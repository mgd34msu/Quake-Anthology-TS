import type { RankingAccountRequest, RankingPlayerState, RankingServiceState } from "../../network/services/rankings.ts";

/** Account UI actions target an admitted source slot, never a platform identity inferred from a player name. */
export interface RankingAccountActions {
  service(): RankingServiceState;
  player(): RankingPlayerState;
  submit(request: RankingAccountRequest): Promise<void>;
  reset(): Promise<void>;
  spectate(): Promise<void>;
}
export type RankingAccountView =
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "busy" }
  | { readonly kind: "account"; readonly player: RankingPlayerState };
export function rankingAccountView(actions: RankingAccountActions): RankingAccountView {
  const service = actions.service();
  switch (service.kind) {
    case "disabled": return { kind: "disabled" };
    case "unavailable": return { kind: "unavailable", message: service.reason };
    case "starting": case "ending": return { kind: "busy" };
    case "active": return { kind: "account", player: actions.player() };
  }
}
