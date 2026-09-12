import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { admitWeaponTiming, canonicalWeaponSource, selectedWeaponResources, selectedWeaponTiming } from "../../../src/content/catalog/weapons.ts";
import { EQUIPMENT_PROVIDERS, equipmentTiming } from "../../../src/content/catalog/equipment.ts";
import type { EquipmentSelection } from "../../../src/contracts/content.ts";
import { nativeProviderTiming } from "../../../src/content/catalog/timing.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { StartupSelectionModel } from "../../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const corpusRoot = join(import.meta.dir, "../../../../qfiles");

test.skipIf(!existsSync(corpusRoot))("foreign base Q1 weapons resolve their own classic and rerelease assets", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  for (const game of ["q2-classic-baseq2", "q3-baseq3"]) {
    const command = parseApplicationCommand(["--game", game, "--map", game.startsWith("q2") ? "base1" : "q3dm1"]);
    if (command.kind !== "run") throw new Error("Expected a launch command");
    const preset = applicationPreset(catalog, command.options);
    for (const edition of ["classic", "rerelease"]) {
      const weapon = { provider: "q1:official", content: catalog.require(`q1-${edition}-id1`).id } satisfies typeof preset.map.entities;
      const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] } } });
      const requests = selectedWeaponResources(preset.map.entities, [weapon], catalog);
      const role = canonicalWeaponSource(preset.map.entities, weapon, catalog);
      expect(recipe.weapons).toEqual([role]);
      expect(recipe.timing.filter(entry => entry.provider === role.provider)).toEqual([nativeProviderTiming(role, "q1", edition === "rerelease")]);
      if (recipe.ordering.kind !== "mixed" || preset.ordering.kind !== "mixed") throw new Error("Expected mixed provider order");
      expect(recipe.ordering.providers.slice(0, preset.ordering.providers.length)).toEqual([...preset.ordering.providers]);
      expect(recipe.ordering.providers.filter(provider => provider === role.provider)).toHaveLength(1);
      expect(requests.filter(request => request.path.startsWith("progs/v_"))).toHaveLength(8);
      for (const request of requests) {
        const resource = recipe.resources.find(entry => entry.requestedPath === request.path);
        expect(resource?.provenance.mount.identity.content).toBe(weapon.content);
      }
      expect(selectedWeaponResources(weapon, [weapon], catalog)).toHaveLength(0);
    }
  }
}, 60000);

test("foreign Q1 launch rejects missing weapon assets before play", async () => {
  const root = await mkdtemp(join(tmpdir(), "q1-weapon-admission-"));
  try {
    await mkdir(join(root, "q1/id1"), { recursive: true });
    await mkdir(join(root, "q2/baseq2/maps"), { recursive: true });
    await writeFile(join(root, "q2/baseq2/maps/base1.bsp"), "map");
    const products = [
      { id: "q1-classic-id1", family: "q1", edition: "classic", campaign: "id1", title: "Q1", contentDirectory: "q1/id1", baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null },
      { id: "q2-classic-baseq2", family: "q2", edition: "classic", campaign: "baseq2", title: "Q2", contentDirectory: "q2/baseq2", baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null },
    ] satisfies NonNullable<Parameters<typeof discoverInstalledContent>[0]["products"]>;
    const catalog = await discoverInstalledContent({ corpusRoot: root, products, discoverMods: false });
    const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2"]);
    if (command.kind !== "run") throw new Error("Expected a launch command");
    const preset = applicationPreset(catalog, command.options);
    await expect(resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
      { provider: "q1:official", content: catalog.require("q1-classic-id1").id },
    ] } } })).rejects.toThrow("Required weapon resource is absent from its selected content and base");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("selected weapon metadata retains matching native timing and rejects conflicting profiles", () => {
  const weapon = { provider: "q1:official", content: "q1:classic:id1:installed" } satisfies Parameters<typeof nativeProviderTiming>[0];
  const profile = nativeProviderTiming(weapon, "q1", false), timing = [profile];
  admitWeaponTiming(timing, nativeProviderTiming(weapon, "q1", false));
  expect(timing).toHaveLength(1);
  expect(() => admitWeaponTiming(timing, { ...profile, clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: 0.1 } })).toThrow("conflicting timing");
  expect(() => admitWeaponTiming(timing, { ...profile, numeric: { ...profile.numeric, floatToInt: "qvm-indefinite" } })).toThrow("conflicting timing");
});

test.skipIf(!existsSync(corpusRoot))("foreign base Q2 weapons resolve source resources and native timing", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  for (const game of ["q1-classic-id1", "q3-baseq3"]) {
    const command = parseApplicationCommand(["--game", game, "--map", game.startsWith("q1") ? "e1m1" : "q3dm1"]);
    if (command.kind !== "run") throw new Error("Expected launch");
    const preset = applicationPreset(catalog, command.options);
    for (const edition of ["classic", "rerelease"]) {
    const weapon = { provider: "q2:official", content: catalog.require(`q2-${edition}-baseq2`).id } satisfies typeof preset.map.entities;
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] } } });
    const canonical = canonicalWeaponSource(preset.map.entities, weapon, catalog);
    expect(recipe.weapons).toEqual([canonical]);
    expect(recipe.timing.filter(entry => entry.provider === canonical.provider)).toEqual([nativeProviderTiming(canonical, "q2", edition === "rerelease")]);
    const requests = selectedWeaponResources(preset.map.entities, [weapon], catalog);
    expect(requests.filter(request => request.path.startsWith("models/weapons/v_") && request.path.endsWith("tris.md2"))).toHaveLength(11);
    for (const request of requests) expect(recipe.resources.some(resource => resource.requestedPath === request.path && resource.provenance.mount.identity.content === weapon.content)).toBe(true);
    if (game === "q1-classic-id1" && edition === "classic") {
      const gear = { provider: EQUIPMENT_PROVIDERS.handGrenades, content: weapon.content };
      expect(selectedWeaponResources(preset.map.entities, [gear], catalog)).toEqual([]);
      expect(selectedWeaponTiming(preset.map.entities, [gear], catalog)).toEqual([]);
      const equipment: EquipmentSelection = { grapple: { kind: "disabled" }, handGrenades: { kind: "enabled", source: gear, edition, binding: "offhand", initialAmmo: 5, capacity: 50 } };
      const mixed = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] }, equipment: { kind: "selected", value: equipment } } });
      expect(mixed.timing.filter(entry => entry.provider === gear.provider)).toEqual([...equipmentTiming(equipment)]);
    }
    }
  }
}, 60000);

