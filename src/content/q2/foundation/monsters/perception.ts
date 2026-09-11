/* Q2 g_ai target selection, attacks and player-trail pursuit. GPL-2.0-or-later. */
import type { SavedActorId } from "../../../../contracts/session.ts";
import { saveQ2Actor } from "../checkpoint.ts";
import type { Q2MonsterPerceptionCheckpoint } from "./checkpoint.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2GameServices } from "../host.ts";
import { add, length, scale, subtract, zero } from "../fields.ts";
import { anglesVectors, changeYaw, chaseDirection, enemyBody, enemyEye, FL_NOTARGET, health, inFront, monsterSolidMask, MASK_OPAQUE, attackTraceMask, stepDirection, targetDistance, vectorAngles, visible } from "./ai.ts";
import type { MonsterContext, Q2MonsterSourceCombatHooks, Q2MonsterHintHooks } from "./types.ts";

interface Sighting { readonly actor: ActorId; readonly time: number; }
interface Noise extends Sighting { readonly owner: ActorId; readonly origin: Vec3; }
interface TrailPoint { readonly origin: Vec3; readonly time: number; readonly yaw: number; }

export function facingIdeal(context: MonsterContext): boolean {
  const delta = ((context.game.body(context.entity).angles.y - context.state.idealYaw) % 360 + 360) % 360;
  return delta <= 45 || delta >= 315;
}

/** The species-specific M_CheckAttack slot; the controller handles turning and dispatch separately. */
export interface Q2AttackChanceProfile { readonly standGround: number; readonly melee: number; readonly near: number; readonly mid: number; readonly far: number; readonly strafeScalar: number; }
const normalAttackChances: Q2AttackChanceProfile = { standGround: 0.7, melee: 0.4, near: 0.25, mid: 0.06, far: 0, strafeScalar: 1 };
export function defaultCheckAttack(context: MonsterContext, profile: Q2AttackChanceProfile = normalAttackChances): boolean {
  const { game, state, entity } = context;
  const target = enemyEye(context);
  if (target === null) return false;
  const rerelease = game.options.edition === "rerelease";
  const rogue = context.sourceCombatRules() === "rogue";
  const body = game.body(entity), start = { ...body.origin, z: body.origin.z + entity.viewHeight };
  if (health(game, entity.enemy) > 0) {
    const trace = game.host.trace({ start, end: target, bounds: null, ignore: entity.actor.id, mask: attackTraceMask(game) });
    if (!(trace.hit.kind === "actor" && (trace.hit.actor === entity.enemy || rerelease && game.host.isPlayer(trace.hit.actor)))) {
      const targetEntity = game.entity(entity.enemy);
      if (!rerelease && !rogue || targetEntity?.solid !== "none" || trace.fraction < 1) {
        if ((rerelease || rogue) && state.blindFire && (!rerelease || state.hadVisibility) && state.blindFireDelay <= 20 && !visible(context) && !(trace.hit.kind === "actor" && game.host.isMonster(trace.hit.actor)) && game.host.now() >= state.attackFinished && game.host.now() >= state.trailTime + state.blindFireDelay) {
          const blind = game.host.trace({ start, end: state.blindFireTarget, bounds: null, ignore: entity.actor.id, mask: 0x2000000 });
          if (!blind.allSolid && !blind.startSolid && (blind.fraction === 1 || blind.hit.kind === "actor" && blind.hit.actor === entity.enemy)) { state.attackState = "blind"; return true; }
        }
        return false;
      }
    }
  }
  const distance = targetDistance(context);
  if (rerelease ? distance <= 20 : distance < 80) {
    if (!rerelease && game.options.skill === 0 && Math.floor(game.host.random() * 4) !== 0) { if (rogue) state.attackState = "straight"; return false; }
    state.attackState = state.hasMelee && (!rerelease || state.meleeTime <= game.host.now()) ? "melee" : "missile";
    return true;
  }
  if (rerelease && state.attackState === "melee" && state.meleeTime > game.host.now()) state.attackState = "missile";
  if (!state.hasRangedAttack) { if (rerelease || rogue) state.attackState = "straight"; return false; }
  if (game.host.now() < state.attackFinished || !rerelease && distance >= 1000) return false;
  let chance = rerelease ? state.standGround ? profile.standGround : distance <= 20 ? profile.melee : distance <= 440 ? profile.near : distance <= 940 ? profile.mid : profile.far
    : state.standGround ? 0.4 : distance < 500 ? 0.1 : distance < 1000 ? 0.02 : 0;
  if (!rerelease) chance *= game.options.skill === 0 ? 0.5 : game.options.skill >= 2 ? 2 : 1;
  const nonSolidEnemy = game.entity(entity.enemy)?.solid === "none";
  if (rerelease ? entity.enemy !== null && !game.host.isPlayer(entity.enemy) && nonSolidEnemy || game.host.random() < chance : game.host.random() < chance || rogue && nonSolidEnemy) {
    state.attackState = "missile";
    state.attackFinished = game.host.now() + (rerelease ? 0 : 2 * game.host.random());
    return true;
  }
  if (state.locomotion === "fly" && (!rerelease || state.strafeTime <= game.host.now())) {
    let strafeChance = rerelease || rogue ? entity.classname === "monster_daedalus" ? 0.8 : 0.6 : 0.3;
    if ((rerelease || rogue) && (game.entity(entity.enemy)?.classname === "tesla" || rerelease && game.entity(entity.enemy)?.classname === "tesla_mine")) strafeChance = 0;
    else if (rerelease) strafeChance *= profile.strafeScalar;
    if (rerelease && strafeChance === 0) return false;
    const next = game.host.random() < strafeChance ? "sliding" : "straight";
    if (rerelease && next !== state.attackState) state.strafeTime = game.host.now() + 1 + game.host.random() * 2;
    state.attackState = next;
  } else if (rerelease && state.locomotion !== "fly" && state.pathing === null) state.attackState = "straight";
  return false;
}

