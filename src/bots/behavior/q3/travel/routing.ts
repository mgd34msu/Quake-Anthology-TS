// Source avoid-reach and avoid-spot policy over the one shared navigation router.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { dot3, normalize3, sub3, vec3 } from "../../../../core/math.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { NavigationEdge } from "../../../navigation/types.ts";
import type { NavigationRuntime } from "../../../navigation/runtime.ts";
import type { BotGoal } from "../../library/goals.ts";
import { BotAvoidSpotType, BotMoveResultFlag } from "../movement-state.ts";
import type { BotAvoidSpot, BotMoveState } from "../movement-state.ts";
import { TravelFlags, TravelType, travelFlagForType } from "../navigation-types.ts";
import type { TravelReachability as AasReachability } from "./types.ts";
const f = Math.fround;
const axes: readonly (keyof Vec3)[] = ["x", "y", "z"];
const discontinuousTravel: readonly number[] = [TravelType.WALKOFFLEDGE, TravelType.JUMP, TravelType.TELEPORT, TravelType.ELEVATOR,
  TravelType.GRAPPLEHOOK, TravelType.ROCKETJUMP, TravelType.BFGJUMP, TravelType.JUMPPAD, TravelType.FUNCBOB];
function at<T>(values: readonly T[], index: number): T {
  const value = values[index]; if (value === undefined) throw new RangeError(`Bot movement index ${index} outside ${values.length} entries`); return value;
}
function ma(start: Vec3, distance: number, direction: Vec3): Vec3 {
  return vec3(start.x + f(distance * direction.x), start.y + f(distance * direction.y), start.z + f(distance * direction.z));
}
export function movementAngleDifference(first: number, second: number): number {
  first = f(first); second = f(second); let difference = f(first - second);
  if (first > second) { if (difference > 180) difference = f(difference - 360); }
  else if (difference < -180) difference = f(difference + 360);
  return difference;
}
export function movementDistanceSquared(first: Vec3, second: Vec3): number { const direction = sub3(second, first); return dot3(direction, direction); }
export function distanceFromLineSquared(point: Vec3, start: Vec3, end: Vec3): number {
  // AAS_ProjectPointOntoVector, followed by the source's first-outside-axis endpoint choice.
  const direction = normalize3(sub3(end, start)), projection = ma(start, dot3(sub3(point, start), direction), direction);
  for (const axis of axes) {
    if ((projection[axis] > start[axis] && projection[axis] > end[axis]) || (projection[axis] < start[axis] && projection[axis] < end[axis])) {
      return movementDistanceSquared(point, Math.abs(f(projection[axis] - start[axis])) < Math.abs(f(projection[axis] - end[axis])) ? start : end);
    }
  }
  return movementDistanceSquared(point, projection);
}

export function avoidMovementSpots(origin: Vec3, reach: AasReachability, spots: readonly BotAvoidSpot[], count: number): number {
  const type = reach.travelType & TravelType.MASK;
  const checkBetween = !discontinuousTravel.includes(type);
  let result: number = BotAvoidSpotType.CLEAR;
  for (let index = 0; index < count; index++) {
    const spot = at(spots, index), squaredRadius = f(spot.radius * spot.radius);
    let squaredDistance = distanceFromLineSquared(spot.origin, origin, reach.start);
    if (squaredDistance < squaredRadius && movementDistanceSquared(spot.origin, origin) > squaredDistance) result = spot.type;
    else if (checkBetween) {
      squaredDistance = distanceFromLineSquared(spot.origin, reach.start, reach.end);
      if (squaredDistance < squaredRadius && movementDistanceSquared(spot.origin, reach.start) > squaredDistance) result = spot.type;
    } else {
      // Source discards this result; the following comparison still uses origin→start distance.
      movementDistanceSquared(spot.origin, reach.end);
      if (squaredDistance < squaredRadius && movementDistanceSquared(spot.origin, reach.start) > squaredDistance) result = spot.type;
    }
    if (result === BotAvoidSpotType.ALWAYS) return result;
  }
  return result;
}

