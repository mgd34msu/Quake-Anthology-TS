import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { AttackProvenance, DamageDecision } from "../../../contracts/gameplay.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2LandmarkCarry } from "../../q2/foundation/host.ts";
import { Q2Foundation } from "../../q2/foundation/runtime.ts";
import { createQ2ItemModule } from "../../q2/foundation/items.ts";
import { createQ2MoverModule } from "../../q2/foundation/movers.ts";
import { createQ2TargetModule } from "../../q2/foundation/targets.ts";
import { createQ2SceneryModule } from "../../q2/foundation/scenery.ts";
import { Q2Monsters } from "../../q2/foundation/monsters/index.ts";
import { Q2Players } from "../../q2/base/player/index.ts";
import type { Q2PlayerAdmission, Q2PlayerHooks } from "../../q2/base/player/index.ts";
import { createQ2BaseEntityModule } from "../../q2/base/entities/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../q2/base/monsters/index.ts";
import { Q2MissionPackEntities, Q2RoguePlayerSpawns, registerQ2MissionPackArmory } from "../../q2/missionpacks/index.ts";
import type { Q2MissionPack } from "../../q2/missionpacks/index.ts";
import { registerQ2MissionPackMonsters } from "../../q2/missionpacks/monsters/index.ts";
import type { Q2MissionPackMonsters } from "../../q2/missionpacks/monsters/index.ts";
import { Q2RereleasePlayers, createQ2RereleaseModule } from "../../q2/rerelease/index.ts";
import type { Q2RereleaseModule } from "../../q2/rerelease/index.ts";
import { registerQ2RereleaseMonsters } from "../../q2/rerelease/monsters/index.ts";
import type { Q2WeaponInput } from "../../q2/foundation/weapons/index.ts";
import type { Q2CompositionOptions } from "./types.ts";
import { setInfoValue } from "../../../core/cvars/info.ts";
import { Q2Ctf } from "../../q2/multiplayer/ctf/index.ts";
import { Q2ProductMatch } from "./match.ts";
import { q2DeathBallRules } from "../../q2/missionpacks/modes/index.ts";
export type * from "./types.ts";
export { captureQ2Product, restoreQ2Product } from "./save.ts";

export type Q2ProductArmory = ReturnType<typeof registerQ2MissionPackArmory>;
export interface Q2ProductExpansion {
  readonly pack: Q2MissionPack;
  readonly entities: Q2MissionPackEntities;
  readonly monsters: Q2MissionPackMonsters;
}
export interface Q2ProductRerelease {
  readonly players: Q2RereleasePlayers;
  readonly entities: Q2RereleaseModule;
  readonly monsters: Q2SpawnModule;
}

/** One source runtime; the session calls player/entity phases from its existing scheduler. */
export class Q2ProductRuntime {
  readonly game: Q2Foundation;
  readonly weapons;
  readonly monsters: Q2Monsters;
  readonly movers;
  readonly items;
  readonly players: Q2Players;
  readonly baseEntities;
  readonly armory: Q2ProductArmory | null;
  readonly expansions: readonly Q2ProductExpansion[];
  readonly rerelease: Q2ProductRerelease | null;
  readonly modules: readonly Q2SpawnModule[];
  readonly match: Q2ProductMatch;
  readonly movementStopSpeed: number | null;
  readonly rogueSpawns: Q2RoguePlayerSpawns | null;
  private readonly activeRules: { deathmatchFlags: number };

