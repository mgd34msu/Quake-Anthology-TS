import { SaveReader } from '../../../../persistence/value.ts';
import { readSavedActor, savedActorId } from '../../../../persistence/save-image.ts';
// sharedEntity_t borrowing and SV_LinkEntity semantics from id Software's sv_world.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ActorId, OwnedActor, ProviderId } from '../../../../contracts/identity.ts';
import type { BodyState } from '../../../../contracts/world.ts';
import type { Vec3 } from '../../../../contracts/math.ts';
import type { Q3PlayerState } from '../../../../contracts/protocol.ts';
import type { QvmGameData } from '../../../../compat/qvm/game-data.ts';
import type { QvmSystemCallResult } from '../../../../compat/qvm/interpreter.ts';
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
  admit?(actor: OwnedActor): undefined;
}

/** Identities denote VM slots. The ABI exposes unlink, but no game-private free event. */
export class Q3GuestRecords {
  private writePlayerVelocity: ((actor: OwnedActor, velocity: Vec3) => undefined) | null = null;
  setPlayerVelocityWriter(write: (actor: OwnedActor, velocity: Vec3) => undefined): void { this.writePlayerVelocity = write; }
  private readonly actors = new Map<number, OwnedActor>();
  private readonly links = new Map<number, ReturnType<Q3VisibilityBindings['link']>>();
  private readonly retiredInputs = new Set<number>();
  private readonly inputMotion = new Set<number>();
  private closed = false;
  private readonly unobserve: () => undefined;

