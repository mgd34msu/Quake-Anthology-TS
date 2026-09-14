// sharedEntity_t borrowing and SV_LinkEntity semantics from id Software's sv_world.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ActorId, OwnedActor, ProviderId } from '../../../../contracts/identity.ts';
import type { BodyState } from '../../../../contracts/world.ts';
import type { Q3PlayerState } from '../../../../contracts/protocol.ts';
import type { QvmGameData } from '../../../../compat/qvm/game-data.ts';
import type { QvmSharedEntity } from '../../../../compat/qvm/shared-entity-record.ts';
import type { SessionActorRegistry } from '../../../../world/actors/registry.ts';
import type { SharedBodyTable } from '../../../../world/actors/body.ts';
import type { ActorCollision, SharedSceneQueries } from '../../../../world/collision/index.ts';
import type { Q3VisibilityBindings } from '../../../../network/q3/visibility.ts';
import { add3, sub3, radiusFromBounds } from '../../../../core/math.ts';

export interface Q3GuestRecordHost {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly scene: SharedSceneQueries;
  readonly provider: ProviderId;
  collision(actor: OwnedActor, collision: ActorCollision): undefined;
}

/** Identities denote VM slots. The ABI exposes unlink, but no game-private free event. */
export class Q3GuestRecords {
  private readonly actors = new Map<number, OwnedActor>();
  private readonly links = new Map<number, ReturnType<Q3VisibilityBindings['link']>>();
  private closed = false;
  private readonly unobserve: () => undefined;

  constructor(readonly data: QvmGameData, readonly host: Q3GuestRecordHost) {
    if (host.scene.nativeQ3ClipModels() === null) throw new Error('Q3 guest records require the native shared Q3 scene');
    host.scene.bindActorCollision(actor => {
      const slot = this.slot(actor);
      return slot === null || slot >= data.numEntities ? null : this.collision(slot);
    });
    this.unobserve = host.actors.onRelease(actor => {
      const source = [...this.actors].find(([, owned]) => owned === actor);
      if (source !== undefined) { this.actors.delete(source[0]); this.links.delete(source[0]); }
      return undefined;
    });
  }

  entity(slot: number): QvmSharedEntity {
    if (this.closed) throw new Error('Q3 guest records are retired');
    return this.data.entity(slot);
  }

  player(slot: number): Q3PlayerState {
    if (this.closed) throw new Error('Q3 guest records are retired');
    return this.data.copyPlayerState(slot);
  }

  actor(slot: number): OwnedActor {
    this.entity(slot);
    if (slot >= 1022) throw new RangeError('Q3 world and none slots cannot own shared actors');
    const current = this.actors.get(slot);
    if (current !== undefined) { this.host.actors.assertOwned(current); return current; }
    const actor = this.host.actors.allocateAtSource(this.host.provider, slot, 'q3:guest-slot');
    this.actors.set(slot, actor);
    this.host.bodies.bind(actor, {
      read: () => this.body(slot),
      write: body => {
        const entity = this.entity(slot);
        entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles;
        entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
        entity.s.pos = { ...entity.s.pos, delta: body.velocity };
        entity.s.groundEntityNum = body.ground === null ? 1023 : this.requireSlot(body.ground);
        return undefined;
      },
    });
    return actor;
  }

  slot(actor: ActorId): number | null {
    if (this.closed) return null;
    const source = this.host.actors.sourceOf(actor);
    return source !== null && source.provider === this.host.provider && this.actors.get(source.slot)?.id.equals(actor) ? source.slot : null;
  }

  requireSlot(actor: ActorId): number {
    const slot = this.slot(actor);
    if (slot === null) throw new Error('Shared actor has no Q3 guest slot');
    return slot;
  }

  reference(slot: number): ActorId | null {
    return slot < 0 || slot >= 1022 ? null : this.actor(slot).id;
  }

