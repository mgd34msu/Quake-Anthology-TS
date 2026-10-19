import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { callMethod, objectValue, readField, readNumber, readObject, readString } from "../../support/reflect.ts";

interface Vec { readonly x: number; readonly y: number; readonly z: number }
function readVec(target: object, name: string): Vec {
  const value = readObject(target, name);
  return { x: readNumber(value, "x"), y: readNumber(value, "y"), z: readNumber(value, "z") };
}
function recordByActor(sim: object, actor: unknown): object | null {
  const records = readObject(readObject(readObject(sim, "source"), "game"), "records");
  const record: unknown = callMethod(records, "byActor", actor);
  return record === null ? null : objectValue(record, "source record");
}

interface Case {
  readonly family: string; readonly movement: string; readonly character: string; readonly weapons: string; readonly body: string;
  readonly enemies?: string; readonly botCharacter: "q1" | "q2" | "q3"; readonly botBody: string | null;
}
const cases: readonly Case[] = [
  { family: "q1", movement: "q1", character: "q1", weapons: "q1-classic-id1", body: "progs/player.mdl", botCharacter: "q3", botBody: null },
  { family: "q2", movement: "q2", character: "q2", weapons: "q2-classic-baseq2", body: "players/male/tris.md2", botCharacter: "q3", botBody: null },
  { family: "q1", movement: "q1", character: "q1", weapons: "q1-classic-id1", body: "progs/player.mdl",
    enemies: "q2-classic-baseq2", botCharacter: "q2", botBody: "players/male/tris.md2" },
];

for (const row of cases) test(`${row.family} character, movement and weapons run in a Q3 world through Application`, async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3", "--map", "q3dm1", "--movement", row.movement,
    "--character", row.character, "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: `${row.family}:official`, content: catalog.require(row.weapons).id }] },
    ...(row.enemies === undefined ? {} : { enemies: { kind: "selected", value: { kind: "players",
      character: { provider: "q2:character", content: catalog.require(row.enemies).id } } } }) } });
  const prints: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { prints.push(text); } }, recipe);
  try {
    for (let index = 0; index < 12; index++) await app.step(50);
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const presentations = app.simulation.presentations().filter(entry => entry.actor.equals(local.actor));
    expect(presentations.some(entry => !entry.viewWeapon && entry.path === row.body)).toBe(true);
    const gun = presentations.find(entry => entry.viewWeapon && entry.family === row.family);
    expect(gun).toBeDefined();
    expect(gun?.viewOrigin).toBeDefined();
    expect(gun?.viewAngles).toBeDefined();
    // Strafe through render frames that do not align with fixed ticks; the
    // authored gun must stay usable (scene re-anchors it to the final eye).
    const strafe = (down: boolean): void => { app.input({ seat: local.seat.id, kind: "key", code: 100, down,
      repeat: false, timeMilliseconds: performance.now() }); };
    strafe(true);
    for (let index = 0; index < 12; index++) await app.step(16);
    strafe(false);
    expect(app.simulation.presentations().some(entry => entry.viewWeapon && entry.actor.equals(local.actor) && entry.viewOrigin !== undefined)).toBe(true);
    expect(app.simulation.playerUi(local.actor).activeWeapon?.startsWith(`${row.family}:`)).toBe(true);
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Missing Q3 source");
    const config = source.sourceState().configstrings.find(entry => entry.index === 544)?.value ?? "";
    expect(config).toContain("model\\sarge/default");
    expect(config).not.toContain("model\\player/default");
    expect(config).not.toContain("model\\male/default");
    // Single-player Q3 arenas are bot matches: the authored arena roster
    // (Ranger on q3dm1) must actually enter, even with foreign weapons.
    for (let index = 0; index < 300 && !prints.some(text => text.includes("Ranger^7 entered the game")); index++) await app.step(50);
    expect(app.simulation.players().length).toBeGreaterThan(1);
    expect(prints.join("")).toContain("Ranger^7 entered the game");
    const bot = app.simulation.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot player");
    expect(app.simulation.movementPlayer(bot)?.character).toBe(row.botCharacter);
    const botBodies = app.simulation.presentations().filter(entry => entry.actor.equals(bot) && !entry.viewWeapon);
    if (row.botBody === null) expect(botBodies.some(entry => entry.path === row.body)).toBe(false);
    else expect(botBodies.some(entry => entry.path === row.botBody)).toBe(true);
    expect(prints.join("")).not.toContain("Failed to load model file");
  } finally { await app.close(); }
}, 120000);

