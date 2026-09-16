import { SeatConsole } from "../../src/console/session.ts";
import { registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
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

test('prepared adoption retains binding commands and the same pending program owner', async () => {
  const identity = createIdentityOwner('stable-prepared-owner');
  const context: CommandContext = { session: identity.session, origin: { kind: 'local-seat', seat: identity.seat(0), client: identity.client(0, 0) } };
  const source = new CvarRegistry({ dialect: 'q2-classic', context }); source.register('skill', '0');
  const cvars = new CvarRegistry({ dialect: 'q2-classic', context });
  const mouse = new MouseSettings(new CvarRegistry({ dialect: 'q2-classic', context }));
  const prepared = new PreparedStartup(source, new CvarRegistry({ dialect: 'q2-classic', context }),
    new ConsoleScriptFiles({ consoleRoot: '/unused', settings: new ConfigStore('/unused'), mounted: undefined }), {
      dialect: 'q2-classic', movementDialect: 'q2-classic', shared: null, sharedNames: ['skill'],
      seats: [{ id: identity.seat(0), context, cvars, mouse, profile: null, archive: [], mouseArchive: [] }],
      print: () => {}, forward: () => undefined,
    });
  const commands = prepared.commands, input = prepared.seats[0]?.input;
  await prepared.execute({ nextFrame: async () => {}, hasMod: false, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => name === 'autoexec.cfg' ? 'alias finish "set skill 3"; map first; wait; finish\n' : undefined,
    applyLaunchOptions: () => {},
  });
  const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => 'q2-classic',
    server: () => ({ cvars: source, sharedNames: ['skill'] }), seat: () => cvars, input: () => mouse.cvars });
  const calls: string[] = [];
  prepared.adopt(routing, name => { calls.push(`old:${name}`); return undefined; }, { source,
    movement: prepared.movement, fallback: prepared.fallback, scripts: prepared.scripts, read: async () => undefined });
  expect(prepared.commands).toBe(commands);
  expect(prepared.seats[0]?.input).toBe(input);
  expect(commands.exists('bind')).toBe(true);
  expect(commands.exists('map')).toBe(true);
  await prepared.advanceFrame(); expect(prepared.pending).toBe(true);
  await prepared.advanceFrame(); expect(prepared.pending).toBe(false); expect(source.variableValue('skill')).toBe(3);
  prepared.adopt(routing, name => { calls.push(`current:${name}`); return undefined; });
  commands.append('map second\n'); commands.execute();
  expect(calls).toEqual(['current:map']);
});

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
  const nextCommands = prepared.commands;
  expect(nextCommands).toBe(prepared.commands);
  prepared.adopt(routing, () => undefined, { source: nextSource, movement: prepared.movement, fallback: prepared.fallback, scripts: prepared.scripts, read: async () => undefined });
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
  const commands = prepared.commands;
  prepared.adopt(routing, () => undefined, { source, movement: prepared.movement, fallback: prepared.fallback,
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
    prepared.adopt(routing, () => undefined, { source: current, movement: prepared.movement, fallback: prepared.fallback,
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


test("prepared output follows two real seat consoles through adoption and retired cleanup", () => {
  const identity = createIdentityOwner("prepared-output"), startup: string[] = [], registryHost: string[] = [];
  const context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q3", context, print: text => registryHost.push(text) });
  source.register("locked", "1", CvarFlag.ReadOnly);
  const movement = new CvarRegistry({ dialect: "q3", context, print: text => registryHost.push(text) });
  const seats = [0, 1].map(index => {
    const seatContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(index), client: identity.client(index, 0) } };
    const cvars = new CvarRegistry({ dialect: "q3", context: seatContext, print: text => registryHost.push(text) });
    cvars.register("validated", "1"); cvars.bindValue("validated", { validate: value => value === "1" ? null : "rejected value", changed: () => {} });
    return { id: identity.seat(index), context: seatContext, cvars, mouse: new MouseSettings(new CvarRegistry({ dialect: "q3", context: seatContext, print: text => registryHost.push(text) })), profile: null, archive: [], mouseArchive: [] };
  });
  const prepared = new PreparedStartup(source, movement, new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined }), {
    dialect: "q3", movementDialect: "q3", seats, shared: null, sharedNames: ["locked"], print: text => startup.push(text), forward: () => undefined,
  });
  const commands = prepared.commands;
  commands.append("echo before-ui\n", context); commands.execute();
  expect(startup.join("")).toContain("before-ui"); startup.length = 0;
  const makeConsoles = () => seats.map(seat => new SeatConsole({ seat: seat.id, dialect: "q3", context: seat.context, commands, cvars: seat.cvars,
    now: () => 0, connected: () => true, clipboard: () => null, focus: () => {}, chat: () => {} }));
  const oldConsoles = makeConsoles(), currentConsoles = makeConsoles(), seen: CommandContext[] = [];
  const output = (consoles: readonly SeatConsole[]) => (text: string, source?: CommandContext): void => {
    if (source === undefined) throw new Error("Private command output lost its source");
    seen.push(source);
    let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind !== "local-seat") throw new Error("Expected private seat output");
    const console = consoles[origin.seat.index]; if (console === undefined) throw new Error("Missing output seat"); console.print(text);
  };
  const old = prepared.bindOutput(output(oldConsoles));
  const first = seats[0], second = seats[1]; if (first === undefined || second === undefined) throw new Error("Two seats required");
  commands.append("echo first-only\n", first.context); commands.execute();
  expect(oldConsoles[0]?.buffer.dump()).toContain("first-only"); expect(oldConsoles[1]?.buffer.dump()).not.toContain("first-only");
  const current = prepared.bindOutput(output(currentConsoles));
  const nextSource = new CvarRegistry({ dialect: "q3", context, print: text => registryHost.push(text) }); nextSource.register("locked", "2", CvarFlag.ReadOnly);
  const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => "q3", server: () => ({ cvars: nextSource, sharedNames: ["locked"] }),
    seat: id => seats.find(seat => seat.id.equals(id))?.cvars ?? null, input: id => seats.find(seat => id !== null && seat.id.equals(id))?.mouse.cvars ?? null });
  prepared.adopt(routing, () => undefined, { source: nextSource, movement, fallback: prepared.fallback, scripts: prepared.scripts, read: async () => undefined });
  old(); old();
  const releaseHelp = registerDiscoveryCommands(commands, text => output(currentConsoles)(text, commands.executionContext));
  const nested: CommandContext = { session: context.session, origin: { kind: "script", name: "nested.cfg", caller: { kind: "script", name: "autoexec.cfg", caller: second.context.origin } } };
  commands.append('echo second-only; bind w +forward; bind w; locked; set locked 3; set validated 2; help absent-command\n', nested); commands.execute();
  const rendered = currentConsoles[1]?.buffer.dump() ?? "";
  for (const expected of ["second-only", "+forward", 'is:"2', "locked is read only", "validated: rejected value", "No command, setting, or alias"]) expect(rendered).toContain(expected);
  expect(currentConsoles[0]?.buffer.dump()).not.toContain("second-only");
  expect(oldConsoles[1]?.buffer.dump()).not.toContain("second-only");
  expect(startup).toEqual([]); expect(registryHost).toEqual([]);
  for (const source of seen.slice(1)) expect(source).toEqual(nested);
  source.set("locked", "4"); expect(registryHost.join("")).toContain("locked is read only"); registryHost.length = 0;
  releaseHelp(); current();
  commands.append("echo after-ui\n", first.context); commands.execute();
  nextSource.set("locked", "4");
  expect(startup.join("")).toContain("after-ui"); expect(registryHost.join("")).toContain("locked is read only");
  expect(prepared.commands).toBe(commands); expect(prepared.source).toBe(nextSource);
});

