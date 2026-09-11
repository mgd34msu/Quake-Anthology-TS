// Rerelease m_insane.cpp. ZeniMax Media, GPL-2.0.
import { insaneDefinition } from "../../../base/monsters/insane.ts";
import { corpse, health } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { recordAt } from "../../../foundation/monsters/types.ts";
import { checkGib } from "../common.ts";
import { insaneFrame, insaneMoves } from "../tables/insane.ts";

function crawling(frame: number): boolean { return frame >= insaneFrame.crawl1 && frame <= insaneFrame.crawl9 || frame >= insaneFrame.stand99 && frame <= insaneFrame.stand160; }
function run(context: MonsterContext): undefined {
  const { entity } = context;
  if ((entity.spawnflags & 16) !== 0 && entity.frame === insaneFrame.cr_pain10) return context.setMove("insane_move_down");
  return context.setMove((entity.spawnflags & 4) !== 0 || crawling(entity.frame) || entity.frame >= insaneFrame.cr_pain2 && entity.frame <= insaneFrame.cr_pain10
    ? "insane_move_runcrawl" : context.game.host.random() <= 0.5 ? "insane_move_run_normal" : "insane_move_run_insane");
}
function dead(context: MonsterContext): undefined {
  if ((context.entity.spawnflags & 8) === 0) return corpse(context);
  context.entity.flags |= 1; context.entity.serverFlags |= 2; context.state.corpse = true;
  context.game.link(context.entity); return context.schedule(0.1, "monster_dead_think");
}
function vocalize(context: MonsterContext, scream: boolean): undefined {
  const { entity, game, state } = context;
  if ((entity.spawnflags & 64) !== 0 || state.attackFinished >= game.host.now()) return undefined;
  const sample = scream ? recordAt([1, 2, 3, 4, 6, 8, 9, 10], Math.floor(game.host.random() * 8)) : 7;
  game.sound(entity, `insane/insane${sample}.wav`, 2, 1, 2); state.attackFinished = game.host.now() + 1 + game.host.random() * 2; return undefined;
}
export const rereleaseInsaneDefinition: Q2MonsterDefinition = {
  ...insaneDefinition, moves: insaneMoves, run,
  initialize(context) {
    context.state.goodGuy = true;
    if ((context.entity.spawnflags & 16) !== 0) context.state.standGround = true;
    if ((context.entity.spawnflags & 8) !== 0) { context.state.locomotion = "stationary"; context.entity.flags |= 2048 | 262144; }
    return undefined;
  },
  afterSpawn(context) { context.entity.skin = Math.floor(context.game.host.random() * 3); return undefined; },
  pain(context) {
    const { game, entity, state } = context;
    if (game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 3;
    const variant = 1 + Math.floor(game.host.random() * 2), hp = health(game, entity.actor.id), band = hp < 25 ? 25 : hp < 50 ? 50 : hp < 75 ? 75 : 100;
    game.sound(entity, `player/male/pain${band}_${variant}.wav`, 2, 1, 2);
    return context.setMove((entity.spawnflags & 8) !== 0 ? "insane_move_struggle_cross" : crawling(entity.frame) || entity.frame >= insaneFrame.stand1 && entity.frame <= insaneFrame.stand40 ? "insane_move_crawl_pain" : "insane_move_stand_pain");
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2, 1, 2);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage, { head: true });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, `player/male/death${1 + Math.floor(game.host.random() * 4)}.wav`, 2, 1, 2);
    state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    return (entity.spawnflags & 8) !== 0 ? dead(context) : context.setMove(crawling(entity.frame) ? "insane_move_crawl_death" : "insane_move_stand_death");
  },
  callbacks: {
    ...insaneDefinition.callbacks, insane_run: run, insane_dead: dead,
    insane_shake(context) { return (context.entity.spawnflags & 64) !== 0 ? undefined : context.game.sound(context.entity, "insane/insane5.wav", 2, 1, 2); },
    insane_moan: context => vocalize(context, false), insane_scream: context => vocalize(context, true),
  },
};
