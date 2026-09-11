import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q2GameServices } from "../foundation/host.ts";

export interface GrapplePose {
  readonly angles: Vec3;
  readonly hand: "left" | "center" | "right";
  readonly viewHeight: number;
  readonly gravity: number;
  readonly gravityVector: Vec3;
}
export type GrappleAnchor = "none" | "box" | "brush" | "world" | "player" | "corpse";
export interface GrappleHooks {
  pose(actor: ActorId, game: Q2GameServices): GrapplePose;
  anchor(actor: ActorId, game: Q2GameServices): GrappleAnchor;
  dead(actor: ActorId, game: Q2GameServices): boolean;
  previousVelocity(actor: ActorId): Vec3;
  setPreviousVelocity(actor: ActorId, velocity: Vec3): undefined;
  volume(actor: ActorId): number;
  noise(actor: ActorId, game: Q2GameServices, origin: Vec3, kind: "weapon" | "impact"): undefined;
  setGrapplePrediction(actor: ActorId, suppressed: boolean): undefined;
  gravity(): number;
  emit(event: { readonly kind: "grapple-cable"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3; readonly offset: Vec3 }): undefined;
}
export function grappleBody(actor: ActorId, game: Q2GameServices): BodyState {
  const body = game.host.bodies.read(actor);
  if (body === null) throw new Error("Grapple owner requires an existing shared body");
  return body;
}
export function grappleVelocity(actor: ActorId, game: Q2GameServices, velocity: Vec3): undefined {
  const owned = game.host.actors.resolveOwned(actor);
  if (owned === null) return undefined;
  game.host.bodies.write(owned, { ...grappleBody(actor, game), velocity });
  return game.host.bodies.link(owned);
}
export class CtfGrappleState {
  grapple: ActorId | null = null;
  grappleState: "fly" | "pull" | "hang" = "fly";
  grappleReleaseTime = 0;
  grappleNoKnockback: boolean | null = null;
}
export class LmctfGrappleState {
  hook: ActorId | null = null;
  hookState: 0 | 1 | 2 = 0;
  hookLength = 0;
  hookHeld = false;
}

export function captureCtfGrapple(state: CtfGrappleState) {
  return { grapple: state.grapple === null ? null : { slot: state.grapple.slot, generation: state.grapple.generation }, grappleState: state.grappleState, grappleReleaseTime: state.grappleReleaseTime, grappleNoKnockback: state.grappleNoKnockback };
}
export function captureLmctfGrapple(state: LmctfGrappleState) {
  return { hook: state.hook === null ? null : { slot: state.hook.slot, generation: state.hook.generation }, hookState: state.hookState, hookLength: state.hookLength, hookHeld: state.hookHeld };
}

export function restoreCtfGrapple(saved: ReturnType<typeof captureCtfGrapple>, game: Q2GameServices): CtfGrappleState {
  return { grapple: saved.grapple === null ? null : game.host.actors.referenceSaved(saved.grapple), grappleState: saved.grappleState, grappleReleaseTime: saved.grappleReleaseTime, grappleNoKnockback: saved.grappleNoKnockback };
}
export function restoreLmctfGrapple(saved: ReturnType<typeof captureLmctfGrapple>, game: Q2GameServices): LmctfGrappleState {
  return { hook: saved.hook === null ? null : game.host.actors.referenceSaved(saved.hook), hookState: saved.hookState, hookLength: saved.hookLength, hookHeld: saved.hookHeld };
}