test("Q1 setup in Q3: +back moves backwards and arena bot combat never selects weapon 0", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3", "--map", "q3dm0", "--movement", "q1",
    "--character", "q1", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require("q1-classic-id1").id }] } } });
  const prints: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { prints.push(text); } }, recipe);
  try {
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const key = (code: number, down: boolean): void => { app.input({ seat: local.seat.id, kind: "key", code, down,
      repeat: false, timeMilliseconds: performance.now() }); };
    for (let index = 0; index < 20; index++) await app.step(50);
    key(119, true); // W / +forward: leave the spawn wall first
    for (let index = 0; index < 40; index++) await app.step(50);
    key(119, false);
    const before = app.simulation.playerView(local.actor);
    if (before === null) throw new Error("Missing local view");
    key(115, true); // S / +back
    for (let index = 0; index < 40; index++) await app.step(50);
    key(115, false);
    const afterBack = app.simulation.playerView(local.actor);
    if (afterBack === null) throw new Error("Missing local view after +back");
    const yaw = before.angles.y * Math.PI / 180;
    const backward = -(afterBack.origin.x - before.origin.x) * Math.cos(yaw) - (afterBack.origin.y - before.origin.y) * Math.sin(yaw);
    expect(backward).toBeGreaterThan(50);
    // Soak bot combat in the reported setup (Crash on q3dm0): keep putting the
    // bot in front of the local player so battle/retreat nodes run; the old
    // build threw "Bot weapon 0 has no loaded weapon information".
    for (let index = 0; index < 300 && !prints.some(text => text.includes("Crash^7 entered the game")); index++) await app.step(50);
    expect(prints.join("")).toContain("Crash^7 entered the game");
    for (let index = 0; index < 800; index++) {
      await app.step(50);
      const bot = app.simulation.players().find(actor => !actor.equals(local.actor));
      const view = app.simulation.playerView(local.actor);
      if (bot !== undefined && view !== null && index % 100 === 99) {
        const radians = view.angles.y * Math.PI / 180;
        callMethod(app.simulation, "setPlayerMovement", bot, { kind: "teleport",
          origin: { x: view.origin.x + Math.cos(radians) * 300, y: view.origin.y + Math.sin(radians) * 300, z: view.origin.z },
          angles: { x: 0, y: (view.angles.y + 180) % 360, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
          commandAngles: { x: 0, y: (view.angles.y + 180) % 360, z: 0 }, holdMilliseconds: 0, spectator: false });
      }
    }
    // The bot must aim at the player, not a wall: place the local player at a
    // trace-clear spot next to the bot and require bot damage. The old build
    // rotated bot aim by the Q3 spawn delta angles, so shots never landed.
    const bot = app.simulation.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot player");
    const botView = app.simulation.playerView(bot);
    if (botView === null) throw new Error("Missing bot view");
    const game = readObject(readObject(app.simulation, "source"), "game");
    const botEntity = recordByActor(app.simulation, bot);
    if (botEntity === null) throw new Error("Missing bot entity");
    const botBounds = readObject(botEntity, "r"), botNumber = readNumber(readObject(botEntity, "s"), "number");
    let placed: { x: number; y: number; z: number } | null = null;
    for (const offset of [{ x: 120, y: 0 }, { x: -120, y: 0 }, { x: 0, y: 120 }, { x: 0, y: -120 }]) {
      const end = { x: botView.origin.x + offset.x, y: botView.origin.y + offset.y, z: botView.origin.z };
      const trace = objectValue(callMethod(readObject(game, "world"), "trace", { start: botView.origin, end, shape: { kind: "box", mins: readField(botBounds, "mins"), maxs: readField(botBounds, "maxs") },
        passEntityNum: botNumber, mask: 0x2010001 }), "trace result");
      if (readNumber(trace, "fraction") === 1 && readString(trace, "solidity") === "clear") { placed = end; break; }
    }
    if (placed === null) throw new Error("No trace-clear placement near bot");
    const faceYaw = (Math.atan2(botView.origin.y - placed.y, botView.origin.x - placed.x) * 180 / Math.PI + 360) % 360;
    callMethod(app.simulation, "setPlayerMovement", local.actor, { kind: "teleport", origin: placed,
      angles: { x: 0, y: faceYaw, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      commandAngles: { x: 0, y: faceYaw, z: 0 }, holdMilliseconds: 0, spectator: false });
    let damaged = false;
    for (let index = 0; index < 600 && !damaged; index++) {
      await app.step(50);
      damaged = app.simulation.playerUi(local.actor).health < 100;
    }
    expect(damaged).toBe(true);
  } finally { await app.close(); }
}, 240000);

