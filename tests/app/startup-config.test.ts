import { SeatInput } from "../../src/input/seat.ts";
import { registerBindingCommands } from "../../src/input/bindings.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { StartupConfig, type StartupScriptScope } from "../../src/app/bootstrap/startup-config.ts";

const identity = createIdentityOwner("startup-config");
const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };

function fixture(dialect: CommandDialect, files: ReadonlyMap<string, string>, hasMod = false) {
  const reads: string[] = [], phases: string[] = [];
  const cvars = new CvarRegistry({ dialect, context });
  cvars.register("setting", "source");
  const startup = new StartupConfig({ dialect, context, hasMod,
    read: async (name, _source, scope) => { reads.push(`${scope}:${name}`); return files.get(`${scope}:${name}`); },
    applySelectedDefaults: () => { phases.push("selected"); cvars.set("setting", "selected"); },
    applyArchive: () => { phases.push("archive"); cvars.applyArchive([{ name: "setting", value: "saved" }]); },
    applyLaunchOptions: () => { phases.push("launch"); cvars.set("setting", "explicit"); },
  });
  const commands = new CommandBuffer({ dialect, context, cvars, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
  commands.register("observe", () => { phases.push(cvars.variableString("setting")); });
  return { startup, commands, reads, phases, cvars };
}

test("Q1 quake.rc controls nested stages, missing config, wait, and explicit launch precedence", async () => {
  const run = fixture("q1-netquake", new Map([
    ["mounted:quake.rc", "exec default.cfg\nexec config.cfg\nexec autoexec.cfg\nobserve\n"],
    ["mounted:default.cfg", "setting shipped\nwait\n"],
    ["user:autoexec.cfg", "observe\nsetting user\n"],
  ]));
  expect(await run.startup.executeFrame(run.commands, async () => {})).toBe(false);
  expect(run.phases).toEqual([]);
  expect(await run.startup.executeFrame(run.commands, async () => {})).toBe(true);
  expect(run.phases).toEqual(["selected", "archive", "saved", "user", "launch"]);
  expect(run.cvars.variableString("setting")).toBe("explicit");
  expect(await run.startup.executeFrame(run.commands, async () => {})).toBe(true);
  expect(run.phases.filter(phase => phase === "launch")).toHaveLength(1);
});

test("Q2 rerelease uses distinct base and mod loose autoexec scopes", async () => {
  const run = fixture("q2-rerelease", new Map<string, string>(), true);
  expect(await run.startup.executeFrame(run.commands, async () => {})).toBe(true);
  expect(run.reads).toEqual(["mounted:default.cfg", "loose:config.cfg", "base-loose:autoexec.cfg", "game-loose:autoexec.cfg", "loose:postexec.cfg"]);
  expect(run.phases).toEqual(["selected", "archive", "launch"]);
});

test("Q3 applies archives after config and before nested autoexec scripts", async () => {
  const run = fixture("q3", new Map([
    ["user:q3config.cfg", "set setting legacy\nobserve\n"],
    ["user:autoexec.cfg", "observe\nexec custom.cfg\n"],
    ["user:custom.cfg", "set setting user\nobserve\n"],
  ]));
  await run.startup.executeFrame(run.commands, async () => {});
  expect(run.phases).toEqual(["selected", "legacy", "archive", "saved", "user", "launch"]);
  run.commands.append("exec default.cfg\n");
  await run.commands.executeScriptsAsync(async () => {});
  expect(run.phases).toEqual(["selected", "legacy", "archive", "saved", "user", "launch"]);
  expect(run.reads.at(-1)).toBe("user:default.cfg");
});

test("missing Q1 parent does not pretend default and archive stages ran", async () => {
  const run = fixture("q1-netquake", new Map<string, string>());
  await expect(run.startup.executeFrame(run.commands, async () => {})).rejects.toThrow("did not reach");
  expect(run.phases).toEqual([]);
});

test("read failure aborts startup without applying archive or launch callbacks", async () => {
  const failure = new Error("unreadable config");
  const phases: string[] = [];
  const startup = new StartupConfig({ dialect: "q3", context, hasMod: false,
    read: async (_name: string, _source: CommandContext, _scope: StartupScriptScope) => { throw failure; },
    applySelectedDefaults: () => { phases.push("default"); }, applyArchive: () => { phases.push("archive"); }, applyLaunchOptions: () => { phases.push("launch"); },
  });
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
  await expect(startup.executeFrame(commands, async () => {})).rejects.toThrow(failure);
  expect(phases).toEqual([]);
});

test("scoped reader keeps loose base and mod files separate from mounted fallback", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createStartupScriptReader } = await import("../../src/app/bootstrap/startup-config.ts");
  const root = await mkdtemp(join(tmpdir(), "startup-config-"));
  try {
    const base = join(root, "base"), game = join(root, "game");
    await mkdir(base); await mkdir(game);
    await writeFile(join(base, "autoexec.cfg"), "base");
    await writeFile(join(game, "autoexec.cfg"), "mod");
    const read = createStartupScriptReader({ mounted: async () => new Uint8Array([112, 97, 107]), user: async () => "user", baseLooseRoots: [base], gameLooseRoots: [game] });
    expect(await read("autoexec.cfg", context, "base-loose")).toBe("base");
    expect(await read("autoexec.cfg", context, "game-loose")).toBe("mod");
    expect(await read("autoexec.cfg", context, "loose")).toBe("mod");
    expect(await read("missing.cfg", context, "game-loose")).toBeUndefined();
    expect(await read("default.cfg", context, "mounted")).toBe("pak");
    expect(await read("config.cfg", context, "user")).toBe("user");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Q2 rerelease initial config falls back to base loose file when mod has none", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createStartupScriptReader } = await import("../../src/app/bootstrap/startup-config.ts");
  const root = await mkdtemp(join(tmpdir(), "startup-base-config-"));
  try {
    const base = join(root, "base"), game = join(root, "mod");
    await mkdir(base); await mkdir(game);
    await writeFile(join(base, "config.cfg"), "record base-config\n");
    const seen: string[] = [];
    const startup = new StartupConfig({ dialect: "q2-rerelease", context, hasMod: true,
      read: createStartupScriptReader({ mounted: async () => undefined, user: async () => undefined, baseLooseRoots: [base], gameLooseRoots: [game] }),
      applySelectedDefaults: () => { seen.push("defaults"); }, applyArchive: () => { seen.push("archive"); }, applyLaunchOptions: () => { seen.push("launch"); },
    });
    const commands = new CommandBuffer({ dialect: "q2-rerelease", context, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
    commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
    expect(await startup.executeFrame(commands, async () => {})).toBe(true);
    expect(seen).toEqual(["defaults", "base-config", "archive", "launch"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup applies selected defaults before saved empty bindings and later user autoexec", async () => {
  for (const autoexec of ["", 'bind z "weapon 7"\n']) {
    let seat: SeatInput | undefined;
    const startup = new StartupConfig({ dialect: "q3", context, hasMod: false,
      read: async name => name === "default.cfg" ? 'unbindall\nbind 1 "weapon 1"\n' : name === "autoexec.cfg" ? autoexec : undefined,
      applySelectedDefaults: () => { seat?.unbindAll(); seat?.bind({ input: { kind: "key", code: 50 }, target: { kind: "command", text: "impulse 2" } }); },
      applyArchive: () => { seat?.unbindAll(); },
      applyLaunchOptions: () => {},
    });
    const commands = new CommandBuffer({ dialect: "q3", context, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
    seat = new SeatInput({ seat: identity.seat(0), dialect: "q3", context, commands, uiEvent: () => false });
    registerBindingCommands(commands, () => seat ?? null, () => {});
    await startup.executeFrame(commands, async () => {});
    expect(seat.bindings).toEqual(autoexec === "" ? [] : [{ input: { kind: "key", code: 122 }, target: { kind: "command", text: "weapon 7" } }]);
  }
});

test("unsaved declaration defaults do not replace legacy configuration values", async () => {
  const cvars = new CvarRegistry({ dialect: "q3", context });
  cvars.register("sensitivity", "5", 1);
  const saved: readonly { readonly name: string; readonly value: string }[] = [];
  const startup = new StartupConfig({ dialect: "q3", context, hasMod: false,
    read: async name => name === "q3config.cfg" ? "set sensitivity 9\n" : undefined,
    applySelectedDefaults: () => {}, applyArchive: () => cvars.applyArchive(saved), applyLaunchOptions: () => {},
  });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
  await startup.executeFrame(commands, async () => {});
  expect(cvars.variableString("sensitivity")).toBe("9");
});

test("secondary seat scripts never replay shared source defaults or autoexec", async () => {
  const cvars = new CvarRegistry({ dialect: "q3", context });
  cvars.register("hostname", "default host", 1);
  const reads: string[] = [];
  for (const scope of ["source", "seat"] satisfies readonly ("source" | "seat")[]) {
    const startup = new StartupConfig({ dialect: "q3", context, hasMod: false, scope,
      read: async (name, _source, readScope) => {
        reads.push(`${scope}:${readScope}:${name}`);
        if (readScope === "seat") return undefined;
        if (name === "default.cfg") return 'set hostname "default host"\n';
        return name === "autoexec.cfg" ? 'set hostname "my custom host"\n' : undefined;
      }, applySelectedDefaults: () => {}, applyArchive: () => {}, applyLaunchOptions: () => {},
    });
    const commands = new CommandBuffer({ dialect: "q3", context, cvars, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
    await startup.executeFrame(commands, async () => {});
    expect(cvars.variableString("hostname")).toBe("my custom host");
  }
  expect(reads.filter(read => read.startsWith("seat:"))).toEqual(["seat:seat:q3config.cfg", "seat:seat:autoexec.cfg"]);
});
