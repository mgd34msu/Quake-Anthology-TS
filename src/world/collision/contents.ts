import type { ActorCollision } from '../spatial/index.ts';
import type { PointContentsResult, TracePolicy, TraceResult, BspPlane } from '../../contracts/scene.ts';
export type CollisionFamily = 'q1' | 'q2' | 'q3';
/** Source flags stay in their geometry; only the selected gameplay boundary maps them. */
export function convertContents(contents: number, from: CollisionFamily, to: CollisionFamily): number {
    if (from === to)
        return contents;
    if (from === 'q1') {
        switch (contents) {
            case -2: return 1;
            case -3: return 32;
            case -4: return 16;
            case -5: return 8;
            case -6: return 1;
            case -9: return 32 | (to === 'q2' ? 0x40000 : 0);
            case -10: return 32 | (to === 'q2' ? 0x80000 : 0);
            case -11: return 32 | (to === 'q2' ? 0x100000 : 0);
            case -12: return 32 | (to === 'q2' ? 0x200000 : 0);
            case -13: return 32 | (to === 'q2' ? 0x400000 : 0);
            case -14: return 32 | (to === 'q2' ? 0x800000 : 0);
            default: return 0;
        }
    }
    if (to === 'q1') {
        if ((contents & (from === 'q2' ? 0xc6000003 : 0x06000001)) !== 0)
            return -2;
        if ((contents & 8) !== 0)
            return -5;
        if ((contents & 16) !== 0)
            return -4;
        if ((contents & 32) !== 0)
            return -3;
        return -1;
    }
    // Shared liquids, clips, actor bodies, origins, areas, and detail retain their bits.
    let result = contents & 0x0f038079;
    if (from === 'q2') {
        if ((contents & 2) !== 0)
            result |= 1;
        if ((contents & 0xc0000000) !== 0)
            result |= 0x02000000;
        if ((contents & 0x10000000) !== 0)
            result |= 0x20000000;
    }
    else {
        if ((contents & 0x20000000) !== 0)
            result |= 0x10000000;
        if ((contents & 0x02000000) !== 0)
            result |= 0x40000000;
    }
    return result | 0;
}
export function actorContents(collision: ActorCollision, to: CollisionFamily): number {
    if (collision.family === 'q1' && collision.shape.kind !== 'model' && to !== 'q1')
        return collision.deadMonster ? 0x04000000 : 0x02000000;
    return convertContents(collision.contents, collision.family, to);
}
export function contentsBlock(contents: number, family: CollisionFamily, policy: TracePolicy): boolean {
    if (policy.kind === 'q1')
        return convertContents(contents, family, 'q1') === -2;
    return (convertContents(contents, family, policy.kind) & policy.contentsMask) !== 0;
}
export function blocksQ1Contents(contents: number, policy: TracePolicy): boolean { return contentsBlock(contents, 'q1', policy); }
/** Convert a gameplay mask to the geometry's native flag namespace. */
export function geometryMask(policy: TracePolicy, family: 'q2' | 'q3'): number {
    let mask = 0;
    for (let bit = 0; bit < 32; bit++) {
        const flag = 1 << bit;
        if (contentsBlock(flag, family, policy))
            mask |= flag;
    }
    return mask;
}
function planeWithType(result: TraceResult): BspPlane {
    if (result.kind !== 'q1')
        return result.sourcePlane;
    const normal = result.contact.kind === 'plane' ? result.contact.plane.normal : result.sourcePlane.normal;
    return { normal, distance: result.sourcePlane.distance, type: normal.x === 1 ? 0 : normal.y === 1 ? 1 : normal.z === 1 ? 2 : 3,
        signbits: Number(normal.x < 0) | Number(normal.y < 0) << 1 | Number(normal.z < 0) << 2 };
}
export function adaptTraceResult(result: TraceResult, policy: TracePolicy): TraceResult {
    if (result.kind === policy.kind)
        return result;
    const fields = { fraction: result.fraction, end: result.end, startSolid: result.startSolid, allSolid: result.allSolid,
        contact: result.contact, hit: result.hit };
    const nativeContents = result.kind === 'q1' ? 'contents' in result && typeof result.contents === 'number' ? result.contents : result.startSolid || result.hit.kind !== 'none' ? -2 : -1 : result.contents;
    const contents = convertContents(nativeContents, result.kind, policy.kind);
    const sourcePlane = planeWithType(result);
    switch (policy.kind) {
        case 'q1': return { ...fields, kind: 'q1', sourcePlane, surfaceFlags: result.kind === 'q2' ? result.surface?.flags ?? 0 : result.kind === 'q3' ? result.surfaceFlags : 0, inOpen: !result.allSolid, inWater: (nativeContents & 56) !== 0 };
        case 'q2': return { ...fields, kind: 'q2', contents, surface: result.kind === 'q3' ? { name: '', flags: convertSurfaceFlags(result.surfaceFlags, 'q3', 'q2'), value: 0, material: '' } : nativeContents === -6 ? { name: 'sky', flags: 4, value: 0, material: '' } : null, sourcePlane, secondary: null };
        case 'q3': return { ...fields, kind: 'q3', contents, surfaceFlags: result.kind === 'q2' && result.surface !== null ? convertSurfaceFlags(result.surface.flags, 'q2', 'q3') : result.kind === 'q1' && nativeContents === -6 ? 4 | 16 : 0, sourcePlane };
    }
}
export function adaptPointContents(result: PointContentsResult, policy: TracePolicy): PointContentsResult {
    if (result.kind === policy.kind)
        return result;
    const source = result.kind === 'q2' ? result.merged : result.contents;
    const contents = convertContents(source, result.kind, policy.kind);
    if (policy.kind === 'q2')
        return { kind: 'q2', stored: contents, merged: contents };
    return { kind: policy.kind, contents };
}
export function convertSurfaceFlags(flags: number, from: CollisionFamily, to: CollisionFamily): number {
    if (from === to)
        return flags;
    if (from === 'q1' || to === 'q1')
        return 0;
    // Slick, sky, and nodraw share their values and meanings.
    return (flags & 0x86) | (from === 'q2' && to === 'q3' && (flags & 4) !== 0 ? 16 : 0);
}
