import type { DrawBatch, RenderOperation } from "../../contracts/render.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";

export type SequencePhase = "sky" | "opaque" | "translucent";
export type SceneGroupOrder = { readonly kind: "compiled"; readonly material: CompiledMaterial }
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

export function sequenceDrawGroup(phase: SequencePhase, batches: readonly DrawBatch[]): SceneModelGroup {
  return { kind: "scene-group", order: { kind: "sequence", phase }, operations: [{ kind: "draw", batches }] };
}

export function sceneModelBatches(groups: readonly SceneModelGroup[]): readonly DrawBatch[] {
  return groups.flatMap(group => group.operations.flatMap(operation => operation.batches));
}

function priority(order: SceneGroupOrder): number {
  if (order.kind === "compiled") return order.material.finished.sort;
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
    const compiled = pending.filter(entry => entry.group.order.kind === "compiled")
      .sort((a, b) => priority(a.group.order) - priority(b.group.order) || a.ordinal - b.ordinal);
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