test("Q1 lightning gibs a Q3 bot corpse in a Q3 world", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3", "--map", "q3dm0", "--movement", "q1",
    "--character", "q1", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require("q1-classic-id1").id }] } } });
  const app = await Application.open(parsed.options, { print: () => undefined }, recipe);
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    // Internal simulation seams, following the trace-placement test above.
    const sim = app.simulation;
    for (let index = 0; index < 300 && sim.players().length < 2; index++) await app.step(50);
    const bot = sim.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing arena bot");
    callMethod(sim, "grantSelectedArsenal", local.actor, "weapons"); callMethod(sim, "grantSelectedArsenal", local.actor, "ammo");
    const arsenal = readObject(sim, "selectedArsenal");
    const game = readObject(readObject(arsenal, "options"), "game"), host = readObject(game, "host");
    const health = (): number => sim.combat.read(bot)?.health ?? 0;
    const teleport = (actor: unknown, origin: Vec): void => { callMethod(sim, "setPlayerMovement", actor, { kind: "teleport", origin,
      angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, commandAngles: { x: 0, y: 0, z: 0 }, holdMilliseconds: 0, spectator: false }); };
    callMethod(arsenal, "select", local.actor, "q1:weapon/lightning");
    teleport(bot, { x: -1152, y: -1245, z: 30 }); teleport(local.actor, { x: -1222, y: -1245, z: 30 });
    for (let index = 0; index < 20; index++) await app.step(50);
    const settledRecord = recordByActor(sim, bot);
    const settled = settledRecord === null ? undefined : readVec(readObject(readObject(settledRecord, "s"), "pos"), "base");
    for (let index = 0; index < 10 && health() > 0; index++) {
      if (settled !== undefined) teleport(bot, settled);
      callMethod(game, "damage", bot, local.actor, local.actor, 30, "lightning");
      await app.step(50);
    }
    expect(health()).toBeLessThanOrEqual(0);
    expect(health()).toBeGreaterThan(-40);
    expect(sim.combat.read(bot)?.canTakeDamage).toBe(true);
    const record = recordByActor(sim, bot);
    if (record === null) throw new Error("Missing bot record");
    const recordBase = readVec(readObject(readObject(record, "s"), "pos"), "base");
    const recordBounds = readObject(record, "r");
    const me = sim.bodies.read(local.actor); if (me === null) throw new Error("Missing local body");
    const eye = { x: me.origin.x, y: me.origin.y, z: me.origin.z + 16 };
    const center = { x: recordBase.x, y: recordBase.y, z: recordBase.z + (readVec(recordBounds, "mins").z + readVec(recordBounds, "maxs").z) / 2 };
    const beyond = { x: eye.x + (center.x - eye.x) * 2, y: eye.y + (center.y - eye.y) * 2, z: eye.z + (center.z - eye.z) * 2 };
    const trace = objectValue(callMethod(host, "trace", { start: eye, end: beyond, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, ignore: local.actor, monsters: true }), "trace result");
    const traceActor: unknown = readField(trace, "actor");
    expect(traceActor !== null && typeof traceActor === "object" && callMethod(traceActor, "equals", bot) === true).toBe(true);
    const pitch = -Math.atan2(center.z - eye.z, Math.hypot(center.x - eye.x, center.y - eye.y)) * 180 / Math.PI;
    app.input({ seat: local.seat.id, kind: "mouse-motion", position: { x: 160, y: 120 }, delta: { x: 0, y: Math.round(pitch / 0.066) }, timeMilliseconds: performance.now() });
    for (let index = 0; index < 4; index++) await app.step(50);
    const playerValue: unknown = callMethod(game, "player", local.actor);
    const viewPitch = playerValue === null ? 0 : readNumber(readObject(objectValue(playerValue, "game player"), "viewAngles"), "x");
    expect(Math.abs(viewPitch - pitch)).toBeLessThan(3);
    app.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    for (let index = 0; index < 12; index++) await app.step(50);
    app.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    await app.step(50);
    // Gibbed: past GIB_HEALTH, contents cleared and further damage refused.
    expect(health()).toBeLessThanOrEqual(-40);
    expect(sim.combat.read(bot)?.canTakeDamage).toBe(false);
    const gibbed = recordByActor(sim, bot);
    expect(gibbed === null ? null : readNumber(readObject(gibbed, "r"), "contents")).toBe(0);
  } finally { await app.close(); }
}, 180000);
