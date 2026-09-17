import { q1WaterTransition } from "../../../movement/q1/water-transition.ts";
import { stepQ1Pusher } from "../../../movement/q1/pusher.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import { createMutableVectorMath } from "../../../core/math.ts";
/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { CombatState, DamageOutcome, DamagePreparation, DamageRequest, ItemId } from "../../../contracts/gameplay.ts";
import type { PickupAdmission } from "../../../contracts/pickups.ts";
import type { Q1CombatContext, Q1DamageSourceEffects } from "../../../world/gameplay/policies.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q1Entity } from "../../../formats/q1-map/index.ts";
import { foreignShamblerDamage } from "./shambler-damage.ts";
import { Q1PrecacheRegistry } from "./precache.ts";
import { Q1Actor, sourceAngles } from "./entity.ts";
import type { Q1FoundationHost, Q1FoundationOptions, Q1PlayerState, Q1Powerup, Q1Presentation, Q1Weapon, Q1SoundChannel, Q1Basis } from "./types.ts";
import { Q1_PROVIDER, ZERO, POINT, vadd, vsub, vscale, dot, length, normalize, WEAPONS, weaponItem, isQ1BaseWeapon, vectors } from "./types.ts";
import { spawnMapActor } from "./spawns.ts";
import { fireWeapon, bestWeapon, weaponModel, projectileTouch } from "./weapons.ts";
import { spawnPickup, registerPickupCallbacks } from "./pickups.ts";
import { captureFoundation, captureEntitySourceState, restoreFoundation } from "./checkpoint.ts";
import type { Q1FoundationCheckpoint } from "./checkpoint.ts";
import type { Q1WeaponDefinition, Q1PlayerExtension, Q1PickupRules, Q1WeaponRules } from "./extensions.ts";
import { Q1CallbackRegistry, callbackName } from "./callbacks.ts";
import type { Q1StateExtension } from "./callbacks.ts";
import { registerMoverCallbacks } from "./movers.ts";
import { registerSpawnCallbacks } from "./spawns.ts";
import { registerMonsterCallbacks } from "./monsters.ts";
import { registerWeaponCallbacks } from "./weapons.ts";
import type { AuthoredTarget, MonsterMission } from "../../monsters/authored.ts";

/** Q1 source entity continuations use the session's authoritative bodies, combat and scheduling. */
export class Q1EntityServices {
  readonly named = new Q1CallbackRegistry(this);
  readonly precaches = new Q1PrecacheRegistry();
  get usesId1Precaches(): boolean { return this.options.precacheProgram === "id1"; }
  precacheModel(path: string): string { return this.precaches.model(path); }
  precacheSound(path: string): string { return this.precaches.sound(path); }
  private baseTeamHealth = true;
  private readonly pathTouches = new Map<string, (corner: Q1Actor, mover: Q1Actor) => boolean>();
  private readonly sourceDamageEffects = new Map<string, Q1DamageSourceEffects>();
  readonly damageSourceEffects: Q1DamageSourceEffects = {
    beforeQuad: (request, amount, target, attacker) => this.prepareSourceDamage("beforeQuad", request, amount, target, attacker),
    afterQuad: (request, amount, target, attacker) => this.prepareSourceDamage("afterQuad", request, amount, target, attacker),
    armorAllowed: (request, amount, target, attacker) => [...this.sourceDamageEffects.values()].every(effects => effects.armorAllowed?.(request, amount, target, attacker) ?? true),
    protectionApplies: (request, target, attacker) => [...this.sourceDamageEffects.values()].every(effects => effects.protectionApplies?.(request, target, attacker) ?? true),
    beforeHealth: (request, amount, target, attacker) => [...this.sourceDamageEffects.values()].every(effects => effects.beforeHealth?.(request, amount, target, attacker) ?? true),
    afterArmor: (request, take, target, attacker) => {
      let amount = take; for (const effects of this.sourceDamageEffects.values()) amount = effects.afterArmor?.(request, amount, target, attacker) ?? amount; return amount;
    },
    lethalHealth: (request, proposed, target, attacker) => {
      let result: { readonly health: number; readonly reaction: "none" | "death" } = { health: proposed, reaction: "death" };
      for (const effects of this.sourceDamageEffects.values()) {
        result = effects.lethalHealth?.(request, result.health, target, attacker) ?? result;
        if (result.reaction === "none") break;
      }
      return result;
    },
  };
  pickupRules: Q1PickupRules | null = null;
  pickupAdmission: PickupAdmission | null = null;
  private readonly weaponRules = new Map<string, Q1WeaponRules>();
  readonly registeredWeapons = new Map<Q1Weapon, Q1WeaponDefinition>();
  readonly playerExtensions = new Map<string, Q1PlayerExtension>();
  weaponOrder: readonly Q1Weapon[] | null = null;
  private weaponOrderOwner: string | null = null;
  readonly stateExtensions = new Map<string, Q1StateExtension>();
  readonly entities = new Map<OwnedActor, Q1Actor>();
  readonly authoredTargets = new Map<ActorId, AuthoredTarget>();
  readonly monsterMissions = new Map<ActorId, MonsterMission>();
  authoredPathFollower: ((mover: ActorId) => { readonly targetname: string; readonly enemy: ActorId | null; advance(name: string, goal: ActorId | null, pauseUntil: number): undefined } | null) | null = null;
  readonly players = new Map<OwnedActor, Q1PlayerState>();
  time = 0;
  frameSeconds = 0;
  forceRetouch = 0;
  basis: Q1Basis = { forward: ZERO, right: ZERO, up: ZERO };
  totalSecrets = 0;
  foundSecrets = 0;
  totalMonsters = 0;
  killedMonsters = 0;
  worldType = 0;
  mapName = "";
  world: Q1Actor | null = null;
  sightEntity: Q1Actor | null = null;
  sightTime = -1;
  intermission: { readonly map: string; readonly cause: ActorId | null; readonly exitAfter: number } | null = null;
  private readonly configuredOptions: Q1FoundationOptions;
  private spawnOptions: Q1FoundationOptions | null = null;
  get provider() { return this.configuredOptions.provider ?? Q1_PROVIDER; }
  get options(): Q1FoundationOptions { return this.spawnOptions ?? this.configuredOptions; }
  private sequence = 0;
  protected nextDynamicSlot = 1;
  private readonly spawners = new Map<string, (game: Q1EntityServices, entity: Q1Actor) => undefined>();

