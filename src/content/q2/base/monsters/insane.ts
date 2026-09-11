/* Quake II m_insane.c. id Software, GPL-2.0-or-later. */
import { health } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { finishCorpse, humanoidBounds, move, sound, standardGib } from "./common.ts";
import { insaneFrame, insaneMoves } from "./tables/insane.ts";

function stand(context: MonsterContext): undefined {
  if ((context.entity.spawnflags & 8) !== 0) { context.state.standGround = true; return context.setMove("insane_move_cross"); }
  if ((context.entity.spawnflags & 20) === 20) return context.setMove("insane_move_down");
  return context.setMove(context.game.host.random() < 0.5 ? "insane_move_stand_normal" : "insane_move_stand_insane");
}
function walking(context: MonsterContext, running: boolean): undefined {
  if ((context.entity.spawnflags & 16) !== 0 && context.entity.frame === insaneFrame.cr_pain10) return context.setMove("insane_move_down");
  if ((context.entity.spawnflags & 4) !== 0) return context.setMove(running ? "insane_move_runcrawl" : "insane_move_crawl");
  const normal = context.game.host.random() <= 0.5;
  return context.setMove(running ? normal ? "insane_move_run_normal" : "insane_move_run_insane" : normal ? "insane_move_walk_normal" : "insane_move_walk_insane");
}
function dead(context: MonsterContext): undefined {
  if ((context.entity.spawnflags & 8) === 0) return finishCorpse(context);
  context.entity.flags |= 1; context.entity.serverFlags |= 2; context.state.corpse = true;
  context.game.link(context.entity);
  return context.game.cancel(context.entity);
}
function crawling(context: MonsterContext): boolean {
  const frame = context.entity.frame;
  return frame >= insaneFrame.crawl1 && frame <= insaneFrame.crawl9 || frame >= insaneFrame.stand99 && frame <= insaneFrame.stand160;
}
export const insaneDefinition: Q2MonsterDefinition = {
  classname: "misc_insane", kind: "insane", model: "models/monsters/insane/tris.md2", health: 100, gibHealth: -50, mass: 300, bounds: humanoidBounds, scale: 1,
  initialMove: "insane_move_stand_normal", moves: insaneMoves, stand, walk(context) { return walking(context, false); }, run(context) { return walking(context, true); }, attack: stand, hasRangedAttack: false,
  initialize(context) {
    context.state.goodGuy = true;
    if ((context.entity.spawnflags & 16) !== 0) context.state.standGround = true;
    if ((context.entity.spawnflags & 8) !== 0) {
      context.state.locomotion = "fly"; context.entity.flags |= 1 | 2048;
      context.game.move(context.entity, { bounds: { min: { x: -16, y: 0, z: 0 }, max: { x: 16, y: 8, z: 32 } } }, false);
    }
    return undefined;
  },
  afterSpawn(context) { if ((context.entity.spawnflags & 8) === 0) context.entity.skin = Math.floor(context.game.host.random() * 3); return undefined; },
  pain(context) {
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    const variant = 1 + Math.floor(context.game.host.random() * 2), hp = health(context.game, context.entity.actor.id), band = hp < 25 ? 25 : hp < 50 ? 50 : hp < 75 ? 75 : 100;
    context.game.sound(context.entity, `player/male/pain${band}_${variant}.wav`, 2, 1, 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove((context.entity.spawnflags & 8) !== 0 ? "insane_move_struggle_cross" : crawling(context) ? "insane_move_crawl_pain" : "insane_move_stand_pain");
  },
  die(context, reaction) {
    if (standardGib(context, reaction, 2, 4, "models/objects/gibs/head2/tris.md2", 2) || context.state.dead) return undefined;
    context.game.sound(context.entity, `player/male/death${1 + Math.floor(context.game.host.random() * 4)}.wav`, 2, 1, 2);
    context.state.dead = true; context.state.canTakeDamage = true; context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true });
    return (context.entity.spawnflags & 8) !== 0 ? dead(context) : context.setMove(crawling(context) ? "insane_move_crawl_death" : "insane_move_stand_death");
  },
  callbacks: {
    insane_stand: stand, insane_walk(context) { return walking(context, false); }, insane_run(context) { return walking(context, true); }, insane_dead: dead,
    insane_onground: move("insane_move_down"), insane_fist: sound("insane/insane11.wav", 2, 2), insane_shake: sound("insane/insane5.wav", 2, 2), insane_moan: sound("insane/insane7.wav", 2, 2),
    insane_scream(context) { const variant = recordAt([1, 2, 3, 4, 6, 8, 9, 10], Math.floor(context.game.host.random() * 8)); return context.game.sound(context.entity, `insane/insane${variant}.wav`, 2, 1, 2); },
    insane_cross(context) { return context.setMove(context.game.host.random() < 0.8 ? "insane_move_cross" : "insane_move_struggle_cross"); },
    insane_checkdown(context) {
      if ((context.entity.spawnflags & 32) !== 0 || context.game.host.random() >= 0.3) return undefined;
      return context.setMove(context.game.host.random() < 0.5 ? "insane_move_uptodown" : "insane_move_jumpdown");
    },
    insane_checkup(context) { if ((context.entity.spawnflags & 20) !== 20 && context.game.host.random() < 0.5) context.setMove("insane_move_downtoup"); return undefined; },
  },
};
