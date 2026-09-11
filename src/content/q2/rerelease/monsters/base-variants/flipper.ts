// Rerelease m_flipper.cpp. ZeniMax Media, GPL-2.0.
import { corpse, health } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { flipperDefinition } from "../../../base/monsters/flipper.ts";
import { checkGib, reactsToPain, rereleaseRandom } from "../common.ts";
import { flipperMoves } from "../tables/flipper.ts";

export const rereleaseFlipperDefinition: Q2MonsterDefinition = {
  ...flipperDefinition, moves: flipperMoves, bounds: { min: { x: -16, y: -16, z: -8 }, max: { x: 16, y: 16, z: 20 } },
  initialize(context) {
    const { state } = context; state.alternateFly = true; state.flyThrusters = false;
    state.flyAcceleration = 30; state.flySpeed = 110; state.flyMinDistance = 10; state.flyMaxDistance = 10;
    return undefined;
  },
  pain(context) {
    const { entity, game, state } = context;
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
    if (game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 3;
    const first = rereleaseRandom(context).integer(2) !== 0;
    game.sound(entity, first ? "flipper/flppain1.wav" : "flipper/flppain2.wav", 2);
    if (!reactsToPain(context)) return undefined;
    return context.setMove(first ? "flipper_move_pain1" : "flipper_move_pain2");
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage, { head: true });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "flipper/flpdeth1.wav", 2); state.dead = true; state.canTakeDamage = true; entity.serverFlags |= 2;
    game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("flipper_move_death");
  },
  callbacks: {
    ...flipperDefinition.callbacks,
    flipper_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -8 }, max: { x: 16, y: 16, z: 8 } } }); },
  },
};
