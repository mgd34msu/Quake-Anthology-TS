import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { SavedActorId } from "../../../../src/contracts/session.ts";
import type { BodyState } from "../../../../src/contracts/world.ts";
import type { CombatState, InventoryEntry } from "../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { WeaponStepInput } from "../../../../src/contracts/movement.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../../src/world/collision/index.ts";
import type { ActorCollision } from "../../../../src/world/collision/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";
import { Q3SelectedSource } from "../../../../src/app/bootstrap/simulation/arsenal/q3-source.ts";
import type { Q3SelectedClientEffects, Q3SelectedSourceHost } from "../../../../src/app/bootstrap/simulation/arsenal/q3-source.ts";
import { Q3SelectedArsenal } from "../../../../src/app/bootstrap/simulation/arsenal/q3.ts";
import { q3SpawnAnimation } from "../../../../src/content/q3/foundation/arsenal.ts";
import { EntityEvent, EntityType, Powerup, Team, statSchema } from "../../../../src/content/q3/base/shared/definitions.ts";
import { itemList } from "../../../../src/content/q3/base/shared/items.ts";
import { ConfigStringRegistry } from "../../../../src/content/q3/base/game/utilities.ts";
import { pickupHoldable } from "../../../../src/content/q3/base/game/item-pickup.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../../src/persistence/value.ts";
import { savedActorId } from "../../../../src/persistence/save-image.ts";

const archivePath = resolve(process.env["QUAKE_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../../qfiles"), "q1/rerelease/id1/pak0.pak");
const zero = { x: 0, y: 0, z: 0 };
async function map() {
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries("maps/start.bsp")[0]; if (entry === undefined) throw new Error("Missing original start map");
    const world = readQ1Bsp(await archive.readEntry(entry));
    const spawn = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
    const point = spawn?.get("origin")?.split(/\s+/).map(Number);
    if (point?.[0] === undefined || point[1] === undefined || point[2] === undefined) throw new Error("Missing original spawn");
    return { world, origin: { x: point[0], y: point[1], z: point[2] } };
  } finally { archive.close(); }
}

