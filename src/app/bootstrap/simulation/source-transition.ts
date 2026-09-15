import type { ExecutableRecipe } from "../../../contracts/content.ts";
import type { TransitionIntent } from "../../../contracts/gameplay.ts";

export type SourceLevelAuthority = "primary-world" | "actor-source";

export function sourceLevelTransition(intent: TransitionIntent, recipe: Pick<ExecutableRecipe, "campaign" | "match">, authority: SourceLevelAuthority): TransitionIntent {
  if (authority === "primary-world" && recipe.campaign.kind === "none" && intent.kind === "campaign-level")
    return { kind: "match-rotation", match: recipe.match.provider, map: intent.map };
  return intent;
}
