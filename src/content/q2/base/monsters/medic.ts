/* Quake II m_medic.c. id Software, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, scale, subtract } from "../../foundation/fields.ts";
import type { Q2Entity } from "../../foundation/host.ts";
import { anglesVectors, health, MASK_SHOT, projectFlash, setDuck, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { defaultCheckAttack } from "../../foundation/monsters/perception.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, move, muzzle, shot, sound } from "./common.ts";
import { medicFrame, medicMoves } from "./tables/medic.ts";

const cableOffsets: readonly Vec3[] = [
  { x: 45, y: -9.2, z: 15.5 }, { x: 48.4, y: -9.7, z: 15.2 }, { x: 47.8, y: -9.8, z: 15.8 },
  { x: 47.3, y: -9.3, z: 14.3 }, { x: 45.4, y: -10.1, z: 13.1 }, { x: 41.9, y: -12.7, z: 12 },
  { x: 37.8, y: -15.8, z: 11.2 }, { x: 34.3, y: -18.4, z: 10.7 }, { x: 32.7, y: -19.7, z: 10.4 }, { x: 32.7, y: -19.7, z: 10.4 },
];
export function createMedicDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  function patient(context: MonsterContext): Q2Entity | null {
    let best: Q2Entity | null = null;
    for (const actor of context.game.host.nearby(context.game.body(context.entity).origin, 1024)) {
      const entity = context.game.entity(actor), candidate = monsters.context(actor);
      if (entity === null || entity === context.entity || (entity.serverFlags & 4) === 0 || candidate?.state.goodGuy === true || entity.owner !== null || health(context.game, actor) > 0 || entity.nextThink !== null || !visible(context, actor)) continue;
      if (best === null || entity.maxHealth > best.maxHealth) best = entity;
    }
    return best;
  }
  function acquire(context: MonsterContext, preserveEnemy: boolean): boolean {
    const target = patient(context); if (target === null) return false;
    if (preserveEnemy) context.state.oldEnemy = context.entity.enemy;
    context.entity.enemy = target.actor.id; target.owner = context.entity.actor.id; context.state.medic = true;
    monsters.foundTarget(context);
    return true;
  }
  function run(context: MonsterContext): undefined {
    if (!context.state.medic && acquire(context, true)) return undefined;
    return context.setMove(context.state.standGround ? "medic_move_stand" : "medic_move_run");
  }
  function idle(context: MonsterContext): undefined { context.game.sound(context.entity, "medic/idle.wav", 2, 1, 2); acquire(context, false); return undefined; }
  function attack(context: MonsterContext): undefined { return context.setMove(context.state.medic ? "medic_move_attackCable" : "medic_move_attackBlaster"); }
  return {
    classname: "monster_medic", kind: "medic", model: "models/monsters/medic/tris.md2", health: 300, gibHealth: -130, mass: 400,
    bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 32 } }, scale: 1,
    initialMove: "medic_move_stand", moves: medicMoves, stand: move("medic_move_stand"), walk: move("medic_move_walk"), run, attack, idle, sight: sound("medic/medsght1.wav"),
    search(context) { context.game.sound(context.entity, "medic/medsrch1.wav", 2, 1, 2); if (context.state.oldEnemy === null) acquire(context, true); return undefined; },
    checkAttack(context) { if (context.state.medic) { attack(context); return true; } return defaultCheckAttack(context); },
    pain(context) {
      damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      if (context.game.options.skill === 3) return undefined;
      const first = context.game.host.random() < 0.5;
      context.setMove(first ? "medic_move_pain1" : "medic_move_pain2");
      return context.game.sound(context.entity, first ? "medic/medpain1.wav" : "medic/medpain2.wav", 2);
    },
    die(context, reaction) {
      const target = context.game.entity(context.entity.enemy);
      if (target?.owner === context.entity.actor.id) target.owner = null;
      return beginDeath(context, reaction, "medic/meddeth1.wav", "medic_move_death");
    },
    dodge(context, attacker) {
      if (context.game.host.random() > 0.25) return undefined;
      context.entity.enemy ??= attacker;
      return context.setMove("medic_move_duck");
    },
    callbacks: {
      medic_idle: idle, medic_run: run, medic_dead: finishCorpse,
      medic_duck_down(context) { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; },
      medic_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
      medic_duck_up(context) { return setDuck(context, false); },
      medic_hook_launch: sound("medic/medatck2.wav", 1),
      medic_hook_retract(context) { context.game.sound(context.entity, "medic/medatck5.wav", 1); const target = context.entity.enemy === null ? null : monsters.context(context.entity.enemy); if (target !== null) target.state.resurrecting = false; return undefined; },
      medic_continue(context) { if (visible(context) && context.game.host.random() <= 0.95) context.setMove("medic_move_attackHyperBlaster"); return undefined; },
      medic_fire_blaster(context) {
        const aim = shot(context, 60); if (aim === null) return undefined;
        const frame = context.entity.frame;
        const effects = frame === medicFrame.attack9 || frame === medicFrame.attack12 ? 8 : frame === medicFrame.attack19 || frame === medicFrame.attack22 || frame === medicFrame.attack25 || frame === medicFrame.attack28 ? 64 : 0;
        context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 2, 1000, effects);
        return muzzle(context, 60, aim.direction, aim.start);
      },
      medic_cable_attack(context) {
        const { entity, game } = context, target = game.entity(entity.enemy);
        if (target === null) return undefined;
        const start = projectFlash(context, recordAt(cableOffsets, entity.frame - medicFrame.attack42)), body = game.body(target);
        const direction = subtract(start, body.origin); if (length(direction) > 256) return undefined;
        let pitch = vectorAngles(direction).x; if (pitch < -180) pitch += 360; if (Math.abs(pitch) > 45) return undefined;
        const trace = game.host.trace({ start, end: body.origin, bounds: null, ignore: entity.actor.id, mask: MASK_SHOT });
        if (trace.fraction !== 1 && (trace.hit.kind !== "actor" || trace.hit.actor !== target.actor.id)) return undefined;
        if (entity.frame === medicFrame.attack43) {
          game.host.emit({ kind: "sound", actor: target.actor.id, origin: body.origin, path: "medic/medatck3.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
          const patientContext = monsters.context(target.actor.id); if (patientContext !== null) patientContext.state.resurrecting = true;
        } else if (entity.frame === medicFrame.attack50) {
          target.spawnflags = 0; target.target = ""; target.targetname = ""; target.combatTarget = ""; target.deathTarget = ""; target.owner = entity.actor.id;
          const revived = monsters.respawn(target, game);
          target.owner = null;
          if (target.think !== null) { target.nextThink = game.host.now(); const think = target.think; think(target, game); }
          revived.state.resurrecting = true;
          if (context.state.oldEnemy !== null && game.host.isPlayer(context.state.oldEnemy)) { target.enemy = context.state.oldEnemy; monsters.foundTarget(revived); }
        } else if (entity.frame === medicFrame.attack44) game.sound(entity, "medic/medatck4.wav", 1);
        const current = game.body(target), end = { ...current.origin, z: current.origin.z + (current.bounds.min.z + current.bounds.max.z) / 2 };
        game.host.emit({ kind: "monster-beam", effect: "medic", actor: entity.actor.id, start: add(start, scale(anglesVectors(game.body(entity).angles).forward, 8)), end });
        return undefined;
      },
    },
  };
}
