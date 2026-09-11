// Rerelease m_guardian.cpp. ZeniMax Media, GPL-2.0.
import { normalize, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Think } from "../../foundation/host.ts";
import { enemyBody, enemyEye, health, projectFlash, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { move, sound } from "../../base/monsters/common.ts";
import { fireMonsterBeam, freeMonsterBeam, updateMonsterBeam } from "./beam.ts";
import { bossExplode, bossExplodeThink, randomBodyPoint } from "./boss.ts";
import { chainfist, monsterFlash, reactsToPain } from "./common.ts";
import { guardianFrame, guardianMoves } from "./tables/guardian.ts";
import { rereleaseFlash } from "./tables/flashes.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "guardian_move_stand" : "guardian_move_run"); }
function spinSound(context: MonsterContext, playing: boolean): undefined {
  return context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "weapons/hyprbl1a.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: playing ? "start" : "stop" });
}

export function createGuardianDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const guardianFireUpdate: Q2Think = (beam, game) => {
    const context = beam.owner === null ? null : monsters.context(beam.owner), owner = game.entity(beam.owner);
    if (context === null || owner === null || enemyBody(context) === null) return undefined;
    const enemy = game.entity(owner.enemy);
    const enemyActor = owner.enemy === null ? null : game.host.bodies.read(owner.enemy);
    if (enemyActor === null) return undefined;
    const start = projectFlash(context, (owner.frame & 1) !== 0 ? { x: 125, y: -70, z: 60 } : { x: 112, y: -62, z: 60 });
    const target = enemy !== null ? randomBodyPoint(enemy, game) : {
      x: enemyActor.origin.x + enemyActor.bounds.min.x + game.host.random() * (enemyActor.bounds.max.x - enemyActor.bounds.min.x),
      y: enemyActor.origin.y + enemyActor.bounds.min.y + game.host.random() * (enemyActor.bounds.max.y - enemyActor.bounds.min.y),
      z: enemyActor.origin.z + enemyActor.bounds.min.z + game.host.random() * (enemyActor.bounds.max.z - enemyActor.bounds.min.z),
    };
    game.move(beam, { origin: start }); beam.movedir = normalize(subtract(target, start));
    return updateMonsterBeam(beam, game, false);
  };
  return {
    classname: "monster_guardian", kind: "guardian", model: "models/monsters/guardian/tris.md2", health: 2500, gibHealth: -200, mass: 850, scale: 1,
    bounds: { min: { x: -96, y: -96, z: -66 }, max: { x: 96, y: 96, z: 62 } }, initialMove: "guardian_move_stand", moves: guardianMoves,
    stand: move("guardian_move_stand"), walk: move("guardian_move_walk"), run,
    sourceCallbacks: { think: { guardian_fire_update: guardianFireUpdate, beam_think: freeMonsterBeam, BossExplode_think: bossExplodeThink } },
    attack(context) {
      if (enemyBody(context) === null) return undefined;
      const range = targetDistance(context);
      return context.setMove(range > 500 ? "guardian_move_atk2_in" : context.state.meleeTime < context.game.host.now() && range < 120 ? "guardian_move_kick" : "guardian_move_atk1_in");
    },
    pain(context, reaction) {
      const { entity, state, game } = context;
      if (!chainfist(context) && reaction.damage <= 10 || game.host.now() < state.painTime) return undefined;
      if (!chainfist(context) && reaction.damage <= 75 && game.host.random() > 0.2) return undefined;
      if (entity.frame >= guardianFrame.atk1_spin1 && entity.frame <= guardianFrame.atk1_spin15 || entity.frame >= guardianFrame.atk2_fire1 && entity.frame <= guardianFrame.atk2_fire4 || entity.frame >= guardianFrame.kick_in1 && entity.frame <= guardianFrame.kick_in13) return undefined;
      state.painTime = game.host.now() + 3;
      if (!reactsToPain(context)) return undefined;
      spinSound(context, false); return context.setMove("guardian_move_pain1");
    },
    die(context) {
      spinSound(context, false); context.state.dead = true; context.state.canTakeDamage = true;
      context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true });
      return context.setMove("guardian_move_death");
    },
    callbacks: {
      guardian_run: run, guardian_footstep: sound("zortemp/step.wav", 4), BossExplode: bossExplode,
      guardian_atk1(context) { context.entity.timestamp = context.game.host.now() + 0.65 + context.game.host.random() * 1.5; return context.setMove("guardian_move_atk1_spin"); },
      guardian_atk1_charge(context) { spinSound(context, true); return context.game.sound(context.entity, "weapons/hyprbu1a.wav", 1); },
      guardian_atk1_finish(context) { spinSound(context, false); return context.setMove("guardian_atk1_out"); },
      guardian_atk2: move("guardian_move_atk2_fire"), guardian_atk2_out: move("guardian_move_atk2_out"),
      guardian_fire_blaster(context) {
        const eye = enemyEye(context); if (eye === null) return undefined;
        const { game, entity } = context, flash = rereleaseFlash.GUARDIAN_BLASTER;
        const start = projectFlash(context, muzzleOffset("rerelease", flash));
        const target = { x: eye.x + (game.host.random() * 2 - 1) * 5, y: eye.y + (game.host.random() * 2 - 1) * 5, z: eye.z + (game.host.random() * 2 - 1) * 5 };
        const direction = normalize(subtract(target, start));
        context.weapons.fireBlaster(entity, game, start, direction, 2, 1000, entity.frame % 4 === 0 ? 64 : 0);
        monsterFlash(context, flash, start, direction);
        if (health(game, entity.enemy) > 0 && entity.frame === guardianFrame.atk1_spin12 && entity.timestamp > game.host.now() && visible(context)) context.state.nextFrame = guardianFrame.atk1_spin5;
        return undefined;
      },
      guardian_laser_fire(context) { context.game.sound(context.entity, "weapons/laser2.wav", 1); return fireMonsterBeam(context, 25, (context.entity.frame & 1) !== 0, guardianFireUpdate); },
      guardian_kick(context) { if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: -80 }, 85, 700)) context.state.meleeTime = context.game.host.now() + 1; return undefined; },
      guardian_dead(context) {
        const { game, entity } = context;
        for (let i = 0; i < 3; i++) game.host.emit({ kind: "effect", effect: "q2:explosion1-big", origin: randomBodyPoint(entity, game), direction: zero, count: 1, color: 0 });
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 125);
        for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 125, { metallic: true });
        for (let i = 1; i <= 6; i++) for (let j = 0; j < 2; j++) throwGib(entity, game, `models/monsters/guardian/gib${i}.md2`, 125, { metallic: true });
        throwGib(entity, game, "models/monsters/guardian/gib7.md2", 125, { metallic: true, head: true });
        context.state.gibbed = true; return undefined;
      },
    },
  };
}
