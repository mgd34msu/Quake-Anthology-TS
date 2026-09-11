import { expect, test } from "bun:test";
import type { ContentId, EquipmentSelection, GrappleSelection, ProviderReference } from "../../../src/contracts/content.ts";
import { discoverInstalledContent, disabledEquipment, EQUIPMENT_PROVIDERS, nativeEquipment, presetChoice, resolveLaunch, selectLaunch } from "../../../src/content/catalog/index.ts";
import type { InstalledCatalog, LaunchPreset } from "../../../src/content/catalog/index.ts";
import { readEquipment } from "../../../src/persistence/recipe.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { openMountPlan } from "../../../src/content/mounts/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const installed = discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
function preset(catalog: InstalledCatalog, product: string, map: string): LaunchPreset {
  const content = catalog.require(product).id, family = catalog.require(product).expectation.family;
  const provider: ProviderReference = { provider: `${family}:official`, content };
  return { id: "recipe:equipment:1", map: { geometry: { content, path: map }, entities: provider },
    campaign: { kind: "campaign", mission: provider, gamecode: provider }, movement: provider,
    character: { definition: provider, appearance: provider }, weapons: [provider], equipment: disabledEquipment(), enemies: { kind: "map-defined" },
    presentation: { assets: content, hud: provider, effects: provider, audio: provider }, engineBehavior: provider,
    combat: provider, inventory: provider, match: provider, transition: provider, execution: [], timing: [],
    ordering: { kind: "mixed", providers: [provider.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" } };
}
function source(provider: ProviderReference["provider"], content: ContentId): ProviderReference { return { provider, content }; }

test("classic Q1 map sidecars cannot resolve from selected Threewave rerelease equipment", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected an application launch");
  const baseline = await loadApplicationContent(command.options);
  try {
    const native = applicationPreset(baseline.catalog, command.options);
    const equipment: EquipmentSelection = { handGrenades: { kind: "disabled" }, grapple: {
      kind: "enabled", mechanic: "q1-threewave", edition: "rerelease", binding: "offhand",
      source: source(EQUIPMENT_PROVIDERS.threewave, baseline.catalog.require("q1-rerelease-ctf").id),
    } };
    const recipe = await resolveLaunch({ catalog: baseline.catalog, preset: native,
      choice: { ...presetChoice(native.id), equipment: { kind: "selected", value: equipment } } });
    const selected = await loadApplicationContent(command.options, recipe);
    try {
      expect(recipe.map.geometryContent).toBe(native.map.geometry.content);
      expect(selected.world).toEqual(baseline.world);
    } finally { await selected.close(); }
  } finally { await baseline.close(); }
}, 60000);

test("equipment selection and saved discriminants preserve campaign, arsenal and explicit disabled choices", async () => {
  const catalog = await installed;
  const native: LaunchPreset = { ...preset(catalog, "q1-rerelease-id1", "maps/start.bsp"),
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
  const equipment: EquipmentSelection = {
    grapple: { kind: "enabled", mechanic: "q2-lmctf", edition: "classic", binding: "slot", source: source(EQUIPMENT_PROVIDERS.lmctf, catalog.require("q2-classic-lmctf").id) },
    handGrenades: { kind: "enabled", edition: "rerelease", binding: "offhand", source: source(EQUIPMENT_PROVIDERS.handGrenades, catalog.require("q2-rerelease-baseq2").id), initialAmmo: 4, capacity: 50 },
  };
  const chosen = selectLaunch({ ...presetChoice(native.id), equipment: { kind: "selected", value: equipment } }, native);
  expect(chosen.equipment).toEqual(equipment); expect(chosen.map).toEqual(native.map); expect(chosen.campaign).toEqual(native.campaign);
  expect(chosen.weapons).toEqual(native.weapons); expect(chosen.match).toEqual(native.match); expect(chosen.execution).toEqual(native.execution);
  expect(readEquipment(new SaveReader(equipment, "equipment"))).toEqual(equipment);
  expect(() => readEquipment(new SaveReader({ ...equipment, handGrenades: { ...equipment.handGrenades, binding: "slot" } }, "equipment"))).toThrow();
  expect(() => readEquipment(new SaveReader({ ...equipment, handGrenades: { ...equipment.handGrenades, initialAmmo: 51 } }, "equipment"))).toThrow();
  const disabled = selectLaunch({ ...presetChoice(native.id), equipment: { kind: "selected", value: disabledEquipment() } }, { ...native, equipment });
  expect(disabled.equipment).toEqual(disabledEquipment());
  const resolved = await resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), equipment: { kind: "selected", value: equipment } } });
  expect(resolved.ordering).toEqual(native.ordering);
  expect(resolved.timing.some(timing => timing.provider === EQUIPMENT_PROVIDERS.lmctf && timing.clock.kind === "q2-classic")).toBe(true);
  expect(resolved.timing.some(timing => timing.provider === EQUIPMENT_PROVIDERS.handGrenades && timing.clock.kind === "q2-rerelease")).toBe(true);
}, 60000);

