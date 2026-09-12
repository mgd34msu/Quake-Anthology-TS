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
import { registerMissionPackArsenal } from "../../../../../src/content/q1/missionpacks/index.ts";
import { registerMissionPackMonsters } from "../../../../../src/content/q1/missionpacks/monsters/index.ts";
import { registerHipnoticMisc } from "../../../../../src/content/q1/missionpacks/world/hipnotic-misc.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../../src/persistence/world-state.ts";
import type { BodyCheckpoint, CombatCheckpoint, InventoryCheckpoint } from "../../../../../src/contracts/session.ts";

interface SavedBoss {
  readonly source: ReturnType<Q1Foundation["capture"]>;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly BodyCheckpoint[];
  readonly combat: readonly CombatCheckpoint[];
  readonly inventories: readonly InventoryCheckpoint[];
}

async function session(pack: "hipnotic" | "rogue", edition: "classic" | "rerelease", saved?: SavedBoss) {
  const name = pack === "hipnotic" ? "hipend" : "r2m8";
  const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q1/${edition === "rerelease" ? "rerelease/" : ""}${pack}/pak0.pak`);
  const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing retail ${name}`);
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); archive.close();
  const identity = createIdentityOwner(`boss-${pack}-${edition}`), actors = saved === undefined ? new SessionActorRegistry(identity) : SessionActorRegistry.restore(identity, saved.slots, saved.sources), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>();
  let active: Q1Foundation | null = null, randomValue = 0.4;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = active?.entity(body.actor); if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") return undefined;
    scene.link(body, { family: "q1", shape: { kind: "box" }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const movement = new Q1MonsterMovement({ scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random: { nextInteger: () => 1 }, readTarget: actor => {
    const owner = actors.resolveOwned(actor), body = bodies.read(actor);
    return owner === null || body === null ? null : { origin: body.origin, absoluteBounds: translatedBodyBounds(owner, body) };
  }, read: actor => {
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
  }, contents: () => "empty", walkMove: (actor, yaw, distance) => movement.walkMove(actor, yaw, distance), changeYaw: actor => movement.changeYaw(actor), moveToGoal: (actor, goal, distance, mode) => movement.moveToGoal(actor, goal, distance, mode), checkBottom: actor => movement.checkBottom(actor), pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; }, emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => active?.entity(actor)?.classname ?? "player", powerup: () => undefined };
  function provider() {
    const game = new Q1Foundation(host, { edition, skill: 1, deathmatch: 0, coop: false, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement" }); active = game;
    const base = registerQ1Base(game); registerMissionPackArsenal(game, pack); const monsters = registerMissionPackMonsters(game, base, pack);
    if (pack === "hipnotic") registerHipnoticMisc(game); return { game, monsters };
  }
  const initial = provider();
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => { if (active === null) throw new Error("Missing source provider"); return active.combatContext(request); }, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  let player: OwnedActor;
  if (saved === undefined) {
    for (const source of map.entityList) { const classname = q1EntityValue(source, "classname") ?? ""; if (classname === "worldspawn" || classname.startsWith("monster_") || classname === "dragon_corner" || classname === "path_corner") initial.game.spawnEntity(initial.game.create(classname, source)); }
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
  function capture(): SavedBoss { return { source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(initial.game.capture())), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(), bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []) }; }
  return { ...initial, player, actors, events, tick, capture, random: (value: number) => { randomValue = value; } };
}

test("retail Armagon preserves split body, rocket bursts, pain cooldown and staged saved death", async () => {
  for (const edition of ["classic", "rerelease"]) {
    if (edition !== "classic" && edition !== "rerelease") throw new Error("Invalid edition");
    const current = await session("hipnotic", edition), { game, player, events } = current;
    const monster = [...current.monsters.monsters.values()].find(value => value.spec.species === "armagon"); if (monster === undefined) throw new Error("Retail hipend lacks Armagon");
    const body = game.entity(monster.entity.references.get("trigger_field") ?? null); if (body === null) throw new Error("Missing Armagon torso");
    expect(game.health(monster.entity.actor.id)).toBe(2500); expect(body.movement).toBe(edition === "classic" ? "step" : "none");
    current.tick(monster.entity); monster.enemy = player.id; const direction = game.makeVectors(game.body(monster.entity).angles).forward;
    const playerBody = game.host.bodies.read(player.id); if (playerBody === null) throw new Error("Missing player body"); game.host.bodies.write(player, { ...playerBody, origin: vadd(monster.origin, vscale(direction, 300)) });
    const before = [...game.entities.values()].filter(entity => entity.classname === "missile").length;
    monster.play("armagon_satk1"); for (let frame = 1; frame < 16; frame++) current.tick(monster.entity);
    expect([...game.entities.values()].filter(entity => entity.classname === "missile")).toHaveLength(before + 6); expect(body.frame).toBe(monster.entity.frame);
    monster.pain(player.id, 24); expect(events.filter(event => event.kind === "sound" && event.path === "armagon/pain.wav")).toHaveLength(0);
    monster.pain(player.id, 25); monster.pain(player.id, 100); expect(events.filter(event => event.kind === "sound" && event.path === "armagon/pain.wav")).toHaveLength(1);
    game.host.combat.setHealth(monster.entity.actor, -1); monster.die(player.id); while (monster.currentFrame !== "armagon_die14") current.tick(monster.entity);
    expect(monster.entity.think).toBe(null); expect(monster.entity.movement).toBe("none"); expect(game.killedMonsters).toBe(1);
    for (let frame = 0; frame < 7; frame++) current.tick(body); expect(body.number("cnt")).toBe(7);
    const restored = await session("hipnotic", edition, current.capture()), restoredActor = restored.actors.resolveSaved(body.actor.id), restoredBody = restoredActor === null ? null : restored.game.entity(restoredActor.id); if (restoredBody === null) throw new Error("Missing saved torso");
    expect(restoredBody.number("cnt")).toBe(7); expect(restoredBody.references.get("trigger_field")?.slot).toBe(monster.entity.actor.id.slot);
    while (restoredBody.model !== "progs/s_explod.spr") restored.tick(restoredBody); expect(restoredBody.frame).toBe(0);
    current.actors.close(); restored.actors.close();
  }
});

test("retail Dragon keeps attack and pain phases, then resumes its saved falling death", async () => {
  const current = await session("rogue", "rerelease"), { game, player } = current;
  const monster = [...current.monsters.monsters.values()].find(value => value.spec.species === "dragon"); if (monster === undefined) throw new Error("Retail r2m8 lacks Dragon");
  current.tick(monster.entity); expect(monster.entity.yawSpeed).toBe(10); expect(game.health(monster.entity.actor.id)).toBe(4000);
  monster.entity.use?.(null, player.id); monster.enemy = player.id; monster.entity.fields.set("dragonAttacking", "1");
  const playerBody = game.host.bodies.read(player.id); if (playerBody === null) throw new Error("Missing player body"); game.host.bodies.write(player, { ...playerBody, origin: vadd(monster.origin, { x: 500, y: 0, z: 0 }) });
  monster.play("dragon_atk_a2"); const shot = [...game.entities.values()].find(entity => entity.classname === "fireball"); if (shot === undefined) throw new Error("Dragon did not fire source fireball");
  expect(length(game.body(shot).velocity)).toBeGreaterThan(900); expect(shot.angularVelocity.z).toBe(300); shot.touch?.(monster.entity.actor.id, null); expect(game.live(shot)).toBe(true);
  current.random(0.1); monster.entity.fields.set("dragonPainSequence", "2"); monster.pain(player.id, 10); expect(monster.nextFrame).toBe("dragon_painF1");
  game.host.combat.setHealth(monster.entity.actor, -1); monster.die(player.id); expect(game.body(monster.entity).ground).toBe(null); expect(monster.entity.number("dragonDeathState")).toBe(1);
  current.tick(monster.entity); const velocity = game.body(monster.entity).velocity; expect(length(monster.entity.vector("dragonLastVelocity"))).toBeGreaterThan(100);
  const restored = await session("rogue", "rerelease", current.capture()), restoredActor = restored.actors.resolveSaved(monster.entity.actor.id), actor = restoredActor === null ? null : restored.game.entity(restoredActor.id); if (actor === null) throw new Error("Missing restored Dragon");
  expect(restored.monsters.require(actor).nextFrame).toBe(monster.nextFrame); expect(restored.game.body(actor).velocity).toEqual(velocity);
  const world = restored.game.world; if (world === null) throw new Error("Missing world"); actor.touch?.(world.actor.id, null); expect(actor.number("dragonDeathState")).toBe(3);
  restored.tick(actor); expect(restored.game.live(actor)).toBe(false); expect(restored.game.killedMonsters).toBe(1); current.actors.close(); restored.actors.close();
});
