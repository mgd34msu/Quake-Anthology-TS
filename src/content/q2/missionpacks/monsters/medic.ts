/* Quake II rogue/m_medic.c. ZeniMax Media, GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity } from "../../foundation/host.ts";
import { add, length, scale, subtract, zero } from "../../foundation/fields.ts";
import { anglesVectors, finishDodge, health, monsterSolidMask, projectFlash, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { defaultCheckAttack } from "../../foundation/monsters/perception.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import type { MonsterContext, MonsterHandler, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, finishCorpse, humanoidBounds, move, shot } from "../../base/monsters/common.ts";
import { blockedCheckPlatform, monsterFlash } from "../../rerelease/monsters/common.ts";
import { cleanupRogueHealTarget, rogueHealEffects } from "./combat.ts";
import { monsterMass, rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge, sourceTraceWorld } from "./rogue-common.ts";
import { checkRogueGroundSpawnPoint, checkRogueSpawnPoint, createRogueGroundMonster, findRogueSpawnPoint, rogueSpawnCallbacks, rogueSpawnGrow } from "./spawn.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { medicFrame, medicMoves } from "./tables/rogue-medic.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";

const cableOffsets: readonly Vec3[] = [
  { x: 45, y: -9.2, z: 15.5 }, { x: 48.4, y: -9.7, z: 15.2 }, { x: 47.8, y: -9.8, z: 15.8 },
  { x: 47.3, y: -9.3, z: 14.3 }, { x: 45.4, y: -10.1, z: 13.1 }, { x: 41.9, y: -12.7, z: 12 },
  { x: 37.8, y: -15.8, z: 11.2 }, { x: 34.3, y: -18.4, z: 10.7 }, { x: 32.7, y: -19.7, z: 10.4 }, { x: 32.7, y: -19.7, z: 10.4 },
];
const reinforcementPositions: readonly Vec3[] = [{ x: 80, y: 0, z: 0 }, { x: 40, y: 60, z: 0 }, { x: 40, y: -60, z: 0 }, { x: 0, y: 80, z: 0 }, { x: 0, y: -80, z: 0 }];
const reinforcements = ["monster_soldier_light", "monster_soldier", "monster_soldier_ss", "monster_infantry", "monster_gunner", "monster_medic", "monster_gladiator"];
function reinforcementBounds(index: number): Bounds { return index === 6 ? { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } } : humanoidBounds; }
function anglemod(angle: number): number { return (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536; }
export function pickRogueCoopTarget(context: MonsterContext): ActorId | null {
  const { game } = context;
  if (game.options.mode !== "coop") return null;
  const players = game.host.players().filter(actor => game.host.actors.isLive(actor) && game.host.isPlayer(actor) && visible(context, actor));
  return players.length === 0 ? null : recordAt(players, Math.min(players.length - 1, Math.floor(game.host.random() * players.length)));
}

export function createRogueMedicDefinitions(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  function medicSound(context: MonsterContext, normal: string, commander: string, channel = 2, attenuation = 1): undefined {
    return context.game.sound(context.entity, monsterMass(context) === 400 ? `medic/${normal}.wav` : `medic_commander/${commander}.wav`, channel, 1, attenuation);
  }
  function cleanup(context: MonsterContext, changeFrame: boolean): undefined {
    const target = context.game.entity(context.entity.enemy);
    if (target !== null) cleanupRogueHealTarget(monsters, source, target, context.game);
    if (changeFrame) context.state.nextFrame = medicFrame.attack52;
    return undefined;
  }
  function abort(context: MonsterContext, changeFrame: boolean, gib: boolean, mark: boolean): undefined {
    const { game, entity, state } = context;
    cleanup(context, changeFrame);
    const target = game.entity(entity.enemy);
    if (target !== null && mark) {
      const patient = source.get(target), previous = game.entity(patient.badMedic1);
      if (previous !== null && previous.classname.startsWith("monster_medic")) patient.badMedic2 = entity.actor.id;
      else patient.badMedic1 = entity.actor.id;
    }
    if (target !== null && gib) {
      const threshold = monsters.context(target.actor.id)?.state.gibHealth ?? 0;
      game.damage(target.actor.id, entity, entity.actor.id, threshold === 0 ? 500 : -threshold, 0, zero, game.body(target).origin, { x: 0, y: 0, z: 1 }, 0);
    }
    state.medic = false; entity.enemy = state.oldEnemy !== null && game.host.actors.isLive(state.oldEnemy) ? state.oldEnemy : null;
    source.get(entity).medicTries = 0;
    return undefined;
  }
  function findDead(context: MonsterContext): Q2Entity | null {
    const { game, entity, state } = context;
    let best: Q2Entity | null = null;
    for (const actor of game.host.nearby(game.body(entity).origin, state.standGround ? 400 : 1024)) {
      const target = game.entity(actor), candidate = monsters.context(actor);
      if (target === null || target === entity || (target.serverFlags & 4) === 0 || candidate?.state.goodGuy === true || target.classname.startsWith("player")) continue;
      const patient = source.get(target), healer = game.entity(patient.healer);
      if (patient.badMedic1 === entity.actor.id || patient.badMedic2 === entity.actor.id || healer !== null && health(game, healer.actor.id) > 0 && (healer.serverFlags & 4) !== 0 && monsters.context(healer.actor.id)?.state.medic === true) continue;
      if (health(game, actor) > 0 || target.nextThink !== null && target.think !== game.sourceCallbacks.think.resolve("M_FliesOn") && target.think !== game.sourceCallbacks.think.resolve("M_FliesOff") || !visible(context, actor)) continue;
      if (length(subtract(game.body(entity).origin, game.body(target).origin)) <= 32) continue;
      if (best === null || target.maxHealth > best.maxHealth) best = target;
    }
    if (best !== null) entity.timestamp = game.host.now() + 10;
    return best;
  }
  function acquire(context: MonsterContext): boolean {
    const target = findDead(context); if (target === null) return false;
    context.state.oldEnemy = context.entity.enemy; context.entity.enemy = target.actor.id;
    source.get(target).healer = context.entity.actor.id; context.state.medic = true;
    monsters.foundTarget(context);
    return true;
  }
  function run(context: MonsterContext): undefined {
    finishDodge(context);
    if (!context.state.medic && acquire(context)) return undefined;
    return context.setMove(context.state.standGround ? "medic_move_stand" : "medic_move_run");
  }
  function idle(context: MonsterContext): undefined { medicSound(context, "idle", "medidle", 2, 2); if (context.state.oldEnemy === null) acquire(context); return undefined; }
  function attack(context: MonsterContext): undefined {
    finishDodge(context);
    const { entity, game, state } = context, meleeRange = targetDistance(context) < 80, privateState = source.get(entity);
    if (privateState.blocked) { context.setMove("medic_move_callReinforcements"); privateState.blocked = false; }
    const random = game.host.random(), commander = monsterMass(context) > 400;
    if (state.medic) return context.setMove(commander && random > 0.8 && state.monsterSlots > 2 ? "medic_move_callReinforcements" : "medic_move_attackCable");
    return context.setMove(state.attackState === "blind" || commander && random > 0.2 && !meleeRange && state.monsterSlots > 2 ? "medic_move_callReinforcements" : "medic_move_attackBlaster");
  }
  function attacking(context: MonsterContext): boolean { return ["medic_move_attackHyperBlaster", "medic_move_attackCable", "medic_move_attackBlaster", "medic_move_callReinforcements"].includes(context.state.move.name); }
  function duck(context: MonsterContext, eta: number): undefined {
    const { state, game } = context;
    if (state.medic) return undefined;
    if (attacking(context)) { state.ducked = false; return undefined; }
    state.duckWait = game.host.now() + eta + (game.options.skill === 0 ? 1 : 0.1 * (3 - game.options.skill));
    rogueDuckDown(context); state.nextFrame = medicFrame.duck1;
    return context.setMove("medic_move_duck");
  }
  function sidestep(context: MonsterContext): undefined {
    if (attacking(context) && context.game.options.skill !== 0) { context.state.dodging = false; return undefined; }
    return context.state.move.name === "medic_move_run" ? undefined : context.setMove("medic_move_run");
  }
  function cable(context: MonsterContext): undefined {
    const { entity, game, state } = context, target = game.entity(entity.enemy);
    if (target === null || (target.effects & 2) !== 0 || game.host.isPlayer(target.actor.id) || health(game, target.actor.id) > 0) return abort(context, true, false, false);
    const start = projectFlash(context, recordAt(cableOffsets, entity.frame - medicFrame.attack42)), targetBody = game.body(target);
    if (length(subtract(start, targetBody.origin)) < 32) return abort(context, true, true, false);
    const trace = game.host.trace({ start, end: targetBody.origin, bounds: null, ignore: entity.actor.id, mask: 3 });
    if (trace.fraction !== 1 && (trace.hit.kind !== "actor" || trace.hit.actor !== target.actor.id)) {
      if (sourceTraceWorld(game, trace)) {
        if (source.get(entity).medicTries > 1) return abort(context, true, false, true);
        source.get(entity).medicTries++; return cleanup(context, true);
      }
      return abort(context, true, false, false);
    }
    if (entity.frame === medicFrame.attack43) {
      game.sound(target, monsterMass(context) === 400 ? "medic/medatck3.wav" : "medic_commander/medatck3a.wav", 0);
      const patient = monsters.context(target.actor.id);
      if (patient !== null) { patient.state.resurrecting = true; patient.state.canTakeDamage = false; rogueHealEffects(patient); }
      game.host.combat.setTraits(target.actor, { canTakeDamage: false });
    } else if (entity.frame === medicFrame.attack50) {
      target.spawnflags = 0; target.target = ""; target.targetname = ""; target.combatTarget = ""; target.deathTarget = "";
      const previous = monsters.context(target.actor.id);
      if (previous !== null) {
        const flags = previous.state;
        flags.ignoreShots = false; flags.doNotCount = false; flags.spawnedBy = "none"; flags.goodGuy = false; flags.targetAnger = false;
        flags.brutal = false; flags.medic = false; flags.resurrecting = false; flags.standGround = false; flags.temporaryStandGround = false;
        flags.holdFrame = false; flags.ducked = false; flags.dodging = false; flags.charging = false; flags.manualSteering = false;
        flags.combatPoint = false; flags.lostSight = false; flags.pursueNext = false; flags.pursueTemporary = false; flags.pursuitLastSeen = false; flags.soundTarget = null;
      }
      source.get(target).healer = entity.actor.id;
      const clear = game.host.trace({ start: targetBody.origin, end: targetBody.origin, bounds: { ...targetBody.bounds, max: { ...targetBody.bounds.max, z: targetBody.bounds.max.z + 48 } }, ignore: target.actor.id, mask: monsterSolidMask(game) });
      if (clear.startSolid || clear.allSolid || !sourceTraceWorld(game, clear)) return abort(context, true, true, false);
      if (previous !== null) previous.state.doNotCount = true;
      const revived = monsters.respawn(target, game);
      if (target.think !== null) { target.nextThink = game.host.now(); target.think(target, game); }
      revived.state.resurrecting = false; revived.state.ignoreShots = true; revived.state.doNotCount = true;
      target.effects &= ~0x4000; source.get(target).healer = null;
      if (state.oldEnemy !== null && game.host.actors.isLive(state.oldEnemy) && health(game, state.oldEnemy) > 0) { target.enemy = state.oldEnemy; monsters.foundTarget(revived); }
      else {
        target.enemy = null;
        if (!revived.findTarget()) { revived.state.pauseTime = game.host.now() + 100000000; revived.stand(); }
        entity.enemy = null; state.oldEnemy = null;
        if (!context.findTarget()) { state.pauseTime = game.host.now() + 100000000; return context.stand(); }
      }
    } else if (entity.frame === medicFrame.attack44) medicSound(context, "medatck4", "medatck4a", 1);
    const currentTarget = game.entity(entity.enemy);
    if (currentTarget === null) return undefined;
    const body = game.body(currentTarget);
    return game.host.emit({ kind: "monster-beam", effect: "medic", actor: entity.actor.id, start: add(start, scale(anglesVectors(game.body(entity).angles).forward, 8)), end: { ...body.origin, z: body.origin.z + (body.bounds.min.z + body.bounds.max.z) / 2 } });
  }
  function eachSpawn(context: MonsterContext, behind: boolean, visit: (point: Vec3, bounds: Bounds, index: number) => boolean): undefined {
    const strength = source.get(context.entity).summonStrength, count = strength === 0 ? 1 : strength - 1 + strength % 2;
    for (let i = 0; i < count; i++) {
      const index = strength - i - i % 2, position = recordAt(reinforcementPositions, i), bounds = reinforcementBounds(index);
      const point = projectFlash(context, behind ? { x: -position.x, y: -position.y, z: position.z } : position);
      const spawn = findRogueSpawnPoint(context.game, { ...point, z: point.z + 10 }, bounds, 32);
      if (spawn !== null && visit(spawn, bounds, index)) break;
    }
    return undefined;
  }
  const callbacks: Readonly<Record<string, MonsterHandler>> = {
    medic_idle: idle, medic_run: run, medic_dead: finishCorpse, monster_done_dodge: finishDodge,
    monster_duck_down: rogueDuckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp,
    medic_hook_launch: context => medicSound(context, "medatck2", "medatck2c", 1),
    medic_hook_retract(context) {
      medicSound(context, "medatck5", "medatck5a", 1); context.state.medic = false;
      if (context.state.oldEnemy !== null && context.game.host.actors.isLive(context.state.oldEnemy)) context.entity.enemy = context.state.oldEnemy;
      else { context.entity.enemy = null; context.state.oldEnemy = null; if (!context.findTarget()) { context.state.pauseTime = context.game.host.now() + 100000000; context.stand(); } }
      return undefined;
    },
    medic_cable_attack: cable,
    medic_continue(context) { if (visible(context) && context.game.host.random() <= 0.95) context.setMove("medic_move_attackHyperBlaster"); return undefined; },
    medic_fire_blaster(context) {
      const aim = shot(context, 60); if (aim === null) return undefined;
      const frame = context.entity.frame, effects = frame === medicFrame.attack9 || frame === medicFrame.attack12 ? 8 : frame === medicFrame.attack19 || frame === medicFrame.attack22 || frame === medicFrame.attack25 || frame === medicFrame.attack28 ? 64 : 0;
      const damage = context.game.entity(context.entity.enemy)?.classname === (context.game.options.edition === "rerelease" ? "tesla_mine" : "tesla") ? 3 : 2, commander = monsterMass(context) > 400;
      if (commander) weapons.fireBlaster2(context.entity, context.game, aim.start, aim.direction, damage, 1000, effects);
      else context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, damage, 1000, effects);
      return monsterFlash(context, commander ? 146 : 60, aim.start, aim.direction);
    },
    medic_start_spawn(context) { context.game.sound(context.entity, "medic_commander/monsterspawn1.wav", 1); context.state.nextFrame = medicFrame.attack48; return undefined; },
    medic_determine_spawn(context) {
      const lucky = context.game.host.random(), strength = context.game.options.skill + (lucky < 0.05 ? -3 : lucky < 0.15 ? -2 : lucky < 0.3 ? -1 : lucky > 0.95 ? 3 : lucky > 0.85 ? 2 : lucky > 0.7 ? 1 : 0);
      source.get(context.entity).summonStrength = Math.max(0, strength);
      let success = false;
      const check = (point: Vec3, bounds: Bounds): boolean => { success = checkRogueGroundSpawnPoint(context.game, point, bounds, 256, -1); return success; };
      eachSpawn(context, false, check);
      if (!success) { eachSpawn(context, true, check); if (success) { context.state.manualSteering = true; context.state.idealYaw = anglemod(context.game.body(context.entity).angles.y) + 180; if (context.state.idealYaw > 360) context.state.idealYaw -= 360; } }
      if (!success) context.state.nextFrame = medicFrame.attack53;
      return undefined;
    },
    medic_spawngrows(context) {
      if (context.state.manualSteering) {
        if (Math.abs(anglemod(context.game.body(context.entity).angles.y) - context.state.idealYaw) > 0.1) { context.state.holdFrame = true; return undefined; }
        context.state.holdFrame = false; context.state.manualSteering = false;
      }
      let success = false;
      eachSpawn(context, false, (point, bounds, index) => { if (checkRogueGroundSpawnPoint(context.game, point, bounds, 256, -1)) { success = true; rogueSpawnGrow(context.game, point, index > 3 ? 1 : 0); } return false; });
      if (!success) context.state.nextFrame = medicFrame.attack53;
      return undefined;
    },
    medic_finish_spawn(context) {
      const { entity, game, state } = context;
      source.get(entity).summonStrength = Math.abs(source.get(entity).summonStrength);
      return eachSpawn(context, false, (point, bounds, index) => {
        if (!checkRogueSpawnPoint(game, point, bounds)) return false;
        const child = createRogueGroundMonster(monsters, game, point, game.body(entity).angles, bounds, recordAt(reinforcements, index), 256);
        if (child === null) return false;
        if (child.think !== null) { child.nextThink = game.host.now(); child.think(child, game); }
        const childContext = monsters.context(child.actor.id); if (childContext === null) throw new Error("Medic reinforcement has no shared controller");
        childContext.state.ignoreShots = true; childContext.state.doNotCount = true; childContext.state.spawnedBy = "medic"; childContext.state.commander = entity.actor.id; state.monsterSlots--;
        let enemy = state.medic ? state.oldEnemy : entity.enemy;
        if (game.options.mode === "coop") { enemy = pickRogueCoopTarget(childContext); if (enemy === entity.enemy && enemy !== null) enemy = pickRogueCoopTarget(childContext); enemy ??= entity.enemy; }
        if (enemy !== null && game.host.actors.isLive(enemy) && health(game, enemy) > 0) { child.enemy = enemy; monsters.foundTarget(childContext); }
        else { child.enemy = null; childContext.stand(); }
        return false;
      });
    },
  };
  const base: Q2MonsterDefinition = {
    classname: "monster_medic", kind: "medic", model: "models/monsters/medic/tris.md2", health: 300, gibHealth: -130, mass: 400,
    bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 32 } }, scale: 1, initialMove: "medic_move_stand", moves: medicMoves,
    stand: move("medic_move_stand"), walk: move("medic_move_walk"), run, attack, idle, callbacks, sourceCallbacks: rogueSpawnCallbacks,
    sight: context => medicSound(context, "medsght1", "medsght"),
    search(context) { medicSound(context, "medsrch1", "medsrch", 2, 2); if (context.state.oldEnemy === null) acquire(context); return undefined; },
    initialize(context) { context.state.ignoreShots = true; if (monsterMass(context) > 400) { context.entity.skin = 2; context.state.monsterSlots = context.game.options.skill === 0 ? 3 : context.game.options.skill === 1 ? 4 : 6; } return undefined; },
    pain(context, reaction) {
      const { entity, game, state } = context, commander = monsterMass(context) > 400;
      finishDodge(context); if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin = commander ? 3 : 1;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3; if (game.options.skill === 3 || state.medic) return undefined;
      if (commander) {
        if (reaction.damage < 35) return medicSound(context, "medpain1", "medpain1");
        state.manualSteering = false; state.holdFrame = false; medicSound(context, "medpain2", "medpain2");
        context.setMove(game.host.random() < Math.min(reaction.damage * 0.005, 0.5) ? "medic_move_pain2" : "medic_move_pain1");
      } else { const first = game.host.random() < 0.5; context.setMove(first ? "medic_move_pain1" : "medic_move_pain2"); medicSound(context, first ? "medpain1" : "medpain2", "medpain2"); }
      if (state.ducked) rogueDuckUp(context);
      return undefined;
    },
    die(context, reaction) { return beginDeath(context, reaction, monsterMass(context) === 400 ? "medic/meddeth1.wav" : "medic_commander/meddeth.wav", "medic_move_death"); },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, duck, sidestep); },
    duck(context, eta) { duck(context, eta); return true; }, sidestep(context) { sidestep(context); return true; },
    blocked(context, distance) { return rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source) || blockedCheckPlatform(context, distance); },
    checkAttack(context) {
      const { game, entity, state } = context;
      if (state.medic) {
        if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) { abort(context, true, false, false); return false; }
        if (entity.timestamp < game.host.now()) { abort(context, true, false, true); entity.timestamp = 0; return false; }
        if (targetDistance(context) < 410) { attack(context); return true; }
        state.attackState = "straight"; return false;
      }
      if (entity.enemy !== null && game.host.isPlayer(entity.enemy) && !visible(context) && state.monsterSlots > 2) { state.attackState = "blind"; return true; }
      if (game.host.random() < 0.8 && state.monsterSlots > 5 && targetDistance(context) > 150) { source.get(entity).blocked = true; state.attackState = "missile"; return true; }
      if (game.options.skill > 0 && state.standGround) { state.attackState = "missile"; return true; }
      return defaultCheckAttack(context);
    },
  };
  return [base, { ...base, classname: "monster_medic_commander", kind: "medic_commander", health: 600, mass: 600, yawSpeed: 40 }];
}