  constructor(readonly host: Q1FoundationHost, options: Q1FoundationOptions) {
    this.configuredOptions = options;
    this.nextDynamicSlot = (options.maxClients ?? 0) + 1;
    this.named.register("SUB_Remove", { action: (game, entity) => game.remove(entity) });
    this.named.register("SUB_Null", { action: () => undefined });
    this.named.register("DelayThink", { action: (game, entity) => { game.useTargets(entity, entity.activator); return game.remove(entity); } });
    registerMoverCallbacks(this); registerSpawnCallbacks(this); registerPickupCallbacks(this); registerWeaponCallbacks(this); registerMonsterCallbacks(this);
    host.actors.onRelease(actor => { this.entities.delete(actor); this.authoredTargets.delete(actor.id); this.monsterMissions.delete(actor.id); this.players.delete(actor); host.cancelThink(actor); return undefined; });
  }

  registerDamageSourceEffects(id: string, effects: Q1DamageSourceEffects): undefined {
    if (this.sourceDamageEffects.has(id)) throw new Error(`Duplicate Q1 damage source effects: ${id}`);
    this.sourceDamageEffects.set(id, effects); return undefined;
  }
  private prepareSourceDamage(phase: "beforeQuad" | "afterQuad", request: DamageRequest, initial: number, target: CombatState, attacker: CombatState | null): DamagePreparation {
    let amount = initial;
    for (const effects of this.sourceDamageEffects.values()) {
      const result = effects[phase]?.(request, amount, target, attacker);
      if (result?.kind === "cancel") return result;
      if (result !== undefined) amount = result.amount;
    }
    return { kind: "continue", amount };
  }
  setGravity(actor: ActorId, scale: number): undefined {
    if (this.host.setGravity === undefined) throw new Error("Q1 source gravity mutation requires the selected movement host");
    return this.host.setGravity(actor, scale);
  }
  controlPlayer(actor: ActorId, control: { readonly kind: "cutscene"; readonly origin: Vec3; readonly angles: Vec3; readonly viewOffset: Vec3 }): undefined {
    if (this.host.controlPlayer === undefined) throw new Error("Q1 cinematic requires the selected player control host");
    return this.host.controlPlayer(actor, control);
  }
  /** Rogue combat.qc replaces the ordinary teamplay==1 gate with TeamHealthDam. */
  setBaseTeamHealth(enabled: boolean): undefined { this.baseTeamHealth = enabled; return undefined; }
  registerPathTouch(id: string, callback: (corner: Q1Actor, mover: Q1Actor) => boolean): undefined {
    if (this.pathTouches.has(id)) throw new Error(`Duplicate Q1 source path touch ${id}`); this.pathTouches.set(id, callback); return undefined;
  }
  sourcePathTouch(corner: Q1Actor, mover: Q1Actor): boolean { for (const callback of this.pathTouches.values()) if (callback(corner, mover)) return true; return false; }
  registerWeaponRules(rules: Q1WeaponRules): undefined {
    if (this.weaponRules.has(rules.id)) throw new Error(`Duplicate Q1 weapon rules: ${rules.id}`);
    if (rules.consumeAmmo !== undefined && [...this.weaponRules.values()].some(rule => rule.consumeAmmo !== undefined)) throw new Error("Q1 source ammunition consumption already registered");
    this.weaponRules.set(rules.id, rules); return undefined;
  }
  consumeWeaponAmmo(player: Q1PlayerState, item: ItemId, amount: number): boolean {
    for (const rules of this.weaponRules.values()) if (rules.consumeAmmo !== undefined) return rules.consumeAmmo(this, player, item, amount);
    return this.host.inventory.consume(player.actor, item, amount);
  }
  weaponBeforeFire(player: Q1PlayerState): undefined {
    for (const rules of this.weaponRules.values()) rules.beforeFire?.(this, player); return undefined;
  }
  weaponAttackDelay(player: Q1PlayerState, initial: number): number {
    let delay = initial; for (const rules of this.weaponRules.values()) delay = rules.attackDelay?.(this, player, delay) ?? delay; return delay;
  }
  nailSpeed(player: Q1PlayerState, initial: number): number {
    let speed = initial; for (const rules of this.weaponRules.values()) speed = rules.nailSpeed?.(this, player, speed) ?? speed; return speed;
  }
  registerPickupRules(rules: Q1PickupRules): undefined {
    if (this.pickupRules !== null) throw new Error(`Q1 pickup rules already owned by ${this.pickupRules.id}`);
    this.pickupRules = rules; return undefined;
  }
  registerWeapon(definition: Q1WeaponDefinition): undefined {
    if (isQ1BaseWeapon(definition.id) || this.registeredWeapons.has(definition.id)) throw new Error(`Q1 weapon already registered: ${definition.id}`);
    this.registeredWeapons.set(definition.id, definition); return undefined;
  }
  replaceWeapon(definition: Q1WeaponDefinition): undefined {
    if (!isQ1BaseWeapon(definition.id) && !this.registeredWeapons.has(definition.id)) throw new Error(`No Q1 weapon to replace: ${definition.id}`);
    this.registeredWeapons.set(definition.id, definition); return undefined;
  }
  registerWeaponOrder(id: string, order: readonly Q1Weapon[]): undefined {
    if (this.weaponOrderOwner !== null) throw new Error(`Q1 weapon fallback already owned by ${this.weaponOrderOwner}`);
    this.weaponOrderOwner = id; this.weaponOrder = [...order]; return undefined;
  }
  registerPlayerExtension(extension: Q1PlayerExtension): undefined {
    if (this.playerExtensions.has(extension.id)) throw new Error(`Duplicate Q1 player extension: ${extension.id}`);
    this.playerExtensions.set(extension.id, extension); return undefined;
  }
  weaponModel(weapon: Q1Weapon, player?: Q1PlayerState): string {
    const definition = this.registeredWeapons.get(weapon);
    if (player !== undefined && definition?.modelFor !== undefined) return definition.modelFor(this, player);
    return definition?.model ?? weaponModel(weapon);
  }
  weaponItem(weapon: Q1Weapon): ItemId { return this.registeredWeapons.get(weapon)?.item ?? weaponItem(weapon); }
  weaponAmmo(weapon: Q1Weapon): ItemId | null { const extension = this.registeredWeapons.get(weapon); return extension === undefined ? ammoItem(weapon) : extension.ammo; }
  weaponAvailable(player: Q1PlayerState, weapon: Q1Weapon, purpose: "best" | "fire" = "best", ammoCount: (item: ItemId) => number = item => this.host.inventory.count(player.actor.id, item)): boolean {
    if (this.host.inventory.count(player.actor.id, this.weaponItem(weapon)) === 0) return false;
    const extension = this.registeredWeapons.get(weapon);
    if (!isQ1BaseWeapon(weapon) && extension === undefined) return false;
    if (extension?.available !== undefined && !extension.available(this, player)) return false;
    if (purpose === "best" && extension?.bestAvailable !== undefined && !extension.bestAvailable(this, player)) return false;
    if (purpose === "best" && weapon === "lightning" && player.waterLevel > 1) return false;
    const ammo = this.weaponAmmo(weapon), needed = extension?.ammoPerShot ?? (purpose === "best" && (weapon === "supernailgun" || weapon === "supershotgun") ? 2 : 1);
    return ammo === null || ammoCount(ammo) >= needed;
  }
  fireRegisteredWeapon(player: Q1PlayerState): boolean {
    if (player.primaryHolstered) return false;
    const definition = this.registeredWeapons.get(player.weapon);
    if (definition === undefined) throw new Error(`Q1 weapon source not registered: ${player.weapon}`);
    if (this.health(player.actor.id) <= 0 || this.time < (player.continuousFiring ? player.nextWeaponFrame : player.attackFinished)) return false;
    if (!this.weaponAvailable(player, player.weapon, "fire")) { this.selectWeapon(player.actor, this.chooseBest(player.actor)); return false; }
    this.weaponBeforeFire(player); return definition.fire(this, player);
  }
  capture(): Q1FoundationCheckpoint { return captureFoundation(this, this.sequence, this.nextDynamicSlot); }
  restore(checkpoint: Q1FoundationCheckpoint, options: { readonly scheduleThinks?: boolean } = {}): undefined {
    restoreFoundation(this, checkpoint); this.sequence = checkpoint.sequence; this.nextDynamicSlot = checkpoint.nextDynamicSlot;
    if (options.scheduleThinks ?? true) this.resumeThinks(); return undefined;
  }
  resumeThinks(): undefined {
    for (const entity of this.entities.values()) if (entity.movement !== "push" && entity.think !== null && entity.nextThink >= 0) this.host.scheduleThink(entity.actor, entity.nextThink);
    return undefined;
  }
  registerStateExtension(extension: Q1StateExtension): undefined {
    if (this.stateExtensions.has(extension.id)) throw new Error(`Duplicate Q1 state extension: ${extension.id}`);
    this.stateExtensions.set(extension.id, extension); return undefined;
  }
  spawnEntity(entity: Q1Actor, context: { readonly deathmatch?: number } = {}): undefined {
    const previous = this.spawnOptions;
    if (context.deathmatch !== undefined) this.spawnOptions = { ...this.options, deathmatch: context.deathmatch };
    try {
      const extension = this.spawners.get(entity.classname);
      if (extension === undefined) spawnMapActor(this, entity); else extension(this, entity);
      if (this.live(entity)) this.link(entity); return undefined;
    } finally { this.spawnOptions = previous; }
  }
  registerSpawn(classname: string, handler: (game: Q1EntityServices, entity: Q1Actor) => undefined): undefined {
    if (this.spawners.has(classname)) throw new Error(`Q1 spawn handler already registered: ${classname}`);
    this.spawners.set(classname, handler); return undefined;
  }

