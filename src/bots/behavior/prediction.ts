import type { Vec3 } from "../../contracts/math.ts";
import type { MovementInput, MovementProvider, MovementResult, MovementServices } from "../../contracts/movement.ts";
import type { BotMovementPrediction } from "./q3/navigation-types.ts";
import type { BotTravelPredictionResult } from "./q3/travel/types.ts";

export interface BotMovementProjection {
  readonly provider: MovementProvider;
  readonly services: MovementServices;
  input(previous: MovementResult | null, frame: number, commandMove: Vec3): MovementInput;
  /** Selected character/trigger semantics classify source stop requests from actual movement output. */
  stop(previous: MovementResult | null, result: MovementResult, frame: number): BotMovementStop;
}
export interface BotMovementStop { readonly events: number; readonly origin: Vec3; readonly area: number | null; }

function move(input: MovementInput, projection: BotMovementProjection): MovementResult {
  const provider = projection.provider;
  if (input.execution !== "prediction" || provider.id !== input.profile.id) throw new Error("Bot projection requires the selected provider in prediction mode");
  switch (input.kind) {
    case "q1-netquake": if (provider.kind === input.kind) return provider.move(input, projection.services); break;
    case "q1-quakeworld": if (provider.kind === input.kind) return provider.move(input, projection.services); break;
    case "q2-classic": if (provider.kind === input.kind) return provider.move(input, projection.services); break;
    case "q2-rerelease": if (provider.kind === input.kind) return provider.move(input, projection.services); break;
    case "q3": if (provider.kind === input.kind) return provider.move(input, projection.services); break;
  }
  throw new Error("Bot projection movement input and provider disagree");
}

/** Source prediction requests replay selected movement over detached input; no actor writes or source frame loop. */
export function projectBotMovement(query: BotMovementPrediction, projection: BotMovementProjection): BotTravelPredictionResult {
  let previous: MovementResult | null = null, end = { ...query.origin }, velocity = { ...query.velocity };
  let seconds = 0, frames = 0, stopEvent = 0, grounded = query.onGround, waterLevel = 0;
  let endArea: number | null = null;
  const observation: { trace: BotTravelPredictionResult["trace"] } = { trace: null };
  let bounds: BotTravelPredictionResult["bounds"] = null;
  const scene = projection.services.scene;
  const observed: BotMovementProjection = { ...projection, services: { ...projection.services, scene: {
    trace(request) {
      const result = scene.trace(request);
      observation.trace = { query: request, result };
      return result;
    },
    pointContents: request => scene.pointContents(request),
    boxLeaves: (bounds, limit) => scene.boxLeaves(bounds, limit),
    areasConnected: (first, second) => scene.areasConnected(first, second),
    clusterVisible: (from, to, kind) => scene.clusterVisible(from, to, kind),
  } } };
  const trajectory: Vec3[] = [end], noCommand = { x: 0, y: 0, z: 0 };
  for (let frame = 0; frame < query.maxFrames; frame++) {
    const input = projection.input(previous, frame, frame < query.commandFrames ? query.commandMove : noCommand);
    const elapsed = input.frame.elapsed.kind === "milliseconds" ? input.frame.elapsed.value / 1000 : input.frame.elapsed.value;
    if (!(elapsed > 0)) throw new RangeError("Bot movement projection must advance detached source time");
    const result = move(input, observed);
    if (result.status === "actor-removed") throw new Error("Movement projection attempted to remove the authoritative actor");
    const state = result.state;
    end = state.kind === "q2-classic" ? { x: state.originEighths[0] / 8, y: state.originEighths[1] / 8, z: state.originEighths[2] / 8 } : { ...state.origin };
    velocity = state.kind === "q2-classic" ? { x: state.velocityEighths[0] / 8, y: state.velocityEighths[1] / 8, z: state.velocityEighths[2] / 8 } : { ...state.velocity };
    grounded = result.ground.kind !== "none"; waterLevel = result.waterLevel;
    bounds = result.bounds;
    const stop = projection.stop(previous, result, frame);
    endArea = stop.area;
    stopEvent = stop.events & query.stopEvents;
    if (stopEvent !== 0) end = { ...stop.origin };
    seconds += elapsed; frames++; trajectory.push(end); previous = result;
    if (stopEvent !== 0) break;
  }
  return { end, endArea, velocity, frames, stopEvent, trajectory, seconds, grounded, waterLevel,
    trace: observation.trace, bounds };
}
