// Rerelease m_medic.cpp. ZeniMax Media, GPL-2.0.
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import { numberField } from "../../../foundation/fields.ts";
import { findRereleaseSpawnPoint, checkRereleaseGroundSpawnPoint } from "../spawn-placement.ts";
import { monsterPowerArmor } from "../../../missionpacks/monsters/power-armor.ts";
import { pickRogueCoopTarget } from "../../../missionpacks/monsters/medic.ts";
import type { Bounds, Vec3 } from "../../../../../contracts/math.ts";
import type { Q2Entity, Q2Think } from "../../../foundation/host.ts";
import { add, length, scale, subtract, zero } from "../../../foundation/fields.ts";
import { anglesVectors, corpse, finishDodge, health, setDuck, monsterSolidMask, projectFlash, targetDistance, visible } from "../../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import { defaultCheckAttack } from "../../../foundation/monsters/perception.ts";
import { recordAt } from "../../../foundation/monsters/types.ts";
import type { MonsterContext, MonsterHandler, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { move, shot } from "../../../base/monsters/common.ts";
import { blockedCheckPlatform, chainfist, checkGib, monsterFlash, reactsToPain, rereleaseRandom } from "../common.ts";
import { cleanupRogueHealTarget, rogueHealEffects } from "../../../missionpacks/monsters/combat.ts";
import { monsterMass, sourceTraceWorld } from "../../../missionpacks/monsters/rogue-common.ts";
import { checkRogueSpawnPoint, createRogueMonster } from "../../../missionpacks/monsters/spawn.ts";
import type { Q2MissionPackMonsterState } from "../../../missionpacks/monsters/state.ts";
import { medicFrame, medicMoves } from "../tables/medic.ts";
import type { Q2MissionPackMonsterWeapons } from "../../../missionpacks/monsters/types.ts";

const cableOffsets: readonly Vec3[] = [
  { x: 45, y: -9.2, z: 15.5 }, { x: 48.4, y: -9.7, z: 15.2 }, { x: 47.8, y: -9.8, z: 15.8 },
  { x: 47.3, y: -9.3, z: 14.3 }, { x: 45.4, y: -10.1, z: 13.1 }, { x: 41.9, y: -12.7, z: 12 },
  { x: 37.8, y: -15.8, z: 11.2 }, { x: 34.3, y: -18.4, z: 10.7 }, { x: 32.7, y: -19.7, z: 10.4 }, { x: 32.7, y: -19.7, z: 10.4 },
];
const reinforcementPositions: readonly Vec3[] = [{ x: 80, y: 0, z: 0 }, { x: 40, y: 60, z: 0 }, { x: 40, y: -60, z: 0 }, { x: 0, y: 80, z: 0 }, { x: 0, y: -80, z: 0 }];
const defaultReinforcements = "monster_soldier_light 1;monster_soldier 2;monster_soldier_ss 2;monster_infantry 3;monster_gunner 4;monster_medic 5;monster_gladiator 6";
interface Reinforcement { readonly classname: string; readonly strength: number; readonly bounds: Bounds; }
function anglemod(angle: number): number { return (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536; }
const spawnGrowLaserThink: Q2Think = (beam, game) => {
  const owner = game.entity(beam.owner);
  if (owner === null) return game.remove(beam);
  const theta = game.host.random() * 2 * Math.PI, phi = Math.acos(game.host.random() * 2 - 1);
  beam.pos2 = add(game.body(beam).origin, scale({ x: Math.sin(phi) * Math.cos(theta), y: Math.sin(phi) * Math.sin(theta), z: Math.cos(phi) }, owner.scale * 9));
  game.link(beam);
  game.host.emit({ kind: "beam", actor: beam.actor.id, start: game.body(beam).origin, end: beam.pos2, width: 1, color: beam.skin, visible: true });
  return game.schedule(beam, 0.001, spawnGrowLaserThink);
};
const spawnGrowThink: Q2Think = (entity, game) => {
  if (game.host.now() >= entity.timestamp) {
    const beam = game.entity(entity.beam);
    if (beam !== null) { game.host.emit({ kind: "beam", actor: beam.actor.id, start: game.body(beam).origin, end: beam.pos2, width: 1, color: beam.skin, visible: false }); game.remove(beam); }
    return game.remove(entity);
  }
  game.move(entity, { angles: add(game.body(entity).angles, scale(entity.angularVelocity, game.host.frameSeconds())) });
  const t = 1 - (game.host.now() - (entity.timestamp - entity.wait)) / entity.wait;
  entity.scale = Math.max(0.001, Math.min(16, (entity.decel + t * (entity.accel - entity.decel)) / 16));
  entity.alpha = t * t;
  game.show(entity);
  return game.schedule(entity, 0.1, spawnGrowThink);
};
function spawnGrow(context: MonsterContext, origin: Vec3, radius: number): undefined {
  const { game } = context, random = rereleaseRandom(context), entity = game.create("spawngro");
  game.move(entity, { origin, angles: { x: random.integer(360), y: random.integer(360), z: random.integer(360) } }, false);
  entity.angularVelocity = { x: random.float(280, 360) * 2, y: random.float(280, 360) * 2, z: random.float(280, 360) * 2 };
  entity.model = "models/items/spawngro3/tris.md2"; entity.renderFlags = 32768; entity.skin = 1;
  entity.accel = radius; entity.decel = radius * 2; entity.scale = Math.max(0.001, Math.min(8, radius / 16));
  entity.wait = 1; entity.timestamp = game.host.now() + 1;
  game.solid(entity, "none"); game.motion(entity, "stationary"); game.schedule(entity, 0.1, spawnGrowThink); game.link(entity); game.show(entity);
  const beam = game.create("spawngro_beam"); entity.beam = beam.actor.id; beam.owner = entity.actor.id;
  beam.frame = 1; beam.skin = 0x30303030; beam.renderFlags = 128 | 512 | 64;
  game.move(beam, { origin }, false); spawnGrowLaserThink(beam, game);
  return undefined;
}

export function createRereleaseMedicDefinitions(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  function medicSound(context: MonsterContext, normal: string, commander: string, channel = 2, attenuation = 1): undefined {
    return context.game.sound(context.entity, monsterMass(context) === 400 ? `medic/${normal}.wav` : `medic_commander/${commander}.wav`, channel, 1, attenuation);
  }
  function restoreEnemy(context: MonsterContext): boolean {
    if (context.state.oldEnemy !== null && health(context.game, context.state.oldEnemy) > 0) {
      context.entity.enemy = context.state.oldEnemy; monsters.huntTarget(context);
    } else {
      context.entity.enemy = null; context.entity.goal = null; context.state.oldEnemy = null;
      if (!context.findTarget()) { context.state.pauseTime = 100000000; context.stand(); return false; }
    }
    return true;
  }
  function cleanup(context: MonsterContext, changeFrame: boolean): undefined {
    const target = context.game.entity(context.entity.enemy);
    if (target !== null) cleanupRogueHealTarget(monsters, source, target, context.game);
    if (!restoreEnemy(context)) return undefined;
    if (changeFrame) context.state.nextFrame = medicFrame.attack52;
    return undefined;
  }
  function abort(context: MonsterContext, changeFrame: boolean, gib: boolean, mark: boolean): undefined {
    const { game, entity, state } = context;
    const target = game.entity(entity.enemy);
    if (target !== null) cleanupRogueHealTarget(monsters, source, target, game);
    if (target !== null && mark) {
      const patient = source.get(target), previous = game.entity(patient.badMedic1);
      if (previous !== null && previous.classname.startsWith("monster_medic")) patient.badMedic2 = entity.actor.id;
      else patient.badMedic1 = entity.actor.id;
    }
    if (target !== null && gib) {
      const threshold = monsters.context(target.actor.id)?.state.gibHealth ?? 0;
      game.damage(target.actor.id, entity, entity.actor.id, threshold === 0 ? 500 : -threshold, 0, zero, game.body(target).origin, { x: 0, y: 0, z: 1 }, 0);
    }
    cleanup(context, changeFrame); state.medic = false;
    source.get(entity).medicTries = 0;
    return undefined;
  }
  function findDead(context: MonsterContext): Q2Entity | null {
    const { game, entity, state } = context;
    if (source.get(entity).reactToDamageTime > game.host.now()) return null;
    let best: Q2Entity | null = null;
    for (const actor of game.host.nearby(game.body(entity).origin, state.standGround ? 400 : 1024)) {
      const target = game.entity(actor), candidate = monsters.context(actor);
      if (target === null || target === entity || (target.serverFlags & 4) === 0 || candidate?.state.goodGuy === true || target.classname.startsWith("player")) continue;
      const patient = source.get(target), healer = game.entity(patient.healer);
      if (patient.badMedic1 === entity.actor.id || patient.badMedic2 === entity.actor.id || healer !== null && health(game, healer.actor.id) > 0 && (healer.serverFlags & 4) !== 0 && monsters.context(healer.actor.id)?.state.medic === true) continue;
      if (health(game, actor) > 0 || target.nextThink !== null && target.think !== game.sourceCallbacks.think.resolve("monster_dead_think") || !visible(context, actor)) continue;
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
    if (state.medic) return context.setMove(commander && random > 0.8 && state.monsterSlots > state.monsterUsed ? "medic_move_callReinforcements" : "medic_move_attackCable");
    return context.setMove(state.attackState === "blind" || commander && random > 0.2 && !meleeRange && state.monsterSlots > state.monsterUsed ? "medic_move_callReinforcements" : "medic_move_attackBlaster");
  }
  function attacking(context: MonsterContext): boolean { return ["medic_move_attackHyperBlaster", "medic_move_attackCable", "medic_move_attackBlaster", "medic_move_callReinforcements"].includes(context.state.move.name); }
  function cable(context: MonsterContext): undefined {
    const { entity, game, state } = context, target = game.entity(entity.enemy);
    if (target === null || (target.effects & 2) !== 0) return abort(context, false, false, false);
    if (game.host.isPlayer(target.actor.id)) return undefined;
    if (health(game, target.actor.id) > 0) return abort(context, false, false, false);
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
      target.spawnflags = 0; target.target = ""; target.targetname = ""; target.combatTarget = ""; target.deathTarget = ""; target.healthTarget = ""; target.itemTarget = "";
      const previous = monsters.context(target.actor.id);
      if (previous !== null) {
        const flags = previous.state;
        flags.ignoreShots = false; flags.doNotCount = false; flags.goodGuy = false; flags.targetAnger = false;
        flags.brutal = false; flags.medic = false; flags.resurrecting = false; flags.standGround = false; flags.temporaryStandGround = false;
        flags.holdFrame = false; flags.ducked = false; flags.dodging = false; flags.charging = false; flags.manualSteering = false;
        flags.combatPoint = false; flags.lostSight = false; flags.pursueNext = false; flags.pursueTemporary = false; flags.pursuitLastSeen = false; flags.soundTarget = null;
      }
      source.get(target).healer = entity.actor.id;
      const clear = game.host.trace({ start: targetBody.origin, end: targetBody.origin, bounds: { ...targetBody.bounds, max: { ...targetBody.bounds.max, z: targetBody.bounds.max.z + 48 } }, ignore: target.actor.id, mask: monsterSolidMask(game) });
      if (clear.startSolid || clear.allSolid || !sourceTraceWorld(game, clear)) return abort(context, true, true, false);
      if (previous !== null) previous.state.doNotCount = true;
      const maxHealth = target.maxHealth, gibHealth = previous?.state.gibHealth ?? 0;
      const slots = previous?.state.monsterSlots ?? 0, used = previous?.state.monsterUsed ?? 0;
      const spawnedBy = previous?.state.spawnedBy ?? "none", commander = previous?.state.commander ?? null;
      const initialPowerArmorType = previous?.state.initialPowerArmorType ?? "none";
      const maxPowerArmorPower = previous?.state.maxPowerArmorPower ?? 0;
      const baseHealth = previous?.state.baseHealth ?? maxHealth, healthScaling = previous?.state.healthScaling ?? 1;
      const revived = monsters.respawn(target, game);
      if (initialPowerArmorType === "none") {
        game.host.combat.setArmor(target.actor, { kind: "none" });
        if (game.host.inventory.has(target.actor.id)) game.host.inventory.configure(target.actor, { item: "q2:monster-power", count: maxPowerArmorPower, capacity: maxPowerArmorPower });
      } else monsterPowerArmor(revived, initialPowerArmorType, maxPowerArmorPower);
      revived.state.initialPowerArmorType = initialPowerArmorType; revived.state.maxPowerArmorPower = maxPowerArmorPower;
      revived.state.baseHealth = baseHealth; revived.state.healthScaling = healthScaling;
      target.maxHealth = maxHealth; game.host.combat.setHealth(target.actor, maxHealth);
      revived.state.gibHealth = Math.trunc(gibHealth / 2); revived.state.monsterSlots = slots; revived.state.monsterUsed = used;
      revived.state.spawnedBy = spawnedBy; revived.state.commander = commander;
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
      cleanup(context, false); return undefined;
    } else if (entity.frame === medicFrame.attack44) medicSound(context, "medatck4", "medatck4a", 1);
    const currentTarget = game.entity(entity.enemy);
    if (currentTarget === null) return undefined;
    const body = game.body(currentTarget);
    return game.host.emit({ kind: "monster-beam", effect: "medic", actor: entity.actor.id, start: add(start, scale(anglesVectors(game.body(entity).angles).forward, 8)), end: { ...body.origin, z: body.origin.z + (body.bounds.min.z + body.bounds.max.z) / 2 } });
  }
  function reinforcementList(context: MonsterContext): readonly Reinforcement[] {
    const value = context.entity.spawn.values.get("reinforcements") ?? defaultReinforcements;
    if (value === "") return [];
    return value.split(";").map(entry => {
      const [classname = "", strength = "0"] = entry.trim().split(/\s+/);
      const definition = monsters.definition(classname, context.game);
      if (definition === null) throw new Error(`Unknown medic reinforcement ${classname}`);
      return { classname, strength: Number.parseInt(strength, 10), bounds: definition.bounds };
    });
  }
  function eachSpawn(context: MonsterContext, behind: boolean, visit: (point: Vec3, reinforcement: Reinforcement) => boolean, determine = false): undefined {
    const list = reinforcementList(context), chosen = source.get(context.entity).chosenReinforcements;
    for (let i = 0; i < chosen.length; i++) {
      const reinforcement = recordAt(list, recordAt(chosen, i));
      let position = recordAt(reinforcementPositions, i);
      if (determine) position = scale(position, context.entity.scale);
      if (behind) position = { x: -position.x, y: -position.y, z: position.z };
      const point = projectFlash(context, position);
      const spawn = findRereleaseSpawnPoint(context.game, { ...point, z: point.z + (behind ? 10 : 10 * context.entity.scale) }, reinforcement.bounds, 32);
      if (spawn !== null && visit(spawn, reinforcement)) break;
    }
    return undefined;
  }
  const callbacks: Readonly<Record<string, MonsterHandler>> = {
    medic_idle: idle, medic_run: run, medic_dead(context) { context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } }); return corpse(context); },
    medic_shrink(context) { const bounds = context.game.body(context.entity).bounds; context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...bounds, max: { ...bounds.max, z: -2 } } }); },
    medic_quick_attack(context) { if (context.game.host.random() < 0.5) { context.setMove("medic_move_attackHyperBlaster", false); context.state.nextFrame = medicFrame.attack16; } return undefined; }, monster_done_dodge: finishDodge,
    medic_hook_launch: context => medicSound(context, "medatck2", "medatck2c", 1),
    medic_hook_retract(context) {
      context.game.sound(context.entity, "medic/medatck5.wav", 1); context.state.medic = false;
      restoreEnemy(context); return undefined;
    },
    medic_cable_attack: cable,
    medic_continue(context) { if (visible(context) && context.game.host.random() <= 0.95) context.setMove("medic_move_attackHyperBlaster", false); return undefined; },
    medic_fire_blaster(context) {
      const frame = context.entity.frame, commander = monsterMass(context) > 400;
      const blaster = frame === medicFrame.attack9 || frame === medicFrame.attack12;
      const flash = blaster ? commander ? 146 : 60 : (commander ? 277 : 265) + frame - medicFrame.attack19;
      const aim = shot(context, flash); if (aim === null) return undefined;
      const effects = blaster ? 8 : frame % 4 === 0 ? 64 : 0;
      const damage = context.game.entity(context.entity.enemy)?.classname === "tesla_mine" ? 3 : blaster ? 6 : 2;
      if (commander) weapons.fireBlaster2(context.entity, context.game, aim.start, aim.direction, damage, 1000, effects);
      else context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, damage, 1000, effects);
      return monsterFlash(context, flash, aim.start, aim.direction);
    },
    medic_start_spawn(context) { context.game.sound(context.entity, "medic_commander/monsterspawn1.wav", 1); context.state.nextFrame = medicFrame.attack48; return undefined; },
    medic_determine_spawn(context) {
      const list = reinforcementList(context), chosen: number[] = [];
      const count = Math.max(1, Math.trunc(Math.log2(context.game.host.random() * 32)));
      let remaining = context.state.monsterSlots - context.state.monsterUsed;
      for (let i = 0; i < count && remaining !== 0; i++) {
        const available = list.flatMap((reinforcement, index) => reinforcement.strength <= remaining ? [index] : []);
        if (available.length === 0) break;
        const index = recordAt(available, rereleaseRandom(context).integer(available.length));
        chosen.push(index); remaining -= recordAt(list, index).strength;
      }
      source.get(context.entity).chosenReinforcements = chosen;
      let success = false;
      const check = (point: Vec3, reinforcement: Reinforcement): boolean => { success = checkRereleaseGroundSpawnPoint(context.game, point, reinforcement.bounds, 256, -1); return success; };
      eachSpawn(context, false, check, true);
      if (!success) { eachSpawn(context, true, check, true); if (success) { context.state.manualSteering = true; context.state.idealYaw = anglemod(context.game.body(context.entity).angles.y) + 180; if (context.state.idealYaw > 360) context.state.idealYaw -= 360; } }
      if (!success) context.state.nextFrame = medicFrame.attack53;
      return undefined;
    },
    medic_spawngrows(context) {
      if (context.state.manualSteering) {
        if (Math.abs(anglemod(context.game.body(context.entity).angles.y) - context.state.idealYaw) > 0.1) { context.state.holdFrame = true; return undefined; }
        context.state.holdFrame = false; context.state.manualSteering = false;
      }
      let success = false;
      eachSpawn(context, false, (point, reinforcement) => { if (checkRereleaseGroundSpawnPoint(context.game, point, reinforcement.bounds, 256, -1)) { success = true; spawnGrow(context, add(point, add(reinforcement.bounds.min, reinforcement.bounds.max)), length(subtract(reinforcement.bounds.max, reinforcement.bounds.min)) * 0.5); } return false; });
      if (!success) context.state.nextFrame = medicFrame.attack53;
      return undefined;
    },
    medic_finish_spawn(context) {
      const { entity, game, state } = context;
      return eachSpawn(context, false, (point, reinforcement) => {
        const bounds = reinforcement.bounds;
        if (!checkRogueSpawnPoint(game, point, bounds)) return false;
        const child = checkRereleaseGroundSpawnPoint(game, point, bounds, 256, -1) ? createRogueMonster(monsters, game, point, game.body(entity).angles, reinforcement.classname) : null;
        if (child === null) return false;
        if (child.think !== null) { child.nextThink = game.host.now(); child.think(child, game); }
        const childContext = monsters.context(child.actor.id); if (childContext === null) throw new Error("Medic reinforcement has no shared controller");
        childContext.state.ignoreShots = true; childContext.state.doNotCount = true; childContext.state.spawnedBy = "medic"; childContext.state.commander = entity.actor.id; childContext.state.monsterSlots = reinforcement.strength; state.monsterUsed += reinforcement.strength;
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
    stand: move("medic_move_stand"), walk: move("medic_move_walk"), run, attack, idle, callbacks, sourceCallbacks: { think: { "rerelease.medic.spawngrow_think": spawnGrowThink, "rerelease.medic.SpawnGro_laser_think": spawnGrowLaserThink } },
    sight: context => medicSound(context, "medsght1", "medsght"),
    search(context) { medicSound(context, "medsrch1", "medsrch", 2, 2); if (context.state.oldEnemy === null) acquire(context); return undefined; },
    initialize(context) { context.state.ignoreShots = true; if (monsterMass(context) > 400) { context.entity.skin = 2; const slots = numberField(context.entity.spawn, "monster_slots", 3); context.state.monsterSlots = slots; if (slots !== 0 && reinforcementList(context).length !== 0) context.state.monsterSlots += Math.floor(slots * context.game.options.skill / 2); } return undefined; },
    pain(context, reaction) {
      const { entity, game, state } = context, commander = monsterMass(context) > 400;
      finishDodge(context); entity.skin = (entity.skin & ~1) | (health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0);
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      const random = game.host.random();
      if (commander) {
        if (reaction.damage < 35) { medicSound(context, "medpain1", "medpain1"); if (!chainfist(context)) return undefined; }
        medicSound(context, "medpain2", "medpain2");
      } else medicSound(context, random < 0.5 ? "medpain1" : "medpain2", "medpain2");
      if (!reactsToPain(context) || !chainfist(context) && state.medic) return undefined;
      if (commander) { state.manualSteering = false; state.holdFrame = false; }
      context.setMove(commander ? random < Math.min(reaction.damage * 0.005, 0.5) ? "medic_move_pain2" : "medic_move_pain1" : random < 0.5 ? "medic_move_pain1" : "medic_move_pain2");
      if (state.ducked) setDuck(context, false);
      return abort(context, false, false, false);
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (state.medic) { const target = game.entity(entity.enemy); if (target !== null) cleanupRogueHealTarget(monsters, source, target, game); state.medic = false; }
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
        throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", reaction.damage, { metallic: true });
        throwGib(entity, game, "models/monsters/medic/gibs/chest.md2", reaction.damage, { skinned: true });
        for (const part of ["leg", "leg", "hook", "gun"]) throwGib(entity, game, `models/monsters/medic/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: true });
        throwGib(entity, game, "models/monsters/medic/gibs/head.md2", reaction.damage, { skinned: true, head: true }); state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      medicSound(context, "meddeth1", "meddeth"); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove("medic_move_death");
    },
    duck(context) { if (context.state.medic) return false; if (attacking(context)) { setDuck(context, false); return false; } context.setMove("medic_move_duck"); return true; },
    sidestep(context) { if (attacking(context)) return false; if (context.state.move.name !== "medic_move_run") context.setMove("medic_move_run"); return true; },
    blocked(context, distance) { return blockedCheckPlatform(context, distance); },
    checkAttack(context) {
      const { game, entity, state } = context;
      if (state.medic) {
        if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) { abort(context, true, false, false); return false; }
        if (entity.timestamp < game.host.now()) { abort(context, true, false, true); entity.timestamp = 0; return false; }
        if (targetDistance(context) < 410) { attack(context); return true; }
        state.attackState = "straight"; return false;
      }
      if (entity.enemy !== null && game.host.isPlayer(entity.enemy) && !visible(context) && state.monsterSlots > state.monsterUsed) { state.attackState = "blind"; return true; }
      if (state.monsterSlots !== 0 && game.host.random() < 0.8 && state.monsterSlots - state.monsterUsed > state.monsterSlots * 0.8 && targetDistance(context) > 150) { source.get(entity).blocked = true; state.attackState = "missile"; return true; }
      if (state.standGround) { state.attackState = "missile"; return true; }
      return defaultCheckAttack(context);
    },
  };
  return [base, { ...base, classname: "monster_medic_commander", kind: "medic_commander", health: 600, mass: 600, yawSpeed: 40 }];
}
