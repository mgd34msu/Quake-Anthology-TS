import type { MonsterSourceDefinition } from "./definitions.ts";
import { q2MonsterSources } from "./q2.ts";

// Source precaches: quake-2-re-ts src/{xatrix,rogue,kexgame}/m_*.ts. Shared callbacks use the same selected mount.
const sharedPrecaches: Readonly<Record<string, readonly string[]>> = {
  monster_medic: [
    "models/monsters/medic/tris.md2", "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/medic/idle.wav", "sound/medic/medatck1.wav", "sound/medic/medatck2.wav",
    "sound/medic/medatck3.wav", "sound/medic/medatck4.wav", "sound/medic/medatck5.wav",
    "sound/medic/meddeth1.wav", "sound/medic/medpain1.wav", "sound/medic/medpain2.wav",
    "sound/medic/medsght1.wav", "sound/medic/medsrch1.wav", "sound/misc/udeath.wav",
  ],
  monster_supertank: [
    "models/monsters/boss1/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/sm_metal/tris.md2",
    "sound/bosstank/btkdeth1.wav", "sound/bosstank/btkengn1.wav", "sound/bosstank/btkpain1.wav",
    "sound/bosstank/btkpain2.wav", "sound/bosstank/btkpain3.wav", "sound/bosstank/btkunqv1.wav",
    "sound/bosstank/btkunqv2.wav",
  ],
  monster_boss2: [
    "models/monsters/boss2/tris.md2", "sound/bosshovr/bhvdeth1.wav", "sound/bosshovr/bhvengn1.wav",
    "sound/bosshovr/bhvpain1.wav", "sound/bosshovr/bhvpain2.wav", "sound/bosshovr/bhvpain3.wav",
    "sound/bosshovr/bhvunqv1.wav",
  ],
  monster_jorg: [
    "models/monsters/boss3/jorg/tris.md2", "models/monsters/boss3/rider/tris.md2", "sound/boss3/bs3atck1.wav",
    "sound/boss3/bs3atck2.wav", "sound/boss3/bs3deth1.wav", "sound/boss3/bs3idle1.wav",
    "sound/boss3/bs3pain1.wav", "sound/boss3/bs3pain2.wav", "sound/boss3/bs3pain3.wav",
    "sound/boss3/bs3srch1.wav", "sound/boss3/bs3srch2.wav", "sound/boss3/bs3srch3.wav",
    "sound/boss3/d_hit.wav", "sound/boss3/step1.wav", "sound/boss3/step2.wav",
    "sound/boss3/w_loop.wav", "sound/boss3/xfire.wav",
  ],
  monster_makron: [
    "models/monsters/boss3/rider/tris.md2", "models/objects/gibs/gear/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/gibs/sm_metal/tris.md2", "sound/makron/bfg_fire.wav", "sound/makron/bhit.wav",
    "sound/makron/brain1.wav", "sound/makron/death.wav", "sound/makron/pain1.wav",
    "sound/makron/pain2.wav", "sound/makron/pain3.wav", "sound/makron/popup.wav",
    "sound/makron/rail_up.wav", "sound/makron/spine.wav", "sound/makron/step1.wav",
    "sound/makron/step2.wav", "sound/makron/voice.wav", "sound/makron/voice3.wav",
    "sound/makron/voice4.wav", "sound/misc/udeath.wav",
  ],
  monster_gekk: [
    "models/monsters/gekk/tris.md2", "models/objects/gekkgib/arm/tris.md2", "models/objects/gekkgib/claw/tris.md2",
    "models/objects/gekkgib/head/tris.md2", "models/objects/gekkgib/leg/tris.md2", "models/objects/gekkgib/pelvis/tris.md2",
    "models/objects/gekkgib/torso/tris.md2", "models/objects/loogy/tris.md2", "sound/gek/gek_high.wav",
    "sound/gek/gek_low.wav", "sound/gek/gek_mid.wav", "sound/gek/gk_atck1.wav",
    "sound/gek/gk_atck2.wav", "sound/gek/gk_atck3.wav", "sound/gek/gk_deth1.wav",
    "sound/gek/gk_idle1.wav", "sound/gek/gk_pain1.wav", "sound/gek/gk_sght1.wav",
    "sound/gek/gk_step1.wav", "sound/gek/gk_step2.wav", "sound/gek/gk_step3.wav",
    "sound/misc/udeath.wav", "sound/mutant/thud1.wav",
  ],
  monster_fixbot: [
    "models/monsters/fixbot/tris.md2", "sound/flyer/flydeth1.wav", "sound/flyer/flypain1.wav",
    "sound/misc/welder1.wav", "sound/misc/welder2.wav", "sound/misc/welder3.wav",
  ],
  monster_gladb: [
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "sound/gladiator/glddeth2.wav",
    "sound/gladiator/gldidle1.wav", "sound/gladiator/gldpain2.wav", "sound/gladiator/gldsrch1.wav",
    "sound/gladiator/melee1.wav", "sound/gladiator/melee2.wav", "sound/gladiator/melee3.wav",
    "sound/gladiator/pain.wav", "sound/gladiator/sight.wav", "sound/misc/udeath.wav",
    "sound/weapons/plasshot.wav",
  ],
  monster_boss5: [
    "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/sm_metal/tris.md2", "sound/bosstank/btkdeth1.wav",
    "sound/bosstank/btkengn1.wav", "sound/bosstank/btkpain1.wav", "sound/bosstank/btkpain2.wav",
    "sound/bosstank/btkpain3.wav", "sound/bosstank/btkunqv1.wav", "sound/bosstank/btkunqv2.wav",
  ],
  monster_chick_heat: [
    "models/monsters/bitch/tris.md2", "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/chick/chkatck1.wav", "sound/chick/chkatck2.wav", "sound/chick/chkatck3.wav",
    "sound/chick/chkatck4.wav", "sound/chick/chkatck5.wav", "sound/chick/chkdeth1.wav",
    "sound/chick/chkdeth2.wav", "sound/chick/chkfall1.wav", "sound/chick/chkidle1.wav",
    "sound/chick/chkidle2.wav", "sound/chick/chkpain1.wav", "sound/chick/chkpain2.wav",
    "sound/chick/chkpain3.wav", "sound/chick/chksght1.wav", "sound/chick/chksrch1.wav",
    "sound/misc/udeath.wav",
  ],
  monster_stalker: [
    "models/monsters/stalker/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "sound/misc/udeath.wav",
    "sound/stalker/death.wav", "sound/stalker/idle.wav", "sound/stalker/melee1.wav",
    "sound/stalker/melee2.wav", "sound/stalker/pain.wav", "sound/stalker/sight.wav",
  ],
  monster_kamikaze: [
    "models/monsters/flyer/tris.md2", "sound/flyer/flyatck1.wav", "sound/flyer/flyatck2.wav",
    "sound/flyer/flyatck3.wav", "sound/flyer/flydeth1.wav", "sound/flyer/flyidle1.wav",
    "sound/flyer/flypain1.wav", "sound/flyer/flypain2.wav", "sound/flyer/flysght1.wav",
    "sound/flyer/flysrch1.wav",
  ],
  monster_daedalus: [
    "models/monsters/hover/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "sound/daedalus/daeddeth1.wav",
    "sound/daedalus/daeddeth2.wav", "sound/daedalus/daedidle1.wav", "sound/daedalus/daedpain1.wav",
    "sound/daedalus/daedpain2.wav", "sound/daedalus/daedsght1.wav", "sound/daedalus/daedsrch1.wav",
    "sound/daedalus/daedsrch2.wav", "sound/hover/hovatck1.wav", "sound/hover/hovdeth1.wav",
    "sound/hover/hovdeth2.wav", "sound/hover/hovidle1.wav", "sound/hover/hovpain1.wav",
    "sound/hover/hovpain2.wav", "sound/hover/hovsght1.wav", "sound/hover/hovsrch1.wav",
    "sound/hover/hovsrch2.wav", "sound/tank/tnkatck3.wav",
  ],
  monster_turret: [
    "models/monsters/turret/tris.md2", "models/monsters/turretbase/tris.md2", "models/objects/debris1/tris.md2",
    "models/objects/laser/tris.md2", "models/objects/rocket/tris.md2", "sound/chick/chkatck2.wav",
    "sound/infantry/infatck1.wav", "sound/misc/lasfly.wav", "sound/soldier/solatck2.wav",
    "sound/weapons/rockfly.wav",
  ],
  monster_carrier: [
    "models/monsters/carrier/tris.md2", "models/monsters/flyer/tris.md2", "models/objects/debris2/tris.md2",
    "models/objects/gibs/gear/tris.md2", "models/objects/gibs/sm_metal/tris.md2", "models/objects/grenade/tris.md2",
    "models/objects/rocket/tris.md2", "sound/bosshovr/bhvengn1.wav", "sound/carrier/death.wav",
    "sound/carrier/pain_lg.wav", "sound/carrier/pain_md.wav", "sound/carrier/pain_sm.wav",
    "sound/carrier/sight.wav", "sound/flyer/flyatck1.wav", "sound/flyer/flyatck2.wav",
    "sound/flyer/flyatck3.wav", "sound/flyer/flydeth1.wav", "sound/flyer/flyidle1.wav",
    "sound/flyer/flypain1.wav", "sound/flyer/flypain2.wav", "sound/flyer/flysght1.wav",
    "sound/flyer/flysrch1.wav", "sound/gladiator/railgun.wav", "sound/gunner/gunatck3.wav",
    "sound/infantry/infatck1.wav", "sound/medic_commander/monsterspawn1.wav", "sound/tank/rocket.wav",
    "sound/weapons/grenlb1b.wav", "sound/weapons/rockfly.wav",
  ],
  monster_medic_commander: [
    "models/monsters/medic/tris.md2", "models/objects/gibs/bone/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/medic/idle.wav", "sound/medic/medatck1.wav", "sound/medic/medatck2.wav",
    "sound/medic/medatck3.wav", "sound/medic/medatck4.wav", "sound/medic/medatck5.wav",
    "sound/medic/meddeth1.wav", "sound/medic/medpain1.wav", "sound/medic/medpain2.wav",
    "sound/medic/medsght1.wav", "sound/medic/medsrch1.wav", "sound/medic_commander/medatck2c.wav",
    "sound/medic_commander/medatck3a.wav", "sound/medic_commander/medatck4a.wav", "sound/medic_commander/medatck5a.wav",
    "sound/medic_commander/meddeth.wav", "sound/medic_commander/medidle.wav", "sound/medic_commander/medpain1.wav",
    "sound/medic_commander/medpain2.wav", "sound/medic_commander/medsght.wav", "sound/medic_commander/medsrch.wav",
    "sound/medic_commander/monsterspawn1.wav", "sound/misc/udeath.wav", "sound/tank/tnkatck3.wav",
  ],
  monster_widow: [
    "models/monsters/blackwidow/gib1/tris.md2", "models/monsters/blackwidow/gib2/tris.md2", "models/monsters/blackwidow/gib3/tris.md2",
    "models/monsters/blackwidow/gib4/tris.md2", "models/monsters/blackwidow/tris.md2", "models/monsters/blackwidow2/gib1/tris.md2",
    "models/monsters/blackwidow2/gib2/tris.md2", "models/monsters/blackwidow2/gib3/tris.md2", "models/monsters/blackwidow2/gib4/tris.md2",
    "models/monsters/legs/tris.md2", "models/monsters/stalker/tris.md2", "models/objects/gibs/gear/tris.md2",
    "models/objects/gibs/sm_metal/tris.md2", "sound/gladiator/railgun.wav", "sound/misc/bigtele.wav",
    "sound/misc/bwidowbeamout.wav", "sound/stalker/death.wav", "sound/stalker/idle.wav",
    "sound/stalker/melee1.wav", "sound/stalker/melee2.wav", "sound/stalker/pain.wav",
    "sound/stalker/sight.wav", "sound/tank/tnkatck3.wav", "sound/widow/bw1pain1.wav",
    "sound/widow/bw1pain2.wav", "sound/widow/bw1pain3.wav", "sound/widow/bwstep2.wav",
    "sound/widow/bwstep3.wav", "sound/widow/laugh.wav",
  ],
  monster_widow2: [
    "models/monsters/blackwidow/gib1/tris.md2", "models/monsters/blackwidow/gib2/tris.md2", "models/monsters/blackwidow/gib3/tris.md2",
    "models/monsters/blackwidow/gib4/tris.md2", "models/monsters/blackwidow2/gib1/tris.md2", "models/monsters/blackwidow2/gib2/tris.md2",
    "models/monsters/blackwidow2/gib3/tris.md2", "models/monsters/blackwidow2/gib4/tris.md2", "models/monsters/blackwidow2/tris.md2",
    "models/monsters/stalker/tris.md2", "models/objects/gibs/bone/tris.md2", "models/objects/gibs/chest/tris.md2",
    "models/objects/gibs/head2/tris.md2", "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/sm_metal/tris.md2",
    "models/proj/disintegrator/tris.md2", "sound/bosshovr/bhvunqv1.wav", "sound/brain/brnatck3.wav",
    "sound/infantry/melee2.wav", "sound/misc/fhit3.wav", "sound/misc/udeath.wav",
    "sound/parasite/paratck1.wav", "sound/parasite/pardeth1.wav", "sound/parasite/parpain1.wav",
    "sound/parasite/parpain2.wav", "sound/parasite/parsght1.wav", "sound/tank/tnkatck3.wav",
    "sound/weapons/disint2.wav", "sound/weapons/disrupt.wav", "sound/widow/bw2pain1.wav",
    "sound/widow/bw2pain2.wav", "sound/widow/bw2pain3.wav", "sound/widow/death.wav",
  ],
};

