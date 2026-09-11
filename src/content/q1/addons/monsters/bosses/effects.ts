/* boss_final.qc pain_lightning. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, vadd, vscale } from "../../../foundation/types.ts";
import type { Q1AddonContext } from "../../context.ts";

export function painLightning(context: Q1AddonContext, entity: Q1Actor, offset: Vec3): undefined {
  const { game } = context, forward = game.makeVectors({ x: game.host.random() * 180 + 180, y: game.host.random() * 360, z: 0 }).forward, origin = vadd(game.body(entity).origin, offset);
  const trace = game.host.trace({ start: origin, end: vadd(origin, vscale(forward, 1000)), bounds: POINT, ignore: entity.actor.id, monsters: false });
  game.sound(entity, "misc/power.wav", "body"); return context.services.emit({ kind: "lightning", actor: entity.actor.id, style: 3, start: origin, end: trace.end });
}
