import type { ContentId, ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { AttackProvenance, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { AnimationStepInput, AnimationStepResult, ArsenalState, MovementContinuation, MovementState, MovementTouchContact, WeaponStepInput, WeaponStepResult } from "../../../contracts/movement.ts";
import type { InputBatch, SaveImage, Simulation, SimulationOutput, WorldSnapshot } from "../../../contracts/session.ts";
import type { FrameContext, SourceTime } from "../../../contracts/time.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, createQ2CombatPolicy, nativeVictimArmor } from "../../../world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../world/collision/index.ts";
import { FrameScheduler } from "../../../world/scheduler.ts";
import { SourceClock } from "../../../world/session/index.ts";
import { Q1Foundation, ammoItem } from "../../../content/q1/foundation/runtime.ts";
import { WEAPONS as Q1_WEAPONS } from "../../../content/q1/foundation/types.ts";
import { registerQ1Base, Q1CampaignState, Q1CharacterActor, captureQ1Travel, admitQ1Travel, newQ1Travel, dropBackpack } from "../../../content/q1/base/index.ts";
import type { Q1Base, Q1TravelState } from "../../../content/q1/base/index.ts";
import { createQ2BaseEntityModule } from "../../../content/q2/base/entities/index.ts";
import type { Q2BaseEntityModule } from "../../../content/q2/base/entities/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../../content/q2/base/monsters/index.ts";
import { Q2Players, Q2CharacterActor } from "../../../content/q2/base/player/index.ts";
import type { Q2CharacterGib } from "../../../content/q2/base/player/character.ts";
import type { Q2PlayerMovementChange, Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import type { Q1FoundationHost, Q1Powerup } from "../../../content/q1/foundation/types.ts";
import { Q2Foundation } from "../../../content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2PresentationEvent, Q2LandmarkCarry } from "../../../content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../content/q2/foundation/targets.ts";
import { createQ2MoverModule } from "../../../content/q2/foundation/movers.ts";
import { createQ2SceneryModule } from "../../../content/q2/foundation/scenery.ts";
import { createQ2ItemModule } from "../../../content/q2/foundation/items.ts";
import type { Q2ItemModule } from "../../../content/q2/foundation/items.ts";
import { Q2Monsters } from "../../../content/q2/foundation/monsters/index.ts";
import { Q2Weapons, Q2_BASE_WEAPONS, q2WeaponDefinition } from "../../../content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent } from "../../../content/q2/foundation/weapons/index.ts";
import { Q3CharacterActor, Q3DeathAnimationSequence, q3InitialCombat, stepQ3CharacterAnimation } from "../../../content/q3/foundation/character.ts";
import type { Q3CharacterView } from "../../../content/q3/foundation/presentation.ts";
import { q3SourceAnimation, q3SourceTorso } from "../../../movement/q3/animation.ts";
import { createQ1MonsterMovement } from "../../../movement/q1/index.ts";
import type { Q1MonsterMovement } from "../../../movement/q1/monsters.ts";
import { SharedPhysics } from "./physics.ts";
import type { SharedSolid } from "./physics.ts";
import { MovementPlayer, movementOrigin, providerFamily, providerTiming } from "./players.ts";
import { SimulationEvents } from "./events.ts";
import { SourceRandom } from "./random.ts";
import type { PlayerAdmission, PlayerView, PlayerUi, PlayerUiItem, SimulationTravel, SimulationOptions, SimulationPresentation, SimulationPresentationEvent } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function add(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function seconds(time: SourceTime): number { return time.kind === "seconds" ? time.value : time.value / 1000; }
function sourceModel(path: string): number | null { return /^\*[0-9]+$/.test(path) ? Number(path.slice(1)) : null; }

function rotateLandmark(vector: Vec3, angles: Vec3): Vec3 {
  const pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180, yaw = angles.y * Math.PI / 180;
  const z = { x: vector.x * Math.cos(yaw) - vector.y * Math.sin(yaw), y: vector.x * Math.sin(yaw) + vector.y * Math.cos(yaw), z: vector.z };
  const y = { x: z.x * Math.cos(roll) + z.z * Math.sin(roll), y: z.y, z: -z.x * Math.sin(roll) + z.z * Math.cos(roll) };
  return { x: y.x, y: y.y * Math.cos(pitch) - y.z * Math.sin(pitch), z: y.y * Math.sin(pitch) + y.z * Math.cos(pitch) };
}

type SourceRuntime = { readonly kind: "loading" }
  | { readonly kind: "q1"; readonly game: Q1Foundation; readonly base: Q1Base }
  | { readonly kind: "q2"; readonly game: Q2Foundation; readonly weapons: Q2Weapons; readonly monsters: Q2Monsters; readonly items: Q2ItemModule; readonly players: Q2Players; readonly baseEntities: Q2BaseEntityModule };

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
  private closed = false;
  private stepping = false;
  private checkingQ2Rules = false;
  private checkClientAt = -Infinity;
  private checkClientIndex = -1;
  private checkedClient: ActorId | null = null;
  private attackSequence = 0;
  private readonly lastAttack = new Map<OwnedActor, AttackProvenance>();

  constructor(readonly options: SimulationOptions) {
    this.session = options.identity.session;
    this.q1Campaign = new Q1CampaignState(options.travel?.source.kind === "q1" ? options.travel.source.flags : 0, options.travel?.source.kind === "q1" ? options.travel.source.skill : options.skill);
    this.recipe = options.recipe;
    const weaponProvider = options.recipe.weapons[0];
    if (weaponProvider === undefined || options.recipe.weapons.length !== 1) throw new Error("This source arsenal requires one selected weapon provider");
    this.weaponProvider = weaponProvider;
    if (options.world.kind === "q3-bsp") throw new Error("The Q3 map game provider is not yet attached to the shared application simulation");
    const timing = providerTiming(this.recipe, this.recipe.map.entities.provider);
    this.clock = new SourceClock({ kind: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? "milliseconds" : "seconds", value: 0 });
    this.sourceFrame = this.clock.frame;
    this.random = new SourceRandom(options.seed);
    this.actors = new SessionActorRegistry(options.identity);
    this.callbacks = new ActorCallbackTable(this.actors);
    this.scene = new SharedSceneQueries(options.world);
    this.physics = new SharedPhysics({ actors: this.actors, callbacks: this.callbacks, scene: this.scene, numeric: timing.numeric,
      sourceOrder: (a, b) => this.sourceOrder(a, b), worldActor: () => this.worldActor(), getCollision: actor => this.collision(actor),
      getMotion: actor => {
        const body = this.physics.bodies.read(actor.id); if (body === null) return null;
        const player = this.playerStates.get(actor);
        if (player !== undefined) return { actor, velocity: body.velocity, angularVelocity: zero,
          kind: this.q2Characters.get(actor)?.state.dead ? this.q2Characters.get(actor)?.state.gibbed ? "bounce" : "toss" : "step", gravity: 1, clipMask: 0x6000003, owner: null };
        if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); return entity === null ? null : { actor, velocity: body.velocity, angularVelocity: entity.angularVelocity,
          kind: entity.motion, gravity: entity.gravity, clipMask: entity.clipMask, owner: entity.owner }; }
        if (this.source.kind === "q1") { const entity = this.source.game.entity(actor.id); return entity === null ? null : { actor, velocity: body.velocity, angularVelocity: entity.angularVelocity,
          kind: entity.movement === "flymissile" ? "fly-missile" : (entity.movement === "none" || entity.movement === "noclip") ? "stationary" : entity.movement,
          gravity: 1, clipMask: 0x6000003, owner: entity.owner }; }
        return null;
      },
      getFlags: actor => {
        const player = this.playerStates.get(actor), entity = this.source.kind === "q1" ? this.source.game.entity(actor.id) : null;
        const monster = this.source.kind === "q2" ? this.source.monsters.context(actor.id)?.state : undefined;
        return { ...(monster === undefined ? {} : { fly: monster.locomotion === "fly", swim: monster.locomotion === "swim", dead: monster.dead }), player: player !== undefined, dead: (this.combat?.read(actor.id)?.health ?? 1) <= 0,
          ...(player === undefined ? {} : { waterLevel: player.waterLevel, waterType: player.waterType }),
          ...(entity === null ? {} : { fly: (entity.movementFlags & 1) !== 0, swim: (entity.movementFlags & 2) !== 0, partialGround: (entity.movementFlags & 1024) !== 0, waterLevel: entity.waterLevel, enemy: entity.monster?.enemy ?? null }) };
      },
      writeFlags: (actor, changes) => { const player = this.playerStates.get(actor);
        if (player !== undefined) { if (changes.waterLevel !== undefined) player.waterLevel = changes.waterLevel; if (changes.waterType !== undefined) player.waterType = changes.waterType; }
        return undefined; },
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
        if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); if (entity !== null) entity.lastAttack = decision.request.attack; }
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
      this.scheduler.cancel(actor); this.playerStates.delete(actor); this.characters.delete(actor); this.q1Characters.delete(actor); this.q2Views.delete(actor.id); this.q2Characters.delete(actor); this.characterTicks.delete(actor); this.entryCarry.delete(actor); this.detachedModels.delete(actor); this.sourceModels.delete(actor.id); this.viewModels.delete(actor.id); this.lastAttack.delete(actor);
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
    if (this.source.kind === "q1" && options.world.kind === "q1-bsp") this.source.game.spawnMap(options.world);
    else if (this.source.kind === "q2") {
      if (options.travel?.source.kind === "q2") this.source.game.counters.serverFlags = options.travel.source.serverFlags;
      const report = this.source.game.load(options.world.entities);
      if (report.unsupported.length !== 0) throw new Error(`Unimplemented authored Q2 spawns: ${[...new Set(report.unsupported.map(entity => entity.classname))].join(", ")}`);
    }
    } catch (error) { this.close(); throw error; }
  }

  get bodies() { return this.physics.bodies; }
  get timeSeconds(): number { return seconds(this.sourceFrame.time); }

  private createSource(): SourceRuntime {
    const recipe = this.recipe, content = recipe.map.entities.content, campaign = recipe.campaign.kind === "campaign" ? recipe.campaign.mission.provider : recipe.map.entities.provider;
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
        checkClient: observer => this.checkClient(observer), powerup: (actor, powerup, expires) => this.powerup(actor, powerup, expires) };
      const game = new Q1Foundation(host, { edition: content.includes(":rerelease:") ? "rerelease" : "classic", skill: this.q1Campaign.skill,
        deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider, gravity: 800 });
      return { kind: "q1", game, base: registerQ1Base(game, { campaign: this.q1Campaign }) };
    }
    const weapons = new Q2Weapons({ emit: event => this.weaponEvent(content, event),
      noise: (actor, origin, secondary) => { if (this.source.kind !== "q2") throw new Error("Q2 monster noise before source admission"); return this.source.monsters.reportNoise(actor, origin, secondary); },
      dodge: (monster, game, attacker, eta, trace) => { if (this.source.kind !== "q2") throw new Error("Q2 dodge before source admission"); return this.source.monsters.dodge(monster, game, attacker, eta, trace); },
      lagCompensation: { kind: "current-world" },
      ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
      canTarget: (attacker, target) => attacker === null || !sameActor(attacker, target) });
    const monsters = new Q2Monsters(weapons, { platformState: actor => { if (this.source.kind !== "q2") return null;
      const entity = this.source.game.entity(actor); return entity === null ? null : this.source.baseEntities.platformState(entity)?.phase ?? null; } });
    const monsterModule = content.includes(":rerelease:") ? monsters : registerQ2ClassicBaseMonsters(monsters);
    const movers = createQ2MoverModule({ pathCorner: (corner, active, other) => monsters.touchPathCorner(corner, active, other), combatPoint: (point, active, other) => monsters.touchCombatPoint(point, active, other) });
    const baseEntities = createQ2BaseEntityModule({ movers, weapons,
      teleportPlayer: (actor, origin, angles) => { if (this.source.kind !== "q2") throw new Error("Q2 teleport before source entry"); const entity = this.source.game.entity(actor);
        return entity === null ? undefined : this.source.players.teleportPlayer(entity, this.source.game, origin, angles); },
      playerPush: (actor, velocity) => { const player = this.requirePlayer(actor), body = this.bodies.read(actor); if (body === null) return undefined;
        this.bodies.write(player.actor, { ...body, velocity }); player.state = player.readState();
        const state = this.source.kind === "q2" ? this.source.players.states.get(actor) : undefined; if (state !== undefined) state.oldVelocity = velocity; return undefined; },
      setActorGravity: (actor, gravity) => { const player = this.player(actor); if (player !== null) {
        player.gravityMultiplier = gravity;
        if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(800 * gravity) };
      } else if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) entity.gravity = gravity; } return undefined; },
      localTime: () => { const time = new Date(); return { hour: time.getHours(), minute: time.getMinutes(), second: time.getSeconds() }; },
      turretDriver: (entity, game) => monsters.spawnInfantryDriver(entity, game), resumeMonster: (entity, game) => monsters.resumeMonster(entity, game),
    });
    const items = createQ2ItemModule({ weaponPicked: (actor, item, first) => {
      const state = weapons.states.get(actor), definition = Q2_BASE_WEAPONS.find(value => value.item === item);
      if (state !== undefined && definition !== undefined && first) state.pending = definition.name;
      return undefined;
    }, silencer: (actor, charges) => { const state = weapons.states.get(actor); if (state === undefined) throw new Error("Silencer owner has no weapon state"); state.silencerShots += charges; return undefined; },
    powerArmor: (actor, kind) => this.events.message({ kind: "print", level: 2, text: `Power armor ${kind}\n` }, actor) });
    const players = new Q2Players(items, weapons, {
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.commandAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: player.ground.kind !== "none", ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
        standingBounds: player.standingBounds, animateQ2: player.character === "q2" }; },
      setMovement: (actor, change) => this.setPlayerMovement(actor, change),
      emit: event => { if (event.kind === "view") this.q2Views.set(event.actor, event.view); return this.events.emit(content, { kind: "q2-player", event }); },
      noise: (actor, origin) => monsters.reportNoise(actor, origin), weaponInput: actor => this.q2WeaponInput(this.requirePlayer(actor)), banned: () => false,
    });
    const host: Q2FoundationHost = { actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
      now: () => this.timeSeconds, frameSeconds: () => seconds(this.sourceFrame.elapsed), random: () => this.random.nextUnit(),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due),
      trace: request => this.physics.trace(request, "q2"), pointContents: point => this.contents(point, "q2"),
      inPvs: (a, b) => this.visible(a, b, "pvs"), inPhs: (a, b) => this.visible(a, b, "phs"),
      areasConnected: (a, b) => this.scene.areasConnected(this.scene.leafArea(this.scene.pointLeaf(a)), this.scene.leafArea(this.scene.pointLeaf(b))),
      nearby: (origin, radius) => this.actors.observations().map(value => value.id).filter(actor => { const body = this.bodies.read(actor); return body !== null && Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) <= radius; }).sort((a, b) => this.sourceOrder(a, b)),
      worldActor: () => { const actor = this.worldActor(); if (actor === null) throw new Error("Map has no source world actor"); return actor; },
      playerViewState: actor => { const player = this.player(actor); return player === null ? null : { viewAngles: player.viewAngles, oldVelocity: players.states.get(actor)?.oldVelocity ?? zero }; },
      prepareLevelChange: (map, landmark, serverFlags) => { this.levelChange = { map, landmark, serverFlags }; return undefined; },
      players: () => this.players(), isPlayer: actor => this.player(actor) !== null, isMonster: actor => this.source.kind === "q2" && ((this.source.game.entity(actor)?.serverFlags ?? 0) & 4) !== 0,
      touchTriggers: actor => this.physics.touchTriggers(actor),
      keyConsumed: actor => { if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) this.source.players.consumedKey(entity, this.source.game); } return undefined; },
      inlineModelBounds: model => this.scene.modelBounds(model), setSolid: (actor, solid, model) => this.physics.setSolid(actor, solid, model, "q2"),
      setMotion: motion => this.physics.setMotion(motion), setAreaPortal: (portal, open) => { this.scene.setAreaPortalState(portal, open); return undefined; },
      emit: event => { if (event.kind === "model") this.sourceModels.set(event.actor, event); return this.events.emit(content, { kind: "q2", event }); },
      transition: intent => {
        if (!this.checkingQ2Rules && this.source.kind === "q2" && intent.kind === "campaign-level") {
          const change = this.levelChange;
          return players.beginIntermission(this.source.game, change?.map ?? intent.map.replace(/^q2:/, ""), change?.landmark ?? null);
        }
        this.transitions.push(intent); return undefined;
      }, diagnostic: message => this.events.message({ kind: "print", level: 2, text: message }) };
    const game = new Q2Foundation(host, { edition: content.includes(":rerelease:") ? "rerelease" : "classic", mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
      skill: this.options.skill, mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients, provider: recipe.map.entities.provider,
      campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider },
      [players, baseEntities, createQ2TargetModule(), movers, createQ2SceneryModule(), items, monsterModule]);
    return { kind: "q2", game, weapons, monsters, items, players, baseEntities };
  }

  private registerCombat(): undefined {
    const id = this.recipe.combat.provider;
    const armor = nativeVictimArmor(request => {
      const body = this.bodies.read(request.target), direction = body === null ? zero : subtract(request.point, body.origin);
      const length = Math.hypot(direction.x, direction.y, direction.z), yaw = (body?.angles.y ?? 0) * Math.PI / 180;
      return { arithmetic: "binary32", q2: { product: this.recipe.inventory.content.includes(":rerelease:") ? "rerelease" : "classic", ctf: false, alive: (this.combat.read(request.target)?.health ?? 0) > 0 }, screenFacingDot: length === 0 ? 0 : (direction.x * Math.cos(yaw) + direction.y * Math.sin(yaw)) / length };
    });
    if (providerFamily(id) === "q1") this.combat.register(createQ1CombatPolicy({ id, armor,
      context: request => { if (this.source.kind !== "q1") throw new Error("Q1 combat source is not attached"); return this.source.game.combatContext(request); } }));
    else this.combat.register(createQ2CombatPolicy({ id, armor, context: request => ({ arithmetic: "binary32", player: this.player(request.target) !== null,
      monster: this.classname(request.target).startsWith("monster_"), attackerPlayer: request.attack.attacker !== null && this.player(request.attack.attacker) !== null,
      hasEnemy: this.source.kind === "q2" && (this.source.game.entity(request.target)?.enemy ?? null) !== null, easySkill: this.options.skill === 0, deathmatch: this.options.mode === "deathmatch",
      defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: !this.physics.isBrush(request.target), rejectTeamDamage: false, suppressPain: false }) }));
    return undefined;
  }

  private schedule(actor: OwnedActor, dueSeconds: number): undefined {
    const kind = providerTiming(this.recipe, actor.owner).clock.kind;
    return this.scheduler.schedule(actor, "world:think", { due: { kind: kind === "q2-rerelease" || kind === "q3" ? "milliseconds" : "seconds", value: kind === "q2-rerelease" || kind === "q3" ? dueSeconds * 1000 : dueSeconds },
      boundary: "during-physics", order: { actor: actor.id, provider: actor.owner, sequence: this.attackSequence++ } });
  }

  private sourceOrder(a: ActorId, b: ActorId): number {
    const left = this.actors.sourceOf(a), right = this.actors.sourceOf(b);
    if (this.recipe.ordering.kind === "mixed") {
      const providers = this.recipe.ordering.providers, order = providers.indexOf(left?.provider ?? this.actors.observe(a)?.owner ?? "world:unknown") - providers.indexOf(right?.provider ?? this.actors.observe(b)?.owner ?? "world:unknown");
      if (order !== 0) return order;
    }
    return (left?.slot ?? a.slot) - (right?.slot ?? b.slot);
  }

  private collision(actor: OwnedActor): SharedSolid | null {
    const player = this.playerStates.get(actor);
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
        const candidate = players[this.checkClientIndex]; if (candidate !== undefined && (this.combat.read(candidate)?.health ?? 0) > 0) { this.checkedClient = candidate; break; } }
    }
    const candidate = this.checkedClient, source = this.bodies.read(observer.id), target = candidate === null ? null : this.bodies.read(candidate);
    return source !== null && target !== null && this.visible(add(target.origin, { x: 0, y: 0, z: this.player(candidate)?.viewHeight ?? 22 }), source.origin, "pvs") ? candidate : null;
  }

  private worldActor(): ActorId | null { return this.actors.atSource(this.recipe.map.entities.provider, 0)?.id ?? null; }
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

  admitPlayer(client: ClientId, travel: SimulationTravel | undefined = this.options.travel): PlayerAdmission {
    this.assertOpen();
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients) throw new Error("Client does not belong to an available session slot");
    for (const player of this.playerStates.values()) if (player.client.slot === client.slot) throw new Error("Client already has a player");
    const source = this.source;
    if (source.kind === "loading") throw new Error("Map spawn is incomplete");
    const entries = source.kind === "q1" ? [...source.game.entities.values()] : [...source.game.entities.values()];
    const sorted = entries.sort((a, b) => this.sourceOrder(a.actor.id, b.actor.id));
    let start = source.kind === "q1" ? source.base.spawnSelector.select()?.actor : undefined;
    if (source.kind === "q1" && start === undefined) throw new Error("Source spawn selection is deferred because every spawn is occupied");
    if (start === undefined && this.options.mode === "coop") {
      if (client.slot > 0) start = sorted.filter(entity => entity.classname === "info_player_coop" && entity.targetname.toLowerCase() === (travel?.spawnPoint ?? "").toLowerCase())[client.slot - 1]?.actor;
    }
    if (start === undefined && this.options.mode === "deathmatch") {
      const spots = sorted.filter(entity => entity.classname === "info_player_deathmatch");
      start = spots.find(entity => { const origin = this.bodies.read(entity.actor.id)?.origin;
        return origin !== undefined && this.players().every(id => { const body = this.bodies.read(id); return body === null || Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) > 32; }); })?.actor ?? spots[0]?.actor;
    }
    start ??= sorted.find(entity => entity.classname === "info_player_start" && entity.targetname.toLowerCase() === (travel?.spawnPoint ?? "").toLowerCase())?.actor;
    if (start === undefined && (travel?.spawnPoint ?? "") === "") start = sorted.find(entity => entity.classname === "info_player_start")?.actor;
    const placement = start === undefined ? null : this.bodies.read(start.id);
    if (placement === null) throw new Error("Map has no player start for the selected mode");
    let spawnOrigin = add(placement.origin, { x: 0, y: 0, z: source.kind === "q1" ? 1 : 10 }), spawnAngles = placement.angles, spawnVelocity = zero;
    if (source.kind === "q2" && travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot) {
      const landmark = travel.source.landmark, destination = source.game.targets(landmark.name)[0];
      if (destination !== undefined) { const reference = source.game.body(destination);
        spawnOrigin = add(reference.origin, rotateLandmark(landmark.relativeOrigin, reference.angles));
        spawnAngles = add(reference.angles, landmark.relativeViewAngles); spawnVelocity = rotateLandmark(landmark.relativeVelocity, reference.angles);
      }
    }
    const actor = this.actors.allocateAtSource(this.recipe.map.entities.provider, client.slot + 1, this.recipe.character.definition.provider);
    const arsenal: ArsenalState = { provider: this.weaponProvider.provider, activeWeapon: null, ammo: [], state: source.kind === "q1"
      ? { kind: "q1", frame: 0, attackFinishedSeconds: 0, sourceWeapon: 1 }
      : { kind: "q2", gunFrame: 0, state: 0, pendingWeapon: null, machinegunShots: 0, grenadeTime: { kind: "seconds", value: 0 }, grenadeBlewUp: false } };
    const player = new MovementPlayer(actor, client, this.recipe, { actors: this.actors, bodies: this.bodies, combat: this.combat, scene: this.scene,
      weaponStep: input => this.weaponStep(input), animationStep: input => this.animationStep(input), touch: (contact, state) => this.touch(contact, state),
      worldActor: () => this.worldActor(), touchTriggers: owned => this.physics.touchTriggers(owned), isBrush: id => this.physics.isBrush(id), jump: (owned, action) => this.jump(owned, action),
      q3Hooks: { firing: context => (context.command.buttons & 1) !== 0 && context.motion.health > 0,
        animation: (request, context) => q3SourceAnimation(request, context), torso: context => q3SourceTorso(11, context, true),
        weapon: context => ({ ...this.weaponStep({ actor: context.input.actor, command: context.input.command, frame: context.frame,
          arsenal: context.arsenal, animation: context.animation, environment: context.input.environment, gauntletHit: false }), movementFlags: context.motion.pmFlags }) } },
      spawnOrigin, spawnAngles, arsenal);
    this.playerStates.set(actor, player);
    const body = { origin: movementOrigin(player.state), angles: spawnAngles, velocity: spawnVelocity, bounds: player.bounds, ground: null };
    this.bodies.create(actor, body);
    const entity = source.kind === "q2" ? source.game.attachPlayer(actor) : null;
    if (entity !== null) { entity.viewHeight = player.viewHeight; entity.solid = "box"; }
    if (player.character === "q3") {
      const character = new Q3CharacterActor(actor, this.recipe.character.definition.provider, "baseq3", { bodies: this.bodies, callbacks: this.callbacks,
        combat: this.combat, inventory: this.inventory, timeMilliseconds: () => Math.trunc(this.timeSeconds * 1000),
        emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event }),
        spawnTargets: owned => {
          if (start !== undefined && source.kind === "q1") { const spot = source.game.entity(start.id); if (spot !== null) source.game.useTargets(spot, owned.id); }
          else if (start !== undefined && source.kind === "q2") { const spot = source.game.entity(start.id); if (spot !== null) source.game.useTargets(spot, owned.id); }
          return undefined;
        }, killBox: owned => this.killBox(owned), deathContext: owned => {
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
      this.killBox(actor); this.bodies.link(actor);
    }
    if (source.kind === "q1") source.game.attachPlayer(actor);
    else { source.items.configurePlayer(actor, source.game, true); if (entity !== null) {
      source.weapons.bind(entity, source.game);
      source.players.attach(entity, source.game, { slot: client.slot, userinfo: `\\name\\Player ${client.slot + 1}\\skin\\male/grunt`, initializeInventory: false });
    } }
    if (player.character === "q1" && source.kind === "q1") {
      const character = new Q1CharacterActor(source.game, actor, { requestRespawn: () => this.respawnPlayer(player), dropInventory: () => this.dropPlayerInventory(player) });
      this.q1Characters.set(actor, character);
      this.callbacks.bind(actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction.attacker, reaction.damage), die: reaction => character.die(reaction.attacker) });
    }
    if (player.character === "q2" && source.kind === "q1") this.attachQ2Character(player);
    const carried = travel?.players.find(record => record.client.slot === client.slot && record.client.generation === client.generation)?.state;
    if (source.kind === "q1" && carried?.kind === "q1") admitQ1Travel(source.game, actor, carried.carry);
    else if (source.kind === "q2" && carried?.kind === "q2" && entity !== null) source.players.restoreCarry(entity, source.game, carried.carry);
    player.state = player.readState();
    player.arsenal = this.arsenal(player);
    if (source.kind === "q1") this.entryCarry.set(actor, captureQ1Travel(source.game, actor));
    return { actor: actor.id, viewHeight: player.viewHeight };
  }

  private attachQ2Character(player: MovementPlayer): undefined {
    const content = this.recipe.character.definition.content;
    const character = new Q2CharacterActor(player.actor, { bodies: this.bodies, combat: this.combat, inventory: this.inventory,
      now: () => this.timeSeconds, random: () => this.random.nextUnit(),
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.viewAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: this.bodies.read(actor)?.ground !== null, ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
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
      mode: this.options.mode, deathmatchFlags: 0, environment: false });
    this.q2Characters.set(player.actor, character);
    this.callbacks.bind(player.actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction), die: reaction => character.die(reaction) });
    return undefined;
  }

  private spawnCharacterGib(gib: Q2CharacterGib): undefined {
    const actor = this.actors.allocate(this.recipe.character.definition.provider, "q2:character-gib");
    this.bodies.create(actor, { origin: gib.origin, velocity: gib.velocity, angles: zero, bounds: { min: zero, max: zero }, ground: null });
    this.physics.setSolid(actor, "none", null, "q2");
    this.physics.setMotion({ actor, velocity: gib.velocity, angularVelocity: gib.angularVelocity, kind: "toss", gravity: 1, clipMask: 3, owner: null });
    this.callbacks.bind(actor, { think: self => this.actors.release(self), touch: null, use: null, pain: null, die: null });
    this.detachedModels.set(actor, { content: this.recipe.character.definition.content, path: gib.model });
    this.schedule(actor, gib.expiresAt); this.bodies.link(actor); return undefined;
  }

  private dropPlayerInventory(player: MovementPlayer): undefined {
    if (this.source.kind !== "q1" || this.options.mode === "singleplayer") return undefined;
    const body = this.bodies.read(player.actor.id); if (body === null) return undefined;
    dropBackpack(this.source.game, body.origin, { weapon: this.source.game.player(player.actor.id)?.weapon ?? null,
      shells: this.inventory.count(player.actor.id, "q1:ammo/shells"), nails: this.inventory.count(player.actor.id, "q1:ammo/nails"),
      rockets: this.inventory.count(player.actor.id, "q1:ammo/rockets"), cells: this.inventory.count(player.actor.id, "q1:ammo/cells") });
    return undefined;
  }

  private respawnPlayer(player: MovementPlayer): undefined {
    if (this.source.kind === "q2") { const entity = this.source.game.entity(player.actor.id); return entity === null ? undefined : this.source.players.respawn(entity, this.source.game); }
    if (this.source.kind !== "q1") throw new Error("Respawn before source entry");
    if (this.options.mode === "singleplayer") { this.transitions.push({ kind: "campaign-level", campaign: this.recipe.map.entities.provider,
      map: `q1:${this.source.game.mapName}`, spawnPoint: "", gates: [], cause: player.actor.id }); return undefined; }
    const start = this.source.base.spawnSelector.select();
    if (start === null) return undefined;
    const body = this.bodies.read(player.actor.id), spot = this.source.game.body(start); if (body === null) throw new Error("Respawn player body missing");
    this.bodies.write(player.actor, { ...body, bounds: player.standingBounds }); player.bounds = player.standingBounds; player.viewHeight = player.character === "q3" ? 26 : 22;
    admitQ1Travel(this.source.game, player.actor, this.options.mode === "coop" ? this.entryCarry.get(player.actor) ?? newQ1Travel(this.source.game.options) : newQ1Travel(this.source.game.options));
    this.combat.setTraits(player.actor, { canTakeDamage: true, invulnerable: false });
    this.setPlayerMovement(player.actor.id, { kind: "spawn", origin: add(spot.origin, { x: 0, y: 0, z: 1 }), velocity: zero, angles: spot.angles, commandAngles: player.viewAngles, holdMilliseconds: 0, spectator: false });
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
    if (this.source.kind === "q1") {
      const state = this.source.game.player(player.actor.id);
      if (state === null) throw new Error("Q1 player has no arsenal");
      return { provider: this.weaponProvider.provider, activeWeapon: `q1:weapon/${state.weapon}`, ammo: this.inventory.entries(player.actor.id),
        state: { kind: "q1", frame: state.weaponFrame, attackFinishedSeconds: state.attackFinished, sourceWeapon: 1 << Q1_WEAPONS.indexOf(state.weapon) } };
    }
    if (this.source.kind !== "q2") throw new Error("Arsenal accessed before source admission");
    const state = this.source.weapons.states.get(player.actor.id);
    if (state === undefined) throw new Error("Q2 player has no arsenal");
    return { provider: this.weaponProvider.provider, activeWeapon: state.weapon === null ? null : q2WeaponDefinition(state.weapon).item, ammo: this.inventory.entries(player.actor.id),
      state: { kind: "q2", gunFrame: state.frame, state: state.phase === "ready" ? 0 : state.phase === "activating" ? 1 : state.phase === "dropping" ? 2 : 3,
        pendingWeapon: state.pending === null ? null : q2WeaponDefinition(state.pending).item, machinegunShots: state.machinegunShots,
        grenadeTime: { kind: "seconds", value: state.grenadeTime }, grenadeBlewUp: state.grenadeBlewUp } };
  }

  private weaponStep(input: WeaponStepInput): WeaponStepResult {
    const player = this.playerStates.get(input.actor);
    if (player === undefined) throw new Error("Weapon input has no admitted player");
    if (this.source.kind === "q1") this.playerWeapon(player);
    return { arsenal: this.arsenal(player), animation: this.characters.get(input.actor)?.animation ?? input.animation, effects: [] };
  }

  private playerWeapon(player: MovementPlayer): undefined {
    const source = this.source, pressed = (player.buttons & 1) !== 0;
    if (source.kind === "q1") source.game.weaponInput(player.actor, pressed, player.viewAngles, this.timeSeconds, player.waterLevel);
    else if (source.kind === "q2") { const entity = source.game.entity(player.actor.id); if (entity !== null) source.players.beginFrame(entity, source.game); }
    return undefined;
  }

  private q2WeaponInput(player: MovementPlayer) {
    const pressed = (player.buttons & 1) !== 0;
    return { attack: pressed, latchedAttack: pressed && (player.previousButtons & 1) === 0, holster: false, angles: player.viewAngles,
      ducked: player.bounds.max.z < player.standingBounds.max.z, spectator: false, notarget: false, hand: "right", animatePlayer: player.character === "q2",
      quadUntil: this.source.kind === "q2" ? this.source.items.playerPowerups(player.actor.id).quadUntil : 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false,
      instantSwitch: false, quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false } satisfies import("../../../content/q2/foundation/weapons/types.ts").Q2WeaponInput;
  }

  private setPlayerMovement(actor: ActorId, change: Q2PlayerMovementChange): undefined {
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
    const velocity = change.kind === "freeze" ? zero : change.velocity;
    this.bodies.write(player.actor, { ...body, origin: change.origin, velocity, angles: change.angles, ground: null });
    player.ground = { kind: "none" };
    if (state.kind === "q1-netquake") player.state = { ...state, origin: change.origin, oldOrigin: change.origin, velocity, viewAngles: change.angles,
      angles: change.angles, flags: state.flags & ~512, moveType: change.kind === "spawn" ? 3 : change.kind === "freeze" ? 0 : state.moveType, ground: { kind: "none" }, fixAngle: false, teleportTimeSeconds: this.timeSeconds + (change.kind === "freeze" ? 0 : change.holdMilliseconds / 1000) };
    else if (state.kind === "q2-classic") player.state = { ...state, originEighths: [Math.trunc(change.origin.x * 8), Math.trunc(change.origin.y * 8), Math.trunc(change.origin.z * 8)],
      velocityEighths: [Math.trunc(velocity.x * 8), Math.trunc(velocity.y * 8), Math.trunc(velocity.z * 8)], flags: change.kind === "freeze" ? state.flags : state.flags | 32,
      timeEightMilliseconds: change.kind === "freeze" ? 0 : Math.trunc(change.holdMilliseconds / 8), deltaAngleShorts: [0, 0, 0], type: change.kind === "freeze" ? 4 : 0 };
    else if (state.kind === "q2-rerelease") player.state = { ...state, origin: change.origin, velocity, flags: change.kind === "freeze" ? state.flags : state.flags | 32,
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
    this.bodies.link(player.actor);
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
    player.commit(state, false, false);
    const other = contact.other.kind === "actor" ? contact.other.actor : this.worldActor();
    if (other !== null) {
      this.callbacks.touch({ ...contact, other });
      const owner = this.actors.resolveOwned(other);
      if (owner !== null && this.actors.isLive(contact.self.id)) this.callbacks.touch({ ...contact, self: owner, other: contact.self.id });
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
      this.hostMilliseconds += input.elapsedMilliseconds;
      const profile = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
      const fixed = profile.kind === "q2-classic" ? 100 : profile.kind === "q2-rerelease" ? profile.frameMilliseconds : null;
      const run = fixed === null || this.hostMilliseconds >= this.timeSeconds * 1000;
      const elapsed = fixed === null ? Math.min(0.1, Math.max(0.001, input.elapsedMilliseconds / 1000)) : fixed / 1000;
      if (run) {
        if (fixed === null) this.sourceFrame = { ...this.clock.frame, elapsed: { kind: "seconds", value: elapsed }, phase: "frame-entry" };
        else this.sourceFrame = this.clock.advance({ kind: this.clock.frame.time.kind, value: this.clock.frame.time.kind === "seconds" ? elapsed : fixed });
      }
      for (const command of input.commands) {
        const player = this.player(command.actor);
        if (player === null) throw new Error("Command targets an unadmitted player");
        if (command.source.kind !== "bot" && (command.source.client.slot !== player.client.slot || command.source.client.generation !== player.client.generation || !this.options.identity.owns(command.source.client))) throw new Error("Command client does not own this player");
        if (command.sequence <= player.lastSequence) continue;
        if (this.source.kind === "q1" && this.source.game.intermission !== null) {
          player.previousButtons = player.buttons; player.buttons = command.command.buttons; player.lastSequence = command.sequence;
          const result = this.source.base.levelRules.requestExit(this.timeSeconds, player.buttons !== 0);
          if (result.kind !== "waiting") this.events.emit(this.recipe.map.entities.content, { kind: "q1-level", event: result });
          continue;
        }
        player.move(command, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: player.profile.kind === "q1-netquake" ? Math.min(100, Math.max(1, input.elapsedMilliseconds)) : input.elapsedMilliseconds } });
        if (this.source.kind === "q2" && this.actors.isLive(player.actor.id)) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) this.source.players.afterClientThink(entity, this.source.game); }
        this.q2Characters.get(player.actor)?.afterClientThink();
        const q1Character = this.q1Characters.get(player.actor); if (q1Character !== undefined) q1Character.postMove();
      }
      if (run) {
        if (this.source.kind === "q2") this.source.monsters.beginFrame(this.source.game);
        const visited = new Set<OwnedActor>();
        for (;;) {
          const actor = this.actors.observations().map(value => this.actors.resolveOwned(value.id)).filter((value): value is OwnedActor => value !== null && !visited.has(value)).sort((a, b) => this.sourceOrder(a.id, b.id))[0];
          if (actor === undefined) break;
          visited.add(actor);
          if (this.playerStates.has(actor)) {
            this.q2Characters.get(actor)?.beginFrame();
            this.playerWeapon(this.playerStates.get(actor) ?? this.requirePlayer(actor.id)); continue;
          }
          if (this.source.kind === "q1") {
            const entity = this.source.game.entity(actor.id), pusher = entity?.movement === "push";
            if (!pusher) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
            if (this.actors.isLive(actor.id)) {
              if (entity?.movement === "noclip") { const body = this.bodies.read(actor.id);
                if (body !== null) { this.bodies.write(actor, { ...body, origin: add(body.origin, { x: body.velocity.x * elapsed, y: body.velocity.y * elapsed, z: body.velocity.z * elapsed }),
                  angles: add(body.angles, { x: entity.angularVelocity.x * elapsed, y: entity.angularVelocity.y * elapsed, z: entity.angularVelocity.z * elapsed }) }); this.bodies.link(actor); }
              } else if (entity === null) this.physics.step(actor, elapsed);
              else this.source.game.physicsEntity(actor, this.timeSeconds, elapsed);
            }
            if (pusher && this.actors.isLive(actor.id)) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
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
                return undefined;
              }
              const after = entity?.motion === "step";
              if (!after) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
              if (this.actors.isLive(actor.id)) this.physics.step(actor, elapsed);
              if (after && this.actors.isLive(actor.id)) this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
              return undefined;
            });
          }
        }
        if (this.source.kind === "q2") for (const player of this.playerStates.values()) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) this.source.players.endFrame(entity, this.source.game); }
        if (this.source.kind === "q2") {
          this.source.monsters.endFrame(this.source.game);
          this.checkingQ2Rules = true;
          try { this.source.players.checkRules(this.source.game); } finally { this.checkingQ2Rules = false; }
        }
        for (const event of this.physics.drainEvents()) if (this.source.kind === "q2") this.events.emit(this.recipe.map.entities.content, { kind: "q2", event: {
          kind: "sound", actor: event.actor, origin: event.origin, path: event.kind === "land" ? "world/land.wav" : "misc/h2ohit1.wav",
          channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" } });
        if (this.source.kind === "q1") for (const player of this.playerStates.values()) this.source.game.playerFrame(player.actor, this.timeSeconds, player.waterLevel);
        for (const [actor, character] of this.q2Characters) if (this.timeSeconds + 0.001 >= (this.characterTicks.get(actor) ?? 0)) {
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
          player.animation = { provider: this.recipe.character.definition.provider, state: { kind: "q1", frame: frame.frame, nextFrameSeconds: this.timeSeconds + 0.1 } };
        }
        if (fixed === null) this.sourceFrame = this.clock.advance({ kind: "seconds", value: elapsed }, "frame-exit");
        else { this.sourceFrame = this.clock.enter("frame-exit"); if (this.hostMilliseconds > this.timeSeconds * 1000) this.hostMilliseconds = this.timeSeconds * 1000; }
      }
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
      for (const [sourceOrdinal, weapon] of Q1_WEAPONS.entries()) {
        const item = ammoItem(weapon), count = item === null ? null : this.inventory.count(actor, item);
        items.push({ id: `q1:weapon/${weapon}`, label: weapon, kind: "weapon", sourceOrdinal,
          owned: this.inventory.count(actor, `q1:weapon/${weapon}`) > 0, hasAmmo: count === null || count >= (weapon === "supernailgun" || weapon === "supershotgun" ? 2 : 1), count, warningCount: 0 });
      }
      const weapon = this.source.game.player(actor)?.weapon;
      if (weapon !== undefined) { const item = ammoItem(weapon); if (item !== null) ammo = { item, count: this.inventory.count(actor, item) }; }
    } else if (this.source.kind === "q2") {
      for (const [sourceOrdinal, definition] of this.source.items.list().entries()) {
        if (!definition.usable) continue;
        const weapon = Q2_BASE_WEAPONS.find(value => value.item === definition.id), quantity = this.inventory.count(actor, definition.id);
        const count = weapon === undefined ? quantity : weapon.ammo === null ? null : this.inventory.count(actor, weapon.ammo);
        items.push({ id: definition.id, label: definition.name, kind: weapon === undefined ? "powerup" : "weapon", sourceOrdinal,
          owned: quantity > 0, hasAmmo: count === null || count >= (weapon?.quantity ?? 1), count, warningCount: weapon?.warning ?? 0 });
      }
      const weapon = Q2_BASE_WEAPONS.find(value => value.item === arsenal.activeWeapon);
      if (weapon !== undefined && weapon.ammo !== null) ammo = { item: weapon.ammo, count: this.inventory.count(actor, weapon.ammo) };
    }
    return { health: combat.health, armor: combat.armor, activeWeapon: arsenal.activeWeapon, ammo, inventory, items };
  }

  playerView(actor: ActorId): PlayerView {
    const player = this.requirePlayer(actor), view = player.view(), source = this.q2Views.get(actor);
    return player.character !== "q2" || source === undefined ? view
      : { origin: add(view.origin, { x: source.offset.x, y: source.offset.y, z: 0 }), angles: add(source.angles, source.kickAngles), viewHeight: source.offset.z };
  }
  q2Source(): Extract<SourceRuntime, { readonly kind: "q2" }> | null { return this.source.kind === "q2" ? this.source : null; }
  movementPlayer(actor: ActorId): Readonly<MovementPlayer> | null { return this.player(actor); }
  q2PlayerView(actor: ActorId): Q2PlayerView | null { return this.q2Views.get(actor) ?? null; }
  disconnectPlayer(actor: ActorId): undefined {
    const player = this.player(actor); if (player === null) return undefined;
    if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) { this.source.players.disconnect(entity, this.source.game); return this.source.game.remove(entity); } }
    if (this.source.kind === "q1") { const entity = this.source.game.entity(actor); if (entity !== null) return this.source.game.remove(entity); }
    return this.actors.release(player.actor);
  }
  private requirePlayer(actor: ActorId): MovementPlayer { const player = this.player(actor); if (player === null) throw new Error("Actor is not an admitted player"); return player; }
  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined { return this.events.registerResource(content, path, resource); }
  drainPresentationEvents(): readonly SimulationPresentationEvent[] { return this.events.takePresentation(); }

  presentations(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [], content = this.recipe.map.entities.content;
    if (this.source.kind === "q1") for (const entity of this.source.game.presentations()) {
      const body = this.bodies.read(entity.actor);
      if (body !== null && this.player(entity.actor) === null && entity.model !== "" && entity.model !== this.recipe.map.geometry.requestedPath) result.push({ actor: entity.actor, content, family: "q1", path: entity.model,
        frame: entity.frame, oldFrame: entity.frame, skin: entity.skin, effects: entity.effects, renderFlags: 0, origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false });
    }
    if (this.source.kind === "q2") for (const entity of this.source.game.entities.values()) {
      const body = this.bodies.read(entity.actor.id), model = this.sourceModels.get(entity.actor.id);
      if (body !== null && this.player(entity.actor.id) === null && entity.model !== "" && entity.classname !== "worldspawn") result.push({ actor: entity.actor.id, content, family: "q2", path: entity.model,
        frame: model?.frame ?? entity.frame, oldFrame: model?.oldFrame ?? entity.frame, skin: model?.skin ?? entity.skin, effects: model?.effects ?? entity.effects,
        renderFlags: model?.renderFlags ?? entity.renderFlags, origin: body.origin, angles: body.angles, scale: model?.scale ?? 1, visible: (entity.serverFlags & 1) === 0, viewWeapon: false });
    }
    for (const player of this.playerStates.values()) {
      if (player.character === "q3") continue;
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
      const player = this.player(actor); if (player === null) continue;
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
      if (player === undefined || body === null || animation.kind !== "q3") return [];
      return [{ actor: owner.id, origin: body.origin, angles: player.viewAngles, velocity: body.velocity,
        movementDirection: player.state.kind === "q3" ? player.state.movementDirection : 0, animation, sourceFlags: character.sourceFlags,
        powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } }];
    });
  }

  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
    const player = this.requirePlayer(actor);
    if (this.source.kind === "q1") {
      const active = this.source.game.player(actor)?.weapon, owned = Q1_WEAPONS.filter(weapon => this.inventory.count(actor, `q1:weapon/${weapon}`) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : Q1_WEAPONS.find(value => value === requested || `q1:weapon/${value}` === requested);
      if (weapon !== undefined) this.source.game.selectWeapon(player.actor, weapon);
    } else if (this.source.kind === "q2") {
      const entity = this.source.game.entity(actor); if (entity === null) throw new Error("Q2 player entity missing");
      const source = this.source, active = source.weapons.states.get(actor)?.weapon, owned = Q2_BASE_WEAPONS.filter(weapon => this.inventory.count(actor, weapon.item) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value.name === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : Q2_BASE_WEAPONS.find(value => value.name === requested || value.item === requested);
      if (weapon !== undefined) source.weapons.requestWeapon(entity, source.game, weapon.name);
      else if (name === "use") { const item = this.inventory.entries(actor).find(value => value.item === requested || value.item === `q2:item_${requested}`); if (item !== undefined) source.items.use(player.actor, item.item, source.game); }
    }
    return undefined;
  }

  captureTravel(spawnPoint = ""): SimulationTravel {
    this.assertOpen();
    const source = this.source;
    if (source.kind === "loading") throw new Error("Source map has not spawned");
    const landmark = this.levelChange?.landmark ?? null;
    const landmarkPlayer = landmark === null ? null : this.player(landmark.player);
    return { spawnPoint, source: source.kind === "q1" ? { kind: "q1", flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }
      : { kind: "q2", serverFlags: this.levelChange?.serverFlags ?? source.game.counters.serverFlags,
        landmark: landmark === null || landmarkPlayer === null ? null : { clientSlot: landmarkPlayer.client.slot, name: landmark.name,
          relativeOrigin: landmark.relativeOrigin, relativeVelocity: landmark.relativeVelocity, relativeViewAngles: landmark.relativeViewAngles } },
      players: [...this.playerStates.values()].map(player => {
        if (source.kind === "q1") return { client: player.client, state: { kind: "q1", carry: captureQ1Travel(source.game, player.actor) } };
        const entity = source.game.entity(player.actor.id); if (entity === null) throw new Error("Q2 travel player entity is missing");
        return { client: player.client, state: { kind: "q2", carry: source.players.saveCarry(entity, source.game) } };
      }) };
  }
  admitTravel(client: ClientId, travel: SimulationTravel): PlayerAdmission { return this.admitPlayer(client, travel); }

  takeTransitions(): readonly TransitionIntent[] { return this.transitions.splice(0); }
  takeLevelChange() { const change = this.levelChange; this.levelChange = null; return change; }
  checkpoint(): SaveImage { throw new Error("Source game callback and level state capture is not implemented; a respawn is not a saved-game checkpoint"); }
  close(): undefined { if (this.closed) return undefined; this.closed = true; this.actors.close(); this.scheduler.close(); return undefined; }
  private assertOpen(): undefined { if (this.closed) throw new Error("Simulation is closed"); return undefined; }
}

export function createSimulation(options: SimulationOptions): SharedSimulation { return new SharedSimulation(options); }