  constructor(readonly data: QvmGameData, readonly host: Q3GuestRecordHost) {
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

  setPlayerViewRoll(actor: ActorId, roll: number): void {
    const slot = this.slot(actor);
    if (slot === null || slot >= this.data.numClients || this.retiredInputs.has(slot)) throw new Error('Q3 source view requires the current client actor');
    const state = this.player(slot);
    this.data.writePlayerState(slot, { ...state, viewAngles: { ...state.viewAngles, z: Math.fround(roll) } });
  }

  actor(slot: number): OwnedActor {
    this.entity(slot);
    if (this.retiredInputs.has(slot)) throw new Error('Q3 input client is retiring');
    if (slot >= 1022) throw new RangeError('Q3 world and none slots cannot own shared actors');
    const current = this.actors.get(slot);
    if (current !== undefined) { this.host.actors.assertOwned(current); return current; }
    const actor = this.host.actors.allocateAtSource(this.host.provider, slot, 'q3:guest-slot');
    this.bind(slot, actor);
    return actor;
  }

  private bind(slot: number, actor: OwnedActor): void {
    this.actors.set(slot, actor);
    this.host.bodies.bind(actor, {
      read: () => this.body(slot),
      write: body => {
        const entity = this.entity(slot);
        if (this.inputMotion.has(slot)) this.data.writePlayerState(slot, { ...this.player(slot), origin: body.origin, velocity: body.velocity });
        else if (slot < this.data.numClients) this.writePlayerVelocity?.(actor, body.velocity);
        entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles;
        entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
        entity.s.pos = { ...entity.s.pos, delta: body.velocity };
        if (!this.inputMotion.has(slot)) entity.s.groundEntityNum = body.ground === null ? 1023 : this.requireSlot(body.ground);
        return undefined;
      },
    });
    this.host.admit?.(actor);
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
    return slot < 0 || slot >= 1022 || this.retiredInputs.has(slot) ? null : this.actor(slot).id;
  }

  body(slot: number): BodyState {
    const entity = this.entity(slot), shared = entity.r;
    return { origin: this.inputMotion.has(slot) ? this.player(slot).origin : shared.currentOrigin, angles: shared.currentAngles, velocity: slot < this.data.numClients ? this.player(slot).velocity : entity.s.pos.delta,
      bounds: { min: shared.mins, max: shared.maxs }, ground: this.actors.get(entity.s.groundEntityNum)?.id ?? null };
  }

  collision(slot: number): ActorCollision {
    const shared = this.entity(slot).r, model = shared.model;
    return { family: 'q3', shape: model.kind === 'inline' ? { kind: 'model', model: model.index } : model,
      contents: shared.contents, owner: this.actors.get(shared.ownerNum)?.id ?? null,
      q3Owner: { entityNumber: slot, ownerNumber: shared.ownerNum }, role: 'solid', monster: false, deadMonster: false };
  }

  link(slot: number): void {
    if (this.retiredInputs.has(slot)) { this.entity(slot).r.linked = false; return; }
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
    const bounds = { min: shared.absmin, max: shared.absmax };
    const nativeLeaves = models?.world.boxLeafnums(bounds, 128);
    const leaves = nativeLeaves ?? scene.boxLeaves(bounds, scene.geometry.leaves.length);
    const clusterLeaves = nativeLeaves === undefined ? [...leaves.leaves].sort((a, b) => scene.leafCluster(a) - scene.leafCluster(b)) : leaves.leaves;
    const lastLeaf = nativeLeaves?.lastLeaf ?? clusterLeaves.at(-1) ?? 0;
    let areanum = -1, areanum2 = -1, lastCluster = 0;
    const clusters: number[] = [];
    for (const leaf of leaves.leaves) {
      const area = scene.leafArea(leaf);
      if (area === -1) continue;
      if (areanum !== -1 && areanum !== area) areanum2 = area;
      else areanum = area;
    }
    for (const leaf of clusterLeaves) {
      const cluster = scene.leafCluster(leaf);
      if (cluster === -1) continue;
      clusters.push(cluster);
      if (clusters.length === 16) { lastCluster = scene.leafCluster(lastLeaf); break; }
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

  captureCheckpoint() {
    if (this.closed) throw new Error('Q3 guest records are retired');
    if (this.retiredInputs.size !== 0 || this.inputMotion.size !== 0) throw new Error('Q3 input must finish before checkpoint');
    return [...this.actors].map(([slot, actor]) => {
      this.host.actors.assertOwned(actor);
      const link = this.links.get(slot);
      return { slot, actor: savedActorId(actor.id), visibility: link === undefined ? null : {
        areanum: link.areanum, areanum2: link.areanum2, clusters: [...link.clusters], lastCluster: link.lastCluster } };
    });
  }

  restoreCheckpoint(value: unknown): void {
    if (this.closed || this.actors.size !== 0) throw new Error('Q3 guest records restore requires a fresh candidate');
    const reader = new SaveReader(value, 'q3.guest.records');
    const entries = reader.list(entry => ({ slot: entry.field('slot').integer(0), actor: readSavedActor(entry.field('actor')),
      visibility: entry.field('visibility').nullable(link => ({ areanum: link.field('areanum').integer(-1),
        areanum2: link.field('areanum2').integer(-1), clusters: link.field('clusters').list(cluster => cluster.integer(0)),
        lastCluster: link.field('lastCluster').integer(-1) })) }));
    const slots = new Set<number>(), actors = new Set<OwnedActor>();
    const bindings = entries.map(entry => {
      this.entity(entry.slot);
      const actor = this.host.actors.resolveSaved(entry.actor);
      if (entry.slot >= 1022 || slots.has(entry.slot) || actor === null || actors.has(actor)
        || actor.owner !== this.host.provider || this.host.actors.atSource(this.host.provider, entry.slot) !== actor
        || (entry.visibility !== null && entry.visibility.clusters.length > 16)) throw reader.fail('invalid source actor or visibility binding');
      slots.add(entry.slot); actors.add(actor);
      return { ...entry, actor };
    });
    if (actors.size !== this.host.actors.ownedBy(this.host.provider).filter(actor => this.host.actors.sourceOf(actor.id)?.slot !== 1022).length) reader.fail('guest record checkpoint omits owned actors');
    for (const entry of bindings) {
      this.bind(entry.slot, entry.actor);
      if (entry.visibility !== null) this.links.set(entry.slot, entry.visibility);
    }
  }

  releaseClient(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.data.numClients) throw new RangeError('Q3 client slot is outside configured game data');
    if (slot < this.data.numEntities) this.unlink(slot);
    const actor = this.actors.get(slot);
    if (actor !== undefined) this.host.actors.release(actor);
  }

  retireInputClient(slot: number): void { this.retiredInputs.add(slot); this.unlink(slot); }
  finishInputRetirement(slot: number): void { this.retiredInputs.delete(slot); }
  isInputRetired(slot: number): boolean { return this.retiredInputs.has(slot); }
  withInputMotion(slot: number, run: () => QvmSystemCallResult): QvmSystemCallResult {
    const previous = this.inputMotion.has(slot); this.inputMotion.add(slot);
    const finish = (): void => { if (!previous) this.inputMotion.delete(slot); };
    try { const result = run(); if (typeof result !== 'number') return result.finally(finish); finish(); return result; }
    catch (error) { finish(); throw error; }
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
