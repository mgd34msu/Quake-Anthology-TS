import type { OrderedMovementEffect } from "../../../../contracts/movement.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceShape } from "../../../../contracts/scene.ts";
import { Q2RereleaseMovementContext } from "../../../../movement/q2/index.ts";
import type { MovementProbeOptions, MovementPredictionSnapshot, PredictionCommand } from "./types.ts";
import { copyPredictionSnapshot, predictMovementCommand } from "./step.ts";

/** Callers retain the returned state across accepted navigation edges; no actor store is changed. */
export function predictMovementSequence(options: MovementProbeOptions, initial: MovementPredictionSnapshot,
  commands: readonly PredictionCommand[], shape: TraceShape = { kind: "box", bounds: options.standingBounds }) {
  let player = copyPredictionSnapshot(initial);
  const origin = (): Vec3 => player.state.kind === "q2-classic"
    ? { x: player.state.originEighths[0] / 8, y: player.state.originEighths[1] / 8, z: player.state.originEighths[2] / 8 } : { ...player.state.origin };
  const trajectory = [origin()], effects: OrderedMovementEffect[] = [];
  const rereleaseMovement = new Q2RereleaseMovementContext();
  let first = true;
  for (const command of commands) {
    const result = predictMovementCommand(options, player, command, { scene: options.scene,
      rereleaseMovement,
      fixedMilliseconds: options.profile.kind === "q3" ? options.profile.fixedMilliseconds : null,
      noFootsteps: options.profile.kind === "q3" && options.profile.noFootsteps, gauntletHit: false, traceMask: null, firstCommand: first }, shape);
    player = result.player; effects.push(...result.result.effects); trajectory.push(origin()); first = false;
  }
  return { player, effects, trajectory, seconds: (player.commandTimeMilliseconds - initial.commandTimeMilliseconds) / 1000 };
}
