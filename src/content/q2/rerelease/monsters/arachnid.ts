import { normalize, subtract } from "../../foundation/fields.ts";
import { enemyBody, enemyEye, projectFlash, targetDistance } from "../../foundation/monsters/ai.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { finishCorpse, move, sound } from "../../base/monsters/common.ts";
import { checkGib, monsterFlash, reactsToPain } from "./common.ts";
import { arachnidFrame, arachnidMoves } from "./tables/arachnid.ts";
import { rereleaseFlash } from "./tables/flashes.ts";

function run(context: MonsterContext): undefined {
  return context.setMove(context.state.standGround ? "arachnid_move_stand" : "arachnid_move_run");
}

export const arachnidDefinition: Q2MonsterDefinition = {
  classname: "monster_arachnid", kind: "arachnid", model: "models/monsters/arachnid/tris.md2",
  health: 1000, gibHealth: -200, mass: 450, scale: 1,
  bounds: { min: { x: -48, y: -48, z: -20 }, max: { x: 48, y: 48, z: 48 } },
  initialMove: "arachnid_move_stand", moves: arachnidMoves,
  stand: move("arachnid_move_stand"), walk: move("arachnid_move_walk"), run,
  sight: sound("arachnid/sight.wav"),
  attack(context) {
    const enemy = enemyBody(context);
    if (enemy === null) return undefined;
    if (context.state.meleeTime < context.game.host.now() && targetDistance(context) < 80) return context.setMove("arachnid_melee");
    return context.setMove(enemy.origin.z - context.game.body(context.entity).origin.z > 150 ? "arachnid_attack_up1" : "arachnid_attack1");
  },
  pain(context) {
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, "arachnid/pain.wav", 2);
    if (!reactsToPain(context)) return undefined;
    return context.setMove(context.game.host.random() < 0.5 ? "arachnid_move_pain1" : "arachnid_move_pain2");
  },
  die(context, reaction) {
    const { game, entity, state } = context;
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage, { head: true });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "arachnid/death.wav", 2); state.dead = true; state.canTakeDamage = true;
    game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("arachnid_move_death");
  },
  callbacks: {
    arachnid_run: run,
    arachnid_dead: finishCorpse,
    arachnid_footstep: ({ game, entity }) => game.sound(entity, "insane/insane11.wav", 4, 0.5, 2),
    arachnid_melee_charge: sound("gladiator/melee3.wav", 1),
    arachnid_melee_hit(context) {
      if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 15, 50)) context.state.meleeTime = context.game.host.now() + 1;
      return undefined;
    },
    arachnid_charge_rail(context) {
      const target = enemyEye(context);
      if (target === null) return undefined;
      context.entity.pos1 = target;
      return context.game.sound(context.entity, "gladiator/railgun.wav", 1);
    },
    arachnid_rail(context) {
      const frame = context.entity.frame;
      const flash = frame === arachnidFrame.rails8 ? rereleaseFlash.ARACHNID_RAIL2
        : frame === arachnidFrame.rails_up7 ? rereleaseFlash.ARACHNID_RAIL_UP1
          : frame === arachnidFrame.rails_up11 ? rereleaseFlash.ARACHNID_RAIL_UP2 : rereleaseFlash.ARACHNID_RAIL1;
      const start = projectFlash(context, muzzleOffset("rerelease", flash));
      const direction = normalize(subtract(context.entity.pos1, start));
      context.weapons.fireRail(context.entity, context.game, start, direction, 35, 100);
      return monsterFlash(context, flash, start, direction);
    },
  },
};
