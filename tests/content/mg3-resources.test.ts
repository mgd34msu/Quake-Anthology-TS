// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { q1AddonMonsterSources } from "../../src/content/monsters/expansions.ts";
import { mg3MonsterResources } from "../../src/content/monsters/mg3-resources.ts";

test("MG3 creatures request their own and QuakeC-reachable resources, not every base monster's", () => {
  const source = q1AddonMonsterSources.find(entry => entry.program === "mg3");
  if (source === undefined) throw new Error("Missing MG3 roster");
  const shambler = source.creatures["monster_super_shambler"];
  if (shambler === undefined) throw new Error("Missing monster_super_shambler");
  expect(shambler.resources).toEqual(mg3MonsterResources["monster_super_shambler"]?.resources ?? []);
  expect(shambler.resources.length).toBeLessThan(80);
  expect(shambler.resources).toContain("progs/gib1.mdl");
  for (const resources of Object.values(mg3MonsterResources)) expect(resources.resources.some(path => path.endsWith(".bsp"))).toBe(false);
});

test("Rogue and Hipnotic selection manifests offer the dragon, morph and spike mine", async () => {
  const { q1ExpansionMonsterSources } = await import("../../src/content/monsters/expansions.ts");
  const wanted: readonly (readonly ["rogue" | "hipnotic", string])[] = [
    ["rogue", "monster_dragon"],
    ["rogue", "monster_morph"],
    ["hipnotic", "monster_spikemine"],
  ];
  for (const [program, classname] of wanted) {
    for (const source of q1ExpansionMonsterSources.filter(entry => entry.program === program)) {
      expect(source.creatures[classname]?.resources.length ?? 0).toBeGreaterThan(5);
    }
  }
});
