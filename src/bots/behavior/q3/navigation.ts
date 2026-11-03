// SPDX-License-Identifier: GPL-2.0-or-later
/* Source AI navigation operations over the shared graph and selected movement. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NavigationEstimateResult } from "../../navigation/types.ts";
import { aasAreaTravelFlags, navigationEdgeTravelFlag } from "../../navigation/graph.ts";
import { aasEstimateAreaTime } from "../../navigation/estimate-aas.ts";
import { NavigationRuntime } from "../../navigation/runtime.ts";
import { aasTraceClientBBox } from "../../navigation/aas.ts";
import type { BotGoal } from "../library/goals.ts";
import type { BotActionBuffer } from "../library/actions.ts";
import type { ServerTraceResult } from "../../../content/q3/base/world.ts";
import { add3, sub3, length3, scale3, normalize3, vec3 } from "../../../core/math.ts";
import { nativeAtoi } from "../../../core/numeric.ts";
import type { AasBspEntities } from "../library/bsp-entities.ts";
import type { BotMoveStateStore, BotMoveResult } from "./movement-state.ts";
import type { BotRandom } from "../library/weights.ts";
import { SourceBotTravel } from "./travel/index.ts";
import { TravelGraph } from "./travel/routing.ts";
import type { BotTravelPredictionResult, BotTravelModel } from "./travel/types.ts";
import { AlternativeRouteType, RouteStopEvent, TravelType } from "./navigation-types.ts";
import type {
  AreaTravelTimeQuery,
  AlternativeGoal,
  AlternativeRouteQuery,
  BotMovementPrediction,
  BotNavigation,
  BotNavigationArea,
  PredictedRoute,
  PredictRouteQuery,
  RouteQuery,
  RouteResult,
} from "./navigation-types.ts";

export interface SourceBotNavigationHost {
  readonly runtime: NavigationRuntime;
  readonly bspEntities: AasBspEntities;
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
  /** Absolute bounds of a brush model, including models the game never sends to the bots. */
  modelBounds(model: number): Bounds | null;
  modelInfo(model: number): BotTravelModel | null;
  nextEntity(after: number): number;
  entityType(entity: number): number;
  entityWeapon(entity: number): number;
  travelWeapon(client: number, mode: "rocket-jump" | "bfg-jump" | "grapple"): number | null;
}

