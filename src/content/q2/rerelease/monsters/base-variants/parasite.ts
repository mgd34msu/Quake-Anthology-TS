// Rerelease m_parasite.cpp. ZeniMax Media, GPL-2.0.
import { parasiteDefinition } from "../../../base/monsters/parasite.ts";
import { add, scale } from "../../../foundation/fields.ts";
import { anglesVectors, clearShot, corpse, health, runAi } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { blockedCheckJump, blockedCheckPlatform, checkGib, monsterJumpFinished, reactsToPain, rereleaseRandom } from "../common.ts";
import { parasiteFrame, parasiteMoves } from "../tables/parasite.ts";
import { createProboscis } from "./proboscis.ts";

function startRun(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "parasite_move_stand" : "parasite_move_start_run"); }
function jump(context: MonsterContext, up: boolean): undefined {
  const body = context.game.body(context.entity), axes = anglesVectors(body.angles);
  return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axes.forward, up ? 200 : 100), scale(axes.up, up ? 450 : 300))) });
}
export function createRereleaseParasiteDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const proboscis = createProboscis(monsters);
  function retract(context: MonsterContext): undefined {
    const tip = context.game.entity(context.entity.proboscus);
    return tip !== null && tip.style !== 2 ? proboscis.retract(tip, context.game) : undefined;
  }
  function run(context: MonsterContext): undefined { retract(context); return context.setMove(context.state.standGround ? "parasite_move_stand" : "parasite_move_run"); }
  return {
    ...parasiteDefinition, moves: parasiteMoves, sourceCallbacks: proboscis.callbacks, run: startRun,
    initialize(context) { context.state.yawSpeed = 30; return undefined; },
    idle(context) { return context.entity.enemy === null ? context.setMove("parasite_move_start_fidget") : undefined; },
    attack(context) { if (!clearShot(context, { x: -1.7, y: 0, z: 1.2 })) return undefined; retract(context); return context.setMove("parasite_move_fire_proboscis"); },
    ai: { parasite_charge_proboscis(context, distance) {
      runAi(context, context.entity.frame >= parasiteFrame.break01 && context.entity.frame <= parasiteFrame.break32 ? "move" : "charge", distance);
      const tip = context.game.entity(context.entity.proboscus), segment = tip === null ? null : context.game.entity(tip.proboscus);
      return segment === null ? undefined : proboscis.draw(segment, context.game);
    } },
    pain(context) {
      const { entity, game, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
      if (game.host.now() < state.painTime) return undefined;
      retract(context); state.painTime = game.host.now() + 3;
      game.sound(entity, game.host.random() < 0.5 ? "parasite/parpain1.wav" : "parasite/parpain2.wav", 2);
      return reactsToPain(context) ? context.setMove("parasite_move_pain1") : undefined;
    },
    die(context, reaction) {
      const { game, entity, state } = context, tip = game.entity(entity.proboscus);
      if (tip !== null && tip.style !== 2) proboscis.reset(tip, game);
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
        for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        throwGib(entity, game, "models/monsters/parasite/gibs/chest.md2", reaction.damage, { skinned: true });
        for (const part of ["bleg", "bleg", "fleg", "fleg"]) throwGib(entity, game, `models/monsters/parasite/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: true });
        throwGib(entity, game, "models/monsters/parasite/gibs/head.md2", reaction.damage, { skinned: true, head: true }); state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "parasite/pardeth1.wav", 2); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove("parasite_move_death");
    },
    blocked(context, distance) {
      const result = blockedCheckJump(context, distance, 256, 68, (context.entity.spawnflags & 8) === 0);
      if (result !== "none") { if (result !== "turn" && context.entity.enemy !== null) context.setMove(result === "up" ? "parasite_move_jump_up" : "parasite_move_jump_down"); return true; }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: {
      ...parasiteDefinition.callbacks, parasite_run: run, parasite_start_run: startRun,
      parasite_tap: context => context.game.sound(context.entity, "parasite/paridle1.wav", 1, 0.75, 2.75),
      parasite_scratch: context => context.game.sound(context.entity, "parasite/paridle2.wav", 1, 0.75, 2.75),
      parasite_fire_proboscis: proboscis.fire,
      parasite_proboscis_wait(context) { context.state.nextFrame = context.entity.frame === parasiteFrame.drain04 ? parasiteFrame.drain05 : parasiteFrame.drain04; return undefined; },
      parasite_proboscis_pull_wait(context) {
        const tip = context.game.entity(context.entity.proboscus);
        if (tip === null || tip.style === 3) context.state.nextFrame = parasiteFrame.drain14;
        else { context.state.nextFrame = context.entity.frame === parasiteFrame.drain12 ? parasiteFrame.drain13 : parasiteFrame.drain12; if (tip.style !== 2) proboscis.retract(tip, context.game); }
        return undefined;
      },
      parasite_break_noise: context => context.game.sound(context.entity, "parasite/parsrch1.wav", 2),
      parasite_break_retract(context) { const tip = context.game.entity(context.entity.proboscus); return tip === null ? undefined : proboscis.retract(tip, context.game); },
      parasite_break_sound(context) { context.state.painTime = context.game.host.now() + 3; return context.game.sound(context.entity, context.game.host.random() < 0.5 ? "parasite/parpain1.wav" : "parasite/parpain2.wav", 2); },
      parasite_break_wait(context) {
        const tip = context.game.entity(context.entity.proboscus);
        if (tip !== null && tip.style !== 3) context.state.nextFrame = parasiteFrame.break19;
        else if (rereleaseRandom(context).integer(2) !== 0) { context.game.sound(context.entity, "parasite/paratck4.wav", 1); context.state.nextFrame = parasiteFrame.break31; }
        return undefined;
      },
      parasite_jump_down: context => jump(context, false), parasite_jump_up: context => jump(context, true),
      parasite_jump_wait_land(context) { context.state.nextFrame = context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? context.entity.frame + 1 : context.entity.frame; return undefined; },
      parasite_shrink(context) { const bounds = context.game.body(context.entity).bounds; context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...bounds, max: { ...bounds.max, z: 0 } } }); },
      parasite_dead(context) { context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } }); return corpse(context); },
    },
  };
}
