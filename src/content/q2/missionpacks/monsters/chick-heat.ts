/* Quake II xatrix/m_chick.c heat-seeking variant. GPL-2.0-or-later. */
import { chickDefinition } from "../../base/monsters/chick.ts";
import { damagedSkin, muzzle, shot } from "../../base/monsters/common.ts";
import type { Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";

export function createChickHeatDefinition(weapons: Q2MissionPackMonsterWeapons): Q2MonsterDefinition {
  return {
    ...chickDefinition, classname: "monster_chick_heat",
    initialize(context) { context.entity.skin = 3; return undefined; },
    pain(context, reaction) {
      damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      const r = context.game.host.random();
      context.game.sound(context.entity, r < 0.33 ? "chick/chkpain1.wav" : r < 0.66 ? "chick/chkpain2.wav" : "chick/chkpain3.wav", 2);
      return context.setMove(reaction.damage <= 10 ? "chick_move_pain1" : reaction.damage <= 25 ? "chick_move_pain2" : "chick_move_pain3");
    },
    callbacks: { ...chickDefinition.callbacks,
      ChickRocket(context) {
        const aim = shot(context, 57); if (aim === null) return undefined;
        if (context.entity.skin > 1) weapons.fireHeatRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
        else context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
        return muzzle(context, 57, aim.direction, aim.start);
      },
    },
  };
}
