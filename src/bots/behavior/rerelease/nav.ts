// Rerelease brain path vocabulary; searches and movement admission belong to NavigationRuntime.
import { NavigationRuntime } from "../../navigation/runtime.ts";
import type { NavigationEdge, NavigationNode } from "../../navigation/types.ts";
import { bvec, bvecDistance, bvecNormalized, bvecSub, type BotVec3 } from "./math.ts";

export enum NavLinkType {
  Walk = 0, LongJump = 1, Teleport = 2, WalkOffLedge = 3, Pusher = 4,
  BarrierJump = 5, Elevator = 6, Train = 7, ManualLongJump = 8, Crouch = 9, Ladder = 10,
}
export type NavLinkTypeT = NavLinkType;
export interface NavTraversalT { readonly funnel: BotVec3; readonly start: BotVec3; readonly end: BotVec3; }
export interface NavGraphLinkT {
  readonly from: number; readonly to: number; readonly type: NavLinkType;
  readonly traversal: NavTraversalT | null;
  readonly entityBounds: { readonly mins: BotVec3; readonly maxs: BotVec3 } | null;
}
export interface NavGraphNodeT {
  readonly index: number; readonly origin: BotVec3; readonly radius: number; readonly flags: number;
}
export interface NavTraverseCapsT {
  jump: boolean; walkOffLedge: boolean; entityTraversal: boolean; swim: boolean;
  maxDrop: number; maxJumpHeight: number;
  avoid?: (node: NavGraphNodeT) => boolean;
}
export interface NavPathT {
  readonly nodes: readonly number[]; readonly points: readonly BotVec3[];
  readonly links: readonly (NavGraphLinkT | null)[]; readonly cost: number;
  readonly generation: number; readonly mapDigest: string;
}
export interface NavPlanOptions {
  readonly caps?: NavTraverseCapsT;
  readonly visible?: (from: BotVec3, to: BotVec3) => boolean;
  readonly maxRadius?: number; readonly startAbove?: number;
}
export interface BotNavigation {
  readonly nodeCount: number;
  readonly nodes: readonly NavGraphNodeT[];
  planPath(start: BotVec3, goal: BotVec3, options?: NavPlanOptions): NavPathT | null;
  pathValid(path: NavPathT): boolean;
}
export function defaultTraverseCaps(): NavTraverseCapsT {
  return { jump: true, walkOffLedge: true, entityTraversal: true, swim: true, maxDrop: 0, maxJumpHeight: 0 };
}
export function navLinkIsJump(type: NavLinkType): boolean {
  return type === NavLinkType.LongJump || type === NavLinkType.BarrierJump || type === NavLinkType.ManualLongJump;
}
export function navLinkIsEntity(type: NavLinkType): boolean {
  return type === NavLinkType.Teleport || type === NavLinkType.Pusher || type === NavLinkType.Elevator || type === NavLinkType.Train;
}
export const PLAN_START_ABOVE = 56;
export function steerDirection(from: BotVec3, to: BotVec3): BotVec3 {
  const direction = bvecSub(to, from);
  return Math.abs(direction.x) < 0.001 && Math.abs(direction.y) < 0.001 ? bvec() : bvecNormalized(bvec(direction.x, direction.y, 0));
}

function nodeView(node: NavigationNode): NavGraphNodeT {
  return { index: node.id, origin: node.origin, radius: node.radius, flags: node.flags };
}
function linkType(edge: NavigationEdge): NavLinkType | null {
  switch (edge.mode) {
    case "walk": case "swim": return NavLinkType.Walk;
    case "crouch": return NavLinkType.Crouch;
    case "ladder": return NavLinkType.Ladder;
    case "jump": case "water-jump": return edge.sourceTravelType === 5 ? NavLinkType.BarrierJump : NavLinkType.LongJump;
    case "drop": return NavLinkType.WalkOffLedge;
    case "teleport": return NavLinkType.Teleport;
    case "jump-pad": return NavLinkType.Pusher;
    case "mover": return edge.sourceTravelType === 7 ? NavLinkType.Train : NavLinkType.Elevator;
    case "rocket-jump": case "bfg-jump": case "grapple": case "double-jump":
    case "ramp-jump": case "strafe-jump": case "unknown": return null;
  }
}
function linkView(edge: NavigationEdge, type: NavLinkType): NavGraphLinkT {
  return { from: edge.from, to: edge.to, type,
    traversal: edge.hint === null ? null : { funnel: edge.hint.funnel, start: edge.start, end: edge.end },
    entityBounds: edge.entity === null ? null : { mins: edge.entity.bounds.min, maxs: edge.entity.bounds.max } };
}

