import { SaveReader, encodeCheckpointValue } from "../../../../persistence/value.ts";

import { savedActorId } from "../../../../persistence/save-image.ts";
import { captureQ3Graph, prepareQ3Graph, restoreQ3Graph } from "../../../../content/q3/base/game/save-state.ts";
import { readQ3Graph, readQ3Actor } from "../../../../content/q3/base/game/save-reader.ts";
import { captureQ3Level, restoreQ3Level } from "../../../../content/q3/base/game/save-level.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { stepQ3Holdable } from "../../../../movement/q3/weapon.ts";
import { q3AdmitTargetDamage } from "../../../../content/q3/base/game/combat.ts";
import type { UseParticipant } from "../../../../content/q3/base/game/state.ts";
import type { UseParticipantServices } from "../../../../content/q3/base/game/use-participant.ts";
import { EntityState } from "../../../../content/q3/base/shared/entity-state.ts";
/* Source game composition from id Software g_main.c; W73 owns time and actor traversal. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { ActorCommand } from "../../../../contracts/session.ts";
import type { DamageDecision } from "../../../../contracts/gameplay.ts";
import type { FrameContext } from "../../../../contracts/time.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { Q3EntityRecords } from "../../../../content/q3/base/records.ts";
import { Q3WorldAdapter } from "../../../../content/q3/base/world-adapter.ts";
import { Q3CombatBridge } from "../../../../content/q3/base/combat-bridge.ts";
import { Q3GameSettings } from "../../../../content/q3/base/settings.ts";
import { GameLevel } from "../../../../content/q3/base/game/level.ts";
import { findQ3EntityTeams } from "../../../../content/q3/base/map-spawns.ts";
import { EntityEvent, EntityType, GameType, Team, MoveType, statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { findItem, itemAt } from "../../../../content/q3/base/shared/items.ts";
import type { Q3SourceHost, Q3SourceOptions, Q3SourceBots, Q3SourceSessionCarry } from "./types.ts";
import { q3SourcePresentationState, q3SourceModels } from "./presentation.ts";
import { ArenaRuntime } from "../../../../content/q3/team-arena/arenas.ts";
import { ClientAdmissionRuntime, clientInfoValue } from "../../../../content/q3/team-arena/client-admission.ts";
import { clientEndFrame } from "../../../../content/q3/team-arena/client-effects.ts";
import type { ClientEffectsContext } from "../../../../content/q3/team-arena/client-effects.ts";
import { clientEvents } from "../../../../content/q3/team-arena/client-events.ts";
import { clientInactivityTimer, clientIntermissionThink, spectatorClientEndFrame, spectatorThink } from "../../../../content/q3/team-arena/client-policy.ts";
import type { ClientPolicyContext } from "../../../../content/q3/team-arena/client-policy.ts";
import { ClientSpawnRuntime, ClientSpawnState, spawnDeathmatchPoint, spawnPlayerStart } from "../../../../content/q3/team-arena/client-spawn.ts";
import { ClientThinkRuntime } from "../../../../content/q3/team-arena/client-think.ts";
import { GameCommandRuntime } from "../../../../content/q3/team-arena/commands.ts";
import { DeathRuntime } from "../../../../content/q3/base/game/death.ts";
import { EntityPool, runThink } from "../../../../content/q3/base/game/entities.ts";
import { gameFormat } from "../../../../content/q3/base/game/format.ts";
import { ItemRegistry, bindItemSaveCallbacks, respawnItem, spawnItem, touchItem, observeQ3Supply } from "../../../../content/q3/base/game/item-lifecycle.ts";
import type { ItemLifecycleContext } from "../../../../content/q3/base/game/item-lifecycle.ts";
import { bindLaunchSaveCallbacks, runItem } from "../../../../content/q3/base/game/item-motion.ts";
import type { DropItemContext } from "../../../../content/q3/base/game/item-motion.ts";
import { MatchModuleState, MatchRuntime } from "../../../../content/q3/team-arena/match.ts";
import { GameMemory } from "../../../../content/q3/base/game/memory.ts";
import { killBox } from "../../../../content/q3/base/game/misc.ts";
import { miscSpawnHandlers } from "../../../../content/q3/base/game/misc-spawn.ts";
import { MissileRuntime } from "../../../../content/q3/base/game/missile.ts";
import { MoverRuntime } from "../../../../content/q3/base/game/mover.ts";
import { MoverSpawnRuntime } from "../../../../content/q3/base/game/mover-spawn.ts";
import { gameAtoi, GameRandom } from "../../../../content/q3/base/game/numeric.ts";
import { PersonalPortalRuntime } from "../../../../content/q3/base/game/personal-portal.ts";
import { GameSessionManager } from "../../../../content/q3/team-arena/session.ts";
import { GameServerCommandRuntime, GameServerCommandState } from "../../../../content/q3/team-arena/server-commands.ts";
import type { SessionWorldState } from "../../../../content/q3/team-arena/session.ts";
import { ShaderRemapRegistry } from "../../../../content/q3/base/game/shader-remaps.ts";
import { SpawnVariables, spawnEntities } from "../../../../content/q3/base/game/spawn.ts";
import type { SpawnHandler, SpawnReport } from "../../../../content/q3/base/game/spawn.ts";
import { ConnectionState, GameFlags, MAX_CLIENTS, MAX_GENTITIES } from "../../../../content/q3/base/game/state.ts";
import type { GameEntity } from "../../../../content/q3/base/game/state.ts";
import { TargetLocationState, targetSpawnHandlers } from "../../../../content/q3/base/game/targets.ts";
import { spawnTeamPoint, TeamRuntime } from "../../../../content/q3/team-arena/team.ts";
import { triggerSpawnHandlers } from "../../../../content/q3/base/game/triggers.ts";
import { ConfigStringRegistry, findEntity, useTargets } from "../../../../content/q3/base/game/utilities.ts";
import type { TargetUseContext } from "../../../../content/q3/base/game/utilities.ts";
import { invulnerabilityEffect, logAccuracyHit, WeaponRuntime } from "../../../../content/q3/base/game/weapon.ts";

export class Q3ClientAdmissionDenied extends Error {}

export class Q3SourceRuntime {
  readonly level = new GameLevel();
  readonly locations = new TargetLocationState();
  readonly random = new GameRandom();
  readonly clientSpawns = new ClientSpawnState();
  readonly matchState = new MatchModuleState();
  readonly remaps;
  readonly settings;
  readonly records: Q3EntityRecords;
  readonly world;
  readonly pool: EntityPool;
  readonly memory;
  readonly config;
  readonly registeredItems;
  readonly bridge;
  readonly combat;
  readonly missiles;
  readonly weapons;
  readonly itemLifecycle: ItemLifecycleContext;
  readonly drops: DropItemContext;
  readonly team;
  readonly death;
  readonly think;
  readonly spawns;
  readonly session;
  readonly match;
  readonly arenas;
  readonly movers;
  readonly moverSpawns;
  readonly personalPortal;
  readonly admission;
  readonly commands;
  readonly serverCommands;
  private loaded = false;
  private readonly unobserve: () => undefined;
  private retired = false;
  private loadedGameType: number | null = null;
  private mapReport: SpawnReport | null = null;
  private readonly publishedEvents = new Map<OwnedActor, { readonly event: number; readonly time: number }>();

  constructor(readonly options: Q3SourceOptions, readonly host: Q3SourceHost,
    private readonly mode: { readonly kind: "new" } | { readonly kind: "restore"; readonly state: unknown } = { kind: "new" }) {
    const runtime = this;
    if (mode.kind === "new" && options.sessionCarry !== undefined) {
      host.cvars.set("session", options.sessionCarry.world, true);
      for (const client of options.sessionCarry.clients) {
        if (client.slot < 0 || client.slot >= options.maxClients) continue;
        host.cvars.set(`session${client.slot}`, client.session, true);
        host.engine.setUserinfo(client.slot, client.userinfo);
      }
    }
    this.remaps = new ShaderRemapRegistry(text => host.engine.print(text));
    this.settings = new Q3GameSettings({ cvars: host.cvars, sendServerCommand: host.engine.sendServerCommand, remapTeams: () => this.remapTeams() }, options.product);
    if (mode.kind === "new") {
      host.cvars.set("sv_maxclients", String(options.maxClients), true);
      this.settings.register(options.buildDate);
    } else {
      const reader = this.nativeSaveReader(mode.state);
      host.serverState.restoreSaveState(reader.field("server").value);
      this.settings.restoreSaveState(reader.field("settings").value);
    }
    this.random.reset(options.seed);
    this.unobserve = host.actors.onRelease(actor => { this.publishedEvents.delete(actor); return undefined; });
    this.records = new Q3EntityRecords({ actors: host.actors, bodies: host.bodies, callbacks: host.callbacks,
      combat: host.combat, inventory: host.inventory, schedule: host.schedule, runThink: host.runThink,
      admitDamage: (entity, request): "continue" | "handled" => q3AdmitTargetDamage(this.combat, entity,
        request.attack.inflictor === null ? this.pool.at(1022) : this.records.useParticipant(request.attack.inflictor),
        request.attack.attacker === null ? this.pool.at(1022) : this.records.useParticipant(request.attack.attacker)),
      damageCall: () => this.bridge.currentCall, foreign: host.foreign, isPlayer: host.isPlayer }, options.recipe.map.entities.provider, options.product);
    this.world = new Q3WorldAdapter({ queries: host.scene, bodies: host.bodies, collision: host.collision,
      curves: () => host.cvars.variableValue("cm_noCurves") === 0, playerCurveClip: () => host.cvars.variableValue("cm_playerCurveClip") !== 0 }, this.records);
    this.pool = new EntityPool({ records: this.records, product: options.product, maxClients: options.maxClients,
      get mapStartTime() { return runtime.level.startTime; }, time: () => this.level.time,
      print: host.engine.print, link: entity => this.world.link(entity), unlink: entity => this.world.unlink(entity.slot) });
    this.memory = new GameMemory(() => this.integer("g_debugAlloc"), host.engine.print);
    this.config = new ConfigStringRegistry(host.configstrings);
    this.registeredItems = new ItemRegistry(options.product);
    this.bridge = this.createCombatBridge();
    this.combat = this.bridge.context;
    const combat = this.combat;
    const behavior = options.weaponBehavior === undefined ? {} : { weaponBehavior: options.weaponBehavior };
    this.missiles = new MissileRuntime(combat.product === "baseq3"
      ? { ...behavior, combat, world: this.world, bodies: host.bodies, actors: host.actors, get previousTime() { return runtime.level.previousTime; }, missionpack: null }
      : { ...behavior, combat, world: this.world, bodies: host.bodies, actors: host.actors, get previousTime() { return runtime.level.previousTime; }, missionpack: {
        get proxMineTimeout() { return runtime.integer("g_proxMineTimeout"); }, random: this.random,
        soundIndex: path => this.config.soundIndex(path), invulnerabilityImpact: (target, direction, point) => invulnerabilityEffect(this.pool, target, direction, point) } });
    this.weapons = new WeaponRuntime({ missiles: this.missiles, random: this.random, unlink: actor => this.world.unlinkActor(actor), get quadFactor() { return runtime.number("g_quadfactor"); } });
    const itemCallbacks: NonNullable<ItemLifecycleContext["callbacks"]> = {
      touch: this.pool.callbacks.touch.register("q3.item.touch", (entity, other, contact) => { touchItem(entity, other, contact, this.itemLifecycle); }),
      respawn: this.pool.callbacks.think.register("q3.item.respawn", entity => { respawnItem(entity, this.itemLifecycle); }),
    };
    this.itemLifecycle = { callbacks: itemCallbacks, ...(host.originalPickups === undefined ? {} : { originalPickups: host.originalPickups }), previewPickup: item => host.previewPickup?.(item) ?? { kind: "native" }, admitPickup: item => host.admitPickup?.(item) ?? { kind: "native" }, entities: this.pool, world: this.world, product: options.product,
      get gameType() { return runtime.gameType; }, get weaponRespawnSeconds() { return runtime.integer("g_weaponrespawn"); },
      get teamWeaponRespawnSeconds() { return runtime.integer("g_weaponTeamRespawn"); }, handicapForClient: number => this.userinfo(number, "handicap"),
      teamPickup: (item, player) => this.team.pickupTeam(item, player), useTargets: (item, player) => useTargets(this.targets(), item, player),
      soundIndex: path => this.config.soundIndex(path), random: this.random, registry: this.registeredItems,
      log: text => this.log(text), warn: host.engine.print };
    this.drops = { entities: this.pool, product: options.product, get gameType() { return runtime.gameType; }, get time() { return runtime.level.time; },
      touchItem: itemCallbacks.touch,
      droppedFlagThink: this.pool.callbacks.think.register("q3.item.droppedFlag", entity => this.team.droppedFlagThink(entity)), checkDroppedTeamItem: entity => this.team.checkDroppedItem(entity), random: () => this.random.random() };
    bindItemSaveCallbacks(this.itemLifecycle);
    bindLaunchSaveCallbacks(this.drops);
    this.team = this.createTeam();
    this.death = this.createDeath();
    this.think = new ClientThinkRuntime({ pool: this.pool, world: this.world, spatial: this.world,
      touches: { native: actor => this.records.nativeByActor(actor),
        isTrigger: actor => host.scene.spatial.get(actor)?.collision.role === "trigger",
        touch: (self, other) => { const actor = host.actors.resolveOwned(self);
          if (actor !== null) host.callbacks.touch({ self: actor, other, plane: null, surface: null }); return undefined; } },
      moveClient: (entity, command, options) => this.host.moveClient(entity, command, options),
      effects: { combat: this.combat }, frame: () => this.level,
      settings: () => ({ synchronousClients: this.integer("g_synchronousClients") !== 0, pmoveFixed: this.integer("pmove_fixed") !== 0,
        debugMove: this.integer("g_debugMove"),
        pmoveMsec: this.integer("pmove_msec"), gravity: this.number("g_gravity"), speed: this.number("g_speed"), dmflags: this.integer("dmflags"),
        smoothClients: this.integer("g_smoothClients") !== 0, forceRespawnSeconds: this.integer("g_forcerespawn"), singlePlayer: this.singlePlayerActive() }),
      setPmoveMsec: value => this.setCvar("pmove_msec", String(value)), intermissionThink: clientIntermissionThink,
      spectatorThink: (entity, command) => spectatorThink(this.policy(), entity, command), checkInactivity: client => clientInactivityTimer(this.policy(), client),
      freeHook: hook => this.missiles.hookFree(hook), checkGauntletAttack: entity => host.primaryAttackAllowed?.(entity.actor.id) !== false && this.weapons.checkGauntletAttack(entity),
      clientEvents: (entity, oldSequence) => this.runClientEvents(entity, oldSequence), respawn: entity => this.spawns.respawn(entity),
      appendConsoleCommand: host.engine.appendConsoleCommand, isDoorTrigger: entity => this.moverSpawns.isDoorTrigger(entity),
      botTestAas: origin => { if (host.bots.kind === "available") host.bots.testAas(origin); } });
    this.spawns = new ClientSpawnRuntime({ pool: this.pool, world: this.world, random: this.random, think: this.think,
      isPlayer: actor => this.combat.actors.isPlayer(actor),
      frame: () => ({ time: this.level.time, gameType: this.gameType, inactivitySeconds: this.integer("g_inactivity"), intermissionTime: this.level.intermissionTime }),
      userCommand: host.engine.getUserCommand, handicap: number => this.userinfo(number, "handicap"),
      findIntermissionPoint: () => this.match.findIntermissionPoint(), moveToIntermission: entity => this.match.moveClientToIntermission(entity),
      selectedPlayer: (entity, pose) => host.spawnPlayer(entity, pose),
      killBox: entity => killBox(this.combat, entity), playerDie: this.death.playerDie, bodyDie: this.death.bodyDie,
      effects: () => this.effects(), targets: () => this.targets() }, this.clientSpawns);
    this.session = new GameSessionManager(this.sessionState(), { cvars: { get: name => this.engineCvar(name), set: (name, value) => this.setCvar(name, value) },
      print: host.engine.print, broadcastTeamChange: (number, oldTeam) => this.commands.broadcastTeamChange(number, oldTeam) });
    this.match = this.createMatch();
    this.arenas = new ArenaRuntime({ match: this.match, world: this.world, cvars: host.cvars, config: this.config });
    this.movers = new MoverRuntime(combat.product === "baseq3"
      ? { combat, ...this.moverServices(), get previousTime() { return runtime.level.previousTime; }, missionpack: null }
      : { combat, ...this.moverServices(), get previousTime() { return runtime.level.previousTime; }, missionpack: { explodeMissile: entity => this.missiles.explode(entity) } });
    this.moverSpawns = new MoverSpawnRuntime({ movers: this.movers, gravity: () => this.number("g_gravity"),
      setBrushModel: (entity, name) => this.setBrushModel(entity, name),
      remapShader: (oldName, newName, time) => this.remapShader(oldName, newName, time), warn: host.engine.print });
    this.personalPortal = this.createPersonalPortal();

    this.admission = this.createAdmission(host.bots);
    this.commands = this.createCommands(this.admission);
    this.serverCommands = new GameServerCommandRuntime(this.pool, host.cvars, {
      readVmCvar: name => this.snapshot(name), print: host.engine.print,
      sendServerCommand: host.engine.sendServerCommand, executeConsoleNow: host.engine.executeConsoleNow,
      setTeam: (entity, request) => this.commands.setTeam(entity, request),
      bots: host.bots.kind === "unavailable" ? host.bots : { kind: "available", run: argv => { if (host.bots.kind === "available") host.bots.consoleCommand(argv); } },
      memory: { kind: "available", run: () => this.memory.status() },
      podium: { kind: "available", run: () => this.arenas.abortPodium() },
    }, new GameServerCommandState());
    if (mode.kind === "restore") {
      const reader = this.nativeSaveReader(mode.state);
      prepareQ3Graph(this.records, readQ3Graph(reader.field("graph").value), host.actors);
      this.spawnHandlers();
    }
  }

  private nativeSaveReader(value: unknown): SaveReader {
    const reader = new SaveReader(value, "q3.native");
    reader.field("schema").literal("q3:native"); reader.field("version").literal(1);
    reader.field("product").literal(this.options.product);
    reader.field("entityText").literal(this.options.entities);
    return reader;
  }

  captureNativeState() {
    if (!this.loaded || this.mapReport === null) throw new Error("Q3 native save requires a loaded source");
    if (this.host.callbacks.current !== null) throw new Error("Cannot save Q3 during an actor callback");
    return { schema: "q3:native", version: 1, product: this.options.product, entityText: this.options.entities,
      server: this.host.serverState.captureSaveState(), graph: captureQ3Graph(this.records, this.pool), level: captureQ3Level(this.level), random: this.random.seed,
      locations: this.locations.captureSaveState(), spawns: this.spawns.captureSaveState(), match: this.match.captureSaveState(),
      remaps: this.remaps.captureSaveState(), settings: this.settings.captureSaveState(), memory: this.memory.captureSaveState(),
      registeredItems: this.registeredItems.captureSaveState(), bridge: this.bridge.captureSaveState(), missiles: this.missiles.captureSaveState(),
      team: this.team.captureSaveState(), arenas: this.arenas.captureSaveState(), personalPortal: this.personalPortal?.captureSaveState() ?? null,
      serverCommands: this.serverCommands.captureSaveState(),
      publishedEvents: [...this.publishedEvents].map(([actor, event]) => ({ actor: savedActorId(actor.id), event: event.event, time: event.time })),
      report: { worldVariables: this.mapReport.worldVariables.entries.map(pair => ({ ...pair })),
        outcomes: this.mapReport.outcomes.map(outcome => outcome.kind === "dispatched"
          ? { kind: outcome.kind, route: outcome.route, slot: outcome.slot, classname: outcome.classname }
          : { ...outcome }) } };
  }

  captureNativeBytes(): Uint8Array { return encodeCheckpointValue(this.captureNativeState()); }

  finishNativeRestore(): void {
    if (this.loaded || this.mode.kind !== "restore") throw new Error("Q3 native hydration requires a prepared restore source");
    const reader = this.nativeSaveReader(this.mode.state);
    restoreQ3Level(this.level, reader.field("level").value);
    this.random.reset(reader.field("random").integer());
    restoreQ3Graph(this.records, this.pool, readQ3Graph(reader.field("graph").value), this.host.actors);
    this.locations.restoreSaveState(reader.field("locations").value, this.pool);
    this.spawns.restoreSaveState(reader.field("spawns").value); this.match.restoreSaveState(reader.field("match").value);
    this.remaps.restoreSaveState(reader.field("remaps").value); this.memory.restoreSaveState(reader.field("memory").value);
    this.registeredItems.restoreSaveState(reader.field("registeredItems").value); this.bridge.restoreSaveState(reader.field("bridge").value);
    this.missiles.restoreSaveState(reader.field("missiles").value, actor => this.host.actors.referenceSaved(actor));
    this.team.restoreSaveState(reader.field("team").value); this.arenas.restoreSaveState(reader.field("arenas").value);
    if (this.personalPortal === null) reader.field("personalPortal").nullable(entry => entry.fail("baseq3 has no personal portal state"));
    else this.personalPortal.restoreSaveState(reader.field("personalPortal").value);
    this.serverCommands.restoreSaveState(reader.field("serverCommands").value);
    this.publishedEvents.clear();
    for (const entry of reader.field("publishedEvents").list(entry => ({ actor: readQ3Actor(entry.field("actor")), event: entry.field("event").number(), time: entry.field("time").number() }))) {
      const actor = this.host.actors.resolveSaved(entry.actor);
      if (actor === null || this.publishedEvents.has(actor)) return reader.fail("Invalid published Q3 event actor");
      this.publishedEvents.set(actor, { event: entry.event, time: entry.time });
    }
    const report = reader.field("report");
    this.mapReport = { worldVariables: new SpawnVariables(report.field("worldVariables").list(pair => ({ key: pair.field("key").string(), value: pair.field("value").string() }))),
      outcomes: report.field("outcomes").list(entry => {
        const kind = entry.field("kind").choice("dispatched", "filtered", "unknown"), slot = entry.field("slot").integer(0);
        if (kind === "dispatched") return { kind, route: entry.field("route").choice("item", "handler"), entity: this.pool.at(slot), slot, classname: entry.field("classname").string() };
        if (kind === "filtered") return { kind, slot, reason: entry.field("reason").choice("notsingle", "notteam", "notfree", "notta", "notq3a", "gametype") };
        return { kind, slot, classname: entry.field("classname").nullable(value => value.string()) };
      }) };
    this.loaded = true; this.loadedGameType = this.gameType;
  }

  get gameType(): number { return this.integer("g_gametype"); }
  sourceState() { return q3SourcePresentationState(this); }
  presentations() { return q3SourceModels(this); }
  get spawnReport(): SpawnReport { if (this.mapReport === null) throw new Error("Q3 map not loaded"); return this.mapReport; }
  private snapshot(name: string) { return this.settings.snapshot(name); }
  private integer(name: string): number { return this.settings.integer(name); }
  private number(name: string): number { return this.settings.number(name); }
  private string(name: string): string { return this.settings.string(name); }
  private engineCvar(name: string): string { return this.host.cvars.variableString(name); }
  private setCvar(name: string, value: string): void { this.host.cvars.set(name, value, true); }
  private userinfo(client: number, key: string): string { return clientInfoValue(this.host.engine.getUserinfo(client), key); }
  private singlePlayerActive(): boolean { return this.options.product === "missionpack" && this.integer("ui_singlePlayerActive") !== 0; }
  private log(text: string): void { this.host.engine.log(text); }

  private createCombatBridge(): Q3CombatBridge {
    const host = this.host, recipe = this.options.recipe;
    const services = { authority: host.combat, entities: this.pool, records: this.records, world: this.world,
      weaponProvider: this.options.weaponProvider.provider, combatProvider: recipe.combat.provider,
      inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider,
      armorContext: host.armorContext, time: () => this.level.time, intermissionQueued: () => this.level.intermissionQueued,
      gameType: () => this.gameType, friendlyFire: () => this.integer("g_friendlyFire") !== 0,
      knockback: () => this.number("g_knockback"), debugDamage: null,
      checkHurtCarrier: (target: GameEntity, attacker: GameEntity) => this.team.checkHurtCarrier(target, attacker),
      logAccuracyHit: (target: GameEntity, attacker: GameEntity) => logAccuracyHit(this.gameType, target, attacker) };
    return new Q3CombatBridge(this.options.product === "baseq3" ? { ...services, product: "baseq3" } : {
      ...services, product: "missionpack", projectileParent: actor => this.missiles.ownerOf(actor), checkObeliskAttack: (target, attacker) => this.team.checkObeliskAttack(target, attacker),
      invulnerabilityEffect: (target, direction, point) => { invulnerabilityEffect(this.pool, target, direction, point); } });
  }
  private createTeam(): TeamRuntime {
    const runtime = this;
    const services = { pool: this.pool, world: this.world, teamScores: this.level.teamScores,
      sortedClients: this.level.sortedClients,
      sendServerCommand: this.host.engine.sendServerCommand, setConfigstring: (index: number, value: string) => this.host.configstrings.set(index, value),
      warn: this.host.engine.print, addScore: (entity: GameEntity, origin: Vec3, score: number) => this.death.addScore(entity, origin, score),
      calculateRanks: () => this.match.calculateRanks(), respawnItem: (item: GameEntity) => respawnItem(item, this.itemLifecycle),
      inPVS: (first: Vec3, second: Vec3) => this.inPVS(first, second) };
    return new TeamRuntime(this.options.product === "baseq3" ? { ...services, product: "baseq3",
      get time() { return runtime.level.time; }, get gameType() { return runtime.gameType; }, get locationHead() { return runtime.locations.head; } }
      : { ...services, product: "missionpack", get time() { return runtime.level.time; }, get gameType() { return runtime.gameType; },
        get locationHead() { return runtime.locations.head; }, obelisk: {
          get health() { return runtime.integer("g_obeliskHealth"); }, get regenPeriodSeconds() { return runtime.integer("g_obeliskRegenPeriod"); },
          get regenAmount() { return runtime.integer("g_obeliskRegenAmount"); }, get respawnDelaySeconds() { return runtime.integer("g_obeliskRespawnDelay"); } } });
  }

  private createDeath(): DeathRuntime {
    const characterDeath: "selected" = "selected";
    const services = { characterDeath, deathAnimations: this.host.deathAnimations, pool: this.pool, world: this.world, random: this.random, teamScores: this.level.teamScores, missiles: this.missiles, items: this.drops,
      frame: () => ({ time: this.level.time, gameType: this.gameType, warmupTime: this.level.warmupTime,
        intermissionTime: this.level.intermissionTime, blood: this.integer("com_blood") !== 0 }),
      calculateRanks: () => this.match.calculateRanks(), sendScoreboard: (entity: GameEntity) => this.commands.scoreboard(entity),
      log: (text: string) => this.log(text), teamFragBonuses: (victim: GameEntity, attacker: GameEntity | null) => this.team.fragBonuses(victim, attacker),
      returnFlag: (team: Team) => this.team.returnFlag(team) };
    return new DeathRuntime(this.options.product === "baseq3" ? { ...services, product: "baseq3" }
      : { ...services, product: "missionpack", neutralObelisk: () => this.team.neutralObelisk,
        cubeTimeoutSeconds: () => this.integer("g_cubeTimeout"), startKamikaze: timer => { this.weapons.startKamikaze(timer); } });
  }

  private createMatch(): MatchRuntime {
    const services = { state: this.level, pool: this.pool, teamScores: this.level.teamScores, random: this.random, spawn: this.spawns,
      settings: () => ({ gameType: this.gameType, timeLimit: this.integer("timelimit"), fragLimit: this.integer("fraglimit"), captureLimit: this.integer("capturelimit"),
        warmupSeconds: this.integer("g_warmup"), warmupModificationCount: this.snapshot("g_warmup").modificationCount,
        password: this.string("g_password"), passwordModificationCount: this.snapshot("g_password").modificationCount }),
      setTeam: (entity: GameEntity, team: "f" | "s") => this.commands.setTeam(entity, team), stopFollowing: (entity: GameEntity) => this.commands.stopFollowing(entity),
      sendScoreboard: (entity: GameEntity) => this.commands.scoreboard(entity), clientUserinfoChanged: (number: number) => this.admission.userinfoChanged(number),
      writeSessionData: () => this.session.writeWorld(), appendConsoleCommand: this.host.engine.appendConsoleCommand,
      sendServerCommand: this.host.engine.sendServerCommand, setConfigstring: (index: number, value: string) => this.host.configstrings.set(index, value),
      setCvar: (name: string, value: string) => this.setCvar(name, value), log: (text: string) => this.log(text), warn: this.host.engine.print,
      botInterbreedEndMatch: () => { if (this.host.bots.kind === "available") this.host.bots.interbreedEndMatch(); },
      updateTournamentInfo: () => this.arenas.updateTournamentInfo() };
    return new MatchRuntime(this.options.product === "baseq3" ? { ...services, product: "baseq3", spawnModelsOnVictoryPads: () => this.arenas.spawnModelsOnVictoryPads() }
      : { ...services, product: "missionpack", singlePlayer: () => this.singlePlayerActive() }, this.matchState);
  }

  private sessionState(): SessionWorldState {
    const runtime = this;
    return { clients: this.pool.clients, get maxClients() { return runtime.pool.maxClients; }, teamScores: this.level.teamScores,
      get gameType() { return runtime.gameType; }, get teamAutoJoin() { return runtime.integer("g_teamAutoJoin") !== 0; },
      get maxGameClients() { return runtime.integer("g_maxGameClients"); }, get time() { return runtime.level.time; },
      get numNonSpectatorClients() { return runtime.level.numNonSpectatorClients; },
      get newSession() { return runtime.level.newSession; }, set newSession(value) { runtime.level.newSession = value; } };
  }

  private policy(): ClientPolicyContext {
    return { pool: this.pool, world: this.world, time: this.level.time, inactivitySeconds: this.integer("g_inactivity"),
      moveClient: (entity, command, options) => this.host.moveClient(entity, command, options),
      follow1: this.level.follow1, follow2: this.level.follow2, touchTriggers: entity => this.think.touchTriggers(entity),
      followCycle: (entity, direction) => this.commands.followCycle(entity, direction), clientBegin: number => this.admission.begin(number),
      dropClient: this.host.engine.dropClient, sendServerCommand: this.host.engine.sendServerCommand };
  }
  private effects(): ClientEffectsContext {
    return { combat: this.combat, intermissionTime: this.level.intermissionTime, smoothClients: this.integer("g_smoothClients") !== 0,
      frySound: this.level.frySound, randomInt: () => this.random.rand(), soundIndex: path => this.config.soundIndex(path),
      sound: (entity, _channel, sound) => { this.pool.tempEntity(entity.r.currentOrigin, EntityEvent.EV_GENERAL_SOUND).s.eventParm = sound; },
      spectatorEndFrame: entity => spectatorClientEndFrame(this.policy(), entity) };
  }
  private moverServices() {
    return { world: this.world, spatial: this.world, actors: { ...this.host.moverActors, native: (actor: ActorId) => this.records.nativeByActor(actor), participant: (actor: ActorId) => this.records.damageInflictor(actor) }, config: this.config, useTargets: (entity: GameEntity, activator: UseParticipant) => useTargets(this.targets(), entity, activator),
      adjustAreaPortalState: (entity: GameEntity, open: boolean) => this.adjustAreaPortalState(entity, open),
      returnDroppedFlag: (entity: GameEntity) => this.team.freeEntity(entity) };
  }
  private inPVS(first: Vec3, second: Vec3): boolean {
    const collision = this.host.scene, a = collision.pointLeaf(first), b = collision.pointLeaf(second);
    return collision.clusterVisible(collision.leafCluster(a), collision.leafCluster(b), "pvs") && collision.areasConnected(collision.leafArea(a), collision.leafArea(b));
  }
  private setBrushModel(entity: GameEntity, name: string | null): void {
    if (name === null || !name.startsWith("*")) throw new Error(`SV_SetBrushModel: ${name} is not a brush model`);
    const index = gameAtoi(name.slice(1));
    entity.s.modelindex = index;
    const bounds = this.host.scene.modelBounds(index);
    entity.r.mins = { ...bounds.min }; entity.r.maxs = { ...bounds.max };
    entity.r.model = { kind: "inline", index }; entity.r.contents = -1;
    this.world.link(entity);
  }
  private createPersonalPortal(): PersonalPortalRuntime | null {
    const combat = this.combat;
    return combat.product === "baseq3" ? null : new PersonalPortalRuntime({ combat, world: this.world, models: this.config, random: this.random, items: this.drops });
  }
  observeSupply(pickup: ActorId, recipient: ActorId): ReturnType<typeof observeQ3Supply> {
    const entity = this.records.nativeByActor(pickup), player = this.records.nativeByActor(recipient);
    return entity === null || player === null ? null : observeQ3Supply(entity, player, this.itemLifecycle);
  }
  quadDamageFactor(): number { return this.number("g_quadfactor"); }

  /** True blocks the selected primary for this command, including source movement preconditions. */
  stepHoldable(actor: ActorId, pressed: boolean): boolean {
    const entity = this.records.nativeByActor(actor), client = entity?.client;
    if (entity === null || client == null) return true;
    const ps = client.ps, schema = statSchema(ps.product);
    if ((ps.pmFlags & MoveFlags.RESPAWNED) !== 0 || ps.pmType === MoveType.PM_SPECTATOR || entity.health <= 0) return true;
    const item = ps.stats.get(schema.holdableItem);
    const state = { pmFlags: ps.pmFlags, holdableItem: item, holdableTag: itemAt(ps.product, item).tag,
      health: entity.health, maxHealth: ps.stats.get(schema.maxHealth) };
    const consumed = stepQ3Holdable(state, pressed, event => ps.addEvent(event));
    ps.pmFlags = state.pmFlags; ps.stats.set(schema.holdableItem, state.holdableItem);
    return consumed;
  }

  private runClientEvents(entity: GameEntity, oldSequence: number): void {
    const combat = this.combat, runtime = this;
    const services = { primaryAttackAllowed: (actor: ActorId) => this.host.primaryAttackAllowed?.(actor) !== false, world: this.world, weapons: this.weapons, spawns: this.spawns, drops: this.drops, get dmflags() { return runtime.integer("dmflags"); } };
    if (combat.product === "baseq3") clientEvents({ ...services, product: "baseq3", combat }, entity, oldSequence);
    else {
      const personalPortal = this.personalPortal;
      if (personalPortal === null) throw new Error("Missionpack portal runtime is missing");
      clientEvents({ ...services, product: "missionpack", combat, personalPortal }, entity, oldSequence);
    }
  }
  private createCommands(admission: ClientAdmissionRuntime): GameCommandRuntime {
    const runtime = this;
    return new GameCommandRuntime({ pool: this.pool, state: this.level, teamScores: this.level.teamScores,
      grantSelectedArsenal: (actor, category) => this.host.grantSelectedArsenal?.(actor, category) ?? false,
      giveSelectedItem: (actor, args) => this.host.giveSelectedItem?.(actor, args) ?? false,
      get settings() { return { gameType: runtime.gameType, cheats: runtime.integer("sv_cheats") !== 0,
        teamForceBalance: runtime.integer("g_teamForceBalance") !== 0, maxGameClients: runtime.integer("g_maxGameClients"),
        dedicated: runtime.integer("dedicated") !== 0, allowVote: runtime.integer("g_allowVote") !== 0 }; },
      imports: { sendServerCommand: this.host.engine.sendServerCommand, setConfigstring: (index, text) => this.host.configstrings.set(index, text),
        appendConsoleCommand: this.host.engine.appendConsoleCommand, getCvar: name => this.engineCvar(name),
        getUserinfo: this.host.engine.getUserinfo, setUserinfo: this.host.engine.setUserinfo, log: text => this.log(text), print: this.host.engine.print },
      team: this.team, death: this.death, spawn: this.spawns, admission, match: this.match, items: this.itemLifecycle,
      teleport: { combat: this.combat, world: this.world } });
  }
  private createAdmission(bots: Q3SourceBots): ClientAdmissionRuntime {
    return new ClientAdmissionRuntime({ product: this.options.product, pool: this.pool, world: this.world, state: this.level,
      teamScores: this.level.teamScores, session: this.session, spawn: this.spawns, death: this.death, match: this.match,
      commands: { broadcastTeamChange: (number, oldTeam) => this.commands.broadcastTeamChange(number, oldTeam), stopFollowing: entity => this.commands.stopFollowing(entity) },
      bots, settings: () => ({ gameType: this.gameType, password: this.string("g_password") }),
      getUserinfo: this.host.engine.getUserinfo, setConfigstring: (index, value) => this.host.configstrings.set(index, value),
      sendServerCommand: this.host.engine.sendServerCommand, log: text => this.log(text), filterPacket: address => this.serverCommands.filterPacket(address) });
  }

  private spawnHandlers(): ReadonlyMap<string, SpawnHandler> {
    const shared = { entities: this.pool, world: this.world, random: this.random, combat: () => this.combat, participants: this.useParticipants(),
      gravity: () => this.number("g_gravity"), soundIndex: (path: string) => this.config.soundIndex(path),
      remapShader: (oldName: string, newName: string, time: number) => this.remapShader(oldName, newName, time), warn: this.host.engine.print };
    const handlers = new Map<string, SpawnHandler>([
      ["info_player_start", spawnPlayerStart], ["info_player_deathmatch", spawnDeathmatchPoint],
      // SP_info_player_intermission and SP_item_botroam have empty source bodies.
      ["info_player_intermission", () => {}], ["item_botroam", () => {}],
      ["team_CTF_redplayer", spawnTeamPoint], ["team_CTF_blueplayer", spawnTeamPoint],
      ["team_CTF_redspawn", spawnTeamPoint], ["team_CTF_bluespawn", spawnTeamPoint],
      ...miscSpawnHandlers({ missiles: this.missiles, itemRegistry: this.registeredItems, random: this.random, warn: this.host.engine.print }),
      ...this.moverSpawns.handlers(),
      ...triggerSpawnHandlers({ ...shared, setBrushModel: (entity, name) => this.setBrushModel(entity, name) }),
      ...targetSpawnHandlers({ ...shared, itemLifecycle: this.itemLifecycle, locations: this.locations,
        addScore: (entity, origin, score) => this.death.addScore(entity, origin, score), returnFlag: team => this.team.returnFlag(team),
        sendServerCommand: this.host.engine.sendServerCommand, setConfigstring: (index, value) => this.host.configstrings.set(index, value) }),
    ]);
    const remove = handlers.get("info_null");
    if (remove === undefined) throw new Error("Source info_null handler is unavailable");
    handlers.set("func_group", remove);
    if (this.options.product === "missionpack") {
      handlers.set("team_redobelisk", entity => this.team.spawnTeamObelisk(entity, Team.TEAM_RED));
      handlers.set("team_blueobelisk", entity => this.team.spawnTeamObelisk(entity, Team.TEAM_BLUE));
      handlers.set("team_neutralobelisk", entity => this.team.spawnNeutralObelisk(entity));
    }
    return handlers;
  }

  private remapTeams(levelTime = this.level.time): void {
    if (this.options.product !== "missionpack") return;
    const time = Math.fround(Math.fround(levelTime) * Math.fround(0.001));
    for (const suffix of ["01", "02"]) this.remaps.add(`textures/ctf2/redteam${suffix}`, `team_icon/${this.string("g_redteam")}_red`, time);
    for (const suffix of ["01", "02"]) this.remaps.add(`textures/ctf2/blueteam${suffix}`, `team_icon/${this.string("g_blueteam")}_blue`, time);
    this.host.configstrings.set(24, this.remaps.buildShaderStateConfig());
  }
  private checkTeamItems(): void {
    this.team.initGame();
    const flags = this.gameType === GameType.GT_CTF ? ["Red", "Blue"]
      : this.options.product === "missionpack" && this.gameType === GameType.GT_1FCTF ? ["Red", "Blue", "Neutral"] : [];
    for (const name of flags) {
      const item = findItem(this.options.product, `${name} Flag`);
      if (item === null || !this.registeredItems.isRegistered(item)) this.host.engine.print(`^3WARNING: No team_CTF_${name.toLowerCase()}flag in map`);
    }
    const obelisks = this.options.product !== "missionpack" ? [] : this.gameType === GameType.GT_OBELISK ? ["team_redobelisk", "team_blueobelisk"]
      : this.gameType === GameType.GT_HARVESTER ? ["team_redobelisk", "team_blueobelisk", "team_neutralobelisk"] : [];
    for (const name of obelisks) if (findEntity(this.pool, null, "classname", name) === null) this.host.engine.print(`^3WARNING: No ${name} in map`);
  }

  private useParticipants(): UseParticipantServices {
    return { live: actor => this.host.actors.isLive(actor), isPlayer: this.host.isPlayer, native: actor => this.records.nativeByActor(actor),
      event: (actor, event, parameter) => {
        const body = this.host.bodies.read(actor); if (body === null) return;
        const state = new EntityState(); state.event = event; state.eventParm = parameter;
        this.host.entityEvent({ kind: "entity-event", actor, state, origin: body.origin, time: this.level.time });
      } };
  }

  private targets(): TargetUseContext {
    return { pool: this.pool, time: this.level.time, remapShader: (oldName, newName, time) => this.remapShader(oldName, newName, time), warn: this.host.engine.print };
  }
  private remapShader(oldName: string, newName: string, time: number): void {
    this.remaps.add(oldName, newName, time);
    this.host.configstrings.set(24, this.remaps.buildShaderStateConfig());
  }

  restartCompatibility(): "compatible" | "game-type-changed" | "client-capacity-changed" {
    if (!this.loaded || this.retired) throw new Error("Q3 round is not active");
    if (this.host.cvars.find("sv_maxclients")?.modified || this.host.cvars.variableValue("sv_maxclients") !== this.options.maxClients) return "client-capacity-changed";
    if (this.host.cvars.find("g_gametype")?.modified || this.host.cvars.variableValue("g_gametype") !== this.loadedGameType) return "game-type-changed";
    return "compatible";
  }

  close(): void {
    if (this.retired) return;
    this.retired = true; this.loaded = false;
    this.missiles.close(); this.records.close(); this.unobserve(); this.publishedEvents.clear();
  }

  load(): SpawnReport {
    if (this.retired || this.loaded || this.mode.kind === "restore") throw new Error("Q3 source map cannot spawn in its current construction mode");
    this.level.time = this.host.now(); this.level.startTime = this.level.time;
    this.level.warmupModificationCount = this.snapshot("g_warmup").modificationCount;
    this.memory.initialize();
    this.pool.initializeClients(this.options.maxClients);
    this.records.activate(1022);
    this.level.frySound = this.config.soundIndex("sound/player/fry.wav");
    this.session.initializeWorld();
    this.serverCommands.processIPBans();
    this.spawns.initBodyQueue(); this.registeredItems.clear(this.gameType);
    const runtime = this;
    this.mapReport = spawnEntities(this.options.entities, { pool: this.pool, memory: this.memory, product: this.options.product, gameType: this.gameType,
      handlers: this.spawnHandlers(), spawnItem: (entity, item, variables) => spawnItem(entity, item, variables,
        () => gameAtoi(this.engineCvar(`disable_${item.className}`)) !== 0, this.itemLifecycle), warn: this.host.engine.print,
      world: { pool: this.pool, startTime: this.level.startTime, motd: this.string("g_motd"), restarted: this.integer("g_restarted"), doWarmup: this.integer("g_doWarmup"),
        get warmupTime() { return runtime.level.warmupTime; }, set warmupTime(value) { runtime.level.warmupTime = value; },
        setConfigstring: (index, value) => this.host.configstrings.set(index, value), setCvar: (name, value) => this.setCvar(name, value), log: text => this.log(text) } });
    findQ3EntityTeams(this.pool);
    if (this.gameType >= GameType.GT_TEAM) this.checkTeamItems();
    this.registeredItems.save((index, value) => this.host.configstrings.set(index, value), this.host.engine.print);
    if (this.gameType === GameType.GT_SINGLE_PLAYER || gameAtoi(this.engineCvar("com_buildScript")) !== 0) {
      this.config.modelIndex("models/mapobjects/podium/podium4.md3");
      this.config.soundIndex("sound/player/gurp1.wav"); this.config.soundIndex("sound/player/gurp2.wav");
    }
    this.remapTeams(); this.settings.update(); this.loaded = true; this.loadedGameType = this.gameType;
    const unknown = this.mapReport.outcomes.filter(outcome => outcome.kind === "unknown");
    if (unknown.length !== 0) throw new Error("Unimplemented authored Q3 spawns: " + unknown.map(outcome => outcome.classname).join(", "));
    this.host.configstrings.set(0, this.host.serverState.serverInfo());
    return this.mapReport;
  }

  beginFrame(frame: FrameContext): void {
    this.level.frameNum = frame.frame;
    this.level.previousTime = this.level.time;
    this.level.time = frame.time.kind === "milliseconds" ? frame.time.value : Math.trunc(frame.time.value * 1000);
    this.settings.update();
  }

  runActor(actor: OwnedActor): void {
    const entity = this.records.byActor(actor.id);
    if (entity !== null && this.missiles.runOwned(actor)) return;
    if (entity === null || entity.slot === 1022 || this.pool.expireEvents(entity) !== "active") return;
    if (entity.neverFree && this.world.linkState(entity.slot)?.linked !== true) return;
    if (entity.s.eType === EntityType.ET_MISSILE) this.missiles.run(entity);
    else if (entity.s.eType === EntityType.ET_ITEM || entity.physicsObject) runItem(entity, { entities: this.pool, world: this.world,
      time: this.level.time, previousTime: this.level.previousTime, freeTeamEntity: item => this.team.freeEntity(item) });
    else if (entity.s.eType === EntityType.ET_MOVER) this.runMover(entity);
    else if (entity.slot < MAX_CLIENTS) this.think.runClient(entity);
    else runThink(entity, this.level.time);
  }

  private runMover(entity: GameEntity): void {
    if ((entity.flags & GameFlags.TEAMSLAVE) !== 0) return;
    const before: { readonly actor: OwnedActor; readonly origin: Vec3 }[] = [];
    for (let part: GameEntity | null = entity; part !== null; part = part.teamchain) {
      before.push({ actor: part.actor, origin: { ...part.r.currentOrigin } });
    }
    this.movers.run(entity);
    const elapsed = Math.fround(Math.fround(this.level.time - this.level.previousTime) * Math.fround(0.001));
    for (const previous of before) {
      const body = this.host.bodies.read(previous.actor.id);
      if (body === null) continue;
      const component = (after: number, start: number): number => elapsed <= 0 ? 0 : Math.fround(Math.fround(after - start) / elapsed);
      this.host.bodies.write(previous.actor, { ...body, velocity: {
        x: component(body.origin.x, previous.origin.x), y: component(body.origin.y, previous.origin.y), z: component(body.origin.z, previous.origin.z),
      } });
    }
  }

  endFrame(): void {
    for (let index = 0; index < this.pool.maxClients; index++) {
      const entity = this.pool.at(index); if (entity.inuse) clientEndFrame(this.effects(), entity);
    }
    this.match.checkTournament(); this.match.checkExitRules(); this.team.checkTeamStatus(); this.match.checkVote();
    this.match.checkTeamVote(Team.TEAM_RED); this.match.checkTeamVote(Team.TEAM_BLUE); this.match.checkCvars();
    if (this.integer("g_listEntity") !== 0) {
      for (let index = 0; index < MAX_GENTITIES; index++) this.host.engine.print(gameFormat("%4i: %s\n", [index, this.pool.at(index).classname]));
      this.setCvar("g_listEntity", "0");
    }
    this.host.configstrings.set(0, this.host.serverState.serverInfo());
    this.publishEvents();
  }

  private publishEvents(): void {
    for (let slot = 0; slot < this.pool.numEntities; slot++) {
      const entity = this.pool.at(slot);
      if (!entity.inuse) continue;
      const event = entity.s.eType >= EntityType.ET_EVENTS ? entity.s.eType - EntityType.ET_EVENTS : entity.s.event;
      if (event === 0) continue;
      const previous = this.publishedEvents.get(entity.actor);
      if (previous?.event === event && previous.time === entity.eventTime) continue;
      this.publishedEvents.set(entity.actor, { event, time: entity.eventTime });
      this.host.entityEvent({ kind: "entity-event", actor: entity.actor.id, state: entity.s.copy(), origin: { ...entity.r.currentOrigin }, time: this.level.time });
    }
  }

  prepareClient(actor: OwnedActor, client: number): GameEntity {
    if (!this.loaded) throw new Error("Q3 source map must be loaded before admitting players");
    return this.records.attach(client, actor, true);
  }

  admitPlayer(actor: OwnedActor, client: number): GameEntity {
    const entity = this.prepareClient(actor, client);
    const restored = this.options.sessionCarry?.clients.some(saved => saved.slot === client) ?? false;
    const rejected = this.admission.connect(client, !restored, false);
    if (rejected !== null) throw new Q3ClientAdmissionDenied(rejected);
    this.admission.begin(client);
    return entity;
  }

  captureSession(): Q3SourceSessionCarry {
    this.session.writeWorld();
    const clients: Q3SourceSessionCarry["clients"][number][] = [];
    for (let slot = 0; slot < this.pool.maxClients; slot++) {
      if (this.pool.clientAt(slot).pers.connected === ConnectionState.DISCONNECTED) continue;
      // ExitLevel has already moved connected clients to CONNECTING before the engine consumes nextmap.
      this.session.writeClient(slot);
      clients.push({ slot, session: this.host.cvars.variableString(`session${slot}`), userinfo: this.host.engine.getUserinfo(slot) });
    }
    return { kind: "q3", world: this.host.cvars.variableString("session"), clients };
  }

  disconnectPlayer(actor: ActorId): void {
    const entity = this.records.byActor(actor);
    if (entity?.client !== null && entity?.client !== undefined) this.admission.disconnect(entity.slot);
  }

  playerThink(input: ActorCommand): void {
    const entity = this.records.byActor(input.actor);
    if (entity === null || entity.client === null) throw new Error("Q3 client command has no admitted actor");
    this.think.clientThink(entity.slot, this.host.sourceCommand(input));
  }
  playerCommand(actor: ActorId, name: string, args: readonly string[]): void {
    const entity = this.records.byActor(actor);
    if (entity === null || entity.client === null) throw new Error("Q3 client command has no admitted actor");
    this.commands.dispatch(entity.slot, [name, ...args]);
  }
  playerWeapon(actor: ActorId): void {
    const entity = this.records.byActor(actor);
    if (entity === null || entity.client === null) throw new Error("Q3 weapon fire has no admitted actor");
    entity.s.weapon = entity.client.ps.weapon;
    this.weapons.fire(entity);
  }
  beforeReaction(actor: OwnedActor, decision: DamageDecision): void {
    this.bridge.beforeReaction(decision);
    const entity = this.records.nativeByActor(actor.id);
    if (decision.reaction === "death" && entity?.client != null) {
      const cause = decision.request.attack.cause;
      this.death.playerDie(entity, this.records.damageInflictor(decision.request.attack.inflictor), this.records.damageInflictor(decision.request.attack.attacker),
        decision.appliedDamage, cause.kind === "q3" ? cause.meansOfDeath : 0);
    }
  }

  private adjustAreaPortalState(entity: GameEntity, open: boolean): void {
    const bounds = this.host.bodies.linked(entity.actor.id)?.absoluteBounds;
    if (bounds === undefined) throw new Error("Area portal mover must be linked");
    const leaves = this.host.scene.boxLeaves(bounds, 128);
    const areas = [...new Set(leaves.leaves.map(leaf => this.host.scene.leafArea(leaf)))];
    const first = areas[0], second = areas[1];
    if (first !== undefined && second !== undefined) this.host.scene.adjustAreaPortalState(first, second, open);
  }
}
