import type { ContentDigest } from "./content.ts";
import type { ModelTransform } from "./scene.ts";

export type ModelAttachmentDefinition = { readonly digest: ContentDigest; readonly grip: ModelTransform } & (
  | { readonly kind: "joint"; readonly name: string }
  | { readonly kind: "mesh"; readonly referenceFrame: number; readonly vertices: readonly [number, number, number] }
);
