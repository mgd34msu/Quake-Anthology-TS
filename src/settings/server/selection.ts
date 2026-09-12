import type { ExecutableRecipe } from "../../contracts/content.ts";
import { collectServerSettings } from "./profile.ts";
import { q2ServerSettingCollections } from "./q2-owner.ts";
import { q3CombatSettings, q3LimitSettings, q3MatchSettings } from "./q3.ts";
import type { ServerSettingDefinition } from "./types.ts";

/** Only collections with an installed source consumer are admitted. Equipment remains recipe-owned. */
export function serverDefinitionsForRecipe(recipe: ExecutableRecipe): readonly ServerSettingDefinition[] {
  if (recipe.map.entities.provider.startsWith("q2:")) return collectServerSettings(q2ServerSettingCollections(recipe.match.provider, recipe.combat.provider.startsWith("q2:")));
  if (recipe.map.entities.provider.startsWith("q3:")) {
    const product = recipe.match.content.includes("missionpack") ? "missionpack" : "baseq3";
    return collectServerSettings([q3LimitSettings(product), q3MatchSettings(product), ...(recipe.combat.provider.startsWith("q3:") ? [q3CombatSettings(product)] : [])]);
  }
  return [];
}
