import type { Vec3 } from "../../contracts/math.ts";
import type { NavigationRuntime } from "./runtime.ts";
import type { NavigationEdge, NavigationNode } from "./types.ts";
import { distance } from "./helpers.ts";

export interface RereleasePathRequest {
  readonly start: Vec3; readonly goal: Vec3; readonly flags: number; readonly moveDistance: number;
  readonly ignoreNodeFlags: boolean; readonly minHeight: number; readonly maxHeight: number; readonly radius: number;
  readonly dropHeight: number; readonly jumpHeight: number;
}
export interface RereleasePathInfo {
  readonly code: number; readonly distanceSquared: number; readonly points: readonly Vec3[];
  readonly first: Vec3; readonly second: Vec3; readonly linkType: number;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function failure(code: number): RereleasePathInfo { return { code, distanceSquared: 0, points: [], first: zero, second: zero, linkType: 0 }; }
function nodeAllowed(node: NavigationNode, request: RereleasePathRequest): boolean {
  if (node.source.kind !== "nav3") return true;
  if ((node.flags & 8192) !== 0) return false;
  if (request.ignoreNodeFlags) return (node.flags & 1024) === 0;
  if ((node.flags & (1 | 2 | 8 | 256 | 512)) !== 0) return false;
  const medium = request.flags & 3;
  return !(medium === 2 && (node.flags & 16) !== 0 || medium === 1 && (node.flags & 16) === 0
    || (request.flags & 32) === 0 && (node.flags & 4) !== 0);
}
function linkType(edge: NavigationEdge): number {
  if (edge.mode === "drop") return 1;
  if (edge.mode === "jump") return edge.sourceTravelType === 5 ? 3 : 2;
  return edge.mode === "mover" ? 4 : 0;
}
function linkAllowed(edge: NavigationEdge, request: RereleasePathRequest): boolean {
  if (request.ignoreNodeFlags) return true;
  if (request.flags === 1 && edge.mode !== "swim" && edge.mode !== "walk") return false;
  switch (edge.mode) {
    case "walk": case "swim": return edge.entity === null;
    case "drop": return (request.flags & 4) !== 0 && (request.dropHeight <= 0 || edge.start.z - edge.end.z <= request.dropHeight);
    case "jump": return (request.flags & (edge.sourceTravelType === 5 ? 16 : 8)) !== 0
      && (edge.sourceTravelType !== 5 || request.jumpHeight <= 0 || edge.end.z - edge.start.z <= request.jumpHeight);
    case "mover": return (request.flags & 32) !== 0;
    default: return false;
  }
}

/** Source advisory paths share the live graph; native monsters execute their own movement. */
export function rereleasePathToGoal(runtime: NavigationRuntime | null, request: RereleasePathRequest): RereleasePathInfo {
  if (runtime === null || runtime.graph.nodes.length === 0) return failure(8);
  if ((request.flags & 3) === 0) return failure(12);
  const { world, graph } = runtime;
  const trace = (start: Vec3, end: Vec3) => world.scene.trace({ start, end, shape: { kind: "point" },
    target: { kind: "world" }, policy: { kind: "q2", contentsMask: 0x30003, leafContents: "merged" },
    numeric: graph.profile.movement.numeric, passActor: world.passActor });
  const nearest = (point: Vec3): NavigationNode | null => {
    let selected: NavigationNode | null = null, best = request.radius > 0 ? request.radius : 512;
    for (const node of graph.nodes) {
      if (!nodeAllowed(node, request) || node.origin.z < point.z - (request.minHeight > 0 ? request.minHeight : 64)
        || node.origin.z > point.z + (request.maxHeight > 0 ? request.maxHeight : 64)) continue;
      const d = Math.hypot(node.origin.x - point.x, node.origin.y - point.y);
      if (d > best) continue;
      const result = trace(point, { ...node.origin, z: node.origin.z + 32 });
      if (result.fraction < 1 || result.startSolid || result.allSolid) continue;
      selected = node; best = d;
    }
    return selected;
  };
  const start = nearest(request.start); if (start === null) return failure(9);
  const goal = nearest(request.goal); if (goal === null) return failure(10);
  if (start.id === goal.id || distance(request.start, goal.origin) <= request.moveDistance) return failure(0);
  if (!request.ignoreNodeFlags) {
    if (trace(request.start, request.start).startSolid) return failure(6);
    if (trace(request.goal, request.goal).startSolid) return failure(7);
  }
  const costs = new Map<number, number>([[start.id, 0]]), previous = new Map<number, NavigationEdge>();
  const queue = [{ node: start.id, cost: 0 }];
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift(); if (current === undefined) break;
    if (current.cost !== costs.get(current.node)) continue;
    if (current.node === goal.id) break;
    for (const edge of runtime.outgoing(current.node)) {
      const node = runtime.node(edge.to);
      if (node === null || !nodeAllowed(node, request) || !linkAllowed(edge, request) || !runtime.edgeAllowed(edge)) continue;
      const cost = current.cost + (edge.mode === "teleport" ? 1 : distance(runtime.node(edge.from)?.origin ?? edge.start, node.origin));
      if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost); previous.set(edge.to, edge); queue.push({ node: edge.to, cost });
    }
  }
  if (!previous.has(goal.id)) return failure(11);
  const edges: NavigationEdge[] = [], nodes: NavigationNode[] = [goal];
  let cursor = goal.id;
  while (cursor !== start.id) {
    const edge = previous.get(cursor);
    if (edge === undefined || edges.length >= graph.nodes.length) throw new Error("Invalid shared navigation predecessor chain");
    const node = runtime.node(edge.from); if (node === null) throw new Error("Missing shared navigation predecessor");
    edges.push(edge); nodes.push(node); cursor = edge.from;
  }
  nodes.reverse(); edges.reverse();
  const edge = edges[0];
  let first = 0;
  if (!request.ignoreNodeFlags && edge !== undefined && (edge.mode === "walk" || edge.mode === "crouch")) {
    const dx = request.start.x - start.origin.x, dy = request.start.y - start.origin.y, length = Math.hypot(dx, dy);
    const next = nodes[1];
    if (length <= start.radius && Math.abs(request.start.z - start.origin.z) <= 64
      || length > 0 && next !== undefined && dx * (next.origin.x - start.origin.x) + dy * (next.origin.y - start.origin.y) > start.radius * length) first = 1;
  }
  const selected = nodes.slice(first), firstNode = selected[0];
  if (firstNode === undefined) throw new Error("Empty shared navigation result");
  let walked = 0, at = request.start;
  for (const node of selected) { walked += distance(at, node.origin); at = node.origin; }
  walked += distance(at, request.goal);
  const points = selected.map(node => node.origin);
  if (distance(request.start, firstNode.origin) > 64) points.unshift(request.start);
  if (distance(goal.origin, request.goal) > 64) points.push(request.goal);
  const traversal = !request.ignoreNodeFlags && edge?.hint !== null && edge !== undefined;
  return { code: request.ignoreNodeFlags ? 3 : traversal ? 2 : 4, distanceSquared: walked * walked, points,
    first: request.ignoreNodeFlags ? zero : traversal ? edge.start : firstNode.origin,
    second: request.ignoreNodeFlags ? zero : traversal ? edge.end : selected[1]?.origin ?? request.goal,
    linkType: edge === undefined ? 0 : linkType(edge) };
}
