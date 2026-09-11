/* Quake II hand grenade source timing adapted to an independent input action.
 * Copyright id Software. GPL-2.0-or-later. */
import { calculateHandThrow, handDeadline, handFrameSeconds, handFuseDeadline, handRecoverySeconds } from "./hand-grenade.ts";
import type { HandGrenadeTempo, HandProjectileSpec, HandThrowInput } from "./hand-grenade.ts";

export type HandAction =
  | { readonly kind: "idle" }
  | { readonly kind: "disarmed" }
  | { readonly kind: "preparing"; readonly frame: number; readonly nextAt: number; readonly releaseQueued: boolean }
  | { readonly kind: "cooking"; readonly expiresAt: number }
  | { readonly kind: "releasing"; readonly expiresAt: number; readonly throwAt: number }
  | { readonly kind: "recovering"; readonly readyAt: number; readonly requireRelease: boolean };

export interface HandActionInput extends HandGrenadeTempo {
  readonly now: number;
  readonly pressed: boolean;
  readonly held: boolean;
  readonly released: boolean;
  readonly lifecycle: "alive" | "dead" | "removing" | "removed";
  readonly enabled: boolean;
  readonly throw: Pick<HandThrowInput, "angles" | "damageMultiplier" | "gravity" | "project">;
}

export interface HandActionHost {
  /** Atomically debit one shared grenade, or reserve an explicitly infinite allowance.
   * The reservation belongs to this action until consume or refund. */
  reserve(): boolean;
  /** Commit or discard the already debited grenade. Must work after actor removal
   * without accessing inventory. Never debit inventory a second time. */
  consume(): undefined;
  refund(): undefined;
  emit(spec: HandProjectileSpec): undefined;
  sound(event: "cock" | "cook-start" | "cook-stop"): undefined;
}

function emit(state: { readonly expiresAt: number }, input: HandActionInput, host: HandActionHost, held: boolean): HandAction {
  host.sound("cook-stop");
  host.consume();
  host.emit(calculateHandThrow({ ...input.throw, edition: input.edition, now: input.now,
    alive: input.lifecycle === "alive" || input.lifecycle === "removing", fuseDeadline: input.lifecycle === "dead" && input.edition === "classic" ? input.now : state.expiresAt, held }));
  return { kind: "recovering", readyAt: handDeadline(input.now, handRecoverySeconds(input), input.edition), requireRelease: held && input.held };
}

function handFrameDeadline(input: HandActionInput): number {
  // Source frames land on the simulation clock. Round frame deadlines to milliseconds
  // so binary64 0.2 + 0.1 does not skip the classic turn at 0.3.
  return (Math.round(input.now * 1000) + Math.round(handFrameSeconds(input) * 1000)) / 1000;
}

/** Advance once per source simulation turn. The host owns the actor and reservation.
 * Send removing before releasing the actor so a primed grenade can use its last pose.
 * Removed only discards a stale reservation; it cannot refund or spawn without an actor. */
export function stepHandAction(state: HandAction, input: HandActionInput, host: HandActionHost): HandAction {
  if (input.lifecycle === "removed") {
    if (state.kind === "preparing" || state.kind === "cooking" || state.kind === "releasing") host.consume();
    return { kind: "disarmed" };
  }
  if (input.lifecycle === "dead" || input.lifecycle === "removing" || !input.enabled) {
    if (state.kind === "preparing") host.refund();
    if (state.kind === "cooking" || state.kind === "releasing") emit(state, input, host, input.lifecycle === "dead" && input.edition === "rerelease");
    return { kind: "disarmed" };
  }
  switch (state.kind) {
    case "disarmed": return input.held ? state : { kind: "idle" };
    case "idle":
      if (!input.pressed || !host.reserve()) return state;
      return { kind: "preparing", frame: input.edition === "classic" ? 1 : 2,
        nextAt: handFrameDeadline(input), releaseQueued: input.released || !input.held };
    case "preparing": {
      const releaseQueued = state.releaseQueued || input.released || !input.held;
      if (input.now < state.nextAt) return { ...state, releaseQueued };
      if (state.frame === 5) host.sound("cock");
      if (state.frame < 11) return { kind: "preparing", frame: state.frame + 1,
        nextAt: handFrameDeadline(input), releaseQueued };
      host.sound("cook-start");
      const cooking: HandAction = { kind: "cooking", expiresAt: handFuseDeadline(input.now, input.edition) };
      if (!releaseQueued) return cooking;
      return input.edition === "rerelease" ? emit(cooking, input, host, false)
        : { kind: "releasing", expiresAt: cooking.expiresAt, throwAt: handFrameDeadline(input) };
    }
    case "cooking":
      if (input.now >= state.expiresAt) return emit(state, input, host, true);
      if (!input.released && input.held) return state;
      return input.edition === "rerelease" ? emit(state, input, host, false)
        : { kind: "releasing", expiresAt: state.expiresAt, throwAt: handFrameDeadline(input) };
    case "releasing": return input.now < state.throwAt ? state : emit(state, input, host, false);
    case "recovering": {
      const requireRelease = state.requireRelease && input.held && !input.released;
      if (input.now < state.readyAt) return { ...state, requireRelease };
      return requireRelease ? { kind: "disarmed" } : { kind: "idle" };
    }
  }
}
