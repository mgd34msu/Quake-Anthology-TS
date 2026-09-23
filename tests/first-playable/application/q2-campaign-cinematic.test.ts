import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../../src/app/bootstrap/startup-selection.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { UnifiedAudio } from "../../../src/audio/index.ts";
import { encodePng } from "../../../src/formats/images/png-encoder.ts";

test("actual mixed Q2 campaign plays, skips and completes unit CIN without losing its world on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-campaign-cin-"));
  const parsed = parseApplicationCommand(["--menu", "--hidden", "--renderer", "cpu", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "menu") throw new Error("Missing startup options");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const model = new StartupSelectionModel(catalog, parsed.options);
  await model.prepareMaps(); model.select("product", "q2-classic-baseq2"); model.select("map", "maps/base1.bsp");
  model.select("movement", "q1-quakeworld"); model.select("character", "q3-baseq3"); model.select("model", "visor");
  await model.prepareMonsterRoster(); model.select("enemies", "custom");
  const monster = model.monsterRosterRows()[0]?.choices.find(choice => choice.id.startsWith("q1:") && choice.id.endsWith("/monster_army") && choice.unavailable === null);
  if (monster === undefined) throw new Error("Missing installed Q1 monster");
  model.selectMonster(null, monster.id);
  const launch = await model.resolve(), messages: string[] = [];
  const streams = spyOn(UnifiedAudio.prototype, "queueStream");
  let app: Application | null = null;
  try {
    const game = app = await Application.open(launch.options, { print: text => { messages.push(text); }, saveDirectory: join(root, "saves") }, launch.recipe);
    await game.step(100);
    const local = game.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const client = local.seat.client, recipe = game.content.recipe;
    const key = (code: number, down: boolean) => game.input({ kind: "key", seat: local.seat.id, timeMilliseconds: game.timeMilliseconds, code, down, repeat: false });
    const tap = (code: number) => { key(code, true); key(code, false); };
    const controls = () => {
      const seat = game.localPlayers[0];
      if (!(seat?.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing shared presentation");
      return seat.seat.presentation.local;
    };
    const exit = async (expression: string) => {
      const source = game.simulation.q2Source();
      if (source === null) throw new Error("Missing Q2 source");
      source.players.beginIntermission(source.game, expression);
      const intermission = source.players.intermission;
      if (intermission.kind !== "intermission") throw new Error("Source did not enter intermission");
      source.players.intermission = { ...intermission, exit: true };
      await game.step(100); await game.step(100);
    };
    const actor = game.simulation.actors.resolveOwned(local.actor);
    if (actor === null) throw new Error("Missing owned player");
    game.simulation.combat.setHealth(actor, 73); game.simulation.inventory.give(actor, "q2:ammo_shells", 17);
    await exit("eou1_.cin+*bunk1");
    const old = game.simulation, pausedTime = game.timeMilliseconds, beforePixels = game.readPixels();
    for (let frame = 0; frame < 15; frame++) await game.step(100);
    expect(game.simulation).toBe(old); expect(game.timeMilliseconds).toBe(pausedTime);
    expect(game.readPixels()).not.toEqual(beforePixels);
    expect(streams.mock.calls.some(([target, pcm]) => target.id.startsWith("campaign-cinematic:") && target.audience.kind === "world" && pcm.samples.length > 0)).toBe(true);
    const artifact = Bun.env["QUAKE_CAMPAIGN_RECEIPTS"];
    if (artifact !== undefined) { await mkdir(artifact, { recursive: true }); await Bun.write(join(artifact, "unit-movie.png"), encodePng(320, 240, game.readPixels())); }
    tap(96); await game.step(100); expect(controls().input.focus.kind).toBe("console");
    expect(game.simulation).toBe(old); tap(96); await game.step(100);
    tap(32); await game.step(100);
    expect(game.simulation).not.toBe(old); expect(game.options.map).toBe("maps/bunk1.bsp");
    const carried = game.localPlayers[0];
    if (carried === undefined) throw new Error("Missing carried player");
    expect(carried.seat.client).toBe(client); expect(game.simulation.playerUi(carried.actor).health).toBe(73);
    expect(game.simulation.inventory.count(carried.actor, "q2:ammo_shells")).toBe(17);
    expect(game.content.recipe.movement).toEqual(recipe.movement); expect(game.content.recipe.character).toEqual(recipe.character);
    expect(game.content.recipe.enemies).toEqual(recipe.enemies);
    expect(game.simulation.movementPlayer(carried.actor)?.state.kind).toBe("q1-quakeworld");
    console.log("Campaign movie skip reached bunk1 with recipe, identity and inventory intact");
    await exit("eou1_.cin+*bunk1");
    const beforeEof = game.simulation;
    let movieFrames = 0;
    while (game.simulation === beforeEof && movieFrames < 1800) { await game.step(100); movieFrames++; }
    expect(game.simulation).not.toBe(beforeEof); expect(game.options.map).toBe("maps/bunk1.bsp");
    expect(game.localPlayers[0]?.seat.client).toBe(client);
    console.log(`Campaign movie normal EOF reached bunk1 after ${movieFrames} movie frame calls`);
    const beforeMissing = game.simulation;
    await exit("missing-campaign-movie.cin+*bunk1");
    expect(game.simulation).toBe(beforeMissing); expect(controls().input.focus.kind).toBe("console");
    expect(messages.some(message => message.includes("Missing campaign cinematic"))).toBe(true);
    tap(96); await game.step(100);
    await exit("eou1_.cin+*bunk1");
    for (let frame = 0; frame < 12; frame++) await game.step(100);
    const rejected = spyOn(game.session, "replaceWorld").mockImplementationOnce(() => { throw new Error("campaign destination preparation rejected"); });
    try {
      const beforeFailure = game.simulation; tap(32); await game.step(100);
      expect(game.simulation).toBe(beforeFailure); expect(game.localPlayers[0]?.seat.client).toBe(client);
      expect(controls().input.focus.kind).toBe("console");
      expect(messages.some(message => message.includes("campaign destination preparation rejected"))).toBe(true);
    } finally { rejected.mockRestore(); }
    if (artifact !== undefined) await Bun.write(join(artifact, "source-log.txt"), messages.join(""));
  } finally { streams.mockRestore(); try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 240000);