export class MonsterPerception {
  private services: Q2GameServices | null = null;
  private sightClient: ActorId | null = null;
  private sight: Sighting | null = null;
  private readonly alerted = new Map<ActorId, Sighting>();
  private primary: Noise | null = null;
  private secondary: Noise | null = null;
  private readonly noises = new Map<ActorId, { readonly primary: ActorId; readonly secondary: ActorId }>();
  private readonly trails = new Map<ActorId, TrailPoint[]>();
  private readonly playerOrigins = new Map<ActorId, Vec3>();
  private readonly hostile = new Map<ActorId, number>();
  private lastFrame = -Infinity;

  private sourceCombatRules: "base" | "rogue" = "base";
  private sourceCombatHooks: Q2MonsterSourceCombatHooks | null = null;
  private hintHooks: Q2MonsterHintHooks | null = null;
  constructor(private readonly contexts: ReadonlyMap<ActorId, MonsterContext>) {}
  setSourceCombatRules(rules: "base" | "rogue", hooks: Q2MonsterSourceCombatHooks | null): undefined {
    this.sourceCombatRules = rules; this.sourceCombatHooks = hooks; return undefined;
  }
  setHintPaths(hooks: Q2MonsterHintHooks): undefined { this.hintHooks = hooks; return undefined; }
  get currentSightClient(): ActorId | null { return this.sightClient; }

  bind(game: Q2GameServices): undefined { this.services = game; return undefined; }

