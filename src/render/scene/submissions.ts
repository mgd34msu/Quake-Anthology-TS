import type { BatchLighting, DrawBatch, MultitextureVertex, RenderOperation, RenderState, RenderVertex, TextureBinding } from "../../contracts/render.ts";
import type { Vec3 } from "../../contracts/math.ts";
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

function sameRenderState(a: RenderState, b: RenderState): boolean {
  return a.blend.source === b.blend.source && a.blend.destination === b.blend.destination
    && a.depthTest === b.depthTest && a.depthWrite === b.depthWrite && a.alphaTest === b.alphaTest && a.cull === b.cull
    && a.depthRange[0] === b.depthRange[0] && a.depthRange[1] === b.depthRange[1]
    && (a.polygonOffset === null && b.polygonOffset === null
      || a.polygonOffset !== null && b.polygonOffset !== null && a.polygonOffset.factor === b.polygonOffset.factor && a.polygonOffset.units === b.polygonOffset.units);
}
function sameTexture(a: TextureBinding, b: TextureBinding): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bind-image" && b.kind === "bind-image") return a.image === b.image;
  if (a.kind === "dynamic-image" && b.kind === "dynamic-image") return a.source === b.source;
  return true;
}
function sameLighting(a: BatchLighting, b: BatchLighting): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "vertex") return true;
  if (a.kind === "q2-model-shadow" && b.kind === "q2-model-shadow")
    return a.atlas === b.atlas && a.shadeScale === b.shadeScale && a.lights === b.lights;
  if (a.kind === "q2-world" && b.kind === "q2-world") {
    if (a.pass !== b.pass || a.atlas !== b.atlas || a.lights !== b.lights) return false;
    return a.pass !== "model" || b.pass === "model" && a.shadeScale === b.shadeScale;
  }
  return false;
}
function mergeable(a: DrawBatch, b: DrawBatch): boolean {
  if ((a.space ?? "clip") !== (b.space ?? "clip")) return false;
  if (a.texturing !== b.texturing || a.primitive !== b.primitive || a.textureEffect !== b.textureEffect) return false;
  if (a.primitive === "lines" && b.primitive === "lines" && a.lineWidth !== b.lineWidth) return false;
  if (!sameTexture(a.texture, b.texture) || !sameRenderState(a.state, b.state) || !sameLighting(a.lighting, b.lighting)) return false;
  if (a.texturing === "pair" && b.texturing === "pair"
    && (a.secondTexture.environment !== b.secondTexture.environment || !sameTexture(a.secondTexture.binding, b.secondTexture.binding))) return false;
  const fa = a.fog, fb = b.fog;
  if ((fa === undefined) !== (fb === undefined)) return false;
  if (fa !== undefined && fb !== undefined) {
    if (fa.kind !== fb.kind || fa.color.x !== fb.color.x || fa.color.y !== fb.color.y || fa.color.z !== fb.color.z) return false;
    if (fa.kind === "exp2" && fb.kind === "exp2" && (fa.density !== fb.density || fa.effect !== fb.effect)) return false;
    if (fa.kind === "constant" && fb.kind === "constant" && fa.amount !== fb.amount) return false;
  }
  return true;
}
type Q2WorldLighting = Extract<BatchLighting, { kind: "q2-world" }>;
type Q2ShadowLighting = Extract<BatchLighting, { kind: "q2-model-shadow" }>;
type LightingBuilder =
  | { readonly kind: "other"; readonly lighting: BatchLighting }
  | { readonly kind: "q2-world"; readonly template: Q2WorldLighting; readonly worldPositions: Vec3[]; readonly normals: Vec3[] }
  | { readonly kind: "q2-model-shadow"; readonly template: Q2ShadowLighting; readonly worldPositions: Vec3[] };
type BatchBuilder =
  | { readonly texturing: "single"; readonly template: Extract<DrawBatch, { texturing: "single" }>; readonly vertices: RenderVertex[]; readonly indices: number[]; readonly lighting: LightingBuilder }
  | { readonly texturing: "pair"; readonly template: Extract<DrawBatch, { texturing: "pair" }>; readonly vertices: MultitextureVertex[]; readonly indices: number[]; readonly lighting: LightingBuilder };

