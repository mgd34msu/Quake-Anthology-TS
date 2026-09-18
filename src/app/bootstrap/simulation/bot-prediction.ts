import type { SharedSimulation } from "./runtime.ts";
import { movementOrigin } from "./players.ts";
import { createPlayerMovementPrediction, movementObservation, type MovementPredictionPlayer } from "./player-movement.ts";
import { projectBotMovement } from "../../../bots/behavior/prediction.ts";
import type { BotMovementPrediction } from "../../../bots/behavior/q3/navigation-types.ts";
import { NavigationRuntime } from "../../../bots/navigation/runtime.ts";
import { aasPointArea, type AasAsset } from "../../../bots/navigation/aas.ts";
import { aasPredictionStop } from "../../../bots/navigation/aas-prediction-stop.ts";

/** Gameplay and AAS authoring share detached selected movement and the caller's exact area graph. */
export function predictApplicationBotMovement(simulation: SharedSimulation, player: MovementPredictionPlayer, query: BotMovementPrediction, navigation: NavigationRuntime | AasAsset) {
  const projection = createPlayerMovementPrediction(simulation, player, query.origin, query.velocity, Math.round(query.frameTime * 1000), query.presence === 4);
  const asset = navigation instanceof NavigationRuntime ? navigation.graph.asset : navigation;
  const areaAt = (origin: typeof query.origin): number | null => navigation instanceof NavigationRuntime ? navigation.areaAt(origin) : aasPointArea(navigation, origin);
  return projectBotMovement(query, { ...projection,
    input(previous, index, command) { return projection.input(previous, index, query.presence === 4 ? { ...command, z: -400 } : command); },
    stop(previous, result, frame) {
      if (result.status !== "active") throw new Error("Navigation projection removed its actor");
      const observation = movementObservation(result), grounded = observation.grounded;
      if (asset?.kind === "aas") {
        const start = previous?.status === "active" ? movementOrigin(previous.state) : query.origin;
        const crossing = aasPredictionStop(asset, start, observation.origin, frame, query.stopEvents, query.stopArea);
        if (crossing !== null) return crossing;
      }
      const wasGrounded = previous?.status === "active" ? movementObservation(previous).grounded : query.onGround;
      let flags = !wasGrounded && grounded ? 1 : wasGrounded && !grounded ? 2 : 0;
      if (observation.medium !== "dry") flags |= observation.medium === "slime" ? 8 : observation.medium === "lava" ? 16 : 4;
      if (query.stopArea !== 0 && areaAt(observation.origin) === query.stopArea) flags |= 512 | (!wasGrounded && grounded ? 1024 : 0);
      if (observation.damagingFall) flags |= 32;
      return { events: flags, origin: observation.origin, area: areaAt(observation.origin) };
    } });
}
