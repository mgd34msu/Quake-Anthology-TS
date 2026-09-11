/* Permanent Q2 monster provider: shared actor authority with source animation/AI callbacks. GPL-2.0-or-later. */
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "../callbacks.ts";
import { restoreQ2Actor, saveQ2Actor } from "../checkpoint.ts";
import type { Q2MonstersCheckpoint } from "./checkpoint.ts";
import { createAlternateFlyState } from "./alternate-fly-state.ts";
import { q2GibCallbacks } from "./gibs.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { AttackProvenance } from "../../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { DeathReaction, PainReaction } from "../../../../contracts/world.ts";
import { add, dot, length, normalize, numberField, scale, subtract, zero } from "../fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use, Q2Pain, Q2Die } from "../host.ts";
import type { MonsterCallback } from "./actions.ts";
import { anglesVectors, enemyBody, finishDodge, fliesOn, fliesOff, monsterDeadThink, health, monsterSolidMask, MASK_WATER, runAi, setDuck, traceGroundActor, vectorAngles } from "./ai.ts";
import { infantryAttack, infantryCallbacks, infantryDie, infantryDuck, infantryPain, infantryRun, infantrySidestep, infantrySight, infantryStand, infantryWalk } from "./infantry.ts";
import { classic_infantryMoves, classic_soldierMoves, rerelease_infantryMoves, rerelease_soldierMoves } from "./moves.ts";
import { defaultCheckAttack, MonsterPerception } from "./perception.ts";
import { soldierAttack, soldierCallbacks, soldierDie, soldierDuck, soldierPain, soldierRun, soldierSidestep, soldierSight, soldierStand, soldierWalk } from "./soldier.ts";
import type { MonsterContext, MonsterHandler, MonsterState, MonsterWeapons, Q2MonsterDefinition, Q2MonsterSourceCombatHooks, Q2MonsterHintHooks } from "./types.ts";
import { recordAt } from "./types.ts";

export type { Q2MonstersCheckpoint, Q2MonsterStateCheckpoint, Q2MonsterPerceptionCheckpoint } from "./checkpoint.ts";
export type { MonsterContext, MonsterFrame, MonsterHandler, MonsterState, MonsterWeapons, Q2MonsterDefinition } from "./types.ts";
export { defaultCheckAttack } from "./perception.ts";
export { throwGib, throwHead } from "./gibs.ts";
export type { Q2GibOptions } from "./gibs.ts";

export interface Q2MonsterHooks {
  readonly platformState?: (actor: ActorId) => "top" | "bottom" | "up" | "down" | null;
}

const sharedCallbacks = {
  monster_done_dodge: finishDodge,
  monster_duck_down(context: MonsterContext): undefined { context.state.nextDuckTime = context.game.host.now() + 5; return setDuck(context, true); },
  monster_duck_hold(context: MonsterContext): undefined { context.state.holdFrame = context.game.host.now() < context.state.duckWait; return undefined; },
  monster_duck_up(context: MonsterContext): undefined {
    if (!context.state.ducked) return undefined;
    setDuck(context, false);
    if (context.state.nextDuckTime > context.game.host.now()) context.state.nextDuckTime = context.game.host.now() + (context.state.nextDuckTime - context.game.host.now()) * 0.5;
    return undefined;
  },
  monster_footstep(context: MonsterContext): undefined {
    if (context.game.body(context.entity).ground !== null) context.game.host.emit({ kind: "entity-event", actor: context.entity.actor.id, event: 8 });
    return undefined;
  },
};
const builtInCallbacks: Readonly<Record<MonsterCallback, MonsterHandler>> = { ...soldierCallbacks, ...infantryCallbacks, ...sharedCallbacks };
const normalBounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };

function builtIn(classname: string, game: Q2GameServices): Q2MonsterDefinition | null {
  if (classname === "monster_infantry") return {
    classname, kind: "infantry", model: "models/monsters/infantry/tris.md2", health: 100, gibHealth: game.options.edition === "classic" ? -40 : -65, mass: 200, bounds: normalBounds, scale: 1,
    initialMove: "infantry_move_stand", moves: game.options.edition === "classic" ? classic_infantryMoves : rerelease_infantryMoves, callbacks: builtInCallbacks,
    stand: infantryStand, walk: infantryWalk, run: infantryRun, attack: infantryAttack, sight: infantrySight, pain: infantryPain, die: infantryDie, duck: infantryDuck, sidestep: infantrySidestep,
    idle(context): undefined { if (context.game.options.edition === "rerelease" && context.entity.enemy !== null) return undefined; context.setMove("infantry_move_fidget"); return context.game.sound(context.entity, "infantry/infidle1.wav", 2, 1, 2); },
  };
  if (classname === "monster_soldier_light" || classname === "monster_soldier" || classname === "monster_soldier_ss") return {
    classname, kind: "soldier", model: "models/monsters/soldier/tris.md2", health: classname === "monster_soldier_light" ? 20 : classname === "monster_soldier" ? 30 : 40, gibHealth: -30, mass: 100, bounds: normalBounds, scale: 1,
    initialMove: "soldier_move_stand1", moves: game.options.edition === "classic" ? classic_soldierMoves : rerelease_soldierMoves, callbacks: builtInCallbacks,
    stand: soldierStand, walk: soldierWalk, run: soldierRun, attack: soldierAttack, sight: soldierSight, pain: soldierPain, die: soldierDie, duck: soldierDuck, sidestep: soldierSidestep, blindFire: classname !== "monster_soldier_ss",
    initialize(context): undefined {
      if (game.options.edition === "classic" || (context.entity.spawnflags & 8) !== 0) return soldierStand(context);
      game.host.random();
      return context.setMove("soldier_move_stand1");
    },
  };
  return null;
}

/** Animation data and callbacks can be extended without copying the frame or perception runner. */
export class Q2Monsters implements Q2SpawnModule {
  private readonly definitions = new Map<string, Q2MonsterDefinition>();
  private readonly editionDefinitions = new Map<Q2GameServices["options"]["edition"], Map<string, Q2MonsterDefinition>>();
  private readonly contexts = new Map<ActorId, MonsterContext>();
  private readonly actors = new Map<ActorId, Q2MonsterDefinition>();
  private readonly perception = new MonsterPerception(this.contexts);
  private readonly pendingDamage = new Map<ActorId, { readonly reaction: DeathReaction; readonly attack: AttackProvenance | null }>();
  private connected = false;
  private sourceCombatHooks: Q2MonsterSourceCombatHooks | null = null;
  private sourceCombatRules: "base" | "rogue" = "base";
  private hintHooks: Q2MonsterHintHooks | null = null;

  constructor(private readonly weapons: MonsterWeapons, private readonly hooks: Q2MonsterHooks = {}) {}

  setSourceCombatRules(rules: "base" | "rogue", hooks: Q2MonsterSourceCombatHooks | null = null): undefined {
    this.sourceCombatRules = rules;
    this.sourceCombatHooks = hooks;
    return this.perception.setSourceCombatRules(rules, hooks);
  }
  setHintPaths(hooks: Q2MonsterHintHooks): undefined { this.hintHooks = hooks; return this.perception.setHintPaths(hooks); }

