// Rerelease m_boss31.cpp. ZeniMax Media, GPL-2.0.
import { createJorgDefinition } from "../../../base/monsters/jorg.ts";
import { loopSound, shot } from "../../../base/monsters/common.ts";
import { stopLoop } from "../../../base/monsters/boss-common.ts";
import { zero } from "../../../foundation/fields.ts";
import { health, projectFlash, visible } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../../foundation/monsters/muzzle.ts";
import { defaultCheckAttack } from "../../../foundation/monsters/perception.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { bossExplode, bossExplodeThink } from "../boss.ts";
import { chainfist, monsterFlash, predictedDirection, reactsToPain } from "../common.ts";
import { boss31Frame, boss31Moves } from "../tables/boss31.ts";
import { tossRereleaseMakron } from "./makron.ts";
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { Q2GameServices } from "../../../foundation/host.ts";

function endSound(context: MonsterContext): undefined {
  if (context.entity.sound !== "") { context.game.sound(context.entity, "boss3/bs3atck1_end.wav", 1); context.entity.sound = ""; stopLoop(context); }
  return undefined;
}
function run(context: MonsterContext): undefined { context.setMove(context.state.standGround ? "jorg_move_stand" : "jorg_move_run"); return endSound(context); }
function bullet(context: MonsterContext, flash: number, offset: number): undefined {
  const start = projectFlash(context, muzzleOffset("rerelease", flash)), direction = predictedDirection(context, start, 0, false, offset);
  if (direction === null) return undefined;
  context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 300, 500, 0); return monsterFlash(context, flash, start, direction);
}
export function createRereleaseJorgDefinition(monsters: Q2Monsters, transferHealthbarTarget?: (oldActor: ActorId, newActor: ActorId, game: Q2GameServices) => undefined): Q2MonsterDefinition {
  const original = createJorgDefinition(monsters);
  function toss(context: MonsterContext): undefined {
    const spawned = tossRereleaseMakron(context, monsters);
    return transferHealthbarTarget?.(context.entity.actor.id, spawned, context.game);
  }
  return {
    ...original, moves: boss31Moves, model: "models/monsters/boss3/jorg/tris.md2", health: 8000, run,
    sourceCallbacks: { think: { BossExplode_think: bossExplodeThink } },
    initialize(context) { context.entity.model2 = "models/monsters/boss3/rider/tris.md2"; context.state.ignoreShots = true; return undefined; },
    stand(context) { context.setMove("jorg_move_stand"); return endSound(context); },
    checkAttack: context => defaultCheckAttack(context, { standGround: 0.4, melee: 0.8, near: 0.4, mid: 0.2, far: 0, strafeScalar: 0 }),
    attack(context) {
      if (context.game.host.random() <= 0.75) {
        context.game.sound(context.entity, "boss3/bs3atck1.wav", 1); context.entity.sound = "boss3/w_loop.wav"; loopSound(context, context.entity.sound); return context.setMove("jorg_move_start_attack1");
      }
      context.game.sound(context.entity, "boss3/bs3atck2.wav", 2); return context.setMove("jorg_move_attack2");
    },
    pain(context, reaction) {
      const { entity, game, state } = context, frame = entity.frame;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
      if (game.host.now() < state.painTime) return undefined;
      if (!chainfist(context)) {
        if (reaction.damage <= 40 && game.host.random() <= 0.6) return undefined;
        if (frame >= boss31Frame.attak101 && frame <= boss31Frame.attak108 && game.host.random() <= 0.005) return undefined;
        if (frame >= boss31Frame.attak109 && frame <= boss31Frame.attak114 && game.host.random() <= 0.00005) return undefined;
        if (frame >= boss31Frame.attak201 && frame <= boss31Frame.attak208 && game.host.random() <= 0.005) return undefined;
      }
      state.painTime = game.host.now() + 3; let heavy = false;
      if (reaction.damage > 50 && reaction.damage <= 100) game.sound(entity, "boss3/bs3pain2.wav", 2);
      else if (reaction.damage > 100 && game.host.random() <= 0.3) { heavy = true; game.sound(entity, "boss3/bs3pain3.wav", 2); }
      if (!reactsToPain(context)) return undefined;
      endSound(context);
      if (reaction.damage <= 50) context.setMove("jorg_move_pain1");
      else if (reaction.damage <= 100) context.setMove("jorg_move_pain2");
      else if (heavy) context.setMove("jorg_move_pain3");
      return undefined;
    },
    die(context) {
      context.game.sound(context.entity, "boss3/bs3deth1.wav", 2); endSound(context);
      context.state.dead = true; context.state.canTakeDamage = false; context.entity.count = 0;
      context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false }); return context.setMove("jorg_move_death");
    },
    callbacks: {
      ...original.callbacks, jorg_run: run, BossExplode: bossExplode,
      jorg_reattack1(context) {
        if (visible(context) && context.game.host.random() < 0.9) return context.setMove("jorg_move_attack1");
        context.setMove("jorg_move_end_attack1"); return endSound(context);
      },
      jorg_attack1_end_sound: endSound,
      jorgBFG(context) {
        const aim = shot(context, 132); if (aim === null) return undefined;
        context.game.sound(context.entity, "makron/bfg_fire.wav", 1);
        context.weapons.fireBfg(context.entity, context.game, aim.start, aim.direction, 50, 300, 200); return monsterFlash(context, 132, aim.start, aim.direction);
      },
      jorg_firebullet_left: context => bullet(context, 120, 0.2), jorg_firebullet_right: context => bullet(context, 126, -0.2),
      jorg_firebullet(context) { bullet(context, 120, 0.2); return bullet(context, 126, -0.2); },
      MakronToss: toss,
      jorg_dead(context) {
        const { entity, game, state } = context;
        game.host.emit({ kind: "effect", effect: "q2:explosion1-big", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
        stopLoop(context); entity.sound = ""; entity.skin = Math.trunc(entity.skin / 2);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 500);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 500, { metallic: true });
        for (const part of ["chest", "foot", "foot", "tube", "tube", "tube", "tube", "spike", "spike", "spike", "spike", "spike", "spike"]) throwGib(entity, game, `models/monsters/boss3/jorg/gibs/${part}.md2`, 500, { skinned: true });
        for (const part of ["gun", "gun", "thigh", "thigh", "spine"]) throwGib(entity, game, `models/monsters/boss3/jorg/gibs/${part}.md2`, 500, { skinned: true, upright: true });
        throwGib(entity, game, "models/monsters/boss3/jorg/gibs/head.md2", 500, { skinned: true, metallic: true, head: true }); state.gibbed = true;
        return toss(context);
      },
    },
  };
}
