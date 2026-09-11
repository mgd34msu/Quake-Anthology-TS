/* mg3_oldone_new.qc projectiles and sphere managers. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, ZERO, dot, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { launchSpike } from "../../../base/projectiles.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import type { Q1AddonContext } from "../../context.ts";
import { spherePoint } from "./sphere-points.ts";

export const oldnewPrefix = "mg3:bosses:";
export function bossLater(context: Q1AddonContext, entity: Q1Actor, name: string, delay: number): undefined { return context.game.schedule(entity, delay, context.game.named.action(entity, oldnewPrefix + name)); }
export function bossEnemy(_context: Q1AddonContext, entity: Q1Actor): ActorId | null { return entity.monster?.enemy ?? entity.references.get("enemy") ?? null; }
export function bossWorld(context: Q1AddonContext): ActorId {
  const world = context.game.world; if (world === null) throw new Error("MG3 boss damage requires worldspawn"); return world.actor.id;
}
export function bossTarget(context: Q1AddonContext, entity: Q1Actor): Vec3 { const enemy = bossEnemy(context, entity); return enemy === null ? ZERO : context.game.host.bodies.read(enemy)?.origin ?? ZERO; }
export function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function flatDot(a: Vec3, b: Vec3): number { return dot(normalize({ ...a, z: 0 }), normalize({ ...b, z: 0 })); }
function missile(context: Q1AddonContext, manager: Q1Actor, origin: Vec3, direction: Vec3, model: string, velocity: Vec3): Q1Actor {
  const { game } = context, shot = launchSpike(game, manager.owner, origin, direction); shot.model = model; shot.touch = game.named.touch(shot, oldnewPrefix + "sphere_mis_touch"); game.setBody(shot, { velocity, bounds: POINT }); return shot;
}
export function spawnSphereManager(context: Q1AddonContext, source: Q1Actor, maximum: number): Q1Actor {
  const { game } = context, manager = game.create("sphere_manager"); manager.classname = ""; manager.owner = source.actor.id; game.setOrigin(manager, game.body(source).origin);
  if (bossEnemy(context, source) === null) { if (source.monster !== null) source.monster.enemy = game.host.players()[0] ?? null; else source.references.set("enemy", game.host.players()[0] ?? null); }
  const direction = normalize({ ...vsub(bossTarget(context, source), game.body(source).origin), z: 0 }), basis = game.makeVectors(game.body(source).angles);
  context.setNumber(manager, "aflag", flatDot(basis.right, cross(direction, { x: 0, y: 0, z: 1 })) > 1 ? 1 : 0);
  game.setBody(manager, { angles: velocityAngles(direction) }); manager.count = maximum; bossLater(context, manager, "actual_sphere", 0.1); return manager;
}
export function spawnSphereChunkManager(context: Q1AddonContext, source: Q1Actor, maximum: number): Q1Actor {
  const { game } = context, manager = game.create("sphere_chunk_manager"); manager.classname = ""; manager.owner = source.actor.id; manager.wait = 22.5; manager.delay = 0.8; manager.count = 0;
  context.setNumber(manager, "aflag", 1); context.setNumber(manager, "cnt", maximum); manager.references.set("enemy", bossEnemy(context, source) ?? game.host.players()[0] ?? null);
  game.setBody(manager, { origin: game.body(source).origin, angles: game.body(source).angles }); bossLater(context, manager, "sphere_chunk", 0.1); return manager;
}
export function autoGun(context: Q1AddonContext, source: Q1Actor, origin: Vec3, offset: number): undefined {
  const { game } = context, player = game.host.players()[0] ?? null, target = player === null ? ZERO : game.host.bodies.read(player)?.origin ?? ZERO;
  let direction = normalize(vsub(target, origin)); if (offset !== 0) direction = vadd(vscale(cross(direction, { x: 0, y: 0, z: 1 }), offset), vscale(direction, 1 - Math.abs(offset)));
  const shot = launchSpike(game, source.actor.id, origin, direction); shot.touch = game.named.touch(shot, oldnewPrefix + "sphere_mis_touch"); shot.model = "progs/rogue/sphere.mdl"; shot.effects = 64;
  return game.setBody(shot, { velocity: vscale(direction, offset === 0 ? 600 : 800), bounds: POINT });
}
export function spawnBossTeledeath(context: Q1AddonContext, origin: Vec3, owner: Q1Actor): Q1Actor {
  const { game } = context, death = game.create("teledeath"), bounds = game.body(owner).bounds;
  death.owner = owner.actor.id; death.solid = "trigger"; death.movement = "none"; death.touch = game.named.touch(death, oldnewPrefix + "tdeath_boss_touch");
  game.setBody(death, { origin, angles: ZERO, bounds: { min: vsub(bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(bounds.max, { x: 1, y: 1, z: 1 }) } });
  game.schedule(death, 0.2, game.named.action(death, "SUB_Remove")); game.link(death); game.forceRetouch = 2; return death;
}
export function registerOldnewProjectiles(context: Q1AddonContext): undefined {
  const { game } = context;
  game.named.register(oldnewPrefix + "sphere_mis_touch", { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    const target = game.entity(other); if (target?.classname === "oldnew_child" || target?.classname === "oldnew_eye" || target?.classname === "monster_szombie") return game.remove(entity);
    if (target?.solid === "trigger") return undefined;
    if (game.host.contents(game.body(entity).origin) === "sky") return game.remove(entity);
    if (game.host.combat.read(other)?.canTakeDamage === true) game.damage(other, entity.actor.id, entity.owner, 18); return game.remove(entity);
  } });
  game.named.register(oldnewPrefix + "actual_sphere", { action: (_game, entity) => {
    if (bossEnemy(context, entity) === null) entity.references.set("enemy", game.host.players()[0] ?? null);
    const direction = game.makeVectors(game.body(entity).angles).forward;
    for (let i = 0; i < 100; i++) {
      const point = spherePoint(i), aim = vadd(vscale(direction, 0.65), vscale(normalize(point), 0.35));
      const shot = missile(context, entity, vadd(vadd(game.body(entity).origin, { x: 0, y: 0, z: 32 }), vscale(point, 32)), aim, "progs/rogue/sphere.mdl", vscale(aim, 800)); shot.damage = 18; if (i % 5 === 0) shot.effects = 64;
    }
    entity.count--; if (entity.count <= 0) return game.remove(entity);
    bossLater(context, entity, "actual_sphere", 0.8); return game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: entity.number("aflag") !== 0 ? 20 : -20, z: 0 }) });
  } });
  game.named.register(oldnewPrefix + "spawn_sphere", { action: (_game, entity) => {
    const initial = game.makeVectors(game.body(entity).angles), excluded = initial.forward, excluded2 = initial.right;
    game.sound(entity, "weapons/spike2.wav", "weapon"); if (bossEnemy(context, entity) === null) entity.references.set("enemy", game.host.players()[0] ?? null);
    for (let y = -1; y < 2; y++) {
      for (let x = 0; x < (y === 0 ? 44 : 45); x++) {
        const basis = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: x * 8, z: 0 }));
        if (Math.abs(flatDot(basis.forward, excluded)) >= 0.9 || Math.abs(flatDot(basis.forward, excluded2)) >= 0.9) continue;
        const origin = vadd(vadd(vadd(game.body(entity).origin, vscale(basis.forward, 64)), vscale(basis.up, y * 16)), { x: 0, y: 0, z: 24 });
        const shot = missile(context, entity, origin, vscale(basis.forward, 200), "progs/diamond.mdl", vscale(normalize(basis.forward), 400)); if (y === -1 && x % 2 === 0) shot.effects = 64; shot.angularVelocity = { x: 0, y: 0, z: -100 };
      }
      game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: 4, z: 0 }) });
    }
    game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: entity.number("aflag") * entity.wait, z: 0 }) }); bossLater(context, entity, "spawn_sphere", entity.delay);
    entity.count++; if (entity.count > entity.number("cnt")) { const owner = game.entity(entity.owner); if (owner !== null && owner.number("boss_immune") !== 0) context.setNumber(owner, "boss_immune", 0); return game.remove(entity); } return undefined;
  } });
  game.named.register(oldnewPrefix + "sphere_chunk", { action: (_game, entity) => {
    const attack = normalize({ ...vsub(bossTarget(context, entity), game.body(entity).origin), z: 0 }); game.setBody(entity, { angles: velocityAngles(attack) });
    const excluded = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: 22.5, z: 0 })).forward, excluded2 = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: -22.5, z: 0 })).forward;
    game.sound(entity, "weapons/spike2.wav", "weapon");
    for (let y = -1; y < 1; y++) {
      for (let x = 0; x < 45; x++) {
        const basis = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: x * 8, z: 0 }));
        if (flatDot(basis.forward, attack) <= 0.5 || flatDot(basis.forward, excluded) > 0.985 || flatDot(basis.forward, excluded2) > 0.985) continue;
        const origin = vadd(vadd(vadd(game.body(entity).origin, vscale(basis.forward, 64)), vscale(basis.up, y * 16)), { x: 0, y: 0, z: 8 });
        const shot = missile(context, entity, origin, vscale(basis.forward, 200), "progs/diamond.mdl", vscale(normalize(basis.forward), 400)); if (y === 0 && x % 2 === 0) shot.effects = 64; shot.angularVelocity = { x: 0, y: 0, z: -100 };
      }
      game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: 4, z: 0 }) });
    }
    entity.count++; return entity.count > entity.number("cnt") ? game.remove(entity) : undefined;
  } });
  game.named.register(oldnewPrefix + "tdeath_boss_touch", { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    if (game.isPlayer(other) || game.host.classname(other) === "monster_oldone_new") {
      if ((game.player(other)?.powerups.get("invulnerability") ?? 0) > game.time) entity.classname = "teledeath2";
      if (!game.isPlayer(entity.owner)) { if (entity.owner !== null) game.damage(entity.owner, entity.actor.id, entity.actor.id, 50000); return undefined; }
    }
    if (game.health(other) !== 0) game.damage(other, entity.actor.id, entity.actor.id, 50000); return undefined;
  } }); return undefined;
}
