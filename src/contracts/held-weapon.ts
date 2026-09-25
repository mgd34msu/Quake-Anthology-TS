import type { ModelTransform } from "./scene.ts";

export interface HeldWeaponModel {
  readonly path: string;
  readonly referenceFrame: number;
  readonly grip: ModelTransform;
  readonly fallback?: string;
  readonly part?: { readonly digests: readonly string[]; readonly vertices: readonly number[] };
}