  private requireContext(entity: Q2Entity): MonsterContext {
    const context = this.contexts.get(entity.actor.id);
    if (context === undefined) throw new Error(`Missing Q2 source monster context ${entity.classname}`);
    return context;
  }
  private readonly sourceThink: Q2Think = entity => this.think(this.requireContext(entity));
  private readonly sourceStart: Q2Think = entity => this.start(this.requireContext(entity));
  private readonly sourceTriggerSpawn: Q2Think = entity => this.triggerSpawn(this.requireContext(entity));
  private readonly sourceDeadThink: Q2Think = entity => monsterDeadThink(this.requireContext(entity));
  private readonly sourceFliesOn: Q2Think = entity => fliesOn(this.requireContext(entity));
  private readonly sourceFliesOff: Q2Think = entity => fliesOff(this.requireContext(entity));
  private readonly sourcePain: Q2Pain = (entity, game, reaction) => {
    const context = this.requireContext(entity), definition = this.actors.get(entity.actor.id);
    this.perception.reactToDamage(context, reaction.attacker);
    if (game.options.edition === "rerelease") this.queuePain(context, reaction, { inflictor: entity.lastAttack?.inflictor ?? null, point: game.body(entity).origin });
    else definition?.pain?.(context, reaction);
    this.setSkin(context); game.show(entity); return undefined;
  };
  private readonly sourceDie: Q2Die = (entity, game, reaction) => {
    const context = this.requireContext(entity), definition = this.actors.get(entity.actor.id);
    if (definition === undefined) throw new Error(`Missing Q2 source monster death ${entity.classname}`);
    if (game.options.edition === "rerelease") {
      if (health(game, entity.actor.id) < -999) game.host.combat.setHealth(entity.actor, -999);
      entity.enemy = reaction.attacker; entity.flags |= 1 << 19;
      return this.queuePain(context, reaction, reaction);
    }
    return this.die(context, definition, reaction);
  };
  private readonly sourceUse: Q2Use = (entity, game, _other, activator) => {
    const context = this.requireContext(entity);
    if (entity.enemy !== null || context.state.dead || activator === null || ((game.entity(activator)?.flags ?? 0) & 32) !== 0 || !game.host.isPlayer(activator) && this.contexts.get(activator)?.state.goodGuy !== true) return undefined;
    entity.enemy = activator;
    return this.perception.foundTarget(context);
  };
  private readonly sourceTriggerUse: Q2Use = (entity, game, _other, activator) => {
    game.schedule(entity, game.options.edition === "classic" ? 0.1 : game.host.frameSeconds(), this.sourceTriggerSpawn);
    if (activator !== null && game.host.isPlayer(activator)) entity.enemy = activator;
    entity.use = this.sourceUse;
    return undefined;
  };
  get callbacks(): Q2CallbackDefinitions {
    const definitions: Q2CallbackDefinitions = {
      think: { ...q2GibCallbacks.think, monster_think: this.sourceThink, monster_start_go: this.sourceStart, monster_triggered_spawn: this.sourceTriggerSpawn,
        monster_dead_think: this.sourceDeadThink, M_FliesOn: this.sourceFliesOn, M_FliesOff: this.sourceFliesOff },
      use: { monster_use: this.sourceUse, monster_triggered_spawn_use: this.sourceTriggerUse },
      pain: { monster_pain: this.sourcePain }, die: { ...q2GibCallbacks.die, monster_die: this.sourceDie }, touch: q2GibCallbacks.touch ?? {}, blocked: {},
    };
    const sources = [definitions, ...[...this.definitions.values(), ...[...this.editionDefinitions.values()].flatMap(entries => [...entries.values()])].flatMap(definition => definition.sourceCallbacks === undefined ? [] : [definition.sourceCallbacks])];
    return { think: mergeCallbacks(sources.map(source => source.think)), use: mergeCallbacks(sources.map(source => source.use)),
      pain: mergeCallbacks(sources.map(source => source.pain)), die: mergeCallbacks(sources.map(source => source.die)),
      touch: mergeCallbacks(sources.map(source => source.touch)), blocked: mergeCallbacks(sources.map(source => source.blocked)) };
  }
  private connect(game: Q2GameServices): undefined {
    if (!this.connected) {
      game.host.actors.onRelease(actor => { this.contexts.delete(actor.id); this.actors.delete(actor.id); this.pendingDamage.delete(actor.id); this.perception.release(actor.id); return undefined; });
      this.connected = true;
    }
    game.sourceCallbacks.register(this.callbacks);
    return this.perception.bind(game);
  }
  definition(classname: string, game: Q2GameServices): Q2MonsterDefinition | null {
    const registered = this.editionDefinitions.get(game.options.edition)?.get(classname) ?? this.definitions.get(classname);
    if (registered !== undefined) return registered;
    if (classname === "turret_driver") {
      const infantry = builtIn("monster_infantry", game);
      return infantry === null ? null : { ...infantry, classname, gibHealth: 0, viewHeight: 24 };
    }
    return builtIn(classname, game);
  }

  register(definition: Q2MonsterDefinition, edition?: Q2GameServices["options"]["edition"]): undefined {
    const definitions = edition === undefined ? this.definitions : this.editionDefinitions.get(edition) ?? new Map<string, Q2MonsterDefinition>();
    if (edition !== undefined) this.editionDefinitions.set(edition, definitions);
    if (definitions.has(definition.classname)) throw new Error(`Duplicate Q2 monster definition ${definition.classname}`);
    for (const move of definition.moves) {
      for (const frame of move.frames) if (typeof frame.ai !== "string" && definition.ai?.[frame.ai.name] === undefined) throw new Error(`Missing Q2 source AI ${frame.ai.name}`);
      if (move.frames.length < move.lastFrame - move.firstFrame + 1) throw new Error(`Q2 move ${move.name} has an incomplete frame table`);
      for (const callback of [move.end, ...move.frames.flatMap(frame => frame.actions.filter(action => typeof action === "string"))]) {
        if (callback !== null && definition.callbacks[callback] === undefined && !(callback in sharedCallbacks)) throw new Error(`Q2 move ${move.name} references missing callback ${callback}`);
      }
    }
    definitions.set(definition.classname, definition);
    return undefined;
  }

  capture(): Q2MonstersCheckpoint {
    return { version: 1, perception: this.perception.capture(), actors: [...this.contexts.values()].map(context => {
      const { state, entity } = context;
      const { move, nextMove, soundTarget, oldEnemy, moveTarget, commander, ...values } = state;
      const definition = this.actors.get(entity.actor.id);
      if (definition === undefined) throw new Error(`Cannot save missing Q2 monster definition ${entity.classname}`);
      const pending = this.pendingDamage.get(entity.actor.id);
      return { actor: { slot: entity.actor.id.slot, generation: entity.actor.id.generation }, definition: definition.classname,
        state: { ...structuredClone(values), move: move.name, nextMove: nextMove?.name ?? null,
          soundTarget: soundTarget === null ? null : { ...soundTarget, origin: { ...soundTarget.origin }, actor: { slot: soundTarget.actor.slot, generation: soundTarget.actor.generation } },
          oldEnemy: saveQ2Actor(oldEnemy), moveTarget: saveQ2Actor(moveTarget), commander: saveQ2Actor(commander) },
        pendingDamage: pending === undefined ? null : { reaction: { damage: pending.reaction.damage, kick: pending.reaction.kick, point: { ...pending.reaction.point },
          attacker: saveQ2Actor(pending.reaction.attacker), inflictor: saveQ2Actor(pending.reaction.inflictor) },
          attack: pending.attack === null ? null : structuredClone({ ...pending.attack, attacker: saveQ2Actor(pending.attack.attacker), inflictor: saveQ2Actor(pending.attack.inflictor) }) } };
    }) };
  }