  replaceSpawn(classname: string, handler: (game: Q1EntityServices, entity: Q1Actor) => undefined): undefined {
    if (!this.spawners.has(classname)) throw new Error(`No registered Q1 spawn to replace: ${classname}`);
    this.spawners.set(classname, handler); return undefined;
  }

  create(classname: string, source?: Q1Entity, sourceOrdinal: number | null = null): Q1Actor {
    const slot = sourceOrdinal === null ? this.nextDynamicSlot++ : sourceOrdinal === 0 ? 0 : sourceOrdinal + (this.options.maxClients ?? 0);
    const owner = this.host.actors.allocateAtSource(this.provider, slot, `q1:${classname}`);
    const entity = new Q1Actor(owner, classname, sourceOrdinal, this.host.combat, source);
    this.host.bodies.create(owner, { origin: source === undefined ? ZERO : entity.vector("origin"), angles: source === undefined ? ZERO : sourceAngles(source), velocity: ZERO, bounds: POINT, ground: null });
    this.host.combat.create(owner, { health: entity.maxHealth, armor: { kind: "none" }, mass: 100, canTakeDamage: false, invulnerable: false, team: null });
    return this.admitEntity(entity);
  }
  /** Attaches source continuation to existing shared state without running a spawn function. */
  attachExisting(actor: OwnedActor, classname: string, source?: Q1Entity, sourceOrdinal: number | null = null): Q1Actor {
    return this.admitEntity(new Q1Actor(actor, classname, sourceOrdinal, this.host.combat, source));
  }
  private admitEntity(entity: Q1Actor): Q1Actor {
    this.host.actors.assertOwned(entity.actor);
    if (this.entities.has(entity.actor)) throw new Error("Q1 actor already attached");
    if (this.host.bodies.read(entity.actor.id) === null || this.host.combat.read(entity.actor.id) === null) throw new Error("Attach Q1 behavior after shared body and combat admission");
    this.entities.set(entity.actor, entity);
    this.host.combat.bindDamageAdjustment(entity.actor, request => foreignShamblerDamage(entity.monster?.species, request));
    this.bindActorCallbacks(entity);
    this.host.registerEntity?.(entity, this);
    return entity;
  }
  cloneEntity(source: Q1Actor): Q1Actor {
    this.host.actors.assertOwned(source.actor);
    const callbacks = { think: callbackName(source.think), use: callbackName(source.use), touch: callbackName(source.touch),
      pain: callbackName(source.pain), die: callbackName(source.die), blocked: callbackName(source.blocked), pathEnd: callbackName(source.pathEnd) };
    const done = source.move === null ? null : callbackName(source.move.done);
    const target = this.create(source.classname);
    Object.assign(target, captureEntitySourceState(source));
    for (const [key, value] of source.fields) target.fields.set(key, value);
    for (const [key, actor] of source.references) target.references.set(key, actor);
    target.owner = source.owner; target.activator = source.activator; target.doorGroup = [...source.doorGroup];
    target.monster = source.monster === null ? null : { ...source.monster, sequence: [...source.monster.sequence] };
    this.host.bodies.write(target.actor, this.body(source));
    const combat = this.host.combat.read(source.actor.id); if (combat === null) throw new Error("Source clone has no combat state");
    this.host.combat.setHealth(target.actor, combat.health); this.host.combat.setArmor(target.actor, combat.armor);
    this.host.combat.setTraits(target.actor, { canTakeDamage: combat.canTakeDamage, mass: combat.mass, invulnerable: combat.invulnerable, team: combat.team,
      ...(combat.noKnockback === undefined ? {} : { noKnockback: combat.noKnockback }) });
    if (this.host.inventory.has(source.actor.id)) this.host.inventory.create(target.actor, this.host.inventory.entries(source.actor.id));
    target.think = callbacks.think === null ? null : this.named.action(target, callbacks.think);
    target.use = callbacks.use === null ? null : this.named.use(target, callbacks.use);
    target.touch = callbacks.touch === null ? null : this.named.touch(target, callbacks.touch);
    target.pain = callbacks.pain === null ? null : this.named.pain(target, callbacks.pain);
    target.die = callbacks.die === null ? null : this.named.die(target, callbacks.die);
    target.blocked = callbacks.blocked === null ? null : this.named.blocked(target, callbacks.blocked);
    target.pathEnd = callbacks.pathEnd === null ? null : this.named.action(target, callbacks.pathEnd);
    target.move = source.move === null || done === null ? null : { ...source.move, destination: { ...source.move.destination }, done: this.named.action(target, done) };
    for (const extension of this.stateExtensions.values()) extension.clone?.(source, target);
    if (target.movement !== "push" && target.think !== null && target.nextThink >= 0) this.host.scheduleThink(target.actor, target.nextThink);
    return target;
  }
  bindActorCallbacks(entity: Q1Actor): undefined {
    const owner = entity.actor;
    this.host.callbacks.bind(owner, {
      think: (_self, frame) => {
        this.time = frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000;
        this.frameSeconds = frame.elapsed.kind === "seconds" ? frame.elapsed.value : frame.elapsed.value / 1000;
        const callback = entity.think; entity.think = null; entity.nextThink = -1;
        if (callback !== null) callback(); return undefined;
      },
      touch: contact => entity.touch?.(contact.other, contact.plane?.normal ?? null, contact.surface),
      use: (_self, other, activator) => entity.use?.(other, activator),
      pain: reaction => entity.pain?.(reaction.attacker, reaction.damage),
      die: reaction => {
        // Killed runs in the victim source even when another game supplied the attack policy.
        if (this.health(owner.id) < -99) this.host.combat.setHealth(owner, -99);
        if (entity.monster !== null && entity.movement !== "push" && entity.movement !== "none") entity.monster.enemy = reaction.attacker;
        return entity.die?.(reaction.attacker);
      },
    });
    return undefined;
  }

