import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import type { EnemySelection, ProviderReference } from "../../../src/contracts/content.ts";
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

const corpus = resolve(import.meta.dir, "../../../../qfiles");

test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("classic Q2 ordinary roster resolves its species, shared environment, projectile and skin resources", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch command");
  const preset = applicationPreset(catalog, command.options), content = catalog.require("q2-classic-baseq2").id;
  const classnames = ["monster_infantry", "monster_berserk", "monster_soldier", "monster_soldier_light", "monster_soldier_ss", "monster_gladiator", "monster_gunner",
    "monster_parasite", "monster_flyer", "monster_floater", "monster_hover", "monster_mutant", "monster_chick", "monster_tank", "monster_tank_commander"];
  const source: ProviderReference = { provider: "q2:monsters/classic/baseq2", content };
  const enemies: EnemySelection = { kind: "replace", default: { source, classname: "monster_infantry" },
    byClassname: Object.fromEntries(classnames.map(classname => [classname, { source, classname }])) };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
  expect(recipe.enemies).toEqual(enemies);
  const paths = new Set(recipe.resources.map(resource => resource.requestedPath));
  for (const path of ["models/monsters/gladiatr/tris.md2", "models/monsters/float/tris.md2", "models/monsters/bitch/tris.md2",
    "models/monsters/soldier/skin_ssp.pcx", "models/monsters/soldier/skin_ltp.pcx", "models/objects/laser/tris.md2", "models/objects/grenade/tris.md2",
    "models/objects/rocket/tris.md2", "sound/weapons/rockfly.wav", "sound/weapons/grenlb1b.wav", "sound/infantry/inflies1.wav",
    "sound/misc/fhit3.wav", "sound/player/watr_in.wav", "sound/mutant/step3.wav"]) expect(paths.has(path)).toBe(true);
  expect(readRecipe(new SaveReader(recipe, "recipe"))).toEqual(recipe);
}, 60000);

test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")))("ordinary Q2 creature presentation resolves classic and rerelease models, skins and muzzle sounds", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  for (const edition of ["classic", "rerelease"]) {
    const command = parseApplicationCommand(["--game", `q2-${edition}-baseq2`, "--map", "base1"]);
    if (command.kind !== "run") throw new Error("Expected Q2 launch command");
    const preset = applicationPreset(catalog, command.options), content = catalog.require(`q2-${edition}-baseq2`).id;
    const source: ProviderReference = { provider: `q2:monsters/${edition}/baseq2`, content };
    const classnames = ["monster_infantry", "monster_soldier", "monster_soldier_light", "monster_soldier_ss", "monster_berserk", "monster_gunner",
      "monster_floater", "monster_hover", "monster_flyer", "monster_mutant", "monster_parasite", "monster_chick", "monster_tank", "monster_tank_commander", "monster_gladiator"];
    const enemies: EnemySelection = { kind: "replace", default: { source, classname: "monster_infantry" },
      byClassname: Object.fromEntries(classnames.map(classname => [classname, { source, classname }])) };
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
    expect(recipe.enemies).toEqual(enemies);
    const paths = new Set(recipe.resources.map(resource => resource.requestedPath));
    for (const path of ["models/objects/smoke/tris.md2", "models/objects/flash/skin.pcx", "models/objects/explode/tris.md2",
      "models/objects/r_explode/skin7.pcx", "sound/soldier/solatck1.wav", "sound/soldier/solatck2.wav", "sound/soldier/solatck3.wav",
      "sound/gunner/gunatck2.wav", "sound/gunner/gunatck3.wav", "sound/hover/hovatck1.wav", "sound/floater/fltatck1.wav", "sound/flyer/flyatck3.wav"]) expect(paths.has(path)).toBe(true);
    if (edition === "rerelease") {
      for (const path of ["models/monsters/parasite/tip/tris.md2", "models/monsters/parasite/tip/base.pcx", "models/monsters/parasite/segment/tris.md2",
        "models/monsters/parasite/segment/skin.pcx", "models/monsters/parasite/gibs/fleg.pcx", "models/monsters/soldier/gibs/arm_lt.pcx",
        "models/monsters/infantry/gibs/arm.pcx", "models/monsters/infantry/gibs/chest.pcx", "models/monsters/infantry/gibs/foot.pcx", "models/monsters/infantry/gibs/head.pcx",
        "models/monsters/bitch/gibs/tube.pcx", "models/monsters/tank/gibs/barm_c.pcx", "models/monsters/tank/cskin.pcx",
        "models/monsters/gladiatr/gibs/larm.pcx", "sound/weapons/rg_hum.wav", "models/objects/rocket/tris.md2", "sound/weapons/rockfly.wav",
        "models/monsters/mutant/gibs/hand.pcx", "sound/berserk/jump.wav", "sound/world/explod2.wav", "sound/weapons/rocklx1a.wav"]) expect(paths.has(path)).toBe(true);
    }
  }
}, 60000);

test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))("rerelease Q1 ordinary creatures resolve their model, gib, projectile and sound resources", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const command = parseApplicationCommand(["--game", "q1-rerelease-id1", "--map", "e1m2"]);
  if (command.kind !== "run") throw new Error("Expected Q1 rerelease launch command");
  const preset = applicationPreset(catalog, command.options);
  const source: ProviderReference = { provider: "q1:monsters/rerelease/id1", content: catalog.require("q1-rerelease-id1").id };
  const classnames = ["monster_army", "monster_dog", "monster_enforcer", "monster_knight", "monster_demon1", "monster_ogre", "monster_ogre_marksman",
    "monster_hell_knight", "monster_shambler", "monster_wizard", "monster_shalrath", "monster_tarbaby", "monster_zombie"];
  const enemies: EnemySelection = { kind: "replace", default: { source, classname: "monster_army" },
    byClassname: Object.fromEntries(classnames.map(classname => [classname, { source, classname }])) };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
  expect(recipe.enemies).toEqual(enemies);
  expect(recipe.map.geometryContent).toBe(preset.map.geometry.content);
  const paths = new Set(recipe.resources.map(resource => resource.requestedPath));
  for (const path of ["progs/ogre.mdl", "progs/h_ogre.mdl", "progs/grenade.mdl", "progs/laser.mdl", "progs/k_spike.mdl", "progs/w_spike.mdl",
    "progs/v_spike.mdl", "progs/zom_gib.mdl", "progs/bolt.mdl", "progs/s_light.mdl", "progs/gib1.mdl", "progs/backpack.mdl", "progs/s_explod.spr",
    "sound/ogre/ogwake.wav", "sound/weapons/bounce.wav", "sound/weapons/r_exp3.wav", "sound/enforcer/enfstop.wav", "sound/shambler/sboom.wav",
    "sound/wizard/hit.wav", "sound/zombie/z_hit.wav", "sound/blob/death1.wav"]) expect(paths.has(path)).toBe(true);
  expect(readRecipe(new SaveReader(recipe, "recipe"))).toEqual(recipe);
}, 60000);
