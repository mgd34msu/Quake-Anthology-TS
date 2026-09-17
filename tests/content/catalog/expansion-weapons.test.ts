import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { ProviderId } from "../../../src/contracts/identity.ts";
import { expansionSupply } from "../../../src/content/composition/expansion-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE } from "../../../src/content/composition/q1-q2-supply.ts";
import { Q3_Q2_SUPPLY_PROFILE } from "../../../src/content/composition/q3-q2-supply.ts";
import { xatrixWeaponDefinitions, rogueWeaponDefinitions } from "../../../src/content/q2/missionpacks/weapons/definitions.ts";

for (const product of ["q1-classic-rogue", "q1-rerelease-rogue", "q1-rerelease-mg3", "q2-classic-xatrix", "q2-classic-rogue", "q2-rerelease-xatrix", "q2-rerelease-rogue", "q2-rerelease-mg2"]) {
  test(`${product} selected arsenal resolves its actual retail weapon resources`, async () => {
    const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
    const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Missing launch");
    const preset = applicationPreset(catalog, command.options);
    const provider: ProviderId = product.startsWith("q1") ? "q1:official" : "q2:official";
    const selected = catalog.require(product);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider, content: selected.id }] } } });
    expect(recipe.weapons.some(reference => reference.content === selected.id)).toBe(true);
    for (const weapon of recipe.weapons) expect(recipe.timing.some(timing => timing.provider === weapon.provider)).toBe(true);
    expect(recipe.resources.some(resource => resource.requestedPath.startsWith("progs/v_") || resource.requestedPath.startsWith("models/weapons/"))).toBe(true);
  });
}

test("Q1 and Q3 supply exposes every selected Q2 expansion weapon and its ammunition", () => {
  for (const base of [Q1_Q2_SUPPLY_PROFILE, Q3_Q2_SUPPLY_PROFILE]) {
    const expanded = expansionSupply(base, ["q2-xatrix", "q2-rogue"]);
    const weapons = expanded.weapons.flatMap(row => row.destinations), ammo = expanded.ammo.flatMap(row => row.destinations);
    for (const definition of [...xatrixWeaponDefinitions, ...rogueWeaponDefinitions]) {
      expect((definition.item === definition.ammo ? ammo : weapons).includes(definition.item)).toBe(true);
      if (definition.ammo !== null) expect(ammo.includes(definition.ammo)).toBe(true);
    }
  }
});

test("every MG3 selected creature resolves its source precaches from the retail product", async () => {
  const { q1AddonMonsterSources } = await import("../../../src/content/monsters/expansions.ts");
  const source = q1AddonMonsterSources.find(source => source.program === "mg3");
  if (source === undefined) throw new Error("Missing MG3 roster");
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const preset = applicationPreset(catalog, parsed.options), reference = { provider: source.provider, content: catalog.require("q1-rerelease-mg3").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { kind: "map-defined" }, byClassname: Object.fromEntries(Object.keys(source.creatures).map(classname => [classname, { source: reference, classname }])),
  } } } });
  expect(recipe.resources.some(resource => resource.requestedPath === "progs/dog_explosive.mdl")).toBe(true);
  expect(Object.keys(source.creatures).length).toBeGreaterThan(25);
});
