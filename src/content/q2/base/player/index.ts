/* Source player phases are invoked by the common simulation. This is not a second G_RunFrame. */
import type { DamageDecision, InventoryEntry } from "../../../../contracts/gameplay.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { DeathReaction } from "../../../../contracts/world.ts";
import { add, dot, scale, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2LandmarkCarry } from "../../foundation/host.ts";
import type { Q2ItemModule } from "../../foundation/items.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { Q2WeaponState, q2WeaponDefinition } from "../../foundation/weapons/index.ts";
import type { Q2WeaponEvent, Q2Weapons } from "../../foundation/weapons/index.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { q2FallingDamage, q2WorldEffects } from "./environment.ts";
import { q2Obituary } from "./obituary.ts";
import { q2ClientAnimation, q2ClientEffects, q2BuildView, q2DamageFeedback } from "./view.ts";
import { q2EntitiesNamed, q2KillBox, q2PlayerSpawns, q2SpawnOrigin, selectQ2Spawn } from "./spawns.ts";
import { createQ2PlayerRules, Q2PlayerState } from "./types.ts";
import type { Q2PlayerCarry, Q2PlayerContext, Q2PlayerHooks, Q2PlayerRules, Q2ScoreRow } from "./types.ts";
import { runQ2ClientCommand } from "./commands.ts";
import { placeQ2Landmark } from "./landmarks.ts";
export * from "./types.ts";
export { q2WorldEffects, q2FallingDamage } from "./environment.ts";
export { addQ2Blend } from "./view.ts";
export { q2Obituary } from "./obituary.ts";
export { q2PlayerSpawns, q2PlayersRange, selectQ2Spawn, q2KillBox } from "./spawns.ts";
export { Q2CharacterActor } from "./character.ts";
export type { Q2CharacterHost, Q2CharacterOptions, Q2CharacterGib } from "./character.ts";
export { rotateQ2Landmark, placeQ2Landmark, fixQ2StuckPlayer } from "./landmarks.ts";

export interface Q2PlayerAdmission {
  readonly slot: number;
  readonly userinfo: string;
  /** False when another selected inventory provider has already admitted the loadout. */
  readonly initializeInventory: boolean;
  readonly useQ2Weapons?: boolean;
  readonly useQ2Inventory?: boolean;
  readonly carry?: Q2PlayerCarry;
}
export type Q2ConnectionResult = { readonly allowed: true; readonly userinfo: string } | { readonly allowed: false; readonly userinfo: string; readonly reason: string };
export type Q2Intermission = { readonly kind: "playing" } | { readonly kind: "intermission"; readonly map: string; readonly started: number; readonly exit: boolean; readonly landmark: Q2LandmarkCarry | null };

export function q2Userinfo(source: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const tokens = (source.startsWith("\\") ? source.slice(1) : source).split("\\");
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const key = tokens[index], value = tokens[index + 1];
    if (key !== undefined && value !== undefined && !result.has(key)) result.set(key, value);
  }
  return result;
}
function infoNumber(value: string | undefined): number { return Number.parseInt(value ?? "0", 10) || 0; }

