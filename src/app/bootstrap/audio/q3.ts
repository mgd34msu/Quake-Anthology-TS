import type { InstalledCatalog } from "../../../content/catalog/index.ts";
import { q3CustomSoundFallback } from "../../../content/q3/presentation/character-resources.ts";
import type { ContentId } from "../../../contracts/content.ts";
import type { LoopSound, PlaySound } from "../../../audio/types.ts";
import type { ActorId, ProviderId, SeatId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";

export type Q3SeatAudioOperation = { readonly kind: "play"; readonly sound: PlaySound }
  | { readonly kind: "loop"; readonly sound: LoopSound }
  | { readonly kind: "position"; readonly actor: ActorId; readonly origin: Vec3 }
  | { readonly kind: "stop-loop"; readonly actor: ActorId }
  | { readonly kind: "clear-loops"; readonly killAll: boolean }
  | { readonly kind: "release-owner" };
export interface Q3SeatAudioFrame { readonly content: ContentId; readonly seat: SeatId; readonly owner?: ProviderId; readonly operations: readonly Q3SeatAudioOperation[]; }

/** Character/client-code edition follows the selected provider, including inherited mods. */
export function q3VoiceFallback(catalog: Pick<InstalledCatalog, "product">, content: ContentId, teamGame: boolean): "sarge" | "james" {
  let product = catalog.product(content);
  for (;;) {
    if (product.expectation.campaign === "missionpack") return q3CustomSoundFallback("missionpack", teamGame);
    if (product.expectation.baseProduct === null) return q3CustomSoundFallback("baseq3", teamGame);
    product = catalog.product(product.expectation.baseProduct);
  }
}
