import type { Vec3 } from "../../contracts/math.ts";
import type { NavigationEdge, NavigationEntityState, NavigationProfile } from "./types.ts";
type Train = NonNullable<NavigationEntityState["train"]>;
export interface NavigationTrainRide {
  readonly boarding: Train["stops"][number];
  readonly arrival: Train["stops"][number];
}
function supports(state: NavigationEntityState, train: Train, stop: Train["stops"][number], point: Vec3, profile: NavigationProfile): boolean {
  const x = stop.origin.x - train.origin.x, y = stop.origin.y - train.origin.y, z = stop.origin.z - train.origin.z;
  const bounds = profile.shape.bounds;
  return point.x + bounds.max.x > state.bounds.min.x + x && point.x + bounds.min.x < state.bounds.max.x + x
    && point.y + bounds.max.y > state.bounds.min.y + y && point.y + bounds.min.y < state.bounds.max.y + y
    && Math.abs(point.z + bounds.min.z - (state.bounds.max.z + z)) <= profile.maximumStep;
}
/** A ride is a directed source route, including waits and teleport corners, rather than a line to a mover's current destination. */
export function navigationTrainRide(state: NavigationEntityState, edge: NavigationEdge, profile: NavigationProfile): NavigationTrainRide | null {
  const train = state.train;
  if (train === undefined || !state.enabled || state.locked || !profile.capabilities.has("mover")) return null;
  const boarding = train.stops.find(stop => !stop.teleport && supports(state, train, stop, edge.start, profile));
  const arrival = train.stops.find(stop => !stop.teleport && supports(state, train, stop, edge.end, profile));
  if (boarding === undefined || arrival === undefined || boarding.id === arrival.id) return null;
  const visited = new Set<number>();
  let current: Train["stops"][number] | undefined = boarding;
  while (current !== undefined && !visited.has(current.id)) {
    if (current.id === arrival.id) return { boarding, arrival };
    if (current.wait < 0 || current.teleport) return null;
    visited.add(current.id);
    current = train.stops.find(stop => stop.id === current?.next);
  }
  return null;
}
