import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/index.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../src/content/q1/foundation/index.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../src/content/q1/base/index.ts";
import { registerMissionPackArsenal } from "../../../../src/content/q1/missionpacks/index.ts";
import { registerMissionPackMonsters } from "../../../../src/content/q1/missionpacks/monsters/index.ts";
import { gremlinSteal } from "../../../../src/content/q1/missionpacks/monsters/gremlin-weapons.ts";
import type { Q1MissionPack } from "../../../../src/content/q1/missionpacks/index.ts";

const assetRoot = "/home/buzzkill/Projects/qfiles/q1";
async function session(pack: Q1MissionPack, name: string, edition: "classic" | "rerelease" = "rerelease") {
  const archive = await openArchive(`${assetRoot}/${edition === "rerelease" ? "rerelease/" : ""}${pack}/pak0.pak`);
  const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error("Retail start.bsp missing");
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); archive.close();
  const actors = new SessionActorRegistry(createIdentityOwner(`missionpack-${pack}`)), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>(), gravity = new Map<ActorId, number>();
  let active: Q1Foundation | null = null, randomValue = 0.4;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = active?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => randomValue, trace: request => {
    const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
    if (trace.kind !== "q1") throw new Error("Q1 trace expected");
    return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? active?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater };
  }, contents: point => {
    const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
    if (result.kind !== "q1") throw new Error("Q1 contents expected"); return result.contents === -2 ? "solid" : result.contents === -3 ? "water" : result.contents === -4 ? "slime" : result.contents === -5 ? "lava" : result.contents === -6 ? "sky" : "empty";
  }, walkMove: () => false, moveToGoal: () => undefined, changeYaw: () => undefined, checkBottom: () => false, pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; }, emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => active?.entity(actor)?.classname ?? "player", powerup: () => undefined, setGravity: (actor, scale) => { gravity.set(actor, scale); return undefined; } };
  const game = new Q1Foundation(host, { edition, skill: 1, deathmatch: 0, teamplay: 0, coop: false, maxClients: 2, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" }); active = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const base = registerQ1Base(game); const arsenal = registerMissionPackArsenal(game, pack), monsters = registerMissionPackMonsters(game, base, pack);
  for (const source of map.entityList) { const classname = q1EntityValue(source, "classname") ?? ""; if (classname === "worldspawn" || classname.startsWith("monster_") || classname === "path_corner" || classname === "info_player_start") game.spawnEntity(game.create(classname, source)); }
  const start = [...game.entities.values()].find(entity => entity.classname === "info_player_start"), origin = start === undefined ? ZERO : game.body(start).origin;
  function player(slot: number) {
    const owner = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(owner, { origin: vadd(origin, { x: 64 * (slot - 1), y: 0, z: 0 }), angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    const state = game.attachPlayer(owner); players.push(owner.id); return state;
  }
  return { game, arsenal, monsters, actors, callbacks, combat, bodies, inventory, events, pending, gravity, random: (value: number) => { randomValue = value; }, player: player(1), target: player(2) };
}

test.skipIf(!existsSync(`${assetRoot}/hipnotic/pak0.pak`))("retail Hipnotic and Rogue monsters admit exact frames and saved continuations", async () => {
  for (const edition of ["classic", "rerelease"]) {
    if (edition !== "classic" && edition !== "rerelease") throw new Error("Unknown edition");
    for (const entry of [{ pack: "hipnotic", map: "hip2m1", species: "gremlin", count: 6 }, { pack: "rogue", map: "r2m1", species: "eel", count: 13 }]) {
      if (entry.pack !== "hipnotic" && entry.pack !== "rogue") throw new Error("Unknown pack");
      const current = await session(entry.pack, entry.map, edition);
      const monsters = [...current.monsters.monsters.values()];
      expect(monsters.filter(monster => monster.spec.species === entry.species)).toHaveLength(entry.count);
      expect(monsters.every(monster => [...monster.definition.frames.values()].every(frame =>
        (monster.definition.frames.has(frame.next) || frame.next in monster.definition.actions) && frame.operations.every(operation => operation.kind !== "action" || operation.name in monster.definition.actions)))).toBe(true);
      expect(() => current.game.capture()).not.toThrow(); current.actors.close();
    }
  }
});

test.skipIf(!existsSync(`${assetRoot}/hipnotic/pak0.pak`))("Gremlin steals the shared weapon, spends signed burst ammo and clones pending source state", async () => {
  const current = await session("hipnotic", "hip2m1"), { game, monsters, inventory, player, target } = current;
  const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === "gremlin"); if (monster === undefined) throw new Error("Missing retail Gremlin");
  const body = game.body(monster.entity); game.host.bodies.write(player.actor, { ...game.host.bodies.read(player.actor.id) ?? body, origin: vadd(body.origin, { x: 40, y: 0, z: 0 }) });
  inventory.configure(player.actor, { item: game.weaponItem("nailgun"), count: 1, capacity: 1 }); inventory.configure(player.actor, { item: "q1:ammo/nails", count: 1, capacity: 200 }); game.selectWeapon(player.actor, "nailgun");
  monster.enemy = player.actor.id; current.random(0.7); expect(gremlinSteal(monster)).toBe(true); expect(inventory.count(player.actor.id, game.weaponItem("nailgun"))).toBe(0); expect(inventory.count(monster.entity.actor.id, "q1:ammo/nails")).toBe(1);
  monster.enemy = target.actor.id; monster.play("gremlin_nail3");
  for (let i = 0; i < 3; i++) monster.play(monster.nextFrame);
  expect(inventory.count(monster.entity.actor.id, "q1:ammo/nails")).toBe(-3); expect(monster.entity.number("currentammo")).toBe(-3);
  const clone = game.cloneEntity(monster.entity); expect(monsters.require(clone).capture()).toEqual(monster.capture()); expect(inventory.count(clone.actor.id, "q1:ammo/nails")).toBe(-3);
  expect(() => game.capture()).not.toThrow(); current.actors.close();
});

test.skipIf(!existsSync(`${assetRoot}/hipnotic/pak0.pak`))("Horn charm keeps retail soldier and dog callbacks on the shared controller", async () => {
  const { game, monsters, player, actors } = await session("hipnotic", "hip1m1");
  for (const species of ["army", "dog"]) {
    const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === species); if (monster === undefined) throw new Error(`Missing retail ${species}`);
    const before = monster.capture(); monsters.charm(monster.entity, player.actor.id); expect(monster.capture()).toEqual(before); expect(monster.entity.references.get("charmer")).toBe(player.actor.id);
    monster.found(player.actor.id); expect(monster.enemy).toBe(null);
    const body = game.host.bodies.read(player.actor.id); if (body === null) throw new Error("Missing charmer body");
    game.host.bodies.write(player.actor, { ...body, origin: vadd(monster.origin, { x: 300, y: 0, z: 0 }) });
    monster.ai("walk", 2); expect(monster.entity.number("huntingcharmer")).toBe(2); expect(monster.nextFrame).toBe(monster.spec.walk);
    expect(monster.entity.references.get("goalentity")).toBe(monster.entity.references.get("trigger_field"));
  }
  expect(() => game.capture()).not.toThrow(); actors.close();
});

test.skipIf(!existsSync(`${assetRoot}/hipnotic/pak0.pak`))("Hipnotic path corners keep authored waits on the monster controller", async () => {
  const { game, monsters, actors } = await session("hipnotic", "hip1m1");
  const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === "army"); if (monster === undefined) throw new Error("Missing retail soldier");
  const first = game.create("path_corner"), second = game.create("path_corner"); first.targetname = "test_first"; first.target = "test_second"; first.delay = 7; second.targetname = "test_second";
  game.spawnEntity(first); game.spawnEntity(second); monster.state.path = first.targetname; monster.enemy = null;
  first.touch?.(monster.entity.actor.id, null);
  expect(monster.state.path).toBe(second.targetname); expect(monster.state.pauseUntil).toBe(game.time + 7); expect(monster.entity.references.get("goalentity")).toBe(second.actor.id);
  expect(() => game.capture()).not.toThrow(); actors.close();
});
