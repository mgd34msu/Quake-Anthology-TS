/* Quake II m_gunner.c. id Software, GPL-2.0-or-later. */
import { setDuck, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, beginDeath, damagedSkin, finishCorpse, forwardShot, humanoidBounds, move, muzzle, shot, sound } from "./common.ts";
import { gunnerFrame, gunnerMoves } from "./tables/gunner.ts";

const stand = move("gunner_move_stand");
function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "gunner_move_stand" : "gunner_move_run"); }
function grenade(context: MonsterContext): undefined {
  const frame = context.entity.frame;
  const flash = frame === gunnerFrame.attak105 ? 53 : frame === gunnerFrame.attak108 ? 54 : frame === gunnerFrame.attak111 ? 55 : 56;
  const { start, direction } = forwardShot(context, flash);
  context.weapons.fireGrenade(context.entity, context.game, start, direction, 50, 600, 2.5, 90, false, false, true);
  return muzzle(context, flash, direction, start);
}
export const gunnerDefinition: Q2MonsterDefinition = {
  classname: "monster_gunner", kind: "gunner", model: "models/monsters/gunner/tris.md2", health: 175, gibHealth: -70, mass: 200, bounds: humanoidBounds, scale: 1,
  initialMove: "gunner_move_stand", moves: gunnerMoves, stand, walk: move("gunner_move_walk"), run,
  attack(context) { return context.setMove(targetDistance(context) < 80 ? "gunner_move_attack_chain" : context.game.host.random() <= 0.5 ? "gunner_move_attack_grenade" : "gunner_move_attack_chain"); },
  sight: sound("gunner/sight1.wav"), search: sound("gunner/gunsrch1.wav"),
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, context.game.host.random() < 0.5 ? "gunner/gunpain2.wav" : "gunner/gunpain1.wav", 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove(reaction.damage <= 10 ? "gunner_move_pain3" : reaction.damage <= 25 ? "gunner_move_pain2" : "gunner_move_pain1");
  },
  die(context, reaction) { return beginDeath(context, reaction, "gunner/death1.wav", "gunner_move_death"); },
  dodge(context, attacker) {
    if (context.game.host.random() > 0.25) return undefined;
    context.entity.enemy ??= attacker;
    return context.setMove("gunner_move_duck");
  },
  callbacks: {
    gunner_stand: stand, gunner_run: run, gunner_dead: finishCorpse,
    gunner_idlesound: sound("gunner/gunidle1.wav", 2, 2), gunner_opengun: sound("gunner/gunatck1.wav", 2, 2),
    gunner_fidget(context) { if (!context.state.standGround && context.game.host.random() <= 0.05) context.setMove("gunner_move_fidget"); return undefined; },
    gunner_duck_down(context) {
      if (context.state.ducked) return undefined;
      if (context.game.options.skill >= 2 && context.game.host.random() > 0.5) grenade(context);
      setDuck(context, true);
      context.state.pauseTime = context.game.host.now() + 1;
      return undefined;
    },
    gunner_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
    gunner_duck_up(context) { return setDuck(context, false); },
    GunnerGrenade: grenade,
    GunnerFire(context) {
      const flash = 45 + context.entity.frame - gunnerFrame.attak216;
      const aim = shot(context, flash, -0.2);
      if (aim === null) return undefined;
      context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 3, 4, 300, 500, 0);
      return muzzle(context, flash, aim.direction, aim.start);
    },
    gunner_fire_chain: move("gunner_move_fire_chain"),
    gunner_refire_chain(context) { return context.setMove(aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.5 ? "gunner_move_fire_chain" : "gunner_move_endfire_chain"); },
  },
};
