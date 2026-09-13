import type { EnemySelection, MonsterDefinitionReference, ProviderTiming, ResourceRequest } from "../../contracts/content.ts";
import { monsterSource, monsterSources, monsterTiming } from "../monsters/definitions.ts";
import type { InstalledCatalog } from "./index.ts";

export { monsterSources } from "../monsters/definitions.ts";
export { campaignMonsterSlots, defaultMonsterRoster } from "../monsters/roster.ts";
export type { MonsterRole, MonsterRosterSlot } from "../monsters/roster.ts";

export function selectedMonsterDefinitions(enemies: EnemySelection): readonly MonsterDefinitionReference[] {
  return enemies.kind === "map-defined" ? [] : [enemies.default, ...Object.values(enemies.byClassname)].flatMap(target => "kind" in target ? [] : [target]);
}

export function validateMonsters(enemies: EnemySelection, catalog: InstalledCatalog): undefined {
  for (const definition of selectedMonsterDefinitions(enemies)) {
    const source = monsterSource(definition), product = catalog.require(definition.source.content).expectation;
    if (product.family !== source.family || product.edition !== source.edition || product.campaign !== source.program) {
      throw new RangeError(`Monster source content does not match ${source.provider}: ${definition.source.content}`);
    }
  }
  if (enemies.kind === "replace" && Object.keys(enemies.byClassname).some(name => name.length === 0)) throw new RangeError("An authored monster classname cannot be empty");
  return undefined;
}

export function selectedMonsterTiming(enemies: EnemySelection): readonly ProviderTiming[] {
  const providers = new Set(selectedMonsterDefinitions(enemies).map(definition => definition.source.provider));
  return monsterSources.filter(source => providers.has(source.provider)).map(monsterTiming);
}

export function monsterResources(enemies: EnemySelection): readonly ResourceRequest[] {
  return selectedMonsterDefinitions(enemies).flatMap(definition => {
    const source = monsterSource(definition);
    const creature = source.creatures[definition.classname];
    if (creature === undefined) throw new RangeError(`Missing registered monster resources: ${definition.classname}`);
    return creature.resources.map(path => ({ content: definition.source.content, path }));
  });
}
