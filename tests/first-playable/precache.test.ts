import { expect, test } from "bun:test";
import { applicationResourceRequests, characterResourceRequests, nativeQ2MonsterResources, prepareApplicationResources } from "../../src/app/bootstrap/precache.ts";
import { InstalledCatalog, expectedProducts } from "../../src/content/catalog/index.ts";
import type { CatalogProduct } from "../../src/content/catalog/index.ts";
import { type ProviderReference, createContentId } from "../../src/contracts/content.ts";
import { disabledEquipment, EQUIPMENT_PROVIDERS } from "../../src/content/catalog/equipment.ts";
import { q2RegisteredWeaponResources, selectedWeaponResources, weaponResources } from "../../src/content/catalog/weapons.ts";
import { rogueWeaponDefinitions, xatrixWeaponDefinitions } from "../../src/content/q2/missionpacks/weapons/definitions.ts";
import { monsterSources } from "../../src/content/monsters/definitions.ts";
import { rereleaseMedicReinforcements } from "../../src/content/q2/rerelease/monsters/base-variants/medic.ts";

const catalog = new InstalledCatalog("/unused", expectedProducts.filter(product => ["q1-classic-id1", "q2-classic-baseq2", "q2-classic-rogue", "q2-rerelease-baseq2", "q3-baseq3"].includes(product.id)).map(expectation => ({
  id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "precache-test" }),
  expectation, availability: { kind: "installed" }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [],
} satisfies CatalogProduct)), [], 0);
const native = { provider: "q1:official", content: catalog.product("q1-classic-id1").id } satisfies Parameters<typeof weaponResources>[0];
const gunner = { source: { provider: "q2:monsters/rerelease/baseq2", content: catalog.product("q2-rerelease-baseq2").id }, classname: "monster_gunner" } satisfies
  Extract<Parameters<typeof applicationResourceRequests>[0]["recipe"]["enemies"], { kind: "replace" }>["default"];
const simulation = { q1Source: () => null, quakecSource: () => null, q2Source: () => null, q1WeaponSource: () => null };

test("Q2 transient precache selects expansion sounds by source content", () => {
  for (const product of ["q2-classic-baseq2", "q2-classic-rogue", "q2-rerelease-baseq2"]) {
    const source = { provider: "q2:entities", content: catalog.product(product).id } satisfies ProviderReference;
    const content = { catalog, recipe: { map: { entities: source }, weapons: [], equipment: disabledEquipment(),
      character: { definition: native, appearance: native }, enemies: { kind: "replace", default: gunner, byClassname: {} } } } satisfies Parameters<typeof applicationResourceRequests>[0];
    const paths = applicationResourceRequests(content, simulation).filter(request => request.content === source.content).map(request => request.path);
    expect(paths).toContain("sound/weapons/rocklx1a.wav");
    for (const path of ["sound/weapons/tesla.wav", "sound/weapons/disrupthit.wav"]) expect(paths.includes(path)).toBe(product !== "q2-classic-baseq2");
  }
  const registered = q2RegisteredWeaponResources({ registeredDefinitions: () => rogueWeaponDefinitions }, false);
  expect(registered).toContain("sound/weapons/disrupthit.wav");
});

test("shared precache keeps selected source identity and deduplicates overlapping monster, weapon and equipment declarations", () => {
  const content = { catalog, recipe: { map: { entities: native }, weapons: [native], character: { definition: native, appearance: native },
    enemies: { kind: "replace", default: gunner, byClassname: { monster_ogre: gunner } },
    equipment: { ...disabledEquipment(), handGrenades: { kind: "enabled", edition: "rerelease", binding: "offhand", initialAmmo: 2, capacity: 50,
      source: { provider: EQUIPMENT_PROVIDERS.handGrenades, content: gunner.source.content } } },
  } } satisfies Parameters<typeof applicationResourceRequests>[0];
  const requests = applicationResourceRequests(content, simulation);
  expect(requests.filter(request => request.content === gunner.source.content && request.path === "models/objects/grenade/tris.md2")).toHaveLength(1);
  expect(requests.some(request => request.content === native.content && request.path === "progs/grenade.mdl")).toBe(true);
  expect(requests.some(request => request.content === gunner.source.content && request.path === "sound/gunner/gunatck3.wav")).toBe(true);
  expect(requests.some(request => request.content === gunner.source.content && request.path === "sound/weapons/grenlx1a.wav")).toBe(true);
  expect(new Set(requests.map(request => `${request.content}/${request.path}`)).size).toBe(requests.length);
  expect(requests.every(request => /\.(mdl|md2|md3|spr|sp2|wav|ogg)$/.test(request.path))).toBe(true);
  expect(selectedWeaponResources(native, [native], catalog)).toEqual([]);
  expect(weaponResources(native, [native], catalog).length).toBeGreaterThan(0);
});

