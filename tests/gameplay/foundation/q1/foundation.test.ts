import { encodeCheckpointValue } from "../../../../src/persistence/value.ts";
import { SharedPhysics } from "../../../../src/app/bootstrap/simulation/physics.ts";
import { createNativeQ1PusherServices } from "../../../../src/app/bootstrap/simulation/native-q1-pusher.ts";
import { actorCollision, actorMotion, actorFlags } from "../../../../src/app/bootstrap/simulation/actor-execution.ts";
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import type { Q1Map } from "../../../../src/formats/q1-map/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { SessionActorRegistry, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../../src/core/numeric.ts";
import { createQ1MonsterMovement } from "../../../../src/movement/q1/index.ts";
import { Q1Foundation, Q1_PROVIDER, PLAYER_BOUNDS, weaponItem, observeQ1Supply } from "../../../../src/content/q1/foundation/index.ts";
import type { Q1Event, Q1FoundationHost, Q1FoundationCheckpoint } from "../../../../src/content/q1/foundation/index.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../src/persistence/world-state.ts";
import { SharedPickupAdmission } from "../../../../src/world/gameplay/pickups.ts";
import { Q1_Q2_SUPPLY_PROFILE } from "../../../../src/content/composition/q1-q2-supply.ts";
import { previewQ1Supply } from "../../../../src/content/q1/foundation/pickups.ts";
import { ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";

const path = resolve(import.meta.dir, "../../../../../qfiles/q1/rerelease/id1/pak0.pak");
test.skipIf(!existsSync(path))("authored soldier gib death launches a persistent head before its gib pieces", async () => {
  const { runtime, due } = gameFor(await loadMap());
  due(1);
  const soldier = [...runtime.entities.values()].find(entity => entity.classname === "monster_army"), world = runtime.world;
  if (soldier === undefined || world === null) throw new Error("Missing authored soldier/world");
  runtime.setBody(soldier, { ground: world.actor.id });
  const origin = runtime.body(soldier).origin;
  runtime.damage(soldier.actor.id, soldier.actor.id, null, 250);
  const head = runtime.body(soldier), pieces = [...runtime.entities.values()].filter(entity => entity.classname === "gib");
  expect(soldier.model).toBe("progs/h_guard.mdl");
  expect(head.ground).toBeNull();
  expect(head.bounds).toEqual({ min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } });
  expect(soldier.nextThink).toBe(-1);
  expect(soldier.think).toBeNull();
  expect(soldier.angularVelocity.y).toBeLessThan(0);
  expect(head.origin.z).toBe(Math.fround(origin.z - 24));
  expect(pieces.map(entity => entity.model)).toEqual(["progs/gib1.mdl", "progs/gib2.mdl", "progs/gib3.mdl"]);
  for (const piece of pieces) expect(runtime.body(piece).origin).toEqual(head.origin);
});
async function loadMap(): Promise<Q1Map> {
  const archive = await openArchive(path);
  try { const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1"); return readQ1Bsp(await archive.readEntry(entry), { source: "maps/e1m1.bsp" }); }
  finally { archive.close(); }
}
test.skipIf(!existsSync(path))("Q1 authored button sound snapshots its brush midpoint and activation changes frame", async () => {
  const { runtime, player, events } = gameFor(await loadMap(), undefined, "classic");
  const button = [...runtime.entities.values()].find(entity => entity.classname === "func_button" && entity.target === "t9");
  if (button === undefined || button.use === null) throw new Error("Missing authored button");
  const body = runtime.body(button);
  button.use(player.id, player.id);
  const sound = events.find(event => event.kind === "sound" && event.actor.equals(button.actor.id));
  if (sound?.kind !== "sound") throw new Error("Button did not emit source sound");
  expect(sound.path).toMatch(/^buttons\//);
  expect(sound.origin).toEqual({ x: body.origin.x + 0.5 * (body.bounds.min.x + body.bounds.max.x),
    y: body.origin.y + 0.5 * (body.bounds.min.y + body.bounds.max.y), z: body.origin.z + 0.5 * (body.bounds.min.z + body.bounds.max.z) });
  runtime.named.action(button, "button_wait")();
  expect(button.frame).toBe(1);
  runtime.named.action(button, "button_return")();
  expect(button.frame).toBe(0);
});
interface SavedTestWorld {
  readonly source: Q1FoundationCheckpoint;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly import("../../../../src/contracts/session.ts").BodyCheckpoint[];
  readonly combat: readonly import("../../../../src/contracts/session.ts").CombatCheckpoint[];
  readonly inventories: readonly import("../../../../src/contracts/session.ts").InventoryCheckpoint[];
}
function gameFor(map: Q1Map, saved?: SavedTestWorld, edition: "classic" | "rerelease" = "rerelease", deathmatch = 0) {
  const identities = createIdentityOwner("q1-foundation");
  const actors = saved === undefined ? new SessionActorRegistry(identities) : SessionActorRegistry.restore(identities, saved.slots, saved.sources), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], players: ActorId[] = [];
  let game: Q1Foundation | null = null;
  const execution = (actor: OwnedActor) => { const entity = game?.entity(actor.id); return entity == null || game === null ? null :
    { kind: "q1", entity, services: game, content: "q1:rerelease:id1:test" } satisfies import("../../../../src/app/bootstrap/simulation/actor-execution.ts").ActorExecution; };
  const physics: SharedPhysics = new SharedPhysics({ actors, callbacks, scene, numeric: Q1_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
    worldActor: () => game?.world?.actor.id ?? null, onBlocked: (actor, other) => game?.entity(actor.id)?.blocked?.(other),
    getCollision: actor => { const entry = execution(actor); return entry === null ? null : actorCollision(entry); },
    getMotion: actor => { const entry = execution(actor), body = physics.bodies.read(actor.id); return entry === null || body === null ? null : actorMotion(entry, body); },
    getFlags: actor => { const entry = execution(actor); return entry === null ? { player: true } : actorFlags(entry); } });
  const bodies = physics.bodies;

  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const monsterMovement = createQ1MonsterMovement({ scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random: { nextInteger: () => 1 },
    readTarget: actor => {
    const owner = actors.resolveOwned(actor), body = bodies.read(actor);
    return owner === null || body === null ? null : { origin: body.origin, absoluteBounds: translatedBodyBounds(owner, body) };
  }, read: actor => { const body = bodies.read(actor), entity = game?.entity(actor); if (body === null || entity == null) return null;
      return { origin: body.origin, angles: body.angles, bounds: body.bounds, absoluteBounds: bodies.linked(actor)?.absoluteBounds ?? { min: vadd(body.origin, body.bounds.min), max: vadd(body.origin, body.bounds.max) },
        flags: entity.movementFlags, ground: body.ground === null ? { kind: "none" } : { kind: "actor", actor: body.ground }, idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, enemy: entity.monster?.enemy ?? null }; },
    write: (actor, state) => { const body = bodies.read(actor.id), entity = game?.entity(actor.id); if (body === null || entity == null) throw new Error("Missing native yaw actor");
      bodies.write(actor, { ...body, origin: state.origin, angles: state.angles }); entity.movementFlags = state.flags; entity.idealYaw = state.idealYaw; entity.yawSpeed = state.yawSpeed; return undefined; },
    link: actor => bodies.link(actor),
  });
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => {
      const result = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.missile === true ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (result.kind !== "q1") throw new Error("Unexpected trace family");
      return { fraction: result.fraction, end: result.end, normal: result.sourcePlane.normal, actor: result.hit.kind === "actor" ? result.hit.actor : result.hit.kind === "world" ? game?.world?.actor.id ?? null : null,
        startSolid: result.startSolid, allSolid: result.allSolid, sky: false, inOpen: result.inOpen, inWater: result.inWater };
    },
    contents: point => { const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
      if (result.kind !== "q1") throw new Error("Unexpected contents family");
      return result.contents === -2 ? "solid" : result.contents === -3 ? "water" : result.contents === -4 ? "slime" : result.contents === -5 ? "lava" : result.contents === -6 ? "sky" : "empty";
    },
    // These tests drive pickups/targets and unobstructed mover completion, not the source movement engine.
    walkMove: () => false, moveToGoal: () => undefined, checkBottom: () => false, changeYaw: actor => monsterMovement.changeYaw(actor),
    pusherServices: game => createNativeQ1PusherServices(game, physics),
    scheduleThink: (actor, time) => { pending.set(actor, time); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => game?.entity(actor)?.classname ?? "player",
    powerup: (actor, powerup, expires) => { if (powerup === "invulnerability") combat.setTraits(actor, { invulnerable: expires > 0 }); return undefined; },
  };
  const runtime = new Q1Foundation(host, { edition: saved?.source.edition ?? edition, skill: 1, deathmatch, coop: false, gravity: 800, maxClients: 4,
    campaign: "q1:id1", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement" });
  game = runtime;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => runtime.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  let report: import("../../../../src/content/q1/foundation/index.ts").Q1SpawnReport | null = null;
  let player: OwnedActor;
  if (saved === undefined) {
    report = runtime.spawnMap(map);
    player = actors.allocateAtSource(Q1_PROVIDER, 1, "q2:male-character");
    const start = [...runtime.entities.values()].find(entity => entity.classname === "info_player_start"); if (start === undefined) throw new Error("Missing start");
    bodies.create(player, { origin: runtime.body(start).origin, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    inventory.create(player, []); runtime.attachPlayer(player);
  } else {
    const restored = actors.atSource(Q1_PROVIDER, 1); if (restored === null) throw new Error("Missing saved player"); player = restored;
    const owner = (id: import("../../../../src/contracts/session.ts").SavedActorId): OwnedActor => { const result = actors.resolveSaved(id); if (result === null) throw new Error("Missing saved actor"); return result; };
    for (const entry of saved.bodies) bodies.create(owner(entry.actor), { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    for (const entry of saved.combat) combat.create(owner(entry.actor), entry.state);
    for (const entry of saved.inventories) inventory.create(owner(entry.actor), entry.entries);
    runtime.restore(saved.source, { scheduleThinks: false });
    restoreSharedBodyLinks(saved, { actors, bodies });
    runtime.resumeThinks();
  }
  players.push(player.id);
  const due = (until: number): void => {
    for (;;) {
      const entry = [...pending].filter(([_actor, time]) => time <= until).sort((a, b) => a[1] - b[1])[0]; if (entry === undefined) break;
      pending.delete(entry[0]); callbacks.think(entry[0], { frame: 0, time: { kind: "seconds", value: entry[1] }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
    runtime.time = until;
  };
  return { runtime, report, player, actors, callbacks, bodies, combat, inventory, events, due };
}

test.skipIf(!existsSync(path))("Q1 monster startup preserves failed drop state and reports placement after native walkmove", async () => {
  const game = gameFor(await loadMap(), undefined, "classic"), { runtime, player, actors } = game;
  try {
    for (const result of [{ fraction: 1, allSolid: false }, { fraction: 0, allSolid: true }, { fraction: 0.5, allSolid: false }]) {
      const entity = runtime.create("monster_dog"); runtime.spawnEntity(entity);
      const origin = { x: 20, y: 30, z: 40 }, raised = { ...origin, z: 41 }, landed = { ...origin, z: 10 };
      runtime.setBody(entity, { origin, ground: player.id }); entity.movementFlags = 1024;
      const order: string[] = [];
      runtime.host.trace = request => {
        order.push("drop"); expect(request.start).toEqual(raised); expect(runtime.body(entity).origin).toEqual(raised);
        return { ...result, end: landed, normal: { x: 0, y: 0, z: 1 }, actor: entity.actor.id, startSolid: result.allSolid, sky: false, inOpen: true, inWater: false };
      };
      runtime.host.walkMove = (actor, yaw, distance) => { expect(actor).toBe(entity.actor); expect([yaw, distance]).toEqual([0, 0]); order.push("walk"); return true; };
      runtime.monsterMissions.set(entity.actor.id, { ambush: false, spawned: () => undefined, started: () => { order.push("started"); return undefined; },
        killed: () => undefined, route: () => null, use: () => false, combatRoute: () => ({ goal: null, standGround: false }), foundTarget: () => undefined });
      runtime.named.action(entity, "walkmonster_start_go")();
      const success = result.fraction < 1 && !result.allSolid;
      expect(runtime.body(entity).origin).toEqual(success ? landed : raised);
      expect(runtime.body(entity).ground).toBe(success ? entity.actor.id : player.id);
      expect(entity.movementFlags).toBe(1024 | 32 | (success ? 512 : 0));
      expect(order).toEqual(["drop", "walk", "started"]);
    }
  } finally { actors.close(); }
});

test.skipIf(!existsSync(path))("Q1 terminal corners give native and selected followers the source pause deadline", async () => {
  const { runtime, actors } = gameFor(await loadMap(), undefined, "classic");
  try {
    const corner = runtime.create("path_corner"); corner.targetname = "terminal"; runtime.spawnEntity(corner);
    const native = runtime.create("monster_army"); runtime.spawnEntity(native);
    if (native.monster === null) throw new Error("Missing native monster");
    native.monster.path = corner.targetname; runtime.time = 1.1;
    corner.touch?.(native.actor.id, null);
    expect(native.monster.path).toBe(""); expect(native.monster.mode).toBe("stand"); expect(native.monster.pauseUntil).toBe(1000000.125);
    const selected = actors.allocate("q2:monsters", "q2:monster_infantry");
    const advances: { readonly name: string; readonly goal: ActorId | null; readonly pauseUntil: number }[] = [];
    runtime.authoredPathFollower = actor => actor.equals(selected.id) ? { targetname: corner.targetname, enemy: null,
      advance: (name, goal, pauseUntil) => { advances.push({ name, goal, pauseUntil }); return undefined; } } : null;
    corner.touch?.(selected.id, null);
    expect(advances).toEqual([{ name: "", goal: null, pauseUntil: native.monster.pauseUntil }]);
  } finally { actors.close(); }
});

test.skipIf(!existsSync(path))("fresh Q1 arsenal publishes its initial view without replaying attachment", async () => {
  const game = gameFor(await loadMap()), state = game.runtime.player(game.player.id);
  if (state === null) throw new Error("Missing source player");
  expect(game.events.filter(event => event.kind === "weapon")).toEqual([{ kind: "weapon", player: game.player.id, weapon: "shotgun", viewModel: "progs/v_shot.mdl", frame: 0, punch: 0 }]);
  state.attackFinished = 3; state.weaponFrame = 2;
  expect(game.runtime.attachPlayer(game.player)).toBe(state);
  expect(state.attackFinished).toBe(3); expect(state.weaponFrame).toBe(2);
  expect(game.events.filter(event => event.kind === "weapon")).toHaveLength(1);
});

test.skipIf(!existsSync(path))("real e1m1 entities spawn with source inhibition and a foreign character", async () => {
  const map = await loadMap(), { runtime, report, player, actors, due } = gameFor(map);
  expect(map.entityList).toHaveLength(428);
  expect(new Set(map.entityList.map(entity => entity.properties.find(property => property.key === "classname")?.value)).size).toBe(41);
  expect(runtime.totalSecrets).toBe(6);
  expect(runtime.totalMonsters).toBe(23);
  if (report === null) throw new Error("Expected spawned map report");
  expect(report.compilerOnly).toHaveLength(5);
  expect(actors.sourceOf(player.id)?.slot).toBe(1);
  expect(runtime.find("t9")[0]?.classname).toBe("trigger_counter");
  due(0.8);
  expect([...runtime.entities.values()].filter(entity => entity.monster !== null).every(entity => runtime.health(entity.actor.id) > 0)).toBe(true);
  actors.close();
});

test.skipIf(!existsSync(path))("e1m1 shootable trigger, button, secret and exit retain source activation order", async () => {
  const { runtime, player, actors, callbacks, combat, due, events } = gameFor(await loadMap());
  const shootable = [...runtime.entities.values()].find(entity => entity.classname === "trigger_multiple" && entity.target === "t4");
  const door = runtime.find("t4")[0]; if (shootable === undefined || door === undefined) throw new Error("Missing authored gate");
  const original = runtime.body(door).origin;
  runtime.damage(shootable.actor.id, player.id, player.id, 1, "shotgun");
  expect(combat.read(shootable.actor.id)?.canTakeDamage).toBe(false);
  expect(door.state).toBe("up");
  runtime.physicsEntity(door.actor, 0.1, 0.1);
  expect(runtime.body(door).origin).not.toEqual(original);
  due(0.3); expect(combat.read(shootable.actor.id)?.health).toBe(1);
  const secret = [...runtime.entities.values()].find(entity => entity.classname === "trigger_secret");
  const exit = [...runtime.entities.values()].find(entity => entity.classname === "trigger_changelevel");
  if (secret === undefined || exit === undefined) throw new Error("Missing authored trigger");
  callbacks.touch({ self: secret.actor, other: player.id, plane: null, surface: null });
  expect(runtime.foundSecrets).toBe(1);
  callbacks.touch({ self: exit.actor, other: player.id, plane: null, surface: null });
  expect(runtime.intermission).toBe(null); due(0.5);
  expect(runtime.intermission?.map).toBe("e1m2");
  expect(events.some(event => event.kind === "intermission")).toBe(true);
  expect(runtime.requestIntermissionExit(1, true)).toBe(false);
  expect(runtime.requestIntermissionExit(3, true)).toBe(true);
  actors.close();
});

test.skipIf(!existsSync(path))("Q2 character receives Q1 arsenal, armor and single-applied quad damage", async () => {
  const { runtime, player, actors, callbacks, inventory, combat, due } = gameFor(await loadMap());
  due(0.8);
  const gun = [...runtime.entities.values()].find(entity => entity.classname === "weapon_nailgun");
  const armor = [...runtime.entities.values()].find(entity => entity.classname === "item_armor2");
  const quad = [...runtime.entities.values()].find(entity => entity.classname === "item_artifact_super_damage");
  if (gun === undefined || armor === undefined || quad === undefined) throw new Error("Missing authored pickup");
  for (const item of [gun, armor, quad]) callbacks.touch({ self: item.actor, other: player.id, plane: null, surface: null });
  expect(inventory.count(player.id, weaponItem("nailgun"))).toBe(1);
  expect(inventory.count(player.id, "q1:ammo/nails")).toBe(30);
  expect(combat.read(player.id)?.armor).toEqual({ regular: { kind: "q1", points: 150, absorption: 0.6, item: "q1:item_armor2" }, powered: { kind: "none" } });
  const victim = runtime.create("damage_receiver"); victim.damageable = true; combat.setHealth(victim.actor, 100);
  runtime.damage(victim.actor.id, player.id, player.id, 9, "nailgun");
  expect(runtime.health(victim.actor.id)).toBe(64);
  runtime.attack(player, ZERO, 1);
  expect(inventory.count(player.id, "q1:ammo/nails")).toBe(29);
  expect([...runtime.entities.values()].some(entity => entity.projectile === "spike")).toBe(true);
  actors.close();
});

test.skipIf(!existsSync(path))("actual e1m1 source save resumes mover, delay, megahealth, axe and AI without map respawn", async () => {
  const map = await loadMap(), original = gameFor(map, undefined, "classic");
  const { runtime, player, callbacks, bodies, combat, inventory, actors } = original;
  original.due(0.8);
  const shootable = [...runtime.entities.values()].find(entity => entity.classname === "trigger_multiple" && entity.target === "t4");
  const door = runtime.find("t4")[0];
  const mega = [...runtime.entities.values()].find(entity => entity.classname === "item_health" && (entity.spawnflags & 3) === 2);
  const button = [...runtime.entities.values()].find(entity => entity.classname === "func_button" && entity.target === "t9");
  if (shootable === undefined || door === undefined || mega === undefined || button === undefined) throw new Error("Missing authored save specimen");
  runtime.damage(shootable.actor.id, player.id, player.id, 1, "shotgun");
  runtime.physicsEntity(door.actor, 0.85, 0.05);
  callbacks.touch({ self: mega.actor, other: player.id, plane: null, surface: null });
  button.delay = 0.6; runtime.useTargets(button, player.id);
  runtime.selectWeapon(player, "axe"); runtime.attack(player, ZERO, 0.85);
  const template = [...runtime.entities.values()].find(entity => entity.classname === "monster_army");
  if (template === undefined) throw new Error("Missing authored clone template");
  const templateMode = template.monster?.mode, total = runtime.totalMonsters;
  const clone = runtime.cloneEntity(template);
  callbacks.pain({ attack: null, self: clone.actor, attacker: player.id, damage: 1, kick: 0 });
  expect(clone.monster?.mode).toBe("pain");
  expect(template.monster?.mode).toBe(templateMode);
  expect(runtime.totalMonsters).toBe(total);
  expect(runtime.body(clone)).toEqual(runtime.body(template));
  const checkpoint = runtime.capture();
  expect(() => decodeQ1FoundationCheckpoint(encodeCheckpointValue({ ...checkpoint, version: 4 }))).toThrow();
  expect(checkpoint.entities.some(entity => entity.move !== null && entity.move.done === "door_hit_top")).toBe(true);
  expect(checkpoint.entities.some(entity => entity.callbacks.think === "health_rot")).toBe(true);
  expect(checkpoint.entities.some(entity => entity.callbacks.think === "DelayThink")).toBe(true);
  expect(checkpoint.entities.some(entity => entity.callbacks.think === "player_axe3")).toBe(true);
  expect(checkpoint.entities.some(entity => entity.callbacks.think === "monster_frame")).toBe(true);
  const saved: SavedTestWorld = {
    source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(checkpoint)), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []),
  };
  const restored = gameFor(map, saved);
  expect(restored.events).toHaveLength(0);
  expect(restored.report).toBe(null);
  expect(restored.runtime.capture()).toEqual(checkpoint);
  const restoredDoor = restored.runtime.find("t4")[0]; if (restoredDoor === undefined) throw new Error("Missing restored mover");
  for (const entry of [{ game: original, door }, { game: restored, door: restoredDoor }]) {
    entry.game.runtime.physicsEntity(entry.door.actor, 1, 0.15);
    entry.game.due(6);
  }
  expect(restored.runtime.capture()).toEqual(original.runtime.capture());
  expect(restored.combat.read(restored.player.id)?.health).toBe(combat.read(player.id)?.health);
  expect(restored.runtime.find("t9")[0]?.count).toBe(2);
  expect(restored.bodies.read(restoredDoor.actor.id)?.origin).toEqual(bodies.read(door.actor.id)?.origin);
  actors.close(); restored.actors.close();
});

test.skipIf(!existsSync(path))("Q1 services attach existing foreign owners and restore their named continuations without resetting authority state", async () => {
  const map = await loadMap(), original = gameFor(map, undefined, "classic");
  const { runtime, actors, bodies, combat, inventory, player } = original;
  const owners = [actors.allocateAtSource("q2:base", 900, "q2:authored-monster"), actors.allocate("q2:base", "q2:dynamic-monster")];
  for (const owner of owners) {
    bodies.create(owner, { origin: { x: 11, y: 22, z: 33 }, angles: ZERO, velocity: { x: 1, y: 2, z: 3 }, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 37, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 275, canTakeDamage: true, invulnerable: false, team: null });
    const body = bodies.read(owner.id), state = combat.read(owner.id), binding = actors.sourceOf(owner.id), count = actors.observations().length;
    const entity = runtime.attachExisting(owner, "DelayedUse");
    expect(entity.actor).toBe(owner);
    expect(bodies.read(owner.id)).toEqual(body);
    expect(combat.read(owner.id)).toEqual(state);
    expect(actors.sourceOf(owner.id)).toEqual(binding);
    expect(actors.observations()).toHaveLength(count);
    expect(() => runtime.attachExisting(owner, "DelayedUse")).toThrow("already attached");
    entity.target = "t9"; entity.activator = player.id;
    runtime.schedule(entity, 0.25, runtime.named.action(entity, "DelayThink"));
  }
  const checkpoint = runtime.capture();
  expect(checkpoint.entities.find(entity => entity.actor.slot === owners[0]?.id.slot)?.sourceSlot).toBe(900);
  expect(checkpoint.entities.find(entity => entity.actor.slot === owners[1]?.id.slot)?.sourceSlot).toBeNull();
  const saved: SavedTestWorld = {
    source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(checkpoint)), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []),
  };
  const restored = gameFor(map, saved);
  expect(restored.runtime.capture()).toEqual(checkpoint);
  for (const owner of owners) {
    const actor = restored.actors.resolveSaved({ slot: owner.id.slot, generation: owner.id.generation });
    if (actor === null) throw new Error("Missing restored foreign owner");
    expect(actor.owner).toBe("q2:base");
    expect(restored.combat.read(actor.id)?.health).toBe(37);
    expect(restored.bodies.read(actor.id)?.velocity).toEqual({ x: 1, y: 2, z: 3 });
  }
  original.due(0.3); restored.due(0.3);
  expect(restored.runtime.capture()).toEqual(runtime.capture());
  expect(runtime.find("t9")[0]?.count).toBe(1);
  for (const owner of owners) expect(actors.isLive(owner.id)).toBe(false);
  actors.close(); restored.actors.close();
});

test.skipIf(!existsSync(path))("external primary holster saves the real weapon and lets a committed axe callback finish once", async () => {
  const map = await loadMap();
  const original = gameFor(map);
  const { runtime, player, actors, bodies, combat, inventory } = original;
  const state = runtime.player(player.id); if (state === null) throw new Error("Missing player");
  expect(runtime.selectWeapon(player, "axe")).toBe(true);
  expect(runtime.attack(player, ZERO, 0)).toBe(true);
  const handoff = runtime.primaryWeaponHandoff(player);
  const deadline = state.attackFinished;
  handoff.holster(); handoff.holster();
  expect(state.weapon).toBe("axe");
  expect(state.attackFinished).toBe(deadline);
  expect(state.weaponFrame).toBe(0);
  expect(runtime.attack(player, ZERO, 1)).toBe(false);
  const checkpoint = runtime.capture();
  const saved: SavedTestWorld = {
    source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(checkpoint)), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => { const value = combat.read(actor.id); return value === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state: value }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []),
  };
  const restored = gameFor(map, saved);
  const resumed = restored.runtime.primaryWeaponHandoff(restored.player);
  expect(resumed.isHolstered()).toBe(true);
  expect([...restored.runtime.entities.values()].filter(entity => entity.classname === "axe_strike")).toHaveLength(1);
  restored.due(1);
  expect([...restored.runtime.entities.values()].filter(entity => entity.classname === "axe_strike")).toHaveLength(0);
  restored.due(2);
  expect(resumed.accepts("q1:weapon/rocketlauncher")).toBe(false);
  resumed.resume(null);
  expect(resumed.isHolstered()).toBe(false);
  expect(restored.runtime.player(restored.player.id)?.weapon).toBe("axe");
  expect(restored.runtime.player(restored.player.id)?.attackFinished).toBe(deadline);
  actors.close(); restored.actors.close();
});

test.skipIf(!existsSync(path))("dedicated Q1 services allocate and restore under the selected provider", async () => {
  const original = gameFor(await loadMap());
  const service = new Q1Foundation(original.runtime.host, { ...original.runtime.options, provider: "q1:threewave" });
  const hook = service.create("hook");
  expect(hook.actor.owner).toBe("q1:threewave");
  expect(original.actors.sourceOf(hook.actor.id)?.provider).toBe("q1:threewave");
  const saved = decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(service.capture()));
  expect(saved.provider).toBe("q1:threewave");
  expect(saved.entities[0]?.actorProvider).toBe("q1:threewave");
  const wrong = new Q1Foundation(original.runtime.host, original.runtime.options);
  expect(() => wrong.restore(saved)).toThrow("Incompatible Q1 source checkpoint");
  original.actors.close();
});


test.skipIf(!existsSync(path))("Q1 exploding boxes retain native stationary bounds and floor placement", async () => {
  const { runtime, actors, player } = gameFor(await loadMap(), undefined, "classic");
  try {
    const authored = [...runtime.entities.values()].filter(entity => entity.classname === "misc_explobox" || entity.classname === "misc_explobox2");
    expect(authored.length).toBeGreaterThan(0);
    for (const entity of authored) { expect(entity.solid).toBe("bbox"); expect(entity.movement).toBe("none"); }
    const world = runtime.world;
    if (world === null) throw new Error("Missing actual world actor");
    for (const classname of ["misc_explobox", "misc_explobox2"]) for (const result of [
      { fraction: 1, allSolid: false, drop: 256 }, { fraction: 0, allSolid: true, drop: 0 },
      { fraction: 0.5, allSolid: false, drop: 128 }, { fraction: 251 / 256, allSolid: false, drop: 251 },
    ]) {
      const entity = runtime.create(classname), origin = { x: 20, y: 30, z: 400 }, raised = { ...origin, z: 402 };
      runtime.setBody(entity, { origin, ground: player.id }); entity.movementFlags = 1024;
      const landed = { ...raised, z: raised.z - result.drop };
      runtime.host.trace = request => {
        expect(request.start).toEqual(raised); expect(runtime.body(entity).origin).toEqual(raised);
        expect(request.bounds).toEqual({ min: ZERO, max: { x: 32, y: 32, z: classname === "misc_explobox2" ? 32 : 64 } });
        expect(request.ignore).toBe(entity.actor.id);
        return { ...result, end: landed, normal: { x: 0, y: 0, z: 1 }, actor: world.actor.id, startSolid: result.allSolid, sky: false, inOpen: true, inWater: false };
      };
      runtime.spawnEntity(entity);
      const success = result.fraction < 1 && !result.allSolid, removed = success && result.drop > 250;
      expect(actors.isLive(entity.actor.id)).toBe(!removed);
      if (removed) continue;
      expect(entity.solid).toBe("bbox"); expect(entity.movement).toBe("none");
      expect(entity.model).toBe(classname === "misc_explobox2" ? "maps/b_exbox2.bsp" : "maps/b_explob.bsp");
      expect(runtime.health(entity.actor.id)).toBe(20); expect(entity.die).not.toBeNull();
      expect(runtime.body(entity).origin).toEqual(success ? landed : raised);
      expect(runtime.body(entity).ground).toBe(success ? world.actor.id : player.id);
      expect(entity.movementFlags).toBe(1024 | (success ? 512 : 0));
    }
  } finally { actors.close(); }
});

test.skipIf(!existsSync(path))("Q1 source supply observations preserve actual offers, touch eligibility and regeneration", async () => {
  const map = await loadMap();
  for (const deathmatch of [1, 2]) {
    const { runtime, player, actors, inventory, combat, callbacks, events, due } = gameFor(map, undefined, "rerelease", deathmatch);
    try {
      inventory.configure(player, { item: "q2:weapon_machinegun", count: 0, capacity: 1 });
      inventory.configure(player, { item: "q2:ammo_bullets", count: 0, capacity: 200 });
      const admission = new SharedPickupAdmission({ inventory, profile: Q1_Q2_SUPPLY_PROFILE,
        ammoGranted: () => undefined, weaponGranted: () => undefined });
      runtime.pickupAdmission = admission;
      const gun = [...runtime.entities.values()].find(entity => entity.classname === "weapon_nailgun");
      const ammo = [...runtime.entities.values()].find(entity => entity.classname === "item_spikes" && (entity.spawnflags & 1) === 0);
      const health = [...runtime.entities.values()].find(entity => entity.classname === "item_health");
      if (gun === undefined || ammo === undefined || health === undefined) throw new Error("Missing authored e1m1 supplies");
      expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.availability).toEqual({ kind: "inactive" });
      expect(observeQ1Supply(runtime, health.actor.id, player.id)).toBeNull();
      due(0.8);
      const before = runtime.capture(), counts = inventory.entries(player.id), eventCount = events.length;
      const observation = observeQ1Supply(runtime, gun.actor.id, player.id);
      if (observation === null) throw new Error("Missing weapon offer");
      expect(observation.offer).toEqual({ kind: "weapon", offer: { item: "q1:weapon/nailgun", ammo: [{ item: "q1:ammo/nails", amount: 30 }] } });
      expect(observation.availability).toEqual({ kind: "ready", eligible: true });
      const preview = previewQ1Supply(runtime, gun.actor.id, player.id);
      if (preview === null) throw new Error("Missing mapped weapon preview");
      expect(preview.weapons).toEqual([{ item: "q2:weapon_machinegun", before: 0, given: 1 }]);
      expect(preview.ammo).toEqual([{ item: "q2:ammo_bullets", before: 0, given: 30 }]);
      expect(runtime.capture()).toEqual(before); expect(inventory.entries(player.id)).toEqual(counts); expect(events).toHaveLength(eventCount);
      callbacks.touch({ self: gun.actor, other: player.id, plane: null, surface: null });
      expect(inventory.count(player.id, "q2:weapon_machinegun")).toBe(1);
      expect(inventory.count(player.id, "q2:ammo_bullets")).toBe(30);
      if (deathmatch === 1) {
        const deadline = Math.fround(0.8 + 30);
        expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.availability).toEqual({ kind: "respawning", atSeconds: deadline });
        expect(gun.model).toBe("");
        due(deadline - 0.1); expect(gun.solid).toBe("none");
        due(deadline); expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: true });
        inventory.configure(player, { item: "q2:ammo_bullets", count: 200, capacity: 200 });
        const full = admission.preview(player.id, observation.offer);
        expect(full.accepted).toBe(true); expect([...full.weapons, ...full.ammo].every(receipt => receipt.given === 0)).toBe(true);
      } else {
        expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: false });
        callbacks.touch({ self: gun.actor, other: player.id, plane: null, surface: null });
        expect(inventory.count(player.id, "q2:ammo_bullets")).toBe(30); expect(gun.nextThink).toBe(-1);
      }
      inventory.configure(player, { item: "q2:ammo_bullets", count: 0, capacity: 200 });
      const ammoObservation = observeQ1Supply(runtime, ammo.actor.id, player.id);
      if (ammoObservation === null) throw new Error("Missing ammo offer");
      expect(ammoObservation.offer).toEqual({ kind: "ammo", offer: { item: "q1:ammo/nails", amount: 25 } });
      combat.setHealth(player, 0);
      expect(observeQ1Supply(runtime, ammo.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: false });
      callbacks.touch({ self: ammo.actor, other: player.id, plane: null, surface: null }); expect(inventory.count(player.id, "q2:ammo_bullets")).toBe(0);
      combat.setHealth(player, 100);
      const ammoPreview = admission.preview(player.id, ammoObservation.offer);
      callbacks.touch({ self: ammo.actor, other: player.id, plane: null, surface: null });
      const ammoGrant = ammoPreview.ammo[0];
      if (ammoGrant === undefined) throw new Error("Missing actual ammo preview grant");
      expect(inventory.count(player.id, "q2:ammo_bullets")).toBe(ammoGrant.given);
      if (deathmatch === 2) expect(observeQ1Supply(runtime, ammo.actor.id, player.id)?.availability).toEqual({ kind: "inactive" });
      runtime.pickupAdmission = null;
      let modifierCalls = 0;
      runtime.registerPickupRules({ id: "observation-grant-check", weaponAmmoGrant: (_game, _player, _weapon, amount) => { modifierCalls++; return amount; } });
      expect(observeQ1Supply(runtime, gun.actor.id, player.id)).toBeNull();
      expect(previewQ1Supply(runtime, gun.actor.id, player.id)).toBeNull();
      expect(observeQ1Supply(runtime, ammo.actor.id, player.id)?.offer).toEqual(ammoObservation.offer);
      expect(modifierCalls).toBe(0);
      runtime.pickupAdmission = admission;
      expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.offer).toEqual(observation.offer);
      runtime.cancel(gun); gun.touch = null; expect(observeQ1Supply(runtime, gun.actor.id, player.id)).toBeNull();
      const removed = ammo.actor.id; runtime.remove(ammo); expect(observeQ1Supply(runtime, removed, player.id)).toBeNull();
    } finally { actors.close(); }
  }
});

