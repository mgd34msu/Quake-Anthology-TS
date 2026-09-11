import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, normalize, scale, subtract } from "../fields.ts";
import type { Q2GameServices } from "../host.ts";
import { PLAYER_CONTENTS, PROJECTILE_MASK, SHOT_MASK } from "./types.ts";
import type { Q2WeaponInput } from "./types.ts";
import { angleVectors } from "./vectors.ts";

export interface Q2ActorView {
  readonly hand: Q2WeaponInput["hand"];
  readonly viewHeight: number;
  readonly playersCollide: boolean;
}

export function q2ActorShotMask(game: Q2GameServices, playersCollide: boolean): number {
  if (game.options.edition === "classic") return SHOT_MASK;
  return playersCollide ? PROJECTILE_MASK : PROJECTILE_MASK & ~PLAYER_CONTENTS;
}

export function projectQ2Actor(actor: ActorId, game: Q2GameServices, view: Q2ActorView, angles: Vec3, offset: Vec3): { start: Vec3; direction: Vec3 } {
  const axes = angleVectors(angles), side = view.hand === "left" ? -offset.y : view.hand === "center" ? 0 : offset.y;
  const body = game.host.bodies.read(actor);
  if (body === null) throw new Error("Q2 projection requires a shared actor body");
  const origin = body.origin;
  if (game.options.edition === "classic") return { start: add(add(add(origin, scale(axes.forward, offset.x)), scale(axes.right, side)), { x: 0, y: 0, z: view.viewHeight + offset.z }), direction: axes.forward };
  const eye = add(origin, { x: 0, y: 0, z: view.viewHeight });
  const start = add(add(add(eye, scale(axes.forward, offset.x)), scale(axes.right, side)), scale(axes.up, offset.z));
  const trace = game.host.trace({ start: eye, end: add(eye, scale(axes.forward, 8192)), bounds: null, ignore: actor, mask: q2ActorShotMask(game, view.playersCollide) & ~0x4000000 });
  const close = trace.kind !== "q1" && (trace.contents & (0x2000000 | PLAYER_CONTENTS)) !== 0 && trace.fraction * 8192 < 128;
  return { start, direction: trace.startSolid || close ? axes.forward : normalize(subtract(trace.end, start)) };
}