  constructor(readonly configuration: Q2CompositionOptions) {
    if (configuration.match !== undefined && configuration.match.kind !== "standard" && configuration.options.mode !== "deathmatch")
      throw new Error("Q2 Tag and DeathBall require deathmatch admission");
    this.weapons = configuration.weapons;
    this.monsters = new Q2Monsters(this.weapons, { dropItem: (actor, game, classname) => { this.items.dropMonster(actor, game, classname); return undefined; }, platformState: actor => {
      const entity = this.game.entity(actor);
      if (entity === null) return null;
      for (const expansion of this.expansions) {
        const phase = expansion.entities.movers?.platformState(entity);
        if (phase !== undefined && phase !== null) return phase.phase;
      }
      return this.baseEntities.platformState(entity)?.phase ?? null;
    } });
    const baseMonsters = registerQ2ClassicBaseMonsters(this.monsters);
    this.movers = createQ2MoverModule({
      pathCorner: (entity, game, other) => this.monsters.touchPathCorner(entity, game, other),
      combatPoint: (entity, game, other) => this.monsters.touchCombatPoint(entity, game, other),
    });
    this.baseEntities = createQ2BaseEntityModule({ ...configuration.entityHooks, movers: this.movers, weapons: this.weapons,
      teleportPlayer: (actor, origin, angles) => {
        const entity = this.game.entity(actor);
        if (entity !== null) this.players.teleportPlayer(entity, this.game, origin, angles);
        return undefined;
      },
      turretDriver: (entity, game) => this.monsters.spawnInfantryDriver(entity, game),
      monsterContext: actor => this.monsters.context(actor),
      resumeMonster: (entity, game) => this.monsters.resumeMonster(entity, game),
    });
    this.items = createQ2ItemModule({ ...configuration.itemHooks,
      ...(configuration.services.randomItems === undefined ? {} : { randomRespawn: (entity: Q2Entity, game: Q2GameServices) => {
        const settings = configuration.services.randomItems?.();
        return settings === undefined ? null : this.armory?.items.randomRespawn(entity, game, settings) ?? null;
      } }),
      weaponPicked: (actor, item, first) => {
        if (this.rerelease !== null) {
          const entity = this.game.entity(actor);
          if (entity !== null) return this.rerelease.players.weaponPicked(entity, this.game, item, first);
        }
        return configuration.itemHooks.weaponPicked(actor, item, first);
      }, ammoPack: (actor, game, full) => {
      configuration.itemHooks.ammoPack?.(actor, game, full);
      if (this.armory !== null) for (const pack of this.packs()) this.armory.items.ammoPack(actor, game, full, pack);
      return undefined;
    } });
    this.armory = configuration.edition === "classic" && configuration.program === "baseq2" ? null : registerQ2MissionPackArmory(
      configuration.program === "xatrix" ? "xatrix" : "rogue", {
        weapons: this.weapons, items: this.items, monster: actor => this.monsters.context(actor),
        hunterCamera: configuration.services.hunterCamera, strongMines: configuration.services.strongMines,
        gravity: () => configuration.services.gravity(),
        intermission: () => this.players.intermission.kind === "intermission",
        playerEffect: event => configuration.services.emit({ kind: "missionpack-player", event }),
      }, configuration.edition);
    const armory = this.armory;
    this.expansions = armory === null ? [] : this.packs().map(pack => ({ pack,
      entities: new Q2MissionPackEntities(pack, { movers: this.movers, weapons: this.weapons, projectiles: armory.projectiles,
        teleportPlayer: (actor, origin, angles) => {
          const entity = this.game.entity(actor);
          if (entity !== null) this.players.teleportPlayer(entity, this.game, origin, angles);
          return undefined;
        },
        targetAnger: (entity, target, game) => {
          const source = this.expansions.find(expansion => expansion.pack === pack);
          if (source === undefined) throw new Error(`Missing Q2 ${pack} source monster registration`);
          return source.monsters.targetAnger(entity, target, game);
        },
        emit: event => configuration.services.emit({ kind: "missionpack-entity", event }),
      }),
      monsters: registerQ2MissionPackMonsters(this.monsters, pack, armory.projectiles, {
        movers: this.movers, gravity: () => configuration.services.gravity(),
        badArea: actor => armory.projectiles.badArea(actor, this.game),
        badAreaEntity: (actor, origin) => armory.projectiles.badAreaEntity(actor, this.game, origin),
        markTeslaArea: (self, tesla) => armory.projectiles.markTeslaArea(self, this.game, tesla),
        powerups: actor => this.powerups(actor),
      }, configuration.edition),
    }));
    this.match = new Q2ProductMatch(configuration.match ?? { kind: "standard" }, () => this.players, this.items, () => this.game, {
      items: this.items, weapons: this.weapons,
      player: actor => this.players.states.get(actor) ?? null,
      setSkin: (actor, skin) => {
        const state = this.players.states.get(actor), entity = this.game.entity(actor);
        if (state === undefined || entity === null) throw new Error("Match skin requires an admitted player");
        return this.players.userinfoChanged(entity, this.game, setInfoValue(state.userinfo, "skin", skin, { dialect: "q2-classic", maximumLength: 512, target: "client-userinfo", serverHighCharacters: false, print: text => configuration.host.diagnostic(text) }));
      },
      spawnPlayer: (entity, game) => this.players.putInServer(entity, game),
      observer: entity => configuration.playerHooks.setMovement(entity.actor.id, { kind: "noclip", enabled: true }),
      teleport: (entity, game, origin, angles, velocity) => {
        this.players.teleportPlayer(entity, game, origin, angles); game.move(entity, { velocity });
        return configuration.playerHooks.setMovement(entity.actor.id, { kind: "teleport", origin, angles, velocity, commandAngles: configuration.playerHooks.movement(entity.actor.id).commandAngles, holdMilliseconds: 160, spectator: false });
      },
      chase: actor => { const entity = this.game.entity(actor); return entity === null ? undefined : this.players.chase(entity, this.game, 1, true); },
      setGrapplePrediction: (actor, suppressed) => configuration.services.emit({ kind: "grapple-prediction", actor, suppressed }),
      gravity: () => configuration.services.gravity(),
      endLevel: (game, map) => map === null ? this.players.endDeathmatchLevel(game) : this.players.beginIntermission(game, map),
      kick: actor => configuration.services.emit({ kind: "kick", actor }),
      setDeathmatchFlags: flags => this.setDeathmatchFlags(flags),
      chatAllowed: (actor, game) => this.players.chatAllowed(actor, game),
    }, configuration.services);
    this.rogueSpawns = configuration.edition === "classic" && configuration.program === "rogue" ? new Q2RoguePlayerSpawns() : null;
    this.movementStopSpeed = configuration.match?.kind === "deathball" ? 0 : null;
    const playerHooks: Q2PlayerHooks = { ...configuration.playerHooks,
      quadFireDropUntil: actor => configuration.edition === "rerelease" && (configuration.services.dropQuadFire?.() ?? true)
        ? this.armory?.items.powerups(actor).quadFireUntil ?? 0 : 0,
      weaponInput: actor => this.weaponInput(actor, configuration.playerHooks.weaponInput(actor)),
      score: (victim, attacker, game, change, means, recipient) => {
        if ((configuration.match === undefined || configuration.match.kind === "standard") && configuration.playerHooks.score !== undefined)
          return configuration.playerHooks.score(victim, attacker, game, change, means, recipient);
        return this.match.score(victim, game, change, means, recipient, attacker);
      },
      playerSpawned: (entity, game) => { this.match.playerSpawned(entity, game); return configuration.playerHooks.playerSpawned?.(entity, game); },
      selectSpawn: (entity, game) => this.match.selectSpawn(entity, game) ?? this.rogueSpawns?.selectSpawn(game) ?? configuration.playerHooks.selectSpawn?.(entity, game) ?? null,
      command: (entity, game, name, args) => this.match.command(entity, game, name, args) || configuration.playerHooks.command?.(entity, game, name, args) === true,
      beforeDeathInventory: (entity, game, attack) => { this.match.dropInventory(entity, game); return configuration.playerHooks.beforeDeathInventory?.(entity, game, attack); },
      death: (entity, game, attack) => {
        this.match.death(entity, game);
        this.armory?.spheres.ownerDied(entity.actor.id, game, attack); this.armory?.items.reset(entity.actor.id);
        return configuration.playerHooks.death?.(entity, game, attack);
      },
      disconnect: (entity, game) => {
        this.match.disconnect(entity, game);
        this.armory?.spheres.disconnect(entity.actor.id, game); this.armory?.items.reset(entity.actor.id);
        return configuration.playerHooks.disconnect?.(entity, game);
      },
    };
    if (configuration.edition === "rerelease") {
      if (armory === null) throw new Error("Rerelease source composition requires the combined arsenal");
      const hooks = { ...configuration.rereleaseHooks,
        monsterHoldsHealthBar: configuration.rereleaseHooks.monsterHoldsHealthBar ?? ((actor: ActorId) => this.game.entity(actor)?.classname === "monster_jorg"),
        clearExpansionPowerups: (actor: ActorId) => {
        armory.items.reset(actor); return configuration.rereleaseHooks.clearExpansionPowerups?.(actor);
      } };
      const players = new Q2RereleasePlayers(this.items, this.weapons, playerHooks, hooks, configuration.rereleaseOptions, configuration.playerRules);
      const entities = createQ2RereleaseModule({ players, hooks, ...(configuration.campaign === undefined ? {} : { campaign: configuration.campaign }) });
      const source = this.expansions.find(expansion => expansion.pack === "rogue")?.monsters.source;
      if (source === undefined) throw new Error("Rerelease source composition requires Rogue monster state");
      const monsters = registerQ2RereleaseMonsters(this.monsters, { source, weapons: armory.projectiles,
        transferHealthbarTarget: (oldActor, newActor, game) => entities.transferHealthbarTarget(oldActor, newActor, game),
        isN64: configuration.program === "n64", expansion: configuration.program === "mg2" ? "mg1" : configuration.program === "xatrix" || configuration.program === "rogue" ? configuration.program : "base" });
      this.players = players; this.rerelease = { players, entities, monsters };
    } else {
      this.players = new Q2Players(this.items, this.weapons, playerHooks, configuration.playerRules);
      this.rerelease = null;
    }
    if (this.match.source instanceof Q2Ctf) {
      const mode = this.match.source, edition = this.rerelease?.entities;
      this.items.setPickupPolicy({
        instancedCoop: game => edition?.instancedCoop(game) ?? false,
        canPickup: (entity, game, actor) => mode.pickupsAllowed() && (edition?.canPickup(entity, game, actor) ?? true),
        beforePickup: (entity, game, actor) => mode.pickupsAllowed() && (edition?.beforePickup(entity, game, actor) ?? true),
        beforeTargets: (entity, game, actor, taken) => edition?.beforeTargets(entity, game, actor, taken),
        afterPickup: (entity, game, actor, taken) => edition?.afterPickup(entity, game, actor, taken),
        keepAfterPickup: (entity, game, actor) => edition?.keepAfterPickup(entity, game, actor) ?? false,
      });
    }
    this.modules = [
      ...(this.rerelease === null ? [] : [this.rerelease.entities]), this.players, this.match,
      ...(this.rogueSpawns === null ? [] : [this.rogueSpawns]),
      ...this.expansions.map(expansion => expansion.entities), this.baseEntities,
      createQ2TargetModule(), this.movers, createQ2SceneryModule(),
      ...(armory === null ? [] : [armory.items]), this.items,
      ...(this.rerelease === null ? [] : [this.rerelease.monsters]), ...this.expansions.map(expansion => expansion.monsters), baseMonsters, this.monsters,
    ];
    const configuredFlags = configuration.services.deathmatchFlags?.read() ?? configuration.options.deathmatchFlags;
    const deathmatchFlags = configuration.match?.kind === "deathball" ? q2DeathBallRules(configuredFlags).deathmatchFlags : configuredFlags;
    const rules = { deathmatchFlags: deathmatchFlags >>> 0 };
    this.activeRules = rules;
    if (deathmatchFlags !== configuredFlags) this.setDeathmatchFlags(deathmatchFlags);
    this.game = new Q2Foundation(configuration.host, { ...configuration.options, edition: configuration.edition, get deathmatchFlags() { return configuration.services.deathmatchFlags?.read() ?? rules.deathmatchFlags; } }, this.modules);
    this.registerCallbacks();
  }