test("selected map content rejects a foreign equipment BSP and permits its own base fallback", async () => {
  const catalog = await installed;
  const missing = preset(catalog, "q1-classic-id1", "maps/q2ctf1.bsp");
  const equipment: EquipmentSelection = { handGrenades: { kind: "disabled" }, grapple: {
    kind: "enabled", mechanic: "q2-ctf", edition: "classic", binding: "offhand",
    source: source(EQUIPMENT_PROVIDERS.ctf, catalog.require("q2-classic-ctf").id),
  } };
  await expect(resolveLaunch({ catalog, preset: missing,
    choice: { ...presetChoice(missing.id), equipment: { kind: "selected", value: equipment } } })).rejects.toThrow("Required map is absent from its selected content and base");
  const fallback = preset(catalog, "q1-rerelease-hipnotic", "maps/e1m1.bsp");
  const resolved = await resolveLaunch({ catalog, preset: fallback, choice: presetChoice(fallback.id) });
  expect(resolved.map.geometryContent).toBe(catalog.require("q1-rerelease-hipnotic").id);
  expect(resolved.map.geometry.provenance.mount.identity.content).toBe(catalog.require("q1-rerelease-id1").id);
}, 60000);

test("native CTF presets declare their grapple bindings while ordinary maps grant no equipment", async () => {
  const catalog = await installed;
  const ref = (product: string, provider: ProviderReference["provider"]): ProviderReference => source(provider, catalog.require(product).id);
  const q1 = ref("q1-rerelease-ctf", "q1:official"), q2 = ref("q2-classic-ctf", "q2:ctf"), lm = ref("q2-classic-lmctf", "q2:lmctf");
  expect(nativeEquipment(catalog, q1, q1).grapple).toMatchObject({ kind: "enabled", mechanic: "q1-threewave", binding: "slot" });
  expect(nativeEquipment(catalog, q2, q2).grapple).toMatchObject({ kind: "enabled", mechanic: "q2-ctf", binding: "slot" });
  expect(nativeEquipment(catalog, lm, lm).grapple).toMatchObject({ kind: "enabled", mechanic: "q2-lmctf", binding: "offhand" });
  const base = ref("q1-rerelease-id1", "q1:official"); expect(nativeEquipment(catalog, base, base)).toEqual(disabledEquipment());
});

