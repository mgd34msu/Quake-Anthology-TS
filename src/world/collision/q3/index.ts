import type { Bounds, Vec3 } from '../../../contracts/math.ts';
import type { LeafQueryResult, PointContentsQuery, PointContentsResult, Q3WorldGeometry, TraceQuery, TraceResult } from '../../../contracts/scene.ts';
import { createNumericOperations } from '../../../core/numeric.ts';
import { geometryMask } from '../contents.ts';
import { CollisionMapResource, decodedCollisionMap } from './map-resource.ts';
import { CollisionWorld, sourceTraceView } from './world.ts';
import type { TraceQuery as Q3TraceQuery } from './world.ts';
import type { TraceMedia } from '../media.ts';
export { CollisionWorld, emptySourceTrace, sourceTraceView, sourceTraceEnd } from './world.ts';
export { CollisionMapResource } from './map-resource.ts';
export { SourceClipModels } from './clip-models.ts';
export { createBoxModel, createCapsuleModel, TemporaryCollisionModel } from './model.ts';
export { generatePatchCollide, tracePatch, positionInPatch, CollisionDebugSurface } from './patch.ts';
export { CollisionWindingLibrary, CollisionWinding } from './polylib.ts';
export class Q3Collision {
    readonly world: CollisionWorld;
    readonly #phs = new Map<number, Uint8Array>();
    constructor(geometry: Q3WorldGeometry | CollisionWorld) { this.world = geometry instanceof CollisionWorld ? geometry : new CollisionWorld(decodedCollisionMap(geometry, null)); }
    pointLeaf(point: Vec3): number { return this.world.pointLeafnum(point); }
    leafArea(index: number): number { return this.world.leafArea(index); }
    leafCluster(index: number): number { return this.world.leafCluster(index); }
    modelBounds(index: number): Bounds { return this.world.modelBounds(index); }
    boxLeaves(bounds: Bounds, limit: number): LeafQueryResult { const result = this.world.boxLeafnums(bounds, limit); return { leaves: result.leaves, topnode: result.topnode, overflow: result.overflowed }; }
    areasConnected(first: number, second: number): boolean { return this.world.areasConnected(first, second); }
    areaBits(area: number): Uint8Array { return this.world.areaBits(area); }
    clusterVisible(from: number, to: number, kind: 'pvs' | 'phs' = 'pvs'): boolean {
        if (kind === 'pvs') return this.world.clusterVisible(from, to);
        if (to < 0 || to >= this.world.clusterCount) return false;
        let row = this.#phs.get(from);
        if (row === undefined) {
            row = new Uint8Array((this.world.clusterCount + 7) >> 3);
            const source = this.world.clusterPVS(from);
            for (let index = 0; index < row.length; index++) row[index] = source.byteAt(index);
            for (let cluster = 0; cluster < this.world.clusterCount; cluster++) {
                if (!this.world.clusterVisible(from, cluster)) continue;
                const adjacent = this.world.clusterPVS(cluster);
                for (let index = 0; index < row.length; index++) row[index] = (row[index] ?? 0) | adjacent.byteAt(index);
            }
            this.#phs.set(from, row);
        }
        return ((row[to >> 3] ?? 0) & (1 << (to & 7))) !== 0;
    }
    adjustAreaPortalState(first: number, second: number, open: boolean): void { this.world.adjustAreaPortalState(first, second, open); }
    pointContents(query: PointContentsQuery): PointContentsResult {
        createNumericOperations(query.numeric);
        const target = query.target;
        return { kind: 'q3', contents: target.kind === 'world' ? this.world.pointContents(query.point) : this.world.transformedPointContents(query.point, target.model, target.origin, target.angles) };
    }
    trace(query: TraceQuery): TraceResult {
        createNumericOperations(query.numeric);
        const target = query.target, model = target.kind === 'world' ? 0 : target.model;
        const local: Q3TraceQuery = { start: query.start, end: query.end, modelIndex: model, mask: geometryMask(query.policy, 'q3'),
            shape: query.shape.kind === 'point' ? query.shape : { kind: query.shape.kind, mins: query.shape.bounds.min, maxs: query.shape.bounds.max },
            curves: query.policy.kind !== 'q3' || query.policy.curves, playerCurveClip: query.policy.kind !== 'q3' || query.policy.playerCurveClip };
        const result = target.kind === 'world' ? this.world.traceSource(local) : this.world.transformedTraceSource(local, target.origin, target.angles);
        const view = sourceTraceView(result);
        return { kind: 'q3', fraction: result.fraction, end: result.end, startSolid: result.startSolid, allSolid: result.allSolid, contact: view.contact,
            hit: result.fraction < 1 || result.startSolid ? { kind: 'world', model } : { kind: 'none' }, contents: result.contents, surfaceFlags: result.surfaceFlags, sourcePlane: result.plane };
    }
    traceMedia(query: TraceQuery, fraction: number): TraceMedia {
        const target = query.target;
        const local: Q3TraceQuery = { start: query.start, end: query.end, mask: geometryMask(query.policy, 'q3'),
            modelIndex: target.kind === 'world' ? 0 : target.model,
            shape: query.shape.kind === 'point' ? query.shape : { kind: query.shape.kind, mins: query.shape.bounds.min, maxs: query.shape.bounds.max } };
        return this.world.traceMedia(local, fraction, target.kind === 'world' ? null : target);
    }
}
export function createQ3Collision(geometry: Q3WorldGeometry): Q3Collision { return new Q3Collision(geometry); }
/** Retains raw source clip-map records when a guest exposes their addresses. */
export function createSourceQ3Collision(bytes: Uint8Array, source = '<q3-bsp>'): Q3Collision {
    const resource = new CollisionMapResource(source, { kind: 'unaccounted' }, null);
    resource.load(bytes);
    resource.initializeBoxHull();
    return new Q3Collision(new CollisionWorld(resource));
}

export { CollisionMapLoader } from './map-loader.ts';
export { collisionChecksum, collisionLumpChecksum } from './checksum.ts';
