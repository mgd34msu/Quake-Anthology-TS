import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { ClockProfile, FrameContext } from "../../../../src/contracts/time.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { FrameScheduler } from "../../../../src/world/scheduler.ts";
import { SharedSceneQueries } from "../../../../src/world/collision/index.ts";
import type { ActorCollision } from "../../../../src/world/collision/index.ts";
import { Q3EntityRecords } from "../../../../src/content/q3/base/records.ts";
import { EntityPool, initGameEntity, setOrigin } from "../../../../src/content/q3/base/game/entities.ts";
import { Q3CombatBridge } from "../../../../src/content/q3/base/combat-bridge.ts";
import { Q3WorldAdapter } from "../../../../src/content/q3/base/world-adapter.ts";
import { damage, DamageFlags } from "../../../../src/content/q3/base/game/combat.ts";
import { logAccuracyHit } from "../../../../src/content/q3/base/game/weapon.ts";
import { MissileRuntime } from "../../../../src/content/q3/base/game/missile.ts";
import { GameType, Powerup, Team, statSchema } from "../../../../src/content/q3/base/shared/definitions.ts";
import { parseQ3Bsp, adaptQ3Bsp } from "../../../../src/formats/q3-map/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";

const archivePath = resolve(process.env["Q3_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../../qfiles/q3a"), "baseq3/pak0.pk3");