test.skipIf(!existsSync(path))("native Q1 supply previews match source touches without changing source state", async () => {
  const map = await loadMap();
  for (const deathmatch of [1, 2]) {
    const { runtime, player, actors, inventory, callbacks, events, due } = gameFor(map, undefined, "rerelease", deathmatch);
    try {
      const gun = [...runtime.entities.values()].find(entity => entity.classname === "weapon_nailgun");
      const ammo = [...runtime.entities.values()].find(entity => entity.classname === "item_spikes" && (entity.spawnflags & 1) === 0);
      if (gun === undefined || ammo === undefined) throw new Error("Missing authored e1m1 supplies");
      due(0.8);
      const before = runtime.capture(), counts = inventory.entries(player.id), eventCount = events.length;
      const preview = previewQ1Supply(runtime, gun.actor.id, player.id);
      expect(preview).toEqual({ accepted: true, weapons: [{ item: "q1:weapon/nailgun", before: 0, given: 1 }],
        ammo: [{ item: "q1:ammo/nails", before: 0, given: 30 }] });
      expect(runtime.capture()).toEqual(before); expect(inventory.entries(player.id)).toEqual(counts); expect(events).toHaveLength(eventCount);
      callbacks.touch({ self: gun.actor, other: player.id, plane: null, surface: null });
      if (preview === null) throw new Error("Missing native weapon preview");
      for (const receipt of [...preview.weapons, ...preview.ammo]) expect(inventory.count(player.id, receipt.item)).toBe(receipt.before + receipt.given);
      if (deathmatch === 2) {
        expect(observeQ1Supply(runtime, gun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: false });
        callbacks.touch({ self: gun.actor, other: player.id, plane: null, surface: null });
        expect(inventory.count(player.id, "q1:ammo/nails")).toBe(30);
      }
      inventory.configure(player, { item: "q1:ammo/nails", count: 200, capacity: 200 });
      expect(previewQ1Supply(runtime, gun.actor.id, player.id)).toEqual({ accepted: true,
        weapons: [{ item: "q1:weapon/nailgun", before: 1, given: 0 }], ammo: [{ item: "q1:ammo/nails", before: 200, given: 0 }] });
      expect(previewQ1Supply(runtime, ammo.actor.id, player.id)).toEqual({ accepted: false, weapons: [],
        ammo: [{ item: "q1:ammo/nails", before: 200, given: 0 }] });
      callbacks.touch({ self: ammo.actor, other: player.id, plane: null, surface: null });
      expect(ammo.solid).toBe("trigger"); expect(inventory.count(player.id, "q1:ammo/nails")).toBe(200);
      inventory.consume(player, "q1:ammo/nails", 10);
      const partial = previewQ1Supply(runtime, ammo.actor.id, player.id);
      expect(partial).toEqual({ accepted: true, weapons: [], ammo: [{ item: "q1:ammo/nails", before: 190, given: 10 }] });
      callbacks.touch({ self: ammo.actor, other: player.id, plane: null, surface: null });
      if (partial === null) throw new Error("Missing native ammo preview");
      for (const receipt of partial.ammo) expect(inventory.count(player.id, receipt.item)).toBe(receipt.before + receipt.given);
      expect(ammo.solid).toBe("none");
    } finally { actors.close(); }
  }
});


