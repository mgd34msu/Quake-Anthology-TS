import { Q3GuestWorld } from './guest-world.ts';
// Q3 server spatial traps from id Software's sv_game.c and sv_world.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Bounds, Vec3 } from '../../../../contracts/math.ts';
import type { TraceQuery } from '../../../../contracts/scene.ts';
import type { CvarRegistry } from '../../../../core/cvars/index.ts';
import { nativeAtoi, Q3_BINARY32_PROFILE } from '../../../../core/numeric.ts';
import type { QvmServerSpatialOperations, QvmServerTraceQuery } from '../../../../compat/qvm/server-game-syscalls.ts';
import type { QvmTraceRecord } from '../../../../compat/qvm/trace-record.ts';
import type { SharedSceneQueries } from '../../../../world/collision/index.ts';
import { createBoxModel, createCapsuleModel } from '../../../../world/collision/q3/model.ts';
import type { Q3VisibilityBindings } from '../../../../network/q3/visibility.ts';
import type { Q3GuestRecords } from './guest-records.ts';

export class Q3GuestSpatial implements QvmServerSpatialOperations {
  readonly world: Q3GuestWorld;
  constructor(readonly records: Q3GuestRecords, readonly scene: SharedSceneQueries, readonly cvars: CvarRegistry) {
    this.world = new Q3GuestWorld(scene);
    if (records.host.scene !== scene) throw new Error('Q3 guest spatial operations must use the record owner scene');
  }

  private query(input: QvmServerTraceQuery): TraceQuery {
    return { start: input.start, end: input.end, shape: input.shape,
      passActor: this.records.reference(input.passEntityNum), target: { kind: 'world' }, numeric: Q3_BINARY32_PROFILE,
      policy: { kind: 'q3', contentsMask: input.mask, curves: this.cvars.variableValue('cm_noCurves') === 0,
        playerCurveClip: (this.cvars.find('cm_playerCurveClip')?.integerValue ?? 1) !== 0 } };
  }

  trace(input: QvmServerTraceQuery): QvmTraceRecord {
    const result = this.scene.trace(this.query(input));
    if (result.kind !== 'q3') throw new Error('Shared scene returned a non-Q3 guest trace');
    const entityNum = result.hit.kind === 'actor' ? this.records.requireSlot(result.hit.actor)
      : result.fraction === 1 ? 1023 : 1022;
    return { fraction: result.fraction, end: result.end, allSolid: result.allSolid, startSolid: result.startSolid,
      contents: result.contents, surfaceFlags: result.surfaceFlags, plane: result.sourcePlane, entityNum };
  }

  pointContents(point: Vec3, passEntityNum: number): number {
    const models = this.scene.nativeQ3ClipModels(), zero = { x: 0, y: 0, z: 0 };
    const sample = this.scene.pointContents({ point, target: { kind: 'model', model: 0, origin: zero, angles: zero }, passActor: null, numeric: Q3_BINARY32_PROFILE,
      policy: { kind: 'q3', contentsMask: -1, curves: true, playerCurveClip: true } });
    if (sample.kind !== 'q3') throw new Error('Guest contents query lost its Q3 policy');
    let contents = sample.contents;
    for (const actor of this.scene.queryActors({ min: point, max: point })) {
      const slot = this.records.requireSlot(actor.body.actor);
      if (slot === passEntityNum) continue;
      const entity = this.records.entity(slot), model = entity.r.model;
      if (model.kind === 'inline') {
        const value = this.scene.pointContents({ point, target: { kind: 'model', model: model.index, origin: entity.r.currentOrigin, angles: entity.r.currentAngles }, passActor: null, numeric: Q3_BINARY32_PROFILE,
          policy: { kind: 'q3', contentsMask: -1, curves: true, playerCurveClip: true } });
        if (value.kind !== 'q3') throw new Error('Guest inline contents query lost its Q3 policy');
        contents |= value.contents;
      }
      else {
        const bounds = { min: entity.r.mins, max: entity.r.maxs };
        const temporary = model.kind === 'capsule' ? createCapsuleModel(bounds, models?.world.counters) : createBoxModel(bounds, models?.world.counters);
        contents |= temporary.transformedPointContents(point, entity.r.currentOrigin, entity.r.currentAngles);
      }
    }
    return contents;
  }

  areaEntities(bounds: Bounds, maximum: number): readonly number[] {
    if (!Number.isInteger(maximum) || maximum < -0x80000000 || maximum > 0x7fffffff) throw new RangeError('Q3 area entity capacity must be a signed 32-bit integer');
    const candidates = this.scene.queryActors(bounds);
    return (maximum < 0 ? candidates : candidates.slice(0, maximum)).map(actor => this.records.requireSlot(actor.body.actor));
  }

  entityContact(bounds: Bounds, slot: number, capsule: boolean): boolean {
    const entity = this.records.entity(slot), shared = entity.r, model = shared.model;
    const origin = { x: 0, y: 0, z: 0 };
    const query = this.query({ start: origin, end: origin, shape: { kind: capsule ? 'capsule' : 'box', bounds }, passEntityNum: 1023, mask: -1 });
    if (model.kind === 'inline') {
      const result = this.scene.geometryTrace({ ...query, target: { kind: 'model', model: model.index, origin: shared.currentOrigin, angles: shared.currentAngles } });
      return result.startSolid || result.allSolid;
    }
    const models = this.scene.nativeQ3ClipModels();
    const targetBounds = { min: shared.mins, max: shared.maxs };
    const temporary = model.kind === 'capsule' ? createCapsuleModel(targetBounds, models?.world.counters) : createBoxModel(targetBounds, models?.world.counters);
    const result = temporary.transformedTraceSource({ start: origin, end: origin, mask: -1,
      shape: { kind: capsule ? 'capsule' : 'box', mins: bounds.min, maxs: bounds.max } }, shared.currentOrigin, shared.currentAngles);
    return result.startSolid || result.allSolid;
  }

  setBrushModel(slot: number, name: string): void {
    if (!name.startsWith('*')) throw new Error(`SV_SetBrushModel: ${name} is not a brush model`);
    const index = nativeAtoi(name.slice(1)), bounds = this.scene.modelBounds(index);
    const entity = this.records.entity(slot);
    entity.r.model = { kind: 'inline', index };
    entity.r.mins = bounds.min; entity.r.maxs = bounds.max; entity.r.contents = -1;
    this.link(slot);
  }

  adjustAreaPortalState(slot: number, open: boolean): void {
    const link = this.records.visibility(slot);
    if (link === undefined) { this.world.adjustAreaPortalState(0, 0, open); return; }
    if (link.areanum2 !== -1) this.world.adjustAreaPortalState(link.areanum, link.areanum2, open);
  }

  areasConnected(first: number, second: number): boolean { return this.scene.areasConnected(first, second); }

  inPvs(first: Vec3, second: Vec3, ignorePortals: boolean): boolean {
    const a = this.scene.pointLeaf(first), b = this.scene.pointLeaf(second);
    return this.scene.clusterVisible(this.scene.leafCluster(a), this.scene.leafCluster(b), 'pvs')
      && (ignorePortals || this.scene.areasConnected(this.scene.leafArea(a), this.scene.leafArea(b)));
  }

  link(slot: number): void { this.records.link(slot); }
  unlink(slot: number): void { this.records.unlink(slot); }
  visibility(slot: number): ReturnType<Q3VisibilityBindings['link']> { return this.records.visibility(slot); }
}
