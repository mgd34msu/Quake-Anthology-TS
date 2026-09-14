// Directed source reachabilities, NAV conditional-node checks, and movement-backed route admission.
// SPDX-License-Identifier: GPL-2.0-or-later
import { SaveReader } from "../../persistence/value.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import { aasBBoxAreas, aasPointArea, aasTraceAreas } from "./aas.ts";
import { aasAreaTravelFlags, aasTravelFlag } from "./graph.ts";
import { clear, contents, distance, nodeProfile, translated } from "./helpers.ts";
import type { NavigationEdge, NavigationGraph, NavigationNode, NavigationRoute, NavigationRouteResult, NavigationWorld, TraversalAdmission, TraversalRequest } from "./types.ts";

export interface NavigationRouteQuery {
  readonly start: Vec3; readonly goal: Vec3;
  readonly startNode?: number; readonly goalNode?: number;
  readonly travelFlags?: number;
  readonly disabledAreas?: ReadonlySet<number>;
  readonly edgeFilter?: (edge: NavigationEdge) => boolean;
  readonly maximumSearches?: number;
}
interface QueueItem { readonly node: number; readonly cost: number; }
class Queue {
  readonly values: QueueItem[] = [];
  push(value: QueueItem): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2), parent = this.values[parentIndex];
      if (parent === undefined || parent.cost <= value.cost) break;
      this.values[index] = parent; index = parentIndex;
    }
    this.values[index] = value;
  }
  pop(): QueueItem | null {
    const result = this.values[0], tail = this.values.pop();
    if (result === undefined || tail === undefined) return null;
    if (this.values.length === 0) return result;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let childIndex = index * 2 + 1;
      const right = this.values[childIndex + 1], left = this.values[childIndex];
      if (left === undefined) break;
      if (right !== undefined && right.cost < left.cost) childIndex++;
      const child = this.values[childIndex];
      if (child === undefined || tail.cost <= child.cost) break;
      this.values[index] = child; index = childIndex;
    }
    this.values[index] = tail;
    return result;
  }
}

export interface NavigationRuntimeCheckpoint {
  readonly version: 1;
  readonly map: { readonly name: string; readonly format: string; readonly digest: string };
  readonly enabled: readonly { readonly id: number; readonly enabled: boolean }[];
  readonly blocked: readonly { readonly id: number; readonly reason: string }[];
  readonly admissionSeconds: readonly { readonly id: number; readonly seconds: number }[];
  readonly worldRevision: number;
  readonly generation: number;
}

