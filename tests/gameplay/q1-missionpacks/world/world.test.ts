import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/index.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../src/content/q1/foundation/index.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../src/content/q1/base/index.ts";
import { registerQ1MissionPack } from "../../../../src/content/q1/missionpacks/index.ts";
import type { Q1MissionPack } from "../../../../src/content/q1/missionpacks/index.ts";

const root = "/home/buzzkill/Projects/qfiles/q1/rerelease";
async function session(pack: Q1MissionPack, edition: "classic" | "rerelease" = "rerelease", deathmatch = 0, teamplay = 0, mapName = pack === "hipnotic" ? "hip1m1" : "r2m8") {
  const archive = await openArchive(`${root}/${pack}/pak0.pak`);
  const entry = archive.findEntries(`maps/${mapName}.bsp`)[0]; if (entry === undefined) throw new Error("Retail start.bsp missing");
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${mapName}.bsp` }); archive.close();
  const actors = new SessionActorRegistry(createIdentityOwner(`missionpack-${pack}`)), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>(), gravity = new Map<ActorId, number>();
  let active: Q1Foundation | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = active?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4, trace: request => {
    const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
    if (trace.kind !== "q1") throw new Error("Q1 trace expected");
    return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? active?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater };
  }, contents: point => {
    const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
    if (result.kind !== "q1") throw new Error("Q1 contents expected"); return result.contents === -2 ? "solid" : result.contents === -3 ? "water" : result.contents === -4 ? "slime" : result.contents === -5 ? "lava" : result.contents === -6 ? "sky" : "empty";
  }, walkMove: () => false, moveToGoal: () => undefined, changeYaw: () => undefined, checkBottom: () => false, pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; }, emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => active?.entity(actor)?.classname ?? "player", powerup: () => undefined, setGravity: (actor, scale) => { gravity.set(actor, scale); return undefined; } };
  const game = new Q1Foundation(host, { edition, skill: 1, deathmatch, teamplay, coop: false, maxClients: 2, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" }); active = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const base = registerQ1Base(game);
  const colors = new Map<ActorId, number>(), scores = new Map<ActorId, number>();
  const runtime = registerQ1MissionPack(game, base, pack, { gamecfg: () => 8, teamColor: actor => colors.get(actor) ?? 5, setTeamColor: (actor, team) => { colors.set(actor, team); return undefined; }, addFrags: (actor, delta) => { scores.set(actor, (scores.get(actor) ?? 0) + delta); return undefined; }, frags: actor => scores.get(actor) ?? 0, playerName: actor => `player${actor.slot}`, playerFrame: () => 0, disconnect: () => undefined, presentFinale: () => undefined });
  game.spawnMap(map);
  const start = [...game.entities.values()].find(entity => entity.classname === "info_player_start"), origin = start === undefined ? ZERO : game.body(start).origin;
  function player(slot: number) {
    const owner = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(owner, { origin: vadd(origin, { x: 64 * (slot - 1), y: 0, z: 0 }), angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    const state = game.attachPlayer(owner); players.push(owner.id); return state;
  }
  function think(entity: import("../../../../src/content/q1/foundation/entity.ts").Q1Actor, time = entity.nextThink) { pending.delete(entity.actor); callbacks.think(entity.actor, { frame: Math.floor(time * 10), time: { kind: "seconds", value: time }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); }
  return { game, runtime, base, actors, callbacks, combat, bodies, inventory, events, pending, gravity, colors, scores, think, player: player(1), target: player(2) };
}

test.skipIf(!existsSync(`${root}/hipnotic/pak0.pak`))("Hipnotic retail world registration, source counter and rotating mover save", async () => {
  const { game, runtime, actors, player, callbacks, think } = await session("hipnotic");
  expect([...game.entities.values()].some(entity => entity.classname === "worldspawn")).toBe(true);
  const counter = game.create("func_counter"); counter.count = 2; counter.targetname = "smoke_counter"; game.spawnEntity(counter);
  callbacks.use(counter.actor, player.actor.id, player.actor.id);
  expect(counter.number("counter_state")).toBe(1);
  const rotating = game.create("func_rotate_entity"); rotating.fields.set("rotate", "0 90 0"); game.spawnEntity(rotating);
  think(rotating); callbacks.use(rotating.actor, player.actor.id, player.actor.id); think(rotating);
  expect(game.body(rotating).angles.y).toBeCloseTo(1.8, 5);
  const checkpoint = game.capture(); expect(checkpoint.entities.find(saved => saved.actor.slot === counter.actor.id.slot)?.callbacks.think).toBe("hip:counter_tick");
  expect(checkpoint.entities.find(saved => saved.actor.slot === rotating.actor.id.slot)?.callbacks.think).toBe("hip:rotate_entity");
  think(counter); expect(game.entity(counter.actor.id)).toBeNull();
  expect(runtime.world.pack).toBe("hipnotic"); actors.close();
});

test.skipIf(!existsSync(`${root}/rogue/pak0.pak`))("Rogue retail ending world, token source scoring and machine crash callbacks", async () => {
  const { game, runtime, actors, player, target, callbacks, think } = await session("rogue", "rerelease", 0, 3);
  const machine = [...game.entities.values()].find(entity => entity.classname === "item_time_machine"); if (machine === undefined) throw new Error("Retail r2m8 time machine missing");
  expect(game.health(machine.actor.id)).toBe(1600);
  let token = [...game.entities.values()].find(entity => entity.classname === "dmatch_tag_token"); if (token === undefined) { token = game.create("dmatch_tag_token"); game.spawnEntity(token); }
  callbacks.touch({ self: token.actor, other: player.actor.id, plane: null, surface: null });
  expect(runtime.world.tagScore(target.actor.id, player.actor.id)).toBe(3);
  expect(runtime.world.tagScore(player.actor.id, target.actor.id)).toBe(5);
  expect(token.owner?.equals(target.actor.id)).toBe(true);
  runtime.world.crashTimeMachine(); expect(machine.movement).toBe("fly"); expect(machine.solid).toBe("none");
  think(machine); expect(game.body(machine).velocity.z).toBe(-55);
  expect(game.capture()).toBeDefined(); actors.close();
});
