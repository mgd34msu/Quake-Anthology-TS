// Movement probes invoke the existing authoritative movement implementation in prediction mode.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { MovementInput, MovementProvider, MovementResult, MovementServices } from "../../contracts/movement.ts";
import type { NavigationProfile, NavigationRoutePrediction, TraversalAdmission, TraversalRequest } from "./types.ts";
import { distance } from "./helpers.ts";

export interface NavigationPrediction {
  readonly provider: MovementProvider;
  readonly services: MovementServices;
  /** Build independent prediction state; never mutate or dispatch contacts to the live actor. */
  input(previous: MovementResult | null, commandIndex: number, request: TraversalRequest): MovementInput;
}
export interface NavigationPredictionDriver {
  begin(request: TraversalRequest, profile: NavigationProfile): NavigationPrediction | null;
}
function step(input: MovementInput, prediction: NavigationPrediction): MovementResult {
  const provider = prediction.provider, services = prediction.services;
  if (input.execution !== "prediction") throw new TypeError("Navigation must use noncommitting movement prediction");
  switch (input.kind) {
    case "q1-netquake": if (provider.kind === input.kind) return provider.move(input, services); break;
    case "q1-quakeworld": if (provider.kind === input.kind) return provider.move(input, services); break;
    case "q2-classic": if (provider.kind === input.kind) return provider.move(input, services); break;
    case "q2-rerelease": if (provider.kind === input.kind) return provider.move(input, services); break;
    case "q3": if (provider.kind === input.kind) return provider.move(input, services); break;
  }
  throw new TypeError("Navigation movement input/provider disagree");
}

export interface NavigationPredictionLimits { readonly maximumSeconds?: number; readonly maximumCommands?: number; readonly tolerance?: number; }

export function createMovementRouteAdmission(driver: NavigationPredictionDriver, profile: NavigationProfile,
  options: NavigationPredictionLimits = {}): NavigationRoutePrediction {
  const maximumSeconds = options.maximumSeconds ?? 8, maximumCommands = options.maximumCommands ?? 512, tolerance = options.tolerance ?? 8;
  if (!Number.isFinite(maximumSeconds) || maximumSeconds <= 0 || !Number.isInteger(maximumCommands) || maximumCommands <= 0 || !Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError("Invalid navigation prediction limits");
  let prediction: NavigationPrediction | null = null, previous: MovementResult | null = null, sequence = 0, failed = false;
  return { admit(request): TraversalAdmission {
    if (failed) throw new Error("Discard a failed navigation prediction before trying another route");
    prediction ??= driver.begin(request, profile);
    if (prediction === null) return { admitted: false, reason: `selected movement cannot predict ${request.mode}` };
    if (prediction.provider.kind !== profile.movement.kind || prediction.provider.id !== profile.movement.id) throw new TypeError("Navigation predictor is not the selected movement provider");
    let seconds = 0;
    const trajectory = [request.from];
    for (let command = 0; command < maximumCommands && seconds < maximumSeconds; command++) {
      const input = prediction.input(previous, sequence++, request);
      if (input.profile !== profile.movement) throw new TypeError("Navigation prediction changed the selected movement profile");
      const elapsed = input.frame.elapsed.kind === "milliseconds" ? input.frame.elapsed.value / 1000 : input.frame.elapsed.value;
      if (!Number.isFinite(elapsed) || elapsed <= 0) throw new RangeError("Navigation prediction must advance source time");
      const result = step(input, prediction);
      if (result.status === "actor-removed") { failed = true; return { admitted: false, reason: "movement removed the predicted actor" }; }
      seconds += elapsed;
      const origin = result.state.kind === "q2-classic" ? { x: result.state.originEighths[0] / 8,
        y: result.state.originEighths[1] / 8, z: result.state.originEighths[2] / 8 } : result.state.origin;
      trajectory.push(origin);
      const grounded = result.ground.kind !== "none" || result.waterLevel > 0 || request.mode === "ladder";
      previous = result;
      if (distance(origin, request.to) <= tolerance && grounded) return { admitted: true, seconds, trajectory };
    }
    failed = true;
    return { admitted: false, reason: `selected movement did not reach the landing within ${maximumSeconds}s/${maximumCommands} commands` };
  } };
}

export function createMovementAdmission(driver: NavigationPredictionDriver, options: NavigationPredictionLimits = {}) {
  return (request: TraversalRequest, profile: NavigationProfile): TraversalAdmission => createMovementRouteAdmission(driver, profile, options).admit(request);
}
