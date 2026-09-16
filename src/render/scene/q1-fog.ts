// Quakespasm r_world.c uses normal fog after texture/lightmap composition,
// and black fog for additive contributions. GPL-2.0-or-later.
import type { DrawBatch, RenderOperation, SceneFog } from '../../contracts/render.ts';

export function fogSceneOperations(operations: readonly RenderOperation[], fog: Extract<SceneFog, { readonly kind: 'q1' }> | undefined): readonly RenderOperation[] {
  if (fog === undefined || fog.density <= 0) return operations;
  const apply = (batch: DrawBatch): DrawBatch => {
    if (batch.fog !== undefined) return batch;
    const additive = batch.state.blend.destination === 'one';
    return { ...batch, fog: { kind: 'exp2', density: fog.density, color: additive ? { x: 0, y: 0, z: 0 } : fog.color } };
  };
  return operations.map(operation => operation.kind === 'draw' || operation.kind === 'object-opacity'
    ? { ...operation, batches: operation.batches.map(apply) } : operation);
}