export class Q2Players implements Q2SpawnModule {
  readonly states = new Map<ActorId, Q2PlayerState>();
  readonly rules: Q2PlayerRules;
  intermission: Q2Intermission = { kind: "playing" };
  private corpseIndex = 0;
  private deathAnimation = 0;
  private painAnimation = 0;
  private readonly playerEntities = new Map<ActorId, Q2Entity>();
  constructor(readonly items: Q2ItemModule, readonly weapons: Q2Weapons, readonly hooks: Q2PlayerHooks, rules: Partial<Q2PlayerRules> = {}) {
    this.rules = createQ2PlayerRules(rules);
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean { return q2PlayerSpawns.spawn(entity, game); }

  context(entity: Q2Entity, game: Q2GameServices): Q2PlayerContext {
    const state = this.states.get(entity.actor.id);
    if (state === undefined) throw new Error("Q2 player has not been admitted");
    return { entity, game, state, movement: this.hooks.movement(entity.actor.id), rules: this.rules, hooks: this.hooks, items: this.items, weapons: this.weapons,
      powerups: () => this.items.playerPowerups(entity.actor.id),
      weaponState: () => { const weapon = this.weapons.states.get(entity.actor.id); return weapon === undefined ? null : {
        q2Name: weapon.weapon, ammo: weapon.weapon === null ? null : q2WeaponDefinition(weapon.weapon).ammo, kickAngles: weapon.kickAngles, kickOrigin: weapon.kickOrigin, loopSound: weapon.loopSound }; },
      environmentDamage: (amount, means, flags) => {
        const world = game.host.worldActor();
        const attack = { ...game.attack(entity, world, means, flags, null), inflictor: world };
        game.host.combat.apply({ attack, target: entity.actor.id, amount, knockback: 0, direction: means === 22 ? { x: 0, y: 0, z: 1 } : zero,
          point: game.body(entity).origin, normal: zero, delivery: "direct" });
        return undefined;
      } };
  }

  connect(game: Q2GameServices, userinfo: string): Q2ConnectionResult {
    const info = q2Userinfo(userinfo);
    let reason = "";
    const spectator = game.options.mode === "deathmatch" && (info.get("spectator") ?? "") !== "" && info.get("spectator") !== "0";
    const pass = spectator ? this.rules.spectatorPassword : this.rules.password;
    if (this.hooks.banned(info.get("ip") ?? "")) reason = "Banned.";
    else if (pass !== "" && pass !== "none" && pass !== info.get(spectator ? "spectator" : "password")) reason = spectator ? "Spectator password required or incorrect." : "Password required or incorrect.";
    else if (spectator && [...this.states.values()].filter(state => state.connected && state.requestedSpectator).length >= this.rules.maxSpectators) reason = "Server spectator limit is full.";
    if (reason !== "") {
      const pairs = [...info].filter(([key]) => key !== "rejmsg"); pairs.push(["rejmsg", reason]);
      return { allowed: false, userinfo: pairs.map(([key, value]) => `\\${key}\\${value}`).join(""), reason };
    }
    return { allowed: true, userinfo };
  }

  attach(entity: Q2Entity, game: Q2GameServices, admission: Q2PlayerAdmission): Q2PlayerState {
    game.host.actors.assertOwned(entity.actor);
    if (this.states.has(entity.actor.id)) throw new Error("Q2 player lifecycle already bound");
    if (!Number.isInteger(admission.slot) || admission.slot < 0 || admission.slot >= game.options.maxClients) throw new RangeError("Q2 player slot is outside maxclients");
    const state = new Q2PlayerState(admission.slot, game.host.now());
    state.useQ2Weapons = admission.useQ2Weapons ?? true;
    state.useQ2Inventory = admission.useQ2Inventory ?? game.options.inventoryProvider.startsWith("q2:");
    state.airFinished = game.host.now() + 12;
    this.states.set(entity.actor.id, state);
    this.playerEntities.set(entity.actor.id, entity);
    const release = game.host.actors.onRelease(actor => { if (actor.id === entity.actor.id) { this.states.delete(actor.id); this.playerEntities.delete(actor.id); release(); } return undefined; });
    this.userinfoChanged(entity, game, admission.userinfo);
    if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
    if (game.host.combat.read(entity.actor.id) === null) game.host.combat.create(entity.actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
    if (admission.initializeInventory) this.items.configurePlayer(entity.actor, game, true);
    if (state.useQ2Weapons && !this.weapons.states.has(entity.actor.id)) this.weapons.bind(entity, game);
    entity.pain = () => undefined;
    entity.die = (self, active, reaction) => this.death(self, active, reaction);
    entity.maxHealth ||= 100;
    entity.viewHeight ||= 22;
    if (admission.carry !== undefined) this.restoreCarry(entity, game, admission.carry);
    state.spawnInventory = game.host.inventory.entries(entity.actor.id);
    state.coopRespawn = this.saveCarry(entity, game);
    state.spectator = state.requestedSpectator;
    return state;
  }

  userinfoChanged(entity: Q2Entity, game: Q2GameServices, source: string): undefined {
    const state = this.states.get(entity.actor.id);
    if (state === undefined) throw new Error("Q2 userinfo requires an admitted player");
    const valid = !source.includes('"') && !source.includes(";");
    state.userinfo = (valid ? source : "\\name\\badinfo\\skin\\male/grunt").slice(0, 511);
    const info = q2Userinfo(state.userinfo);
    state.name = (info.get("name") ?? "").slice(0, 15); state.skin = info.get("skin") ?? "";
    const gender = (info.get("gender") ?? "").slice(0, 1).toLowerCase();
    state.gender = gender === "f" ? "female" : gender === "m" ? "male" : "neutral";
    state.requestedSpectator = game.options.mode === "deathmatch" && (info.get("spectator") ?? "") !== "" && info.get("spectator") !== "0";
    const fov = infoNumber(info.get("fov")); state.fov = game.options.mode === "deathmatch" && (game.options.deathmatchFlags & 32768) !== 0 ? 90 : fov < 1 ? 90 : Math.min(160, fov);
    const hand = infoNumber(info.get("hand")); state.hand = hand === 1 ? "left" : hand === 2 ? "center" : "right";
    return this.hooks.emit({ kind: "userinfo", actor: entity.actor.id, slot: state.slot, name: state.name, skin: state.skin });
  }

  saveCarry(entity: Q2Entity, game: Q2GameServices): Q2PlayerCarry {
    const state = this.context(entity, game).state, combat = game.host.combat.read(entity.actor.id);
    if (combat === null) throw new Error("Q2 carry requires shared combat state");
    return { health: combat.health, maximumHealth: entity.maxHealth, armor: combat.armor, inventory: game.host.inventory.entries(entity.actor.id),
      weapon: this.weapons.states.get(entity.actor.id)?.weapon ?? null, selectedItem: state.selectedItem, score: state.score, flags: entity.flags & (16 | 32 | 4096), powerCubes: entity.powerCubes };
  }
  restoreCarry(entity: Q2Entity, game: Q2GameServices, carry: Q2PlayerCarry): undefined {
    const state = this.context(entity, game).state;
    game.host.combat.setHealth(entity.actor, carry.health); game.host.combat.setArmor(entity.actor, carry.armor);
    this.setInventory(entity, game, carry.inventory); entity.maxHealth = carry.maximumHealth; entity.flags |= carry.flags;
    entity.powerCubes = carry.powerCubes;
    state.god = (carry.flags & 16) !== 0; state.notarget = (carry.flags & 32) !== 0;
    state.score = carry.score; state.selectedItem = carry.selectedItem;
    game.host.combat.setTraits(entity.actor, { invulnerable: state.god });
    const weapon = this.weapons.states.get(entity.actor.id);
    if (weapon !== undefined) { weapon.weapon = carry.weapon; weapon.pending = null; }
    return undefined;
  }
  private setInventory(entity: Q2Entity, game: Q2GameServices, entries: readonly InventoryEntry[]): undefined {
    for (const entry of game.host.inventory.entries(entity.actor.id)) game.host.inventory.configure(entity.actor, { ...entry, count: 0 });
    for (const entry of entries) game.host.inventory.configure(entity.actor, entry);
    return undefined;
  }

  consumedKey(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state;
    if (state.coopRespawn !== null) {
      const current = game.host.inventory.entries(entity.actor.id);
      state.coopRespawn = { ...state.coopRespawn, powerCubes: entity.powerCubes,
        inventory: state.coopRespawn.inventory.map(entry => entry.item.startsWith("q2:key_") ? current.find(item => item.item === entry.item) ?? { ...entry, count: 0 } : entry) };
    }
    return undefined;
  }

  putInServer(entity: Q2Entity, game: Q2GameServices, restoreLoadout = true, landmark: Q2LandmarkCarry | null = null): undefined {
    const old = this.context(entity, game), state = old.state;
    // Source selects spawn while the prior life still contributes its old health/distance.
    const spot = selectQ2Spawn(game, state, this.rules.spawnPoint);
    const placement = landmark === null ? null : placeQ2Landmark(entity, game, landmark, spot, old.movement.standingBounds);
    const origin = placement === null ? q2SpawnOrigin(spot, game) : add(placement.origin, { x: 0, y: 0, z: 1 });
    const sourceAngles = placement?.angles ?? game.body(spot).angles, velocity = placement?.velocity ?? zero;
    const angles = placement === null ? { x: 0, y: sourceAngles.y, z: 0 } : { ...sourceAngles, x: sourceAngles.x / 3 };
    if (restoreLoadout) {
      if (game.options.mode === "coop" && state.coopRespawn !== null) this.restoreCarry(entity, game, { ...state.coopRespawn, score: Math.max(state.score, state.coopRespawn.score) });
      else if (game.options.mode === "deathmatch" || (game.host.combat.read(entity.actor.id)?.health ?? 0) <= 0) {
        this.setInventory(entity, game, state.useQ2Inventory ? [] : state.spawnInventory);
        if (state.useQ2Inventory) this.items.configurePlayer(entity.actor, game, true);
        game.host.combat.setHealth(entity.actor, 100); game.host.combat.setArmor(entity.actor, { kind: "none" }); entity.maxHealth = 100;
        state.selectedItem = "q2:weapon_blaster";
      }
    }
    state.dead = false; state.gibbed = false; state.oldWaterLevel = 0; state.airFinished = game.host.now() + 12; state.drownDamage = 2;
    state.damageAlpha = 0; state.bonusAlpha = 0; state.damageBlood = 0; state.damageArmor = 0; state.damagePowerArmor = 0; state.damageKnockback = 0;
    state.fallTime = 0; state.bobTime = 0; state.bobMove = 0; state.animationPriority = 0; state.animationEnd = 39;
    state.spectator = state.requestedSpectator; state.noclip = state.spectator; state.chaseTarget = null; state.oldVelocity = zero;
    state.landmarkFreeFall = placement !== null;
    this.clearPowerups(entity, game);
    entity.viewHeight = 22; entity.serverFlags &= ~(1 | 2); entity.flags &= ~(1024 | 0x20000); entity.angularVelocity = zero;
    entity.frame = 0; entity.oldFrame = -1; entity.effects = 0; entity.renderFlags = 0; entity.visible = !state.spectator;
    entity.model = old.movement.animateQ2 ? `players/${state.skin.split("/")[0] || "male"}/tris.md2` : entity.model;
    game.host.combat.setTraits(entity.actor, { canTakeDamage: !state.spectator, mass: 200, invulnerable: state.god });
    game.move(entity, { origin, velocity, angles, bounds: old.movement.standingBounds, ground: null }, false);
    game.solid(entity, state.spectator ? "none" : "box"); game.motion(entity, "stationary");
    this.hooks.setMovement(entity.actor.id, { kind: "spawn", origin, velocity, angles, commandAngles: old.movement.commandAngles, holdMilliseconds: 0, spectator: state.spectator });
    if (!state.spectator) q2KillBox(entity, game);
    const weapon = this.weapons.states.get(entity.actor.id);
    if (state.useQ2Weapons && weapon !== undefined) {
      const selected = game.options.mode === "deathmatch" ? "blaster" : state.coopRespawn?.weapon ?? weapon.weapon ?? "blaster";
      Object.assign(weapon, new Q2WeaponState(selected));
    }
    if (old.movement.animateQ2) game.show(entity);
    game.link(entity);
    return undefined;
  }

  respawn(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state;
    if (game.options.mode === "singleplayer") return this.hooks.emit({ kind: "load-menu", actor: entity.actor.id });
    if (!state.noclip) this.copyToBodyQueue(entity, game);
    this.putInServer(entity, game);
    const body = game.body(entity), movement = this.hooks.movement(entity.actor.id);
    this.hooks.setMovement(entity.actor.id, { kind: "spawn", origin: body.origin, velocity: body.velocity, angles: movement.viewAngles,
      commandAngles: movement.commandAngles, holdMilliseconds: 112, spectator: state.spectator });
    state.respawnTime = game.host.now(); state.event = "q2:player-teleport";
    return undefined;
  }

  copyToBodyQueue(entity: Q2Entity, game: Q2GameServices): undefined {
    const corpses = q2EntitiesNamed(game, "bodyque"), corpse = corpses[this.corpseIndex];
    if (corpse === undefined) throw new Error("Q2 corpse reuse requires worldspawn's eight reserved body slots");
    this.corpseIndex = (this.corpseIndex + 1) % 8;
    game.host.bodies.unlink(entity.actor); game.host.bodies.unlink(corpse.actor);
    corpse.model = entity.model; corpse.frame = entity.frame; corpse.skin = entity.skin; corpse.effects = entity.effects; corpse.renderFlags = entity.renderFlags;
    corpse.serverFlags = entity.serverFlags; corpse.clipMask = entity.clipMask; corpse.owner = entity.owner; corpse.visible = entity.visible;
    game.move(corpse, game.body(entity), false);
    // Original CopyToBodyQue leaves the reserved edict's health value in place.
    if (game.host.combat.read(corpse.actor.id) === null) game.host.combat.create(corpse.actor, { health: 0, armor: { kind: "none" }, canTakeDamage: true, invulnerable: false, mass: 0, team: null });
    else game.host.combat.setTraits(corpse.actor, { canTakeDamage: true, invulnerable: false });
    corpse.die = (self, active, reaction) => {
      if ((active.host.combat.read(self.actor.id)?.health ?? 0) < -40) {
        active.sound(self, "misc/udeath.wav", 4);
        for (let index = 0; index < 4; index++) throwGib(self, active, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        active.move(self, { origin: add(active.body(self).origin, { x: 0, y: 0, z: -48 }) });
        this.throwClientHead(self, active, reaction.damage); active.host.combat.setTraits(self.actor, { canTakeDamage: false });
      }
      return undefined;
    };
    game.solid(corpse, entity.solid); game.motion(corpse, entity.motion); game.show(corpse);
    return undefined;
  }

  private throwClientHead(entity: Q2Entity, game: Q2GameServices, damage: number): undefined {
    const head = game.host.random() < 0.5;
    entity.model = head ? "models/objects/gibs/head2/tris.md2" : "models/objects/gibs/skull/tris.md2"; entity.skin = head ? 1 : 0;
    entity.frame = 0; entity.effects = 2; entity.angularVelocity = zero;
    const magnitude = damage < 50 ? 0.7 : 1.2;
    const impulse = { x: (game.host.random() * 2 - 1) * 100 * magnitude, y: (game.host.random() * 2 - 1) * 100 * magnitude, z: (200 + game.host.random() * 100) * magnitude };
    game.move(entity, { origin: add(game.body(entity).origin, { x: 0, y: 0, z: 32 }), velocity: add(game.body(entity).velocity, impulse), bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 16 } } });
    game.solid(entity, "none"); game.motion(entity, "bounce"); game.show(entity);
    return undefined;
  }

  death(entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction): undefined {
    const context = this.context(entity, game), state = context.state;
    if (!context.movement.animateQ2) { this.recordDeath(entity, game, reaction); return undefined; }
    entity.angularVelocity = zero; entity.serverFlags |= 2;
    game.move(entity, { angles: { x: 0, y: game.body(entity).angles.y, z: 0 }, bounds: { ...game.body(entity).bounds, max: { ...game.body(entity).bounds.max, z: -8 } } }, false);
    game.motion(entity, "toss"); game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    const first = this.recordDeath(entity, game, reaction);
    const health = game.host.combat.read(entity.actor.id)?.health ?? 0;
    if (health < -40 && !state.gibbed) {
      game.sound(entity, "misc/udeath.wav", 4);
      for (let index = 0; index < 4; index++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      this.throwClientHead(entity, game, reaction.damage); state.gibbed = true;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    } else if (first) {
      this.deathAnimation = (this.deathAnimation + 1) % 3; state.animationPriority = 5;
      entity.frame = context.movement.ducked ? 172 : this.deathAnimation === 0 ? 177 : this.deathAnimation === 1 ? 183 : 189;
      state.animationEnd = context.movement.ducked ? 177 : this.deathAnimation === 0 ? 183 : this.deathAnimation === 1 ? 189 : 197;
      game.sound(entity, `*death${Math.floor(game.host.random() * 4) + 1}.wav`, 2);
    }
    game.link(entity); game.show(entity);
    return undefined;
  }

  /** Campaign death bookkeeping also applies to a foreign character on this actor. */
  recordDeath(entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction): boolean {
    const state = this.context(entity, game).state, first = !state.dead;
    if (first) {
      state.respawnTime = game.host.now() + 1;
      const killer = reaction.attacker !== null && reaction.attacker !== entity.actor.id ? game.host.bodies.read(reaction.attacker)
        : reaction.inflictor !== null && reaction.inflictor !== entity.actor.id ? game.host.bodies.read(reaction.inflictor) : null;
      if (killer !== null) { const origin = game.body(entity).origin; state.killerYaw = (Math.atan2(killer.origin.y - origin.y, killer.origin.x - origin.x) * 180 / Math.PI + 360) % 360; }
      else state.killerYaw = game.body(entity).angles.y;
      const attack = entity.lastAttack;
      this.hooks.emit({ kind: "print", target: null, level: "medium", text: q2Obituary(state, reaction.attacker === null ? null : this.states.get(reaction.attacker) ?? null,
        attack?.cause.kind === "q2" ? attack.cause.meansOfDeath : 0, game.options.mode === "deathmatch", game.options.mode === "coop") });
      this.tossWeapon(entity, game);
      if (!state.useQ2Weapons) this.hooks.dropInventory?.(entity, game, attack);
      if (game.options.mode === "coop" && state.coopRespawn !== null) {
        const current = game.host.inventory.entries(entity.actor.id);
        state.coopRespawn = { ...state.coopRespawn, inventory: state.coopRespawn.inventory.map(entry => entry.item.startsWith("q2:key_") ? current.find(value => value.item === entry.item) ?? entry : entry) };
      }
      this.setInventory(entity, game, []);
      state.showScores = game.options.mode === "deathmatch";
    }
    state.dead = true;
    this.clearPowerups(entity, game);
    for (const tracker of q2EntitiesNamed(game, "pain daemon")) if (tracker.enemy === entity.actor.id) game.remove(tracker);
    this.hooks.death?.(entity, game, entity.lastAttack);
    return first;
  }

  private tossWeapon(entity: Q2Entity, game: Q2GameServices): undefined {
    if (game.options.mode !== "deathmatch") return undefined;
    if (this.states.get(entity.actor.id)?.useQ2Weapons !== true) return undefined;
    const weapon = this.weapons.states.get(entity.actor.id)?.weapon;
    const definition = weapon === undefined || weapon === null ? null : q2WeaponDefinition(weapon);
    const item = definition !== null && definition.name !== "blaster" && (definition.ammo === null || game.host.inventory.count(entity.actor.id, definition.ammo) !== 0) ? definition.item : null;
    const quad = this.items.playerPowerups(entity.actor.id).quadUntil;
    const dropQuad = (game.options.deathmatchFlags & 16384) !== 0 && quad > game.host.now() + 1, spread = item !== null && dropQuad ? 22.5 : 0;
    if (item !== null) this.items.drop(entity, game, item, { playerDeath: true, yawOffset: -spread });
    if (dropQuad) this.items.drop(entity, game, "q2:item_quad", { playerDeath: true, yawOffset: spread, expiresAt: quad });
    return undefined;
  }
  private clearPowerups(entity: Q2Entity, game: Q2GameServices): undefined {
    this.items.clearPowerups(entity.actor.id); entity.flags &= ~4096;
    const armor = game.host.combat.read(entity.actor.id)?.armor;
    if (armor?.kind === "q2") game.host.combat.setArmor(entity.actor, { ...armor, powerArmor: { kind: "none" } });
    return game.host.combat.setTraits(entity.actor, { invulnerable: this.states.get(entity.actor.id)?.god ?? false });
  }

  /** Call after the common movement commit, trigger callbacks, and Q2 movement contacts. */
  afterClientThink(entity: Q2Entity, game: Q2GameServices): undefined {
    const context = this.context(entity, game), state = context.state;
    state.latchedButtons |= context.movement.buttons & ~state.buttons; state.buttons = context.movement.buttons;
    if (this.intermission.kind === "intermission") {
      if (game.host.now() > this.intermission.started + 5 && state.buttons !== 0) this.intermission = { ...this.intermission, exit: true };
      return undefined;
    }
    if (state.spectator) {
      if ((state.latchedButtons & 1) !== 0) { state.latchedButtons &= ~1; this.chase(entity, game, 1, true); }
    } else if (state.useQ2Weapons && (state.latchedButtons & 1) !== 0 && !state.weaponThunk) {
      state.weaponThunk = true; this.weapons.tick(entity, game, { ...this.hooks.weaponInput(entity.actor.id), latchedAttack: true });
    }
    for (const [actor, watcher] of this.states) {
      const observer = game.entity(actor);
      if (watcher.chaseTarget === entity.actor.id && observer !== null) this.updateChase(observer, game);
    }
    return undefined;
  }

  beginFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.intermission.kind !== "playing") return undefined;
    const context = this.context(entity, game), state = context.state, now = game.host.now();
    if (game.options.mode === "deathmatch" && state.requestedSpectator !== state.spectator && now - state.respawnTime >= 5) return this.spectatorRespawn(entity, game);
    if (state.useQ2Weapons && !state.weaponThunk && !state.spectator) this.weapons.tick(entity, game, { ...this.hooks.weaponInput(entity.actor.id), latchedAttack: (state.latchedButtons & 1) !== 0 });
    else state.weaponThunk = false;
    if (state.dead) {
      if (now > state.respawnTime && ((state.latchedButtons & (game.options.mode === "deathmatch" ? 1 : -1)) !== 0 || game.options.mode === "deathmatch" && (game.options.deathmatchFlags & 1024) !== 0)) {
        this.respawn(entity, game); state.latchedButtons = 0;
      }
      return undefined;
    }
    if (game.options.mode !== "deathmatch") this.hooks.emit({ kind: "trail", actor: entity.actor.id, origin: game.body(entity).origin, time: now });
    state.latchedButtons = 0;
    return undefined;
  }

  endFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    const context = this.context(entity, game), state = context.state, now = game.host.now();
    if (this.intermission.kind !== "playing") return this.hooks.emit({ kind: "view", actor: entity.actor.id, view: q2BuildView(context, 0, true) });
    const powers = this.items.playerPowerups(entity.actor.id);
    game.host.combat.setTraits(entity.actor, { invulnerable: state.god || powers.invulnerabilityUntil > now });
    q2WorldEffects(context);
    const body = game.body(entity), vectors = angleVectors(context.movement.viewAngles);
    const side = dot(body.velocity, vectors.right), roll = (side < 0 ? -1 : 1) * Math.min(Math.abs(side) * this.rules.rollAngle / this.rules.rollSpeed, this.rules.rollAngle);
    if (context.movement.animateQ2) game.move(entity, { angles: { x: (context.movement.viewAngles.x > 180 ? context.movement.viewAngles.x - 360 : context.movement.viewAngles.x) / 3, y: context.movement.viewAngles.y, z: roll * 4 } }, false);
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed < 5) { state.bobMove = 0; state.bobTime = 0; }
    else if (context.movement.grounded) state.bobMove = speed > 210 ? 0.25 : speed > 100 ? 0.125 : 0.0625;
    state.bobTime += state.bobMove;
    q2FallingDamage(context);
    const feedback = q2DamageFeedback(context, this.painAnimation); this.painAnimation = feedback.painIndex;
    const view = q2BuildView(context, feedback.flashes, false);
    this.hooks.emit({ kind: "view", actor: entity.actor.id, view });
    const cycle = Math.trunc(context.movement.ducked ? state.bobTime * 4 : state.bobTime);
    if (state.event === "" && context.movement.grounded && speed > 225 && Math.trunc(state.bobTime + state.bobMove) !== cycle) state.event = "q2:footstep";
    if (state.event !== "") { game.host.emit({ kind: "effect", effect: state.event, origin: body.origin, direction: zero, count: 1, color: 0 }); state.event = ""; }
    q2ClientEffects(context); q2ClientAnimation(context);
    if (context.movement.animateQ2) game.show(entity);
    state.oldVelocity = body.velocity; state.oldViewAngles = view.angles;
    const weapon = this.weapons.states.get(entity.actor.id);
    if (weapon !== undefined) { weapon.kickOrigin = zero; weapon.kickAngles = zero; }
    if (state.showScores && (Math.round(now * 10) & 31) === 0) this.scoreboard(entity, game, false);
    return undefined;
  }

  recordDamage(entity: Q2Entity, game: Q2GameServices, decision: DamageDecision): undefined {
    const state = this.states.get(entity.actor.id);
    if (state === undefined) return undefined;
    entity.lastAttack = decision.request.attack;
    if (decision.reaction === "death") return undefined;
    const feedback = decision.feedback;
    state.damageBlood += feedback?.blood ?? decision.appliedDamage;
    state.damageArmor += feedback?.armor ?? 0;
    state.damagePowerArmor += feedback?.powerArmor ?? 0;
    if ((feedback?.powerArmor ?? 0) > 0) state.powerArmorTime = game.host.now() + 0.2;
    state.damageKnockback += feedback?.knockback ?? decision.request.knockback; state.damageFrom = decision.request.point;
    return undefined;
  }

  weaponEvent(event: Q2WeaponEvent): undefined {
    const state = this.states.get(event.actor);
    if (state !== undefined && event.kind === "player-animation") {
      state.animationPriority = event.priority === "attack" ? 4 : event.priority === "pain" ? 3 : 6; state.animationEnd = event.last;
      const entity = this.playerEntities.get(event.actor);
      if (entity !== undefined) entity.frame = event.first;
    }
    return undefined;
  }

  teleportPlayer(entity: Q2Entity, game: Q2GameServices, origin: Vec3, angles: Vec3): undefined {
    const context = this.context(entity, game); context.state.event = "q2:player-teleport";
    this.hooks.setMovement(entity.actor.id, { kind: "teleport", origin, velocity: zero, angles, commandAngles: context.movement.commandAngles, holdMilliseconds: 160, spectator: context.state.spectator });
    return undefined;
  }

  private spectatorRespawn(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state;
    const result = this.connect(game, state.userinfo);
    if (!result.allowed) {
      state.requestedSpectator = state.spectator;
      this.hooks.emit({ kind: "print", target: entity.actor.id, level: "high", text: `${result.reason}\n` });
      return this.hooks.emit({ kind: "stufftext", actor: entity.actor.id, text: `spectator ${state.spectator ? 1 : 0}\n` });
    }
    state.score = 0; this.putInServer(entity, game); state.respawnTime = game.host.now();
    this.hooks.emit({ kind: "print", target: null, level: "high", text: `${state.name} ${state.spectator ? "has moved to the sidelines" : "joined the game"}\n` });
    if (!state.spectator) state.event = "q2:player-teleport";
    return undefined;
  }

  disconnect(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state;
    this.hooks.emit({ kind: "print", target: null, level: "high", text: `${state.name} disconnected\n` });
    for (const tracker of q2EntitiesNamed(game, "pain daemon")) if (tracker.enemy === entity.actor.id) game.remove(tracker);
    this.hooks.disconnect?.(entity, game);
    state.connected = false; entity.visible = false; game.solid(entity, "none"); game.show(entity);
    game.host.emit({ kind: "effect", effect: "q2:logout", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
    this.hooks.emit({ kind: "userinfo", actor: entity.actor.id, slot: state.slot, name: "", skin: "" });
    this.states.delete(entity.actor.id);
    this.playerEntities.delete(entity.actor.id);
    return undefined;
  }

  scoreboard(entity: Q2Entity, game: Q2GameServices, reliable = true): undefined {
    const rows: Q2ScoreRow[] = [...this.states.values()].filter(state => state.connected && !state.spectator).sort((left, right) => right.score - left.score || left.slot - right.slot).slice(0, 12)
      .map(state => ({ slot: state.slot, name: state.name, score: state.score, ping: Math.min(state.ping, 999), minutes: Math.trunc((game.host.now() - state.enteredAt) / 60), spectator: state.spectator }));
    return this.hooks.emit({ kind: "scoreboard", actor: entity.actor.id, rows, killer: entity.enemy, reliable });
  }

  chase(entity: Q2Entity, game: Q2GameServices, direction: 1 | -1, toggle = false): undefined {
    const state = this.context(entity, game).state;
    if (toggle && state.chaseTarget !== null) state.chaseTarget = null;
    else {
      const candidates = [...this.states].filter(([, value]) => value.connected && !value.spectator).sort((left, right) => left[1].slot - right[1].slot);
      const index = candidates.findIndex(([actor]) => actor === state.chaseTarget);
      state.chaseTarget = candidates[(index + direction + candidates.length) % candidates.length]?.[0] ?? null;
    }
    this.hooks.emit({ kind: "chase", actor: entity.actor.id, target: state.chaseTarget });
    if (state.chaseTarget !== null) this.updateChase(entity, game);
    else this.hooks.setMovement(entity.actor.id, { kind: "noclip", enabled: true });
    return undefined;
  }

  updateChase(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state;
    const target = state.chaseTarget === null ? null : game.entity(state.chaseTarget);
    const targetState = target === null ? undefined : this.states.get(target.actor.id);
    if (target === null || targetState === undefined || !targetState.connected || targetState.spectator) {
      if (state.chaseTarget !== null) { state.chaseTarget = null; this.chase(entity, game, 1); }
      return undefined;
    }
    const targetBody = game.body(target), movement = this.hooks.movement(target.actor.id);
    const eye = add(targetBody.origin, { x: 0, y: 0, z: target.viewHeight });
    const forward = angleVectors({ ...movement.viewAngles, x: Math.min(movement.viewAngles.x, 56) }).forward;
    const behind = add(eye, scale(forward, -30));
    const desired = { ...behind, z: Math.max(behind.z, targetBody.origin.z + 20) + (movement.grounded ? 0 : 16) };
    const trace = (start: Vec3, end: Vec3) => game.host.trace({ start, end, bounds: null, ignore: target.actor.id, mask: 3 });
    let goal = add(trace(eye, desired).end, scale(forward, 2));
    const ceiling = trace(goal, add(goal, { x: 0, y: 0, z: 6 }));
    if (ceiling.fraction < 1) goal = add(ceiling.end, { x: 0, y: 0, z: -6 });
    const floor = trace(goal, add(goal, { x: 0, y: 0, z: -6 }));
    if (floor.fraction < 1) goal = add(floor.end, { x: 0, y: 0, z: 6 });
    const angles = targetState.dead ? { x: -15, y: targetState.killerYaw, z: 40 } : movement.viewAngles;
    entity.viewHeight = 0;
    game.move(entity, { origin: goal, velocity: zero });
    this.hooks.setMovement(entity.actor.id, { kind: "freeze", origin: goal, angles });
    return undefined;
  }

  beginIntermission(game: Q2GameServices, map: string, landmark: Q2LandmarkCarry | null = null): undefined {
    if (this.intermission.kind !== "playing") return undefined;
    for (const actor of this.states.keys()) { const entity = game.entity(actor); if (entity !== null && (game.host.combat.read(actor)?.health ?? 0) <= 0) this.putInServer(entity, game); }
    const endUnit = map.includes("*");
    if (endUnit && game.options.mode === "coop") {
      for (const actor of this.states.keys()) {
        const owned = game.host.actors.resolveOwned(actor); if (owned === null) continue;
        for (const entry of game.host.inventory.entries(actor)) if (entry.item.startsWith("q2:key_")) game.host.inventory.configure(owned, { ...entry, count: 0 });
      }
    }
    this.intermission = { kind: "intermission", map, started: game.host.now(), exit: !endUnit && game.options.mode !== "deathmatch", landmark };
    if (this.intermission.exit) return undefined;
    const authored = q2EntitiesNamed(game, "info_player_intermission");
    const spot = authored.length === 0 ? q2EntitiesNamed(game, "info_player_start")[0] ?? q2EntitiesNamed(game, "info_player_deathmatch")[0]
      : authored[(Math.floor(game.host.random() * 4) & 3) % authored.length];
    if (spot === undefined) throw new Error("Q2 intermission has no authored camera or player spawn");
    const camera = game.body(spot);
    for (const [actor, state] of this.states) {
      const entity = game.entity(actor); if (entity === null) continue;
      state.showScores = game.options.mode !== "singleplayer"; state.loopSound = ""; this.clearPowerups(entity, game);
      entity.viewHeight = 0; entity.visible = false; entity.effects = 0; game.solid(entity, "none");
      game.move(entity, { origin: camera.origin, velocity: zero }); game.show(entity);
      this.hooks.setMovement(actor, { kind: "freeze", origin: camera.origin, angles: camera.angles });
      if (state.showScores) this.scoreboard(entity, game);
    }
    return undefined;
  }

  checkRules(game: Q2GameServices): undefined {
    if (this.intermission.kind === "intermission") {
      if (!this.intermission.exit) return undefined;
      const map = this.intermission.map, landmark = this.intermission.landmark;
      if (landmark !== null) for (const actor of this.states.keys()) { const entity = game.entity(actor); if (entity !== null) this.endFrame(entity, game); }
      this.intermission = { kind: "playing" };
      if (landmark === null) for (const actor of this.states.keys()) { const entity = game.entity(actor); if (entity !== null) this.endFrame(entity, game); }
      for (const actor of this.states.keys()) {
        const entity = game.entity(actor); if (entity === null) continue;
        const health = game.host.combat.read(actor)?.health ?? 0;
        if (health > entity.maxHealth) game.host.combat.setHealth(entity.actor, entity.maxHealth);
      }
      game.host.prepareLevelChange(map, landmark, game.counters.serverFlags);
      const unitMap = map.startsWith("*") ? map.slice(1) : map, [destination, spawn] = unitMap.split("$");
      if (destination === undefined || destination === "") throw new Error("Q2 transition has no map destination");
      return game.host.transition({ kind: "campaign-level", campaign: game.options.campaign, map: `q2:${destination}`, spawnPoint: spawn ?? "", gates: [], cause: null });
    }
    if (game.options.mode !== "deathmatch") return undefined;
    let message = "";
    if (this.rules.timeLimitMinutes !== 0 && game.host.now() >= this.rules.timeLimitMinutes * 60) message = "Timelimit hit.\n";
    else if (this.rules.fragLimit !== 0 && [...this.states.values()].some(state => state.connected && state.score >= this.rules.fragLimit)) message = "Fraglimit hit.\n";
    if (message !== "") { this.hooks.emit({ kind: "print", target: null, level: "high", text: message }); this.endDeathmatchLevel(game); }
    return undefined;
  }

  endDeathmatchLevel(game: Q2GameServices): undefined {
    let next = game.options.mapName;
    if ((game.options.deathmatchFlags & 32) === 0) {
      const index = this.rules.mapList.findIndex(map => map.toLowerCase() === game.options.mapName.toLowerCase());
      if (index >= 0) next = this.rules.mapList[(index + 1) % this.rules.mapList.length] ?? next;
      else next = this.rules.nextMap || q2EntitiesNamed(game, "target_changelevel")[0]?.spawn.values.get("map") || next;
    }
    return this.beginIntermission(game, next);
  }
  needPassword(): number { return (this.rules.password !== "" && this.rules.password.toLowerCase() !== "none" ? 1 : 0) | (this.rules.spectatorPassword !== "" && this.rules.spectatorPassword.toLowerCase() !== "none" ? 2 : 0); }
  clientCommand(entity: Q2Entity, game: Q2GameServices, command: string, args: readonly string[]): boolean { return runQ2ClientCommand(this, this.context(entity, game), command, args); }
}
