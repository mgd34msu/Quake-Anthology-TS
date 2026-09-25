import type { ActorId } from "../../contracts/identity.ts";
import type { ModIdentity } from "../../contracts/mods.ts";
import type { PresentationOwner } from "../../contracts/presentation.ts";
import type { PlayerView } from "../../app/bootstrap/simulation/types.ts";
import type { NativeQ2HudFrame } from "../../ui/hud/q2-native.ts";

export interface ModClientPresentationAdmission {
  readonly hud: "none" | "overlay" | "replace";
  readonly view: boolean;
}
export interface NativeModCameraView extends PlayerView {
  readonly native: {
    readonly edition: "classic" | "rerelease";
    readonly movementOrigin: PlayerView["origin"];
    readonly renderFlags: number;
    readonly positionPrediction: boolean;
    readonly angularPrediction: boolean;
    readonly weaponVisible: boolean;
  };
}
export type ModClientPresentationFrame =
  | { readonly kind: "qvm"; readonly hud: { readonly mode: "overlay" | "replace-status" }; readonly view: null }
  | { readonly kind: "quakec"; readonly hud: { readonly health: number; readonly armor: number } | null; readonly view: PlayerView | null }
  | { readonly kind: "native"; readonly hud: { readonly mode: "layout-overlay" | "replace-status"; readonly frame: NativeQ2HudFrame } | null; readonly view: NativeModCameraView | null };

/** Module storage remains authoritative; the returned frame contains detached source values. */
export interface ModClientPresentationSource {
  readonly generation: number;
  frame(actor: ActorId): ModClientPresentationFrame | null;
  assertCurrent(): void;
}
export interface ActiveModClientPresentation {
  readonly owner: PresentationOwner;
  readonly identity: ModIdentity;
  readonly source: ModClientPresentationSource;
}
