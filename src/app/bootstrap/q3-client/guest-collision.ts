import type { QvmClientClipModels } from '../../../compat/qvm/client-collision-syscalls.ts';
import type { QvmCvarServices } from '../../../compat/qvm/cvar-syscalls.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import { Q3_BINARY32_PROFILE } from '../../../core/numeric.ts';
import type { SharedSceneQueries } from '../../../world/collision/index.ts';
import { SOURCE_BOX_MODEL_HANDLE, SOURCE_CAPSULE_MODEL_HANDLE } from '../../../world/collision/q3/clip-models.ts';
import { createBoxModel, createCapsuleModel } from '../../../world/collision/q3/model.ts';
import type { TemporaryTraceQuery } from '../../../world/collision/q3/model.ts';
import { emptySourceTrace } from '../../../world/collision/q3/world.ts';
import type { SourceTraceResult } from '../../../world/collision/q3/world.ts';

const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Cgame traces geometry only; its entity clipping remains in the guest module. */
export class SharedQvmClientClipModels implements QvmClientClipModels {
  private bounds = { min: zero, max: zero };
  private box = createBoxModel(this.bounds);
  readonly world: { readonly hasNodes: boolean };
  constructor(private readonly scene: SharedSceneQueries, private readonly cvars: QvmCvarServices) {
    this.world = { hasNodes: scene.geometry.nodes.length !== 0 };
  }
  get modelCount(): number { return this.scene.geometry.models.length; }
  inlineModel(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.modelCount) throw new RangeError('CM_InlineModel: bad number');
    return index;
  }
  tempBoxModel(min: Vec3, max: Vec3, capsule: boolean): number {
    this.bounds = { min: { ...min }, max: { ...max } };
    if (!capsule) this.box = createBoxModel(this.bounds);
    return capsule ? SOURCE_CAPSULE_MODEL_HANDLE : SOURCE_BOX_MODEL_HANDLE;
  }
  private temporary(handle: number) {
    if (Number.isInteger(handle) && handle >= 0 && handle < this.modelCount) return null;
    if (handle === SOURCE_BOX_MODEL_HANDLE) return this.box;
    if (handle === SOURCE_CAPSULE_MODEL_HANDLE) return createCapsuleModel(this.bounds);
    throw new RangeError(`CM_ClipHandleToModel: bad handle ${handle}`);
  }
  private policy() {
    return { kind: 'q3', contentsMask: -1, curves: (this.cvars.get('cm_noCurves')?.integerValue ?? 0) === 0,
      playerCurveClip: (this.cvars.get('cm_playerCurveClip')?.integerValue ?? 1) !== 0 } satisfies Parameters<SharedSceneQueries['geometryTrace']>[0]['policy'];
  }
  pointContents(point: Vec3, handle: number): number { return this.transformedPointContents(point, handle, zero, zero); }
  transformedPointContents(point: Vec3, handle: number, origin: Vec3, angles: Vec3): number {
    const temporary = this.temporary(handle);
    if (!this.world.hasNodes) return 0;
    if (temporary !== null) return temporary.transformedPointContents(point, origin, angles);
    const result = this.scene.pointContents({ point, target: { kind: 'model', model: handle, origin, angles },
      passActor: null, numeric: Q3_BINARY32_PROFILE, policy: this.policy() });
    if (result.kind !== 'q3') throw new Error('QVM client contents lost Q3 policy');
    return result.contents;
  }
  traceWithoutNodes(handle: number): SourceTraceResult | null { this.temporary(handle); return this.world.hasNodes ? null : emptySourceTrace(); }
  trace(query: TemporaryTraceQuery, handle: number): SourceTraceResult { return this.transformedTrace(query, handle, zero, zero); }
  transformedTrace(query: TemporaryTraceQuery, handle: number, origin: Vec3, angles: Vec3): SourceTraceResult {
    const temporary = this.temporary(handle);
    if (!this.world.hasNodes) return { ...emptySourceTrace(), end: query.end };
    if (temporary !== null) return temporary.transformedTraceSource(query, origin, angles);
    const shape = query.shape;
    const result = this.scene.geometryTrace({ start: query.start, end: query.end,
      shape: shape.kind === 'point' ? shape : { kind: shape.kind, bounds: { min: shape.mins, max: shape.maxs } },
      target: { kind: 'model', model: handle, origin, angles }, passActor: null, numeric: Q3_BINARY32_PROFILE,
      policy: { ...this.policy(), contentsMask: query.mask } });
    if (result.kind !== 'q3') throw new Error('QVM client trace lost Q3 policy');
    return { fraction: result.fraction, end: result.end, allSolid: result.allSolid, startSolid: result.startSolid,
      contents: result.contents, surfaceFlags: result.surfaceFlags, plane: result.sourcePlane };
  }
}
