import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { ApplicationConsoleRouting, q1ConsoleServer } from "../../src/app/bootstrap/console.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { MouseSettings } from "../../src/input/mouse-settings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { ConsoleScriptFiles } from "../../src/app/bootstrap/config-scripts.ts";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { resolveStartupRules } from "../../src/app/bootstrap/startup-source.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { Q3ServerState, registerQ3ServerCvars } from "../../src/app/bootstrap/simulation/q3/server-state.ts";

function options(args: readonly string[] = []) {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", ...args]);
  if (command.kind !== "run") throw new Error("Expected launch");
  return command.options;
}

test("parsed source skill/mode determine initial simulation options unless explicitly selected", async () => {
  const id = createIdentityOwner("preworld-startup");
  const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
  for (const explicit of [false, true]) {
    const source = new CvarRegistry({ dialect: "q2-classic", context });
    source.register("skill", "1"); source.register("deathmatch", "0"); source.register("coop", "0"); source.register("maxclients", "1");
    const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } };
    const cvars = new CvarRegistry({ dialect: "q2-classic", context: seatContext });
    const mouse = new MouseSettings(new CvarRegistry({ dialect: "q2-classic", context: seatContext }));
    const movement = new CvarRegistry({ dialect: "q2-classic", context });
    const prepared = new PreparedStartup(source, movement, new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q2-classic", movementDialect: "q2-classic", shared: null, sharedNames: source.snapshots().map(state => state.name),
      seats: [{ id: id.seat(0), context: seatContext, cvars, mouse, profile: null, archive: [], mouseArchive: [] }], print: () => {}, forward: () => undefined,
    });
    const initial = options(explicit ? ["--skill", "0", "--mode", "singleplayer"] : []);
    let effective = { options: initial, maxClients: 1 }, loadingFrames = 0;
    await prepared.execute({ nextFrame: async () => { loadingFrames++; }, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
      read: async name => name === "autoexec.cfg" ? "set skill 3\nwait\nset coop 1\nset maxclients 4\nset sensitivity 9\n" : undefined,
      applyLaunchOptions: () => { effective = resolveStartupRules(initial, source, 1, []); },
    });
    expect(loadingFrames).toBe(1);
    expect(prepared.pending).toBe(false);
    expect(effective.options.skill).toBe(explicit ? 0 : 3);
    expect(effective.options.mode).toBe(explicit ? "singleplayer" : "coop");
    expect(effective.maxClients).toBe(4);
    expect(mouse.read().sensitivity).toBe(9);
    expect(prepared.source).toBe(source);
  }
});

test("Q3 source host adopts prepared registry and resolves pending first-map values", () => {
  const id = createIdentityOwner("adopt-q3");
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: id.session, origin: { kind: "server-console" } } });
  cvars.register("g_gametype", "0", CvarFlag.Latch); cvars.set("g_gametype", "3"); cvars.applyLatched();
  registerQ3ServerCvars(cvars, { maxClients: 4, mapName: "q3dm1" });
  expect(cvars.variableString("sv_mapname")).toBe("");
  cvars.set("sv_mapname", "script-map");
  expect(cvars.variableString("sv_mapname")).toBe("");
  const state = new Q3ServerState({ session: id.session, settings: { gameType: 3, singlePlayer: false, maxClients: 4, mapName: "q3dm1", sourceRegistry: cvars }, now: () => 0, print: () => {} });
  expect(state.cvars).toBe(cvars);
  expect(state.cvars.variableString("sv_mapname")).toBe("q3dm1");
  expect(state.cvars.variableValue("g_gametype")).toBe(3);
});

for (const dialect of ["q2-classic", "q2-rerelease"] satisfies readonly import("../../src/contracts/common.ts").CommandDialect[]) {
  test(`${dialect} startup uses native capacity when scripts enable cooperative or deathmatch play`, () => {
    const id = createIdentityOwner("native-capacity");
    for (const mode of ["coop", "deathmatch"]) {
      const source = new CvarRegistry({ dialect, context: { session: id.session, origin: { kind: "server-console" } } });
      source.register("skill", "1"); source.register("maxclients", "1"); source.register(mode, "1");
      expect(resolveStartupRules(options(), source, 1, []).maxClients).toBe(mode === "coop" ? 4 : 8);
    }
  });
}