  initializeWeaponInventory(actor: OwnedActor): undefined {
    const entries = WEAPONS.map(weapon => ({ item: weaponItem(weapon), count: weapon === "axe" || weapon === "shotgun" ? 1 : 0, capacity: 1 }));
    entries.push({ item: "q1:ammo/shells", count: 25, capacity: 100 }, { item: "q1:ammo/nails", count: 0, capacity: 200 },
      { item: "q1:ammo/rockets", count: 0, capacity: 100 }, { item: "q1:ammo/cells", count: 0, capacity: 100 });
    if (!this.host.inventory.has(actor.id)) this.host.inventory.create(actor, entries);
    else for (const entry of entries) this.host.inventory.configure(actor, entry);
    return undefined;
  }

  attachPlayer(actor: OwnedActor, options: { readonly weapon?: Q1Weapon; readonly initializeInventory?: boolean; readonly maxHealth?: number } = {}): Q1PlayerState {
    this.host.actors.assertOwned(actor);
    const existing = this.players.get(actor); if (existing !== undefined) return existing;
    if (options.initializeInventory ?? true) {
      this.initializeWeaponInventory(actor);
      for (const item of ["q1:key/silver", "q1:key/gold"] satisfies readonly ItemId[]) this.host.inventory.configure(actor, { item, count: 0, capacity: 1 });
    }
    const state: Q1PlayerState = { actor, alpha: 0, scale: 0, weapon: options.weapon ?? "shotgun", primaryHolstered: false, attackFinished: 0, attackHeld: false, jumpHeld: false, teleportUntil: 0, weaponFrame: 0, weaponAnimationAt: -1, weaponAnimationBase: 1,
      continuousFiring: false, nextWeaponFrame: 0, lightningSoundAt: 0, punchAngles: ZERO, nailSide: 1,
      maxHealth: options.maxHealth ?? (this.options.edition === "rerelease" && this.options.skill === 3 && this.options.deathmatch === 0 ? 50 : 100), megaRotAt: -1, hostileUntil: 0, viewAngles: this.host.bodies.read(actor.id)?.angles ?? ZERO,
      waterLevel: 0, airFinished: this.time + 12, drownDamage: 2, drownAt: 0, hazardAt: 0, autoSwitch: "always", powerups: new Map<Q1Powerup, number>() };
    this.players.set(actor, state);
    for (const extension of this.playerExtensions.values()) extension.attach?.(this, state);
    this.host.emit({ kind: "weapon", player: actor.id, weapon: state.weapon, viewModel: this.weaponModel(state.weapon, state), frame: state.weaponFrame, punch: 0 });
    return state;
  }

