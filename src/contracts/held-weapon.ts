import type { ModelTransform } from "./scene.ts";
import type { ContentDigest } from "./content.ts";

export type HeldWeaponDeclaration = { readonly kind: "none" } | { readonly kind: "model"; readonly model: HeldWeaponModel };

export interface HeldWeaponModel {
  readonly digest?: ContentDigest;
  readonly path: string;
  readonly referenceFrame: number;
  readonly grip: ModelTransform;
  readonly fallback?: string;
  readonly part?: { readonly digests: readonly string[]; readonly vertices: readonly number[] };
}
