import { expect, test } from "bun:test";
import type { EnemySelection } from "../../../src/contracts/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { readRecipe } from "../../../src/persistence/recipe.ts";
import { SaveReader } from "../../../src/persistence/value.ts";

test("selected creature definitions resolve edition assets and clocks without replacing the map or arsenal", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  for (const edition of ["classic", "rerelease"]) {
    for (const family of ["q1", "q2"]) {
      const command = parseApplicationCommand(["--game", family === "q1" ? "q2-classic-baseq2" : "q1-classic-id1", "--map", family === "q1" ? "base1" : "e1m1"]);
      if (command.kind !== "run") throw new Error("Expected a launch command");
      const preset = applicationPreset(catalog, command.options);
      const program = family === "q1" ? "id1" : "baseq2";
      const enemies: EnemySelection = { kind: "replace", default: {
        source: { provider: `${family}:monsters/${edition}/${program}`, content: catalog.require(`${family}-${edition}-${program}`).id },
        classname: family === "q1" ? "monster_army" : "monster_infantry",
      }, byClassname: edition === "classic" ? { [family === "q1" ? "monster_soldier" : "monster_army"]: { source: { provider: `${family}:monsters/${edition}/${program}`, content: catalog.require(`${family}-${edition}-${program}`).id }, classname: family === "q1" ? "monster_dog" : "monster_berserk" } } : {} };
      const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
      expect(recipe.enemies).toEqual(enemies);
      expect(recipe.map.geometryContent).toBe(preset.map.geometry.content);
      expect(recipe.weapons).toEqual(preset.weapons);
      if (preset.ordering.kind === "native") expect(recipe.ordering).toEqual(preset.ordering);
      else if (recipe.ordering.kind === "mixed") expect(recipe.ordering.providers.slice(0, preset.ordering.providers.length)).toEqual([...preset.ordering.providers]);
      expect(recipe.timing.some(entry => entry.provider === enemies.default.source.provider)).toBe(true);
      expect(recipe.resources.some(resource => resource.requestedPath === (family === "q1" ? "sound/soldier/sattck1.wav" : "sound/infantry/infatck1.wav"))).toBe(true);
      if (edition === "classic") expect(recipe.resources.some(resource => resource.requestedPath === (family === "q1" ? "sound/dog/dattack1.wav" : "sound/berserk/attack.wav"))).toBe(true);
      expect(readRecipe(new SaveReader(recipe, "recipe"))).toEqual(recipe);
    }
  }
}, 60000);