function sourceType(edge: NavigationEdge): number {
  if (edge.source.kind === "aas") return edge.sourceTravelType;
  switch (edge.mode) {
    case "walk": return TravelType.WALK;
    case "crouch": return TravelType.CROUCH;
    case "jump": return edge.sourceTravelType === 5 || edge.sourceTravelType === 11 ? TravelType.BARRIERJUMP : TravelType.JUMP;
    case "drop": return TravelType.WALKOFFLEDGE;
    case "swim": return TravelType.SWIM;
    case "water-jump": return TravelType.WATERJUMP;
    case "ladder": return TravelType.LADDER;
    case "teleport": return TravelType.TELEPORT;
    case "mover": return TravelType.ELEVATOR;
    case "jump-pad": return TravelType.JUMPPAD;
    case "grapple": return TravelType.GRAPPLEHOOK;
    case "rocket-jump": return TravelType.ROCKETJUMP;
    case "bfg-jump": return TravelType.BFGJUMP;
    case "double-jump": return TravelType.DOUBLEJUMP;
    case "ramp-jump": return TravelType.RAMPJUMP;
    case "strafe-jump": return TravelType.STRAFEJUMP;
    case "unknown": return TravelType.INVALID;
  }
}

/** Source handles keep zero invalid while the shared foreign graph may use node/edge zero. */
export class TravelGraph {
  readonly offset: number;
  constructor(readonly runtime: NavigationRuntime) { this.offset = runtime.graph.asset?.kind === "aas" ? 0 : 1; }
  area(node: number): number { return node + this.offset; }
  node(area: number): number { return area - this.offset; }
  handle(edge: NavigationEdge): number { return edge.id + this.offset; }
  reach(number: number): AasReachability | null {
    if (number === 0) return null;
    const edge = this.runtime.graph.edges.find(candidate => this.handle(candidate) === number);
    return edge === undefined ? null : this.describe(edge);
  }
  describe(edge: NavigationEdge): AasReachability {
    const asset = this.runtime.graph.asset, record = asset?.kind === "aas" ? asset.reachability[edge.id] : undefined;
    return { area: this.area(edge.to), face: record?.face ?? edge.entity?.model ?? 0,
      edge: record?.edge ?? Math.trunc(edge.end.z - edge.start.z), start: edge.start, end: edge.end,
      travelType: sourceType(edge), travelTime: record?.travelTime ?? Math.max(1, Math.trunc(edge.travelSeconds * 100)),
      padding: record?.padding ?? 0, graphEdge: edge };
  }
  outgoing(area: number): readonly AasReachability[] { return this.runtime.outgoing(this.node(area)).map(edge => this.describe(edge)); }
  select(state: BotMoveState, goal: BotGoal, travelFlags: number, moveTravelFlags = travelFlags): { readonly reachability: number; readonly flags: number } {
    let flags = 0;
    const asset = this.runtime.graph.asset;
    if (asset?.kind === "aas" && (((asset.settings[state.area]?.contents ?? 0) | (asset.settings[goal.area]?.contents ?? 0)) & 256) !== 0) {
      travelFlags |= TravelFlags.DONOTENTER; moveTravelFlags |= TravelFlags.DONOTENTER;
    }
    const candidates: { readonly edge: NavigationEdge; readonly time: number }[] = [];
    for (const edge of this.runtime.outgoing(this.node(state.area))) {
      const reach = this.describe(edge), number = this.handle(edge);
      if ((travelFlagForType(reach.travelType) & travelFlags) === 0 || (travelFlagForType(reach.travelType) & moveTravelFlags) === 0) continue;
      if (state.avoidReach[0] === number && state.avoidReachTimes[0] >= this.time && state.avoidReachTries[0] > 4) continue;
      if (state.lastGoalArea === goal.area && reach.area === state.lastArea) continue;
      const tail = this.runtime.estimate({ startNode: edge.to, goalNode: this.node(goal.area), origin: reach.end, travelFlags });
      if (tail.kind === "unreachable" || tail.travelTime === 0) continue;
      if (avoidMovementSpots(state.origin, reach, state.avoidSpots, state.numAvoidSpots) !== 0) {
        flags |= BotMoveResultFlag.BLOCKEDBYAVOIDSPOT; continue;
      }
      candidates.push({ edge, time: (tail.travelTime + reach.travelTime) | 0 });
    }
    candidates.sort((first, second) => first.time - second.time);
    for (const candidate of candidates) {
      if (this.runtime.admitEdge(candidate.edge, state.origin).admitted) return { reachability: this.handle(candidate.edge), flags };
    }
    return { reachability: 0, flags };
  }
  time = 0;
}