  private packs(): readonly Q2MissionPack[] {
    return this.configuration.edition === "rerelease" ? ["xatrix", "rogue"]
      : this.configuration.program === "baseq2" ? [] : [this.configuration.program];
  }

  setDeathmatchFlags(flags: number): undefined {
    if (this.configuration.services.deathmatchFlags !== undefined) return this.configuration.services.deathmatchFlags.write(flags >>> 0);
    this.activeRules.deathmatchFlags = flags >>> 0; return undefined;
  }

  get originalSourceFallbacks(): readonly string[] {
    return this.rerelease === null ? [] : this.expansions.flatMap(expansion => expansion.monsters.originalSourceFallbacks)
      .filter(classname => classname !== "monster_gladb" && classname !== "monster_boss5");
  }

  registerCallbacks(): undefined {
    for (const module of this.modules) if (module.callbacks !== undefined) this.game.sourceCallbacks.register(module.callbacks);
    this.game.sourceCallbacks.register(this.weapons.callbacks);
    if (this.armory !== null) {
      this.game.sourceCallbacks.register(this.armory.projectiles.callbacks);
      this.game.sourceCallbacks.register(this.armory.spheres.callbacks);
      this.game.sourceCallbacks.register(this.armory.doppleganger.callbacks);
    }
    return undefined;
  }

