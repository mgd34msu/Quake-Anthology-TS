import { expect, test } from "bun:test";
import type { MonsterSelectionTarget, ProviderReference } from "../../../src/contracts/content.ts";
import { campaignMonsterSlots, defaultMonsterRoster, monsterSources } from "../../../src/content/catalog/monsters.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent, resolveApplicationTravel } from "../../../src/app/bootstrap/content.ts";
import { monsterSource } from "../../../src/content/monsters/definitions.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const q1: ProviderReference = { provider: "q1:monsters/rerelease/id1", content: "q1:rerelease:id1:test" };
const q2: ProviderReference = { provider: "q2:monsters/rerelease/baseq2", content: "q2:rerelease:baseq2:test" };
function target(family: "q1" | "q2", source: ProviderReference, classname: string): MonsterSelectionTarget | undefined {
  const roster = defaultMonsterRoster(family, source);
  return roster.byClassname[classname];
}

test("campaign slot catalogs cover all registered species, expansions and bosses without Q3 players", () => {
  for (const source of monsterSources) {
    const slots = campaignMonsterSlots(source.family);
    expect(new Set(slots.map(slot => slot.classname)).size).toBe(slots.length);
    for (const classname of Object.keys(source.creatures)) expect(slots.some(slot => slot.classname === classname)).toBe(true);
    for (const classname of Object.keys(source.creatures)) {
      const reference = { provider: source.provider, content: source.family === "q1" ? q1.content : q2.content };
      const role = slots.find(slot => slot.classname === classname)?.role;
      expect(target(source.family, reference, classname)).toEqual(role === "boss" || role === "special" ? { kind: "map-defined" } : { source: reference, classname });
    }
  }
  expect(campaignMonsterSlots("q1").some(slot => slot.classname === "monster_armagon")).toBe(true);
  expect(campaignMonsterSlots("q1").some(slot => slot.classname === "monster_eel")).toBe(true);
  expect(campaignMonsterSlots("q2").some(slot => slot.classname === "monster_widow2")).toBe(true);
  expect(campaignMonsterSlots("q2").some(slot => slot.classname === "monster_soldier_ripper")).toBe(true);
  expect(campaignMonsterSlots("q3")).toEqual([]);
});

test("role defaults preserve flight, water, boss scripts and explicit overrides", () => {
  for (const [authored, replacement] of [["monster_soldier", "monster_army"], ["monster_soldier_light", "monster_army"], ["monster_infantry", "monster_enforcer"],
    ["monster_berserk", "monster_demon1"], ["monster_gunner", "monster_ogre"], ["monster_flyer", "monster_wizard"], ["monster_flipper", "monster_fish"],
    ["monster_tank", "monster_shambler"]] satisfies readonly (readonly [string, string])[])
    expect(target("q2", q1, authored)).toEqual({ source: q1, classname: replacement });
  expect(target("q1", q2, "monster_fish")).toEqual({ source: q2, classname: "monster_flipper" });
  expect(target("q1", q2, "monster_eel")).toEqual({ source: q2, classname: "monster_flipper" });
  expect(target("q1", q2, "monster_wrath")).toEqual({ source: q2, classname: "monster_flyer" });
  for (const classname of ["monster_medic", "monster_gekk", "monster_stalker", "monster_widow2", "monster_boss3_stand"])
    expect(target("q2", q1, classname)).toEqual({ kind: "map-defined" });
  for (const classname of ["monster_boss", "monster_oldone", "monster_armagon", "monster_dragon", "monster_zombie", "monster_morph"])
    expect(target("q1", q2, classname)).toEqual({ kind: "map-defined" });
  const override = { source: q1, classname: "monster_ogre" };
  const roster = defaultMonsterRoster("q2", q1, { monster_soldier: override, monster_flipper: { kind: "map-defined" }, monster_custom: override });
  if (roster.kind !== "replace") throw new Error("Missing selected roster");
  expect(roster.byClassname["monster_soldier"]).toEqual(override);
  expect(roster.byClassname["monster_flipper"]).toEqual({ kind: "map-defined" });
  expect(roster.byClassname["monster_custom"]).toEqual(override);
  expect(roster.default).toEqual({ kind: "map-defined" });
  expect(defaultMonsterRoster("q2", q1)).toEqual(defaultMonsterRoster("q2", q1));
});

test("an available boss controller does not replace authored boss scripts automatically", () => {
  const source: ProviderReference = { provider: "q1:monsters/rerelease/hipnotic", content: "q1:rerelease:hipnotic:test" };
  expect(monsterSources.find(entry => entry.provider === source.provider)?.creatures["monster_armagon"]).toBeDefined();
  expect(defaultMonsterRoster("q1", source).byClassname["monster_armagon"]).toEqual({ kind: "map-defined" });
  const replacement = { source, classname: "monster_armagon" };
  expect(defaultMonsterRoster("q1", source, { monster_armagon: replacement }).byClassname["monster_armagon"]).toEqual(replacement);
  expect(defaultMonsterRoster("q1", source, { monster_army: replacement }).byClassname["monster_army"]).toEqual(replacement);
});

