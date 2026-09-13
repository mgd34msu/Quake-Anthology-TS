import type { ModelTransform } from "../../../contracts/scene.ts";
import { scale3 } from "../../../core/math.ts";
import { composeModelTransform, modelLocalDelta } from "./transform.ts";

/** Register a model-space grip against a destination socket without changing its size. */
export function alignModelAttachment(source: ModelTransform, destination: ModelTransform): ModelTransform {
  const inverse: ModelTransform = {
    origin: modelLocalDelta(source, scale3(source.origin, -1)),
    axis: [modelLocalDelta(source, { x: 1, y: 0, z: 0 }), modelLocalDelta(source, { x: 0, y: 1, z: 0 }),
      modelLocalDelta(source, { x: 0, y: 0, z: 1 })],
    scale: { x: 1, y: 1, z: 1 },
  };
  return composeModelTransform(destination, inverse);
}
