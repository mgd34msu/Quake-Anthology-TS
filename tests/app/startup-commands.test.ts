import { expect, test } from "bun:test";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { ConsoleScriptFiles } from "../../src/app/bootstrap/config-scripts.ts";

test("CLI settings stay in menu, world requests launch, and explicit menu wins", () => {
  expect(parseApplicationCommand([]).kind).toBe("menu");
  expect(parseApplicationCommand(["+set", "name", "Player One"]).kind).toBe("menu");
  expect(parseApplicationCommand(["+map", "base1"]).kind).toBe("run");
  expect(() => parseApplicationCommand(["+connect", "localhost"])).toThrow("--connect-q1");
  expect(parseApplicationCommand(["+map", "base1", "--menu"]).kind).toBe("menu");
  expect(() => parseApplicationCommand(["+set", "fs_game", "mod"])).toThrow("--game");
});

test("argv batches retain source operands through the real tokenizer", () => {
  const parsed = parseApplicationCommand(["+echo", "Player One", "-2", "a+b-c", "+bind x \"+attack\"", "--width", "800"]);
  if (parsed.kind !== "menu") throw new Error("Expected menu");
  expect(parsed.options.width).toBe(800);
  const collected: string[][] = [];
  const commands = new CommandBuffer({ dialect: "q1-netquake", context: { session: createIdentityOwner("argv").session, origin: { kind: "server-console" } } });
  commands.unregister("echo"); commands.register("echo", invocation => { collected.push([...invocation.argv]); });
  commands.register("bind", invocation => { collected.push([...invocation.argv]); });
  for (const text of parsed.options.startupCommands ?? []) commands.append(`${text}\n`);
  commands.execute();
  expect(collected).toEqual([["echo", "Player One", "-2", "a+b-c"], ["bind", "x", "+attack"]]);
});

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} command-line phases execute in the source buffer with world wait continuation`, async () => {
    const id = createIdentityOwner("cli-phases");
    const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
    const source = new CvarRegistry({ dialect, context }); source.register("marker", "initial");
    const seen: string[] = [], requests: string[] = [];
    const q1 = dialect === "q1-netquake" || dialect === "q1-quakeworld";
    const lines = [q1 ? "marker cli" : "set marker cli", "map start", "wait", q1 ? "marker tail" : "set marker tail"];
    const prepared = new PreparedStartup(source, new CvarRegistry({ dialect, context }), new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect, movementDialect: dialect, startupCommands: lines, seats: [], shared: null, sharedNames: ["marker"], print: () => {},
      forward: name => { requests.push(name); },
    });
    prepared.commands.register("record", () => { seen.push(source.variableString("marker")); });
    await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
      read: async name => {
        if (name === "quake.rc") return "exec default.cfg\nexec config.cfg\nstuffcmds\n";
        if (name === "server.cfg") return "record\nmarker config\n";
        if (name === "default.cfg") return `record\n${q1 ? "marker" : "set marker"} default\n`;
        if (name === "config.cfg" || name === "q3config.cfg") return `${q1 ? "marker" : "set marker"} config\n`;
        if (name === "autoexec.cfg") return "record\n";
        return undefined;
      }, applyLaunchOptions: () => {},
    });
    expect(requests).toEqual(["map"]);
    expect(prepared.pending).toBe(true);
    // Q2 consumes both +set entries early, whereas Q3 also keeps them in late order.
    expect(source.variableString("marker")).toBe(q1 || dialect === "q3" ? "cli" : "tail");
    await prepared.advanceFrame(); await prepared.advanceFrame();
    expect(source.variableString("marker")).toBe(dialect === "q1-quakeworld" ? "config" : "tail");
    expect(prepared.pending).toBe(false);
    expect(seen[0]).toBe(dialect === "q1-netquake" ? "initial" : "tail");
  });
}

test("stuffcmds retains canonical argv through real buffer replacement without changing legacy argv", async () => {
  const context: CommandContext = { session: createIdentityOwner("stuff-adopt").session, origin: { kind: "server-console" } };
  const printed: string[] = [];
  const old = new CommandBuffer({ dialect: "q1-netquake", context, startupCommandText: 'echo "a+b-c"\n' });
  old.append("wait\nstuffcmds\n"); await old.executeScriptsAsync(async () => {});
  const current = new CommandBuffer({ dialect: "q1-netquake", context, print: text => { printed.push(text); } });
  current.copyPendingFrom(old); await current.executeScriptsAsync(async () => {});
  expect(printed.join("")).toContain("a+b-c");
  const legacy = new CommandBuffer({ dialect: "q1-netquake", context, commandLine: ["quake", "+echo", "legacy"], print: text => { printed.push(text); } });
  legacy.append("stuffcmds\n"); legacy.execute();
  expect(printed.join("")).toContain("legacy");
});

test("Q2 set is early but seta remains a late command", async () => {
  const context: CommandContext = { session: createIdentityOwner("early-set").session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q2-classic", context }); source.register("marker", "initial");
  const values: string[] = [];
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q2-classic", context }),
    new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q2-classic", movementDialect: "q2-classic", seats: [], shared: null, sharedNames: ["marker"],
      startupCommands: ["set marker early", "seta marker late"], print: () => {}, forward: () => undefined,
    });
  prepared.commands.register("record", () => { values.push(source.variableString("marker")); });
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => name === "default.cfg" ? "record\nset marker default\n" : name === "config.cfg" ? "set marker config\n" : name === "autoexec.cfg" ? "record\n" : undefined,
    applyLaunchOptions: () => { values.push(source.variableString("marker")); },
  });
  expect(values).toEqual(["early", "early", "late"]);
});

test("Q3 startup variables force latched, readonly and init values before configs and replay, retaining normal late sets", async () => {
  const context: CommandContext = { session: createIdentityOwner("q3-startup-variable").session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q3", context });
  source.register("g_gametype", "0", CvarFlag.Latch); source.set("g_gametype", "2");
  source.register("locked", "original", CvarFlag.ReadOnly); source.register("initial", "original", CvarFlag.Init);
  const records: string[][] = [];
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q3", context }),
    new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q3", movementDialect: "q3", seats: [], shared: null, sharedNames: ["g_gametype", "locked", "initial"],
      startupCommands: ["set g_gametype 3", "set locked cli", "set initial cli", "record", "seta locked denied"],
      print: () => {}, forward: () => undefined,
    });
  prepared.commands.register("record", () => { records.push([source.variableString("g_gametype"), source.variableString("locked"), source.variableString("initial")]); });
  prepared.commands.register("change", () => { source.set("g_gametype", "4", true); source.set("locked", "config", true); source.set("initial", "config", true); });
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => name === "default.cfg" ? "record\n" : name === "autoexec.cfg" ? "change\n" : undefined,
    applyLaunchOptions: () => {},
  });
  expect(records).toEqual([["3", "cli", "cli"], ["3", "cli", "cli"]]);
  expect(source.variableString("locked")).toBe("cli");
  expect(source.find("g_gametype")?.latchedValue).toBeUndefined();
  for (const name of ["g_gametype", "locked", "initial"]) expect((source.find(name)?.flags ?? 0) & CvarFlag.UserCreated).toBe(CvarFlag.UserCreated);
});

for (const safe of ["safe", "CVAR_RESTART"]) test(`Q3 +${safe} consumes safe mode and skips persisted configuration`, async () => {
  const context: CommandContext = { session: createIdentityOwner("q3-safe").session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q3", context }); source.register("marker", "initial", CvarFlag.Archive);
  const reads: string[] = [], order: string[] = [], forwarded: string[] = [];
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q3", context }),
    new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q3", movementDialect: "q3", seats: [], shared: null, sharedNames: ["marker"], startupCommands: ["record before", safe, "record after"],
      print: () => {}, forward: name => { forwarded.push(name); },
    });
  prepared.commands.register("record", command => { order.push(`${command.args[0]}:${source.variableString("marker")}`); });
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [{ name: "marker", value: "saved" }], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => { reads.push(name); return name === "default.cfg" ? "set marker default\n" : name === "q3config.cfg" ? "set marker file\n" : undefined; },
    applyLaunchOptions: () => {},
  });
  expect(reads).toEqual(["default.cfg", "autoexec.cfg"]);
  expect(order).toEqual(["before:default", "after:default"]);
  expect(forwarded).toEqual([]);
  expect(prepared.pending).toBe(false);
});

test("filesystem startup selection rejects ASCII case variants before application launch", () => {
  for (const args of [["+set", "FS_GAME", "mod"], ["+SET", "fs_game", "mod"], ["+SeT", "BaSeDiR", "/tmp"]])
    expect(() => parseApplicationCommand(args)).toThrow("--game");
});