test("registry output bindings restore the latest live sink without changing cvar state", () => {
  const identity = createIdentityOwner("registry-output"), calls: string[] = [];
  const registry = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "server-console" } }, print: text => calls.push("host:" + text) });
  registry.register("locked", "1", CvarFlag.ReadOnly);
  const before = registry.captureSaveState();
  const old = registry.bindOutput(text => calls.push("old:" + text));
  const current = registry.bindOutput(text => calls.push("current:" + text));
  old(); old(); expect(registry.captureSaveState()).toEqual(before); registry.set("locked", "2");
  expect(calls).toEqual(["current:locked is read only.\n"]);
  current(); registry.set("locked", "2");
  expect(calls.at(-1)).toBe("host:locked is read only.\n"); expect(registry.variableString("locked")).toBe("1");
  const control = new CvarRegistry({ dialect: "q3", context: registry.context });
  control.register("locked", "1", CvarFlag.ReadOnly); control.set("locked", "2"); control.set("locked", "2");
  expect(registry.captureSaveState()).toEqual(control.captureSaveState());
});



test("inactive retained seats neither route commands nor join another source's console owners", async () => {
  const identity = createIdentityOwner("retained-inactive-seats"), calls: string[] = [], registryOutput: string[] = [];
  const context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q1-netquake", context });
  const seats = [0, 1].map(index => {
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(index), client: identity.client(index, 0) } };
    const cvars = new CvarRegistry({ dialect: "q1-netquake", context, print: text => registryOutput.push(text) });
    return { id: identity.seat(index), context, cvars, mouse: new MouseSettings(cvars), profile: null, archive: [], mouseArchive: [] };
  });
  const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
  const prepared = new PreparedStartup(source, source, scripts, { dialect: "q1-netquake", movementDialect: "q1-netquake", shared: null, sharedNames: [], seats,
    print: text => calls.push(text), forward: () => undefined });
  const [first, second] = prepared.seats;
  if (first === undefined || second === undefined) throw new Error("Missing retained seats");
  const release = prepared.bindOutput(text => calls.push(text));
  prepared.setActiveSeats([first.id]);
  const next = new CvarRegistry({ dialect: "q3", context });
  const primary = new CvarRegistry({ dialect: "q3", context: first.context });
  const routing = new ApplicationConsoleRouting({ fallback: next, sourceDialect: () => "q3", server: () => ({ cvars: next, sharedNames: [] }),
    seat: id => id.equals(first.id) ? primary : second.cvars, input: id => id === null || id.equals(first.id) ? primary : second.mouse.cvars });
  prepared.adopt(routing, () => undefined, { source: next, movement: next, fallback: next, scripts, read: async () => undefined });
  prepared.publishSeats([{ ...first, cvars: primary, mouse: new MouseSettings(primary) }, second], [first.id]);
  expect(prepared.seats[1]?.input).toBe(second.input);
  expect(second.input.dialect).toBe("q1-netquake");
  const nested: CommandContext = { session: identity.session, origin: { kind: "script", name: "inactive.cfg", caller: second.context.origin } };
  prepared.commands.append("echo inactive\n", nested);
  prepared.commands.append("echo active\n", first.context);
  prepared.commands.execute();
  expect(calls.join("")).not.toContain("inactive \n");
  expect(calls.join("")).toContain("active \n");
  expect(calls.join("")).toContain("local client is inactive or has retired");
  second.cvars.set("absent", "2");
  expect(registryOutput.join("")).toContain("variable absent not found");
  expect(await prepared.readScript("inactive.cfg", nested)).toBeUndefined();
  expect(() => prepared.prepareClientCommands({ dialect: "q1-netquake", context, cvars: second.cvars })).toThrow("isolated cvar owners");
  expect(() => prepared.setActiveSeats([identity.seat(2)])).toThrow("not retained");
  const restored = new ApplicationConsoleRouting({ fallback: source, sourceDialect: () => "q1-netquake", server: () => ({ cvars: source, sharedNames: [] }),
    seat: id => seats.find(seat => seat.id.equals(id))?.cvars ?? null, input: id => seats.find(seat => id === null || seat.id.equals(id))?.mouse.cvars ?? null });
  prepared.adopt(restored, () => undefined, { source, movement: source, fallback: source, scripts, read: async () => undefined });
  prepared.publishSeats(seats.map(seat => ({ ...seat, input: seat.id.equals(first.id) ? first.input : second.input })));
  prepared.commands.append("echo restored\n", second.context); prepared.commands.execute();
  expect(calls.join("")).toContain("restored \n");
  const retired: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: second.id, client: identity.client(1, 1) } };
  prepared.commands.append("echo retired\n", retired); prepared.commands.execute();
  expect(calls.join("")).not.toContain("retired \n");
  release(); routing.close(); restored.close(); await scripts.close();
});

