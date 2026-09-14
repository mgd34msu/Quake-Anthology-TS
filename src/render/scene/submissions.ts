import type { DrawBatch, RenderOperation } from "../../contracts/render.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";
import type { RegisteredSceneMaterial, SceneMaterialRegistrations, ShaderRegistration } from "./material-registrations.ts";
import { packSourceDrawSort, sortDrawSurfs } from "./source-sort.ts";

class SourceViewOrder {
  readonly #identity = Symbol("source-view-order");
  private entityCount = 0;
  constructor(readonly registrations: SceneMaterialRegistrations) {}
  equals(other: SourceViewOrder): boolean { return this.#identity === other.#identity; }
  reserveEntities(count: number): number {
    if (!Number.isInteger(count) || count < 0 || this.entityCount + count > 1022) throw new RangeError("Source view exceeds the refentity draw-sort field");
    const first = this.entityCount; this.entityCount += count; return first;
  }
}
export type SourceSceneOrder = SourceViewOrder;
export function createSourceSceneOrder(registrations: SceneMaterialRegistrations): SourceSceneOrder { return new SourceViewOrder(registrations); }
export function reserveSourceEntityRange(view: SourceSceneOrder, count: number): number { return view.reserveEntities(count); }
export type SourceEntityOrder = { readonly kind: "world" } | { readonly kind: "refentity"; readonly index: number };
export interface SourceSurfaceOrder {
  readonly view: SourceSceneOrder;
  readonly entity: SourceEntityOrder;
  readonly surface: number;
  readonly fog: number;
  readonly dlight: number;
}

export type SequencePhase = "sky" | "opaque" | "translucent";
export type SceneGroupOrder = { readonly kind: "compiled"; readonly material: CompiledMaterial }
  | { readonly kind: "source"; readonly material: RegisteredSceneMaterial; readonly source: SourceSurfaceOrder }
  | { readonly kind: "sequence"; readonly phase: SequencePhase };
type DrawOperation = Extract<RenderOperation, { readonly kind: "draw" }>;

export interface SceneGroup {
  readonly kind: "scene-group";
  readonly order: SceneGroupOrder;
  readonly operations: readonly RenderOperation[];
}

export interface SceneModelGroup extends SceneGroup {
  readonly operations: readonly DrawOperation[];
}

export type SceneOperation = RenderOperation | SceneGroup;

export function compiledDrawGroup(material: CompiledMaterial, batches: readonly DrawBatch[]): SceneModelGroup {
  return { kind: "scene-group", order: { kind: "compiled", material }, operations: [{ kind: "draw", batches }] };
}

export function sourceDrawGroup(material: RegisteredSceneMaterial, source: SourceSurfaceOrder, batches: readonly DrawBatch[]): SceneModelGroup {
  const entity = source.entity;
  if (!Number.isInteger(source.surface) || source.surface < 0) throw new RangeError("Source surface index must be nonnegative");
  if (entity.kind === "refentity" && (!Number.isInteger(entity.index) || entity.index < 0 || entity.index >= 1022)) throw new RangeError("Source refentity index exceeds the draw-sort field");
  if (!Number.isInteger(source.fog) || source.fog < 0 || source.fog > 31) throw new RangeError("Source fog index exceeds the draw-sort field");
  if (!Number.isInteger(source.dlight) || source.dlight < 0 || source.dlight > 3) throw new RangeError("Source light flag exceeds the draw-sort field");
  if (material.registration.provider.owner !== source.view.registrations) throw new Error("Source material belongs to another scene");
  return { kind: "scene-group", order: { kind: "source", material, source }, operations: batches.length === 0 ? [] : [{ kind: "draw", batches }] };
}

export function sequenceDrawGroup(phase: SequencePhase, batches: readonly DrawBatch[]): SceneModelGroup {
  return { kind: "scene-group", order: { kind: "sequence", phase }, operations: [{ kind: "draw", batches }] };
}

export function sceneModelBatches(groups: readonly SceneModelGroup[]): readonly DrawBatch[] {
  return groups.flatMap(group => group.operations.flatMap(operation => operation.batches));
}

function priority(order: SceneGroupOrder): number {
  if (order.kind !== "sequence") return order.material.finished.sort;
  switch (order.phase) {
    case "sky": return 2;
    case "opaque": return 3;
    case "translucent": return 9;
  }
}

export function finishSceneOperations(input: readonly SceneOperation[]): readonly RenderOperation[] {
  const result: RenderOperation[] = [];
  const pending: { readonly group: SceneGroup; readonly ordinal: number }[] = [];
  const flush = (): void => {
    const generic = pending.filter(entry => entry.group.order.kind === "compiled")
      .sort((a, b) => priority(a.group.order) - priority(b.group.order) || a.ordinal - b.ordinal);
    const source = pending.flatMap(entry => entry.group.order.kind === "source" ? [{ ...entry, order: entry.group.order, sort: 0 }] : []);
    const view = source[0]?.order.source.view;
    if (view !== undefined) {
      const ranks = new Map<ShaderRegistration, number>(view.registrations.snapshot().map((material, index) => [material.registration, index]));
      for (const entry of source) {
        if (entry.order.source.view !== view) throw new Error("Different source views share a sortable range");
        const rank = ranks.get(entry.order.material.registration);
        if (rank === undefined) throw new Error("Source material has no published shader rank");
        if (rank >= 16384) throw new RangeError("Source shader rank exceeds the draw-sort field");
        const order = entry.order.source, entity = order.entity.kind === "world" ? 1022 : order.entity.index;
        entry.sort = packSourceDrawSort(rank, entity, order.fog, order.dlight);
      }
      const at = (index: number) => {
        const entry = source[index];
        if (entry === undefined) throw new RangeError("Source draw-sort index is outside its range");
        return entry;
      };
      sortDrawSurfs({ length: source.length, getSort: index => at(index).sort,
        setSort: (index, sort) => { at(index).sort = sort; },
        swap: (first, second) => { const a = at(first), b = at(second); source[first] = b; source[second] = a; } });
    }
    const compiled: typeof pending = [];
    let sourceIndex = 0, genericIndex = 0;
    while (sourceIndex < source.length || genericIndex < generic.length) {
      const native = source[sourceIndex], other = generic[genericIndex];
      if (native !== undefined && (other === undefined || priority(native.group.order) < priority(other.group.order)
        || priority(native.group.order) === priority(other.group.order) && native.ordinal < other.ordinal)) {
        compiled.push(native); sourceIndex++;
      } else if (other !== undefined) { compiled.push(other); genericIndex++; }
    }
    const sequence = pending.filter(entry => entry.group.order.kind === "sequence");
    let materialIndex = 0, sequenceIndex = 0;
    while (materialIndex < compiled.length || sequenceIndex < sequence.length) {
      const material = compiled[materialIndex], legacy = sequence[sequenceIndex];
      if (material !== undefined && (legacy === undefined || priority(material.group.order) < priority(legacy.group.order)
        || priority(material.group.order) === priority(legacy.group.order) && material.ordinal < legacy.ordinal)) {
        result.push(...material.group.operations); materialIndex++;
      } else if (legacy !== undefined) {
        result.push(...legacy.group.operations); sequenceIndex++;
      }
    }
    pending.length = 0;
  };
  for (const operation of input) {
    if (operation.kind === "scene-group") pending.push({ group: operation, ordinal: pending.length });
    else { flush(); result.push(operation); }
  }
  flush();
  return result;
}
