import { q1MonsterSources } from "./q1.ts";
import type { MonsterDefinitionReference, ProviderTiming } from "../../contracts/content.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE } from "../../core/numeric.ts";

export type MonsterSourceDefinition = {
  readonly provider: ProviderId;
  readonly edition: "classic" | "rerelease";
  readonly creatures: Readonly<Record<string, { readonly resources: readonly string[] }>>;
} & ({ readonly family: "q1"; readonly program: "id1" } | { readonly family: "q2"; readonly program: "baseq2" });

const classicBerserk = { resources: ["models/monsters/berserk/tris.md2", "models/monsters/berserk/skin.pcx",
  "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/head2/tris.md2",
  ...["berserk/sight.wav", "berserk/bersrch1.wav", "berserk/berpain2.wav", "berserk/berdeth2.wav", "berserk/beridle1.wav", "berserk/attack.wav", "misc/udeath.wav"].map(path => `sound/${path}`)] };
const infantryResources = ["models/monsters/infantry/tris.md2", "models/monsters/infantry/skin.pcx",
  "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
  ...["infantry/infsght1.wav", "infantry/infsrch1.wav", "infantry/infpain1.wav", "infantry/infpain2.wav", "infantry/infdeth1.wav", "infantry/infdeth2.wav",
    "infantry/infatck1.wav", "infantry/infatck2.wav", "infantry/infatck3.wav", "infantry/infidle1.wav", "infantry/melee2.wav", "misc/udeath.wav", "misc/fhit3.wav"].map(path => `sound/${path}`)];
const classicInfantry = { resources: [...infantryResources, "models/objects/gibs/head2/tris.md2"] };
const rereleaseInfantry = { resources: [...infantryResources, ...["arm", "chest", "foot", "gun", "head"].map(part => `models/monsters/infantry/gibs/${part}.md2`)] };

/** These identities bind the existing source modules, including their edition-specific continuations. */
export const monsterSources: readonly MonsterSourceDefinition[] = [
  ...q1MonsterSources,
  { provider: "q2:monsters/classic/baseq2", family: "q2", edition: "classic", program: "baseq2", creatures: { monster_infantry: classicInfantry, monster_berserk: classicBerserk } },
  { provider: "q2:monsters/rerelease/baseq2", family: "q2", edition: "rerelease", program: "baseq2", creatures: { monster_infantry: rereleaseInfantry } },
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