  /** Shared actor/health/body tables and Q2 entities must be restored first. No source callback executes. */
  restore(game: Q2GameServices, checkpoint: Q2MonstersCheckpoint): undefined {
    this.connect(game);
    this.contexts.clear(); this.actors.clear(); this.pendingDamage.clear();
    const reference = (actor: SavedActorId | null): ActorId | null => actor === null ? null : game.host.actors.referenceSaved(actor);
    for (const saved of structuredClone(checkpoint).actors) {
      const owner = restoreQ2Actor(game, saved.actor), entity = game.entity(owner.id), definition = this.definition(saved.definition, game);
      if (entity === null || definition === null) throw new Error(`Missing restored Q2 monster ${saved.definition}`);
      const findMove = (name: string) => {
        const move = definition.moves.find(candidate => candidate.name === name);
        if (move === undefined) throw new Error(`Unknown saved Q2 monster move ${name}`);
        return move;
      };
      const { move, nextMove, soundTarget, oldEnemy, moveTarget, commander, ...values } = saved.state;
      const state: MonsterState = { ...values, move: findMove(move), nextMove: nextMove === null ? null : findMove(nextMove),
        soundTarget: soundTarget === null ? null : { ...soundTarget, actor: game.host.actors.referenceSaved(soundTarget.actor) },
        oldEnemy: reference(oldEnemy), moveTarget: reference(moveTarget), commander: reference(commander) };
      this.attachContext(entity, game, definition, state);
      const pending = saved.pendingDamage;
      if (pending !== null) this.pendingDamage.set(owner.id, {
        reaction: { ...pending.reaction, self: owner, attacker: reference(pending.reaction.attacker), inflictor: reference(pending.reaction.inflictor) },
        attack: pending.attack === null ? null : { ...pending.attack, attacker: reference(pending.attack.attacker), inflictor: reference(pending.attack.inflictor) },
      });
    }
    this.perception.restore(game, checkpoint.perception);
    for (const context of this.contexts.values()) this.actors.get(context.entity.actor.id)?.restore?.(context);
    return undefined;
  }

