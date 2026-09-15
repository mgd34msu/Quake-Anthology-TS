/* Source AI navigation operations over the shared graph and selected movement. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NavigationEstimateResult } from "../../navigation/types.ts";
import { aasAreaTravelFlags, navigationEdgeTravelFlag } from "../../navigation/graph.ts";
import { aasEstimateAreaTime } from "../../navigation/estimate-aas.ts";
import { NavigationRuntime } from "../../navigation/runtime.ts";
import type { BotGoal } from "../library/goals.ts";
import type { BotActionBuffer } from "../library/actions.ts";
import type { ServerTraceResult } from "../../../content/q3/base/world.ts";
import { add3, sub3, length3, scale3, normalize3 } from "../../../core/math.ts";
import type { BotMoveStateStore, BotMoveResult } from "./movement-state.ts";
import type { BotRandom } from "../library/weights.ts";
import { SourceBotTravel } from "./travel/index.ts";
import type { BotTravelPredictionResult, BotTravelModel } from "./travel/types.ts";
import { AlternativeRouteType, RouteStopEvent, TravelType } from "./navigation-types.ts";
import type { AreaTravelTimeQuery, AlternativeGoal, AlternativeRouteQuery, BotMovementPrediction, BotNavigation,
  BotNavigationArea, PredictedRoute, PredictRouteQuery, RouteQuery, RouteResult } from "./navigation-types.ts";

export interface SourceBotNavigationHost {
  readonly runtime: NavigationRuntime;
  forClient(client: number): NavigationRuntime;
  readonly moveStates: BotMoveStateStore;
  readonly actions: BotActionBuffer;
  readonly random: BotRandom;
  readonly crouchedBounds: Bounds;
  time(): number;
  pointContents(point: Vec3): number;
  entityModelIndex(entity: number): number;
  trace(start: Vec3, end: Vec3, bounds: Bounds | null, passEntity: number, mask: number): ServerTraceResult;
  /** Executes the selected actor movement provider on detached state. */
  predictClientMovement(query: BotMovementPrediction): BotTravelPredictionResult;
  modelInfo(model: number): BotTravelModel | null;
  nextEntity(after: number): number;
  entityType(entity: number): number;
  entityWeapon(entity: number): number;
  travelWeapon(client: number, mode: "rocket-jump" | "bfg-jump" | "grapple"): number | null;
}