function lightingBuilder(lighting: BatchLighting): LightingBuilder {
  if (lighting.kind === "q2-world") return { kind: "q2-world", template: lighting, worldPositions: [...lighting.worldPositions], normals: [...lighting.normals] };
  if (lighting.kind === "q2-model-shadow") return { kind: "q2-model-shadow", template: lighting, worldPositions: [...lighting.worldPositions] };
  return { kind: "other", lighting };
}
function extendLighting(builder: LightingBuilder, lighting: BatchLighting): void {
  if (builder.kind === "q2-world" && lighting.kind === "q2-world") {
    builder.worldPositions.push(...lighting.worldPositions);
    builder.normals.push(...lighting.normals);
  } else if (builder.kind === "q2-model-shadow" && lighting.kind === "q2-model-shadow") builder.worldPositions.push(...lighting.worldPositions);
}
function builtLighting(builder: LightingBuilder): BatchLighting {
  if (builder.kind === "q2-world") return { ...builder.template, worldPositions: builder.worldPositions, normals: builder.normals };
  if (builder.kind === "q2-model-shadow") return { ...builder.template, worldPositions: builder.worldPositions };
  return builder.lighting;
}
function startBuilder(template: DrawBatch): BatchBuilder {
  const lighting = lightingBuilder(template.lighting);
  return template.texturing === "single"
    ? { texturing: "single", template, vertices: [...template.vertices], indices: [...template.indices], lighting }
    : { texturing: "pair", template, vertices: [...template.vertices], indices: [...template.indices], lighting };
}
function extendBuilder(builder: BatchBuilder, batch: DrawBatch): void {
  const offset = builder.vertices.length;
  if (builder.texturing === "single" && batch.texturing === "single") builder.vertices.push(...batch.vertices);
  else if (builder.texturing === "pair" && batch.texturing === "pair") builder.vertices.push(...batch.vertices);
  for (const index of batch.indices) builder.indices.push(index + offset);
  extendLighting(builder.lighting, batch.lighting);
}
function finishBuilder(builder: BatchBuilder): DrawBatch {
  const lighting = builtLighting(builder.lighting);
  return builder.texturing === "single"
    ? { ...builder.template, lighting, vertices: builder.vertices, indices: builder.indices }
    : { ...builder.template, lighting, vertices: builder.vertices, indices: builder.indices };
}
interface MergeSignature {
  readonly indices: DrawBatch["indices"];
  readonly worldPositions: readonly unknown[] | null;
  readonly normals: readonly unknown[] | null;
}
interface MergeNode {
  readonly next: WeakMap<object, MergeNode>;
  entry?: { readonly template: DrawBatch; readonly signature: readonly MergeSignature[]; readonly merged: DrawBatch };
}
/** Merged geometry retained by constituent array identity, like the GL pack
 * cache: a repeated run of the same immutable vertex/index (and lighting)
 * arrays reuses the previously merged batch, whose own arrays then keep a
 * stable identity for packing instead of being rebuilt every frame. */
const mergeRoots = new WeakMap<object, MergeNode>();
function mergeSignature(batch: DrawBatch): MergeSignature {
  if (batch.lighting.kind === "vertex") return { indices: batch.indices, worldPositions: null, normals: null };
  return { indices: batch.indices, worldPositions: batch.lighting.worldPositions,
    normals: batch.lighting.kind === "q2-world" ? batch.lighting.normals : null };
}
function retainedMerge(run: readonly DrawBatch[]): DrawBatch {
  const build = (): DrawBatch => {
    const first = run[0];
    if (first === undefined) throw new RangeError("Cannot merge an empty draw run");
    const builder = startBuilder(first);
    for (let index = 1; index < run.length; index++) {
      const batch = run[index];
      if (batch !== undefined) extendBuilder(builder, batch);
    }
    return finishBuilder(builder);
  };
  let vertices = 0;
  for (const batch of run) vertices += batch.vertices.length;
  if (run.length < 2 || vertices < 64) return build();
  const root = run[0];
  if (root === undefined) return build();
  let node: MergeNode = mergeRoots.get(root.vertices) ?? { next: new WeakMap() };
  mergeRoots.set(root.vertices, node);
  for (let index = 1; index < run.length; index++) {
    const batch = run[index];
    if (batch === undefined) break;
    const existing: MergeNode | undefined = node.next.get(batch.vertices);
    const next: MergeNode = existing ?? { next: new WeakMap() };
    if (existing === undefined) node.next.set(batch.vertices, next);
    node = next;
  }
  const entry = node.entry, template = run[0];
  if (entry !== undefined && template !== undefined && mergeable(entry.template, template)) {
    let valid = entry.signature.length === run.length;
    for (let index = 0; valid && index < run.length; index++) {
      const batch = run[index], part = entry.signature[index];
      if (batch === undefined || part === undefined || part.indices !== batch.indices) { valid = false; break; }
      const lighting = batch.lighting;
      valid = lighting.kind === "vertex" ? part.worldPositions === null && part.normals === null
        : part.worldPositions === lighting.worldPositions
          && part.normals === (lighting.kind === "q2-world" ? lighting.normals : null);
    }
    if (valid) return entry.merged;
  }
  const merged = build();
  if (template !== undefined) node.entry = { template, signature: run.map(mergeSignature), merged };
  return merged;
}

/**
 * Adjacent draws with identical state render identically when concatenated
 * (primitive order is preserved), so merge them: static world surfaces share
 * materials heavily, and each unmerged batch pays full pack + bind costs.
 * Runs of mergeable batches keep their merged geometry across frames when
 * the constituent arrays repeat (see retainedMerge).
 */
export function mergeDrawOperations(input: readonly RenderOperation[]): readonly RenderOperation[] {
  const result: RenderOperation[] = [];
  let pending: DrawBatch[] = [];
  let run: DrawBatch[] = [];
  const flushRun = (): void => {
    if (run.length === 1) { const only = run[0]; if (only !== undefined) pending.push(only); }
    else if (run.length > 1) pending.push(retainedMerge(run));
    run = [];
  };
  const flush = (): void => { flushRun(); if (pending.length !== 0) { result.push({ kind: "draw", batches: pending }); pending = []; } };
  for (const operation of input) {
    if (operation.kind !== "draw") { flush(); result.push(operation); continue; }
    for (const batch of operation.batches) {
      const template = run[0];
      if (template !== undefined && !mergeable(template, batch)) flushRun();
      run.push(batch);
    }
  }
  flush();
  return result;
}
