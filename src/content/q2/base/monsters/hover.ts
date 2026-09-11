/* Quake II m_hover.c. id Software, GPL-2.0-or-later. */
import { zero } from "../../foundation/fields.ts";
import type { Q2Think } from "../../foundation/host.ts";
import { visible } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, beginDeath, damagedSkin, loopSound, move, muzzle, shot, sound, standardGib } from "./common.ts";
import { hoverFrame, hoverMoves } from "./tables/hover.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "hover_move_stand" : "hover_move_run"); }
export const hoverDefinition: Q2MonsterDefinition = {
  classname: "monster_hover", kind: "hover", model: "models/monsters/hover/tris.md2", health: 240, gibHealth: -100, mass: 150,
  bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 32 } }, scale: 1, locomotion: "fly",
  initialMove: "hover_move_stand", moves: hoverMoves, stand: move("hover_move_stand"), walk: move("hover_move_walk"), run, attack: move("hover_move_start_attack"),
  sight: sound("hover/hovsght1.wav"),
  search(context) { return context.game.sound(context.entity, context.game.host.random() < 0.5 ? "hover/hovsrch1.wav" : "hover/hovsrch2.wav", 2); },
  initialize(context) { return loopSound(context, "hover/hovidle1.wav"); },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    const light = reaction.damage <= 25, first = !light || context.game.host.random() < 0.5;
    context.game.sound(context.entity, first ? "hover/hovpain1.wav" : "hover/hovpain2.wav", 2);
    return context.setMove(!light ? "hover_move_pain1" : first ? "hover_move_pain3" : "hover_move_pain2");
  },
  die(context, reaction) {
    if (standardGib(context, reaction, 2, 2, "models/objects/gibs/sm_meat/tris.md2") || context.state.dead) return undefined;
    return beginDeath(context, reaction, context.game.host.random() < 0.5 ? "hover/hovdeth1.wav" : "hover/hovdeth2.wav", "hover_move_death1");
  },
  callbacks: {
    hover_run: run, hover_attack: move("hover_move_attack1"),
    hover_reattack(context) { return context.setMove(aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.6 ? "hover_move_attack1" : "hover_move_end_attack"); },
    hover_fire_blaster(context) {
      const aim = shot(context, 62); if (aim === null) return undefined;
      context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, context.entity.frame === hoverFrame.attak104 ? 64 : 0);
      return muzzle(context, 62, aim.direction, aim.start);
    },
    hover_dead(context) {
      const { entity, game, state } = context;
      state.corpse = true;
      game.move(entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } });
      game.motion(entity, "toss");
      const deadline = game.host.now() + 15;
      const think: Q2Think = (self, services) => {
        if (services.body(self).ground === null && services.host.now() < deadline) return services.schedule(self, 0.1, think);
        services.host.emit({ kind: "effect", effect: "q2:explosion1", origin: services.body(self).origin, direction: zero, count: 1, color: 0 });
        return services.remove(self);
      };
      return game.schedule(entity, 0.1, think);
    },
  },
};