  context(actor: ActorId): MonsterContext | null { return this.contexts.get(actor) ?? null; }
  get currentSightClient(): ActorId | null { return this.perception.currentSightClient; }
  foundTarget(context: MonsterContext): undefined { return this.perception.foundTarget(context); }
  huntTarget(context: MonsterContext): undefined { return this.perception.huntTarget(context); }
  respawn(entity: Q2Entity, game: Q2GameServices): MonsterContext {
    const definition = this.actors.get(entity.actor.id) ?? this.definition(entity.classname, game);
    if (definition === null) throw new Error(`Cannot revive unknown Q2 monster ${entity.classname}`);
    game.cancel(entity);
    this.admit(entity, game, definition, true);
    const context = this.contexts.get(entity.actor.id);
    if (context === undefined) throw new Error(`Q2 monster ${entity.classname} was inhibited during revival`);
    return context;
  }
  resumeMonster(entity: Q2Entity, game: Q2GameServices): undefined {
    const context = this.contexts.get(entity.actor.id);
    if (context === undefined) throw new Error(`No monster callbacks for ${entity.classname}`);
    return game.schedule(entity, game.options.edition === "classic" ? 0.1 : game.host.frameSeconds(), this.sourceThink);
  }
  spawnInfantryDriver(entity: Q2Entity, game: Q2GameServices): MonsterContext {
    const infantry = builtIn("monster_infantry", game);
    if (infantry === null) throw new Error("Missing infantry definition");
    this.admit(entity, game, { ...infantry, classname: "turret_driver", gibHealth: 0, viewHeight: 24 }, false);
    const context = this.contexts.get(entity.actor.id);
    if (context === undefined) throw new Error("Turret infantry driver was inhibited");
    return context;
  }
  beginFrame(game: Q2GameServices): undefined { return this.perception.beginFrame(game); }
  endFrame(game: Q2GameServices): undefined {
    if (game.options.edition !== "rerelease") return undefined;
    const contexts = [...this.contexts.values()].sort((a, b) => (game.host.actors.sourceOf(a.entity.actor.id)?.slot ?? a.entity.actor.id.slot) - (game.host.actors.sourceOf(b.entity.actor.id)?.slot ?? b.entity.actor.id.slot));
    for (const context of contexts) if (game.host.actors.isLive(context.entity.actor.id) && (context.entity.serverFlags & 4) !== 0) this.processPain(context.entity, game);
    return undefined;
  }
  processPain(entity: Q2Entity, game: Q2GameServices): undefined {
    const pending = this.pendingDamage.get(entity.actor.id), context = this.contexts.get(entity.actor.id), definition = this.actors.get(entity.actor.id);
    if (pending === undefined || context === undefined || definition === undefined || pending.reaction.damage === 0) return undefined;
    entity.lastAttack = pending.attack;
    if (health(game, entity.actor.id) <= 0) {
      this.die(context, definition, pending.reaction);
      if (game.host.actors.isLive(entity.actor.id) && health(game, entity.actor.id) > context.state.gibHealth && entity.frame === context.state.move.lastFrame) {
        entity.frame -= 1 + Math.floor(game.host.random() * 2);
        const body = game.body(entity);
        if (body.ground !== null && entity.motion === "toss" && context.state.locomotion !== "stationary") game.move(entity, { angles: { ...body.angles, y: body.angles.y + (game.host.random() < 0.5 ? 4.5 : -4.5) } });
      }
    } else definition.pain?.(context, pending.reaction);
    this.pendingDamage.delete(entity.actor.id);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    this.setSkin(context);
    const healthTarget = entity.healthTarget;
    if (healthTarget !== "") { const saved = entity.target; entity.target = healthTarget; game.useTargets(entity, entity.enemy); entity.target = saved; }
    if (game.host.actors.isLive(entity.actor.id)) game.show(entity);
    return undefined;
  }
  reportNoise(actor: ActorId, origin: Vec3, secondary = false): undefined { return this.perception.reportNoise(actor, origin, secondary); }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    const definition = this.definition(entity.classname, game);
    if (definition === null) return false;
    return this.admit(entity, game, definition, false);
  }

  /** Rogue CreateMonster sets AI_DO_NOT_COUNT before ED_CallSpawn. */
  spawnSummoned(entity: Q2Entity, game: Q2GameServices): MonsterContext {
    const definition = this.definition(entity.classname, game);
    if (definition === null) throw new Error(`Cannot summon unknown Q2 monster ${entity.classname}`);
    this.admit(entity, game, definition, false, true);
    return this.requireContext(entity);
  }

  private attachContext(entity: Q2Entity, game: Q2GameServices, definition: Q2MonsterDefinition, state: MonsterState): MonsterContext {
    const moves = new Map(definition.moves.map(move => [move.name, move]));
    const context: MonsterContext = {
      entity, game, state, weapons: this.weapons,
      sourceCombatRules: () => this.sourceCombatRules,
      beforeSourceMove: displacement => this.sourceCombatHooks?.beforeMove(context, displacement) ?? { kind: "move", displacement },
      acceptsSourceGroundMove: origin => this.sourceCombatHooks?.acceptsGroundMove(context, origin) ?? true,
      consumeSourceBlocked: () => this.sourceCombatHooks?.consumeBlocked(context) ?? false,
      runHintPath: distance => this.hintHooks?.run(context, distance) ?? false,
      checkLostHintPath: () => this.hintHooks?.checkLost(context) ?? false,
      schedule: (delay, callback) => {
        const think = game.sourceCallbacks.think.resolve(callback);
        if (think === null) throw new Error(`Missing monster thinker ${callback}`);
        return game.schedule(entity, delay, think);
      },
      setMove: (name, immediate = true) => {
        const move = moves.get(name);
        if (move === undefined) throw new Error(`${entity.classname}: unknown source animation ${name}`);
        if (game.options.edition === "rerelease" && !immediate) state.nextMove = move;
        else { state.move = move; state.nextMove = null; }
        return undefined;
      },
      stand: () => definition.stand(context), walk: () => definition.walk(context), run: () => definition.run(context), attack: () => definition.attack(context),
      melee: () => definition.melee?.(context), idle: () => definition.idle?.(context), search: () => definition.search?.(context),
      dispatch: callback => {
        if (callback === "$sight") return definition.sight?.(context);
        const shared: Readonly<Record<string, MonsterHandler>> = sharedCallbacks;
        const handler = definition.callbacks[callback] ?? shared[callback];
        if (handler === undefined) throw new Error(`${entity.classname}: unknown source callback ${callback}`);
        return handler(context);
      },
      findTarget: () => this.perception.findTarget(context),
      checkAttack: _distance => this.perception.checkAttack(context, definition.checkAttack ?? defaultCheckAttack),
      moveToGoal: distance => this.perception.moveToGoal(context, distance),
      dodge: (attacker, eta, trace, gravity = false) => this.dodge(entity, game, attacker, eta, trace, gravity),
      blocked: distance => definition.blocked?.(context, distance) ?? this.blocked(context, distance),
      platformState: actor => this.hooks.platformState?.(actor) ?? null,
    };
    this.contexts.set(entity.actor.id, context); this.actors.set(entity.actor.id, definition);
    return context;
  }

  private admit(entity: Q2Entity, game: Q2GameServices, definition: Q2MonsterDefinition, reviving: boolean, summoned = false): boolean {
    if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
    this.connect(game);
    const initial = definition.moves.find(move => move.name === definition.initialMove);
    if (initial === undefined) throw new Error(`Missing Q2 monster initial move ${definition.initialMove}`);
    const previous = reviving ? this.contexts.get(entity.actor.id)?.state : undefined;
    const state: MonsterState = {
      ...createAlternateFlyState(),
      kind: definition.kind, weapon: entity.classname === "monster_soldier_light" ? "blaster" : entity.classname === "monster_soldier" ? "shotgun" : "machinegun",
      locomotion: definition.locomotion ?? "walk", hasMelee: definition.melee !== undefined, hasRangedAttack: definition.hasRangedAttack !== false,
      hasIdle: definition.idle !== undefined, hasSearch: definition.search !== undefined, blindFire: definition.blindFire === true,
      goodGuy: false, targetAnger: false, brutal: false, medic: false, resurrecting: false,
      ignoreShots: previous?.ignoreShots ?? false, doNotCount: summoned || (previous?.doNotCount ?? false), spawnedBy: previous?.spawnedBy ?? "none",
      commander: previous?.commander ?? null, monsterSlots: previous?.monsterSlots ?? 0, monsterUsed: previous?.monsterUsed ?? 0,
      move: initial, nextMove: null, nextFrame: 0, nextMoveTime: 0, scale: definition.scale, gibHealth: definition.gibHealth, canTakeDamage: true,
      dead: false, corpse: false, gibbed: false, standGround: false, temporaryStandGround: false, holdFrame: false, ducked: false, dodging: false, charging: false, manualSteering: false, combatPoint: false,
      attackState: "straight", lefty: false, idealYaw: game.body(entity).angles.y, yawSpeed: definition.yawSpeed ?? (stateLocomotion(definition) === "walk" ? 20 : 10),
      pauseTime: 0, idleTime: 0, painTime: 0, fireWait: 0, duckWait: 0, nextDuckTime: 0, dodgeTime: 0, attackFinished: 0, checkAttackTime: 0, strafeTime: 0, hadVisibility: false, closeSightTripped: false,
      meleeTime: 0, searchTime: 0, trailTime: 0, showHostile: 0, lastSighting: zero, savedGoal: null, lostSight: false, pursueNext: false, pursueTemporary: false, pursuitLastSeen: false,
      blindFireTarget: zero, blindFireDelay: 0, soundTarget: null, oldEnemy: null, moveTarget: null, combatTarget: entity.combatTarget,
      cocked: definition.kind === "soldier", forceRefire: false, normalHeight: definition.bounds.max.z, waterLevel: 0, waterType: 0, lastLinkCount: 0, airFinished: game.host.now() + 12, environmentalDamageTime: 0, jumpTime: 0, fliesTime: null,
    };
    const context = this.attachContext(entity, game, definition, state);
    entity.model = definition.model;
    entity.maxHealth = definition.health * (game.options.edition === "rerelease" ? numberField(entity.spawn, "health_multiplier", 1) : 1);
    entity.viewHeight = definition.viewHeight ?? (game.options.edition === "rerelease" ? 0 : state.locomotion === "swim" ? 10 : 25);
    entity.serverFlags = (entity.serverFlags | 4) & ~2;
    entity.flags |= state.locomotion === "fly" ? 1 : state.locomotion === "swim" ? 2 : 0;
    entity.clipMask = monsterSolidMask(game);
    entity.skin = definition.kind === "soldier" ? state.weapon === "blaster" ? 0 : state.weapon === "shotgun" ? 2 : 4 : 0;
    entity.count = entity.skin;
    entity.scale = game.options.edition === "rerelease" ? numberField(entity.spawn, "scale", 1) : 1;
    if (game.options.edition === "classic") entity.renderFlags |= 64;
    else entity.renderFlags |= 32768;
    state.scale *= entity.scale;
    game.move(entity, { bounds: { min: scale(definition.bounds.min, entity.scale), max: scale(definition.bounds.max, entity.scale) } }, false);
    state.normalHeight = game.body(entity).bounds.max.z;
    if (game.options.edition === "rerelease" && entity.viewHeight === 0) entity.viewHeight = Math.trunc(state.normalHeight - 8);
    if (game.host.combat.read(entity.actor.id) === null) game.host.combat.create(entity.actor, { health: entity.maxHealth, armor: { kind: "none" }, mass: definition.mass * entity.scale, canTakeDamage: true, invulnerable: false, team: null });
    else {
      game.host.combat.setHealth(entity.actor, entity.maxHealth);
      game.host.combat.setArmor(entity.actor, { kind: "none" });
      game.host.combat.setTraits(entity.actor, { mass: definition.mass * entity.scale, canTakeDamage: true, invulnerable: false });
    }
    entity.pain = this.sourcePain; entity.die = this.sourceDie; entity.use = this.sourceUse;
    definition.initialize?.(context);
    if (!game.host.actors.isLive(entity.actor.id)) return true;
    if (game.options.edition === "rerelease" && (entity.spawnflags & 524288) !== 0) state.goodGuy = true;
    if (!state.goodGuy && (entity.spawnflags & 4) !== 0) entity.spawnflags = (entity.spawnflags & ~4) | 1;
    if ((!reviving || game.options.edition === "classic") && !state.goodGuy && !state.doNotCount && (game.options.edition === "classic" || (entity.spawnflags & 65536) === 0)) game.counters.totalMonsters++;
    game.solid(entity, "box"); game.motion(entity, state.locomotion === "stationary" ? "stationary" : "step");
    const automatic = definition.startMode?.(context) !== "manual";
    if (automatic) entity.frame = state.move.firstFrame + Math.floor(game.host.random() * (state.move.lastFrame - state.move.firstFrame + 1));
    game.show(entity);
    if (automatic) game.schedule(entity, game.options.edition === "classic" ? 0.1 : game.host.frameSeconds(), this.sourceStart);
    definition.afterSpawn?.(context);
    return true;
  }

  private start(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    const spawnDead = game.options.edition === "rerelease" && (entity.spawnflags & 65536) !== 0;
    if ((entity.spawnflags & 2) === 0 && state.locomotion === "walk" && game.host.now() < 1 && (game.options.edition === "classic" || (entity.spawnflags & 262144) === 0)) this.dropToFloor(context);
    if (health(game, entity.actor.id) <= 0) return undefined;
    if (entity.target.length > 0) {
      const targets = game.targets(entity.target);
      if (targets.some(target => target.classname === "point_combat")) { state.combatTarget = entity.combatTarget = entity.target; entity.target = ""; }
    }
    if (entity.target.length > 0) {
      const target = game.pickTarget(entity.target);
      entity.goal = state.moveTarget = target?.actor.id ?? null;
      if (target === null) { game.host.diagnostic(`${entity.classname}: target ${entity.target} not found`); entity.target = ""; state.pauseTime = game.host.now() + 100000000; if (!spawnDead) context.stand(); }
      else if (target.classname === "path_corner") {
        state.idealYaw = vectorAngles(subtract(game.body(target).origin, game.body(entity).origin)).y;
        game.move(entity, { angles: { ...game.body(entity).angles, y: state.idealYaw } }, false);
        if (!spawnDead) context.walk(); entity.target = "";
      } else { entity.goal = state.moveTarget = null; state.pauseTime = game.host.now() + 100000000; if (!spawnDead) context.stand(); }
    } else { state.pauseTime = game.host.now() + 100000000; if (!spawnDead) context.stand(); }
    if (spawnDead) {
      const definition = this.actors.get(entity.actor.id);
      if (definition === undefined) throw new Error("Missing dead monster definition");
      const origin = game.body(entity).origin;
      game.host.combat.setHealth(entity.actor, 0);
      definition.die(context, { self: entity.actor, attacker: entity.actor.id, inflictor: entity.actor.id, damage: 0, kick: 0, point: zero });
      if (!game.host.actors.isLive(entity.actor.id) || state.gibbed) return undefined;
      const move = state.move;
      for (let frameNumber = move.firstFrame; frameNumber < move.lastFrame; frameNumber++) {
        entity.frame = frameNumber;
        for (const action of recordAt(move.frames, frameNumber - move.firstFrame).actions) {
          if (typeof action === "string") context.dispatch(action); else state.nextFrame = action.frame === "next" ? entity.frame + 1 : action.frame;
          if (!game.host.actors.isLive(entity.actor.id)) return undefined;
        }
      }
      if (move.end !== null) context.dispatch(move.end);
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
      entity.frame = move.lastFrame;
      game.move(entity, { origin }); game.show(entity);
      return undefined;
    }
    if ((entity.spawnflags & 2) !== 0) {
      game.solid(entity, "none"); game.motion(entity, "stationary"); entity.visible = false; entity.serverFlags |= 1;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); game.show(entity);
      entity.use = this.sourceTriggerUse;
      return game.cancel(entity);
    }
    return game.schedule(entity, game.options.edition === "classic" ? 0.1 : game.host.frameSeconds(), this.sourceThink);
  }

  private triggerSpawn(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    game.move(entity, { origin: add(game.body(entity).origin, { x: 0, y: 0, z: 1 }) }, false);
    const origin = game.body(entity).origin;
    for (let i = 0; i < 1024; i++) {
      const trace = game.host.trace({ start: origin, end: origin, bounds: game.body(entity).bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
      if (trace.hit.kind !== "actor") break;
      const target = trace.hit.actor;
      if (game.host.combat.read(target) === null) break;
      game.damage(target, entity, entity.actor.id, 100000, 0, zero, origin, zero, 21, 8);
      if (game.entity(target)?.solid !== "none") break;
    }
    entity.spawnflags &= ~2; entity.serverFlags &= ~1; entity.visible = true;
    game.solid(entity, "box"); game.motion(entity, "step"); game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    state.airFinished = game.host.now() + 12;
    this.start(context);
    if (entity.enemy !== null && (entity.spawnflags & 1) === 0 && ((game.entity(entity.enemy)?.flags ?? 0) & 32) === 0) this.perception.foundTarget(context);
    else entity.enemy = null;
    entity.use = this.sourceUse;
    game.show(entity);
    return undefined;
  }

  private dropToFloor(context: MonsterContext): undefined {
    const { game, entity } = context, body = game.body(entity), direction = entity.gravityVector.z > 0 ? 1 : -1;
    const offset = game.options.edition === "classic" || game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) }).startSolid;
    const start = offset ? add(body.origin, { x: 0, y: 0, z: -direction }) : body.origin;
    game.move(entity, { origin: start }, false);
    const trace = game.host.trace({ start, end: add(start, { x: 0, y: 0, z: direction * 256 }), bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    if (trace.fraction !== 1 && !trace.allSolid) { game.move(entity, { origin: trace.end }); this.checkGround(context); this.categorizePosition(context); }
    return undefined;
  }

  private think(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    if (game.options.edition === "rerelease") {
      entity.renderFlags &= ~((1 << 22) | (1 << 26));
      entity.oldFrame = -1;
      const priorThink = entity.think;
      this.processPain(entity, game);
      if (!game.host.actors.isLive(entity.actor.id) || entity.think !== priorThink) return undefined;
      this.checkDodge(context);
    }
    game.schedule(entity, game.options.edition === "classic" ? 0.1 : game.host.frameSeconds(), this.sourceThink);
    this.moveFrame(context);
    if (!game.host.actors.isLive(entity.actor.id) || state.gibbed) return undefined;
    const linkCount = game.host.bodies.linked(entity.actor.id)?.linkCount ?? 0;
    if (linkCount !== state.lastLinkCount) { state.lastLinkCount = linkCount; this.checkGround(context); }
    this.categorizePosition(context);
    this.worldEffects(context);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    entity.effects &= ~256; entity.renderFlags &= ~(1024 | 2048 | 4096);
    if (state.resurrecting) { entity.effects |= 256; entity.renderFlags |= 1024; }
    game.show(entity);
    return undefined;
  }

  /** M_MoveFrame captures a frame before AI, preserving its callback when AI changes the move. */
  private moveFrame(context: MonsterContext): undefined {
    const { game, entity, state } = context;
    const rerelease = game.options.edition === "rerelease";
    let move = state.move;
    let runFrame = !rerelease || state.nextMoveTime <= game.host.now();
    if (runFrame && state.nextMove !== null && state.nextMove !== state.move) { state.move = state.nextMove; state.nextMove = null; move = state.move; }
    if (!runFrame) runFrame = entity.frame < move.firstFrame || entity.frame > move.lastFrame;
    if (runFrame) {
      let explicit = false;
      if (state.nextFrame !== 0 && state.nextFrame >= move.firstFrame && state.nextFrame <= move.lastFrame) { entity.frame = state.nextFrame; state.nextFrame = 0; }
      else {
        if (entity.frame === move.lastFrame && move.end !== null) {
          context.dispatch(move.end);
          if (rerelease && state.nextMove !== null) {
            state.move = state.nextMove; state.nextMove = null;
            if (state.nextFrame !== 0) { entity.frame = state.nextFrame; state.nextFrame = 0; explicit = true; }
          }
          move = state.move;
          if (state.corpse || (entity.serverFlags & 2) !== 0 || !game.host.actors.isLive(entity.actor.id)) return undefined;
        }
        if (entity.frame < move.firstFrame || entity.frame > move.lastFrame) { state.holdFrame = false; entity.frame = move.firstFrame; }
        else if (!explicit && !state.holdFrame) { entity.frame++; if (entity.frame > move.lastFrame) entity.frame = move.firstFrame; }
      }
      state.nextMoveTime = Math.round((game.host.now() + 0.1) * 1000) / 1000;
      if (rerelease && state.nextFrame !== 0 && (state.nextFrame < move.firstFrame || state.nextFrame > move.lastFrame)) state.nextFrame = 0;
    }
    const frame = recordAt(move.frames, entity.frame - move.firstFrame);
    const distance = state.holdFrame ? 0 : frame.distance * state.scale * (rerelease ? game.host.frameSeconds() * 10 : 1);
    if (typeof frame.ai === "string") runAi(context, frame.ai, distance);
    else {
      const handler = this.actors.get(entity.actor.id)?.ai?.[frame.ai.name];
      if (handler === undefined) throw new Error(`Missing Q2 source AI ${frame.ai.name}`);
      handler(context, distance);
    }
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (runFrame) for (const action of frame.actions) {
      if (typeof action === "string") context.dispatch(action);
      else state.nextFrame = action.frame === "next" ? entity.frame + 1 : action.frame;
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    }
    if (rerelease && frame.lerpFrame !== -1) { entity.renderFlags |= 1 << 22; entity.oldFrame = frame.lerpFrame; }
    return undefined;
  }

  private die(context: MonsterContext, definition: Q2MonsterDefinition, reaction: DeathReaction): undefined {
    const { state, entity, game } = context;
    this.sourceCombatHooks?.beforeKilled(context);
    if (!state.dead) {
      const commander = state.commander === null ? null : game.entity(state.commander);
      const commanderState = commander === null ? undefined : this.contexts.get(commander.actor.id)?.state;
      if (commander !== null && commanderState !== undefined) {
        if (state.spawnedBy === "carrier" && commander.classname === "monster_carrier") commanderState.monsterSlots++;
        else if (state.spawnedBy === "medic" && commander.classname === "monster_medic_commander") { if (game.options.edition === "rerelease") commanderState.monsterUsed -= state.monsterSlots; else commanderState.monsterSlots++; }
        else if (state.spawnedBy === "widow" && commander.classname.startsWith("monster_widow") && commanderState.monsterUsed > 0) commanderState.monsterUsed--;
      }
      if (!state.goodGuy && !state.doNotCount && (game.options.edition === "classic" || (entity.spawnflags & 65536) === 0)) game.counters.killedMonsters++;
      entity.enemy = reaction.attacker;
      if (game.options.edition === "classic" && (entity.motion === "push" || entity.motion === "stop" || entity.motion === "stationary")) {
        definition.die(context, reaction); game.show(entity); return undefined;
      }
      entity.touch = null;
      entity.flags &= ~3;
      const item = entity.spawn.values.get("item");
      if (item !== undefined && item.length > 0) {
        const origin = game.body(entity).origin;
        game.spawn({ classname: item, ordinal: -1, values: new Map([["classname", item], ["origin", `${origin.x} ${origin.y} ${origin.z}`], ["spawnflags", "65536"]]) });
      }
      if (entity.deathTarget.length > 0) entity.target = entity.deathTarget;
      if (entity.target.length > 0) game.useTargets(entity, reaction.attacker);
    }
    definition.die(context, reaction);
    game.show(entity);
    return undefined;
  }

  private queuePain(context: MonsterContext, reaction: PainReaction, hit: { readonly inflictor: ActorId | null; readonly point: Vec3 }): undefined {
    const previous = this.pendingDamage.get(context.entity.actor.id);
    this.pendingDamage.set(context.entity.actor.id, { reaction: { ...reaction, inflictor: hit.inflictor, point: hit.point,
      damage: reaction.damage + (previous?.reaction.damage ?? 0), kick: reaction.kick + (previous?.reaction.kick ?? 0) }, attack: context.entity.lastAttack });
    return undefined;
  }

  private setSkin(context: MonsterContext): undefined {
    if (context.state.gibbed || context.game.options.edition !== "rerelease") return undefined;
    if (context.state.kind === "soldier") context.entity.skin = (context.entity.skin & ~1) | (health(context.game, context.entity.actor.id) < context.entity.maxHealth / 2 ? 1 : 0);
    else if (context.state.kind === "infantry") context.entity.skin = health(context.game, context.entity.actor.id) < context.entity.maxHealth / 2 ? 1 : 0;
    return undefined;
  }

  dodge(entity: Q2Entity, game: Q2GameServices, attacker: ActorId, eta: number, trace: TraceResult | null, gravity = false): undefined {
    const context = this.contexts.get(entity.actor.id), definition = this.actors.get(entity.actor.id);
    if (context === undefined || definition === undefined) return undefined;
    if (definition.dodge !== undefined) return definition.dodge(context, attacker, eta, trace, gravity);
    const { state } = context, r = game.host.random();
    if (game.options.edition === "classic") {
      if (r > 0.25) return undefined;
      if (entity.enemy === null) entity.enemy = attacker;
      if (state.kind === "infantry") return context.setMove("infantry_move_duck");
      if (state.kind !== "soldier") return undefined;
      if (game.options.skill === 0) return context.setMove("soldier_move_duck");
      state.pauseTime = game.host.now() + eta + 0.3;
      return context.setMove(game.host.random() > (game.options.skill === 1 ? 0.33 : 0.66) ? "soldier_move_duck" : "soldier_move_attack3");
    }
    if (health(game, entity.actor.id) < 1) return undefined;
    const ducker = definition.duck !== undefined && !gravity, dodger = definition.sidestep !== undefined && !state.standGround;
    if (!ducker && !dodger) return undefined;
    if (entity.enemy === null) { entity.enemy = attacker; this.perception.foundTarget(context); }
    if (eta < game.host.frameSeconds() || eta > 2.5 || r > 0.5) return undefined;
    const body = game.body(entity), height = body.origin.z + body.bounds.max.z - (ducker && trace !== null ? 32 : 0);
    if (ducker && trace !== null && !dodger && (trace.end.z <= height || state.ducked)) return undefined;
    if (dodger) {
      if (state.dodging) return undefined;
      if (!ducker || trace === null || trace.end.z <= height || state.ducked) {
        if (game.options.skill < 2 && game.host.random() >= (game.options.skill === 0 ? 0.25 : 0.5)) { state.dodgeTime = game.host.now() + 0.8 + game.host.random() * 0.6; return undefined; }
        state.lefty = trace === null ? game.host.random() < 0.5 : dot(anglesVectors(body.angles).right, subtract(trace.end, body.origin)) >= 0;
        if (definition.sidestep?.(context) === true) {
          if (ducker && state.ducked) sharedCallbacks.monster_duck_up(context);
          state.dodging = true; state.attackState = "sliding"; state.dodgeTime = game.host.now() + 0.4 + game.host.random() * 1.6;
        }
        return undefined;
      }
    }
    if (ducker && trace !== null && eta < 0.5) {
      if (state.nextDuckTime > game.host.now()) return undefined;
      finishDodge(context);
      if (definition.duck?.(context, eta) === true) {
        if (state.duckWait < game.host.now()) state.duckWait = game.host.now() + eta;
        sharedCallbacks.monster_duck_down(context);
        if (game.options.skill === 0) state.duckWait += 0.5 + game.host.random() * 0.5;
        else if (game.options.skill === 1) state.duckWait += 0.1 + game.host.random() * 0.25;
      }
      state.dodgeTime = game.host.now() + 0.2 + game.host.random() * 0.5;
    }
    return undefined;
  }

  private checkDodge(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    const definition = this.actors.get(entity.actor.id);
    if (state.dead || state.dodgeTime > game.host.now() || definition === undefined || definition.dodge === undefined && definition.duck === undefined && definition.sidestep === undefined) return undefined;
    const body = game.body(entity), forward = anglesVectors(body.angles).forward;
    const min = add(add(body.origin, body.bounds.min), { x: -512, y: -512, z: -512 });
    const max = add(add(body.origin, body.bounds.max), { x: 512, y: 512, z: 512 });
    for (const projectile of game.entities.values()) {
      if (!projectile.projectile || !projectile.dodgeable || projectile.solid === "none" || projectile.owner === null) continue;
      const shot = game.body(projectile), speed = length(shot.velocity), shotMin = add(shot.origin, shot.bounds.min), shotMax = add(shot.origin, shot.bounds.max);
      if (speed < 4 || shotMin.x > max.x || shotMin.y > max.y || shotMin.z > max.z || shotMax.x < min.x || shotMax.y < min.y || shotMax.z < min.z || dot(normalize(subtract(shot.origin, body.origin)), forward) <= 0.35) continue;
      const trace = game.host.trace({ start: shot.origin, end: add(shot.origin, shot.velocity), bounds: shot.bounds, ignore: projectile.actor.id, mask: projectile.clipMask });
      if (trace.hit.kind !== "actor" || trace.hit.actor !== entity.actor.id) continue;
      this.dodge(entity, game, projectile.owner, length(subtract(trace.end, shot.origin)) / speed, trace, projectile.motion === "bounce" || projectile.motion === "toss");
      break;
    }
    return undefined;
  }

  private blocked(context: MonsterContext, distance: number): boolean {
    const { game, entity, state } = context, enemy = enemyBody(context), body = game.body(entity);
    if (enemy === null || state.kind === "soldier" && (state.dodging || state.ducked)) return false;
    const forward = anglesVectors(body.angles).forward;
    if (state.kind === "infantry" && (entity.spawnflags & 8) === 0 && state.jumpTime <= game.host.now()) {
      const selfMin = body.origin.z + body.bounds.min.z, enemyMin = enemy.origin.z + enemy.bounds.min.z;
      const ahead = add(body.origin, scale(forward, 48));
      const down = enemyMin < selfMin - 18, up = enemyMin > selfMin + 18;
      if (down || up) {
        const start = up ? { ...ahead, z: body.origin.z + body.bounds.max.z + 40 } : ahead;
        const end = down ? { ...ahead, z: selfMin - 193 } : ahead;
        if (!down || game.host.trace({ start: body.origin, end: ahead, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) }).fraction === 1) {
          const trace = game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) | MASK_WATER });
          const solid = game.host.pointContents(add(trace.end, { x: 0, y: 0, z: -1 }));
          if (trace.fraction < 1 && !trace.allSolid && !trace.startSolid && (solid & (3 | 32)) !== 0 && (up ? trace.end.z - selfMin <= 40 : selfMin - trace.end.z >= 24 && enemyMin - trace.end.z <= 32 && trace.contact.kind === "plane" && trace.contact.plane.normal.z >= 0.9)) {
            if ((solid & 32) !== 0) {
              const deep = game.host.trace({ start: trace.end, end, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
              if ((game.host.pointContents(add(deep.end, { x: 0, y: 0, z: 48 })) & MASK_WATER) !== 0) return false;
            }
            finishDodge(context); state.jumpTime = game.host.now() + 3; context.setMove(up ? "infantry_move_jump2" : "infantry_move_jump"); return true;
          }
        }
      }
    }
    const above = enemy.origin.z + enemy.bounds.min.z >= body.origin.z + body.bounds.max.z, below = enemy.origin.z + enemy.bounds.max.z <= body.origin.z + body.bounds.min.z;
    if (!above && !below) return false;
    let platform = game.entity(body.ground);
    if (!platform?.classname.startsWith("func_plat")) {
      const start = add(body.origin, scale(forward, distance));
      const trace = game.host.trace({ start, end: add(start, { x: 0, y: 0, z: -384 }), bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
      platform = trace.hit.kind === "actor" ? game.entity(trace.hit.actor) : null;
    }
    if (platform === null || !platform.classname.startsWith("func_plat") || platform.use === null) return false;
    const endpoint = this.hooks.platformState?.(platform.actor.id) ?? null;
    const onPlatform = body.ground === platform.actor.id;
    if (above ? onPlatform && endpoint === "bottom" || !onPlatform && endpoint === "top" : onPlatform && endpoint === "top" || !onPlatform && endpoint === "bottom") { platform.use(platform, game, entity.actor.id, entity.actor.id); return true; }
    return false;
  }

  touchPathCorner(corner: Q2Entity, game: Q2GameServices, actor: ActorId): undefined {
    const context = this.contexts.get(actor);
    if (context === undefined || context.state.moveTarget !== corner.actor.id || context.entity.enemy !== null) return undefined;
    const { entity, state } = context;
    const pathTarget = corner.spawn.values.get("pathtarget");
    if (pathTarget !== undefined) { const saved = corner.target; corner.target = pathTarget; game.useTargets(corner, actor); corner.target = saved; }
    let next = corner.target.length > 0 ? game.pickTarget(corner.target) : null;
    if (next !== null && (next.spawnflags & 1) !== 0) {
      const destination = game.body(next), body = game.body(entity);
      game.move(entity, { origin: { ...destination.origin, z: destination.origin.z + destination.bounds.min.z - body.bounds.min.z } });
      game.host.emit({ kind: "entity-event", actor: entity.actor.id, event: 7 });
      next = game.pickTarget(next.target);
    }
    entity.goal = state.moveTarget = next?.actor.id ?? null;
    if (corner.wait !== 0) { state.pauseTime = game.host.now() + corner.wait; context.stand(); }
    else if (next === null) { state.pauseTime = game.host.now() + 100000000; context.stand(); }
    else state.idealYaw = vectorAngles(subtract(game.body(next).origin, game.body(entity).origin)).y;
    return undefined;
  }

  touchCombatPoint(corner: Q2Entity, game: Q2GameServices, actor: ActorId): undefined {
    const context = this.contexts.get(actor);
    if (context === undefined || context.state.moveTarget !== corner.actor.id) return undefined;
    const { entity, state } = context;
    if (corner.target.length > 0) {
      entity.target = corner.target;
      const target = game.pickTarget(entity.target);
      entity.goal = state.moveTarget = target?.actor.id ?? null;
      if (target === null) { game.host.diagnostic(`point_combat target ${corner.target} does not exist`); state.moveTarget = corner.actor.id; }
      corner.target = "";
    } else if ((corner.spawnflags & 1) !== 0 && state.locomotion === "walk") { state.pauseTime = game.host.now() + 100000000; state.standGround = true; context.stand(); }
    if (state.moveTarget === corner.actor.id) { entity.target = ""; state.moveTarget = null; entity.goal = entity.enemy; state.combatPoint = false; }
    const pathTarget = corner.spawn.values.get("pathtarget");
    if (pathTarget !== undefined) {
      const saved = corner.target; corner.target = pathTarget;
      const activator = [entity.enemy, state.oldEnemy, entity.activator].find(candidate => candidate !== null && game.host.isPlayer(candidate)) ?? actor;
      game.useTargets(corner, activator); corner.target = saved;
    }
    return undefined;
  }

  private checkGround(context: MonsterContext): undefined {
    const { entity, game } = context, body = game.body(entity);
    if ((entity.flags & 3) !== 0) return undefined;
    if (body.velocity.z * entity.gravityVector.z < -100) return game.move(entity, { ground: null }, false);
    const trace = game.host.trace({ start: body.origin, end: add(body.origin, { x: 0, y: 0, z: 0.25 * entity.gravityVector.z }), bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    const steep = trace.contact.kind !== "plane" || (entity.gravityVector.z < 0 ? trace.contact.plane.normal.z < 0.7 : trace.contact.plane.normal.z > -0.7);
    if (!trace.startSolid && steep) return game.move(entity, { ground: null }, false);
    if (!trace.startSolid && !trace.allSolid) game.move(entity, { origin: trace.end, ground: traceGroundActor(trace, game), velocity: { ...body.velocity, z: 0 } }, false);
    return undefined;
  }

  private categorizePosition(context: MonsterContext): undefined {
    const { game, entity, state } = context, body = game.body(entity);
    const feet = { ...body.origin, z: body.origin.z + (entity.gravityVector.z > 0 ? body.bounds.max.z - 1 : body.bounds.min.z + 1) };
    const contents = game.host.pointContents(feet);
    state.waterLevel = (contents & MASK_WATER) === 0 ? 0 : (game.host.pointContents(add(feet, { x: 0, y: 0, z: 26 })) & MASK_WATER) === 0 ? 1 : (game.host.pointContents(add(feet, { x: 0, y: 0, z: 48 })) & MASK_WATER) === 0 ? 2 : 3;
    state.waterType = state.waterLevel === 0 ? 0 : contents;
    return undefined;
  }

  private worldEffects(context: MonsterContext): undefined {
    const { game, entity, state } = context, body = game.body(entity);
    const water = state.waterLevel, contents = state.waterType;
    const world = game.host.worldActor();
    if (health(game, entity.actor.id) > 0) {
      if (state.locomotion === "swim" ? water > 0 : water < 3) state.airFinished = game.host.now() + (state.locomotion === "swim" ? 9 : 12);
      else if (state.airFinished < game.host.now() && state.painTime < game.host.now()) { game.damage(entity.actor.id, world, world, Math.min(15, 2 + 2 * Math.floor(game.host.now() - state.airFinished)), 0, zero, body.origin, zero, 17, 2); state.painTime = game.host.now() + 1; }
    }
    if (water === 0) { if ((entity.flags & 8) !== 0) game.sound(entity, "player/watr_out.wav", 4); entity.flags &= ~8; return undefined; }
    if ((contents & 8) !== 0 && (entity.flags & 128) === 0 && state.environmentalDamageTime < game.host.now()) { state.environmentalDamageTime = game.host.now() + 0.2; game.damage(entity.actor.id, world, world, 10 * water, 0, zero, body.origin, zero, 19); }
    if ((contents & 16) !== 0 && (entity.flags & 64) === 0 && state.environmentalDamageTime < game.host.now()) { state.environmentalDamageTime = game.host.now() + 1; game.damage(entity.actor.id, world, world, 4 * water, 0, zero, body.origin, zero, 18); }
    if ((entity.flags & 8) === 0) {
      if (!state.dead) game.sound(entity, (contents & 8) !== 0 ? game.host.random() <= 0.5 ? "player/lava1.wav" : "player/lava2.wav" : "player/watr_in.wav", 4);
      entity.flags |= 8; state.environmentalDamageTime = 0;
    }
    return undefined;
  }
}

function stateLocomotion(definition: Q2MonsterDefinition): MonsterState["locomotion"] { return definition.locomotion ?? "walk"; }

function mergeCallbacks<T>(sources: readonly (Readonly<Record<string, T>> | undefined)[]): Readonly<Record<string, T>> {
  const result: Record<string, T> = {};
  for (const source of sources) for (const [name, callback] of Object.entries(source ?? {})) {
    if (result[name] !== undefined && result[name] !== callback) throw new Error(`Duplicate Q2 monster source callback ${name}`);
    result[name] = callback;
  }
  return result;
}