  body(slot: number): BodyState {
    const entity = this.entity(slot), shared = entity.r;
    return { origin: shared.currentOrigin, angles: shared.currentAngles, velocity: entity.s.pos.delta,
      bounds: { min: shared.mins, max: shared.maxs }, ground: this.reference(entity.s.groundEntityNum) };
  }

  collision(slot: number): ActorCollision {
    const shared = this.entity(slot).r, model = shared.model;
    return { family: 'q3', shape: model.kind === 'inline' ? { kind: 'model', model: model.index } : model,
      contents: shared.contents, owner: this.actors.get(shared.ownerNum)?.id ?? null,
      q3Owner: { entityNumber: slot, ownerNumber: shared.ownerNum }, role: 'solid', monster: false, deadMonster: false };
  }

  link(slot: number): void {
    const entity = this.entity(slot), shared = entity.r, actor = this.actor(slot), scene = this.host.scene;
    this.host.bodies.unlink(actor); shared.linked = false;
    const model = shared.model;
    const byte = (value: number): number => Math.max(1, Math.min(255, Math.trunc(value)));
    entity.s.solid = model.kind === 'inline' ? 0xffffff : (shared.contents & (1 | 0x2000000)) === 0 ? 0
      : (byte(Math.fround(shared.maxs.z + 32)) << 16) | (byte(-shared.mins.z) << 8) | byte(shared.maxs.x);
    const angles = shared.currentAngles, origin = shared.currentOrigin;
    const rotated = model.kind === 'inline' && (angles.x !== 0 || angles.y !== 0 || angles.z !== 0);
    const radius = rotated ? radiusFromBounds({ min: shared.mins, max: shared.maxs }) : 0;
    const extent = { x: radius, y: radius, z: radius }, epsilon = { x: 1, y: 1, z: 1 };
    shared.absmin = sub3(rotated ? sub3(origin, extent) : add3(origin, shared.mins), epsilon);
    shared.absmax = add3(rotated ? add3(origin, extent) : add3(origin, shared.maxs), epsilon);
    const models = scene.nativeQ3ClipModels();
    if (models === null) throw new Error('Q3 guest scene retired');
    const leaves = models.world.boxLeafnums({ min: shared.absmin, max: shared.absmax }, 128);
    let areanum = -1, areanum2 = -1, lastCluster = 0;
    const clusters: number[] = [];
    for (const leaf of leaves.leaves) {
      const area = scene.leafArea(leaf);
      if (area === -1) continue;
      if (areanum !== -1 && areanum !== area) areanum2 = area;
      else areanum = area;
    }
    for (const leaf of leaves.leaves) {
      const cluster = scene.leafCluster(leaf);
      if (cluster === -1) continue;
      clusters.push(cluster);
      if (clusters.length === 16) { lastCluster = scene.leafCluster(leaves.lastLeaf); break; }
    }
    this.links.set(slot, { areanum, areanum2, clusters, lastCluster });
    if (leaves.leaves.length === 0) return;
    this.host.collision(actor, this.collision(slot));
    this.host.bodies.link(actor);
    shared.linkcount = (shared.linkcount + 1) | 0;
    shared.linked = true;
  }

  unlink(slot: number): void {
    this.entity(slot).r.linked = false;
    const actor = this.actors.get(slot);
    if (actor !== undefined) this.host.bodies.unlink(actor);
  }

  visibility(slot: number): ReturnType<Q3VisibilityBindings['link']> { this.entity(slot); return this.links.get(slot); }

  releaseClient(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.data.numClients) throw new RangeError('Q3 client slot is outside configured game data');
    if (slot < this.data.numEntities) this.unlink(slot);
    const actor = this.actors.get(slot);
    if (actor !== undefined) this.host.actors.release(actor);
  }

  close(): void {
    if (this.closed) return;
    for (const [slot, actor] of this.actors) {
      if (slot < this.data.numEntities) this.entity(slot).r.linked = false;
      this.host.actors.release(actor);
    }
    this.closed = true;
    this.unobserve(); this.links.clear();
  }
}