test("real catalog resolves all grapple mechanics and both grenade editions on independently selected map families", async () => {
  const catalog = await installed;
  const q1 = catalog.require("q1-rerelease-ctf").id, q2 = catalog.require("q2-classic-ctf").id, q2rr = catalog.require("q2-rerelease-ctf").id;
  const lm = catalog.require("q2-classic-lmctf").id;
  const cases: readonly { readonly product: string; readonly map: string; readonly grapple: GrappleSelection; readonly grenadeEdition: "classic" | "rerelease" }[] = [
    { product: "q2-classic-baseq2", map: "maps/base1.bsp", grapple: { kind: "enabled", mechanic: "q1-threewave", edition: "rerelease", binding: "offhand", source: source(EQUIPMENT_PROVIDERS.threewave, q1) }, grenadeEdition: "rerelease" },
    { product: "q3-baseq3", map: "maps/q3dm1.bsp", grapple: { kind: "enabled", mechanic: "q1-threewave", edition: "rerelease", binding: "slot", source: source(EQUIPMENT_PROVIDERS.threewave, q1) }, grenadeEdition: "classic" },
    { product: "q1-rerelease-id1", map: "maps/start.bsp", grapple: { kind: "enabled", mechanic: "q2-ctf", edition: "classic", binding: "slot", source: source(EQUIPMENT_PROVIDERS.ctf, q2) }, grenadeEdition: "rerelease" },
    { product: "q1-rerelease-id1", map: "maps/start.bsp", grapple: { kind: "enabled", mechanic: "q2-ctf", edition: "rerelease", binding: "offhand", source: source(EQUIPMENT_PROVIDERS.ctf, q2rr) }, grenadeEdition: "classic" },
    { product: "q3-baseq3", map: "maps/q3dm1.bsp", grapple: { kind: "enabled", mechanic: "q2-lmctf", edition: "classic", binding: "slot", source: source(EQUIPMENT_PROVIDERS.lmctf, lm) }, grenadeEdition: "rerelease" },
    { product: "q1-rerelease-id1", map: "maps/start.bsp", grapple: { kind: "enabled", mechanic: "q2-lmctf", edition: "classic", binding: "offhand", source: source(EQUIPMENT_PROVIDERS.lmctf, lm) }, grenadeEdition: "classic" },
  ];
  for (const entry of cases) {
    const native = preset(catalog, entry.product, entry.map);
    const equipment: EquipmentSelection = { grapple: entry.grapple, handGrenades: { kind: "enabled", source: source(EQUIPMENT_PROVIDERS.handGrenades, catalog.require(`q2-${entry.grenadeEdition}-baseq2`).id),
      edition: entry.grenadeEdition, binding: "offhand", initialAmmo: 3, capacity: 50 } };
    const resolved = await resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), equipment: { kind: "selected", value: equipment } } });
    expect(resolved.equipment).toEqual(equipment); expect(resolved.campaign).toEqual(native.campaign); expect(resolved.weapons).toEqual(native.weapons);
    expect(resolved.presentation).toEqual(native.presentation); expect(resolved.match).toEqual(native.match); expect(resolved.execution).toHaveLength(0);
    expect(resolved.map.geometry.provenance.mount.identity.content).toBe(native.map.geometry.content);
    expect(resolved.timing.some(timing => timing.provider === EQUIPMENT_PROVIDERS.handGrenades && timing.clock.kind === `q2-${entry.grenadeEdition}`)).toBe(true);
    expect(resolved.resources.some(resource => resource.requestedPath === `models/objects/${entry.grenadeEdition === "classic" ? "grenade2" : "grenade3"}/tris.md2`)).toBe(true);
    using mounts = await openMountPlan(resolved.mounts);
    for (const resource of resolved.resources) expect((await mounts.read(resource)).length).toBe(resource.byteLength);
    if (entry.product === "q2-classic-baseq2" && entry.grenadeEdition === "rerelease") {
      const classicWeapon = await mounts.resolve("models/objects/grenade2/tris.md2");
      expect(classicWeapon?.provenance.mount.identity.content).toBe(native.presentation.assets);
    }
  }
}, 60000);

test("equipment resolution rejects mismatched installed sources and invalid ammunition", async () => {
  const catalog = await installed, native = preset(catalog, "q1-rerelease-id1", "maps/start.bsp");
  const invalid: EquipmentSelection = { grapple: { kind: "enabled", mechanic: "q2-ctf", edition: "classic", binding: "offhand",
    source: source(EQUIPMENT_PROVIDERS.ctf, catalog.require("q2-rerelease-ctf").id) }, handGrenades: { kind: "disabled" } };
  expect(resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), equipment: { kind: "selected", value: invalid } } })).rejects.toThrow("does not supply");
  const badAmmo: EquipmentSelection = { grapple: { kind: "disabled" }, handGrenades: { kind: "enabled", source: source(EQUIPMENT_PROVIDERS.handGrenades, catalog.require("q2-classic-baseq2").id), edition: "classic", binding: "offhand", initialAmmo: -1, capacity: 50 } };
  expect(resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), equipment: { kind: "selected", value: badAmmo } } })).rejects.toThrow("allowance");
});
