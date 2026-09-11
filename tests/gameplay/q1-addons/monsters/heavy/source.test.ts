import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../../../src/core/numeric.ts";
import { Q1MonsterMovement } from "../../../../../src/movement/q1/monsters.ts";
import { openArchive } from "../../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../../../src/content/q1/foundation/runtime.ts";
import type { Q1Actor } from "../../../../../src/content/q1/foundation/entity.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../../src/content/q1/foundation/types.ts";
import { PLAYER_BOUNDS, ZERO, vadd, vscale, length } from "../../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../../src/content/q1/base/index.ts";
import { Q1AddonContext } from "../../../../../src/content/q1/addons/context.ts";
import { registerMg3Heavy } from "../../../../../src/content/q1/addons/monsters/heavy/index.ts";
import { parseMdl } from "../../../../../src/formats/q12-model/mdl.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../../src/persistence/world-state.ts";
import type { BodyCheckpoint, CombatCheckpoint, InventoryCheckpoint } from "../../../../../src/contracts/session.ts";

interface SavedHeavy {
  readonly source: ReturnType<Q1Foundation["capture"]>;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly BodyCheckpoint[];
  readonly combat: readonly CombatCheckpoint[];
  readonly inventories: readonly InventoryCheckpoint[];
}

async function session(name: string, saved?: SavedHeavy) {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/mg3/pak0.pak");
  const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing retail ${name}`);
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); archive.close();
  const identity = createIdentityOwner("mg3-heavy"), actors = saved === undefined ? new SessionActorRegistry(identity) : SessionActorRegistry.restore(identity, saved.slots, saved.sources), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>();
  let active: Q1Foundation | null = null, randomValue = 0.4;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = active?.entity(body.actor); if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") return undefined;
    scene.link(body, { family: "q1", shape: { kind: "box" }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const movement = new Q1MonsterMovement({ scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random: { nextInteger: () => 1 }, read: actor => {
    const body = bodies.read(actor), entity = active?.entity(actor); if (body === null || entity === null || entity === undefined) return null;
    return { ...body, absoluteBounds: translatedBodyBounds(entity.actor, body), flags: entity.movementFlags, ground: body.ground === null ? { kind: "none" } : { kind: "actor", actor: body.ground }, idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, enemy: entity.monster?.enemy ?? null };
  }, write: (actor, state) => {
    const body = bodies.read(actor.id), entity = active?.entity(actor.id); if (body === null || entity === null || entity === undefined) throw new Error("Missing source movement actor");
    bodies.write(actor, { ...body, origin: state.origin, angles: state.angles, ground: state.ground.kind === "none" ? null : state.ground.kind === "actor" ? state.ground.actor : active?.world?.actor.id ?? null });
    entity.movementFlags = state.flags; entity.idealYaw = state.idealYaw; entity.yawSpeed = state.yawSpeed; return undefined;
  }, link: actor => bodies.link(actor) });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => randomValue, trace: request => {
    const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
    if (trace.kind !== "q1") throw new Error("Q1 trace expected");
    return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? active?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater };
  }, contents: () => "empty", walkMove: (actor, yaw, distance) => movement.walkMove(actor, yaw, distance), changeYaw: actor => movement.changeYaw(actor), moveToGoal: (actor, goal, distance) => movement.moveToGoal(actor, goal, distance), checkBottom: actor => movement.checkBottom(actor), pushMove: () => null,
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; }, emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => active?.entity(actor)?.classname ?? "player", powerup: () => undefined };
  function provider() {
    const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch: 0, coop: false, gravity: 800, campaign: "q1:mg3", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement" }); active = game;
    const base = registerQ1Base(game), context = new Q1AddonContext(base, "mg3", { emit: () => undefined, isMonster: actor => game.entity(actor)?.monster !== null && game.entity(actor) !== null, cvar: name => name === "skill" ? 1 : 0, setCvar: () => undefined });
    const monsters = registerMg3Heavy(context); return { game, monsters, base };
  }
  const initial = provider();
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => { if (active === null) throw new Error("Missing source provider"); return active.combatContext(request); }, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  let player: OwnedActor;
  if (saved === undefined) {
    for (const source of map.entityList) { const classname = q1EntityValue(source, "classname") ?? ""; if (classname === "worldspawn" || initial.monsters.definitions.has(classname) || classname === "path_corner") initial.game.spawnEntity(initial.game.create(classname, source)); }
    player = actors.allocateAtSource("q3:character", 1, "q3:sarge"); bodies.create(player, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(player, { health: 1000, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); initial.game.attachPlayer(player);
  } else {
    const actor = actors.atSource("q3:character", 1); if (actor === null) throw new Error("Missing saved foreign player"); player = actor;
    const owner = (id: BodyCheckpoint["actor"]): OwnedActor => { const actor = actors.resolveSaved(id); if (actor === null) throw new Error("Missing saved actor"); return actor; };
    for (const entry of saved.bodies) bodies.create(owner(entry.actor), { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    for (const entry of saved.combat) combat.create(owner(entry.actor), entry.state);
    for (const entry of saved.inventories) inventory.create(owner(entry.actor), entry.entries);
    initial.game.restore(saved.source); restoreSharedBodyLinks(saved, { actors, bodies });
  }
  players.push(player.id);
  function tick(entity: Q1Actor) { const callback = entity.think; if (callback === null || active === null) throw new Error("Missing scheduled source callback"); active.time = entity.nextThink; entity.think = null; entity.nextThink = -1; pending.delete(entity.actor); callback(); }
  function capture(): SavedHeavy { return { source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(initial.game.capture())), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(), bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []) }; }
  return { ...initial, player, actors, events, tick, capture, random: (value: number) => { randomValue = value; } };
}

test("MG3 retail heavy models cover all 401 source frame callbacks", async () => {
  const current = await session("map2"), archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/mg3/pak0.pak");
  try {
    let frames = 0;
    for (const definition of current.monsters.definitions.values()) {
      const entry = archive.findEntries(`progs/${definition.spec.model}.mdl`)[0]; if (entry === undefined) throw new Error(`Missing retail ${definition.spec.model}`);
      const model = parseMdl(await archive.readEntry(entry), entry.path); frames += definition.frames.size;
      expect([...definition.frames.values()].every(frame => frame.frame < model.frames.length && (definition.frames.has(frame.next) || frame.next in definition.actions) && frame.operations.every(op => op.kind !== "action" || op.name in definition.actions))).toBe(true);
    }
    expect(frames).toBe(401); expect(current.monsters.monsters.size).toBe(2);
    const source = current.game.create("monster_ranged_knight"); source.spawnflags = 262144; current.game.spawnEntity(source); expect(current.game.live(source)).toBe(false); expect(current.game.totalMonsters).toBe(2);
    expect(() => current.capture()).not.toThrow();
  } finally { archive.close(); current.actors.close(); }
});

test("Super Shambler keeps source blast counts and guarded lightning children", async () => {
  const current = await session("map8"), { game, player, monsters } = current;
  const monster = [...monsters.monsters.values()].find(monster => monster.entity.classname === "monster_super_shambler"); if (monster === undefined) throw new Error("Missing retail Super Shambler");
  monster.start(); monster.enemy = player.id; const body = game.host.bodies.read(player.id); if (body === null) throw new Error("Missing target body");
  game.host.bodies.write(player, { ...body, origin: vadd(monster.origin, { x: 500, y: 0, z: 0 }) });
  monster.play("supsham_smash10"); expect([...game.entities.values()].filter(entity => entity.classname === "knightspike")).toHaveLength(11);
  monster.play("supsham_swingl7"); expect([...game.entities.values()].filter(entity => entity.classname === "knightspike")).toHaveLength(20);
  monster.play("supsham_magic3"); const child = game.entity(monster.entity.references.get("child") ?? null); if (child === null) throw new Error("Missing lightning child");
  expect(child.owner).toBe(monster.entity.actor.id); current.tick(monster.entity); expect(child.frame).toBe(1);
  const restored = await session("map8", current.capture()), owner = restored.actors.resolveSaved(monster.entity.actor.id), entity = owner === null ? null : restored.game.entity(owner.id); if (entity === null) throw new Error("Missing restored Super Shambler");
  const restoredChild = restored.game.entity(entity.references.get("child") ?? null); if (restoredChild === null) throw new Error("Missing restored lightning child");
  restored.tick(entity); expect(restoredChild.frame).toBe(2);
  const controller = restored.monsters.require(entity); controller.play("supsham_magic6"); restored.tick(entity); restored.tick(entity);
  expect(entity.number("frags")).toBe(3); expect(restored.events.filter(event => event.kind === "beam" && event.style === "lightning1")).toHaveLength(3); expect(restored.game.live(restoredChild)).toBe(false);
  controller.play("supsham_magic_b3"); const fast = restored.game.entity(entity.references.get("child") ?? null); if (fast === null) throw new Error("Missing fast lightning child"); restored.tick(entity);
  expect(fast.owner).toBe(null); expect(fast.classname).toBe(""); expect(fast.frame).toBe(0);
  current.actors.close(); restored.actors.close();
});

test("Rune Knight resumes its saved burst counter and Lava Man retains MG3 awakening", async () => {
  const current = await session("map2"), monster = [...current.monsters.monsters.values()].find(value => value.entity.classname === "monster_ranged_knight"); if (monster === undefined) throw new Error("Missing retail Rune Knight");
  monster.start(); monster.enemy = current.player.id; monster.play("rknight_magicb6"); for (let frame = 0; frame < 6; frame++) current.tick(monster.entity);
  expect(monster.currentFrame).toBe("rknight_magicb12"); expect(monster.entity.number("ammo_nails")).toBe(2); current.base.campaign.writeFlags(64);
  const restored = await session("map2", current.capture()), owner = restored.actors.resolveSaved(monster.entity.actor.id), entity = owner === null ? null : restored.game.entity(owner.id); if (entity === null) throw new Error("Missing saved Rune Knight");
  restored.tick(entity); restored.tick(entity); expect(entity.number("ammo_nails")).toBe(0); expect(restored.monsters.require(entity).nextFrame).toBe("rknight_magicb13");
  const shots = [...restored.game.entities.values()].filter(entity => entity.classname === "knightspike"), last = shots[shots.length - 1]; if (last === undefined) throw new Error("Missing saved burst shots");
  expect(shots).toHaveLength(8); expect(length(restored.game.body(last).velocity)).toBeCloseTo(600, 3); current.actors.close(); restored.actors.close();
  const lava = await session("map2b"), source = [...lava.monsters.monsters.values()].find(value => value.entity.classname === "monster_lava_man"); if (source === undefined) throw new Error("Missing retail Lava Man");
  const origin = source.origin; source.entity.use?.(null, lava.player.id); expect(source.origin).toEqual(origin); expect(source.entity.movement).toBe("fly"); expect(lava.game.health(source.entity.actor.id)).toBe(1500);
  lava.random(0.9); source.pain(lava.player.id, 1); expect(source.entity.count).toBe(1); expect(source.currentFrame).toBe("lavaman_shocka1");
  source.enemy = lava.player.id; source.play("lavaman_fire7"); const ball = [...lava.game.entities.values()].find(entity => entity.classname === "lavaman_ball"); if (ball === undefined) throw new Error("Missing Lava Man missile");
  const up = lava.game.basis.up; expect(lava.game.body(ball).origin.z - origin.z).toBeCloseTo(vscale(up, 90).z, 3); expect(ball.movement).toBe("bounce");
  const world = lava.game.world; if (world === null) throw new Error("Missing source world");
  ball.touch?.(world.actor.id, null); expect(ball.model).toBe("progs/s_explod.spr"); expect(ball.frame).toBe(0); expect(ball.movement).toBe("none");
  expect(lava.events.filter(event => event.kind === "effect" && event.effect === "explosion")).toHaveLength(1);
  for (let frame = 1; frame <= 5; frame++) lava.tick(ball);
  expect(ball.frame).toBe(5); expect(lava.game.live(ball)).toBe(true); lava.tick(ball); expect(lava.game.live(ball)).toBe(false);
  source.entity.use?.(null, lava.player.id); expect(lava.game.killedMonsters).toBe(1); expect(source.currentFrame).toBe("lavaman_death1"); expect(() => lava.capture()).not.toThrow(); lava.actors.close();
});
