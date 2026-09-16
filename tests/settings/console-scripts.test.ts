import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
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
        capture: () => null, mapName: () => "test", print() {}, queue: operation => { writes.push(scripts.write(operation)); } });
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