interface SavedFixture {
  readonly actors: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sourceActors: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly time: number;
  readonly source: unknown;
  readonly world: SavedActorId;
  readonly player: SavedActorId;
  readonly strings: readonly (readonly [number, string])[];
  readonly states: readonly { readonly id: SavedActorId; readonly body: BodyState | null; readonly combat: CombatState | null;
    readonly inventory: readonly InventoryEntry[] | null; readonly player: boolean; readonly collision: ActorCollision | undefined; readonly linked: boolean }[];
}
function fixture(data: Awaited<ReturnType<typeof map>>, previous?: SavedFixture, product: Q3SelectedSourceHost["product"] = "missionpack") {
  const actors = previous === undefined ? new SessionActorRegistry(createIdentityOwner("selected-team-arena"))
    : SessionActorRegistry.restore(createIdentityOwner("selected-team-arena-restored"), previous.actors, previous.sourceActors);
  const callbacks = new ActorCallbackTable(actors), scene = new SharedSceneQueries(data.world), collisions = new Map<ActorId, ActorCollision>();
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
    onLink: body => { const collision = collisions.get(body.actor); if (collision !== undefined) scene.link(body, collision); return undefined; },
    onUnlink: actor => { scene.unlink(actor); return undefined; } });
  scene.bindActorState(actor => bodies.read(actor));
  let source: Q3SelectedSource | null = null;
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing body");
      bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } }); return undefined; },
    beforeReaction: (_actor, decision) => { source?.bridge.beforeReaction(decision); return undefined; }, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), players = new Set<ActorId>();
  let maxHealth = 100;
  let time = previous?.time ?? 100, angles: Vec3 = { x: 90, y: 0, z: 0 };
  const strings = new Map<number, string>(previous?.strings), indices = new ConfigStringRegistry({ get: index => strings.get(index) ?? "", set: (index, value) => { strings.set(index, value); } });
  const executions = new Map<OwnedActor, (previous: number, time: number) => void>();
  const changes: { readonly before: Q3SelectedClientEffects; readonly after: Q3SelectedClientEffects }[] = [], events: number[] = [];
  const create = (definition: "q1:world" | "q1:player", origin: Vec3) => {
    const actor = actors.allocate("q1:game", definition);
    bodies.create(actor, { origin, angles: zero, velocity: zero, bounds: definition === "q1:player" ? { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } : { min: zero, max: zero }, ground: null });
    combat.create(actor, { health: 80, armor: { regular: { kind: "q1", points: 20, absorption: 0.3, item: "q1:armor/green" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: definition === "q1:player", invulnerable: false, team: null });
    inventory.create(actor, [{ item: "q1:ammo/shells", count: 19, capacity: 100 }]);
    callbacks.bind(actor, { think: null, touch: null, pain: null, die: null, use: null });
    if (definition === "q1:player") { players.add(actor.id); collisions.set(actor.id, { family: "q1", shape: { kind: "box" }, contents: -2, owner: null, role: "solid", monster: false, deadMonster: false }); bodies.link(actor); }
    return actor;
  };
  if (previous !== undefined) for (const state of previous.states) {
    const actor = actors.resolveSaved(state.id); if (actor === null) throw new Error("Missing restored actor");
    if (state.body !== null) bodies.create(actor, { ...state.body, ground: null });
    if (state.combat !== null) combat.create(actor, state.combat);
    if (state.inventory !== null) inventory.create(actor, state.inventory);
    if (state.player) players.add(actor.id);
    if (state.collision !== undefined) { collisions.set(actor.id, { ...state.collision, owner: null }); if (state.linked) bodies.link(actor); }
  }
  const world = previous === undefined ? create("q1:world", zero) : actors.resolveSaved(previous.world);
  const player = previous === undefined ? create("q1:player", data.origin) : actors.resolveSaved(previous.player);
  if (world === null || player === null) throw new Error("Missing restored fixture principals");
  source = new Q3SelectedSource({ actors, bodies, callbacks, combat, inventory, queries: scene,
    provider: `q3:weapons/classic/${product}`, product, equipment: { kind: "source" }, content: `q3:classic:${product}:retail`, configstrings: indices.store, userinfo: () => "\\name\\Source player",
    maxClients: 2, seed: 1, now: () => time, worldActor: () => world, player: actor => players.has(actor)
      ? { angles, viewHeight: 22, maxHealth, team: Team.TEAM_FREE, quadUntil: 0, hasteUntil: 0 } : null,
    combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement",
    collision: (actor, collision) => { collisions.set(actor.id, collision); return undefined; }, curves: () => true, playerCurveClip: () => true,
    armorContext: () => ({ screenFacingDot: 1, arithmetic: "binary32" }), gameType: () => 0, friendlyFire: () => false,
    knockback: () => 1000, intermissionQueued: () => 0, checkHurtCarrier: () => {}, checkObeliskAttack: () => false,
    quadFactor: () => 4, proximityTimeout: () => 20000, modelIndex: path => indices.modelIndex(path), soundIndex: path => indices.soundIndex(path), print: () => {},
    execute: (actor, step) => { executions.set(actor, step); }, event: (_actor, state) => { events.push(state.eType >= EntityType.ET_EVENTS ? state.eType - EntityType.ET_EVENTS : state.event & 255); },
    clientChanged: (_actor, before, after) => { changes.push({ before, after }); angles = after.viewAngles; maxHealth = after.maxHealth; },
    returnPickup: () => { throw new Error("Fixture has no borrowed map item lifecycle"); },
    dropObjectives: () => {}, spawnPoint: () => ({ origin: data.origin, angles: { x: 0, y: 90, z: 0 } }) }, previous?.source);
  combat.register(source.bridge.policy()); source.admit(player);
  const active = source;
  return { actors, bodies, combat, inventory, callbacks, scene, collisions, strings, source: active, world, player, players, changes, events,
    now: () => time, angles: (value: Vec3) => { angles = value; },
    advance: (next: number) => { const previous = time; time = next; for (const [actor, step] of [...executions]) if (actors.isLive(actor.id)) step(previous, time); },
  };
}
function capture(value: ReturnType<typeof fixture>): SavedFixture {
  return { actors: value.actors.checkpoint(), sourceActors: value.actors.sourceCheckpoint(), time: value.now(),
    source: decodeCheckpointValue(encodeCheckpointValue(value.source.capture())), world: savedActorId(value.world.id), player: savedActorId(value.player.id), strings: [...value.strings],
    states: value.actors.observations().map(actor => ({ id: savedActorId(actor.id), body: value.bodies.read(actor.id), combat: value.combat.read(actor.id),
      inventory: value.inventory.has(actor.id) ? value.inventory.entries(actor.id) : null, player: value.players.has(actor.id), collision: value.collisions.get(actor.id), linked: value.bodies.linked(actor.id) !== null })) };
}
function input(value: ReturnType<typeof fixture>, arsenal: Q3SelectedArsenal): WeaponStepInput {
  return { actor: value.player, arsenal: arsenal.read(value.player.id), command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: value.now() / 1000,
    viewAngles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    frame: { frame: 1, time: { kind: "milliseconds", value: value.now() }, elapsed: { kind: "milliseconds", value: 100 }, phase: "client-command" },
    animation: { provider: "q1:character", state: q3SpawnAnimation() }, environment: { health: 80, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, gauntletHit: false };
}

test.skipIf(!existsSync(archivePath))("original Team Arena proximity source runs on borrowed Q1 actors and restores its armed deadline", async () => {
  const data = await map(), value = fixture(data), beforeBody = value.bodies.read(value.player.id), beforeCombat = value.combat.read(value.player.id);
  const arsenal = new Q3SelectedArsenal({ provider: value.source.host.provider, product: "missionpack", inventory: value.inventory,
    fire: (actor, weapon, input) => value.source.fire(actor, weapon, input), useHoldable: (actor, event) => value.source.useHoldable(actor, event),
    equipment: { read: actor => value.source.equipment(actor), consume: (actor, item) => value.source.consume(actor, item) } });
  arsenal.admit(value.player, 100);
  value.source.fire(value.player, 12, input(value, arsenal));
  expect(value.bodies.read(value.player.id)).toEqual(beforeBody); expect(value.combat.read(value.player.id)).toEqual(beforeCombat);
  expect(value.inventory.count(value.player.id, "q1:ammo/shells")).toBe(19);
  const mine = value.source.pool.at(64); expect(mine.classname).toBe("prox mine");
  const foreign = value.actors.allocate("q1:game", "q1:enemy");
  if (beforeBody === null) throw new Error("Missing player body");
  value.bodies.create(foreign, beforeBody);
  const projected = value.source.records.byActor(foreign.id); if (projected === null) throw new Error("Missing borrowed enemy");
  expect(projected.slot).toBe(65); expect(value.source.pool.numEntities).toBe(66);
  value.actors.release(foreign); expect(projected.inuse).toBe(false);
  for (let time = 200; time <= 1800 && mine.s.pos.type !== 0; time += 100) value.advance(time);
  expect(mine.s.pos.type).toBe(0); expect(mine.nextthink).toBeGreaterThan(value.now());
  value.advance(mine.nextthink); expect(mine.health).toBe(1); expect(mine.takedamage).toBe(true);
  const armed = mine.nextthink, saved = capture(value), restored = fixture(data, saved);
  try {
    expect(restored.source.pool.at(mine.slot).nextthink).toBe(armed);
    expect(restored.bodies.read(restored.player.id)).toEqual(value.bodies.read(value.player.id));
    restored.advance(armed);
    expect(restored.source.pool.at(mine.slot).s.eType).toBe(EntityType.ET_GENERAL);
    expect(restored.source.pool.at(mine.slot).freeAfterEvent).toBe(true);
    expect(restored.events).not.toContain(EntityEvent.EV_PROXIMITY_MINE_STICK);
    expect(restored.events).toContain(EntityEvent.EV_MISSILE_MISS);
  } finally { restored.source.close(); value.source.close(); }
  expect(value.actors.isLive(value.player.id)).toBe(true); expect(value.inventory.count(value.player.id, "q1:ammo/shells")).toBe(19);
  expect(value.actors.ownedBy("q3:weapons/classic/missionpack")).toHaveLength(0);
});

test.skipIf(!existsSync(archivePath))("original holdable grant and selected use run once and preserve source portal and invulnerability state", async () => {
  const value = fixture(await map()), source = value.source, actor = value.player;
  const arsenal = new Q3SelectedArsenal({ provider: source.host.provider, product: "missionpack", inventory: value.inventory,
    fire: (actor, weapon, input) => source.fire(actor, weapon, input), useHoldable: (actor, event) => source.useHoldable(actor, event),
    equipment: { read: actor => source.equipment(actor), consume: (actor, item) => source.consume(actor, item) } });
  arsenal.admit(actor, 100); arsenal.step(input(value, arsenal), undefined);
  const player = source.records.nativeByActor(actor.id); if (player === null) throw new Error("Missing source player");
  const grant = (classname: string) => {
    const item = itemList("missionpack").find(item => item.className === classname); if (item === undefined) throw new Error("Missing original item");
    const pickup = source.pool.spawn(); pickup.item = item; pickup.s.modelindex = itemList("missionpack").indexOf(item);
    pickupHoldable(pickup, player); source.pool.free(pickup);
  };
  try {
    grant("holdable_medkit");
    const use = { provider: arsenal.provider, weapon: null, useHoldable: true };
    arsenal.step(input(value, arsenal), use); expect(value.combat.read(actor.id)?.health).toBe(125);
    expect(source.equipment(actor).holdableItem).toBe(0);
    value.combat.setHealth(actor, 70); arsenal.step(input(value, arsenal), use); expect(value.combat.read(actor.id)?.health).toBe(70);
    arsenal.step(input(value, arsenal), { ...use, useHoldable: false }); grant("holdable_invulnerability");
    arsenal.step(input(value, arsenal), use);
    expect(player.client?.invulnerabilityTime).toBe(value.now() + 10000);
    expect(value.changes.at(-1)?.after.invulnerabilityTime).toBe(value.now() + 10000);
    arsenal.step(input(value, arsenal), { ...use, useHoldable: false }); grant("holdable_portal");
    arsenal.step(input(value, arsenal), use);
    expect(player.client?.portalID).toBe(1); expect(source.equipment(actor).holdableItem).toBeGreaterThan(0);
    arsenal.step(input(value, arsenal), { ...use, useHoldable: false }); arsenal.step(input(value, arsenal), use);
    expect(player.client?.portalID).toBe(0); expect(source.equipment(actor).holdableItem).toBe(0);
    expect(source.pool.at(64).classname).toBe("hi_portal destination"); expect(source.pool.at(65).classname).toBe("hi_portal source");
    expect(player.client?.ps.stats.get(statSchema("missionpack").maxHealth)).toBe(100);
    arsenal.step(input(value, arsenal), { ...use, useHoldable: false }); grant("holdable_teleporter");
    const before = value.bodies.read(actor.id); arsenal.step(input(value, arsenal), use);
    expect(value.bodies.read(actor.id)?.bounds).toEqual(before?.bounds);
    expect(value.changes.at(-1)?.after.viewAngles).toEqual({ x: 0, y: 90, z: 0 });
    expect(value.changes.at(-1)?.after.pmTime).toBe(160);
    const changed = value.changes.length; source.synchronize(); source.equipment(actor); expect(value.changes).toHaveLength(changed);
    arsenal.step(input(value, arsenal), { ...use, useHoldable: false }); grant("holdable_kamikaze");
    arsenal.step(input(value, arsenal), use);
    expect(player.client?.invulnerabilityTime).toBe(0);
    const explosion = Array.from({ length: source.pool.numEntities }, (_, slot) => source.pool.at(slot)).find(entity => entity.classname === "kamikaze");
    if (explosion === undefined) throw new Error("Original kamikaze entity missing");
    value.advance(value.now() + 100); expect(explosion.count).toBe(100);
    expect(value.changes.at(-1)?.after.deltaAngles).not.toEqual(zero);
    source.respawn(actor.id); expect(source.equipment(actor).holdableItem).toBe(0); expect(player.client?.portalID).toBe(0);
  } finally { source.close(); }
});


test.skipIf(!existsSync(archivePath))("base Q3 selected source uses original medkit and teleporter leaves with its own saved item layout", async () => {
  const data = await map(), value = fixture(data, undefined, "baseq3");
  const source = value.source, actor = value.player;
  const arsenal = new Q3SelectedArsenal({ provider: source.host.provider, product: "baseq3", inventory: value.inventory,
    fire: (actor, weapon, input) => source.fire(actor, weapon, input), useHoldable: (actor, event) => source.useHoldable(actor, event),
    equipment: { read: actor => source.equipment(actor), consume: (actor, item) => source.consume(actor, item) } });
  arsenal.admit(actor, 100); arsenal.step(input(value, arsenal), undefined);
  try {
    expect(source.giveHoldable(actor, "holdable_invulnerability")).toBe(false);
    expect(source.giveHoldable(actor, "holdable_medkit")).toBe(true);
    arsenal.step(input(value, arsenal), { provider: arsenal.provider, weapon: null, useHoldable: true });
    expect(value.combat.read(actor.id)?.health).toBe(125);
    arsenal.step(input(value, arsenal), { provider: arsenal.provider, weapon: null, useHoldable: false });
    expect(source.giveHoldable(actor, "holdable_teleporter")).toBe(true);
    const restored = fixture(data, capture(value), "baseq3");
    try {
      expect(restored.source.equipment(restored.player).holdableTag).toBe(source.equipment(actor).holdableTag);
      restored.source.useHoldable(restored.player, EntityEvent.EV_USE_ITEM1);
      expect(restored.changes.at(-1)?.after.pmTime).toBe(160);
      expect(restored.changes.at(-1)?.after.viewAngles).toEqual({ x: 0, y: 90, z: 0 });
    } finally { restored.source.close(); }
  } finally { source.close(); }
});


test.skipIf(!existsSync(archivePath))("original persistent pickup keeps its item lifetime and grants source Guard, Scout and ammo timers", async () => {
  const value = fixture(await map()), source = value.source, actor = value.player;
  const arsenal = new Q3SelectedArsenal({ provider: source.host.provider, product: "missionpack", inventory: value.inventory,
    fire: (actor, weapon, input) => source.fire(actor, weapon, input), useHoldable: (actor, event) => source.useHoldable(actor, event),
    equipment: { read: actor => source.equipment(actor), consume: (actor, item) => source.consume(actor, item), endCommand: (actor, msec) => source.endCommand(actor, msec) } });
  arsenal.admit(actor, 100);
  const player = source.records.nativeByActor(actor.id); if (player?.client == null) throw new Error("Missing source player");
  const grant = (classname: string) => {
    const item = itemList("missionpack").find(item => item.className === classname); if (item === undefined) throw new Error("Missing original item");
    const pickup = source.pool.spawn(); pickup.item = item;
    const result = source.takePickup({ itemActor: pickup.actor.id, playerActor: actor.id, item, count: 0, generic1: 0, dropped: false, gameType: 0, weaponRespawnSeconds: 5, teamWeaponRespawnSeconds: 30 });
    if (result.kind !== "picked") throw new Error("Original persistent pickup refused");
    expect(result.respawnSeconds).toBe(-1);
    pickup.r.contents = 0; pickup.r.svFlags |= 1; pickup.s.eFlags |= 0x80;
    return pickup;
  };
  try {
    const guard = grant("item_guard");
    expect(value.combat.read(actor.id)?.health).toBe(200); expect(value.combat.read(actor.id)?.armor.regular).toMatchObject({ points: 200 });
    expect(source.equipment(actor).maxHealth).toBe(200); expect(player.client.persistantPowerup).toBe(guard);
    value.combat.setHealth(actor, 50); source.endCommand(actor, 1000);
    expect(value.combat.read(actor.id)?.health).toBe(65);
    source.died(actor.id); expect(guard.r.contents).toBe(0x40000000); expect(guard.r.svFlags & 1).toBe(0); expect(player.client.persistantPowerup).toBeNull();
    const scout = grant("item_scout");
    expect(value.combat.read(actor.id)?.armor.regular).toMatchObject({ points: 0 }); expect(source.speedMultiplier(actor.id)).toBe(1.5);
    expect(source.equipment(actor).persistentPowerupTag).toBe(Powerup.PW_SCOUT);
    source.respawn(actor.id); expect(scout.r.contents).toBe(0x40000000); expect(source.speedMultiplier(actor.id)).toBe(1);
    grant("item_ammoregen");
    value.inventory.configure(actor, { item: "q3:ammo/machinegun", count: 0, capacity: 200 });
    for (let step = 0; step < 10; step++) arsenal.step(input(value, arsenal), undefined);
    expect(value.inventory.count(actor.id, "q3:ammo/machinegun")).toBe(4);
    expect(arsenal.read(actor.id).ammo.find(entry => entry.item === "q3:ammo/machinegun")?.count).toBe(4);
  } finally { source.close(); }
});
