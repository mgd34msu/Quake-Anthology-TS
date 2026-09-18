import { sourceProgramProduct, selectedSourceProgram } from "../../content/catalog/source-program.ts";
import { adaptForeignQ3Objectives } from "../../content/q3/team-arena/foreign-objectives.ts";
import { parseQ1Entities, q1EntityValue } from "../../formats/q1-map/entities.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { matchMapUnavailable, type MatchRules } from "./match-modes.ts";
import type { ApplicationOptions } from "./options.ts";

/** Validate the configured source rules before constructing a simulation or renderer. */
export function preflightApplicationMatch(content: Pick<LoadedApplicationContent, "catalog" | "recipe"> & { readonly world: Pick<LoadedApplicationContent["world"], "kind" | "entities"> },
  options: Pick<ApplicationOptions, "mode">, sourceValues: readonly { readonly name: string; readonly value: string }[]): void {
  const owner = content.recipe.map.entities;
  const execution = content.recipe.execution.find(module => module.role === "server-game" && module.owner.content === owner.content && module.owner.provider === owner.provider);
  // Guest modules own their mode definitions and admission; stock rules cannot validate them.
  if (execution?.kind !== "typescript") return;
  const source = sourceProgramProduct(content.catalog, owner.content).expectation;
  if (source.family === "q3") {
    let configured: string | undefined;
    for (const value of sourceValues) if (value.name === "g_gametype") configured = value.value;
    const gameType = configured === undefined ? options.mode === "singleplayer" ? 2 : 0 : Number(configured);
    const result = adaptForeignQ3Objectives(content.world, selectedSourceProgram(content.recipe) === "missionpack" ? "missionpack" : "baseq3", gameType);
    if (result.kind === "missing-objectives") throw new Error(`Selected Q3 match map is missing: ${result.classnames.join(", ")}`);
    if (result.kind === "unsupported-mode") throw new Error(`Selected Q3 product does not support game type ${result.gameType}`);
    return;
  }
  const provider = content.recipe.match.provider;
  const rules: MatchRules = provider === "q2:ctf" ? "ctf" : provider === "q2:lmctf" ? "lmctf" : provider === "q2:tag" ? "tag"
    : provider === "q2:deathball" ? "deathball" : provider === "q1:horde" ? "horde" : "standard";
  const reason = matchMapUnavailable({ ...source, mode: options.mode, rules },
    parseQ1Entities(content.world.entities).map(entity => q1EntityValue(entity, "classname") ?? ""));
  if (reason !== null) throw new Error(reason);
}
