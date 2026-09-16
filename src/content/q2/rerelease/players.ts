import type { DamageDecision, ItemId } from "../../../contracts/gameplay.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { DeathReaction } from "../../../contracts/world.ts";
import { Q2Players, q2Userinfo } from "../base/player/index.ts";
import type { Q2ConnectionResult, Q2PlayerAdmission, Q2PlayerCarry, Q2PlayerContext, Q2PlayerHooks, Q2PlayerRules, Q2PlayerState, Q2PlayerView } from "../base/player/index.ts";
import { add, movedir, scale, zero } from "../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2LandmarkCarry } from "../foundation/host.ts";
import type { Q2ItemModule } from "../foundation/items.ts";
import type { Q2Weapons } from "../foundation/weapons/index.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import { restoreQ2Actor } from "../foundation/checkpoint.ts";
import type { Q2RereleasePlayersCheckpoint } from "./checkpoint.ts";
import { q2RereleaseObituary } from "./obituary.ts";
import { q2RereleaseSpawns, selectQ2RereleaseSpawn } from "./spawns.ts";
import { q2EntitiesNamed } from "../base/player/spawns.ts";
import { placeQ2Landmark } from "../base/player/landmarks.ts";
import { q2RereleaseFallingDamage, q2RereleaseWorldEffects } from "./environment.ts";
import { createQ2RereleaseOptions, Q2RereleasePlayerState, q2IsN64, q2UsesInstancedItems } from "./types.ts";
import type { Q2RereleaseHooks, Q2RereleaseOptions } from "./types.ts";
import { q2RereleaseBuildView, q2RereleaseClientAnimation, q2RereleaseDamageFeedback } from "./view.ts";
import { killQ2RereleaseBox } from "./killbox.ts";

export interface Q2RereleasePlayerExtension {
  admitted(entity: Q2Entity, game: Q2GameServices): undefined;
  endPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined;
  spawned(entity: Q2Entity, game: Q2GameServices): undefined;
  beforeLevelChange(game: Q2GameServices): undefined;
  endOfUnit(game: Q2GameServices): undefined;
  leaveUnit(): undefined;
  beginPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined;
  help(entity: Q2Entity, game: Q2GameServices): undefined;
}

export class Q2RereleasePlayers extends Q2Players {
  readonly rereleaseStates = new Map<ActorId, Q2RereleasePlayerState>();
  readonly rereleaseOptions: Q2RereleaseOptions;
  coopRestartTime = 0;
  deadlyKillBox = false;
  intermissionFlags = 0;
  intermissionFadeUntil: number | null = null;
  intermissionCamera: { readonly origin: Vec3; readonly angles: Vec3 } | null = null;
  intermissionCameraSet = false;
  extension: Q2RereleasePlayerExtension | null = null;
  private readonly squadSpawns = new Map<ActorId, { readonly origin: Vec3; readonly angles: Vec3 }>();
  private readonly selectedSpawns = new Map<ActorId, { readonly origin: Vec3; readonly angles: Vec3; readonly velocity: Vec3; readonly fromLandmark: boolean }>();

