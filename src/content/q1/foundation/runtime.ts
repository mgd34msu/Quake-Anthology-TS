/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { DamageOutcome, DamageRequest, ItemId } from "../../../contracts/gameplay.ts";
import type { Q1CombatContext } from "../../../world/gameplay/policies.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q1Entity, Q1Map } from "../../../formats/q1-map/index.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import { Q1Actor, sourceAngles } from "./entity.ts";
import type { Q1FoundationHost, Q1FoundationOptions, Q1PlayerState, Q1Powerup, Q1Presentation, Q1Weapon } from "./types.ts";
import { Q1_PROVIDER, ZERO, POINT, vadd, vsub, vscale, dot, length, normalize, WEAPONS, weaponItem } from "./types.ts";
import { spawnMapActor, linkDoors } from "./spawns.ts";
import { fireWeapon, bestWeapon, weaponModel, projectileTouch } from "./weapons.ts";
import { spawnPickup, registerPickupCallbacks } from "./pickups.ts";
import { captureFoundation, restoreFoundation } from "./checkpoint.ts";
import type { Q1FoundationCheckpoint } from "./checkpoint.ts";
import { Q1CallbackRegistry } from "./callbacks.ts";
import type { Q1StateExtension } from "./callbacks.ts";
import { registerMoverCallbacks } from "./movers.ts";
import { registerSpawnCallbacks } from "./spawns.ts";
import { registerMonsterCallbacks } from "./monsters.ts";
import { registerWeaponCallbacks } from "./weapons.ts";

export interface Q1SpawnReport {
  readonly spawned: readonly Q1Presentation[];
  readonly inhibited: readonly { readonly ordinal: number; readonly classname: string; readonly reason: string }[];
  readonly compilerOnly: readonly { readonly ordinal: number; readonly classname: string }[];
}

/** Official Q1 behavior runs inside the shared session, using its bodies, scheduling and mutations. */
export class Q1Foundation {
  readonly named = new Q1CallbackRegistry(this);
  readonly stateExtensions = new Map<string, Q1StateExtension>();
  readonly entities = new Map<OwnedActor, Q1Actor>();
  readonly players = new Map<OwnedActor, Q1PlayerState>();
  time = 0;
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
  private sequence = 0;
  private nextDynamicSlot = 1;
  private readonly spawners = new Map<string, (game: Q1Foundation, entity: Q1Actor) => undefined>();

  constructor(readonly host: Q1FoundationHost, readonly options: Q1FoundationOptions) {
    this.nextDynamicSlot = (options.maxClients ?? 0) + 1;
    this.named.register("SUB_Remove", { action: (game, entity) => game.remove(entity) });
    this.named.register("SUB_Null", { action: () => undefined });
    this.named.register("DelayThink", { action: (game, entity) => { game.useTargets(entity, entity.activator); return game.remove(entity); } });
    registerMoverCallbacks(this); registerSpawnCallbacks(this); registerPickupCallbacks(this); registerWeaponCallbacks(this); registerMonsterCallbacks(this);
    host.actors.onRelease(actor => { this.entities.delete(actor); this.players.delete(actor); host.cancelThink(actor); return undefined; });
  }

  capture(): Q1FoundationCheckpoint { return captureFoundation(this, this.sequence, this.nextDynamicSlot); }
  restore(checkpoint: Q1FoundationCheckpoint, options: { readonly scheduleThinks?: boolean } = {}): undefined {
    restoreFoundation(this, checkpoint); this.sequence = checkpoint.sequence; this.nextDynamicSlot = checkpoint.nextDynamicSlot;
    if (options.scheduleThinks ?? true) this.resumeThinks(); return undefined;
  }
  resumeThinks(): undefined {
    for (const entity of this.entities.values()) if (entity.think !== null && entity.nextThink >= 0) this.host.scheduleThink(entity.actor, entity.nextThink);
    return undefined;
  }
  registerStateExtension(extension: Q1StateExtension): undefined {
    if (this.stateExtensions.has(extension.id)) throw new Error(`Duplicate Q1 state extension: ${extension.id}`);
    this.stateExtensions.set(extension.id, extension); return undefined;
  }