test("prepared profile publication preserves tail order and appended physical releases", async () => {
  const identity = createIdentityOwner("profile-publication"), calls: string[] = [];
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
  const source = new CvarRegistry({ dialect: "q2-classic", context });
  const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: async () => undefined });
  const prepared = new PreparedStartup(source, source, scripts, { dialect: "q2-classic", movementDialect: "q2-classic", shared: null, sharedNames: [],
    seats: [{ id: identity.seat(0), context, cvars: source, mouse: new MouseSettings(source), profile: null, archive: [], mouseArchive: [] }], print: text => calls.push(text), forward: () => undefined });
  const input = prepared.seats[0]?.input; if (input === undefined) throw new Error("Missing seat");
  const commands = prepared.commands;
  commands.register("+probe", () => undefined);
  commands.register("-probe", command => { calls.push("release:" + prepared.source.dialect + ":" + command.dialect); });
  commands.register("give", () => { calls.push("give:" + prepared.source.dialect); });
  let pending = false; commands.unregister("load"); commands.register("load", () => { pending = true; });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+probe; echo suffix" } });
  for (const dialect of ["q3", "q2-classic"] satisfies readonly import("../../src/contracts/common.ts").CommandDialect[]) {
    const prior = commands.dialect, next = new CvarRegistry({ dialect, context }), mouse = new MouseSettings(next);
    const routing = new ApplicationConsoleRouting({ fallback: next, sourceDialect: () => dialect, server: () => ({ cvars: next, sharedNames: [] }), seat: () => next, input: () => next });
    input.input({ kind: "key", seat: input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 0 }); commands.execute(); calls.length = 0;
    commands.append("load; give all; echo tail\n");
    const oldSource = prepared.source;
    expect(() => prepared.adopt(routing, () => undefined, { source: next, movement: next, fallback: next, scripts, read: async () => undefined })).toThrow("released input");
    expect(prepared.source).toBe(oldSource); expect(input.hasHeldInput).toBe(true);
    await commands.executeAsync(async () => {
      if (!pending) return; pending = false;
      input.release(1); expect(input.hasHeldInput).toBe(false); expect(calls).toEqual([]);
      prepared.adopt(routing, () => undefined, { source: next, movement: next, fallback: next, scripts, read: async () => undefined });
      prepared.adoptSeat(input.seat, next, mouse); calls.push("publish:" + dialect);
    });
    expect(calls).toEqual(["publish:" + dialect, "give:" + dialect, "tail \n", "release:" + dialect + ":" + prior, "suffix \n"]);
    expect(prepared.commands).toBe(commands); expect(prepared.seats[0]?.input).toBe(input);
    expect(commands.dialect).toBe(dialect); expect(input.dialect).toBe(dialect); expect(prepared.seats[0]?.mouse).toBe(mouse);
  }
});