const classicPrecaches: Readonly<Record<string, readonly string[]>> = {
  monster_medic: [
    "models/objects/gibs/head2/tris.md2",
  ],
  monster_supertank: [
    "models/objects/gibs/chest/tris.md2", "models/objects/gibs/gear/tris.md2",
  ],
  monster_fixbot: [
    "sound/misc/lasfly.wav",
  ],
  monster_gladb: [
    "models/monsters/gladb/tris.md2", "models/objects/gibs/head2/tris.md2",
  ],
  monster_boss5: [
    "models/monsters/boss5/tris.md2", "models/objects/gibs/chest/tris.md2", "models/objects/gibs/gear/tris.md2",
  ],
  monster_chick_heat: [
    "models/objects/gibs/head2/tris.md2",
  ],
  monster_stalker: [
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/head2/tris.md2", "models/proj/laser2/tris.md2",
  ],
  monster_daedalus: [
    "models/objects/gibs/bone/tris.md2", "sound/misc/udeath.wav",
  ],
  monster_turret: [
    "sound/world/dr_short.wav",
  ],
  monster_carrier: [
    "models/items/spawngro/tris.md2", "models/items/spawngro2/tris.md2",
  ],
  monster_medic_commander: [
    "models/items/spawngro/tris.md2", "models/items/spawngro2/tris.md2", "models/objects/gibs/head2/tris.md2",
  ],
  monster_widow: [
    "models/items/spawngro2/tris.md2", "models/proj/laser2/tris.md2", "sound/bosshovr/bhvunqv1.wav",
  ],
  monster_widow2: [
    "models/items/spawngro2/tris.md2", "models/proj/laser2/tris.md2",
  ],
};