const f = Math.fround;
const zero = { x: 0, y: 0, z: 0 };
/** Source area zero remains invalid even when a foreign navigation graph uses node zero. */
export class SourceBotNavigation implements BotNavigation {
  private readonly offset: number;
  private readonly travel: SourceBotTravel;
  private selected: NavigationRuntime | null = null;
  constructor(readonly host: SourceBotNavigationHost) {
    this.offset = host.runtime.graph.asset?.kind === "aas" ? 0 : 1;
    this.travel = new SourceBotTravel({
      ...host,
      navigation: this,
      runtime: client => host.forClient(client),
      predict: query => host.predictClientMovement(query),
    });
  }
  private get runtime(): NavigationRuntime {
    return this.selected ?? this.host.runtime;
  }
  withClient<T>(client: number, think: () => T): T {
    const previous = this.selected;
    this.selected = this.host.forClient(client);
    try {
      return think();
    } finally {
      this.selected = previous;
    }
  }
  get ready(): boolean {
    return this.runtime.graph.nodes.length > 0;
  }
  private source(node: number): number {
    return node + this.offset;
  }
  private node(area: number): number {
    return area - this.offset;
  }
  pointArea(origin: Vec3): number {
    const node = this.runtime.areaAt(origin);
    return node === null ? 0 : this.source(node);
  }
  area(number: number): BotNavigationArea {
    const runtime = this.runtime,
      node = number === 0 ? null : runtime.node(this.node(number));
    if (node === null) return { contents: 0, flags: 0, presenceType: 0, cluster: 0, reachableAreaCount: 0 };
    const asset = runtime.graph.asset;
    const source = asset?.kind === "aas" && node.source.kind === "aas" ? asset.settings[node.source.area] : undefined;
    return {
      contents: source?.contents ?? (node.contents & 1) | ((node.contents & 4) >>> 1) | ((node.contents & 2) << 1),
      flags: source?.flags ?? node.flags,
      presenceType: source?.presence ?? node.presence,
      cluster: source?.cluster ?? node.sourceCluster ?? 0,
      reachableAreaCount: runtime.outgoing(node.id).length,
    };
  }
  bboxAreas(bounds: Bounds): readonly number[] {
    return this.runtime.bboxAreas(bounds).map(node => this.source(node));
  }
  traceAreas(start: Vec3, end: Vec3, maximum: number): readonly { readonly area: number; readonly point: Vec3 }[] {
    return this.runtime.traceAreas(start, end, maximum).map(crossing => ({ ...crossing, area: this.source(crossing.area) }));
  }
  setAreaEnabled(area: number, enabled: boolean): void {
    if (area !== 0) this.runtime.enableArea(this.node(area), enabled);
  }
  private selectedEstimate(query: AreaTravelTimeQuery): NavigationEstimateResult {
    // AAS_AreaRouteToGoalArea answers 1 for equal areas before it range-tests either.
    if (query.area === query.goalArea && this.runtime.graph.asset?.kind === "aas") return { kind: "estimate", travelTime: 1, firstEdge: null };
    if (query.area === 0 || query.goalArea === 0) return { kind: "unreachable" };
    return this.runtime.estimate({
      startNode: this.node(query.area),
      goalNode: this.node(query.goalArea),
      origin: query.origin,
      travelFlags: query.travelFlags,
    });
  }
  route(query: RouteQuery): RouteResult {
    const result = this.selectedEstimate(query);
    return result.kind === "unreachable"
      ? result
      : { kind: "found", travelTime: result.travelTime, nextReachability: result.firstEdge === null ? 0 : result.firstEdge.id + this.offset };
  }
  areaTravelTimeToGoal(query: AreaTravelTimeQuery): number {
    const result = this.selectedEstimate(query);
    return result.kind === "unreachable" ? 0 : result.travelTime;
  }
  predictRoute(query: PredictRouteQuery): PredictedRoute {
    let area = query.area,
      origin = query.origin;
    let endArea = query.goalArea,
      endPosition = query.origin,
      endTravelFlags = 0,
      endContents = 0,
      time = 0;
    const result = (succeeded: boolean, stopEvent = 0): PredictedRoute => ({ succeeded, stopEvent, endArea, endPosition, endTravelFlags, time, endContents });
    const initial = this.area(query.area);
    const addTime = (start: Vec3, travelTime: number): void => {
      time += aasEstimateAreaTime({ presence: initial.presenceType, flags: initial.flags }, query.origin, start) + travelTime;
      if (time > 0x7fffffff) throw new RangeError("predicted route time exceeds source int range");
    };
    for (
      let count = 0;
      area !== query.goalArea && (query.maximumAreas === 0 || count < query.maximumAreas) && count < this.runtime.graph.nodes.length;
      count++
    ) {
      const selected = this.selectedEstimate({ area, origin, goalArea: query.goalArea, travelFlags: query.travelFlags });
      if (selected.kind === "unreachable" || selected.firstEdge === null) return result(false, RouteStopEvent.NO_ROUTE);
      const edge = selected.firstEdge,
        flags = navigationEdgeTravelFlag(edge),
        destination = this.source(edge.to);
      const asset = this.runtime.graph.asset;
      const sourceReach = asset?.kind === "aas" && edge.source.kind === "aas" ? asset.reachability[edge.id] : undefined;
      const travelTime = sourceReach?.travelTime ?? Math.max(1, Math.trunc(f(edge.travelSeconds * 100)));
      if ((query.stopEvent & RouteStopEvent.USE_TRAVEL_TYPE) !== 0) {
        if ((flags & query.stopTravelFlags) !== 0) {
          endArea = area;
          endContents = this.area(area).contents;
          endTravelFlags = flags;
          endPosition = edge.start;
          return result(true, RouteStopEvent.USE_TRAVEL_TYPE);
        }
        const contentsFlags = aasAreaTravelFlags(this.area(destination));
        if ((contentsFlags & query.stopTravelFlags) !== 0) {
          endArea = destination;
          endContents = this.area(destination).contents;
          endTravelFlags = contentsFlags;
          endPosition = edge.end;
          addTime(edge.start, travelTime);
          return result(true, RouteStopEvent.USE_TRAVEL_TYPE);
        }
      }
      let crossed: readonly { readonly area: number; readonly point: Vec3 }[] = [];
      if (sourceReach === undefined) crossed = this.traceAreas(edge.start, edge.end, 32);
      else
        switch (sourceReach.travelType & 0xffffff) {
          case TravelType.BARRIERJUMP:
          case TravelType.WATERJUMP:
            crossed = this.traceAreas(edge.start, { ...edge.start, z: edge.end.z }, 32);
            break;
          case TravelType.WALKOFFLEDGE:
            crossed = this.traceAreas({ ...edge.end, z: edge.start.z }, edge.end, 32);
            break;
          case TravelType.GRAPPLEHOOK:
            crossed = this.traceAreas(edge.start, edge.end, 32);
            break;
        }
      for (const area of [...crossed.map(value => value.area), destination]) {
        if ((query.stopEvent & RouteStopEvent.ENTER_CONTENTS) !== 0 && (this.area(area).contents & query.stopContents) !== 0) {
          endArea = area;
          endContents = this.area(area).contents;
          endPosition = edge.end;
          addTime(edge.start, travelTime);
          return result(true, RouteStopEvent.ENTER_CONTENTS);
        }
        if ((query.stopEvent & RouteStopEvent.ENTER_AREA) !== 0 && area === query.stopArea) {
          endArea = area;
          endContents = this.area(area).contents;
          endPosition = edge.start;
          return result(true, RouteStopEvent.ENTER_AREA);
        }
      }
      addTime(edge.start, travelTime);
      endArea = destination;
      endContents = this.area(destination).contents;
      endPosition = edge.end;
      endTravelFlags = flags;
      area = destination;
      origin = edge.end;
      if (query.maximumTime !== 0 && time > query.maximumTime) break;
    }
    return result(area === query.goalArea);
  }
  alternativeRouteGoals(query: AlternativeRouteQuery): readonly AlternativeGoal[] {
    if (query.startArea === 0 || query.goalArea === 0) return [];
    const direct = this.areaTravelTimeToGoal({ area: query.startArea, origin: query.start, goalArea: query.goalArea, travelFlags: query.travelFlags });
    const candidates = new Map<number, { start: number; goal: number }>();
    for (const node of this.runtime.graph.nodes) {
      const number = this.source(node.id),
        area = this.area(number);
      if (
        (query.type & AlternativeRouteType.ALL) === 0 &&
        !((query.type & AlternativeRouteType.CLUSTER_PORTALS) !== 0 && (area.contents & 8) !== 0) &&
        !((query.type & AlternativeRouteType.VIEW_PORTALS) !== 0 && (area.contents & 512) !== 0)
      )
        continue;
      if (area.reachableAreaCount === 0) continue;
      const start = this.areaTravelTimeToGoal({ area: query.startArea, origin: query.start, goalArea: number, travelFlags: query.travelFlags });
      if (start === 0 || start > f(f(1.1) * f(direct))) continue;
      const goal = this.areaTravelTimeToGoal({ area: number, origin: null, goalArea: query.goalArea, travelFlags: query.travelFlags });
      if (goal === 0 || goal > f(f(0.8) * f(direct))) continue;
      candidates.set(number, { start, goal });
    }
    const goals: AlternativeGoal[] = [],
      visited = new Set<number>();
    for (const [first] of candidates) {
      if (visited.has(first)) continue;
      const cluster: number[] = [],
        stack = [first];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined || visited.has(current) || !candidates.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        for (const neighbor of this.neighbors(current).reverse()) stack.push(neighbor);
      }
      const centerOf = (area: number): Vec3 | null => {
        const asset = this.runtime.graph.asset,
          node = this.runtime.node(this.node(area));
        return asset?.kind === "aas" ? (asset.areas[area]?.center ?? null) : (node?.origin ?? null);
      };
      let center = { ...zero };
      for (const area of cluster) {
        const origin = centerOf(area);
        if (origin !== null) center = add3(center, origin);
      }
      center = scale3(center, 1 / cluster.length);
      let bestArea = first,
        bestDistance = 999999;
      for (const area of cluster) {
        const origin = centerOf(area);
        if (origin === null) continue;
        const distance = length3(sub3(origin, center));
        if (distance < bestDistance) {
          bestArea = area;
          bestDistance = distance;
        }
      }
      const origin = centerOf(bestArea),
        times = candidates.get(bestArea);
      if (origin === null || times === undefined) throw new Error("Alternative route candidate vanished");
      goals.push({
        origin,
        area: bestArea,
        startTravelTime: times.start,
        goalTravelTime: times.goal,
        extraTravelTime: (times.start + times.goal - direct) & 65535,
      });
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
  presenceBounds(presence: 2 | 4): Bounds {
    return presence === 4 ? this.host.crouchedBounds : this.runtime.graph.profile.shape.bounds;
  }
  dropToFloor(origin: Vec3, bounds: Bounds): { readonly success: boolean; readonly origin: Vec3 } {
    const trace = this.host.trace(origin, { ...origin, z: origin.z - 100 }, bounds, 0, 1);
    return trace.solidity === "clear" ? { success: true, origin: trace.end } : { success: false, origin };
  }
  bestReachableArea(origin: Vec3, bounds: Bounds): { readonly area: number; readonly origin: Vec3 } {
    let start = origin,
      area = this.pointArea(start);
    const queried = new Set<string>([`${origin.x},${origin.y},${origin.z}`]);
    for (let i = 0; i < 5 && area === 0; i++)
      for (let j = 0; j < 5 && area === 0; j++) {
        for (let k = -1; k <= 1 && area === 0; k++)
          for (let l = -1; l <= 1 && area === 0; l++) {
            start = { x: origin.x + j * 4 * k, y: origin.y + j * 4 * l, z: origin.z + i * 4 };
            const key = `${start.x},${start.y},${start.z}`;
            if (queried.has(key)) continue;
            queried.add(key);
            area = this.pointArea(start);
          }
      }
    if (area !== 0) {
      const end = { ...start, z: start.z - 50 };
      start = { ...start, z: start.z + 0.25 };
      // AAS_TraceClientBBox walks the area tree and ignores entities, so a door or plat linked over the floor cannot change the answer.
      const asset = this.runtime.graph.asset;
      const trace = asset?.kind === "aas" ? aasTraceClientBBox(asset, start, end, 4) : null;
      const floor = trace !== null ? (trace.startSolid ? null : trace.end) : this.floorBelow(start, end);
      if (floor === null) return { area, origin: start };
      area = this.pointArea(floor);
      if (area !== 0) return { area, origin: floor };
    }
    // AAS_LinkEntityClientBBox grows the box by the crouch hull, so a box that touches no area itself still finds one.
    const hull = this.presenceBounds(4);
    const areas = this.bboxAreas({ min: sub3(add3(origin, bounds.min), hull.max), max: sub3(add3(origin, bounds.max), hull.min) });
    for (const number of areas) if ((this.area(number).flags & 5) !== 0) return { area: number, origin };
    return { area: areas[0] ?? 0, origin };
  }
  /** The hull-sized drop for graphs with no area tree to walk; null when the start is solid. */
  private floorBelow(start: Vec3, end: Vec3): Vec3 | null {
    const trace = this.host.trace(start, end, this.presenceBounds(4), -1, 1 | 0x10000);
    return trace.solidity === "clear" ? trace.end : null;
  }
  fuzzyPointReachabilityArea(origin: Vec3): number {
    let first = this.pointArea(origin);
    if (first !== 0 && this.area(first).reachableAreaCount !== 0) return first;
    for (const crossing of this.traceAreas(origin, { ...origin, z: origin.z + 4 }, 10)) {
      if (this.area(crossing.area).reachableAreaCount !== 0) return crossing.area;
    }
    let best = 0,
      distance = 999999;
    for (let z = 1; z >= -1; z--) {
      for (let x = 1; x >= -1; x--)
        for (let y = 1; y >= -1; y--) {
          for (const crossing of this.traceAreas(origin, { x: origin.x + x * 8, y: origin.y + y * 8, z: origin.z + z * 12 }, 10)) {
            if (this.area(crossing.area).reachableAreaCount !== 0) {
              const candidate = length3(sub3(crossing.point, origin));
              if (candidate < distance) {
                distance = candidate;
                best = crossing.area;
              }
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
      const mover = this.runtime.moverEdge(model);
      if (mover !== null) return this.source(mover.to);
      if (this.swimming(origin)) return this.fuzzyPointReachabilityArea(origin);
      const area = this.fuzzyPointReachabilityArea(origin);
      if (area !== 0 && this.area(area).reachableAreaCount !== 0) return area;
      const floor = this.host.trace(origin, { ...origin, z: origin.z - 800 }, this.presenceBounds(4), -1, 1 | 0x10000);
      return this.fuzzyPointReachabilityArea(floor.solidity !== "clear" ? origin : floor.end);
    }
    return this.fuzzyPointReachabilityArea(origin);
  }
  /** AAS_GetJumpPadInfo for one trigger_push: the launch point on the floor of its brush, the brush bounds and the launch velocity toward its target. */
  private jumpPadInfo(entity: number): { readonly start: Vec3; readonly bounds: Bounds; readonly velocity: Vec3 } | null {
    const entities = this.host.bspEntities,
      text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes.subarray(0, Math.max(0, bytes.indexOf(0))));
    const model = new Uint8Array(128),
      target = new Uint8Array(128),
      name = new Uint8Array(128);
    entities.value(entity, "model", model);
    const bounds = this.host.modelBounds(model[0] === 0 ? 0 : nativeAtoi(text(model).slice(1)));
    if (bounds === null) return null;
    const center = scale3(add3(bounds.min, bounds.max), 0.5);
    const floor = this.host.trace(vec3(center.x, center.y, center.z + 64), center, this.presenceBounds(4), -1, 1 | 0x10000);
    const bottom = floor.solidity !== "clear" ? center : floor.end,
      start = vec3(bottom.x, bottom.y, bottom.z + 0.125);
    entities.value(entity, "target", target);
    const targetName = text(target);
    let destination = entities.nextEntity(0);
    for (; destination !== 0; destination = entities.nextEntity(destination))
      if (entities.value(destination, "targetname", name) && text(name) === targetName) break;
    if (destination === 0) return null;
    const gravity = this.host.moveStates.svGravity?.value ?? 800,
      point = entities.vector(destination, "origin").value;
    const time = f(Math.sqrt(f(f(point.z - center.z) / f(0.5 * gravity))));
    if (!(time > 0)) return null;
    const delta = sub3(point, center),
      push = scale3(normalize3(delta), f(f(length3(delta) / time) * f(1.1)));
    return { start, bounds, velocity: vec3(push.x, push.y, f(time * gravity)) };
  }
  /** AAS_BestReachableFromJumpPadArea: the largest jump-pad area of the first trigger_push whose launch flight hits the item box. */
  bestReachableFromJumpPadArea(origin: Vec3, bounds: Bounds): number {
    const entities = this.host.bspEntities,
      box = { min: add3(origin, bounds.min), max: add3(origin, bounds.max) },
      hull = this.presenceBounds(4);
    const classname = new Uint8Array(128);
    for (let entity = entities.nextEntity(0); entity !== 0; entity = entities.nextEntity(entity)) {
      if (
        !entities.value(entity, "classname", classname) ||
        new TextDecoder().decode(classname.subarray(0, Math.max(0, classname.indexOf(0)))) !== "trigger_push"
      )
        continue;
      const pad = this.jumpPadInfo(entity);
      if (pad === null) continue;
      const areas = this.bboxAreas({ min: sub3(pad.bounds.min, hull.max), max: sub3(pad.bounds.max, hull.min) }).filter(
        area => (this.area(area).contents & 128) !== 0,
      );
      if (areas.length === 0) continue;
      const move = this.host.predictClientMovement({
        entityNum: -1,
        origin: pad.start,
        presence: 2,
        onGround: false,
        velocity: pad.velocity,
        commandMove: vec3(pad.velocity.x, pad.velocity.y, 0),
        commandFrames: 0,
        maxFrames: 30,
        frameTime: f(0.1),
        stopEvents: 2048,
        stopArea: 0,
        hitBox: box,
        visualize: false,
      });
      if ((move.stopEvent & 2048) === 0) continue;
      // The loaded graph keeps area boxes but not the faces AAS_AreaVolume sums, so the box volume ranks the pad areas.
      let best = 0,
        volume = 0;
      for (const area of areas) {
        const node = this.runtime.node(this.node(area));
        if (node === null) continue;
        const size = sub3(node.bounds.max, node.bounds.min),
          candidate = f(f(size.x * size.y) * size.z);
        if (candidate >= volume) {
          best = area;
          volume = candidate;
        }
      }
      return best;
    }
    return 0;
  }
  swimming(origin: Vec3): boolean {
    return (this.host.pointContents(add3(origin, { x: 0, y: 0, z: -2 })) & (8 | 16 | 32)) !== 0;
  }
  predictClientMovement(query: BotMovementPrediction): { readonly move: { readonly end: Vec3 } } {
    return { move: { end: this.host.predictClientMovement(query).end } };
  }
  moveInDirection(handle: number, direction: Vec3, speed: number, moveType: number): boolean {
    const state = this.host.moveStates.fromHandle(handle);
    return state === null ? false : this.withClient(state.client, () => this.travel.moveInDirection(handle, direction, speed, moveType));
  }
  moveToGoal(result: BotMoveResult, handle: number, goal: BotGoal, travelFlags: number): void {
    const state = this.host.moveStates.fromHandle(handle);
    if (state === null) {
      result.failure = true;
      return;
    }
    this.withClient(state.client, () => this.travel.moveToGoal(result, handle, goal, travelFlags));
  }
  /** BotAddToTarget: walks `start` to `end` while the look-ahead budget lasts and reports whether the budget ran out. */
  private addToTarget(start: Vec3, end: Vec3, maximum: number, travelled: { value: number }, target: { value: Vec3 }): boolean {
    const direction = sub3(end, start),
      length = length3(direction),
      unit = normalize3(direction);
    if (f(travelled.value + length) < maximum) {
      target.value = end;
      travelled.value = f(travelled.value + length);
      return false;
    }
    target.value = add3(start, scale3(unit, f(maximum - travelled.value)));
    travelled.value = maximum;
    return true;
  }
  movementViewTarget(handle: number, goal: BotGoal, travelFlags: number, lookAhead: number, output: { value: Vec3 }): boolean {
    const state = this.host.moveStates.fromHandle(handle);
    if (state === null || state.lastReachability === 0) return false;
    const graph = new TravelGraph(this.runtime);
    graph.time = f(this.host.time());
    const travelled = { value: 0 };
    let end = state.origin,
      number = state.lastReachability;
    while (number !== 0 && travelled.value < lookAhead) {
      const reach = graph.reach(number);
      if (reach === null) break;
      if (this.addToTarget(end, reach.start, lookAhead, travelled, output)) return true;
      const type = reach.travelType & TravelType.MASK;
      // Never look beyond a teleporter or a weapon jump.
      if (type === TravelType.TELEPORT || type === TravelType.ROCKETJUMP || type === TravelType.BFGJUMP) return true;
      if (
        type !== TravelType.JUMPPAD &&
        type !== TravelType.ELEVATOR &&
        type !== TravelType.FUNCBOB &&
        this.addToTarget(reach.start, reach.end, lookAhead, travelled, output)
      )
        return true;
      number = graph.select(state, goal, travelFlags, travelFlags, {
        area: reach.area,
        origin: reach.end,
        lastGoalArea: state.lastGoalArea,
        lastArea: state.lastArea,
        avoid: state,
      }).reachability;
      end = reach.end;
    }
    return false;
  }
  predictVisiblePosition(origin: Vec3, area: number, goal: BotGoal, travelFlags: number, output: { value: Vec3 }): boolean {
    if (area === 0) return false;
    if (area === goal.area) {
      output.value = goal.origin;
      return true;
    }
    const graph = new TravelGraph(this.runtime);
    graph.time = f(this.host.time());
    const start = (position: Vec3, areaNumber: number) =>
      graph.select(null, goal, travelFlags, travelFlags, { area: areaNumber, origin: position, lastGoalArea: -1, lastArea: -1, avoid: null }).reachability;
    let number = start(origin, area);
    for (let hop = 0; hop < 20 && number !== 0; hop++) {
      const reach = graph.reach(number);
      if (reach === null) break;
      if (reach.area === goal.area) {
        output.value = reach.end;
        return true;
      }
      const trace = this.host.trace(reach.end, goal.origin, null, -1, 1);
      if (trace.fraction === 1 && trace.solidity === "clear") {
        output.value = reach.end;
        return true;
      }
      number = start(reach.end, reach.area);
    }
    return false;
  }
}