  player(actor: ActorId): Q1PlayerState | null { const owner = this.host.actors.resolveOwned(actor); return owner === null ? null : this.players.get(owner) ?? null; }
  entity(actor: ActorId | null): Q1Actor | null { if (actor === null) return null; const owner = this.host.actors.resolveOwned(actor); return owner === null ? null : this.entities.get(owner) ?? null; }
  isPlayer(actor: ActorId | null): boolean { return actor !== null && (this.player(actor) !== null || this.host.players().some(candidate => sameActor(actor, candidate))); }
  live(entity: Q1Actor): boolean { return this.host.actors.isLive(entity.actor.id); }
  health(actor: ActorId): number { return this.host.combat.read(actor)?.health ?? 0; }
  body(entity: Q1Actor): BodyState { const body = this.host.bodies.read(entity.actor.id); if (body === null) throw new Error("Missing Q1 body"); return body; }
  setBody(entity: Q1Actor, patch: Partial<BodyState>): undefined { this.host.bodies.write(entity.actor, { ...this.body(entity), ...patch }); return undefined; }
  link(entity: Q1Actor): undefined { return this.host.bodies.link(entity.actor); }
  setOrigin(entity: Q1Actor, origin: Vec3): undefined { this.setBody(entity, { origin }); return this.link(entity); }
  setBounds(entity: Q1Actor, bounds: Bounds): undefined { this.setBody(entity, { bounds }); return this.link(entity); }
  remove(entity: Q1Actor): undefined { if (this.live(entity)) this.host.actors.release(entity.actor); return undefined; }
  schedule(entity: Q1Actor, delay: number, callback: () => undefined): undefined {
    return this.scheduleAt(entity, Math.fround(this.time + delay), callback);
  }
  scheduleAt(entity: Q1Actor, dueSeconds: number, callback: () => undefined): undefined {
    entity.nextThink = Math.fround(dueSeconds); entity.think = callback;
    if (entity.movement === "push") return this.host.cancelThink(entity.actor);
    return this.host.scheduleThink(entity.actor, entity.nextThink);
  }
  cancel(entity: Q1Actor): undefined { entity.nextThink = -1; entity.think = null; return this.host.cancelThink(entity.actor); }
  sound(entity: Q1Actor | OwnedActor, path: string, channel: Q1SoundChannel = "voice", attenuation = 1, volume = 1): undefined {
    const actor = entity instanceof Q1Actor ? entity.actor.id : entity.id;
    const body = this.host.bodies.read(actor);
    if (body === null) throw new Error("Missing Q1 sound emitter body");
    const origin = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5));
    return this.host.emit({ kind: "sound", actor, origin, path, channel, volume, attenuation });
  }
  message(player: ActorId | null, text: string, center = true, args: readonly (string | number)[] = []): undefined {
    if (player !== null && this.isPlayer(player) && text !== "") this.host.emit({ kind: "message", player, text, center, ...(args.length === 0 ? {} : { args: [...args] }) }); return undefined;
  }
  effect(effect: Extract<import("./types.ts").Q1Event, { kind: "effect" }>["effect"], origin: Vec3, actor: ActorId | null = null, amount = 1): undefined {
    return this.host.emit({ kind: "effect", effect, origin, actor, amount });
  }
  find(targetname: string): readonly Q1Actor[] { return targetname === "" ? [] : [...this.entities.values()].filter(entity => entity.targetname === targetname); }
  private targetActors(name: string): readonly AuthoredTarget[] {
    if (name === "") return [];
    return [...this.entities.values(), ...this.authoredTargets.values()]
      .filter(entity => entity.targetname === name && this.host.actors.isLive(entity.actor.id))
      .sort((a, b) => (this.host.actors.sourceOf(a.actor.id)?.slot ?? a.actor.id.slot) - (this.host.actors.sourceOf(b.actor.id)?.slot ?? b.actor.id.slot));
  }
  useTargets(entity: AuthoredTarget, activator: ActorId | null): undefined {
    if (entity.delay !== 0) {
      const delayed = this.create("DelayedUse"); delayed.target = entity.target; delayed.killtarget = entity.killtarget; delayed.message = entity.message;
      delayed.activator = activator;
      return this.schedule(delayed, entity.delay, this.named.action(delayed, "DelayThink"));
    }
    this.message(activator, entity.message);
    for (const victim of this.targetActors(entity.killtarget)) if (this.host.actors.isLive(victim.actor.id)) this.host.actors.release(victim.actor);
    // Each use executes synchronously; targets removed by a nested call are not invoked afterward.
    for (const target of this.targetActors(entity.target)) if (this.host.actors.isLive(target.actor.id)) this.host.callbacks.use(target.actor, entity.actor.id, activator);
    return undefined;
  }

  damage(target: ActorId, inflictor: ActorId, attacker: ActorId | null, amount: number, weapon: Q1Weapon | null = null, delivery: "direct" | "radius" = "direct", deathType = "", armorEffect?: "bypass" | "half-effectiveness"): DamageOutcome {
    const targetBody = this.host.bodies.read(target); const source = this.host.bodies.read(inflictor);
    const point = targetBody?.origin ?? ZERO;
    const direction = normalize(vsub(point, source?.origin ?? point));
    const scaled = Math.fround(Math.fround(amount) * Math.fround(attacker === null ? 1 : this.host.sourceDamageMultiplier?.(attacker) ?? 1));
    return this.host.combat.apply({ target, amount: scaled, knockback: scaled, direction, point, normal: ZERO, delivery,
      attack: { sequence: this.sequence++, time: { kind: "seconds", value: this.time }, attacker, inflictor,
        weapon: weapon === null ? null : this.weaponItem(weapon), weaponProvider: this.provider, combatProvider: this.options.combatProvider,
        inventoryProvider: this.options.inventoryProvider, movementProvider: this.options.movementProvider, cause: { kind: "q1", deathType, ...(armorEffect === undefined ? {} : { armorEffect }) } } });
  }
  powerupExpires(actor: ActorId, powerup: Q1Powerup): number {
    return this.host.powerupExpires?.(actor, powerup) ?? this.player(actor)?.powerups.get(powerup) ?? 0;
  }
  combatContext(request: DamageRequest): Q1CombatContext {
    const inflictor = request.attack.inflictor === null ? null : this.host.bodies.linked(request.attack.inflictor);
    const target = this.host.bodies.read(request.target);
    return { arithmetic: "binary32", quad: request.attack.attacker !== null && this.powerupExpires(request.attack.attacker, "quad") > this.time,
      teamplay: this.options.teamplay ?? 0, baseTeamHealth: this.baseTeamHealth, walk: this.isPlayer(request.target), momentumDirection: target === null || inflictor === null ? null :
        normalize(vsub(target.origin, vscale(vadd(inflictor.absoluteBounds.min, inflictor.absoluteBounds.max), 0.5))) };
  }
  sourceTarget(actor: ActorId) {
    const observed = this.host.sourceTarget?.(actor);
    if (observed !== undefined) return observed;
    const entity = this.entity(actor);
    return { aimedDamage: entity?.aimedDamage ?? false, push: entity?.movement === "push", player: this.isPlayer(actor) };
  }
  monsterTarget(actor: ActorId) {
    if (this.host.monsterTarget !== undefined) return this.host.monsterTarget(actor);
    const entity = this.entity(actor), player = this.player(actor);
    if (entity === null && player === null) return null;
    return { viewHeight: player === null ? 25 : 22, notarget: ((entity?.movementFlags ?? 0) & 128) !== 0,
      invisible: (player?.powerups.get("invisibility") ?? 0) > this.time, lightLevel: null, hostileUntil: player?.hostileUntil ?? null };
  }
  canDamage(target: ActorId, inflictor: ActorId): boolean {
    const targetBody = this.host.bodies.read(target), source = this.host.bodies.read(inflictor); if (targetBody === null || source === null) return false;
    const push = this.sourceTarget(target).push;
    const destination = push ? vadd(targetBody.origin, vscale(vadd(targetBody.bounds.min, targetBody.bounds.max), 0.5)) : targetBody.origin;
    const offsets = push ? [ZERO] : [ZERO, { x: 15, y: 15, z: 0 }, { x: -15, y: -15, z: 0 }, { x: -15, y: 15, z: 0 }, { x: 15, y: -15, z: 0 }];
    return offsets.some(offset => { const trace = this.host.trace({ start: source.origin, end: vadd(destination, offset), bounds: POINT, ignore: inflictor, monsters: false }); return trace.fraction === 1 || trace.actor !== null && sameActor(trace.actor, target); });
  }
  radiusDamage(inflictor: ActorId, attacker: ActorId | null, amount: number, ignore: ActorId | null, weapon: Q1Weapon | null, deathType = ""): undefined {
    const source = this.host.bodies.read(inflictor); if (source === null) return undefined;
    for (const observation of this.host.actors.observations()) {
      const target = observation.id; const combat = this.host.combat.read(target), body = this.host.bodies.read(target);
      if (combat === null || !combat.canTakeDamage || body === null || ignore !== null && sameActor(ignore, target)) continue;
      const center = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5));
      const distance = length(vsub(center, source.origin)); if (distance > amount + 40) continue;
      let points = Math.fround(amount - 0.5 * distance); if (attacker !== null && sameActor(target, attacker)) points *= 0.5;
      if (this.host.classname(target) === "monster_shambler") points *= 0.5;
      if (points > 0 && this.canDamage(target, inflictor)) this.damage(target, inflictor, attacker, points, weapon, "radius", deathType);
    }
    return undefined;
  }

  calcMove(entity: Q1Actor, destination: Vec3, speed: number, done: () => undefined): undefined {
    if (!(speed > 0)) throw new RangeError("Q1 mover speed must be positive");
    this.cancel(entity); const delta = vsub(destination, this.body(entity).origin);
    const travel = Math.fround(length(delta) / speed);
    entity.move = { destination, done };
    this.setBody(entity, { velocity: travel < 0.1 ? ZERO : vscale(delta, Math.fround(1 / travel)) });
    return this.scheduleAt(entity, Math.fround(entity.number("ltime") + Math.max(0.1, travel)), this.named.action(entity, "SUB_CalcMoveDone"));
  }

  /** Convenience for direct provider use. The unified session calls physicsEntity in source-slot order. */
  physicsStep(seconds: number, elapsedSeconds: number): undefined {
    for (const entity of [...this.entities.values()]) this.physicsEntity(entity.actor, seconds, elapsedSeconds);
    for (const player of this.players.values()) this.playerFrame(player.actor, seconds);
    return undefined;
  }
  physicsEntity(actor: OwnedActor, seconds: number, elapsedSeconds: number): undefined {
    this.time = seconds; this.frameSeconds = elapsedSeconds; const entity = this.entities.get(actor);
    if (entity === undefined || !this.live(entity)) return undefined;
    if (entity.movement === "push") {
      const angular = entity.angularVelocity;
      stepQ1Pusher({ actor: actor.id, elapsedSeconds,
        movement: angular.x !== 0 || angular.y !== 0 || angular.z !== 0 ? "rotate" : "translate" }, this.host.pusherServices(this));
    } else if (entity.movement === "toss" || entity.movement === "bounce" || entity.movement === "gib" || entity.movement === "fly" || entity.movement === "flymissile") this.projectilePhysics(entity, elapsedSeconds);
    return undefined;
  }

  /** Weapon/powerup/environment state; jumping belongs to the independently selected movement provider. */
  playerFrame(actor: OwnedActor, seconds: number, waterLevel?: number): undefined {
    this.time = seconds; const player = this.players.get(actor);
    if (player === undefined) return undefined;
    if (waterLevel !== undefined) player.waterLevel = waterLevel;
    for (const extension of this.playerExtensions.values()) extension.frame?.(this, player, seconds);
    this.weaponFrame(actor, seconds);
    if (player.megaRotAt >= 0 && player.megaRotAt <= seconds) {
      const health = this.health(actor.id);
      if (health > player.maxHealth) { this.host.combat.setHealth(actor, health - 1); player.megaRotAt = seconds + 1; }
      else player.megaRotAt = -1;
    }
    for (const [powerup, expires] of player.powerups) if (expires <= seconds) { player.powerups.delete(powerup); this.host.powerup(actor, powerup, 0); }
    if (this.intermission !== null || this.health(actor.id) < 0) return undefined;
    const suit = (player.powerups.get("suit") ?? 0) > seconds;
    const lavaSuit = (player.powerups.get("mg3:lavasuit") ?? 0) > seconds;
    if (player.waterLevel !== 3 || suit || lavaSuit) { player.airFinished = seconds + 12; player.drownDamage = 2; }
    else if (player.airFinished < seconds && player.drownAt < seconds) {
      player.drownDamage += 2; if (player.drownDamage > 15) player.drownDamage = 10;
      this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, player.drownDamage, null, "direct", "drown"); player.drownAt = seconds + 1;
    }
    const body = this.host.bodies.read(actor.id);
    if (body !== null && player.waterLevel > 0 && player.hazardAt < seconds) {
      const contents = this.host.contents(vadd(body.origin, { x: 0, y: 0, z: body.bounds.min.z + 1 }));
      if (contents === "lava" && !lavaSuit) {
        player.hazardAt = seconds + (suit ? 1 : 0.2); this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, 10 * player.waterLevel, null, "direct", "lava");
      } else if (contents === "slime" && !suit && !lavaSuit) {
        player.hazardAt = seconds + 1; this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, 4 * player.waterLevel, null, "direct", "slime");
      }
    }
    return undefined;
  }
  weaponPunch(player: Q1PlayerState, pitch: number): undefined {
    if (pitch !== 0) player.punchAngles = { ...player.punchAngles, x: pitch };
    return undefined;
  }
  advancePunch(actor: ActorId, elapsed: number, numeric: NumericOperations): Vec3 | null {
    const player = this.player(actor); if (player === null) return null;
    const math = createMutableVectorMath(numeric, "preserve"), direction = { ...player.punchAngles };
    const magnitude = math.VectorNormalize(direction), remaining = Math.max(0, numeric.subtract(magnitude, numeric.multiply(10, elapsed)));
    const punch = { ...ZERO }; math.VectorScale(direction, remaining, punch); player.punchAngles = punch; return punch;
  }
  weaponFrame(actor: OwnedActor, seconds: number): undefined {
    this.time = seconds; const player = this.players.get(actor);
    if (player === undefined) return undefined;
    const weaponExtension = this.registeredWeapons.get(player.weapon);
    weaponExtension?.animate?.(this, player, seconds);
    if (weaponExtension?.animate === undefined && isQ1BaseWeapon(player.weapon) && !player.continuousFiring && player.weaponAnimationAt >= 0) {
      const frame = Math.floor((seconds - player.weaponAnimationAt) / 0.1);
      const count = player.weapon === "axe" ? 4 : 6;
      const next = frame >= count ? 0 : player.weaponAnimationBase + frame;
      if (next !== player.weaponFrame) {
        player.weaponFrame = next; this.host.emit({ kind: "weapon", player: actor.id, weapon: player.weapon, viewModel: this.weaponModel(player.weapon, player), frame: next, punch: 0 });
      }
      if (frame >= count) player.weaponAnimationAt = -1;
    }
    return undefined;
  }
  playerAfterPhysics(actor: OwnedActor, seconds: number): undefined {
    this.time = seconds; const player = this.players.get(actor); if (player === undefined) return undefined;
    for (const extension of this.playerExtensions.values()) extension.afterPhysics?.(this, player, seconds);
    return undefined;
  }
  travel(map: string, cause: ActorId | null): undefined {
    return this.host.transition({ kind: "campaign-level", campaign: this.options.campaign, map: `q1:${map}`, spawnPoint: "", gates: [], cause });
  }
  beginIntermission(map: string, cause: ActorId | null): undefined {
    const spots = [...this.entities.values()].filter(entity => entity.classname === "info_intermission");
    let selected = spots[0];
    if (selected !== undefined) {
      let cycle = Math.fround(this.host.random() * 4), index = 0;
      while (cycle > 1) { index = (index + 1) % spots.length; cycle = Math.fround(cycle - 1); }
      selected = spots[index];
    } else selected = [...this.entities.values()].find(entity => entity.classname === "info_player_start") ?? [...this.entities.values()].find(entity => entity.classname === "testplayerstart");
    if (selected === undefined) throw new Error("FindIntermission: no spot");
    const body = this.body(selected);
    const exitAfter = this.time + (this.options.deathmatch !== 0 ? 5 : 2);
    this.intermission = { map, cause, exitAfter };
    return this.host.emit({ kind: "intermission", origin: body.origin, angles: selected.classname === "info_intermission" ? selected.vector("mangle") : body.angles, map, exitAfter, track: 3 });
  }
  requestIntermissionExit(seconds: number, pressed: boolean): boolean {
    const pending = this.intermission;
    if (pending === null || seconds < pending.exitAfter || !pressed) return false;
    this.time = seconds; this.intermission = null; this.travel(pending.map, pending.cause); return true;
  }

  makeVectors(angles: Vec3): Q1Basis { this.basis = vectors(angles); return this.basis; }
  beginFrame(seconds: number, elapsedSeconds: number): undefined {
    this.time = seconds; this.frameSeconds = elapsedSeconds; return undefined;
  }
  playerInput(actor: OwnedActor, input: { readonly attack: boolean; readonly jump: boolean; readonly teleportUntil?: number }): undefined {
    const player = this.players.get(actor); if (player === undefined) return undefined;
    player.attackHeld = input.attack; player.jumpHeld = input.jump;
    if (input.teleportUntil !== undefined) player.teleportUntil = input.teleportUntil;
    return undefined;
  }
  attack(actor: OwnedActor, viewAngles: Vec3, seconds: number, waterLevel = 0): boolean {
    this.time = seconds; const player = this.players.get(actor); if (player === undefined) throw new Error("Player has no Q1 weapon state");
    player.viewAngles = viewAngles; player.waterLevel = waterLevel; return fireWeapon(this, player);
  }
  weaponInput(actor: OwnedActor, pressed: boolean, viewAngles: Vec3, seconds: number, waterLevel = 0): boolean {
    const player = this.players.get(actor); if (player === undefined) throw new Error("Player has no Q1 weapon state");
    this.time = seconds; player.viewAngles = viewAngles; player.waterLevel = waterLevel; player.attackHeld = pressed;
    if (!pressed) {
      if (player.continuousFiring) { player.continuousFiring = false; player.weaponAnimationAt = -1; player.weaponFrame = 0; }
      return false;
    }
    return this.attack(actor, viewAngles, seconds, waterLevel);
  }
  selectWeapon(actor: OwnedActor, weapon: Q1Weapon): boolean {
    const player = this.players.get(actor); if (player === undefined || this.host.inventory.count(actor.id, this.weaponItem(weapon)) === 0) return false;
    if (!isQ1BaseWeapon(weapon) && !this.registeredWeapons.has(weapon)) return false;
    const definition = this.registeredWeapons.get(weapon); if (definition?.available !== undefined && !definition.available(this, player)) return false;
    player.weapon = weapon; player.weaponFrame = 0; player.continuousFiring = false; player.weaponAnimationAt = -1;
    this.host.emit({ kind: "weapon", player: actor.id, weapon, viewModel: this.weaponModel(weapon, player), frame: 0, punch: 0 }); return true;
  }
  primaryWeaponHandoff(actor: OwnedActor) {
    const player = this.players.get(actor);
    if (player === undefined) throw new Error("Player has no Q1 weapon state");
    const resolve = (item: ItemId): Q1Weapon | null => {
      const weapon = [...WEAPONS, ...this.registeredWeapons.keys()].find(candidate => this.weaponItem(candidate) === item);
      return weapon !== undefined && this.weaponAvailable(player, weapon) ? weapon : null;
    };
    return {
      provider: this.provider,
      accepts: (item: ItemId): boolean => resolve(item) !== null,
      select: (item: ItemId): boolean => {
        const weapon = resolve(item);
        return weapon !== null && this.selectWeapon(actor, weapon);
      },
      holster: (): void => {
        if (player.primaryHolstered) return;
        player.primaryHolstered = true;
        player.weaponFrame = 0; player.continuousFiring = false; player.weaponAnimationAt = -1;
      },
      isHolstered: (): boolean => player.primaryHolstered,
      resume: (item: ItemId | null): void => {
        const requested = item === null ? player.weapon : resolve(item);
        const weapon = requested !== null && this.weaponAvailable(player, requested) ? requested : bestWeapon(this, actor);
        this.selectWeapon(actor, weapon);
        player.primaryHolstered = false;
      },
    };
  }
  chooseBest(actor: OwnedActor, ammoCount?: (item: ItemId) => number): Q1Weapon { return bestWeapon(this, actor, ammoCount); }
  givePowerup(player: Q1PlayerState, powerup: Q1Powerup, duration = 30): undefined {
    const expires = Math.fround(this.time + duration); player.powerups.set(powerup, expires); this.host.powerup(player.actor, powerup, expires);
    return this.host.emit({ kind: "powerup", player: player.actor.id, powerup, expires });
  }
  dropShells(origin: Vec3): undefined {
    const backpack = this.create("item_backpack"); this.setOrigin(backpack, vadd(origin, { x: 0, y: 0, z: -24 })); backpack.fields.set("shells", "5");
    spawnPickup(this, backpack); this.schedule(backpack, 120, this.named.action(backpack, "SUB_Remove")); return undefined;
  }
  presentations(): readonly Q1Presentation[] { return [...this.entities.values()].map(entity => ({ actor: entity.actor.id, classname: entity.classname, model: entity.model, frame: entity.frame, skin: entity.skin, effects: entity.effects, solid: entity.solid, movement: entity.movement, targetname: entity.targetname, sourceOrdinal: entity.sourceOrdinal })); }
  private projectilePhysics(entity: Q1Actor, elapsed: number): undefined {
    const gib = entity.movement === "gib";
    if (gib && (this.options.physicsEdition ?? this.options.edition) !== "rerelease") throw new Error("Gib movement requires the rerelease physics profile");
    const gravity = gib ? (entity.number("gravity") || 1) * this.options.gravity : this.options.gravity;
    let body = this.body(entity);
    if (body.ground !== null) return undefined;
    let velocity = body.velocity;
    if (entity.movement !== "flymissile" && entity.movement !== "fly") velocity = { ...velocity, z: Math.fround(velocity.z - gravity * elapsed) };
    const trace = this.host.trace({ start: body.origin, end: vadd(body.origin, vscale(velocity, elapsed)), bounds: body.bounds, ignore: entity.actor.id,
      monsters: entity.solid !== "none" && entity.solid !== "trigger", missile: entity.movement === "flymissile" });
    this.setBody(entity, { origin: trace.end, velocity, angles: vadd(body.angles, vscale(entity.angularVelocity, elapsed)) }); this.link(entity);
    if (trace.fraction === 1) return undefined;
    if (trace.sky && entity.projectile !== null && entity.projectile !== "grenade") return this.remove(entity);
    if (entity.projectile !== null) projectileTouch(this, entity, trace.actor, trace.normal);
    else {
      const hit = trace.actor ?? this.world?.actor.id ?? null;
      if (hit !== null) entity.touch?.(hit, trace.normal);
    }
    if (!this.live(entity)) return undefined;
    body = this.body(entity);
    const bounces = entity.movement === "bounce" || entity.movement === "gib" && (this.options.physicsEdition ?? this.options.edition) === "rerelease";
    const overbounce = bounces ? 1.5 : 1;
    velocity = vsub(body.velocity, vscale(trace.normal, dot(body.velocity, trace.normal) * overbounce));
    if (trace.normal.z > 0.7 && (velocity.z < 60 || !bounces)) { velocity = ZERO; entity.angularVelocity = ZERO; }
    this.setBody(entity, { velocity, ground: velocity === ZERO ? trace.actor : null });
    return this.checkWaterTransition(entity);
  }
  /** sv_phys.c: after STEP think, and after a surviving TOSS collision. */
  checkWaterTransition(entity: Q1Actor): undefined {
    const contents = this.host.contents(this.body(entity).origin);
    const value = contents === "solid" ? -2 : contents === "water" ? -3 : contents === "slime" ? -4 : contents === "lava" ? -5 : contents === "sky" ? -6 : -1;
    const transition = q1WaterTransition(entity.waterType, value);
    if (transition.splash) this.sound(entity, "misc/h2ohit1.wav", "auto");
    entity.waterType = transition.waterType; entity.waterLevel = transition.waterLevel;
    return undefined;
  }
}

export function ammoItem(weapon: Q1Weapon): ItemId | null {
  switch (weapon) {
    case "axe": return null;
    case "shotgun": case "supershotgun": return "q1:ammo/shells";
    case "nailgun": case "supernailgun": return "q1:ammo/nails";
    case "grenadelauncher": case "rocketlauncher": return "q1:ammo/rockets";
    case "lightning": case "hipnotic:laser": case "mg3:laser": return "q1:ammo/cells";
    case "hipnotic:mjolnir": case "rogue:grapple": case "ctf:grapple": case "mg3:mjolnir": return null;
    case "hipnotic:proximity": return "q1:ammo/rockets";
    case "rogue:lava-nailgun": case "rogue:lava-supernailgun": return "rogue:ammo/lava-nails";
    case "rogue:multi-grenade": case "rogue:multi-rocket": return "rogue:ammo/multi-rockets";
    case "rogue:plasma": return "rogue:ammo/plasma";
  }
}
