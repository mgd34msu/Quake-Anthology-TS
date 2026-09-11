/* Quake II xatrix/m_fixbot.c. ZeniMax Media, GPL-2.0-or-later. */
import type { OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, scale, subtract, zero } from "../../foundation/fields.ts";
import { freeQ2Entity } from "../../foundation/callbacks.ts";
import type { Q2Entity } from "../../foundation/host.ts";
import { anglesVectors, changeYaw, health, inFront, MASK_SHOT, monsterSolidMask, projectFlash, runAi, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { explode, finishCorpse, move, muzzle, shot } from "../../base/monsters/common.ts";
import { monsterDabeam } from "./dabeam.ts";
import { fixbotFrame, fixbotMoves } from "./tables/xatrix-fixbot.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "fixbot_move_stand" : "fixbot_move_run"); }
function goal(context: MonsterContext): Q2Entity {
  const entity = context.game.entity(context.entity.goal);
  if (entity === null) throw new Error("Fixbot source movement requires its bot goal");
  return entity;
}
function turn(context: MonsterContext): number {
  const direction = subtract(context.game.body(goal(context)).origin, context.game.body(context.entity).origin);
  context.state.idealYaw = vectorAngles(direction).y; changeYaw(context);
  return Math.trunc(length(direction));
}
function leaveGoal(context: MonsterContext): undefined {
  const target = goal(context); context.game.schedule(target, 0.1, freeQ2Entity);
  context.entity.goal = null; context.entity.enemy = null;
  return context.setMove("fixbot_move_stand");
}
function verticalGoal(context: MonsterContext, landing: boolean): undefined {
  const { game, entity } = context, target = game.create("bot_goal"), body = game.body(entity);
  target.owner = entity.actor.id; game.solid(target, "box");
  const bounds = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 24 } };
  const end = add(body.origin, scale(anglesVectors(body.angles).up, landing ? -8096 : 128));
  const trace = game.host.trace({ start: body.origin, end, bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
  game.move(target, { origin: trace.end, bounds }, false); entity.goal = entity.enemy = target.actor.id;
  return context.setMove(landing ? "fixbot_move_landing" : "fixbot_move_takeoff");
}

export function createFixbotDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  // Scratch belongs to the source AI/callback pair within one uninterrupted frame.
  const beforeMove = new WeakMap<OwnedActor, Vec3>();
  function search(context: MonsterContext): boolean {
    if (context.entity.goal !== null) return false;
    let best: Q2Entity | null = null;
    for (const actor of context.game.host.nearby(context.game.body(context.entity).origin, 1024)) {
      const candidate = context.game.entity(actor), state = monsters.context(actor)?.state;
      if (candidate === null || candidate === context.entity || (candidate.serverFlags & 4) === 0 || state?.goodGuy === true || candidate.owner !== null || health(context.game, actor) > 0 || candidate.nextThink !== null || !visible(context, actor)) continue;
      if (best === null || candidate.maxHealth > best.maxHealth) best = candidate;
    }
    if (best === null) return false;
    context.state.oldEnemy = context.entity.enemy; context.entity.enemy = best.actor.id; best.owner = context.entity.actor.id; context.state.medic = true;
    monsters.foundTarget(context); return true;
  }
  function attack(context: MonsterContext): undefined {
    if (context.state.medic) {
      if (!visible(context, context.entity.goal)) return undefined;
      const enemy = context.entity.enemy === null ? null : context.game.host.bodies.read(context.entity.enemy); if (enemy === null || length(subtract(context.game.body(context.entity).origin, enemy.origin)) > 128) return undefined;
      return context.setMove("fixbot_move_laserattack");
    }
    return context.setMove("fixbot_move_attack2");
  }
  return {
    classname: "monster_fixbot", kind: "fixbot", model: "models/monsters/fixbot/tris.md2", health: 150, gibHealth: 0, mass: 150,
    bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 24 } }, scale: 1, locomotion: "fly",
    initialMove: "fixbot_move_stand", moves: fixbotMoves, stand: move("fixbot_move_stand"), run, attack,
    sourceCallbacks: { think: { G_FreeEdict: freeQ2Entity } },
    walk(context) {
      const target = goal(context);
      return context.setMove(target.classname === "object_repair" && length(subtract(context.game.body(context.entity).origin, context.game.body(target).origin)) < 32 ? "fixbot_move_weld_start" : "fixbot_move_walk");
    },
    pain(context, reaction) {
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3; context.game.sound(context.entity, "flyer/flypain1.wav", 2);
      return context.setMove(reaction.damage <= 10 ? "fixbot_move_pain3" : reaction.damage <= 25 ? "fixbot_move_painb" : "fixbot_move_paina");
    },
    die(context) { return explode(context, "flyer/flydeth1.wav"); },
    ai: {
      ai_move2(context, distance) { if (distance !== 0) runAi(context, "move", distance); turn(context); return undefined; },
      ai_movetogoal(context, distance) { beforeMove.set(context.entity.actor, context.game.body(context.entity).origin); context.moveToGoal(distance); return undefined; },
      ai_facing(context) { if (inFront(context, goal(context).actor.id)) return context.setMove("fixbot_move_forward"); turn(context); return undefined; },
    },
    callbacks: {
      fixbot_run: run, fixbot_dead: finishCorpse, fixbot_attack: attack,
      change_to_roam(context) {
        if (search(context)) return undefined;
        context.setMove("fixbot_move_roamgoal");
        if ((context.entity.spawnflags & 16) !== 0) { verticalGoal(context, true); context.entity.spawnflags = 32; }
        if ((context.entity.spawnflags & 8) !== 0) { verticalGoal(context, false); context.entity.spawnflags = 32; }
        if ((context.entity.spawnflags & 4) !== 0) { context.setMove("fixbot_move_roamgoal"); context.entity.spawnflags = 32; }
        if (context.entity.spawnflags === 0) context.setMove("fixbot_move_stand2");
        return undefined;
      },
      roam_goal(context) {
        const { entity, game } = context, body = game.body(entity), target = game.create("bot_goal"); target.owner = entity.actor.id; game.solid(target, "box");
        let distance = 0, chosen = zero;
        for (let i = 0; i < 12; i++) {
          const angles = { ...body.angles, y: body.angles.y + (i < 6 ? i * 30 : -(i - 6) * 30) };
          const trace = game.host.trace({ start: body.origin, end: add(body.origin, scale(anglesVectors(angles).forward, 8192)), bounds: null, ignore: entity.actor.id, mask: MASK_SHOT });
          const size = Math.trunc(length(subtract(body.origin, trace.end))); if (size > distance) { distance = size; chosen = trace.end; }
        }
        game.move(target, { origin: chosen }, false); entity.goal = entity.enemy = target.actor.id;
        return context.setMove("fixbot_move_turn");
      },
      fly_vertical2(context) { return turn(context) < 32 ? leaveGoal(context) : undefined; },
      fly_vertical(context) {
        turn(context);
        if (context.entity.frame === fixbotFrame.landing_58 || context.entity.frame === fixbotFrame.takeoff_16) leaveGoal(context);
        const body = context.game.body(context.entity), direction = anglesVectors({ ...body.angles, x: body.angles.x + 90 }).forward, spread = 500 + context.entity.frame - fixbotFrame.takeoff_01;
        for (let i = 0; i < 10; i++) context.weapons.fireShotgun(context.entity, context.game, body.origin, direction, 2, 1, spread, spread, 1, 37);
        return undefined;
      },
      use_scanner(context) {
        const { entity, game } = context;
        for (const actor of game.host.nearby(game.body(entity).origin, 1024)) {
          const candidate = game.entity(actor);
          if (candidate === null || health(game, actor) < 100 || candidate.classname !== "object_repair" || !visible(context, actor)) continue;
          const old = goal(context); if (old.classname === "bot_goal") game.schedule(old, 0.1, freeQ2Entity);
          entity.goal = entity.enemy = actor;
          if (length(subtract(game.body(entity).origin, game.body(candidate).origin)) < 32) context.setMove("fixbot_move_weld_start");
          return undefined;
        }
        const target = goal(context);
        if (length(subtract(game.body(entity).origin, game.body(target).origin)) < 32) return target.classname === "object_repair" ? context.setMove("fixbot_move_weld_start") : leaveGoal(context);
        const previous = beforeMove.get(entity.actor); if (previous === undefined) throw new Error("Fixbot scanner must follow source movement in the same frame");
        if (Math.trunc(length(subtract(game.body(entity).origin, previous))) === 0) return target.classname === "object_repair" ? context.setMove("fixbot_move_stand") : leaveGoal(context);
        return undefined;
      },
      weldstate(context) {
        if (context.entity.frame === fixbotFrame.weldstart_10) return context.setMove("fixbot_move_weld");
        if (context.entity.frame === fixbotFrame.weldmiddle_07) {
          const target = goal(context), hp = health(context.game, target.actor.id);
          if (hp < 0) { const enemy = context.game.entity(context.entity.enemy); if (enemy !== null) enemy.owner = null; return context.setMove("fixbot_move_weld_end"); }
          return context.game.host.combat.setHealth(target.actor, hp - 10);
        }
        context.entity.goal = context.entity.enemy = null; return context.setMove("fixbot_move_stand");
      },
      fixbot_fire_welder(context) {
        if (context.entity.enemy === null) return undefined;
        context.game.host.emit({ kind: "effect", effect: "q2:welding-sparks", origin: projectFlash(context, { x: 24, y: -0.8, z: -10 }), direction: zero, count: 10, color: 0xe0 + Math.floor(context.game.host.random() * 8) });
        if (context.game.host.random() > 0.8) { const r = context.game.host.random(); context.game.sound(context.entity, r < 0.33 ? "misc/welder1.wav" : r < 0.66 ? "misc/welder2.wav" : "misc/welder3.wav", 2, 1, 2); }
        return undefined;
      },
      fixbot_fire_blaster(context) {
        if (!visible(context)) context.setMove("fixbot_move_run");
        const aim = shot(context, 58); if (aim === null) return undefined;
        context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 15, 1000, 8);
        return muzzle(context, 58, aim.direction, aim.start);
      },
      fixbot_fire_laser(context) {
        const { entity, game } = context, target = game.entity(entity.enemy); if (target === null) return undefined;
        const patient = monsters.context(target.actor.id); if (patient === null) return undefined;
        if (health(game, target.actor.id) <= patient.state.gibHealth) { context.state.medic = false; return context.setMove("fixbot_move_stand"); }
        game.sound(entity, "misc/lasfly.wav", 0, 1, 3);
        const body = game.body(entity), targetBody = game.body(target), angles = vectorAngles(subtract(targetBody.origin, body.origin));
        monsterDabeam(entity, game, target.actor.id, add(body.origin, scale(anglesVectors(angles).forward, 16)), angles, -1, true);
        if (health(game, target.actor.id) <= (game.host.combat.read(target.actor.id)?.mass ?? 0) / 10) { patient.state.resurrecting = true; return undefined; }
        const trace = game.host.trace({ start: targetBody.origin, end: scale(anglesVectors(targetBody.angles).up, 48), bounds: targetBody.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
        if (trace.hit.kind === "actor" && game.host.combat.read(trace.hit.actor)?.canTakeDamage === true) {
          const victim = game.host.actors.resolveOwned(trace.hit.actor); if (victim !== null) game.host.combat.setHealth(victim, -1000);
          return undefined;
        }
        target.spawnflags = 0; target.target = target.targetname = target.combatTarget = target.deathTarget = ""; target.owner = entity.actor.id;
        const restored = monsters.respawn(target, game); target.owner = null; restored.state.resurrecting = false;
        game.move(entity, { origin: { ...body.origin, z: body.origin.z + 1 } }, false); context.state.medic = false;
        return context.setMove("fixbot_move_stand");
      },
    },
  };
}
