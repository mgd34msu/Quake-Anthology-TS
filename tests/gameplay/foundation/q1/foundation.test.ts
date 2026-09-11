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
import { Q1_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { Q1Foundation, Q1_PROVIDER, PLAYER_BOUNDS, weaponItem } from "../../../../src/content/q1/foundation/index.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../src/content/q1/foundation/index.ts";
import { ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";

const path = resolve(import.meta.dir, "../../../../../qfiles/q1/rerelease/id1/pak0.pak");
async function loadMap(): Promise<Q1Map> {
  const archive = await openArchive(path);
  try { const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1"); return readQ1Bsp(await archive.readEntry(entry), { source: "maps/e1m1.bsp" }); }
  finally { archive.close(); }
}
function gameFor(map: Q1Map) {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-foundation")), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
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
    walkMove: () => false, moveToGoal: () => undefined, checkBottom: () => false,
    pushMove: (actor, displacement) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing mover body"); bodies.write(actor, { ...body, origin: vadd(body.origin, displacement) }); bodies.link(actor); return null; },
    scheduleThink: (actor, time) => { pending.set(actor, time); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => game?.entity(actor)?.classname ?? "player",
    powerup: (actor, powerup, expires) => { if (powerup === "invulnerability") combat.setTraits(actor, { invulnerable: expires > 0 }); return undefined; },
  };
  const runtime = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch: 0, coop: false, gravity: 800, maxClients: 4,
    campaign: "q1:id1", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement" });
  game = runtime;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => runtime.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const report = runtime.spawnMap(map);
  const player = actors.allocateAtSource(Q1_PROVIDER, 1, "q2:male-character");
  const start = [...runtime.entities.values()].find(entity => entity.classname === "info_player_start"); if (start === undefined) throw new Error("Missing start");
  bodies.create(player, { origin: runtime.body(start).origin, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(player, []); runtime.attachPlayer(player); players.push(player.id);
  const due = (until: number): void => {
    for (;;) {
      const entry = [...pending].filter(([_actor, time]) => time <= until).sort((a, b) => a[1] - b[1])[0]; if (entry === undefined) break;
      pending.delete(entry[0]); callbacks.think(entry[0], { frame: 0, time: { kind: "seconds", value: entry[1] }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
    runtime.time = until;
  };
  return { runtime, report, player, actors, callbacks, bodies, combat, inventory, events, due };
}

test.skipIf(!existsSync(path))("real e1m1 entities spawn with source inhibition and a foreign character", async () => {
  const map = await loadMap(), { runtime, report, player, actors, due } = gameFor(map);
  expect(map.entityList).toHaveLength(428);
  expect(new Set(map.entityList.map(entity => entity.properties.find(property => property.key === "classname")?.value)).size).toBe(41);
  expect(runtime.totalSecrets).toBe(6);
  expect(runtime.totalMonsters).toBe(23);
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
