import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import type { OwnedActor } from "../../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../../src/contracts/scene.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../../src/world/collision/index.ts";
import { Q2_DONOR_PROFILE } from "../../../../../src/core/numeric.ts";
import { openArchive } from "../../../../../src/content/archive/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../../../../src/formats/q2-map/index.ts";
import type { Q2DecodedMap } from "../../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities } from "../../../../../src/content/q2/foundation/fields.ts";
import type { Q2FoundationHost, Q2TraceRequest, Q2Edition } from "../../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../../src/content/q2/foundation/runtime.ts";
import { Q2Ballistics } from "../../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../../src/content/q2/foundation/monsters/index.ts";
import { Q2RogueHints, decodeQ2RogueHintsCheckpoint } from "../../../../../src/content/q2/missionpacks/monsters/hints.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../../../src/persistence/value.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

function fixture(edition: Q2Edition = "classic", map: Q2DecodedMap | null = null) {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-hint-paths")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }), inventory = new SharedInventoryTable(actors);
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"), player = actors.allocate("q3:character", "q3:sarge");
  const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  bodies.create(player, { origin: { x: 800, y: 0, z: 24 }, angles: zero, velocity: zero, bounds, ground: world.id });
  combat.create(player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  const queries = map === null ? null : createSceneQueries(map);
  let now = 0, hideEnemy = false;
  const scheduled = new Map<OwnedActor, number>(), diagnostics: string[] = [];
  const trace = (request: Q2TraceRequest): TraceResult => {
    if (queries !== null) return queries.trace({ start: request.start, end: request.end, shape: request.bounds === null ? { kind: "point" } : { kind: "box", bounds: request.bounds },
      target: { kind: "world" }, policy: { kind: "q2", contentsMask: request.mask, leafContents: edition === "classic" ? "stored" : "merged" }, numeric: Q2_DONOR_PROFILE, passActor: request.ignore });
    const plane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };
    const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
    if (request.bounds !== null && request.end.z < request.start.z && request.end.z + request.bounds.min.z <= 0) {
      const z = -request.bounds.min.z; return { ...clear, fraction: Math.max(0, (request.start.z - z) / (request.start.z - request.end.z)), end: { ...request.end, z }, hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
    }
    const playerBody = bodies.read(player.id);
    if (hideEnemy && request.ignore !== player.id && request.bounds === null && playerBody !== null && request.end.x === playerBody.origin.x && request.end.z > 24)
      return { ...clear, fraction: 0.5, hit: { kind: "world", model: 0 } };
    return clear;
  };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace, pointContents: point => point.z < 0 ? 1 : 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor === player.id, isMonster: actor => monsters.context(actor) !== null,
    touchTriggers: () => undefined, nearby: () => [...game.entities.values()].map(entity => entity.actor.id), inlineModelBounds: () => bounds,
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: () => undefined,
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined,
    diagnostic: message => { diagnostics.push(message); return undefined; },
  };
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons), hints = new Q2RogueHints(monsters); monsters.setHintPaths(hints.hooks);
  const game = new Q2Foundation(host, { edition, mapName: "rhangar2", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1,
    provider: "q2:game", campaign: "q2:rogue", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, [hints, monsters]);
  game.attachPlayer(player);
  return { actors, bodies, combat, game, hints, monsters, callbacks, scheduled, diagnostics, player, world,
    time(seconds: number): undefined { now = seconds; return undefined; },
    hideEnemy(hidden: boolean): undefined { hideEnemy = hidden; return undefined; },
    hint(targetname: string, target: string, x: number, endpoint = false, wait = 0) {
      return game.spawn({ classname: "hint_path", ordinal: -1, values: new Map([["targetname", targetname], ["target", target], ["origin", `${x} 0 24`], ["spawnflags", endpoint ? "1" : "0"], ["wait", String(wait)]]) });
    },
    monster(origin = zero) {
      const entity = game.spawn({ classname: "monster_infantry", ordinal: -1, values: new Map([["origin", `${origin.x} ${origin.y} ${origin.z + 24}`]]) });
      const context = monsters.context(entity.actor.id); if (context === null) throw new Error("Missing actual infantry controller");
      game.move(entity, { ground: world.id }); entity.enemy = player.id;
      const think = game.sourceCallbacks.think.resolve("monster_think"); if (think === null) throw new Error("Missing named monster think"); entity.think = think;
      return context;
    },
  };
}

test("actual Rogue maps construct their authored hint chains and named callbacks", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/rogue/pak0.pak");
  let maps = 0, nodes = 0;
  try {
    for (const entry of archive.entries.filter(entry => entry.path.startsWith("maps/") && entry.path.endsWith(".bsp"))) {
      const rows = parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities).filter(row => row.classname === "hint_path");
      if (rows.length === 0) continue;
      const scene = fixture(); for (const row of rows) scene.game.spawn(row);
      const report = scene.hints.finalize(scene.game); expect(report.present).toBe(true); expect(report.chains).toBeGreaterThan(0); expect(report.issues).toEqual([]);
      expect(scene.game.capture().entities.every(entity => entity.spawn.classname !== "hint_path" || entity.callbacks.touch === "hint_path_touch")).toBe(true);
      nodes += rows.length; maps++; scene.actors.close();
    }
  } finally { archive.close(); }
  expect(maps).toBe(12); expect(nodes).toBe(830);
});

