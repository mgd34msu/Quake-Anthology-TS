import type { ActorId } from "../../../contracts/identity.ts";
import type { Q2FoundationHost, Q2GameOptions } from "../../q2/foundation/host.ts";
import type { Q2Weapons } from "../../q2/foundation/weapons/index.ts";
import type { Q2ItemHooks } from "../../q2/foundation/items.ts";
import type { Q2PlayerHooks, Q2PlayerRules } from "../../q2/base/player/index.ts";
import type { Q2BaseEntityHooks } from "../../q2/base/entities/types.ts";
import type { Q2MissionPackPlayerEffect } from "../../q2/missionpacks/types.ts";
import type { Q2MissionPackEntityEvent } from "../../q2/missionpacks/entities/types.ts";
import type { Q2RereleaseHooks, Q2RereleaseOptions } from "../../q2/rerelease/types.ts";
import type { Q2RereleaseCampaignState } from "../../q2/rerelease/entities.ts";

export type Q2ClassicProgram = "baseq2" | "xatrix" | "rogue";
export type Q2RereleaseProgram = Q2ClassicProgram | "mg2" | "n64";
export type Q2MatchSelection = { readonly kind: "standard" } | { readonly kind: "tag" }
  | { readonly kind: "deathball"; readonly team1Skin: string; readonly team2Skin: string; readonly goalLimit: number };
export type Q2CompositionEvent =
  | { readonly kind: "missionpack-player"; readonly event: Q2MissionPackPlayerEffect }
  | { readonly kind: "missionpack-entity"; readonly event: Q2MissionPackEntityEvent };

/** These operations use the session's selected movement and presentation owners. */
export interface Q2CompositionServices {
  gravity(): number;
  emit(event: Q2CompositionEvent): undefined;
  readonly hunterCamera: boolean;
  readonly strongMines: boolean;
  /** Selected foreign arsenals keep their own powerup state. */
  foreignPowerups(actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number };
}

export interface Q2CompositionCommon {
  readonly host: Q2FoundationHost;
  readonly options: Omit<Q2GameOptions, "edition">;
  readonly weapons: Q2Weapons;
  readonly itemHooks: Q2ItemHooks;
  readonly playerHooks: Q2PlayerHooks;
  readonly playerRules?: Partial<Q2PlayerRules>;
  /** DeathBall is an explicit unified choice; native Rogue gamerules 3 never enabled it. */
  readonly match?: Q2MatchSelection;
  readonly entityHooks: Pick<Q2BaseEntityHooks, "playerPush" | "setActorGravity" | "localTime">;
  readonly services: Q2CompositionServices;
}

export type Q2CompositionOptions = Q2CompositionCommon & (
  | { readonly edition: "classic"; readonly program: Q2ClassicProgram }
  | { readonly edition: "rerelease"; readonly program: Q2RereleaseProgram;
      readonly rereleaseHooks: Q2RereleaseHooks;
      readonly rereleaseOptions?: Partial<Q2RereleaseOptions>;
      readonly campaign?: Q2RereleaseCampaignState }
);