/** Holds only a borrowed runtime. No source graph, reachability cache, or world state is recreated. */
export class SourceRereleaseNavigation implements BotNavigation {
  constructor(readonly runtime: NavigationRuntime) {}
  get nodes(): readonly NavGraphNodeT[] { return this.runtime.graph.nodes.map(nodeView); }
  get nodeCount(): number { return this.runtime.graph.nodes.length; }
  pathValid(path: NavPathT): boolean {
    return path.generation === this.runtime.generation && path.mapDigest === this.runtime.graph.map.digest;
  }
  planPath(start: BotVec3, goal: BotVec3, options: NavPlanOptions = {}): NavPathT | null {
    const caps = options.caps ?? defaultTraverseCaps(), disabledAreas = new Set<number>();
    for (const node of this.runtime.graph.nodes) if (caps.avoid?.(nodeView(node)) === true) disabledAreas.add(node.id);
    const eligible = (edge: NavigationEdge): boolean => {
      const type = linkType(edge);
      if (type === null || !caps.jump && navLinkIsJump(type) || !caps.entityTraversal && navLinkIsEntity(type)
        || !caps.walkOffLedge && type === NavLinkType.WalkOffLedge || !caps.swim && edge.mode === "swim") return false;
      if (caps.maxDrop > 0 && edge.start.z - edge.end.z >= caps.maxDrop) return false;
      if (caps.maxJumpHeight > 0 && navLinkIsJump(type) && edge.end.z - edge.start.z >= caps.maxJumpHeight) return false;
      return true;
    };
    const startNode = this.nearest(start, options, disabledAreas, options.startAbove), goalNode = this.nearest(goal, options, disabledAreas);
    if (startNode === null || goalNode === null) return null;
    const result = this.runtime.route({ start, goal, startNode, goalNode, disabledAreas, edgeFilter: eligible });
    if (result.kind === "unreachable") return null;
    const route = result.route, points: BotVec3[] = [], links: (NavGraphLinkT | null)[] = [];
    const append = (point: BotVec3, link: NavGraphLinkT | null): void => {
      const previous = points.at(-1);
      if (previous !== undefined && bvecDistance(previous, point) < 1) {
        if (link !== null) links[links.length - 1] = link;
        return;
      }
      points.push({ ...point }); links.push(link);
    };
    let cursor = 0;
    const nearestTrajectoryIndex = (point: BotVec3): number => {
      let selected = cursor, distance = Infinity;
      for (let index = cursor; index < route.points.length; index++) {
        const candidate = route.points[index];
        if (candidate === undefined) throw new Error("Navigation trajectory point is absent");
        const next = bvecDistance(candidate, point);
        if (next < distance) { selected = index; distance = next; }
      }
      return selected;
    };
    for (const edge of route.edges) {
      const type = linkType(edge);
      if (type === null) throw new Error("Navigation admitted an unsupported rerelease command traversal");
      const link = linkView(edge, type), begin = nearestTrajectoryIndex(edge.start);
      for (; cursor < begin; cursor++) {
        const point = route.points[cursor];
        if (point === undefined) throw new Error("Navigation approach point is absent");
        append(point, null);
      }
      const end = nearestTrajectoryIndex(edge.end);
      if (type !== NavLinkType.Walk || edge.entity !== null) {
        if (link.traversal !== null) { append(edge.start, link); append(edge.end, null); }
        else append(edge.end, link);
        cursor = end + 1;
      } else {
        for (; cursor <= end; cursor++) {
          const point = route.points[cursor];
          if (point === undefined) throw new Error("Navigation movement point is absent");
          append(point, null);
        }
      }
    }
    for (; cursor < route.points.length; cursor++) {
      const point = route.points[cursor];
      if (point === undefined) throw new Error("Navigation goal point is absent");
      append(point, null);
    }
    return { nodes: [...route.nodes], points, links, cost: route.travelSeconds,
      generation: route.generation, mapDigest: route.map.digest };
  }
  private nearest(point: BotVec3, options: NavPlanOptions, disabled: ReadonlySet<number>, above?: number): number | null {
    let selected: number | null = null, best = options.maxRadius ?? 512;
    for (const node of this.runtime.graph.nodes) {
      if (disabled.has(node.id) || above !== undefined && node.origin.z > point.z + above) continue;
      const distance = bvecDistance(point, node.origin);
      if (distance > best || options.visible?.(point, node.origin) === false) continue;
      selected = node.id; best = distance;
    }
    return selected;
  }
}
