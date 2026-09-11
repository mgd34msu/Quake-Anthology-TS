/* Quake II brush tracing and area connectivity from id Software cmodel.c and
 * q2repro cmodel.c. Copyright (C) 1997-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from '../../contracts/math.ts';
import type { NumericOperations } from '../../contracts/numeric.ts';
import type { BspChild, BspPlane, LeafQueryResult, PointContentsQuery, PointContentsResult, Q2SurfaceInfo, Q2WorldGeometry, TraceQuery, TraceResult, TraceShape } from '../../contracts/scene.ts';
import { createNumericOperations } from '../../core/numeric.ts';
import { convertContents, geometryMask } from './contents.ts';
import { traceBrushMedia } from './media.ts';
import type { MediumBrush, TraceMedia } from './media.ts';
type Q2Trace = Extract<TraceResult, {
    kind: 'q2';
}>;
interface Work {
    fraction: number;
    startSolid: boolean;
    allSolid: boolean;
    contents: number;
    plane: BspPlane;
    surface: Q2SurfaceInfo | null;
    secondary: Q2Trace['secondary'];
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const noPlane: BspPlane = { normal: zero, distance: 0, type: 0, signbits: 0 };
const epsilon = 0.03125;
function at<T>(values: readonly T[], index: number): T { const value = values[index]; if (value === undefined)
    throw new RangeError(`Q2 collision index ${index}`); return value; }
function dot(a: Vec3, b: Vec3, n: NumericOperations): number { return n.add(n.add(n.multiply(a.x, b.x), n.multiply(a.y, b.y)), n.multiply(a.z, b.z)); }
function subtract(a: Vec3, b: Vec3, n: NumericOperations): Vec3 { return { x: n.subtract(a.x, b.x), y: n.subtract(a.y, b.y), z: n.subtract(a.z, b.z) }; }
function lerp(a: Vec3, b: Vec3, f: number, n: NumericOperations): Vec3 { return { x: n.add(a.x, n.multiply(f, n.subtract(b.x, a.x))), y: n.add(a.y, n.multiply(f, n.subtract(b.y, a.y))), z: n.add(a.z, n.multiply(f, n.subtract(b.z, a.z))) }; }
function axis(angles: Vec3, n: NumericOperations): readonly [
    Vec3,
    Vec3,
    Vec3
] {
    const yaw = angles.y * Math.PI / 180, pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180;
    const sy = n.store(Math.sin(yaw)), cy = n.store(Math.cos(yaw)), sp = n.store(Math.sin(pitch)), cp = n.store(Math.cos(pitch)), sr = n.store(Math.sin(roll)), cr = n.store(Math.cos(roll));
    return [{ x: n.multiply(cp, cy), y: n.multiply(cp, sy), z: -sp },
        { x: n.subtract(n.multiply(n.multiply(sr, sp), cy), n.multiply(cr, sy)), y: n.add(n.multiply(n.multiply(sr, sp), sy), n.multiply(cr, cy)), z: n.multiply(sr, cp) },
        { x: n.add(n.multiply(n.multiply(cr, sp), cy), n.multiply(sr, sy)), y: n.subtract(n.multiply(n.multiply(cr, sp), sy), n.multiply(sr, cy)), z: n.multiply(cr, cp) }];
}
function rotate(p: Vec3, a: readonly [
    Vec3,
    Vec3,
    Vec3
], n: NumericOperations): Vec3 { return { x: dot(p, a[0], n), y: dot(p, a[1], n), z: dot(p, a[2], n) }; }
function planeDistance(p: Vec3, plane: BspPlane, n: NumericOperations): number { return n.subtract(plane.type === 0 ? p.x : plane.type === 1 ? p.y : plane.type === 2 ? p.z : dot(p, plane.normal, n), plane.distance); }
function shapeBounds(shape: TraceShape): Bounds { return shape.kind === 'point' ? { min: zero, max: zero } : shape.bounds; }
function expand(plane: BspPlane, shape: TraceShape, n: NumericOperations): number {
    const bounds = shapeBounds(shape), normal = plane.normal;
    if (shape.kind === 'capsule') {
        const center = { x: n.multiply(n.add(bounds.min.x, bounds.max.x), 0.5), y: n.multiply(n.add(bounds.min.y, bounds.max.y), 0.5), z: n.multiply(n.add(bounds.min.z, bounds.max.z), 0.5) };
        const halfheight = n.multiply(n.subtract(bounds.max.z, bounds.min.z), 0.5), radius = Math.min(n.multiply(n.subtract(bounds.max.x, bounds.min.x), 0.5), halfheight);
        return n.subtract(n.add(radius, n.multiply(Math.abs(normal.z), n.subtract(halfheight, radius))), dot(center, normal, n));
    }
    return -dot({ x: normal.x < 0 ? bounds.max.x : bounds.min.x, y: normal.y < 0 ? bounds.max.y : bounds.min.y, z: normal.z < 0 ? bounds.max.z : bounds.min.z }, normal, n);
}
export class Q2Collision {
    readonly #openPortals = new Set<number>();
    readonly #flood: number[];
    constructor(readonly geometry: Q2WorldGeometry) { this.#flood = geometry.areas.map(() => 0); this.#floodAreas(); }
    modelBounds(index: number): Bounds { return at(this.geometry.models, index).bounds; }
    pointLeaf(point: Vec3, model = 0): number { return this.#pointLeaf(point, at(this.geometry.models, model).headnode); }
    #pointLeaf(point: Vec3, headnode: number, numeric: NumericOperations | null = null): number {
        let child: BspChild = headnode < 0 ? { kind: 'leaf', index: -1 - headnode } : { kind: 'node', index: headnode };
        while (child.kind === 'node') {
            const node = at(this.geometry.nodes, child.index), plane = at(this.geometry.planes, node.plane);
            const d = numeric === null ? point.x * plane.normal.x + point.y * plane.normal.y + point.z * plane.normal.z - plane.distance : planeDistance(point, plane, numeric);
            child = node.children[d < 0 ? 1 : 0];
        }
        return child.index;
    }
    leafCluster(index: number): number { return at(this.geometry.leaves, index).cluster; }
    leafArea(index: number): number { return at(this.geometry.leaves, index).area; }
    pointContents(query: PointContentsQuery): PointContentsResult {
        const n = createNumericOperations(query.numeric), target = query.target;
        let point = query.point;
        let model = 0;
        if (target.kind === 'model') {
            model = target.model;
            point = rotate(subtract(point, target.origin, n), axis(target.angles, n), n);
        }
        const leaf = at(this.geometry.leaves, this.#pointLeaf(point, at(this.geometry.models, model).headnode, n));
        return { kind: 'q2', stored: leaf.contents, merged: leaf.mergedContents };
    }
    traceMedia(query: TraceQuery, fraction: number): TraceMedia {
        const numeric = createNumericOperations(query.numeric), target = query.target;
        const model = target.kind === 'model' ? target.model : 0;
        const rotation = target.kind === 'model' ? axis(target.angles, numeric) : null;
        const local = (point: Vec3): Vec3 => target.kind === 'world' || rotation === null ? point
            : rotate(subtract(point, target.origin, numeric), rotation, numeric);
        const start = local(query.start), end = local(query.end), bounds = shapeBounds(query.shape);
        const reached = lerp(start, end, fraction, numeric);
        const envelope: Bounds = { min: { x: Math.min(start.x, reached.x) + bounds.min.x - 1,
            y: Math.min(start.y, reached.y) + bounds.min.y - 1, z: Math.min(start.z, reached.z) + bounds.min.z - 1 },
            max: { x: Math.max(start.x, reached.x) + bounds.max.x + 1,
                y: Math.max(start.y, reached.y) + bounds.max.y + 1, z: Math.max(start.z, reached.z) + bounds.max.z + 1 } };
        const leaves = this.boxLeaves(envelope, this.geometry.leaves.length, at(this.geometry.models, model).headnode);
        const geometry = this.geometry;
        function* brushes(): Generator<MediumBrush, undefined, unknown> {
            const seen = new Set<number>();
            for (const leafIndex of leaves.leaves) {
                const leaf = at(geometry.leaves, leafIndex);
                for (let index = 0; index < leaf.brushes.count; index++) {
                    const brushIndex = at(geometry.leafBrushes, leaf.brushes.first + index);
                    if (seen.has(brushIndex)) continue;
                    seen.add(brushIndex);
                    const brush = at(geometry.brushes, brushIndex);
                    if (convertContents(brush.contents, 'q2', 'q1') === -1) continue;
                    yield { contents: brush.contents, planes: Array.from({ length: brush.sides.count }, (_, side) =>
                        at(geometry.planes, at(geometry.brushSides, brush.sides.first + side).plane)) };
                }
            }
        }
        return traceBrushMedia(brushes(), 'q2', (plane, endpoint) =>
            numeric.subtract(dot(endpoint === 'start' ? start : end, plane.normal, numeric),
                numeric.add(plane.distance, expand(plane, query.shape, numeric))), numeric, fraction);
    }
    boxLeaves(bounds: Bounds, limit: number, headnode = 0): LeafQueryResult {
        if (!Number.isSafeInteger(limit) || limit < 0)
            throw new RangeError('Leaf limit must be nonnegative');
        const leaves: number[] = [];
        let topnode: number | null = null, overflow = false;
        const stack: BspChild[] = [headnode < 0 ? { kind: 'leaf', index: -1 - headnode } : { kind: 'node', index: headnode }];
        while (stack.length !== 0) {
            const child = stack.pop();
            if (child === undefined)
                break;
            if (child.kind === 'leaf') {
                if (leaves.length === limit)
                    overflow = true;
                else
                    leaves.push(child.index);
                continue;
            }
            const node = at(this.geometry.nodes, child.index), plane = at(this.geometry.planes, node.plane), normal = plane.normal;
            const far = (normal.x < 0 ? bounds.min.x : bounds.max.x) * normal.x + (normal.y < 0 ? bounds.min.y : bounds.max.y) * normal.y + (normal.z < 0 ? bounds.min.z : bounds.max.z) * normal.z;
            const near = (normal.x < 0 ? bounds.max.x : bounds.min.x) * normal.x + (normal.y < 0 ? bounds.max.y : bounds.min.y) * normal.y + (normal.z < 0 ? bounds.max.z : bounds.min.z) * normal.z;
            if (far >= plane.distance && near < plane.distance && topnode === null)
                topnode = child.index;
            if (near < plane.distance)
                stack.push(node.children[1]);
            if (far >= plane.distance)
                stack.push(node.children[0]);
        }
        return { leaves, topnode, overflow };
    }
    trace(query: TraceQuery): Q2Trace {
        const n = createNumericOperations(query.numeric), target = query.target;
        const model = target.kind === 'model' ? target.model : 0, headnode = at(this.geometry.models, model).headnode;
        const transform = target.kind === 'model' ? axis(target.angles, n) : null;
        const start = target.kind === 'model' ? rotate(subtract(query.start, target.origin, n), transform ?? axis(zero, n), n) : query.start;
        const end = target.kind === 'model' ? rotate(subtract(query.end, target.origin, n), transform ?? axis(zero, n), n) : query.end;
        const stationary = start.x === end.x && start.y === end.y && start.z === end.z;
        const merged = query.policy.kind !== 'q2' || query.policy.leafContents === 'merged';
        const mask = geometryMask(query.policy, 'q2'), bounds = shapeBounds(query.shape);
        const extents = { x: Math.max(-bounds.min.x, bounds.max.x), y: Math.max(-bounds.min.y, bounds.max.y), z: Math.max(-bounds.min.z, bounds.max.z) };
        const work: Work = { fraction: 1, startSolid: false, allSolid: false, contents: 0, plane: noPlane, surface: null, secondary: null };
        const checked = new Set<number>();
        const brushTrace = (index: number): void => {
            if (checked.has(index))
                return;
            checked.add(index);
            const brush = at(this.geometry.brushes, index);
            if ((brush.contents & mask) === 0 || brush.sides.count === 0)
                return;
            let enter = -1, enter2 = -1, leave = 1, startOut = false, getOut = false;
            let lead: {
                plane: BspPlane;
                surface: Q2SurfaceInfo | null;
            } | null = null, second: BspPlane | null = null;
            for (let i = 0; i < brush.sides.count; i++) {
                const side = at(this.geometry.brushSides, brush.sides.first + i), plane = at(this.geometry.planes, side.plane);
                const distance = n.add(plane.distance, expand(plane, query.shape, n));
                const d1 = n.subtract(dot(start, plane.normal, n), distance);
                if (stationary) {
                    if (d1 > 0)
                        return;
                    continue;
                }
                const d2 = n.subtract(dot(end, plane.normal, n), distance);
                if (d1 > 0)
                    startOut = true;
                if (d2 > 0)
                    getOut = true;
                if (d1 > 0 && (d2 >= epsilon || d2 >= d1))
                    return;
                if (d1 <= 0 && d2 <= 0)
                    continue;
                if (d1 > d2) {
                    const f = Math.max(0, n.divide(n.subtract(d1, epsilon), n.subtract(d1, d2)));
                    if (f > enter) {
                        enter = f;
                        lead = { plane, surface: side.textureInfo < 0 ? null : at(this.geometry.textureInfo, side.textureInfo) };
                    }
                    else if (f > enter2) {
                        enter2 = f;
                        second = plane;
                    }
                }
                else
                    leave = Math.min(leave, Math.min(1, n.divide(n.add(d1, epsilon), n.subtract(d1, d2))));
            }
            if (!startOut) {
                work.startSolid = true;
                if (!getOut) {
                    work.allSolid = true;
                    if (stationary || merged) {
                        work.fraction = 0;
                        work.contents = brush.contents;
                    }
                }
                return;
            }
            if (enter < leave && enter > -1 && enter < work.fraction && lead !== null) {
                work.fraction = enter;
                work.plane = lead.plane;
                work.surface = lead.surface;
                work.contents = brush.contents;
                // q2repro retains the primary surface beside the secondary plane.
                if (second !== null)
                    work.secondary = { plane: second, surface: lead.surface };
            }
        };
        const leafTrace = (index: number): void => {
            const leaf = at(this.geometry.leaves, index);
            if (((merged ? leaf.mergedContents : leaf.contents) & mask) === 0)
                return;
            for (let i = 0; i < leaf.brushes.count; i++) {
                brushTrace(at(this.geometry.leafBrushes, leaf.brushes.first + i));
                if (work.fraction === 0)
                    return;
            }
        };
        const walk = (child: BspChild, p1f: number, p2f: number, p1: Vec3, p2: Vec3): void => {
            if (work.fraction <= p1f)
                return;
            if (child.kind === 'leaf') {
                leafTrace(child.index);
                return;
            }
            const node = at(this.geometry.nodes, child.index), plane = at(this.geometry.planes, node.plane);
            const t1 = planeDistance(p1, plane, n), t2 = planeDistance(p2, plane, n);
            const offset = plane.type === 0 ? extents.x : plane.type === 1 ? extents.y : plane.type === 2 ? extents.z :
                n.add(n.add(Math.abs(n.multiply(extents.x, plane.normal.x)), Math.abs(n.multiply(extents.y, plane.normal.y))), Math.abs(n.multiply(extents.z, plane.normal.z)));
            if (t1 >= offset && t2 >= offset) {
                walk(node.children[0], p1f, p2f, p1, p2);
                return;
            }
            if (t1 < -offset && t2 < -offset) {
                walk(node.children[1], p1f, p2f, p1, p2);
                return;
            }
            let side: 0 | 1 = 0, f1 = 1, f2 = 0;
            if (t1 < t2) {
                const inv = n.divide(1, n.subtract(t1, t2));
                side = 1;
                f2 = n.multiply(n.add(n.add(t1, offset), epsilon), inv);
                f1 = n.multiply(n.add(n.subtract(t1, offset), epsilon), inv);
            }
            else if (t1 > t2) {
                const inv = n.divide(1, n.subtract(t1, t2));
                f2 = n.multiply(n.subtract(n.subtract(t1, offset), epsilon), inv);
                f1 = n.multiply(n.add(n.add(t1, offset), epsilon), inv);
            }
            f1 = Math.max(0, Math.min(1, f1));
            f2 = Math.max(0, Math.min(1, f2));
            walk(node.children[side], p1f, n.add(p1f, n.multiply(n.subtract(p2f, p1f), f1)), p1, lerp(p1, p2, f1, n));
            walk(node.children[side === 0 ? 1 : 0], n.add(p1f, n.multiply(n.subtract(p2f, p1f), f2)), p2f, lerp(p1, p2, f2, n), p2);
        };
        if (stationary) {
            const leaves = this.boxLeaves({ min: { x: start.x + bounds.min.x - 1, y: start.y + bounds.min.y - 1, z: start.z + bounds.min.z - 1 }, max: { x: start.x + bounds.max.x + 1, y: start.y + bounds.max.y + 1, z: start.z + bounds.max.z + 1 } }, 1024, headnode);
            for (const leaf of leaves.leaves) {
                leafTrace(leaf);
                if (work.allSolid)
                    break;
            }
        }
        else
            walk(headnode < 0 ? { kind: 'leaf', index: -1 - headnode } : { kind: 'node', index: headnode }, 0, 1, start, end);
        let plane = work.plane;
        if (transform !== null && work.fraction !== 1 && target.kind === 'model') {
            // Preserve Q2's inverse-angle conversion; it differs from a general matrix transpose.
            const inverse = axis({ x: -target.angles.x, y: -target.angles.y, z: -target.angles.z }, n);
            plane = { ...plane, normal: rotate(plane.normal, inverse, n) };
        }
        return { kind: 'q2', fraction: work.fraction, end: lerp(query.start, query.end, work.fraction, n), startSolid: work.startSolid, allSolid: work.allSolid,
            contact: work.fraction < 1 && !work.allSolid ? { kind: 'plane', plane } : { kind: 'none' }, hit: work.fraction < 1 || work.startSolid ? { kind: 'world', model } : { kind: 'none' },
            contents: work.contents, surface: work.surface, sourcePlane: plane, secondary: work.secondary };
    }
    setAreaPortalState(portal: number, open: boolean): void {
        if (!this.geometry.areaPortals.some(value => value.portal === portal))
            throw new RangeError(`Unknown Q2 area portal ${portal}`);
        if (open)
            this.#openPortals.add(portal);
        else
            this.#openPortals.delete(portal);
        this.#floodAreas();
    }
    portalState(): readonly number[] { return [...this.#openPortals]; }
    restorePortalState(open: readonly number[]): void { this.#openPortals.clear(); for (const id of open)
        this.#openPortals.add(id); this.#floodAreas(); }
    #floodAreas(): void {
        this.#flood.fill(0);
        let flood = 0;
        for (let area = 1; area < this.geometry.areas.length; area++) {
            if (at(this.#flood, area) !== 0)
                continue;
            flood++;
            const stack = [area];
            while (stack.length !== 0) {
                const current = stack.pop();
                if (current === undefined)
                    break;
                if (at(this.#flood, current) !== 0)
                    continue;
                this.#flood[current] = flood;
                const portals = at(this.geometry.areas, current).portals;
                for (let i = 0; i < portals.count; i++) {
                    const portal = at(this.geometry.areaPortals, portals.first + i);
                    if (this.#openPortals.has(portal.portal))
                        stack.push(portal.otherArea);
                }
            }
        }
    }
    areasConnected(first: number, second: number): boolean { return at(this.#flood, first) === at(this.#flood, second); }
    areaBits(area: number): Uint8Array {
        const bits = new Uint8Array((this.geometry.areas.length + 7) >> 3);
        for (let i = 0; i < this.geometry.areas.length; i++)
            if (area === 0 || this.areasConnected(area, i))
                bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
        return bits;
    }
    clusterVisible(from: number, to: number, kind: 'pvs' | 'phs' = 'pvs'): boolean {
        if (to < 0)
            return false;
        const vis = this.geometry.visibility;
        if (vis === null)
            return true;
        if (from < 0 || from >= vis.clusters.length || to >= vis.clusters.length)
            return false;
        const row = at(vis.clusters, from), offset = kind === 'pvs' ? row.pvsOffset : row.phsOffset;
        if (offset < 0)
            return true;
        let input = offset, output = 0;
        const wanted = to >> 3;
        while (output <= wanted) {
            const byte = vis.compressed[input++];
            if (byte === undefined)
                throw new RangeError('Q2 visibility read outside lump');
            if (byte !== 0) {
                if (output === wanted)
                    return (byte & (1 << (to & 7))) !== 0;
                output++;
            }
            else {
                const run = vis.compressed[input++];
                if (run === undefined || run === 0)
                    throw new RangeError('Invalid Q2 visibility zero run');
                if (output + run > wanted)
                    return false;
                output += run;
            }
        }
        return false;
    }
}
