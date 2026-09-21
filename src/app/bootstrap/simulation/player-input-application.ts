import type { MovementProfile, MovementState } from "../../../contracts/movement.ts";
import type { UserCommand } from "../../../contracts/protocol.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { quakeWorldCommandSlices } from "../../../movement/q1/quakeworld.ts";
import { updateQ3PredictionView } from "../../../movement/q3/prediction.ts";
import { classicViewAngles, rereleaseViewAngles } from "../../../movement/q2/view.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";

/** Movement entrypoints use native delta-angle conventions; the observer also receives world aim. */
export function movementApplicationAim(command: UserCommand, state: MovementState, health: number, numeric: NumericOperations): Vec3 {
  if (command.kind === "q1-netquake") return command.viewAngles;
  if (command.kind === "q1-quakeworld") return command.angles;
  if (command.kind === "q2-rerelease" && state.kind === command.kind) {
    const view: [number, number, number] = [0, 0, 0];
    rereleaseViewAngles(view, [command.angles.x, command.angles.y, command.angles.z], [state.deltaAngles.x, state.deltaAngles.y, state.deltaAngles.z], state.flags, numeric);
    return { x: view[0], y: view[1], z: view[2] };
  }
  if (command.kind === "q2-classic" && state.kind === command.kind) {
    const view: [number, number, number] = [0, 0, 0];
    classicViewAngles(view, [...command.angleShorts], [...state.deltaAngleShorts], state.flags, numeric);
    return { x: view[0], y: view[1], z: view[2] };
  }
  if (command.kind === "q3" && state.kind === command.kind) return updateQ3PredictionView(state, health, command).viewAngles;
  throw new Error("Input application command does not match movement state");
}

export function movementApplicationFrame(command: UserCommand, state: MovementState, profile: MovementProfile, frame: FrameContext): FrameContext {
  if (command.kind === "q1-netquake") return frame;
  let milliseconds: number;
  if (command.kind === "q3") {
    if (state.kind !== "q3") throw new Error("Q3 input application has no command clock");
    milliseconds = Math.max(0, Math.min(1000, command.serverTimeMilliseconds - state.commandTimeMilliseconds));
  } else if (command.kind === "q1-quakeworld" && profile.clock.kind === "q1-quakeworld") {
    milliseconds = 0;
    for (const slice of quakeWorldCommandSlices(command, profile.clock.maximumCommandMilliseconds)) milliseconds += slice.milliseconds;
  } else if (command.kind === "q1-quakeworld") return frame;
  else milliseconds = command.milliseconds;
  return { ...frame, elapsed: { kind: "milliseconds", value: milliseconds } };
}
