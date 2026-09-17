import { loadMountedBotAssetFiles, type BotSourceFiles } from "../../../bots/behavior/assets.ts";
import { loadQuake1Knowledge } from "../../../bots/behavior/rerelease/data/knowledge-q1.ts";
import { Bot_LoadKnowledge } from "../../../bots/behavior/rerelease/data/knowledge-q2.ts";
import type { BotKnowledge } from "../../../bots/behavior/rerelease/data/knowledge.ts";
import type { LoadedApplicationContent } from "../content.ts";
import type { SharedSimulation } from "./runtime.ts";
import { nativeQ3WeaponKnowledge } from "./bot-selected-knowledge.ts";
export type ApplicationBotAssets = { readonly kind: "q3"; readonly files: BotSourceFiles }
  | { readonly kind: "rerelease"; readonly source: "q1-rerelease" | "q2-rerelease"; readonly files: BotSourceFiles; readonly knowledge: BotKnowledge };
/** Authored map bot definitions win. Classic products without these files keep their existing policy. */
export async function loadApplicationBotAssets(content: LoadedApplicationContent, simulation: SharedSimulation): Promise<ApplicationBotAssets> {
  let native = await loadMountedBotAssetFiles(await content.forContent(content.recipe.map.entities.content), content.catalog);
  if (simulation.q3Source() !== null) return { kind: "q3", files: native };
  const family = simulation.q1Source() !== null ? "q1" : "q2";
  if (native.read("bots/weapons.txt") === null) {
    const sibling = content.catalog.products.find(product => product.expectation.id === (family === "q1" ? "q1-rerelease-id1" : "q2-rerelease-baseq2") && product.availability.kind === "installed");
    if (sibling !== undefined) native = await loadMountedBotAssetFiles(await content.forContent(sibling.id), content.catalog);
  }
  if (native.read("bots/weapons.txt") !== null) {
    const source = simulation.q1Source() !== null ? "q1-rerelease" : "q2-rerelease";
    const knowledge = source === "q1-rerelease" ? loadQuake1Knowledge(native) : Bot_LoadKnowledge(native);
    if (knowledge === null) throw new Error("Native bot definitions disappeared during loading");
    if (knowledge.errors.length !== 0) throw new Error(`Invalid native bot definitions: ${knowledge.errors.join("; ")}`);
    const selected = content.recipe.weapons[0];
    if (selected !== undefined && selected.content !== content.recipe.map.entities.content) {
      let arsenal = await loadMountedBotAssetFiles(await content.forContent(selected.content), content.catalog);
      if (!selected.provider.startsWith("q3:") && arsenal.read("bots/weapons.txt") === null) {
        const sibling = content.catalog.products.find(product => product.expectation.id === (selected.provider.startsWith("q1:") ? "q1-rerelease-id1" : "q2-rerelease-baseq2") && product.availability.kind === "installed");
        if (sibling !== undefined) arsenal = await loadMountedBotAssetFiles(await content.forContent(sibling.id), content.catalog);
      }
      const weapons = selected.provider.startsWith("q3:") ? nativeQ3WeaponKnowledge(arsenal)
        : selected.provider.startsWith("q1:") ? loadQuake1Knowledge(arsenal)?.weapons : Bot_LoadKnowledge(arsenal).weapons;
      if (weapons === undefined || weapons.length === 0) throw new Error("Selected arsenal lacks authored bot weapon knowledge");
      knowledge.replaceWeapons(weapons);
      native.add("arsenal/provenance", new TextEncoder().encode(`${selected.provider}\n${selected.content}\n${arsenal.provenance()}`));
    }
    return { kind: "rerelease", source, files: native, knowledge };
  }
  return { kind: "q3", files: await loadMountedBotAssetFiles(await content.forContent(content.catalog.product("q3-baseq3").id), content.catalog) };
}