  admit(actor: OwnedActor, admission: Q2PlayerAdmission, landmark: Q2LandmarkCarry | null = null): Q2Entity {
    const entity = this.game.attachPlayer(actor);
    if (admission.useQ2Weapons !== false) this.weapons.bind(entity, this.game);
    this.players.attach(entity, this.game, admission);
    this.match.admitted(entity, this.game);
    if (!(this.match.source instanceof Q2Ctf)) this.players.putInServer(entity, this.game, false, landmark);
    return entity;
  }

  weaponInput(actor: ActorId, input: Q2WeaponInput): Q2WeaponInput {
    const adjusted = this.armory?.items.input(actor, input) ?? input, entity = this.game.entity(actor);
    return this.match.source instanceof Q2Ctf && entity !== null ? this.match.source.weaponInput(entity, this.game, adjusted) : adjusted;
  }

  powerups(actor: ActorId) {
    if (this.players.states.get(actor)?.useQ2Inventory === false) return this.configuration.services.foreignPowerups(actor);
    const base = this.items.playerPowerups(actor);
    return { quadUntil: base.quadUntil, invulnerabilityUntil: base.invulnerabilityUntil, doubleUntil: this.armory?.items.powerups(actor).doubleUntil ?? 0 };
  }

  recordDamage(entity: Q2Entity, decision: DamageDecision): undefined {
    return this.players.recordDamage(entity, this.game, decision);
  }

  beforeReaction(actor: ActorId, attack: AttackProvenance): undefined { return this.armory?.spheres.ownerDamaged(actor, attack, this.game); }

  movementImpact(actor: ActorId, impactDelta: number, onLadder: boolean): undefined {
    return this.rerelease?.players.movementImpact(actor, impactDelta, onLadder);
  }

  recordForeignWeaponFire(actor: ActorId): undefined { return this.rerelease?.players.recordWeaponFire(actor, this.game.host.now()); }

  afterPlayerFrames(): undefined {
    for (const actor of this.players.states.keys()) {
      const entity = this.game.entity(actor);
      if (entity !== null) this.match.effects(entity, this.game);
    }
    return this.rerelease?.entities.afterPlayerFrames(this.game);
  }

  afterSpawn(): undefined {
    for (const expansion of this.expansions) expansion.monsters.hints?.finalize(this.game);
    return this.match.afterSpawn(this.game);
  }

  checkRules(): undefined {
    if (this.players.intermission.kind === "playing" && this.match.checkRules(this.game)) return undefined;
    return this.players.checkRules(this.game);
  }

}

export function createQ2ProductRuntime(options: Q2CompositionOptions): Q2ProductRuntime { return new Q2ProductRuntime(options); }
