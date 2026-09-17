import { resolve } from "node:path";

const donor = process.argv[2];
if (donor === undefined) throw new Error("Pass the quakec_mg3 source directory");
const modules = new Map([
  ["monster_ogre_rocket", "ogre"], ["monster_demodog", "mg3_demodog"],
  ["monster_army_infected", "mg3_soldier_infected"], ["monster_knight_infected", "mg3_knight_infected"],
  ["monster_enforcer_infected", "mg3_enforcer_infected"], ["monster_hell_knight_infected", "mg3_hknight_infected"],
  ["monster_ranged_knight", "mg3_rknight"], ["monster_super_shambler", "mg3_super_shambler"],
  ["monster_lava_man", "mg3_lavaman"], ["monster_ghost", "mg3_player_ghost"], ["monster_orb", "mg3_orb"],
  ["monster_szombie", "mg3_shub_zombie"], ["monster_oldone_new", "mg3_oldone_new"], ["monster_boss_final", "boss_final"],
]);
const result: Record<string, { readonly resources: readonly string[] }> = {};
for (const [classname, module] of modules) {
  const source = (await Bun.file(resolve(donor, "monsters", `${module}.qc`)).text()).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const paths = new Set(["progs/gib1.mdl", "progs/gib2.mdl", "progs/gib3.mdl", "sound/player/udeath.wav"]);
  for (const match of source.matchAll(/precache_(model|sound)\d?\s*\(\s*"([^"]+)"\s*\)/g)) {
    const kind = match[1], path = match[2];
    if (path !== undefined) paths.add(kind === "sound" ? `sound/${path}` : path);
  }
  result[classname] = { resources: [...paths].sort() };
}
await Bun.write(resolve(import.meta.dir, "../../src/content/monsters/mg3-resources.ts"),
  `// Generated from quakec_mg3/monsters source precache declarations.\n// Regenerate with tools/content/generate-mg3-monster-resources.ts.\nexport const mg3MonsterResources: Readonly<Record<string, { readonly resources: readonly string[] }>> = ${JSON.stringify(result, null, 2)};\n`);