test("startup world action retains following wait and cvars in original buffer", async () => {
  const id = createIdentityOwner("startup-world-boundary");
  const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q2-classic", context });
  source.register("skill", "1");
  const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } };
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: seatContext });
  const mouse = new MouseSettings(new CvarRegistry({ dialect: "q2-classic", context: seatContext }));
  const maps: number[] = [];
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q2-classic", context }),
    new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q2-classic", movementDialect: "q2-classic", shared: null, sharedNames: ["skill"],
      seats: [{ id: id.seat(0), context: seatContext, cvars, mouse, profile: null, archive: [], mouseArchive: [] }],
      print: () => {}, forward: name => { if (name === "map") maps.push(source.variableValue("skill")); return undefined; },
    });
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => name === "autoexec.cfg" ? "set skill 0; map foo; wait; set skill 3\n" : undefined,
    applyLaunchOptions: () => {},
  });
  expect(maps).toEqual([0]); expect(source.variableValue("skill")).toBe(0);
  expect(prepared.commands.pendingText).toContain("wait; set skill 3");
  const nextSource = new CvarRegistry({ dialect: "q2-classic", context }); nextSource.register("skill", "0");
  const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => "q2-classic",
    server: () => ({ cvars: nextSource, sharedNames: ["skill"] }), seat: () => cvars, input: () => mouse.cvars });
  const nextCommands = new CommandBuffer({ dialect: "q2-classic", context, cvarRouting: routing,
    readScript: (name, source) => prepared.readScript(name, source), onScriptComplete: event => prepared.onScriptComplete(event),
    allowCommand: command => prepared.allowCommand(command) });
  nextCommands.copyPendingFrom(prepared.commands);
  prepared.adopt(routing, () => undefined, { commands: nextCommands, source: nextSource, movement: prepared.movement, fallback: prepared.fallback, scripts: prepared.scripts, read: async () => undefined });
  await prepared.advanceFrame();
  expect(source.variableValue("skill")).toBe(0); expect(prepared.pending).toBe(true);
  await prepared.advanceFrame();
  expect(source.variableValue("skill")).toBe(0); expect(nextSource.variableValue("skill")).toBe(3); expect(prepared.pending).toBe(false);
});

test("secondary exported shared archives are rejected but explicit autoexec overrides remain", async () => {
  const id = createIdentityOwner("secondary-saved-shared");
  const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q3", context }); source.register("sv_hostname", "default", CvarFlag.Archive);
  const seats = [0, 1].map(index => {
    const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(index), client: id.client(index, 0) } };
    return { id: id.seat(index), context: seatContext, cvars: new CvarRegistry({ dialect: "q3", context: seatContext }),
      mouse: new MouseSettings(new CvarRegistry({ dialect: "q3", context: seatContext })), profile: null, archive: [], mouseArchive: [] };
  });
  const printed: string[] = [];
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q3", context }),
    new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
      dialect: "q3", movementDialect: "q3", shared: null, sharedNames: ["sv_hostname"], seats, print: text => printed.push(text), forward: () => undefined,
    });
  let beforeSecondaryAutoexec = "";
  await prepared.execute({ nextFrame: async () => {
    expect(source.variableString("sv_hostname")).toBe("primary custom");
    prepared.commands.executeNow('seta sv_hostname "interactive choice"', context);
    expect(source.variableString("sv_hostname")).toBe("interactive choice");
  }, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async (name, _context, scope) => {
      if (scope === "seat" && name === "q3config.cfg") return 'seta sv_hostname "old exported default"\nseta sensitivity 8\nwait\n';
      if (name !== "autoexec.cfg") return undefined;
      if (scope !== "seat") return 'seta sv_hostname "primary custom"\n';
      beforeSecondaryAutoexec = source.variableString("sv_hostname");
      return 'seta sv_hostname "intentional secondary"\n';
    }, applyLaunchOptions: () => {},
  });
  expect(beforeSecondaryAutoexec).toBe("interactive choice");
  expect(source.variableString("sv_hostname")).toBe("intentional secondary");
  expect(seats[1]?.mouse.read().sensitivity).toBe(8);
  expect(printed.some(text => text.includes("Ignoring shared cvar sv_hostname"))).toBe(true);
});

test("pending and ordinary exec use adopted readers after old content retires", async () => {
  const id = createIdentityOwner("startup-reader-adoption");
  const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q2-classic", context }); source.register("skill", "1");
  const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } };
  const seat = { id: id.seat(0), context: seatContext, cvars: new CvarRegistry({ dialect: "q2-classic", context: seatContext }),
    mouse: new MouseSettings(new CvarRegistry({ dialect: "q2-classic", context: seatContext })), profile: null, archive: [], mouseArchive: [] };
  let retired = false;
  const oldScripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: async () => {
    if (retired) throw new Error("Retired content reader"); return undefined;
  } });
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: "q2-classic", context }), oldScripts, {
    dialect: "q2-classic", movementDialect: "q2-classic", shared: null, sharedNames: ["skill"], seats: [seat], print: () => {}, forward: () => undefined,
  });
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => {
      if (retired) throw new Error("Retired scoped reader");
      return name === "autoexec.cfg" ? "map foo; exec nested.cfg\n" : undefined;
    }, applyLaunchOptions: () => {},
  });
  const newScripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: async () => new TextEncoder().encode("set skill 2\n") });
  const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => "q2-classic",
    server: () => ({ cvars: source, sharedNames: ["skill"] }), seat: () => seat.cvars });
  const commands = new CommandBuffer({ dialect: "q2-classic", context, cvarRouting: routing,
    readScript: (name, source) => prepared.readScript(name, source), onScriptComplete: event => prepared.onScriptComplete(event) });
  commands.copyPendingFrom(prepared.commands);
  prepared.adopt(routing, () => undefined, { commands, source, movement: prepared.movement, fallback: prepared.fallback,
    scripts: newScripts, read: async name => name === "nested.cfg" ? "set skill 3\n" : undefined });
  retired = true;
  await prepared.advanceFrame();
  expect(source.variableValue("skill")).toBe(3); expect(prepared.pending).toBe(false);
  commands.append("exec ordinary.cfg\n"); await commands.executeScriptsAsync(async () => {});
  expect(source.variableValue("skill")).toBe(2);
});

