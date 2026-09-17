import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { registerConsoleCommands } from "../../src/console/commands.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { ConsoleScriptFiles, readConsoleScript, seatConsoleConfig } from "../../src/app/bootstrap/config-scripts.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";

const identity = createIdentityOwner("config-scripts");
function context(index: number): CommandContext { return { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(index), client: identity.client(index, 0) } }; }

test("configuration library lists readable seat and product scripts with the same precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "console-script-library-"));
  try {
    const settings = new ConfigStore(join(root, "product")), consoleRoot = join(root, "console");
    const scripts = new ConsoleScriptFiles({ consoleRoot, settings, mounted: undefined });
    await settings.dump("config.cfg", "echo product\n");
    await settings.dump("presets/aim.cfg", "echo aim\n");
    await settings.dump("ignored.txt", "not a config");
    await seatConsoleConfig(consoleRoot, identity.seat(0)).dump("CONFIG.cfg", "echo seat\n");
    await seatConsoleConfig(consoleRoot, identity.seat(1)).dump("other.cfg", "echo other\n");
    expect(await scripts.list(context(0))).toEqual([{ name: "CONFIG.cfg", kind: "seat" }, { name: "presets/aim.cfg", kind: "product" }]);
    expect(await scripts.read("CONFIG.cfg", context(0))).toBe("echo seat\n");
    expect((await scripts.list(context(1))).map(entry => entry.name)).toEqual(["config.cfg", "other.cfg", "presets/aim.cfg"]);
    await scripts.close();
    await expect(scripts.list(context(0))).rejects.toThrow("retired");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit legacy home migration selects latest game config without writing or overriding seat archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "console-script-migration-"));
  try {
    const home = join(root, "legacy"), first = new ConfigStore(join(home, "id1")), latest = new ConfigStore(join(home, "hipnotic"));
    const settings = new ConfigStore(join(root, "current-product")), consoleRoot = join(root, "console");
    await first.dump("config.cfg", "seta imported older\n");
    await latest.dump("config.cfg", "seta imported newest\nexec nested.cfg\n");
    await utimes(join(first.root, "config.cfg"), 100, 100); await utimes(join(latest.root, "config.cfg"), 200, 200);
    await settings.dump("nested.cfg", "seta nested done\n");
    const source = context(0), output: string[] = [];
    const scripts = new ConsoleScriptFiles({ consoleRoot, settings, legacyConfig: { sharedRoot: home, gameRoots: [first.root, latest.root] }, mounted: undefined });
    const cvars = new CvarRegistry({ dialect: "q1-netquake", context: source });
    const commands = new CommandBuffer({ dialect: "q1-netquake", context: source, cvars, readScript: (name, caller) => scripts.read(name, caller), print: text => { output.push(text); } });
    commands.append("exec config.cfg\necho after\n"); await commands.executeScriptsAsync(async () => {});
    expect(cvars.variableString("imported")).toBe("newest"); expect(cvars.variableString("nested")).toBe("done");
    expect(output.join("")).toContain("after");
    expect(await Bun.file(join(consoleRoot, "settings/seat-0/config.cfg")).exists()).toBe(false);
    await writeFile(join(home, "config.cfg"), Buffer.from('seta imported "caf\xe9"\n', "latin1"));
    expect(await scripts.read("config.cfg", source)).toContain('"caf\xe9"');
    await settings.dump("subdir/config.cfg", "echo requested nested product\n");
    expect(await scripts.read("subdir/config.cfg", source)).toBe("echo requested nested product\n");
    await seatConsoleConfig(consoleRoot, identity.seat(0)).dump("config.cfg", "seta imported retained\n");
    expect(await scripts.read("config.cfg", source)).toBe("seta imported retained\n");
    expect(await scripts.read("config.cfg", context(1))).toContain('"caf\xe9"');
    const separate = new ConsoleScriptFiles({ consoleRoot: join(root, "qw-console"), settings, mounted: async () => new TextEncoder().encode("mounted config") });
    expect(await separate.read("config.cfg", context(0))).toBe("mounted config");
    await separate.close(); await scripts.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("configuration retirement retains reads from invocation through queued writes and mounted settlement", async () => {
  const root = await mkdtemp(join(tmpdir(), "console-script-retirement-"));
  try {
    const writing = Promise.withResolvers<void>(), reading = Promise.withResolvers<Uint8Array | undefined>();
    const entered = Promise.withResolvers<void>();
    let retired = 0;
    const scripts = new ConsoleScriptFiles({ consoleRoot: root, settings: new ConfigStore(join(root, "product")),
      mounted: () => { entered.resolve(); return reading.promise; } }, async () => { retired++; });
    const write = scripts.write(() => writing.promise);
    const read = scripts.read("pending.cfg", context(0));
    const close = scripts.close();
    expect(scripts.close()).toBe(close);
    await Promise.resolve();
    expect(retired).toBe(0);
    await expect(scripts.read("late.cfg", context(0))).rejects.toThrow("retired");
    writing.resolve(); await write; await entered.promise;
    expect(retired).toBe(0);
    reading.resolve(new TextEncoder().encode("echo retained\n"));
    expect(await read).toBe("echo retained\n");
    await close; expect(retired).toBe(1);

    const mountedRead = Promise.withResolvers<Uint8Array | undefined>();
    const mounted = new ConsoleScriptFiles({ consoleRoot: root, settings: new ConfigStore(root), mounted: () => mountedRead.promise }, async () => { retired++; });
    const pending = mounted.readMounted("default.cfg"), retirement = mounted.close();
    await Promise.resolve(); expect(retired).toBe(1);
    mountedRead.reject(new Error("read failed"));
    await expect(pending).rejects.toThrow("read failed");
    await retirement; expect(retired).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exec reads each seat's exported config before product user files and mounted arbitrary scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "console-scripts-"));
  try {
    const consoleRoot = join(root, "console"), settings = new ConfigStore(join(root, "product")), installed = new ConfigStore(join(root, "installed"));
    await installed.dump("scripts/custom.txt", "seta mounted_value yes\n");
    await installed.dump("config.cfg", "seta seat_value mounted\n");
    await settings.dump("config.cfg", "seta seat_value user\n");
    await seatConsoleConfig(consoleRoot, identity.seat(0)).dump("config.cfg", "seta seat_value zero\nexec scripts/custom.txt\n");
    await seatConsoleConfig(consoleRoot, identity.seat(1)).dump("config.cfg", "seta seat_value one\nexec scripts/custom.txt\n");
    using mounts = await openMountPlan({ id: "mount-plan:scripts:1", mounts: [{ kind: "loose", rootPath: installed.root, identity: { id: "mount:scripts:1", content: "q3:classic:baseq3:installed", generation: 1 } }], defaultOrder: ["mount:scripts:1"], prefixOrders: [] });
    for (const index of [0, 1, 2]) {
      const source = context(index), cvars = new CvarRegistry({ dialect: "q3", context: source });
      const scripts = new ConsoleScriptFiles({ consoleRoot, settings, mounted: async path => (await mounts.open(path))?.bytes });
      const commands = new CommandBuffer({ dialect: "q3", context: source, cvars, readScript: (name, source) => scripts.read(name, source) });
      commands.append("exec config; seta finished yes\n");
      for (let attempts = 0; attempts < 100 && cvars.variableString("finished") !== "yes"; attempts++) { commands.execute(); await Bun.sleep(1); }
      expect(cvars.variableString("finished")).toBe("yes");
      expect(cvars.variableString("seat_value")).toBe(index === 0 ? "zero" : index === 1 ? "one" : "user");
      if (index !== 2) expect(cvars.variableString("mounted_value")).toBe("yes");
      const seatConsole = new SeatConsole({ seat: identity.seat(index), dialect: "q3", context: source, commands, cvars,
        now: () => 0, connected: () => false, clipboard: () => null, focus() {}, chat() {} });
      const writes: Promise<void>[] = [];
      const unregister = registerConsoleCommands({ commands, config: seat => seatConsoleConfig(consoleRoot, seat),
        configuration: invocation => `${commands.archiveCommands(invocation.source).join("\n")}\n`, console: () => seatConsole,
        canChat: () => false, capture: () => null, mapName: () => "test", print() {}, queue: operation => { writes.push(scripts.write(operation)); } });
      commands.append("writeconfig roundtrip; seta seat_value changed; exec roundtrip; seta roundtrip_finished yes\n");
      for (let attempts = 0; attempts < 100 && cvars.variableString("roundtrip_finished") !== "yes"; attempts++) { commands.execute(); await Bun.sleep(1); }
      expect(cvars.variableString("seat_value")).toBe(index === 0 ? "zero" : index === 1 ? "one" : "user");
      await Promise.all(writes); unregister();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("script reader rejects escapes and symlinks without falling through to mounted files", async () => {
  const root = await mkdtemp(join(tmpdir(), "console-script-paths-"));
  try {
    const consoleRoot = join(root, "console"), settings = new ConfigStore(join(root, "product")), outside = new ConfigStore(join(root, "outside"));
    await outside.dump("secret.cfg", "secret");
    await mkdir(settings.root); await mkdir(join(consoleRoot, "settings/seat-0"), { recursive: true });
    await symlink(outside.root, join(settings.root, "escape"));
    await symlink(join(outside.root, "secret.cfg"), join(consoleRoot, "settings/seat-0/secret.cfg"));
    let reads = 0;
    const read = (name: string) => readConsoleScript({ name, source: context(0), consoleRoot, settings, mounted: async () => { reads++; return undefined; } });
    await expect(read("../secret.cfg")).rejects.toThrow();
    await expect(read("escape/secret.cfg")).rejects.toThrow("symlink");
    await expect(read("secret.cfg")).rejects.toThrow("symlink");
    expect(reads).toBe(0);
    expect(await read("absent.cfg")).toBeUndefined();
    expect(reads).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
