import type { Bounds, Vec3 } from '../../contracts/math.ts';
import type { BspPlane, Q1ClipNode, Q1Hull, TraceQuery, TraceResult } from '../../contracts/scene.ts';
import { createNumericOperations } from '../../core/numeric.ts';
import { adaptTraceResult, actorContents } from './contents.ts';
import type { SpatialActor } from '../spatial/index.ts';
import { traceQ1Hull } from './q1/index.ts';
import { createBoxModel, createCapsuleModel } from './q3/model.ts';
import { sourceTraceView } from './q3/world.ts';
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function hull(bounds: Bounds): Q1Hull {
    const planes: BspPlane[] = [
        { normal: { x: 1, y: 0, z: 0 }, distance: bounds.max.x, type: 0, signbits: 0 }, { normal: { x: 1, y: 0, z: 0 }, distance: bounds.min.x, type: 0, signbits: 0 },
        { normal: { x: 0, y: 1, z: 0 }, distance: bounds.max.y, type: 1, signbits: 0 }, { normal: { x: 0, y: 1, z: 0 }, distance: bounds.min.y, type: 1, signbits: 0 },
        { normal: { x: 0, y: 0, z: 1 }, distance: bounds.max.z, type: 2, signbits: 0 }, { normal: { x: 0, y: 0, z: 1 }, distance: bounds.min.z, type: 2, signbits: 0 }
    ];
    const clipnodes: Q1ClipNode[] = planes.map((_, index) => { const empty = { kind: 'contents', value: -1 } satisfies Q1ClipNode['children'][0]; const next: Q1ClipNode['children'][0] = index === 5 ? { kind: 'contents', value: -2 } : { kind: 'clipnode', index: index + 1 }; return { plane: index, children: index % 2 === 0 ? [empty, next] : [next, empty] }; });
    return { planes, clipnodes, firstClipnode: 0, lastClipnode: 5, clipBounds: { min: zero, max: zero } };
}
export function traceActorBody(query: TraceQuery, actor: SpatialActor): TraceResult {
    const body = actor.body, collision = actor.collision, bounds = body.state.bounds;
    if (query.policy.kind === 'q1' && query.shape.kind !== 'capsule' && collision.shape.kind === 'box') {
        const moving = query.shape.kind === 'point' ? { min: zero, max: zero } : query.shape.bounds;
        const expanded: Bounds = { min: { x: bounds.min.x - moving.max.x, y: bounds.min.y - moving.max.y, z: bounds.min.z - moving.max.z }, max: { x: bounds.max.x - moving.min.x, y: bounds.max.y - moving.min.y, z: bounds.max.z - moving.min.z } };
        const origin = body.state.origin, local = (p: Vec3): Vec3 => ({ x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z });
        const result = traceQ1Hull(hull(expanded), local(query.start), local(query.end), query.numeric);
        const end = result.fraction === 1 ? query.end : { x: result.end.x + origin.x, y: result.end.y + origin.y, z: result.end.z + origin.z };
        return { kind: 'q1', fraction: result.fraction, end, startSolid: result.startSolid, allSolid: result.allSolid, inOpen: result.inOpen, inWater: result.inWater, sourcePlane: result.plane,
            contact: result.fraction < 1 ? { kind: 'plane', plane: result.plane } : { kind: 'none' }, hit: result.fraction < 1 || result.startSolid ? { kind: 'actor', actor: body.actor } : { kind: 'none' } };
    }
    if (query.policy.kind === 'q2' && query.shape.kind !== 'capsule' && collision.shape.kind === 'box')
        return traceQ2Box(query, actor);
    const model = collision.shape.kind === 'capsule' ? createCapsuleModel(bounds) : createBoxModel(bounds);
    const result = model.transformedTraceSource({ start: query.start, end: query.end, mask: query.policy.kind === 'q3' && collision.family === 'q3' ? query.policy.contentsMask : 0x02000000, shape: query.shape.kind === 'point' ? query.shape : { kind: query.shape.kind, mins: query.shape.bounds.min, maxs: query.shape.bounds.max } }, body.state.origin, zero);
    const view = sourceTraceView(result);
    return adaptTraceResult({ kind: 'q3', fraction: result.fraction, end: result.end, startSolid: result.startSolid, allSolid: result.allSolid, sourcePlane: result.plane, contact: view.contact,
        hit: result.fraction < 1 || result.startSolid ? { kind: 'actor', actor: body.actor } : { kind: 'none' }, contents: query.policy.kind === 'q3' && collision.family === 'q3' ? result.contents : actorContents(collision, 'q3'), surfaceFlags: 0 }, query.policy);
}
function traceQ2Box(query: TraceQuery, actor: SpatialActor): TraceResult {
    const n = createNumericOperations(query.numeric), origin = actor.body.state.origin, bounds = actor.body.state.bounds;
    const moving = query.shape.kind === 'point' ? { min: zero, max: zero } : query.shape.bounds;
    const expanded: Bounds = { min: { x: n.subtract(bounds.min.x, moving.max.x), y: n.subtract(bounds.min.y, moving.max.y), z: n.subtract(bounds.min.z, moving.max.z) }, max: { x: n.subtract(bounds.max.x, moving.min.x), y: n.subtract(bounds.max.y, moving.min.y), z: n.subtract(bounds.max.z, moving.min.z) } };
    const planes = hull(expanded).planes;
    let enter = -1, enter2 = -1, leave = 1, startOut = false, getOut = false;
    let plane: BspPlane = { normal: zero, distance: 0, type: 0, signbits: 0 };
    let secondary: BspPlane | null = null;
    const stationary = query.start.x === query.end.x && query.start.y === query.end.y && query.start.z === query.end.z;
    let misses = false;
    for (const [index, current] of planes.entries()) {
        const axis = current.type === 0 ? 'x' : current.type === 1 ? 'y' : 'z', sign = index % 2 === 0 ? 1 : -1;
        const d1 = n.multiply(n.subtract(n.subtract(query.start[axis], origin[axis]), current.distance), sign), d2 = n.multiply(n.subtract(n.subtract(query.end[axis], origin[axis]), current.distance), sign);
        const distance = sign > 0 ? bounds.max[axis] : -bounds.min[axis];
        if (d1 > 0)
            startOut = true;
        if (d2 > 0)
            getOut = true;
        if (d1 > 0 && (d2 >= 0.03125 || d2 >= d1)) {
            misses = true;
            break;
        }
        if (d1 <= 0 && d2 <= 0)
            continue;
        if (d1 > d2) {
            const f = Math.max(0, n.divide(n.subtract(d1, 0.03125), n.subtract(d1, d2)));
            const sourcePlane: BspPlane = { normal: { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 },
                distance, type: sign < 0 ? current.type + 3 : current.type, signbits: sign < 0 ? 1 << current.type : 0 };
            if (f > enter) {
                enter = f;
                plane = sourcePlane;
            }
            else if (f > enter2) { enter2 = f; secondary = sourcePlane; }
        }
        else
            leave = Math.min(leave, Math.min(1, n.divide(n.add(d1, 0.03125), n.subtract(d1, d2))));
    }
    const startSolid = !misses && !startOut, allSolid = startSolid && !getOut;
    const fraction = misses ? 1 : allSolid && (stationary || query.policy.kind === 'q2' && query.policy.leafContents === 'merged') ? 0 : startSolid ? 1 : enter < leave && enter >= 0 ? enter : 1;
    const contents = fraction < 1 ? actorContents(actor.collision, 'q2') : 0;
    const selectedPlane: BspPlane = misses || startSolid || fraction === 1 ? { normal: zero, distance: 0, type: 0, signbits: 0 } : plane;
    return { kind: 'q2', fraction, end: { x: n.add(query.start.x, n.multiply(fraction, n.subtract(query.end.x, query.start.x))), y: n.add(query.start.y, n.multiply(fraction, n.subtract(query.end.y, query.start.y))), z: n.add(query.start.z, n.multiply(fraction, n.subtract(query.end.z, query.start.z))) }, startSolid, allSolid,
        contact: fraction < 1 && !allSolid ? { kind: 'plane', plane: selectedPlane } : { kind: 'none' }, sourcePlane: selectedPlane, hit: fraction < 1 || startSolid ? { kind: 'actor', actor: actor.body.actor } : { kind: 'none' }, contents, surface: null,
        secondary: secondary === null || fraction === 1 || startSolid ? null : { plane: secondary, surface: null } };
}
