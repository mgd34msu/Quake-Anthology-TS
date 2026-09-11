import { GameType } from "../base/shared/definitions.ts";
import type { Product } from "../base/shared/definitions.ts";

export type ObjectiveClassname = "team_CTF_redflag" | "team_CTF_blueflag" | "team_CTF_neutralflag"
  | "team_redobelisk" | "team_blueobelisk" | "team_neutralobelisk";

export type ObjectivePlacementResult =
  | { readonly kind: "ready" }
  | { readonly kind: "missing-objectives"; readonly classnames: readonly ObjectiveClassname[] }
  | { readonly kind: "unsupported-mode"; readonly product: Product; readonly gameType: number };

/** Authored map entities and explicit cross-game placements use the same source classnames. */
export function checkObjectivePlacements(product: Product, gameType: number,
  placements: readonly { readonly classname: string | null }[]): ObjectivePlacementResult {
  let required: readonly ObjectiveClassname[];
  switch (gameType) {
    case GameType.GT_FFA:
    case GameType.GT_TOURNAMENT:
    case GameType.GT_SINGLE_PLAYER:
    case GameType.GT_TEAM:
      required = [];
      break;
    case GameType.GT_CTF:
      required = ["team_CTF_redflag", "team_CTF_blueflag"];
      break;
    case GameType.GT_1FCTF:
      if (product !== "missionpack") return { kind: "unsupported-mode", product, gameType };
      required = ["team_CTF_redflag", "team_CTF_blueflag", "team_CTF_neutralflag"];
      break;
    case GameType.GT_OBELISK:
      if (product !== "missionpack") return { kind: "unsupported-mode", product, gameType };
      required = ["team_redobelisk", "team_blueobelisk"];
      break;
    case GameType.GT_HARVESTER:
      if (product !== "missionpack") return { kind: "unsupported-mode", product, gameType };
      required = ["team_redobelisk", "team_blueobelisk", "team_neutralobelisk"];
      break;
    default:
      return { kind: "unsupported-mode", product, gameType };
  }
  const present = new Set<string>();
  for (const placement of placements) if (placement.classname !== null) present.add(placement.classname);
  const missing = required.filter(classname => !present.has(classname));
  return missing.length === 0 ? { kind: "ready" } : { kind: "missing-objectives", classnames: missing };
}
