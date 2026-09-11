import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import type { Q1Map } from "../../../../src/formats/q1-map/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../../src/core/numeric.ts";
import { createQ1MonsterMovement } from "../../../../src/movement/q1/index.ts";
import { Q1Foundation, Q1_PROVIDER, PLAYER_BOUNDS, weaponItem } from "../../../../src/content/q1/foundation/index.ts";
import type { Q1Event, Q1FoundationHost, Q1FoundationCheckpoint } from "../../../../src/content/q1/foundation/index.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../src/persistence/world-state.ts";
import { ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";

const path = resolve(import.meta.dir, "../../../../../qfiles/q1/rerelease/id1/pak0.pak");
async function loadMap(): Promise<Q1Map> {
  const archive = await openArchive(path);
  try { const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1"); return readQ1Bsp(await archive.readEntry(entry), { source: "maps/e1m1.bsp" }); }
  finally { archive.close(); }
}
interface SavedTestWorld {
  readonly source: Q1FoundationCheckpoint;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly import("../../../../src/contracts/session.ts").BodyCheckpoint[];
  readonly combat: readonly import("../../../../src/contracts/session.ts").CombatCheckpoint[];
  readonly inventories: readonly import("../../../../src/contracts/session.ts").InventoryCheckpoint[];
}
function gameFor(map: Q1Map, saved?: SavedTestWorld, edition: "classic" | "rerelease" = "rerelease") {
  const identities = createIdentityOwner("q1-foundation");
  const actors = saved === undefined ? new SessionActorRegistry(identities) : SessionActorRegistry.restore(identities, saved.slots, saved.sources), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], players: ActorId[] = [];
  let game: Q1Foundation | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = game?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner,
      role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const monsterMovement = createQ1MonsterMovement({ scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random: { nextInteger: () => 1 },
    read: actor => { const body = bodies.read(actor), entity = game?.entity(actor); if (body === null || entity == null) return null;
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
    pushMove: (actor, displacement) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing mover body"); bodies.write(actor, { ...body, origin: vadd(body.origin, displacement) }); bodies.link(actor); return null; },
    scheduleThink: (actor, time) => { pending.set(actor, time); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => game?.entity(actor)?.classname ?? "player",
    powerup: (actor, powerup, expires) => { if (powerup === "invulnerability") combat.setTraits(actor, { invulnerable: expires > 0 }); return undefined; },
  };
  const runtime = new Q1Foundation(host, { edition: saved?.source.edition ?? edition, skill: 1, deathmatch: 0, coop: false, gravity: 800, maxClients: 4,
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
    combat.create(player, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
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
  expect(combat.read(player.id)?.armor).toEqual({ kind: "q1", points: 150, absorption: 0.6, item: "q1:item_armor2" });
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
  callbacks.pain({ self: clone.actor, attacker: player.id, damage: 1, kick: 0 });
  expect(clone.monster?.mode).toBe("pain");
  expect(template.monster?.mode).toBe(templateMode);
  expect(runtime.totalMonsters).toBe(total);
  expect(runtime.body(clone)).toEqual(runtime.body(template));
  const checkpoint = runtime.capture();
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
    combat.create(owner, { health: 37, armor: { kind: "none" }, mass: 275, canTakeDamage: true, invulnerable: false, team: null });
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
