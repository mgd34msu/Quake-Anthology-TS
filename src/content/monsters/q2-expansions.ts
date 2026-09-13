import type { MonsterSourceDefinition } from "./definitions.ts";
import { q2MonsterSources } from "./q2.ts";

const model = (path: string, ...dependencies: readonly string[]) => ({ resources: [path, ...dependencies] });
const laser = "models/objects/laser/tris.md2";
const rocket = "models/objects/rocket/tris.md2";
const baseAdditional = {
  monster_medic: model("models/monsters/medic/tris.md2", laser),
  monster_supertank: model("models/monsters/boss1/tris.md2", rocket),
  monster_boss2: model("models/monsters/boss2/tris.md2", rocket),
  monster_jorg: model("models/monsters/boss3/rider/tris.md2", "models/monsters/boss3/jorg/tris.md2", "sprites/s_bfg1.sp2"),
  monster_makron: model("models/monsters/boss3/rider/tris.md2", laser),
};
export const q2ExpandedClassicCreatures: MonsterSourceDefinition["creatures"] = baseAdditional;
const xatrix = {
  monster_gekk: model("models/monsters/gekk/tris.md2", "models/objects/loogy/tris.md2"),
  monster_fixbot: model("models/monsters/fixbot/tris.md2", laser),
  monster_gladb: model("models/monsters/gladb/tris.md2", "sprites/s_photon.sp2"),
  monster_boss5: model("models/monsters/boss5/tris.md2", rocket),
  monster_chick_heat: model("models/monsters/bitch/tris.md2", rocket),
  monster_soldier_ripper: model("models/monsters/soldierh/tris.md2", "models/objects/boomrang/tris.md2"),
  monster_soldier_hypergun: model("models/monsters/soldierh/tris.md2", laser),
  monster_soldier_lasergun: model("models/monsters/soldierh/tris.md2"),
};
const rogue = {
  monster_stalker: model("models/monsters/stalker/tris.md2", laser),
  monster_kamikaze: model("models/monsters/flyer/tris.md2"),
  monster_daedalus: model("models/monsters/hover/tris.md2", laser),
  monster_turret: model("models/monsters/turret/tris.md2", laser, rocket),
  monster_carrier: model("models/monsters/carrier/tris.md2", "models/monsters/flyer/tris.md2", rocket, "models/objects/grenade/tris.md2"),
  monster_medic_commander: model("models/monsters/medic/tris.md2", laser),
  monster_widow: model("models/monsters/blackwidow/tris.md2", "models/monsters/stalker/tris.md2", laser),
  monster_widow2: model("models/monsters/blackwidow2/tris.md2", "models/monsters/stalker/tris.md2", "models/proj/disintegrator/tris.md2"),
};
const rerelease = {
  monster_arachnid: model("models/monsters/arachnid/tris.md2"),
  monster_guardian: model("models/monsters/guardian/tris.md2", rocket),
  monster_shambler: model("models/monsters/shambler/tris.md2"),
  monster_guncmdr: model("models/monsters/gunner/tris.md2", "models/objects/grenade/tris.md2"),
};
/** These are the actual source model prerequisites; skins and sounds resolve in the same content-scoped mount. */
const { monster_soldier_ripper, monster_soldier_hypergun, monster_soldier_lasergun, ...rereleaseXatrix } = xatrix;
export const q2ExpandedBaseCreatures: MonsterSourceDefinition["creatures"] = { ...baseAdditional, ...rereleaseXatrix, ...rogue, ...rerelease,
  monster_gladb: model("models/monsters/gladiatr/tris.md2", "sprites/s_photon.sp2"),
  monster_boss5: model("models/monsters/boss1/tris.md2", rocket),
};
function ordinary(edition: "classic" | "rerelease"): MonsterSourceDefinition["creatures"] {
  const source = q2MonsterSources.find(source => source.edition === edition);
  if (source === undefined) throw new Error(`Missing Q2 ${edition} base monster definitions`);
  return source.creatures;
}
export const q2ExpansionSources: readonly MonsterSourceDefinition[] = [
  { provider: "q2:monsters/classic/xatrix", family: "q2", edition: "classic", program: "xatrix", creatures: { ...ordinary("classic"), ...baseAdditional, ...xatrix } },
  { provider: "q2:monsters/classic/rogue", family: "q2", edition: "classic", program: "rogue", creatures: { ...ordinary("classic"), ...baseAdditional, ...rogue } },
  { provider: "q2:monsters/rerelease/xatrix", family: "q2", edition: "rerelease", program: "xatrix", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
  { provider: "q2:monsters/rerelease/rogue", family: "q2", edition: "rerelease", program: "rogue", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
  { provider: "q2:monsters/rerelease/mg2", family: "q2", edition: "rerelease", program: "mg2", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
];
