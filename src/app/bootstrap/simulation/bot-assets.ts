import { loadMountedBotAssetFiles, type BotSourceFiles } from "../../../bots/behavior/assets.ts";
import { loadQuake1Knowledge } from "../../../bots/behavior/rerelease/data/knowledge-q1.ts";
import { Bot_LoadKnowledge } from "../../../bots/behavior/rerelease/data/knowledge-q2.ts";
import type { BotKnowledge } from "../../../bots/behavior/rerelease/data/knowledge.ts";
import type { LoadedApplicationContent } from "../content.ts";
import type { SharedSimulation } from "./runtime.ts";
import { nativeQ3WeaponKnowledge } from "./bot-selected-knowledge.ts";
import { loadServerLocalizationResources } from "../../../text/localization-resources.ts";
import type { LocalizationTable } from "../../../text/localization.ts";
export type ApplicationBotAssets = { readonly kind: "q3"; readonly files: BotSourceFiles }
  | { readonly kind: "rerelease"; readonly source: "q1-rerelease" | "q2-rerelease"; readonly files: BotSourceFiles; readonly knowledge: BotKnowledge; readonly localization: LocalizationTable };
/** Authored map bot definitions win. Classic products without these files keep their existing policy. */
export async function loadApplicationBotAssets(content: LoadedApplicationContent, simulation: SharedSimulation): Promise<ApplicationBotAssets> {
  let mounts = await content.forContent(content.recipe.map.entities.content);
  let native = await loadMountedBotAssetFiles(mounts, content.catalog);
  if (simulation.q3Source() !== null || simulation.q3Guest() !== null) return { kind: "q3", files: native };
  const family = simulation.q1Source() !== null ? "q1" : "q2";
  if (native.read("bots/weapons.txt") === null) {
    const sibling = content.catalog.products.find(product => product.expectation.id === (family === "q1" ? "q1-rerelease-id1" : "q2-rerelease-baseq2") && product.availability.kind === "installed");
    if (sibling !== undefined) {
      mounts = await content.forContent(sibling.id);
      native = await loadMountedBotAssetFiles(mounts, content.catalog);
    }
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
    const configuration = simulation.q1Source()?.cvars ?? simulation.q2ServerCvars();
    const language = configuration?.variableString("language") || "english";
    const localization = await loadServerLocalizationResources(language, async path => {
      const bytes = (await mounts.open(path))?.bytes ?? null;
      if (bytes !== null) native.add(path, bytes);
      return bytes;
    }, source);
    return { kind: "rerelease", source, files: native, knowledge, localization };
  }
  return { kind: "q3", files: await loadMountedBotAssetFiles(await content.forContent(content.catalog.product("q3-baseq3").id), content.catalog) };
}
