import type { DrawBatch, DynamicImageSource, ImageResourceOperation, RendererImage, TextureBinding } from "../../contracts/render.ts";

/** Resolve each source once per draw, after successful uploads and before binding its image. */
export function createTextureResolver(apply: (operation: ImageResourceOperation) => void): (binding: TextureBinding) => TextureBinding {
  let resolved: Map<DynamicImageSource, RendererImage> | null = null;
  return binding => {
    if (binding.kind !== "dynamic-image") return binding;
    resolved ??= new Map<DynamicImageSource, RendererImage>();
    let image = resolved.get(binding.source);
    if (image === undefined) { image = binding.source.resolve(apply); resolved.set(binding.source, image); }
    return { kind: "bind-image", image };
  };
}

export function resolveDrawTextures(batch: DrawBatch, apply: (operation: ImageResourceOperation) => void): DrawBatch {
  const resolve = createTextureResolver(apply), texture = resolve(batch.texture);
  if (batch.texturing !== "pair") return texture === batch.texture ? batch : { ...batch, texture };
  const binding = resolve(batch.secondTexture.binding);
  // Unchanged batches keep their identity so backends can retain packed
  // geometry for the static surfaces that reuse the same batch object.
  return texture === batch.texture && binding === batch.secondTexture.binding
    ? batch
    : { ...batch, texture, secondTexture: { ...batch.secondTexture, binding } };
}