export class NavigationRuntime {
  readonly #nodes = new Map<number, NavigationNode>();
  readonly #outgoing = new Map<number, NavigationEdge[]>();
  readonly #enabled = new Map<number, boolean>();
  readonly #blocked = new Map<number, string>();
  readonly #admissionSeconds = new Map<number, number>();
  #worldRevision: number;
  #generation = 0;
  constructor(readonly graph: NavigationGraph, readonly world: NavigationWorld) {
    this.#worldRevision = world.revision;
    for (const node of graph.nodes) {
      if (this.#nodes.has(node.id)) throw new RangeError(`Duplicate navigation node ${node.id}`);
      this.#nodes.set(node.id, node); this.#outgoing.set(node.id, []);
    }
    const ids = new Set<number>();
    for (const edge of graph.edges) {
      const list = this.#outgoing.get(edge.from);
      if (list === undefined || !this.#nodes.has(edge.to) || ids.has(edge.id)) throw new RangeError("Invalid navigation edge identity/reference");
      if (!Number.isFinite(edge.travelSeconds) || edge.travelSeconds < 0) throw new RangeError("Invalid navigation edge cost");
      ids.add(edge.id); list.push(edge);
    }
  }
  checkpoint(): NavigationRuntimeCheckpoint {
    return { version: 1, map: { ...this.graph.map },
      enabled: Array.from(this.#enabled, ([id, enabled]) => ({ id, enabled })),
      blocked: Array.from(this.#blocked, ([id, reason]) => ({ id, reason })),
      admissionSeconds: Array.from(this.#admissionSeconds, ([id, seconds]) => ({ id, seconds })),
      worldRevision: this.#worldRevision, generation: this.#generation };
  }
  restoreCheckpoint(value: unknown): void {
    const reader = new SaveReader(value, "navigation");
    reader.field("version").literal(1);
    const map = reader.field("map");
    map.field("name").literal(this.graph.map.name);
    map.field("format").literal(this.graph.map.format);
    map.field("digest").literal(this.graph.map.digest);
    const readEntries = <T>(name: string, known: ReadonlySet<number>, read: (entry: SaveReader) => T): Map<number, T> => {
      const entries = new Map<number, T>();
      reader.field(name).list(entry => {
        const id = entry.field("id").integer(0);
        if (!known.has(id) || entries.has(id)) entry.fail("unknown or duplicate navigation identity");
        entries.set(id, read(entry));
      });
      return entries;
    };
    const edges = new Set(this.graph.edges.map(edge => edge.id));
    const enabled = readEntries("enabled", new Set(this.#nodes.keys()), entry => entry.field("enabled").boolean());
    const blocked = readEntries("blocked", edges, entry => entry.field("reason").string());
    const admissions = readEntries("admissionSeconds", edges, entry => {
      const seconds = entry.field("seconds").finite();
      if (seconds < 0) entry.fail("negative admission duration");
      return seconds;
    });
    const revision = reader.field("worldRevision").finite(), generation = reader.field("generation").integer(0);
    this.#enabled.clear(); for (const [id, state] of enabled) this.#enabled.set(id, state);
    this.#blocked.clear(); for (const [id, reason] of blocked) this.#blocked.set(id, reason);
    this.#admissionSeconds.clear(); for (const [id, seconds] of admissions) this.#admissionSeconds.set(id, seconds);
    this.#worldRevision = revision; this.#generation = generation;
  }
  get generation(): number { this.#refresh(); return this.#generation; }
  node(id: number): NavigationNode | null { return this.#nodes.get(id) ?? null; }
  outgoing(id: number): readonly NavigationEdge[] { return this.#outgoing.get(id) ?? []; }
  boardingElevator(node: number) {
    for (const edge of this.outgoing(node)) {
      if (edge.source.kind !== "nav3" || edge.mode !== "mover" || edge.sourceTravelType !== 6 || edge.entity === null) continue;
      const state = this.world.entity(edge.entity);
      if (state?.elevator !== undefined && state.enabled && !state.locked) return { edge, actor: state.actor, platform: state.elevator };
    }
    return null;
  }
  enableArea(id: number, enabled: boolean): boolean {
    const node = this.node(id);
    if (node === null) throw new RangeError(`Unknown navigation area ${id}`);
    const previous = this.#enabled.get(id) ?? !(node.source.kind === "aas" && (node.flags & 8) !== 0);
    this.#enabled.set(id, enabled); this.#invalidate(); return previous;
  }
  blockEdge(id: number, reason: string | null): void {
    if (!this.graph.edges.some(edge => edge.id === id)) throw new RangeError(`Unknown navigation edge ${id}`);
    if (reason === null) this.#blocked.delete(id); else this.#blocked.set(id, reason);
    this.#invalidate();
  }
  #invalidate(): void { this.#generation++; this.#admissionSeconds.clear(); }
  #refresh(): void { if (this.#worldRevision !== this.world.revision) { this.#worldRevision = this.world.revision; this.#invalidate(); } }
  areaAt(point: Vec3): number | null {
    if (this.graph.asset?.kind === "aas") { const area = aasPointArea(this.graph.asset, point); return this.#nodes.has(area) ? area : null; }
    return this.nearest(point)?.id ?? null;
  }
  nearest(point: Vec3, radius = 512): NavigationNode | null {
    let selected: NavigationNode | null = null, best = radius;
    for (const node of this.graph.nodes) {
      const d = distance(point, node.origin), profile = nodeProfile(this.graph.profile, node);
      if (d <= best && profile !== null && this.#nodeAllowed(node) && clear(this.world, profile, point, node.origin)) { best = d; selected = node; }
    }
    return selected;
  }
  bboxAreas(bounds: Bounds): readonly number[] {
    if (this.graph.asset?.kind === "aas") return aasBBoxAreas(this.graph.asset, bounds);
    return this.graph.nodes.filter(node => node.bounds.min.x <= bounds.max.x && node.bounds.max.x >= bounds.min.x
      && node.bounds.min.y <= bounds.max.y && node.bounds.max.y >= bounds.min.y && node.bounds.min.z <= bounds.max.z && node.bounds.max.z >= bounds.min.z).map(node => node.id);
  }
  traceAreas(start: Vec3, end: Vec3, maximum = this.graph.nodes.length): readonly { readonly area: number; readonly point: Vec3 }[] {
    if (this.graph.asset?.kind === "aas") return aasTraceAreas(this.graph.asset, start, end, maximum);
    if (!Number.isInteger(maximum) || maximum < 0) throw new RangeError("Invalid navigation area limit");
    const crossed: { area: number; point: Vec3; fraction: number }[] = [];
    for (const node of this.graph.nodes) {
      let enter = 0, leave = 1;
      const axes: readonly ("x" | "y" | "z")[] = ["x", "y", "z"];
      for (const axis of axes) {
        const delta = end[axis] - start[axis];
        if (delta === 0) { if (start[axis] < node.bounds.min[axis] || start[axis] > node.bounds.max[axis]) leave = -1; continue; }
        const first = (node.bounds.min[axis] - start[axis]) / delta, second = (node.bounds.max[axis] - start[axis]) / delta;
        enter = Math.max(enter, Math.min(first, second)); leave = Math.min(leave, Math.max(first, second));
      }
      if (enter <= leave) crossed.push({ area: node.id, fraction: enter,
        point: { x: start.x + (end.x - start.x) * enter, y: start.y + (end.y - start.y) * enter, z: start.z + (end.z - start.z) * enter } });
    }
    return crossed.sort((a, b) => a.fraction - b.fraction).slice(0, maximum).map(({ area, point }) => ({ area, point }));
  }
  #nodeAllowed(node: NavigationNode, query?: NavigationRouteQuery, awaitElevator = false): boolean {
    const profile = nodeProfile(this.graph.profile, node);
    if (profile === null) return false;
    if (this.#enabled.get(node.id) === false || query?.disabledAreas?.has(node.id)) return false;
    if (node.source.kind === "aas" && (node.flags & 8) !== 0 && this.#enabled.get(node.id) !== true) return false;
    if (node.source.kind === "nav3") {
      if ((node.flags & 8192) !== 0 || profile.monster && (node.flags & 256) !== 0) return false;
      if ((node.flags & 512) !== 0 && !profile.capabilities.has("crouch")) return false;
    }
    const medium = contents(this.world, profile, node.origin);
    if ((medium & 6) !== 0 || (medium & 1) !== 0 && !profile.capabilities.has("swim")) return false;
    if (this.world.hazard(translated(node.origin, profile.shape.bounds))) return false;
    if (!awaitElevator && !clear(this.world, profile, node.origin, node.origin)) return false;
    if (node.source.kind === "nav3" && (node.flags & 2048) !== 0 && (medium & 7) === 0) return false;
    if (node.source.kind === "nav3" && (node.flags & 64) !== 0) {
      const result = this.world.scene.trace({ start: node.origin, end: { ...node.origin, z: node.origin.z - 96 },
        shape: { kind: "box", bounds: { min: { ...profile.shape.bounds.min, z: 0 }, max: { ...profile.shape.bounds.max, z: 0 } } },
        target: { kind: "world" }, policy: profile.policy, numeric: profile.movement.numeric, passActor: this.world.passActor });
      if (result.fraction === 1 && !awaitElevator) return false;
    }
    return true;
  }
  edgeAllowed(edge: NavigationEdge, query?: NavigationRouteQuery): boolean {
    const profile = this.graph.profile;
    if (!profile.capabilities.has(edge.mode) || edge.mode === "unknown" || this.#blocked.has(edge.id)) return false;
    if (query?.edgeFilter !== undefined && !query.edgeFilter(edge)) return false;
    const target = this.node(edge.to);
    const elevator = this.boardingElevator(edge.to);
    if (target === null || !this.#nodeAllowed(target, query, elevator !== null && elevator.platform.phase !== "bottom")) return false;
    if (edge.mode === "drop" && edge.start.z - edge.end.z > profile.maximumDrop) return false;
    if (edge.source.kind === "aas") {
      if (query?.travelFlags !== undefined && (aasTravelFlag(edge.sourceTravelType) & query.travelFlags) === 0) return false;
      if (profile.team === "red" && (edge.sourceTravelType & 0x01000000) !== 0 || profile.team === "blue" && (edge.sourceTravelType & 0x02000000) !== 0) return false;
      const settings = this.graph.asset?.kind === "aas" ? this.graph.asset.settings[edge.to] : undefined;
      if (settings !== undefined) {
        if (query?.travelFlags !== undefined && (aasAreaTravelFlags(settings) & ~query.travelFlags) !== 0) return false;
        if (profile.team === "red" && (settings.contents & 2048) !== 0 || profile.team === "blue" && (settings.contents & 4096) !== 0) return false;
      }
    } else if (edge.source.kind === "nav3") {
      if ((edge.sourceFlags & 64) !== 0) return false;
      if (profile.team !== null && (edge.sourceFlags & (profile.team === "red" ? 1 : 2)) === 0) return false;
    }
    if (edge.entity !== null) {
      const state = this.world.entity(edge.entity);
      if (state === null || !state.enabled || state.locked) return false;
    }
    return true;
  }
  #candidate(start: number, goal: number, query: NavigationRouteQuery, rejected: ReadonlySet<number>): NavigationEdge[] | null {
    const queue = new Queue(), costs = new Map([[start, 0]]), parents = new Map<number, NavigationEdge>();
    queue.push({ node: start, cost: 0 });
    for (let current = queue.pop(); current !== null; current = queue.pop()) {
      if (current.cost !== costs.get(current.node)) continue;
      if (current.node === goal) {
        const path: NavigationEdge[] = [];
        for (let node = goal; node !== start;) {
          const edge = parents.get(node);
          if (edge === undefined) throw new Error("Navigation predecessor chain is incomplete");
          path.push(edge); node = edge.from;
        }
        return path.reverse();
      }
      for (const edge of this.outgoing(current.node)) {
        if (rejected.has(edge.id) || !this.edgeAllowed(edge, query)) continue;
        const cost = current.cost + (this.#admissionSeconds.get(edge.id) ?? edge.travelSeconds);
        if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
        costs.set(edge.to, cost); parents.set(edge.to, edge); queue.push({ node: edge.to, cost });
      }
    }
    return null;
  }
  route(query: NavigationRouteQuery): NavigationRouteResult {
    this.#refresh();
    const start = query.startNode === undefined ? this.areaAt(query.start) : query.startNode;
    const goal = query.goalNode === undefined ? this.areaAt(query.goal) : query.goalNode;
    if (start === null || goal === null || this.node(start) === null || this.node(goal) === null) return { kind: "unreachable", reason: "start or goal has no navigation area" };
    const startNode = this.node(start);
    if (startNode === null || !this.#nodeAllowed(startNode, query)) return { kind: "unreachable", reason: "start area is disabled or occupied" };
    const rejected = new Set<number>();
    const maximumSearches = query.maximumSearches ?? 64;
    for (let attempt = 0; attempt < maximumSearches; attempt++) {
      const edges = this.#candidate(start, goal, query, rejected);
      if (edges === null) return { kind: "unreachable", reason: "no route satisfies source flags, character capabilities, and current obstacles" };
      let cursor = query.start, seconds = 0, failed = false;
      const points: Vec3[] = [cursor];
      let prediction = this.world.beginRoute(this.graph.profile);
      const admit = (request: TraversalRequest): TraversalAdmission => {
        const result = prediction.admit(request);
        if (result.admitted) {
          const last = result.trajectory[result.trajectory.length - 1];
          if (last === undefined || !Number.isFinite(result.seconds) || result.seconds < 0) throw new RangeError("Movement admission returned no trajectory or invalid duration");
          seconds += result.seconds; points.push(...result.trajectory.slice(1)); cursor = last;
        }
        return result;
      };
      for (const edge of edges) {
        const mover = edge.mode === "mover" && edge.source.kind === "nav3" && edge.sourceTravelType === 6 && edge.entity !== null
          ? this.world.entity(edge.entity) : null;
        if (mover?.elevator !== undefined && mover.enabled && !mover.locked) {
          const elevator = mover.elevator;
          if (elevator.top.z <= elevator.bottom.z || elevator.top.x !== elevator.bottom.x || elevator.top.y !== elevator.bottom.y) {
            rejected.add(edge.id); failed = true; break;
          }
          const staging = edge.hint?.funnel ?? edge.start;
          if (distance(cursor, edge.start) > Math.max(this.graph.profile.maximumStep, this.node(edge.from)?.radius ?? 0) && distance(cursor, staging) > 1
            && !admit({ from: cursor, to: staging, mode: "walk", hint: null, entity: null }).admitted) {
            rejected.add(edge.id); failed = true; break;
          }
          points.push(edge.end); cursor = edge.end; seconds += edge.travelSeconds;
          prediction = this.world.beginRoute(this.graph.profile);
          continue;
        }
        if (distance(cursor, edge.start) > 1 && !admit({ from: cursor, to: edge.start, mode: edge.mode === "crouch" ? "crouch" : "walk", hint: null, entity: null }).admitted) {
          rejected.add(edge.id); failed = true; break;
        }
        let landing = edge.end;
        const boarding = edge.mode === "walk" && edge.source.kind === "nav3" ? this.boardingElevator(edge.to) : null;
        if (boarding !== null && boarding.platform.phase !== "bottom") {
          // The source elevator action waits at the supported approach, not at its absent deck.
          landing = edge.start;
        } else if (boarding !== null) {
          const floor = this.world.scene.trace({ start: edge.end, end: { ...edge.end, z: edge.end.z - 96 },
            shape: this.graph.profile.shape, target: { kind: "world" }, policy: this.graph.profile.policy,
            numeric: this.graph.profile.movement.numeric, passActor: this.world.passActor });
          if (!floor.startSolid && !floor.allSolid && floor.hit.kind === "actor" && floor.hit.actor.equals(boarding.actor)
            && floor.contact.kind === "plane" && floor.contact.plane.normal.z >= this.graph.profile.minimumFloorNormal) landing = floor.end;
        }
        const result = admit({ from: cursor, to: landing, mode: edge.mode, hint: edge.hint, entity: edge.entity });
        if (result.admitted) this.#admissionSeconds.set(edge.id, result.seconds);
        if (!result.admitted) { rejected.add(edge.id); failed = true; break; }
      }
      if (failed) continue;
      if (distance(cursor, query.goal) > 1 && !admit({ from: cursor, to: query.goal, mode: "walk", hint: null, entity: null }).admitted) return { kind: "unreachable", reason: "selected movement cannot reach the goal within its area" };
      return { kind: "route", route: { map: this.graph.map, nodes: [start, ...edges.map(edge => edge.to)], edges, points, travelSeconds: seconds, generation: this.#generation } };
    }
    return { kind: "unreachable", reason: `movement admission exhausted ${maximumSearches} candidate routes` };
  }
  routeStillValid(route: NavigationRoute): boolean {
    this.#refresh();
    return route.map.digest === this.graph.map.digest && route.generation === this.#generation && route.edges.every(edge => this.edgeAllowed(edge));
  }
  /** Drawing belongs to the renderer; these records preserve source IDs for selection/camera tools. */
  debugLines(): readonly { readonly from: Vec3; readonly to: Vec3; readonly edge: number; readonly enabled: boolean; readonly mode: NavigationEdge["mode"] }[] {
    this.#refresh();
    return this.graph.edges.map(edge => ({ from: edge.start, to: edge.end, edge: edge.id, enabled: this.edgeAllowed(edge), mode: edge.mode }));
  }
}
