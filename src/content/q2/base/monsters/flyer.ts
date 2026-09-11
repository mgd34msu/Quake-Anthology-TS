/* Quake II m_flyer.c. id Software, GPL-2.0-or-later. */
import type { Q2GameServices } from "../../foundation/host.ts";
import { targetDistance } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { damagedSkin, explode, humanoidBounds, loopSound, move, muzzle, shot, sound } from "./common.ts";
import { flyerFrame, flyerMoves } from "./tables/flyer.ts";

const nextMoves = new WeakMap<Q2GameServices, "melee" | "attack" | "run">();
function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "flyer_move_stand" : "flyer_move_run"); }
function fire(context: MonsterContext, flash: number): undefined {
  const aim = shot(context, flash); if (aim === null) return undefined;
  const effect = context.entity.frame === flyerFrame.attak204 || context.entity.frame === flyerFrame.attak207 || context.entity.frame === flyerFrame.attak210 ? 64 : 0;
  context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, effect);
  return muzzle(context, flash, aim.direction, aim.start);
}
function slash(context: MonsterContext, right: boolean): undefined {
  const bounds = context.game.body(context.entity).bounds;
  context.weapons.fireHit(context.entity, context.game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 0 }, 5, 0);
  return context.game.sound(context.entity, "flyer/flyatck2.wav", 1);
}
export const flyerDefinition: Q2MonsterDefinition = {
  classname: "monster_flyer", kind: "flyer", model: "models/monsters/flyer/tris.md2", health: 50, gibHealth: 0, mass: 50, bounds: humanoidBounds, scale: 1, locomotion: "fly",
  initialMove: "flyer_move_stand", moves: flyerMoves, stand: move("flyer_move_stand"), walk: move("flyer_move_walk"), run,
  attack: move("flyer_move_attack2"), melee: move("flyer_move_start_melee"), sight: sound("flyer/flysght1.wav"), idle: sound("flyer/flysrch1.wav", 2, 2),
  initialize(context) {
    if (context.game.options.mapName.toLowerCase() === "jail5" && context.game.body(context.entity).origin.z === -104) { context.entity.targetname = context.entity.target; context.entity.target = ""; }
    return loopSound(context, "flyer/flyidle1.wav");
  },
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    const n = Math.floor(context.game.host.random() * 3);
    context.game.sound(context.entity, n === 1 ? "flyer/flypain2.wav" : "flyer/flypain1.wav", 2);
    return context.setMove(n === 0 ? "flyer_move_pain1" : n === 1 ? "flyer_move_pain2" : "flyer_move_pain3");
  },
  die(context) { return explode(context, "flyer/flydeth1.wav"); },
  callbacks: {
    flyer_run: run, flyer_pop_blades: sound("flyer/flyatck1.wav", 2), flyer_loop_melee: move("flyer_move_loop_melee"),
    flyer_fireleft(context) { return fire(context, 58); }, flyer_fireright(context) { return fire(context, 59); },
    flyer_slash_left(context) { return slash(context, false); }, flyer_slash_right(context) { return slash(context, true); },
    flyer_check_melee(context) { return context.setMove(targetDistance(context) < 80 && context.game.host.random() <= 0.8 ? "flyer_move_loop_melee" : "flyer_move_end_melee"); },
    flyer_setstart(context) { nextMoves.set(context.game, "run"); return context.setMove("flyer_move_start"); },
    flyer_nextmove(context) {
      const next = nextMoves.get(context.game);
      if (next === undefined) return undefined;
      return context.setMove(next === "melee" ? "flyer_move_start_melee" : next === "attack" ? "flyer_move_attack2" : "flyer_move_run");
    },
  },
};
