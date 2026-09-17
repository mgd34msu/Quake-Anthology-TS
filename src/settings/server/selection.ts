import type { ExecutableRecipe, ProviderReference } from "../../contracts/content.ts";
import { collectServerSettings } from "./profile.ts";
import { q2RotationSettings } from "./rotation.ts";
import { q2ServerSettingCollections } from "./q2-owner.ts";
import { q3CombatSettings, q3LimitSettings, q3MatchSettings } from "./q3.ts";
import type { ServerSettingDefinition } from "./types.ts";

/** Only collections with an installed source consumer are admitted. Equipment remains recipe-owned. */
export function serverDefinitionsForRecipe(recipe: ExecutableRecipe): readonly ServerSettingDefinition[] {
  return serverDefinitionsForSelection({ source: recipe.map.entities, match: recipe.match, combat: recipe.combat });
}

export function serverDefinitionsForSelection(selection: {
  readonly source: ProviderReference; readonly match: ProviderReference; readonly combat: ProviderReference;
}): readonly ServerSettingDefinition[] {
  if (selection.source.provider.startsWith("q2:")) return collectServerSettings([...q2ServerSettingCollections(selection.match.provider, selection.combat.provider.startsWith("q2:"), selection.source.content.includes(":rerelease:")), q2RotationSettings(selection.source.content.includes(":rerelease:"))]);
  if (selection.source.provider.startsWith("q3:")) {
    const product = selection.match.content.includes("missionpack") ? "missionpack" : "baseq3";
    return collectServerSettings([q3LimitSettings(product), q3MatchSettings(product), ...(selection.combat.provider.startsWith("q3:") ? [q3CombatSettings(product)] : [])]);
  }
  return [];
}
