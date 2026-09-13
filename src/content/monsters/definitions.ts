import { q1MonsterSources } from "./q1.ts";
import { q2MonsterSources } from "./q2.ts";
import { q1ExpansionMonsterSources, q1AddonMonsterSources } from "./expansions.ts";
import { q2ExpansionSources, q2ExpandedBaseCreatures, q2ExpandedClassicCreatures } from "./q2-expansions.ts";
import type { MonsterDefinitionReference, ProviderTiming } from "../../contracts/content.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE } from "../../core/numeric.ts";

export type MonsterSourceDefinition = {
  readonly provider: ProviderId;
  readonly edition: "classic" | "rerelease";
  readonly creatures: Readonly<Record<string, { readonly resources: readonly string[] }>>;
} & ({ readonly family: "q1"; readonly program: "id1" | "hipnotic" | "rogue" | "dopa" | "mg1" } | { readonly family: "q2"; readonly program: "baseq2" | "xatrix" | "rogue" | "mg2" });

/** These identities bind the existing source modules, including their edition-specific continuations. */
export const monsterSources: readonly MonsterSourceDefinition[] = [
  ...q1MonsterSources,
  ...q2MonsterSources.map(source => ({ ...source, creatures: { ...source.creatures,
    ...(source.edition === "rerelease" ? q2ExpandedBaseCreatures : q2ExpandedClassicCreatures) } })),
  ...q1ExpansionMonsterSources,
  ...q1AddonMonsterSources,
  ...q2ExpansionSources,
];

export function monsterSource(definition: MonsterDefinitionReference): MonsterSourceDefinition {
  const source = monsterSources.find(candidate => candidate.provider === definition.source.provider);
  if (source === undefined || !Object.hasOwn(source.creatures, definition.classname)) {
    throw new RangeError(`Selected monster implementation is unavailable: ${definition.source.provider}/${definition.classname}`);
  }
  return source;
}

export function monsterTiming(source: MonsterSourceDefinition): ProviderTiming {
  return { provider: source.provider, numeric: source.family === "q1" ? Q1_DONOR_PROFILE : Q2_DONOR_PROFILE,
    clock: source.family === "q1" ? { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null }
      : source.edition === "classic" ? { kind: "q2-classic", frameMilliseconds: 100 }
        : { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" } };
}
