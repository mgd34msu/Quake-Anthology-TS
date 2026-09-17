import type { SourceClipModels } from "./q3/clip-models.ts";
import type { CollisionMapSettings } from "./q3/settings.ts";
import type { ActorId } from '../../contracts/identity.ts';
import { sameActor } from '../../contracts/identity.ts';
import type { Bounds, Vec3 } from '../../contracts/math.ts';
import type { BodyState, LinkedBody } from '../../contracts/world.ts';
import type { DecodedWorld, LeafQueryResult, PointContentsQuery, PointContentsResult, SceneQueries, TraceQuery, TraceResult } from '../../contracts/scene.ts';
import { adaptPointContents, adaptTraceResult, blocksQ1Contents, actorContents } from './contents.ts';
import { createQ1Collision } from './q1/index.ts';
import type { Q1Collision } from './q1/index.ts';
import { Q2Collision } from './q2.ts';
import { createQ3Collision } from './q3/index.ts';
import type { Q3Collision } from './q3/index.ts';
import { traceActorBody } from './body.ts';
import { SpatialIndex } from '../spatial/index.ts';
import type { ActorCollision, SpatialActor } from '../spatial/index.ts';
export type { ActorCollision, SpatialActor } from '../spatial/index.ts';
export { convertContents, convertSurfaceFlags } from './contents.ts';
type GeometryCollision = {
    readonly kind: 'q1';
    readonly provider: Q1Collision;
} | {
    readonly kind: 'q2';
    readonly provider: Q2Collision;
} | {
    readonly kind: 'q3';
    readonly provider: Q3Collision;
};
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function sweptBounds(query: TraceQuery): Bounds {
    const b = query.shape.kind === 'point' ? { min: zero, max: zero } : query.shape.bounds;
    if (query.policy.kind === 'q3') {
        const axis = (key: 'x' | 'y' | 'z', minimum: boolean): number => Math.fround(Math.fround(
            (minimum ? Math.min(query.start[key], query.end[key]) : Math.max(query.start[key], query.end[key]))
            + (minimum ? b.min[key] : b.max[key])) + (minimum ? -1 : 1));
        return { min: { x: axis('x', true), y: axis('y', true), z: axis('z', true) },
            max: { x: axis('x', false), y: axis('y', false), z: axis('z', false) } };
    }
    return { min: { x: Math.min(query.start.x, query.end.x) + b.min.x - 1, y: Math.min(query.start.y, query.end.y) + b.min.y - 1, z: Math.min(query.start.z, query.end.z) + b.min.z - 1 }, max: { x: Math.max(query.start.x, query.end.x) + b.max.x + 1, y: Math.max(query.start.y, query.end.y) + b.max.y + 1, z: Math.max(query.start.z, query.end.z) + b.max.z + 1 } };
}
/** World and linked actor collision share one session owner. Model targets bypass actors. */
export class SharedSceneQueries implements SceneQueries {
    readonly spatial: SpatialIndex;
    readonly #geometry: GeometryCollision;
    #readActorState: ((actor: ActorId) => BodyState | null) | null = null;
    #readActorCollision: ((actor: ActorId) => ActorCollision | null) | null = null;
    nativeQ3ClipModels(): SourceClipModels | null {
        return this.#geometry.kind === 'q3' ? this.#geometry.provider.world.sourceClipModels() : null;
    }
    bindCollisionSettings(settings: CollisionMapSettings): void {
        if (this.#geometry.kind === 'q3') this.#geometry.provider.world.bindSettings(settings);
    }
    constructor(readonly geometry: DecodedWorld) {
        switch (geometry.kind) {
            case 'q1-bsp':
                this.#geometry = { kind: 'q1', provider: createQ1Collision(geometry, { blocksContents: blocksQ1Contents }) };
                break;
            case 'q2-bsp':
                this.#geometry = { kind: 'q2', provider: new Q2Collision(geometry) };
                break;
            case 'q3-bsp':
                this.#geometry = { kind: 'q3', provider: createQ3Collision(geometry) };
                break;
        }
        this.spatial = new SpatialIndex(this.#geometry.provider.modelBounds(0));
    }
    link(body: LinkedBody, collision: ActorCollision): void { this.spatial.link(body, collision); }
    unlink(actor: ActorId): void { this.spatial.unlink(actor); }
    linkedActor(actor: ActorId): SpatialActor | null {
        const linked = this.spatial.get(actor);
        return linked === null ? null : this.#currentActor(linked);
    }
    bindActorState(read: (actor: ActorId) => BodyState | null): void { this.#readActorState = read; }
    bindActorCollision(read: (actor: ActorId) => ActorCollision | null): void { this.#readActorCollision = read; }
    #currentActor(linked: SpatialActor): SpatialActor | null {
        if (this.#readActorState === null && this.#readActorCollision === null) return linked;
        const collision = this.#readActorCollision === null ? linked.collision : this.#readActorCollision(linked.body.actor);
        if (collision === null) return null;
        const state = this.#readActorState === null ? linked.body.state : this.#readActorState(linked.body.actor);
        if (state === null) return null;
        return {
            body: { ...linked.body, state: {
                origin: { ...state.origin }, angles: { ...state.angles }, velocity: { ...state.velocity },
                bounds: { min: { ...state.bounds.min }, max: { ...state.bounds.max } }, ground: state.ground,
            } },
            collision,
        };
    }
    queryActors(bounds: Bounds, role: 'solid' | 'trigger' | 'both' = 'both'): readonly SpatialActor[] {
        const actors: SpatialActor[] = [];
        for (const linked of this.spatial.query(bounds, this.#readActorCollision === null ? role : 'both')) {
            const actor = this.#currentActor(linked);
            if (actor !== null && (role === 'both' || actor.collision.role === role)) actors.push(actor);
        }
        return actors;
    }
    pointLeaf(point: Vec3): number { return this.#geometry.provider.pointLeaf(point); }
    leafCluster(leaf: number): number { return this.#geometry.provider.leafCluster(leaf); }
    leafArea(leaf: number): number { return this.#geometry.provider.leafArea(leaf); }
    modelBounds(model: number): Bounds { return this.#geometry.provider.modelBounds(model); }
    boxLeaves(bounds: Bounds, limit: number): LeafQueryResult { return this.#geometry.provider.boxLeaves(bounds, limit); }
    areasConnected(first: number, second: number): boolean { return this.#geometry.provider.areasConnected(first, second); }
    areaBits(area: number): Uint8Array { return this.#geometry.provider.areaBits(area); }
    clusterVisible(from: number, to: number, kind: 'pvs' | 'phs'): boolean {
        const geometry = this.#geometry;
        return geometry.provider.clusterVisible(from, to, kind);
    }
    setAreaPortalState(portal: number, open: boolean): void {
        if (this.#geometry.kind !== 'q2')
            throw new RangeError('Portal identifiers belong to Quake II maps');
        this.#geometry.provider.setAreaPortalState(portal, open);
    }
    adjustAreaPortalState(first: number, second: number, open: boolean): void {
        if (this.#geometry.kind !== 'q3')
            throw new RangeError('Area-pair portal references belong to Quake III maps');
        this.#geometry.provider.adjustAreaPortalState(first, second, open);
    }
    geometryTrace(query: TraceQuery): TraceResult {
        if (query.shape.kind === 'box' && query.shape.bounds.min.x === 0 && query.shape.bounds.min.y === 0 && query.shape.bounds.min.z === 0
            && query.shape.bounds.max.x === 0 && query.shape.bounds.max.y === 0 && query.shape.bounds.max.z === 0)
            query = { ...query, shape: { kind: 'point' } };
        const geometry = this.#geometry;
        const result = adaptTraceResult(geometry.provider.trace(query), query.policy);
        if (result.kind !== 'q1' || geometry.kind === 'q1') return result;
        return { ...result, ...geometry.provider.traceMedia(query, result.fraction) };
    }
    trace(query: TraceQuery): TraceResult {
        return this.#trace(query, []);
    }
    traceExcluding(query: TraceQuery, excluded: readonly ActorId[]): TraceResult {
        return this.#trace(query, excluded);
    }
    #trace(query: TraceQuery, excluded: readonly ActorId[]): TraceResult {
        let result = this.geometryTrace(query);
        if (query.target.kind === 'model' || result.allSolid || query.policy.kind === 'q3' && result.fraction === 0)
            return result;
        const pass = query.passActor === null ? null : this.spatial.get(query.passActor);
        const passCollision = query.passActor === null ? null : this.#readActorCollision === null
            ? pass?.collision ?? null : this.#readActorCollision(query.passActor);
        let envelope = sweptBounds(query);
        if (query.policy.kind === 'q1' && query.policy.move === 'missile')
            envelope = sweptBounds({ ...query, shape: { kind: 'box', bounds: { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } } } });
        for (const linked of this.spatial.query(envelope, this.#readActorCollision === null ? 'solid' : 'both')) {
            const actor = this.#currentActor(linked);
            if (actor === null || actor.collision.role !== 'solid') continue;
            const collision = actor.collision, id = linked.body.actor;
            if (excluded.some(actor => sameActor(actor, id))) continue;
            if (query.passActor !== null) {
                if (sameActor(query.passActor, id)) continue;
                const rawPass = passCollision?.q3Owner, rawCandidate = collision.q3Owner;
                if (query.policy.kind === 'q3' && rawPass !== undefined && rawCandidate !== undefined) {
                    const passOwner = rawPass.ownerNumber === 1023 ? -1 : rawPass.ownerNumber;
                    if (rawCandidate.ownerNumber === rawPass.entityNumber || rawCandidate.ownerNumber === passOwner) continue;
                } else {
                    if (collision.owner !== null && sameActor(query.passActor, collision.owner)) continue;
                    const owner = passCollision?.owner;
                    if (owner !== null && owner !== undefined && (query.policy.kind === 'q3'
                        ? collision.owner !== null && sameActor(owner, collision.owner) : sameActor(owner, id))) continue;
                }
            }
            if (collision.q1Corpse === true && query.shape.kind !== 'point'
                && (query.shape.bounds.min.x !== query.shape.bounds.max.x || query.shape.bounds.min.y !== query.shape.bounds.max.y || query.shape.bounds.min.z !== query.shape.bounds.max.z))
                continue;
            if (query.policy.kind === 'q1' && query.policy.move === 'no-monsters' && collision.shape.kind !== 'model')
                continue;
            if (query.policy.kind === 'q1' ? actorContents(collision, 'q1') !== -2 : (actorContents(collision, query.policy.kind) & query.policy.contentsMask) === 0)
                continue;
            const moving: TraceQuery = query.policy.kind === 'q1' && query.policy.move === 'missile' && collision.monster ? { ...query, shape: { kind: 'box', bounds: { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } } } } : query;
            let hit: TraceResult;
            if (collision.shape.kind === 'model') {
                hit = this.geometryTrace({ ...moving, target: { kind: 'model', model: collision.shape.model, origin: actor.body.state.origin, angles: actor.body.state.angles } });
                if (hit.hit.kind !== 'none')
                    hit = { ...hit, hit: { kind: 'actor', actor: id } };
            }
            else
                hit = traceActorBody(moving, actor);
            // SV_Trace preserves the previous record at equal fraction, even for allsolid.
            if (query.policy.kind === 'q3') {
                if (hit.fraction < result.fraction) result = { ...hit, startSolid: hit.startSolid || result.startSolid };
                else result = { ...result, allSolid: result.allSolid || hit.allSolid, startSolid: result.startSolid || (!hit.allSolid && hit.startSolid) };
            }
            else if (hit.allSolid || hit.fraction < result.fraction || query.policy.kind === 'q1' && hit.startSolid)
                result = { ...hit, startSolid: hit.startSolid || result.startSolid };
            else if (hit.startSolid)
                result = { ...result, startSolid: true };
            if (result.allSolid)
                break;
        }
        return result;
    }
    pointContents(query: PointContentsQuery): PointContentsResult {
        let result = adaptPointContents(this.#geometry.provider.pointContents(query), query.policy);
        if (query.target.kind === 'model' || query.policy.kind === 'q1')
            return result;
        for (const linked of this.spatial.query({ min: query.point, max: query.point }, this.#readActorCollision === null ? 'solid' : 'both')) {
            if (query.passActor !== null && sameActor(query.passActor, linked.body.actor))
                continue;
            const actor = this.#currentActor(linked);
            if (actor === null || actor.collision.role !== 'solid') continue;
            const collision = actor.collision, state = actor.body.state;
            let added: number;
            if (collision.shape.kind === 'model') {
                const sample = adaptPointContents(this.#geometry.provider.pointContents({ ...query, target: { kind: 'model', model: collision.shape.model, origin: state.origin, angles: state.angles } }), query.policy);
                added = sample.kind === 'q2' ? query.policy.kind === 'q2' && query.policy.leafContents === 'stored' ? sample.stored : sample.merged : sample.contents;
            }
            else {
                const p = { x: query.point.x - state.origin.x, y: query.point.y - state.origin.y, z: query.point.z - state.origin.z }, b = state.bounds;
                if (p.x < b.min.x || p.y < b.min.y || p.z < b.min.z || p.x > b.max.x || p.y > b.max.y || p.z > b.max.z)
                    continue;
                added = actorContents(collision, query.policy.kind);
            }
            if (result.kind === 'q1') {
                if (added === -2)
                    result = { kind: 'q1', contents: -2 };
            }
            else if (result.kind === 'q2')
                result = { kind: 'q2', stored: result.stored | added, merged: result.merged | added };
            else
                result = { kind: 'q3', contents: result.contents | added };
        }
        return result;
    }
}
export function createSceneQueries(world: DecodedWorld): SharedSceneQueries { return new SharedSceneQueries(world); }