test.skipIf(!existsSync(archivePath))("Q3 combat and grenade expiry use shared authorities on retail map geometry", async () => {
  const archive = await openArchive(archivePath, "pk3");
  const entry = archive.findEntries("maps/q3dm1.bsp")[0];
  if (entry === undefined) throw new Error("Retail q3dm1 is missing");
  const bytes = await archive.readEntry(entry); archive.close();
  const queries = new SharedSceneQueries(adaptQ3Bsp(parseQ3Bsp(bytes)));
  const actors = new SessionActorRegistry(createIdentityOwner("q3-gameplay-smoke"));
  const callbacks = new ActorCallbackTable(actors), collisions = new Map<ActorId, ActorCollision>();
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
    onLink: body => { const shape = collisions.get(body.actor); if (shape !== undefined) queries.link(body, shape); return undefined; },
    onUnlink: actor => { queries.unlink(actor); return undefined; } });
  let bridge: Q3CombatBridge | null = null;
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing damage body");
      bodies.write(actor, { ...body, velocity: { x: Math.fround(body.velocity.x + impulse.x), y: Math.fround(body.velocity.y + impulse.y), z: Math.fround(body.velocity.z + impulse.z) } }); return undefined; },
    beforeReaction: (_actor, decision) => { if (bridge === null) throw new Error("Combat bridge is not initialized"); bridge.beforeReaction(decision); return undefined; },
    confirmed: () => undefined,
  });
  const inventory = new SharedInventoryTable(actors);
  const profile: ClockProfile = { kind: "q3", serverFrameMilliseconds: 100, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 };
  const scheduler = new FrameScheduler({ actors, ordering: { kind: "native", traversal: "source-slot-order", clock: profile },
    clocks: [{ provider: "q3:game-smoke", profile }], resolve: () => (actor, frame) => { callbacks.think(actor, frame); return undefined; } });
  let time = 100;
  const frame = (): FrameContext => ({ frame: Math.trunc(time / 100), time: { kind: "milliseconds", value: time },
    elapsed: { kind: "milliseconds", value: 100 }, phase: "entity-physics" });
  const records = new Q3EntityRecords({ actors, bodies, combat, inventory, callbacks, foreign: () => null, isPlayer: () => false,
    damageCall: () => bridge?.currentCall ?? null,
    runThink: actor => { scheduler.run(actor.id, frame(), "during-physics"); return undefined; },
    schedule: (actor, due) => { if (due === null) scheduler.cancel(actor); else scheduler.schedule(actor, "q3:think", {
      due: { kind: "milliseconds", value: due }, boundary: "during-physics", order: { actor: actor.id, provider: actor.owner, sequence: 0 } }); return undefined; },
  }, "q3:game-smoke", "baseq3");
  const world = new Q3WorldAdapter({ queries, bodies, collision: (actor, shape) => { collisions.set(actor.id, shape); return undefined; },
    curves: () => true, playerCurveClip: () => true }, records);
  const pool = new EntityPool({ records, product: "baseq3", maxClients: 2, mapStartTime: 0, time: () => time,
    print: () => {}, link: entity => world.link(entity), unlink: entity => world.unlink(entity.slot) });
  bridge = new Q3CombatBridge({ authority: combat, entities: pool, records, world, product: "baseq3",
    weaponProvider: "q3:weapons", combatProvider: "q3:combat", inventoryProvider: "q3:inventory", movementProvider: "q3:movement",
    armorContext: () => ({ screenFacingDot: 1, arithmetic: "binary32" }), time: () => time, intermissionQueued: () => 0,
    gameType: () => GameType.GT_FFA, friendlyFire: () => false, knockback: () => 1000, debugDamage: null,
    checkHurtCarrier: () => {}, logAccuracyHit: () => true });
  combat.register(bridge.policy());
  const attacker = pool.activateClient(0), victim = pool.activateClient(1);
  initGameEntity(attacker); initGameEntity(victim);
  expect(logAccuracyHit(GameType.GT_FFA, pool.at(1023), attacker)).toBe(false);
  attacker.health = victim.health = 100; attacker.takedamage = victim.takedamage = true;
  pool.clientAt(0).sess.sessionTeam = pool.clientAt(1).sess.sessionTeam = Team.TEAM_RED;
  expect(logAccuracyHit(GameType.GT_CTF, victim, attacker)).toBe(false);
  expect(logAccuracyHit(GameType.GT_FFA, victim, attacker)).toBe(true);
  pool.clientAt(1).sess.sessionTeam = Team.TEAM_BLUE;
  expect(logAccuracyHit(GameType.GT_CTF, victim, attacker)).toBe(true);
  pool.clientAt(0).sess.sessionTeam = pool.clientAt(1).sess.sessionTeam = Team.TEAM_FREE;
  pool.clientAt(0).ps.stats.set(statSchema("baseq3").maxHealth, 100);
  pool.clientAt(1).ps.stats.set(statSchema("baseq3").armor, 100);
  damage(bridge.context, victim, attacker, attacker, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 50, 0, 3);
  expect(combat.read(victim.actor.id)?.health).toBe(83);
  expect(pool.clientAt(1).ps.stats.get(statSchema("baseq3").armor)).toBe(67);
  expect(pool.clientAt(1).damageBlood).toBe(17);
  expect(pool.clientAt(1).damageArmor).toBe(33);
  expect(bodies.read(victim.actor.id)?.velocity.x).toBe(250);
  pool.clientAt(1).ps.powerups.set(Powerup.PW_BATTLESUIT, 10000);
  damage(bridge.context, victim, attacker, attacker, { x: 1, y: 0, z: 0 }, null, 100, DamageFlags.RADIUS, 7);
  expect(combat.read(victim.actor.id)?.health).toBe(83);
  expect(pool.clientAt(1).ps.externalEvent & 255).toBe(62);
  const context = bridge.context;
  if (context.product !== "baseq3") throw new Error("Unexpected product");
  const missiles = new MissileRuntime({ world, previousTime: 0, combat: context, missionpack: null });
  setOrigin(attacker, { x: 5000, y: 5000, z: 5000 });
  const grenade = missiles.fireGrenade(attacker, attacker.r.currentOrigin, { x: 1, y: 0, z: 0 });
  expect(scheduler.pending(grenade.actor.id)?.timing.due.value).toBe(2600);
  expect(grenade.s.pos.delta.x).toBe(700);
  time = 2600;
  scheduler.run(grenade.actor.id, frame(), "during-physics");
  expect(grenade.freeAfterEvent).toBe(true);
  expect(grenade.s.event & 255).toBe(51);
  expect(scheduler.pending(grenade.actor.id)).toBeNull();
  actors.close(); scheduler.close();
});
