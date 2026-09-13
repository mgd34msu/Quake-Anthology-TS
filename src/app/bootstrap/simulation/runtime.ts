import { WorldTextStore } from "../../../text/world.ts";
import type { WorldText } from "../../../text/world.ts";
import { applyServerProfile, bindQ2ServerCvars, captureServerProfile, cvarServerSettingsOwner, registerQ2ServerCvars, serverDefinitionsForRecipe } from "../../../settings/server/index.ts";
import type { BoundServerSetting, ServerProfile, ServerSettingsOwner } from "../../../settings/server/index.ts";
import { q3GameCvarDefinitions } from "../../../content/q3/base/settings.ts";
import type { NetQuakeClientBinding } from "./players.ts";
import { QuakeCSource } from "./quakec-source.ts";
import type { QwUserCommand } from "../../../contracts/protocol.ts";
import { id1DamageMultiplier } from "../../../content/q1/quakec/id1-program.ts";
import { createNativeQ1PusherServices } from "./native-q1-pusher.ts";
import { q1WeaponStatus, q2WeaponStatus, q3WeaponStatus, q3ArsenalWarning } from "./arsenal/weapon-status.ts";
import { Q1ClientVisibility } from "../../../world/gameplay/q1-client-visibility.ts";
import type { Q1ClientEye } from "../../../world/gameplay/q1-client-visibility.ts";
import { selectedMonsterDefinitions } from "../../../content/catalog/monsters.ts";
import type { VictimArmorContext } from "../../../world/gameplay/armor.ts";
import { Q2MissionPackProjectiles } from "../../../content/q2/missionpacks/projectiles/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../../content/q2/base/monsters/index.ts";
import { registerQ2RereleaseOrdinaryMonsters } from "../../../content/q2/rerelease/monsters/index.ts";
import { WeaponSlot } from "./weapon-slot.ts";
import type { PrimaryWeaponHandoff, WeaponReference, WeaponSlotState } from "./weapon-slot.ts";
import { projectWeaponSlot } from "./weapon-slot-projection.ts";
import type { WeaponSlotProjection } from "./weapon-slot-projection.ts";
import { readWeaponSlots } from "./weapon-slot-checkpoint.ts";
import { GrappleRuntime } from "./grapple-runtime.ts";
import { SelectedMonsters } from "./monster-runtime.ts";
import { preservesAuthoredQ1Placement, preservesAuthoredQ2Placement } from "./monster-placement.ts";
import { parseQ2Entities } from "../../../content/q2/foundation/fields.ts";
import type { SelectedMonsterSource } from "./monster-runtime.ts";
import { monsterSource } from "../../../content/monsters/definitions.ts";
import type { MonsterMission } from "../../../content/monsters/authored.ts";
import { setMonsterRoute } from "../../../content/q1/foundation/monsters.ts";
import { Q2Monsters } from "../../../content/q2/foundation/monsters/index.ts";
import type { GrappleSlotHost } from "./grapple-runtime.ts";
import { q2AttackFrames, q2ReverseFrames, q2WeaponAnimationRate, q2PowerupSound } from "../../../content/q2/foundation/weapons/presentation.ts";
import { readGrappleRuntimeCheckpoint } from "./grapple-checkpoint.ts";
import type { SharedGrappleControl } from "../../../contracts/equipment.ts";
import { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import { Q1Creatures, q1Creatures } from "../../../content/q1/base/creatures.ts";
import { baseSpecies } from "../../../content/q1/base/species.ts";
import { q1AmmoPickupSelection, q1WeaponPickupSelection } from "../../../content/q1/foundation/pickups.ts";
import { threewaveCharacterPose } from "../../../content/q1/equipment/threewave-weapon.ts";
import { ThreewaveGrapple } from "../../../content/q1/equipment/threewave-grapple.ts";
import { aim as q1Aim } from "../../../content/q1/foundation/weapons.ts";
import { Q2CtfGrappleEquipment } from "../../../content/q2/equipment/ctf-grapple.ts";
import { LmctfGrappleEquipment } from "../../../content/q2/equipment/lmctf-grapple.ts";
import type { GrappleHooks, GrappleAnchor } from "../../../content/q2/equipment/grapple-services.ts";
import { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import { Q2Ballistics } from "../../../content/q2/foundation/weapons/ballistics.ts";
import { Q2HandGrenadeEquipment } from "../../../content/q2/equipment/hand-grenades.ts";
import { projectQ2Actor } from "../../../content/q2/foundation/weapons/projection.ts";
import { q3WeaponPickupQuantity, q3WeaponRespawnSeconds, RESPAWN_AMMO } from "../../../content/q3/base/game/item-pickup.ts";
import type { SourcePickupDescriptor, SourcePickupAdmission, SourcePickupPreview } from "../../../content/q3/base/game/item-lifecycle.ts";
import { Powerup, ItemType } from "../../../content/q3/base/shared/definitions.ts";
import { HandGrenadeRuntime } from "./equipment-runtime.ts";
import { readHandGrenadeRuntimeCheckpoint } from "./equipment-checkpoint.ts";
import { providerFrame } from "./provider-frames.ts";
import type { MonsterState as Q2MonsterState } from "../../../content/q2/foundation/monsters/types.ts";
import { createQ1ActorHost, createQ2ActorHost } from "./source-hosts.ts";
import type { ActorHostRuntime } from "./source-hosts.ts";
import { actorMotion, actorCollision, actorFlags, writeActorFlags, executeActor } from "./actor-execution.ts";
import type { ActorExecution } from "./actor-execution.ts";
import { Q2_Q1_SUPPLY_PROFILE, Q2_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q2-q1-supply.ts";
import { Q3_Q1_SUPPLY_PROFILE, Q3_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q3-q1-supply.ts";
import { Q1_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q1-hipnotic-supply.ts";
import { registerHipnoticWeapons } from "../../../content/q1/missionpacks/arsenal.ts";
import { missionWeaponImpulse } from "../../../content/q1/missionpacks/selection.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../content/composition/q2-q3-supply.ts";
import { SharedPickupAdmission } from "../../../world/gameplay/pickups.ts";
import { Q1_Q3_SUPPLY_PROFILE, q1Q3SupplyLoadout } from "../../../content/composition/q1-q3-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE, q1Q2PickupSelect, q1Q2SupplyLoadout } from "../../../content/composition/q1-q2-supply.ts";
import { Q3SharedBallistics, readQ3ProjectileStates, readQ3WeaponStatistics } from "./q3-ballistics.ts";
import { GameRandom } from "../../../core/game-numeric.ts";
import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import { emitQ2ShadowLights } from "../../../content/q2/foundation/shadow-lights.ts";
import { SimulationBotServices } from "./bots.ts";
import { readQ1FoundationCheckpoint } from "../../../persistence/q1-foundation.ts";
import { Q1SelectedArsenal } from "./arsenal/q1.ts";
import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readQ2WeaponsCheckpoint } from "../../../persistence/q2-weapons.ts";
import { Q2SelectedArsenal, projectQ2Arsenal } from "./arsenal/q2.ts";
import { q2BaseWeaponInventory } from "../../../content/q2/foundation/items.ts";
import { Q3_Q2_SUPPLY_PROFILE, q3Q2SupplyLoadout } from "../../../content/composition/q3-q2-supply.ts";
import { Q3SelectedArsenal, readQ3SelectedArsenalCheckpoint } from "./arsenal/q3.ts";
import { playerMovementEnvironment } from "./player-movement.ts";
import { resolveQ3ArsenalControls } from "./arsenal-intent.ts";
import { isDeepStrictEqual } from "node:util";
import type { ContentId, ExecutableRecipe, MonsterDefinitionReference, ProviderReference, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { PickupSupplyProfile, PickupSupplyOffer } from "../../../contracts/pickups.ts";
import type { AttackProvenance, DamageRequest, ItemId, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ActorId, ClientId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
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
import { WEAPONS as Q1_WEAPONS, isQ1BaseWeapon, q1WeaponBit } from "../../../content/q1/foundation/types.ts";
import type { Q1PlayerState } from "../../../content/q1/foundation/types.ts";
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
import type { Q2FoundationHost, Q2PresentationEvent, Q2LandmarkCarry, Q2WeaponTarget } from "../../../content/q2/foundation/host.ts";
import type { Q2ItemHooks } from "../../../content/q2/foundation/items.ts";
import { Q2Weapons, Q2WeaponState, Q2_BASE_WEAPONS } from "../../../content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent } from "../../../content/q2/foundation/weapons/index.ts";
import { Q3CharacterActor, Q3DeathAnimationSequence, q3InitialCombat, stepQ3CharacterAnimation } from "../../../content/q3/foundation/character.ts";
import type { Q3CharacterView } from "../../../content/q3/foundation/presentation.ts";
import { q3RequestWeapon, q3RequestWeaponHolster, q3RequestWeaponResume, q3SpawnLoadout, q3SpawnArsenalRuntime, stepQ3Arsenal, q3WeaponItem, Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import type { Q3ArsenalRuntimeState } from "../../../content/q3/foundation/arsenal.ts";
import type { GameEntity } from "../../../content/q3/base/game/state.ts";
import type { UserCommand as Q3SourceCommand } from "../../../content/q3/base/shared/player-state.ts";
import type { SpawnPose } from "../../../content/q3/team-arena/client-spawn.ts";
import type { ClientMovementOptions, ClientMovementResult } from "./q3/types.ts";
import { Q3SourceRuntime, createQ3SourceHost, readQ3MovementState, writeQ3MovementState, writeQ3CharacterAnimation,
  readQ3MovementEnvironment, readQ3ArsenalRuntime, writeQ3ArsenalRuntime, applyQ3CommandPolicy } from "./q3/index.ts";
import { CommandButtons, MoveFlags, MoveType, PlayerAnimation } from "../../../movement/q3/constants.ts";
import { q3SourceCommand, relativeQ3SourceCommand, selectedQ3Command } from "./q3-commands.ts";
import { q3SourceAnimation, q3SourceTorso, runQ3TorsoOperation } from "../../../movement/q3/animation.ts";
import { createQ1MonsterMovement } from "../../../movement/q1/index.ts";
import type { Q1MonsterMovement } from "../../../movement/q1/monsters.ts";
import { SharedPhysics } from "./physics.ts";
import type { SharedSolid } from "./physics.ts";
import { MovementPlayer, movementOrigin, providerFamily, providerTiming } from "./players.ts";
import { SimulationEvents } from "./events.ts";
import { SourceRandom } from "./random.ts";
import { captureSharedBodies, restoreSharedBodyLinks, restoreSharedWorldState, sourceActorsCheckpoint, readSourceActorsCheckpoint,
  savedActorId, readSavedActor, encodeCheckpointValue, decodeCheckpointValue, SaveReader, encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint,
  readQ2CharacterCheckpoint } from "../../../persistence/index.ts";
import { readContentId } from "../../../persistence/recipe.ts";
import { readRandom, readVector } from "../../../persistence/shared.ts";
import { captureMovementPlayer, readMovementPlayer, readQ1Travel, readQ2View, readQ3Character } from "./player-checkpoint.ts";
import { simulationProviderCheckpoint, simulationSaveReader, savedSimulationSettings } from "./save.ts";
import type { PlayerAdmission, PlayerView, PlayerUi, PlayerUiItem, SimulationTravel, SimulationOptions, SimulationPresentation, SimulationPresentationEvent } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function add(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function seconds(time: SourceTime): number { return time.kind === "seconds" ? time.value : time.value / 1000; }
function replacedSupplyItems(profile: PickupSupplyProfile): readonly ItemId[] {
  const mappings = [...profile.ammo, ...profile.weapons], retained = new Set(mappings.flatMap(mapping => mapping.destinations));
  return mappings.map(mapping => mapping.source).filter(source => !retained.has(source));
}
function sourceModel(path: string): number | null { return /^\*[0-9]+$/.test(path) ? Number(path.slice(1)) : null; }


type SourceRuntime = { readonly kind: "loading" }
  | { readonly kind: "quakec"; readonly game: QuakeCSource }
  | { readonly kind: "q1"; readonly game: Q1Foundation; readonly composition: Q1SourceComposition; readonly cvars: CvarRegistry }
  | { readonly kind: "q3"; readonly game: Q3SourceRuntime }
  | ({ readonly kind: "q2"; readonly product: Q2ProductRuntime } & Pick<Q2ProductRuntime, "game" | "weapons" | "monsters" | "movers" | "items" | "players" | "baseEntities">);

type SelectedWeaponSource = { readonly kind: "q1"; readonly game: Q1EntityServices; readonly random: SourceRandom }
  | { readonly kind: "q2"; readonly game: Q2EntityServices; readonly weapons: Q2Weapons; readonly random: SourceRandom;
    frame: FrameContext; mapMilliseconds: number; nextMilliseconds: number; readonly intervalMilliseconds: number };

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
  private readonly actorExecutions = new Map<ActorId, ActorExecution>();
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
  private grapple: GrappleRuntime | null = null;
  private readonly weaponSlots = new Map<ActorId, WeaponSlot>();
  private grappleFrame: FrameContext;
  private handGrenades: HandGrenadeRuntime | null = null;
  private equipmentFrame: FrameContext;
  private selectedBallistics: Q3SharedBallistics | null = null;
  private readonly selectedRandom = new GameRandom();
  private selectedMilliseconds = 0;
  private selectedArsenal: Q1SelectedArsenal | Q2SelectedArsenal | Q3SelectedArsenal | null = null;
  private selectedWeaponSource: SelectedWeaponSource | null = null;
  private readonly primaryCommandBlocks = new Set<ActorId>();
  private selectedSupply: SharedPickupAdmission | null = null;
  private readonly q3Arsenals = new Map<OwnedActor, Q3ArsenalRuntimeState>();
  private readonly q3Commands = new Map<OwnedActor, ActorCommand>();
  private readonly deathAnimations = new Q3DeathAnimationSequence();
  private readonly sourceModels = new Map<ActorId, Extract<Q2PresentationEvent, { readonly kind: "model" }>>();
  private readonly viewModels = new Map<ActorId, { readonly path: string; readonly frame: number;
    readonly q2?: { readonly skin: number; readonly rate: number; readonly kickOrigin: Vec3; readonly kickAngles: Vec3 } }>();
  private readonly transitions: TransitionIntent[] = [];
  private levelChange: { readonly map: string; readonly landmark: Q2LandmarkCarry | null; readonly serverFlags: number } | null = null;
  readonly weaponProvider: ProviderReference;
  private readonly q1Movement: Q1MonsterMovement;
  private selectedMonsters: SelectedMonsters | null = null;
  private readonly monsterSources = new Map<ProviderId, SelectedMonsterSource>();
  private readonly monsterMissions = new Map<ActorId, MonsterMission>();
  private q2ServerRegistry: CvarRegistry | null = null;
  private readonly worldTextStore = new WorldTextStore();
  private worldTextFrame = -1;
  private worldTextSnapshot: readonly WorldText[] = [];
  private source: SourceRuntime = { kind: "loading" };
  private sourceFrame: FrameContext;
  private hostMilliseconds = 0;
  private sourceSchedulingMilliseconds = 0;
  private closed = false;
  private stepping = false;
  private checkingQ2Rules = false;
  private readonly q1ClientVisibility: Q1ClientVisibility;
  private attackSequence = 0;
  private q1Restart = false;
  private readonly lastAttack = new Map<OwnedActor, AttackProvenance>();
  private readonly areaPortals = new Map<number, boolean>();
  private readonly quakeWorldCommands: ({ readonly kind: "move"; readonly client: ClientId; readonly commands: readonly QwUserCommand[]; readonly sequence: number } | { readonly kind: "action"; readonly client: ClientId; readonly action: () => void })[] = [];
  private quakeWorldTouched: Set<number> | null = null;

  constructor(readonly options: SimulationOptions) {
    this.session = options.identity.session;
    this.q1Campaign = new Q1CampaignState(options.travel?.source.kind === "q1" ? options.travel.source.flags : 0, options.travel?.source.kind === "q1" ? options.travel.source.skill : options.skill);
    this.recipe = options.recipe;
    const quakec = options.recipe.execution.find(module => module.kind === "quakec");
    if (quakec !== undefined) {
      if (options.dedicated !== true || options.preparedQuakeC === undefined || !isDeepStrictEqual(quakec, options.preparedQuakeC.execution)
        || options.world.kind !== "q1-bsp" || options.recipe.execution.length !== 1 || !options.recipe.map.entities.content.startsWith(quakec.api.kind === "q1-quakeworld" ? "q1:quakeworld:id1:" : "q1:classic:id1:")
        || options.recipe.enemies.kind !== "map-defined" || options.recipe.weapons.some(weapon => !isDeepStrictEqual(weapon, options.recipe.map.entities)))
        throw new Error("QuakeC simulation requires the prepared dedicated native classic id1 artifact and map-defined actors");
      if (quakec.api.kind === "q1-quakeworld" && (options.mode !== "deathmatch" || options.maxClients > 32 || providerTiming(options.recipe, options.recipe.movement.provider).clock.kind !== "q1-quakeworld"))
        throw new Error("Native QuakeWorld requires deathmatch, at most 32 clients and QuakeWorld movement");
      if (options.restore !== undefined || options.travel !== undefined && (quakec.api.kind !== "q1-quakeworld" || options.travel.source.kind !== "quakeworld") || (options.restoredClients?.length ?? 0) !== 0
        || options.initialSourceMilliseconds !== undefined && options.initialSourceMilliseconds !== 1000)
        throw new Error("QuakeC application clients, travel and saved games are not yet supported");
    } else if (options.preparedQuakeC !== undefined) throw new Error("Prepared QuakeC artifact does not match the selected execution");
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
    const initial = saved === undefined ? options.initialSourceMilliseconds ?? (options.preparedQuakeC === undefined ? 0 : 1000) : seconds(saved.frame.time) * 1000;
    if (!Number.isFinite(initial) || initial < 0) throw new RangeError("Initial source time must be finite and nonnegative");
    this.clock = new SourceClock({ kind: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? "milliseconds" : "seconds",
      value: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? initial : initial / 1000 }, saved?.frame.frame ?? 0);
    this.hostMilliseconds = initial;
    this.sourceSchedulingMilliseconds = initial;
    this.selectedMilliseconds = initial; this.selectedRandom.reset(options.seed);
    this.sourceFrame = saved?.frame ?? this.clock.frame;
    this.equipmentFrame = this.sourceFrame;
    this.grappleFrame = this.sourceFrame;
    this.random = new SourceRandom(options.seed, timing.clock.kind === "q2-rerelease" ? "q2-rerelease" : "classic");
    this.actors = saved === undefined ? new SessionActorRegistry(options.identity)
      : SessionActorRegistry.restore(options.identity, saved.actors, readSourceActorsCheckpoint(simulationProviderCheckpoint(saved, "world:source-slots")));
    this.callbacks = new ActorCallbackTable(this.actors);
    this.scene = new SharedSceneQueries(options.world);
    this.physics = new SharedPhysics({ actors: this.actors, callbacks: this.callbacks, scene: this.scene, numeric: timing.numeric,
      q2Edition: this.recipe.map.entities.content.includes(":rerelease:") ? "rerelease" : "classic",
      takeKillVelocity: actor => { const entry = this.actorExecutions.get(actor.id), entity = entry?.kind === "q2" ? entry.entity : null;
        if (entity === null || (entity.flags & 0x800000) === 0) return false; entity.flags &= ~0x800000; return true; },
      stopSpeed: () => this.source.kind === "q2" ? this.source.product.movementStopSpeed ?? 100 : 100,
      sourceOrder: (a, b) => this.sourceOrder(a, b), worldActor: () => this.worldActor(), getCollision: actor => this.collision(actor),
      getMotion: actor => {
        const body = this.physics.bodies.read(actor.id); if (body === null) return null;
        const player = this.playerStates.get(actor);
        if (player !== undefined) return { actor, velocity: body.velocity, angularVelocity: zero,
          kind: this.q2Characters.get(actor)?.state.dead ? this.q2Characters.get(actor)?.state.gibbed ? "bounce" : "toss" : "step", gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null };
        const entry = this.actorExecutions.get(actor.id);
        return entry === undefined ? null : actorMotion(entry, body);
      },
      getFlags: actor => {
        const player = this.playerStates.get(actor), entry = this.actorExecutions.get(actor.id);
        return { ...(entry === undefined ? {} : actorFlags(entry)),
          ...(player === undefined || entry?.kind === "q1" ? {} : { waterLevel: player.waterLevel, waterType: player.waterType }),
          player: player !== undefined, dead: (this.combat?.read(actor.id)?.health ?? 1) <= 0 };
      },
      writeFlags: (actor, changes) => {
        const player = this.playerStates.get(actor);
        if (player !== undefined) { if (changes.waterLevel !== undefined) player.waterLevel = changes.waterLevel; if (changes.waterType !== undefined) player.waterType = changes.waterType; }
        const entry = this.actorExecutions.get(actor.id);
        return entry === undefined ? undefined : writeActorFlags(entry, changes);
      },
      event: event => {
        const entry = this.actorExecutions.get(event.actor), family = entry?.kind === "quakec" ? "q1" : entry?.kind ?? providerFamily(this.recipe.map.entities.provider);
        return this.events.emit(entry?.content ?? this.recipe.map.entities.content, family === "q1" ? { kind: "q1", event: {
          kind: "sound", actor: event.actor, path: event.kind === "land" ? "demon/dland2.wav" : "misc/h2ohit1.wav", channel: "auto", volume: 1, attenuation: 1 } }
          : { kind: "q2", event: { kind: "sound", actor: event.actor, origin: event.origin, path: event.kind === "land" ? "world/land.wav" : "misc/h2ohit1.wav",
            channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" } });
      },
      q1WaterTransition: actor => {
        const entry = this.actorExecutions.get(actor.id);
        if (entry?.kind === "q1") entry.services.checkWaterTransition(entry.entity);
        else if (entry?.kind === "quakec") entry.source.checkWaterTransition(actor);
        return undefined;
      },
      writeAngularVelocity: (actor, velocity) => {
        const entry = this.actorExecutions.get(actor.id);
        if (entry?.kind === "quakec") entry.source.writeAngularVelocity(actor, velocity);
        else if (entry !== undefined && entry.kind !== "q3") entry.entity.angularVelocity = velocity;
        return undefined;
      },
      onBlocked: (actor, other) => {
        const entry = this.actorExecutions.get(actor.id);
        if (entry?.kind === "q1") entry.entity.blocked?.(other);
        else if (entry?.kind === "q2") entry.entity.blocked?.(entry.entity, entry.services, other);
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
        if (decision.reaction === "death") { const player = this.playerStates.get(actor); if (player !== undefined) { this.grapple?.release(actor.id); this.stepHandGrenade(player, "dead"); } }
        if (this.source.kind === "q1") this.source.composition.beforeReaction(actor, decision);
        if (this.source.kind === "q2") { const entity = this.source.game.entity(actor.id); if (entity !== null) { entity.lastAttack = decision.request.attack; if (this.playerStates.has(actor)) this.source.product.beforeReaction(actor.id, decision.request.attack); } }
        if (decision.reaction === "death" && this.source.kind === "q2" && this.playerStates.has(actor) && this.playerStates.get(actor)?.character !== "q2") {
          const entity = this.source.game.entity(actor.id); if (entity !== null) this.source.players.recordDeath(entity, this.source.game, { attack: decision.request.attack, self: actor, attacker: decision.request.attack.attacker,
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
      executionProvider: actor => this.executionProvider(actor),
      resolve: (_provider, callback) => callback === "world:think" ? (actor, frame) => { this.callbacks.think(actor, frame); return undefined; } : null });
    this.actors.onRelease(actor => {
      this.actorExecutions.delete(actor.id);
      this.monsterMissions.delete(actor.id);
      this.selectedArsenal?.remove(actor.id);
      this.scheduler.cancel(actor); this.weaponSlots.delete(actor.id); this.playerStates.delete(actor); this.characters.delete(actor); this.characterStarts.delete(actor); this.q3Arsenals.delete(actor); this.q3Commands.delete(actor); this.q1Characters.delete(actor); this.q2Views.delete(actor.id); this.q2Characters.delete(actor); this.characterTicks.delete(actor); this.entryCarry.delete(actor); this.detachedModels.delete(actor); this.sourceModels.delete(actor.id); this.viewModels.delete(actor.id); this.lastAttack.delete(actor);
      return undefined;
    });
    this.q1Movement = this.createMonsterMovement(timing.numeric, this.random);
    this.q1ClientVisibility = new Q1ClientVisibility({ maxClients: this.options.maxClients, visibility: this.scene,
      client: slot => {
        const player = [...this.playerStates.values()].find(player => player.client.slot + 1 === slot);
        const actor = slot === 0 ? this.worldActor() : player?.actor.id ?? null;
        const eye = actor === null ? null : this.q1VisibilityEye(actor);
        return { actor, free: actor === null || !this.actors.isLive(actor), health: actor === null ? 0 : this.combat.read(actor)?.health ?? 0,
          notarget: actor !== null && ((this.source.kind === "q1" && this.source.composition.noTarget(actor)) || (this.monsterTarget(actor)?.notarget ?? false)),
          origin: eye?.origin ?? zero, viewOffset: eye?.viewOffset ?? zero };
      } });
    this.source = this.createSource();
    this.handGrenades = this.createHandGrenades();
    this.grapple = this.createGrapple();
    if (this.source.kind !== "quakec" && (this.weaponProvider.content !== this.recipe.map.entities.content || providerFamily(this.weaponProvider.provider) !== this.source.kind)) {
      if (providerFamily(this.weaponProvider.provider) === "q1") {
        this.selectedArsenal = this.createSelectedQ1Arsenal();
      } else if (providerFamily(this.weaponProvider.provider) === "q2" && (this.source.kind === "q1" || this.source.kind === "q2" || this.source.kind === "q3")) {
        this.selectedArsenal = this.createSelectedQ2Arsenal();
      } else {
      if (providerFamily(this.weaponProvider.provider) !== "q3" || this.source.kind === "q3") throw new Error("Selected foreign arsenal is not yet implemented for this provider");
      if (this.weaponProvider.content.includes("missionpack")) throw new Error("Selected foreign Team Arena arsenal requires its complete weapon and holdable services");
      const ballistics = new Q3SharedBallistics({ actors: this.actors, bodies: this.bodies, scene: this.scene, combat: this.combat,
        weaponProvider: this.weaponProvider.provider, numeric: providerTiming(this.recipe, this.weaponProvider.provider).numeric, random: this.selectedRandom,
        time: () => this.selectedMilliseconds,
        weaponVolume: actor => (this.q2ItemWeaponSource()?.weapons.silencerShots(actor) ?? 0) > 0 ? 0.2 : 1,
        weaponImpact: (actor, origin) => { if (this.source.kind === "q2") this.source.weapons.playerNoiseForActor(actor, this.source.game, origin, "impact"); },
        projectile: (actor, owner, step) => { this.registerActorExecution({ kind: "q3", actor, owner, step, provider: this.weaponProvider.provider, content: this.weaponProvider.content }); },
        // Current foreign match selections do not expose Q3 GT_TEAM; CTF is a distinct mode.
        teamDeathmatch: () => false, isPlayer: actor => this.player(actor) !== null,
        teamGame: () => {
          if (this.source.kind === "q1") return this.source.composition.selection.program === "ctf" || this.source.cvars.variableValue("teamplay") !== 0;
          if (this.source.kind === "q3") return this.source.game.gameType >= 3;
          if (this.source.kind !== "q2") throw new Error("Selected Q3 accuracy requires admitted match rules");
          const selected = this.source.product.match;
          if (selected.source instanceof Q2Lmctf) return (selected.source.rules.ctfFlags & 128) === 0;
          const match = selected.selection.kind;
          return match === "ctf" || match === "lmctf" || match === "deathball" || this.source.game.options.mode === "deathmatch" && (this.source.game.options.deathmatchFlags & (64 | 128)) !== 0;
        },
        pose: actor => { const player = this.requirePlayer(actor.id), view = player.view();
          const quad = this.source.kind === "q1" ? (this.source.game.player(actor.id)?.powerups.get("quad") ?? 0) > this.timeSeconds
            : this.source.kind === "q2" && this.source.items.playerPowerups(actor.id).quadUntil > this.timeSeconds;
          return { origin: view.origin, angles: view.angles, viewheight: view.viewHeight, quadActive: quad, quad: quad ? 4 : 1 }; },
        worldActor: () => { const actor = this.worldActor(); if (actor === null) throw new Error("Selected Q3 damage requires the admitted map world actor"); return actor; },
        attack: (actor, inflictor, weapon, method, flags, originatingProjectile) => ({ sequence: this.attackSequence++, time: { kind: "milliseconds", value: this.selectedMilliseconds },
          attacker: actor, inflictor, ...(originatingProjectile === undefined ? {} : { originatingProjectile }), weapon: q3WeaponItem(weapon)?.item ?? null,
          weaponProvider: this.weaponProvider.provider, combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider,
          movementProvider: this.recipe.movement.provider, cause: { kind: "q3", meansOfDeath: method, damageFlags: flags } }),
        event: event => this.events.emit(this.weaponProvider.content, { kind: "q3-ballistics", event }) });
      this.selectedBallistics = ballistics;
      const q1Supply = this.source.kind === "q1" && this.source.composition.selection.program === "id1" ? {
        profile: Q1_Q3_SUPPLY_PROFILE.id, loadout: q1Q3SupplyLoadout(this.weaponProvider.provider),
        replacedItems: replacedSupplyItems(Q1_Q3_SUPPLY_PROFILE),
      } : undefined;
      const q2Supply = this.source.kind === "q2" && this.source.product.configuration.program === "baseq2"
        && (this.source.product.configuration.match === undefined || this.source.product.configuration.match.kind === "standard") ? {
          profile: Q2_Q3_SUPPLY_PROFILE.id, loadout: q3SpawnLoadout(this.weaponProvider.provider, "baseq3", false),
          replacedItems: [...replacedSupplyItems(Q2_Q3_SUPPLY_PROFILE), "q2:weapon_blaster"] satisfies readonly ItemId[],
        } : undefined;
      const supply = q1Supply ?? q2Supply;
      const selectedArsenal = new Q3SelectedArsenal({ ...(supply === undefined ? {} : { supply }), provider: this.weaponProvider.provider, product: "baseq3", inventory: this.inventory,
        fire: (actor, weapon, input) => {
          ballistics.fire(actor, weapon, input);
          if (this.actors.isLive(actor.id)) {
            if (this.requirePlayer(actor.id).character === "q2") this.weaponCharacterAnimation(actor.id, "attack", weapon === 1, this.weaponProvider.content, false);
            const body = this.bodies.read(actor.id);
            if (this.source.kind === "q2" && body !== null) this.source.weapons.playerNoiseForActor(actor.id, this.source.game, body.origin, "weapon");
          }
          if (this.source.kind === "q1") this.source.composition.fired(actor.id, q3WeaponItem(weapon)?.item ?? null);
          return undefined;
        },
        useHoldable: () => { throw new Error("Selected foreign Q3 holdable services are not implemented"); } });
      this.selectedArsenal = selectedArsenal;
      if (q1Supply !== undefined && this.source.kind === "q1") {
        const game = this.source.game;
        game.pickupAdmission = new SharedPickupAdmission({ inventory: this.inventory, profile: Q1_Q3_SUPPLY_PROFILE,
          ammoGranted: (actor, grants, autoSwitch) => { selectedArsenal.pickupAmmo(actor, grants, autoSwitch && game.player(actor.id)?.autoSwitch !== "never");
            this.requirePlayer(actor.id).arsenal = selectedArsenal.read(actor.id); return undefined; },
          weaponGranted: (actor, weapons, selection) => { selectedArsenal.pickupWeapons(actor, weapons, selection);
            this.requirePlayer(actor.id).arsenal = selectedArsenal.read(actor.id); return undefined; } });
      } else if (q2Supply !== undefined && this.source.kind === "q2") {
        this.source.items.setPickupAdmission(new SharedPickupAdmission({ inventory: this.inventory, profile: Q2_Q3_SUPPLY_PROFILE,
          ammoGranted: actor => { this.requirePlayer(actor.id).arsenal = selectedArsenal.read(actor.id); return undefined; },
          weaponGranted: (actor, weapons, selection) => { selectedArsenal.pickupWeapons(actor, weapons, selection);
            this.requirePlayer(actor.id).arsenal = selectedArsenal.read(actor.id); return undefined; } }));
      }
    }
    }
    try {
    this.prepareSelectedMonsters();
    options.monsterNavigation?.install(this, this.q1Movement);
    if (saved !== undefined) this.restore(saved);
    else if (this.source.kind === "q1" && options.world.kind === "q1-bsp") this.source.composition.spawnMap(options.world);
    else if (this.source.kind === "quakec") {
      if (options.travel?.source.kind === "quakeworld") {
        if (options.travel.source.clients.some(record => !options.identity.owns(record.client))) throw new Error("QW travel client belongs to another session");
        this.source.game.restoreTravel(options.travel.source);
      }
      this.source.game.spawnMap();
    }
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

  private monsterSourceFor(definition: MonsterDefinitionReference): SelectedMonsterSource {
    const existing = this.monsterSources.get(definition.source.provider);
    if (existing !== undefined) return existing;
    const registered = monsterSource(definition), reference = definition.source;
    const timing = providerTiming(this.recipe, reference.provider), world = providerTiming(this.recipe, this.recipe.map.entities.provider);
    const random = new SourceRandom(this.options.seed, registered.family === "q2" && registered.edition === "rerelease" ? "q2-rerelease" : "classic");
    const initial = providerFrame({ ...this.sourceFrame, elapsed: { kind: "seconds", value: 0 } }, world.clock, timing.clock);
    const clock = { frame: initial, advanced: false };
    const runtime: ActorHostRuntime = { numeric: timing.numeric, random, now: () => seconds(clock.frame.time),
      frameSeconds: () => registered.family === "q2" ? registered.edition === "classic" ? 0.1 : 0.025 : seconds(clock.frame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
    const common = { provider: reference.provider, edition: registered.edition, skill: this.options.skill, maxClients: this.options.maxClients,
      campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider };
    let source: SelectedMonsterSource;
    if (registered.family === "q1") {
      const game = new Q1EntityServices(this.q1ActorHost(reference, runtime), { ...common, deathmatch: 0, coop: this.options.mode === "coop", gravity: this.physics.gravity, precacheProgram: "id1" });
      const creatures = new Q1Creatures(game, {
        countMonsterKill: monster => { throw new Error(`Selected creature has no authored mission: ${monster.entity.classname}`); },
        finale: monster => { throw new Error(`Selected creature finale is unavailable: ${monster.entity.classname}`); },
        finishFinale: monster => { throw new Error(`Selected creature finale is unavailable: ${monster.entity.classname}`); },
      });
      creatures.registerSpecies(baseSpecies.filter(species => species.classnames.every(classname => Object.hasOwn(registered.creatures, classname))));
      game.registerStateExtension({ id: "q1:selected-creatures",
        capture: () => encodeCheckpointValue({ version: 1, ...creatures.captureFields() }),
        restore: bytes => {
          const reader = new SaveReader(decodeCheckpointValue(bytes), "q1:selected-creatures");
          reader.field("version").literal(1);
          return creatures.restoreFields(reader);
        },
        clone: (original, target) => creatures.clone(original, target),
      });
      game.pickupAdmission = this.selectedCreaturePickups();
      source = { kind: "q1", reference, random, clock, game };
    } else {
      let monsters: Q2Monsters;
      const weapons = new Q2Ballistics({ emit: event => this.weaponEvent(reference.content, event),
        noise: (actor, origin, secondary) => monsters.reportNoise(actor, origin, secondary),
        dodge: (actor, attacker, eta, trace) => this.q2MonsterDodge(actor, attacker, eta, trace),
        ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
        lagCompensation: { kind: "current-world" }, canTarget: (attacker, target) => attacker === null || !attacker.equals(target) });
      monsters = new Q2Monsters(weapons, { mission: actor => this.monsterMissions.get(actor) ?? null });
      const projectiles = registered.edition === "rerelease" ? new Q2MissionPackProjectiles({ base: weapons,
        monster: actor => monsters.context(actor), gravity: () => this.physics.gravity,
        playerEffect: event => this.events.emit(reference.content, { kind: "q2-composition", event: { kind: "missionpack-player", event } }, clock.frame.time) }) : null;
      if (projectiles !== null) registerQ2RereleaseOrdinaryMonsters(monsters, projectiles);
      const modules = registered.edition === "classic" ? [registerQ2ClassicBaseMonsters(monsters), monsters] : [monsters];
      const game = new Q2EntityServices(this.q2ActorHost(reference, runtime, actor => monsters.context(actor)?.state),
        { ...common, mode: this.options.mode === "coop" ? "coop" : "singleplayer", mapName: this.recipe.map.geometry.requestedPath, deathmatchFlags: 0 }, modules);
      weapons.registerCallbacks(game);
      if (projectiles !== null) game.sourceCallbacks.register(projectiles.callbacks);
      source = { kind: "q2", reference, random, clock, game, monsters, ballistics: weapons };
    }
    this.monsterSources.set(reference.provider, source);
    return source;
  }

  private attachMonster(actor: OwnedActor, definition: MonsterDefinitionReference, mission: MonsterMission): undefined {
    const source = this.monsterSourceFor(definition);
    this.monsterMissions.set(actor.id, mission);
    if (source.kind === "q1") {
      source.game.monsterMissions.set(actor.id, mission);
      const entity = source.game.attachExisting(actor, definition.classname);
      entity.spawnflags = mission.ambush ? 1 : 0;
      return source.game.spawnEntity(entity, { deathmatch: 0 });
    }
    const entity = source.game.attach(actor, { classname: definition.classname, ordinal: -1, values: new Map<string, string>() });
    entity.spawnflags = mission.ambush ? 1 : 0;
    source.game.spawnEntity(entity);
    return undefined;
  }

  private prepareSelectedMonsters(): undefined {
    const selection = this.recipe.enemies;
    if (selection.kind === "map-defined") return undefined;
    if (this.selectedMonsters !== null) throw new Error("Selected monster admission is already prepared");
    const map = this.source;
    if (map.kind !== "q1" && map.kind !== "q2") throw new Error("Selected monster map admission currently requires a Q1 or Q2 authored map");
    const selected = new SelectedMonsters(selection, map, { attach: (actor, definition, mission) => this.attachMonster(actor, definition, mission),
      validatePlacement: (entry, definition) => {
        const body = this.bodies.read(entry.actor.id);
        if (body === null) throw new Error("Started selected monster has no shared body");
        const source = this.monsterSourceFor(definition);
        const trace = this.scene.geometryTrace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds },
          target: { kind: "world" }, passActor: entry.actor.id, numeric: providerTiming(this.recipe, definition.source.provider).numeric,
          policy: source.kind === "q1" ? { kind: "q1", move: "normal", hull: null } : { kind: "q2", contentsMask: 1, leafContents: "merged" } });
        if (trace.startSolid || trace.allSolid) {
          const entity = source.kind === "q1" ? source.game.entity(entry.actor.id) : null;
          const q2Entity = source.kind === "q2" ? source.game.entity(entry.actor.id) : null;
          const preservedQ2 = source.kind === "q2" && map.kind === "q2" && this.options.world.kind === "q2-bsp" && q2Entity !== null
            && preservesAuthoredQ2Placement({ map: this.recipe.map,
              authored: parseQ2Entities(this.options.world.entities, map.game.options.edition)[entry.sourceOrdinal], definition,
              native: map.monsters.definition(entry.classname, map.game), game: source.game, entity: q2Entity, body });
          const preserved = source.kind === "q1" && this.options.world.kind === "q1-bsp" && entity !== null
            && preservesAuthoredQ1Placement({ map: this.recipe.map, authored: this.options.world.entityList[entry.sourceOrdinal], definition, game: source.game, entity, body });
          if (!preserved && !preservedQ2) throw new Error(`Selected monster placement obstructed in ${this.recipe.map.geometry.requestedPath}: source ${entry.sourceOrdinal} ${entry.classname} -> ${definition.source.provider}/${definition.classname}`);
        }
        return undefined;
      },
      resume: (actor, activator) => {
        const entry = this.actorExecutions.get(actor);
        if (entry === undefined || entry.kind === "q3" || entry.kind === "quakec") throw new Error("Activated monster has no creature source continuation");
        if (entry.kind === "q1") {
          const start = entry.entity.think; entry.services.cancel(entry.entity);
          start?.();
          if (this.actors.isLive(actor) && activator !== null) entry.entity.use?.(null, activator);
        } else {
          const start = entry.entity.think; entry.services.cancel(entry.entity);
          start?.(entry.entity, entry.services);
          if (this.actors.isLive(actor) && activator !== null) entry.entity.use?.(entry.entity, entry.services, null, activator);
        }
        return undefined;
      },
      enemy: actor => { const entry = this.actorExecutions.get(actor); return entry?.kind === "q1" ? entry.entity.monster?.enemy ?? null : entry?.kind === "q2" ? entry.entity.enemy : null; },
      oldEnemy: actor => { const entry = this.actorExecutions.get(actor); return entry?.kind === "q1" ? entry.entity.monster?.oldEnemy ?? null : entry?.kind === "q2" ? entry.readMonster()?.oldEnemy ?? null : null; },
      setRoute: (actor, goal, pauseUntil) => {
        const definition = selected.definitions.get(actor);
        if (definition === undefined) throw new Error("Selected route actor has no creature definition");
        const source = this.monsterSourceFor(definition);
        if (source.kind === "q2") return source.monsters.setRoute(actor, goal, pauseUntil);
        const entity = source.game.entity(actor);
        if (entity === null) throw new Error("Selected Q1 route actor has no source continuation");
        return setMonsterRoute(source.game, entity, goal, pauseUntil);
      } });
    for (const definition of selectedMonsterDefinitions(selection)) this.monsterSourceFor(definition);
    if (map.kind === "q1") {
      map.game.monsterAdmission = { resolve: (classname, source) => selected.resolve(classname, new Map(source.properties.map(property => [property.key, property.value]))), spawn: (actor, fields, ordinal, definition) => selected.admitQ1(actor, fields, ordinal, definition) };
      map.game.authoredPathFollower = actor => selected.q1PathFollower(actor);
    }
    else {
      map.game.monsterAdmission = { resolve: (classname, source) => selected.resolve(classname, source.values), spawn: (actor, fields, definition) => selected.admitQ2(actor, fields, definition) };
      map.monsters.externalPathFollower = actor => selected.q2PathFollower(actor);
      map.monsters.externalCombatFollower = actor => selected.q2CombatFollower(actor);
    }
    this.selectedMonsters = selected;
    return undefined;
  }

  private captureSelectedMonsters(): SelectedMonstersCheckpoint | null {
    if (this.selectedMonsters === null) return null;
    return { version: 2, authored: this.selectedMonsters.capture(), sources: [...this.monsterSources.values()].map(source => {
      const common = { reference: source.reference, frame: source.clock.frame, random: source.random.checkpoint() };
      return source.kind === "q1" ? { ...common, kind: "q1", entities: source.game.capture() }
        : { ...common, kind: "q2", entities: source.game.capture(), monsters: source.monsters.capture(), ballistics: source.ballistics.captureProjectiles() };
    }) };
  }

  private restoreSelectedMonsters(saved: SelectedMonstersCheckpoint): undefined {
    const selected = this.selectedMonsters;
    if (selected === null) throw new Error("Saved monsters have no selected admission");
    selected.restore(saved.authored);
    for (const entry of selected.authored.values()) {
      const mission = selected.mission(entry);
      this.monsterMissions.set(entry.actor.id, mission);
      const definition = selected.definitions.get(entry.actor.id);
      if (definition === undefined) throw new Error("Restored monster has no definition");
      const source = this.monsterSourceFor(definition);
      if (source.kind === "q1") source.game.monsterMissions.set(entry.actor.id, mission);
    }
    for (const state of saved.sources) {
      const source = this.monsterSources.get(state.reference.provider);
      if (source === undefined || source.reference.content !== state.reference.content || source.kind !== state.kind) throw new Error("Saved monster source differs from selected module");
      source.clock.frame = state.frame; source.clock.advanced = false; source.random.restore(state.random);
      if (source.kind === "q1" && state.kind === "q1") source.game.restore(state.entities, { scheduleThinks: false });
      else if (source.kind === "q2" && state.kind === "q2") { source.game.restore(state.entities); source.monsters.restore(source.game, state.monsters); source.ballistics.restoreProjectiles(source.game, state.ballistics); }
    }
    return undefined;
  }

  private beginMonsterFrames(milliseconds: number, map: boolean): undefined {
    const worldClock = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
    for (const source of this.monsterSources.values()) {
      source.clock.advanced = false;
      if (source.kind === "q1") {
        if (!map) continue;
        const projected = providerFrame(this.sourceFrame, worldClock, providerTiming(this.recipe, source.reference.provider).clock);
        source.clock.frame = projected; source.clock.advanced = true;
        source.game.beginFrame(seconds(projected.time), seconds(projected.elapsed));
      } else {
        const interval = source.game.options.edition === "classic" ? 100 : 25;
        const next = Math.round(seconds(source.clock.frame.time) * 1000) + interval;
        if (milliseconds !== next) continue;
        const kind = source.game.options.edition === "classic" ? "seconds" : "milliseconds";
        const divisor = kind === "seconds" ? 1000 : 1;
        source.clock.frame = { frame: source.clock.frame.frame + 1, phase: "frame-entry",
          time: { kind, value: next / divisor }, elapsed: { kind, value: interval / divisor } };
        source.clock.advanced = true;
        source.monsters.beginFrame(source.game);
      }
    }
    return undefined;
  }

  private selectedCreaturePickups(): SharedPickupAdmission {
    const selected = this.selectedArsenal;
    const identity: PickupSupplyProfile = { id: "composition:q1-creature-q1-supply", weaponOwnership: "all-destinations",
      ammo: Q1_Q3_SUPPLY_PROFILE.ammo.map(entry => ({ source: entry.source, destinations: [entry.source] })),
      weapons: Q1_Q3_SUPPLY_PROFILE.weapons.map(entry => ({ source: entry.source, destinations: [entry.source] })) };
    const profile = selected?.family === "q3" ? Q1_Q3_SUPPLY_PROFILE : selected?.family === "q2" ? Q1_Q2_SUPPLY_PROFILE
      : selected?.family === "q1" && selected.game.registeredWeapons.has("hipnotic:laser") ? Q1_HIPNOTIC_SUPPLY_PROFILE
      : selected?.family === "q1" || this.source.kind === "q1" ? identity : Q1_Q2_SUPPLY_PROFILE;
    return new SharedPickupAdmission({ inventory: this.inventory, profile,
      ammoGranted: (actor, grants, autoSwitch) => {
        if (selected !== null) {
          selected.pickupAmmo(actor, grants, autoSwitch); this.requirePlayer(actor.id).arsenal = selected.read(actor.id);
        } else if (this.source.kind === "q1") {
          const game = this.source.game, player = game.player(actor.id);
          if (player === null) throw new Error("Q1 pickup recipient has no admitted player");
          const before = game.chooseBest(actor, item => grants.find(grant => grant.item === item)?.before ?? this.inventory.count(actor.id, item));
          q1AmmoPickupSelection(game, player, before, autoSwitch && player.autoSwitch !== "never");
        }
        return undefined;
      }, weaponGranted: (actor, weapons, selection) => {
        if (selected !== null) {
          selected.pickupWeapons(actor, weapons, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id);
        } else if (this.source.kind === "q1") {
          const game = this.source.game, player = game.player(actor.id);
          if (player === null) throw new Error("Q1 pickup recipient has no admitted player");
          for (const item of weapons) {
            const weapon = [...Q1_WEAPONS, ...game.registeredWeapons.keys()].find(weapon => game.weaponItem(weapon) === item);
            if (weapon !== undefined) q1WeaponPickupSelection(game, player, weapon, player.autoSwitch === "never" ? "never" : selection);
          }
        } else if (this.source.kind === "q2" && selection !== "never") {
          const source = this.source, player = source.game.entity(actor.id);
          if (player === null) throw new Error("Q2 pickup recipient has no admitted player");
          for (const item of weapons) {
            const definition = source.weapons.registeredDefinitions().find(weapon => weapon.item === item);
            const current = source.weapons.states.get(actor.id)?.weapon;
            const currentItem = source.weapons.registeredDefinitions().find(weapon => weapon.name === current)?.item ?? null;
            if (definition !== undefined && q1Q2PickupSelect(currentItem, item, selection)) source.weapons.requestWeapon(player, source.game, definition.name);
          }
        }
        return undefined;
      } });
  }

  private createMonsterMovement(numeric: ReturnType<typeof providerTiming>["numeric"], random: SourceRandom): Q1MonsterMovement {
    return createQ1MonsterMovement({ scene: this.scene, numeric: createNumericOperations(numeric), random,
      readTarget: actor => {
        const body = this.bodies.read(actor);
        return body === null ? null : { origin: body.origin,
          absoluteBounds: this.bodies.linked(actor)?.absoluteBounds ?? { min: add(body.origin, body.bounds.min), max: add(body.origin, body.bounds.max) } };
      },
      read: actor => {
        const body = this.physics.bodies.read(actor), entry = this.actorExecutions.get(actor), entity = entry?.kind === "q1" ? entry.entity : null;
        if (body === null || entity === null) return null;
        return { origin: body.origin, angles: body.angles, bounds: body.bounds,
          absoluteBounds: this.physics.bodies.linked(actor)?.absoluteBounds ?? { min: add(body.origin, body.bounds.min), max: add(body.origin, body.bounds.max) },
          flags: entity.movementFlags, ground: body.ground === null ? { kind: "none" } : { kind: "actor", actor: body.ground },
          idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, enemy: entity.monster?.enemy ?? null };
      },
      write: (actor, state) => {
        const body = this.physics.bodies.read(actor.id), entry = this.actorExecutions.get(actor.id), entity = entry?.kind === "q1" ? entry.entity : null;
        if (body === null || entity === null) return undefined;
        this.physics.bodies.write(actor, { ...body, origin: state.origin, angles: state.angles, ground: state.ground.kind === "actor" ? state.ground.actor : state.ground.kind === "world" ? this.worldActor() : null });
        entity.movementFlags = state.flags; entity.idealYaw = state.idealYaw; entity.yawSpeed = state.yawSpeed;
        return undefined;
      }, link: (actor, triggers) => { this.physics.bodies.link(actor); if (triggers) this.physics.touchTriggers(actor); return undefined; } });
  }

  private selectedQ3Supply(pickup: SourcePickupDescriptor):
    | { readonly kind: "native" | "rejected" }
    | { readonly kind: "selected"; readonly offer: PickupSupplyOffer; readonly respawnSeconds: number } {
    const arsenal = this.selectedArsenal;
    if (arsenal === null || arsenal.family === "q3" || this.selectedSupply === null) return { kind: "native" };
    if (pickup.item.type !== ItemType.IT_WEAPON && pickup.item.type !== ItemType.IT_AMMO) return { kind: "native" };
    const weapon = q3WeaponItem(pickup.item.tag);
    if (weapon == null || !this.actors.isLive(pickup.playerActor)) return { kind: "rejected" };
    if (pickup.item.type === ItemType.IT_AMMO) {
      if (weapon.ammo === null) return { kind: "rejected" };
      return { kind: "selected", offer: { kind: "ammo", offer: { item: weapon.ammo,
        amount: pickup.count !== 0 ? pickup.count : pickup.item.quantity } }, respawnSeconds: RESPAWN_AMMO };
    }
    const profile = arsenal.family === "q1" ? Q3_Q1_SUPPLY_PROFILE : Q3_Q2_SUPPLY_PROFILE;
    const destination = weapon.ammo === null ? null : profile.ammo.find(entry => entry.source === weapon.ammo)?.destinations[0];
    if (weapon.ammo !== null && destination == null) return { kind: "rejected" };
    const quantity = q3WeaponPickupQuantity({ count: pickup.count, quantity: pickup.item.quantity, dropped: pickup.dropped,
      gameType: pickup.gameType, currentAmmo: destination == null ? 0 : this.inventory.count(pickup.playerActor, destination) });
    return { kind: "selected", offer: { kind: "weapon", offer: { item: weapon.item,
      ammo: weapon.ammo === null ? [] : [{ item: weapon.ammo, amount: quantity }] } }, respawnSeconds: q3WeaponRespawnSeconds(pickup) };
  }

  private previewSelectedQ3Pickup(pickup: SourcePickupDescriptor): SourcePickupPreview {
    const supplied = this.selectedQ3Supply(pickup);
    if (supplied.kind !== "selected") return supplied;
    const admission = this.selectedSupply;
    if (admission === null) throw new Error("Selected source supply lost its admission");
    return { kind: "selected", offer: supplied.offer, preview: admission.preview(pickup.playerActor, supplied.offer) };
  }

  private admitSelectedQ3Pickup(pickup: SourcePickupDescriptor): SourcePickupAdmission {
    const supplied = this.selectedQ3Supply(pickup);
    if (supplied.kind !== "selected") return supplied;
    const admission = this.selectedSupply, actor = this.actors.resolveOwned(pickup.playerActor);
    if (admission === null || actor === null) return { kind: "rejected" };
    const offer = supplied.offer;
    const accepted = offer.kind === "ammo" ? admission.ammo(actor, offer.offer)
      : offer.kind === "weapon" && admission.weapon(actor, offer.offer, this.options.mode === "deathmatch" ? "better" : "always");
    return accepted ? { kind: "picked", respawnSeconds: supplied.respawnSeconds } : { kind: "rejected" };
  }

  private q1CombatSource(): Q1EntityServices {
    if (this.source.kind === "q1") return this.source.game;
    if (this.selectedArsenal?.family === "q1") return this.selectedArsenal.game;
    throw new Error("Q1 combat source is not attached");
  }

  private selectedQ1Frame(): FrameContext {
    return providerFrame(this.sourceFrame, providerTiming(this.recipe, this.recipe.map.entities.provider).clock, providerTiming(this.recipe, this.weaponProvider.provider).clock);
  }

  private createSelectedQ2Arsenal(): Q2SelectedArsenal {
    if (this.weaponProvider.content.split(":")[2] !== "baseq2") throw new Error("Selected Q2 arsenal currently supports only baseq2");
    if (this.source.kind === "q3" && this.source.game.options.product === "missionpack") throw new Error("Selected Q2 supply on Team Arena is not implemented");
    if (this.source.kind === "q2" && this.source.product.configuration.program !== "baseq2") throw new Error("Selected Q2 supply currently supports base Q2 maps");
    const timing = providerTiming(this.recipe, this.weaponProvider.provider), profile = timing.clock;
    if (profile.kind !== "q2-classic" && profile.kind !== "q2-rerelease") throw new Error("Selected Q2 arsenal requires its source clock");
    const edition = profile.kind === "q2-classic" ? "classic" : "rerelease", intervalMilliseconds = profile.kind === "q2-classic" ? 100 : profile.frameMilliseconds;
    const random = new SourceRandom(this.options.seed, edition === "rerelease" ? "q2-rerelease" : "classic");
    const initialMilliseconds = this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : this.sourceFrame.time.value * 1000;
    const frame: FrameContext = { frame: 0, time: { kind: profile.kind === "q2-classic" ? "seconds" : "milliseconds", value: profile.kind === "q2-classic" ? initialMilliseconds / 1000 : initialMilliseconds },
      elapsed: { kind: profile.kind === "q2-classic" ? "seconds" : "milliseconds", value: profile.kind === "q2-classic" ? intervalMilliseconds / 1000 : intervalMilliseconds }, phase: "frame-entry" };
    const current = (): Extract<SelectedWeaponSource, { readonly kind: "q2" }> => {
      const source = this.selectedWeaponSource;
      if (source?.kind !== "q2") throw new Error("Selected Q2 source is not attached");
      return source;
    };
    const runtime: ActorHostRuntime = { numeric: timing.numeric, random, now: () => seconds(current().frame.time),
      frameSeconds: () => intervalMilliseconds / 1000, schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
    const game = new Q2EntityServices(this.q2ActorHost(this.weaponProvider, runtime, () => undefined), {
      provider: this.weaponProvider.provider, edition, mapName: this.recipe.map.geometry.requestedPath, skill: this.options.skill,
      mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients, campaign: this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider }, []);
    const weapons = new Q2Weapons({ emit: event => {
      if (event.kind === "muzzleflash" && this.player(event.actor)?.character !== "q2") this.weaponCharacterAnimation(event.actor, "attack", false, this.weaponProvider.content, false);
      return this.weaponEvent(this.weaponProvider.content, event);
    }, noise: (actor, origin, secondary) => {
      if (this.source.kind === "q2") this.source.monsters.reportNoise(actor, origin, secondary);
      for (const source of this.monsterSources.values()) if (source.kind === "q2") source.monsters.reportNoise(actor, origin, secondary);
      return undefined;
    }, dodge: (actor, attacker, eta, trace) => this.q2MonsterDodge(actor, attacker, eta, trace), quadMultiplier: () => this.source.kind === "q3" ? this.source.game.quadDamageFactor() : 4,
      lagCompensation: { kind: "current-world" },
      ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
      canTarget: (attacker, target) => attacker === null || !sameActor(attacker, target) });
    game.sourceCallbacks.register(weapons.callbacks);
    this.selectedWeaponSource = { kind: "q2", game, weapons, random, frame, mapMilliseconds: initialMilliseconds, intervalMilliseconds, nextMilliseconds: initialMilliseconds + intervalMilliseconds };
    const identity: PickupSupplyProfile = { id: "composition:q2-base-q2-supply", weaponOwnership: "all-destinations",
      ammo: [...new Set(Q2_BASE_WEAPONS.flatMap(weapon => weapon.ammo === null ? [] : [weapon.ammo]))].map(item => ({ source: item, destinations: [item] })),
      weapons: Q2_BASE_WEAPONS.map(weapon => ({ source: weapon.item, destinations: [weapon.item] })) };
    const supply = this.source.kind === "q1" ? Q1_Q2_SUPPLY_PROFILE : this.source.kind === "q2" ? identity : Q3_Q2_SUPPLY_PROFILE;
    const selected = new Q2SelectedArsenal({ game, weapons, inventoryDefinitions: q2BaseWeaponInventory(), replacedItems: replacedSupplyItems(supply),
      ...(this.source.kind === "q2" ? {} : { loadout: this.source.kind === "q1" ? q1Q2SupplyLoadout() : q3Q2SupplyLoadout() }),
      observe: actor => { const player = this.requirePlayer(actor); return { owner: { actor: player.actor, viewHeight: player.viewHeight }, input: this.q2WeaponInput(player) }; } });
    this.selectedSupply = new SharedPickupAdmission({ inventory: this.inventory, profile: supply,
      ammoGranted: (actor, grants, autoSwitch) => { selected.pickupAmmo(actor, grants, autoSwitch); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; },
      weaponGranted: (actor, granted, selection) => { selected.pickupWeapons(actor, granted, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; } });
    if (this.source.kind === "q1") this.source.game.pickupAdmission = this.selectedSupply;
    else if (this.source.kind === "q2") this.source.items.setPickupAdmission(this.selectedSupply);
    return selected;
  }

  private createSelectedQ1Arsenal(): Q1SelectedArsenal {
    const product = this.weaponProvider.content.split(":")[2];
    if (this.source.kind === "q3" && this.source.game.options.product === "missionpack") throw new Error("Selected Q1 supply on Team Arena is not implemented");
    if (this.source.kind === "q2" && this.source.product.configuration.program !== "baseq2") throw new Error("Selected Q1 supply currently supports base Q2 items");
    if (product !== "id1" && product !== "hipnotic") throw new Error("Selected Q1 arsenal requires id1 or Hipnotic weapon registration");
    const timing = providerTiming(this.recipe, this.weaponProvider.provider);
    const random = new SourceRandom(this.options.seed, "classic");
    const host = this.q1ActorHost(this.weaponProvider, { numeric: timing.numeric, random,
      now: () => seconds(this.selectedQ1Frame().time), frameSeconds: () => seconds(this.selectedQ1Frame().elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) });
    const powerupExpires = (actor: ActorId, powerup: Q1Powerup): number => {
      if (!this.actors.isLive(actor)) return 0;
      if (this.source.kind === "q1") return this.source.game.player(actor)?.powerups.get(powerup) ?? 0;
      if (this.source.kind === "q2") {
        const powers = this.source.items.playerPowerups(actor);
        return powerup === "quad" ? powers.quadUntil : powerup === "invulnerability" ? powers.invulnerabilityUntil : powerup === "suit" ? powers.enviroUntil : 0;
      }
      if (this.source.kind === "q3") {
        const client = this.source.game.records.nativeByActor(actor)?.client;
        const key = powerup === "quad" ? Powerup.PW_QUAD : powerup === "invisibility" ? Powerup.PW_INVIS : powerup === "suit" ? Powerup.PW_BATTLESUIT : null;
        return powerup === "invulnerability" ? (client?.invulnerabilityTime ?? 0) / 1000 : key === null ? 0 : (client?.ps.powerups.get(key) ?? 0) / 1000;
      }
      return 0;
    };
    const game = new Q1EntityServices({ ...host, powerupExpires,
      weaponVolume: actor => (this.q2ItemWeaponSource()?.weapons.silencerShots(actor) ?? 0) > 0 ? 0.2 : 1,
      weaponImpact: (actor, origin) => this.source.kind === "q2" ? this.source.weapons.playerNoiseForActor(actor, this.source.game, origin, "impact") : undefined,
      sourceDamageMultiplier: attacker => providerFamily(this.recipe.combat.provider) === "q1" || powerupExpires(attacker, "quad") <= seconds(this.selectedQ1Frame().time) ? 1
        : this.source.kind === "q3" ? this.source.game.quadDamageFactor() : 4 }, {
      provider: this.weaponProvider.provider, edition: this.weaponProvider.content.includes(":rerelease:") ? "rerelease" : "classic",
      skill: this.options.skill, deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", campaign: this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, movementProvider: this.recipe.movement.provider, inventoryProvider: this.recipe.inventory.provider, gravity: this.physics.gravity });
    if (product === "hipnotic") registerHipnoticWeapons(game);
    this.selectedWeaponSource = { kind: "q1", game, random };
    const profile: PickupSupplyProfile = product === "hipnotic"
      ? this.source.kind === "q1" ? Q1_HIPNOTIC_SUPPLY_PROFILE : this.source.kind === "q2" ? Q2_HIPNOTIC_SUPPLY_PROFILE : Q3_HIPNOTIC_SUPPLY_PROFILE
      : this.source.kind === "q1" ? { id: "composition:q1-q1-supply", weaponOwnership: "all-destinations",
      ammo: Q1_Q3_SUPPLY_PROFILE.ammo.map(entry => ({ source: entry.source, destinations: [entry.source] })),
      weapons: Q1_Q3_SUPPLY_PROFILE.weapons.map(entry => ({ source: entry.source, destinations: [entry.source] })) } : this.source.kind === "q2" ? Q2_Q1_SUPPLY_PROFILE : Q3_Q1_SUPPLY_PROFILE;
    const selected = new Q1SelectedArsenal({ game,
      ...(product === "hipnotic" ? { impulse: (player: Q1PlayerState, value: number) => missionWeaponImpulse(game, player, "hipnotic", value) } : {}),
      ...(this.source.kind === "q1" ? { nativePlayer: (actor: ActorId) => {
        const player = this.source.kind === "q1" ? this.source.game.player(actor) : null;
        if (player === null) throw new Error("Selected Q1 arsenal has no native map player");
        return player;
      } } : {}),
      fired: (actor, weapon) => {
        this.weaponCharacterAnimation(actor, "attack", weapon === "axe" || weapon === "hipnotic:mjolnir", this.weaponProvider.content, false);
        if (this.source.kind === "q1") this.source.composition.fired(actor, game.weaponItem(weapon));
        const player = this.requirePlayer(actor), body = this.bodies.read(actor);
        if (this.source.kind === "q2" && body !== null) this.source.weapons.playerNoiseForActor(actor, this.source.game, body.origin, "weapon");
        return player.animation;
      },
      replacedItems: [...(this.source.kind === "q1" ? [] : replacedSupplyItems(profile)), ...(this.source.kind === "q2" ? ["q2:weapon_blaster"] satisfies readonly ItemId[] : [])],
      observe: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, waterLevel: player.waterLevel }; } });
    this.selectedSupply = new SharedPickupAdmission({ inventory: this.inventory, profile,
      ammoGranted: (actor, grants, autoSwitch) => { selected.pickupAmmo(actor, grants, autoSwitch); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; },
      weaponGranted: (actor, weapons, selection) => { selected.pickupWeapons(actor, weapons, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; } });
    if (this.source.kind === "q2") this.source.items.setPickupAdmission(this.selectedSupply);
    if (this.source.kind === "q1") this.source.game.pickupAdmission = this.selectedSupply;
    return selected;
  }

  private q1ActorHost(source: ProviderReference, runtime: ActorHostRuntime): Q1FoundationHost {
    const content = source.content;
    const movement = source.provider === this.recipe.map.entities.provider ? this.q1Movement : this.createMonsterMovement(runtime.numeric, runtime.random);
    const visibilityNumeric = createNumericOperations(runtime.numeric);
    return createQ1ActorHost({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
        monsterTarget: actor => this.monsterTarget(actor),
        registerEntity: (entity, services) => this.registerActorExecution({ kind: "q1", entity, services, content }),
        sourceTarget: actor => { const entry = this.actorExecutions.get(actor), player = this.player(actor) !== null;
          return { player, aimedDamage: player || (entry?.kind === "q1" ? entry.entity.aimedDamage : entry?.kind === "q2" && (entry.entity.serverFlags & 4) !== 0),
            push: entry?.kind === "q1" ? entry.entity.movement === "push" : entry?.kind === "q2" ? entry.entity.motion === "push" || entry.entity.motion === "stop" : this.grappleAnchor(actor) === "brush" }; },
        random: () => runtime.random.nextUnit(),
        walkMove: (actor, yaw, distance) => movement.walkMove(actor, yaw, distance),
        checkBottom: actor => movement.checkBottom(actor),
        moveToGoal: (actor, goal, distance, mode) => movement.moveToGoal(actor, goal, distance, mode),
        changeYaw: actor => { movement.changeYaw(actor); return undefined; },
        pusherServices: game => createNativeQ1PusherServices(game, this.physics),
        scheduleThink: (actor, due) => runtime.schedule(actor, due), cancelThink: actor => runtime.schedule(actor, null),
        emit: event => {
          if (event.kind === "weapon") {
            this.viewModels.set(event.player, { path: event.viewModel, frame: event.frame });
            const player = this.player(event.player);
            if (player !== null && event.attack !== undefined) this.q1Characters.get(player.actor)?.attack(event.attack);
          }
          if (event.kind === "intermission") for (const player of this.playerStates.values()) {
            player.viewHeight = 0;
            this.setPlayerMovement(player.actor.id, { kind: "freeze", origin: event.origin, angles: event.angles });
          }
          if (event.kind === "teleport-player") { this.grapple?.release(event.player); const player = this.player(event.player); if (player !== null) { player.viewAngles = event.angles; if (player.state.kind === "q1-netquake") player.state = { ...player.state, viewAngles: event.angles, teleportTimeSeconds: event.lockUntil }; } }
          return this.events.emit(content, { kind: "q1", event }, { kind: "seconds", value: runtime.now() });
        }, transition: intent => { this.transitions.push(intent); return undefined; }, players: () => this.players(), classname: actor => this.classname(actor),
        checkClient: observer => {
          const eye = this.q1VisibilityEye(observer.id);
          return eye === null ? null : this.q1ClientVisibility.check(eye, runtime.now(), visibilityNumeric);
        }, powerup: (actor, powerup, expires) => this.powerup(actor, powerup, expires),
        controlPlayer: (actor, control) => this.controlPlayer(actor, control),
        setGravity: (actor, scale) => { const player = this.player(actor); if (player !== null) {
          player.gravityMultiplier = scale;
          if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * scale) };
        } return undefined; } }, { scene: this.scene, numeric: runtime.numeric, worldActor: () => this.worldActor(), sourceOrder: (a, b) => this.sourceOrder(a, b) });
  }

  private q2ActorHost(source: ProviderReference, runtime: ActorHostRuntime,
    readMonster: (actor: ActorId) => Q2MonsterState | undefined): Q2FoundationHost {
    const content = source.content;
    return createQ2ActorHost({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
      gravity: () => this.physics.gravity,
      monsterTarget: actor => this.monsterTarget(actor),
      weaponTarget: actor => this.q2WeaponTarget(actor),
      registerEntity: (entity, services) => this.registerActorExecution({ kind: "q2", entity, services, content, readMonster: () => readMonster(entity.actor.id) }),
      ...(runtime.random.rerelease === null ? {} : { rereleaseRandom: runtime.random.rerelease }),
      now: () => runtime.now(), frameSeconds: () => runtime.frameSeconds(), random: () => runtime.random.nextUnit(), schedule: (actor, due) => runtime.schedule(actor, due),
      worldActor: () => { const actor = this.worldActor(); if (actor === null) throw new Error("Map has no source world actor"); return actor; },
      playerViewState: actor => { const player = this.player(actor); return player === null ? null : { viewAngles: player.viewAngles, oldVelocity: this.source.kind === "q2" ? this.source.players.states.get(actor)?.oldVelocity ?? zero : zero }; },
      prepareLevelChange: (map, landmark, serverFlags) => { this.levelChange = { map, landmark, serverFlags }; return undefined; },
      players: () => this.players(), isPlayer: actor => this.player(actor) !== null, isMonster: actor => { const entry = this.actorExecutions.get(actor);
        return entry?.kind === "q2" ? (entry.entity.serverFlags & 4) !== 0 : entry?.kind === "q1" && entry.entity.monster !== null; },
      touchTriggers: actor => this.physics.touchTriggers(actor),
      keyConsumed: actor => { if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) this.source.players.consumedKey(entity, this.source.game); } return undefined; },
      setSolid: (actor, solid, model) => this.physics.setSolid(actor, solid, model, "q2"),
      setMotion: motion => this.physics.setMotion(motion), setAreaPortal: (portal, open) => { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); return undefined; },
      emit: event => { if (event.kind === "model") this.sourceModels.set(event.actor, event); return this.events.emit(content, { kind: "q2", event }, this.source.kind === "q2" && source.content === this.recipe.map.entities.content ? this.sourceFrame.time : { kind: "seconds", value: runtime.now() }); },
      transition: intent => {
        if (!this.checkingQ2Rules && this.source.kind === "q2" && intent.kind === "campaign-level") {
          const change = this.levelChange;
          return this.source.players.beginIntermission(this.source.game, change?.map ?? intent.map.replace(/^q2:/, ""), change?.landmark ?? null);
        }
        this.transitions.push(intent); return undefined;
      }, diagnostic: message => this.events.message({ kind: "print", level: 2, text: message }) }, { scene: this.scene, numeric: runtime.numeric, worldActor: () => this.worldActor(), sourceOrder: (a, b) => this.sourceOrder(a, b) });
  }

  setHandGrenadeInput(actor: ActorId, held: boolean): undefined {
    this.assertOpen(); this.requirePlayer(actor);
    if (this.handGrenades === null) throw new Error("Hand grenades are disabled in this recipe");
    return this.handGrenades.input(actor, held);
  }

  handGrenadeState(actor: ActorId) { return this.handGrenades?.controller.state(actor) ?? null; }

  setGrappleInput(actor: ActorId, held: boolean): undefined {
    this.assertOpen(); this.requirePlayer(actor);
    if (this.grapple === null || this.grapple.selection.binding !== "offhand") throw new Error("No selected offhand grapple is available");
    return this.grapple.input(actor, held);
  }

  grappleState(actor: ActorId) {
    return this.grapple === null ? null : { mechanic: this.grapple.selection.mechanic, hook: this.grapple.hook(actor),
      pulling: this.grapple.pulling(actor), gravityScale: this.grapple.gravityScale(actor), predictionSuppressed: this.grapple.prediction(actor) };
  }

  private sharedGrapple(): SharedGrappleControl {
    return { selection: this.recipe.equipment.grapple,
      nativeSlot: () => false,
      input: (actor, held) => this.setGrappleInput(actor, held), release: actor => this.grapple?.release(actor),
      pulling: actor => this.grapple?.pulling(actor) ?? false, gravityScale: actor => this.grapple?.gravityScale(actor) ?? 1 };
  }

  private primaryHandoff(actor: ActorId): PrimaryWeaponHandoff {
    const player = this.requirePlayer(actor), source = this.source;
    if (this.selectedArsenal !== null) return this.selectedArsenal.handoff(actor);
    if (source.kind === "q1") return source.game.primaryWeaponHandoff(player.actor);
    if (source.kind === "q2") {
      const entity = source.game.entity(actor); if (entity === null) throw new Error("Q2 primary has no source player");
      const definition = (item: import("../../../contracts/gameplay.ts").ItemId) => source.weapons.registeredDefinitions().find(weapon => weapon.item === item);
      return { provider: this.weaponProvider.provider, accepts: item => definition(item) !== undefined && this.inventory.count(actor, item) > 0,
        select: item => { const weapon = definition(item); if (weapon === undefined) return false; const result = source.weapons.requestWeapon(entity, source.game, weapon.name); return result === "selected" || result === "current"; },
        holster: () => source.weapons.requestHolster(entity), isHolstered: () => source.weapons.isHolstered(entity),
        resume: item => source.weapons.resumePrimary(entity, source.game, this.q2WeaponInput(player), item === null ? null : definition(item)?.name ?? null) };
    }
    if (source.kind !== "q3") throw new Error("Primary source is not ready");
    const runtime = () => { const state = this.q3Arsenals.get(player.actor); if (state === undefined) throw new Error("Missing Q3 primary continuation"); return state; };
    const select = (item: import("../../../contracts/gameplay.ts").ItemId): boolean => { const weapon = Q3_WEAPON_ITEMS.find(value => value.item === item);
      if (weapon === undefined || this.inventory.count(actor, item) <= 0 || runtime().product === "baseq3" && weapon.weapon > 10) return false;
      this.q3Arsenals.set(player.actor, q3RequestWeapon(runtime(), weapon.weapon)); return true; };
    return { provider: this.weaponProvider.provider, accepts: item => Q3_WEAPON_ITEMS.some(weapon => weapon.item === item && (runtime().product === "missionpack" || weapon.weapon <= 10)) && this.inventory.count(actor, item) > 0,
      select, holster: () => { this.q3Arsenals.set(player.actor, q3RequestWeaponHolster(runtime())); }, isHolstered: () => runtime().externalSlot === "holstered",
      resume: item => { this.q3Arsenals.set(player.actor, q3RequestWeaponResume(runtime())); if (item !== null) select(item); } };
  }

  private admitGrapple(actor: ActorId): undefined {
    this.grapple?.admit(actor);
    this.weaponSlots.delete(actor);
    if (this.grapple?.selection.binding === "slot") {
      const owner = this.requirePlayer(actor).actor;
      this.inventory.configure(owner, { item: this.grapple.weapon().item, count: 1, capacity: 1 });
      this.bindWeaponSlot(actor, { kind: "primary" });
    }
    return undefined;
  }
  private bindWeaponSlot(actor: ActorId, state: WeaponSlotState): undefined {
    if (this.grapple === null || this.grapple.selection.binding !== "slot") throw new Error("Weapon slot has no selected equipment");
    this.weaponSlots.set(actor, new WeaponSlot(this.primaryHandoff(actor), this.grapple.handoff(actor), state));
    return undefined;
  }
  requestWeapon(actor: ActorId, weapon: WeaponReference): boolean {
    this.assertOpen(); this.requirePlayer(actor);
    if (this.source.kind === "quakec") return weapon.provider === this.weaponProvider.provider && this.source.game.requestClientWeapon(actor, weapon.item);
    const slot = this.weaponSlots.get(actor);
    if (slot !== undefined) { const accepted = slot.request(weapon); slot.reconcile(); return accepted; }
    const primary = this.primaryHandoff(actor);
    return weapon.provider === primary.provider && primary.select(weapon.item);
  }

  private grappleAnchor(actor: ActorId): GrappleAnchor {
    if (this.worldActor()?.equals(actor)) return "world";
    const owner = this.actors.resolveOwned(actor);
    if (owner === null) return "none";
    const collision = this.physics.solidOf(actor);
    if (collision === null || collision.solid === "none") return "none";
    if (this.player(actor) !== null) return (this.combat.read(actor)?.health ?? 0) <= 0 ? "corpse" : "player";
    if (this.classname(actor) === "bodyque") return "corpse";
    return collision.solid === "brush" ? "brush" : collision.solid === "box" ? "box" : "none";
  }

  private q1CharacterPose(actor: ActorId) {
    const source = this.grapple?.source;
    if (source?.kind === "q1-threewave" && this.weaponSlots.get(actor)?.equipmentSelected()) return threewaveCharacterPose(source.core, actor);
    return this.source.kind === "q1" ? this.source.composition.characterPose(actor) : { axePose: this.playerUi(actor).activeWeapon === "q1:weapon/axe", frame: null };
  }

  private equipmentWeaponInput(actor: ActorId) {
    const player = this.requirePlayer(actor), source = this.source, native = this.q2WeaponInput(player), input = source.kind === "q2" ? source.product.weaponInput(actor, native) : native;
    const q3 = source.kind === "q3" ? source.game.records.byActor(actor)?.client?.ps : undefined;
    return { ...input, quadUntil: source.kind === "q1" ? source.game.player(actor)?.powerups.get("quad") ?? 0 : source.kind === "q3" ? (q3?.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000 : input.quadUntil,
      haste: input.haste || (q3?.powerups.get(Powerup.PW_HASTE) ?? 0) > this.timeSeconds * 1000 };
  }
  private grappleCharacterAnimation(actor: ActorId, priority: "attack" | "reverse", melee = false): undefined {
    const equipment = this.recipe.equipment.grapple;
    if (equipment.kind !== "enabled") throw new Error("Grapple animation has no selected source");
    return this.weaponCharacterAnimation(actor, priority, melee, equipment.source.content, equipment.edition === "rerelease");
  }

  private weaponCharacterAnimation(actor: ActorId, priority: "attack" | "reverse", melee: boolean, content: ContentId, resetTime: boolean): undefined {
    const player = this.requirePlayer(actor);
    if (player.animation.state.kind === "q3") {
      const result = runQ3TorsoOperation(priority === "reverse" ? PlayerAnimation.TORSO_DROP : melee ? PlayerAnimation.TORSO_ATTACK2 : PlayerAnimation.TORSO_ATTACK, { animation: player.animation, dead: (this.combat.read(actor)?.health ?? 0) <= 0,
        elapsedMilliseconds: 0, buttons: player.buttons, product: this.recipe.character.definition.content.includes("missionpack") ? "missionpack" : "baseq3", eventSequence: 0 });
      player.animation = result.animation; this.characters.get(player.actor)?.commitAnimation(result.animation);
      if (this.source.kind === "q3") { const entity = this.source.game.records.byActor(actor); if (entity !== null) writeQ3CharacterAnimation(entity, result.animation); }
      return undefined;
    }
    if (player.character !== "q2") return undefined;
    const ducked = player.bounds.max.z < player.standingBounds.max.z, frames = priority === "attack" ? q2AttackFrames(ducked) : q2ReverseFrames(ducked);
    this.q2Characters.get(player.actor)?.setAnimation(priority, frames.first, frames.last);
    return this.weaponEvent(content, { kind: "player-animation", actor, priority, ...frames, resetTime });
  }

  private grappleSlotHost(): GrappleSlotHost {
    return { selected: actor => this.weaponSlots.get(actor)?.equipmentSelected() ?? false, frame: (actor, frame) => frame === 2 ? this.grappleCharacterAnimation(actor, "attack", true) : undefined,
      available: actor => { const player = this.player(actor); return player !== null && !player.intermission && player.cutscene === null && (this.combat.read(actor)?.health ?? 0) > 0; },
      presentation: actor => {
        return { attackAnimation: () => this.grappleCharacterAnimation(actor, "attack"), reverseAnimation: () => this.grappleCharacterAnimation(actor, "reverse"),
          animationTime: state => { const input = this.equipmentWeaponInput(actor); return Math.trunc(1000 / q2WeaponAnimationRate({ ...input, phase: state.phase, frame: state.frame,
            frameSeconds: seconds(this.grappleFrame.elapsed), now: seconds(this.grappleFrame.time) })) / 1000; },
          powerupSound: () => { const source = this.grapple?.source; if (source === undefined || source.kind === "q1-threewave") return undefined;
            const input = this.equipmentWeaponInput(actor), path = q2PowerupSound({ ...input, rerelease: this.grapple?.selection.edition === "rerelease", now: source.game.host.now() }), body = this.bodies.read(actor);
            return path === null || body === null ? undefined : source.game.host.emit({ kind: "sound", actor, origin: body.origin, path, channel: 3, volume: 1, attenuation: 1, reliable: false, loop: "once" }); } };
      } };
  }

  private createGrapple(): GrappleRuntime | null {
    const selection = this.recipe.equipment.grapple;
    if (selection.kind === "disabled") return null;
    const world = providerTiming(this.recipe, this.recipe.map.entities.provider), timing = providerTiming(this.recipe, selection.source.provider);
    this.grappleFrame = providerFrame({ ...this.sourceFrame, elapsed: { kind: "seconds", value: 0 } }, world.clock, timing.clock);
    const random = new SourceRandom(this.options.seed, selection.edition === "rerelease" && selection.mechanic !== "q1-threewave" ? "q2-rerelease" : "classic");
    const runtime: ActorHostRuntime = { numeric: world.numeric, random, now: () => seconds(this.grappleFrame.time), frameSeconds: () => seconds(this.grappleFrame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
    const differentTeam = (owner: ActorId, target: ActorId): boolean => { const team = this.combat.read(owner)?.team; return team == null || this.combat.read(target)?.team !== team; };
    if (selection.mechanic === "q1-threewave") {
      const game = new Q1EntityServices(this.q1ActorHost(selection.source, runtime), { provider: selection.source.provider, edition: selection.edition,
        skill: this.options.skill, deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
        campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
        combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider, gravity: this.physics.gravity });
      game.beginFrame(seconds(this.grappleFrame.time), seconds(this.grappleFrame.elapsed));
      const core = new ThreewaveGrapple(game, { input: actor => { const player = this.requirePlayer(actor), held = this.grapple?.held(actor) ?? false;
          return { held, release: !held && (selection.binding === "offhand" || this.weaponSlots.get(actor)?.equipmentSelected() === true), jump: this.grapple?.jump(actor) ?? false,
            viewAngles: player.viewAngles, teleportUntil: this.source.kind === "q1" && player.state.kind === "q1-netquake" ? player.state.teleportTimeSeconds : 0 }; },
        aim: (actor, forward) => q1Aim(game, this.requirePlayer(actor).actor, forward),
        anchor: actor => { const anchor = this.grappleAnchor(actor); return { solid: anchor !== "none", centered: anchor === "player" || anchor === "corpse" || anchor === "box", player: this.player(actor) !== null }; },
        canAttach: differentTeam, canPulse: differentTeam, canDamage: (target, owner) => game.canDamage(target, owner) });
      return new GrappleRuntime(selection, { kind: selection.mechanic, game, core }, random, this.grappleSlotHost());
    }
    const game = new Q2EntityServices(this.q2ActorHost(selection.source, runtime, () => undefined), { provider: selection.source.provider, edition: selection.edition,
      mapName: this.recipe.map.geometry.requestedPath, skill: this.options.skill, mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients,
      campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider }, []);
    const hooks: GrappleHooks = {
      pose: actor => { const player = this.requirePlayer(actor); return { angles: player.viewAngles, hand: "right", viewHeight: player.viewHeight, gravity: player.gravityMultiplier, gravityVector: { x: 0, y: 0, z: -1 } }; },
      anchor: actor => this.grappleAnchor(actor), dead: actor => this.combat.read(actor)?.canTakeDamage === true && (this.combat.read(actor)?.health ?? 1) <= 0,
      previousVelocity: actor => this.grapple?.previousVelocity(actor) ?? zero,
      setPreviousVelocity: (actor, velocity) => { const native = this.source.kind === "q2" ? this.source.players.states.get(actor) : undefined;
        if (native !== undefined) native.oldVelocity = velocity; return this.grapple?.setPreviousVelocity(actor, velocity); },
      volume: actor => (this.q2ItemWeaponSource()?.weapons.silencerShots(actor) ?? 0) > 0 ? 0.2 : 1,
      noise: (actor, services, origin, kind) => this.q2ItemWeaponSource()?.weapons.playerNoiseForActor(actor, services, origin, kind),
      setGrapplePrediction: (actor, suppressed) => { this.grapple?.setPrediction(actor, suppressed); const player = this.player(actor);
        if (player !== null && (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease")) player.state = { ...player.state, flags: suppressed ? player.state.flags | 64 : player.state.flags & ~64 }; return undefined; },
      gravity: () => this.physics.gravity,
      emit: event => this.events.emit(selection.source.content, { kind: "q2-composition", event: { kind: selection.mechanic === "q2-lmctf" ? "lmctf" : "ctf", event } }, this.grappleFrame.time),
    };
    return selection.mechanic === "q2-ctf" ? new GrappleRuntime(selection, { kind: selection.mechanic, game, core: new Q2CtfGrappleEquipment(hooks, differentTeam) }, random, this.grappleSlotHost())
      : new GrappleRuntime(selection, { kind: selection.mechanic, game, core: new LmctfGrappleEquipment(hooks, {
        canAttach: (owner, target) => differentTeam(owner, target), canDamage: () => true, playerHit: target => this.player(target) !== null,
      }, actor => this.grapple?.released(actor)) }, random, this.grappleSlotHost());
  }

  private createHandGrenades(): HandGrenadeRuntime | null {
    const selection = this.recipe.equipment.handGrenades;
    if (selection.kind === "disabled") return null;
    const timing = providerTiming(this.recipe, selection.source.provider);
    const world = providerTiming(this.recipe, this.recipe.map.entities.provider);
    this.equipmentFrame = providerFrame({ ...this.sourceFrame, elapsed: { kind: "seconds", value: 0 } }, world.clock, timing.clock);
    const random = new SourceRandom(this.options.seed, selection.edition === "rerelease" ? "q2-rerelease" : "classic");
    const host = this.q2ActorHost(selection.source, { numeric: world.numeric, random,
      now: () => seconds(this.equipmentFrame.time), frameSeconds: () => seconds(this.equipmentFrame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) }, () => undefined);
    const game = new Q2EntityServices(host, { edition: selection.edition, mapName: this.recipe.map.geometry.requestedPath,
      skill: this.options.skill, mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients,
      provider: selection.source.provider, campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider }, []);
    const ballistics = new Q2Ballistics({ emit: event => this.events.emit(selection.source.content, { kind: "q2-weapon", event }, this.equipmentFrame.time),
      noise: (actor, origin, secondary) => this.source.kind === "q2" ? this.source.monsters.reportNoise(actor, origin, secondary) : undefined,
      dodge: (actor, attacker, eta, trace) => this.q2MonsterDodge(actor, attacker, eta, trace),
      lagCompensation: { kind: "current-world" },
      ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
      canTarget: (attacker, target) => attacker === null || !sameActor(attacker, target) });
    return new HandGrenadeRuntime(selection, new Q2HandGrenadeEquipment(game, ballistics), { game, random });
  }

  private stepHandGrenade(player: MovementPlayer, lifecycle: "alive" | "dead" | "removing" = "alive"): undefined {
    const equipment = this.handGrenades;
    if (equipment === null) return undefined;
    const source = this.source, actor = player.actor.id;
    const native = this.q2WeaponInput(player);
    const q2 = source.kind === "q2" ? source.product.weaponInput(actor, native) : native;
    const q3 = source.kind === "q3" ? source.game.records.byActor(actor)?.client?.ps : undefined;
    const quadUntil = source.kind === "q1" ? source.game.player(actor)?.powerups.get("quad") ?? 0
      : source.kind === "q3" ? (q3?.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000 : q2.quadUntil;
    return equipment.step(actor, { angles: player.viewAngles, gravity: this.physics.gravity * player.gravityMultiplier,
      quadUntil: providerFamily(this.recipe.combat.provider) === "q1" ? 0 : quadUntil,
      doubleUntil: q2.doubleUntil, quadFireUntil: q2.quadFireUntil, haste: q2.haste || (q3?.powerups.get(Powerup.PW_HASTE) ?? 0) > this.timeSeconds * 1000,
      noStackDouble: q2.noStackDouble, playersCollide: q2.playersCollide,
      lifecycle,
      project: (angles, offset) => projectQ2Actor(actor, equipment.controller.game,
        { hand: q2.hand, viewHeight: player.viewHeight, playersCollide: q2.playersCollide }, angles, offset) }, !player.intermission && player.cutscene === null && !q2.spectator && !(player.state.kind === "q3" && player.state.movementType === MoveType.PM_SPECTATOR));
  }

  private createSource(): SourceRuntime {
    const recipe = this.recipe, content = recipe.map.entities.content, campaign = recipe.campaign.kind === "campaign" ? recipe.campaign.mission.provider : recipe.map.entities.provider;
    const timing = providerTiming(recipe, recipe.map.entities.provider);
    if (this.options.preparedQuakeC !== undefined) {
      if (this.options.world.kind !== "q1-bsp") throw new Error("QuakeC requires a Q1 world");
      const game: QuakeCSource = new QuakeCSource(this.options.preparedQuakeC, { recipe, world: this.options.world, scene: this.scene,
        actors: this.actors, callbacks: this.callbacks, physics: this.physics, combat: this.combat, inventory: this.inventory, events: this.events,
        random: this.random, skill: this.options.skill, mode: this.options.mode, maxClients: this.options.maxClients,
        initialSourceTimeSeconds: this.timeSeconds,
        admit: (actor, _slot, source) => this.registerActorExecution({ kind: "quakec", actor, source, content }),
        damageRequest: call => {
          const attack = game.attacks.resolve(call);
          if (attack !== null) return { target: call.target, amount: call.amount, knockback: attack.knockback,
            direction: attack.direction, point: attack.point, normal: attack.normal, delivery: "direct",
            attack: { sequence: this.attackSequence++, time: { kind: "seconds", value: attack.time }, attacker: call.attacker, inflictor: call.inflictor,
              weapon: attack.weapon, weaponProvider: this.weaponProvider.provider, combatProvider: recipe.combat.provider,
              inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider, cause: { kind: "q1", deathType: game.deathType(call.target) } } };
          const environment = game.environment.resolve(call, game.currentPhysicsCallback);
          const projectile = game.projectiles.resolve(call);
          if (projectile !== null) {
            const target = this.bodies.read(call.target), inflictor = this.bodies.read(call.inflictor);
            if (target === null || inflictor === null) throw new Error("QC projectile damage lost its source bodies");
            const delta = { x: target.origin.x - inflictor.origin.x - (inflictor.bounds.min.x + inflictor.bounds.max.x) * 0.5,
              y: target.origin.y - inflictor.origin.y - (inflictor.bounds.min.y + inflictor.bounds.max.y) * 0.5,
              z: target.origin.z - inflictor.origin.z - (inflictor.bounds.min.z + inflictor.bounds.max.z) * 0.5 };
            const length = Math.hypot(delta.x, delta.y, delta.z), direction = length === 0 ? zero : { x: delta.x / length, y: delta.y / length, z: delta.z / length };
            return { target: call.target, amount: call.amount, knockback: call.amount * id1DamageMultiplier(game.machine, game.worldHost.reference(call.attacker), game.worldHost.reference(call.inflictor)),
              direction, point: projectile.trace?.point ?? target.origin, normal: projectile.trace?.normal ?? zero, delivery: "direct",
              attack: { sequence: this.attackSequence++, time: { kind: "seconds", value: projectile.time }, attacker: call.attacker, inflictor: call.inflictor,
                ...(projectile.launch === null ? {} : { originatingProjectile: call.inflictor }),
                weapon: projectile.weapon, weaponProvider: this.weaponProvider.provider, combatProvider: recipe.combat.provider,
                inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider, cause: { kind: "q1", deathType: game.deathType(call.target) } } };
          }
          if (environment === null) {
            const target = this.bodies.read(call.target);
            if (target === null) throw new Error("Native QuakeC damage lost its target body");
            return { target: call.target, amount: call.amount, knockback: 0, direction: zero, point: target.origin, normal: zero, delivery: "direct",
              attack: { sequence: this.attackSequence++, time: { kind: "seconds", value: game.machine.globals.float(game.machine.globalOffset("time")) },
                attacker: call.attacker, inflictor: call.inflictor, weapon: null, weaponProvider: this.weaponProvider.provider,
                combatProvider: recipe.combat.provider, inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider,
                cause: { kind: "q1", deathType: game.deathType(call.target) } } };
          }
          return { target: call.target, amount: call.amount, knockback: environment.knockback, direction: environment.direction,
            point: environment.point, normal: zero, delivery: "direct",
            attack: { sequence: this.attackSequence++, time: { kind: "seconds", value: environment.time }, attacker: call.attacker, inflictor: call.inflictor,
              weapon: null, weaponProvider: this.weaponProvider.provider, combatProvider: recipe.combat.provider,
              inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider, cause: environment.cause } };
        }, print: text => this.events.message({ kind: "print", level: 2, text }) });
      return { kind: "quakec", game };
    }
    const actorRuntime: ActorHostRuntime = { numeric: timing.numeric, random: this.random, now: () => this.timeSeconds,
      frameSeconds: () => timing.clock.kind === "q2-classic" ? 0.1 : timing.clock.kind === "q2-rerelease" ? timing.clock.frameMilliseconds / 1000 : seconds(this.sourceFrame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
    if (this.options.world.kind === "q3-bsp") {
      const product = content.includes("missionpack") ? "missionpack" : "baseq3";
      const host = createQ3SourceHost({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
        scene: this.scene, deathAnimations: this.deathAnimations, bots: this.botServices.source,
        now: () => Math.trunc(this.timeSeconds * 1000), schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due / 1000),
        runThink: actor => { this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics"); return undefined; },
        collision: (actor, collision) => this.physics.setCollision(actor, collision), armorContext: request => this.victimArmorContext(request),
        primaryAttackAllowed: actor => this.selectedArsenal === null && (this.weaponSlots.get(actor)?.primarySelected() ?? true),
        admitPickup: item => this.admitSelectedQ3Pickup(item),
        previewPickup: item => this.previewSelectedQ3Pickup(item),
        foreign: actor => { if (this.actors.isLive(actor)) throw new Error("Foreign Q3 actor projection is not attached"); return null; },
        isPlayer: actor => this.player(actor) !== null,
        moverActors: {
          observe: id => {
            const actor = this.actors.resolveOwned(id), state = this.bodies.read(id), linked = this.bodies.linked(id);
            if (actor === null || state === null || linked === null) return null;
            const motion = this.physics.motionOf(id);
            return { actor, state, absoluteBounds: linked.absoluteBounds, clipMask: motion?.clipMask ?? 1,
              kind: this.bodies.attachment(id) !== null ? "attached" : this.player(id) !== null ? "player"
                : motion === null || motion.kind === "stationary" || motion.kind === "push" || motion.kind === "stop" ? "fixed" : "movable" };
          },
          write: (actor, origin, ground) => {
            const body = this.bodies.read(actor.id);
            if (body !== null) this.bodies.write(actor, { ...body, origin, ground });
            return undefined;
          },
          link: actor => { if (this.actors.isLive(actor.id)) this.bodies.link(actor); return undefined; },
          release: actor => this.actors.release(actor),
        },
        sourceCommand: input => {
          const client = this.source.kind === "q3" ? this.source.game.records.nativeByActor(input.actor)?.client : null;
          if (client == null) throw new Error("Q3 source command has no actual client");
          const command = q3SourceCommand(input, this.requirePlayer(input.actor), this.sourceSchedulingMilliseconds, client.ps.weapon);
          const delta = client.ps.deltaAngles;
          return relativeQ3SourceCommand(input.source, command, delta);
        },
        spawnPlayer: (entity, pose) => this.spawnQ3Player(entity, pose), moveClient: (entity, command, options) => this.moveQ3Client(entity, command, options),
        emit: event => { this.events.emit(content, { kind: "q3-source", event }); }, clientNumber: actor => this.requirePlayer(actor).client.slot,
      }, { gameType: this.options.mode === "singleplayer" ? 2 : 0, singlePlayer: this.options.mode === "singleplayer", maxClients: this.options.maxClients,
        mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        ...(this.options.q3Cvars === undefined ? {} : { cvars: this.options.q3Cvars }) });
      for (const definition of q3GameCvarDefinitions(product)) host.cvars.register(definition.name, definition.value, definition.flags);
      this.initializeServerSettings(host.cvars);
      return { kind: "q3", game: new Q3SourceRuntime({ recipe, weaponProvider: this.weaponProvider, product, entities: this.options.world.entities,
        seed: this.options.seed, maxClients: this.options.maxClients, buildDate: "TypeScript port",
        ...(this.options.q3Session === undefined ? {} : { sessionCarry: this.options.q3Session }) }, host) };
    }
    if (this.options.world.kind === "q1-bsp") {
      const host = this.q1ActorHost(recipe.map.entities, actorRuntime);
      const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: this.session, origin: { kind: "server-console" } },
        print: text => { this.events.message({ kind: "print", level: 2, text }); } });
      for (const [name, value] of Object.entries({ skill: String(this.q1Campaign.skill), deathmatch: this.options.mode === "deathmatch" ? "1" : "0", coop: this.options.mode === "coop" ? "1" : "0",
        teamplay: "0", sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", sv_cheats: "0", footsteps: "1" })) cvars.register(name, value);
      const services: Q1CompositionServices = { sharedGrapple: this.sharedGrapple(),
        cvar: name => cvars.variableValue(name), setCvar: (name, value) => { cvars.set(name, value, true); if (name === "sv_gravity") this.setWorldGravity(cvars.variableValue(name)); if (name === "skill") { const skill = cvars.variableValue(name); if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Q1 skill must be 0..3"); this.q1Campaign.skill = skill; } return undefined; },
        emit: event => { if (event.kind === "level-presentation") return this.events.emit(content, { kind: "q1-level", event: event.event }); return this.events.emit(content, { kind: "q1-composition", event }); },
        selectedPlayer: actor => { const player = this.requirePlayer(actor), lifecycle = this.q1Characters.get(player.actor)?.lifecycle, life = lifecycle?.life;
          return { deadFlag: life === "dying" ? 1 : life === "dead" ? 2 : life === "respawnable" ? 3 : (this.combat.read(actor)?.health ?? 0) > 0 ? 0 : 2,
            isBot: this.botServices.isBot(actor), viewAngles: player.viewAngles, viewOffset: lifecycle?.viewOffset ?? this.q2Views.get(actor)?.offset ?? { x: 0, y: 0, z: player.viewHeight }, frame: player.animation.state.kind === "q1" || player.animation.state.kind === "q2" ? player.animation.state.frame : 0,
            waterType: player.waterType === -3 || player.waterType === 32 ? "water" : player.waterType === -4 || player.waterType === 16 ? "slime" : player.waterType === -5 || player.waterType === 8 ? "lava" : "empty",
            waterLevel: player.waterLevel === 3 ? 3 : player.waterLevel === 2 ? 2 : player.waterLevel === 1 ? 1 : 0,
            teleportUntil: player.state.kind === "q1-netquake" ? player.state.teleportTimeSeconds : 0 }; },
        setObserver: (actor, enabled) => { const player = this.requirePlayer(actor); this.setPlayerMovement(actor, { kind: "noclip", enabled }); this.combat.setTraits(player.actor, { canTakeDamage: !enabled }); this.bodies.link(player.actor); return undefined; },
        placePlayer: (actor, spot, travel) => this.placeQ1Player(this.requirePlayer(actor.id), spot, travel),
        disconnect: actor => { const player = this.requirePlayer(actor); return this.actors.release(player.actor); },
        teleport: (actor, origin, angles, velocity, until) => { const player = this.requirePlayer(actor); return this.setPlayerMovement(actor, { kind: "teleport", origin, angles, velocity, commandAngles: player.commandAngles, holdMilliseconds: Math.max(0, (until - this.timeSeconds) * 1000), spectator: false }); },
        weaponServices: () => this.selectedWeaponSource?.kind === "q1" ? this.selectedWeaponSource.game : this.selectedArsenal === null && this.source.kind === "q1" ? this.source.game : null,
        selectedWeapon: actor => this.playerUi(actor).activeWeapon, selectedAmmo: actor => this.playerUi(actor).ammo?.item ?? null,
        selectWeapon: (actor, item) => { if (this.source.kind !== "q1") return false;
          if (this.selectedArsenal !== null) return this.selectedArsenal.select(actor, item);
          const game = this.source.game;
          const weapon = [...Q1_WEAPONS, ...game.registeredWeapons.keys()].find(value => game.weaponItem(value) === item);
          return weapon !== undefined && game.selectWeapon(this.requirePlayer(actor).actor, weapon); },
        weaponChanged: actor => { const player = this.requirePlayer(actor); player.arsenal = this.arsenal(player); return undefined; },
        promptSupported: actor => { const player = this.player(actor); return player !== null && (this.options.promptSupported?.(player.client) ?? false); },
        restartSession: (map, flags) => { this.q1Restart = true; this.q1Campaign.flags = flags; this.transitions.push({ kind: "campaign-level", campaign, map: `q1:${map}`, spawnPoint: "", gates: [], cause: null }); return undefined; },
        finishCampaign: () => { this.transitions.push({ kind: "campaign-complete", campaign, gates: [] }); return undefined; },
      };
      const program = content.split(":")[2];
      if (program !== "id1" && program !== "hipnotic" && program !== "rogue" && program !== "dopa" && program !== "mg1" && program !== "mg3" && program !== "ctf") throw new Error(`Unsupported Q1 source program ${program}`);
      const composition = createQ1SourceComposition(host, { edition: content.includes(":rerelease:") ? "rerelease" : "classic", skill: this.q1Campaign.skill,
        deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider, gravity: 800 },
        { program, campaign: this.q1Campaign, registered: true, officialCampaign: program === "id1" }, services);
      return { kind: "q1", game: composition.game, composition, cvars };
    }

    const weapons = new Q2Weapons({ emit: event => this.weaponEvent(content, event),
      noise: (actor, origin, secondary) => { if (this.source.kind !== "q2") throw new Error("Q2 monster noise before source admission"); return this.source.monsters.reportNoise(actor, origin, secondary); },
      dodge: (actor, attacker, eta, trace) => this.q2MonsterDodge(actor, attacker, eta, trace),
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
    }, silencer: (actor, charges) => { if (this.source.kind !== "q2") throw new Error("Q2 silencer before source admission"); const source = this.q2ItemWeaponSource(); if (source === null) throw new Error("Q2 silencer has no arsenal source"); return source.weapons.grantSilencer(actor, source.game, charges); },
    powerArmor: (actor, kind) => this.events.message({ kind: "print", level: 2, text: `Power armor ${kind}\n` }, actor) };
    const playerHooks: Q2PlayerHooks = {
      weaponState: actor => { const active = this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource.weapons : weapons;
        const state = active.states.get(actor); return state === undefined ? null : { q2Name: state.weapon,
          ammo: state.weapon === null ? null : active.definition(state.weapon).ammo, kickAngles: state.kickAngles, kickOrigin: state.kickOrigin, loopSound: state.loopSound }; },
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.commandAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: player.ground.kind !== "none", ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
        standingBounds: player.standingBounds, animateQ2: player.character === "q2" }; },
      setMovement: (actor, change) => this.setPlayerMovement(actor, change),
      playerSpawned: entity => {
        if (this.selectedArsenal !== null) { weapons.resetSilencer(entity.actor.id); this.q2ItemWeaponSource()?.weapons.resetSilencer(entity.actor.id); }
        const player = this.requirePlayer(entity.actor.id);
        if (this.selectedArsenal?.has(entity.actor.id)) {
          this.selectedArsenal.remove(entity.actor.id); player.arsenal = this.selectedArsenal.admit(entity.actor, 100, false);
        }
        this.selectedBallistics?.respawn(entity.actor.id);
        this.handGrenades?.respawn(entity.actor.id); this.grapple?.release(entity.actor.id);
        if (this.selectedArsenal === null || this.selectedArsenal.has(entity.actor.id)) this.admitGrapple(entity.actor.id);
        return undefined;
      },
      emit: event => { if (event.kind === "view") this.q2Views.set(event.actor, event.view); return this.events.emit(content, { kind: "q2-player", event }); },
      noise: (actor, origin) => { if (this.source.kind !== "q2") throw new Error("Q2 noise before source entry"); return this.source.monsters.reportNoise(actor, origin); }, weaponInput: actor => this.q2WeaponInput(this.requirePlayer(actor)), banned: () => false,
    };
    let owningMonsters: Q2ProductRuntime["monsters"] | null = null;
    const host = this.q2ActorHost(recipe.map.entities, actorRuntime, actor => owningMonsters?.context(actor)?.state);
    const serverCvars = new CvarRegistry({ dialect: content.includes(":rerelease:") ? "q2-rerelease" : "q2-classic",
      context: { session: this.session, origin: { kind: "server-console" } }, print: text => this.events.message({ kind: "print", level: 2, text }) });
    this.q2ServerRegistry = serverCvars;
    registerQ2ServerCvars(serverCvars, recipe.match.provider);
    serverCvars.register("sv_airaccelerate", "0", 0);
    for (const variable of this.options.q2Cvars ?? []) serverCvars.set(variable.name, variable.value, true);
    this.initializeServerSettings(serverCvars);
    const common: Q2CompositionCommon = { host, weapons, itemHooks, playerHooks, entityHooks,
      match: recipe.match.provider === "q2:lmctf" ? { kind: "lmctf", ...(this.options.travel?.source.kind === "q2" && this.options.travel.source.lmctf !== undefined ? { travel: this.options.travel.source.lmctf } : {}) } : { kind: recipe.match.provider === "q2:ctf" ? "ctf" : "standard" }, playerRules: { spawnPoint: this.options.travel?.spawnPoint ?? "" },
      options: { mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        skill: this.options.skill, mode: this.options.mode, deathmatchFlags: serverCvars.variableValue("dmflags"), maxClients: this.options.maxClients, provider: recipe.map.entities.provider,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider },
      services: { deathmatchFlags: { read: () => serverCvars.variableValue("dmflags"), write: flags => {
        const before = serverCvars.find("dmflags"), changed = Number(before?.value ?? 0) ^ flags;
        const desired = ((Number(before?.latchedValue ?? before?.value ?? 0) & ~changed) | (flags & changed)) >>> 0;
        serverCvars.set("dmflags", String(flags), true);
        if (desired !== flags) serverCvars.stage("dmflags", String(desired));
        return undefined;
      } }, sharedGrapple: this.sharedGrapple(), gravity: () => this.physics.gravity, hunterCamera: false, strongMines: false,
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
        emit: event => { if (event.kind === "world-text") { this.worldTextStore.submit({ ...event.text, content }, this.timeSeconds, event.lifetime); return undefined; } if (event.kind === "screen-blend") { const view = this.q2Views.get(event.actor); if (view !== undefined) this.q2Views.set(event.actor, { ...view, blend: event.blend }); } return this.events.emit(content, { kind: "q2-rerelease", event }); },
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
    bindQ2ServerCvars(serverCvars, product);
    serverCvars.setServerActive(true);
    owningMonsters = product.monsters;
    return { kind: "q2", product, game: product.game, weapons, monsters: product.monsters, movers: product.movers, items: product.items, players: product.players, baseEntities: product.baseEntities };
  }

  private victimArmorContext(request: DamageRequest): VictimArmorContext {
    const target = this.actorExecutions.get(request.target);
    const product = target?.kind === "q2" ? target.services.options.edition : this.recipe.inventory.content.includes(":rerelease:") ? "rerelease" : "classic";
    const body = this.bodies.read(request.target), contact = body === null ? zero : subtract(request.point, body.origin);
    const direction = request.attack.cause.kind === "q1" && body !== null && contact.x === 0 && contact.y === 0 && contact.z === 0
      && request.attack.inflictor !== null && this.worldActor()?.equals(request.attack.inflictor) !== true
      ? { x: -request.direction.x, y: -request.direction.y, z: -request.direction.z } : contact;
    const length = Math.hypot(direction.x, direction.y, direction.z), yaw = (body?.angles.y ?? 0) * Math.PI / 180;
    return { arithmetic: "binary32", q2: { product, ctf: this.recipe.match.provider === "q2:ctf", alive: (this.combat.read(request.target)?.health ?? 0) > 0 }, screenFacingDot: length === 0 ? 0 : (direction.x * Math.cos(yaw) + direction.y * Math.sin(yaw)) / length };
  }

  private registerCombat(): undefined {
    const id = this.recipe.combat.provider;
    const armor = nativeVictimArmor(request => this.victimArmorContext(request));
    if (providerFamily(id) === "q1") this.combat.register(createQ1CombatPolicy({ id, armor, sourceEffects: {
      beforeQuad: (request, amount, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.beforeQuad?.(request, amount, target, attacker) ?? { kind: "continue", amount };
      }, afterQuad: (request, amount, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.afterQuad?.(request, amount, target, attacker) ?? { kind: "continue", amount };
      }, armorAllowed: (request, amount, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.armorAllowed?.(request, amount, target, attacker) ?? true;
      }, protectionApplies: (request, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.protectionApplies?.(request, target, attacker) ?? true;
      }, beforeHealth: (request, amount, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.beforeHealth?.(request, amount, target, attacker) ?? true;
      }, afterArmor: (request, amount, target, attacker) => {
        const game = this.q1CombatSource();
        return game.damageSourceEffects.afterArmor?.(request, amount, target, attacker) ?? amount;
      } },
      context: request => {
        const context = this.q1CombatSource().combatContext(request);
        const source = this.selectedWeaponSource, projectileId = request.attack.originatingProjectile ?? request.attack.inflictor;
        const projectile = projectileId === null ? undefined : this.actorExecutions.get(projectileId);
        const selectedQ2Attack = source?.kind === "q2" && (projectile?.kind === "q2" && projectile.services === source.game
          || request.attack.attacker !== null && request.attack.inflictor === request.attack.attacker && source.weapons.states.has(request.attack.attacker));
        const sourceScaled = selectedQ2Attack && request.attack.cause.kind === "q2" || this.selectedArsenal?.family === "q3" && request.attack.cause.kind === "q3";
        return sourceScaled && request.attack.weaponProvider === this.weaponProvider.provider && request.attack.weapon !== null ? { ...context, quad: false } : context;
      } }));
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
      defenderSphere: false,
      teamDamageEnabled: this.source.kind === "q2" && (this.recipe.match.provider === "q2:ctf" || this.recipe.match.provider === "q2:lmctf" || (this.source.game.options.deathmatchFlags & (64 | 128)) !== 0),
      friendlyFire: this.q2ServerRegistry === null || (this.q2ServerRegistry.variableValue("dmflags") & 256) === 0, nuke: false, noKnockback: false, movable: !this.physics.isBrush(request.target), rejectTeamDamage: false, suppressPain: false }) }));
    return undefined;
  }

  private q2MatchDamageEffects() {
    if (this.source.kind !== "q2") throw new Error("Q2 match damage requires its source runtime");
    return this.source.product.match.sourceEffects(this.source.game);
  }

  private schedule(actor: OwnedActor, dueSeconds: number): undefined {
    const executionProvider = this.executionProvider(actor.id) ?? actor.owner;
    const kind = providerTiming(this.recipe, executionProvider).clock.kind;
    return this.scheduler.schedule(actor, "world:think", { due: { kind: kind === "q2-rerelease" || kind === "q3" ? "milliseconds" : "seconds", value: kind === "q2-rerelease" || kind === "q3" ? dueSeconds * 1000 : dueSeconds },
      ...(executionProvider === actor.owner ? {} : { executionProvider }),
      boundary: "during-physics", order: { actor: actor.id, provider: actor.owner, sequence: this.attackSequence++ } });
  }

  private executionProvider(actor: ActorId): ProviderId | null {
    const entry = this.actorExecutions.get(actor);
    return entry === undefined ? null : entry.kind === "q3" ? entry.provider : entry.kind === "quakec" ? this.recipe.map.entities.provider : entry.kind === "q1" ? entry.services.provider : entry.services.options.provider;
  }

  private q2WeaponTarget(actor: ActorId): Q2WeaponTarget | null {
    const owner = this.actors.resolveOwned(actor);
    if (owner === null) return null;
    const entry = this.actorExecutions.get(actor), native = entry?.kind === "q2" ? entry.entity : null;
    const collision = this.collision(owner), linked = this.scene.spatial.get(actor)?.collision;
    const solid = actor === this.worldActor() ? "brush" : entry?.kind === "q3" || entry === undefined && this.player(actor) === null
      ? linked === undefined ? "none" : linked.role === "trigger" ? "trigger" : linked.shape.kind === "model" ? "brush" : "box"
      : collision?.solid ?? "none";
    return { solid, laserImmune: native?.laserImmune ?? false, damageableTarget: native?.damageableTarget ?? false,
      bfgExplobox: (entry?.kind === "q1" || entry?.kind === "q2") && entry.entity.classname === "misc_explobox" };
  }

  private q2MonsterDodge(actor: ActorId, attacker: ActorId, eta: number, trace: Parameters<Q2Weapons["hooks"]["dodge"]>[3]): undefined {
    const entry = this.actorExecutions.get(actor);
    if (entry?.kind !== "q2" || !this.actors.isLive(actor)) return undefined;
    const selected = this.monsterSources.get(entry.services.options.provider);
    const monsters = selected?.kind === "q2" && selected.game === entry.services ? selected.monsters
      : this.source.kind === "q2" && this.source.game === entry.services ? this.source.monsters : null;
    const context = monsters?.context(actor);
    if (monsters === null || context === null || context === undefined) return undefined;
    return monsters.dodge(context.entity, context.game, attacker, eta, trace);
  }

  private monsterTarget(actor: ActorId) {
    if (!this.actors.isLive(actor) || this.bodies.read(actor) === null) return null;
    const player = this.player(actor), entry = this.actorExecutions.get(actor);
    const q1 = entry?.kind === "q1" ? entry.services.player(actor) : null;
    return { viewHeight: player?.viewHeight ?? (entry?.kind === "q2" ? entry.entity.viewHeight : 25),
      notarget: entry?.kind === "q1" ? (entry.entity.movementFlags & 128) !== 0 : entry?.kind === "q2" && (entry.entity.flags & (32 | (entry.services.options.edition === "rerelease" ? 0x1008000 : 0))) !== 0,
      invisible: (q1?.powerups.get("invisibility") ?? 0) > this.timeSeconds,
      lightLevel: entry?.kind === "q2" ? entry.entity.lightLevel : null,
      hostileUntil: q1?.hostileUntil ?? null };
  }

  private sourceOrder(a: ActorId, b: ActorId): number {
    const left = this.sourcePosition(a), right = this.sourcePosition(b);
    return left[0] - right[0] || left[1] - right[1];
  }
  private sourcePosition(actor: ActorId): readonly [number, number] {
    const source = this.actors.sourceOf(actor);
    const provider = source?.provider ?? this.actors.observe(actor)?.owner ?? "world:unknown";
    if (this.recipe.ordering.kind === "mixed") return [this.recipe.ordering.providers.indexOf(provider), source?.slot ?? actor.slot];
    return provider !== this.recipe.map.entities.provider ? [1, actor.slot] : [0, source?.slot ?? actor.slot];
  }

  private collision(actor: OwnedActor): SharedSolid | null {
    if (this.selectedMonsters?.active(actor.id) === false) return { family: providerFamily(this.recipe.map.entities.provider), solid: "none", model: null, owner: null };
    const player = this.playerStates.get(actor);
    if (player !== undefined && (player.intermission || player.cutscene !== null)) return { family: providerFamily(player.profile.id), solid: "none", model: null, owner: null };
    if (player !== undefined && this.q2Characters.get(actor)?.state.gibbed) return { family: "q2", solid: "none", model: null, owner: null };
    if (player !== undefined) return { family: providerFamily(player.profile.id), solid: "box", model: null, owner: null };
    const entry = this.actorExecutions.get(actor.id);
    return entry === undefined ? null : actorCollision(entry);
  }

  private registerActorExecution(entry: ActorExecution): undefined {
    const actor = entry.kind === "q3" || entry.kind === "quakec" ? entry.actor : entry.entity.actor, previous = this.actorExecutions.get(actor.id);
    this.actors.assertOwned(actor);
    if (previous !== undefined && (previous.kind === "q3" || entry.kind === "q3" || previous.kind === "quakec" || entry.kind === "quakec" ? previous !== entry : previous.services !== entry.services)) throw new Error("Actor already has another source execution owner");
    this.actorExecutions.set(actor.id, entry);
    return undefined;
  }

  private contents(point: Vec3, family: "q1" | "q2"): number {
    const result = this.scene.pointContents({ point, target: { kind: "world" }, passActor: null,
      policy: family === "q1" ? { kind: "q1", move: "normal", hull: null } : { kind: "q2", contentsMask: -1, leafContents: "merged" },
      numeric: providerTiming(this.recipe, this.recipe.map.entities.provider).numeric });
    return result.kind === "q2" ? result.merged : result.contents;
  }

  private q1VisibilityEye(actor: ActorId): Q1ClientEye | null {
    const body = this.bodies.read(actor); if (body === null) return null;
    const entry = this.actorExecutions.get(actor), player = this.player(actor);
    if (entry?.kind === "q1" && entry.entity.fields.has("view_ofs")) return { origin: body.origin, viewOffset: entry.entity.vector("view_ofs") };
    if (player !== null) return { origin: body.origin, viewOffset: { x: 0, y: 0, z: player.viewHeight } };
    if (entry?.kind === "q1" && entry.entity.monster !== null) {
      const eye = q1Creatures(entry.services).monsters.get(entry.entity.actor)?.eye();
      if (eye !== null && eye !== undefined) return { origin: eye, viewOffset: zero };
    }
    return { origin: body.origin, viewOffset: { x: 0, y: 0, z: this.monsterTarget(actor)?.viewHeight ?? 0 } };
  }

  private worldActor(): ActorId | null { return this.actors.atSource(this.recipe.map.entities.provider, this.options.world.kind === "q3-bsp" ? 1022 : 0)?.id ?? null; }
  private player(actor: ActorId | null): MovementPlayer | null { if (actor === null) return null; const owned = this.actors.resolveOwned(actor); return owned === null ? null : this.playerStates.get(owned) ?? null; }
  players(): readonly ActorId[] { return [...this.playerStates.values()].sort((a, b) => a.client.slot - b.client.slot).map(player => player.actor.id); }
  private classname(actor: ActorId): string { const entry = this.actorExecutions.get(actor); return this.player(actor) !== null ? "player" : entry?.kind === "q3" ? "q3:projectile" : entry?.kind === "quakec" ? entry.source.classname(actor) : entry?.entity.classname ?? ""; }

  private powerup(actor: OwnedActor, powerup: Q1Powerup, expires: number): undefined {
    if (powerup === "invulnerability") this.combat.setTraits(actor, { invulnerable: expires > this.timeSeconds });
    return undefined;
  }

  private weaponEvent(content: ContentId, event: Q2WeaponEvent): undefined {
    if (this.source.kind === "q2") this.source.players.weaponEvent(event);
    else if (event.kind === "player-animation") {
      const player = this.player(event.actor);
      if (player !== null) this.q2Characters.get(player.actor)?.setAnimation(event.priority, event.first, event.last);
    }
    if (event.kind === "view-weapon") this.viewModels.set(event.actor, { path: event.model, frame: event.frame,
      q2: { skin: event.skin, rate: event.rate, kickOrigin: event.kickOrigin, kickAngles: event.kickAngles } });
    return this.events.emit(content, { kind: "q2-weapon", event }, this.selectedWeaponSource?.kind === "q2" && content === this.weaponProvider.content
      ? this.selectedWeaponSource.frame.time : this.sourceFrame.time);
  }

  private createPlayer(actor: OwnedActor, client: ClientId, origin: Vec3, angles: Vec3, arsenal: ArsenalState): MovementPlayer {
    const source = this.source;
    const netQuake: NetQuakeClientBinding | undefined = source.kind === "quakec" && source.game.kind === "netquake" ? {
      projection: { read: state => source.game.readClientState(actor.id, state), write: state => source.game.writeClientState(actor.id, state) },
      jumpAuthority: "source-gamecode", input: command => source.game.clientInput(actor.id, command),
      beforePhysics: () => source.game.clientPreThink(actor), think: frame => source.game.runThink(actor, frame), afterPhysics: () => source.game.clientPostThink(actor),
    } : source.kind === "q1" ? {
      projection: null, jumpAuthority: "selected-movement",
      input: command => source.composition.input(actor.id, { attack: (command.buttons & 1) !== 0, jump: (command.buttons & 2) !== 0,
        use: (command.buttons & 4) !== 0, impulse: command.impulse }),
      beforePhysics: frame => {
        const player = this.requirePlayer(actor.id);
        source.composition.playerPreThink(actor.id); source.game.playerFrame(actor, seconds(frame.time), player.waterLevel);
        return undefined;
      },
      think: frame => { this.scheduler.run(actor.id, { ...frame, phase: "entity-think" }, "during-physics"); return undefined; },
      afterPhysics: frame => { source.game.playerAfterPhysics(actor, seconds(frame.time)); source.composition.playerPostThink(actor.id);
        this.q2Characters.get(actor)?.afterClientThink(); this.q1Characters.get(actor)?.postMove(); return undefined; },
    } : undefined;
    const player = new MovementPlayer(actor, client, this.recipe, { ...(netQuake === undefined ? {} : { netQuake }),
      ...(source.kind !== "quakec" || source.game.kind !== "quakeworld" ? {} : { quakeWorld: {
        read: (state: import("../../../contracts/movement.ts").QwMovementState) => source.game.readQuakeWorldState(actor.id, state),
        write: (state: import("../../../contracts/movement.ts").QwMovementState) => source.game.writeQuakeWorldState(actor.id, state),
        beforePhysics: (command: QwUserCommand, frame: FrameContext) => source.game.quakeWorldPreThink(actor, command, frame),
        water: (level: number, type: number) => source.game.quakeWorldWater(actor.id, level, type),
        profile: (profile: import("../../../contracts/movement.ts").QwMovementProfile) => source.game.quakeWorldProfile(actor.id, profile),
      } }), actors: this.actors, bodies: this.bodies, combat: this.combat, scene: this.scene, rereleaseMovement: this.physics.rereleaseMovement,
      q2MovementConfig: () => this.q2MovementConfig(),
      weaponStep: input => this.weaponStep(input), animationStep: input => this.animationStep(input), touch: (contact, state) => this.touch(contact, state),
      sourcePunch: actor => this.q1WeaponSource()?.game.player(actor)?.punchAngles ?? null,
      worldActor: () => this.worldActor(), touchTriggers: owned => this.source.kind === "q3" ? undefined : this.physics.touchTriggers(owned), isBrush: id => this.physics.isBrush(id), jump: (owned, action) => this.jump(owned, action),
      q3Hooks: { firing: context => (context.command.buttons & 1) !== 0 && context.motion.health > 0,
        animation: (request, context) => context.animation.state.kind === "q3" ? q3SourceAnimation(request, context) : { animation: context.animation, effects: [] }, torso: context => context.animation.state.kind === "q3" ? q3SourceTorso(11, context, true) : { animation: context.animation, effects: [] },
        weapon: context => { const result = this.weaponStep({ actor: context.input.actor, command: context.input.command, frame: context.frame,
          arsenal: context.arsenal, animation: context.animation, environment: context.input.environment, gauntletHit: this.playerStates.get(context.input.actor)?.sourceMovement?.gauntletHit ?? false });
          const runtime = this.q3Arsenals.get(context.input.actor);
          if (this.selectedArsenal !== null && this.source.kind === "q3") {
            const client = this.source.game.records.nativeByActor(context.input.actor.id)?.client;
            if (client == null) throw new Error("Selected Q3-map movement has no source client");
            const mask = MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD;
            return { ...result, movementFlags: (context.motion.pmFlags & ~mask) | (client.ps.pmFlags & mask) };
          }
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
    if (this.source.kind === "q1") return this.requirePlayer(this.admitPlayer(client).actor).actor;
    if (this.source.kind === "q2") {
      const admitted = this.admitPlayer(client), entity = this.source.game.entity(admitted.actor);
      if (entity === null) throw new Error("Bot admission lost its shared source entity");
      entity.serverFlags |= 16; return entity.actor;
    }
    if (this.source.kind !== "q3") throw new Error("Bot admission requires a supported source observation binding");
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
    this.handGrenades?.admit(actor.id); this.admitGrapple(actor.id);
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
    if (this.selectedArsenal !== null) {
      this.selectedArsenal.remove(player.actor.id);
      player.arsenal = this.selectedArsenal.admit(player.actor, 100, false);
    }
    this.handGrenades?.respawn(player.actor.id); this.grapple?.release(player.actor.id); this.admitGrapple(player.actor.id);
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
    const grappleGravity = this.grapple?.gravityScale(player.actor.id) ?? 1;
    if (this.grapple !== null && (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease"))
      player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * player.gravityMultiplier * grappleGravity) };
    if (grappleGravity === 0) {
      if (player.state.kind === "q3") player.state = { ...player.state, gravity: 0 };
      player.sourceEnvironment = { ...player.sourceEnvironment, gravityMultiplier: 0 };
    }
    const elapsed = Math.max(0, Math.min(200, command.serverTime - client.ps.commandTime));
    const pending = this.q3Commands.get(player.actor);
    const converted = selectedQ3Command(player.profile.kind === "q3" ? command : { ...command, angles: add(command.angles, client.ps.deltaAngles) }, player, elapsed);
    const before = pending === undefined ? command : q3SourceCommand(pending, player, this.sourceSchedulingMilliseconds, client.ps.weapon);
    const sourceBefore = pending === undefined ? before : relativeQ3SourceCommand(pending.source, before, client.ps.deltaAngles);
    const input: ActorCommand = pending === undefined ? { actor: player.actor.id, sequence: player.lastSequence + 1,
      source: { kind: "bot", provider: this.recipe.map.entities.provider }, command: converted,
      ...(this.selectedArsenal === null ? {} : { arsenal: { provider: this.weaponProvider.provider, weapon: null,
        useHoldable: (command.buttons & CommandButtons.USE_HOLDABLE) !== 0 } }) }
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
    client.ps.groundEntityNum = player.ground.kind === "world" ? 1022 : player.ground.kind === "actor" ? this.source.game.records.nativeByActor(player.ground.actor)?.slot ?? 1023 : 1023;
    if (player.state.kind === "q3") writeQ3MovementState(entity, player.state, this.source.game.records);
    if (player.animation.state.kind === "q3") { const animation = player.animation.state;
      client.ps.legsAnim = animation.legs; client.ps.torsoAnim = animation.torso; client.ps.legsTimer = animation.legsTimerMilliseconds; client.ps.torsoTimer = animation.torsoTimerMilliseconds;
      this.characters.get(player.actor)?.commitAnimation(player.animation);
    }
    writeQ3CharacterAnimation(entity, player.animation);
    for (const { effect } of result.effects) if (effect.kind === "event" && providerFamily(effect.value.provider) === "q3") client.ps.addEvent(effect.value.event, effect.value.parameter);
    const worldActor = this.source.game.pool.at(1022).actor.id;
    return { contacts: result.contacts.flatMap(contact => contact.target.kind === "actor" ? [contact.target.actor] : contact.target.kind === "world" ? [worldActor] : []),
      bounds: player.bounds, waterlevel: player.waterLevel, watertype: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
      xyspeed: Math.hypot(result.state.kind === "q2-classic" ? result.state.velocityEighths[0] / 8 : result.state.velocity.x,
        result.state.kind === "q2-classic" ? result.state.velocityEighths[1] / 8 : result.state.velocity.y) };
  }

  private syncQ3Player(player: MovementPlayer): undefined {
    if (this.source.kind !== "q3") return undefined;
    const entity = this.source.game.records.byActor(player.actor.id), ps = entity?.client?.ps;
    if (entity === null || entity === undefined || ps === undefined) return undefined;
    this.grapple?.observeTeleport(player.actor.id, ps.eFlags & 4);
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
      this.events.emit(this.recipe.map.entities.content, { kind: "view-reset", reason: "source", actor: player.actor.id, angles: player.viewAngles });
    return undefined;
  }

  admitPlayer(client: ClientId, travel: SimulationTravel | undefined = this.options.travel): PlayerAdmission {
    this.assertOpen();
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients) throw new Error("Client does not belong to an available session slot");
    for (const player of this.playerStates.values()) if (player.client.slot === client.slot) throw new Error("Client already has a player");
    const source = this.source;
    if (source.kind === "quakec") {
      if (travel !== undefined && (source.game.kind !== "quakeworld" || travel.source.kind !== "quakeworld") || this.options.dedicated !== true || providerFamily(this.recipe.character.definition.provider) !== "q1"
        || providerTiming(this.recipe, this.recipe.movement.provider).clock.kind !== (source.game.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake"))
        throw new Error("QuakeC internal clients require dedicated native NetQuake movement and Q1 character; graphical clients and travel are unsupported");
      const actor = source.game.admitClient(client), body = this.bodies.read(actor.id);
      if (body === null) throw new Error("QC reserved client has no shared body");
      const player = this.createPlayer(actor, client, body.origin, body.angles, source.game.clientArsenal(actor.id));
      this.playerStates.set(actor, player); player.state = player.readState(); player.animation = source.game.clientAnimation(actor.id);
      player.bounds = body.bounds; player.viewAngles = body.angles; player.commandAngles = body.angles;
      this.syncQuakeCClientView(player);
      return { actor: actor.id, viewHeight: player.viewHeight };
    }
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
      source.product.admit(actor, { slot: client.slot, userinfo: `\\name\\Player ${client.slot + 1}\\skin\\male/grunt`, initializeInventory: false, useQ2Weapons: this.selectedArsenal === null }, travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot ? { ...travel.source.landmark, player: actor.id } : null);
    } }
    if (player.character === "q1" && source.kind === "q1") {
      const character = new Q1CharacterActor(source.game, actor, { requestRespawn: () => this.respawnPlayer(player), dropInventory: () => this.dropPlayerInventory(player), sourcePose: () => this.q1CharacterPose(actor.id), fallDamageAllowed: () => source.composition.fallDamageAllowed(actor.id) });
      this.q1Characters.set(actor, character);
      this.callbacks.bind(actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction.attacker, reaction.damage), die: reaction => character.die(reaction.attacker) });
    }
    if (player.character === "q2" && source.kind === "q1") this.attachQ2Character(player);
    const carriedPlayer = travel?.players.find(record => record.client.slot === client.slot && record.client.generation === client.generation);
    const carried = carriedPlayer?.state;
    if (source.kind === "q1" && carried?.kind === "q1") source.composition.admitTravel(actor, carried.carry);
    else if (source.kind === "q2" && carried?.kind === "q2" && entity !== null) source.players.restoreCarry(entity, source.game, carried.carry);
    player.state = player.readState();
    if (this.selectedArsenal !== null) {
      if (source.kind === "q1" && this.selectedArsenal.family === "q1" && (this.selectedArsenal.game.registeredWeapons.size === 0 || carriedPlayer?.selectedArsenal === undefined)) player.arsenal = this.selectedArsenal.admit(actor, 100);
      else if (carriedPlayer?.selectedArsenal !== undefined) {
        const carry = carriedPlayer.selectedArsenal;
        if (this.selectedArsenal.family === "q1" && carry.kind === "q1") player.arsenal = this.selectedArsenal.admitTravel(actor, 100, carry.state);
        else if (this.selectedArsenal.family === "q2" && carry.kind === "q2" && this.selectedWeaponSource?.kind === "q2") {
          this.selectedArsenal.admit(actor, 100);
          for (const entry of carry.inventory) {
            const destination = this.inventory.entries(actor.id).find(value => value.item === entry.item);
            if (destination === undefined) throw new Error("Selected Q2 travel item has no admitted inventory entry");
            this.inventory.configure(actor, { ...destination, count: Math.min(entry.count, destination.capacity) });
          }
          const weapon = carry.weapon === null ? null : Q2_BASE_WEAPONS.find(value => value.item === carry.weapon);
          if (weapon === undefined) throw new Error("Selected Q2 travel weapon is not in the base arsenal");
          const state = this.selectedWeaponSource.weapons.states.get(actor.id);
          if (state === undefined) throw new Error("Selected Q2 travel has no native weapon state");
          Object.assign(state, new Q2WeaponState(weapon?.name ?? null));
          player.arsenal = this.selectedArsenal.read(actor.id);
        }
        else if (this.selectedArsenal.family === "q3" && carry.kind === "q3") this.selectedArsenal.restore(actor, { ...carry.state, lastFireMilliseconds: carry.state.lastFireMilliseconds === null ? null
          : carry.state.lastFireMilliseconds + this.selectedMilliseconds - carry.milliseconds });
        else throw new Error("Campaign travel selected arsenal family differs from destination");
      }
      else player.arsenal = this.selectedArsenal.admit(actor, 100, false);
    } else if (carriedPlayer?.selectedArsenal !== undefined) throw new Error("Campaign travel selected arsenal differs from the destination recipe");
    player.arsenal = this.arsenal(player);
    if (source.kind === "q1") {
      const selected = source.composition.selectSpawn(actor.id); if (selected === null) throw new Error("Source player spawn is deferred");
      const spot = source.game.body(selected); this.characterStarts.set(actor, selected.actor.id);
      this.setPlayerMovement(actor.id, { kind: "spawn", origin: add(spot.origin, { x: 0, y: 0, z: 1 }), velocity: zero, angles: spot.angles, commandAngles: player.commandAngles, holdMilliseconds: 0, spectator: false });
      this.killBox(actor); this.bodies.link(actor); source.game.useTargets(selected, actor.id);
      source.composition.spawned(actor.id, true); this.entryCarry.set(actor, source.composition.captureTravel(actor)); }
    if (source.kind === "q2") this.resumeQ2Presentation(actor.id);
    this.handGrenades?.admit(actor.id, carriedPlayer?.handGrenades); this.admitGrapple(actor.id);
    if (carriedPlayer?.weaponSlot !== undefined && this.weaponSlots.has(actor.id)) {
      this.primaryHandoff(actor.id).holster();
      this.bindWeaponSlot(actor.id, { kind: "holstering-primary", next: carriedPlayer.weaponSlot });
      this.weaponSlots.get(actor.id)?.reconcile();
    }
    return { actor: actor.id, viewHeight: player.viewHeight };
  }

  private syncQuakeCClientView(player: MovementPlayer): undefined {
    if (this.source.kind !== "quakec") return undefined;
    const angles = this.source.game.consumeClientViewReset(player.actor.id);
    if (angles !== null) {
      player.viewAngles = angles;
      this.events.emit(this.recipe.map.entities.content, { kind: "view-reset", reason: "source", actor: player.actor.id, angles });
    }
    return undefined;
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
      }, weapon: actor => { return { q2Name: null, ammo: this.playerUi(actor).ammo?.item ?? null,
        kickAngles: zero, kickOrigin: zero, loopSound: "" }; },
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
    if (this.selectedArsenal !== null) { this.selectedArsenal.remove(player.actor.id); player.arsenal = this.selectedArsenal.admit(player.actor, 100, false); }
    this.combat.setTraits(player.actor, { canTakeDamage: true, invulnerable: false });
    this.setPlayerMovement(player.actor.id, { kind: "spawn", origin: add(spot.origin, { x: 0, y: 0, z: 1 }), velocity: zero, angles: spot.angles, commandAngles: player.commandAngles, holdMilliseconds: 0, spectator: false });
    this.selectedBallistics?.respawn(player.actor.id);
    this.handGrenades?.respawn(player.actor.id); this.grapple?.release(player.actor.id); this.admitGrapple(player.actor.id);
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
    if (this.selectedArsenal !== null) return this.selectedArsenal.read(player.actor.id);
    if (this.source.kind === "q3") return { ...player.arsenal, ammo: this.inventory.entries(player.actor.id) };
    if (this.source.kind === "quakec") return this.source.game.clientArsenal(player.actor.id);
    if (this.source.kind === "q1") {
      const state = this.source.game.player(player.actor.id);
      if (state === null) throw new Error("Q1 player has no arsenal");
      return { provider: this.weaponProvider.provider, activeWeapon: this.source.game.weaponItem(state.weapon), ammo: this.inventory.entries(player.actor.id),
        state: { kind: "q1", frame: state.weaponFrame, attackFinishedSeconds: state.attackFinished, sourceWeapon: isQ1BaseWeapon(state.weapon) ? q1WeaponBit(state.weapon) : 0 } };
    }
    if (this.source.kind !== "q2") throw new Error("Arsenal accessed before source admission");
    return projectQ2Arsenal(player.actor.id, this.weaponProvider.provider, this.source.weapons, this.inventory);
  }

  private weaponStep(input: WeaponStepInput): WeaponStepResult {
    const player = this.playerStates.get(input.actor);
    if (player === undefined) throw new Error("Weapon input has no admitted player");
    if (this.selectedArsenal !== null) {
      if (this.selectedArsenal.family === "q1") {
        const client = this.source.kind === "q1" ? this.source.composition.clients.require(player.actor.id) : null;
        const impulse = client?.impulse ?? ("impulse" in input.command ? input.command.impulse : 0);
        if (this.selectedArsenal.impulse(player.actor.id, impulse)) { if (client !== null) client.impulse = 0; }
        else if (this.source.kind === "q1") this.source.composition.impulse(player.actor.id);
      }
      if (this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf && this.source.product.match.source.match.paused)
        return { arsenal: this.selectedArsenal.read(player.actor.id), animation: input.animation, effects: [] };
      const arsenal = this.selectedArsenal.read(player.actor.id);
      const gauntletHit = (this.weaponSlots.get(player.actor.id)?.primarySelected() ?? true) && arsenal.state.kind === "q3" && arsenal.state.sourceWeapon === 1 && arsenal.state.timeMilliseconds <= 0
        && (input.command.buttons & 1) !== 0 && (input.command.kind !== "q3" || (input.command.buttons & CommandButtons.TALK) === 0)
        && input.environment.health > 0 ? this.selectedBallistics?.gauntletHit(player.actor) ?? false : false;
      if (this.source.kind === "q3") {
        const entity = this.source.game.records.nativeByActor(player.actor.id), client = entity?.client;
        if (client == null) throw new Error("Selected primary on Q3 map has no admitted source client");
        const useHoldable = player.arsenalIntent?.useHoldable ?? (input.command.kind === "q3" && (input.command.buttons & CommandButtons.USE_HOLDABLE) !== 0);
        if ((input.command.buttons & CommandButtons.ATTACK) === 0 && !useHoldable && input.environment.health > 0) client.ps.pmFlags &= ~MoveFlags.RESPAWNED;
        if (this.source.game.stepHoldable(player.actor.id, useHoldable)) {
          this.primaryCommandBlocks.add(player.actor.id);
          return { arsenal, animation: input.animation, effects: [] };
        }
      }
      this.primaryCommandBlocks.delete(player.actor.id);
      const frame = this.selectedArsenal.family === "q1" ? this.selectedQ1Frame() : this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource.frame
        : { ...input.frame, time: { kind: "milliseconds", value: this.selectedMilliseconds } satisfies SourceTime };
      const result = this.selectedArsenal.step({ ...input, gauntletHit, frame }, player.arsenalIntent);
      player.arsenal = result.arsenal;
      this.weaponSlots.get(player.actor.id)?.reconcile();
      return result;
    }
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
      this.weaponSlots.get(player.actor.id)?.reconcile();
      return result;
    }
    if (this.source.kind === "q1") this.playerWeapon(player);
    this.weaponSlots.get(player.actor.id)?.reconcile();
    return { arsenal: this.arsenal(player), animation: this.characters.get(input.actor)?.animation ?? input.animation, effects: [] };
  }

  private frameSelectedQ2Weapon(actor: OwnedActor): undefined {
    const player = this.playerStates.get(actor);
    if (this.selectedArsenal?.family !== "q2" || player === undefined || this.primaryCommandBlocks.has(actor.id)) return undefined;
    this.selectedArsenal.frame(actor.id);
    player.arsenal = this.selectedArsenal.read(actor.id);
    this.weaponSlots.get(actor.id)?.reconcile();
    return undefined;
  }

  private playerWeapon(player: MovementPlayer): undefined {
    if (player.cutscene !== null) return undefined;
    const source = this.source, pressed = (player.buttons & 1) !== 0;
    if (source.kind === "q1") { source.composition.impulse(player.actor.id); if (this.selectedArsenal === null && source.game.weaponInput(player.actor, pressed, player.viewAngles, this.timeSeconds, player.waterLevel)) source.composition.fired(player.actor.id, this.arsenal(player).activeWeapon); }
    else if (source.kind === "q2") { const entity = source.game.entity(player.actor.id); if (entity !== null) { source.product.match.beforePlayer(entity, source.game); source.players.beginFrame(entity, source.game); } }
    return undefined;
  }

  private q2WeaponInput(player: MovementPlayer) {
    const selected = this.selectedArsenal?.family === "q2";
    const pressed = (player.buttons & 1) !== 0 && (!selected || (this.weaponSlots.get(player.actor.id)?.primarySelected() ?? true));
    const q3 = this.source.kind === "q3" ? this.source.game.records.nativeByActor(player.actor.id)?.client?.ps : undefined;
    return { attack: pressed, latchedAttack: pressed && (player.previousButtons & 1) === 0, holster: false, angles: player.viewAngles,
      ducked: player.bounds.max.z < player.standingBounds.max.z, spectator: this.source.kind === "q2" && this.source.players.states.get(player.actor.id)?.spectator === true
        || selected && (player.intermission || player.cutscene !== null || q3 !== undefined && (q3.pmType === MoveType.PM_SPECTATOR || (q3.pmFlags & MoveFlags.RESPAWNED) !== 0)),
      notarget: selected && (this.monsterTarget(player.actor.id)?.notarget ?? false), hand: "right", animatePlayer: player.character === "q2",
      quadUntil: this.source.kind === "q2" ? this.source.items.playerPowerups(player.actor.id).quadUntil : this.source.kind === "q1"
        ? this.source.game.player(player.actor.id)?.powerups.get("quad") ?? 0 : this.source.kind === "q3"
          ? (this.source.game.records.nativeByActor(player.actor.id)?.client?.ps.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000 : 0,
      doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false,
      instantSwitch: false, quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: this.physics.gravity, weaponThunk: false } satisfies import("../../../content/q2/foundation/weapons/types.ts").Q2WeaponInput;
  }

  private setPlayerMovement(actor: ActorId, change: Q2PlayerMovementChange, link = true): undefined {
    const player = this.requirePlayer(actor), body = this.bodies.read(actor);
    if (body === null) throw new Error("Player has no body");
    const state = player.readState();
    if (change.kind === "teleport") this.grapple?.release(actor);
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
    this.events.emit(this.recipe.map.entities.content, { kind: "view-reset", reason: change.kind, actor, angles: change.angles });
    return undefined;
  }

  private animationStep(input: AnimationStepInput): AnimationStepResult {
    if (this.source.kind === "quakec") return { animation: this.source.game.clientAnimation(input.actor.id), effects: [] };
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
      const sourceQw = state.kind === "q1-quakeworld" && this.source.kind === "quakec" && this.source.game.kind === "quakeworld";
      if (sourceQw) {
        const slot = this.sourcePosition(other)[1];
        if (this.quakeWorldTouched?.has(slot) === true) return { kind: "continue", state: player.readState() };
        const owner = this.actors.resolveOwned(other);
        if (owner !== null) this.callbacks.touch({ ...sharedContact, self: owner, other: contact.self.id });
        this.quakeWorldTouched?.add(slot);
      } else if (state.kind === "q2-classic" || state.kind === "q2-rerelease") {
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
    if (action === "jump") {
      const character = this.characters.get(actor);
      if (character !== undefined) return character.jump();
      if (this.requirePlayer(actor.id).character === "q2") return this.events.emit(this.recipe.character.definition.content,
        { kind: "q2", event: { kind: "sound", actor: actor.id, origin: this.requirePlayer(actor.id).view().origin, path: "*jump1.wav", channel: 2,
          volume: 1, attenuation: 1, reliable: false, loop: "once" } });
    }
    return this.events.emit(this.recipe.movement.content, { kind: "q1", event: { kind: "sound", actor: actor.id,
      path: action === "jump" ? "player/plyrjmp8.wav" : "misc/water1.wav", channel: "body", volume: 1, attenuation: 1 } });
  }

  private prepareArsenalCommand(player: MovementPlayer, received: ActorCommand, paused: boolean): ActorCommand {
    let command = received;
    const slot = this.weaponSlots.get(player.actor.id);
    if (!paused && slot !== undefined && command.arsenal !== undefined) {
      const intent = command.arsenal;
      if (intent.weapon !== null && !this.requestWeapon(player.actor.id, { provider: intent.provider, item: intent.weapon })) throw new Error("Weapon request is unavailable to this actor");
      command = { ...command, arsenal: { provider: this.weaponProvider.provider, weapon: null, useHoldable: intent.useHoldable } };
    } else if (!paused && slot === undefined && this.selectedArsenal === null && command.arsenal !== undefined
      && (this.source.kind === "q1" || this.source.kind === "q2" || this.source.kind === "quakec")) {
      const intent = command.arsenal;
      if (intent.provider !== this.weaponProvider.provider) throw new Error("Arsenal command belongs to a different provider");
      if (intent.weapon !== null && (this.source.kind === "q2" || intent.weapon !== this.arsenal(player).activeWeapon)
        && !this.requestWeapon(player.actor.id, { provider: intent.provider, item: intent.weapon })) throw new Error("Weapon request is unavailable to this actor");
      command = { ...command, arsenal: { provider: this.weaponProvider.provider, weapon: null, useHoldable: intent.useHoldable } };
    }
    if (!paused && this.grapple?.selection.binding === "slot") this.grapple.input(player.actor.id, (command.command.buttons & 1) !== 0);
    return command;
  }

  queueQuakeWorldCommands(client: ClientId, commands: readonly QwUserCommand[], sequence: number): void {
    this.assertOpen();
    if (this.source.kind !== "quakec" || this.source.game.kind !== "quakeworld" || !this.options.identity.owns(client)
      || !Number.isSafeInteger(sequence) || sequence < 0 || commands.length < 1 || commands.length > 20)
      throw new Error("Invalid native QuakeWorld command group");
    const player = [...this.playerStates.values()].find(player => player.client.equals(client));
    if (player === undefined) throw new Error("QuakeWorld command client has not begun");
    for (const command of commands) if (!Number.isInteger(command.milliseconds) || command.milliseconds < 0 || command.milliseconds > 255)
      throw new Error("Invalid QuakeWorld command duration");
    this.quakeWorldCommands.push({ kind: "move", client, commands: structuredClone(commands), sequence });
  }
  queueQuakeWorldAction(client: ClientId, action: () => void): void {
    this.assertOpen();
    if (this.source.kind !== "quakec" || this.source.game.kind !== "quakeworld" || !this.options.identity.owns(client)
      || !this.source.game.hasClient(client)) throw new Error("QuakeWorld action requires a connected client");
    this.quakeWorldCommands.push({ kind: "action", client, action });
  }
  private runQuakeWorldNewMissile(): void {
    if (this.source.kind !== "quakec" || this.source.game.kind !== "quakeworld") return;
    const actor = this.source.game.takeNewMissile();
    if (actor === null) return;
    const entry = this.actorExecutions.get(actor.id);
    if (entry?.kind !== "quakec") throw new Error("QW newmis has no shared source execution");
    executeActor(entry, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
      frame: { ...this.sourceFrame, elapsed: { kind: "seconds", value: 0.05 } }, timeSeconds: this.timeSeconds, elapsed: 0.05, visited: new Set<OwnedActor>() });
    this.physics.commitAttachments();
  }
  private runQuakeWorldCommands(): void {
    if (this.source.kind !== "quakec" || this.source.game.kind !== "quakeworld") return;
    const source = this.source.game;
    for (const group of this.quakeWorldCommands.splice(0)) {
      const player = [...this.playerStates.values()].find(player => player.client.equals(group.client));
      if (group.kind === "action") {
        if (!source.hasClient(group.client)) continue;
        group.action();
        if (player === undefined || !source.isActiveClient(player.actor.id)) continue;
        player.arsenal = source.clientArsenal(player.actor.id); player.animation = source.clientAnimation(player.actor.id);
        player.state = player.readState(); this.syncQuakeCClientView(player);
        continue;
      }
      if (player === undefined || group.sequence <= player.lastSequence) continue;
      this.quakeWorldTouched = new Set<number>();
      try {
        for (const command of group.commands) {
          if (!this.actors.isLive(player.actor.id)) break;
          player.move({ actor: player.actor.id, source: { kind: "remote-client", client: group.client }, command, sequence: group.sequence },
            { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: command.milliseconds } });
        }
        if (this.actors.isLive(player.actor.id)) {
          source.clientPostThink(player.actor); this.runQuakeWorldNewMissile();
          player.arsenal = source.clientArsenal(player.actor.id); player.animation = source.clientAnimation(player.actor.id);
          player.state = player.readState(); this.syncQuakeCClientView(player);
        }
      } finally { this.quakeWorldTouched = null; }
    }
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
      const previousSelectedMilliseconds = this.selectedMilliseconds;
      if (!paused) this.selectedMilliseconds += input.elapsedMilliseconds;
      if (!paused) this.sourceSchedulingMilliseconds += input.elapsedMilliseconds;
      const profile = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
      const fixed = profile.kind === "q2-classic" ? 100 : profile.kind === "q2-rerelease" ? profile.frameMilliseconds : profile.kind === "q3" ? profile.serverFrameMilliseconds : null;
      const mapRun = !paused && (fixed === null || this.sourceSchedulingMilliseconds >= this.timeSeconds * 1000);
      const elapsed = fixed === null ? Math.min(0.1, Math.max(0.001, input.elapsedMilliseconds / 1000)) : fixed / 1000;
      const selectedQ2 = this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource : null;
      const mapEndMilliseconds = (selectedQ2?.mapMilliseconds ?? this.timeSeconds * 1000) + elapsed * 1000;
      const deadlines = new Set<number>([mapEndMilliseconds]);
      const weaponDeadlines = new Set<number>();
      if (mapRun) {
        if (selectedQ2 !== null) for (let due = selectedQ2.nextMilliseconds; due <= mapEndMilliseconds; due += selectedQ2.intervalMilliseconds) {
          deadlines.add(due); weaponDeadlines.add(due);
        }
        for (const source of this.monsterSources.values()) if (source.kind === "q2") {
          const interval = source.game.options.edition === "classic" ? 100 : 25;
          for (let due = Math.round(seconds(source.clock.frame.time) * 1000) + interval; due <= mapEndMilliseconds; due += interval) deadlines.add(due);
        }
      }
      const boundaries = [...deadlines].sort((a, b) => a - b).map(milliseconds => ({
        map: mapRun && milliseconds === mapEndMilliseconds, q2: weaponDeadlines.has(milliseconds), milliseconds,
      }));
      for (const boundary of boundaries) {
      const run = boundary.map, commandTurn = run || !mapRun;
      if (run && selectedQ2 !== null) selectedQ2.mapMilliseconds = mapEndMilliseconds;
      if (boundary.q2 && selectedQ2 !== null) {
        const milliseconds = selectedQ2.frame.time.kind === "milliseconds";
        selectedQ2.frame = { frame: selectedQ2.frame.frame + 1, phase: "frame-entry",
          time: { kind: milliseconds ? "milliseconds" : "seconds", value: milliseconds ? boundary.milliseconds : boundary.milliseconds / 1000 },
          elapsed: { kind: milliseconds ? "milliseconds" : "seconds", value: milliseconds ? selectedQ2.intervalMilliseconds : selectedQ2.intervalMilliseconds / 1000 } };
        selectedQ2.nextMilliseconds = boundary.milliseconds + selectedQ2.intervalMilliseconds;
      }
      if (mapRun && !run) this.beginMonsterFrames(boundary.milliseconds, false);
      let botCommands: readonly ActorCommand[] = [];
      const preparesQ1Clients = this.source.kind === "q1" || this.source.kind === "quakec";
      if (run) {
        if (fixed === null) this.sourceFrame = { ...this.clock.frame, elapsed: { kind: "seconds", value: elapsed }, phase: "frame-entry" };
        else this.sourceFrame = this.clock.advance({ kind: this.clock.frame.time.kind, value: this.clock.frame.time.kind === "seconds" ? elapsed : fixed });
        this.beginMonsterFrames(boundary.milliseconds, true);
        if (this.selectedArsenal?.family === "q1") {
          const frame = this.selectedQ1Frame();
          this.selectedArsenal.game.beginFrame(seconds(frame.time), seconds(frame.elapsed));
          this.selectedArsenal.frame(seconds(frame.time));
        }
        const q1Weapons = this.q1WeaponSource();
        if (!paused && q1Weapons !== null) for (const player of this.playerStates.values()) {
          if (player.cutscene !== null || player.intermission || player.state.kind === "q1-netquake" && player.state.moveType === 0) continue;
          const punchAngles = q1Weapons.game.advancePunch(player.actor.id, seconds(this.selectedQ1Frame().elapsed), createNumericOperations(providerTiming(this.recipe, this.weaponProvider.provider).numeric));
          if (punchAngles !== null && player.state.kind === "q1-netquake") player.state = { ...player.state, punchAngles };
        }
        if (this.handGrenades !== null) this.equipmentFrame = providerFrame(this.sourceFrame, profile, providerTiming(this.recipe, this.handGrenades.selection.source.provider).clock);
        if (this.grapple !== null) {
          this.grappleFrame = providerFrame(this.sourceFrame, profile, providerTiming(this.recipe, this.grapple.selection.source.provider).clock);
          if (this.grapple.source.kind === "q1-threewave") this.grapple.source.game.beginFrame(seconds(this.grappleFrame.time), seconds(this.grappleFrame.elapsed));
        }
        if (this.source.kind === "q2" && this.source.product.rerelease?.players.intermissionFadeUntil != null) {
          this.checkingQ2Rules = true;
          try { this.source.product.rerelease.players.fadeFrame(this.source.game); } finally { this.checkingQ2Rules = false; }
          this.sourceFrame = this.clock.enter("frame-exit");
          if (this.sourceSchedulingMilliseconds > this.timeSeconds * 1000) this.sourceSchedulingMilliseconds = this.timeSeconds * 1000;
          emitQ2ShadowLights(this.source.game);
          return { snapshot: this.snapshot(), events: this.events.take() };
        }
        if (this.source.kind === "q1") this.source.game.beginFrame(this.timeSeconds, elapsed);
        if (preparesQ1Clients) botCommands = this.botServices.frame(this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : Math.trunc(this.timeSeconds * 1000), elapsed * 1000);
        if (this.source.kind === "q1" || this.source.kind === "quakec") {
          for (const command of [...input.commands, ...botCommands]) {
            const player = this.requirePlayer(command.actor);
            if (player.profile.kind !== "q1-netquake" || command.sequence <= player.lastSequence) continue;
            player.receiveNetQuake(this.prepareArsenalCommand(player, command, false));
            this.grapple?.setJump(player.actor.id, (command.command.buttons & 2) !== 0);
            if (this.source.kind === "q1" && this.source.game.intermission !== null)
              this.source.composition.requestIntermissionExit(player.buttons !== 0);
          }
          for (const player of this.playerStates.values()) if (player.profile.kind === "q1-netquake" && player.cutscene === null && !player.intermission) {
            const gravityMultiplier = player.gravityMultiplier;
            player.gravityMultiplier *= this.grapple?.gravityScale(player.actor.id) ?? 1;
            try { player.prepareNetQuake({ ...this.sourceFrame, phase: "client-command" }); }
            finally { player.gravityMultiplier = gravityMultiplier; }
          }
        }
        if (this.source.kind === "quakec") this.source.game.beginFrame(this.sourceFrame);
        if (this.source.kind === "q1") {
          this.setWorldGravity(this.source.cvars.variableValue("sv_gravity"));
          this.source.composition.preFrame(elapsed);
          for (const player of this.playerStates.values()) {
            if (player.profile.kind === "q1-netquake") continue;
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
      if (run && !preparesQ1Clients) botCommands = this.botServices.frame(this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : Math.trunc(this.timeSeconds * 1000), elapsed * 1000);
      for (const received of [...(commandTurn ? input.commands : []), ...botCommands]) {
        let command = paused ? { ...received, command: { ...received.command, buttons: received.command.buttons & ~1 } } : received;
        const player = this.player(command.actor);
        if (player === null) throw new Error("Command targets an unadmitted player");
        if (command.sequence <= player.lastSequence) continue;
        command = this.prepareArsenalCommand(player, command, paused);
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
        const movementCommand = command.command;
        this.grapple?.setJump(player.actor.id, movementCommand.kind === "q1-netquake" || movementCommand.kind === "q1-quakeworld" ? (movementCommand.buttons & 2) !== 0
          : movementCommand.kind === "q2-rerelease" ? (movementCommand.buttons & 8) !== 0 : movementCommand.upMove > 0);
        if (this.source.kind === "q3") {
          this.q3Commands.set(player.actor, command);
          try { this.source.game.playerThink(command); } finally { this.q3Commands.delete(player.actor); }
          this.syncQ3Player(player);
        } else {
          const gravityMultiplier = player.gravityMultiplier;
          const matchGravity = this.source.kind === "q2" ? this.source.product.match.gravityScale(player.actor.id) : 1;
          player.gravityMultiplier *= matchGravity * (this.grapple?.gravityScale(player.actor.id) ?? 1);
          if ((this.source.kind === "q2" || this.grapple !== null) && (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3"))
            player.state = { ...player.state, gravity: Math.trunc(this.physics.gravity * player.gravityMultiplier) };
          try { const moved = player.move(command, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: player.profile.kind === "q1-netquake" ? Math.min(100, Math.max(1, input.elapsedMilliseconds)) : input.elapsedMilliseconds } });
          if (this.source.kind === "q2" && moved.kind === "q2-rerelease" && moved.status === "active") this.source.product.movementImpact(player.actor.id, moved.impactDelta, (moved.state.flags & 128) !== 0);
          } finally { player.gravityMultiplier = gravityMultiplier; }
        }
        const sourcePunch = this.q1WeaponSource()?.game.player(player.actor.id)?.punchAngles;
        if (sourcePunch !== undefined && player.state.kind === "q1-netquake") player.state = { ...player.state, punchAngles: sourcePunch };
        if (!paused && this.selectedArsenal !== null && (player.profile.kind === "q2-classic" || player.profile.kind === "q2-rerelease") && this.actors.isLive(player.actor.id)) {
          const combat = this.combat.read(player.actor.id);
          if (combat === null) throw new Error("Selected arsenal owner has no combat state");
          const milliseconds = "milliseconds" in command.command ? command.command.milliseconds : Math.min(100, Math.max(1, input.elapsedMilliseconds));
          const result = this.weaponStep({ actor: player.actor, command: command.command,
            frame: { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: milliseconds } },
            arsenal: this.arsenal(player), animation: player.animation, environment: playerMovementEnvironment(player, combat), gauntletHit: false });
          player.arsenal = result.arsenal; player.animation = result.animation;
        }
        if (this.source.kind === "q1" && this.actors.isLive(player.actor.id)) { this.source.game.playerAfterPhysics(player.actor, this.timeSeconds); this.source.composition.playerPostThink(player.actor.id); }
        if (!paused && this.source.kind === "q2" && this.actors.isLive(player.actor.id)) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) {
          if (!player.intermission) entity.viewHeight = player.viewHeight;
          this.source.players.afterClientThink(entity, this.source.game);
        } }
        this.q2Characters.get(player.actor)?.afterClientThink();
        const q1Character = this.q1Characters.get(player.actor); if (q1Character !== undefined) q1Character.postMove();
        if (!paused) this.physics.commitAttachments();
      }
      if (!paused) {
        if (run && this.source.kind === "q2") this.source.monsters.beginFrame(this.source.game);
        if (run && this.source.kind === "q3") this.source.game.beginFrame(this.sourceFrame);
        const visited = new Set<OwnedActor>();
        let cursor: readonly [number, number] | null = null;
        for (;;) {
          const previous = cursor;
          let next: { readonly actor: OwnedActor; readonly position: readonly [number, number] } | null = null;
          for (const observation of this.actors.observations()) {
            const candidate = this.actors.resolveOwned(observation.id);
            if (candidate === null || visited.has(candidate)) continue;
            const position = this.sourcePosition(candidate.id);
            if (previous !== null && (position[0] < previous[0] || position[0] === previous[0] && position[1] <= previous[1])) continue;
            if (next === null || position[0] < next.position[0] || position[0] === next.position[0] && position[1] < next.position[1])
              next = { actor: candidate, position };
          }
          if (next === null) break;
          const actor = next.actor;
          cursor = next.position;
          visited.add(actor);
          const execution = this.actorExecutions.get(actor.id), clientPlayer = this.playerStates.get(actor);
          if (run && clientPlayer?.profile.kind === "q1-netquake" && (this.source.kind === "q1" || this.source.kind === "quakec")) {
            if (this.source.kind === "quakec") this.source.game.beforeActor(actor);
            else if (this.source.game.forceRetouch > 0) { this.bodies.link(actor); this.physics.touchTriggers(actor); }
            if (this.actors.isLive(actor.id) && clientPlayer.cutscene === null && !clientPlayer.intermission) {
              const gravityMultiplier = clientPlayer.gravityMultiplier;
              clientPlayer.gravityMultiplier *= this.grapple?.gravityScale(actor.id) ?? 1;
              try { clientPlayer.physicsNetQuake({ ...this.sourceFrame, phase: "entity-physics" }); }
              finally { clientPlayer.gravityMultiplier = gravityMultiplier; }
              const punch = this.q1WeaponSource()?.game.player(actor.id)?.punchAngles;
              if (punch !== undefined && clientPlayer.state.kind === "q1-netquake") clientPlayer.state = { ...clientPlayer.state, punchAngles: punch };
              this.syncQuakeCClientView(clientPlayer);
            }
            if (boundary.q2) this.frameSelectedQ2Weapon(actor);
            if (this.actors.isLive(actor.id)) {
              this.q2Characters.get(actor)?.beginFrame();
              this.playerWeapon(clientPlayer);
            }
            this.physics.commitAttachments(); continue;
          }
          if (execution?.kind === "quakec") {
            if (!run) continue;
            execution.source.beforeActor(actor);
            if (this.actors.isLive(actor.id)) executeActor(execution, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
              frame: this.sourceFrame, timeSeconds: this.timeSeconds, elapsed, visited });
            this.runQuakeWorldNewMissile();
            this.physics.commitAttachments(); continue;
          }
          if (execution?.kind === "q3") {
            if (!commandTurn) continue;
            execution.step(previousSelectedMilliseconds, this.selectedMilliseconds);
            this.physics.commitAttachments(); continue;
          }
          const selectedActor = selectedQ2 !== null && execution?.kind === "q2" && execution.services === selectedQ2.game;
          if (selectedActor) {
            if (boundary.q2) {
              executeActor(execution, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
                frame: selectedQ2.frame, timeSeconds: seconds(selectedQ2.frame.time), elapsed: selectedQ2.intervalMilliseconds / 1000, visited });
              this.physics.commitAttachments();
            }
            continue;
          }
          if (boundary.q2) this.frameSelectedQ2Weapon(actor);
          const monsterSource = execution?.kind === "q2" ? this.monsterSources.get(execution.services.options.provider) : undefined;
          if (execution?.kind === "q2" && monsterSource?.kind === "q2" && execution.services === monsterSource.game) {
            const active = run ? this.selectedMonsters?.beforeTurn(actor.id) !== false : this.selectedMonsters?.active(actor.id) !== false;
            if (run && active && this.source.kind === "q1" && this.source.game.forceRetouch > 0) {
              this.bodies.link(actor); this.physics.touchTriggers(actor);
            }
            if (mapRun && active && monsterSource.clock.advanced && this.actors.isLive(actor.id)) {
              const frame = monsterSource.clock.frame;
              executeActor(execution, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
                frame, timeSeconds: seconds(frame.time), elapsed: seconds(frame.elapsed), visited });
              this.physics.commitAttachments();
            }
            continue;
          }
          if (!run || this.selectedMonsters?.beforeTurn(actor.id) === false) continue;
          const equipmentPlayer = this.playerStates.get(actor);
          if (equipmentPlayer !== undefined) {
            this.stepHandGrenade(equipmentPlayer);
            this.grapple?.step(actor.id, (this.combat.read(actor.id)?.health ?? 0) > 0 && !equipmentPlayer.intermission && equipmentPlayer.cutscene === null
              && !(equipmentPlayer.state.kind === "q3" && equipmentPlayer.state.movementType === MoveType.PM_SPECTATOR)
              && !(this.source.kind === "q2" && this.source.players.states.get(actor.id)?.spectator === true));
          }
          if (!this.actors.isLive(actor.id)) continue;
          if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) {
            this.bodies.link(actor); this.physics.touchTriggers(actor);
            if (!this.actors.isLive(actor.id)) continue;
          }
          if (execution !== undefined && !this.playerStates.has(actor)) {
            const sourceProvider = execution.kind === "q1" ? execution.services.provider : execution.services.options.provider;
            const monsterSource = this.monsterSources.get(sourceProvider);
            const frame = monsterSource?.clock.frame ?? (this.selectedArsenal?.family === "q1" && execution.services === this.selectedArsenal.game ? this.selectedQ1Frame() : execution.services === this.grapple?.source.game ? this.grappleFrame : execution.services === this.handGrenades?.independent?.game ? this.equipmentFrame : this.sourceFrame);
            executeActor(execution, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
              frame, timeSeconds: seconds(frame.time), elapsed, visited });
            this.physics.commitAttachments();
            continue;
          }
          if (this.source.kind === "q3") { this.source.game.runActor(actor); this.physics.commitAttachments(); const player = this.playerStates.get(actor); if (player !== undefined) this.syncQ3Player(player); continue; }
          if (this.playerStates.has(actor)) {
            this.q2Characters.get(actor)?.beginFrame();
            this.playerWeapon(this.playerStates.get(actor) ?? this.requirePlayer(actor.id)); this.physics.commitAttachments(); continue;
          }
          this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics");
          if (this.actors.isLive(actor.id)) this.physics.step(actor, elapsed);
          this.physics.commitAttachments();
        }
      }
      if (mapRun) for (const source of this.monsterSources.values()) if (source.kind === "q2" && source.clock.advanced) source.monsters.endFrame(source.game);
      if (run) for (const slot of this.weaponSlots.values()) slot.reconcile();
      if (run || paused) {
        if (this.source.kind === "q2") for (const player of this.playerStates.values()) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) this.source.players.endFrame(entity, this.source.game); }
        if (run && this.source.kind === "q2") {
          const match = this.source.product.match.source;
          if (match instanceof Q2Lmctf && match.match.phase === "countdown" && !match.match.paused && match.match.remaining <= 0 && this.source.game.host.now() >= match.match.nextThink)
            this.q2ServerRegistry?.applyLatched("timelimit");
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
          const frame = character.frame(this.timeSeconds, { axePose: this.q1CharacterPose(player.actor.id).axePose ?? this.playerUi(player.actor.id).activeWeapon === "q1:weapon/axe", attack: (player.buttons & 1) !== 0, jump: (player.buttons & 2) !== 0,
            use: (player.buttons & 4) !== 0, waterLevel: player.waterLevel >= 3 ? 3 : player.waterLevel === 2 ? 2 : player.waterLevel === 1 ? 1 : 0,
            waterType: player.waterType === -3 ? "water" : player.waterType === -4 ? "slime" : player.waterType === -5 ? "lava" : "empty",
            invisible: (powers?.get("invisibility") ?? 0) > this.timeSeconds, invulnerable: (this.combat.read(actor.id)?.invulnerable ?? false) });
          if (this.source.kind === "q1") this.source.composition.characterFrame(actor.id, frame);
          player.animation = { provider: this.recipe.character.definition.provider, state: { kind: "q1", frame: frame.frame, nextFrameSeconds: this.timeSeconds + 0.1 } };
        }
      }
      if (run) {
        if (this.source.kind === "quakec") {
          this.source.game.endFrame();
          if (this.source.game.kind === "quakeworld") { this.runQuakeWorldCommands(); this.source.game.messages.flush(); }
        }
        if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) this.source.game.forceRetouch--;
        if (fixed === null) this.sourceFrame = this.clock.advance({ kind: "seconds", value: elapsed }, "frame-exit");
        else { this.sourceFrame = this.clock.enter("frame-exit"); if (this.sourceSchedulingMilliseconds > this.timeSeconds * 1000) this.sourceSchedulingMilliseconds = this.timeSeconds * 1000; }
      }
      }
      if (this.source.kind === "q2") emitQ2ShadowLights(this.source.game);
      return { snapshot: this.snapshot(), events: this.events.take() };
    } finally { this.primaryCommandBlocks.clear(); this.stepping = false; }
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

  private slotProjection(actor: ActorId, model: SimulationPresentation | null): WeaponSlotProjection {
    const player = this.requirePlayer(actor), ui = this.primaryUi(actor), arsenal = this.arsenal(player), slot = this.weaponSlots.get(actor), grapple = this.grapple;
    const q3Pending = this.q3Arsenals.get(player.actor)?.requestedWeapon ?? null;
    const pendingItem = this.selectedArsenal !== null ? this.selectedArsenal.pendingWeapon(actor) : arsenal.state.kind === "q2" ? arsenal.state.pendingWeapon : q3Pending === null ? null : q3WeaponItem(q3Pending)?.item ?? null;
    const primary = { active: ui.activeWeapon === null ? null : { provider: this.weaponProvider.provider, item: ui.activeWeapon },
      pending: pendingItem === null ? null : { provider: this.weaponProvider.provider, item: pendingItem }, ui, model };
    if (slot === undefined || grapple === null) return primary;
    const gear = grapple.weaponView(actor), view = this.source.kind === "q2" && player.character === "q2" ? this.playerView(actor) : player.view(), weapon = grapple.weapon();
    const gearModel: SimulationPresentation | null = gear === null ? null : { actor, content: grapple.selection.source.content, family: grapple.source.kind === "q1-threewave" ? "q1" : "q2",
      path: gear.path, frame: gear.frame, oldFrame: gear.frame, skin: 0, effects: 0, renderFlags: 0,
      origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), gear.kickOrigin), angles: add(view.angles, { x: gear.kickPitch, y: 0, z: 0 }),
      scale: 1, visible: ui.health > 0 && !player.intermission && player.cutscene === null, viewWeapon: true };
    return projectWeaponSlot(slot.snapshot(), primary, { source: grapple.selection.source, weapon, item: { id: weapon.item, label: grapple.selection.mechanic === "q2-lmctf" ? "Hook" : "Grapple", kind: "weapon",
      sourceOrdinal: ui.items.length, owned: this.inventory.count(actor, weapon.item) > 0, hasAmmo: true, count: null, warningCount: 0 }, model: gearModel });
  }
  playerUi(actor: ActorId): PlayerUi { return this.slotProjection(actor, null).ui; }
  weaponSlot(actor: ActorId): WeaponSlotProjection {
    return this.slotProjection(actor, this.primaryPresentations().find(model => model.viewWeapon && sameActor(model.actor, actor)) ?? null);
  }

  private primaryUi(actor: ActorId): PlayerUi {
    const player = this.requirePlayer(actor), combat = this.combat.read(actor);
    if (combat === null) throw new Error("Player has no combat state");
    if (this.selectedArsenal !== null) return { health: combat.health, armor: combat.armor, inventory: this.inventory.entries(actor), ...this.selectedArsenal.ui(actor, this.weaponProvider) };
    const arsenal = this.arsenal(player), inventory = this.inventory.entries(actor), items: PlayerUiItem[] = [];
    let ammo: PlayerUi["ammo"] = null, weaponStatus: PlayerUi["weaponStatus"] = null;
    let arsenalWarning: PlayerUi["arsenalWarning"] = "none";
    if (this.source.kind === "q1") {
      for (const [sourceOrdinal, weapon] of [...Q1_WEAPONS, ...this.source.game.registeredWeapons.keys()].entries()) {
        const item = this.source.game.weaponAmmo(weapon), count = item === null ? null : this.inventory.count(actor, item);
        items.push({ id: this.source.game.weaponItem(weapon), label: weapon, kind: "weapon", sourceOrdinal,
          owned: this.inventory.count(actor, this.source.game.weaponItem(weapon)) > 0, hasAmmo: count === null || count >= (this.source.game.registeredWeapons.get(weapon)?.ammoPerShot ?? (weapon === "supernailgun" || weapon === "supershotgun" ? 2 : 1)), count, warningCount: 0 });
      }
      const state = this.source.game.player(actor), weapon = state?.weapon;
      if (state !== null) weaponStatus = q1WeaponStatus(this.source.game, state, this.weaponProvider);
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
      weaponStatus = q2WeaponStatus(weapon ?? null, item => this.inventory.count(actor, item), this.weaponProvider);
      if (weapon !== undefined && weapon.ammo !== null) ammo = { item: weapon.ammo, count: this.inventory.count(actor, weapon.ammo) };
    } else if (this.source.kind === "q3") {
      for (const definition of Q3_WEAPON_ITEMS) {
        const count = definition.ammo === null ? null : this.inventory.count(actor, definition.ammo);
        items.push({ id: definition.item, label: definition.item.slice("q3:weapon/".length), kind: "weapon", sourceOrdinal: definition.weapon,
          owned: this.inventory.count(actor, definition.item) > 0, hasAmmo: count === null || count > 0, count, warningCount: 0 });
      }
      const definition = arsenal.state.kind === "q3" ? q3WeaponItem(arsenal.state.sourceWeapon) : null;
      if (definition?.ammo != null) ammo = { item: definition.ammo, count: this.inventory.count(actor, definition.ammo) };
      const product = this.source.game.options.product;
      weaponStatus = q3WeaponStatus(arsenal.activeWeapon, product, item => this.inventory.count(actor, item), this.weaponProvider);
      arsenalWarning = q3ArsenalWarning(product, item => this.inventory.count(actor, item));
    }
    return { health: combat.health, armor: combat.armor, activeWeapon: arsenal.activeWeapon, ammo, inventory, items, weaponStatus, arsenalWarning };
  }

  playerView(actor: ActorId): PlayerView {
    const player = this.requirePlayer(actor), view = player.view(), source = this.q2Views.get(actor);
    if (player.cutscene !== null) return { origin: add(player.cutscene.origin, { ...player.cutscene.viewOffset, z: 0 }), angles: player.cutscene.angles, viewHeight: player.cutscene.viewOffset.z };
    const punch = this.q1WeaponSource()?.game.player(actor)?.punchAngles ?? zero;
    // Classic viewoffset includes eye height; rerelease sends it separately in pmove.viewheight.
    return player.character !== "q2" || source === undefined ? { ...view, kickAngles: punch }
      : { origin: add(view.origin, { x: source.offset.x, y: source.offset.y, z: 0 }), angles: add(source.angles, source.kickAngles), kickAngles: punch,
        viewHeight: source.offset.z + (this.source.kind === "q2" && this.source.product.rerelease !== null && !player.intermission ? view.viewHeight : 0) };
  }
  get sourceEntityText(): string { return this.options.world.entities; }

  q1WeaponSource(): { readonly game: Q1EntityServices } | null {
    if (this.selectedArsenal !== null) return this.selectedArsenal.family === "q1" && this.selectedWeaponSource?.kind === "q1" ? this.selectedWeaponSource : null;
    return this.source.kind === "q1" ? this.source : null;
  }
  private q2ItemWeaponSource(): { readonly game: Q2EntityServices; readonly weapons: Q2Weapons } | null {
    return this.q2WeaponSource() ?? (this.source.kind === "q2" ? this.source : null);
  }
  q2WeaponSource(): { readonly game: Q2EntityServices; readonly weapons: Q2Weapons } | null {
    if (this.selectedArsenal !== null) return this.selectedArsenal.family === "q2" && this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource : null;
    return this.source.kind === "q2" ? this.source : null;
  }
  selectedQ3WeaponSource(): Pick<Q3SelectedArsenal, "has" | "read"> | null {
    return this.selectedArsenal?.family === "q3" ? this.selectedArsenal : null;
  }
  private initializeServerSettings(cvars: CvarRegistry): void {
    if (this.options.serverProfile === undefined) return;
    const owner = cvarServerSettingsOwner(cvars, true);
    applyServerProfile(this.options.serverProfile, serverDefinitionsForRecipe(this.recipe).map(definition => ({ definition, owner })));
  }
  q2ServerCvars(): CvarRegistry | null { return this.q2ServerRegistry; }
  q2MovementConfig(): { readonly airAccelerate: number; readonly n64Physics: boolean } | null {
    if (this.source.kind !== "q2" || this.q2ServerRegistry === null) return null;
    const options = this.source.game.options, rerelease = options.edition === "rerelease";
    return { airAccelerate: rerelease ? this.q2ServerRegistry.find("sv_airaccelerate")?.integerValue ?? 0
      : options.mode === "deathmatch" ? this.q2ServerRegistry.variableValue("sv_airaccelerate") : 0,
      n64Physics: rerelease && options.mode !== "deathmatch" && options.mapName.startsWith("q64/") };
  }
  serverSettings(): readonly BoundServerSetting[] {
    const cvars = this.q2ServerRegistry ?? (this.source.kind === "q3" ? this.source.game.host.cvars : null);
    if (cvars === null) return [];
    const owner = cvarServerSettingsOwner(cvars);
    if (this.source.kind === "q3") {
      const settings = this.source.game.settings;
      return serverDefinitionsForRecipe(this.recipe).map(definition => ({ definition, owner: {
        write: owner.write,
        read: target => ({ ...owner.read(target), effective: target.kind === "value" ? settings.snapshot(target.name).value : owner.read(target).effective }),
      } satisfies ServerSettingsOwner }));
    }
    return serverDefinitionsForRecipe(this.recipe).map(definition => ({ definition, owner }));
  }
  serverProfile(): ServerProfile { return captureServerProfile(this.serverSettings()); }
  q2Source(): Extract<SourceRuntime, { readonly kind: "q2" }> | null { return this.source.kind === "q2" ? this.source : null; }
  quakecSource() { return this.source.kind === "quakec" ? this.source.game : null; }
  q1Source() { return this.source.kind === "q1" ? this.source : null; }
  q3Source(): Q3SourceRuntime | null { return this.source.kind === "q3" ? this.source.game : null; }
  movementPlayer(actor: ActorId): Readonly<MovementPlayer> | null { return this.player(actor); }
  weaponPresentationClock(): { readonly content: ContentId; readonly timeMilliseconds: number } | null {
    return this.selectedArsenal?.family !== "q3" ? null : { content: this.weaponProvider.content, timeMilliseconds: this.selectedMilliseconds };
  }
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
    if (this.source.kind === "quakec") {
      this.source.game.disconnectClient(player.actor);
      this.playerStates.delete(player.actor);
      return undefined;
    }
    this.grapple?.release(actor);
    this.stepHandGrenade(player, "removing");
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
  worldText(): readonly WorldText[] {
    if (this.worldTextFrame !== this.sourceFrame.frame) {
      this.worldTextFrame = this.sourceFrame.frame;
      this.worldTextSnapshot = this.worldTextStore.snapshot(this.timeSeconds, this.sourceFrame.frame);
    }
    return this.worldTextSnapshot;
  }

  drainPresentationEvents(): readonly SimulationPresentationEvent[] { return this.events.takePresentation(); }

  presentations(): readonly SimulationPresentation[] {
    const models = this.primaryPresentations();
    if (this.weaponSlots.size === 0) return models;
    const result = models.filter(model => !model.viewWeapon || !this.weaponSlots.has(model.actor));
    for (const actor of this.weaponSlots.keys()) { const projection = this.slotProjection(actor, models.find(model => model.viewWeapon && sameActor(model.actor, actor)) ?? null); if (projection.model !== null) result.push(projection.model); }
    return result;
  }
  private q1VisualFields(alpha: number, scale: number): { readonly alpha: number; readonly scale: number } {
    return { alpha: alpha === 0 ? 1 : Math.max(0, Math.min(1, Math.fround(alpha))), scale: scale === 0 ? 1 : Math.fround(scale) };
  }
  private primaryPresentations(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [];
    if (this.source.kind === "q3") result.push(...this.source.game.presentations());
    for (const entry of this.actorExecutions.values()) {
      if (entry.kind === "q3" || entry.kind === "quakec") continue;
      const body = this.bodies.read(entry.entity.actor.id);
      if (this.selectedMonsters?.active(entry.entity.actor.id) === false) continue;
      if (body === null || this.player(entry.entity.actor.id) !== null || entry.entity.model === "" && !(entry.kind === "q2" && entry.entity.flare !== null)) continue;
      if (entry.kind === "q1") {
        const entity = entry.entity, alpha = entity.number("alpha"), scale = entity.number("scale");
        if (entity.model === this.recipe.map.geometry.requestedPath) continue;
        result.push({ actor: entity.actor.id, content: entry.content, family: "q1", path: entity.model,
          frame: entity.frame, oldFrame: entity.frame, skin: entity.skin, effects: entity.effects, renderFlags: 0,
          origin: body.origin, angles: body.angles, ...this.q1VisualFields(alpha, scale), visible: true, viewWeapon: false });
      } else {
        const entity = entry.entity, model = this.sourceModels.get(entity.actor.id);
        if (entity.classname === "worldspawn") continue;
        result.push({ actor: entity.actor.id, content: entry.content, family: "q2", path: entity.model,
          ...(entity.flare === null ? {} : { flare: entity.flare }),
          frame: model?.frame ?? entity.frame, oldFrame: model?.oldFrame ?? entity.frame, skin: model?.skin ?? entity.skin, effects: model?.effects ?? entity.effects,
          renderFlags: model?.renderFlags ?? entity.renderFlags, alpha: model?.alpha ?? entity.alpha, origin: body.origin, angles: body.angles,
          previousOrigin: entry.services.options.edition === "rerelease" && (entity.renderFlags & 128) !== 0 ? entity.pos2 : body.origin,
          ...(entry.services.options.edition === "rerelease" && (entity.renderFlags & 128) !== 0 ? { modelBeam: { segmentLength: entity.frame } } : {}),
          scale: model?.scale ?? 1, visible: (entity.serverFlags & 1) === 0, viewWeapon: false });
      }
    }
    for (const player of this.playerStates.values()) {
      if (player.character === "q3" || player.intermission || player.cutscene !== null) continue;
      const body = this.bodies.read(player.actor.id); if (body === null) continue;
      const model = this.recipe.character.appearance.provider.split("/").at(-1) ?? "male";
      const q1Player = this.source.kind === "q1" ? this.source.game.player(player.actor.id) : null;
      const colors = player.character === "q1" && this.source.kind === "q1" ? this.source.composition.clients.get(player.actor.id) : null;
      const visual = q1Player === null ? { alpha: 1, scale: 1 } : this.q1VisualFields(q1Player.alpha, q1Player.scale);
      result.push({ actor: player.actor.id, content: this.recipe.character.appearance.content, family: player.character,
        path: this.q2Characters.get(player.actor)?.entity.model ?? (this.q1Characters.get(player.actor)?.presentation.model ?? (player.character === "q1" ? "progs/player.mdl" : `players/${model}/tris.md2`)), skinPath: player.character === "q2" ? `players/${model}/grunt.pcx` : null,
        frame: this.q2Characters.get(player.actor)?.entity.frame ?? (player.animation.state.kind === "q1" || player.animation.state.kind === "q2" ? player.animation.state.frame : 0), oldFrame: 0,
        skin: 0, effects: 0, renderFlags: 0, origin: body.origin, angles: body.angles, ...visual,
        ...(colors === null ? {} : { playerColors: { top: colors.shirt, bottom: colors.pants } }), visible: true, viewWeapon: false });
    }
    for (const [actor, model] of this.detachedModels) { const body = this.bodies.read(actor.id); if (body !== null) result.push({ actor: actor.id, content: model.content, family: "q2", path: model.path,
      frame: 0, oldFrame: 0, skin: 0, effects: 2, renderFlags: 0, origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false }); }
    const weaponModels = this.selectedArsenal === null ? this.viewModels : new Map(this.players().flatMap(actor => {
      const model = this.selectedArsenal?.view(actor); return model == null ? [] : [[actor, model] satisfies [ActorId, { readonly path: string; readonly frame: number }]];
    }));
    for (const [actor, model] of weaponModels) {
      const player = this.player(actor); if (player === null || player.intermission || player.cutscene !== null) continue;
      const q2 = providerFamily(this.weaponProvider.provider) === "q2" ? this.viewModels.get(actor)?.q2 : undefined;
      const nativeView = this.source.kind === "q2" && player.character === "q2" ? this.q2Views.get(actor) : undefined;
      const view = nativeView === undefined ? player.view() : this.playerView(actor), sourceView = q2 === undefined ? undefined : nativeView;
      const selected = this.selectedArsenal, arsenal = selected?.read(actor), body = this.bodies.read(actor);
      const q3Weapon = selected?.family !== "q3" || arsenal?.state.kind !== "q3" || body === null ? {} : { q3Weapon: {
        ...selected.viewState(actor), timeMilliseconds: this.selectedMilliseconds, weapon: arsenal.state.sourceWeapon,
        firing: (player.buttons & 1) !== 0 && (this.combat.read(actor)?.health ?? 0) > 0,
        horizontalSpeed: Math.hypot(body.velocity.x, body.velocity.y), bobCycle: player.state.kind === "q3" ? player.state.bobCycle : 0 } };
      result.push({ actor, ...q3Weapon, content: this.weaponProvider.content, family: providerFamily(this.weaponProvider.provider), path: model.path, frame: model.frame, oldFrame: model.frame,
        skin: q2?.skin ?? 0, effects: 0, renderFlags: providerFamily(this.weaponProvider.provider) === "q2" ? 1 | 4 | 16 : 0,
        origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), sourceView?.gunOffset ?? q2?.kickOrigin ?? zero), angles: add(view.angles, sourceView?.gunAngles ?? q2?.kickAngles ?? zero),
        scale: 1, visible: (this.combat.read(actor)?.health ?? 0) > 0, viewWeapon: true });
    }
    return result;
  }

  characterViews(): readonly Q3CharacterView[] {
    return [...this.characters].flatMap(([owner, character]): Q3CharacterView[] => {
      const player = this.playerStates.get(owner), body = this.bodies.read(owner.id), animation = character.animation.state;
      if (player === undefined || player.intermission || player.cutscene !== null || body === null || animation.kind !== "q3") return [];
      const q1Player = this.source.kind === "q1" ? this.source.game.player(owner.id) : null;
      const visual = q1Player === null ? { alpha: 1, scale: 1 } : this.q1VisualFields(q1Player.alpha, q1Player.scale);
      return [{ actor: owner.id, origin: body.origin, angles: player.viewAngles, velocity: body.velocity,
        movementDirection: player.state.kind === "q3" ? player.state.movementDirection : 0, animation, sourceFlags: character.sourceFlags,
        powerups: 0, team: null, scale: visual.scale, opacity: visual.alpha, color: { x: 1, y: 1, z: 1, w: 1 } }];
    });
  }

  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
    const player = this.requirePlayer(actor);
    if (this.weaponSlots.has(actor) && (name === "weapnext" || name === "weapprev" || name === "use")) {
      const ui = this.playerUi(actor), owned = ui.items.filter(item => item.kind === "weapon" && item.owned), requested = args.join("").toLowerCase().replaceAll(" ", "");
      const selected = name === "use" ? owned.find(item => item.id === requested || item.id === `q1:weapon/${requested}` || item.label.toLowerCase().replaceAll(" ", "") === requested)
        : owned[(owned.findIndex(item => item.id === ui.activeWeapon) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length];
      if (selected !== undefined) { const equipment = this.grapple?.weapon(); this.requestWeapon(actor, { provider: equipment?.item === selected.id ? equipment.provider : this.weaponProvider.provider, item: selected.id }); return undefined; }
      if (name !== "use") return undefined;
    }
    if (this.selectedArsenal !== null && (name === "weapnext" || name === "weapprev" || name === "use")) {
      const ui = this.selectedArsenal.ui(actor, this.weaponProvider), owned = ui.items.filter(item => item.kind === "weapon" && item.owned);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "use" ? owned.find(item => item.id === requested || item.id === `q1:weapon/${requested}` || item.label.toLowerCase().replaceAll(" ", "") === requested)
        : owned[(owned.findIndex(item => item.id === ui.activeWeapon) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length];
      if (weapon !== undefined) { this.selectedArsenal.select(actor, weapon.id); return undefined; }
      if (name !== "use") return undefined;
    }
    if (this.source.kind === "q3") { this.source.game.playerCommand(actor, name, args); return undefined; }
    if (this.source.kind === "q1") {
      const active = this.source.game.player(actor)?.weapon, owned = Q1_WEAPONS.filter(weapon => this.inventory.count(actor, `q1:weapon/${weapon}`) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : Q1_WEAPONS.find(value => value === requested || `q1:weapon/${value}` === requested);
      if (weapon !== undefined && this.selectedArsenal === null) this.source.game.selectWeapon(player.actor, weapon);
    } else if (this.source.kind === "q2") {
      const entity = this.source.game.entity(actor); if (entity === null) throw new Error("Q2 player entity missing");
      if (name !== "weapnext" && name !== "weapprev" && name !== "use") { this.source.players.clientCommand(entity, this.source.game, name, args); return undefined; }
      if (this.source.product.match.source instanceof Q2Lmctf && !this.source.product.match.source.canMove(actor)) return undefined;
      const source = this.source, active = source.weapons.states.get(actor)?.weapon, owned = source.weapons.registeredDefinitions().filter(weapon => this.inventory.count(actor, weapon.item) > 0);
      const requested = args.join("").toLowerCase().replaceAll(" ", "");
      const weapon = name === "weapnext" || name === "weapprev" ? owned[(owned.findIndex(value => value.name === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length] : source.weapons.registeredDefinitions().find(value => value.name === requested || value.item === requested);
      if (weapon !== undefined) { if (this.selectedArsenal === null) source.weapons.requestWeapon(entity, source.game, weapon.name); }
      else if (name === "use") { const item = this.inventory.entries(actor).find(value => value.item === requested || value.item === `q2:item_${requested}`); if (item !== undefined) source.items.use(player.actor, item.item, source.game); }
    }
    return undefined;
  }

  captureTravel(spawnPoint = ""): SimulationTravel {
    this.assertOpen();
    const source = this.source;
    if (source.kind === "quakec" && source.game.kind === "quakeworld") return { spawnPoint, source: source.game.captureTravel(), players: [] };
    if (source.kind === "loading" || source.kind === "quakec") throw new Error("Source campaign travel is not available");
    if (source.kind === "q3") throw new Error("Q3 map rotation uses match session state instead of campaign travel carry");
    for (const player of this.playerStates.values()) this.grapple?.release(player.actor.id);
    const landmark = this.levelChange?.landmark ?? null;
    const landmarkPlayer = landmark === null ? null : this.player(landmark.player);
    return { spawnPoint, source: source.kind === "q1" ? { kind: "q1", flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }
      : { kind: "q2", serverFlags: this.levelChange?.serverFlags ?? source.game.counters.serverFlags,
        ...(source.product.match.source instanceof Q2Lmctf ? { lmctf: source.product.match.source.captureTravel() } : {}),
        ...(source.product.rerelease === null ? {} : { rerelease: source.product.rerelease.entities.campaign }),
        landmark: landmark === null || landmarkPlayer === null ? null : { clientSlot: landmarkPlayer.client.slot, name: landmark.name,
          relativeOrigin: landmark.relativeOrigin, relativeVelocity: landmark.relativeVelocity, relativeViewAngles: landmark.relativeViewAngles } },
      players: [...this.playerStates.values()].map(player => {
        const handGrenades = this.q1Restart ? undefined : this.handGrenades?.travel(player.actor.id);
        const projection = this.weaponSlots.has(player.actor.id) && !this.q1Restart ? this.slotProjection(player.actor.id, null) : null;
        const target = projection?.pending ?? projection?.active;
        const equipment = { ...(handGrenades === undefined ? {} : { handGrenades }), ...(target == null ? {} : { weaponSlot: target }) };
        const selected: Pick<SimulationTravel["players"][number], "selectedArsenal"> = this.selectedArsenal === null || this.q1Restart ? {} : {
          selectedArsenal: this.selectedArsenal.family === "q1" ? { kind: "q1", state: this.selectedArsenal.captureTravel(player.actor.id) }
            : this.selectedArsenal.family === "q2" ? { kind: "q2", weapon: this.selectedArsenal.read(player.actor.id).activeWeapon, inventory: this.selectedArsenal.read(player.actor.id).ammo }
            : { kind: "q3", state: this.selectedArsenal.capture(player.actor.id), milliseconds: this.selectedMilliseconds } };
        if (source.kind === "q1") return { client: player.client, ...selected, ...equipment, state: { kind: "q1", carry: this.q1Restart ? source.composition.newTravel() : source.composition.captureTravel(player.actor) } };
        const entity = source.game.entity(player.actor.id); if (entity === null) throw new Error("Q2 travel player entity is missing");
        return { client: player.client, ...selected, ...equipment, state: { kind: "q2", carry: source.product.match.source instanceof Q2Lmctf ? { ...source.players.saveCarry(entity, source.game), score: 0 } : source.players.saveCarry(entity, source.game) } };
      }) };
  }
  admitTravel(client: ClientId, travel: SimulationTravel): PlayerAdmission { return this.admitPlayer(client, travel); }

  pendingMatchMap(): string | null { return this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf ? this.source.product.match.source.match.pendingMap?.map ?? null : null; }

  takeTransitions(): readonly TransitionIntent[] { return this.transitions.splice(0); }
  takeLevelChange() { const change = this.levelChange; this.levelChange = null; return change; }
  checkpoint(): SaveImage {
    this.assertOpen();
    if (this.stepping || this.transitions.length !== 0) throw new Error("Save requires a completed frame without pending world travel");
    const source = this.source;
    if (source.kind === "loading" || source.kind === "q3" || source.kind === "quakec") throw new Error("The selected source world does not yet expose a complete saved-game checkpoint");
    const provider = this.recipe.map.entities.provider;
    for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    const providers: SaveImage["providers"][number][] = [sourceActorsCheckpoint(this.actors.sourceCheckpoint())];
    const add = (schema: SaveImage["providers"][number]["schema"], bytes: Uint8Array) => providers.push({ provider, schema, version: schema === "world:simulation" ? 11 : 1, bytes });
    if (source.kind === "q1") add("q1:foundation", encodeQ1FoundationCheckpoint(source.game.capture()));
    else providers.push(...captureQ2Product(source.product));

    add("world:simulation", encodeCheckpointValue({ settings: { skill: this.options.skill, mode: this.options.mode, maxClients: this.options.maxClients, seed: this.options.seed },
      players: [...this.playerStates.values()].map(captureMovementPlayer), hostMilliseconds: this.hostMilliseconds,
      sourceSchedulingMilliseconds: this.sourceSchedulingMilliseconds,
      attackSequence: this.attackSequence, q1ClientVisibility: this.q1ClientVisibility.capture(),
      sourceCvars: source.kind === "q1" ? source.cvars.snapshots().map(value => ({ name: value.name, value: value.value })) : [],
      campaign: { flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }, physics: this.physics.capture(), events: this.events.capture(),
      portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })),
      selectedBallistics: this.selectedBallistics === null ? null : { milliseconds: this.selectedMilliseconds, randomSeed: this.selectedRandom.seed,
        weaponStatistics: this.selectedBallistics.checkpointWeaponStatistics().map(state => ({ ...state, actor: savedActorId(state.actor.id) })),
        projectiles: this.selectedBallistics.checkpoint() },
      handGrenades: this.handGrenades?.capture() ?? null, grapple: this.grapple?.capture() ?? null, weaponSlots: [...this.weaponSlots].map(([actor, slot]) => ({ actor: savedActorId(actor), state: slot.snapshot() })),
      selectedMonsters: this.captureSelectedMonsters(),
      selectedWeaponSource: this.selectedWeaponSource === null ? null : this.selectedWeaponSource.kind === "q1" ? {
        kind: "q1", entities: this.selectedWeaponSource.game.capture(), random: this.selectedWeaponSource.random.checkpoint() } : {
        kind: "q2", entities: this.selectedWeaponSource.game.capture(), weapons: this.selectedWeaponSource.weapons.capture(this.selectedWeaponSource.game),
        random: this.selectedWeaponSource.random.checkpoint(), frame: this.selectedWeaponSource.frame,
        mapMilliseconds: this.selectedWeaponSource.mapMilliseconds, nextMilliseconds: this.selectedWeaponSource.nextMilliseconds, intervalMilliseconds: this.selectedWeaponSource.intervalMilliseconds,
        turns: this.players().map(actor => {
          if (this.selectedArsenal?.family !== "q2") throw new Error("Selected Q2 source has no arsenal");
          return { actor: savedActorId(actor), state: this.selectedArsenal.captureTurn(actor) };
        }) },
      selectedArsenals: this.selectedArsenal?.family !== "q3" ? null : this.players().map(actor => ({ actor: savedActorId(actor), state: this.selectedArsenal?.family === "q3" ? this.selectedArsenal.capture(actor) : null })),
      q1Characters: [...this.q1Characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), bytes: character.capture() })),
      q2Characters: [...this.q2Characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), state: character.capture() })),
      q3Characters: [...this.characters].map(([actor, character]) => ({ actor: savedActorId(actor.id), state: character.capture() })),
      characterStarts: [...this.characterStarts].map(([actor, start]) => ({ actor: savedActorId(actor.id), start: start === null ? null : savedActorId(start) })),
      deathAnimations: this.deathAnimations.capture(),
      characterTicks: [...this.characterTicks].map(([actor, time]) => ({ actor: savedActorId(actor.id), time })),
      entryCarry: [...this.entryCarry].map(([actor, state]) => ({ actor: savedActorId(actor.id), state })),
      detachedModels: [...this.detachedModels].map(([actor, model]) => ({ actor: savedActorId(actor.id), ...model })),
      sourceModels: [...this.sourceModels.values()].map(model => ({ ...model, actor: savedActorId(model.actor) })),
      viewModels: [...this.viewModels].map(([actor, model]) => ({ actor: savedActorId(actor), ...model, q2: model.q2 ?? null })),
      q2Views: [...this.q2Views].map(([actor, view]) => ({ actor: savedActorId(actor), view })),
      levelChange: this.levelChange === null ? null : { ...this.levelChange, landmark: this.levelChange.landmark === null ? null
        : { ...this.levelChange.landmark, player: savedActorId(this.levelChange.landmark.player) } } }));
    const actors = this.actors.observations();
    return { schemaVersion: 2, recipe: this.recipe, frame: this.sourceFrame, nextEventSequence: this.events.nextSequence,
      clocks: [{ provider, time: this.sourceFrame.time }], random: [{ provider, state: this.random.checkpoint() }], actors: this.actors.checkpoint(),
      bodies: captureSharedBodies(this.actors, this.bodies),
      combat: actors.flatMap(actor => { const state = this.combat.read(actor.id); return state === null ? [] : [{ actor: savedActorId(actor.id), state }]; }),
      inventories: actors.flatMap(actor => this.inventory.has(actor.id) ? [{ actor: savedActorId(actor.id), entries: this.inventory.entries(actor.id) }] : []),
      configurations: this.players().map(actor => ({ actor: savedActorId(actor), movement: this.recipe.movement, character: this.recipe.character, weapons: this.recipe.weapons, inventory: this.recipe.inventory })),
      thinks: actors.flatMap(actor => { const pending = this.scheduler.pending(actor.id); return pending === null ? [] : [{ actor: savedActorId(actor.id), callback: pending.callback,
        ...(pending.timing.executionProvider === undefined ? {} : { executionProvider: pending.timing.executionProvider }),
        due: pending.timing.due, boundary: pending.timing.boundary, provider: pending.timing.order.provider, sequence: pending.timing.order.sequence }]; }), providers, guests: [] };
  }

  private restore(save: SaveImage): undefined {
    const source = this.source;
    if (source.kind === "q3" || source.kind === "loading" || source.kind === "quakec") throw new Error("The selected source world does not expose a complete saved-game restore");
    const reader = simulationSaveReader(save), reference = (value: SaveReader) => this.actors.referenceSaved(readSavedActor(value));
    const owner = (value: SaveReader): OwnedActor => { const actor = this.actors.resolveSaved(readSavedActor(value)); if (actor === null) return value.fail("Missing restored actor"); return actor; };
    const random = save.random.find(value => value.provider === this.recipe.map.entities.provider)?.state;
    if (random?.kind !== "glibc-random" && random?.kind !== "q2-rerelease-mt19937") throw new Error("Save has no matching source random stream");
    this.random.restore(random);
    this.hostMilliseconds = reader.field("hostMilliseconds").finite();
    const scheduling = reader.field("sourceSchedulingMilliseconds");
    this.sourceSchedulingMilliseconds = scheduling.value === undefined ? this.hostMilliseconds : scheduling.finite();
    this.attackSequence = reader.field("attackSequence").integer(0);
    this.q1ClientVisibility.restore(reader.field("q1ClientVisibility").value);
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
    const selectedBallistics = reader.field("selectedBallistics");
    if (this.selectedBallistics !== null) {
      this.selectedMilliseconds = selectedBallistics.field("milliseconds").finite();
      this.selectedRandom.reset(selectedBallistics.field("randomSeed").integer());
      this.selectedBallistics.restore(readQ3ProjectileStates(selectedBallistics.field("projectiles"), owner, saved => this.actors.referenceSaved(saved)));
      this.selectedBallistics.restoreWeaponStatistics(readQ3WeaponStatistics(selectedBallistics.field("weaponStatistics"), owner));
    } else if (selectedBallistics.value !== undefined && selectedBallistics.value !== null) selectedBallistics.fail("Saved selected ballistics has no matching authority");
    const selectedSource = reader.field("selectedWeaponSource"), weaponSource = this.selectedWeaponSource;
    if (weaponSource !== null) {
      selectedSource.field("kind").literal(weaponSource.kind);
      const random = readRandom(selectedSource.field("random"));
      if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") selectedSource.field("random").fail("Selected source requires its native random stream");
      else weaponSource.random.restore(random);
      if (weaponSource.kind === "q1") weaponSource.game.restore(readQ1FoundationCheckpoint(selectedSource.field("entities")), { scheduleThinks: false });
      else {
        const savedFrame = selectedSource.field("frame"), time = savedFrame.field("time"), elapsed = savedFrame.field("elapsed");
        const timeKind = time.field("kind").literal(weaponSource.frame.time.kind);
        weaponSource.frame = { frame: savedFrame.field("frame").integer(0), time: { kind: timeKind, value: time.field("value").finite() },
          elapsed: { kind: elapsed.field("kind").literal(weaponSource.frame.elapsed.kind), value: elapsed.field("value").finite() },
          phase: savedFrame.field("phase").choice("frame-entry", "client-command", "entity-think", "frame-exit") };
        selectedSource.field("intervalMilliseconds").literal(weaponSource.intervalMilliseconds);
        weaponSource.mapMilliseconds = selectedSource.field("mapMilliseconds").finite();
        weaponSource.nextMilliseconds = selectedSource.field("nextMilliseconds").finite();
        if (weaponSource.mapMilliseconds < 0 || weaponSource.nextMilliseconds <= weaponSource.mapMilliseconds
          || weaponSource.nextMilliseconds - weaponSource.mapMilliseconds > weaponSource.intervalMilliseconds) selectedSource.fail("Selected Q2 source deadline must follow admitted map progress");
        weaponSource.game.restore(readQ2FoundationCheckpoint(selectedSource.field("entities")));
        weaponSource.weapons.restore(weaponSource.game, readQ2WeaponsCheckpoint(selectedSource.field("weapons")));
        if (this.selectedArsenal?.family !== "q2") selectedSource.fail("Selected Q2 source has no arsenal");
        else {
          const arsenal = this.selectedArsenal;
          selectedSource.field("turns").list(value => {
            const state = value.field("state");
            arsenal.restoreTurn(owner(value.field("actor")).id, { buttons: state.field("buttons").integer(), latchedButtons: state.field("latchedButtons").integer(), weaponThunk: state.field("weaponThunk").boolean() });
          });
        }
      }
      for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    } else if (selectedSource.value !== null) selectedSource.fail("Saved selected weapon source has no matching authority");
    const selected = reader.field("selectedArsenals");
    if (this.selectedArsenal?.family === "q3") {
      const arsenal = this.selectedArsenal;
      selected.list(value => { arsenal.restore(owner(value.field("actor")), readQ3SelectedArsenalCheckpoint(value.field("state"))); });
      for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    } else if (selected.value !== undefined && selected.value !== null) selected.fail("Saved selected arsenal has no matching authority");
    const bytes = (schema: SaveImage["providers"][number]["schema"]) => simulationProviderCheckpoint(save, schema).bytes;
    if (source.kind === "q1") reader.field("sourceCvars").list(value => { source.cvars.set(value.field("name").string(), value.field("value").string(), true); return undefined; });
    if (source.kind === "q1") source.game.restore(decodeQ1FoundationCheckpoint(bytes("q1:foundation")), { scheduleThinks: false });
    else restoreQ2Product(source.product, save.providers);
    const monsters = reader.field("selectedMonsters");
    if (this.selectedMonsters !== null) this.restoreSelectedMonsters(readSelectedMonstersCheckpoint(monsters));
    else if (monsters.value !== null) monsters.fail("Saved selected monsters have no matching admission");
    const grapple = reader.field("grapple");
    if (this.grapple !== null) this.grapple.restore(readGrappleRuntimeCheckpoint(grapple));
    else if (grapple.value !== undefined && grapple.value !== null) grapple.fail("Saved grapple has no selected controller");
    this.weaponSlots.clear();
    for (const saved of readWeaponSlots(reader.field("weaponSlots"))) { const actor = this.actors.resolveSaved(saved.actor); if (actor === null) throw new Error("Saved slot actor is missing"); this.bindWeaponSlot(actor.id, saved.state); }
    const equipment = reader.field("handGrenades");
    if (this.handGrenades !== null) this.handGrenades.restore(readHandGrenadeRuntimeCheckpoint(equipment));
    else if (equipment.value !== undefined && equipment.value !== null) equipment.fail("Saved equipment has no selected controller");

    reader.field("q1Characters").list(value => {
      if (source.kind !== "q1") return value.fail("Q1 character needs its saved source foundation");
      const actor = owner(value.field("actor")), player = this.requirePlayer(actor.id);
      const character = new Q1CharacterActor(source.game, actor, { requestRespawn: () => this.respawnPlayer(player), dropInventory: () => this.dropPlayerInventory(player), sourcePose: () => this.q1CharacterPose(actor.id), fallDamageAllowed: () => source.composition.fallDamageAllowed(actor.id) });
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
    reader.field("viewModels").list(value => {
      const q2 = value.field("q2").nullable(view => ({ skin: view.field("skin").integer(), rate: view.field("rate").finite(),
        kickOrigin: readVector(view.field("kickOrigin")), kickAngles: readVector(view.field("kickAngles")) }));
      this.viewModels.set(reference(value.field("actor")), { path: value.field("path").string(), frame: value.field("frame").number(), ...(q2 === null ? {} : { q2 }) });
    });
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
      this.scheduler.schedule(actor, think.callback, { due: think.due, boundary: think.boundary,
        ...(think.executionProvider === undefined ? {} : { executionProvider: think.executionProvider }),
        order: { actor: actor.id, provider: think.provider, sequence: think.sequence } });
    }
    this.events.restore(reader.field("events"), actor => this.actors.referenceSaved(actor));
    this.resumeQ2Presentation();
    if (this.events.nextSequence !== save.nextEventSequence) throw new Error("Save event sequence disagrees with its source journal");
    return undefined;
  }
  close(): undefined { if (this.closed) return undefined; this.closed = true; this.worldTextStore.clear(); this.worldTextSnapshot = []; this.actors.close(); this.scheduler.close(); return undefined; }
  private assertOpen(): undefined { if (this.closed) throw new Error("Simulation is closed"); return undefined; }
}

export function createSimulation(options: SimulationOptions): SharedSimulation { return new SharedSimulation(options); }
import { readSelectedMonstersCheckpoint } from "./monster-checkpoint.ts";
import type { SelectedMonstersCheckpoint } from "./monster-checkpoint.ts";
