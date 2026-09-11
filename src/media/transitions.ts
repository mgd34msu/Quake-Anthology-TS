import type { SeatId } from "../contracts/identity.ts";
import type { CinematicEndReason } from "./types.ts";

export type CinematicTransition = { readonly kind: "q2-nextserver"; readonly serverCount: number }
  | { readonly kind: "q3-nextmap"; readonly command: string }
  | { readonly kind: "return" };
export interface CinematicTransitionHost {
  sendClientCommand(seat: SeatId, command: string): void;
  appendCommand(seat: SeatId, command: string): void;
  leaveCinematic(seat: SeatId): void;
}

/** Snapshot the transition at movie admission; an unrelated seat cannot consume it. */
export function cinematicTransition(seat: SeatId, transition: CinematicTransition, host: CinematicTransitionHost): (reason: CinematicEndReason) => void {
  let completed = false;
  return reason => {
    if (completed) return;
    completed = true;
    host.leaveCinematic(seat);
    if (reason === "stopped") return;
    switch (transition.kind) {
      case "q2-nextserver":
        if (!Number.isInteger(transition.serverCount)) throw new RangeError("Q2 server count must be an integer");
        host.sendClientCommand(seat, `nextserver ${transition.serverCount}\n`);
        return;
      case "q3-nextmap":
        if (transition.command.length !== 0) host.appendCommand(seat, `${transition.command}\n`);
        return;
      case "return": return;
    }
  };
}