test("source hint pursuit selects source-order nodes, moves, waits, reverses and restores references", () => {
  for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
    const scene = fixture(edition), start = scene.hint("", "b", 0, true), entry = scene.hint("b", "c", 100, false, 2), middle = scene.hint("c", "d", 700), end = scene.hint("d", "", 800, true);
    scene.hints.finalize(scene.game); const monster = scene.monster(); scene.time(9.9);
    expect(monster.checkLostHintPath()).toBe(false); scene.time(10); expect(monster.checkLostHintPath()).toBe(true);
    expect(monster.state.moveTarget).toBe(entry.actor.id); expect(monster.entity.goal).toBe(entry.actor.id);
    scene.hideEnemy(true); expect(monster.runHintPath(12)).toBe(true); expect(scene.game.body(monster.entity).origin.x).toBeGreaterThan(0); expect(monster.state.hintPath).toBe(true);
    const checkpoint = decodeQ2RogueHintsCheckpoint(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(scene.hints.capture(scene.game)))));
    scene.hints.stop(monster); scene.hints.restore(scene.game, checkpoint); scene.hints.go(monster, entry);
    scene.callbacks.touch({ self: entry.actor, other: monster.entity.actor.id, plane: null, surface: null });
    expect(monster.state.moveTarget).toBe(middle.actor.id); expect(scene.scheduled.get(monster.entity.actor)).toBe(12);
    expect(scene.game.sourceCallbacks.think.name(monster.entity.think)).toBe("monster_think");
    scene.callbacks.touch({ self: middle.actor, other: monster.entity.actor.id, plane: null, surface: null }); expect(monster.state.moveTarget).toBe(end.actor.id);
    scene.callbacks.touch({ self: end.actor, other: monster.entity.actor.id, plane: null, surface: null }); expect(monster.state.hintPath).toBe(false); expect(monster.entity.goal).toBe(scene.player.id);
    const playerBody = scene.bodies.read(scene.player.id); if (playerBody === null) throw new Error("Missing foreign player body"); scene.bodies.write(scene.player, { ...playerBody, origin: { x: 0, y: 0, z: 24 } });
    scene.game.move(monster.entity, { origin: { x: 800, y: 0, z: 24 } }); scene.hideEnemy(false);
    expect(scene.hints.check(monster)).toBe(true); expect(monster.state.moveTarget).toBe(end.actor.id);
    scene.callbacks.touch({ self: end.actor, other: monster.entity.actor.id, plane: null, surface: null }); expect(monster.state.moveTarget).toBe(middle.actor.id);
    expect(scene.hints.otherEnd(start, scene.game)).toBe(end); expect(scene.hints.findStart(end, scene.game)).toBe(start);
    scene.combat.setHealth(scene.player, 0); scene.hints.stop(monster); expect(monster.entity.enemy).toBeNull(); expect(monster.state.pauseTime).toBeGreaterThan(100000000);
    scene.actors.close();
  }
});

test("forks and circular hint chains are diagnosed and disconnected", () => {
  const scene = fixture(), root = scene.hint("", "b", 0, true);
  scene.hint("b", "c", 100); scene.hint("b", "", 120, true);
  expect(scene.hints.finalize(scene.game).issues.some(issue => issue.includes("Forked"))).toBe(true);
  expect(scene.hints.capture(scene.game).nodes.find(node => node.actor.slot === root.actor.id.slot)?.next).toBeNull();
  for (const entity of [...scene.game.entities.values()]) if (entity.classname === "hint_path") scene.game.remove(entity);
  const cycle = scene.hint("", "x", 0, true); scene.hint("x", "y", 100); scene.hint("y", "x", 200);
  expect(scene.hints.finalize(scene.game).issues.some(issue => issue.includes("Circular"))).toBe(true);
  expect(scene.hints.capture(scene.game).nodes.find(node => node.actor.slot === cycle.actor.id.slot)?.next).toBeNull(); scene.actors.close();
});

test("rhangar2 hint pursuit uses retail BSP visibility and leaves rerelease nav pursuit alone", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/rogue/pak0.pak");
  try {
    const entry = archive.findEntries("maps/rhangar2.bsp")[0]; if (entry === undefined) throw new Error("Missing Rogue rhangar2.bsp");
    const map = toQ2WorldGeometry(readQ2Bsp(await archive.readEntry(entry))), scene = fixture("rerelease", map);
    const nodes = parseQ2Entities(map.entities).filter(row => row.classname === "hint_path").map(row => scene.game.spawn(row)); scene.hints.finalize(scene.game);
    const start = nodes[0], end = nodes.at(-1); if (start === undefined || end === undefined) throw new Error("Retail hangar hint chain missing endpoints");
    const monster = scene.monster(), playerBody = scene.bodies.read(scene.player.id); if (playerBody === null) throw new Error("Missing foreign player body");
    scene.game.move(monster.entity, { origin: scene.game.body(start).origin }); scene.bodies.write(scene.player, { ...playerBody, origin: scene.game.body(end).origin });
    expect(scene.hints.check(monster)).toBe(true); expect(monster.state.hintPath).toBe(true);
    const next = scene.game.entity(monster.state.moveTarget); expect(next).not.toBeNull();
    scene.hints.stop(monster); monster.state.pathing = { firstMovePoint: zero, secondMovePoint: zero, traversalPending: false };
    expect(scene.hints.check(monster)).toBe(false); expect(monster.state.hintPath).toBe(false);
    scene.actors.close();
  } finally { archive.close(); }
});