test.skipIf(!existsSync(resolve(import.meta.dir, "../../../../qfiles/q2/rerelease/baseq2/pak0.pak")))("Q2 cross-edition arsenals resolve distinct role clocks and retain map pickup ownership", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: resolve(import.meta.dir, "../../../../qfiles"), discoverMods: false });
  for (const mapEdition of ["classic", "rerelease"]) {
    const edition = mapEdition === "classic" ? "rerelease" : "classic";
    const command = parseApplicationCommand(["--game", `q2-${mapEdition}-baseq2`, "--map", "base1"]);
    if (command.kind !== "run") throw new Error("Expected Q2 launch");
    const startup = new StartupSelectionModel(catalog, command.options);
    startup.select("weapons", `q2-${edition}-baseq2`);
    expect(startup.rows().find(row => row.id === "weapons")?.value).toBe(`q2-${edition}-baseq2`);
    const preset = applicationPreset(catalog, command.options);
    const weapon = { provider: "q2:official", content: catalog.require(`q2-${edition}-baseq2`).id } satisfies typeof preset.map.entities;
    const role = canonicalWeaponSource(preset.map.entities, weapon, catalog);
    expect(role.provider).toBe(`q2:weapons/${edition}/baseq2`);
    await expect(resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q2:banana", content: weapon.content }] } } })).rejects.toThrow("Unsupported Q2 weapon provider");
    expect(canonicalWeaponSource(preset.map.entities, preset.map.entities, catalog)).toEqual(preset.map.entities);
    expect(() => canonicalWeaponSource(preset.map.entities, { ...role, content: preset.map.entities.content }, catalog)).toThrow("does not match");
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] } } });
    expect(recipe.weapons).toEqual([role]); expect(recipe.inventory).toEqual(preset.inventory);
    expect(recipe.map.entities).toEqual(preset.map.entities);
    expect(recipe.timing.find(entry => entry.provider === role.provider)).toEqual(nativeProviderTiming(role, "q2", edition === "rerelease"));
    expect(recipe.timing.find(entry => entry.provider === preset.map.entities.provider)).toEqual(preset.timing.find(entry => entry.provider === preset.map.entities.provider));
    expect(recipe.ordering.kind === "mixed" && recipe.ordering.providers.filter(provider => provider === role.provider).length === 1).toBe(true);
    for (const request of selectedWeaponResources(preset.map.entities, [role], catalog)) expect(recipe.resources.some(resource => resource.requestedPath === request.path && resource.provenance.mount.identity.content === weapon.content)).toBe(true);
  }
}, 60000);

test.skipIf(!existsSync(resolve(corpusRoot, "q1/rerelease/id1/pak0.pak")))("Q1 cross-edition arsenals retain independent NetQuake roles and source assets", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  for (const mapEdition of ["classic", "rerelease"]) {
    const edition = mapEdition === "classic" ? "rerelease" : "classic";
    const command = parseApplicationCommand(["--game", `q1-${mapEdition}-id1`, "--map", "e1m1"]);
    if (command.kind !== "run") throw new Error("Expected Q1 launch");
    const preset = applicationPreset(catalog, command.options);
    const weapon = { provider: "q1:official", content: catalog.require(`q1-${edition}-id1`).id } satisfies typeof preset.map.entities;
    const role = canonicalWeaponSource(preset.map.entities, weapon, catalog);
    expect(role.provider).toBe(`q1:weapons/${edition}/id1`);
    expect(canonicalWeaponSource(preset.map.entities, preset.map.entities, catalog)).toEqual(preset.map.entities);
    expect(() => canonicalWeaponSource(preset.map.entities, { ...role, content: preset.map.entities.content }, catalog)).toThrow("does not match");
    await expect(resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q1:banana", content: weapon.content }] } } })).rejects.toThrow("Unsupported Q1 weapon provider");
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] } } });
    expect(recipe.weapons).toEqual([role]); expect(recipe.inventory).toEqual(preset.inventory);
    expect(recipe.map.entities).toEqual(preset.map.entities);
    expect(recipe.timing.find(entry => entry.provider === role.provider)).toEqual(nativeProviderTiming(role, "q1", edition === "rerelease"));
    expect(recipe.timing.find(entry => entry.provider === preset.map.entities.provider)).toEqual(preset.timing.find(entry => entry.provider === preset.map.entities.provider));
    expect(recipe.ordering.kind === "mixed" && recipe.ordering.providers.filter(provider => provider === role.provider).length === 1).toBe(true);
    for (const request of selectedWeaponResources(preset.map.entities, [role], catalog)) expect(recipe.resources.some(resource => resource.requestedPath === request.path && resource.provenance.mount.identity.content === weapon.content)).toBe(true);
  }
}, 60000);
