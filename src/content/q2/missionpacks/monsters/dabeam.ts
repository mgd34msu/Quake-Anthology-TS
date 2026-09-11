/* Quake II xatrix/g_monster.c transient monster healing/laser beam. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { freeQ2Entity } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { anglesVectors, traceGroundActor } from "../../foundation/monsters/ai.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";

const beamHit: Q2Think = (entity, game) => {
  const origin = game.body(entity).origin, end = add(origin, scale(entity.movedir, 2048));
  let start = origin, ignore: ActorId = entity.actor.id, endpoint = end;
  for (;;) {
    const trace = game.host.trace({ start, end, bounds: null, ignore, mask: 1 | 0x2000000 | 0x4000000 });
    endpoint = trace.end;
    const actor = traceGroundActor(trace, game); if (actor === null) break;
    const target = game.entity(actor), state = game.host.combat.read(actor);
    if (state?.canTakeDamage === true && target?.laserImmune !== true && ((target?.flags ?? 0) & 4) === 0 && actor !== entity.owner) game.damage(actor, entity, entity.owner, entity.damage, game.options.skill, entity.movedir, trace.end, zero, 30, 4);
    const updated = game.host.combat.read(actor);
    if (entity.damage < 0 && game.host.isPlayer(actor) && updated !== null && updated.health > 100) {
      const owned = game.host.actors.resolveOwned(actor); if (owned !== null) game.host.combat.setHealth(owned, updated.health + entity.damage);
    }
    if (!game.host.isMonster(actor) && !game.host.isPlayer(actor)) {
      if ((entity.spawnflags & 0x80000000) !== 0) {
        entity.spawnflags &= ~0x80000000;
        game.host.emit({ kind: "effect", effect: "q2:laser-sparks", origin: trace.end, direction: trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, count: 10, color: entity.skin & 255 });
      }
      break;
    }
    ignore = actor; start = trace.end;
  }
  game.host.emit({ kind: "beam", actor: entity.actor.id, start: origin, end: endpoint, width: 2, color: entity.skin, visible: true });
  return game.schedule(entity, 0.1, freeQ2Entity);
};

export const monsterDabeamCallbacks: Q2CallbackDefinitions = { think: { dabeam_hit: beamHit, G_FreeEdict: freeQ2Entity } };

export function monsterDabeam(owner: Q2Entity, game: Q2GameServices, target: ActorId | null, origin: Vec3, angles: Vec3, damage: number, medic: boolean): Q2Entity {
  game.sourceCallbacks.register(monsterDabeamCallbacks);
  const beam = game.create("dabeam"); beam.owner = owner.actor.id; beam.enemy = target; beam.damage = damage; beam.renderFlags = 128 | 32; beam.frame = 2; beam.skin = medic ? 0xf3f3f1f1 : 0xf2f2f0f0;
  const enemy = target === null ? null : game.host.bodies.read(target);
  if (enemy !== null) {
    const point = add(enemy.origin, scale(add(enemy.bounds.min, enemy.bounds.max), 0.5));
    beam.movedir = normalize(subtract(medic ? { ...point, x: point.x + Math.sin(game.host.now()) * 8 } : point, origin));
  } else beam.movedir = anglesVectors(angles).forward;
  beam.spawnflags |= 0x80000001;
  game.move(beam, { origin, angles, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }, false);
  game.motion(beam, "stationary"); game.solid(beam, "none"); game.schedule(beam, 0.1, beamHit);
  return beam;
}
