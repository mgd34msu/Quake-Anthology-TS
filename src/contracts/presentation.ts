import type { ProviderId } from "./identity.ts";

/** A component activation, retained with its output across a world checkpoint. */
export interface PresentationOwner { readonly provider: ProviderId; readonly generation: number; }

export type ComponentPresentationMediaRequest =
  | { readonly kind: "music"; readonly intro: string; readonly loop: string }
  | { readonly kind: "music-stop" }
  | { readonly kind: "shader-remap"; readonly original: string; readonly replacement: string; readonly timeOffset: number };

export function presentationOwnerKey(owner: PresentationOwner | undefined): string {
  return owner === undefined ? "primary" : JSON.stringify([owner.provider, owner.generation]);
}

export function samePresentationOwner(left: PresentationOwner | undefined, right: PresentationOwner): boolean {
  return left?.provider === right.provider && left.generation === right.generation;
}
