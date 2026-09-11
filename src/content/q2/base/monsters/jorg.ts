/* Quake II m_boss31.c. id Software, GPL-2.0-or-later. */
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { visible } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { bossCheckAttack, bossExplode, stopLoop } from "./boss-common.ts";
import { damagedSkin, loopSound, move, muzzle, shot, sound } from "./common.ts";
import { makronToss } from "./makron.ts";
import { boss31Frame, boss31Moves } from "./tables/boss31.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "jorg_move_stand" : "jorg_move_run"); }
export function createJorgDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  return {
    classname: "monster_jorg", kind: "jorg", model: "models/monsters/boss3/rider/tris.md2", health: 3000, gibHealth: -2000, mass: 1000,
    bounds: { min: { x: -80, y: -80, z: 0 }, max: { x: 80, y: 80, z: 140 } }, scale: 1,
    initialMove: "jorg_move_stand", moves: boss31Moves, stand: move("jorg_move_stand"), walk: move("jorg_move_walk"), run,
    initialize(context) { context.entity.model2 = "models/monsters/boss3/jorg/tris.md2"; return undefined; },
    checkAttack(context) { return bossCheckAttack(context); },
    search(context) { const r = context.game.host.random(); return context.game.sound(context.entity, r <= 0.3 ? "boss3/bs3srch1.wav" : r <= 0.6 ? "boss3/bs3srch2.wav" : "boss3/bs3srch3.wav", 2); },
    attack(context) {
      if (context.game.host.random() <= 0.75) { context.game.sound(context.entity, "boss3/bs3atck1.wav", 2); loopSound(context, "boss3/w_loop.wav"); return context.setMove("jorg_move_start_attack1"); }
      context.game.sound(context.entity, "boss3/bs3atck2.wav", 2);
      return context.setMove("jorg_move_attack2");
    },
    pain(context, reaction) {
      damagedSkin(context); stopLoop(context);
      if (context.game.host.now() < context.state.painTime || reaction.damage <= 40 && context.game.host.random() <= 0.6) return undefined;
      const frame = context.entity.frame;
      if (frame >= boss31Frame.attak101 && frame <= boss31Frame.attak108 && context.game.host.random() <= 0.005) return undefined;
      if (frame >= boss31Frame.attak109 && frame <= boss31Frame.attak114 && context.game.host.random() <= 0.00005) return undefined;
      if (frame >= boss31Frame.attak201 && frame <= boss31Frame.attak208 && context.game.host.random() <= 0.005) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      if (context.game.options.skill === 3) return undefined;
      if (reaction.damage > 100 && context.game.host.random() > 0.3) return undefined;
      context.game.sound(context.entity, reaction.damage <= 50 ? "boss3/bs3pain1.wav" : reaction.damage <= 100 ? "boss3/bs3pain2.wav" : "boss3/bs3pain3.wav", 2);
      return context.setMove(reaction.damage <= 50 ? "jorg_move_pain1" : reaction.damage <= 100 ? "jorg_move_pain2" : "jorg_move_pain3");
    },
    die(context) {
      context.game.sound(context.entity, "boss3/bs3deth1.wav", 2); stopLoop(context);
      context.state.dead = true; context.state.canTakeDamage = false; context.entity.count = 0;
      context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false });
      return context.setMove("jorg_move_death");
    },
    callbacks: {
      jorg_run: run, jorg_attack1: move("jorg_move_attack1"), BossExplode: bossExplode,
      jorg_idle: sound("boss3/bs3idle1.wav"), jorg_step_left: sound("boss3/step1.wav", 4), jorg_step_right: sound("boss3/step2.wav", 4), jorg_death_hit: sound("boss3/d_hit.wav", 4),
      // The original jorg_dead body is excluded by #if 0.
      jorg_dead() { return undefined; },
      MakronToss(context) { return makronToss(context, monsters); },
      jorg_reattack1(context) {
        if (visible(context) && context.game.host.random() < 0.9) return context.setMove("jorg_move_attack1");
        stopLoop(context); return context.setMove("jorg_move_end_attack1");
      },
      jorgBFG(context) {
        const aim = shot(context, 132); if (aim === null) return undefined;
        context.game.sound(context.entity, "boss3/bs3atck2.wav", 2);
        context.weapons.fireBfg(context.entity, context.game, aim.start, aim.direction, 50, 300, 200);
        return muzzle(context, 132, aim.direction, aim.start);
      },
      jorg_firebullet(context) {
        for (const flash of [120, 126]) {
          const aim = shot(context, flash, -0.2); if (aim === null) return undefined;
          context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 6, 4, 300, 500, 0);
          muzzle(context, flash, aim.direction, aim.start);
        }
        return undefined;
      },
    },
  };
}