test("all Quake monster sources replace Q2 parasites with their inherited dog while preserving custom overrides", () => {
  for (const source of monsterSources.filter(source => source.family === "q1")) {
    const reference: ProviderReference = { provider: source.provider, content: `q1:${source.edition}:${source.program}:test` };
    const replacement = target("q2", reference, "monster_parasite");
    expect(replacement).toEqual({ source: reference, classname: "monster_dog" });
    if (replacement === undefined || "kind" in replacement) throw new Error("Missing Quake dog replacement");
    expect(monsterSource(replacement)).toBe(source);
    expect(source.creatures[replacement.classname]?.resources).toContain("progs/dog.mdl");
    for (const override of [{ kind: "map-defined" }, { source: q2, classname: "monster_parasite" }, { source: reference, classname: "monster_ogre" }] satisfies readonly MonsterSelectionTarget[])
      expect(defaultMonsterRoster("q2", reference, { monster_parasite: override }).byClassname["monster_parasite"]).toEqual(override);
  }
  expect(target("q2", q2, "monster_parasite")).toEqual({ kind: "map-defined" });
});

test("all Quake II monster sources replace Quake dogs with parasites while preserving custom overrides", () => {
  for (const source of monsterSources.filter(source => source.family === "q2")) {
    const reference: ProviderReference = { provider: source.provider, content: `q2:${source.edition}:${source.program}:test` };
    const replacement = target("q1", reference, "monster_dog");
    expect(replacement).toEqual({ source: reference, classname: "monster_parasite" });
    if (replacement === undefined || "kind" in replacement) throw new Error("Missing Quake II parasite replacement");
    expect(monsterSource(replacement)).toBe(source);
    expect(source.creatures[replacement.classname]?.resources).toContain("models/monsters/parasite/tris.md2");
    for (const override of [{ kind: "map-defined" }, { source: q1, classname: "monster_dog" }, { source: reference, classname: "monster_berserk" }] satisfies readonly MonsterSelectionTarget[])
      expect(defaultMonsterRoster("q1", reference, { monster_dog: override }).byClassname["monster_dog"]).toEqual(override);
  }
  expect(target("q1", q1, "monster_dog")).toEqual({ source: q1, classname: "monster_dog" });
});

test("installed Quake dog rosters retain their source behavior and resources across Q2 campaign travel", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1"]);
  if (parsed.kind !== "run") throw new Error("Expected launch command");
  const preset = applicationPreset(catalog, parsed.options);
  for (const source of monsterSources.filter(source => source.family === "q1")) {
    const product = catalog.require(`q1-${source.edition}-${source.program}`);
    const reference = { provider: source.provider, content: product.id };
    const enemies = defaultMonsterRoster("q2", reference);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
    expect(recipe.enemies).toEqual(enemies);
    expect(recipe.resources.some(resource => resource.requestedPath === "progs/dog.mdl")).toBe(true);
    expect(recipe.resources.some(resource => resource.requestedPath === "sound/dog/dattack1.wav")).toBe(true);
    const content = await loadApplicationContent(parsed.options, recipe);
    try {
      const next = await resolveApplicationTravel(content, "maps/base2.bsp");
      expect(next.map.geometry.requestedPath).toBe("maps/base2.bsp");
      expect(next.campaign).toEqual(recipe.campaign);
      expect(next.enemies).toEqual(enemies);
      if (next.enemies.kind !== "replace") throw new Error("Missing selected roster after travel");
      const parasite = next.enemies.byClassname["monster_parasite"];
      if (parasite === undefined || "kind" in parasite) throw new Error("Native parasite survived default Quake roster");
      expect(monsterSource(parasite)).toBe(source);
      expect(parasite.classname).toBe("monster_dog");
    } finally { await content.close(); }
  }
}, 60000);

test("actual Q2 base1 and Q1 e1m1 recipes resolve automatic campaign rosters without per-class setup", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  for (const [game, map, family, source] of [["q2-rerelease-baseq2", "base1", "q2", q1], ["q1-rerelease-id1", "e1m1", "q1", q2]] satisfies readonly (readonly [string, string, "q1" | "q2", ProviderReference])[]) {
    const parsed = parseApplicationCommand(["--game", game, "--map", map]);
    if (parsed.kind !== "run") throw new Error("Expected launch command");
    const preset = applicationPreset(catalog, parsed.options), selected = { ...source, content: catalog.require(source === q1 ? "q1-rerelease-id1" : "q2-rerelease-baseq2").id }, enemies = defaultMonsterRoster(family, selected);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
    expect(recipe.enemies).toEqual(enemies);
    expect(recipe.map.geometryContent).toBe(preset.map.geometry.content);
    expect(recipe.weapons).toEqual(preset.weapons);
    if (recipe.enemies.kind !== "replace") throw new Error("Expected automatic roster");
    const replacements = new Set(Object.values(recipe.enemies.byClassname).flatMap(value => "classname" in value ? [value.classname] : []));
    expect(replacements.size).toBeGreaterThan(5);
    expect(recipe.timing.some(clock => clock.provider === source.provider)).toBe(true);
  }
}, 60000);
