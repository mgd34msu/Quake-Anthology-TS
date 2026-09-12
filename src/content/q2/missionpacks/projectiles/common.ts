import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2Motion, Q2Think } from "../../foundation/host.ts";
import { add, scale, zero } from "../../foundation/fields.ts";
import { vectorAngles } from "../../foundation/weapons/vectors.ts";

export const shotMask = 0x6000003;
export function projectileMask(game: Q2GameServices): number { return game.options.edition === "rerelease" ? 0x46004003 : shotMask; }
export const freeProjectile: Q2Think = (entity, game) => game.remove(entity);

export function projectile(self: Pick<Q2Entity, "actor">, game: Q2GameServices, classname: string, start: Vec3, direction: Vec3,
  speed: number, model: string, motion: Q2Motion["kind"], effects: number): Q2Entity {
  const entity = game.create(classname);
  entity.owner = self.actor.id; entity.projectile = true; entity.dodgeable = true;
  entity.speed = speed; entity.model = model; entity.effects = effects; entity.clipMask = projectileMask(game); entity.motion = motion;
  entity.movedir = direction;
  game.move(entity, { origin: start, velocity: scale(direction, speed), angles: vectorAngles(direction), bounds: { min: zero, max: zero } }, false);
  return entity;
}

export function publishProjectile(entity: Q2Entity, game: Q2GameServices, sound = ""): undefined {
  game.solid(entity, "box"); game.motion(entity, entity.motion); game.show(entity);
  return sound === "" ? undefined : game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin,
    path: sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
}

export function effect(entity: Q2Entity, game: Q2GameServices, name: string, direction: Vec3 = zero, count = 1, color = 0): undefined {
  return game.host.emit({ kind: "effect", effect: `q2:${name}`, origin: game.body(entity).origin, direction, count, color });
}

export function explode(entity: Q2Entity, game: Q2GameServices, name = "explosion1"): undefined {
  effect(entity, game, name); return game.remove(entity);
}

export function sight(game: Q2GameServices, from: Q2Entity, target: ActorId): boolean {
  const body = game.host.bodies.read(target);
  if (body === null) return false;
  const eye = game.entity(target)?.viewHeight ?? (game.host.isPlayer(target) ? 22 : 0);
  const trace = game.host.trace({ start: add(game.body(from).origin, { x: 0, y: 0, z: from.viewHeight }),
    end: add(body.origin, { x: 0, y: 0, z: eye }), bounds: null, ignore: from.actor.id, mask: 25 });
  return trace.fraction === 1;
}



export function velocity(game: Q2GameServices, actor: ActorId, value: Vec3, liftGround = false): undefined {
  const body = game.host.bodies.read(actor), owned = game.host.actors.resolveOwned(actor);
  if (body === null || owned === null) return undefined;
  game.host.bodies.write(owned, { ...body, velocity: value, ground: liftGround ? null : body.ground });
  const entity = game.entity(actor);
  if (entity !== null) game.motion(entity, entity.motion);
  return undefined;
}