for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly import("../../src/contracts/common.ts").CommandDialect[]) {
  test(`${dialect} QC source getter owns the retained bare-cvar continuation`, async () => {
    const id = createIdentityOwner(`qc-continuation-${dialect}`);
    const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
    const oldSource = new CvarRegistry({ dialect, context }); oldSource.register("skill", "0");
    const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } };
    const seat = { id: id.seat(0), context: seatContext, cvars: new CvarRegistry({ dialect, context: seatContext }),
      mouse: new MouseSettings(new CvarRegistry({ dialect, context: seatContext })), profile: null, archive: [], mouseArchive: [] };
    const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
    const prepared = new PreparedStartup(oldSource, new CvarRegistry({ dialect, context }), scripts, {
      dialect, movementDialect: dialect, shared: null, sharedNames: ["skill"], seats: [seat], print: () => {}, forward: () => undefined,
    });
    await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
      read: async name => name === "quake.rc" ? "exec default.cfg\nexec config.cfg\nmap start\nskill 3\n" : undefined,
      applyLaunchOptions: () => {},
    });
    const current = new CvarRegistry({ dialect, context }); current.register("skill", "0");
    const getters = { q1Source: () => null, quakecSource: () => ({ cvars: current }) };
    const server = q1ConsoleServer(getters);
    expect(server?.cvars).toBe(current);
    expect(server?.sharedNames).toContain("timescale");
    const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => dialect,
      server: () => q1ConsoleServer(getters), seat: () => seat.cvars });
    const commands = new CommandBuffer({ dialect, context, cvarRouting: routing, readScript: (name, source) => prepared.readScript(name, source),
      onScriptComplete: event => prepared.onScriptComplete(event) });
    commands.copyPendingFrom(prepared.commands);
    prepared.adopt(routing, () => undefined, { commands, source: current, movement: prepared.movement, fallback: prepared.fallback,
      scripts, read: async () => undefined });
    await prepared.advanceFrame();
    expect(current.variableValue("skill")).toBe(3); expect(oldSource.variableValue("skill")).toBe(0);
    expect(seat.cvars.find("skill")).toBeUndefined(); expect(prepared.pending).toBe(false);
  });
}

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic"] satisfies readonly import("../../src/contracts/common.ts").CommandDialect[]) {
  test(`${dialect} dedicated configuration has no input seat and retains server-console script ordering`, async () => {
    const identity = createIdentityOwner("dedicated-startup");
    const context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    const source = new CvarRegistry({ dialect, context });
    source.register("skill", "1", CvarFlag.Archive);
    const messages: string[] = [], requests: CommandContext[] = [], reads: string[] = [];
    const prepared = new PreparedStartup(source, new CvarRegistry({ dialect, context }),
      new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
        dialect, movementDialect: dialect, seats: [], shared: null, sharedNames: ["skill"],
        print: text => { messages.push(text); }, forward: (_name, _args, origin) => { requests.push(origin); },
      });
    const setSkill = dialect === "q2-classic" ? "set skill" : "skill";
    let launchSkill = -1, archivedBeforeServer = -1;
    await prepared.execute({ nextFrame: async () => {}, hasMod: false,
      sourceArchive: [{ name: "skill", value: "2" }], movementArchive: [], fallbackArchive: [], sharedArchive: [],
      read: async name => {
        reads.push(name);
        if (name === "server.cfg") {
          archivedBeforeServer = source.variableValue("skill");
          return "bind SPACE +jump\nskill 0\nmap start\nwait\nskill 3\n";
        }
        if (name === "quake.rc") return "exec default.cfg\nexec config.cfg\nexec autoexec.cfg\n";
        if (name === "default.cfg") return `bind SPACE +jump\n${setSkill} 1\n`;
        if (name === "autoexec.cfg") return `${setSkill} 0\nmap start\nwait\n${setSkill} 3\n`;
        return undefined;
      }, applyLaunchOptions: () => { launchSkill = source.variableValue("skill"); },
    });
    expect(prepared.seats).toHaveLength(0);
    expect(messages).toContain("bind <key> [command]\n");
    expect(requests).toHaveLength(1);
    let origin = requests[0]?.origin;
    while (origin?.kind === "script") origin = origin.caller;
    expect(origin?.kind).toBe("server-console");
    expect(source.variableValue("skill")).toBe(0);
    expect(launchSkill).toBe(0);
    expect(prepared.pending).toBe(true);
    await prepared.advanceFrame();
    expect(source.variableValue("skill")).toBe(0);
    await prepared.advanceFrame();
    expect(source.variableValue("skill")).toBe(3);
    expect(prepared.pending).toBe(false);
    if (dialect === "q1-quakeworld") {
      expect(reads).toEqual(["server.cfg"]);
      expect(archivedBeforeServer).toBe(2);
    }
  });
}
