import { resolveStartupRules } from "../../src/app/bootstrap/startup-source.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { ConsoleScriptFiles } from "../../src/app/bootstrap/config-scripts.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { MouseSettings } from "../../src/input/mouse-settings.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { StartupConfig } from "../../src/app/bootstrap/startup-config.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { GameType } from "../../src/content/q3/base/shared/definitions.ts";
import { currentTeamArenaCursor, nextTeamArenaCursor, parseTeamArenaCampaign, planTeamArenaSkirmish, readTeamArenaSkirmish, teamArenaSourceCvars, teamArenaClientCvars, teamArenaServerOverrides, TeamArenaLaunchOverrides } from "../../src/app/bootstrap/team-arena-skirmish.ts";

const corpus = resolve(import.meta.dir, "../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q3a/missionpack/pak0.pk3")))("Team Arena skirmish uses installed source teams, alias fallback, limits and campaign progression", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const setup = await readTeamArenaSkirmish(catalog, 4);
  expect(setup).toMatchObject({ kind: "team-arena", map: "maps/mpteam1.bsp", title: "Base Siege", gameType: GameType.GT_CTF,
    maxClients: 6, skill: 4, playerTeam: "Red", playerModel: "james", playerHeadModel: "*james" });
  expect(setup.bots).toEqual([
    { ai: "Callisto", name: "Enforcer", team: "Blue", delayMilliseconds: 500 },
    { ai: "James", name: "Icarus ", team: "Blue", delayMilliseconds: 1000 },
    { ai: "Gammy", name: "Gammy", team: "Blue", delayMilliseconds: 1500 },
    { ai: "Khan", name: "Khan", team: "Red", delayMilliseconds: 2000 },
    { ai: "Gaunt", name: "Deadeye", team: "Red", delayMilliseconds: 2500 },
  ]);
  expect(Object.fromEntries(setup.cvars.map(row => [row.name, row.value]))).toMatchObject({
    g_gametype: "4", ui_singlePlayerActive: "1", g_spSkill: "4", sv_maxclients: "6", g_doWarmup: "1", g_warmup: "15", g_friendlyFire: "0",
    sv_pure: "0", capturelimit: "5", fraglimit: "10", g_redTeam: "Pagans", g_blueTeam: "Stroggs",
  });
  expect((await readTeamArenaSkirmish(catalog, 4, setup)).map).toBe("maps/mpteam2.bsp");
  expect((await readTeamArenaSkirmish(catalog, 4, { ...setup, advance: false })).map).toBe(setup.map);
  expect(setup.timeToBeat).toBeGreaterThan(0);
  expect(setup.cvars.some(value => value.name.startsWith("cg_"))).toBe(false);
  const source = Object.fromEntries(teamArenaSourceCvars(setup, [{ name: "capturelimit", value: "12" }, { name: "g_warmup", value: "27" }]).map(row => [row.name, row.value]));
  expect(source).toMatchObject({ capturelimit: "5", ui_saveCaptureLimit: "12", g_warmup: "15", ui_Warmup: "27" });
  const product = catalog.require("q3-missionpack");
  const campaign = parseTeamArenaCampaign(Buffer.from(await catalog.read(product.id, "gameinfo.txt")).toString("latin1"), Buffer.from(await catalog.read(product.id, "teaminfo.txt")).toString("latin1"));
  let cursor = setup.cursor;
  const visited = new Set<string>();
  for (let count = 0; count < 100; count++) {
    const next = planTeamArenaSkirmish(campaign, 4, cursor), key = `${next.gameType}:${next.map}`;
    if (visited.has(key)) break;
    visited.add(key);
    expect(catalog.mapsFor(product.id).some(map => map.path === next.map)).toBe(true);
    expect(next.bots.length + 1).toBe(next.maxClients);
    cursor = nextTeamArenaCursor(campaign, cursor);
  }
  expect(visited.size).toBe(56);
  const afterHarvester = planTeamArenaSkirmish(campaign, 2, nextTeamArenaCursor(campaign,
    currentTeamArenaCursor(campaign, { gameType: GameType.GT_HARVESTER, map: "maps/mpq3ctf4.bsp" })));
  expect(afterHarvester).toMatchObject({ map: "maps/mptourney1.bsp", gameType: GameType.GT_TOURNAMENT, maxClients: 2, playerTeam: "free", playerModel: "sarge" });
  expect(afterHarvester.bots).toEqual([{ ai: "Fritzkrieg", name: "Fritzkrieg", team: "", delayMilliseconds: 500 }]);
  const overload = planTeamArenaSkirmish(campaign, 2, currentTeamArenaCursor(campaign, { gameType: GameType.GT_OBELISK, map: "maps/mpteam1.bsp" }));
  expect(overload.cvars.find(row => row.name === "capturelimit")?.value).toBe("4");
  expect(() => currentTeamArenaCursor(campaign, { gameType: GameType.GT_CTF, map: "maps/q3dm0.bsp" })).toThrow("no authored campaign entry");
}, 15000);