  constructor(items: Q2ItemModule, weapons: Q2Weapons, hooks: Q2PlayerHooks, readonly rereleaseHooks: Q2RereleaseHooks, options: Partial<Q2RereleaseOptions> = {}, rules: Partial<Q2PlayerRules> = {}) {
    super(items, weapons, hooks, rules); this.rereleaseOptions = createQ2RereleaseOptions(options);
  }
  override spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    return q2RereleaseSpawns.spawn(entity, game);
  }

  override get callbacks(): Q2CallbackDefinitions { return { ...super.callbacks, ...q2RereleaseSpawns.callbacks }; }

  extra(actor: ActorId): Q2RereleasePlayerState {
    const value = this.rereleaseStates.get(actor);
    if (value === undefined) throw new Error("Q2 rerelease player is not admitted");
    return value;
  }

  override connect(game: Q2GameServices, userinfo: string, isBot = false): Q2ConnectionResult {
    const info = q2Userinfo(userinfo), value = info.get("spectator") ?? "";
    const spectator = game.options.mode === "deathmatch" && value !== "" && value !== "0";
    const password = spectator ? this.rules.spectatorPassword : this.rules.password;
    let reason = "";
    if ((spectator || !isBot) && password !== "" && password !== "none" && password !== info.get(spectator ? "spectator" : "password")) reason = spectator ? "Spectator password required or incorrect." : "Password required or incorrect.";
    else if (spectator && [...this.states.values()].filter(state => state.connected && state.requestedSpectator).length >= this.rules.maxSpectators) reason = "Server spectator limit is full.";
    if (reason === "") return { allowed: true, userinfo };
    const fields = [...info].filter(([key]) => key !== "rejmsg"); fields.push(["rejmsg", reason]);
    return { allowed: false, userinfo: fields.map(([key, value]) => `\\${key}\\${value}`).join(""), reason };
  }

  captureRerelease(): Q2RereleasePlayersCheckpoint {
    return { version: 1, options: { ...this.rereleaseOptions }, coopRestartTime: this.coopRestartTime, deadlyKillBox: this.deadlyKillBox,
      intermissionFlags: this.intermissionFlags, intermissionFadeUntil: this.intermissionFadeUntil, intermissionCamera: this.intermissionCamera === null ? null : structuredClone(this.intermissionCamera), intermissionCameraSet: this.intermissionCameraSet,
      players: [...this.rereleaseStates].map(([actor, state]) => ({ actor: { slot: actor.slot, generation: actor.generation }, state: structuredClone(state) })),
      squadSpawns: [...this.squadSpawns].map(([actor, placement]) => ({ actor: { slot: actor.slot, generation: actor.generation }, ...structuredClone(placement) })) };
  }
  restoreRerelease(game: Q2GameServices, checkpoint: Q2RereleasePlayersCheckpoint): undefined {
    this.rereleaseStates.clear(); this.squadSpawns.clear();
    Object.assign(this.rereleaseOptions, checkpoint.options); this.coopRestartTime = checkpoint.coopRestartTime; this.deadlyKillBox = checkpoint.deadlyKillBox;
    this.intermissionFlags = checkpoint.intermissionFlags; this.intermissionFadeUntil = checkpoint.intermissionFadeUntil;
    this.intermissionCamera = checkpoint.intermissionCamera === null ? null : structuredClone(checkpoint.intermissionCamera); this.intermissionCameraSet = checkpoint.intermissionCameraSet;
    for (const entry of checkpoint.players) {
      const actor = restoreQ2Actor(game, entry.actor).id, state = new Q2RereleasePlayerState(entry.state.seat, entry.state.socialId);
      Object.assign(state, structuredClone(entry.state)); this.rereleaseStates.set(actor, state);
    }
    for (const entry of checkpoint.squadSpawns) this.squadSpawns.set(restoreQ2Actor(game, entry.actor).id, { origin: entry.origin, angles: entry.angles });
    return undefined;
  }

  override attach(entity: Q2Entity, game: Q2GameServices, admission: Q2PlayerAdmission): Q2PlayerState {
    const identity = this.rereleaseHooks.playerIdentity(entity.actor.id), extra = new Q2RereleasePlayerState(identity.seat, identity.socialId);
    extra.lives = game.options.mode === "coop" && this.rereleaseOptions.coopLives ? this.rereleaseOptions.coopNumLives + 1 : 0;
    this.rereleaseStates.set(entity.actor.id, extra);
    const state = super.attach(entity, game, admission);
    if (extra.autoShield >= 0) entity.flags |= 0x40000000;
    const release = game.host.actors.onRelease(actor => { if (actor.id === entity.actor.id) { this.rereleaseStates.delete(actor.id); this.squadSpawns.delete(actor.id); release(); } return undefined; });
    this.extension?.admitted(entity, game);
    state.spawnInventory = game.host.inventory.entries(entity.actor.id); state.coopRespawn = this.saveCarry(entity, game);
    return state;
  }

  override userinfoChanged(entity: Q2Entity, game: Q2GameServices, source: string): undefined {
    const state = this.states.get(entity.actor.id);
    if (state === undefined) throw new Error("Q2 rerelease userinfo requires an admitted player");
    const info = q2Userinfo(source.slice(0, 2047)), name = (info.get("name") ?? "badinfo").slice(0, 31);
    state.userinfo = source.slice(0, 2047); state.skin = info.get("skin") ?? "male/grunt";
    state.requestedSpectator = game.options.mode === "deathmatch" && (info.get("spectator") ?? "") !== "" && info.get("spectator") !== "0";
    state.fov = Math.max(1, Math.min(160, Number.parseInt(info.get("fov") ?? "0", 10) || 0));
    const hand = Math.max(0, Math.min(2, Number.parseInt(info.get("hand") ?? "0", 10) || 0)); state.hand = hand === 1 ? "left" : hand === 2 ? "center" : "right";
    const extra = this.extra(entity.actor.id), autoSwitch = Math.max(0, Math.min(3, Number.parseInt(info.get("autoswitch") ?? "0", 10) || 0));
    extra.bobSkip = info.get("bobskip")?.startsWith("1") ?? false;
    extra.autoSwitch = autoSwitch === 1 ? 1 : autoSwitch === 2 ? 2 : autoSwitch === 3 ? 3 : 0;
    extra.autoShield = info.has("autoshield") ? Number.parseInt(info.get("autoshield") ?? "0", 10) || 0 : -1;
    extra.dogtag = info.get("dogtag") ?? "";
    this.hooks.emit({ kind: "userinfo", actor: entity.actor.id, slot: state.slot, name, skin: state.skin });
    this.rereleaseHooks.emit({ kind: "player-dogtag", actor: entity.actor.id, value: extra.dogtag });
    state.name = (entity.serverFlags & 16) !== 0 ? name : `##P${state.slot}`;
    return undefined;
  }

  weaponPicked(entity: Q2Entity, game: Q2GameServices, item: ItemId, first: boolean): undefined {
    const weapon = this.weapons.registeredDefinitions().find(definition => definition.item === item), state = this.weapons.states.get(entity.actor.id);
    if (weapon === undefined || state === undefined || state.weapon === weapon.name || state.pending === weapon.name) return undefined;
    const ammoWeapon = this.items.lookup(item)?.kind === "ammo", required = ammoWeapon ? 1 : weapon.quantity;
    if (weapon.ammo !== null && game.host.inventory.count(entity.actor.id, weapon.ammo) < required) return undefined;
    const mode = this.extra(entity.actor.id).autoSwitch;
    if (mode === 3 || mode === 2 && ammoWeapon || mode === 0 && state.weapon !== "blaster" && (game.options.mode === "deathmatch" || !first)) return undefined;
    state.pending = weapon.name;
    return undefined;
  }

  protected override obituary(entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction): undefined {
    const cause = entity.lastAttack?.cause, state = this.context(entity, game).state;
    const attacker = reaction.attacker === null ? null : this.states.get(reaction.attacker) ?? null;
    const obituary = q2RereleaseObituary(state, attacker, cause?.kind === "q2" ? cause.meansOfDeath : 0, game.options.mode, cause?.kind === "q2" && cause.native?.edition === "rerelease" && cause.native.noPointLoss,
      (recipient, change) => this.applyScore(entity, game, reaction, recipient, change));
    return this.rereleaseHooks.emit({ kind: "localized-print", actor: null, level: "medium", ...obituary });
  }
  protected override clearDeathInventory(entity: Q2Entity, game: Q2GameServices): undefined {
    return game.options.mode === "coop" && !q2UsesInstancedItems(this.rereleaseOptions) ? super.clearDeathInventory(entity, game) : undefined;
  }
  override canDropCoopStayItems(game: Q2GameServices): boolean { return game.options.mode === "coop" && q2UsesInstancedItems(this.rereleaseOptions); }
  override death(entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction): undefined {
    const cause = entity.lastAttack?.cause, means = cause?.kind === "q2" ? cause.meansOfDeath & ~0x8000000 : 0;
    entity.model2 = ""; entity.model3 = ""; entity.sound = ""; this.context(entity, game).state.loopSound = "";
    if (means === 51) { game.host.combat.setHealth(entity.actor, -100); return super.death(entity, game, { ...reaction, damage: 400 }); }
    if (means === 47 && (game.host.combat.read(entity.actor.id)?.health ?? 0) < -80) entity.flags |= 0x10000;
    return super.death(entity, game, reaction);
  }

  override recordDamage(entity: Q2Entity, game: Q2GameServices, decision: DamageDecision): undefined {
    super.recordDamage(entity, game, decision);
    if (decision.feedback?.kind === "q2" && decision.reaction !== "death") this.extra(entity.actor.id).lastDamageUntil = game.host.now() + 2;
    return undefined;
  }
  override saveCarry(entity: Q2Entity, game: Q2GameServices): Q2PlayerCarry {
    const carry = super.saveCarry(entity, game);
    return { ...carry, flags: entity.flags & (16 | 32 | 4096 | 0x400000 | 0x40000000) };
  }
  override restoreCarry(entity: Q2Entity, game: Q2GameServices, carry: Q2PlayerCarry): undefined {
    super.restoreCarry(entity, game, carry);
    if (carry.health <= 0) {
      const state = this.context(entity, game).state;
      for (const entry of game.host.inventory.entries(entity.actor.id)) game.host.inventory.configure(entity.actor, { ...entry, count: 0 });
      if (state.useQ2Inventory) this.items.configurePlayer(entity.actor, game, true);
      else for (const entry of state.spawnInventory) game.host.inventory.configure(entity.actor, entry);
      game.host.combat.setHealth(entity.actor, 100); game.host.combat.setArmor(entity.actor, { kind: "none" });
      entity.maxHealth = 100; entity.flags &= ~(16 | 32 | 4096 | 0x400000 | 0x40000000); entity.powerCubes = 0;
      state.god = false; state.notarget = false; state.selectedItem = state.useQ2Inventory ? "q2:weapon_blaster" : null;
      game.host.combat.setTraits(entity.actor, { invulnerable: false });
      const weapon = this.weapons.states.get(entity.actor.id);
      if (weapon !== undefined) { weapon.weapon = "blaster"; weapon.pending = null; }
      this.extension?.spawned(entity, game);
      state.coopRespawn = this.saveCarry(entity, game);
    }
    this.extra(entity.actor.id).flashlight = (carry.flags & 0x400000) !== 0;
    return undefined;
  }

  override recordDeath(entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction): boolean {
    const carry = this.saveCarry(entity, game), state = this.context(entity, game).state;
    const first = super.recordDeath(entity, game, reaction), options = this.rereleaseOptions;
    this.extra(entity.actor.id).invisibilityUntil = 0;
    if (!first) return false;
    const extra = this.extra(entity.actor.id);
    extra.animationTime = 0;
    if (game.options.mode === "deathmatch" && options.deathmatchForceRespawnTime !== 0) state.respawnTime = game.host.now() + options.deathmatchForceRespawnTime;
    if (game.options.mode === "coop" && q2UsesInstancedItems(options)) {
      state.coopRespawn = { ...carry, health: entity.maxHealth, maximumHealth: entity.maxHealth };
    }
    if (game.options.mode === "coop" && (options.coopSquadRespawn || options.coopLives)) {
      if (options.coopLives && extra.lives !== 0) extra.lives--;
      const allDead = game.host.players().every(actor => (game.host.combat.read(actor)?.health ?? 0) <= 0 && (this.deadlyKillBox || !options.coopLives || (this.rereleaseStates.get(actor)?.lives ?? 0) <= 0));
      if (allDead) {
        this.coopRestartTime = game.host.now() + 5;
        for (const actor of game.host.players()) game.host.emit({ kind: "centerprint", actor, text: "$g_coop_lose" });
      } else state.respawnTime = game.host.now() + 3;
    }
    return true;
  }

  override afterClientThink(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.intermission.kind === "intermission" && (this.intermission.map === "" || q2IsN64(game) && game.options.mode !== "deathmatch" && !this.intermissionCameraSet)) {
      const state = this.context(entity, game).state;
      state.buttons = this.hooks.movement(entity.actor.id).buttons;
      return undefined;
    }
    super.afterClientThink(entity, game);
    if (this.intermission.kind !== "playing") return undefined;
    const context = this.context(entity, game), extra = this.extra(entity.actor.id);
    return q2RereleaseFallingDamage(context, extra, this.rereleaseOptions, game.host.frameSeconds());
  }

  /** Foreign weapon providers report actual shots to the selected campaign's squad rules. */
  recordWeaponFire(actor: ActorId, now: number): undefined { this.extra(actor).lastFiringUntil = now + 2.5; return undefined; }
  revealInvisibility(actor: ActorId, until: number): undefined { this.extra(actor).invisibilityFadeUntil = until; return undefined; }

  /** Pass the actual selected movement provider's impact result before afterClientThink. */
  movementImpact(actor: ActorId, impactDelta: number, onLadder: boolean): undefined {
    const extra = this.extra(actor); extra.impactDelta = impactDelta; extra.onLadder = onLadder; return undefined;
  }

  override beginFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.intermission.kind !== "playing") return undefined;
    const now = game.host.now();
    if (this.extra(entity.actor.id).awaitingRespawn) {
      if (Math.round(now * 1000) % 500 === 0) this.putInServer(entity, game);
      return undefined;
    }
    return super.beginFrame(entity, game);
  }

  protected override deadFrame(context: Q2PlayerContext): undefined {
    const { entity, game, state } = context, options = this.rereleaseOptions;
    if (game.host.now() <= state.respawnTime || this.coopRestartTime !== 0) return undefined;
    if (game.options.mode === "coop" && (options.coopSquadRespawn || options.coopLives)) return this.coopRespawn(entity, game);
    if ((state.latchedButtons & (game.options.mode === "deathmatch" ? 1 : -1)) !== 0 || game.options.mode === "deathmatch" && options.deathmatchForceRespawn) {
      this.respawn(entity, game); state.latchedButtons = 0;
    }
    return undefined;
  }

  override beginIntermission(game: Q2GameServices, map: string, landmark: Q2LandmarkCarry | null = null): undefined {
    return this.beginRereleaseIntermission(game, map, landmark, 0);
  }

  beginRereleaseIntermission(game: Q2GameServices, map: string, landmark: Q2LandmarkCarry | null, flags: number): undefined {
    if (this.intermission.kind !== "playing") return undefined;
    this.intermissionFlags = flags; this.intermissionFadeUntil = null;
    this.intermission = { kind: "intermission", map, landmark, started: game.host.now(), exit: false };
    for (const [actor, state] of this.states) {
      const entity = game.entity(actor);
      if (entity === null || !state.connected || (game.host.combat.read(actor)?.health ?? 0) > 0) continue;
      if (q2UsesInstancedItems(this.rereleaseOptions) && state.coopRespawn !== null) state.coopRespawn = { ...state.coopRespawn, health: entity.maxHealth, maximumHealth: entity.maxHealth };
      this.respawn(entity, game);
    }
    this.extension?.beforeLevelChange(game);
    const endUnit = map.includes("*");
    if (endUnit) {
      if (game.options.mode === "coop") for (const [actor, state] of this.states) {
        const entity = game.entity(actor);
        if (entity === null || !state.connected) continue;
        for (const item of this.items.list()) if (item.kind === "key") {
          const entry = game.host.inventory.entries(actor).find(value => value.item === item.id);
          if (entry !== undefined) game.host.inventory.configure(entity.actor, { ...entry, count: 0 });
        }
      }
      const achievement = q2EntitiesNamed(game, "worldspawn")[0]?.spawn.values.get("achievement");
      if (achievement !== undefined && achievement !== "") this.rereleaseHooks.emit({ kind: "achievement", id: achievement });
      if ((flags & 16) === 0) this.extension?.endOfUnit(game);
      else if ((flags & 64) !== 0 && game.options.mode !== "deathmatch") { this.intermission = { ...this.intermission, exit: true }; return undefined; }
    } else if (game.options.mode !== "deathmatch") { this.intermission = { ...this.intermission, exit: true }; return undefined; }
    if (!this.intermissionCameraSet || this.intermissionCamera === null) {
      const authored = q2EntitiesNamed(game, "info_player_intermission");
      const selection = authored.length === 0 ? 0 : game.host.rereleaseRandom?.integer(4) ?? Math.floor(game.host.random() * 4);
      const spot = authored.length === 0 ? q2EntitiesNamed(game, "info_player_start")[0] ?? q2EntitiesNamed(game, "info_player_deathmatch")[0] : authored[selection % authored.length];
      if (spot === undefined) throw new Error("Q2 rerelease intermission has no camera or player spawn");
      const body = game.body(spot); this.intermissionCamera = { origin: body.origin, angles: body.angles };
    }
    return this.moveToCamera(game, this.intermissionCamera.origin, this.intermissionCamera.angles, true);
  }

  override checkRules(game: Q2GameServices): undefined {
    if (this.intermission.kind === "intermission" && this.intermission.map === "") return undefined;
    if (this.intermission.kind === "intermission" && this.intermission.exit) {
      if ((this.intermissionFlags & 32) !== 0) {
        if (this.intermissionFadeUntil === null) this.intermissionFadeUntil = game.host.now() + 1.3;
        if (game.host.now() < this.intermissionFadeUntil) return undefined;
        this.intermissionFlags &= ~32; this.intermissionFadeUntil = null;
      }
    }
    if (this.coopRestartTime !== 0 && game.host.now() >= this.coopRestartTime) {
      this.coopRestartTime = 0;
      return this.rereleaseHooks.emit({ kind: "restart-level", map: game.options.mapName });
    }
    return super.checkRules(game);
  }

  protected override beforeExitLevel(game: Q2GameServices, map: string): undefined {
    if ((this.intermissionFlags & 8) !== 0) {
      this.intermissionFlags &= ~8;
      for (const [actor, state] of this.states) {
        const entity = game.entity(actor); if (entity === null) continue;
        for (const entry of game.host.inventory.entries(actor)) game.host.inventory.configure(entity.actor, { ...entry, count: 0 });
        game.host.combat.setHealth(entity.actor, 0); game.host.combat.setArmor(entity.actor, { kind: "none" });
        this.items.clearPowerups(actor); this.rereleaseHooks.clearExpansionPowerups?.(actor);
        entity.flags &= ~(16 | 32 | 4096 | 0x400000 | 0x40000000); entity.powerCubes = 0;
        state.god = false; state.notarget = false; state.coopRespawn = null; state.selectedItem = null;
      }
    }
    if (map.includes("*")) this.extension?.leaveUnit();
    return undefined;
  }

  fadeFrame(game: Q2GameServices): undefined {
    const until = this.intermissionFadeUntil;
    if (until === null) return undefined;
    if (game.host.now() >= until) return this.checkRules(game);
    const alpha = Math.max(0, Math.min(1, 1 - (until - game.host.now() - 0.3)));
    for (const [actor, state] of this.states) if (state.connected) this.rereleaseHooks.emit({ kind: "screen-blend", actor, blend: { x: 0, y: 0, z: 0, w: alpha } });
    return undefined;
  }

  moveToCamera(game: Q2GameServices, origin: Vec3, angles: Vec3, entering: boolean): undefined {
    this.intermissionCamera = { origin, angles };
    for (const [actor, state] of this.states) {
      const entity = game.entity(actor);
      if (entity === null) continue;
      if (entering && (game.host.combat.read(actor)?.health ?? 0) <= 0) this.respawn(entity, game);
      if (entering) game.host.emit({ kind: "entity-event", actor, event: 7 });
      state.showHelp = false; state.showScores = game.options.mode === "deathmatch"; state.damageAlpha = 0; state.bonusAlpha = 0; state.loopSound = "";
      this.items.clearPowerups(actor); this.rereleaseHooks.clearExpansionPowerups?.(actor);
      this.extra(actor).invisibilityUntil = 0;
      game.host.combat.setTraits(entity.actor, { invulnerable: state.god });
      const weapon = this.weapons.states.get(actor);
      if (weapon !== undefined) { weapon.grenadeBlewUp = false; weapon.grenadeTime = 0; weapon.viewModel = null; }
      entity.viewHeight = 0; entity.model = ""; entity.model2 = ""; entity.model3 = ""; entity.effects = 0; entity.sound = ""; entity.visible = false;
      game.solid(entity, "none"); game.motion(entity, "stationary"); game.move(entity, { origin }); game.show(entity);
      this.hooks.setMovement(actor, { kind: "freeze", origin, angles });
      if (state.showScores) this.scoreboard(entity, game);
    }
    return undefined;
  }

  finishCamera(game: Q2GameServices): undefined {
    const current = this.intermission;
    this.intermission = current.kind === "playing" ? { kind: "intermission", map: "", started: game.host.now(), exit: false, landmark: null }
      : { ...current, started: game.host.now(), exit: current.map !== "" && !current.map.includes("*") };
    return undefined;
  }

  emitFlashlight(actor: ActorId, game: Q2GameServices): undefined {
    const state = this.states.get(actor);
    if (state === undefined) throw new Error("Flashlight player is not admitted");
    return this.rereleaseHooks.emit({ kind: "flashlight", actor, hand: state.hand,
      enabled: this.extra(actor).flashlight && this.intermission.kind === "playing" && (game.host.combat.read(actor)?.health ?? 0) > 0 });
  }

  override endFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    this.extension?.beginPlayerFrame(entity, game);
    super.endFrame(entity, game);
    this.extension?.endPlayerFrame(entity, game);
    const extra = this.extra(entity.actor.id), now = game.host.now();
    const alpha = this.intermission.kind === "playing" && (game.host.combat.read(entity.actor.id)?.health ?? 0) > 0 && extra.invisibilityUntil > now
      ? Math.max(0.1, Math.min(1, (extra.invisibilityFadeUntil - now) / 2)) : 1;
    this.rereleaseHooks.emit({ kind: "alpha", actor: entity.actor.id, alpha });
    this.emitFlashlight(entity.actor.id, game);
    if (this.intermission.kind === "playing" && game.options.mode === "coop" && this.rereleaseOptions.coopPlayerCollision && (entity.clipMask & 0x40000000) === 0 && game.host.combat.read(entity.actor.id)?.canTakeDamage) {
      const body = game.body(entity), trace = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, mask: 0x40000000 });
      if (!trace.startSolid && !trace.allSolid) { entity.clipMask |= 0x40000000; this.rereleaseHooks.playerCollision?.(entity.actor.id, true); }
    }
    return undefined;
  }

  override clientCommand(entity: Q2Entity, game: Q2GameServices, command: string, args: readonly string[]): boolean {
    if (command.toLowerCase() === "help" && game.options.mode !== "deathmatch" && this.extension !== null) { this.extension.help(entity, game); return true; }
    return super.clientCommand(entity, game, command, args);
  }

  override putInServer(entity: Q2Entity, game: Q2GameServices, restoreLoadout = true, landmark: Q2LandmarkCarry | null = null): undefined {
    const context = this.context(entity, game), extra = this.extra(entity.actor.id);
    const modeSpawn = this.hooks.selectSpawn?.(entity, game);
    if (modeSpawn !== undefined && modeSpawn !== null) this.squadSpawns.set(entity.actor.id, modeSpawn);
    if (landmark !== null) extra.pendingLandmark = { name: landmark.name, relativeOrigin: landmark.relativeOrigin, relativeVelocity: landmark.relativeVelocity, relativeViewAngles: landmark.relativeViewAngles };
    const carry = extra.pendingLandmark === null ? null : { ...extra.pendingLandmark, player: entity.actor.id };
    if (!this.squadSpawns.has(entity.actor.id)) {
      const spot = selectQ2RereleaseSpawn(game, entity, context.movement.standingBounds, this.rereleaseOptions, this.rules.spawnPoint, extra.awaitingRespawn && game.host.now() > extra.respawnTimeout);
      if (spot === null && game.options.mode !== "singleplayer") {
        if (!extra.awaitingRespawn) extra.respawnTimeout = game.host.now() + 3;
        extra.awaitingRespawn = true; extra.spawned = false;
        const points = q2EntitiesNamed(game, "info_player_intermission"), camera = points.length === 0 ? q2EntitiesNamed(game, "info_player_start")[0] ?? q2EntitiesNamed(game, "info_player_deathmatch")[0] : points[Math.floor(game.host.random() * 4) % points.length];
        const body = camera === undefined ? { origin: zero, angles: zero } : game.body(camera);
        context.state.dead = false; context.state.noclip = true; entity.visible = false; entity.serverFlags |= 1;
        game.move(entity, { origin: body.origin, velocity: zero }); game.solid(entity, "none");
        this.hooks.setMovement(entity.actor.id, { kind: "freeze", origin: body.origin, angles: body.angles });
        game.host.emit({ kind: "visibility", actor: entity.actor.id, visible: false }); return game.link(entity);
      }
      const placed = spot === null || carry === null ? null : placeQ2Landmark(entity, game, carry, spot, context.movement.standingBounds);
      const origin = placed?.origin ?? (spot === null ? zero : game.body(spot).origin), angles = placed?.angles ?? (spot === null ? zero : game.body(spot).angles);
      this.selectedSpawns.set(entity.actor.id, { origin: add(origin, { x: 0, y: 0, z: game.options.mode === "deathmatch" ? 10 : 1 }),
        angles: { ...angles, x: angles.x / 3 }, velocity: placed?.velocity ?? zero, fromLandmark: placed !== null });
    }
    const wasWaiting = extra.awaitingRespawn;
    extra.awaitingRespawn = false; extra.respawnTimeout = 0; extra.pendingLandmark = null;
    entity.clipMask = game.options.mode === "coop" && !this.rereleaseOptions.coopPlayerCollision ? 0x2010003 : 0x42010003;
    super.putInServer(entity, game, restoreLoadout, carry);
    this.rereleaseHooks.playerCollision?.(entity.actor.id, (entity.clipMask & 0x40000000) !== 0);
    extra.slimeDebounce = 0; extra.animationTime = 0; extra.slowViewAngles = zero; extra.coopRespawnState = "none";
    extra.invisibilityUntil = 0; extra.invisibilityFadeUntil = 0;
    this.extension?.spawned(entity, game);
    if (game.options.mapName.toLowerCase() === "rboss" && game.options.mode !== "deathmatch" && context.state.useQ2Inventory) game.host.inventory.configure(entity.actor, { item: "q2:key_nuke", count: 1, capacity: 1 });
    if (wasWaiting) this.postRespawn(entity, game);
    return undefined;
  }

  private postRespawn(entity: Q2Entity, game: Q2GameServices): undefined {
    if ((entity.serverFlags & 1) !== 0) return undefined;
    const state = this.context(entity, game).state, body = game.body(entity), movement = this.hooks.movement(entity.actor.id);
    this.hooks.setMovement(entity.actor.id, { kind: "spawn", origin: body.origin, velocity: body.velocity, angles: movement.viewAngles, commandAngles: movement.commandAngles, holdMilliseconds: 112, spectator: state.spectator });
    state.event = "q2:player-teleport"; state.respawnTime = game.host.now(); return undefined;
  }
  override respawn(entity: Q2Entity, game: Q2GameServices): undefined {
    if (game.options.mode === "singleplayer") return this.hooks.emit({ kind: "load-menu", actor: entity.actor.id });
    if (!this.context(entity, game).state.spectator) this.copyToBodyQueue(entity, game);
    entity.serverFlags &= ~1; this.putInServer(entity, game); return this.postRespawn(entity, game);
  }

  protected override killBox(entity: Q2Entity, game: Q2GameServices): boolean {
    return killQ2RereleaseBox(entity, game, this, true, true);
  }

  private coopRespawn(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context(entity, game).state, extra = this.extra(entity.actor.id), options = this.rereleaseOptions;
    let allowed = true;
    if (options.coopLives && extra.lives === 0) { extra.coopRespawnState = "no-lives"; allowed = false; }
    else if (options.coopSquadRespawn && game.host.players().some(actor => (game.host.combat.read(actor)?.health ?? 0) > 0)) {
      const target = this.squadTarget(game);
      if (target === null) allowed = false;
      else this.squadSpawns.set(entity.actor.id, target);
    }
    if (allowed) {
      extra.coopRespawnState = "none"; state.spectator = false; state.requestedSpectator = false;
      this.respawn(entity, game); state.latchedButtons = 0;
    } else {
      if (extra.coopRespawnState === "none") extra.coopRespawnState = "waiting";
      if (!state.spectator) {
        this.copyToBodyQueue(entity, game); state.spectator = true; state.noclip = true;
        game.solid(entity, "none"); game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
        entity.visible = false; game.host.emit({ kind: "visibility", actor: entity.actor.id, visible: false });
        state.damageAlpha = 0; state.bonusAlpha = 0;
        this.hooks.setMovement(entity.actor.id, { kind: "noclip", enabled: true });
        game.link(entity); this.chase(entity, game, 1);
      }
    }
    return this.rereleaseHooks.emit({ kind: "coop-respawn", actor: entity.actor.id, state: extra.coopRespawnState, lives: extra.lives });
  }

  private squadTarget(game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 } | null {
    const searching = this.rereleaseHooks.monstersSearching(null), now = game.host.now();
    for (const actor of game.host.players()) {
      const entity = game.entity(actor), state = this.states.get(actor), extra = this.rereleaseStates.get(actor);
      if (entity === null || state === undefined || extra === undefined || state.dead) continue;
      const firingUntil = this.weapons.states.get(actor)?.lastFiringTime ?? extra.lastFiringUntil;
      if (extra.lastDamageUntil >= now || this.rereleaseHooks.monstersSearching(actor) || searching && firingUntil >= now) { extra.coopRespawnState = "in-combat"; continue; }
      if (!this.rereleaseHooks.groundedOnWorld(actor) || this.hooks.movement(actor).waterLevel >= 3) { extra.coopRespawnState = "bad-area"; continue; }
      const origin = this.findRespawnSpot(entity, game);
      if (origin === null) { extra.coopRespawnState = "blocked"; continue; }
      return { origin, angles: { ...game.body(entity).angles, z: 0 } };
    }
    return null;
  }

  findRespawnSpot(player: Q2Entity, game: Q2GameServices): Vec3 | null {
    const body = game.body(player), bounds = this.hooks.movement(player.actor.id).standingBounds, mask = 0x201001b;
    const trace = (start: Vec3, end: Vec3, point = false) => game.host.trace({ start, end, bounds: point ? null : bounds, ignore: player.actor.id, mask });
    const first = trace(body.origin, body.origin);
    if (first.startSolid || first.allSolid) return null;
    for (const yaw of [0, 90, 45, -45, -90]) {
      const up = trace(body.origin, add(body.origin, { x: 0, y: 0, z: 128 }));
      if (up.startSolid || up.allSolid || (game.host.pointContents(up.end) & 24) !== 0) continue;
      const back = trace(up.end, add(up.end, scale(movedir({ x: 0, y: body.angles.y + 180 + yaw, z: 0 }), 128)));
      if (back.startSolid || back.allSolid || (game.host.pointContents(back.end) & 24) !== 0) continue;
      const floor = trace(back.end, add(back.end, { x: 0, y: 0, z: -512 }));
      if (floor.startSolid || floor.allSolid || floor.fraction === 1 || floor.hit.kind !== "world" || (game.host.pointContents(floor.end) & 24) !== 0) continue;
      if ((game.host.pointContents(add(floor.end, { x: 0, y: 0, z: 22 })) & 56) !== 0 || floor.contact.kind === "none" || floor.contact.plane.normal.z < 0.7) continue;
      const height = Math.abs(body.origin.z - floor.end.z);
      if (height > 72) continue;
      if (height > 18 && (trace(body.origin, floor.end, true).fraction !== 1 || trace(add(body.origin, { x: 0, y: 0, z: 22 }), add(floor.end, { x: 0, y: 0, z: 22 }), true).fraction !== 1)) continue;
      return floor.end;
    }
    return null;
  }

  protected override spawnPlacement(entity: Q2Entity, game: Q2GameServices, landmark: Q2LandmarkCarry | null): { readonly origin: Vec3; readonly angles: Vec3; readonly velocity: Vec3; readonly fromLandmark: boolean } {
    const squad = this.squadSpawns.get(entity.actor.id);
    if (squad === undefined) {
      const selected = this.selectedSpawns.get(entity.actor.id);
      if (selected !== undefined) { this.selectedSpawns.delete(entity.actor.id); return selected; }
      return super.spawnPlacement(entity, game, landmark);
    }
    this.squadSpawns.delete(entity.actor.id);
    return { ...squad, velocity: zero, fromLandmark: false };
  }

  protected override worldEffects(context: Q2PlayerContext): undefined { return q2RereleaseWorldEffects(context, this.extra(context.entity.actor.id)); }
  protected override fallingDamage(_context: Q2PlayerContext): undefined { return undefined; }
  protected override damageFeedback(context: Q2PlayerContext, painIndex: number): { readonly flashes: number; readonly painIndex: number } { return q2RereleaseDamageFeedback(context, this.extra(context.entity.actor.id), painIndex); }
  protected override buildView(context: Q2PlayerContext, flashes: number, intermission: boolean): Q2PlayerView {
    const view = q2RereleaseBuildView(context, this.extra(context.entity.actor.id), flashes, intermission);
    return this.intermissionFadeUntil === null ? view : { ...view, blend: { x: 0, y: 0, z: 0, w: Math.max(0, Math.min(1, 1 - (this.intermissionFadeUntil - context.game.host.now() - 0.3))) } };
  }
  protected override updateBob(context: Q2PlayerContext): undefined {
    const body = context.game.body(context.entity), speed = Math.hypot(body.velocity.x, body.velocity.y), state = context.state;
    if (speed < 5) { state.bobMove = 0; state.bobTime = 0; }
    else if (context.movement.grounded) state.bobMove = context.game.host.frameSeconds() / (speed > 210 ? 0.4 : speed > 100 ? 0.8 : 1.6);
    state.bobTime += state.bobMove; return undefined;
  }
  protected override clientAnimation(context: Q2PlayerContext): undefined {
    return q2RereleaseClientAnimation(context, this.extra(context.entity.actor.id));
  }
}
