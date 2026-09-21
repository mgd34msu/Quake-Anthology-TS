// Rerelease m_hover.cpp. ZeniMax Media, GPL-2.0.
import { hoverDefinition } from "../../../base/monsters/hover.ts";
import { aliveEnemy, loopSound, shot } from "../../../base/monsters/common.ts";
import { zero } from "../../../foundation/fields.ts";
import type { Q2Think } from "../../../foundation/host.ts";
import { health, visible } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { checkGib, monsterFlash, reactsToPain, rereleaseRandom } from "../common.ts";
import { hoverMoves } from "../tables/hover.ts";
import { rereleaseFlash } from "../tables/flashes.ts";

function gib(context: MonsterContext): undefined {
  const { entity, game, state } = context;
  game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
  entity.skin = Math.trunc(entity.skin / 2);
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 150);
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 150, { metallic: true });
  throwGib(entity, game, "models/monsters/hover/gibs/chest.md2", 150, { skinned: true });
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/hover/gibs/ring.md2", 150, { skinned: true, metallic: true });
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/hover/gibs/foot.md2", 150, { skinned: true });
  throwGib(entity, game, "models/monsters/hover/gibs/head.md2", 150, { skinned: true, head: true });
  state.dead = true; state.gibbed = true; return undefined;
}
export function createRereleaseHoverDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const deadThink: Q2Think = (entity, game) => {
    if (game.body(entity).ground === null && game.host.now() < entity.timestamp) return game.schedule(entity, 0.1, deadThink);
    const context = monsters.context(entity.actor.id);
    return context === null ? undefined : gib(context);
  };
  return {
    ...hoverDefinition, moves: hoverMoves, sourceCallbacks: { think: { hover_deadthink: deadThink } },
    initialize(context) {
      const { state } = context; state.yawSpeed = 18; state.alternateFly = true; state.flyThrusters = false;
      state.flyAcceleration = 20; state.flySpeed = 120; state.flyMinDistance = 150; state.flyMaxDistance = 350;
      return loopSound(context, "hover/hovidle1.wav");
    },
    pain(context, reaction) {
      const { game, entity, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      game.sound(entity, game.host.random() < 0.5 ? "hover/hovpain1.wav" : "hover/hovpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      const choice = game.host.random();
      return context.setMove(reaction.damage <= 25 ? choice < 0.5 ? "hover_move_pain3" : "hover_move_pain2" : choice < 0.3 ? "hover_move_pain1" : "hover_move_pain2");
    },
    die(context) {
      const { entity, game, state } = context;
      entity.effects = 0;
      game.host.combat.setPoweredProtection(entity.actor, { kind: "none" });
      if (checkGib(context)) return gib(context);
      if (state.dead) return undefined;
      game.sound(entity, game.host.random() < 0.5 ? "hover/hovdeth1.wav" : "hover/hovdeth2.wav", 2);
      state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove("hover_move_death1");
    },
    callbacks: {
      ...hoverDefinition.callbacks,
      hover_attack(context) {
        if (context.game.host.random() > 0.5) { context.state.attackState = "straight"; return context.setMove("hover_move_attack1"); }
        if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty;
        context.state.attackState = "sliding"; return context.setMove("hover_move_attack2");
      },
      hover_reattack(context) {
        if (aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.6) {
          if (context.state.attackState === "straight") return context.setMove("hover_move_attack1");
          if (context.state.attackState === "sliding") return context.setMove("hover_move_attack2");
        }
        return context.setMove("hover_move_end_attack");
      },
      hover_fire_blaster(context) {
        const flash = (context.entity.frame & 1) !== 0 ? rereleaseFlash.HOVER_BLASTER_2 : rereleaseFlash.HOVER_BLASTER_1;
        const aim = shot(context, flash); if (aim === null) return undefined;
        context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, context.entity.frame % 4 === 0 ? 64 : 0);
        return monsterFlash(context, flash, aim.start, aim.direction);
      },
      hover_dead(context) {
        const { entity, game, state } = context;
        state.corpse = true;
        game.move(entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } });
        game.motion(entity, "toss"); entity.timestamp = game.host.now() + 15;
        return game.schedule(entity, 0.1, deadThink);
      },
      hover_dying(context) {
        const { entity, game } = context;
        if (game.body(entity).ground !== null) return deadThink(entity, game);
        if (rereleaseRandom(context).integer(2) !== 0) return undefined;
        game.host.emit({ kind: "effect", effect: "q2:plain-explosion", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
        const organic = rereleaseRandom(context).integer(2) !== 0;
        throwGib(entity, game, organic ? "models/objects/gibs/sm_meat/tris.md2" : "models/objects/gibs/sm_metal/tris.md2", 120, { metallic: !organic });
        return undefined;
      },
    },
  };
}