test("Team Arena result actions remain available after a loss through shared keyboard and controller menus", async () => {
  const { TeamArenaResults } = await import("../../src/app/bootstrap/team-arena-results.ts");
  const { NativeUiController, defaultUiSkin } = await import("../../src/ui/common/index.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  const seat = createIdentityOwner("team-arena-results").seat(0);
  const actions: string[] = [];
  const controller = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 0,
    bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  const results = new TeamArenaResults(controller, { read: () => ({ title: "Base Siege", won: false, score: 2, opponent: 5, points: 30, time: "01:02" }),
    next: () => { actions.push("next"); return undefined; }, retry: () => { actions.push("retry"); return undefined; }, quit: () => { actions.push("quit"); return undefined; } });
  const key = (code: number) => controller.input({ seat, kind: "key", code, down: true, repeat: false, timeMilliseconds: 0 });
  try {
    results.update();
    expect(results.active).toBe(true);
    expect(controller.activeMenu).toBe("menu:application:team-arena-results");
    key(13);
    key(9);
    controller.input({ seat, kind: "controller-button", device: 0, button: 0, down: true, timeMilliseconds: 0 });
    key(9); key(13);
    expect(actions).toEqual(["next", "retry", "quit"]);
    results.update();
    expect(controller.state().focus).toMatchObject({ kind: "menu", control: "ui:team-arena:main-menu" });
    key(27); expect(controller.activeMenu).toBeNull();
    results.update(); expect(controller.activeMenu).toBe("menu:application:team-arena-results");
    controller.input({ seat, kind: "mouse-button", button: 3, down: true, timeMilliseconds: 0 });
    results.update(); expect(controller.activeMenu).toBe("menu:application:team-arena-results");
  } finally { results.close(); }
  expect(controller.activeMenu).toBeNull();
});

test("Team Arena snapshots post-config values once and restores them across saved cvar state", async () => {
  const campaign = parseTeamArenaCampaign('gametypes { { "FFA" 0 } { "Tournament" 1 } { "Team" 3 } { "CTF" 4 } } maps { { "Test" "test" 1 "Bot" 2 60 4 90 } }',
    'teams { { "Stroggs" "icon" "Bot" "Bot" "Bot" "Bot" "Bot" } { "Pagans" "icon" "Bot" "Bot" "Bot" "Bot" "Bot" } } aliases { { "Bot" "Bot" } }');
  const setup = planTeamArenaSkirmish(campaign);
  const identity = createIdentityOwner("ta-live-config");
  const context = { session: identity.session, origin: { kind: "server-console" } } satisfies CommandContext;
  const cvars = new CvarRegistry({ dialect: "q3", context });
  let captures = 0;
  const startup = new StartupConfig({ dialect: "q3", context, hasMod: true,
    read: async name => name === "autoexec.cfg" ? "set sv_maxclients 12\nset capturelimit 9\nset fraglimit 17\nset g_doWarmup 0\nset g_warmup 27\nset sv_pure 1\nset g_friendlyFire 1\nset cg_drawTimer 2\n" : "",
    applySelectedDefaults: () => undefined, applyArchive: () => undefined,
    applyLaunchOptions: () => {
      captures++;
      const baseline = cvars.snapshots();
      for (const setting of [...teamArenaSourceCvars(setup, baseline), ...teamArenaClientCvars(setup, baseline)]) cvars.set(setting.name, setting.value, true);
    } });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
  expect(await startup.executeFrame(commands, async () => {})).toBe(true);
  expect(await startup.executeFrame(commands, async () => {})).toBe(true);
  expect(captures).toBe(1);
  expect(cvars.variableValue("capturelimit")).toBe(5);
  expect(cvars.variableValue("cg_drawTimer")).toBe(1);
  expect(cvars.variableValue("ui_saveCaptureLimit")).toBe(9);
  expect(cvars.variableValue("ui_drawTimer")).toBe(2);
  expect(cvars.variableValue("ui_maxClients")).toBe(12);
  const restored = new CvarRegistry({ dialect: "q3", context });
  restored.restoreSaveState(cvars.captureSaveState());
  for (const setting of teamArenaServerOverrides) restored.set(setting.name, restored.variableString(setting.saved), true);
  restored.set("cg_drawTimer", restored.variableString("ui_drawTimer"), true);
  expect(restored.variableValue("sv_maxclients")).toBe(setup.maxClients);
  expect(restored.variableValue("ui_maxClients")).toBe(12);
  for (const [name, value] of [["capturelimit", 9], ["fraglimit", 17], ["g_doWarmup", 0], ["g_warmup", 27], ["sv_pure", 1], ["g_friendlyFire", 1], ["cg_drawTimer", 2]] satisfies readonly (readonly [string, number])[])
    expect(restored.variableValue(name)).toBe(value);
  for (const setting of teamArenaSourceCvars(setup, restored.snapshots())) restored.set(setting.name, setting.value, true);
  expect(restored.variableValue("ui_saveCaptureLimit")).toBe(9);
  expect(restored.variableValue("capturelimit")).toBe(5);
});

test("Team Arena preparation captures once across map wait and adopted source and seat owners", async () => {
  const campaign = parseTeamArenaCampaign('gametypes { { "FFA" 0 } { "Tournament" 1 } { "Team" 3 } { "CTF" 4 } } maps { { "Test" "test" 2 "Bot" 2 60 4 90 } }',
    'teams { { "Stroggs" "icon" "Bot" "Bot" "Bot" "Bot" "Bot" } { "Pagans" "icon" "Bot" "Bot" "Bot" "Bot" "Bot" } } aliases { { "Bot" "Bot" } }');
  const setup = planTeamArenaSkirmish(campaign);
  const launch = new TeamArenaLaunchOverrides(setup);
  const id = createIdentityOwner("ta-adopted-startup");
  const context: CommandContext = { session: id.session, origin: { kind: "server-console" } };
  const seatContext: CommandContext = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } };
  const oldSource = new CvarRegistry({ dialect: "q3", context });
  oldSource.register("capturelimit", "5"); oldSource.register("sv_maxclients", "12", CvarFlag.Latch);
  oldSource.register("g_gametype", "4", CvarFlag.Latch);
  const oldSeat = new CvarRegistry({ dialect: "q3", context: seatContext }); oldSeat.register("cg_drawTimer", "0");
  const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
  const prepared = new PreparedStartup(oldSource, new CvarRegistry({ dialect: "q3", context }), scripts, {
    dialect: "q3", movementDialect: "q3", shared: null, sharedNames: ["capturelimit", "sv_maxclients", "g_gametype"],
    seats: [{ id: id.seat(0), context: seatContext, cvars: oldSeat, mouse: new MouseSettings(new CvarRegistry({ dialect: "q3", context: seatContext })), profile: null, archive: [], mouseArchive: [] }],
    print: () => undefined, forward: () => undefined,
  });
  let applications = 0;
  await prepared.execute({ nextFrame: async () => {}, hasMod: true, sourceArchive: [], movementArchive: [], fallbackArchive: [], sharedArchive: [],
    read: async name => name === "autoexec.cfg" ? "set capturelimit 9; set cg_drawTimer 2; map mpteam1; wait; set capturelimit 21; set cg_drawTimer 7; set g_gametype 3; set sv_maxclients 12\n" : "",
    applyLaunchOptions: () => { applications++; launch.apply(prepared.source, prepared.seats); },
  });
  expect(prepared.pending).toBe(true);
  expect(applications).toBe(1);
  expect(oldSource.variableValue("ui_saveCaptureLimit")).toBe(9);
  expect(oldSeat.variableValue("ui_drawTimer")).toBe(2);
  const currentSource = new CvarRegistry({ dialect: "q3", context }); currentSource.restoreSaveState(oldSource.captureSaveState());
  const currentSeat = new CvarRegistry({ dialect: "q3", context: seatContext }); currentSeat.restoreSaveState(oldSeat.captureSaveState());
  const seat = prepared.seats[0]; if (seat === undefined) throw new Error("Missing prepared seat");
  prepared.adoptSeat(seat.id, seat.input, currentSeat);
  const routing = new ApplicationConsoleRouting({ fallback: prepared.fallback, sourceDialect: () => "q3",
    server: () => ({ cvars: currentSource, sharedNames: ["capturelimit", "sv_maxclients", "g_gametype"] }), seat: () => currentSeat });
  const commands = new CommandBuffer({ dialect: "q3", context, cvarRouting: routing, readScript: (name, source) => prepared.readScript(name, source), onScriptComplete: event => prepared.onScriptComplete(event) });
  commands.copyPendingFrom(prepared.commands);
  prepared.adopt(routing, () => undefined, { commands, source: currentSource, movement: prepared.movement, fallback: prepared.fallback, scripts, read: async () => undefined });
  oldSource.set("capturelimit", "88", true); oldSeat.set("cg_drawTimer", "88", true);
  for (let frame = 0; frame < 4 && prepared.pending; frame++) await prepared.advanceFrame();
  expect(prepared.pending).toBe(false);
  expect(applications).toBe(2);
  const parsed = parseApplicationCommand(["--game", "q3-missionpack", "--map", "mpteam1"]);
  if (parsed.kind !== "run") throw new Error("Missing native launch options");
  const resolved = resolveStartupRules(parsed.options, currentSource, setup.maxClients, [], false);
  expect(currentSource.variableValue("g_gametype")).toBe(4);
  expect(currentSource.variableValue("sv_maxclients")).toBe(4);
  expect(resolved.maxClients).toBe(setup.maxClients);
  expect(currentSource.find("g_gametype")?.latchedValue).toBeUndefined();
  expect(currentSource.find("sv_maxclients")?.latchedValue).toBeUndefined();
  expect(currentSource.variableValue("capturelimit")).toBe(5);
  expect(currentSource.variableValue("ui_saveCaptureLimit")).toBe(9);
  expect(currentSource.variableValue("ui_maxClients")).toBe(12);
  expect(currentSource.variableValue("ui_drawTimer")).toBe(2);
  expect(currentSeat.variableValue("cg_drawTimer")).toBe(1);
  expect(currentSeat.variableValue("ui_drawTimer")).toBe(2);
  expect(currentSeat.variableString("model")).toBe("james");
  expect(oldSource.variableValue("capturelimit")).toBe(88);
  expect(oldSeat.variableValue("cg_drawTimer")).toBe(88);
  for (const setting of teamArenaServerOverrides) currentSource.set(setting.name, currentSource.variableString(setting.saved), true);
  currentSeat.set("cg_drawTimer", currentSeat.variableString("ui_drawTimer"), true);
  expect(currentSource.variableValue("capturelimit")).toBe(9);
  expect(currentSeat.variableValue("cg_drawTimer")).toBe(2);
});