  capture(): Q2MonsterPerceptionCheckpoint {
    const actor = (id: ActorId): SavedActorId => ({ slot: id.slot, generation: id.generation });
    const sight = (value: Sighting | null) => value === null ? null : { ...value, actor: actor(value.actor) };
    const noise = (value: Noise | null) => value === null ? null : { ...value, actor: actor(value.actor), owner: actor(value.owner) };
    return structuredClone({ sightClient: saveQ2Actor(this.sightClient), sight: sight(this.sight),
      alerted: [...this.alerted].map(([id, value]) => ({ actor: actor(id), sighting: { ...value, actor: actor(value.actor) } })),
      primary: noise(this.primary), secondary: noise(this.secondary),
      noises: [...this.noises].map(([id, value]) => ({ actor: actor(id), primary: actor(value.primary), secondary: actor(value.secondary) })),
      trails: [...this.trails].map(([id, points]) => ({ actor: actor(id), points })),
      playerOrigins: [...this.playerOrigins].map(([id, origin]) => ({ actor: actor(id), origin })),
      hostile: [...this.hostile].map(([id, time]) => ({ actor: actor(id), time })), lastFrame: Number.isFinite(this.lastFrame) ? this.lastFrame : null });
  }

  restore(game: Q2GameServices, checkpoint: Q2MonsterPerceptionCheckpoint): undefined {
    this.services = game;
    const saved = structuredClone(checkpoint);
    const actor = (id: SavedActorId): ActorId => game.host.actors.referenceSaved(id);
    this.sightClient = saved.sightClient === null ? null : actor(saved.sightClient);
    this.sight = saved.sight === null ? null : { ...saved.sight, actor: actor(saved.sight.actor) };
    this.primary = saved.primary === null ? null : { ...saved.primary, actor: actor(saved.primary.actor), owner: actor(saved.primary.owner) };
    this.secondary = saved.secondary === null ? null : { ...saved.secondary, actor: actor(saved.secondary.actor), owner: actor(saved.secondary.owner) };
    this.alerted.clear(); this.noises.clear(); this.trails.clear(); this.playerOrigins.clear(); this.hostile.clear();
    for (const value of saved.alerted) this.alerted.set(actor(value.actor), { ...value.sighting, actor: actor(value.sighting.actor) });
    for (const value of saved.noises) this.noises.set(actor(value.actor), { primary: actor(value.primary), secondary: actor(value.secondary) });
    for (const value of saved.trails) this.trails.set(actor(value.actor), [...value.points]);
    for (const value of saved.playerOrigins) this.playerOrigins.set(actor(value.actor), value.origin);
    for (const value of saved.hostile) this.hostile.set(actor(value.actor), value.time);
    this.lastFrame = saved.lastFrame ?? -Infinity;
    return undefined;
  }

  release(actor: ActorId): undefined {
    this.noises.delete(actor); this.alerted.delete(actor); this.trails.delete(actor); this.playerOrigins.delete(actor); this.hostile.delete(actor);
    return undefined;
  }

  beginFrame(game: Q2GameServices): undefined {
    this.services = game;
    if (this.lastFrame === game.host.now()) return undefined;
    this.lastFrame = game.host.now();
    const players = game.host.players();
    const current = this.sightClient === null ? 0 : players.indexOf(this.sightClient);
    this.sightClient = null;
    for (let i = 1; i <= players.length; i++) {
      const candidate = players[(current + i) % players.length];
      if (candidate !== undefined && this.targetable(game, candidate) && (this.sourceCombatRules !== "rogue" || ((game.entity(candidate)?.flags ?? 0) & 0x8000) === 0)) { this.sightClient = candidate; break; }
    }
    for (const player of players) {
      const body = game.host.bodies.read(player);
      if (body === null || health(game, player) <= 0) continue;
      const trail = this.trails.get(player) ?? [];
      const previous = trail.at(-1);
      const playerEye = { ...body.origin, z: body.origin.z + (game.entity(player)?.viewHeight ?? 22) };
      if (previous === undefined || game.host.trace({ start: playerEye, end: previous.origin, bounds: null, ignore: player, mask: MASK_OPAQUE }).fraction !== 1) {
        const oldOrigin = this.playerOrigins.get(player) ?? body.origin;
        trail.push({ origin: oldOrigin, time: game.host.now(), yaw: previous === undefined ? body.angles.y : vectorAngles(subtract(oldOrigin, previous.origin)).y });
        if (trail.length > 8) trail.shift();
        this.trails.set(player, trail);
      }
      this.playerOrigins.set(player, body.origin);
    }
    return undefined;
  }

