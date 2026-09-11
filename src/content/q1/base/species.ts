/* QuakeC monster spawn defaults. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Bounds } from "../../../contracts/math.ts";
import type { Q1Monster } from "../foundation/entity.ts";
export type BaseSpecies = "knight" | "enforcer" | "demon" | "ogre" | "hellknight" | "shambler" | "wizard" | "shalrath" | "tarbaby" | "fish" | "zombie" | "boss" | "oldone";
export interface MonsterSpecies {
  readonly species: Q1Monster["species"];
  readonly killString?: string;
  readonly classnames: readonly string[];
  readonly model: string;
  readonly head: string | null;
  readonly health: number;
  readonly gibHealth: number;
  readonly gibs: readonly string[];
  readonly bounds: Bounds;
  readonly stand: string;
  readonly walk: string;
  readonly run: string;
  readonly sight: string;
  readonly missile: string | null;
  readonly melee: boolean;
  readonly movement: "walk" | "fly" | "swim" | "boss";
}
const human: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } };
const large: Bounds = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } };
const gibs: readonly string[] = ["gib1", "gib2", "gib3"];
export const baseSpecies: readonly MonsterSpecies[] = [
  { species: "knight", killString: "$qc_ks_knight", classnames: ["monster_knight"], model: "knight", head: "h_knight", health: 75, gibHealth: -40, gibs, bounds: human, stand: "knight_stand1", walk: "knight_walk1", run: "knight_run1", sight: "knight/ksight.wav", missile: null, melee: true, movement: "walk" },
  { species: "enforcer", killString: "$qc_ks_enforcer", classnames: ["monster_enforcer"], model: "enforcer", head: "h_mega", health: 80, gibHealth: -35, gibs, bounds: human, stand: "enf_stand1", walk: "enf_walk1", run: "enf_run1", sight: "enforcer/sight1.wav", missile: "enf_atk1", melee: false, movement: "walk" },
  { species: "demon", killString: "$qc_ks_fiend", classnames: ["monster_demon1"], model: "demon", head: "h_demon", health: 300, gibHealth: -80, gibs: ["gib1", "gib1", "gib1"], bounds: large, stand: "demon1_stand1", walk: "demon1_walk1", run: "demon1_run1", sight: "demon/sight2.wav", missile: "demon1_jump1", melee: true, movement: "walk" },
  { species: "ogre", killString: "$qc_ks_ogre", classnames: ["monster_ogre", "monster_ogre_marksman"], model: "ogre", head: "h_ogre", health: 200, gibHealth: -80, gibs: ["gib3", "gib3", "gib3"], bounds: large, stand: "ogre_stand1", walk: "ogre_walk1", run: "ogre_run1", sight: "ogre/ogwake.wav", missile: "ogre_nail1", melee: true, movement: "walk" },
  { species: "hellknight", killString: "$qc_ks_deathknight", classnames: ["monster_hell_knight"], model: "hknight", head: "h_hellkn", health: 250, gibHealth: -40, gibs, bounds: human, stand: "hknight_stand1", walk: "hknight_walk1", run: "hknight_run1", sight: "hknight/sight1.wav", missile: "hknight_magicc1", melee: true, movement: "walk" },
  { species: "shambler", killString: "$qc_ks_shambler", classnames: ["monster_shambler"], model: "shambler", head: "h_shams", health: 600, gibHealth: -60, gibs, bounds: large, stand: "sham_stand1", walk: "sham_walk1", run: "sham_run1", sight: "shambler/ssight.wav", missile: "sham_magic1", melee: true, movement: "walk" },
  { species: "wizard", killString: "$qc_ks_scrag", classnames: ["monster_wizard"], model: "wizard", head: "h_wizard", health: 80, gibHealth: -40, gibs: ["gib2", "gib2", "gib2"], bounds: human, stand: "wiz_stand1", walk: "wiz_walk1", run: "wiz_run1", sight: "wizard/wsight.wav", missile: "wiz_fast1", melee: false, movement: "fly" },
  { species: "shalrath", killString: "$qc_ks_vore", classnames: ["monster_shalrath"], model: "shalrath", head: "h_shal", health: 400, gibHealth: -90, gibs, bounds: large, stand: "shal_stand", walk: "shal_walk1", run: "shal_run1", sight: "shalrath/sight.wav", missile: "shal_attack1", melee: false, movement: "walk" },
  { species: "tarbaby", killString: "$qc_ks_spawn", classnames: ["monster_tarbaby"], model: "tarbaby", head: null, health: 80, gibHealth: -Infinity, gibs: [], bounds: human, stand: "tbaby_stand1", walk: "tbaby_walk1", run: "tbaby_run1", sight: "blob/sight1.wav", missile: "tbaby_jump1", melee: true, movement: "walk" },
  { species: "fish", killString: "$qc_ks_rotfish", classnames: ["monster_fish"], model: "fish", head: null, health: 25, gibHealth: -Infinity, gibs: [], bounds: { min: human.min, max: { x: 16, y: 16, z: 24 } }, stand: "f_stand1", walk: "f_walk1", run: "f_run1", sight: "fish/idle.wav", missile: null, melee: true, movement: "swim" },
  { species: "zombie", killString: "$qc_ks_zombie", classnames: ["monster_zombie"], model: "zombie", head: "h_zombie", health: 60, gibHealth: 0, gibs, bounds: human, stand: "zombie_stand1", walk: "zombie_walk1", run: "zombie_run1", sight: "zombie/z_idle.wav", missile: "zombie_atta1", melee: false, movement: "walk" },
  { species: "boss", killString: "$qc_ks_chthon", classnames: ["monster_boss"], model: "boss", head: null, health: 3, gibHealth: -Infinity, gibs: [], bounds: { min: { x: -128, y: -128, z: -24 }, max: { x: 128, y: 128, z: 256 } }, stand: "boss_idle1", walk: "boss_idle1", run: "boss_missile1", sight: "boss1/sight1.wav", missile: "boss_missile1", melee: false, movement: "boss" },
  { species: "oldone", killString: "$qc_ks_shub", classnames: ["monster_oldone"], model: "oldone", head: null, health: 40000, gibHealth: -Infinity, gibs: [], bounds: { min: { x: -160, y: -128, z: -24 }, max: { x: 160, y: 128, z: 256 } }, stand: "old_idle1", walk: "old_idle1", run: "old_idle1", sight: "boss2/sight.wav", missile: null, melee: false, movement: "boss" },
];

/** progs106 monster spawn declarations, before model assignment and startup. */
export function precacheId1Monster(game: Q1EntityServices, species: Q1Monster["species"]): undefined {
  switch (species) {
    case "knight":
      game.precacheModel("progs/knight.mdl");
      game.precacheModel("progs/h_knight.mdl");
      game.precacheSound("knight/kdeath.wav");
      game.precacheSound("knight/khurt.wav");
      game.precacheSound("knight/ksight.wav");
      game.precacheSound("knight/sword1.wav");
      game.precacheSound("knight/sword2.wav");
      game.precacheSound("knight/idle.wav");
      return undefined;
    case "enforcer":
      game.precacheModel("progs/enforcer.mdl");
      game.precacheModel("progs/h_mega.mdl");
      game.precacheModel("progs/laser.mdl");
      game.precacheSound("enforcer/death1.wav");
      game.precacheSound("enforcer/enfire.wav");
      game.precacheSound("enforcer/enfstop.wav");
      game.precacheSound("enforcer/idle1.wav");
      game.precacheSound("enforcer/pain1.wav");
      game.precacheSound("enforcer/pain2.wav");
      game.precacheSound("enforcer/sight1.wav");
      game.precacheSound("enforcer/sight2.wav");
      game.precacheSound("enforcer/sight3.wav");
      game.precacheSound("enforcer/sight4.wav");
      return undefined;
    case "demon":
      game.precacheModel("progs/demon.mdl");
      game.precacheModel("progs/h_demon.mdl");
      game.precacheSound("demon/ddeath.wav");
      game.precacheSound("demon/dhit2.wav");
      game.precacheSound("demon/djump.wav");
      game.precacheSound("demon/dpain1.wav");
      game.precacheSound("demon/idle1.wav");
      game.precacheSound("demon/sight2.wav");
      return undefined;
    case "ogre":
      game.precacheModel("progs/ogre.mdl");
      game.precacheModel("progs/h_ogre.mdl");
      game.precacheModel("progs/grenade.mdl");
      game.precacheSound("ogre/ogdrag.wav");
      game.precacheSound("ogre/ogdth.wav");
      game.precacheSound("ogre/ogidle.wav");
      game.precacheSound("ogre/ogidle2.wav");
      game.precacheSound("ogre/ogpain1.wav");
      game.precacheSound("ogre/ogsawatk.wav");
      game.precacheSound("ogre/ogwake.wav");
      return undefined;
    case "hellknight":
      game.precacheModel("progs/hknight.mdl");
      game.precacheModel("progs/k_spike.mdl");
      game.precacheModel("progs/h_hellkn.mdl");
      game.precacheSound("hknight/attack1.wav");
      game.precacheSound("hknight/death1.wav");
      game.precacheSound("hknight/pain1.wav");
      game.precacheSound("hknight/sight1.wav");
      game.precacheSound("hknight/hit.wav");
      game.precacheSound("hknight/slash1.wav");
      game.precacheSound("hknight/idle.wav");
      game.precacheSound("hknight/grunt.wav");
      game.precacheSound("knight/sword1.wav");
      game.precacheSound("knight/sword2.wav");
      return undefined;
    case "shambler":
      game.precacheModel("progs/shambler.mdl");
      game.precacheModel("progs/s_light.mdl");
      game.precacheModel("progs/h_shams.mdl");
      game.precacheModel("progs/bolt.mdl");
      game.precacheSound("shambler/sattck1.wav");
      game.precacheSound("shambler/sboom.wav");
      game.precacheSound("shambler/sdeath.wav");
      game.precacheSound("shambler/shurt2.wav");
      game.precacheSound("shambler/sidle.wav");
      game.precacheSound("shambler/ssight.wav");
      game.precacheSound("shambler/melee1.wav");
      game.precacheSound("shambler/melee2.wav");
      game.precacheSound("shambler/smack.wav");
      return undefined;
    case "wizard":
      game.precacheModel("progs/wizard.mdl");
      game.precacheModel("progs/h_wizard.mdl");
      game.precacheModel("progs/w_spike.mdl");
      game.precacheSound("wizard/hit.wav");
      game.precacheSound("wizard/wattack.wav");
      game.precacheSound("wizard/wdeath.wav");
      game.precacheSound("wizard/widle1.wav");
      game.precacheSound("wizard/widle2.wav");
      game.precacheSound("wizard/wpain.wav");
      game.precacheSound("wizard/wsight.wav");
      return undefined;
    case "shalrath":
      game.precacheModel("progs/shalrath.mdl");
      game.precacheModel("progs/h_shal.mdl");
      game.precacheModel("progs/v_spike.mdl");
      game.precacheSound("shalrath/attack.wav");
      game.precacheSound("shalrath/attack2.wav");
      game.precacheSound("shalrath/death.wav");
      game.precacheSound("shalrath/idle.wav");
      game.precacheSound("shalrath/pain.wav");
      game.precacheSound("shalrath/sight.wav");
      return undefined;
    case "tarbaby":
      game.precacheModel("progs/tarbaby.mdl");
      game.precacheSound("blob/death1.wav");
      game.precacheSound("blob/hit1.wav");
      game.precacheSound("blob/land1.wav");
      game.precacheSound("blob/sight1.wav");
      return undefined;
    case "fish":
      game.precacheModel("progs/fish.mdl");
      game.precacheSound("fish/death.wav");
      game.precacheSound("fish/bite.wav");
      game.precacheSound("fish/idle.wav");
      return undefined;
    case "zombie":
      game.precacheModel("progs/zombie.mdl");
      game.precacheModel("progs/h_zombie.mdl");
      game.precacheModel("progs/zom_gib.mdl");
      game.precacheSound("zombie/z_idle.wav");
      game.precacheSound("zombie/z_idle1.wav");
      game.precacheSound("zombie/z_shot1.wav");
      game.precacheSound("zombie/z_gib.wav");
      game.precacheSound("zombie/z_pain.wav");
      game.precacheSound("zombie/z_pain1.wav");
      game.precacheSound("zombie/z_fall.wav");
      game.precacheSound("zombie/z_miss.wav");
      game.precacheSound("zombie/z_hit.wav");
      game.precacheSound("zombie/idle_w2.wav");
      return undefined;
    case "boss":
      game.precacheModel("progs/boss.mdl");
      game.precacheModel("progs/lavaball.mdl");
      game.precacheSound("weapons/rocket1i.wav");
      game.precacheSound("boss1/out1.wav");
      game.precacheSound("boss1/sight1.wav");
      game.precacheSound("misc/power.wav");
      game.precacheSound("boss1/throw.wav");
      game.precacheSound("boss1/pain.wav");
      game.precacheSound("boss1/death.wav");
      return undefined;
    case "oldone":
      game.precacheModel("progs/oldone.mdl");
      game.precacheSound("boss2/death.wav");
      game.precacheSound("boss2/idle.wav");
      game.precacheSound("boss2/sight.wav");
      game.precacheSound("boss2/pop2.wav");
      return undefined;
    default: throw new Error(`No id1 base monster precaches for ${species}`);
  }
}