test("registered native expansion arsenals include source projectile and sound dependencies", () => {
  const classic = q2RegisteredWeaponResources({ registeredDefinitions: () => rogueWeaponDefinitions }, false);
  expect(classic).toContain("models/weapons/v_tesla2/tris.md2");
  expect(classic).toContain("sound/weapons/disint2.wav");
  expect(classic).toContain("models/weapons/g_prox/tris.md2");
  expect(classic).not.toContain("sound/weapons/trapcock.wav");
  const rerelease = q2RegisteredWeaponResources({ registeredDefinitions: () => [...rogueWeaponDefinitions, ...xatrixWeaponDefinitions] }, true);
  expect(rerelease).not.toContain("models/weapons/v_tesla2/tris.md2");
  expect(rerelease).toContain("sound/weapons/trapcock.wav");
  expect(rerelease).toContain("sprites/s_photon.sp2");
});

test("native medic precache reads the same custom reinforcement fields as live source AI", () => {
  const source = monsterSources.find(source => source.provider === gunner.source.provider);
  if (source === undefined) throw new Error("Missing rerelease source metadata");
  const fields = new Map([["reinforcements", " monster_arachnid 7; monster_guardian 11 "]]);
  expect(rereleaseMedicReinforcements(fields)).toEqual([{ classname: "monster_arachnid", strength: 7 }, { classname: "monster_guardian", strength: 11 }]);
  const commander = { classname: "monster_medic_commander", spawn: { classname: "monster_medic_commander", ordinal: 4, values: fields } };
  const emptyFields: Parameters<typeof rereleaseMedicReinforcements>[0] = new Map<string, string>();
  const ordinary = nativeQ2MonsterResources(gunner.source.content, source, [{ ...commander, spawn: { ...commander.spawn, values: emptyFields } }]);
  const custom = nativeQ2MonsterResources(gunner.source.content, source, [commander]);
  for (const classname of ["monster_arachnid", "monster_guardian"]) {
    const creature = source.creatures[classname];
    if (creature === undefined) throw new Error(`Missing ${classname} metadata`);
    for (const path of creature.resources) expect(custom).toContainEqual({ content: gunner.source.content, path });
  }
  expect(ordinary.some(request => request.path === "models/monsters/arachnid/tris.md2")).toBe(false);
  expect(custom.some(request => request.path === "models/monsters/arachnid/tris.md2")).toBe(true);
  expect(rereleaseMedicReinforcements(new Map([["reinforcements", ""]]))).toEqual([]);
  expect(rereleaseMedicReinforcements(emptyFields).map(value => value.classname)).toContain("monster_gunner");
  // Restored source fields are consumed anew, with no classname-only cache to retain an old declaration.
  fields.set("reinforcements", "monster_shambler 3");
  const restored = nativeQ2MonsterResources(gunner.source.content, source, [commander]);
  expect(restored.some(request => request.path === "models/monsters/arachnid/tris.md2")).toBe(false);
  expect(restored.some(request => request.path === "models/monsters/shambler/tris.md2")).toBe(true);
});

test("preparation advances loading progress and reports a failed optional resource while finishing the list", async () => {
  const content = { catalog, recipe: { map: { entities: native }, weapons: [], equipment: disabledEquipment(), character: { definition: native, appearance: native },
    enemies: { kind: "replace", default: gunner, byClassname: {} } } } satisfies Parameters<typeof applicationResourceRequests>[0];
  const requests = applicationResourceRequests(content, simulation), visited: string[] = [], messages: string[] = [], progress: string[] = [];
  await prepareApplicationResources({ content, simulation, progress: message => { progress.push(message); }, print: message => { messages.push(message); },
    audio: { preloadSound: async (_content, path) => { visited.push(path); }, preloadCharacterFootsteps: async () => {} },
    effects: { preloadModel: async (_content, path) => { visited.push(path); if (path === "models/objects/grenade/tris.md2") throw new Error("test missing model"); } },
  });
  expect(visited).toEqual(requests.map(request => request.path));
  expect(progress).toHaveLength(requests.length);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(`${gunner.source.content}/models/objects/grenade/tris.md2: test missing model`);
});

test("selected character resources include native voices and gibs without pulling other character families", () => {
  for (const product of ["q1-classic-id1", "q2-rerelease-baseq2", "q3-baseq3"]) {
    const character = { ...native, content: catalog.product(product).id };
    const requests = characterResourceRequests({ catalog, recipe: { map: { entities: native }, weapons: [], enemies: { kind: "map-defined" },
      equipment: disabledEquipment(), character: { definition: character, appearance: character } } });
    expect(requests.every(request => request.content === character.content)).toBe(true);
    const paths = requests.map(request => request.path);
    if (product.startsWith("q1")) { expect(paths).toContain("sound/player/pain1.wav"); expect(paths).toContain("progs/gib1.mdl"); expect(paths).not.toContain("progs/v_rock.mdl"); }
    else if (product.startsWith("q2")) { expect(paths).toContain("*pain100_1.wav"); expect(paths).toContain("models/objects/gibs/head2/tris.md2"); }
    else { expect(paths).toContain("*pain100_1.wav"); expect(paths).toContain("sound/world/telein.wav"); expect(paths).not.toContain("sound/player/sarge/pain100_1.wav"); }
  }
});