const f = Math.fround;
const zero = { x: 0, y: 0, z: 0 };
function overlap(a: Bounds, b: Bounds): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}
/** Source area zero remains invalid even when a foreign navigation graph uses node zero. */
export class SourceBotNavigation implements BotNavigation {
  private readonly offset: number;
  private readonly travel: SourceBotTravel;
  private selected: NavigationRuntime | null = null;
  constructor(readonly host: SourceBotNavigationHost) {
    this.offset = host.runtime.graph.asset?.kind === "aas" ? 0 : 1;
    this.travel = new SourceBotTravel({ ...host, navigation: this, runtime: client => host.forClient(client),
      predict: query => host.predictClientMovement(query) });
  }
  private get runtime(): NavigationRuntime { return this.selected ?? this.host.runtime; }
  withClient<T>(client: number, think: () => T): T {
    const previous = this.selected;
    this.selected = this.host.forClient(client);
    try { return think(); } finally { this.selected = previous; }
  }
  get ready(): boolean { return this.runtime.graph.nodes.length > 0; }
  private source(node: number): number { return node + this.offset; }
  private node(area: number): number { return area - this.offset; }
  pointArea(origin: Vec3): number {
    const node = this.runtime.areaAt(origin);
    return node === null ? 0 : this.source(node);
  }
  area(number: number): BotNavigationArea {
    const runtime = this.runtime, node = number === 0 ? null : runtime.node(this.node(number));
    if (node === null) return { contents: 0, flags: 0, presenceType: 0, cluster: 0, reachableAreaCount: 0 };
    const asset = runtime.graph.asset;
    const source = asset?.kind === "aas" && node.source.kind === "aas" ? asset.settings[node.source.area] : undefined;
    return { contents: source?.contents ?? ((node.contents & 1) | ((node.contents & 4) >>> 1) | ((node.contents & 2) << 1)),
      flags: source?.flags ?? node.flags, presenceType: source?.presence ?? node.presence,
      cluster: source?.cluster ?? node.sourceCluster ?? 0, reachableAreaCount: runtime.outgoing(node.id).length };
  }
  bboxAreas(bounds: Bounds): readonly number[] { return this.runtime.bboxAreas(bounds).map(node => this.source(node)); }
  traceAreas(start: Vec3, end: Vec3, maximum: number): readonly { readonly area: number; readonly point: Vec3 }[] {
    return this.runtime.traceAreas(start, end, maximum).map(crossing => ({ ...crossing, area: this.source(crossing.area) }));
  }
  setAreaEnabled(area: number, enabled: boolean): void { if (area !== 0) this.runtime.enableArea(this.node(area), enabled); }
  private selectedEstimate(query: AreaTravelTimeQuery): NavigationEstimateResult {
    if (query.area === 0 || query.goalArea === 0) return { kind: "unreachable" };
    return this.runtime.estimate({ startNode: this.node(query.area), goalNode: this.node(query.goalArea), origin: query.origin, travelFlags: query.travelFlags });
  }
  route(query: RouteQuery): RouteResult {
    const result = this.selectedEstimate(query);
    return result.kind === "unreachable" ? result : { kind: "found", travelTime: result.travelTime,
      nextReachability: result.firstEdge === null ? 0 : result.firstEdge.id + this.offset };
  }
  areaTravelTimeToGoal(query: AreaTravelTimeQuery): number {
    const result = this.selectedEstimate(query); return result.kind === "unreachable" ? 0 : result.travelTime;
  }
  predictRoute(query: PredictRouteQuery): PredictedRoute {
    let area = query.area, origin = query.origin;
    let endArea = query.goalArea, endPosition = query.origin, endTravelFlags = 0, endContents = 0, time = 0;
    const result = (succeeded: boolean, stopEvent = 0): PredictedRoute => ({ succeeded, stopEvent, endArea,
      endPosition, endTravelFlags, time, endContents });
    const initial = this.area(query.area);
    const addTime = (start: Vec3, travelTime: number): void => {
      time += aasEstimateAreaTime({ presence: initial.presenceType, flags: initial.flags }, query.origin, start) + travelTime;
      if (time > 0x7fffffff) throw new RangeError("predicted route time exceeds source int range");
    };
    for (let count = 0; area !== query.goalArea && (query.maximumAreas === 0 || count < query.maximumAreas)
      && count < this.runtime.graph.nodes.length; count++) {
      const selected = this.selectedEstimate({ area, origin, goalArea: query.goalArea, travelFlags: query.travelFlags });
      if (selected.kind === "unreachable" || selected.firstEdge === null) return result(false, RouteStopEvent.NO_ROUTE);
      const edge = selected.firstEdge, flags = navigationEdgeTravelFlag(edge), destination = this.source(edge.to);
      const asset = this.runtime.graph.asset;
      const sourceReach = asset?.kind === "aas" && edge.source.kind === "aas" ? asset.reachability[edge.id] : undefined;
      const travelTime = sourceReach?.travelTime ?? Math.max(1, Math.trunc(f(edge.travelSeconds * 100)));
      if ((query.stopEvent & RouteStopEvent.USE_TRAVEL_TYPE) !== 0) {
        if ((flags & query.stopTravelFlags) !== 0) {
          endArea = area; endContents = this.area(area).contents; endTravelFlags = flags; endPosition = edge.start;
          return result(true, RouteStopEvent.USE_TRAVEL_TYPE);
        }
        const contentsFlags = aasAreaTravelFlags(this.area(destination));
        if ((contentsFlags & query.stopTravelFlags) !== 0) {
          endArea = destination; endContents = this.area(destination).contents; endTravelFlags = contentsFlags; endPosition = edge.end;
          addTime(edge.start, travelTime);
          return result(true, RouteStopEvent.USE_TRAVEL_TYPE);
        }
      }
      let crossed: readonly { readonly area: number; readonly point: Vec3 }[] = [];
      if (sourceReach === undefined) crossed = this.traceAreas(edge.start, edge.end, 32);
      else switch (sourceReach.travelType & 0xffffff) {
        case TravelType.BARRIERJUMP:
        case TravelType.WATERJUMP:
          crossed = this.traceAreas(edge.start, { ...edge.start, z: edge.end.z }, 32); break;
        case TravelType.WALKOFFLEDGE:
          crossed = this.traceAreas({ ...edge.end, z: edge.start.z }, edge.end, 32); break;
        case TravelType.GRAPPLEHOOK:
          crossed = this.traceAreas(edge.start, edge.end, 32); break;
      }
      for (const area of [...crossed.map(value => value.area), destination]) {
        if ((query.stopEvent & RouteStopEvent.ENTER_CONTENTS) !== 0 && (this.area(area).contents & query.stopContents) !== 0) {
          endArea = area; endContents = this.area(area).contents; endPosition = edge.end; addTime(edge.start, travelTime);
          return result(true, RouteStopEvent.ENTER_CONTENTS);
        }
        if ((query.stopEvent & RouteStopEvent.ENTER_AREA) !== 0 && area === query.stopArea) {
          endArea = area; endContents = this.area(area).contents; endPosition = edge.start;
          return result(true, RouteStopEvent.ENTER_AREA);
        }
      }
      addTime(edge.start, travelTime);
      endArea = destination; endContents = this.area(destination).contents; endPosition = edge.end; endTravelFlags = flags;
      area = destination; origin = edge.end;
      if (query.maximumTime !== 0 && time > query.maximumTime) break;
    }
    return result(area === query.goalArea);
  }
  alternativeRouteGoals(query: AlternativeRouteQuery): readonly AlternativeGoal[] {
    if (query.startArea === 0 || query.goalArea === 0) return [];
    const direct = this.areaTravelTimeToGoal({ area: query.startArea, origin: query.start, goalArea: query.goalArea, travelFlags: query.travelFlags });
    const candidates = new Map<number, { start: number; goal: number }>();
    for (const node of this.runtime.graph.nodes) {
      const number = this.source(node.id), area = this.area(number);
      if ((query.type & AlternativeRouteType.ALL) === 0
        && !((query.type & AlternativeRouteType.CLUSTER_PORTALS) !== 0 && (area.contents & 8) !== 0)
        && !((query.type & AlternativeRouteType.VIEW_PORTALS) !== 0 && (area.contents & 512) !== 0)) continue;
      if (area.reachableAreaCount === 0) continue;
      const start = this.areaTravelTimeToGoal({ area: query.startArea, origin: query.start, goalArea: number, travelFlags: query.travelFlags });
      if (start === 0 || start > f(f(1.1) * f(direct))) continue;
      const goal = this.areaTravelTimeToGoal({ area: number, origin: null, goalArea: query.goalArea, travelFlags: query.travelFlags });
      if (goal === 0 || goal > f(f(0.8) * f(direct))) continue;
      candidates.set(number, { start, goal });
    }
    const goals: AlternativeGoal[] = [], visited = new Set<number>();
    for (const [first] of candidates) {
      if (visited.has(first)) continue;
      const cluster: number[] = [], stack = [first];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined || visited.has(current) || !candidates.has(current)) continue;
        visited.add(current); cluster.push(current);
        for (const neighbor of this.neighbors(current).reverse()) stack.push(neighbor);
      }
      let center = { ...zero };
      for (const area of cluster) { const node = this.runtime.node(this.node(area)); if (node !== null) center = add3(center, node.origin); }
      center = scale3(center, 1 / cluster.length);
      let bestArea = first, bestDistance = 999999;
      for (const area of cluster) { const node = this.runtime.node(this.node(area)); if (node === null) continue;
        const distance = length3(sub3(node.origin, center)); if (distance < bestDistance) { bestArea = area; bestDistance = distance; } }
      const node = this.runtime.node(this.node(bestArea)), times = candidates.get(bestArea);
      if (node === null || times === undefined) throw new Error("Alternative route candidate vanished");
      goals.push({ origin: node.origin, area: bestArea, startTravelTime: times.start, goalTravelTime: times.goal,
        extraTravelTime: (times.start + times.goal - direct) & 65535 });
      if (goals.length >= query.maximumGoals) break;
    }
    return goals;
  }
  private neighbors(area: number): number[] {
    const asset = this.runtime.graph.asset;
    if (asset?.kind === "aas") {
      const source = asset.areas[area];
      if (source === undefined) return [];
      const result: number[] = [];
      for (let index = 0; index < source.faceCount; index++) {
        const faceIndex = asset.faceIndexes[source.firstFace + index];
        const face = faceIndex === undefined ? undefined : asset.faces[Math.abs(faceIndex)];
        if (face === undefined) throw new Error("AAS alternative route references an absent face");
        const other = face.frontArea === area ? face.backArea : face.frontArea;
        if (other !== 0) result.push(other);
      }
      return result;
    }
    const result = new Set<number>();
    for (const edge of this.runtime.graph.edges) {
      if (edge.from === this.node(area)) result.add(this.source(edge.to));
      else if (edge.to === this.node(area)) result.add(this.source(edge.from));
    }
    return [...result];
  }
  presenceBounds(presence: 2 | 4): Bounds { return presence === 4 ? this.host.crouchedBounds : this.runtime.graph.profile.shape.bounds; }
  dropToFloor(origin: Vec3, bounds: Bounds): { readonly success: boolean; readonly origin: Vec3 } {
    const trace = this.host.trace(origin, { ...origin, z: origin.z - 100 }, bounds, 0, 1);
    return trace.solidity === "clear" ? { success: true, origin: trace.end } : { success: false, origin };
  }
  bestReachableArea(origin: Vec3, bounds: Bounds): { readonly area: number; readonly origin: Vec3 } {
    let start = origin, area = this.pointArea(start);
    for (let i = 0; i < 5 && area === 0; i++) for (let j = 0; j < 5 && area === 0; j++) {
      for (let k = -1; k <= 1 && area === 0; k++) for (let l = -1; l <= 1 && area === 0; l++) {
        start = { x: origin.x + j * 4 * k, y: origin.y + j * 4 * l, z: origin.z + i * 4 };
        area = this.pointArea(start);
      }
    }
    if (area !== 0) {
      const end = { ...start, z: start.z - 50 };
      start = { ...start, z: start.z + 0.25 };
      const trace = this.host.trace(start, end, this.presenceBounds(4), -1, 1 | 0x10000);
      if (trace.solidity !== "clear") return { area, origin: start };
      area = this.pointArea(trace.end);
      if (area !== 0) return { area, origin: trace.end };
    }
    const areas = this.bboxAreas({ min: add3(origin, bounds.min), max: add3(origin, bounds.max) });
    for (const number of areas) if ((this.area(number).flags & 5) !== 0) return { area: number, origin };
    return { area: areas[0] ?? 0, origin };
  }
  fuzzyPointReachabilityArea(origin: Vec3): number {
    let first = this.pointArea(origin);
    if (first !== 0 && this.area(first).reachableAreaCount !== 0) return first;
    for (const crossing of this.traceAreas(origin, { ...origin, z: origin.z + 4 }, 10)) {
      if (this.area(crossing.area).reachableAreaCount !== 0) return crossing.area;
    }
    let best = 0, distance = 999999;
    for (let z = 1; z >= -1; z--) {
      for (let x = 1; x >= -1; x--) for (let y = 1; y >= -1; y--) {
        for (const crossing of this.traceAreas(origin, { x: origin.x + x * 8, y: origin.y + y * 8, z: origin.z + z * 12 }, 10)) {
          if (this.area(crossing.area).reachableAreaCount !== 0) {
            const candidate = length3(sub3(crossing.point, origin));
            if (candidate < distance) { distance = candidate; best = crossing.area; }
          }
          if (first === 0) first = crossing.area;
        }
      }
      if (best !== 0) return best;
    }
    return first;
  }
  reachabilityArea(origin: Vec3, client: number): number {
    const trace = this.host.trace(origin, { ...origin, z: origin.z - 3 }, this.presenceBounds(4), client, 1 | 0x10000);
    if (trace.solidity === "clear" && trace.fraction < 1 && trace.entityNum !== 1023) {
      if (trace.entityNum === 1022) return this.fuzzyPointReachabilityArea(origin);
      const model = this.host.entityModelIndex(trace.entityNum);
      for (const edge of this.runtime.graph.edges) if (edge.mode === "mover" && edge.entity?.model === model) return this.source(edge.to);
      if (this.swimming(origin)) return this.fuzzyPointReachabilityArea(origin);
      const area = this.fuzzyPointReachabilityArea(origin);
      if (area !== 0 && this.area(area).reachableAreaCount !== 0) return area;
      const floor = this.host.trace(origin, { ...origin, z: origin.z - 800 }, this.presenceBounds(4), -1, 1 | 0x10000);
      return this.fuzzyPointReachabilityArea(floor.solidity !== "clear" ? origin : floor.end);
    }
    return this.fuzzyPointReachabilityArea(origin);
  }
  bestReachableFromJumpPadArea(origin: Vec3, bounds: Bounds): number {
    const target = { min: add3(origin, bounds.min), max: add3(origin, bounds.max) };
    let best = 0, volume = 0;
    for (const edge of this.runtime.graph.edges) {
      if (edge.mode !== "jump-pad") continue;
      const result = this.runtime.world.admit({ from: edge.start, to: edge.end, mode: edge.mode, hint: edge.hint, entity: edge.entity }, this.runtime.graph.profile);
      if (!result.admitted || !result.trajectory.some(point => overlap(target, {
        min: add3(point, this.presenceBounds(4).min), max: add3(point, this.presenceBounds(4).max) }))) continue;
      const area = this.source(edge.from), node = this.runtime.node(edge.from);
      if (node === null) continue;
      const size = sub3(node.bounds.max, node.bounds.min), candidate = f(f(size.x * size.y) * size.z);
      if (candidate >= volume) { best = area; volume = candidate; }
    }
    return best;
  }
  swimming(origin: Vec3): boolean { return (this.host.pointContents(add3(origin, { x: 0, y: 0, z: -2 })) & (8 | 16 | 32)) !== 0; }
  predictClientMovement(query: BotMovementPrediction): { readonly move: { readonly end: Vec3 } } { return { move: { end: this.host.predictClientMovement(query).end } }; }
  moveInDirection(handle: number, direction: Vec3, speed: number, moveType: number): boolean {
    const state = this.host.moveStates.fromHandle(handle);
    return state === null ? false : this.withClient(state.client, () => this.travel.moveInDirection(handle, direction, speed, moveType));
  }
  moveToGoal(result: BotMoveResult, handle: number, goal: BotGoal, travelFlags: number): void {
    const state = this.host.moveStates.fromHandle(handle);
    if (state === null) { result.failure = true; return; }
    this.withClient(state.client, () => this.travel.moveToGoal(result, handle, goal, travelFlags));
  }
  private estimatedPoints(query: RouteQuery): readonly Vec3[] | null {
    const points: Vec3[] = [query.origin], visited = new Set<number>();
    let area = query.area, origin = query.origin;
    while (area !== query.goalArea) {
      const result = this.selectedEstimate({ area, origin, goalArea: query.goalArea, travelFlags: query.travelFlags });
      if (result.kind === "unreachable" || result.firstEdge === null || visited.has(result.firstEdge.id)) return null;
      const edge = result.firstEdge; visited.add(edge.id); points.push(edge.start, edge.end);
      area = this.source(edge.to); origin = edge.end;
    }
    return points;
  }
  movementViewTarget(handle: number, goal: BotGoal, travelFlags: number, lookAhead: number, output: { value: Vec3 }): boolean {
    const state = this.host.moveStates.fromHandle(handle);
    if (state === null) return false;
    const route = this.estimatedPoints({ area: this.pointArea(state.origin), origin: state.origin, goalArea: goal.area, travelFlags });
    if (route === null) return false;
    let start = state.origin, remaining = lookAhead;
    for (const point of [...route, goal.origin]) {
      const delta = sub3(point, start), distance = length3(delta);
      if (distance >= remaining) { output.value = add3(start, scale3(normalize3(delta), remaining)); return true; }
      remaining -= distance; start = point;
    }
    output.value = goal.origin; return true;
  }
  predictVisiblePosition(origin: Vec3, area: number, goal: BotGoal, travelFlags: number, output: { value: Vec3 }): boolean {
    const route = this.estimatedPoints({ area, origin, goalArea: goal.area, travelFlags });
    if (route === null) return false;
    for (const point of route) {
      const trace = this.host.trace(point, goal.origin, null, -1, 1);
      if (trace.fraction === 1 && trace.solidity === "clear") { output.value = point; return true; }
    }
    return false;
  }
}
