import type { Vec3 } from "./math.ts";

/** Semantic outputs; each source explicitly maps its own private encodings. */
export type ModClientMovementMode = "normal" | "noclip" | "freeze";
export type ModClientOutput =
  | { readonly kind: "view-offset"; readonly value: Vec3 }
  | { readonly kind: "movement-mode"; readonly value: ModClientMovementMode }
  | { readonly kind: "stance"; readonly value: boolean };
export type ModClientOutputChannel = ModClientOutput["kind"];
export type ModClientOutputDeclaration<Scalar, Vector> =
  | { readonly kind: "view-offset"; readonly field: Vector }
  | { readonly kind: "view-offset"; readonly height: Scalar }
  | { readonly kind: "movement-mode"; readonly field: Scalar; readonly mask?: number;
      readonly values: readonly { readonly value: number; readonly mode: ModClientMovementMode }[] }
  | { readonly kind: "stance"; readonly field: Scalar; readonly mask?: number;
      readonly values: readonly { readonly value: number; readonly crouched: boolean }[] };
export interface ModClientMovementOutputs {
  readonly viewOffset?: Vec3;
  readonly mode?: ModClientMovementMode;
  readonly stance?: boolean;
}
