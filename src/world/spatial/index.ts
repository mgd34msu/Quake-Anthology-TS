/* Sector membership adapted from Quake sv_world.c and Quake III sv_world.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId, SessionId } from '../../contracts/identity.ts';
import { sameActor } from '../../contracts/identity.ts';
import type { Bounds } from '../../contracts/math.ts';
import type { LinkedBody } from '../../contracts/world.ts';
import type { CollisionFamily } from '../collision/contents.ts';
export interface ActorCollision {
    readonly family: CollisionFamily;
    readonly shape: {
        readonly kind: 'box' | 'capsule';
    } | {
        readonly kind: 'model';
        readonly model: number;
    };
    readonly contents: number;
    readonly owner: ActorId | null;
    readonly q3Owner?: { readonly entityNumber: number; readonly ownerNumber: number };
    readonly role: 'solid' | 'trigger';
    readonly monster: boolean;
    readonly deadMonster: boolean;
    /** Declared rerelease corpse policy: point attacks hit; bodies pass through. */
    readonly q1Corpse?: true;
}
export interface SpatialActor {
    readonly body: LinkedBody;
    readonly collision: ActorCollision;
}
interface Member {
    readonly actor: SpatialActor;
    sector: Sector | null;
    next: Member | null;
    previous: Member | null;
}
interface Sector {
    readonly split: {
        readonly axis: 'x' | 'y';
        readonly distance: number;
        readonly front: Sector;
        readonly back: Sector;
    } | null;
    head: Member | null;
    tail: Member | null;
}
export function boundsIntersect(first: Bounds, second: Bounds): boolean {
    return first.min.x <= second.max.x && first.min.y <= second.max.y && first.min.z <= second.max.z && first.max.x >= second.min.x && first.max.y >= second.min.y && first.max.z >= second.min.z;
}
function makeSector(bounds: Bounds, depth: number): Sector {
    if (depth === 4)
        return { split: null, head: null, tail: null };
    const axis = bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y ? 'x' : 'y';
    const distance = Math.fround(Math.fround(bounds.max[axis] + bounds.min[axis]) * 0.5);
    return { head: null, tail: null, split: { axis, distance, front: makeSector({ min: { ...bounds.min, [axis]: distance }, max: bounds.max }, depth + 1), back: makeSector({ min: bounds.min, max: { ...bounds.max, [axis]: distance } }, depth + 1) } };
}
/** One membership owner; queries observe the most recent explicit link snapshot. */
export class SpatialIndex {
    readonly #root: Sector;
    readonly #members = new Map<number, Member>();
    #session: SessionId | null = null;
    constructor(bounds: Bounds) { this.#root = makeSector(bounds, 0); }
    link(body: LinkedBody, collision: ActorCollision): void {
        if (this.#session === null)
            this.#session = body.actor.session;
        if (this.#session !== body.actor.session)
            throw new RangeError('Actor belongs to another scene session');
        const previous = this.#members.get(body.actor.slot);
        if (previous !== undefined)
            this.unlink(previous.actor.body.actor);
        const captured: LinkedBody = { ...body, state: { ...body.state, origin: { ...body.state.origin }, angles: { ...body.state.angles }, velocity: { ...body.state.velocity }, bounds: { min: { ...body.state.bounds.min }, max: { ...body.state.bounds.max } } }, absoluteBounds: { min: { ...body.absoluteBounds.min }, max: { ...body.absoluteBounds.max } } };
        const member: Member = { actor: { body: captured, collision: { ...collision, shape: { ...collision.shape } } }, sector: null, next: null, previous: null };
        let sector = this.#root;
        const bounds = body.absoluteBounds;
        while (sector.split !== null) {
            const split = sector.split;
            if (bounds.min[split.axis] > split.distance)
                sector = split.front;
            else if (bounds.max[split.axis] < split.distance)
                sector = split.back;
            else
                break;
        }
        member.sector = sector;
        if (collision.family === 'q3') {
            member.next = sector.head;
            if (sector.head !== null)
                sector.head.previous = member;
            else
                sector.tail = member;
            sector.head = member;
        }
        else {
            member.previous = sector.tail;
            if (sector.tail !== null)
                sector.tail.next = member;
            else
                sector.head = member;
            sector.tail = member;
        }
        this.#members.set(body.actor.slot, member);
    }
    unlink(actor: ActorId): void {
        const member = this.#members.get(actor.slot);
        if (member === undefined || !sameActor(member.actor.body.actor, actor))
            return;
        const sector = member.sector;
        if (sector === null)
            return;
        if (member.previous === null)
            sector.head = member.next;
        else
            member.previous.next = member.next;
        if (member.next === null)
            sector.tail = member.previous;
        else
            member.next.previous = member.previous;
        member.sector = null;
        this.#members.delete(actor.slot);
    }
    get(actor: ActorId): SpatialActor | null { const member = this.#members.get(actor.slot); return member !== undefined && sameActor(member.actor.body.actor, actor) ? member.actor : null; }
    visit(bounds: Bounds, visit: (actor: SpatialActor) => 'continue' | 'stop-sector' | 'stop'): void {
        const walk = (sector: Sector): boolean => {
            for (let member = sector.head; member !== null;) {
                const next = member.next;
                if (boundsIntersect(member.actor.body.absoluteBounds, bounds)) {
                    const result = visit(member.actor);
                    if (result === 'stop')
                        return false;
                    if (result === 'stop-sector')
                        return true;
                }
                member = next;
            }
            const split = sector.split;
            if (split !== null) {
                if (bounds.max[split.axis] > split.distance && !walk(split.front))
                    return false;
                if (bounds.min[split.axis] < split.distance && !walk(split.back))
                    return false;
            }
            return true;
        };
        walk(this.#root);
    }
    query(bounds: Bounds, role: 'solid' | 'trigger' | 'both' = 'both'): readonly SpatialActor[] {
        const result: SpatialActor[] = [];
        this.visit(bounds, actor => { if (role === 'both' || actor.collision.role === role)
            result.push(actor); return 'continue'; });
        return result;
    }
    clear(): void { for (const member of this.#members.values()) {
        const sector = member.sector;
        if (sector !== null) {
            sector.head = null;
            sector.tail = null;
            member.sector = null;
        }
    } this.#members.clear(); }
}
