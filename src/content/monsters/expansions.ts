import { mg3MonsterResources } from "./mg3-resources.ts";
import type { MonsterSourceDefinition } from "./definitions.ts";
import { q1MonsterSources } from "./q1.ts";

const monster_scourge = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/h_scourg.mdl",
  "progs/scor.mdl",
  "progs/spike.mdl",
  "sound/misc/null.wav",
  "sound/player/udeath.wav",
  "sound/scourge/idle.wav",
  "sound/scourge/pain.wav",
  "sound/scourge/pain2.wav",
  "sound/scourge/sight.wav",
  "sound/scourge/tailswng.wav",
  "sound/scourge/walk.wav",
  "sound/shambler/smack.wav",
  "sound/weapons/rocket1i.wav"
] };

const monster_gremlin = { resources: [
  "progs/backpack.mdl",
  "progs/bolt.mdl",
  "progs/bolt2.mdl",
  "progs/bolt3.mdl",
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/grem.mdl",
  "progs/grenade.mdl",
  "progs/h_grem.mdl",
  "progs/laser.mdl",
  "progs/missile.mdl",
  "progs/s_explod.spr",
  "progs/spike.mdl",
  "progs/zom_gib.mdl",
  "sound/demon/dhit2.wav",
  "sound/grem/attack.wav",
  "sound/grem/death.wav",
  "sound/grem/idle.wav",
  "sound/grem/sight1.wav",
  "sound/items/protect3.wav",
  "sound/player/udeath.wav",
  "sound/weapons/bounce.wav",
  "sound/weapons/grenade.wav",
  "sound/weapons/guncock.wav",
  "sound/weapons/lstart.wav",
  "sound/weapons/r_exp3.wav",
  "sound/weapons/ric1.wav",
  "sound/weapons/ric2.wav",
  "sound/weapons/ric3.wav",
  "sound/weapons/rocket1i.wav",
  "sound/weapons/sgun1.wav",
  "sound/weapons/shotgn2.wav",
  "sound/weapons/tink1.wav"
] };

const monster_armagon = { resources: [
  "progs/armabody.mdl",
  "progs/armalegs.mdl",
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/laser.mdl",
  "progs/missile.mdl",
  "progs/s_explod.spr",
  "sound/armagon/death.wav",
  "sound/armagon/footfall.wav",
  "sound/armagon/pain.wav",
  "sound/armagon/repel.wav",
  "sound/armagon/servo.wav",
  "sound/armagon/sight.wav",
  "sound/misc/longexpl.wav",
  "sound/player/udeath.wav",
  "sound/weapons/r_exp3.wav",
  "sound/weapons/sgun1.wav"
] };

const monster_eel = { resources: [
  "progs/eel2.mdl",
  "progs/eelgib.mdl",
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "sound/eel/eactive1.wav",
  "sound/eel/eatt1.wav",
  "sound/eel/edie3r.wav",
  "sound/eel/eelc5.wav",
  "sound/eel/epain3.wav",
  "sound/player/udeath.wav"
] };

const monster_sword = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/sword.mdl",
  "sound/knight/ksight.wav",
  "sound/knight/sword1.wav",
  "sound/player/axhit2.wav",
  "sound/player/udeath.wav"
] };

const monster_wrath = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/s_explod.spr",
  "progs/w_ball.mdl",
  "progs/wrath.mdl",
  "progs/wrthgib1.mdl",
  "progs/wrthgib2.mdl",
  "progs/wrthgib3.mdl",
  "sound/player/udeath.wav",
  "sound/weapons/r_exp3.wav",
  "sound/wrath/watt.wav",
  "sound/wrath/wdthc.wav",
  "sound/wrath/wpain.wav",
  "sound/wrath/wsee.wav"
] };

