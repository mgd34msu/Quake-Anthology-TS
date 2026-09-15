import { loadCvarArchive } from "../../../src/app/bootstrap/cvar-archives.ts";
import { ConfigStore } from "../../../src/settings/config.ts";
import { encodePng } from "../../../src/formats/images/png-encoder.ts";
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../../src/app/bootstrap/startup-selection.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { readTeamArenaSkirmish } from "../../../src/app/bootstrap/team-arena-skirmish.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { presetChoice, resolveLaunch, discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { ClientAdmissionRuntime } from "../../../src/content/q3/team-arena/client-admission.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { Q3SourceRuntime } from "../../../src/app/bootstrap/simulation/q3/runtime.ts";
import { ConnectionState } from "../../../src/content/q3/base/game/state.ts";
import { Team } from "../../../src/content/q3/base/shared/definitions.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";
import { SourceBotDirector } from "../../../src/bots/behavior/index.ts";
import { userProductDirectory } from "../../../src/content/user-data.ts";
import { providerTiming } from "../../../src/app/bootstrap/simulation/players.ts";


async function captureArtifact(name: string, width: number, height: number, pixels: Uint8Array): Promise<void> {
  const directory = process.env["TEAM_ARENA_ARTIFACTS"];
  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, name), encodePng(width, height, pixels));
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(join(corpus, "q3a/missionpack/pak0.pk3")))("native Team Arena preset launches authored teams, restores without setup replay, and presents transactional match progression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "team-arena-application-"));
  const parsed = parseApplicationCommand(["--content-root", corpus, "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", directory]);
  if (parsed.kind !== "menu" && parsed.kind !== "run") throw new Error("Missing launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const selection = new StartupSelectionModel(catalog, parsed.options);
  await selection.prepareMaps();
  const first = await selection.resolvePreset("q3-missionpack", 2);
  const setup = await readTeamArenaSkirmish(catalog, 2, { map: "maps/mpq3ctf4.bsp", gameType: 4, advance: false });
  const options = { ...first.options, map: setup.map, characterModel: setup.playerModel, teamArenaSkirmish: setup };
  const preset = applicationPreset(catalog, options, { movement: first.recipe.movement, character: first.recipe.character.definition });
  const launch = { options, recipe: await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) }) };
  const messages: string[] = [];
  const host = { print: (text: string) => { messages.push(text); return undefined; }, saveDirectory: join(directory, "saves") };
  let app: Application | null = null;
  try {
    const seatProfile = join(directory, "console/settings/seat-0");
    await mkdir(seatProfile, { recursive: true });
    await writeFile(join(seatProfile, "autoexec.cfg"), 'seta name "Player 1"\nset sv_maxclients 12\nset capturelimit 9\nset fraglimit 17\nset g_doWarmup 0\nset g_warmup 27\nset sv_pure 1\nset g_friendlyFire 1\nset cg_drawTimer 2\n');
    app = await Application.open(launch.options, host, launch.recipe);
    const source = app.simulation.q3Source(), human = app.localPlayers[0];
    if (source === null || human === undefined) throw new Error("Missing native Team Arena source and human");
    const clock = providerTiming(app.simulation.recipe, app.simulation.recipe.map.entities.provider).clock;
    if (clock.kind !== "q3") throw new Error("Expected native Quake III source clock");
    const lastDelay = Math.max(...setup.bots.map(bot => bot.delayMilliseconds));
    const admittedAfter = source.level.time + lastDelay + 2 * clock.serverFrameMilliseconds;
    for (let frame = 0; frame < Math.ceil(lastDelay / clock.serverFrameMilliseconds) + 4 && source.level.time < admittedAfter; frame++)
      await app.step(clock.serverFrameMilliseconds);
    expect(source.level.time).toBeGreaterThanOrEqual(admittedAfter);
    const roster = () => source.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED)
      .map(client => ({ name: client.pers.netname, team: client.sess.sessionTeam }));
    const expectedTeams = [Team.TEAM_RED, ...setup.bots.map(bot => bot.team === "Blue" ? Team.TEAM_BLUE : Team.TEAM_RED)];
    const teamSetupDeadline = source.level.time + 2000;
    const maxTeamSetupSteps = Math.ceil(2000 / clock.serverFrameMilliseconds);
    console.log(`Team Arena admission deadline ${admittedAfter}ms reached at ${source.level.time}ms; team setup deadline ${teamSetupDeadline}ms, max ${maxTeamSetupSteps} steps, bot_thinktime ${source.host.cvars.variableValue("bot_thinktime")}ms`);
    let previousRoster = "";
    let teamSetupSteps = 0;
    for (;;) {
      const current = roster(), serialized = JSON.stringify(current);
      if (serialized !== previousRoster) {
        console.log(`Team Arena roster at source time ${source.level.time}ms: ${serialized}`);
        previousRoster = serialized;
      }
      if (current.length === setup.maxClients && current.every((client, index) => client.team === expectedTeams[index])) break;
      if (source.level.time >= teamSetupDeadline || teamSetupSteps >= maxTeamSetupSteps) break;
      await app.step(clock.serverFrameMilliseconds);
      teamSetupSteps++;
    }
    console.log(`Team Arena team setup stopped at ${source.level.time}ms after ${teamSetupSteps} steps: ${JSON.stringify(roster())}`);
    expect(source.gameType).toBe(4);
    expect(source.pool.maxClients).toBe(4);
    expect(roster()).toEqual([
      { name: "Player 1", team: Team.TEAM_RED }, { name: "Enforcer", team: Team.TEAM_BLUE },
      { name: "Icarus", team: Team.TEAM_BLUE }, { name: "Khan", team: Team.TEAM_RED },
    ]);
    expect(source.host.engine.getUserinfo(human.seat.client.id.slot)).toContain("\\team_headmodel\\*james");
    expect(source.host.cvars.variableValue("g_warmup")).toBe(15);
    expect(source.host.cvars.variableValue("ui_pure"), "pre-save ui_pure baseline").toBe(1);
    expect(source.host.cvars.variableValue("ui_friendlyFire"), "pre-save ui_friendlyFire baseline").toBe(1);
    await captureArtifact("gameplay.png", 320, 240, app.readPixels());
    expect(source.host.cvars.variableValue("ui_saveCaptureLimit")).toBe(9);
    expect(source.host.cvars.variableValue("ui_saveFragLimit")).toBe(17);
    expect(source.host.cvars.variableValue("ui_Warmup")).toBe(27);
    expect(source.host.cvars.variableValue("ui_drawTimer")).toBe(2);
    expect(source.host.cvars.variableValue("ui_maxClients")).toBe(12);
    expect(source.level.warmupTime).toBeGreaterThan(0);
    console.log(`Team Arena authored roster ready at source time ${source.level.time}ms`);
    const savedRoster = roster(), path = join(directory, "warmup.sav");
    await app.saveGame(path);
    const image = await readSaveImage(path);
    if (!(human.seat.presentation instanceof WorldSeatPresentation) || human.seat.presentation.q3Client === null) throw new Error("Missing timer preference owner");
    human.seat.presentation.q3Client.cvars.set("cg_fov", "115", true);
    await app.loadGame(path);
    const loadedSeat = app.localPlayers[0]?.seat.presentation;
    if (!(loadedSeat instanceof WorldSeatPresentation) || loadedSeat.q3Client === null) throw new Error("Missing in-app restored timer owner");
    expect(loadedSeat.q3Client.cvars.variableValue("ui_drawTimer"), "in-app saved timer baseline").toBe(2);
    expect(loadedSeat.q3Client.cvars.variableValue("cg_drawTimer"), "in-app active timer").toBe(1);
    expect(loadedSeat.q3Client.cvars.variableValue("cg_fov"), "current FOV survives old save load").toBe(115);
    await app.close(); app = null;
    const clientProduct = catalog.product(launch.recipe.engineBehavior.content);
    const clientStore = new ConfigStore(clientProduct.userContent?.root ?? userProductDirectory(directory, clientProduct.expectation.contentDirectory));
    const clientArchive = await loadCvarArchive(clientStore, ["client", launch.recipe.engineBehavior.content, launch.recipe.engineBehavior.provider, "0"], "q3");
    expect(clientArchive.find(row => row.name.toLowerCase() === "cg_drawtimer")?.value, "active close retains original timer preference").toBe("2");
    expect(clientArchive.find(row => row.name.toLowerCase() === "cg_fov")?.value).toBe("115");
    const sourceProduct = catalog.product(launch.recipe.map.entities.content);
    const sourceStore = new ConfigStore(sourceProduct.userContent?.root ?? userProductDirectory(directory, sourceProduct.expectation.contentDirectory));
    const sourceArchive = await loadCvarArchive(sourceStore, ["source", launch.recipe.map.entities.content, launch.recipe.map.entities.provider], "q3");
    expect(sourceArchive.find(row => row.name.toLowerCase() === "capturelimit")?.value, "active close retains original capture limit").toBe("9");
    console.log("Team Arena scoped timer survived public load; active close preserved profile baselines and current FOV");
    const load = spyOn(Q3SourceRuntime.prototype, "load"), connect = spyOn(ClientAdmissionRuntime.prototype, "connect"),
      begin = spyOn(ClientAdmissionRuntime.prototype, "begin"), bots = spyOn(SourceBotDirector.prototype, "load");
    try {
      app = await Application.open(launch.options, host, launch.recipe, undefined, image);
      expect(load).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
      expect(begin).not.toHaveBeenCalled(); expect(bots).not.toHaveBeenCalled();
    } finally { load.mockRestore(); connect.mockRestore(); begin.mockRestore(); bots.mockRestore(); }
    const restored = app.simulation.q3Source(), local = app.localPlayers[0];
    if (restored === null || local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing restored Team Arena presentation");
    expect(restored.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED)
      .map(client => ({ name: client.pers.netname, team: client.sess.sessionTeam }))).toEqual(savedRoster);
    expect(restored.host.cvars.variableString("nextmap")).toBe("teamarena-results");
    expect(restored.host.cvars.variableValue("ui_pure"), "post-load ui_pure baseline").toBe(1);
    expect(restored.host.cvars.variableValue("ui_friendlyFire"), "post-load ui_friendlyFire baseline").toBe(1);
    console.log("Team Arena saved roster restored without source admission replay");
    restored.level.teamScores.set(Team.TEAM_RED, 5); restored.level.teamScores.set(Team.TEAM_BLUE, 2);
    restored.match.beginIntermission();
    await app.step(1); await app.step(1);
    const controller = local.seat.presentation.ui.controller;
    expect(controller.activeMenu).toBe("menu:application:team-arena-results");
    await captureArtifact("results.png", 320, 240, app.readPixels());
    expect(messages.join("")).toContain("Choose Next match, Retry match, or Main menu");
    const scoreFile = Bun.file(join(userProductDirectory(directory, catalog.require("q3-missionpack").expectation.contentDirectory), "games/mpq3ctf4_4.game"));
    expect(scoreFile.size).toBe(68);
    for (const [name, value] of [["capturelimit", 9], ["fraglimit", 17], ["g_doWarmup", 0], ["g_warmup", 27], ["sv_pure", 1], ["g_friendlyFire", 1]] satisfies readonly (readonly [string, number])[])
      expect(restored.host.cvars.variableValue(name), `postgame restored ${name}`).toBe(value);
    expect(local.seat.presentation.q3Client?.cvars.variableValue("cg_drawTimer")).toBe(2);
    expect(restored.pool.maxClients).toBe(setup.maxClients);
    expect(restored.host.cvars.variableValue("sv_maxclients")).toBe(setup.maxClients);
    expect(restored.host.cvars.variableValue("ui_maxClients")).toBe(12);
    console.log("Team Arena source result menu and native score file published");
    const original = app.simulation, oldBots = app.botClients.map(bot => bot.client);
    const selectResult = async (action: "next" | "retry") => {
      if (app === null) throw new Error("Missing application");
      const currentLocal = app.localPlayers[0];
      if (currentLocal === undefined || !(currentLocal.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing current result presentation");
      const currentController = currentLocal.seat.presentation.ui.controller;
      for (let attempt = 0; attempt < 4; attempt++) {
        const focus = currentController.state().focus;
        if (focus.kind === "menu" && focus.control === `ui:team-arena:${action}`) break;
        for (const down of [true, false]) app.input({ seat: currentLocal.seat.id, kind: "key", code: 9, down, repeat: false, timeMilliseconds: performance.now() });
      }
      expect(currentController.state().focus).toMatchObject({ kind: "menu", control: `ui:team-arena:${action}` });
      for (const down of [true, false]) app.input({ seat: currentLocal.seat.id, kind: "key", code: 13, down, repeat: false, timeMilliseconds: performance.now() });
      await app.step(1);
    };
    const publish = spyOn(app.session, "replaceWorld").mockImplementationOnce(candidate => {
      if (!(candidate instanceof SharedSimulation)) throw new Error("Expected shared simulation candidate");
      expect(candidate.recipe.map.geometry.requestedPath).toBe("maps/mpq3ctf4.bsp");
      expect(candidate.recipe.character.appearance.content).toBe(launch.recipe.character.appearance.content);
      expect(candidate.recipe.character.appearance.provider).toBe("q3:model/james");
      expect(candidate.q3Source()?.host.cvars.variableValue("capturelimit")).toBe(5);
      expect(candidate.q3Source()?.host.cvars.variableValue("fraglimit")).toBe(10);
      throw new Error("Team Arena candidate publication rejected");
    });
    try { await selectResult("retry"); await app.step(1); expect(messages.join("\n")).toContain("Team Arena candidate publication rejected"); }
    finally { publish.mockRestore(); }
    expect(app.simulation).toBe(original);
    expect(oldBots.every(client => !client.isClosed)).toBe(true);
    expect(local.seat.client.isClosed).toBe(false);
    expect(controller.activeMenu).toBe("menu:application:team-arena-results");
    console.log("Team Arena rejected Retry preserved the published world and clients");
    await selectResult("retry"); await app.step(1);
    const retried = app.simulation.q3Source();
    if (retried === null) throw new Error("Retry lost native Team Arena source");
    expect(app.simulation).not.toBe(original);
    expect(app.options.map).toBe(setup.map);
    expect(retried.gameType).toBe(setup.gameType);
    expect(retried.pool.maxClients).toBe(setup.maxClients);
    expect(app.localPlayers[0]?.seat.client).toBe(local.seat.client);
    expect(oldBots.every(client => client.isClosed)).toBe(true);
    expect(app.simulation.recipe.character.appearance.content).toBe(launch.recipe.character.appearance.content);
    expect(app.simulation.recipe.character.appearance.provider).toBe("q3:model/james");
    const retryRoster = () => retried.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED)
      .map(client => ({ name: client.pers.netname, team: client.sess.sessionTeam }));
    const retryDeadline = retried.level.time + lastDelay + 2000;
    const retryMaxSteps = Math.ceil((lastDelay + 2000) / clock.serverFrameMilliseconds);
    for (let frame = 0; frame < retryMaxSteps && retried.level.time < retryDeadline; frame++) {
      if (JSON.stringify(retryRoster()) === JSON.stringify(savedRoster)) break;
      await app.step(clock.serverFrameMilliseconds);
    }
    console.log(`Team Arena Retry roster at source time ${retried.level.time}ms, deadline ${retryDeadline}ms: ${JSON.stringify(retryRoster())}`);
    expect(retryRoster()).toEqual(savedRoster);
    expect(retried.host.cvars.variableValue("capturelimit")).toBe(5);
    expect(retried.host.cvars.variableValue("fraglimit")).toBe(10);
    expect(retried.host.cvars.variableValue("ui_saveCaptureLimit")).toBe(9);
    expect(retried.host.cvars.variableValue("ui_saveFragLimit")).toBe(17);
    expect(retried.host.cvars.variableValue("ui_drawTimer")).toBe(2);
    console.log("Team Arena successful Retry rebuilt the authored match and roster");
    retried.level.teamScores.set(Team.TEAM_RED, 5); retried.level.teamScores.set(Team.TEAM_BLUE, 2);
    retried.match.beginIntermission();
    await app.step(1); await app.step(1);
    await selectResult("next"); await app.step(1);
    expect(app.options.map).toBe("maps/mpteam1.bsp");
    expect(oldBots.every(client => client.isClosed)).toBe(true);
    expect(app.localPlayers[0]?.seat.client).toBe(local.seat.client);
    expect(app.simulation.q3Source()?.host.cvars.variableValue("ui_singlePlayerActive")).toBe(1);
    expect(app.simulation.q3Source()?.host.cvars.variableValue("g_gametype")).toBe(5);
    expect(app.simulation.q3Source()?.host.cvars.variableValue("capturelimit")).toBe(5);
    expect(app.simulation.q3Source()?.host.cvars.variableValue("fraglimit")).toBe(10);
    expect(app.simulation.recipe.character.definition.content).toBe(launch.recipe.character.definition.content);
    expect(app.simulation.recipe.character.appearance.content).toBe(launch.recipe.character.appearance.content);
    console.log("Team Arena Next entered OneFlag with authored settings and missionpack character content");
  } catch (error) {
    console.error(messages.join(""));
    throw error;
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
}, 240000);
