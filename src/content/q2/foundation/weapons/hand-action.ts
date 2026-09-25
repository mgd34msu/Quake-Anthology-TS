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
  firingInterval?(seconds: number): number;
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
  return { kind: "recovering", readyAt: handDeadline(input.now, firingInterval(host, handRecoverySeconds(input)), input.edition), requireRelease: held && input.held };
}

function firingInterval(host: HandActionHost, seconds: number): number {
  const result = host.firingInterval?.(seconds) ?? seconds;
  if (!Number.isFinite(result) || result < 0) throw new Error("Original hand grenade cadence must produce a finite nonnegative interval");
  return result;
}

function handFrameDeadline(input: HandActionInput, host: HandActionHost, from = input.now): number {
  // Source frames land on the simulation clock. Round frame deadlines to milliseconds
  // so binary64 0.2 + 0.1 does not skip the classic turn at 0.3.
  return (Math.round(from * 1000) + Math.round(firingInterval(host, handFrameSeconds(input)) * 1000)) / 1000;
}

function release(state: { readonly expiresAt: number }, input: HandActionInput, host: HandActionHost, releasedAt: number): HandAction {
  if (input.edition === "rerelease") return emit(state, input, host, false);
  const throwAt = handFrameDeadline(input, host, releasedAt);
  return input.now < throwAt ? { kind: "releasing", expiresAt: state.expiresAt, throwAt } : emit(state, input, host, false);
}

function cook(state: Extract<HandAction, { readonly kind: "cooking" }>, input: HandActionInput, host: HandActionHost): HandAction {
  if (input.now >= state.expiresAt) return emit(state, input, host, true);
  return !input.released && input.held ? state : release(state, input, host, input.now);
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
        nextAt: handFrameDeadline(input, host), releaseQueued: input.released || !input.held };
    case "preparing": {
      let frame = state.frame, nextAt = state.nextAt;
      while (input.now >= nextAt && frame < 11) {
        if (frame === 5) host.sound("cock");
        frame++;
        nextAt = handFrameDeadline(input, host, nextAt);
      }
      if (input.now < nextAt) return { kind: "preparing", frame, nextAt,
        releaseQueued: state.releaseQueued || input.released || !input.held };
      host.sound("cook-start");
      const cooking: Extract<HandAction, { readonly kind: "cooking" }> = { kind: "cooking", expiresAt: handFuseDeadline(nextAt, input.edition) };
      // A previously observed tap can complete its throw animation during catch-up.
      // A release first observed on this turn belongs to now, not the earlier hold frame.
      return state.releaseQueued ? release(cooking, input, host, nextAt) : cook(cooking, input, host);
    }
    case "cooking": return cook(state, input, host);
    case "releasing": return input.now < state.throwAt ? state : emit(state, input, host, false);
    case "recovering": {
      const requireRelease = state.requireRelease && input.held && !input.released;
      if (input.now < state.readyAt) return { ...state, requireRelease };
      return requireRelease ? { kind: "disarmed" } : { kind: "idle" };
    }
  }
}