test.skipIf(!existsSync(path))("declared rerelease gib gravity and corpse enum survive provider checkpoint", async () => {
  const { runtime, player, bodies } = gameFor(await loadMap());
  const playerBody = bodies.read(player.id);
  if (playerBody === null) throw new Error("Missing fixture player body");
  const gib = runtime.create("declared_gib");
  gib.movement = "gib"; gib.solid = "corpse"; gib.fields.set("gravity", "0.5");
  runtime.setBody(gib, { origin: playerBody.origin, velocity: ZERO, bounds: { min: ZERO, max: ZERO }, ground: null });
  runtime.physicsEntity(gib.actor, 0.001, 0.001);
  expect(runtime.body(gib).velocity.z).toBe(Math.fround(-0.4));
  const checkpoint = decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(runtime.capture()));
  const saved = checkpoint.entities.find(entity => entity.classname === "declared_gib");
  expect(saved?.state.movement).toBe("gib"); expect(saved?.state.solid).toBe("corpse");
  expect(saved?.fields.find(field => field.key === "gravity")?.value).toBe("0.5");
  const classic = gameFor(await loadMap(), undefined, "classic").runtime;
  const invalid = classic.create("declared_gib"); invalid.movement = "gib";
  expect(() => classic.physicsEntity(invalid.actor, 0.001, 0.001)).toThrow("rerelease physics profile");
});
