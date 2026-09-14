import type { DrawBatch, RendererImage, RenderVertex, SceneCamera } from '../../contracts/render.ts';
import type { DebugLine } from '../../debug/shapes.ts';
import { createViewProjector } from './view.ts';

/** Append after scene fog, before world text. Both backends consume these line batches. */
export function prepareDebugShapes(lines: readonly DebugLine[], camera: SceneCamera, whiteImage: RendererImage, lineWidth = 2): readonly DrawBatch[] {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) throw new RangeError('Invalid debug line width');
  const project = createViewProjector(camera), batches: DrawBatch[] = [];
  let vertices: RenderVertex[] = [], indices: number[] = [], depthTest: boolean | null = null;
  const flush = (): void => {
    if (vertices.length === 0) return;
    batches.push({ primitive: 'lines', lineWidth, lighting: { kind: 'vertex' }, texturing: 'single', vertices, indices,
      texture: { kind: 'bind-image', image: whiteImage }, state: { blend: { source: 'src-alpha', destination: 'one-minus-src-alpha' }, depthTest: depthTest === true ? 'less-equal' : 'always', depthWrite: false, alphaTest: 'none', cull: 'none', depthRange: [0, 1], polygonOffset: null } });
    vertices = []; indices = [];
  };
  for (const line of lines) {
    if (depthTest !== line.depthTest) flush();
    depthTest = line.depthTest;
    for (const point of [line.start, line.end]) { indices.push(vertices.length); vertices.push({ position: project(point), color: line.color, texCoord: { x: 0, y: 0 } }); }
  }
  flush();
  return batches;
}