const rereleasePrecaches: Readonly<Record<string, readonly string[]>> = {
  monster_medic: [
    "models/items/spawngro3/tris.md2", "models/monsters/medic/gibs/chest.md2", "models/monsters/medic/gibs/gun.md2",
    "models/monsters/medic/gibs/head.md2", "models/monsters/medic/gibs/hook.md2", "models/monsters/medic/gibs/leg.md2",
    "models/objects/gibs/sm_metal/tris.md2", "sound/medic_commander/medatck2c.wav", "sound/medic_commander/medatck3a.wav",
    "sound/medic_commander/medatck4a.wav", "sound/medic_commander/medatck5a.wav", "sound/medic_commander/meddeth.wav",
    "sound/medic_commander/medidle.wav", "sound/medic_commander/medpain1.wav", "sound/medic_commander/medpain2.wav",
    "sound/medic_commander/medsght.wav", "sound/medic_commander/medsrch.wav", "sound/medic_commander/monsterspawn1.wav",
    "sound/tank/tnkatck3.wav",
  ],
  monster_supertank: [
    "models/monsters/boss1/gibs/cgun.md2", "models/monsters/boss1/gibs/chest.md2", "models/monsters/boss1/gibs/core.md2",
    "models/monsters/boss1/gibs/head.md2", "models/monsters/boss1/gibs/ltread.md2", "models/monsters/boss1/gibs/rgun.md2",
    "models/monsters/boss1/gibs/rtread.md2", "models/monsters/boss1/gibs/tube.md2", "models/objects/rocket/tris.md2",
    "sound/gunner/gunatck3.wav", "sound/infantry/infatck1.wav", "sound/tank/rocket.wav",
    "sound/weapons/railgr1a.wav", "sound/weapons/rockfly.wav",
  ],
  monster_boss2: [
    "models/monsters/boss2/gibs/chaingun.md2", "models/monsters/boss2/gibs/chest.md2", "models/monsters/boss2/gibs/cpu.md2",
    "models/monsters/boss2/gibs/engine.md2", "models/monsters/boss2/gibs/head.md2", "models/monsters/boss2/gibs/larm.md2",
    "models/monsters/boss2/gibs/rarm.md2", "models/monsters/boss2/gibs/rocket.md2", "models/monsters/boss2/gibs/spine.md2",
    "models/monsters/boss2/gibs/wing.md2", "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/sm_metal/tris.md2",
    "sound/flyer/flyatck3.wav", "sound/infantry/infatck1.wav", "sound/tank/rocket.wav",
  ],
  monster_jorg: [
    "models/monsters/boss3/jorg/gibs/chest.md2", "models/monsters/boss3/jorg/gibs/foot.md2", "models/monsters/boss3/jorg/gibs/gun.md2",
    "models/monsters/boss3/jorg/gibs/head.md2", "models/monsters/boss3/jorg/gibs/spike.md2", "models/monsters/boss3/jorg/gibs/spine.md2",
    "models/monsters/boss3/jorg/gibs/thigh.md2", "models/monsters/boss3/jorg/gibs/tube.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/gibs/sm_metal/tris.md2", "sound/boss3/bs3atck1_end.wav", "sound/boss3/bs3atck1_loop.wav",
    "sound/makron/bfg_fire.wav",
  ],
  monster_gekk: [
    "sound/gek/gk_atck4.wav", "sound/gek/loogie_hit.wav",
  ],
  monster_gladb: [
    "models/monsters/gladiatr/gibs/chest.md2", "models/monsters/gladiatr/gibs/head.md2", "models/monsters/gladiatr/gibs/larm.md2",
    "models/monsters/gladiatr/gibs/rarm.md2", "models/monsters/gladiatr/gibs/thigh.md2", "models/monsters/gladiatr/tris.md2",
    "sound/gladiator/death.wav", "sound/gladiator/railgun.wav", "sound/weapons/phaloop.wav",
    "sound/weapons/rg_hum.wav",
  ],
  monster_boss5: [
    "models/monsters/boss1/gibs/cgun.md2", "models/monsters/boss1/gibs/chest.md2", "models/monsters/boss1/gibs/core.md2",
    "models/monsters/boss1/gibs/head.md2", "models/monsters/boss1/gibs/ltread.md2", "models/monsters/boss1/gibs/rgun.md2",
    "models/monsters/boss1/gibs/rtread.md2", "models/monsters/boss1/gibs/tube.md2", "models/monsters/boss1/tris.md2",
    "models/objects/rocket/tris.md2", "sound/gunner/gunatck3.wav", "sound/infantry/infatck1.wav",
    "sound/tank/rocket.wav", "sound/weapons/railgr1a.wav", "sound/weapons/rockfly.wav",
  ],
  monster_chick_heat: [
    "models/monsters/bitch/gibs/arm.md2", "models/monsters/bitch/gibs/chest.md2", "models/monsters/bitch/gibs/foot.md2",
    "models/monsters/bitch/gibs/head.md2", "models/monsters/bitch/gibs/tube.md2", "sound/weapons/railgr1a.wav",
  ],
  monster_soldier_ripper: [
    "models/monsters/soldier/gibs/arm.md2", "models/monsters/soldier/gibs/chest.md2", "models/monsters/soldier/gibs/gun.md2",
    "models/monsters/soldier/gibs/head.md2", "models/monsters/soldier/tris.md2", "models/objects/boomrang/tris.md2",
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/bone2/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/laser/tris.md2", "sound/infantry/infatck3.wav", "sound/misc/lasfly.wav",
    "sound/misc/udeath.wav", "sound/soldier/solatck1.wav", "sound/soldier/solatck2.wav",
    "sound/soldier/solatck3.wav", "sound/soldier/soldeth1.wav", "sound/soldier/soldeth2.wav",
    "sound/soldier/soldeth3.wav", "sound/soldier/solidle1.wav", "sound/soldier/solpain1.wav",
    "sound/soldier/solpain2.wav", "sound/soldier/solpain3.wav", "sound/soldier/solsght1.wav",
    "sound/soldier/solsrch1.wav", "sound/weapons/hyprbd1a.wav", "sound/weapons/hyprbl1a.wav",
  ],
  monster_soldier_hypergun: [
    "models/monsters/soldier/gibs/arm.md2", "models/monsters/soldier/gibs/chest.md2", "models/monsters/soldier/gibs/gun.md2",
    "models/monsters/soldier/gibs/head.md2", "models/monsters/soldier/tris.md2", "models/objects/boomrang/tris.md2",
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/bone2/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/laser/tris.md2", "sound/infantry/infatck3.wav", "sound/misc/lasfly.wav",
    "sound/misc/udeath.wav", "sound/soldier/solatck1.wav", "sound/soldier/solatck2.wav",
    "sound/soldier/solatck3.wav", "sound/soldier/soldeth1.wav", "sound/soldier/soldeth2.wav",
    "sound/soldier/soldeth3.wav", "sound/soldier/solidle1.wav", "sound/soldier/solpain1.wav",
    "sound/soldier/solpain2.wav", "sound/soldier/solpain3.wav", "sound/soldier/solsght1.wav",
    "sound/soldier/solsrch1.wav", "sound/weapons/hyprbd1a.wav", "sound/weapons/hyprbl1a.wav",
  ],
  monster_soldier_lasergun: [
    "models/monsters/soldier/gibs/arm.md2", "models/monsters/soldier/gibs/chest.md2", "models/monsters/soldier/gibs/gun.md2",
    "models/monsters/soldier/gibs/head.md2", "models/monsters/soldier/tris.md2", "models/objects/boomrang/tris.md2",
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/bone2/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/laser/tris.md2", "sound/infantry/infatck3.wav", "sound/misc/lasfly.wav",
    "sound/misc/udeath.wav", "sound/soldier/solatck1.wav", "sound/soldier/solatck2.wav",
    "sound/soldier/solatck3.wav", "sound/soldier/soldeth1.wav", "sound/soldier/soldeth2.wav",
    "sound/soldier/soldeth3.wav", "sound/soldier/solidle1.wav", "sound/soldier/solpain1.wav",
    "sound/soldier/solpain2.wav", "sound/soldier/solpain3.wav", "sound/soldier/solsght1.wav",
    "sound/soldier/solsrch1.wav", "sound/weapons/hyprbd1a.wav", "sound/weapons/hyprbl1a.wav",
  ],
  monster_stalker: [
    "models/monsters/stalker/gibs/bodya.md2", "models/monsters/stalker/gibs/bodyb.md2", "models/monsters/stalker/gibs/claw.md2",
    "models/monsters/stalker/gibs/foot.md2", "models/monsters/stalker/gibs/head.md2", "models/monsters/stalker/gibs/leg.md2",
    "models/objects/gibs/sm_metal/tris.md2", "models/objects/laser/tris.md2",
  ],
  monster_kamikaze: [
    "models/monsters/flyer/gibs/base.md2", "models/monsters/flyer/gibs/gun.md2", "models/monsters/flyer/gibs/head.md2",
    "models/monsters/flyer/gibs/wing.md2", "models/objects/gibs/sm_meat/tris.md2", "models/objects/gibs/sm_metal/tris.md2",
  ],
  monster_daedalus: [
    "models/monsters/hover/gibs/chest.md2", "models/monsters/hover/gibs/foot.md2", "models/monsters/hover/gibs/head.md2",
    "models/monsters/hover/gibs/ring.md2", "models/objects/gibs/sm_metal/tris.md2",
  ],
  monster_turret: [
    "sound/turret/moved.wav", "sound/turret/moving.wav", "sound/weapons/chngnu1a.wav",
  ],
  monster_carrier: [
    "models/items/spawngro3/tris.md2", "models/monsters/carrier/gibs/base.md2", "models/monsters/carrier/gibs/chest.md2",
    "models/monsters/carrier/gibs/gl.md2", "models/monsters/carrier/gibs/head.md2", "models/monsters/carrier/gibs/lcg.md2",
    "models/monsters/carrier/gibs/lwing.md2", "models/monsters/carrier/gibs/rcg.md2", "models/monsters/carrier/gibs/rwing.md2",
    "models/monsters/carrier/gibs/spawner.md2", "models/monsters/carrier/gibs/thigh.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/weapons/chngnd1a.wav", "sound/weapons/chngnl1a.wav", "sound/weapons/chngnu1a.wav",
  ],
  monster_medic_commander: [
    "models/items/spawngro3/tris.md2", "models/monsters/medic/gibs/chest.md2", "models/monsters/medic/gibs/gun.md2",
    "models/monsters/medic/gibs/head.md2", "models/monsters/medic/gibs/hook.md2", "models/monsters/medic/gibs/leg.md2",
    "models/objects/gibs/sm_metal/tris.md2",
  ],
  monster_widow: [
    "models/items/spawngro3/tris.md2", "models/objects/laser/tris.md2", "sound/widow/bwstep1.wav",
  ],
  monster_widow2: [
    "models/items/spawngro3/tris.md2", "models/objects/laser/tris.md2", "sound/widow/bwstep1.wav",
  ],
  monster_arachnid: [
    "models/monsters/arachnid/tris.md2", "models/objects/gibs/bone/tris.md2", "models/objects/gibs/head2/tris.md2",
    "models/objects/gibs/sm_meat/tris.md2", "sound/arachnid/death.wav", "sound/arachnid/pain.wav",
    "sound/arachnid/sight.wav", "sound/gladiator/melee2.wav", "sound/gladiator/melee3.wav",
    "sound/gladiator/railgun.wav", "sound/insane/insane11.wav", "sound/misc/udeath.wav",
  ],
  monster_guardian: [
    "models/monsters/guardian/gib1.md2", "models/monsters/guardian/gib2.md2", "models/monsters/guardian/gib3.md2",
    "models/monsters/guardian/gib4.md2", "models/monsters/guardian/gib5.md2", "models/monsters/guardian/gib6.md2",
    "models/monsters/guardian/gib7.md2", "models/monsters/guardian/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "models/objects/gibs/sm_metal/tris.md2", "sound/weapons/hyprbl1a.wav", "sound/weapons/hyprbu1a.wav",
    "sound/weapons/laser2.wav", "sound/zortemp/step.wav",
  ],
  monster_shambler: [
    "models/monsters/shambler/tris.md2", "models/objects/gibs/chest/tris.md2", "models/objects/gibs/head2/tris.md2",
    "models/objects/gibs/sm_meat/tris.md2", "models/proj/lightning/tris.md2", "sound/misc/udeath.wav",
    "sound/shambler/melee1.wav", "sound/shambler/melee2.wav", "sound/shambler/sattck1.wav",
    "sound/shambler/sboom.wav", "sound/shambler/sdeath.wav", "sound/shambler/shurt2.wav",
    "sound/shambler/sidle.wav", "sound/shambler/smack.wav", "sound/shambler/ssight.wav",
  ],
  monster_guncmdr: [
    "models/monsters/gunner/gibs/chest.md2", "models/monsters/gunner/gibs/foot.md2", "models/monsters/gunner/gibs/garm.md2",
    "models/monsters/gunner/gibs/gun.md2", "models/monsters/gunner/gibs/head.md2", "models/monsters/gunner/tris.md2",
    "models/objects/gibs/bone/tris.md2", "models/objects/gibs/gear/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/guncmdr/gcdratck1.wav", "sound/guncmdr/gcdratck2.wav", "sound/guncmdr/gcdratck3.wav",
    "sound/guncmdr/gcdrdeath1.wav", "sound/guncmdr/gcdridle1.wav", "sound/guncmdr/gcdrpain1.wav",
    "sound/guncmdr/gcdrpain2.wav", "sound/guncmdr/gcdrsrch1.wav", "sound/guncmdr/sight1.wav",
    "sound/misc/udeath.wav",
  ],
};

