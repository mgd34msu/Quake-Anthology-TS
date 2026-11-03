import type { SharedSimulation } from "./runtime.ts";
import { movementOrigin } from "./players.ts";
import { createPlayerMovementPrediction, movementObservation, playerCrouchedBounds, playerTracePolicy, type MovementPredictionPlayer } from "./player-movement.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import { projectBotMovement } from "../../../bots/behavior/prediction.ts";
import type { BotMovementPrediction } from "../../../bots/behavior/q3/navigation-types.ts";
import { NavigationRuntime } from "../../../bots/navigation/runtime.ts";
import { aasPointArea, type AasAsset } from "../../../bots/navigation/aas.ts";
import { aasPredictionStop } from "../../../bots/navigation/aas-prediction-stop.ts";

const PHYS_MAXSTEP = 18, PHYS_MAXBARRIER = 32;
const SE_GAP = 64, SE_HITBOUNDINGBOX = 2048;

function liquidBelow(simulation: SharedSimulation, player: MovementPredictionPlayer, numeric: NumericProfile, point: Vec3): boolean {
  const sample = simulation.scene.pointContents({ point, target: { kind: "world" }, policy: playerTracePolicy(player), numeric, passActor: null });
  return sample.kind === "q1" ? sample.contents === -3 : ((sample.kind === "q2" ? sample.merged : sample.contents) & 32) !== 0;
}

/** AAS_PredictClientMovement's SE_GAP probe: a crouch-box trace below the origin that finds no floor within a step. */
function atGap(simulation: SharedSimulation, player: MovementPredictionPlayer, numeric: NumericProfile, origin: Vec3): boolean {
  const trace = simulation.scene.trace({ start: origin, end: { ...origin, z: origin.z - (48 + PHYS_MAXBARRIER) }, shape: { kind: "box", bounds: playerCrouchedBounds(player) },
    target: { kind: "world" }, policy: playerTracePolicy(player), numeric, passActor: null });
  return !trace.startSolid && trace.end.z < origin.z - PHYS_MAXSTEP - 1 && !liquidBelow(simulation, player, numeric, trace.end);
}

function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

/** Gameplay and AAS authoring share detached selected movement and the caller's exact area graph. */
export function predictApplicationBotMovement(simulation: SharedSimulation, player: MovementPredictionPlayer, query: BotMovementPrediction, navigation: NavigationRuntime | AasAsset) {
  const numeric = simulation.recipe.timing.find(entry => entry.provider === simulation.recipe.engineBehavior.provider)?.numeric;
  if (numeric === undefined) throw new Error("Bot prediction has no source numeric policy");
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
      // be_aas_move.c reports ground events from the current state, not from a change since the last frame.
      let flags = grounded ? 1 : 2;
      if (observation.medium !== "dry") flags |= observation.medium === "slime" ? 8 : observation.medium === "lava" ? 16 : 4;
      if (query.stopArea !== 0 && areaAt(observation.origin) === query.stopArea) flags |= 512 | (!wasGrounded && grounded ? 1024 : 0);
      if (observation.damagingFall) flags |= 32;
      if ((query.stopEvents & SE_GAP) !== 0 && atGap(simulation, player, numeric, observation.origin)) flags |= SE_GAP;
      if ((query.stopEvents & SE_HITBOUNDINGBOX) !== 0 && query.hitBox !== undefined
        && boxesOverlap({ min: { x: observation.origin.x + result.bounds.min.x, y: observation.origin.y + result.bounds.min.y, z: observation.origin.z + result.bounds.min.z },
          max: { x: observation.origin.x + result.bounds.max.x, y: observation.origin.y + result.bounds.max.y, z: observation.origin.z + result.bounds.max.z } }, query.hitBox)) flags |= SE_HITBOUNDINGBOX;
      return { events: flags, origin: observation.origin, area: areaAt(observation.origin) };
    } });
}