  reportNoise(actor: ActorId, origin: Vec3, secondary: boolean): undefined {
    const game = this.services;
    if (game === null || !game.host.actors.isLive(actor) || game.options.mode === "deathmatch" || ((game.entity(actor)?.flags ?? 0) & FL_NOTARGET) !== 0) return undefined;
    let pair = this.noises.get(actor);
    if (pair === undefined) {
      const primary = game.create("player_noise"), other = game.create("player_noise");
      for (const noise of [primary, other]) {
        noise.owner = actor; noise.visible = false; noise.serverFlags |= 1;
        game.move(noise, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }, false);
      }
      pair = { primary: primary.actor.id, secondary: other.actor.id };
      this.noises.set(actor, pair);
    }
    const noise = game.entity(secondary ? pair.secondary : pair.primary);
    if (noise === null) return undefined;
    game.move(noise, { origin });
    const record = { actor: noise.actor.id, owner: actor, origin, time: game.host.now() };
    if (secondary) this.secondary = record; else this.primary = record;
    return undefined;
  }

  private targetable(game: Q2GameServices, actor: ActorId): boolean { return game.host.actors.isLive(actor) && health(game, actor) > 0 && ((game.entity(actor)?.flags ?? 0) & (FL_NOTARGET | (game.options.edition === "rerelease" ? 0x1008000 : 0))) === 0; }

  private visualCandidate(context: MonsterContext, actor: ActorId): boolean {
    const { game, state, entity } = context;
    const target = game.host.bodies.read(actor);
    if (target === null || !game.host.actors.isLive(actor)) return false;
    const saved = entity.enemy; entity.enemy = actor;
    const distance = targetDistance(context); entity.enemy = saved;
    if (game.options.edition === "rerelease") {
      if (distance > 940) return false;
      return distance <= 440 && (this.hostile.get(actor) ?? -1) >= game.host.now() && (entity.spawnflags & 1) === 0 || visible(context, actor) && (distance <= 20 || inFront(context, actor));
    }
    if (distance >= 1000 || (game.entity(actor)?.lightLevel ?? 128) <= 5 || !visible(context, actor)) return false;
    if (distance >= 80 && distance < 500 && (this.contexts.get(actor)?.state.showHostile ?? this.hostile.get(actor) ?? -1) < game.host.now() && !inFront(context, actor)) return false;
    if (distance >= 500 && !inFront(context, actor)) return false;
    return !state.goodGuy;
  }

  findTarget(context: MonsterContext): boolean {
    const { game, entity, state } = context;
    if (state.goodGuy || state.combatPoint || state.dead) return false;
    const now = game.host.now(), recent = (record: Sighting | null): boolean => record !== null && record.time >= now - (game.options.edition === "classic" ? 0.1 : game.host.frameSeconds());
    let candidate: ActorId | null = null, noise: Noise | null = null;
    if (game.options.edition === "rerelease") {
      const candidates = game.host.players().filter(actor => {
        if (!this.targetable(game, actor)) return false;
        const target = game.host.bodies.read(actor);
        return target !== null && (this.closeEnough(context, target.origin, 0, actor) || inFront(context, actor) && visible(context, actor));
      });
      candidate = candidates.length === 0 ? null : candidates[Math.floor(game.host.random() * candidates.length)] ?? null;
      if (candidate === entity.enemy && state.soundTarget === null) return false;
      if (candidate === null && (entity.spawnflags & 1) === 0) {
        for (const sight of this.alerted.values()) if (recent(sight) && this.visualCandidate(context, sight.actor)) { candidate = sight.actor; break; }
      }
    } else if (recent(this.sight) && (entity.spawnflags & 1) === 0) {
      candidate = this.sight?.actor ?? null;
      if (game.entity(candidate)?.enemy === entity.enemy) return false;
    }
    if (candidate === null) {
      if (recent(this.primary)) noise = this.primary;
      else if (entity.enemy === null && (entity.spawnflags & 1) === 0 && recent(this.secondary)) noise = this.secondary;
      if (noise !== null) candidate = noise.actor;
      else if (game.options.edition === "classic") candidate = this.sightClient;
    }
    if (candidate === null || !game.host.actors.isLive(candidate)) return false;
    if (state.hintPath && game.options.mode === "coop") noise = null;
    if (candidate === entity.enemy && !(game.options.edition === "rerelease" && noise !== null && state.soundTarget !== null)) return true;
    const candidateEntity = game.entity(candidate);
    if (noise !== null) {
      if (((game.entity(noise.owner)?.flags ?? 0) & FL_NOTARGET) !== 0) return false;
      const origin = game.body(entity).origin;
      if ((entity.spawnflags & 1) !== 0 ? !visible(context, candidate) : !game.host.inPhs(origin, noise.origin)) return false;
      if (length(subtract(noise.origin, origin)) > 1000 || !game.host.areasConnected(origin, noise.origin)) return false;
      state.idealYaw = vectorAngles(subtract(noise.origin, origin)).y;
      if (!state.manualSteering) changeYaw(context);
      if (state.temporaryStandGround) { state.standGround = false; state.temporaryStandGround = false; }
      state.soundTarget = noise;
      entity.enemy = candidate;
    } else {
      if (game.host.isPlayer(candidate)) { if (!this.targetable(game, candidate)) return false; }
      else if (game.host.isMonster(candidate)) {
        if (candidateEntity?.enemy === null || candidateEntity?.enemy === undefined || !this.targetable(game, candidateEntity.enemy)) return false;
      } else return false;
      if (!this.visualCandidate(context, candidate)) return false;
      state.soundTarget = null;
      entity.enemy = game.host.isPlayer(candidate) ? candidate : candidateEntity?.enemy ?? null;
      if (entity.enemy === null || !game.host.isPlayer(entity.enemy)) { entity.enemy = null; return false; }
    }
    if (state.hintPath && this.hintHooks !== null) { this.hintHooks.stop(context); return true; }
    this.foundTarget(context);
    if (state.soundTarget === null) {
      if (game.options.edition === "classic" || !state.closeSightTripped) context.dispatch("$sight");
      state.closeSightTripped = true;
    }
    return true;
  }

  huntTarget(context: MonsterContext): undefined {
    const { game, entity, state } = context, enemy = enemyBody(context);
    if (enemy === null) return undefined;
    entity.goal = entity.enemy;
    if (state.standGround) context.stand(); else context.run();
    state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
    if (game.options.edition === "classic" && !state.standGround) state.attackFinished = game.host.now() + 1;
    return undefined;
  }

  foundTarget(context: MonsterContext): undefined {
    const { game, entity, state } = context, enemy = enemyBody(context);
    if (enemy === null) return undefined;
    if (entity.enemy !== null && game.host.isPlayer(entity.enemy)) {
      const player = game.entity(entity.enemy);
      if (player !== null && this.sourceCombatRules === "rogue") player.flags &= ~0x8000;
      const record = { actor: entity.actor.id, time: game.host.now() };
      this.sight = record; this.alerted.set(entity.enemy, record); this.hostile.set(entity.enemy, game.host.now() + 1);
    }
    state.showHostile = game.host.now() + 1;
    if (game.options.edition === "rerelease") {
      if (state.trailTime === 0) state.attackFinished = game.host.now() + 0.6;
      state.attackFinished += game.options.skill === 0 ? 0.4 : game.options.skill === 1 ? 0.2 : 0;
      state.savedGoal = enemy.origin; state.blindFireTarget = add(enemy.origin, scale(enemy.velocity, -0.1)); state.blindFireDelay = 0;
    }
    state.lastSighting = enemy.origin; state.trailTime = game.host.now();
    if (this.sourceCombatRules === "rogue" && game.options.edition === "classic") state.blindFireTarget = enemy.origin;
    if (state.combatPoint) return undefined;
    if (state.combatTarget.length === 0) return this.huntTarget(context);
    const target = game.pickTarget(state.combatTarget);
    if (target === null) { game.host.diagnostic(`${entity.classname}: combattarget ${state.combatTarget} not found`); return this.huntTarget(context); }
    state.combatTarget = entity.combatTarget = ""; state.combatPoint = true; state.moveTarget = target.actor.id; entity.goal = target.actor.id;
    if (game.options.edition === "classic") target.targetname = "";
    state.pauseTime = 0;
    return context.run();
  }

  reactToDamage(context: MonsterContext, attacker: ActorId | null): undefined {
    const { game, entity, state } = context;
    if (attacker === null || !game.host.isPlayer(attacker) && !game.host.isMonster(attacker)) return undefined;
    if (this.sourceCombatHooks?.beforeReact(context, attacker) === true) return undefined;
    if (attacker === entity.actor.id || attacker === entity.enemy) return undefined;
    const other = game.entity(attacker);
    if (state.goodGuy && (game.host.isPlayer(attacker) || this.contexts.get(attacker)?.state.goodGuy === true || other !== null && this.sourceCombatHooks?.isGoodGuy(other) === true)) return undefined;
    if (game.host.isPlayer(attacker)) {
      state.soundTarget = null;
      if (entity.enemy !== null && game.host.isPlayer(entity.enemy)) {
        if (visible(context)) { state.oldEnemy = attacker; return undefined; }
        state.oldEnemy = entity.enemy;
      }
      entity.enemy = attacker;
    } else if (other !== null) {
      const ignoreShots = this.sourceCombatRules === "rogue" || game.options.edition === "rerelease"
        ? state.ignoreShots || this.contexts.get(attacker)?.state.ignoreShots === true
        : ["monster_tank", "monster_supertank", "monster_makron", "monster_jorg"].includes(other.classname);
      const retaliate = (entity.flags & 3) === (other.flags & 3) && entity.classname !== other.classname && !ignoreShots || other.enemy === entity.actor.id;
      if (entity.enemy !== null && game.host.isPlayer(entity.enemy)) state.oldEnemy = entity.enemy;
      if (retaliate) entity.enemy = attacker;
      else if (other.enemy !== null && other.enemy !== entity.actor.id) entity.enemy = other.enemy;
      else return undefined;
    } else entity.enemy = attacker;
    if (!state.ducked) this.foundTarget(context);
    return undefined;
  }

  checkAttack(context: MonsterContext, check: (context: MonsterContext) => boolean): boolean {
    const { game, entity, state } = context;
    if (state.combatPoint) return false;
    if (state.soundTarget !== null) {
      const fresh = this.primary?.actor === state.soundTarget.actor ? this.primary : this.secondary?.actor === state.soundTarget.actor ? this.secondary : state.soundTarget;
      state.soundTarget = fresh;
      if (game.host.now() - fresh.time <= 5) { state.showHostile = game.host.now() + 1; return false; }
      if (entity.goal === entity.enemy) entity.goal = state.moveTarget;
      state.soundTarget = null;
      if (state.temporaryStandGround) { state.standGround = false; state.temporaryStandGround = false; }
    }
    let enemy = enemyBody(context);
    const enemyHealth = health(game, entity.enemy);
    if (enemy === null || (state.medic ? enemyHealth > 0 : state.brutal ? game.options.edition === "classic" && enemyHealth <= -80 : enemyHealth <= 0)) {
      if (this.sourceCombatRules === "rogue") state.medic = false;
      entity.enemy = null; state.closeSightTripped = false;
      if (game.options.edition === "rerelease") entity.goal = null;
      if (state.oldEnemy !== null && health(game, state.oldEnemy) > 0) { entity.enemy = state.oldEnemy; state.oldEnemy = null; this.huntTarget(context); enemy = enemyBody(context); }
      else if (this.sourceCombatRules === "rogue" && this.sourceCombatHooks !== null) {
        entity.enemy = this.sourceCombatHooks.recoverEnemy(context);
        if (entity.enemy !== null) { state.oldEnemy = null; this.huntTarget(context); enemy = enemyBody(context); }
        else {
          if (state.moveTarget !== null) { entity.goal = state.moveTarget; context.walk(); }
          else { state.pauseTime = game.host.now() + 100000000; context.stand(); }
          return true;
        }
      } else {
        if (state.moveTarget !== null && (game.options.edition === "classic" || !state.standGround)) { entity.goal = state.moveTarget; context.walk(); }
        else { state.pauseTime = game.host.now() + 100000000; context.stand(); }
        return true;
      }
    }
    if (enemy === null) return false;
    const enemyVisible = visible(context);
    if (enemyVisible) {
      state.searchTime = game.host.now() + 5; state.lastSighting = enemy.origin;
      if (this.sourceCombatRules === "rogue" && game.options.edition === "classic") { state.lostSight = false; state.trailTime = game.host.now(); state.blindFireTarget = enemy.origin; state.blindFireDelay = 0; }
      if (game.options.edition === "rerelease") {
        state.hadVisibility = true; state.lostSight = false; state.savedGoal = enemy.origin; state.trailTime = game.host.now();
        state.blindFireTarget = add(enemy.origin, scale(enemy.velocity, -0.1)); state.blindFireDelay = 0;
        if (entity.enemy !== null) this.hostile.set(entity.enemy, game.host.now() + 1);
      }
    }
    const rerelease = game.options.edition === "rerelease";
    if (!rerelease && this.sourceCombatRules === "rogue") {
      const selected = check(context);
      if (!selected) return false;
      if (state.attackState === "missile" || state.attackState === "melee" || state.attackState === "blind") {
        state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
        if (!state.manualSteering) changeYaw(context);
        if (facingIdeal(context)) {
          if (state.attackState === "melee") { context.melee(); state.attackState = "straight"; }
          else { context.attack(); if (state.attackState === "missile" || state.attackState === "blind") state.attackState = "straight"; }
        }
        return true;
      }
      return enemyVisible;
    }
    let selected = false;
    if (rerelease && state.checkAttackTime <= game.host.now()) { state.checkAttackTime = game.host.now() + 0.1; selected = check(context); }
    if (state.attackState === "missile" || state.attackState === "melee" || rerelease && state.attackState === "blind") {
      state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
      if (!state.manualSteering) changeYaw(context);
      if (facingIdeal(context)) {
        if (state.attackState === "melee") context.melee();
        else { context.attack(); if (rerelease) state.attackFinished = game.host.now() + 1 + game.host.random(); }
        if (!rerelease || state.attackState === "missile" || state.attackState === "blind" || state.attackState === "melee") state.attackState = "straight";
      }
      return true;
    }
    if (rerelease) return selected;
    return enemyVisible && check(context);
  }

  moveToGoal(context: MonsterContext, distance: number): boolean {
    const { game, entity, state } = context;
    if (state.locomotion === "stationary" || game.body(entity).ground === null && state.locomotion === "walk") return false;
    const enemy = enemyBody(context);
    let goal = entity.goal === null ? null : game.host.bodies.read(entity.goal)?.origin ?? null;
    if (!state.hintPath && !state.combatPoint && state.soundTarget === null && enemy !== null && !visible(context)) goal = this.pursuitGoal(context, distance);
    else if (!state.hintPath && !state.combatPoint && state.soundTarget === null && enemy !== null) { state.lostSight = false; state.lastSighting = enemy.origin; state.trailTime = game.host.now(); }
    if (goal === null) return false;
    if (!state.hintPath && enemy !== null && !state.combatPoint && state.soundTarget === null && this.closeEnough(context, enemy.origin, distance, entity.enemy)) return true;
    if (Math.floor(game.host.random() * 4) !== 1 && stepDirection(context, state.idealYaw, distance)) return true;
    if ((game.options.edition === "rerelease" || this.sourceCombatRules === "rogue") && context.blocked(distance)) return true;
    return chaseDirection(context, goal, distance);
  }

  private closeEnough(context: MonsterContext, origin: Vec3, distance: number, actor: ActorId | null): boolean {
    const body = context.game.body(context.entity), target = actor === null ? null : context.game.host.bodies.read(actor);
    const bounds = target?.bounds ?? { min: zero, max: zero };
    return origin.x + bounds.min.x <= body.origin.x + body.bounds.max.x + distance && origin.x + bounds.max.x >= body.origin.x + body.bounds.min.x - distance &&
      origin.y + bounds.min.y <= body.origin.y + body.bounds.max.y + distance && origin.y + bounds.max.y >= body.origin.y + body.bounds.min.y - distance &&
      origin.z + bounds.min.z <= body.origin.z + body.bounds.max.z + distance && origin.z + bounds.max.z >= body.origin.z + body.bounds.min.z - distance;
  }

  private pursuitGoal(context: MonsterContext, distance: number): Vec3 {
    const { game, entity, state } = context, body = game.body(entity);
    let newGoal = false;
    if (!state.lostSight) { state.lostSight = true; state.pursuitLastSeen = true; state.pursueNext = false; state.pursueTemporary = false; newGoal = true; }
    if (state.pursueNext) {
      state.pursueNext = false; state.searchTime = game.host.now() + 5;
      if (state.pursueTemporary && state.savedGoal !== null) { state.pursueTemporary = false; state.lastSighting = state.savedGoal; newGoal = true; }
      else {
        const trail = entity.enemy === null ? [] : this.trails.get(entity.enemy) ?? [];
        let marker = trail.find(point => point.time > state.trailTime);
        if (state.pursuitLastSeen && marker !== undefined) {
          const prior = trail[trail.indexOf(marker) - 1];
          const trace = game.host.trace({ start: body.origin, end: marker.origin, bounds: null, ignore: entity.actor.id, mask: MASK_OPAQUE });
          if (trace.fraction !== 1 && prior !== undefined && game.host.trace({ start: body.origin, end: prior.origin, bounds: null, ignore: entity.actor.id, mask: MASK_OPAQUE }).fraction === 1) marker = prior;
        }
        state.pursuitLastSeen = false;
        if (marker !== undefined) { state.lastSighting = marker.origin; state.trailTime = marker.time; state.idealYaw = marker.yaw; game.move(entity, { angles: { ...body.angles, y: marker.yaw } }, false); newGoal = true; }
      }
    }
    const d1 = length(subtract(state.lastSighting, body.origin));
    if (d1 <= distance) state.pursueNext = true;
    if (newGoal && d1 > 0) {
      const center = game.host.trace({ start: body.origin, end: state.lastSighting, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
      if (center.fraction < 1) {
        const d2 = d1 * (center.fraction + 1) * 0.5;
        state.idealYaw = vectorAngles(subtract(state.lastSighting, body.origin)).y;
        const basis = anglesVectors({ ...body.angles, y: state.idealYaw });
        const make = (forward: number, right: number): Vec3 => add(body.origin, add(scale(basis.forward, forward), scale(basis.right, right)));
        const left = game.host.trace({ start: body.origin, end: make(d2, -16), bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
        const right = game.host.trace({ start: body.origin, end: make(d2, 16), bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
        const centerFraction = d1 * center.fraction / d2;
        const side = left.fraction >= centerFraction && left.fraction > right.fraction ? -16 : right.fraction >= centerFraction && right.fraction > left.fraction ? 16 : 0;
        if (side !== 0) {
          const fraction = side < 0 ? left.fraction : right.fraction;
          state.savedGoal = state.lastSighting; state.pursueTemporary = true; state.lastSighting = make(fraction < 1 ? d2 * fraction * 0.5 : d2, side);
          state.idealYaw = vectorAngles(subtract(state.lastSighting, body.origin)).y;
        }
        game.move(entity, { angles: { ...body.angles, y: state.idealYaw } }, false);
      }
    }
    return state.lastSighting;
  }
}