const monster_mummy = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/h_zombie.mdl",
  "progs/mummy.mdl",
  "progs/zom_gib.mdl",
  "sound/player/udeath.wav",
  "sound/zombie/z_fall.wav",
  "sound/zombie/z_gib.wav",
  "sound/zombie/z_hit.wav",
  "sound/zombie/z_idle.wav",
  "sound/zombie/z_idle1.wav",
  "sound/zombie/z_miss.wav",
  "sound/zombie/z_pain.wav",
  "sound/zombie/z_pain1.wav",
  "sound/zombie/z_shot1.wav"
] };

const monster_super_wrath = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/s_explod.spr",
  "progs/s_wrath.mdl",
  "progs/s_wrtgb2.mdl",
  "progs/s_wrtgb3.mdl",
  "progs/w_ball.mdl",
  "progs/wrthgib1.mdl",
  "progs/wrthgib2.mdl",
  "progs/wrthgib3.mdl",
  "sound/player/udeath.wav",
  "sound/s_wrath/smash.wav",
  "sound/weapons/r_exp3.wav",
  "sound/wrath/watt.wav",
  "sound/wrath/wpain.wav",
  "sound/wrath/wsee.wav"
] };

const monster_lava_man = { resources: [
  "progs/lavaball.mdl",
  "progs/lavaman.mdl",
  "sound/boss1/death.wav",
  "sound/boss1/out1.wav",
  "sound/boss1/sight1.wav",
  "sound/boss1/throw.wav"
] };

const monster_dragon = { resources: [
  "progs/dragon.mdl",
  "progs/drggib01.mdl",
  "progs/drggib02.mdl",
  "progs/drggib03.mdl",
  "progs/fireball.mdl",
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "sound/dragon/active.wav",
  "sound/dragon/attack.wav",
  "sound/dragon/death.wav",
  "sound/dragon/pain.wav",
  "sound/dragon/see.wav",
  "sound/player/udeath.wav"
] };

const monster_morph = { resources: [
  "progs/gib1.mdl",
  "progs/gib2.mdl",
  "progs/gib3.mdl",
  "progs/laser.mdl",
  "progs/morph_az.mdl",
  "progs/morph_eg.mdl",
  "progs/morph_gr.mdl",
  "sound/enforcer/enfire.wav",
  "sound/guard/death.wav",
  "sound/guard/pain1.wav",
  "sound/guard/see1.wav",
  "sound/player/udeath.wav"
] };

const monster_spikemine = { resources: [
  "progs/demon.mdl",
  "progs/h_demon.mdl",
  "sound/demon/ddeath.wav",
  "sound/demon/dhit2.wav",
  "sound/demon/djump.wav",
  "sound/demon/dpain1.wav",
  "sound/demon/idle1.wav",
  "sound/demon/sight2.wav"
] };

export const q1ExpansionMonsterSources: readonly MonsterSourceDefinition[] = q1MonsterSources.flatMap(source => [
  { ...source, provider: `q1:monsters/${source.edition}/hipnotic`, family: "q1", program: "hipnotic", creatures: { ...source.creatures, monster_scourge, monster_gremlin, monster_armagon, monster_spikemine } },
  { ...source, provider: `q1:monsters/${source.edition}/rogue`, family: "q1", program: "rogue", creatures: { ...source.creatures, monster_eel, monster_sword, monster_wrath, monster_mummy, monster_super_wrath, monster_lava_man, monster_dragon, monster_morph } },
]);

export const q1AddonMonsterSources: readonly MonsterSourceDefinition[] = q1MonsterSources.filter(source => source.edition === "rerelease").flatMap(source => [
  { ...source, provider: "q1:monsters/rerelease/dopa", family: "q1", program: "dopa", creatures: source.creatures },
  { ...source, provider: "q1:monsters/rerelease/mg1", family: "q1", program: "mg1", creatures: source.creatures },
  { ...source, provider: "q1:monsters/rerelease/mg3", family: "q1", program: "mg3", creatures: { ...source.creatures, ...mg3MonsterResources } },
]);
