/* MG3 launch_spike and LightningDamage source operations. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import type { Q1EntityServices } from "../../../foundation/entity-services.ts";
import { launchSpike } from "../../../base/projectiles.ts";
import { POINT, ZERO, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { heavyPrefix } from "./runtime.ts";

export function heavySpike(game: Q1EntityServices, owner: ActorId, origin: Vec3, velocity: Vec3): Q1Actor {
  const missile = launchSpike(game, owner, origin, velocity); missile.classname = "knightspike";
  missile.touch = game.named.touch(missile, `${heavyPrefix}:spike_touch`); return missile;
}
export function registerHeavyProjectiles(game: Q1EntityServices): undefined {
  game.named.register(`${heavyPrefix}:spike_touch`, { touch: (runtime, entity, other) => {
    if (entity.owner !== null && sameActor(other, entity.owner) || runtime.entity(other)?.solid === "trigger") return undefined;
    const origin = runtime.body(entity).origin; if (runtime.host.contents(origin) === "sky") return runtime.remove(entity);
    if (runtime.host.combat.read(other)?.canTakeDamage) {
      runtime.effect("blood", origin, other, 9); runtime.damage(other, entity.actor.id, entity.owner, 9);
    } else runtime.effect("knight-spike", origin);
    return runtime.remove(entity);
  } }); return undefined;
}
export function heavyLightningDamage(game: Q1EntityServices, actor: ActorId, start: Vec3, end: Vec3, damage: number): undefined {
  const delta = vsub(end, start), side = { x: -delta.y * 16, y: -delta.y * 16, z: 0 }; const hit: (ActorId | null)[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: actor, monsters: true });
    const target = trace.actor;
    if (target !== null && !hit.some(previous => previous !== null && sameActor(previous, target)) && game.host.combat.read(target)?.canTakeDamage) {
      game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 246, count: damage * 4 }); game.damage(target, actor, actor, damage);
    }
    hit.push(target);
  }
  return undefined;
}