const sharedCallbacks = ['sound/misc/udeath.wav', 'sound/infantry/inflies1.wav', 'sound/misc/fhit3.wav',
  'sound/player/watr_in.wav', 'sound/player/watr_out.wav', 'sound/player/lava1.wav', 'sound/player/lava2.wav',
  'models/objects/gibs/bone/tris.md2', 'models/objects/gibs/sm_meat/tris.md2', 'models/objects/gibs/head2/tris.md2'];
function precached(creatures: MonsterSourceDefinition['creatures'], edition: 'classic' | 'rerelease'): MonsterSourceDefinition['creatures'] {
  const result: Record<string, { readonly resources: readonly string[] }> = Object.fromEntries(Object.entries(creatures).map(([classname, creature]): readonly [string, { readonly resources: readonly string[] }] => {
    const resources = new Set([...creature.resources, ...sharedCallbacks, ...sharedPrecaches[classname] ?? [],
      ...(edition === 'classic' ? classicPrecaches : rereleasePrecaches)[classname] ?? []]);
    if (edition === 'rerelease' && (classname === 'monster_medic' || classname === 'monster_medic_commander'))
      for (let step = 1; step <= 4; step++) resources.add(`sound/player/step${step}.wav`);
    if (classname === 'monster_turret') resources.add('sound/world/dr_short.wav');
    if (classname === 'monster_makron') resources.add('sprites/s_bfg1.sp2');
    if (resources.has('models/objects/laser/tris.md2')) resources.add('sound/misc/lasfly.wav');
    if (resources.has('models/objects/rocket/tris.md2')) {
      resources.add('sound/weapons/rockfly.wav'); resources.add('models/objects/debris2/tris.md2');
    }
    if (resources.has('models/objects/grenade/tris.md2')) resources.add('sound/weapons/grenlb1b.wav');
    if (resources.has('sprites/s_bfg1.sp2')) for (const path of ['sprites/s_bfg3.sp2', 'sound/weapons/bfg__l1a.wav', 'sound/weapons/bfg__x1b.wav']) resources.add(path);
    return [classname, { resources: [...resources] }];
  }));
  const available = { ...ordinary(edition), ...result };
  for (const [classname, dependencies] of Object.entries({
    monster_jorg: ['monster_makron'], monster_carrier: ['monster_flyer'],
    monster_widow: ['monster_stalker'], monster_widow2: ['monster_stalker'],
    monster_medic_commander: ['monster_soldier_light', 'monster_soldier', 'monster_soldier_ss', 'monster_infantry', 'monster_gunner', 'monster_medic', 'monster_gladiator'],
  })) {
    const creature = result[classname];
    if (creature === undefined) continue;
    result[classname] = { resources: [...new Set([...creature.resources, ...dependencies.flatMap(name => available[name]?.resources ?? [])])] };
  }
  return result;
}

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
export const q2ExpandedClassicCreatures: MonsterSourceDefinition["creatures"] = precached(baseAdditional, "classic");
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
/** Edition-specific source models and precaches resolve through the selected content mount. */
const { monster_soldier_ripper, monster_soldier_hypergun, monster_soldier_lasergun, ...rereleaseXatrix } = xatrix;
export const q2ExpandedBaseCreatures: MonsterSourceDefinition["creatures"] = precached({ ...baseAdditional, ...rereleaseXatrix, ...rogue, ...rerelease,
  monster_gladb: model("models/monsters/gladiatr/tris.md2", "sprites/s_photon.sp2"),
  monster_boss5: model("models/monsters/boss1/tris.md2", rocket),
}, "rerelease");
function ordinary(edition: "classic" | "rerelease"): MonsterSourceDefinition["creatures"] {
  const source = q2MonsterSources.find(source => source.edition === edition);
  if (source === undefined) throw new Error(`Missing Q2 ${edition} base monster definitions`);
  return source.creatures;
}
export const q2ExpansionSources: readonly MonsterSourceDefinition[] = [
  { provider: "q2:monsters/classic/xatrix", family: "q2", edition: "classic", program: "xatrix", creatures: precached({ ...ordinary("classic"), ...baseAdditional, ...xatrix }, "classic") },
  { provider: "q2:monsters/classic/rogue", family: "q2", edition: "classic", program: "rogue", creatures: precached({ ...ordinary("classic"), ...baseAdditional, ...rogue }, "classic") },
  { provider: "q2:monsters/rerelease/xatrix", family: "q2", edition: "rerelease", program: "xatrix", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
  { provider: "q2:monsters/rerelease/rogue", family: "q2", edition: "rerelease", program: "rogue", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
  { provider: "q2:monsters/rerelease/mg2", family: "q2", edition: "rerelease", program: "mg2", creatures: { ...ordinary("rerelease"), ...q2ExpandedBaseCreatures } },
];
