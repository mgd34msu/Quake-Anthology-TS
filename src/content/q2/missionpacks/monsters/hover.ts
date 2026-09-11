/* Quake II rogue/m_hover.c. ZeniMax Media, GPL-2.0-or-later. */
import { hoverDefinition } from "../../base/monsters/hover.ts";
import { aliveEnemy, beginDeath, loopSound, shot, standardGib } from "../../base/monsters/common.ts";
import { zero } from "../../foundation/fields.ts";
import type { Q2Think } from "../../foundation/host.ts";
import { health, visible } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { monsterFlash } from "../../rerelease/monsters/common.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "./power-armor.ts";
import { monsterMass, rogueBlockedCheckShot } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { hoverFrame, hoverMoves } from "./tables/rogue-hover.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";

const hoverDeadThink: Q2Think = (entity, game) => {
  if (game.body(entity).ground === null && game.host.now() < entity.timestamp) return game.schedule(entity, 0.1, hoverDeadThink);
  game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
  return game.remove(entity);
};
function path(context: MonsterContext, suffix: string): string { return monsterMass(context) < 225 ? `hover/hov${suffix}.wav` : `daedalus/daed${suffix}.wav`; }

export function createRogueHoverDefinitions(weapons: Q2MissionPackMonsterWeapons, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  const definition: Q2MonsterDefinition = {
    ...hoverDefinition, moves: hoverMoves,
    sourceCallbacks: { think: { "q2:rogue/hover_deadthink": hoverDeadThink } },
    sight(context) { return context.game.sound(context.entity, path(context, "sght1"), 2); },
    search(context) { return context.game.sound(context.entity, path(context, context.game.host.random() < 0.5 ? "srch1" : "srch2"), 2); },
    pain(context, reaction) {
      const { entity, game, state } = context;
      if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin |= 1;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      if (game.options.skill === 3) return undefined;
      const first = game.host.random() < (reaction.damage <= 25 ? 0.5 : 0.45 - 0.1 * game.options.skill);
      game.sound(entity, path(context, first ? "pain1" : "pain2"), 2);
      return context.setMove(first ? reaction.damage <= 25 ? "hover_move_pain3" : "hover_move_pain1" : "hover_move_pain2");
    },
    die(context, reaction) {
      context.entity.effects = 0; context.game.host.combat.setArmor(context.entity.actor, { kind: "none" });
      if (standardGib(context, reaction, 2, 2, "models/objects/gibs/sm_meat/tris.md2") || context.state.dead) return undefined;
      return beginDeath(context, reaction, path(context, context.game.host.random() < 0.5 ? "deth1" : "deth2"), "hover_move_death1");
    },
    blocked(context) { return rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source); },
    callbacks: {
      ...hoverDefinition.callbacks,
      hover_attack(context) {
        const chance = (context.game.options.skill === 0 ? 0 : 1 - 0.5 / context.game.options.skill) + (monsterMass(context) > 150 ? 0.1 : 0);
        if (context.game.host.random() > chance) { context.state.attackState = "straight"; return context.setMove("hover_move_attack1"); }
        if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty;
        context.state.attackState = "sliding"; return context.setMove("hover_move_attack2");
      },
      hover_reattack(context) {
        if (aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.6) {
          if (context.state.attackState === "straight") return context.setMove("hover_move_attack1");
          if (context.state.attackState === "sliding") return context.setMove("hover_move_attack2");
          context.game.host.diagnostic(`hover_reattack: unexpected state ${context.state.attackState}`);
        }
        return context.setMove("hover_move_end_attack");
      },
      hover_fire_blaster(context) {
        const aim = shot(context, 62); if (aim === null) return undefined;
        const daedalus = monsterMass(context) >= 200;
        if (daedalus) weapons.fireBlaster2(context.entity, context.game, aim.start, aim.direction, 1, 1000, 8);
        else context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, context.entity.frame === hoverFrame.attak104 ? 64 : 0);
        return monsterFlash(context, daedalus ? 145 : 62, aim.start, aim.direction);
      },
      hover_dead(context) {
        context.state.corpse = true;
        context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } });
        context.game.motion(context.entity, "toss"); context.entity.timestamp = context.game.host.now() + 15;
        return context.game.schedule(context.entity, 0.1, hoverDeadThink);
      },
    },
  };
  return [definition, {
    ...definition, classname: "monster_daedalus", kind: "daedalus", health: 450, mass: 225, yawSpeed: 25,
    initialize(context) { monsterPowerArmor(context, "screen", 100); return loopSound(context, "daedalus/daedidle1.wav"); },
    afterSpawn(context) { context.entity.skin = 2; return context.game.show(context.entity); },
    restore: restoreMonsterPowerArmor,
  }];
}
