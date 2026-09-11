/* mg3_oldone_new.qc summoned attack actors. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { spawnTeleportFog } from "../../../foundation/spawns.ts";
import { launchSpike } from "../../../base/projectiles.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import type { Q1AddonContext } from "../../context.ts";
import { bossEnemy, bossLater, bossTarget, bossWorld, cross, oldnewPrefix, spawnBossTeledeath } from "./oldnew-projectiles.ts";

const largeHull = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } };
function child(context: Q1AddonContext, owner: Q1Actor): Q1Actor { const entity = context.game.create("oldnew_child"); entity.owner = owner.actor.id; context.game.setOrigin(entity, context.game.body(owner).origin); return entity; }
export function spawnSpammer(context: Q1AddonContext, owner: Q1Actor): Q1Actor {
  const entity = child(context, owner); entity.references.set("enemy", bossEnemy(context, owner) ?? context.game.host.players()[0] ?? null); bossLater(context, entity, "spammer_think", 0.1); return entity;
}
export function spawnSwiper(context: Q1AddonContext, owner: Q1Actor): Q1Actor {
  const { game } = context, entity = child(context, owner); entity.count = 0; game.setBody(entity, { angles: game.body(owner).angles });
  game.sound(entity, "weapons/lstart.wav", "weapon"); context.setNumber(entity, "aflag", owner.number("aflag")); context.setNumber(owner, "aflag", 1 - owner.number("aflag")); bossLater(context, entity, "oldnew_swipe", 0.025); return entity;
}
export function spawnEye(context: Q1AddonContext, owner: Q1Actor): Q1Actor {
  const { game } = context, entity = game.create("oldnew_eye"), origin = vadd(game.body(owner).origin, { x: 0, y: 0, z: 300 }); spawnTeleportFog(game, origin);
  game.setBody(entity, { origin, bounds: largeHull }); entity.model = "progs/teleporter_eye.mdl"; entity.solid = "slidebox"; entity.movement = "fly"; entity.damageable = true; entity.aimedDamage = true;
  entity.pain = game.named.pain(entity, oldnewPrefix + "eye_pain"); entity.die = game.named.die(entity, oldnewPrefix + "eye_die"); entity.touch = game.named.touch(entity, oldnewPrefix + "eye_touch");
  entity.owner = owner.actor.id; entity.speed = 100; game.host.combat.setHealth(entity.actor, 300); entity.maxHealth = 300; entity.references.set("enemy", game.host.players()[0] ?? null);
  bossLater(context, entity, "eye_chase", 0.1); game.link(entity); return entity;
}
function armedEye(context: Q1AddonContext, owner: Q1Actor, offset: number): Q1Actor {
  const { game } = context, entity = child(context, owner), basis = game.makeVectors(game.body(owner).angles);
  const origin = vadd(vadd(vadd(game.body(owner).origin, vscale(basis.right, offset * 300)), vscale(basis.up, 80)), vscale(basis.forward, 200));
  game.setBody(entity, { origin, bounds: largeHull }); entity.model = "progs/teleporter_eye.mdl"; entity.solid = "slidebox"; entity.movement = "step"; entity.movementFlags = 33;
  entity.die = game.named.die(entity, oldnewPrefix + "eye_die"); spawnBossTeledeath(context, origin, entity); game.host.combat.setHealth(entity.actor, 120); entity.maxHealth = 120; entity.damageable = true; entity.aimedDamage = true;
  game.totalMonsters++; game.host.emit({ kind: "monster-total", total: game.totalMonsters }); game.setBody(entity, { angles: game.body(owner).angles }); spawnTeleportFog(game, origin); entity.effects = 64; game.link(entity); return entity;
}
export function spawnBlaster(context: Q1AddonContext, owner: Q1Actor): undefined {
  for (const offset of [1, -1]) { const entity = armedEye(context, owner, offset); context.setNumber(entity, "aflag", offset); entity.count = 0; entity.damage = -offset; bossLater(context, entity, "blast", 2); } return undefined;
}
export function spawnVortex(context: Q1AddonContext, owner: Q1Actor): Q1Actor {
  const entity = armedEye(context, owner, owner.number("ammo_cells") !== 0 ? 1 : -1); context.setNumber(entity, "aflag", owner.number("ammo_cells") !== 0 ? 1 : -1);
  context.setNumber(owner, "ammo_cells", 1 - owner.number("ammo_cells")); entity.count = 0; entity.references.set("enemy", bossEnemy(context, owner)); bossLater(context, entity, "vortex_think_alt", 2); return entity;
}
export function cleanupOldnew(context: Q1AddonContext): undefined {
  const { game } = context; for (const entity of game.entities.values()) if (entity.classname === "oldnew_child" || entity.classname === "oldnew_eye") bossLater(context, entity, "oldnew_cleanup_think", 0.1);
  const timer = game.create("oldnew_cleanup_zombies"); timer.classname = ""; bossLater(context, timer, "oldnew_cleanup_zombies", 2); return undefined;
}
export function registerOldnewChildren(context: Q1AddonContext): undefined {
  const { game } = context;
  const eyeDie = (entity: Q1Actor, attacker: ActorId | null): undefined => {
    if ((entity.movementFlags & 32) !== 0) {
      game.killedMonsters++; game.host.emit({ kind: "monster-killed", actor: entity.actor.id, total: game.totalMonsters, found: game.killedMonsters });
      entity.movementFlags &= ~3; entity.references.set("enemy", attacker); game.useTargets(entity, attacker);
    }
    context.services.emit({ kind: "colored-explosion", origin: game.body(entity).origin, colorStart: 244, colorLength: 3 }); return game.remove(entity);
  };
  game.named.register(oldnewPrefix + "eye_die", { die: (_game, entity, attacker) => eyeDie(entity, attacker) });
  game.named.register(oldnewPrefix + "eye_pain", { pain: (_game, entity, attacker, take) => {
    const origin = game.body(entity).origin, delta = vsub(origin, attacker === null ? ZERO : game.host.bodies.read(attacker)?.origin ?? ZERO);
    const impulse = vscale(vadd(vscale(normalize({ ...delta, z: 0 }), 0.8), { x: 0, y: 0, z: 0.2 }), take * 10); return game.setBody(entity, { velocity: vadd(game.body(entity).velocity, impulse) });
  } });
  game.named.register(oldnewPrefix + "eye_touch", { touch: (_game, entity, other) => {
    if (game.entity(other) === game.world || entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    if (game.health(other) !== 0) game.damage(other, entity.actor.id, entity.owner, 500); return undefined;
  } });
  game.named.register(oldnewPrefix + "eye_chase", { action: (_game, entity) => {
    const body = game.body(entity), target = bossTarget(context, entity); entity.speed = length(body.velocity); if (entity.speed < 300) entity.speed += 10;
    let velocity = vadd(vscale(normalize(vsub(target, body.origin)), 0.3), vscale(normalize(body.velocity), 0.7));
    if (body.origin.z < target.z + 32) velocity = normalize({ ...velocity, z: 0 });
    game.setBody(entity, { angles: velocityAngles(velocity), velocity: vscale(velocity, entity.speed) }); bossLater(context, entity, "eye_chase", 0.1);
    if (entity.count % 2 === 0) { entity.effects |= 2; game.sound(entity, "misc/power.wav"); } entity.count++; return undefined;
  } });
  const blast = (entity: Q1Actor, name: string): undefined => {
    const enemy = bossEnemy(context, entity); if (enemy === null || !game.isPlayer(enemy)) entity.references.set("enemy", game.host.players()[0] ?? null);
    const body = game.body(entity), target = bossTarget(context, entity); let direction = normalize(vsub(target, body.origin));
    direction = normalize(vadd(direction, vscale(cross(direction, { x: 0, y: 0, z: 1 }), Math.cos(entity.count * 15) * 0.5 * entity.number("aflag")))); game.setBody(entity, { angles: velocityAngles(direction) });
    const shot = launchSpike(game, entity.actor.id, vadd(body.origin, vscale(direction, 8)), direction); shot.touch = game.named.touch(shot, oldnewPrefix + "blast_touch"); shot.model = "progs/rogue/sphere.mdl"; shot.effects = 64;
    game.sound(entity, "weapons/spike2.wav", "weapon"); game.setBody(shot, { velocity: vscale(direction, 500), bounds: POINT }); shot.angularVelocity = vscale({ x: 300, y: 300, z: 300 }, game.host.random() * 2 - 1);
    bossLater(context, entity, name, 0.2); entity.count++; if (entity.count > 72) game.damage(entity.actor.id, bossWorld(context), bossWorld(context), 500); return undefined;
  };
  for (const name of ["blast", "vortex_think_alt"]) game.named.register(oldnewPrefix + name, { action: (_game, entity) => blast(entity, name) });
  game.named.register(oldnewPrefix + "blast_touch", { touch: (_game, entity, other) => {
    if (game.entity(other) === game.world) return game.remove(entity);
    if (game.host.classname(other) === "sphere" || entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    if (game.host.classname(other) === "monster_oldone_new") return game.remove(entity);
    if (game.entity(other)?.solid === "trigger") return undefined;
    if (game.health(other) !== 0) game.damage(other, entity.actor.id, entity.owner, 15); return game.remove(entity);
  } });
  game.named.register(oldnewPrefix + "spammer_think", { action: (_game, entity) => {
    const owner = game.entity(entity.owner), angles = owner === null ? ZERO : game.body(owner).angles; game.setBody(entity, { angles });
    const offset = [0, 1, -3, 2, -2, 3, -1, 4, 2, -1, -3, 2, -4][entity.count]; if (offset === undefined) return game.remove(entity);
    const basis = game.makeVectors(vadd(angles, { x: 0, y: offset * 6, z: 0 })), shot = game.create("spam"), origin = vadd(vadd(game.body(entity).origin, { x: 0, y: 0, z: 50 }), vscale(basis.forward, 48));
    shot.owner = entity.owner; shot.model = "progs/rogue/plasma.mdl"; shot.solid = "bbox"; shot.movement = "toss"; shot.effects = 64; shot.touch = game.named.touch(shot, oldnewPrefix + "spam_touch");
    const oomph = Math.max(200, length(vsub(bossTarget(context, entity), game.body(entity).origin)) * 0.8), velocity = vscale(basis.forward, oomph + 25 * entity.count);
    game.setBody(shot, { origin, bounds: POINT, velocity: { ...velocity, z: 200 } }); game.sound(entity, "weapons/grenade.wav", "weapon"); entity.count++; game.link(shot); return bossLater(context, entity, "spammer_think", 0.1);
  } });
  game.named.register(oldnewPrefix + "spam_touch", { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    if (game.entity(other) === game.world) {
      game.setBody(entity, { velocity: ZERO, angles: { x: 0, y: game.host.random() * 360, z: 0 } }); entity.movement = "none"; entity.solid = "none"; entity.model = "maps/bmodel/b_splash.bsp"; entity.touch = null; game.link(entity); return bossLater(context, entity, "spam1", 2);
    }
    if (game.health(other) !== 0) game.damage(other, entity.owner ?? bossWorld(context), entity.actor.id, 10); return game.remove(entity);
  } });
  game.named.register(oldnewPrefix + "spam1", { action: (_game, entity) => { const origin = game.body(entity).origin; context.services.emit({ kind: "lightning", actor: entity.actor.id, style: 1, start: origin, end: vadd(origin, { x: 0, y: 0, z: 500 }) }); return bossLater(context, entity, "spam2", 0.1); } });
  game.named.register(oldnewPrefix + "spam2", { action: (_game, entity) => { context.services.emit({ kind: "colored-explosion", origin: game.body(entity).origin, colorStart: 244, colorLength: 3 }); game.radiusDamage(entity.actor.id, entity.actor.id, 100, game.world?.actor.id ?? null, null); return game.remove(entity); } });
  game.named.register(oldnewPrefix + "oldnew_swipe", { action: (_game, entity) => {
    const a = (entity.count / 50) ** 2, basis = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: entity.number("aflag") === 0 ? -60 + a * 180 : 60 - a * 180, z: 0 }));
    const origin = game.body(entity).origin, start = vadd(origin, vscale(basis.forward, 130)), trace = game.host.trace({ start, end: vadd(origin, vscale(basis.forward, 1000)), bounds: POINT, ignore: entity.actor.id, monsters: true });
    if (trace.actor !== null && game.health(trace.actor) !== 0) game.damage(trace.actor, entity.owner ?? bossWorld(context), entity.owner, game.host.classname(trace.actor) === "monster_szombie" ? 100 : 25);
    if (entity.count % 2 === 0) context.services.emit({ kind: "lightning", actor: entity.actor.id, style: 3, start, end: trace.end });
    if (entity.number("t_width") < game.time) { game.sound(entity, "weapons/lhit.wav", "weapon"); context.setNumber(entity, "t_width", game.time + 0.6); }
    entity.count++; return entity.count > 50 ? game.schedule(entity, 0.025, game.named.action(entity, "SUB_Remove")) : bossLater(context, entity, "oldnew_swipe", 0.025);
  } });
  game.named.register(oldnewPrefix + "oldnew_cleanup_think", { action: (_game, entity) => { game.damage(entity.actor.id, entity.actor.id, entity.actor.id, 5000); return undefined; } });
  game.named.register(oldnewPrefix + "oldnew_cleanup_zombies", { action: (_game, entity) => {
    const zombie = [...game.entities.values()].find(actor => actor.classname === "monster_szombie");
    if (zombie !== undefined) { game.damage(zombie.actor.id, bossWorld(context), bossWorld(context), 500); return bossLater(context, entity, "oldnew_cleanup_zombies", 0.2 + game.host.random() * 0.5); }
    return bossLater(context, entity, "oldnew_cleanup_zombies", 1.5);
  } }); return undefined;
}