  spawnMap(map: Q1Map): Q1SpawnReport {
    if (this.entities.size > 0) throw new Error("Q1 map entities already spawned");
    this.mapName = map.source.replace(/^.*[/\\]/u, "").replace(/\.bsp$/u, "");
    this.nextDynamicSlot = (this.options.maxClients ?? 0) + map.entityList.length;
    const inhibited: { ordinal: number; classname: string; reason: string }[] = [];
    const compilerOnly: { ordinal: number; classname: string }[] = [];
    for (const [ordinal, source] of map.entityList.entries()) {
      const classname = q1EntityValue(source, "classname") ?? "";
      const flags = Number(q1EntityValue(source, "spawnflags") ?? 0);
      const reason = this.inhibit(classname, flags);
      if (reason !== null) { inhibited.push({ ordinal, classname, reason }); continue; }
      // info_null is explicitly removed by misc.qc after the compiler uses its lighting target.
      if (classname === "info_null") { compilerOnly.push({ ordinal, classname }); continue; }
      const actor = this.create(classname, source, ordinal);
      const body = this.body(actor);
      if (actor.model.startsWith("*")) {
        const modelIndex = Number(actor.model.slice(1)); const model = map.models[modelIndex];
        if (model === undefined) throw new Error(`Missing inline model ${actor.model}`);
        // Mod_LoadBrushModel expands each authored bound by one; QC self.size includes that expansion.
        this.host.bodies.write(actor.actor, { ...body, bounds: { min: vsub(model.bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(model.bounds.max, { x: 1, y: 1, z: 1 }) } });
      }
      const extension = this.spawners.get(classname);
      if (extension === undefined) spawnMapActor(this, actor); else extension(this, actor);
      if (this.live(actor)) this.link(actor);
    }
    linkDoors(this);
    return { spawned: this.presentations(), inhibited, compilerOnly };
  }
  registerSpawn(classname: string, handler: (game: Q1Foundation, entity: Q1Actor) => undefined): undefined {
    if (this.spawners.has(classname)) throw new Error(`Q1 spawn handler already registered: ${classname}`);
    this.spawners.set(classname, handler); return undefined;
  }

  replaceSpawn(classname: string, handler: (game: Q1Foundation, entity: Q1Actor) => undefined): undefined {
    if (!this.spawners.has(classname)) throw new Error(`No registered Q1 spawn to replace: ${classname}`);
    this.spawners.set(classname, handler); return undefined;
  }

  create(classname: string, source?: Q1Entity, sourceOrdinal: number | null = null): Q1Actor {
    const slot = sourceOrdinal === null ? this.nextDynamicSlot++ : sourceOrdinal === 0 ? 0 : sourceOrdinal + (this.options.maxClients ?? 0);
    const owner = this.host.actors.allocateAtSource(Q1_PROVIDER, slot, `q1:${classname}`);
    const entity = new Q1Actor(owner, classname, sourceOrdinal, this.host.combat, source);
    this.entities.set(owner, entity);
    this.host.bodies.create(owner, { origin: source === undefined ? ZERO : entity.vector("origin"), angles: source === undefined ? ZERO : sourceAngles(source), velocity: ZERO, bounds: POINT, ground: null });
    this.host.combat.create(owner, { health: entity.maxHealth, armor: { kind: "none" }, mass: 100, canTakeDamage: false, invulnerable: false, team: null });
    this.bindActorCallbacks(entity);
    return entity;
  }
  bindActorCallbacks(entity: Q1Actor): undefined {
    const owner = entity.actor;
    this.host.callbacks.bind(owner, {
      think: (_self, frame) => {
        this.time = frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000;
        const callback = entity.think; entity.think = null; entity.nextThink = -1;
        if (callback !== null) callback(); return undefined;
      },
      touch: contact => entity.touch?.(contact.other, contact.plane?.normal ?? null),
      use: (_self, other, activator) => entity.use?.(other, activator),
      pain: reaction => entity.pain?.(reaction.attacker, reaction.damage),
      die: reaction => entity.die?.(reaction.attacker),
    });
    return undefined;
  }

  attachPlayer(actor: OwnedActor, options: { readonly weapon?: Q1Weapon; readonly initializeInventory?: boolean; readonly maxHealth?: number } = {}): Q1PlayerState {
    this.host.actors.assertOwned(actor);
    const existing = this.players.get(actor); if (existing !== undefined) return existing;
    if (options.initializeInventory ?? true) {
      const entries = WEAPONS.map(weapon => ({ item: weaponItem(weapon), count: weapon === "axe" || weapon === "shotgun" ? 1 : 0, capacity: 1 }));
      entries.push({ item: "q1:ammo/shells", count: 25, capacity: 100 }, { item: "q1:ammo/nails", count: 0, capacity: 200 },
        { item: "q1:ammo/rockets", count: 0, capacity: 100 }, { item: "q1:ammo/cells", count: 0, capacity: 100 },
        { item: "q1:key/silver", count: 0, capacity: 1 }, { item: "q1:key/gold", count: 0, capacity: 1 });
      if (!this.host.inventory.has(actor.id)) this.host.inventory.create(actor, entries);
      else for (const entry of entries) this.host.inventory.configure(actor, entry);
    }
    const state: Q1PlayerState = { actor, weapon: options.weapon ?? "shotgun", attackFinished: 0, weaponFrame: 0, weaponAnimationAt: -1, weaponAnimationBase: 1,
      continuousFiring: false, nextWeaponFrame: 0, lightningSoundAt: 0, nailSide: 1,
      maxHealth: options.maxHealth ?? (this.options.edition === "rerelease" && this.options.skill === 3 && this.options.deathmatch === 0 ? 50 : 100), megaRotAt: -1, hostileUntil: 0, viewAngles: this.host.bodies.read(actor.id)?.angles ?? ZERO,
      waterLevel: 0, airFinished: this.time + 12, drownDamage: 2, drownAt: 0, hazardAt: 0, autoSwitch: "always", powerups: new Map<Q1Powerup, number>() };
    this.players.set(actor, state); return state;
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
    entity.nextThink = Math.fround(this.time + delay); entity.think = callback;
    return this.host.scheduleThink(entity.actor, entity.nextThink);
  }
  cancel(entity: Q1Actor): undefined { entity.nextThink = -1; entity.think = null; return this.host.cancelThink(entity.actor); }
  sound(entity: Q1Actor | OwnedActor, path: string, channel: "auto" | "weapon" | "voice" | "item" | "body" = "voice", attenuation = 1): undefined {
    return this.host.emit({ kind: "sound", actor: entity instanceof Q1Actor ? entity.actor.id : entity.id, path, channel, volume: 1, attenuation });
  }
  message(player: ActorId | null, text: string, center = true): undefined {
    if (player !== null && this.isPlayer(player) && text !== "") this.host.emit({ kind: "message", player, text, center }); return undefined;
  }
  effect(effect: Extract<import("./types.ts").Q1Event, { kind: "effect" }>["effect"], origin: Vec3, actor: ActorId | null = null, amount = 1): undefined {
    return this.host.emit({ kind: "effect", effect, origin, actor, amount });
  }
  find(targetname: string): readonly Q1Actor[] { return targetname === "" ? [] : [...this.entities.values()].filter(entity => entity.targetname === targetname); }
  useTargets(entity: Q1Actor, activator: ActorId | null): undefined {
    if (entity.delay !== 0) {
      const delayed = this.create("DelayedUse"); delayed.target = entity.target; delayed.killtarget = entity.killtarget; delayed.message = entity.message;
      delayed.activator = activator;
      return this.schedule(delayed, entity.delay, this.named.action(delayed, "DelayThink"));
    }
    this.message(activator, entity.message);
    for (const victim of this.find(entity.killtarget)) this.remove(victim);
    // Each use executes synchronously; targets removed by a nested call are not invoked afterward.
    for (const target of this.find(entity.target)) if (this.live(target)) this.host.callbacks.use(target.actor, entity.actor.id, activator);
    return undefined;
  }

  damage(target: ActorId, inflictor: ActorId, attacker: ActorId | null, amount: number, weapon: Q1Weapon | null = null, delivery: "direct" | "radius" = "direct", deathType = ""): DamageOutcome {
    const targetBody = this.host.bodies.read(target); const source = this.host.bodies.read(inflictor);
    const point = targetBody?.origin ?? ZERO;
    const direction = normalize(vsub(point, source?.origin ?? point));
    return this.host.combat.apply({ target, amount: Math.fround(amount), knockback: Math.fround(amount), direction, point, normal: ZERO, delivery,
      attack: { sequence: this.sequence++, time: { kind: "seconds", value: this.time }, attacker, inflictor,
        weapon: weapon === null ? null : weaponItem(weapon), weaponProvider: Q1_PROVIDER, combatProvider: this.options.combatProvider,
        inventoryProvider: this.options.inventoryProvider, movementProvider: this.options.movementProvider, cause: { kind: "q1", deathType } } });
  }
  combatContext(request: DamageRequest): Q1CombatContext {
    const inflictor = request.attack.inflictor === null ? null : this.host.bodies.linked(request.attack.inflictor);
    const target = this.host.bodies.read(request.target);
    return { arithmetic: "binary32", quad: request.attack.attacker !== null && (this.player(request.attack.attacker)?.powerups.get("quad") ?? 0) > this.time,
      teamplay: this.options.teamplay ?? 0, walk: this.isPlayer(request.target), momentumDirection: target === null || inflictor === null ? null :
        normalize(vsub(target.origin, vscale(vadd(inflictor.absoluteBounds.min, inflictor.absoluteBounds.max), 0.5))) };
  }
  canDamage(target: ActorId, inflictor: ActorId): boolean {
    const targetBody = this.host.bodies.read(target), source = this.host.bodies.read(inflictor); if (targetBody === null || source === null) return false;
    const entity = this.entity(target);
    const destination = entity?.movement === "push" ? vadd(targetBody.origin, vscale(vadd(targetBody.bounds.min, targetBody.bounds.max), 0.5)) : targetBody.origin;
    const offsets = entity?.movement === "push" ? [ZERO] : [ZERO, { x: 15, y: 15, z: 0 }, { x: -15, y: -15, z: 0 }, { x: -15, y: 15, z: 0 }, { x: 15, y: -15, z: 0 }];
    return offsets.some(offset => { const trace = this.host.trace({ start: source.origin, end: vadd(destination, offset), bounds: POINT, ignore: inflictor, monsters: false }); return trace.fraction === 1 || trace.actor !== null && sameActor(trace.actor, target); });
  }
  radiusDamage(inflictor: ActorId, attacker: ActorId | null, amount: number, ignore: ActorId | null, weapon: Q1Weapon | null): undefined {
    const source = this.host.bodies.read(inflictor); if (source === null) return undefined;
    for (const observation of this.host.actors.observations()) {
      const target = observation.id; const combat = this.host.combat.read(target), body = this.host.bodies.read(target);
      if (combat === null || !combat.canTakeDamage || body === null || ignore !== null && sameActor(ignore, target)) continue;
      const center = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5));
      const distance = length(vsub(center, source.origin)); if (distance > amount + 40) continue;
      let points = Math.fround(amount - 0.5 * distance); if (attacker !== null && sameActor(target, attacker)) points *= 0.5;
      if (this.host.classname(target) === "monster_shambler") points *= 0.5;
      if (points > 0 && this.canDamage(target, inflictor)) this.damage(target, inflictor, attacker, points, weapon, "radius");
    }
    return undefined;
  }

  calcMove(entity: Q1Actor, destination: Vec3, speed: number, done: () => undefined): undefined {
    if (!(speed > 0)) throw new RangeError("Q1 mover speed must be positive");
    this.cancel(entity); const delta = vsub(destination, this.body(entity).origin); const travel = length(delta) / speed;
    entity.move = { destination, speed, remaining: Math.max(0.1, travel), done };
    return this.setBody(entity, { velocity: travel < 0.1 ? ZERO : vscale(delta, 1 / travel) });
  }

  /** Convenience for direct provider use. The unified session calls physicsEntity in source-slot order. */
  physicsStep(seconds: number, elapsedSeconds: number): undefined {
    for (const entity of [...this.entities.values()]) this.physicsEntity(entity.actor, seconds, elapsedSeconds);
    for (const player of this.players.values()) this.playerFrame(player.actor, seconds);
    return undefined;
  }
  physicsEntity(actor: OwnedActor, seconds: number, elapsedSeconds: number): undefined {
    this.time = seconds; const entity = this.entities.get(actor);
    if (entity === undefined || !this.live(entity)) return undefined;
    const move = entity.move;
    if (move !== null) {
      const body = this.body(entity); const duration = Math.min(elapsedSeconds, move.remaining);
      const final = duration >= move.remaining;
      const displacement = final ? vsub(move.destination, body.origin) : vscale(body.velocity, duration);
      const blocker = this.host.pushMove(entity.actor, displacement);
      if (blocker !== null) return undefined;
      move.remaining -= duration;
      if (final) { entity.move = null; this.setBody(entity, { velocity: ZERO }); move.done(); }
    } else if (entity.movement === "toss" || entity.movement === "bounce" || entity.movement === "flymissile") this.projectilePhysics(entity, elapsedSeconds);
    return undefined;
  }
  /** Weapon/powerup/environment state; jumping belongs to the independently selected movement provider. */
  playerFrame(actor: OwnedActor, seconds: number, waterLevel?: number): undefined {
    this.time = seconds; const player = this.players.get(actor);
    if (player === undefined) return undefined;
    if (waterLevel !== undefined) player.waterLevel = waterLevel;
    if (!player.continuousFiring && player.weaponAnimationAt >= 0) {
      const frame = Math.floor((seconds - player.weaponAnimationAt) / 0.1);
      const count = player.weapon === "axe" ? 4 : 6;
      const next = frame >= count ? 0 : player.weaponAnimationBase + frame;
      if (next !== player.weaponFrame) {
        player.weaponFrame = next; this.host.emit({ kind: "weapon", player: actor.id, weapon: player.weapon, viewModel: weaponModel(player.weapon), frame: next, punch: 0 });
      }
      if (frame >= count) player.weaponAnimationAt = -1;
    }
    if (player.megaRotAt >= 0 && player.megaRotAt <= seconds) {
      const health = this.health(actor.id);
      if (health > player.maxHealth) { this.host.combat.setHealth(actor, health - 1); player.megaRotAt = seconds + 1; }
      else player.megaRotAt = -1;
    }
    for (const [powerup, expires] of player.powerups) if (expires <= seconds) { player.powerups.delete(powerup); this.host.powerup(actor, powerup, 0); }
    if (this.intermission !== null || this.health(actor.id) < 0) return undefined;
    const suit = (player.powerups.get("suit") ?? 0) > seconds;
    if (player.waterLevel !== 3 || suit) { player.airFinished = seconds + 12; player.drownDamage = 2; }
    else if (player.airFinished < seconds && player.drownAt < seconds) {
      player.drownDamage += 2; if (player.drownDamage > 15) player.drownDamage = 10;
      this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, player.drownDamage, null, "direct", "drown"); player.drownAt = seconds + 1;
    }
    const body = this.host.bodies.read(actor.id);
    if (body !== null && player.waterLevel > 0 && player.hazardAt < seconds) {
      const contents = this.host.contents(vadd(body.origin, { x: 0, y: 0, z: body.bounds.min.z + 1 }));
      if (contents === "lava") {
        player.hazardAt = seconds + (suit ? 1 : 0.2); this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, 10 * player.waterLevel, null, "direct", "lava");
      } else if (contents === "slime" && !suit) {
        player.hazardAt = seconds + 1; this.damage(actor.id, this.world?.actor.id ?? actor.id, this.world?.actor.id ?? null, 4 * player.waterLevel, null, "direct", "slime");
      }
    }
    return undefined;
  }
  travel(map: string, cause: ActorId | null): undefined {
    return this.host.transition({ kind: "campaign-level", campaign: this.options.campaign, map: `q1:${map}`, spawnPoint: "", gates: [], cause });
  }
  beginIntermission(map: string, cause: ActorId | null): undefined {
    const spots = [...this.entities.values()].filter(entity => entity.classname === "info_intermission");
    const selected = spots[Math.min(spots.length - 1, Math.floor(this.host.random() * spots.length))] ?? [...this.entities.values()].find(entity => entity.classname === "info_player_start");
    const body = selected === undefined ? null : this.body(selected);
    const exitAfter = this.time + (this.options.deathmatch !== 0 ? 5 : 2);
    this.intermission = { map, cause, exitAfter };
    return this.host.emit({ kind: "intermission", origin: body?.origin ?? ZERO, angles: selected?.vector("mangle") ?? body?.angles ?? ZERO, map, exitAfter, track: 3 });
  }
  requestIntermissionExit(seconds: number, pressed: boolean): boolean {
    const pending = this.intermission;
    if (pending === null || seconds < pending.exitAfter || !pressed) return false;
    this.time = seconds; this.intermission = null; this.travel(pending.map, pending.cause); return true;
  }

  attack(actor: OwnedActor, viewAngles: Vec3, seconds: number, waterLevel = 0): boolean {
    this.time = seconds; const player = this.players.get(actor); if (player === undefined) throw new Error("Player has no Q1 weapon state");
    player.viewAngles = viewAngles; player.waterLevel = waterLevel; return fireWeapon(this, player);
  }
  weaponInput(actor: OwnedActor, pressed: boolean, viewAngles: Vec3, seconds: number, waterLevel = 0): boolean {
    const player = this.players.get(actor); if (player === undefined) throw new Error("Player has no Q1 weapon state");
    this.time = seconds; player.viewAngles = viewAngles; player.waterLevel = waterLevel;
    if (!pressed) {
      if (player.continuousFiring) { player.continuousFiring = false; player.weaponAnimationAt = -1; player.weaponFrame = 0; }
      return false;
    }
    return this.attack(actor, viewAngles, seconds, waterLevel);
  }
  selectWeapon(actor: OwnedActor, weapon: Q1Weapon): boolean {
    const player = this.players.get(actor); if (player === undefined || this.host.inventory.count(actor.id, weaponItem(weapon)) === 0) return false;
    player.weapon = weapon; player.weaponFrame = 0; player.continuousFiring = false; player.weaponAnimationAt = -1;
    this.host.emit({ kind: "weapon", player: actor.id, weapon, viewModel: weaponModel(weapon), frame: 0, punch: 0 }); return true;
  }
  chooseBest(actor: OwnedActor): Q1Weapon { return bestWeapon(this, actor); }
  givePowerup(player: Q1PlayerState, powerup: Q1Powerup): undefined {
    const expires = Math.fround(this.time + 30); player.powerups.set(powerup, expires); this.host.powerup(player.actor, powerup, expires);
    return this.host.emit({ kind: "powerup", player: player.actor.id, powerup, expires });
  }
  dropShells(origin: Vec3): undefined {
    const backpack = this.create("item_backpack"); this.setOrigin(backpack, vadd(origin, { x: 0, y: 0, z: -24 })); backpack.fields.set("shells", "5");
    spawnPickup(this, backpack); this.schedule(backpack, 120, this.named.action(backpack, "SUB_Remove")); return undefined;
  }
  presentations(): readonly Q1Presentation[] { return [...this.entities.values()].map(entity => ({ actor: entity.actor.id, classname: entity.classname, model: entity.model, frame: entity.frame, skin: entity.skin, effects: entity.effects, solid: entity.solid, movement: entity.movement, targetname: entity.targetname, sourceOrdinal: entity.sourceOrdinal })); }

  private inhibit(classname: string, flags: number): string | null {
    if (this.options.deathmatch !== 0 && ((flags & 2048) !== 0 || classname.startsWith("monster_"))) return "deathmatch";
    if (this.options.deathmatch === 0) {
      const bit = this.options.skill === 0 ? 256 : this.options.skill === 1 ? 512 : 1024;
      if ((flags & bit) !== 0) return `skill-${this.options.skill}`;
    }
    return null;
  }
  private projectilePhysics(entity: Q1Actor, elapsed: number): undefined {
    let body = this.body(entity);
    if (body.ground !== null && entity.movement !== "flymissile") return undefined;
    let velocity = body.velocity;
    if (entity.movement !== "flymissile") velocity = { ...velocity, z: Math.fround(velocity.z - this.options.gravity * elapsed) };
    const trace = this.host.trace({ start: body.origin, end: vadd(body.origin, vscale(velocity, elapsed)), bounds: body.bounds, ignore: entity.actor.id,
      monsters: entity.solid !== "none" && entity.solid !== "trigger", missile: entity.movement === "flymissile" });
    this.setBody(entity, { origin: trace.end, velocity, angles: vadd(body.angles, vscale(entity.angularVelocity, elapsed)) }); this.link(entity);
    if (trace.fraction === 1) return undefined;
    if (trace.sky) return this.remove(entity);
    if (entity.projectile !== null) projectileTouch(this, entity, trace.actor, trace.normal);
    else {
      const hit = trace.actor ?? this.world?.actor.id ?? null;
      if (hit !== null) entity.touch?.(hit, trace.normal);
    }
    if (!this.live(entity)) return undefined;
    body = this.body(entity);
    const overbounce = entity.movement === "bounce" ? 1.5 : 1;
    velocity = vsub(body.velocity, vscale(trace.normal, dot(body.velocity, trace.normal) * overbounce));
    if (trace.normal.z > 0.7 && (velocity.z < 60 || entity.movement !== "bounce")) velocity = ZERO;
    return this.setBody(entity, { velocity, ground: velocity === ZERO ? trace.actor : null });
  }
}

export function ammoItem(weapon: Q1Weapon): ItemId | null {
  switch (weapon) {
    case "axe": return null;
    case "shotgun": case "supershotgun": return "q1:ammo/shells";
    case "nailgun": case "supernailgun": return "q1:ammo/nails";
    case "grenadelauncher": case "rocketlauncher": return "q1:ammo/rockets";
    case "lightning": return "q1:ammo/cells";
  }
}
