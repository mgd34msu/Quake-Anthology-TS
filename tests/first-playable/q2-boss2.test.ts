import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { adaptTraceResult } from "../../src/world/collision/contents.ts";
import type { TraceResult } from "../../src/contracts/scene.ts";
import { corpusHasFile, testCorpusRoot } from "../support/corpus.ts";

const corpus = corpusHasFile("q2/baseq2/pak0.pak");

async function bootBoss2(movement: "q2" | "q3") {
  const character = movement === "q3" ? "q3" : "q2";
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "boss2", "--movement", movement,
    "--character", character, "--dedicated", "--content-root", testCorpusRoot()]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options);
  const identity = createIdentityOwner(`boss2-${movement}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
  const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
  let sequence = 0, timeMs = 0;
  const step = (forward = 0, yaw = 0, pitch = 0) => {
    timeMs += 25;
    const words: [number, number, number] = [Math.trunc(pitch * 65536 / 360), Math.trunc(yaw * 65536 / 360), 0];
    simulation.step({ elapsedMilliseconds: 25, commands: [{ actor: admission.actor, source: { kind: "local-seat", client, seat }, sequence: sequence++,
      command: movement === "q3"
        ? { kind: "q3", serverTimeMilliseconds: timeMs, angleWords: words, forwardMove: forward === 0 ? 0 : 127, rightMove: 0, upMove: 0, buttons: 0, weapon: 0 }
        : { kind: "q2-classic", milliseconds: 25, angleShorts: words, forwardMove: forward, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 0 } }] });
    simulation.drainPresentationEvents();
  };
  for (let i = 0; i < 20; i++) step();
  const source = simulation.q2Source();
  if (source === null) throw new Error("Missing Q2 source");
  return { content, simulation, admission, step, game: source.game };
}

test.skipIf(!corpus)("Jorg presents the outer shell attached to the rider on boss2", async () => {
  const { content, simulation, game } = await bootBoss2("q2");
  try {
    const jorg = [...game.entities.values()].find(entity => entity.classname === "monster_jorg");
    if (jorg === undefined) throw new Error("Missing monster_jorg");
    const paths = simulation.presentations()
      .filter(p => p.actor.slot === jorg.actor.id.slot && p.actor.generation === jorg.actor.id.generation)
      .map(p => p.path);
    expect(paths).toContain("models/monsters/boss3/rider/tris.md2");
    expect(paths).toContain("models/monsters/boss3/jorg/tris.md2");
  } finally { simulation.close(); await content.close(); }
});

test.skipIf(!corpus)("Q3 movement activates a boss2 floor button by standing on it", async () => {
  const { content, simulation, admission, step, game } = await bootBoss2("q3");
  try {
    const entities = [...game.entities.values()];
    const button = entities.find(entity => entity.model === "*9"), door = entities.find(entity => entity.model === "*11");
    const player = game.entity(admission.actor);
    if (button === undefined || door === undefined || player === null) throw new Error("Missing button, door, or player");
    const body = game.body(button);
    game.move(player, { origin: { x: body.origin.x + (body.bounds.min.x + body.bounds.max.x) / 2,
      y: body.origin.y + (body.bounds.min.y + body.bounds.max.y) / 2, z: body.origin.z + body.bounds.max.z + 30 },
      velocity: { x: 0, y: 0, z: 0 } });
    const before = { ...game.body(door).origin };
    for (let i = 0; i < 80; i++) step();
    const after = game.body(door).origin;
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.z - before.z)).toBeGreaterThan(10);
  } finally { simulation.close(); await content.close(); }
});

test.skipIf(!corpus)("Q3 movement climbs the boss2 ladder", async () => {
  const { content, simulation, admission, step, game } = await bootBoss2("q3");
  try {
    const player = game.entity(admission.actor);
    if (player === null) throw new Error("Missing player");
    // The only ladder brush on boss2: x -2144..-2112, y -679..-674, z -350..13.
    game.move(player, { origin: { x: -2128, y: -696, z: -320 }, velocity: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 80; i++) step(127, 90, -45);
    expect(game.body(player).origin.z).toBeGreaterThan(-100);
  } finally { simulation.close(); await content.close(); }
});

test.skipIf(!corpus)("hidden Q2 entities are not presented as visible", async () => {
  const { content, simulation, game } = await bootBoss2("q2");
  try {
    const wall = [...game.entities.values()].find(entity => entity.model === "*32");
    if (wall === undefined) throw new Error("Missing func_wall *32");
    const presentation = () => simulation.presentations().find(p => p.path === "*32");
    expect(presentation()?.visible).toBe(true);
    if (wall.use === null) throw new Error("func_wall *32 has no toggle use");
    wall.use(wall, game, null, null);
    expect(wall.visible).toBe(false);
    expect(presentation()?.visible).toBe(false);
  } finally { simulation.close(); await content.close(); }
});

test.skipIf(!corpus)("presentations interpolate between fixed source ticks", async () => {
  const { content, simulation, admission, game } = await bootBoss2("q2");
  try {
    const rotating = [...game.entities.values()].find(entity => entity.classname === "func_rotating");
    if (rotating === undefined || rotating.use === null) throw new Error("Missing func_rotating");
    rotating.use(rotating, game, admission.actor, admission.actor);
    const yaws: number[] = [];
    for (let i = 0; i < 24; i++) {
      simulation.step({ elapsedMilliseconds: 16, commands: [] });
      const presentation = simulation.presentations().find(p => p.path === "*4");
      if (presentation !== undefined) yaws.push(presentation.angles.y);
    }
    const moving = yaws.filter(yaw => yaw > 0);
    expect(moving.length).toBeGreaterThan(8);
    for (let i = 1; i < moving.length; i++) expect(Math.abs((moving[i] ?? 0) - (moving[i - 1] ?? 0))).toBeLessThan(30);
  } finally { simulation.close(); await content.close(); }
});

test("ladder flags translate between Q2 contents and Q3 surface flags", () => {
  const plane = { normal: { x: 0, y: 1, z: 0 }, distance: 0, type: 1, signbits: 0 };
  const q2Trace = { kind: "q2", fraction: 0.5, end: { x: 0, y: 0, z: 0 }, startSolid: false, allSolid: false,
    contact: { kind: "plane", plane }, hit: { kind: "world", model: 0 }, contents: 0x28030000,
    surface: { name: "", flags: 0, value: 0, material: "" }, sourcePlane: plane, secondary: null } satisfies TraceResult;
  const asQ3 = adaptTraceResult(q2Trace, { kind: "q3", contentsMask: 0x02010003, curves: true, playerCurveClip: true });
  if (asQ3.kind !== "q3") throw new Error("Expected Q3 trace");
  expect(asQ3.surfaceFlags & 8).toBe(8);
  const q3Trace = { kind: "q3", fraction: 0.5, end: { x: 0, y: 0, z: 0 }, startSolid: false, allSolid: false,
    contact: { kind: "plane", plane }, hit: { kind: "world", model: 0 }, contents: 1, surfaceFlags: 8, sourcePlane: plane } satisfies TraceResult;
  const asQ2 = adaptTraceResult(q3Trace, { kind: "q2", contentsMask: 0x02010003, leafContents: "stored" });
  if (asQ2.kind !== "q2") throw new Error("Expected Q2 trace");
  expect(asQ2.contents & 0x20000000).toBe(0x20000000);
});
