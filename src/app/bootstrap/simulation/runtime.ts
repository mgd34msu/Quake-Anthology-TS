import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import { emitQ2ShadowLights } from "../../../content/q2/foundation/shadow-lights.ts";
import { SimulationBotServices } from "./bots.ts";
import { resolveQ3ArsenalControls } from "./arsenal-intent.ts";
import { isDeepStrictEqual } from "node:util";
import type { ContentId, ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { AttackProvenance, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { AnimationStepInput, AnimationStepResult, ArsenalState, MovementContinuation, MovementState, MovementTouchContact, WeaponStepInput, WeaponStepResult } from "../../../contracts/movement.ts";
import type { ActorCommand, InputBatch, SaveImage, Simulation, SimulationOutput, WorldSnapshot } from "../../../contracts/session.ts";
import type { FrameContext, SourceTime } from "../../../contracts/time.ts";
import { CvarRegistry } from "../../../core/cvars/index.ts";
import { createQ1SourceComposition } from "../../../content/composition/q1/index.ts";
import type { Q1SourceComposition, Q1CompositionServices } from "../../../content/composition/q1/index.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, createQ2CombatPolicy, nativeVictimArmor } from "../../../world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../world/collision/index.ts";
import { FrameScheduler } from "../../../world/scheduler.ts";
import { SourceClock } from "../../../world/session/index.ts";
import { Q1Foundation } from "../../../content/q1/foundation/runtime.ts";
import { WEAPONS as Q1_WEAPONS, isQ1BaseWeapon } from "../../../content/q1/foundation/types.ts";
import { Q1CampaignState, Q1CharacterActor } from "../../../content/q1/base/index.ts";
import type { Q1TravelState } from "../../../content/q1/base/index.ts";
import { Q2CharacterActor } from "../../../content/q2/base/player/index.ts";
import type { Q2PlayerHooks } from "../../../content/q2/base/player/index.ts";
import { createQ2ProductRuntime, captureQ2Product, restoreQ2Product } from "../../../content/composition/q2/index.ts";
import type { Q2ProductRuntime, Q2CompositionCommon } from "../../../content/composition/q2/index.ts";
import type { Q2RereleaseHooks } from "../../../content/q2/rerelease/types.ts";
import type { Q2CharacterGib } from "../../../content/q2/base/player/character.ts";
import type { Q2PlayerMovementChange, Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import type { Q1FoundationHost, Q1Powerup } from "../../../content/q1/foundation/types.ts";
import type { Q2FoundationHost, Q2PresentationEvent, Q2LandmarkCarry } from "../../../content/q2/foundation/host.ts";
import type { Q2ItemHooks } from "../../../content/q2/foundation/items.ts";
import { Q2Weapons } from "../../../content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent } from "../../../content/q2/foundation/weapons/index.ts";
import { Q3CharacterActor, Q3DeathAnimationSequence, q3InitialCombat, stepQ3CharacterAnimation } from "../../../content/q3/foundation/character.ts";
import type { Q3CharacterView } from "../../../content/q3/foundation/presentation.ts";
import { q3SpawnLoadout, q3SpawnArsenalRuntime, stepQ3Arsenal, q3WeaponItem, Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import type { Q3ArsenalRuntimeState } from "../../../content/q3/foundation/arsenal.ts";
import type { GameEntity } from "../../../content/q3/base/game/state.ts";
import type { UserCommand as Q3SourceCommand } from "../../../content/q3/base/shared/player-state.ts";
import type { SpawnPose } from "../../../content/q3/team-arena/client-spawn.ts";
import type { ClientMovementOptions, ClientMovementResult } from "./q3/types.ts";
import { Q3SourceRuntime, createQ3SourceHost, readQ3MovementState, writeQ3MovementState, writeQ3CharacterAnimation,
  readQ3MovementEnvironment, readQ3ArsenalRuntime, writeQ3ArsenalRuntime, applyQ3CommandPolicy } from "./q3/index.ts";
import { MoveFlags, MoveType } from "../../../movement/q3/constants.ts";
import { q3SourceCommand, selectedQ3Command } from "./q3-commands.ts";
import { q3SourceAnimation, q3SourceTorso } from "../../../movement/q3/animation.ts";
import { createQ1MonsterMovement } from "../../../movement/q1/index.ts";
import type { Q1MonsterMovement } from "../../../movement/q1/monsters.ts";
import { SharedPhysics } from "./physics.ts";
import type { SharedSolid } from "./physics.ts";
import { MovementPlayer, movementOrigin, providerFamily, providerTiming } from "./players.ts";
import { SimulationEvents } from "./events.ts";
import { SourceRandom } from "./random.ts";
import { captureSharedBodies, restoreSharedBodyLinks, restoreSharedWorldState, sourceActorsCheckpoint, readSourceActorsCheckpoint,
  savedActorId, readSavedActor, encodeCheckpointValue, SaveReader, encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint,
  readQ2CharacterCheckpoint } from "../../../persistence/index.ts";
import { readContentId } from "../../../persistence/recipe.ts";
import { readVector } from "../../../persistence/shared.ts";
import { captureMovementPlayer, readMovementPlayer, readQ1Travel, readQ2View, readQ3Character } from "./player-checkpoint.ts";
import { simulationProviderCheckpoint, simulationSaveReader, savedSimulationSettings } from "./save.ts";
import type { PlayerAdmission, PlayerView, PlayerUi, PlayerUiItem, SimulationTravel, SimulationOptions, SimulationPresentation, SimulationPresentationEvent } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function add(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function seconds(time: SourceTime): number { return time.kind === "seconds" ? time.value : time.value / 1000; }
function sourceModel(path: string): number | null { return /^\*[0-9]+$/.test(path) ? Number(path.slice(1)) : null; }


type SourceRuntime = { readonly kind: "loading" }
  | { readonly kind: "q1"; readonly game: Q1Foundation; readonly composition: Q1SourceComposition; readonly cvars: CvarRegistry }
  | { readonly kind: "q3"; readonly game: Q3SourceRuntime }
  | ({ readonly kind: "q2"; readonly product: Q2ProductRuntime } & Pick<Q2ProductRuntime, "game" | "weapons" | "monsters" | "movers" | "items" | "players" | "baseEntities">);

/** One actor registry and source-ordered frame traversal, including foreign character and movement providers. */
export class SharedSimulation implements Simulation {
  readonly session;
  readonly recipe: ExecutableRecipe;
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly scene: SharedSceneQueries;
  readonly physics: SharedPhysics;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly scheduler: FrameScheduler;
  readonly random: SourceRandom;
  readonly botServices = new SimulationBotServices();
  readonly clock: SourceClock;
  readonly events: SimulationEvents;
  private readonly playerStates = new Map<OwnedActor, MovementPlayer>();
  private readonly q2Characters = new Map<OwnedActor, Q2CharacterActor>();
  private readonly characterTicks = new Map<OwnedActor, number>();
  private readonly entryCarry = new Map<OwnedActor, Q1TravelState>();
  private readonly detachedModels = new Map<OwnedActor, { readonly content: ContentId; readonly path: string }>();
  private readonly q1Characters = new Map<OwnedActor, Q1CharacterActor>();
  private readonly q2Views = new Map<ActorId, Q2PlayerView>();
  private readonly q1Campaign: Q1CampaignState;
  private readonly characters = new Map<OwnedActor, Q3CharacterActor>();
  private readonly characterStarts = new Map<OwnedActor, ActorId | null>();
  private readonly q3Arsenals = new Map<OwnedActor, Q3ArsenalRuntimeState>();
  private readonly q3Commands = new Map<OwnedActor, ActorCommand>();
  private readonly deathAnimations = new Q3DeathAnimationSequence();
  private readonly sourceModels = new Map<ActorId, Extract<Q2PresentationEvent, { readonly kind: "model" }>>();
  private readonly viewModels = new Map<ActorId, { readonly path: string; readonly frame: number }>();
  private readonly transitions: TransitionIntent[] = [];
  private levelChange: { readonly map: string; readonly landmark: Q2LandmarkCarry | null; readonly serverFlags: number } | null = null;
  readonly weaponProvider: ProviderReference;
  private readonly q1Movement: Q1MonsterMovement;
  private source: SourceRuntime = { kind: "loading" };
  private sourceFrame: FrameContext;
  private hostMilliseconds = 0;
  private sourceSchedulingMilliseconds = 0;
  private closed = false;
  private stepping = false;
  private checkingQ2Rules = false;
  private checkClientAt = -Infinity;
  private checkClientIndex = -1;
  private checkedClient: ActorId | null = null;
  private attackSequence = 0;
  private q1Restart = false;
  private readonly lastAttack = new Map<OwnedActor, AttackProvenance>();
  private readonly areaPortals = new Map<number, boolean>();

  constructor(readonly options: SimulationOptions) {
    this.session = options.identity.session;
    this.q1Campaign = new Q1CampaignState(options.travel?.source.kind === "q1" ? options.travel.source.flags : 0, options.travel?.source.kind === "q1" ? options.travel.source.skill : options.skill);
    this.recipe = options.recipe;
    const weaponProvider = options.recipe.weapons[0];
    if (weaponProvider === undefined || options.recipe.weapons.length !== 1) throw new Error("This source arsenal requires one selected weapon provider");
    this.weaponProvider = weaponProvider;
    const timing = providerTiming(this.recipe, this.recipe.map.entities.provider);
    const saved = options.restore;
    if (saved !== undefined) {
      const settings = savedSimulationSettings(saved);
      if (settings.skill !== options.skill || settings.mode !== options.mode || settings.maxClients !== options.maxClients)
        throw new Error("Saved simulation rules differ from construction settings");
      if (!isDeepStrictEqual(saved.recipe, options.recipe)) throw new Error("Saved simulation recipe differs from the mounted recipe");
      if (saved.guests.length !== 0) throw new Error("Source TypeScript simulation cannot restore guest memory providers");
    }
    const initial = saved === undefined ? options.initialSourceMilliseconds ?? 0 : seconds(saved.frame.time) * 1000;
    if (!Number.isFinite(initial) || initial < 0) throw new RangeError("Initial source time must be finite and nonnegative");
    this.clock = new SourceClock({ kind: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? "milliseconds" : "seconds",
      value: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? initial : initial / 1000 }, saved?.frame.frame ?? 0);
    this.hostMilliseconds = initial;
    this.sourceSchedulingMilliseconds = initial;
    this.sourceFrame = saved?.frame ?? this.clock.frame;
    this.random = new SourceRandom(options.seed, timing.clock.kind === "q2-rerelease" ? "q2-rerelease" : "classic");
    this.actors = saved === undefined ? new SessionActorRegistry(options.identity)
      : SessionActorRegistry.restore(options.identity, saved.actors, readSourceActorsCheckpoint(simulationProviderCheckpoint(saved, "world:source-slots")));
    this.callbacks = new ActorCallbackTable(this.actors);
    this.scene = new SharedSceneQueries(options.world);
    this.physics = new SharedPhysics({ actors: this.actors, callbacks: this.callbacks, scene: this.scene, numeric: timing.numeric,
      q2Edition: this.recipe.map.entities.content.includes(":rerelease:") ? "rerelease" : "classic",
      takeKillVelocity: actor => { const entity = this.source.kind === "q2" ? this.source.game.entity(actor.id) : null;
        if (entity === null || (entity.flags & 0x800000) === 0) return false; entity.flags &= ~0x800000; return true; },
      stopSpeed: () => this.source.kind === "q2" ? this.source.product.movementStopSpeed ?? 100 : 100,
      sourceOrder: (a, b) => this.sourceOrder(a, b), worldActor: () => this.worldActor(), getCollision: actor => this.collision(actor),
      getMotion: actor => {
        const body = this.physics.bodies.read(actor.id); if (body === null) return null;
        const player = this.playerStates.get(actor);
        if (player !== undefined) return { actor, velocity: body.velocity, angularVelocity: zero,
          kind: this.q2Characters.get(actor)?.state.dead ? this.q2Characters.get(actor)?.state.gibbed ? "bounce" : "toss" : "step", gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null };
        if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); return entity === null ? null : { actor, velocity: body.velocity, angularVelocity: entity.angularVelocity,
          kind: entity.motion, gravity: entity.gravity, gravityVector: entity.gravityVector, clipMask: entity.clipMask, owner: entity.owner }; }
        if (this.source.kind === "q1") { const entity = this.source.game.entity(actor.id); return entity === null ? null : { actor, velocity: body.velocity, angularVelocity: entity.angularVelocity,
          kind: entity.movement === "flymissile" ? "fly-missile" : (entity.movement === "none" || entity.movement === "noclip") ? "stationary" : entity.movement,
          gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: entity.owner }; }
        return null;
      },
      getFlags: actor => {
        const player = this.playerStates.get(actor), entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : null;
        const q2 = this.source.kind === "q2" ? this.source.game.entity(actor.id) : null;
        const monster = this.source.kind === "q2" ? this.source.monsters.context(actor.id)?.state : undefined;
        return { ...(q2 === null ? {} : { teamSlave: (q2.flags & 1024) !== 0, alwaysTouch: (q2.flags & 0x10000000) !== 0 }), ...(monster === undefined ? {} : { fly: monster.locomotion === "fly", swim: monster.locomotion === "swim", dead: monster.dead, waterLevel: monster.waterLevel, waterType: monster.waterType }), player: player !== undefined, dead: (this.combat?.read(actor.id)?.health ?? 1) <= 0,
          ...(player === undefined ? {} : { waterLevel: player.waterLevel, waterType: player.waterType }),
          ...(entity === null ? {} : { fly: (entity.movementFlags & 1) !== 0, swim: (entity.movementFlags & 2) !== 0, partialGround: (entity.movementFlags & 1024) !== 0, waterLevel: entity.waterLevel, waterType: entity.waterType, enemy: entity.monster?.enemy ?? null }) };
      },
      writeFlags: (actor, changes) => { const player = this.playerStates.get(actor);
        if (player !== undefined) { if (changes.waterLevel !== undefined) player.waterLevel = changes.waterLevel; if (changes.waterType !== undefined) player.waterType = changes.waterType; }
        const entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : null;
        if (entity !== null && changes.waterLevel !== undefined) entity.waterLevel = changes.waterLevel;
        const monster = this.source.kind === "q2" ? this.source.monsters.context(actor.id)?.state : undefined;
        if (monster !== undefined) { if (changes.waterLevel === 0 || changes.waterLevel === 1 || changes.waterLevel === 2 || changes.waterLevel === 3) monster.waterLevel = changes.waterLevel; if (changes.waterType !== undefined) monster.waterType = changes.waterType; }
        return undefined; },
      event: event => this.events.emit(this.recipe.map.entities.content, this.source.kind === "q1" ? { kind: "q1", event: {
        kind: "sound", actor: event.actor, path: event.kind === "land" ? "demon/dland2.wav" : "misc/h2ohit1.wav", channel: "auto", volume: 1, attenuation: 1 } }
        : { kind: "q2", event: { kind: "sound", actor: event.actor, origin: event.origin, path: event.kind === "land" ? "world/land.wav" : "misc/h2ohit1.wav",
          channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" } }),
      writeAngularVelocity: (actor, velocity) => { const entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : this.source.kind === "q2" ? this.source.game.entity(actor.id) : null;
        if (entity !== null) entity.angularVelocity = velocity; return undefined; },
      onBlocked: (actor, other) => {
        if (this.source.kind === "q1") this.source.game.entity(actor.id)?.blocked?.(other);
        else if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); entity?.blocked?.(entity, this.source.game, other); }
        return undefined;
      } });
    this.inventory = new SharedInventoryTable(this.actors);
    this.events = new SimulationEvents(this.physics.bodies, () => this.sourceFrame.time, actor => this.player(actor)?.client ?? null, actor => this.actors.sourceOf(actor)?.slot ?? null);
    this.combat = new GameplayAuthority(this.actors, this.callbacks, {
      impulse: (actor, impulse, movement) => {
        const body = this.physics.bodies.read(actor.id);
        if (body === null) throw new Error("Damaged actor has no body");
        const numeric = createNumericOperations(providerTiming(this.recipe, movement).numeric);
        this.physics.bodies.write(actor, { ...body, velocity: { x: numeric.add(body.velocity.x, impulse.x), y: numeric.add(body.velocity.y, impulse.y), z: numeric.add(body.velocity.z, impulse.z) } });
        return undefined;
      },
      beforeReaction: (actor, decision) => {
        this.lastAttack.set(actor, decision.request.attack);
        if (this.source.kind === "q3") this.source.game.beforeReaction(actor, decision);
        if (this.source.kind === "q1") this.source.composition.beforeReaction(actor, decision);
        if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); if (entity !== null) { entity.lastAttack = decision.request.attack; if (this.playerStates.has(actor)) this.source.product.beforeReaction(actor.id, decision.request.attack.attacker); } }
        if (decision.reaction === "death" && this.source.kind === "q2" && this.playerStates.has(actor) && this.playerStates.get(actor)?.character !== "q2") {
          const entity = this.source.game.entity(actor.id); if (entity !== null) this.source.players.recordDeath(entity, this.source.game, { self: actor, attacker: decision.request.attack.attacker,
            inflictor: decision.request.attack.inflictor, damage: decision.appliedDamage, kick: decision.request.knockback, point: decision.request.point });
        }
        return undefined;
      }, confirmed: outcome => {
        if (outcome.kind === "committed") { const actor = this.actors.resolveOwned(outcome.decision.request.target);
          if (actor !== null) {
            this.q2Characters.get(actor)?.recordDamage(outcome.decision);
            if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id);
              if (entity !== null && this.playerStates.get(actor)?.character === "q2") this.source.players.recordDamage(entity, this.source.game, outcome.decision);
              const character = this.characters.get(actor), state = this.source.players.states.get(actor.id);
              if (character !== undefined && state !== undefined && state.dead) state.respawnTime = Math.max(state.respawnTime, character.respawnEligibleAfterMilliseconds / 1000);
            }
          }
        }
        return this.events.append({ kind: "damage", outcome });
      },
    });
    this.registerCombat();
    this.scheduler = new FrameScheduler({ actors: this.actors, ordering: this.recipe.ordering, clocks: this.recipe.timing.map(value => ({ provider: value.provider, profile: value.clock })),
      sourceSlot: actor => this.actors.sourceOf(actor)?.slot ?? null,
      resolve: (_provider, callback) => callback === "world:think" ? (actor, frame) => { this.callbacks.think(actor, frame); return undefined; } : null });
    this.actors.onRelease(actor => {
      this.scheduler.cancel(actor); this.playerStates.delete(actor); this.characters.delete(actor); this.characterStarts.delete(actor); this.q3Arsenals.delete(actor); this.q3Commands.delete(actor); this.q1Characters.delete(actor); this.q2Views.delete(actor.id); this.q2Characters.delete(actor); this.characterTicks.delete(actor); this.entryCarry.delete(actor); this.detachedModels.delete(actor); this.sourceModels.delete(actor.id); this.viewModels.delete(actor.id); this.lastAttack.delete(actor);
      return undefined;
    });
    this.q1Movement = createQ1MonsterMovement({ scene: this.scene, numeric: createNumericOperations(timing.numeric), random: this.random,
      read: actor => {
        const body = this.physics.bodies.read(actor), entity = this.source.kind === "q1" ? this.source.game.entity(actor) : null;
        if (body === null || entity === null) return null;
        return { origin: body.origin, angles: body.angles, bounds: body.bounds,
          absoluteBounds: this.physics.bodies.linked(actor)?.absoluteBounds ?? { min: add(body.origin, body.bounds.min), max: add(body.origin, body.bounds.max) },
          flags: entity.movementFlags, ground: body.ground === null ? { kind: "none" } : { kind: "actor", actor: body.ground },
          idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, enemy: entity.monster?.enemy ?? null };
      },
      write: (actor, state) => {
        const body = this.physics.bodies.read(actor.id), entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : null;
        if (body === null || entity === null) return undefined;
        this.physics.bodies.write(actor, { ...body, origin: state.origin, angles: state.angles, ground: state.ground.kind === "actor" ? state.ground.actor : state.ground.kind === "world" ? this.worldActor() : null });
        entity.movementFlags = state.flags; entity.idealYaw = state.idealYaw; entity.yawSpeed = state.yawSpeed;
        return undefined;
      }, link: (actor, triggers) => { this.physics.bodies.link(actor); if (triggers) this.physics.touchTriggers(actor); return undefined; } });
    this.source = this.createSource();
    try {
    options.monsterNavigation?.install(this, this.q1Movement);
    if (saved !== undefined) this.restore(saved);
    else if (this.source.kind === "q1" && options.world.kind === "q1-bsp") this.source.composition.spawnMap(options.world);
    else if (this.source.kind === "q3") { if (providerFamily(this.recipe.combat.provider) === "q3") this.combat.register(this.source.game.bridge.policy()); this.source.game.load(); }
    else if (this.source.kind === "q2") {
      if (options.travel?.source.kind === "q2") this.source.game.counters.serverFlags = options.travel.source.serverFlags;
      const report = this.source.game.load(options.world.entities);
      this.source.product.afterSpawn();
      if (report.unsupported.length !== 0) throw new Error(`Unimplemented authored Q2 spawns: ${[...new Set(report.unsupported.map(entity => entity.classname))].join(", ")}`);
    }
    } catch (error) { this.close(); throw error; }
  }

  get bodies() { return this.physics.bodies; }
  get timeSeconds(): number { return seconds(this.sourceFrame.time); }

  private createSource(): SourceRuntime {
    const recipe = this.recipe, content = recipe.map.entities.content, campaign = recipe.campaign.kind === "campaign" ? recipe.campaign.mission.provider : recipe.map.entities.provider;
    if (this.options.world.kind === "q3-bsp") {
      const product = content.includes("missionpack") ? "missionpack" : "baseq3";
      const host = createQ3SourceHost({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
        scene: this.scene, deathAnimations: this.deathAnimations, bots: this.botServices.source,
        now: () => Math.trunc(this.timeSeconds * 1000), schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due / 1000),
        runThink: actor => { this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics"); return undefined; },
        collision: (actor, collision) => this.physics.setCollision(actor, collision), armorContext: () => ({ screenFacingDot: 0, arithmetic: "binary32" }),
        foreign: actor => { if (this.actors.isLive(actor)) throw new Error("Foreign Q3 actor projection is not attached"); return null; },
        sourceCommand: input => {
          const command = q3SourceCommand(input, this.requirePlayer(input.actor), this.sourceSchedulingMilliseconds);
          const delta = this.source.kind === "q3" ? this.source.game.records.byActor(input.actor)?.client?.ps.deltaAngles : undefined;
          return input.source.kind === "local-seat" && delta !== undefined ? { ...command, angles: subtract(command.angles, delta) } : command;
        },
        spawnPlayer: (entity, pose) => this.spawnQ3Player(entity, pose), moveClient: (entity, command, options) => this.moveQ3Client(entity, command, options),
        emit: event => { this.events.emit(content, { kind: "q3-source", event }); }, clientNumber: actor => this.requirePlayer(actor).client.slot,
      }, { gameType: this.options.mode === "singleplayer" ? 2 : 0, singlePlayer: this.options.mode === "singleplayer", maxClients: this.options.maxClients,
        mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        ...(this.options.q3Cvars === undefined ? {} : { cvars: this.options.q3Cvars }) });
      return { kind: "q3", game: new Q3SourceRuntime({ recipe, weaponProvider: this.weaponProvider, product, entities: this.options.world.entities,
        seed: this.options.seed, maxClients: this.options.maxClients, buildDate: "TypeScript port",
        ...(this.options.q3Session === undefined ? {} : { sessionCarry: this.options.q3Session }) }, host) };
    }
    if (this.options.world.kind === "q1-bsp") {
      const host: Q1FoundationHost = { actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
        random: () => this.random.nextUnit(),
        trace: request => {
          const trace = this.scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" },
            policy: { kind: "q1", move: request.missile ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: providerTiming(recipe, recipe.map.entities.provider).numeric, passActor: request.ignore });
          if (trace.kind !== "q1") throw new Error("Q1 trace returned another source representation");
          const contents = this.scene.pointContents({ point: trace.end, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: providerTiming(recipe, recipe.map.entities.provider).numeric, passActor: request.ignore });
          return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? this.worldActor() : null,
            startSolid: trace.startSolid, allSolid: trace.allSolid, sky: contents.kind === "q1" && contents.contents === -6, inOpen: trace.inOpen, inWater: trace.inWater };
        },
        contents: point => { const value = this.contents(point, "q1"); return value === -2 ? "solid" : value === -3 ? "water" : value === -4 ? "slime" : value === -5 ? "lava" : value === -6 ? "sky" : "empty"; },
        walkMove: (actor, yaw, distance) => this.q1Movement.walkMove(actor, yaw, distance),
        checkBottom: actor => this.q1Movement.checkBottom(actor),
        moveToGoal: (actor, goal, distance) => this.q1Movement.moveToGoal(actor, goal, distance),
        changeYaw: actor => { this.q1Movement.changeYaw(actor); return undefined; },
        pushMove: (actor, displacement) => { const entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : null;
          const angular = entity?.angularVelocity ?? zero, elapsed = seconds(this.sourceFrame.elapsed);
          return this.physics.pushMove(actor, displacement, { x: angular.x * elapsed, y: angular.y * elapsed, z: angular.z * elapsed }); },
        scheduleThink: (actor, due) => this.schedule(actor, due), cancelThink: actor => this.scheduler.cancel(actor),
        emit: event => {
          if (event.kind === "weapon") this.viewModels.set(event.player, { path: event.viewModel, frame: event.frame });
          if (event.kind === "intermission") for (const player of this.playerStates.values()) {
            player.viewHeight = 0;
            this.setPlayerMovement(player.actor.id, { kind: "freeze", origin: event.origin, angles: event.angles });
          }
          if (event.kind === "teleport-player") { const player = this.player(event.player); if (player !== null) { player.viewAngles = event.angles; if (player.state.kind === "q1-netquake") player.state = { ...player.state, viewAngles: event.angles, teleportTimeSeconds: event.lockUntil }; } }
          return this.events.emit(content, { kind: "q1", event });
        }, transition: intent => { this.transitions.push(intent); return undefined; }, players: () => this.players(), classname: actor => this.classname(actor),
        checkClient: observer => this.checkClient(observer), powerup: (actor, powerup, expires) => this.powerup(actor, powerup, expires),
        controlPlayer: (actor, control) => this.controlPlayer(actor, control),
        setGravity: (actor, scale) => { const player = this.player(actor); if (player !== null) {
          player.gravityMultiplier = scale;
          if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * scale) };
        } return undefined; } };
      const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: this.session, origin: { kind: "server-console" } },
        print: text => { this.events.message({ kind: "print", level: 2, text }); } });
      for (const [name, value] of Object.entries({ skill: String(this.q1Campaign.skill), deathmatch: this.options.mode === "deathmatch" ? "1" : "0", coop: this.options.mode === "coop" ? "1" : "0",
        teamplay: "0", sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", sv_cheats: "0", footsteps: "1" })) cvars.register(name, value);
      const services: Q1CompositionServices = {
        cvar: name => cvars.variableValue(name), setCvar: (name, value) => { cvars.set(name, value, true); if (name === "sv_gravity") this.setWorldGravity(cvars.variableValue(name)); if (name === "skill") { const skill = cvars.variableValue(name); if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Q1 skill must be 0..3"); this.q1Campaign.skill = skill; } return undefined; },
        emit: event => { if (event.kind === "level-presentation") return this.events.emit(content, { kind: "q1-level", event: event.event }); return this.events.emit(content, { kind: "q1-composition", event }); },
        selectedPlayer: actor => { const player = this.requirePlayer(actor), life = this.q1Characters.get(player.actor)?.presentation.life;
          return { deadFlag: life === "dying" ? 1 : life === "dead" ? 2 : life === "respawnable" ? 3 : (this.combat.read(actor)?.health ?? 0) > 0 ? 0 : 2,
            isBot: false, viewAngles: player.viewAngles, viewOffset: this.q1Characters.get(player.actor)?.presentation.viewOffset ?? this.q2Views.get(actor)?.offset ?? { x: 0, y: 0, z: player.viewHeight }, frame: player.animation.state.kind === "q1" || player.animation.state.kind === "q2" ? player.animation.state.frame : 0,
            waterType: player.waterType === -3 || player.waterType === 32 ? "water" : player.waterType === -4 || player.waterType === 16 ? "slime" : player.waterType === -5 || player.waterType === 8 ? "lava" : "empty",
            waterLevel: player.waterLevel === 3 ? 3 : player.waterLevel === 2 ? 2 : player.waterLevel === 1 ? 1 : 0,
            teleportUntil: player.state.kind === "q1-netquake" ? player.state.teleportTimeSeconds : 0 }; },
        setObserver: (actor, enabled) => { const player = this.requirePlayer(actor); this.setPlayerMovement(actor, { kind: "noclip", enabled }); this.combat.setTraits(player.actor, { canTakeDamage: !enabled }); this.bodies.link(player.actor); return undefined; },
        placePlayer: (actor, spot, travel) => this.placeQ1Player(this.requirePlayer(actor.id), spot, travel),
        disconnect: actor => { const player = this.requirePlayer(actor); return this.actors.release(player.actor); },
        teleport: (actor, origin, angles, velocity, until) => { const player = this.requirePlayer(actor); return this.setPlayerMovement(actor, { kind: "teleport", origin, angles, velocity, commandAngles: player.commandAngles, holdMilliseconds: Math.max(0, (until - this.timeSeconds) * 1000), spectator: false }); },
        selectedWeapon: actor => this.playerUi(actor).activeWeapon, selectedAmmo: actor => this.playerUi(actor).ammo?.item ?? null,
        selectWeapon: (actor, item) => { if (this.source.kind !== "q1") return false; const game = this.source.game;
          const weapon = [...Q1_WEAPONS, ...game.registeredWeapons.keys()].find(value => game.weaponItem(value) === item);
          return weapon !== undefined && game.selectWeapon(this.requirePlayer(actor).actor, weapon); },
        weaponChanged: actor => { const player = this.requirePlayer(actor); player.arsenal = this.arsenal(player); return undefined; },
        promptSupported: () => true,
        restartSession: (map, flags) => { this.q1Restart = true; this.q1Campaign.flags = flags; this.transitions.push({ kind: "campaign-level", campaign, map: `q1:${map}`, spawnPoint: "", gates: [], cause: null }); return undefined; },
        finishCampaign: () => { this.transitions.push({ kind: "campaign-complete", campaign, gates: [] }); return undefined; },
      };
      const selectedProgram = content.split(":")[2];
    const program = selectedProgram === "ctf" || selectedProgram === "lmctf" ? "baseq2" : selectedProgram;
      if (program !== "id1" && program !== "hipnotic" && program !== "rogue" && program !== "dopa" && program !== "mg1" && program !== "mg3" && program !== "ctf") throw new Error(`Unsupported Q1 source program ${program}`);
      const composition = createQ1SourceComposition(host, { edition: content.includes(":rerelease:") ? "rerelease" : "classic", skill: this.q1Campaign.skill,
        deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider, gravity: 800 },
        { program, campaign: this.q1Campaign, registered: true, officialCampaign: program === "id1" }, services);
      return { kind: "q1", game: composition.game, composition, cvars };
    }

    const weapons = new Q2Weapons({ emit: event => this.weaponEvent(content, event),
      noise: (actor, origin, secondary) => { if (this.source.kind !== "q2") throw new Error("Q2 monster noise before source admission"); return this.source.monsters.reportNoise(actor, origin, secondary); },
      dodge: (monster, game, attacker, eta, trace) => { if (this.source.kind !== "q2") throw new Error("Q2 dodge before source admission"); return this.source.monsters.dodge(monster, game, attacker, eta, trace); },
      lagCompensation: { kind: "current-world" },
      ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
      canTarget: (attacker, target) => attacker === null || !sameActor(attacker, target) });
    const entityHooks: Q2CompositionCommon["entityHooks"] = {
      playerPush: (actor, velocity) => { const player = this.requirePlayer(actor), body = this.bodies.read(actor); if (body === null) return undefined;
        this.bodies.write(player.actor, { ...body, velocity }); player.state = player.readState();
        const state = this.source.kind === "q2" ? this.source.players.states.get(actor) : undefined; if (state !== undefined) state.oldVelocity = velocity; return undefined; },
      setActorGravity: (actor, gravity) => { const player = this.player(actor); if (player !== null) {
        player.gravityMultiplier = gravity;
        if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * gravity) };
      } else if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) entity.gravity = gravity; } return undefined; },
      localTime: () => { const time = new Date(); return { hour: time.getHours(), minute: time.getMinutes(), second: time.getSeconds() }; },
    };
    const itemHooks: Q2ItemHooks = { weaponPicked: (actor, item, first) => {
      const state = weapons.states.get(actor), definition = weapons.registeredDefinitions().find(value => value.item === item);
      if (state !== undefined && definition !== undefined && first) state.pending = definition.name;
      return undefined;
    }, silencer: (actor, charges) => { const state = weapons.states.get(actor); if (state === undefined) throw new Error("Silencer owner has no weapon state"); state.silencerShots += charges; return undefined; },
    powerArmor: (actor, kind) => this.events.message({ kind: "print", level: 2, text: `Power armor ${kind}\n` }, actor) };
    const playerHooks: Q2PlayerHooks = {
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.commandAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: player.ground.kind !== "none", ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
        standingBounds: player.standingBounds, animateQ2: player.character === "q2" }; },
      setMovement: (actor, change) => this.setPlayerMovement(actor, change),
      emit: event => { if (event.kind === "view") this.q2Views.set(event.actor, event.view); return this.events.emit(content, { kind: "q2-player", event }); },
      noise: (actor, origin) => { if (this.source.kind !== "q2") throw new Error("Q2 noise before source entry"); return this.source.monsters.reportNoise(actor, origin); }, weaponInput: actor => this.q2WeaponInput(this.requirePlayer(actor)), banned: () => false,
    };
    const host: Q2FoundationHost = { actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
      ...(this.random.rerelease === null ? {} : { rereleaseRandom: this.random.rerelease }),
      now: () => this.timeSeconds, frameSeconds: () => {
        const clock = providerTiming(recipe, recipe.map.entities.provider).clock;
        return clock.kind === "q2-classic" ? 0.1 : clock.kind === "q2-rerelease" ? clock.frameMilliseconds / 1000 : seconds(this.sourceFrame.elapsed);
      }, random: () => this.random.nextUnit(),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due),
      trace: request => this.physics.trace(request, "q2"), pointContents: point => this.contents(point, "q2"),
      inPvs: (a, b) => this.visible(a, b, "pvs"), inPhs: (a, b) => this.visible(a, b, "phs"),
      areasConnected: (a, b) => this.scene.areasConnected(this.scene.leafArea(this.scene.pointLeaf(a)), this.scene.leafArea(this.scene.pointLeaf(b))),
      nearby: (origin, radius) => this.actors.observations().map(value => value.id).filter(actor => { const body = this.bodies.read(actor); return body !== null && Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) <= radius; }).sort((a, b) => this.sourceOrder(a, b)),
      worldActor: () => { const actor = this.worldActor(); if (actor === null) throw new Error("Map has no source world actor"); return actor; },
      playerViewState: actor => { const player = this.player(actor); return player === null ? null : { viewAngles: player.viewAngles, oldVelocity: this.source.kind === "q2" ? this.source.players.states.get(actor)?.oldVelocity ?? zero : zero }; },
      prepareLevelChange: (map, landmark, serverFlags) => { this.levelChange = { map, landmark, serverFlags }; return undefined; },
      players: () => this.players(), isPlayer: actor => this.player(actor) !== null, isMonster: actor => this.source.kind === "q2" && ((this.source.game.entity(actor)?.serverFlags ?? 0) & 4) !== 0,
      touchTriggers: actor => this.physics.touchTriggers(actor),
      keyConsumed: actor => { if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) this.source.players.consumedKey(entity, this.source.game); } return undefined; },
      inlineModelBounds: model => this.scene.modelBounds(model), setSolid: (actor, solid, model) => this.physics.setSolid(actor, solid, model, "q2"),
      setMotion: motion => this.physics.setMotion(motion), setAreaPortal: (portal, open) => { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); return undefined; },
      emit: event => { if (event.kind === "model") this.sourceModels.set(event.actor, event); return this.events.emit(content, { kind: "q2", event }); },
      transition: intent => {
        if (!this.checkingQ2Rules && this.source.kind === "q2" && intent.kind === "campaign-level") {
          const change = this.levelChange;
          return this.source.players.beginIntermission(this.source.game, change?.map ?? intent.map.replace(/^q2:/, ""), change?.landmark ?? null);
        }
        this.transitions.push(intent); return undefined;
      }, diagnostic: message => this.events.message({ kind: "print", level: 2, text: message }) };
    const common: Q2CompositionCommon = { host, weapons, itemHooks, playerHooks, entityHooks,
      match: { kind: recipe.match.provider === "q2:ctf" ? "ctf" : recipe.match.provider === "q2:lmctf" ? "lmctf" : "standard" }, playerRules: { spawnPoint: this.options.travel?.spawnPoint ?? "" },
      options: { mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        skill: this.options.skill, mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients, provider: recipe.map.entities.provider,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider },
      services: { gravity: () => this.physics.gravity, hunterCamera: false, strongMines: false,
        emit: event => {
          if (event.kind === "grapple-prediction") {
            const player = this.requirePlayer(event.actor);
            if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease")
              player.state = { ...player.state, flags: event.suppressed ? player.state.flags | 64 : player.state.flags & ~64 };
            return undefined;
          }
          return this.events.emit(event.kind === "ctf" || event.kind === "lmctf" ? recipe.match.content : content, { kind: "q2-composition", event });
        },
        foreignPowerups: actor => { throw new Error(`Foreign arsenal powerups are not bound for ${this.requirePlayer(actor).arsenal.provider}`); } } };
    const selectedProgram = content.split(":")[2];
    const program = selectedProgram === "ctf" || selectedProgram === "lmctf" ? "baseq2" : selectedProgram;
    let product: Q2ProductRuntime;
    if (content.includes(":rerelease:")) {
      if (program !== "baseq2" && program !== "xatrix" && program !== "rogue" && program !== "mg2" && program !== "n64") throw new Error(`Unsupported Q2 rerelease program ${program}`);
      const rereleaseHooks: Q2RereleaseHooks = {
        lightStyle: style => this.events.lightStyle(style),
        emit: event => { if (event.kind === "screen-blend") { const view = this.q2Views.get(event.actor); if (view !== undefined) this.q2Views.set(event.actor, { ...view, blend: event.blend }); } return this.events.emit(content, { kind: "q2-rerelease", event }); },
        playerIdentity: actor => { const identity = this.options.playerIdentity; if (identity === undefined) throw new Error("Q2 rerelease admission requires session seat identity"); return identity(this.requirePlayer(actor).client); },
        clipTrigger: (trigger, actor, game) => {
          const body = this.bodies.read(actor), brush = game.body(trigger), model = sourceModel(trigger.model);
          if (body === null || model === null) throw new Error("Exact Q2 trigger clipping requires a brush model and live player body");
          const trace = this.scene.trace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds },
            target: { kind: "model", model, origin: brush.origin, angles: brush.angles }, policy: { kind: "q2", contentsMask: -1, leafContents: "stored" },
            numeric: providerTiming(recipe, recipe.map.entities.provider).numeric, passActor: actor });
          return trace.startSolid || trace.allSolid;
        }, navigation: () => ({ kind: "no-navigation" }),
        monstersSearching: player => { if (this.source.kind !== "q2") return false;
          for (const entity of this.source.game.entities.values()) {
            if ((entity.serverFlags & 4) === 0 || (this.combat.read(entity.actor.id)?.health ?? 0) <= 0) continue;
            const state = this.source.monsters.context(entity.actor.id)?.state;
            if (player === null ? entity.enemy !== null && !this.source.game.host.isPlayer(entity.enemy) : entity.enemy === null || !sameActor(entity.enemy, player)) continue;
            if (state?.lostSight && this.timeSeconds > state.trailTime + 5) continue;
            return true;
          } return false; },
        groundedOnWorld: actor => { const ground = this.requirePlayer(actor).ground, world = this.worldActor(); return ground.kind === "world" || ground.kind === "actor" && world !== null && sameActor(ground.actor, world); },
        pushPlayer: entityHooks.playerPush, setActorGravity: entityHooks.setActorGravity, setWorldGravity: gravity => this.setWorldGravity(gravity),
      };
      product = createQ2ProductRuntime({ ...common, edition: "rerelease", program, rereleaseHooks,
        ...(this.options.travel?.source.kind === "q2" && this.options.travel.source.rerelease !== undefined ? { campaign: this.options.travel.source.rerelease } : {}) });
    } else {
      if (program !== "baseq2" && program !== "xatrix" && program !== "rogue") throw new Error(`Unsupported Q2 classic program ${program}`);
      product = createQ2ProductRuntime({ ...common, edition: "classic", program });
    }
    return { kind: "q2", product, game: product.game, weapons, monsters: product.monsters, movers: product.movers, items: product.items, players: product.players, baseEntities: product.baseEntities };
  }

  private registerCombat(): undefined {
    const id = this.recipe.combat.provider;
    const armor = nativeVictimArmor(request => {
      const body = this.bodies.read(request.target), direction = body === null ? zero : subtract(request.point, body.origin);
      const length = Math.hypot(direction.x, direction.y, direction.z), yaw = (body?.angles.y ?? 0) * Math.PI / 180;
      return { arithmetic: "binary32", q2: { product: this.recipe.inventory.content.includes(":rerelease:") ? "rerelease" : "classic", ctf: this.recipe.match.provider === "q2:ctf", alive: (this.combat.read(request.target)?.health ?? 0) > 0 }, screenFacingDot: length === 0 ? 0 : (direction.x * Math.cos(yaw) + direction.y * Math.sin(yaw)) / length };
    });
    if (providerFamily(id) === "q1") this.combat.register(createQ1CombatPolicy({ id, armor, sourceEffects: {
      beforeQuad: (request, amount, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.beforeQuad?.(request, amount, target, attacker) ?? { kind: "continue", amount };
      }, afterQuad: (request, amount, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.afterQuad?.(request, amount, target, attacker) ?? { kind: "continue", amount };
      }, armorAllowed: (request, amount, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.armorAllowed?.(request, amount, target, attacker) ?? true;
      }, protectionApplies: (request, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.protectionApplies?.(request, target, attacker) ?? true;
      }, beforeHealth: (request, amount, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.beforeHealth?.(request, amount, target, attacker) ?? true;
      }, afterArmor: (request, amount, target, attacker) => {
        if (this.source.kind !== "q1") throw new Error("Q1 source damage effects are not attached");
        return this.source.game.damageSourceEffects.afterArmor?.(request, amount, target, attacker) ?? amount;
      } },
      context: request => { if (this.source.kind !== "q1") throw new Error("Q1 combat source is not attached"); return this.source.game.combatContext(request); } }));
    else if (providerFamily(id) === "q2") this.combat.register(createQ2CombatPolicy({ id, armor,
      ...(this.recipe.match.provider === "q2:ctf" || this.recipe.match.provider === "q2:lmctf" ? { sourceEffects: {
        beforeMomentum: (request, damage, target, attacker) => this.q2MatchDamageEffects().beforeMomentum?.(request, damage, target, attacker) ?? damage,
        powerArmorAllowed: (request, target, attacker) => this.q2MatchDamageEffects().powerArmorAllowed?.(request, target, attacker) ?? true,
        afterPowerArmor: (request, take, target, attacker) => this.q2MatchDamageEffects().afterPowerArmor?.(request, take, target, attacker) ?? take,
        armorAllowed: (request, target, attacker) => this.q2MatchDamageEffects().armorAllowed?.(request, target, attacker) ?? true,
        afterArmor: (request, take, target, attacker) => this.q2MatchDamageEffects().afterArmor?.(request, take, target, attacker) ?? take,
        afterHealth: (decision, current) => this.q2MatchDamageEffects().afterHealth?.(decision, current),
      } } : {}), context: request => ({ arithmetic: "binary32", player: this.player(request.target) !== null,
      monster: this.classname(request.target).startsWith("monster_"), attackerPlayer: request.attack.attacker !== null && this.player(request.attack.attacker) !== null,
      hasEnemy: this.source.kind === "q2" && (this.source.game.entity(request.target)?.enemy ?? null) !== null, easySkill: this.options.skill === 0, deathmatch: this.options.mode === "deathmatch",
      defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: !this.physics.isBrush(request.target), rejectTeamDamage: false, suppressPain: false }) }));
    return undefined;
  }

  private q2MatchDamageEffects() {
    if (this.source.kind !== "q2") throw new Error("Q2 match damage requires its source runtime");
    return this.source.product.match.sourceEffects(this.source.game);
  }

  private schedule(actor: OwnedActor, dueSeconds: number): undefined {
    const kind = providerTiming(this.recipe, actor.owner).clock.kind;
    return this.scheduler.schedule(actor, "world:think", { due: { kind: kind === "q2-rerelease" || kind === "q3" ? "milliseconds" : "seconds", value: kind === "q2-rerelease" || kind === "q3" ? dueSeconds * 1000 : dueSeconds },
      boundary: "during-physics", order: { actor: actor.id, provider: actor.owner, sequence: this.attackSequence++ } });
  }

  private sourceOrder(a: ActorId, b: ActorId): number {
    const left = this.sourcePosition(a), right = this.sourcePosition(b);
    return left[0] - right[0] || left[1] - right[1];
  }
  private sourcePosition(actor: ActorId): readonly [number, number] {
    const source = this.actors.sourceOf(actor);
    return [this.recipe.ordering.kind === "mixed" ? this.recipe.ordering.providers.indexOf(source?.provider ?? this.actors.observe(actor)?.owner ?? "world:unknown") : 0, source?.slot ?? actor.slot];
  }

  private collision(actor: OwnedActor): SharedSolid | null {
    const player = this.playerStates.get(actor);
    if (player !== undefined && (player.intermission || player.cutscene !== null)) return { family: providerFamily(player.profile.id), solid: "none", model: null, owner: null };
    if (player !== undefined && this.q2Characters.get(actor)?.state.gibbed) return { family: "q2", solid: "none", model: null, owner: null };
    if (player !== undefined) return { family: providerFamily(player.profile.id), solid: "box", model: null, owner: null };
    if (this.source.kind === "q1") {
      const entity = this.source.game.entity(actor.id); if (entity === null) return null;
      return { family: "q1", solid: entity.solid === "none" ? "none" : entity.solid === "trigger" ? "trigger" : entity.solid === "bsp" ? "brush" : "box",
        model: sourceModel(entity.model || entity.originalModel), owner: entity.owner, monster: entity.monster !== null, item: (entity.movementFlags & 256) !== 0 };
    }
    if (this.source.kind === "q2") {
      const entity = this.source.game.entity(actor.id); if (entity === null) return null;
      return { family: "q2", solid: entity.solid, model: sourceModel(entity.model), owner: entity.owner,
        monster: (entity.serverFlags & 4) !== 0, deadMonster: (entity.serverFlags & 2) !== 0 };
    }
    return null;
  }

  private contents(point: Vec3, family: "q1" | "q2"): number {
    const result = this.scene.pointContents({ point, target: { kind: "world" }, passActor: null,
      policy: family === "q1" ? { kind: "q1", move: "normal", hull: null } : { kind: "q2", contentsMask: -1, leafContents: "merged" },
      numeric: providerTiming(this.recipe, this.recipe.map.entities.provider).numeric });
    return result.kind === "q2" ? result.merged : result.contents;
  }

  private visible(a: Vec3, b: Vec3, kind: "pvs" | "phs"): boolean {
    return this.scene.clusterVisible(this.scene.leafCluster(this.scene.pointLeaf(a)), this.scene.leafCluster(this.scene.pointLeaf(b)), kind);
  }

  private checkClient(observer: OwnedActor): ActorId | null {
    const players = this.players();
    if (this.timeSeconds - this.checkClientAt >= 0.1) {
      this.checkClientAt = this.timeSeconds; this.checkedClient = null;
      for (let count = 0; count < players.length; count++) { this.checkClientIndex = (this.checkClientIndex + 1) % players.length;
        const candidate = players[this.checkClientIndex]; if (candidate !== undefined && (this.combat.read(candidate)?.health ?? 0) > 0 && !(this.source.kind === "q1" && this.source.composition.noTarget(candidate))) { this.checkedClient = candidate; break; } }
    }
    const candidate = this.checkedClient, source = this.bodies.read(observer.id), target = candidate === null ? null : this.bodies.read(candidate);
    return source !== null && target !== null && this.visible(add(target.origin, { x: 0, y: 0, z: this.player(candidate)?.viewHeight ?? 22 }), source.origin, "pvs") ? candidate : null;
  }

  private worldActor(): ActorId | null { return this.actors.atSource(this.recipe.map.entities.provider, this.options.world.kind === "q3-bsp" ? 1022 : 0)?.id ?? null; }
  private player(actor: ActorId | null): MovementPlayer | null { if (actor === null) return null; const owned = this.actors.resolveOwned(actor); return owned === null ? null : this.playerStates.get(owned) ?? null; }
  players(): readonly ActorId[] { return [...this.playerStates.values()].sort((a, b) => a.client.slot - b.client.slot).map(player => player.actor.id); }
  private classname(actor: ActorId): string { return this.player(actor) !== null ? "player" : this.source.kind === "q1" ? this.source.game.entity(actor)?.classname ?? "" : this.source.kind === "q2" ? this.source.game.entity(actor)?.classname ?? "" : ""; }

  private powerup(actor: OwnedActor, powerup: Q1Powerup, expires: number): undefined {
    if (powerup === "invulnerability") this.combat.setTraits(actor, { invulnerable: expires > this.timeSeconds });
    return undefined;
  }

  private weaponEvent(content: ContentId, event: Q2WeaponEvent): undefined {
    if (this.source.kind === "q2") this.source.players.weaponEvent(event);
    if (event.kind === "view-weapon") this.viewModels.set(event.actor, { path: event.model, frame: event.frame });
    return this.events.emit(content, { kind: "q2-weapon", event });
  }

  private createPlayer(actor: OwnedActor, client: ClientId, origin: Vec3, angles: Vec3, arsenal: ArsenalState): MovementPlayer {
    const player = new MovementPlayer(actor, client, this.recipe, { actors: this.actors, bodies: this.bodies, combat: this.combat, scene: this.scene, rereleaseMovement: this.physics.rereleaseMovement,
      weaponStep: input => this.weaponStep(input), animationStep: input => this.animationStep(input), touch: (contact, state) => this.touch(contact, state),
      worldActor: () => this.worldActor(), touchTriggers: owned => this.source.kind === "q3" ? undefined : this.physics.touchTriggers(owned), isBrush: id => this.physics.isBrush(id), jump: (owned, action) => this.jump(owned, action),
      q3Hooks: { firing: context => (context.command.buttons & 1) !== 0 && context.motion.health > 0,
        animation: (request, context) => context.animation.state.kind === "q3" ? q3SourceAnimation(request, context) : { animation: context.animation, effects: [] }, torso: context => context.animation.state.kind === "q3" ? q3SourceTorso(11, context, true) : { animation: context.animation, effects: [] },
        weapon: context => { const result = this.weaponStep({ actor: context.input.actor, command: context.input.command, frame: context.frame,
          arsenal: context.arsenal, animation: context.animation, environment: context.input.environment, gauntletHit: this.playerStates.get(context.input.actor)?.sourceMovement?.gauntletHit ?? false });
          const runtime = this.q3Arsenals.get(context.input.actor);
          return { ...result, movementFlags: runtime === undefined ? context.motion.pmFlags
            : (context.motion.pmFlags & ~(MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD)) | (runtime.respawned ? MoveFlags.RESPAWNED : 0) | (runtime.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0) };
        } } },
      origin, angles, arsenal);
    player.worldGravity = this.physics.gravity;
    if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: this.physics.gravity };
    return player;
  }

  prepareBotClient(client: ClientId): OwnedActor {
    this.assertOpen();
    if (this.source.kind !== "q3") throw new Error("Source bot admission requires a Q3 source runtime");
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients || [...this.playerStates.values()].some(player => player.client.slot === client.slot)) throw new Error("Bot client is not an available session slot");
    const actor = this.prepareQ3Client(client, this.source.game); this.source.game.prepareClient(actor, client.slot); return actor;
  }

  private prepareQ3Client(client: ClientId, source: Q3SourceRuntime): OwnedActor {
    const actor = this.actors.allocateAtSource(this.recipe.map.entities.provider, client.slot, this.recipe.character.definition.provider);
    const arsenal = q3SpawnLoadout(this.weaponProvider.provider, source.options.product, source.gameType === 3);
    const player = this.createPlayer(actor, client, zero, zero, arsenal);
    this.playerStates.set(actor, player);
    this.bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds: player.standingBounds, ground: null });
    this.combat.create(actor, q3InitialCombat("100", null)); this.inventory.create(actor, arsenal.ammo);
    return actor;
  }

  private admitQ3Player(client: ClientId, source: Q3SourceRuntime): PlayerAdmission {
    const actor = this.prepareQ3Client(client, source); source.admitPlayer(actor, client.slot);
    return { actor: actor.id, viewHeight: this.requirePlayer(actor.id).viewHeight };
  }

  private spawnQ3Player(entity: GameEntity, pose: SpawnPose): void {
    if (this.source.kind !== "q3") throw new Error("Q3 spawn before source attachment");
    const player = this.requirePlayer(entity.actor.id), product = this.source.game.options.product;
    player.arsenal = q3SpawnLoadout(this.weaponProvider.provider, product, this.source.game.gameType === 3);
    this.q3Arsenals.set(player.actor, q3SpawnArsenalRuntime(product, 100));
    player.bounds = player.standingBounds; player.viewHeight = player.character === "q3" ? 26 : 22;
    const body = { origin: pose.origin, angles: pose.angles, velocity: zero, bounds: player.standingBounds, ground: null };
    if (player.character === "q3") {
      let character = this.characters.get(player.actor);
      if (character === undefined) {
        character = new Q3CharacterActor(player.actor, this.recipe.character.definition.provider, product, {
          bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory, timeMilliseconds: () => Math.trunc(this.timeSeconds * 1000),
          emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event }),
          placement: "source-game",
          deathContext: actor => { const attack = this.lastAttack.get(actor); return { blood: true, noDrop: false,
            suicide: attack?.cause.kind === "q3" && attack.cause.meansOfDeath === 20,
            killerSourceSlot: attack?.attacker == null ? 1022 : this.actors.sourceOf(attack.attacker)?.slot ?? 1022 }; },
        }, this.deathAnimations);
        this.characters.set(player.actor, character);
      }
      character.spawn({ body, combat: q3InitialCombat("100", null), inventory: player.arsenal.ammo });
      player.animation = character.animation;
    } else {
      this.bodies.write(player.actor, body); this.combat.setHealth(player.actor, 100); this.combat.setTraits(player.actor, { canTakeDamage: true, invulnerable: false });
      for (const entry of this.inventory.entries(player.actor.id)) this.inventory.configure(player.actor, { ...entry, count: 0 });
      for (const entry of player.arsenal.ammo) this.inventory.configure(player.actor, entry);
      if (player.character === "q2") {
        const character = this.q2Characters.get(player.actor); if (character === undefined) this.attachQ2Character(player); else character.respawned();
      } else throw new Error("Q1 character lifecycle requires its foundation adjunct on Q3 maps");
    }
    this.setPlayerMovement(player.actor.id, { kind: "spawn", ...pose, velocity: zero, commandAngles: player.commandAngles, holdMilliseconds: 100, spectator: false }, false);
    const client = entity.client;
    if (client !== null) { client.ps.viewheight = player.viewHeight; client.ps.viewangles = pose.angles;
      if (player.arsenal.state.kind === "q3") { client.ps.weapon = player.arsenal.state.sourceWeapon; client.ps.weaponState = player.arsenal.state.state; client.ps.weaponTime = player.arsenal.state.timeMilliseconds; }
    }
  }

  private moveQ3Client(entity: GameEntity, command: Q3SourceCommand, options: ClientMovementOptions): ClientMovementResult {
    const player = this.requirePlayer(entity.actor.id), client = entity.client;
    if (client === null) throw new Error("Q3 movement has no client record");
    if (this.source.kind !== "q3") throw new Error("Q3 source movement owner is missing");
    if (player.state.kind === "q3") player.state = readQ3MovementState(entity, this.source.game.records);
    player.sourceEnvironment = readQ3MovementEnvironment(entity, { health: this.combat.read(entity.actor.id)?.health ?? 0,
      flight: false, haste: false, invulnerable: this.combat.read(entity.actor.id)?.invulnerable ?? false, gravityMultiplier: player.gravityMultiplier });
    const elapsed = Math.max(0, Math.min(200, command.serverTime - client.ps.commandTime));
    const pending = this.q3Commands.get(player.actor);
    const converted = selectedQ3Command(player.profile.kind === "q3" ? command : { ...command, angles: add(command.angles, client.ps.deltaAngles) }, player, elapsed);
    const before = pending === undefined ? command : q3SourceCommand(pending, player, this.sourceSchedulingMilliseconds);
    const sourceBefore = pending?.source.kind === "local-seat" ? { ...before, angles: subtract(before.angles, client.ps.deltaAngles) } : before;
    const input: ActorCommand = pending === undefined ? { actor: player.actor.id, sequence: player.lastSequence + 1,
      source: { kind: "bot", provider: this.recipe.map.entities.provider }, command: converted }
      : applyQ3CommandPolicy(pending, sourceBefore, command, converted,
        client.ps.pmType === MoveType.PM_FREEZE || client.ps.pmType === MoveType.PM_INTERMISSION || client.ps.pmType === MoveType.PM_SPINTERMISSION);
    player.sourceMovement = options;
    const lastSequence = player.lastSequence;
    const result = player.move(input, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: elapsed } });
    if (pending === undefined) player.lastSequence = lastSequence;
    if (result.status !== "active") return { contacts: [], bounds: player.bounds, waterlevel: player.waterLevel, watertype: player.waterType, xyspeed: 0 };
    if (player.profile.kind === "q2-classic" || player.profile.kind === "q2-rerelease") {
      const weapon = this.weaponStep({ actor: player.actor, command: input.command, frame: { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: elapsed } },
        arsenal: this.arsenal(player), animation: player.animation, environment: player.sourceEnvironment, gauntletHit: options.gauntletHit });
      player.arsenal = weapon.arsenal; player.animation = weapon.animation;
      for (const effect of weapon.effects) if (effect.kind === "event" && providerFamily(effect.value.provider) === "q3") client.ps.addEvent(effect.value.event, effect.value.parameter);
    }
    client.ps.commandTime = command.serverTime; client.ps.viewangles = player.viewAngles; client.ps.viewheight = player.viewHeight;
    client.ps.groundEntityNum = player.ground.kind === "world" ? 1022 : player.ground.kind === "actor" ? this.actors.sourceOf(player.ground.actor)?.slot ?? 1023 : 1023;
    if (player.state.kind === "q3") writeQ3MovementState(entity, player.state, this.source.game.records);
    if (player.animation.state.kind === "q3") { const animation = player.animation.state;
      client.ps.legsAnim = animation.legs; client.ps.torsoAnim = animation.torso; client.ps.legsTimer = animation.legsTimerMilliseconds; client.ps.torsoTimer = animation.torsoTimerMilliseconds;
      this.characters.get(player.actor)?.commitAnimation(player.animation);
    }
    writeQ3CharacterAnimation(entity, player.animation);
    for (const { effect } of result.effects) if (effect.kind === "event" && providerFamily(effect.value.provider) === "q3") client.ps.addEvent(effect.value.event, effect.value.parameter);
    return { contacts: result.contacts.flatMap(contact => contact.target.kind === "actor" ? [this.actors.sourceOf(contact.target.actor)?.slot ?? 1023] : contact.target.kind === "world" ? [1022] : []),
      bounds: player.bounds, waterlevel: player.waterLevel, watertype: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
      xyspeed: Math.hypot(result.state.kind === "q2-classic" ? result.state.velocityEighths[0] / 8 : result.state.velocity.x,
        result.state.kind === "q2-classic" ? result.state.velocityEighths[1] / 8 : result.state.velocity.y) };
  }

  private syncQ3Player(player: MovementPlayer): undefined {
    if (this.source.kind !== "q3") return undefined;
    const entity = this.source.game.records.byActor(player.actor.id), ps = entity?.client?.ps;
    if (entity === null || entity === undefined || ps === undefined) return undefined;
    const previous = player.viewAngles;
    player.viewAngles = { ...ps.viewangles };
    if (player.state.kind === "q3") player.state = readQ3MovementState(entity, this.source.game.records);
    else {
      const state = player.readState();
      if (state.kind === "q1-netquake") player.state = { ...state, viewAngles: player.viewAngles,
        teleportTimeSeconds: (ps.pmFlags & MoveFlags.TIME_KNOCKBACK) !== 0 ? this.timeSeconds + ps.pmTime / 1000 : state.teleportTimeSeconds };
      else player.state = state;
    }
    if (previous.x !== player.viewAngles.x || previous.y !== player.viewAngles.y || previous.z !== player.viewAngles.z)
      this.events.emit(this.recipe.map.entities.content, { kind: "view-reset", actor: player.actor.id, angles: player.viewAngles });
    return undefined;
  }

  admitPlayer(client: ClientId, travel: SimulationTravel | undefined = this.options.travel): PlayerAdmission {
    this.assertOpen();
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients) throw new Error("Client does not belong to an available session slot");
    for (const player of this.playerStates.values()) if (player.client.slot === client.slot) throw new Error("Client already has a player");
    const source = this.source;
    if (source.kind === "loading") throw new Error("Map spawn is incomplete");
    if (source.kind === "q3") return this.admitQ3Player(client, source.game);
    const actor = this.actors.allocateAtSource(this.recipe.map.entities.provider, client.slot + 1, this.recipe.character.definition.provider);
    const arsenal: ArsenalState = { provider: this.weaponProvider.provider, activeWeapon: null, ammo: [], state: source.kind === "q1"
      ? { kind: "q1", frame: 0, attackFinishedSeconds: 0, sourceWeapon: 1 }
      : { kind: "q2", gunFrame: 0, state: 0, pendingWeapon: null, machinegunShots: 0, grenadeTime: { kind: "seconds", value: 0 }, grenadeBlewUp: false } };
    const player = this.createPlayer(actor, client, zero, zero, arsenal);
    this.playerStates.set(actor, player);
    const body = { origin: movementOrigin(player.state), angles: zero, velocity: zero, bounds: player.bounds, ground: null };
    this.bodies.create(actor, body);
    const entity = source.kind === "q2" ? source.game.attachPlayer(actor) : null;
    if (entity !== null) { entity.viewHeight = player.viewHeight; entity.solid = "box"; }
    if (player.character === "q3") {
      this.characterStarts.set(actor, null);
      const character = new Q3CharacterActor(actor, this.recipe.character.definition.provider, "baseq3", { bodies: this.bodies, callbacks: this.callbacks,
        combat: this.combat, inventory: this.inventory, timeMilliseconds: () => Math.trunc(this.timeSeconds * 1000),
        emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event }),
        placement: "source-game", deathContext: owned => {
          const attack = this.lastAttack.get(owned); return { blood: true, noDrop: false,
            suicide: attack?.cause.kind === "q3" && attack.cause.meansOfDeath === 20,
            killerSourceSlot: attack?.attacker === null || attack?.attacker === undefined ? 1022 : this.actors.sourceOf(attack.attacker)?.slot ?? 1022 };
        } }, this.deathAnimations);
      this.characters.set(actor, character);
      character.spawn({ body, combat: q3InitialCombat("100", null), inventory: [] });
      player.animation = character.animation;
    } else {
      this.combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
      this.inventory.create(actor, []);
    }
    if (source.kind === "q1") { source.game.attachPlayer(actor); source.composition.attach(actor, { slot: client.slot, userinfo: new Map([["name", `Player ${client.slot + 1}`], ["topcolor", "0"], ["bottomcolor", "0"]]) }); }
    else { source.items.configurePlayer(actor, source.game, true); if (entity !== null) {
      source.product.admit(actor, { slot: client.slot, userinfo: `\\name\\Player ${client.slot + 1}\\skin\\male/grunt`, initializeInventory: false }, travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot ? { ...travel.source.landmark, player: actor.id } : null);
    } }
    if (player.character === "q1" && source.kind === "q1") {
      const character = new Q1CharacterActor(source.game, actor, { requestRespawn: () => this.respawnPlayer(player), dropInventory: () => this.dropPlayerInventory(player), sourcePose: () => source.composition.characterPose(actor.id), fallDamageAllowed: () => source.composition.fallDamageAllowed(actor.id) });
      this.q1Characters.set(actor, character);
      this.callbacks.bind(actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction.attacker, reaction.damage), die: reaction => character.die(reaction.attacker) });
    }
    if (player.character === "q2" && source.kind === "q1") this.attachQ2Character(player);
    const carried = travel?.players.find(record => record.client.slot === client.slot && record.client.generation === client.generation)?.state;
    if (source.kind === "q1" && carried?.kind === "q1") source.composition.admitTravel(actor, carried.carry);
    else if (source.kind === "q2" && carried?.kind === "q2" && entity !== null) source.players.restoreCarry(entity, source.game, carried.carry);
    player.state = player.readState();
    player.arsenal = this.arsenal(player);
    if (source.kind === "q1") {
      const selected = source.composition.selectSpawn(actor.id); if (selected === null) throw new Error("Source player spawn is deferred");
      const spot = source.game.body(selected); this.characterStarts.set(actor, selected.actor.id);
      this.setPlayerMovement(actor.id, { kind: "spawn", origin: add(spot.origin, { x: 0, y: 0, z: 1 }), velocity: zero, angles: spot.angles, commandAngles: player.commandAngles, holdMilliseconds: 0, spectator: false });
      this.killBox(actor); this.bodies.link(actor); source.game.useTargets(selected, actor.id);
      source.composition.spawned(actor.id, true); this.entryCarry.set(actor, source.composition.captureTravel(actor)); }
    if (source.kind === "q2") this.resumeQ2Presentation(actor.id);
    return { actor: actor.id, viewHeight: player.viewHeight };
  }

  private resumeQ2Presentation(actor: ActorId | null = null): undefined {
    if (this.source.kind !== "q2" || this.source.product.rerelease === null) return undefined;
    const source = this.source.product.rerelease, content = this.recipe.map.entities.content;
    this.events.emit(content, { kind: "q2-rerelease", event: { kind: "sky", ...source.entities.sky } });
    this.events.emit(content, { kind: "q2-rerelease", event: { kind: "story", text: source.entities.story } });
    for (const [player, state] of source.players.rereleaseStates) if (actor === null || sameActor(actor, player)) {
      this.events.emit(content, { kind: "q2-rerelease", event: { kind: "fog", actor: player, value: state.fog, transitionMilliseconds: 0 } });
      this.events.emit(content, { kind: "q2-rerelease", event: { kind: "flashlight", actor: player, enabled: state.flashlight } });
    } return undefined;
  }

  private attachQ2Character(player: MovementPlayer): undefined {
    const content = this.recipe.character.definition.content;
    const character = new Q2CharacterActor(player.actor, { bodies: this.bodies, combat: this.combat, inventory: this.inventory,
      now: () => this.timeSeconds, random: () => this.random.nextUnit(),
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.commandAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: player.ground.kind !== "none", ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
        standingBounds: player.standingBounds, animateQ2: true }; },
      pointContents: point => this.contents(point, "q2"), powerups: actor => {
        const powers = this.source.kind === "q1" ? this.source.game.player(actor)?.powerups : undefined;
        return { quadUntil: powers?.get("quad") ?? 0, invulnerabilityUntil: powers?.get("invulnerability") ?? 0, breatherUntil: powers?.get("suit") ?? 0, enviroUntil: powers?.get("suit") ?? 0 };
      }, weapon: actor => { const player = this.requirePlayer(actor); return { q2Name: null, ammo: this.playerUi(actor).ammo?.item ?? null,
        kickAngles: player.state.kind === "q1-netquake" ? player.state.punchAngles : zero, kickOrigin: zero, loopSound: "" }; },
      emit: event => this.events.emit(content, { kind: "q2", event }), view: (actor, view) => { this.q2Views.set(actor, view); return undefined; },
      noise: (actor, origin) => { if (this.source.kind === "q2") this.source.monsters.reportNoise(actor, origin); return undefined; },
      environmentDamage: (actor, amount, means, flags) => { const body = this.bodies.read(actor.id); if (body === null) return undefined;
        this.combat.apply({ target: actor.id, amount, knockback: 0, direction: zero, point: body.origin, normal: zero, delivery: "direct",
          attack: { sequence: this.attackSequence++, time: this.sourceFrame.time, attacker: this.worldActor(), inflictor: this.worldActor(), weapon: null,
            weaponProvider: this.weaponProvider.provider, combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider,
            cause: { kind: "q2", meansOfDeath: means, damageFlags: flags } } }); return undefined; },
      died: () => this.dropPlayerInventory(player), requestRespawn: () => this.respawnPlayer(player),
      motion: (actor, kind, solid) => { const character = this.q2Characters.get(actor); if (character !== undefined) { character.entity.motion = kind; character.entity.solid = solid; }
        if (player.state.kind === "q1-netquake") player.state = { ...player.state, moveType: kind === "bounce" ? 10 : 6 };
        return this.physics.setSolid(actor, solid, null, "q2"); }, spawnGib: gib => this.spawnCharacterGib(gib),
    }, { model: `players/${this.recipe.character.appearance.provider.split("/").at(-1) ?? "male"}/tris.md2`, skin: 0, slot: player.client.slot,
      mode: this.options.mode, deathmatchFlags: 0, environment: false, edition: content.includes(":rerelease:") ? "rerelease" : "classic" });
    this.q2Characters.set(player.actor, character);
    this.callbacks.bind(player.actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction), die: reaction => character.die(reaction) });
    return undefined;
  }

  private spawnCharacterGib(gib: Q2CharacterGib): undefined {
    const actor = this.actors.allocate(this.recipe.character.definition.provider, "q2:character-gib");
    this.bodies.create(actor, { origin: gib.origin, velocity: gib.velocity, angles: zero, bounds: { min: zero, max: zero }, ground: null });
    this.physics.setSolid(actor, "none", null, "q2");
    this.physics.setMotion({ actor, velocity: gib.velocity, angularVelocity: gib.angularVelocity, kind: "toss", gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 3, owner: null });
    this.callbacks.bind(actor, { think: self => this.actors.release(self), touch: null, use: null, pain: null, die: null });
    this.detachedModels.set(actor, { content: this.recipe.character.definition.content, path: gib.model });
    this.schedule(actor, gib.expiresAt); this.bodies.link(actor); return undefined;
  }

  private dropPlayerInventory(player: MovementPlayer): undefined {
    if (this.source.kind !== "q1" || this.options.mode === "singleplayer") return undefined;
    this.source.composition.dropInventory(player.actor); return undefined;
  }

  private respawnPlayer(player: MovementPlayer): undefined {
    if (this.source.kind === "q2") { const entity = this.source.game.entity(player.actor.id); return entity === null ? undefined : this.source.players.respawn(entity, this.source.game); }
    if (this.source.kind !== "q1") throw new Error("Respawn before source entry");
    return this.source.composition.requestRespawn(player.actor.id, this.entryCarry.get(player.actor) ?? null);
  }

  private placeQ1Player(player: MovementPlayer, start: import("../../../content/q1/foundation/entity.ts").Q1Actor, travel: Q1TravelState): undefined {
    if (this.source.kind !== "q1") throw new Error("Q1 placement before source entry");
    const body = this.bodies.read(player.actor.id), spot = this.source.game.body(start); if (body === null) throw new Error("Respawn player body missing");
    this.bodies.write(player.actor, { ...body, bounds: player.standingBounds }); player.bounds = player.standingBounds; player.viewHeight = player.character === "q3" ? 26 : 22;
    this.source.composition.admitTravel(player.actor, travel);
    this.combat.setTraits(player.actor, { canTakeDamage: true, invulnerable: false });
    this.setPlayerMovement(player.actor.id, { kind: "spawn", origin: add(spot.origin, { x: 0, y: 0, z: 1 }), velocity: zero, angles: spot.angles, commandAngles: player.commandAngles, holdMilliseconds: 0, spectator: false });
    this.q2Characters.get(player.actor)?.respawned(); this.q1Characters.get(player.actor)?.respawn(); this.killBox(player.actor);
    return undefined;
  }

  private killBox(actor: OwnedActor): undefined {
    const body = this.bodies.read(actor.id);
    if (body === null) throw new Error("Spawned player has no body");
    for (const candidate of this.actors.observations()) {
      if (sameActor(candidate.id, actor.id) || !(this.combat.read(candidate.id)?.canTakeDamage ?? false)) continue;
      const other = this.bodies.read(candidate.id);
      if (other === null || body.origin.x + body.bounds.min.x > other.origin.x + other.bounds.max.x || body.origin.x + body.bounds.max.x < other.origin.x + other.bounds.min.x
        || body.origin.y + body.bounds.min.y > other.origin.y + other.bounds.max.y || body.origin.y + body.bounds.max.y < other.origin.y + other.bounds.min.y
        || body.origin.z + body.bounds.min.z > other.origin.z + other.bounds.max.z || body.origin.z + body.bounds.max.z < other.origin.z + other.bounds.min.z) continue;
      this.combat.apply({ attack: { sequence: this.attackSequence++, time: this.sourceFrame.time, attacker: actor.id, inflictor: actor.id, weapon: null,
        weaponProvider: this.weaponProvider.provider, combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider,
        cause: this.source.kind === "q1" ? { kind: "q1", deathType: "telefrag" } : { kind: "q2", meansOfDeath: 21, damageFlags: 32 } }, target: candidate.id,
        amount: 100000, knockback: 0, direction: zero, point: body.origin, normal: zero, delivery: "direct" });
    }
    return undefined;
  }

  private arsenal(player: MovementPlayer): ArsenalState {
    if (this.source.kind === "q3") return { ...player.arsenal, ammo: this.inventory.entries(player.actor.id) };
    if (this.source.kind === "q1") {
      const state = this.source.game.player(player.actor.id);
      if (state === null) throw new Error("Q1 player has no arsenal");
      return { provider: this.weaponProvider.provider, activeWeapon: this.source.game.weaponItem(state.weapon), ammo: this.inventory.entries(player.actor.id),
        state: { kind: "q1", frame: state.weaponFrame, attackFinishedSeconds: state.attackFinished, sourceWeapon: isQ1BaseWeapon(state.weapon) ? 1 << Q1_WEAPONS.indexOf(state.weapon) : 0 } };
    }
    if (this.source.kind !== "q2") throw new Error("Arsenal accessed before source admission");
    const state = this.source.weapons.states.get(player.actor.id);
    if (state === undefined) throw new Error("Q2 player has no arsenal");
    return { provider: this.weaponProvider.provider, activeWeapon: state.weapon === null ? null : this.source.weapons.definition(state.weapon).item, ammo: this.inventory.entries(player.actor.id),
      state: { kind: "q2", gunFrame: state.frame, state: state.phase === "ready" ? 0 : state.phase === "activating" ? 1 : state.phase === "dropping" ? 2 : 3,
        pendingWeapon: state.pending === null ? null : this.source.weapons.definition(state.pending).item, machinegunShots: state.machinegunShots,
        grenadeTime: { kind: "seconds", value: state.grenadeTime }, grenadeBlewUp: state.grenadeBlewUp } };
  }

  private weaponStep(input: WeaponStepInput): WeaponStepResult {
    const player = this.playerStates.get(input.actor);
    if (player === undefined) throw new Error("Weapon input has no admitted player");
    if (this.source.kind === "q3") {
      const entity = this.source.game.records.byActor(player.actor.id), runtime = this.q3Arsenals.get(player.actor);
      if (entity?.client == null || runtime === undefined) throw new Error("Q3 arsenal has no source client state");
      const ps = entity.client.ps;
      const result = stepQ3Arsenal({ ...input, arsenal: this.arsenal(player), gauntletHit: player.sourceMovement?.gauntletHit ?? input.gauntletHit }, readQ3ArsenalRuntime(entity, runtime),
        resolveQ3ArsenalControls(this.arsenal(player), player.arsenalIntent, input.command, runtime.product));
      this.q3Arsenals.set(player.actor, result.runtime); player.arsenal = result.arsenal;
      writeQ3ArsenalRuntime(entity, result.runtime);
      for (const entry of result.arsenal.ammo) this.inventory.configure(player.actor, entry);
      if (result.arsenal.state.kind === "q3") { ps.weapon = result.arsenal.state.sourceWeapon; ps.weaponState = result.arsenal.state.state; ps.weaponTime = result.arsenal.state.timeMilliseconds; }
      this.characters.get(player.actor)?.commitAnimation(result.animation);
      return result;
    }
    if (this.source.kind === "q1") this.playerWeapon(player);
    return { arsenal: this.arsenal(player), animation: this.characters.get(input.actor)?.animation ?? input.animation, effects: [] };
  }

  private playerWeapon(player: MovementPlayer): undefined {
    if (player.cutscene !== null) return undefined;
    const source = this.source, pressed = (player.buttons & 1) !== 0;
    if (source.kind === "q1") { source.composition.impulse(player.actor.id); if (source.game.weaponInput(player.actor, pressed, player.viewAngles, this.timeSeconds, player.waterLevel)) source.composition.fired(player.actor.id, this.arsenal(player).activeWeapon); }
    else if (source.kind === "q2") { const entity = source.game.entity(player.actor.id); if (entity !== null) { source.product.match.beforePlayer(entity, source.game); source.players.beginFrame(entity, source.game); } }
    return undefined;
  }

  private q2WeaponInput(player: MovementPlayer) {
    const pressed = (player.buttons & 1) !== 0;
    return { attack: pressed, latchedAttack: pressed && (player.previousButtons & 1) === 0, holster: false, angles: player.viewAngles,
      ducked: player.bounds.max.z < player.standingBounds.max.z, spectator: this.source.kind === "q2" && this.source.players.states.get(player.actor.id)?.spectator === true, notarget: false, hand: "right", animatePlayer: player.character === "q2",
      quadUntil: this.source.kind === "q2" ? this.source.items.playerPowerups(player.actor.id).quadUntil : 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false,
      instantSwitch: false, quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: this.physics.gravity, weaponThunk: false } satisfies import("../../../content/q2/foundation/weapons/types.ts").Q2WeaponInput;
  }

  private setPlayerMovement(actor: ActorId, change: Q2PlayerMovementChange, link = true): undefined {
    const player = this.requirePlayer(actor), body = this.bodies.read(actor);
    if (body === null) throw new Error("Player has no body");
    const state = player.readState();
    if (change.kind === "noclip") {
      player.state = state.kind === "q1-netquake" ? { ...state, moveType: change.enabled ? 8 : 3 }
        : state.kind === "q2-classic" || state.kind === "q2-rerelease" ? { ...state, type: change.enabled ? 1 : 0 }
          : state.kind === "q3" ? { ...state, movementType: change.enabled ? 1 : 0 } : { ...state, spectator: change.enabled ? 1 : 0 };
      return undefined;
    }
    player.viewAngles = change.angles;
    if (change.kind === "spawn") player.cutscene = null;
    player.intermission = change.kind === "freeze";
    if (change.kind === "freeze") this.combat.setTraits(player.actor, { canTakeDamage: false });
    const velocity = change.kind === "freeze" ? zero : change.velocity;
    this.bodies.write(player.actor, { ...body, origin: change.origin, velocity, angles: change.angles, ground: null });
    player.ground = { kind: "none" };
    if (state.kind === "q1-netquake") player.state = { ...state, origin: change.origin, oldOrigin: change.origin, velocity, viewAngles: change.angles,
      angles: change.angles, flags: state.flags & ~512, moveType: change.kind === "spawn" ? 3 : change.kind === "freeze" ? 0 : state.moveType, ground: { kind: "none" }, fixAngle: false, teleportTimeSeconds: this.timeSeconds + (change.kind === "freeze" ? 0 : change.holdMilliseconds / 1000) };
    else if (state.kind === "q2-classic") player.state = { ...state, originEighths: [Math.trunc(change.origin.x * 8), Math.trunc(change.origin.y * 8), Math.trunc(change.origin.z * 8)],
      velocityEighths: [Math.trunc(velocity.x * 8), Math.trunc(velocity.y * 8), Math.trunc(velocity.z * 8)], flags: change.kind === "freeze" ? state.flags : (change.kind === "spawn" ? 0 : state.flags & ~56) | (change.holdMilliseconds > 0 ? 32 : 0),
      timeEightMilliseconds: change.kind === "freeze" ? 0 : Math.trunc(change.holdMilliseconds / 8), deltaAngleShorts: [0, 0, 0], type: change.kind === "freeze" ? 4 : 0 };
    else if (state.kind === "q2-rerelease") player.state = { ...state, origin: change.origin, velocity, flags: change.kind === "freeze" ? state.flags : (change.kind === "spawn" ? 0 : state.flags & ~56) | (change.holdMilliseconds > 0 ? 32 : 0),
      timeMilliseconds: change.kind === "freeze" ? 0 : change.holdMilliseconds, deltaAngles: zero, type: change.kind === "freeze" ? 5 : 0 };
    else if (state.kind === "q3") player.state = { ...state, origin: change.origin, velocity, viewAngles: change.angles, movementType: change.kind === "freeze" ? 4 : 0, ground: { kind: "none" } };
    else player.state = { ...state, origin: change.origin, velocity, angles: change.angles, ground: { kind: "none" } };
    const character = this.characters.get(player.actor);
    if (change.kind === "spawn" && character !== undefined && (character.sourceFlags & 1) !== 0) {
      const current = this.bodies.read(actor);
      if (current === null) throw new Error("Respawning character has no body");
      character.spawn({ body: { ...current, bounds: player.standingBounds }, combat: q3InitialCombat("100", null), inventory: this.inventory.entries(actor) });
      player.bounds = player.standingBounds; player.viewHeight = 26; player.animation = character.animation;
    }
    if (link) this.bodies.link(player.actor);
    this.events.emit(this.recipe.map.entities.content, { kind: "view-reset", actor, angles: change.angles });
    return undefined;
  }

  private animationStep(input: AnimationStepInput): AnimationStepResult {
    const character = this.characters.get(input.actor);
    if (character !== undefined) {
      const result = stepQ3CharacterAnimation({ ...input, animation: character.animation }, "baseq3", (this.combat.read(input.actor.id)?.health ?? 0) <= 0, character.eventSequence);
      character.commitAnimation(result.animation); return result;
    }
    return { animation: input.animation, effects: [] };
  }

  private touch(contact: MovementTouchContact, state: MovementState): MovementContinuation {
    const player = this.playerStates.get(contact.self);
    if (player === undefined) return { kind: "actor-removed" };
    if (this.source.kind === "q3") return { kind: "continue", state };
    player.commit(state, false, false);
    const other = contact.other.kind === "actor" ? contact.other.actor : this.worldActor();
    if (other !== null) {
      const { sourceTrace, ...sharedContact } = contact;
      if (state.kind === "q2-classic" || state.kind === "q2-rerelease") {
        // Q2 ClientThink invokes only the touched entity's callback.
        const owner = this.actors.resolveOwned(other);
        if (owner !== null) this.callbacks.touch({ ...sharedContact, self: owner, other: contact.self.id,
          ...(sourceTrace === undefined ? {} : { sourceTrace: { ...sourceTrace, ent: other } }) });
      } else {
        this.callbacks.touch({ ...sharedContact, other });
        const owner = this.actors.resolveOwned(other);
        if (owner !== null && this.actors.isLive(contact.self.id)) this.callbacks.touch({ ...sharedContact, self: owner, other: contact.self.id });
      }
    }
    return this.actors.isLive(contact.self.id) ? { kind: "continue", state: player.readState() } : { kind: "actor-removed" };
  }

  private jump(actor: OwnedActor, action: "jump" | "swim"): undefined {
    return this.events.emit(this.recipe.movement.content, { kind: "q1", event: { kind: "sound", actor: actor.id,
      path: action === "jump" ? "player/plyrjmp8.wav" : "misc/water1.wav", channel: "body", volume: 1, attenuation: 1 } });
  }

  step(input: InputBatch): SimulationOutput {
    this.assertOpen();
    if (this.stepping) throw new Error("Simulation step is already running");
    if (!Number.isFinite(input.elapsedMilliseconds) || input.elapsedMilliseconds < 0) throw new RangeError("Host elapsed time must be finite and nonnegative");
    this.stepping = true;
    try {
      for (const command of input.commands) {
        const player = this.player(command.actor);
        if (player === null) throw new Error("Command targets an unadmitted player");
        if (command.source.kind !== "bot" && (command.source.client.slot !== player.client.slot || command.source.client.generation !== player.client.generation || !this.options.identity.owns(command.source.client))) throw new Error("Command client does not own this player");
      }
      this.hostMilliseconds += input.elapsedMilliseconds;
      const lmctf = this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf ? this.source.product.match.source : null;
      const paused = lmctf?.match.paused === true;
      if (!paused) this.sourceSchedulingMilliseconds += input.elapsedMilliseconds;
      const profile = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
      const fixed = profile.kind === "q2-classic" ? 100 : profile.kind === "q2-rerelease" ? profile.frameMilliseconds : profile.kind === "q3" ? profile.serverFrameMilliseconds : null;
      const run = !paused && (fixed === null || this.sourceSchedulingMilliseconds >= this.timeSeconds * 1000);
      const elapsed = fixed === null ? Math.min(0.1, Math.max(0.001, input.elapsedMilliseconds / 1000)) : fixed / 1000;
      if (run) {
        if (fixed === null) this.sourceFrame = { ...this.clock.frame, elapsed: { kind: "seconds", value: elapsed }, phase: "frame-entry" };
        else this.sourceFrame = this.clock.advance({ kind: this.clock.frame.time.kind, value: this.clock.frame.time.kind === "seconds" ? elapsed : fixed });
        if (this.source.kind === "q2" && this.source.product.rerelease?.players.intermissionFadeUntil != null) {
          this.checkingQ2Rules = true;
          try { this.source.product.rerelease.players.fadeFrame(this.source.game); } finally { this.checkingQ2Rules = false; }
          this.sourceFrame = this.clock.enter("frame-exit");
          if (this.sourceSchedulingMilliseconds > this.timeSeconds * 1000) this.sourceSchedulingMilliseconds = this.timeSeconds * 1000;
          emitQ2ShadowLights(this.source.game);
          return { snapshot: this.snapshot(), events: this.events.take() };
        }
        if (this.source.kind === "q1") {
          this.setWorldGravity(this.source.cvars.variableValue("sv_gravity"));
          this.source.game.beginFrame(this.timeSeconds, elapsed); this.source.composition.preFrame(elapsed);
          for (const player of this.playerStates.values()) {
            const command = [...input.commands].reverse().find(value => sameActor(value.actor, player.actor.id) && value.sequence > player.lastSequence)?.command;
            const jump = command === undefined ? (player.buttons & 2) !== 0 : command.kind === "q1-netquake" ? (command.buttons & 2) !== 0
              : command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 : command.upMove > 0;
            this.source.composition.input(player.actor.id, { attack: player.cutscene === null && ((command?.buttons ?? player.buttons) & 1) !== 0, jump: player.cutscene === null && jump,
              use: ((command?.buttons ?? player.buttons) & 4) !== 0, impulse: command !== undefined && "impulse" in command ? command.impulse : 0 });
            this.source.composition.playerPreThink(player.actor.id);
            this.source.game.playerFrame(player.actor, this.timeSeconds, player.waterLevel);
          }
        }
      }
      if (this.source.kind === "q2" && this.source.product.rerelease?.players.intermissionFadeUntil != null) {
        emitQ2ShadowLights(this.source.game);
        return { snapshot: this.snapshot(), events: this.events.take() };
      }
      const botCommands = run && this.source.kind === "q3" ? this.botServices.frame(this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : Math.trunc(this.timeSeconds * 1000), elapsed * 1000) : [];
      for (const received of [...input.commands, ...botCommands]) {
        const command = paused ? { ...received, command: { ...received.command, buttons: received.command.buttons & ~1 } } : received;
        const player = this.player(command.actor);
        if (player === null) throw new Error("Command targets an unadmitted player");
        if (command.sequence <= player.lastSequence) continue;
        if (paused && lmctf !== null && !lmctf.canMove(player.actor.id)) {
          player.lastSequence = command.sequence;
          continue;
        }
        if (player.cutscene !== null) {
          player.previousButtons = player.buttons; player.buttons = command.command.buttons; player.lastSequence = command.sequence;
          continue;
        }
        if (this.source.kind === "q1" && this.source.game.intermission !== null) {
          player.previousButtons = player.buttons; player.buttons = command.command.buttons; player.lastSequence = command.sequence;
          this.source.composition.requestIntermissionExit(player.buttons !== 0);
          continue;
        }
        if (this.source.kind === "q3") {
          this.q3Commands.set(player.actor, command);
          try { this.source.game.playerThink(command); } finally { this.q3Commands.delete(player.actor); }
          this.syncQ3Player(player);
        } else {
          const gravityMultiplier = player.gravityMultiplier;
          const matchGravity = this.source.kind === "q2" ? this.source.product.match.gravityScale(player.actor.id) : 1;
          player.gravityMultiplier *= matchGravity;
          if (this.source.kind === "q2" && (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3"))
            player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * player.gravityMultiplier) };
          try { const moved = player.move(command, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: player.profile.kind === "q1-netquake" ? Math.min(100, Math.max(1, input.elapsedMilliseconds)) : input.elapsedMilliseconds } });
          if (this.source.kind === "q2" && moved.kind === "q2-rerelease" && moved.status === "active") this.source.product.movementImpact(player.actor.id, moved.impactDelta, (moved.state.flags & 128) !== 0);
          } finally { player.gravityMultiplier = gravityMultiplier; }
        }
        if (this.source.kind === "q1" && this.actors.isLive(player.actor.id)) { this.source.game.playerAfterPhysics(player.actor, this.timeSeconds); this.source.composition.playerPostThink(player.actor.id); }
        if (!paused && this.source.kind === "q2" && this.actors.isLive(player.actor.id)) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) this.source.players.afterClientThink(entity, this.source.game); }
        this.q2Characters.get(player.actor)?.afterClientThink();
        const q1Character = this.q1Characters.get(player.actor); if (q1Character !== undefined) q1Character.postMove();
      }
      if (run) {
        if (this.source.kind === "q2") this.source.monsters.beginFrame(this.source.game);
        if (this.source.kind === "q3") this.source.game.beginFrame(this.sourceFrame);
        const visited = new Set<OwnedActor>();
        let cursor: readonly [number, number] | null = null;
        for (;;) {
          const previous = cursor;
          const actor = this.actors.observations().map(value => this.actors.resolveOwned(value.id)).filter((value): value is OwnedActor => {
            if (value === null || visited.has(value)) return false;
            const position = this.sourcePosition(value.id);
            return previous === null || position[0] > previous[0] || position[0] === previous[0] && position[1] > previous[1];
          }).sort((a, b) => this.sourceOrder(a.id, b.id))[0];
          if (actor === undefined) break;
          cursor = this.sourcePosition(actor.id);
          visited.add(actor);
          if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) {
            this.bodies.link(actor); this.physics.touchTriggers(actor);
            if (!this.actors.isLive(actor.id)) continue;
          }
          if (this.source.kind === "q3") { this.source.game.runActor(actor); const player = this.playerStates.get(actor); if (player !== undefined) this.syncQ3Player(player); continue; }
          if (this.playerStates.has(actor)) {
            this.q2Characters.get(actor)?.beginFrame();
            this.playerWeapon(this.playerStates.get(actor) ?? this.requirePlayer(actor.id)); continue;
          }
          if (this.source.kind === "q1") {
            const entity = this.source.game.entity(actor.id), pusher = entity?.movement === "push", step = entity?.movement === "step";
            if (!pusher && !step) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
            if (this.actors.isLive(actor.id)) {
              if (entity?.movement === "noclip") { const body = this.bodies.read(actor.id);
                if (body !== null) { this.bodies.write(actor, { ...body, origin: add(body.origin, { x: body.velocity.x * elapsed, y: body.velocity.y * elapsed, z: body.velocity.z * elapsed }),
                  angles: add(body.angles, { x: entity.angularVelocity.x * elapsed, y: entity.angularVelocity.y * elapsed, z: entity.angularVelocity.z * elapsed }) }); this.bodies.link(actor); }
              } else if (entity === null || step) {
                this.physics.step(actor, elapsed);
                if (entity !== null) entity.movementFlags = (entity.movementFlags & ~512) | (this.bodies.read(actor.id)?.ground == null ? 0 : 512);
              }
              else this.source.game.physicsEntity(actor, this.timeSeconds, elapsed);
            }
            if ((pusher || step) && this.actors.isLive(actor.id)) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
            if (step && entity !== null && this.actors.isLive(actor.id)) this.source.game.checkWaterTransition(entity);
          } else if (this.source.kind === "q2") {
            const source = this.source;
            source.game.runActor(actor.id, () => {
              source.game.prePhysics(actor.id);
              if (!this.actors.isLive(actor.id)) return undefined;
              const entity = source.game.entity(actor.id);
              if (entity?.motion === "push" || entity?.motion === "stop") {
                const team = source.game.pushTeam(actor.id);
                const master = team[0];
                if (master !== undefined && !sameActor(master.id, actor.id)) return undefined;
                for (const member of team) visited.add(member);
                const blocked = this.physics.pushTeam(team, elapsed);
                if (blocked !== null) {
                  for (const member of team) { const pending = this.scheduler.pending(member.id);
                    if (pending !== null && this.actors.isLive(member.id)) {
                      const due = { kind: pending.timing.due.kind, value: pending.timing.due.value + (pending.timing.due.kind === "seconds" ? elapsed : elapsed * 1000) };
                      this.scheduler.schedule(member, pending.callback, { ...pending.timing, due });
                      const part = source.game.entity(member.id); if (part !== null) part.nextThink = seconds(due);
                    } }
                } else for (const member of team) if (this.actors.isLive(member.id)) this.scheduler.run(member.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
                for (const member of team) if (this.actors.isLive(member.id)) source.game.postPhysics(member.id);
                return undefined;
              }
              const after = entity?.motion === "step";
              if (!after) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
              const moved = this.actors.isLive(actor.id) ? this.physics.step(actor, elapsed) : undefined;
              if (entity !== null && entity !== undefined && this.actors.isLive(actor.id)
                && (entity.motion === "new-toss" && moved === "moved" || entity.motion === "toss" || entity.motion === "bounce" || entity.motion === "fly" || entity.motion === "fly-missile" || entity.motion === "wall-bounce")) {
                const body = this.bodies.read(actor.id);
                for (let next = entity.teamChain; body !== null && next !== null;) {
                  const follower = source.game.entity(next);
                  if (follower === null) break;
                  const current = this.bodies.read(follower.actor.id);
                  if (current !== null) { this.bodies.write(follower.actor, { ...current, origin: body.origin }); this.bodies.link(follower.actor); }
                  next = follower.teamChain;
                }
              }
              if (after && this.actors.isLive(actor.id)) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
              if (this.actors.isLive(actor.id)) source.game.postPhysics(actor.id);
              return undefined;
            });
          }
        }
      }
      if (run || paused) {
        if (this.source.kind === "q2") for (const player of this.playerStates.values()) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) this.source.players.endFrame(entity, this.source.game); }
        if (run && this.source.kind === "q2") {
          this.source.product.afterPlayerFrames();
          this.source.monsters.endFrame(this.source.game);
          this.checkingQ2Rules = true;
          try { this.source.product.checkRules(); } finally { this.checkingQ2Rules = false; }
        }
        if (this.source.kind === "q3") this.source.game.endFrame();
        for (const [actor, character] of this.q2Characters) if (paused || this.timeSeconds + 0.001 >= (this.characterTicks.get(actor) ?? 0)) {
          this.characterTicks.set(actor, this.timeSeconds + 0.1); character.endFrame();
          const player = this.playerStates.get(actor); if (player !== undefined) player.animation = { provider: this.recipe.character.definition.provider,
            state: { kind: "q2", frame: character.entity.frame, endFrame: character.state.animationEnd, priority: character.state.animationPriority, duck: character.state.animationDuck, run: character.state.animationRun } };
        }
        for (const [actor, character] of this.q1Characters) { const player = this.playerStates.get(actor); if (player === undefined) continue;
          const powers = this.source.kind === "q1" ? this.source.game.player(actor.id)?.powerups : undefined;
          const frame = character.frame(this.timeSeconds, { axePose: this.arsenal(player).activeWeapon === "q1:weapon/axe", attack: (player.buttons & 1) !== 0, jump: (player.buttons & 2) !== 0,
            use: (player.buttons & 4) !== 0, waterLevel: player.waterLevel >= 3 ? 3 : player.waterLevel === 2 ? 2 : player.waterLevel === 1 ? 1 : 0,
            waterType: player.waterType === -3 ? "water" : player.waterType === -4 ? "slime" : player.waterType === -5 ? "lava" : "empty",
            invisible: (powers?.get("invisibility") ?? 0) > this.timeSeconds, invulnerable: (this.combat.read(actor.id)?.invulnerable ?? false) });
          if (this.source.kind === "q1") this.source.composition.characterFrame(actor.id, frame);
          player.animation = { provider: this.recipe.character.definition.provider, state: { kind: "q1", frame: frame.frame, nextFrameSeconds: this.timeSeconds + 0.1 } };
        }
      }
      if (run) {
        if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) this.source.game.forceRetouch--;
        if (fixed === null) this.sourceFrame = this.clock.advance({ kind: "seconds", value: elapsed }, "frame-exit");
        else { this.sourceFrame = this.clock.enter("frame-exit"); if (this.sourceSchedulingMilliseconds > this.timeSeconds * 1000) this.sourceSchedulingMilliseconds = this.timeSeconds * 1000; }
      }
      if (this.source.kind === "q2") emitQ2ShadowLights(this.source.game);
      return { snapshot: this.snapshot(), events: this.events.take() };
    } finally { this.stepping = false; }
  }

  private snapshot(): WorldSnapshot {
    const observations = this.actors.observations();
    return { session: this.session, frame: this.sourceFrame, actors: observations,
      bodies: observations.flatMap(actor => { const body = this.bodies.read(actor.id); return body === null ? [] : [{ actor: actor.id, body }]; }),
      inventories: this.players().map(actor => ({ actor, entries: this.inventory.entries(actor) })),
      configurations: this.players().map(actor => ({ actor, movement: this.recipe.movement, character: this.recipe.character, weapons: this.recipe.weapons, inventory: this.recipe.inventory })),
      scene: { session: this.session, time: this.sourceFrame.time, world: { resource: this.recipe.map.geometry, geometry: this.options.world },
        entities: [], lights: [], particles: [], lightStyles: this.events.lightStyles(this.timeSeconds), areaBits: null } };
  }

  playerUi(actor: ActorId): PlayerUi {
    const player = this.requirePlayer(actor), combat = this.combat.read(actor);
    if (combat === null) throw new Error("Player has no combat state");
    const arsenal = this.arsenal(player), inventory = this.inventory.entries(actor), items: PlayerUiItem[] = [];
    let ammo: PlayerUi["ammo"] = null;
    if (this.source.kind === "q1") {
      for (const [sourceOrdinal, weapon] of [...Q1_WEAPONS, ...this.source.game.registeredWeapons.keys()].entries()) {
        const item = this.source.game.weaponAmmo(weapon), count = item === null ? null : this.inventory.count(actor, item);
        items.push({ id: this.source.game.weaponItem(weapon), label: weapon, kind: "weapon", sourceOrdinal,
          owned: this.inventory.count(actor, this.source.game.weaponItem(weapon)) > 0, hasAmmo: count === null || count >= (this.source.game.registeredWeapons.get(weapon)?.ammoPerShot ?? (weapon === "supernailgun" || weapon === "supershotgun" ? 2 : 1)), count, warningCount: 0 });
      }
      const weapon = this.source.game.player(actor)?.weapon;
      if (weapon !== undefined) { const item = this.source.game.weaponAmmo(weapon); if (item !== null) ammo = { item, count: this.inventory.count(actor, item) }; }
    } else if (this.source.kind === "q2") {
      for (const [sourceOrdinal, definition] of this.source.items.list().entries()) {
        if (!definition.usable) continue;
        const weapon = this.source.weapons.registeredDefinitions().find(value => value.item === definition.id), quantity = this.inventory.count(actor, definition.id);
        const count = weapon === undefined ? quantity : weapon.ammo === null ? null : this.inventory.count(actor, weapon.ammo);
        items.push({ id: definition.id, label: definition.name, kind: weapon === undefined ? "powerup" : "weapon", sourceOrdinal,
          owned: quantity > 0, hasAmmo: count === null || count >= (weapon?.quantity ?? 1), count, warningCount: weapon?.warning ?? 0 });
      }
      const weapon = this.source.weapons.registeredDefinitions().find(value => value.item === arsenal.activeWeapon);
      if (weapon !== undefined && weapon.ammo !== null) ammo = { item: weapon.ammo, count: this.inventory.count(actor, weapon.ammo) };
    } else if (this.source.kind === "q3") {
      for (const definition of Q3_WEAPON_ITEMS) {
        const count = definition.ammo === null ? null : this.inventory.count(actor, definition.ammo);
        items.push({ id: definition.item, label: definition.item.slice("q3:weapon/".length), kind: "weapon", sourceOrdinal: definition.weapon,
          owned: this.inventory.count(actor, definition.item) > 0, hasAmmo: count === null || count > 0, count, warningCount: 0 });
      }
      const definition = arsenal.state.kind === "q3" ? q3WeaponItem(arsenal.state.sourceWeapon) : null;
      if (definition?.ammo != null) ammo = { item: definition.ammo, count: this.inventory.count(actor, definition.ammo) };
    }
    return { health: combat.health, armor: combat.armor, activeWeapon: arsenal.activeWeapon, ammo, inventory, items };
  }

  playerView(actor: ActorId): PlayerView {
    const player = this.requirePlayer(actor), view = player.view(), source = this.q2Views.get(actor);
    if (player.cutscene !== null) return { origin: add(player.cutscene.origin, { ...player.cutscene.viewOffset, z: 0 }), angles: player.cutscene.angles, viewHeight: player.cutscene.viewOffset.z };
    return player.character !== "q2" || source === undefined ? view
      : { origin: add(view.origin, { x: source.offset.x, y: source.offset.y, z: 0 }), angles: add(source.angles, source.kickAngles), viewHeight: source.offset.z };
  }
  q2Source(): Extract<SourceRuntime, { readonly kind: "q2" }> | null { return this.source.kind === "q2" ? this.source : null; }
  q1Source() { return this.source.kind === "q1" ? this.source : null; }
  q3Source(): Q3SourceRuntime | null { return this.source.kind === "q3" ? this.source.game : null; }
  movementPlayer(actor: ActorId): Readonly<MovementPlayer> | null { return this.player(actor); }
  q2PlayerView(actor: ActorId): Q2PlayerView | null { return this.q2Views.get(actor) ?? null; }
  controlPlayer(actor: ActorId, control: { readonly kind: "cutscene"; readonly origin: Vec3; readonly angles: Vec3; readonly viewOffset: Vec3 }): undefined {
    const player = this.requirePlayer(actor), body = this.bodies.read(actor);
    if (body === null) throw new Error("Controlled player has no body");
    player.cutscene = { origin: { ...control.origin }, angles: { ...control.angles }, viewOffset: { ...control.viewOffset } };
    player.viewAngles = control.angles; player.viewHeight = control.viewOffset.z; player.ground = { kind: "none" };
    const state = player.state;
    if (state.kind === "q1-netquake") player.state = { ...state, origin: control.origin, velocity: zero, angles: control.angles, viewAngles: control.angles, moveType: 0, ground: { kind: "none" } };
    else if (state.kind === "q2-classic") player.state = { ...state, type: 4, originEighths: [Math.trunc(control.origin.x * 8), Math.trunc(control.origin.y * 8), Math.trunc(control.origin.z * 8)], velocityEighths: [0, 0, 0] };
    else if (state.kind === "q2-rerelease") player.state = { ...state, type: 5, origin: control.origin, velocity: zero };
    else if (state.kind === "q3") player.state = { ...state, movementType: 4, origin: control.origin, velocity: zero, viewAngles: control.angles, ground: { kind: "none" } };
    else player.state = { ...state, origin: control.origin, velocity: zero, angles: control.angles };
    this.bodies.write(player.actor, { ...body, origin: control.origin, angles: control.angles, velocity: zero, ground: null });
    this.combat.setTraits(player.actor, { canTakeDamage: false }); this.bodies.link(player.actor);
    if (this.source.kind === "q1") { this.source.game.playerInput(player.actor, { attack: false, jump: false }); this.source.game.weaponInput(player.actor, false, control.angles, this.timeSeconds, player.waterLevel); }
    return undefined;
  }
  setWorldGravity(gravity: number): undefined {
    this.physics.setWorldGravity(gravity);
    for (const player of this.playerStates.values()) {
      player.worldGravity = gravity;
      if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(gravity * player.gravityMultiplier) };
    }
    return undefined;
  }
  disconnectPlayer(actor: ActorId): undefined {
    const player = this.player(actor); if (player === null) return undefined;
    if (this.source.kind === "q3") { this.source.game.disconnectPlayer(actor); return this.actors.release(player.actor); }
    if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) {
      this.source.players.disconnect(entity, this.source.game); this.source.game.remove(entity);
      return this.actors.isLive(actor) ? this.actors.release(player.actor) : undefined;
    } }
    if (this.source.kind === "q1") return this.source.composition.disconnect(actor);
    return this.actors.release(player.actor);
  }
  private requirePlayer(actor: ActorId): MovementPlayer { const player = this.player(actor); if (player === null) throw new Error("Actor is not an admitted player"); return player; }
  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined { return this.events.registerResource(content, path, resource); }
  drainPresentationEvents(): readonly SimulationPresentationEvent[] { return this.events.takePresentation(); }

  presentations(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [], content = this.recipe.map.entities.content;
    if (this.source.kind === "q3") result.push(...this.source.game.presentations());
    if (this.source.kind === "q1") for (const entity of this.source.game.presentations()) {
      const body = this.bodies.read(entity.actor);
      if (body !== null && this.player(entity.actor) === null && entity.model !== "" && entity.model !== this.recipe.map.geometry.requestedPath) result.push({ actor: entity.actor, content, family: "q1", path: entity.model,
        frame: entity.frame, oldFrame: entity.frame, skin: entity.skin, effects: entity.effects, renderFlags: 0, origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false });
    }
    if (this.source.kind === "q2") for (const entity of this.source.game.entities.values()) {
      const body = this.bodies.read(entity.actor.id), model = this.sourceModels.get(entity.actor.id);
      if (body !== null && this.player(entity.actor.id) === null && entity.model !== "" && entity.classname !== "worldspawn") result.push({ actor: entity.actor.id, content, family: "q2", path: entity.model,
        frame: model?.frame ?? entity.frame, oldFrame: model?.oldFrame ?? entity.frame, skin: model?.skin ?? entity.skin, effects: model?.effects ?? entity.effects,
        renderFlags: model?.renderFlags ?? entity.renderFlags, alpha: model?.alpha ?? entity.alpha, origin: body.origin, angles: body.angles, scale: model?.scale ?? 1, visible: (entity.serverFlags & 1) === 0, viewWeapon: false });
    }
    for (const player of this.playerStates.values()) {
      if (player.character === "q3" || player.intermission || player.cutscene !== null) continue;
      const body = this.bodies.read(player.actor.id); if (body === null) continue;
      const model = this.recipe.character.appearance.provider.split("/").at(-1) ?? "male";
      result.push({ actor: player.actor.id, content: this.recipe.character.appearance.content, family: player.character,
        path: this.q2Characters.get(player.actor)?.entity.model ?? (this.q1Characters.get(player.actor)?.presentation.model ?? (player.character === "q1" ? "progs/player.mdl" : `players/${model}/tris.md2`)), skinPath: player.character === "q2" ? `players/${model}/grunt.pcx` : null,
        frame: this.q2Characters.get(player.actor)?.entity.frame ?? (player.animation.state.kind === "q1" || player.animation.state.kind === "q2" ? player.animation.state.frame : 0), oldFrame: 0,
        skin: 0, effects: 0, renderFlags: 0, origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false });
    }
    for (const [actor, model] of this.detachedModels) { const body = this.bodies.read(actor.id); if (body !== null) result.push({ actor: actor.id, content: model.content, family: "q2", path: model.path,
      frame: 0, oldFrame: 0, skin: 0, effects: 2, renderFlags: 0, origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false }); }
    for (const [actor, model] of this.viewModels) {
      const player = this.player(actor); if (player === null || player.intermission || player.cutscene !== null) continue;
      const view = player.view(), kick = this.source.kind === "q2" ? this.source.weapons.states.get(actor) : undefined;
      result.push({ actor, content: this.weaponProvider.content, family: providerFamily(this.weaponProvider.provider), path: model.path, frame: model.frame, oldFrame: model.frame,
        skin: 0, effects: 0, renderFlags: 0, origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), kick?.kickOrigin ?? zero), angles: add(view.angles, kick?.kickAngles ?? zero),
        scale: 1, visible: (this.combat.read(actor)?.health ?? 0) > 0, viewWeapon: true });
    }
    return result;
  }

  characterViews(): readonly Q3CharacterView[] {
    return [...this.characters].flatMap(([owner, character]): Q3CharacterView[] => {
      const player = this.playerStates.get(owner), body = this.bodies.read(owner.id), animation = character.animation.state;
      if (player === undefined || player.intermission || player.cutscene !== null || body === null || animation.kind !== "q3") return [];
      return [{ actor: owner.id, origin: body.origin, angles: player.viewAngles, velocity: body.velocity,
        movementDirection: player.state.kind === "q3" ? player.state.movementDirection : 0, animation, sourceFlags: character.sourceFlags,
        powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } }];
    });
  }

  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
    const player = this.requirePlayer(actor);
    if (this.source.kind === "q3") { this.source.game.playerCommand(actor, name, args); return undefined; }
    if (this.source.kind === "q1") {
      const active = this.source.game.player(actor)?.weapon, owned = Q1_WEAPONS.filter(weapon => this.inventory.count(actor, `q1:weapon/${weapon}`) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : Q1_WEAPONS.find(value => value === requested || `q1:weapon/${value}` === requested);
      if (weapon !== undefined) this.source.game.selectWeapon(player.actor, weapon);
    } else if (this.source.kind === "q2") {
      const entity = this.source.game.entity(actor); if (entity === null) throw new Error("Q2 player entity missing");
      if (name !== "weapnext" && name !== "weapprev" && name !== "use") { this.source.players.clientCommand(entity, this.source.game, name, args); return undefined; }
      if (this.source.product.match.source instanceof Q2Lmctf && !this.source.product.match.source.canMove(actor)) return undefined;
      const source = this.source, active = source.weapons.states.get(actor)?.weapon, owned = source.weapons.registeredDefinitions().filter(weapon => this.inventory.count(actor, weapon.item) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value.name === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : source.weapons.registeredDefinitions().find(value => value.name === requested || value.item === requested);
      if (weapon !== undefined) source.weapons.requestWeapon(entity, source.game, weapon.name);
      else if (name === "use") { const item = this.inventory.entries(actor).find(value => value.item === requested || value.item === `q2:item_${requested}`); if (item !== undefined) source.items.use(player.actor, item.item, source.game); }
    }
    return undefined;
  }

  captureTravel(spawnPoint = ""): SimulationTravel {
    this.assertOpen();
    const source = this.source;
    if (source.kind === "loading") throw new Error("Source map has not spawned");
    if (source.kind === "q3") throw new Error("Q3 map rotation uses match session state instead of campaign travel carry");
    const landmark = this.levelChange?.landmark ?? null;
    const landmarkPlayer = landmark === null ? null : this.player(landmark.player);
    return { spawnPoint, source: source.kind === "q1" ? { kind: "q1", flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }
      : { kind: "q2", serverFlags: this.levelChange?.serverFlags ?? source.game.counters.serverFlags,
        ...(source.product.rerelease === null ? {} : { rerelease: source.product.rerelease.entities.campaign }),
        landmark: landmark === null || landmarkPlayer === null ? null : { clientSlot: landmarkPlayer.client.slot, name: landmark.name,
          relativeOrigin: landmark.relativeOrigin, relativeVelocity: landmark.relativeVelocity, relativeViewAngles: landmark.relativeViewAngles } },
      players: [...this.playerStates.values()].map(player => {
        if (source.kind === "q1") return { client: player.client, state: { kind: "q1", carry: this.q1Restart ? source.composition.newTravel() : source.composition.captureTravel(player.actor) } };
        const entity = source.game.entity(player.actor.id); if (entity === null) throw new Error("Q2 travel player entity is missing");
        return { client: player.client, state: { kind: "q2", carry: source.players.saveCarry(entity, source.game) } };
      }) };
  }
  admitTravel(client: ClientId, travel: SimulationTravel): PlayerAdmission { return this.admitPlayer(client, travel); }

  takeTransitions(): readonly TransitionIntent[] { return this.transitions.splice(0); }
  takeLevelChange() { const change = this.levelChange; this.levelChange = null; return change; }
  checkpoint(): SaveImage {
    this.assertOpen();
    if (this.stepping || this.transitions.length !== 0) throw new Error("Save requires a completed frame without pending world travel");
    const source = this.source;
    if (source.kind === "loading" || source.kind === "q3") throw new Error("The selected source world does not yet expose a complete saved-game checkpoint");
    const provider = this.recipe.map.entities.provider;
    const providers: SaveImage["providers"][number][] = [sourceActorsCheckpoint(this.actors.sourceCheckpoint())];
    const add = (schema: SaveImage["providers"][number]["schema"], bytes: Uint8Array) => providers.push({ provider, schema, version: schema === "world:simulation" ? 2 : 1, bytes });
    if (source.kind === "q1") add("q1:foundation", encodeQ1FoundationCheckpoint(source.game.capture()));
    else providers.push(...captureQ2Product(source.product));

    add("world:simulation", encodeCheckpointValue({ settings: { skill: this.options.skill, mode: this.options.mode, maxClients: this.options.maxClients, seed: this.options.seed },
      players: [...this.playerStates.values()].map(captureMovementPlayer), hostMilliseconds: this.hostMilliseconds,
      sourceSchedulingMilliseconds: this.sourceSchedulingMilliseconds,
      attackSequence: this.attackSequence, checkClientAt: this.checkClientAt, checkClientIndex: this.checkClientIndex,
      checkedClient: this.checkedClient === null ? null : savedActorId(this.checkedClient),
      sourceCvars: source.kind === "q1" ? source.cvars.snapshots().map(value => ({ name: value.name, value: value.value })) : [],
      campaign: { flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }, physics: this.physics.capture(), events: this.events.capture(),
      portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })),
      q1Characters: [...this.q1Characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), bytes: character.capture() })),
      q2Characters: [...this.q2Characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), state: character.capture() })),
      q3Characters: [...this.characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), state: character.capture() })),
      characterStarts: [...this.characterStarts].map(([actor, start]) => ({ actor: savedActorId(actor.id), start: start === null ? null : savedActorId(start) })),
      deathAnimations: this.deathAnimations.capture(),
      characterTicks: [...this.characterTicks].map(([actor, time]) => ({ actor: savedActorId(actor.id), time })),
      entryCarry: [...this.entryCarry].map(([actor, state]) => ({ actor: savedActorId(actor.id), state })),
      detachedModels: [...this.detachedModels].map(([actor, model]) => ({ actor: savedActorId(actor.id), ...model })),
      sourceModels: [...this.sourceModels.values()].map(model => ({ ...model, actor: savedActorId(model.actor) })),
      viewModels: [...this.viewModels].map(([actor, model]) => ({ actor: savedActorId(actor), ...model })),
      q2Views: [...this.q2Views].map(([actor, view]) => ({ actor: savedActorId(actor), view })),
      levelChange: this.levelChange === null ? null : { ...this.levelChange, landmark: this.levelChange.landmark === null ? null
        : { ...this.levelChange.landmark, player: savedActorId(this.levelChange.landmark.player) } } }));
    const actors = this.actors.observations();
    return { schemaVersion: 1, recipe: this.recipe, frame: this.sourceFrame, nextEventSequence: this.events.nextSequence,
      clocks: [{ provider, time: this.sourceFrame.time }], random: [{ provider, state: this.random.checkpoint() }], actors: this.actors.checkpoint(),
      bodies: captureSharedBodies(this.actors, this.bodies),
      combat: actors.flatMap(actor => { const state = this.combat.read(actor.id); return state === null ? [] : [{ actor: savedActorId(actor.id), state }]; }),
      inventories: actors.flatMap(actor => this.inventory.has(actor.id) ? [{ actor: savedActorId(actor.id), entries: this.inventory.entries(actor.id) }] : []),
      configurations: this.players().map(actor => ({ actor: savedActorId(actor), movement: this.recipe.movement, character: this.recipe.character, weapons: this.recipe.weapons, inventory: this.recipe.inventory })),
      thinks: actors.flatMap(actor => { const pending = this.scheduler.pending(actor.id); return pending === null ? [] : [{ actor: savedActorId(actor.id), callback: pending.callback,
        due: pending.timing.due, boundary: pending.timing.boundary, provider: pending.timing.order.provider, sequence: pending.timing.order.sequence }]; }), providers, guests: [] };
  }

  private restore(save: SaveImage): undefined {
    const source = this.source;
    if (source.kind === "q3" || source.kind === "loading") throw new Error("The selected source world does not expose a complete saved-game restore");
    const reader = simulationSaveReader(save), reference = (value: SaveReader) => this.actors.referenceSaved(readSavedActor(value));
    const owner = (value: SaveReader): OwnedActor => { const actor = this.actors.resolveSaved(readSavedActor(value)); if (actor === null) return value.fail("Missing restored actor"); return actor; };
    const random = save.random.find(value => value.provider === this.recipe.map.entities.provider)?.state;
    if (random?.kind !== "glibc-random" && random?.kind !== "q2-rerelease-mt19937") throw new Error("Save has no matching source random stream");
    this.random.restore(random);
    this.hostMilliseconds = reader.field("hostMilliseconds").finite();
    const scheduling = reader.field("sourceSchedulingMilliseconds");
    this.sourceSchedulingMilliseconds = scheduling.value === undefined ? this.hostMilliseconds : scheduling.finite();
    this.attackSequence = reader.field("attackSequence").integer(0);
    this.checkClientAt = reader.field("checkClientAt").number(); this.checkClientIndex = reader.field("checkClientIndex").integer(-1);
    this.checkedClient = reader.field("checkedClient").nullable(reference);
    this.q1Campaign.flags = reader.field("campaign").field("flags").number(); this.q1Campaign.skill = reader.field("campaign").field("skill").choice(0, 1, 2, 3);
    restoreSharedWorldState(save, { actors: this.actors, bodies: this.bodies, combat: this.combat, inventory: this.inventory, storage: () => "typescript" });
    reader.field("players").list(value => {
      const saved = readMovementPlayer(value, actor => this.actors.referenceSaved(actor)), actor = owner(value.field("actor"));
      const client = this.options.restoredClients?.find(client => client.slot === saved.clientSlot);
      if (client === undefined || !this.options.identity.owns(client)) return value.fail("Saved player has no connected session client");
      const body = this.bodies.read(actor.id); if (body === null) return value.fail("Saved player has no body");
      const player = this.createPlayer(actor, client, body.origin, saved.viewAngles, saved.arsenal);
      if (saved.state.kind !== player.profile.kind) return value.fail("Saved movement state differs from the selected movement provider");
      const { actor: _savedActor, clientSlot: _slot, ...state } = saved;
      Object.assign(player, state); this.playerStates.set(actor, player);
    });
    const bytes = (schema: SaveImage["providers"][number]["schema"]) => simulationProviderCheckpoint(save, schema).bytes;
    if (source.kind === "q1") reader.field("sourceCvars").list(value => { source.cvars.set(value.field("name").string(), value.field("value").string(), true); return undefined; });
    if (source.kind === "q1") source.game.restore(decodeQ1FoundationCheckpoint(bytes("q1:foundation")), { scheduleThinks: false });
    else restoreQ2Product(source.product, save.providers);

    reader.field("q1Characters").list(value => {
      if (source.kind !== "q1") return value.fail("Q1 character needs its saved source foundation");
      const actor = owner(value.field("actor")), player = this.requirePlayer(actor.id);
      const character = new Q1CharacterActor(source.game, actor, { requestRespawn: () => this.respawnPlayer(player), dropInventory: () => this.dropPlayerInventory(player), sourcePose: () => source.composition.characterPose(actor.id), fallDamageAllowed: () => source.composition.fallDamageAllowed(actor.id) });
      character.restore(value.field("bytes").bytes()); this.q1Characters.set(actor, character);
      this.callbacks.bind(actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction.attacker, reaction.damage), die: reaction => character.die(reaction.attacker) });
    });
    reader.field("q2Characters").list(value => {
      const actor = owner(value.field("actor")); this.attachQ2Character(this.requirePlayer(actor.id));
      const character = this.q2Characters.get(actor); if (character === undefined) return value.fail("Q2 character was not bound");
      character.restore(readQ2CharacterCheckpoint(value.field("state")), saved => this.actors.referenceSaved(saved));
    });
    reader.field("characterStarts").list(value => this.characterStarts.set(owner(value.field("actor")), value.field("start").nullable(reference)));
    reader.field("q3Characters").list(value => {
      const actor = owner(value.field("actor")), checkpoint = readQ3Character(value.field("state"));
      const character = new Q3CharacterActor(actor, this.recipe.character.definition.provider, checkpoint.product, {
        bodies: this.bodies, combat: this.combat, inventory: this.inventory, callbacks: this.callbacks,
        placement: "source-game",
        timeMilliseconds: () => Math.trunc(this.timeSeconds * 1000), emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event }),
        deathContext: owned => { const attack = this.lastAttack.get(owned); return { blood: true, noDrop: false, suicide: attack?.cause.kind === "q3" && attack.cause.meansOfDeath === 20,
          killerSourceSlot: attack?.attacker === null || attack?.attacker === undefined ? 1022 : this.actors.sourceOf(attack.attacker)?.slot ?? 1022 }; },
      }, this.deathAnimations);
      character.restore(checkpoint); this.characters.set(actor, character);
    });
    const death = reader.field("deathAnimations"); this.deathAnimations.restore({ version: death.field("version").literal(1), index: death.field("index").integer(0) });
    reader.field("characterTicks").list(value => this.characterTicks.set(owner(value.field("actor")), value.field("time").number()));
    reader.field("entryCarry").list(value => this.entryCarry.set(owner(value.field("actor")), readQ1Travel(value.field("state"))));
    reader.field("detachedModels").list(value => {
      const actor = owner(value.field("actor"));
      this.detachedModels.set(actor, { content: readContentId(value.field("content")), path: value.field("path").string() });
      this.callbacks.bind(actor, { think: self => this.actors.release(self), touch: null, use: null, pain: null, die: null });
    });
    reader.field("viewModels").list(value => this.viewModels.set(reference(value.field("actor")), { path: value.field("path").string(), frame: value.field("frame").number() }));
    reader.field("q2Views").list(value => this.q2Views.set(reference(value.field("actor")), readQ2View(value.field("view"))));
    reader.field("sourceModels").list(value => {
      const attached = value.field("attachedModels").list(value => value.string()), [first, second, third] = attached;
      if (attached.length !== 3 || first === undefined || second === undefined || third === undefined) return value.fail("Q2 attached models must retain three slots");
      const actor = reference(value.field("actor"));
      this.sourceModels.set(actor, { kind: "model", actor, path: value.field("path").string(), attachedModels: [first, second, third], frame: value.field("frame").number(), oldFrame: value.field("oldFrame").number(),
        scale: value.field("scale").number(), skin: value.field("skin").number(), effects: value.field("effects").number(), renderFlags: value.field("renderFlags").number(), alpha: value.field("alpha").value === undefined ? 1 : value.field("alpha").finite() });
    });
    this.levelChange = reader.field("levelChange").nullable(value => ({ map: value.field("map").string(), serverFlags: value.field("serverFlags").number(), landmark: value.field("landmark").nullable(value => ({ player: reference(value.field("player")), name: value.field("name").string(),
      relativeOrigin: readVector(value.field("relativeOrigin")), relativeVelocity: readVector(value.field("relativeVelocity")), relativeViewAngles: readVector(value.field("relativeViewAngles")) })) }));
    this.physics.restoreCheckpoint(reader.field("physics"));
    reader.field("portals").list(value => { const portal = value.field("portal").integer(0), open = value.field("open").boolean(); this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); });
    restoreSharedBodyLinks(save, { actors: this.actors, bodies: this.bodies });
    this.physics.restoreSpatial(reader.field("physics"));
    for (const think of save.thinks) {
      const actor = this.actors.resolveSaved(think.actor); if (actor === null) throw new Error("Saved think has no restored actor");
      this.scheduler.schedule(actor, think.callback, { due: think.due, boundary: think.boundary, order: { actor: actor.id, provider: think.provider, sequence: think.sequence } });
    }
    this.events.restore(reader.field("events"), actor => this.actors.referenceSaved(actor));
    this.resumeQ2Presentation();
    if (this.events.nextSequence !== save.nextEventSequence) throw new Error("Save event sequence disagrees with its source journal");
    return undefined;
  }
  close(): undefined { if (this.closed) return undefined; this.closed = true; this.actors.close(); this.scheduler.close(); return undefined; }
  private assertOpen(): undefined { if (this.closed) throw new Error("Simulation is closed"); return undefined; }
}

export function createSimulation(options: SimulationOptions): SharedSimulation { return new SharedSimulation(options); }
