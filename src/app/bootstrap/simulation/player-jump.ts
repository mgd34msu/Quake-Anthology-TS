import type { MovementResult, MovementState } from "../../../contracts/movement.ts";
import type { UserCommand } from "../../../contracts/protocol.ts";
import type { TraceHit } from "../../../contracts/scene.ts";
import { EntityEvent } from "../../../movement/q3/constants.ts";
import { PmflagsT } from "../../../movement/q2/types.ts";

/** Source jump acknowledgements, not a held jump button or an arbitrary upward impulse. */
export function movementJumped(before: MovementState, ground: TraceHit, command: UserCommand, result: MovementResult): boolean {
  if (result.status !== "active") return false;
  switch (result.kind) {
    case "q1-netquake": return false; // NetQuake invokes its source playerAction hook.
    case "q1-quakeworld": return before.kind === "q1-quakeworld" && ground.kind !== "none"
      && (before.oldButtons & 2) === 0 && (result.state.oldButtons & 2) !== 0 && result.state.velocity.z > 0 && !result.state.dead;
    case "q2-classic": return command.kind === "q2-classic" && ground.kind !== "none" && result.ground.kind === "none"
      && command.upMove >= 10 && result.waterLevel === 0;
    case "q2-rerelease": return result.jumpSound && (result.state.flags & PmflagsT.PMF_ON_LADDER) === 0;
    case "q3": return result.effects.some(({ effect }) => effect.kind === "event" && effect.value.event === EntityEvent.EV_JUMP);
  }
}
