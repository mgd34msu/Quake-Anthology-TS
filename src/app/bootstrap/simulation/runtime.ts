import { Q3MappedAmmoRegeneration } from "./arsenal/q3-ammo-regen.ts";
import { readLegacyQ3Source, migrateLegacyQ3Arsenal } from "./arsenal/q3-source-legacy.ts";
import { itemAt } from "../../../content/q3/base/shared/items.ts";
import { q3WeaponDelay } from "../../../movement/q3/weapon.ts";
import { q3WeaponDamageFactor } from "../../../content/q3/base/game/weapon.ts";
import { clientSpeedMultiplier } from "../../../content/q3/team-arena/client-effects.ts";
import { returnQ3PersistentPowerup } from "../../../content/q3/base/game/death.ts";
import { setInfoValue } from "../../../core/cvars/info.ts";
import { Q2Ctf } from "../../../content/q2/multiplayer/ctf/index.ts";
import { Q3SelectedSource, type Q3SelectedClientEffects } from "./arsenal/q3-source.ts";
import type { CombatPolicy } from "../../../contracts/gameplay.ts";
import { ConfigStringRegistry } from "../../../content/q3/base/game/utilities.ts";
import { Team, GameType, statSchema } from "../../../content/q3/base/shared/definitions.ts";
import { dropQ3TeleportObjectives } from "../../../content/q3/team-arena/client-events.ts";
import { dropFlag as dropQ1CtfFlag } from "../../../content/q1/addons/ctf/flags.ts";
import { rereleasePathToGoal } from "../../../bots/navigation/rerelease-path.ts";
import { QvmWeaponBehaviorSource, type QvmWeaponTarget } from "./qvm-weapon-behavior.ts";
import type { ApplicationBotNavigation } from "./navigation.ts";
import type { RereleaseNavigationServices } from "../../../compat/q2/rerelease/navigation.ts";
import type { PreparedWeaponBehavior } from "../weapon-behavior-selection.ts";
import { RereleaseWeaponBehaviorSource } from "./rerelease-weapon-behavior.ts";
import { nativeProviderTiming } from "../../../content/catalog/timing.ts";
import { loadServerLocalizationResources } from "../../../text/localization-resources.ts";
import { q2LocalizedText } from "../q2-localization.ts";
import type { WeaponBehaviorRuntimeCheckpoint } from "./weapon-behavior-runtime.ts";
import { quakeCFreeMovement } from "./quakec-client-adapter.ts";
import { quakeWorldCommandSlices } from "../../../movement/q1/quakeworld.ts";
import { prepareNativeQ2Map } from "./native-q2-map.ts";
import { q3GuestPlayerUi } from "./q3/guest-player.ts";
import { quakeCCharacterAnimation } from "./quakec-character-animation.ts";
import { advanceQ2PlayerAnimation } from "../../../content/q2/base/player/view.ts";
import { donorAngleVectors } from "../../../core/math.ts";
import { publishQ3CharacterMovementEvent } from "./player-jump.ts";
import { EntityEvent as MovementEntityEvent } from "../../../movement/q3/constants.ts";
import { selectedSourceProgram } from "../../../content/catalog/source-program.ts";
import type { Q2NativeWorld } from "./q2-native-world.ts";
import { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import type { RereleaseGuestServicesOptions } from "./rerelease-guest-services-contract.ts";
import { SimulationWeaponBehaviors } from "./weapon-behavior-runtime.ts";
import { encodeQ2RereleaseNativeSave, type Q2RereleaseVisitedLevel } from "./native-q2-rerelease-save.ts";
import { rereleaseGuestLocalCommand, rereleaseGuestPlayerView, rereleaseGuestPlayerUi } from "./rerelease-guest-player.ts";
import type { NativeQ2Travel } from "./native-q2-travel.ts";
import type { Q2ClassicVisitedLevel } from "../../../persistence/q2-classic-guest.ts";
import type { ClassicGuestServicesOptions } from "./classic-guest-services.ts";
import { q2GameCallback } from "../network/types.ts";
import { ClassicOriginalSaveFiles, encodeQ2ClassicOriginalSave } from "../../../persistence/q2-classic-guest.ts";
import { ClassicGuestWorld } from "./classic-guest-world.ts";
import { classicGuestLocalCommand, classicGuestPlayerView, classicGuestPlayerUi } from "./classic-guest-player.ts";
import { CollisionMapSettings } from "../../../world/collision/q3/settings.ts";
import { WorldDebugLineStore } from "../../../debug/world.ts";
import { sourceLevelTransition } from "./source-transition.ts";
import type { SourceLevelAuthority } from "./source-transition.ts";
import type { DebugLine } from "../../../debug/shapes.ts";
import { fromQ3UserCommand } from "../../../network/q3/adapters.ts";
import { assertQ3GuestRecipe } from "./q3/guest-artifact.ts";
import { Q3QvmServerGame } from "./q3/guest-runtime.ts";
import { q3InputProfile } from "../../../content/q3/input-profile.ts";
import { Q3ServerState } from "./q3/server-state.ts";
import { createSelectedQ2MonsterModules } from "./q2-monster-sources.ts";
import { WorldTextStore } from "../../../text/world.ts";
import type { WorldText } from "../../../text/world.ts";
import { applyServerProfile, bindQ2ServerCvars, captureServerProfile, cvarServerSettingsOwner, registerQ2ServerCvars, restoreQ2ServerCvars, serverDefinitionsForRecipe } from "../../../settings/server/index.ts";
import { q2SourceDeathmatchFlags, q2RereleaseItemServices } from "../../../settings/server/q2-owner.ts";
import type { BoundServerSetting, ServerProfile, ServerSettingsOwner } from "../../../settings/server/index.ts";
import { q3GameCvarDefinitions } from "../../../content/q3/base/settings.ts";
import { giveQ1 } from "../../../content/composition/q1/give.ts";
import { q2CheatsAllowed } from "../../../content/q2/base/player/commands.ts";
import type { NetQuakeClientBinding } from "./players.ts";
import { QuakeCSource } from "./quakec-source.ts";
import type { QwUserCommand, UserCommand } from "../../../contracts/protocol.ts";
import { id1DamageMultiplier } from "../../../content/q1/quakec/id1-program.ts";
import { createNativeQ1PusherServices } from "./native-q1-pusher.ts";
import { q1WeaponStatus, q2WeaponStatus, q3WeaponStatus, q3ArsenalWarning } from "./arsenal/weapon-status.ts";
import { Q1ClientVisibility } from "../../../world/gameplay/q1-client-visibility.ts";
import type { Q1ClientEye } from "../../../world/gameplay/q1-client-visibility.ts";
import { selectedMonsterDefinitions } from "../../../content/catalog/monsters.ts";
import type { VictimArmorContext } from "../../../world/gameplay/armor.ts";
import { WeaponSlot } from "./weapon-slot.ts";
import type { PrimaryWeaponHandoff, WeaponReference, WeaponSlotRestoreState } from "./weapon-slot.ts";
import { projectWeaponSlot } from "./weapon-slot-projection.ts";
import type { SourceWeaponProjection, WeaponSlotProjection } from "./weapon-slot-projection.ts";
import { readWeaponSlots } from "./weapon-slot-checkpoint.ts";
import { GrappleRuntime } from "./grapple-runtime.ts";
import { QvmGrappleSource, type QvmGrappleTarget } from "./qvm-grapple-source.ts";
import { QvmGameCombat } from "../../../compat/qvm/game-combat.ts";
import { QvmCombatBindings } from "../../../compat/qvm/game-combat-binding.ts";
import { QvmPrimaryPickups } from "../../../compat/qvm/game-pickups.ts";
import { qvmInventoryBinding, type QvmInventoryProfile } from "../../../compat/qvm/game-inventory.ts";
import { q3NativeInventoryProfile } from "../../../content/q3/equipment/inventory-profile.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import { classicCombatProfile } from "../../../compat/q2/classic/combat-profile.ts";
import { q3NativeCombatProfile } from "../../../content/q3/equipment/combat-profile.ts";
import { q3NativePickupProfile } from "../../../content/q3/equipment/pickup-profile.ts";
import { retailRereleaseClientProfile } from "../../../compat/q2/rerelease/client-profile.ts";
import { q3GrappleProfile } from "../../../content/q3/equipment/grapple-profiles.ts";
import { SelectedMonsters } from "./monster-runtime.ts";
import { isQ1TeleportStaging, nearbyMonsterPlacement, preservesAuthoredQ1Placement, preservesAuthoredQ2Placement } from "./monster-placement.ts";
import { parseVector } from "../../../content/q1/foundation/entity.ts";
import { numberField, parseQ2Entities } from "../../../content/q2/foundation/fields.ts";
import type { SelectedMonsterSource } from "./monster-runtime.ts";
import { monsterSource } from "../../../content/monsters/definitions.ts";
import type { MonsterMission } from "../../../content/monsters/authored.ts";
import { setMonsterRoute } from "../../../content/q1/foundation/monsters.ts";
import type { GrappleSlotHost } from "./grapple-runtime.ts";
import { q2AttackFrames, q2ReverseFrames, q2WeaponAnimationRate, q2PowerupSound, q2WeaponRecoil } from "../../../content/q2/foundation/weapons/presentation.ts";
import { readGrappleRuntimeCheckpoint } from "./grapple-checkpoint.ts";
import type { SharedGrappleControl } from "../../../contracts/equipment.ts";
import { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import { Q1Creatures, q1Creatures } from "../../../content/q1/base/creatures.ts";
import { baseSpecies } from "../../../content/q1/base/species.ts";
import { registerSelectedQ1Expansion } from "./monster-sources.ts";
import { Q1PlayerPunch, type Q1PunchOwner } from "./q1-punch.ts";
import type { Q1AddonEvent } from "../../../content/q1/addons/context.ts";
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
import { registerSelectedQ1MissionWeapons } from "../../../content/composition/q1-expansion-arsenal.ts";
import { registerSelectedQ2MissionWeapons } from "../../../content/composition/q2-expansion-arsenal.ts";
import { expansionSupply } from "../../../content/composition/expansion-supply.ts";
import { expansionSourceSupply } from "../../../content/composition/expansion-source-supply.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../content/composition/q2-q3-supply.ts";
import { SharedPickupAdmission } from "../../../world/gameplay/pickups.ts";
import { SharedOriginalPickupAdmission } from "../../../world/gameplay/original-pickups.ts";
import { Q1_Q3_SUPPLY_PROFILE, q1Q3SupplyLoadout } from "../../../content/composition/q1-q3-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE, q1Q2PickupSelect, q1Q2SupplyLoadout } from "../../../content/composition/q1-q2-supply.ts";
import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import { emitQ2ShadowLights } from "../../../content/q2/foundation/shadow-lights.ts";
import { SimulationBotServices } from "./bots.ts";
import { readQ1FoundationCheckpoint } from "../../../persistence/q1-foundation.ts";
import { Q1SelectedArsenal } from "./arsenal/q1.ts";
import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readQ2WeaponsCheckpoint } from "../../../persistence/q2-weapons.ts";
import { Q2SelectedArsenal, projectQ2Arsenal } from "./arsenal/q2.ts";
import { Q3_Q2_SUPPLY_PROFILE, q3Q2SupplyLoadout } from "../../../content/composition/q3-q2-supply.ts";
import { Q3SelectedArsenal, readQ3SelectedArsenalCheckpoint } from "./arsenal/q3.ts";
import { playerMovementEnvironment, playerPostures } from "./player-movement.ts";
import { resolveQ3ArsenalControls } from "./arsenal-intent.ts";
import { isDeepStrictEqual } from "node:util";
import type { ContentId, ExecutableRecipe, MonsterDefinitionReference, ProviderReference, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { PickupSupplyProfile, PickupSupplyOffer } from "../../../contracts/pickups.ts";
import type { AttackProvenance, DamageRequest, InventoryEntry, ItemId, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ActorId, ClientId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { ArsenalIntent } from "../../../contracts/gameplay.ts";
import type { AnimationStepInput, AnimationStepResult, ArsenalState, MovementContinuation, MovementState, MovementTouchContact, WeaponStepInput, WeaponStepResult } from "../../../contracts/movement.ts";
import type { ActorCommand, InputBatch, SaveImage, Simulation, SimulationOutput, WorldSnapshot } from "../../../contracts/session.ts";
import type { ModSessionCheckpoint, ModTravelCheckpoint } from "../../../contracts/mods.ts";
import { SessionMods } from "../../../world/session/mods.ts";
import type { ModClientCommand, ModClientEvent, ModClientServices } from "../../../world/session/mod-clients.ts";
import { ModClientApplications } from "../../../world/session/mod-client-applications.ts";
import { captureModClientCommand, readModClientCommands } from "./mod-client-checkpoint.ts";
import type { NativeModHostContext } from "./native-mod-host.ts";
import type { FrameContext, SourceTime } from "../../../contracts/time.ts";
import { CvarRegistry } from "../../../core/cvars/index.ts";
import { createQ1SourceComposition } from "../../../content/composition/q1/index.ts";
import { sourceQ2MatchSelection } from "../../../content/composition/q2/match-selection.ts";
import { adaptForeignQ3Objectives } from "../../../content/q3/team-arena/foreign-objectives.ts";
import type { Q1SourceComposition, Q1CompositionServices } from "../../../content/composition/q1/index.ts";
import { createNumericOperations, Q1_DONOR_PROFILE } from "../../../core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, createQ2CombatPolicy, nativeVictimArmor } from "../../../world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../world/collision/index.ts";
import { FrameScheduler } from "../../../world/scheduler.ts";
import { SourceClock } from "../../../world/session/index.ts";
import { Q1Foundation } from "../../../content/q1/foundation/runtime.ts";
import { WEAPONS as Q1_WEAPONS, isQ1BaseWeapon, q1WeaponBit } from "../../../content/q1/foundation/types.ts";
import { Q1CampaignState, Q1CharacterActor } from "../../../content/q1/base/index.ts";
import { registerCharacterCallbacks } from "../../../content/q1/base/player.ts";
import { registerMapCallbacks } from "../../../content/q1/base/map-entities.ts";
import type { Q1TravelState } from "../../../content/q1/base/index.ts";
import { q2Userinfo, Q2CharacterActor } from "../../../content/q2/base/player/index.ts";
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
import { q3SourceCommand, relativeQ3SourceCommand, relativeMovementCommand, selectedQ3Command } from "./q3-commands.ts";
import { q3SourceAnimation, q3SourceTorso, runQ3TorsoOperation } from "../../../movement/q3/animation.ts";
import { createQ1MonsterMovement } from "../../../movement/q1/index.ts";
import type { Q1MonsterMovement } from "../../../movement/q1/monsters.ts";
import { SharedPhysics } from "./physics.ts";
import type { SharedSolid } from "./physics.ts";
import { MovementPlayer, movementOrigin, providerFamily, providerTiming } from "./players.ts";
import { SimulationEvents } from "./events.ts";
import { SourceRandom } from "./random.ts";
import { captureSourceItems, prepareSourceItemRestore } from "../../../persistence/source-items.ts";
import { qcWeaponStage } from "../../../content/q1/quakec/weapon-stage.ts";
import { capturePrimaryProtection } from "../../../persistence/protection.ts";
import { captureSharedBodies, restoreSharedBodyLinks, restoreSharedWorldState, sourceActorsCheckpoint, readSourceActorsCheckpoint,
  savedActorId, readSavedActor, encodeCheckpointValue, decodeCheckpointValue, SaveReader, encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint,
  readQ2CharacterCheckpoint } from "../../../persistence/index.ts";
import { readContentId } from "../../../persistence/recipe.ts";
import type { SharedWorldRestoreCompletion } from "../../../persistence/world-state.ts";
import { readRandom, readVector } from "../../../persistence/shared.ts";
import { captureMovementPlayer, readMovementPlayer, readQ1Travel, readQ2View, readQ3Character } from "./player-checkpoint.ts";
import { simulationProviderCheckpoint, simulationSaveReader, savedSimulationSettings, simulationQuakeCCheckpoint, simulationQvmCheckpoint, validateSimulationSave, nativeQ3RuntimeReader, savedSourceCvars, nativeQ2RereleaseSave, nativeQ2OriginalSave, nativeQ2SavedClients } from "./save.ts";
import { saveQ2Attack, restoreQ2Attack } from "../../../content/q2/foundation/checkpoint.ts";
import type { PlayerAdmission, PlayerView, PlayerUi, PlayerUiItem, SimulationTravel, SimulationOptions, SimulationPresentation, SimulationPresentationEvent } from "./types.ts";
import { q1PowerupTimers, q2PowerupTimers, q3PowerupTimers } from "./powerup-timers.ts";

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
  | { readonly kind: "q3-qvm"; readonly game: Q3QvmServerGame; readonly combat: QvmCombatBindings | null; readonly inventory: QvmInventoryProfile | null }
  | { readonly kind: "q2-native"; readonly edition: "classic"; readonly game: ClassicGuestWorld; readonly files: ClassicOriginalSaveFiles; readonly visited: Map<string, Q2ClassicVisitedLevel>; readonly clients: Map<ClientId, OwnedActor> }
  | { readonly kind: "q2-native"; readonly edition: "rerelease"; readonly game: RereleaseGuestWorld; readonly visited: Map<string, Q2RereleaseVisitedLevel>; readonly clients: Map<ClientId, OwnedActor> }
  | ({ readonly kind: "q2"; readonly product: Q2ProductRuntime } & Pick<Q2ProductRuntime, "game" | "weapons" | "monsters" | "movers" | "items" | "players" | "baseEntities">);

type SelectedWeaponSource = { readonly kind: "q1"; readonly game: Q1EntityServices; readonly random: SourceRandom; readonly missionWeapons: ReturnType<typeof registerSelectedQ1MissionWeapons> }
  | { readonly kind: "q2"; readonly game: Q2EntityServices; readonly weapons: Q2Weapons; readonly random: SourceRandom;
    frame: FrameContext; mapMilliseconds: number; nextMilliseconds: number; readonly intervalMilliseconds: number };

/** One actor registry and source-ordered frame traversal, including foreign character and movement providers. */
const nativeLoading = Symbol("native loading");

export class SharedSimulation implements Simulation {
  readonly session;
  readonly recipe: ExecutableRecipe;
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly scene: SharedSceneQueries;
  readonly physics: SharedPhysics;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly originalPickups: SharedOriginalPickupAdmission;
  readonly scheduler: FrameScheduler;
  readonly random: SourceRandom;
  readonly botServices = new SimulationBotServices();
  readonly clock: SourceClock;
  readonly events: SimulationEvents;
  private readonly actorExecutions = new Map<ActorId, ActorExecution>();
  private readonly playerStates = new Map<OwnedActor, MovementPlayer>();
  private readonly q1Punch: Q1PlayerPunch;
  private readonly q2Characters = new Map<OwnedActor, Q2CharacterActor>();
  private readonly characterTicks = new Map<OwnedActor, number>();
  private readonly entryCarry = new Map<OwnedActor, Q1TravelState>();
  private readonly startItems: string;
  private readonly initialSpawnPoint: string;
  private readonly pendingStartItems = new Set<ActorId>();
  private pendingSharedRestore: SharedWorldRestoreCompletion | null = null;
  private readonly detachedModels = new Map<OwnedActor, { readonly content: ContentId; readonly path: string }>();
  private readonly q1Characters = new Map<OwnedActor, Q1CharacterActor>();
  private q1CharacterFoundation: Q1EntityServices | null = null;
  private readonly q1CharacterAdjuncts = new Set<Q1EntityServices>();
  private readonly q2Views = new Map<ActorId, Q2PlayerView>();
  private readonly q1Campaign: Q1CampaignState;
  private readonly characters = new Map<OwnedActor, Q3CharacterActor>();
  private readonly characterStarts = new Map<OwnedActor, ActorId | null>();
  private grapple: GrappleRuntime | null = null;
  private pendingQvmGrappleRestore: { readonly grapple: ReturnType<typeof readGrappleRuntimeCheckpoint>; readonly slots: ReturnType<typeof readWeaponSlots> } | null = null;
  private readonly sourceItemsRestore: ReturnType<typeof prepareSourceItemRestore> | null;
  private readonly weaponSlots = new Map<ActorId, WeaponSlot>();
  private readonly nativeEquipmentPlayers = new Set<ActorId>();
  private readonly nativeEquipmentAlive = new Map<ActorId, boolean>();
  private readonly nativeWeaponRequests = new Map<ActorId, number>();
  private readonly nativeEquipmentVelocity = new Map<ActorId, Vec3>();
  private grappleFrame: FrameContext;
  private handGrenades: HandGrenadeRuntime | null = null;
  private equipmentFrame: FrameContext;
  private selectedQ3Source: Q3SelectedSource | null = null;
  private selectedAmmoTimers: Q3MappedAmmoRegeneration | null = null;
  private selectedQ3Time = 0;
  private selectedQ3Next = 0;
  private readonly selectedQ3Strings = new Map<number, string>();
  private readonly weaponBehavior: SimulationWeaponBehaviors;
  private nativeNavigation: ApplicationBotNavigation | null = null;
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
  private readonly debugLineStore = new WorldDebugLineStore();
  private debugLineFrame = -1;
  private debugLineSnapshot: readonly DebugLine[] = [];
  private readonly worldTextStore = new WorldTextStore();
  private worldTextFrame = -1;
  private worldTextSnapshot: readonly WorldText[] = [];
  private source: SourceRuntime = { kind: "loading" };
  private pendingNativeTravel: ((nextFrame: () => Promise<void>) => Promise<Extract<SourceRuntime, { readonly kind: "q2-native" }>>) | null = null;
  private disposeSourceCombat: (() => undefined) | null = null;
  private sourceFrame: FrameContext;
  private hostMilliseconds = 0;
  private q1PauseState = false;
  private sourceSchedulingMilliseconds = 0;
  private closed = false;
  private modOwner: SessionMods | null = null;
  modPresentationSources() { return this.modOwner?.presentationSources() ?? []; }
  private readonly modClientListeners = new Set<(event: ModClientEvent) => undefined>();
  private readonly modClientAdmissions = new Set<ActorId>();
  private readonly modClientCommands = new Map<ActorId, ModClientCommand>();
  private readonly modClientApplications = new ModClientApplications(identity => this.actors.isLive(identity.actor)
    && this.options.identity.owns(identity.client) && this.playerClient(identity.actor)?.equals(identity.client) === true);
  private readonly modClientDrops: { readonly client: ClientId; readonly actor: ActorId; readonly reason: string; readonly content: ContentId }[] = [];
  readonly modClients: ModClientServices;
  private createModClients(): ModClientServices { return {
    maximum: this.options.maxClients,
    clients: () => this.players().flatMap(actor => { const client = this.playerClient(actor); return client === null || this.bodies.read(actor) === null ? [] : [{ client, actor }]; }),
    forActor: actor => this.actors.isLive(actor) ? this.playerClient(actor) : null,
    actor: client => this.options.identity.owns(client) ? this.players().find(actor => this.actors.isLive(actor) && this.playerClient(actor)?.equals(client)) ?? null : null,
    userinfo: client => this.sourcePlayerUserinfo(this.requireModClient(client)) ?? "",
    setUserinfo: (client, value) => this.storePlayerUserinfo(this.requireModClient(client), value),
    command: client => this.modClientCommands.get(this.requireModClient(client)) ?? null,
    grounded: client => {
      const actor = this.requireModClient(client), source = this.source;
      if (source.kind === "q2-native") return source.game.services.playerGrounded(this.nativeQ2Client(actor).slot + 1, actor);
      if (source.kind === "q3-qvm") {
        const slot = source.game.records.slot(actor);
        if (slot === null) throw new Error("QVM movement state requires a source client");
        return source.game.records.player(slot).groundEntityNumber !== 1023;
      }
      const state = this.requirePlayer(actor).readState();
      if (state.kind === "q2-classic" || state.kind === "q2-rerelease") return (state.flags & 4) !== 0;
      return state.kind === "q1-netquake" ? (state.flags & 512) !== 0 : state.ground.kind !== "none";
    },
    playerView: client => {
      const actor = this.requireModClient(client), source = this.source;
      if (source.kind === "q2-native") return source.game.services.playerView(this.nativeQ2Client(actor).slot + 1, actor);
      if (source.kind === "q3-qvm") {
        const slot = source.game.records.slot(actor);
        if (slot === null) throw new Error("QVM view requires a live source client");
        const state = source.game.records.player(slot);
        return { viewOffset: { x: 0, y: 0, z: state.viewHeight }, crouched: (state.movementFlags & 1) !== 0 };
      }
      const player = this.requirePlayer(actor), state = player.readState(), view = this.playerView(actor), body = this.bodies.read(actor);
      if (view === null || body === null) throw new Error("Client view requires a live movement owner");
      return { viewOffset: { x: view.origin.x - body.origin.x, y: view.origin.y - body.origin.y, z: view.origin.z + (state.kind === "q3" || state.kind === "q2-rerelease" ? state.viewHeight : view.viewHeight) - body.origin.z },
        crouched: state.kind === "q3" ? (state.movementFlags & 1) !== 0 : state.kind === "q2-classic" || state.kind === "q2-rerelease" ? (state.flags & 1) !== 0 : false };
    },
    drop: (client, reason, content) => { const actor = this.requireModClient(client); this.modClientDrops.push({ client, actor, reason, content }); },
    subscribe: listener => { this.modClientListeners.add(listener); return () => { this.modClientListeners.delete(listener); return undefined; }; },
    subscribeApplication: listener => this.modClientApplications.subscribe(listener),
  }; }
  private stepping = false;
  private checkpointInProgress = false;
  private sourceRoundSettlement:
    | { readonly kind: "none" }
    | { readonly kind: "ready"; readonly source: Q3SourceRuntime }
    | { readonly kind: "active"; readonly source: Q3SourceRuntime; completed: number }
    | { readonly kind: "failed"; readonly source: Q3SourceRuntime } = { kind: "none" };
  private checkingQ2Rules = false;
  private readonly q1ClientVisibility: Q1ClientVisibility;
  private attackSequence = 0;
  private q1Restart = false;
  private readonly lastAttack = new Map<OwnedActor, AttackProvenance>();
  private readonly areaPortals = new Map<number, boolean>();
  private readonly quakeWorldCommands: ({ readonly kind: "move"; readonly client: ClientId; readonly commands: readonly QwUserCommand[]; readonly sequence: number } | { readonly kind: "action"; readonly client: ClientId; readonly action: () => void })[] = [];
  private quakeWorldTouched: Set<number> | null = null;

  constructor(readonly options: SimulationOptions, loading?: typeof nativeLoading) {
    this.sourceItemsRestore = options.restore === undefined ? null : prepareSourceItemRestore(options.restore);
    if (this.sourceItemsRestore !== null) { options = { ...options, restore: this.sourceItemsRestore.primary }; this.options = options; }
    this.modClients = this.createModClients();
    if (loading !== nativeLoading && options.recipe.equipment.grapple.kind === "enabled" && options.recipe.equipment.grapple.mechanic === "q3-qvm")
      throw new Error("Authored QVM grapple requires asynchronous loadSimulation");
    if (loading !== nativeLoading && ((options.preparedMods?.length ?? 0) !== 0 || (options.enabledMods?.length ?? 0) !== 0
      || (options.restore?.mods?.mods.length ?? 0) !== 0 || (options.modTravel?.mods.length ?? 0) !== 0))
      throw new Error("Selected gameplay mods require asynchronous loadSimulation");
    const native = options.recipe.execution.find(module => module.kind === "native");
    if (native !== undefined) {
      if (native.role !== "server-game" || !(native.api.kind === "q2-classic-game" && native.profile.kind === "windows-i386" && options.q2Guest?.edition === "classic"
          || native.api.kind === "q2-rerelease-game" && native.profile.kind === "windows-x86-64" && options.q2Guest?.edition === "rerelease")
        || options.q2Guest === undefined || !isDeepStrictEqual(native, options.q2Guest.prepared.execution)
        || options.recipe.execution.length !== 1 || options.travel !== undefined)
        throw new Error("Native Quake II requires its exact prepared API and ABI");
    } else if (options.q2Guest !== undefined) throw new Error("Prepared Quake II native module differs from selected execution");
    const qvm = options.recipe.execution.find(module => module.kind === "qvm" && module.role === "server-game");
    if (qvm !== undefined) {
      assertQ3GuestRecipe(options.recipe, qvm);
      if (options.mode !== "deathmatch"
        || options.q3Guest === undefined || !isDeepStrictEqual(qvm, options.q3Guest.prepared.execution)
        || options.travel !== undefined || options.q3Session !== undefined
        || options.restore === undefined && (options.restoredClients?.length ?? 0) !== 0
        || options.initialSourceMilliseconds !== undefined && (!Number.isSafeInteger(options.initialSourceMilliseconds) || options.initialSourceMilliseconds < 0 || options.initialSourceMilliseconds > 0x7fffffff))
        throw new Error("Q3 bytecode requires a prepared native map without travel state");
    } else if (options.q3Guest !== undefined || options.recipe.execution.some(module => module.kind === "qvm")) {
      throw new Error("Prepared Q3 guest does not match the selected server execution");
    }
    this.session = options.identity.session;
    this.q1Campaign = new Q1CampaignState(options.travel?.source.kind === "q1" ? options.travel.source.flags : 0, options.travel?.source.kind === "q1" ? options.travel.source.skill : options.skill);
    this.recipe = options.recipe;
    if (options.recipe.equipment.grapple.kind === "enabled" || options.recipe.equipment.handGrenades.kind === "enabled") {
      const native = options.q2Guest, qvm = options.q3Guest;
      const supported = native === undefined ? qvm === undefined || q3NativeCombatProfile(qvm.prepared.artifact) !== null
        : native.edition === "classic" ? classicCombatProfile(native.prepared.execution.artifact.digest) !== null
          : retailRereleaseClientProfile.authority.kind === "artifact" && native.prepared.execution.artifact.digest === retailRereleaseClientProfile.authority.digest;
      if (!supported) throw new Error(`${options.recipe.map.entities.content} lacks a supported shared combat interface. Disable Hook and Offhand grenades or choose a supported game module.`);
    }
    this.startItems = options.restore === undefined ? options.startItems ?? "" : savedSimulationSettings(options.restore).startItems;
    this.initialSpawnPoint = options.nativeQ2Travel?.spawnPoint ?? options.travel?.spawnPoint
      ?? (options.restore === undefined ? options.initialSpawnPoint ?? "" : savedSimulationSettings(options.restore).initialSpawnPoint);
    const quakec = options.recipe.execution.find(module => module.kind === "quakec");
    if (quakec !== undefined) {
      const nativeMap = quakec.api.kind === "q1-quakeworld" ? options.recipe.map.entities.content.startsWith("q1:quakeworld:")
        : options.recipe.map.entities.content.startsWith("q1:");
      if (quakec.api.kind === "q1-quakeworld" && options.dedicated !== true || options.preparedQuakeC === undefined || !isDeepStrictEqual(quakec, options.preparedQuakeC.execution)
        || options.recipe.execution.length !== 1 || !nativeMap
        || options.recipe.enemies.kind !== "map-defined" || options.recipe.weapons.some(weapon => !isDeepStrictEqual(weapon, options.recipe.map.entities)))
        throw new Error("QuakeC simulation requires the prepared dedicated native supported artifact and map-defined actors");
      if (quakec.api.kind === "q1-quakeworld" && (options.mode !== "deathmatch" || options.maxClients > 32))
        throw new Error("Native QuakeWorld requires deathmatch, at most 32 clients and QuakeWorld movement");
      if (options.travel !== undefined && (options.restore !== undefined || options.travel.source.kind !== (quakec.api.kind === "q1-quakeworld" ? "quakeworld" : "netquake"))
        || options.restore === undefined && (options.restoredClients?.length ?? 0) !== 0
        || options.originalSaveCandidate !== true && options.initialSourceMilliseconds !== undefined && options.initialSourceMilliseconds !== 1000)
        throw new Error("QuakeC travel must use the same native ABI and a fresh source clock");
    } else if (options.preparedQuakeC !== undefined) throw new Error("Prepared QuakeC artifact does not match the selected execution");
    const weaponProvider = options.recipe.weapons[0];
    if (weaponProvider === undefined || options.recipe.weapons.length !== 1) throw new Error("This source arsenal requires one selected weapon provider");
    this.weaponProvider = weaponProvider;
    const timing = providerTiming(this.recipe, this.recipe.map.entities.provider);
    const saved = options.restore;
    if (saved !== undefined) {
      validateSimulationSave(saved);
      const settings = savedSimulationSettings(saved);
      if (settings.skill !== options.skill || settings.mode !== options.mode || settings.maxClients !== options.maxClients)
        throw new Error("Saved simulation rules differ from construction settings");
      if (!isDeepStrictEqual(saved.recipe, options.recipe)) throw new Error("Saved simulation recipe differs from the mounted recipe");
      if (options.restoredClients?.some(client => !options.identity.owns(client))) throw new Error("Restored client belongs to another session");
      const clients = options.restoredClients ?? [];
      if (new Set(clients.map(client => client.slot)).size !== clients.length || new Set(settings.clientSlots).size !== settings.clientSlots.length
        || clients.length !== settings.clientSlots.length || settings.clientSlots.some(slot => !clients.some(client => client.slot === slot)))
        throw new Error("Saved players do not match the restored client slots");
    }
    const initial = saved === undefined ? options.initialSourceMilliseconds ?? (options.preparedQuakeC === undefined ? 0 : 1000) : seconds(saved.frame.time) * 1000;
    if (!Number.isFinite(initial) || initial < 0) throw new RangeError("Initial source time must be finite and nonnegative");
    this.clock = new SourceClock({ kind: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? "milliseconds" : "seconds",
      value: timing.clock.kind === "q2-rerelease" || timing.clock.kind === "q3" ? initial : initial / 1000 }, saved?.frame.frame ?? 0);
    this.hostMilliseconds = initial;
    this.sourceSchedulingMilliseconds = initial;
    this.selectedMilliseconds = initial;
    this.sourceFrame = saved?.frame ?? this.clock.frame;
    this.equipmentFrame = this.sourceFrame;
    this.grappleFrame = this.sourceFrame;
    this.random = new SourceRandom(options.seed, timing.clock.kind === "q2-rerelease" ? "q2-rerelease" : "classic");
    this.actors = saved === undefined ? new SessionActorRegistry(options.identity)
      : SessionActorRegistry.restore(options.identity, saved.actors, readSourceActorsCheckpoint(simulationProviderCheckpoint(saved, "world:source-slots")));
    this.q1Punch = new Q1PlayerPunch(this.actors, actor => this.q1PunchOwner(actor));
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
          kind: this.q1Characters.get(actor)?.presentation.movement === "bounce" ? "bounce" : this.q1Characters.get(actor)?.presentation.movement === "toss" ? "toss"
            : this.q2Characters.get(actor)?.state.dead ? this.q2Characters.get(actor)?.state.gibbed ? "bounce" : "toss" : "step", gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null };
        const entry = this.actorExecutions.get(actor.id);
        const motion = entry === undefined ? null : actorMotion(entry, body);
        return motion === null || this.selectedMonsters?.active(actor.id) !== false ? motion : { ...motion, kind: "stationary", velocity: zero, angularVelocity: zero };
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
        else if (entry !== undefined && entry.kind !== "q3" && entry.kind !== "q3-source") entry.entity.angularVelocity = velocity;
        return undefined;
      },
      onBlocked: (actor, other) => {
        const entry = this.actorExecutions.get(actor.id);
        if (entry?.kind === "q1") entry.entity.blocked?.(other);
        else if (entry?.kind === "q2") entry.entity.blocked?.(entry.entity, entry.services, other);
        return undefined;
      } });
    this.inventory = new SharedInventoryTable(this.actors);
    this.events = new SimulationEvents(this.physics.bodies, () => this.sourceFrame.time, actor => this.player(actor)?.client ?? null, actor => this.actors.sourceOf(actor)?.slot ?? null, { content: this.recipe.map.entities.content, acceptedContents: new Set(this.recipe.mounts.mounts.map(mount => mount.identity.content)), entities: options.world.kind === "q1-bsp" ? options.world.entities : "", alive: actor => this.actors.resolveOwned(actor) !== null });
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
        if (this.selectedQ3Source?.bridge.currentCall !== null) this.selectedQ3Source?.bridge.beforeReaction(decision);
        if (decision.reaction === "death") { this.selectedQ3Source?.died(actor.id); const player = this.playerStates.get(actor); if (player !== undefined) { player.setFlight(false); this.grapple?.release(actor.id); this.stepHandGrenade(player.actor.id, "dead"); } }
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
            const qcPlayer = this.source.kind === "quakec" ? this.playerStates.get(actor) : undefined;
            if (qcPlayer?.character === "q2" && outcome.decision.appliedDamage > 0)
              qcPlayer.animation = quakeCCharacterAnimation(qcPlayer.animation, (this.combat.read(actor.id)?.health ?? 0) <= 0 ? "death" : "pain",
                qcPlayer.bounds.max.z < qcPlayer.standingBounds.max.z);
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
    this.originalPickups = new SharedOriginalPickupAdmission(this.actors, this.combat, this.inventory, offer => this.selectedQ3Source?.pickupAllowed(offer) ?? true);
    this.registerCombat();
    this.scheduler = new FrameScheduler({ actors: this.actors, ordering: this.recipe.ordering, clocks: this.recipe.timing.map(value => ({ provider: value.provider, profile: value.clock })),
      sourceSlot: actor => this.actors.sourceOf(actor)?.slot ?? null,
      executionProvider: actor => this.executionProvider(actor),
      resolve: (_provider, callback) => callback === "world:think" ? (actor, frame) => { this.callbacks.think(actor, frame); return undefined; } : null });
    this.actors.onRelease(actor => {
      this.modClientApplications.release(actor.id);
      this.modClientCommands.delete(actor.id); this.modClientAdmissions.delete(actor.id);
      this.events.retire(actor.id);
      this.actorExecutions.delete(actor.id);
      this.monsterMissions.delete(actor.id);
      this.nativeEquipmentPlayers.delete(actor.id); this.nativeEquipmentAlive.delete(actor.id); this.nativeEquipmentVelocity.delete(actor.id); this.nativeWeaponRequests.delete(actor.id);
      this.selectedArsenal?.remove(actor.id);
      this.scheduler.cancel(actor); this.weaponSlots.delete(actor.id); this.playerStates.delete(actor); this.characters.delete(actor); this.characterStarts.delete(actor); this.q3Arsenals.delete(actor); this.q3Commands.delete(actor); this.q1Characters.delete(actor); this.q2Views.delete(actor.id); this.q2Characters.delete(actor); this.characterTicks.delete(actor); this.entryCarry.delete(actor); this.detachedModels.delete(actor); this.sourceModels.delete(actor.id); this.viewModels.delete(actor.id); this.lastAttack.delete(actor);
      return undefined;
    });
    this.q1Movement = this.createMonsterMovement(timing.numeric, this.random);
    this.q1ClientVisibility = new Q1ClientVisibility({ maxClients: this.options.maxClients, visibility: this.scene,
      client: slot => {
        const actor = slot === 0 ? this.worldActor() : this.players().find(actor => this.playerClient(actor)?.slot === slot - 1) ?? null;
        const eye = actor === null ? null : this.q1VisibilityEye(actor);
        return { actor, free: actor === null || !this.actors.isLive(actor), health: actor === null ? 0 : this.combat.read(actor)?.health ?? 0,
          notarget: actor !== null && (this.monsterTarget(actor)?.notarget ?? false),
          origin: eye?.origin ?? zero, viewOffset: eye?.viewOffset ?? zero };
      } });
    this.weaponBehavior = new SimulationWeaponBehaviors(options.weaponBehaviors ?? [], { actors: this.actors, scene: this.scene, mode: options.mode, seed: options.seed,
      targets: () => this.actors.observations().flatMap(actor => {
        const body = this.bodies.read(actor.id), combat = this.combat.read(actor.id);
        return body === null ? [] : [{ actor: actor.id, body, health: combat?.health ?? 0, classname: this.classname(actor.id), name: this.player(actor.id) === null ? "" : this.sourcePlayerName(actor.id),
          solid: this.bodies.linked(actor.id) !== null }];
      }), aim: actor => { const forward = { x: 0, y: 0, z: 0 }; donorAngleVectors(this.playerView(actor).angles, forward, null, null); return forward; },
      print: (actor, text) => { this.events.message({ kind: "print", level: 2, text }, actor); },
      qvm: entry => this.createQvmWeaponBehavior(entry),
      native: (entry, nextFrame) => this.createNativeWeaponBehavior(entry, nextFrame) });
    try {
    this.source = this.createSource(loading);
    if (this.source.kind === "q2-native") this.source.game.services.setPlayerVelocityWriter((actor, velocity) => {
      if (this.playerClient(actor.id) === null) throw new Error("Native movement write requires an admitted player");
      this.nativeEquipmentVelocity.set(actor.id, velocity); return undefined;
    }, actor => this.nativeEquipmentVelocity.get(actor));
    else if (this.source.kind === "q3-qvm") {
      const game = this.source.game;
      game.records.setPlayerVelocityWriter((actor, velocity) => {
        const slot = game.records.requireSlot(actor.id), state = game.records.player(slot);
        game.game.data.writePlayerState(slot, { ...state, velocity, groundEntityNumber: 1023 }); return undefined;
      });
      const artifact = this.options.q3Guest?.prepared.artifact;
      const definition = artifact === undefined ? null : q3InputProfile(artifact);
      if (definition !== null) game.bindInput(definition, {
        applications: this.modClientApplications,
        identity: slot => {
          const player = game.players().find(player => player.sourceEntity === slot);
          return player === undefined ? null : { client: player.client, actor: player.actor };
        },
        live: identity => this.actors.isLive(identity.actor) && this.playerClient(identity.actor)?.equals(identity.client) === true,
        accepted: actor => this.modClientCommands.get(actor) ?? null,
        frame: () => this.sourceFrame,
        onRelease: listener => this.actors.onRelease(actor => listener(actor.id)),
      });
    }
    if (this.source.kind === "q3-qvm" && (this.recipe.equipment.grapple.kind === "enabled" && this.recipe.equipment.grapple.mechanic !== "q3-qvm" || this.recipe.equipment.handGrenades.kind === "enabled")) {
      const world = this.actors.atSource(this.recipe.map.entities.provider, 1022) ?? this.actors.allocateAtSource(this.recipe.map.entities.provider, 1022, "q3:worldspawn");
      this.bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    }
    this.handGrenades = this.createHandGrenades();
    this.grapple = this.createGrapple();
    if (this.source.kind !== "quakec" && this.source.kind !== "q3-qvm" && this.source.kind !== "q2-native" && (this.weaponProvider.content !== this.recipe.map.entities.content || providerFamily(this.weaponProvider.provider) !== this.source.kind)) {
      if (providerFamily(this.weaponProvider.provider) === "q1") {
        this.selectedArsenal = this.createSelectedQ1Arsenal();
      } else if (providerFamily(this.weaponProvider.provider) === "q2" && (this.source.kind === "q1" || this.source.kind === "q2" || this.source.kind === "q3")) {
        this.selectedArsenal = this.createSelectedQ2Arsenal();
      } else if (providerFamily(this.weaponProvider.provider) === "q3") {
        this.selectedArsenal = this.createSelectedQ3Arsenal();
      } else throw new Error("Selected foreign arsenal is not implemented for this provider");
    }
    if (this.source.kind !== "q3-qvm" && this.source.kind !== "q2-native") { this.prepareSelectedMonsters(); options.monsterNavigation?.install(this, this.q1Movement); }
    if (saved !== undefined) {
      if (this.source.kind !== "q2-native" || loading !== nativeLoading) {
        this.restore(saved);
        if (options.travel !== undefined) this.restoreCampaignTravel(options.travel);
        if (this.sourceCollisionSettings !== null) this.scene.bindCollisionSettings(this.sourceCollisionSettings);
      }
    }
    else if (this.source.kind === "q1" && options.world.kind === "q1-bsp") this.source.composition.spawnMap(options.world);
    else if (this.source.kind === "quakec") {
      if (options.travel?.source.kind === "quakeworld" || options.travel?.source.kind === "netquake") {
        if (options.travel.source.clients.some(record => !options.identity.owns(record.client))) throw new Error("QuakeC travel client belongs to another session");
        this.source.game.restoreTravel(options.travel.source);
      }
      this.source.game.spawnMap();
    }
    else if (this.source.kind === "q3") {
      this.source.game.host.cvars.clearModified("sv_maxclients");
      if (providerFamily(this.recipe.combat.provider) === "q3") this.disposeSourceCombat = this.combat.register(this.selectedEquipmentCombat(this.source.game.bridge.policy()));
      this.source.game.load();
      this.source.game.host.cvars.clearModified("g_gametype");
    }
    else if (this.source.kind === "q2-native") {
      if (options.nativeQ2Travel === undefined && loading !== nativeLoading) {
        this.source.game.init();
        this.source.game.spawn(this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), options.world.entities);
      }
    }
    else if (this.source.kind === "q2") {
      if (options.travel?.source.kind === "q2") this.source.game.counters.serverFlags = options.travel.source.serverFlags;
      const worldspawn = parseQ2Entities(options.world.entities, this.source.game.options.edition).find(entity => entity.classname === "worldspawn");
      this.setWorldGravity(worldspawn === undefined ? 800 : numberField(worldspawn, "gravity", 800));
      const report = this.source.game.load(options.world.entities);
      this.source.product.afterSpawn();
      if (report.unsupported.length !== 0) throw new Error(`Unimplemented authored Q2 spawns: ${[...new Set(report.unsupported.map(entity => entity.classname))].join(", ")}`);
    }
    if (loading !== nativeLoading) {
      this.pendingSharedRestore?.finish();
      this.pendingSharedRestore?.assertComplete();
      this.pendingSharedRestore = null;
      this.bindNativeInput();
    }
    } catch (error) {
      if (this.source.kind === "q3-qvm") {
        const errors: unknown[] = [error];
        try { this.source.game.discard(); } catch (cleanup) { errors.push(cleanup); }
        try { this.close(); } catch (cleanup) { errors.push(cleanup); }
        if (errors.length !== 1) throw new AggregateError(errors, "Q3 guest candidate restore and cleanup failed");
        throw error;
      }
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Source candidate initialization and cleanup failed"); }
      throw error;
    }
  }

  static async load(options: SimulationOptions, nextFrame: () => Promise<void>): Promise<SharedSimulation> {
    const simulation = new SharedSimulation(options, nativeLoading);
    try {
      if (options.prepareRereleaseNavigation !== undefined && (simulation.q2Source()?.game.options.edition === "rerelease" || options.q2Guest?.edition === "rerelease"
        || options.weaponBehaviors?.some(entry => entry.kind === "rerelease-native") === true))
        simulation.installRereleaseNavigation(await options.prepareRereleaseNavigation(simulation));
      if (simulation.source.kind === "q2-native") {
        const travel = simulation.pendingNativeTravel;
        simulation.pendingNativeTravel = null;
        if (travel !== null) simulation.source = await travel(nextFrame);
        else if (options.restore !== undefined) {
          await simulation.restoreNativeLoading(options.restore, nextFrame);
          simulation.restore(options.restore, true);
          if (options.travel !== undefined) simulation.restoreCampaignTravel(options.travel);
          if (simulation.sourceCollisionSettings !== null) simulation.scene.bindCollisionSettings(simulation.sourceCollisionSettings);
        } else {
          await simulation.source.game.initLoading(nextFrame);
          await simulation.source.game.spawnLoading(options.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), options.world.entities, nextFrame);
        }
      }
      simulation.bindNativeInput();
      await simulation.initializeQvmGrapple();
      await simulation.weaponBehavior.initializeLoading(nextFrame);
      const modState = options.restore?.mods;
      const enabled = options.enabledMods ?? (modState ?? options.modTravel)?.mods.map(mod => mod.identity.selection) ?? [];
      if (options.preparedMods !== undefined || enabled.length !== 0 || modState !== undefined || options.modTravel !== undefined) {
        const native = simulation.nativeModContext();
        simulation.modOwner = await SessionMods.open({ presentation: simulation.events, prepared: options.preparedMods ?? [], enabled,
          services: { clients: simulation.modClients, weapons: {
            bind: (actor, binding) => {
              simulation.actors.assertOwned(actor);
              if (simulation.source.kind === "quakec" && qcWeaponStage(simulation.source.game.prepared.program) === null) throw new Error("Primary QC weapon handoff lacks a qualified source boundary");
              if (!simulation.weaponSlots.has(actor.id)) simulation.bindWeaponSlot(actor.id);
              const slot = simulation.weaponSlots.get(actor.id); if (slot === undefined) throw new Error("Source weapon slot was not admitted");
              return slot.bind(binding);
            }, selected: (actor, provider) => simulation.weaponSlots.get(actor)?.selected(provider) ?? false,
            request: (actor, weapon) => simulation.requestWeapon(actor, weapon),
          }, ...(native === undefined ? {} : { native }), ...(options.modCommands === undefined ? {} : { commands: options.modCommands }),
            ...(options.modFiles === undefined ? {} : { files: options.modFiles }), actors: simulation.actors, bodies: simulation.bodies, combat: simulation.combat, inventory: simulation.inventory, seed: options.seed, time: () => simulation.sourceFrame.time,
            damageContext: source => ({ sequence: simulation.attackSequence++, weaponProvider: source, combatProvider: simulation.recipe.combat.provider,
              inventoryProvider: simulation.recipe.inventory.provider, movementProvider: simulation.recipe.movement.provider }),
            callbacks: simulation.callbacks, referenceSaved: actor => {
              if (options.restore === undefined && options.modTravel !== undefined) throw new Error("Retained mod state cannot reference actors from the previous world");
              return simulation.actors.referenceSaved(actor, options.restore === undefined ? "current" : "checkpoint");
            },
            engine: { scene: simulation.scene, physics: simulation.physics, events: simulation.events, world: () => simulation.worldActor(), print: text => simulation.events.message({ kind: "print", level: 2, text }),
              environment: { skill: options.skill, mode: options.mode, maxClients: options.maxClients, gravity: simulation.physics.gravity },
              classname: actor => simulation.classname(actor),
              inlineModel: index => ({ bounds: simulation.scene.modelBounds(index), content: options.recipe.map.geometryContent,
                family: options.world.kind === "q1-bsp" ? "q1" : options.world.kind === "q2-bsp" ? "q2" : "q3" }),
              areaEntities: bounds => simulation.scene.queryActors(bounds).map(actor => actor.body.actor),
              clients: { maximum: options.maxClients, visibility: simulation.scene, at: slot => {
                const actor = simulation.players().find(actor => simulation.playerClient(actor)?.slot === slot - 1) ?? null;
                const body = actor === null ? null : simulation.bodies.read(actor), view = actor === null ? null : simulation.playerView(actor);
                return { actor, free: actor === null || body === null, health: actor === null ? 0 : simulation.combat.read(actor)?.health ?? 0,
                  notarget: actor !== null && (simulation.monsterTarget(actor)?.notarget ?? false), origin: body?.origin ?? zero,
                  viewOffset: view === null || body === null ? zero : { x: view.origin.x - body.origin.x, y: view.origin.y - body.origin.y, z: view.origin.z + view.viewHeight - body.origin.z } };
              } },
              message: (event, actor) => simulation.events.message(event, actor),
              presentation: { map: options.recipe.map.geometry.requestedPath, players: () => simulation.players(),
                camera: actor => { const view = simulation.playerView(actor); return { origin: { ...view.origin, z: view.origin.z + view.viewHeight }, angles: view.angles }; } } } },
          operations: { damage: simulation.combat.damageOperation, actors: simulation.callbacks.operations, inventory: simulation.inventory.operations }, nextFrame }, modState, options.modTravel);
      }
      simulation.sourceItemsRestore?.finish(simulation.actors, simulation.inventory);
      for (const slot of simulation.weaponSlots.values()) slot.validateRestore();
      simulation.events.finishOwnerRestore();
      simulation.pendingSharedRestore?.finish();
      simulation.pendingSharedRestore?.assertComplete();
      simulation.pendingSharedRestore = null;
      return simulation;
    } catch (error) {
      const errors: unknown[] = [error];
      try { await simulation.shutdownQ3Guest(); } catch (cleanup) { errors.push(cleanup); }
      try { simulation.close(); } catch (cleanup) { errors.push(cleanup); }
      if (errors.length > 1) throw new AggregateError(errors, "Simulation loading and cleanup failed");
      throw error;
    }
  }

  get bodies() { return this.physics.bodies; }
  get timeSeconds(): number { return seconds(this.sourceFrame.time); }
  private q1PunchOwner(actor: ActorId): Q1PunchOwner | null {
    const source = this.source;
    if (source.kind === "quakec" && source.game.kind === "netquake") return {
      read: () => source.game.clientPunchAngles(actor), write: angles => source.game.setClientPunchAngles(actor, angles) };
    const player = (source.kind === "q1" ? source.game.player(actor) : null) ?? this.q1WeaponSource()?.game.player(actor);
    return player == null ? null : { read: () => player.punchAngles, write: angles => { player.punchAngles = angles; } };
  }
  private emitQ1Addon(content: ContentId, event: Q1AddonEvent, time: SourceTime): undefined {
    if (event.kind === "punch-angle") this.q1Punch.write(event.player, event.angles);
    else if (event.kind === "view-roll") this.setSourceViewRoll(event.player, event.roll);
    return this.events.emit(content, { kind: "q1-composition", event: { kind: "addon", event } }, time);
  }
  private setSourceViewRoll(actor: ActorId, roll: number): void {
    if (!Number.isFinite(roll)) throw new RangeError("Source view roll must be finite");
    const source = this.source;
    if (this.playerClient(actor) === null) throw new Error("Source view requires a live client");
    if (source.kind === "quakec") { source.game.setClientViewRoll(actor, roll); return; }
    if (source.kind === "q2-native") { source.game.services.setPlayerViewRoll(this.nativeQ2Client(actor).slot + 1, actor, roll); return; }
    if (source.kind === "q3-qvm") { source.game.records.setPlayerViewRoll(actor, roll); return; }
    const movement = this.requirePlayer(actor);
    if (source.kind === "q1") {
      const player = source.game.player(actor);
      if (player === null) throw new Error("Q1 source view has no player state");
      player.viewAngles = { ...player.viewAngles, z: Math.fround(roll) };
    } else if (source.kind === "q3") {
      const state = source.game.records.byActor(actor)?.client?.ps;
      if (state === undefined) throw new Error("Q3 source view has no player state");
      state.viewangles = { ...state.viewangles, z: Math.fround(roll) };
    }
    movement.setSourceViewRoll(roll);
  }
  private advanceQ1Punch(): void {
    const numeric = createNumericOperations(Q1_DONOR_PROFILE);
    for (const actor of this.players()) {
      const owned = this.actors.resolveOwned(actor), player = owned === null ? undefined : this.playerStates.get(owned);
      if (player?.cutscene != null || player?.intermission === true || player?.state.kind === "q1-netquake" && player.state.moveType === 0) continue;
      // Native NetQuake ClientThink owns DropPunchAngle and writes its result to QC memory.
      if (this.source.kind === "quakec" && this.source.game.kind === "netquake"
        && (player?.state.kind === "q1-netquake" || !this.source.game.clientPunchAdvances(actor))) continue;
      const punchAngles = this.q1Punch.advance(actor, seconds(this.sourceFrame.elapsed), numeric);
      if (player?.state.kind === "q1-netquake") player.state = { ...player.state, punchAngles };
    }
  }
  private get q1PhysicsEdition(): "classic" | "rerelease" { return this.recipe.engineBehavior.content.startsWith("q1:rerelease:") ? "rerelease" : "classic"; }

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
      const game = new Q1EntityServices(this.q1ActorHost(reference, runtime), { ...common, physicsEdition: this.q1PhysicsEdition, deathmatch: 0, coop: this.options.mode === "coop", gravity: this.physics.gravity, precacheProgram: "id1" });
      if (registered.program === "mg3" && this.options.restore === undefined) game.world = game.create("worldspawn");
      const addon = registered.program === "id1" ? null : registerSelectedQ1Expansion(game, registered.program, {
        emit: event => this.emitQ1Addon(reference.content, event, clock.frame.time),
        isMonster: actor => {
          const execution = this.actorExecutions.get(actor);
          return execution?.kind === "q1" ? (execution.entity.movementFlags & 32) !== 0
            : execution?.kind === "q2" && (execution.entity.serverFlags & 4) !== 0;
        },
        cvar: name => this.source.kind === "q1" ? this.source.cvars.variableValue(name) : this.q2ServerRegistry?.variableValue(name) ?? 0,
        setCvar: (name, value) => {
          const registry = this.source.kind === "q1" ? this.source.cvars : this.q2ServerRegistry;
          if (registry === null) throw new Error("Selected Q1 addon requires the shared server settings registry");
          registry.set(name, value, true); return undefined;
        },
      });
      if (registered.program === "id1") {
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
      }
      game.pickupAdmission = this.selectedCreaturePickups();
      source = { kind: "q1", reference, random, clock, game, ...(addon === null ? {} : { addon }) };
    } else {
      const modules = createSelectedQ2MonsterModules({ edition: registered.edition, program: registered.program,
        behavior: { mission: actor => this.monsterMissions.get(actor) ?? null },
        weapons: { emit: event => this.weaponEvent(reference.content, event),
          dodge: (actor, attacker, eta, trace) => this.q2MonsterDodge(actor, attacker, eta, trace),
          ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
          lagCompensation: { kind: "current-world" }, canTarget: (attacker, target) => attacker === null || !attacker.equals(target) },
        gravity: () => this.physics.gravity,
        powerups: actor => {
          if (this.source.kind === "q2") return this.source.product.powerups(actor);
          if (this.source.kind === "q1") { const powers = this.source.game.player(actor)?.powerups;
            return { quadUntil: powers?.get("quad") ?? 0, doubleUntil: 0, invulnerabilityUntil: powers?.get("invulnerability") ?? 0 }; }
          if (this.source.kind !== "q3") throw new Error("Selected Q2 monster powerups require an admitted character source");
          const powers = this.source.game.records.nativeByActor(actor)?.client?.ps.powerups;
          return { quadUntil: (powers?.get(Powerup.PW_QUAD) ?? 0) / 1000, doubleUntil: 0, invulnerabilityUntil: (powers?.get(Powerup.PW_INVULNERABILITY) ?? 0) / 1000 };
        },
        playerEffect: event => this.events.emit(reference.content, { kind: "q2-composition", event: { kind: "missionpack-player", event } }, clock.frame.time),
        createGame: (monsters, spawnModules) => new Q2EntityServices(this.q2ActorHost(reference, runtime, actor => monsters.context(actor)?.state),
          { ...common, mode: this.options.mode === "coop" ? "coop" : "singleplayer", mapName: this.recipe.map.geometry.requestedPath, deathmatchFlags: 0 }, spawnModules) });
      source = { kind: "q2", reference, random, clock, ...modules };
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
      validatePlacement: (entry, definition, relocated) => {
        const body = this.bodies.read(entry.actor.id);
        if (body === null) throw new Error("Started selected monster has no shared body");
        const source = this.monsterSourceFor(definition);
        const trace = this.scene.geometryTrace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds },
          target: { kind: "world" }, passActor: entry.actor.id, numeric: providerTiming(this.recipe, definition.source.provider).numeric,
          policy: source.kind === "q1" ? { kind: "q1", move: "normal", hull: null } : { kind: "q2", contentsMask: 1, leafContents: "merged" } });
        if (trace.startSolid || trace.allSolid) {
          if (map.kind === "q1" && isQ1TeleportStaging(map.game, body)) {
            entry.placement = { kind: "teleport", origin: body.origin };
            return true;
          }
          const entity = source.kind === "q1" ? source.game.entity(entry.actor.id) : null;
          const q2Entity = source.kind === "q2" ? source.game.entity(entry.actor.id) : null;
          const preservedQ2 = source.kind === "q2" && map.kind === "q2" && this.options.world.kind === "q2-bsp" && q2Entity !== null
            && preservesAuthoredQ2Placement({ map: this.recipe.map,
              authored: parseQ2Entities(this.options.world.entities, map.game.options.edition)[entry.sourceOrdinal], definition,
              native: map.monsters.definition(entry.classname, map.game), game: source.game, entity: q2Entity, body });
          const preserved = source.kind === "q1" && this.options.world.kind === "q1-bsp" && entity !== null
            && preservesAuthoredQ1Placement({ map: this.recipe.map, authored: this.options.world.entityList[entry.sourceOrdinal], definition, game: source.game, entity, body });
          if (!preserved && !preservedQ2) {
            const nativeBounds = map.kind === "q2" ? map.monsters.definition(entry.classname, map.game)?.bounds
              : baseSpecies.find(species => species.classnames.includes(entry.classname))?.bounds;
            const nativeMovement = map.kind === "q2" ? map.monsters.definition(entry.classname, map.game)?.locomotion
              : baseSpecies.find(species => species.classnames.includes(entry.classname))?.movement;
            const position = map.kind === "q2" ? parseQ2Entities(this.options.world.entities, map.game.options.edition)[entry.sourceOrdinal]?.values.get("origin")
              : this.options.world.kind === "q1-bsp" ? this.options.world.entityList[entry.sourceOrdinal]?.properties.find(property => property.key === "origin")?.value : undefined;
            const flags = entity?.movementFlags ?? q2Entity?.flags ?? 0;
            const locomotion = (flags & 2) !== 0 ? "swim" : (flags & 1) !== 0 ? "fly" : "walk";
            const medium = (origin: Vec3): number => {
              if (source.kind === "q2") return source.game.host.pointContents(origin) & 56;
              const contents = source.game.host.contents(origin);
              return contents === "water" ? 32 : contents === "slime" ? 16 : contents === "lava" ? 8 : 0;
            };
            const originalMedium = medium(body.origin);
            const blockers: ActorId[] = [];
            const search = (excluded: readonly ActorId[]) => nativeBounds === undefined || position === undefined ? null : nearbyMonsterPlacement({ body, locomotion, worldActor: this.worldActor(),
              sameMedium: origin => medium(origin) === originalMedium,
              authored: { origin: relocated ?? parseVector(position), bounds: nativeBounds, locomotion: nativeMovement === "fly" || nativeMovement === "swim" ? nativeMovement : "walk" },
              query: { target: { kind: "world" }, passActor: entry.actor.id, numeric: providerTiming(this.recipe, definition.source.provider).numeric,
                policy: source.kind === "q1" ? { kind: "q1", move: "normal", hull: null } : { kind: "q2", contentsMask: 1, leafContents: "merged" } },
              blockedBy: actor => { if (!blockers.some(value => value.equals(actor))) blockers.push(actor); return undefined; },
              trace: query => this.scene.traceExcluding(query, excluded) });
            const placement = search([]);
            if (placement === null) {
              const candidates = map.kind === "q2" && entry.targetname !== "" ? map.game.targets(entry.targetname).filter(door => {
                const state = map.movers.traversal(door);
                return door.classname === "func_door" && (state.locked || state.destination !== null);
              }) : [];
              let doors = candidates.filter(door => blockers.some(actor => actor.equals(door.actor.id)));
              let future: ReturnType<typeof nearbyMonsterPlacement> = null;
              while (doors.length > 0) {
                future = search(doors.map(door => door.actor.id));
                if (future !== null) break;
                const next = candidates.filter(door => blockers.some(actor => actor.equals(door.actor.id)));
                if (next.length === doors.length) break;
                doors = next;
              }
              if (map.kind === "q2" && future !== null) {
                entry.placement = { kind: "waiting", barriers: doors.map(door => ({ actor: door.actor.id, origin: map.game.body(door).origin })), activator: null };
                this.combat.setTraits(entry.actor, { canTakeDamage: false });
                this.bodies.link(entry.actor);
                return false;
              }
              throw new Error(`Selected monster placement obstructed in ${this.recipe.map.geometry.requestedPath}: source ${entry.sourceOrdinal} ${entry.classname} -> ${definition.source.provider}/${definition.classname}`);
            }
            this.bodies.write(entry.actor, { ...body, ...placement });
            if (entity !== null && locomotion === "walk") entity.movementFlags |= 512;
            this.bodies.link(entry.actor);
          }
        }
        return true;
      },
      placementReady: entry => {
        if (entry.placement.kind === "teleport") {
          const body = this.bodies.read(entry.actor.id);
          return map.kind === "q1" && body !== null && !isQ1TeleportStaging(map.game, body);
        }
        if (entry.placement.kind !== "waiting" || map.kind !== "q2") return false;
        return entry.placement.barriers.every(barrier => {
          const door = map.game.entity(barrier.actor);
          if (door === null) return true;
          const traversal = map.movers.traversal(door), origin = map.game.body(door).origin;
          return !traversal.locked && traversal.destination === null && (origin.x !== barrier.origin.x || origin.y !== barrier.origin.y || origin.z !== barrier.origin.z);
        });
      },
      resume: (actor, activator) => {
        const entry = this.actorExecutions.get(actor);
        if (entry === undefined || (entry.kind === "q3" || entry.kind === "q3-source") || entry.kind === "quakec") throw new Error("Activated monster has no creature source continuation");
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
        : { ...common, kind: "q2", entities: source.game.capture(), monsters: source.monsters.capture(), ballistics: source.ballistics.captureProjectiles(), movers: source.movers.capture(source.game), packs: source.packs.map(pack => ({ pack: pack.pack, state: pack.monsters.capture(source.game) })) };
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
      else if (source.kind === "q2" && state.kind === "q2") { source.game.restore(state.entities); source.monsters.restore(source.game, state.monsters); source.ballistics.restoreProjectiles(source.game, state.ballistics); if (state.movers !== null) source.movers.restore(source.game, state.movers);
        for (const savedPack of state.packs) { const pack = source.packs.find(value => value.pack === savedPack.pack); if (pack === undefined) throw new Error("Saved monster pack is not registered"); pack.monsters.restore(source.game, savedPack.state); } }
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
        source.addon?.frame(seconds(projected.elapsed));
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
    const profile = expansionSourceSupply(arsenal.family === "q1" ? Q3_Q1_SUPPLY_PROFILE : Q3_Q2_SUPPLY_PROFILE);
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
    const equipment = this.selectedQ3Source?.takePickup(pickup);
    if (equipment !== undefined && equipment.kind !== "native") return equipment;
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

  private createSelectedQ3Arsenal(): Q3SelectedArsenal {
    const product = this.weaponProvider.content.includes(":missionpack:") ? "missionpack" : "baseq3";
    const timing = providerTiming(this.recipe, this.weaponProvider.provider).clock;
    if (timing.kind !== "q3") throw new Error("Selected Q3 requires its source clock");
    this.selectedQ3Time = Math.trunc(this.selectedMilliseconds);
    this.selectedQ3Next = this.selectedQ3Time + timing.serverFrameMilliseconds;
    const strings = this.selectedQ3Strings;
    const config = new ConfigStringRegistry({ get: index => strings.get(index) ?? "", set: (index, value) => { strings.set(index, value); } });
    strings.set(20, "baseq3-1"); strings.set(21, String(this.selectedQ3Time));
    const gameType = (): number => this.source.kind === "q3" ? this.source.game.gameType
      : this.recipe.match.provider === "q1:ctf" || this.recipe.match.provider === "q2:ctf" || this.recipe.match.provider === "q2:lmctf" ? GameType.GT_CTF
        : this.teamGame() ? GameType.GT_TEAM : GameType.GT_FFA;
    let serverInfo = "";
    const sourceInfo = this.source.kind === "q3" ? this.source.game.host.serverState.serverInfo() : "";
    for (const [key, value] of [["mapname", this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, "")],
      ["g_gametype", String(gameType())], ["sv_maxclients", String(this.options.maxClients)]]) {
      if (key === undefined || value === undefined) throw new Error("Selected source server info pair is incomplete");
      serverInfo = setInfoValue(serverInfo || sourceInfo, key, value, { dialect: "q3", maximumLength: 1024, target: "server-info",
        serverHighCharacters: true, print: text => { this.events.message({ kind: "print", level: 2, text }); } });
    }
    strings.set(0, serverInfo);
    const primaryEquipment = this.source.kind === "q3" && this.source.game.options.product === "missionpack";
    const equipment: import("./arsenal/q3-source.ts").Q3SelectedSourceHost["equipment"] = primaryEquipment ? { kind: "primary",
      damageFactor: actor => {
        if (this.source.kind !== "q3") throw new Error("Primary Q3 equipment lost its source");
        const client = this.source.game.records.nativeByActor(actor)?.client;
        if (client == null) throw new Error("Primary Q3 equipment lost its client");
        return q3WeaponDamageFactor(client, this.source.game.quadDamageFactor(), client.ps.product);
      }, firingDelay: (actor, milliseconds) => {
        if (this.source.kind !== "q3") throw new Error("Primary Q3 equipment lost its source");
        const client = this.source.game.records.nativeByActor(actor)?.client;
        if (client == null) throw new Error("Primary Q3 equipment lost its client");
        return q3WeaponDelay(milliseconds, client.persistantPowerup?.item?.tag ?? 0, client.ps.powerups.get(Powerup.PW_HASTE) !== 0);
      } } : { kind: "source" };
    const source = new Q3SelectedSource({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
      queries: this.scene, weaponBehavior: this.weaponBehavior, provider: this.weaponProvider.provider, product, equipment, content: this.weaponProvider.content,
      configstrings: config.store, userinfo: actor => this.sourcePlayerUserinfo(actor) ?? "", maxClients: this.options.maxClients, seed: this.options.seed, now: () => this.selectedQ3Time,
      worldActor: () => { const actor = this.worldActor(), owner = actor === null ? null : this.actors.resolveOwned(actor); if (owner === null) throw new Error("Selected Q3 source has no map world"); return owner; },
      player: actor => {
        const player = this.player(actor); if (player === null) return null;
        const q1 = this.source.kind === "q1" ? this.source.game.player(actor) : null;
        const q2 = this.source.kind === "q2" ? this.source.items.playerPowerups(actor) : null;
        const q3 = this.source.kind === "q3" ? this.source.game.records.nativeByActor(actor)?.client : null;
        const team = this.combat.read(actor)?.team?.toLowerCase();
        return { angles: player.viewAngles, viewHeight: player.viewHeight, maxHealth: this.source.kind === "q2" ? this.source.game.entity(actor)?.maxHealth ?? 100
          : q3?.ps.stats.get(statSchema(q3.ps.product).maxHealth) ?? q1?.maxHealth ?? 100,
          team: q3?.sess.sessionTeam ?? (team === "red" || team === "5" ? Team.TEAM_RED : team === "blue" || team === "14" ? Team.TEAM_BLUE : Team.TEAM_FREE),
          quadUntil: q3?.ps.powerups.get(Powerup.PW_QUAD) ?? Math.trunc((q1?.powerups.get("quad") ?? q2?.quadUntil ?? 0) * 1000),
          hasteUntil: q3?.ps.powerups.get(Powerup.PW_HASTE) ?? 0 };
      },
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider,
      armorContext: request => this.victimArmorContext(request),
      collision: (actor, collision) => this.physics.setCollision(actor, collision),
      curves: () => this.source.kind !== "q3" || this.source.game.host.cvars.variableValue("cm_noCurves") === 0,
      playerCurveClip: () => this.source.kind !== "q3" || this.source.game.host.cvars.variableValue("cm_playerCurveClip") !== 0,
      gameType,
      friendlyFire: () => this.source.kind === "q3" ? this.source.game.host.cvars.variableValue("g_friendlyFire") !== 0 : this.source.kind === "q2" ? (this.source.game.options.deathmatchFlags & 256) === 0 : true,
      knockback: () => this.source.kind === "q3" ? this.source.game.host.cvars.variableValue("g_knockback") : 1000,
      intermissionQueued: () => this.source.kind === "q3" ? this.source.game.level.intermissionQueued : this.source.kind === "q1" ? this.source.game.intermission === null ? 0 : 1 : this.source.kind === "q2" && this.source.players.intermission.kind !== "playing" ? 1 : 0,
      checkHurtCarrier: (target, attacker) => { if (this.source.kind !== "q3") return;
        const nativeTarget = this.source.game.records.nativeByActor(target.actor.id), nativeAttacker = this.source.game.records.nativeByActor(attacker.actor.id);
        if (nativeTarget !== null && nativeAttacker !== null) this.source.game.team.checkHurtCarrier(nativeTarget, nativeAttacker);
      },
      checkObeliskAttack: (target, attacker) => { if (this.source.kind !== "q3") return false;
        const nativeTarget = this.source.game.records.nativeByActor(target.actor.id), nativeAttacker = this.source.game.records.nativeByActor(attacker.actor.id);
        return nativeTarget !== null && nativeAttacker !== null && this.source.game.team.checkObeliskAttack(nativeTarget, nativeAttacker);
      },
      quadFactor: () => this.source.kind === "q3" ? this.source.game.quadDamageFactor() : 4,
      proximityTimeout: () => this.source.kind === "q3" ? this.source.game.host.cvars.variableValue("g_proxMineTimeout") : 20000,
      modelIndex: path => config.modelIndex(path), soundIndex: path => config.soundIndex(path),
      print: text => { this.events.message({ kind: "print", level: 2, text }); },
      execute: (actor, step) => { this.registerActorExecution({ kind: "q3-source", actor, step, provider: this.weaponProvider.provider, content: this.weaponProvider.content,
        motion: body => source.motion(actor, body), collision: () => source.collision(actor) }); },
      event: (actor, state, time) => { const body = this.bodies.read(actor.id); if (body !== null) this.events.emit(this.weaponProvider.content,
        { kind: "q3-source", event: { kind: "entity-event", actor: actor.id, state, origin: body.origin, time } }, { kind: "milliseconds", value: time }); },
      clientChanged: (actor, before, after) => this.selectedQ3ClientChanged(actor, before, after),
      dropObjectives: actor => this.dropSelectedQ3Objectives(actor), spawnPoint: actor => this.selectedQ3Spawn(actor),
      returnPickup: actor => {
        if (this.source.kind !== "q3") throw new Error("Borrowed persistent pickup has no original Q3 map owner");
        const pickup = this.source.game.records.nativeByActor(actor);
        if (pickup === null || !pickup.inuse) throw new Error("Borrowed persistent pickup was retired");
        returnQ3PersistentPowerup(pickup, this.source.game.world);
      },
    });
    this.selectedQ3Source = source;
    const base = this.source.kind === "q1" ? Q1_Q3_SUPPLY_PROFILE : this.source.kind === "q2" ? Q2_Q3_SUPPLY_PROFILE : null;
    const profile = base === null ? null : expansionSourceSupply(product === "missionpack" ? expansionSupply(base, ["q3-missionpack"]) : base);
    const supply = profile === null ? undefined : { profile: profile.id,
      loadout: this.source.kind === "q1" ? q1Q3SupplyLoadout(this.weaponProvider.provider, product) : q3SpawnLoadout(this.weaponProvider.provider, product, false),
      replacedItems: [...replacedSupplyItems(profile), ...(this.source.kind === "q2" ? ["q2:weapon_blaster"] satisfies readonly ItemId[] : [])] };
    const selected = new Q3SelectedArsenal({ provider: this.weaponProvider.provider, product, inventory: this.inventory,
      ...(supply === undefined ? {} : { supply }),
      ...(equipment.kind === "primary" ? { firingDelay: (actor: OwnedActor, milliseconds: number) => equipment.firingDelay(actor.id, milliseconds) } : {}),
      equipment: { ownsHoldables: source.ownsEquipment, read: actor => source.equipment(actor), consume: (actor, item) => source.consume(actor, item), restore: (actor, state) => source.restoreEquipment(actor, state), advance: (actor, milliseconds) => source.advanceMovement(actor, milliseconds), endCommand: (actor, milliseconds) => source.endCommand(actor, milliseconds) },
      fire: (actor, weapon, input) => {
        source.fire(actor, weapon, input);
        if (!this.actors.isLive(actor.id)) return undefined;
        if (this.requirePlayer(actor.id).character === "q2") this.weaponCharacterAnimation(actor.id, "attack", weapon === 1, this.weaponProvider.content, false);
        if (this.source.kind === "q1") this.source.composition.fired(actor.id, q3WeaponItem(weapon)?.item ?? null);
        const body = this.bodies.read(actor.id); if (this.source.kind === "q2" && body !== null) this.source.weapons.playerNoiseForActor(actor.id, this.source.game, body.origin, "weapon");
        return undefined;
      }, useHoldable: (actor, event) => source.useHoldable(actor, event) });
    if (profile !== null) {
      this.bindSelectedAmmo(profile);
    this.selectedSupply = new SharedPickupAdmission({ inventory: this.inventory, profile,
        ammoGranted: (actor, grants, autoSwitch) => { selected.pickupAmmo(actor, grants, autoSwitch && (this.source.kind !== "q1" || this.source.game.player(actor.id)?.autoSwitch !== "never")); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; },
        weaponGranted: (actor, weapons, selection) => { selected.pickupWeapons(actor, weapons, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; } });
      if (this.source.kind === "q1") this.source.game.pickupAdmission = this.selectedSupply;
      else if (this.source.kind === "q2") this.source.items.setPickupAdmission(this.selectedSupply);
    }
    return selected;
  }

  private selectedQ3Spawn(actor: OwnedActor): { readonly origin: Vec3; readonly angles: Vec3 } {
    const source = this.source;
    if (source.kind === "q1") { const spot = source.composition.selectSpawn(actor.id, true);
      if (spot === null) throw new Error("Selected teleporter has no source spawn");
      const body = source.game.body(spot); return { origin: body.origin, angles: body.angles };
    }
    if (source.kind === "q2") { const entity = source.game.entity(actor.id); if (entity === null) throw new Error("Selected teleporter has no Q2 player"); return source.players.selectTeleportSpawn(entity, source.game); }
    if (source.kind === "q3") { const body = this.bodies.read(actor.id); if (body === null) throw new Error("Selected teleporter lost its body"); return source.game.spawns.selectSpawnPoint(body.origin); }
    throw new Error("Selected Team Arena map travel has no source owner");
  }

  private dropSelectedQ3Objectives(actor: OwnedActor): void {
    const source = this.source;
    if (source.kind === "q1") { if (source.composition.ctf !== null) dropQ1CtfFlag(source.composition.ctf, actor.id); source.composition.packs?.world.dropCarriedFlag(actor.id); return; }
    if (source.kind === "q2") { const match = source.product.match.source, entity = source.game.entity(actor.id);
      if (entity !== null && (match instanceof Q2Ctf || match instanceof Q2Lmctf)) match.flags.drop(entity, source.game);
      return;
    }
    if (source.kind === "q3") { const entity = source.game.records.nativeByActor(actor.id); if (entity === null) throw new Error("Selected objective drop has no map player");
      dropQ3TeleportObjectives({ product: source.game.options.product, combat: source.game.bridge.context, drops: source.game.drops }, entity); return;
    }
    throw new Error("Selected objective drop has no source map owner");
  }

  private selectedQ3ClientChanged(actor: OwnedActor, before: Q3SelectedClientEffects, after: Q3SelectedClientEffects): void {
    const player = this.playerStates.get(actor); if (player === undefined) return;
    if (before.maxHealth !== after.maxHealth) {
      if (this.source.kind === "q1") {
        const target = this.source.game.player(actor.id); if (target === null) throw new Error("Selected max health has no Q1 player"); target.maxHealth = after.maxHealth;
      } else if (this.source.kind === "q2") {
        const target = this.source.game.entity(actor.id); if (target === null) throw new Error("Selected max health has no Q2 player"); target.maxHealth = after.maxHealth;
      } else if (this.source.kind === "q3") {
        const target = this.source.game.records.nativeByActor(actor.id)?.client; if (target == null) throw new Error("Selected max health has no Q3 client");
        target.pers.maxHealth = after.maxHealth; target.ps.stats.set(statSchema(target.ps.product).maxHealth, after.maxHealth);
      }
    }
    const changedAngles = before.viewAngles.x !== after.viewAngles.x || before.viewAngles.y !== after.viewAngles.y || before.viewAngles.z !== after.viewAngles.z;
    if (before.teleportBit !== after.teleportBit) {
      const body = this.bodies.read(actor.id); if (body === null) throw new Error("Selected Q3 teleport lost its destination body");
      this.setPlayerMovement(actor.id, { kind: "teleport", origin: body.origin, angles: after.viewAngles, velocity: body.velocity, holdMilliseconds: after.pmTime, commandAngles: player.commandAngles, spectator: false });
    } else {
      const delta = { x: ((after.deltaAngles.x - before.deltaAngles.x + 32768 & 65535) - 32768), y: ((after.deltaAngles.y - before.deltaAngles.y + 32768 & 65535) - 32768), z: ((after.deltaAngles.z - before.deltaAngles.z + 32768 & 65535) - 32768) };
      if (!changedAngles && delta.x === 0 && delta.y === 0 && delta.z === 0) return;
      const state = player.readState(), angles = changedAngles ? after.viewAngles : add(player.viewAngles, { x: delta.x * 360 / 65536, y: delta.y * 360 / 65536, z: delta.z * 360 / 65536 });
      player.viewAngles = angles;
      if (state.kind === "q3") player.state = { ...state, viewAngles: angles, deltaAngleWords: [state.deltaAngleWords[0] + delta.x, state.deltaAngleWords[1] + delta.y, state.deltaAngleWords[2] + delta.z] };
      else if (state.kind === "q2-classic") player.state = { ...state, deltaAngleShorts: [state.deltaAngleShorts[0] + delta.x, state.deltaAngleShorts[1] + delta.y, state.deltaAngleShorts[2] + delta.z] };
      else if (state.kind === "q2-rerelease") player.state = { ...state, deltaAngles: add(state.deltaAngles, { x: delta.x * 360 / 65536, y: delta.y * 360 / 65536, z: delta.z * 360 / 65536 }) };
      else if (state.kind === "q1-netquake") player.state = { ...state, viewAngles: angles };
      else player.state = { ...state, angles };
      this.events.emit(this.weaponProvider.content, { kind: "view-reset", reason: "source", actor: actor.id, angles });
    }
  }

  private bindSelectedAmmo(profile: PickupSupplyProfile): void {
    if (this.source.kind !== "q3" || providerFamily(this.weaponProvider.provider) === "q3") return;
    if (this.selectedAmmoTimers !== null) throw new Error("Selected ammo timers already have a source owner");
    const legacy = providerFamily(this.weaponProvider.provider) === "q1" ? Q3_Q1_SUPPLY_PROFILE : Q3_Q2_SUPPLY_PROFILE;
    this.selectedAmmoTimers = new Q3MappedAmmoRegeneration(profile, this.actors, this.inventory, legacy.ammoOwners ?? []);
  }

  private selectedAmmo(actor: ActorId): readonly import("../../../content/q3/team-arena/client-effects.ts").Q3MappedAmmoTimer[] | null {
    if (this.selectedArsenal === null || this.selectedArsenal.family === "q3" || !this.selectedArsenal.has(actor)) return null;
    const owner = this.actors.resolveOwned(actor);
    if (owner === null || this.selectedAmmoTimers === null) throw new Error("Selected ammunition has no live timer owner");
    return this.selectedAmmoTimers.timers(owner);
  }

  private selectedAmmoActors(): readonly OwnedActor[] {
    return [...this.playerStates.values()].filter(player => this.selectedArsenal?.has(player.actor.id) === true).map(player => player.actor);
  }

  private selectedWeaponDelay(actor: ActorId, seconds: number): number {
    const client = this.source.kind === "q3" ? this.source.game.records.nativeByActor(actor)?.client : null;
    if (client == null) return seconds;
    const schema = statSchema(client.ps.product), persistent = schema.product === "missionpack" ? itemAt(client.ps.product, client.ps.stats.get(schema.persistentPowerup)).tag : 0;
    const milliseconds = seconds * 1000, delay = q3WeaponDelay(milliseconds, persistent, client.ps.powerups.get(Powerup.PW_HASTE) !== 0);
    return delay === milliseconds ? seconds : delay / 1000;
  }

  private selectedEquipmentCombat(policy: CombatPolicy): CombatPolicy {
    return { ...policy, prepare: (request, target, attacker) => this.selectedQ3Source?.blocksDamage(request) === true ? { kind: "cancel" }
      : policy.prepare?.(request, target, attacker) ?? { kind: "continue", amount: request.amount } };
  }

  private createSelectedQ2Arsenal(): Q2SelectedArsenal {
    const product = this.weaponProvider.content.split(":")[2];
    if (product !== "baseq2" && product !== "xatrix" && product !== "rogue" && product !== "mg2") throw new Error("Selected Q2 arsenal has an unsupported source program");
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
      sourceDamageMultiplier: actor => {
        const client = this.source.kind === "q3" ? this.source.game.records.nativeByActor(actor)?.client : null;
        return client == null ? 1 : q3WeaponDamageFactor(client, 1, client.ps.product);
      },
      firingInterval: (actor, seconds) => this.selectedWeaponDelay(actor, seconds),
      lagCompensation: { kind: "current-world" },
      ammoChanged: actor => this.events.message({ kind: "q2-inventory", counts: this.inventory.entries(actor).map(entry => entry.count) }, actor),
      canTarget: (attacker, target) => attacker === null || !sameActor(attacker, target) });
    game.sourceCallbacks.register(weapons.callbacks);
    this.selectedWeaponSource = { kind: "q2", game, weapons, random, frame, mapMilliseconds: initialMilliseconds, intervalMilliseconds, nextMilliseconds: initialMilliseconds + intervalMilliseconds };
    const missionWeapons = registerSelectedQ2MissionWeapons(game, weapons, product, {
      gravity: () => this.physics.gravity,
      monster: actor => {
        if (this.source.kind === "q2") { const found = this.source.monsters.context(actor); if (found !== null) return found; }
        for (const source of this.monsterSources.values()) if (source.kind === "q2") { const found = source.monsters.context(actor); if (found !== null) return found; }
        return null;
      },
      playerEffect: event => this.events.emit(this.weaponProvider.content, { kind: "q2-composition", event: { kind: "missionpack-player", event } }, current().frame.time),
    });
    const identity: PickupSupplyProfile = { id: "composition:q2-base-q2-supply", weaponOwnership: "all-destinations",
      ammo: [...new Set(Q2_BASE_WEAPONS.flatMap(weapon => weapon.ammo === null ? [] : [weapon.ammo]))].map(item => ({ source: item, destinations: [item] })),
      weapons: Q2_BASE_WEAPONS.map(weapon => ({ source: weapon.item, destinations: [weapon.item] })) };
    const supply = expansionSourceSupply(expansionSupply(this.source.kind === "q1" ? Q1_Q2_SUPPLY_PROFILE : this.source.kind === "q2" ? identity : Q3_Q2_SUPPLY_PROFILE,
      edition === "rerelease" ? ["q2-xatrix", "q2-rogue"] : product === "xatrix" ? ["q2-xatrix"] : product === "rogue" ? ["q2-rogue"] : []));
    const selected = new Q2SelectedArsenal({ game, weapons, inventoryDefinitions: missionWeapons.inventoryDefinitions, pickupOrder: missionWeapons.pickupOrder, replacedItems: replacedSupplyItems(supply),
      ...(this.source.kind === "q2" ? {} : { loadout: this.source.kind === "q1" ? q1Q2SupplyLoadout() : q3Q2SupplyLoadout() }),
      observe: actor => { const player = this.requirePlayer(actor); return { owner: { actor: player.actor, viewHeight: player.viewHeight }, input: this.q2WeaponInput(player) }; } });
    this.bindSelectedAmmo(supply);
    this.selectedSupply = new SharedPickupAdmission({ inventory: this.inventory, profile: supply,
      ammoGranted: (actor, grants, autoSwitch) => { selected.pickupAmmo(actor, grants, autoSwitch); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; },
      weaponGranted: (actor, granted, selection) => { selected.pickupWeapons(actor, granted, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; } });
    if (this.source.kind === "q1") this.source.game.pickupAdmission = this.selectedSupply;
    else if (this.source.kind === "q2") this.source.items.setPickupAdmission(this.selectedSupply);
    return selected;
  }

  private createSelectedQ1Arsenal(): Q1SelectedArsenal {
    const product = this.weaponProvider.content.split(":")[2];
    if (product !== "id1" && product !== "hipnotic" && product !== "rogue" && product !== "dopa" && product !== "mg1" && product !== "mg3") throw new Error("Selected Q1 arsenal has an unsupported source program");
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
      sourceDamageMultiplier: attacker => {
        if (this.source.kind === "q3") {
          const client = this.source.game.records.nativeByActor(attacker)?.client;
          return client == null ? 1 : q3WeaponDamageFactor(client, this.source.game.quadDamageFactor(), client.ps.product);
        }
        return providerFamily(this.recipe.combat.provider) === "q1" || powerupExpires(attacker, "quad") <= seconds(this.selectedQ1Frame().time) ? 1 : 4;
      } }, {
      provider: this.weaponProvider.provider, edition: this.weaponProvider.content.includes(":rerelease:") ? "rerelease" : "classic",
      physicsEdition: this.q1PhysicsEdition,
      skill: this.options.skill, deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", campaign: this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, movementProvider: this.recipe.movement.provider, inventoryProvider: this.recipe.inventory.provider, gravity: this.physics.gravity });
    if (product === "mg3" && this.options.restore === undefined) game.world = game.create("worldspawn");
    const missionWeapons = registerSelectedQ1MissionWeapons(game, product, {
      emit: event => this.emitQ1Addon(this.weaponProvider.content, event, this.selectedQ1Frame().time),
      isMonster: actor => { const execution = this.actorExecutions.get(actor); return execution?.kind === "q1" ? (execution.entity.movementFlags & 32) !== 0 : execution?.kind === "q2" && (execution.entity.serverFlags & 4) !== 0; },
      cvar: name => this.source.kind === "q1" ? this.source.cvars.variableValue(name) : this.source.kind === "q3" ? this.source.game.host.cvars.variableValue(name) : this.q2ServerRegistry?.variableValue(name) ?? 0,
      setCvar: (name, value) => { const registry = this.source.kind === "q1" ? this.source.cvars : this.source.kind === "q3" ? this.source.game.host.cvars : this.q2ServerRegistry;
        if (registry === null) throw new Error("Selected Q1 weapons require the shared server settings registry");
        registry.set(name, value, true); return undefined; },
    });
    if (this.source.kind === "q3") game.registerWeaponRules({ id: "composition:q3-cadence",
      attackDelay: (_game, player, delay) => this.selectedWeaponDelay(player.actor.id, delay),
      frameDelay: (_game, player, delay) => this.selectedWeaponDelay(player.actor.id, delay) });
    if (product === "mg3") this.q1CharacterAdjuncts.add(game);
    this.selectedWeaponSource = { kind: "q1", game, random, missionWeapons };
    const baseProfile: PickupSupplyProfile = product === "hipnotic"
      ? this.source.kind === "q1" ? Q1_HIPNOTIC_SUPPLY_PROFILE : this.source.kind === "q2" ? Q2_HIPNOTIC_SUPPLY_PROFILE : Q3_HIPNOTIC_SUPPLY_PROFILE
      : this.source.kind === "q1" ? { id: "composition:q1-q1-supply", weaponOwnership: "all-destinations",
      ammo: Q1_Q3_SUPPLY_PROFILE.ammo.map(entry => ({ source: entry.source, destinations: [entry.source] })),
      weapons: Q1_Q3_SUPPLY_PROFILE.weapons.map(entry => ({ source: entry.source, destinations: [entry.source] })) } : this.source.kind === "q2" ? Q2_Q1_SUPPLY_PROFILE : Q3_Q1_SUPPLY_PROFILE;
    const profile = expansionSourceSupply(expansionSupply(baseProfile, product === "rogue" ? ["q1-rogue"] : product === "mg3" ? ["q1-mg3"] : []));
    const selected = new Q1SelectedArsenal({ game, impulse: missionWeapons.impulse, preparePickup: missionWeapons.preparePickup,
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
    this.bindSelectedAmmo(profile);
    this.selectedSupply = new SharedPickupAdmission({ inventory: this.inventory, profile,
      ammoGranted: (actor, grants, autoSwitch) => { selected.pickupAmmo(actor, grants, autoSwitch); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; },
      weaponGranted: (actor, weapons, selection) => { selected.pickupWeapons(actor, weapons, selection); this.requirePlayer(actor.id).arsenal = selected.read(actor.id); return undefined; } });
    if (this.source.kind === "q2") this.source.items.setPickupAdmission(this.selectedSupply);
    if (this.source.kind === "q1") this.source.game.pickupAdmission = this.selectedSupply;
    return selected;
  }

  private q1ActorHost(source: ProviderReference, runtime: ActorHostRuntime, authority: SourceLevelAuthority = "actor-source"): Q1FoundationHost {
    const content = source.content;
    const movement = source.provider === this.recipe.map.entities.provider ? this.q1Movement : this.createMonsterMovement(runtime.numeric, runtime.random);
    const visibilityNumeric = createNumericOperations(runtime.numeric);
    return createQ1ActorHost({ punchAngles: this.q1Punch, weaponBehavior: this.weaponBehavior, actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory, originalPickups: this.originalPickups,
        monsterTarget: actor => this.monsterTarget(actor),
        registerEntity: (entity, services) => this.registerActorExecution({ kind: "q1", entity, services, content }),
        sourceTarget: actor => { const entry = this.actorExecutions.get(actor), player = this.playerClient(actor) !== null;
          const collision = this.scene.spatial.get(actor)?.collision;
          return { player, aimedDamage: player || (entry?.kind === "q1" ? entry.entity.aimedDamage : entry?.kind === "q2" && (entry.entity.serverFlags & 4) !== 0),
            slidebox: entry?.kind === "q1" ? entry.entity.solid === "slidebox" : collision?.role === "solid" && collision.monster && collision.shape.kind !== "model",
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
        }, transition: intent => { this.transitions.push(sourceLevelTransition(intent, this.recipe, authority)); return undefined; }, players: () => this.players(), classname: actor => this.classname(actor),
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
    readMonster: (actor: ActorId) => Q2MonsterState | undefined, authority: SourceLevelAuthority = "actor-source"): Q2FoundationHost {
    const content = source.content;
    return createQ2ActorHost({ weaponBehavior: this.weaponBehavior, actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory, originalPickups: this.originalPickups,
      gravity: () => this.physics.gravity,
      monsterTarget: actor => this.monsterTarget(actor),
      weaponTarget: actor => this.q2WeaponTarget(actor),
      registerEntity: (entity, services) => this.registerActorExecution({ kind: "q2", entity, services, content, readMonster: () => readMonster(entity.actor.id) }),
      ...(runtime.random.rerelease === null ? {} : { rereleaseRandom: runtime.random.rerelease }),
      now: () => runtime.now(), frameSeconds: () => runtime.frameSeconds(), random: () => runtime.random.nextUnit(), schedule: (actor, due) => runtime.schedule(actor, due),
      worldActor: () => { const actor = this.worldActor(); if (actor === null) throw new Error("Map has no source world actor"); return actor; },
      playerViewState: actor => this.playerClient(actor) === null ? null : { viewAngles: this.playerView(actor).angles, oldVelocity: this.source.kind === "q2" ? this.source.players.states.get(actor)?.oldVelocity ?? zero : this.grapple?.previousVelocity(actor) ?? zero },
      prepareLevelChange: (map, landmark, serverFlags) => { this.levelChange = { map, landmark, serverFlags }; return undefined; },
      players: () => this.players(), isPlayer: actor => this.playerClient(actor) !== null, isMonster: actor => { const entry = this.actorExecutions.get(actor);
        return entry?.kind === "q2" ? (entry.entity.serverFlags & 4) !== 0 : entry?.kind === "q1" && entry.entity.monster !== null; },
      touchTriggers: actor => this.physics.touchTriggers(actor),
      keyConsumed: actor => { if (this.source.kind === "q2") { const entity = this.source.game.entity(actor); if (entity !== null) this.source.players.consumedKey(entity, this.source.game); } return undefined; },
      setSolid: (actor, solid, model) => this.physics.setSolid(actor, solid, model, "q2"),
      setMotion: motion => this.physics.setMotion(motion), setAreaPortal: (portal, open) => { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); return undefined; },
      emit: event => { if (event.kind === "model") this.sourceModels.set(event.actor, event); return this.events.emit(content, { kind: "q2", event }, this.source.kind === "q2" && source.content === this.recipe.map.entities.content ? this.sourceFrame.time : { kind: "seconds", value: runtime.now() }); },
      transition: intent => {
        if (authority === "primary-world" && !this.checkingQ2Rules && this.source.kind === "q2" && intent.kind === "campaign-level") {
          const change = this.levelChange;
          return this.source.players.beginIntermission(this.source.game, change?.map ?? intent.map.replace(/^q2:/, ""), change?.landmark ?? null);
        }
        this.transitions.push(sourceLevelTransition(intent, this.recipe, authority)); return undefined;
      }, diagnostic: message => this.events.message({ kind: "print", level: 2, text: message }) }, { scene: this.scene, numeric: runtime.numeric, worldActor: () => this.worldActor(), sourceOrder: (a, b) => this.sourceOrder(a, b) });
  }

  setHandGrenadeInput(actor: ActorId, held: boolean): undefined {
    this.assertOpen(); this.requireEquipmentPlayer(actor);
    if (this.handGrenades === null) throw new Error("Hand grenades are disabled in this recipe");
    return this.handGrenades.input(actor, held);
  }

  handGrenadeState(actor: ActorId) { return this.handGrenades?.controller.state(actor) ?? null; }

  private requireEquipmentPlayer(actor: ActorId): void {
    if (this.source.kind !== "q2-native" && this.source.kind !== "q3-qvm") { this.requirePlayer(actor); return; }
    const client = this.playerClient(actor);
    if (client === null) throw new Error("Equipment owner is not an admitted source player");
    if ((this.grapple !== null || this.handGrenades !== null) && !this.nativeEquipmentPlayers.has(actor)) {
      const owner = this.actors.resolveOwned(actor); if (owner === null) throw new Error("Equipment owner was released");
      if (!this.inventory.has(actor)) this.bindEquipmentInventory(owner);
      const carry = this.options.nativeQ2Travel?.clients.find(entry => entry.client.equals(client));
      this.handGrenades?.admit(actor, carry?.handGrenades); this.admitGrapple(actor); this.nativeEquipmentPlayers.add(actor);
      this.nativeEquipmentAlive.set(actor, this.equipmentPlayerAvailable(actor));
      if (carry?.weaponSlot !== undefined && this.weaponSlots.has(actor)) {
        this.primaryHandoff(actor).holster(); this.bindWeaponSlot(actor, { kind: "holstering-primary", next: carry.weaponSlot }); this.weaponSlots.get(actor)?.reconcile();
      }
    }
  }

  private bindEquipmentInventory(actor: OwnedActor, initial: readonly InventoryEntry[] = []): void {
    const source = this.source.kind === "q2-native" ? this.source.game.services.sourceInventory(this.nativeQ2Client(actor.id).slot + 1) : null;
    if (source === null) { this.inventory.create(actor, initial); return; }
    this.bindSourceInventory(actor, source, initial);
  }

  private bindSourceInventory(actor: OwnedActor, source: InventoryStateBinding, initial: readonly InventoryEntry[]): void {
    if (new Set(initial.map(entry => entry.item)).size !== initial.length) throw new Error("Saved source inventory has duplicate items");
    const nativeItems = new Set(source.read().map(entry => entry.item));
    const supplemental = new Map(initial.filter(entry => !nativeItems.has(entry.item)).map(entry => [entry.item, entry]));
    this.inventory.bind(actor, { read: () => [...source.read(), ...supplemental.values()],
      mutableCapacity: item => nativeItems.has(item) ? source.mutableCapacity?.(item) === true : supplemental.has(item), write: entry => {
      if (nativeItems.has(entry.item)) return source.write(entry);
      supplemental.set(entry.item, entry); return undefined;
    } });
  }

  private equipmentPlayerAvailable(actor: ActorId): boolean {
    if (this.source.kind === "q3-qvm") {
      const player = this.source.game.players().find(entry => entry.actor.equals(actor)); if (player === undefined) return false;
      const state = this.source.game.records.player(player.sourceEntity);
      return (state.stats[0] ?? 0) > 0 && state.movementType !== MoveType.PM_SPECTATOR && state.movementType !== MoveType.PM_INTERMISSION && state.movementType !== MoveType.PM_SPINTERMISSION;
    }
    if (this.source.kind === "q2-native") return this.playerClient(actor) !== null && this.nativePlayerUi(actor).health > 0;
    const player = this.player(actor); return player !== null && !player.intermission && player.cutscene === null && (this.combat.read(actor)?.health ?? 0) > 0;
  }

  private beginNativeEquipmentFrame(): void {
    const grapple = this.grapple, grenades = this.handGrenades;
    if (grapple === null && grenades === null) return;
    const clock = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
    if (grenades !== null) this.equipmentFrame = providerFrame(this.sourceFrame, clock, providerTiming(this.recipe, grenades.selection.source.provider).clock);
    if (grapple !== null) {
      this.grappleFrame = providerFrame(this.sourceFrame, clock, providerTiming(this.recipe, grapple.selection.source.provider).clock);
      if (grapple.source.kind === "q1-threewave") grapple.source.game.beginFrame(seconds(this.grappleFrame.time), seconds(this.grappleFrame.elapsed));
      else if (grapple.source.kind === "q3-qvm") grapple.source.game.beginFrame(Math.round(seconds(this.grappleFrame.time) * 1000), this.grappleFrame.frame);
    }
    for (const actor of this.players()) {
      this.requireEquipmentPlayer(actor);
      if (this.source.kind === "q3-qvm") grapple?.observeTeleport(actor, this.source.game.records.player(this.source.game.records.requireSlot(actor)).flags & 4);
      else if (this.source.kind === "q2-native") grapple?.observeTeleport(actor, this.source.game.playerState(this.nativeQ2Client(actor).slot + 1).movement.flags & 32);
      if (grapple?.source.kind === "q3-qvm") grapple.source.game.pull(actor);
      const available = this.equipmentPlayerAvailable(actor);
      if (available && this.nativeEquipmentAlive.get(actor) === false) { this.handGrenades?.respawn(actor); grapple?.release(actor); this.admitGrapple(actor); }
      this.nativeEquipmentAlive.set(actor, available);
      this.stepHandGrenade(actor, available ? "alive" : "dead"); grapple?.step(actor, available);
    }
    const visited = new Set<OwnedActor>();
    for (const actor of orderedActorTurns(this.actors, actor => this.sourcePosition(actor.id), visited)) {
      const execution = this.actorExecutions.get(actor.id);
      if (execution?.kind !== "q1" && execution?.kind !== "q2") continue;
      const frame = execution.services === grapple?.source.game ? this.grappleFrame : execution.services === grenades?.independent.game ? this.equipmentFrame : null;
      if (frame === null) continue;
      executeActor(execution, { actors: this.actors, bodies: this.bodies, physics: this.physics, scheduler: this.scheduler,
        frame, timeSeconds: seconds(frame.time), elapsed: seconds(frame.elapsed), visited });
      this.physics.commitAttachments();
    }
    for (const slot of this.weaponSlots.values()) slot.reconcile();
  }

  setGrappleInput(actor: ActorId, held: boolean): undefined {
    this.assertOpen(); this.requireEquipmentPlayer(actor);
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
    const source = this.source;
    if (source.kind === "q3-qvm" || source.kind === "q2-native") {
      let holstered = false;
      const accepts = (item: import("../../../contracts/gameplay.ts").ItemId) => { const ui = this.nativePlayerUi(actor); return ui.activeWeapon === item || ui.items.some(entry => entry.id === item && entry.kind === "weapon" && entry.owned); };
      const select = (item: import("../../../contracts/gameplay.ts").ItemId): boolean => {
        if (!accepts(item)) return false;
        if (this.nativePlayerUi(actor).activeWeapon === item) return true;
        if (source.kind === "q3-qvm") {
          const weapon = this.nativePlayerUi(actor).items.find(entry => entry.id === item && entry.kind === "weapon"); if (weapon === undefined) return false;
          this.nativeWeaponRequests.set(actor, weapon.sourceOrdinal);
        } else {
          const itemName = this.nativePlayerUi(actor).items.find(entry => entry.id === item)?.label;
          if (itemName === undefined) return false;
          source.game.command(this.nativeQ2Client(actor).slot + 1, ["use", itemName], itemName);
        }
        return true;
      };
      return { provider: this.weaponProvider.provider, accepts, select, holster: () => { holstered = true; }, isHolstered: () => holstered,
        resume: item => { holstered = false; return item === null || select(item); } };
    }
    const player = this.requirePlayer(actor);
    if (this.selectedArsenal !== null) return this.selectedArsenal.handoff(actor);
    if (source.kind === "quakec") return { provider: this.weaponProvider.provider,
      accepts: item => this.primaryUi(actor).items.some(entry => entry.id === item && entry.kind === "weapon" && entry.owned),
      select: item => source.game.requestClientWeapon(actor, item),
      holster: () => { if (!this.actors.isLive(actor)) throw new Error("QC weapon owner retired"); }, isHolstered: () => source.game.clientWeaponSettled(actor),
      resume: item => item === null || source.game.requestClientWeapon(actor, item) };
    if (source.kind === "q1") return source.game.primaryWeaponHandoff(player.actor);
    if (source.kind === "q2") {
      const entity = source.game.entity(actor); if (entity === null) throw new Error("Q2 primary has no source player");
      const definition = (item: import("../../../contracts/gameplay.ts").ItemId) => source.weapons.registeredDefinitions().find(weapon => weapon.item === item);
      return { provider: this.weaponProvider.provider, accepts: item => definition(item) !== undefined && this.inventory.count(actor, item) > 0,
        select: item => { const weapon = definition(item); if (weapon === undefined) return false; const result = source.weapons.requestWeapon(entity, source.game, weapon.name); return result === "selected" || result === "current"; },
        holster: () => source.weapons.requestHolster(entity), isHolstered: () => source.weapons.isHolstered(entity),
        resume: item => { source.weapons.resumePrimary(entity, source.game, this.q2WeaponInput(player), item === null ? null : definition(item)?.name ?? null); return item === null || this.arsenal(player).activeWeapon === item; } };
    }
    if (source.kind !== "q3") throw new Error("Primary source is not ready");
    const runtime = () => { const state = this.q3Arsenals.get(player.actor); if (state === undefined) throw new Error("Missing Q3 primary continuation"); return state; };
    const select = (item: import("../../../contracts/gameplay.ts").ItemId): boolean => { const weapon = Q3_WEAPON_ITEMS.find(value => value.item === item);
      if (weapon === undefined || this.inventory.count(actor, item) <= 0 || runtime().product === "baseq3" && weapon.weapon > 10) return false;
      this.q3Arsenals.set(player.actor, q3RequestWeapon(runtime(), weapon.weapon)); return true; };
    return { provider: this.weaponProvider.provider, accepts: item => Q3_WEAPON_ITEMS.some(weapon => weapon.item === item && (runtime().product === "missionpack" || weapon.weapon <= 10)) && this.inventory.count(actor, item) > 0,
      select, holster: () => { this.q3Arsenals.set(player.actor, q3RequestWeaponHolster(runtime())); }, isHolstered: () => runtime().externalSlot === "holstered",
      resume: item => { this.q3Arsenals.set(player.actor, q3RequestWeaponResume(runtime())); return item === null || select(item); } };
  }

  private admitGrapple(actor: ActorId): undefined {
    this.grapple?.admit(actor);
    if (this.grapple?.selection.binding === "slot") {
      const owner = this.actors.resolveOwned(actor); if (owner === null) throw new Error("Grapple owner was released");
      if (!this.inventory.has(actor)) this.bindEquipmentInventory(owner);
      this.inventory.configure(owner, { item: this.grapple.weapon().item, count: 1, capacity: 1 });
      if (!this.weaponSlots.has(actor)) this.bindWeaponSlot(actor);
    }
    return undefined;
  }
  private bindWeaponSlot(actor: ActorId, state?: WeaponSlotRestoreState): undefined {
    const owner = this.actors.resolveOwned(actor); if (owner === null) throw new Error("Weapon slot actor retired");
    this.weaponSlots.set(actor, new WeaponSlot(this.primaryHandoff(actor), this.grapple?.selection.binding === "slot" ? this.grapple.handoff(actor) : undefined, state,
      () => this.actors.resolveOwned(actor) === owner));
    return undefined;
  }
  hasWeaponSlot(actor: ActorId): boolean { return this.weaponSlots.has(actor); }
  requestWeapon(actor: ActorId, weapon: WeaponReference): boolean {
    this.assertOpen(); this.requireEquipmentPlayer(actor);
    const slot = this.weaponSlots.get(actor);
    if (slot !== undefined) { const accepted = slot.request(weapon); slot.reconcile(); return accepted; }
    const primary = this.primaryHandoff(actor);
    return weapon.provider === primary.provider && primary.select(weapon.item);
  }

  private grappleAnchor(actor: ActorId): GrappleAnchor {
    if (this.worldActor()?.equals(actor)) return "world";
    const owner = this.actors.resolveOwned(actor);
    if (owner === null) return "none";
    const collision = this.physics.solidOf(actor), native = this.scene.linkedActor(actor)?.collision;
    if ((collision === null || collision.solid === "none") && (native === undefined || native.role !== "solid")) return "none";
    if (this.playerClient(actor) !== null) return this.equipmentPlayerAvailable(actor) ? "player" : "corpse";
    if (this.classname(actor) === "bodyque") return "corpse";
    return collision?.solid === "brush" || native?.shape.kind === "model" ? "brush" : collision?.solid === "box" || native?.shape.kind === "box" ? "box" : "none";
  }

  private q1CharacterPose(actor: ActorId) {
    const source = this.grapple?.source;
    if (source?.kind === "q1-threewave" && this.weaponSlots.get(actor)?.equipmentSelected()) return threewaveCharacterPose(source.core, actor);
    return this.source.kind === "q1" ? this.source.composition.characterPose(actor) : { axePose: this.playerUi(actor).activeWeapon === "q1:weapon/axe", frame: null };
  }

  private equipmentWeaponInput(actor: ActorId) {
    const source = this.source;
    if (source.kind === "q2-native" || source.kind === "q3-qvm") {
      const view = this.playerView(actor), q3 = source.kind === "q3-qvm" ? source.game.records.player(source.game.records.requireSlot(actor)) : null;
      return { attack: this.grapple?.held(actor) ?? false, latchedAttack: false, holster: false, angles: view.angles,
        ducked: (this.bodies.read(actor)?.bounds.max.z ?? 32) < 32, spectator: !this.equipmentPlayerAvailable(actor), notarget: false, hand: "right", animatePlayer: false,
        quadUntil: (q3?.powerups[Powerup.PW_QUAD] ?? 0) / 1000, doubleUntil: 0, quadFireUntil: 0,
        haste: (q3?.powerups[Powerup.PW_HASTE] ?? 0) > this.timeSeconds * 1000, noStackDouble: false,
        instantSwitch: false, quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: this.physics.gravity, weaponThunk: false } satisfies import("../../../content/q2/foundation/weapons/types.ts").Q2WeaponInput;
    }
    const player = this.requirePlayer(actor), native = this.q2WeaponInput(player), input = source.kind === "q2" ? source.product.weaponInput(actor, native) : native;
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
    const player = this.player(actor);
    if (player === null) return undefined;
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
      available: actor => this.equipmentPlayerAvailable(actor),
      presentation: actor => {
        return { attackAnimation: () => this.grappleCharacterAnimation(actor, "attack"), reverseAnimation: () => this.grappleCharacterAnimation(actor, "reverse"),
          animationTime: state => { const input = this.equipmentWeaponInput(actor); return Math.trunc(1000 / q2WeaponAnimationRate({ ...input, phase: state.phase, frame: state.frame,
            frameSeconds: seconds(this.grappleFrame.elapsed), now: seconds(this.grappleFrame.time) })) / 1000; },
          powerupSound: () => { const source = this.grapple?.source; if (source === undefined || source.kind === "q1-threewave" || source.kind === "q3-qvm") return undefined;
            const input = this.equipmentWeaponInput(actor), path = q2PowerupSound({ ...input, rerelease: this.grapple?.selection.edition === "rerelease", now: source.game.host.now() }), body = this.bodies.read(actor);
            return path === null || body === null ? undefined : source.game.host.emit({ kind: "sound", actor, origin: body.origin, path, channel: 3, volume: 1, attenuation: 1, reliable: false, loop: "once" }); } };
      } };
  }

  private createGrapple(): GrappleRuntime | null {
    const selection = this.recipe.equipment.grapple;
    if (selection.kind === "disabled") return null;
    if (selection.mechanic === "q3-qvm") return null;
    const world = providerTiming(this.recipe, this.recipe.map.entities.provider), timing = providerTiming(this.recipe, selection.source.provider);
    this.grappleFrame = providerFrame({ ...this.sourceFrame, elapsed: { kind: "seconds", value: 0 } }, world.clock, timing.clock);
    const random = new SourceRandom(this.options.seed, selection.edition === "rerelease" && selection.mechanic !== "q1-threewave" ? "q2-rerelease" : "classic");
    const runtime: ActorHostRuntime = { numeric: world.numeric, random, now: () => seconds(this.grappleFrame.time), frameSeconds: () => seconds(this.grappleFrame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
    const differentTeam = (owner: ActorId, target: ActorId): boolean => { const team = this.combat.read(owner)?.team; return team == null || this.combat.read(target)?.team !== team; };
    if (selection.mechanic === "q1-threewave") {
      const game = new Q1EntityServices(this.q1ActorHost(selection.source, runtime), { provider: selection.source.provider, edition: selection.edition, physicsEdition: this.q1PhysicsEdition,
        skill: this.options.skill, deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
        campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
        combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider, gravity: this.physics.gravity });
      game.beginFrame(seconds(this.grappleFrame.time), seconds(this.grappleFrame.elapsed));
      const core = new ThreewaveGrapple(game, { input: actor => { const player = this.player(actor), held = this.grapple?.held(actor) ?? false;
          return { held, release: !held && (selection.binding === "offhand" || this.weaponSlots.get(actor)?.equipmentSelected() === true), jump: this.grapple?.jump(actor) ?? false,
            viewAngles: this.playerView(actor).angles, teleportUntil: this.source.kind === "q1" && player?.state.kind === "q1-netquake" ? player.state.teleportTimeSeconds : 0 }; },
        aim: (actor, forward) => { const owner = this.actors.resolveOwned(actor); if (owner === null) throw new Error("Hook owner was released"); return q1Aim(game, owner, forward); },
        anchor: actor => { const anchor = this.grappleAnchor(actor); return { solid: anchor !== "none", centered: anchor === "player" || anchor === "corpse" || anchor === "box", player: this.playerClient(actor) !== null }; },
        canAttach: differentTeam, canPulse: differentTeam, canDamage: (target, owner) => game.canDamage(target, owner) });
      return new GrappleRuntime(selection, { kind: selection.mechanic, game, core }, random, this.grappleSlotHost());
    }
    const game = new Q2EntityServices(this.q2ActorHost(selection.source, runtime, () => undefined), { provider: selection.source.provider, edition: selection.edition,
      mapName: this.recipe.map.geometry.requestedPath, skill: this.options.skill, mode: this.options.mode, deathmatchFlags: 0, maxClients: this.options.maxClients,
      campaign: this.recipe.campaign.kind === "campaign" ? this.recipe.campaign.mission.provider : this.recipe.map.entities.provider,
      combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider }, []);
    const hooks: GrappleHooks = {
      pose: actor => { const view = this.playerView(actor); return { angles: view.angles, hand: "right", viewHeight: view.viewHeight, gravity: this.player(actor)?.gravityMultiplier ?? 1, gravityVector: { x: 0, y: 0, z: -1 } }; },
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
        canAttach: (owner, target) => differentTeam(owner, target), canDamage: () => true, playerHit: target => this.playerClient(target) !== null,
      }, actor => this.grapple?.released(actor)) }, random, this.grappleSlotHost());
  }

  private async initializeQvmGrapple(): Promise<void> {
    const selection = this.recipe.equipment.grapple;
    if (selection.kind !== "enabled" || selection.mechanic !== "q3-qvm") return;
    const prepared = this.options.preparedQvmGrapple, realTime = this.options.weaponBehaviorRealTime;
    if (prepared === undefined || !isDeepStrictEqual(prepared.selection, selection) || realTime === undefined)
      throw new Error("Selected QVM grapple requires its exact prepared source and host clock");
    const primary = this.source.kind === "q3-qvm" ? this.source.game : null, primaryArtifact = this.options.q3Guest?.prepared.artifact;
    const primaryProfile = primaryArtifact === undefined ? null : q3GrappleProfile(primaryArtifact);
    const primaryCombat = primary === null || primaryArtifact === undefined || primaryProfile === null ? null : new QvmGameCombat(primary.game, primaryArtifact, primaryProfile);
    const game = await QvmGrappleSource.create({ artifact: prepared.artifact, profile: selection.profile, provider: selection.source.provider, mounts: prepared.mounts,
      actors: this.actors, bodies: this.bodies, scene: this.scene, context: { session: this.session, origin: { kind: "server-console" } },
      seed: this.options.seed, entityText: this.options.world.entities, binding: selection.binding, realTime, assertCurrent: () => this.assertOpen(),
      event: event => this.events.emit(selection.source.content, { kind: "q3-source", event }, this.grappleFrame.time),
      damage: hit => {
        this.combat.apply({ target: hit.target, amount: hit.amount, knockback: (hit.flags & 4) !== 0 ? 0 : hit.amount,
        direction: hit.direction, point: hit.point, normal: zero, delivery: "direct", attack: { sequence: this.attackSequence++, time: this.grappleFrame.time,
          attacker: hit.attacker, inflictor: hit.inflictor, weapon: "q3:weapon_grapplinghook", weaponProvider: selection.source.provider,
          combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider, movementProvider: this.recipe.movement.provider,
          cause: { kind: "q3", meansOfDeath: hit.method, damageFlags: hit.flags } } }); },
      velocity: (actor, velocity) => {
        const owner = this.actors.resolveOwned(actor), body = this.bodies.read(actor);
        if (owner === null || body === null) return;
        if (body.velocity.x === velocity.x && body.velocity.y === velocity.y && body.velocity.z === velocity.z) return;
        if (this.source.kind === "q2-native") this.nativeEquipmentVelocity.set(actor, velocity);
        else this.bodies.write(owner, { ...body, velocity, ground: null });
        if (this.source.kind === "q3-qvm") {
          const native = this.source.game.players().find(entry => entry.actor.equals(actor));
          if (native !== undefined) { const data = this.source.game.game.data, state = data.copyPlayerState(native.sourceEntity); data.writePlayerState(native.sourceEntity, { ...state, velocity, groundEntityNumber: 1023 }); }
        }
        const player = this.player(actor);
        if (player !== null) {
          player.ground = { kind: "none" };
          player.state = player.state.kind === "q2-classic" ? { ...player.state, velocityEighths: [Math.trunc(velocity.x * 8), Math.trunc(velocity.y * 8), Math.trunc(velocity.z * 8)] }
            : { ...player.state, velocity };
        }
      },
      targets: () => this.actors.observations().flatMap<QvmGrappleTarget>(observation => {
        if (observation.owner === selection.source.provider || this.worldActor()?.equals(observation.id)) return [];
        const actor = observation.id, body = this.bodies.read(actor), combat = this.combat.read(actor), player = this.player(actor);
        if (body === null) return [];
        const slot = primary?.records.slot(actor) ?? null, nativeCombat = slot === null || primaryCombat === null ? undefined : primaryCombat.state(slot);
        if (nativeCombat === null) return [];
        if (player === null && this.playerClient(actor) !== null && (this.source.kind === "q2-native" || this.source.kind === "q3-qvm")) {
          const view = this.playerView(actor), state = this.source.kind === "q3-qvm" ? this.source.game.records.player(this.source.game.records.requireSlot(actor)) : null;
          const health = nativeCombat?.health ?? (state?.stats[0] ?? this.nativePlayerUi(actor).health), team = state?.persistent[3];
          return [{ actor, body: { ...body, angles: view.angles }, health, kind: "player", viewHeight: view.viewHeight, team: team === 1 ? "red" : team === 2 ? "blue" : team === 3 ? "spectator" : "free", userinfo: this.sourcePlayerUserinfo(actor) ?? "\\name\\Player\\ip\\localhost\\model\\sarge/default" }];
        }
        if (player === null) return [{ actor, body, health: nativeCombat?.health ?? combat?.health ?? 0, kind: "actor", mover: this.grappleAnchor(actor) === "brush" }];
        const team = combat?.team?.toLowerCase();
        return [{ actor, body: { ...body, angles: player.viewAngles }, health: combat?.health ?? 0, kind: "player", viewHeight: player.viewHeight,
          userinfo: this.sourcePlayerUserinfo(actor) ?? "\\name\\Player\\ip\\localhost\\model\\sarge/default\\handicap\\100", team: team === "red" || team === "blue" ? team : "free" }];
      }) });
    this.grapple = new GrappleRuntime(selection, { kind: "q3-qvm", game, core: game.core }, new SourceRandom(this.options.seed, "classic"), this.grappleSlotHost());
    const saved = this.pendingQvmGrappleRestore; this.pendingQvmGrappleRestore = null;
    if (saved === null) for (const actor of this.players()) { if (this.source.kind === "q2-native" || this.source.kind === "q3-qvm") this.requireEquipmentPlayer(actor); else this.admitGrapple(actor); }
    else {
      this.grapple.restore(saved.grapple);
      if (this.source.kind === "q2-native" || this.source.kind === "q3-qvm") for (const entry of saved.grapple.controls) this.nativeEquipmentPlayers.add(this.actors.referenceSaved(entry.actor));
      for (const entry of saved.slots) { const actor = this.actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Saved grapple slot actor is missing"); this.bindWeaponSlot(actor.id, entry.state); }
    }
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

  private stepHandGrenade(actor: ActorId, lifecycle: "alive" | "dead" | "removing" = "alive"): undefined {
    const equipment = this.handGrenades;
    if (equipment === null) return undefined;
    const input = this.equipmentWeaponInput(actor), view = this.playerView(actor);
    return equipment.step(actor, { angles: view.angles, gravity: this.physics.gravity * (this.player(actor)?.gravityMultiplier ?? 1),
      quadUntil: providerFamily(this.recipe.combat.provider) === "q1" ? 0 : input.quadUntil,
      doubleUntil: input.doubleUntil, quadFireUntil: input.quadFireUntil, haste: input.haste,
      noStackDouble: input.noStackDouble, playersCollide: input.playersCollide, lifecycle,
      project: (angles, offset) => projectQ2Actor(actor, equipment.controller.game,
        { hand: input.hand, viewHeight: view.viewHeight, playersCollide: input.playersCollide }, angles, offset) }, this.equipmentPlayerAvailable(actor) && !input.spectator);
  }

  installRereleaseNavigation(navigation: ApplicationBotNavigation): void {
    this.assertOpen();
    if (this.nativeNavigation !== null && this.nativeNavigation !== navigation) throw new Error("Native navigation already belongs to this world");
    this.nativeNavigation = navigation;
  }
  rereleaseNavigation(): ApplicationBotNavigation | null { return this.nativeNavigation; }
  private nativeModContext(): NativeModHostContext | undefined {
    const clock = this.options.weaponBehaviorClock;
    if (clock === undefined) return undefined;
    return { scene: this.scene, mapPath: this.recipe.map.geometry.requestedPath, maxClients: this.options.maxClients,
      frameMilliseconds: 25, skill: this.options.skill, mode: this.options.mode, gravity: this.physics.gravity,
      clock, navigation: this.rereleaseNavigationServices(),
      engine: (source, runtime) => this.q2ActorHost(source, runtime, () => undefined),
      collision: (actor, collision) => this.physics.setCollision(actor, collision) };
  }
  private rereleaseNavigationServices(): RereleaseNavigationServices {
    return { runtime: () => this.nativeNavigation?.runtime ?? null,
      moveToPoint: (actor, point, tolerance) => this.botServices.moveToPoint(actor, point, tolerance),
      followActor: (actor, target) => this.botServices.followActor(actor, target) };
  }
  private async createQvmWeaponBehavior(entry: Extract<PreparedWeaponBehavior, { readonly kind: "qvm" }>): Promise<QvmWeaponBehaviorSource> {
    const realTime = this.options.weaponBehaviorRealTime;
    if (realTime === undefined) throw new Error("QVM weapon components require host calendar services");
    const teamMode = this.teamGame();
    return QvmWeaponBehaviorSource.create({ artifact: entry.artifact, profile: entry.profile, mounts: entry.mounts,
      scene: this.scene, context: { session: this.session, origin: { kind: "server-console" } }, seed: this.options.seed,
      entityText: this.options.world.entities, mode: this.options.mode, teamMode, realTime,
      assertCurrent: () => this.assertOpen(), print: text => { this.events.message({ kind: "print", level: 2, text }); },
      targets: () => this.actors.observations().flatMap<QvmWeaponTarget>(owned => {
        const actor = owned.id, body = this.bodies.read(actor), combat = this.combat.read(actor);
        if (body === null) return [];
        const target = { actor, body, health: combat?.health ?? 0 }, client = this.playerClient(actor);
        if (client === null) return [{ ...target, kind: "actor" }];
        const userinfo = this.sourcePlayerUserinfo(actor) ?? "", info = q2Userinfo(userinfo);
        const spectator = info.get("spectator") === "1" || info.get("team") === "spectator" || info.get("team") === "s";
        const sourceTeam = combat?.team?.toLowerCase();
        const team = spectator ? "spectator" : !teamMode ? "free" : sourceTeam === "red" ? "red" : sourceTeam === "blue" ? "blue" : null;
        if (team === null) throw new Error(`QVM weapon component cannot represent source team ${combat?.team ?? "unassigned"}`);
        return [{ ...target, kind: "player", userinfo, team }];
      }) });
  }

  private async createNativeWeaponBehavior(entry: Extract<PreparedWeaponBehavior, { readonly kind: "rerelease-native" }>, nextFrame: () => Promise<void>): Promise<RereleaseWeaponBehaviorSource> {
    const clock = this.options.weaponBehaviorClock;
    if (clock === undefined) throw new Error("Native weapon components require host clock capabilities");
    const reference = entry.selection.source, timing = nativeProviderTiming(reference, "q2", true);
    const cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: this.session, origin: { kind: "server-console" } },
      print: text => this.events.message({ kind: "print", level: 2, text }) });
    for (const [name, value] of Object.entries({ maxclients: String(this.options.maxClients), skill: String(this.options.skill),
      deathmatch: this.options.mode === "deathmatch" ? "1" : "0", coop: this.options.mode === "coop" ? "1" : "0", sv_gravity: String(this.physics.gravity) })) cvars.register(name, value);
    const random = new SourceRandom(this.options.seed, "q2-rerelease");
    const runtime: ActorHostRuntime = { numeric: timing.numeric, random, now: () => this.timeSeconds, frameSeconds: () => 0.025,
      schedule: () => { throw new Error("Native weapon callbacks must use their component's source scheduler"); } };
    const localization = await loadServerLocalizationResources("english", async path => (await entry.mounts.open(path))?.bytes ?? null, "q2-rerelease");
    const unsupported = (): never => { throw new Error("Native weapon component cannot mutate primary world ownership"); };
    return RereleaseWeaponBehaviorSource.create({ prepared: entry.prepared, declaration: entry.declaration, clock, nextFrame,
      map: { map: this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, "rerelease", this.options.mode), spawnPoint: "" },
      ownership: { inventory: "source-private", presentation: "selected-weapon" },
      services: { engine: this.q2ActorHost(reference, runtime, () => undefined), scene: this.scene, cvars, numeric: createNumericOperations(timing.numeric),
        mapPath: this.recipe.map.geometry.requestedPath, maxClients: this.options.maxClients, frameMilliseconds: 25,
        admit: unsupported, collision: unsupported, command: () => ({ arguments: [], args: "" }), addCommand: unsupported, debugGraph: unsupported,
        print: text => this.events.message({ kind: "print", level: 2, text }), localize: (key, arguments_) => q2LocalizedText(localization, key, arguments_),
        clipboard: { kind: "dedicated" }, debugShapes: unsupported, worldText: unsupported, navigation: this.rereleaseNavigationServices() },
      actor: id => {
        const actor = this.actors.resolveOwned(id), body = this.bodies.read(id);
        if (actor === null || body === null) throw new Error("Native weapon component references an unavailable shared actor");
        const player = this.playerClient(id) !== null, view = player ? this.playerView(id) : null;
        return { actor, body, viewAngles: view?.angles ?? body.angles, viewHeight: view?.viewHeight ?? 0,
          userinfo: player ? this.sourcePlayerUserinfo(id) ?? "" : "" };
      } });
  }

  private createSource(loading?: typeof nativeLoading): SourceRuntime {
    const recipe = this.recipe, content = recipe.map.entities.content, campaign = recipe.campaign.kind === "campaign" ? recipe.campaign.mission.provider : recipe.map.entities.provider;
    const timing = providerTiming(recipe, recipe.map.entities.provider);
    const native = this.options.q2Guest;
    if (native !== undefined) {
      const retained = this.options.nativeQ2Travel;
      if (retained !== undefined && (retained.edition !== native.edition || this.options.restore !== undefined || !isDeepStrictEqual(retained.world.module, { id: native.prepared.execution.owner.provider, artifactPath: native.prepared.execution.artifact.requestedPath, digest: native.prepared.execution.artifact.digest, revision: native.prepared.execution.artifact.digest }) || retained.world.services.options.maxClients !== this.options.maxClients)) throw new Error("Native travel requires the same source module and client capacity");
      const cvars = retained?.world.services.options.cvars ?? (this.options.restore === undefined ? this.options.sourceRegistry : undefined) ?? new CvarRegistry({ dialect: native.edition === "classic" ? "q2-classic" : "q2-rerelease", context: { session: this.session, origin: { kind: "server-console" } }, print: native.print });
      if (retained === undefined && this.options.sourceRegistry === undefined) cvars.applyArchive(this.options.sourceArchive ?? []);
      if (retained === undefined) for (const [name, value] of Object.entries({ maxclients: String(this.options.maxClients), skill: String(this.options.skill), deathmatch: this.options.mode === "deathmatch" ? "1" : "0", coop: this.options.mode === "coop" ? "1" : "0", sv_gravity: "800", sv_airaccelerate: "0" })) {
        if (cvars.find(name) === undefined) cvars.register(name, value);
        cvars.set(name, value, true);
      }
      if (this.options.restore === undefined) cvars.set("nextserver", this.options.q2NextServer ?? "", true);
      this.q2ServerRegistry = cvars;
      this.initializeServerSettings(cvars);
      if (this.options.restore !== undefined) restoreQ2ServerCvars(cvars, savedSourceCvars(this.options.restore));
      const runtime: ActorHostRuntime = { numeric: timing.numeric, random: this.random, now: () => this.timeSeconds, frameSeconds: () => native.edition === "classic" ? 0.1 : 0.025,
        schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) };
      const services: ClassicGuestServicesOptions = {
        pickups: this.originalPickups,
        damageProvenance: () => ({ sequence: this.attackSequence++, time: { kind: "seconds", value: this.timeSeconds }, weapon: null,
          weaponProvider: recipe.map.entities.provider, combatProvider: recipe.combat.provider,
          inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider }),
        engine: this.q2ActorHost(recipe.map.entities, runtime, () => undefined, "primary-world"), scene: this.scene, cvars, numeric: createNumericOperations(timing.numeric),
        mapPath: recipe.map.geometry.requestedPath, maxClients: this.options.maxClients,
        admit: (record, actor) => { this.actors.assertOwned(actor); if (record.currentActor()?.equals(actor.id) !== true) throw new Error("Native actor projection lost shared identity"); return undefined; },
        collision: (actor, collision) => this.physics.setCollision(actor, collision), print: native.print,
        command: () => ({ arguments: [], args: "" }), addCommand: native.addCommand, debugGraph: native.debugGraph,
      };
      const map = { map: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, native.edition, this.options.mode), spawnPoint: this.initialSpawnPoint };
      if (native.edition === "rerelease") {
        if (retained !== undefined && retained.edition !== "rerelease") throw new Error("Native travel edition changed");
        const rrServices: RereleaseGuestServicesOptions = { ...services, engine: this.q2ActorHost(recipe.map.entities, runtime, () => undefined, "primary-world"),
          ...(retailRereleaseClientProfile.authority.kind === "artifact" && native.prepared.execution.artifact.digest === retailRereleaseClientProfile.authority.digest && native.semanticBindings === undefined
            ? { foreignDamage: { provenance: () => ({ sequence: this.attackSequence++, time: { kind: "seconds", value: this.timeSeconds }, weapon: null,
              weaponProvider: recipe.map.entities.provider, combatProvider: recipe.combat.provider, inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider }) } } : {}),
          frameMilliseconds: 25, localize: native.localize, clipboard: native.clipboard,
          debugShapes: event => this.submitDebugShapes(event),
          worldText: event => this.worldTextStore.submit({ ...event.text, content }, this.timeSeconds, event.lifetime),
          navigation: this.rereleaseNavigationServices(),
          ...(native.semanticBindings === undefined ? {} : { semanticBindings: native.semanticBindings }) };
        const visited = new Map<string, Q2RereleaseVisitedLevel>(retained?.visited ?? []);
        const level = cvars.variableValue("deathmatch") === 0 ? visited.get(recipe.map.geometry.requestedPath) : undefined;
        const revisit = level === undefined ? undefined : { level: level.level, restoreServerState: (world: RereleaseGuestWorld) => {
          world.restoreConfigstrings(new Map(level.configstrings.map(entry => [entry.index, entry.value])));
          for (const { portal, open } of level.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
        } };
        if (retained !== undefined && loading === nativeLoading) this.pendingNativeTravel = async nextFrame => ({ kind: "q2-native", edition: "rerelease",
          game: await retained.world.travelLoading(map, rrServices, nextFrame, revisit), visited, clients: new Map<ClientId, OwnedActor>() });
        const game = retained === undefined ? RereleaseGuestWorld.create({ prepared: native.prepared, capabilities: native.capabilities, services: rrServices })
          : loading === nativeLoading ? retained.world : retained.world.travel(map, rrServices, revisit);
        return { kind: "q2-native", edition: "rerelease", game, visited, clients: new Map<ClientId, OwnedActor>() };
      }
      if (retained !== undefined && retained.edition !== "classic") throw new Error("Native travel edition changed");
      const files = retained?.files ?? new ClassicOriginalSaveFiles(native.capabilities.openFile);
      const visited = new Map<string, Q2ClassicVisitedLevel>(retained?.visited ?? []);
      const revisit = cvars.variableValue("deathmatch") === 0 ? visited.get(recipe.map.geometry.requestedPath) : undefined;
      if (retained !== undefined && loading === nativeLoading) this.pendingNativeTravel = async nextFrame => ({ kind: "q2-native", edition: "classic", files, visited, clients: new Map<ClientId, OwnedActor>(), game: await (revisit === undefined
        ? retained.world.travelLoading(map, services, nextFrame)
        : files.withTravelLevelLoading(revisit.level, levelPath => retained.world.travelLoading(map, services, nextFrame, { levelPath, restoreServerState: world => {
          world.restoreConfigstrings(new Map(revisit.configstrings.map(entry => [entry.index, entry.value])));
          for (const { portal, open } of revisit.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
        } }))) });
      const game = retained === undefined ? ClassicGuestWorld.create({ prepared: native.prepared, capabilities: { ...native.capabilities, openFile: files.openFile }, services })
        : loading === nativeLoading ? retained.world
        : revisit === undefined ? retained.world.travel(map, services)
        : files.withTravelLevel(revisit.level, levelPath => retained.world.travel(map, services, { levelPath, restoreServerState: world => {
          world.restoreConfigstrings(new Map(revisit.configstrings.map(entry => [entry.index, entry.value])));
          for (const { portal, open } of revisit.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
        } }));
      return { kind: "q2-native", edition: "classic", game, files, visited, clients: new Map<ClientId, OwnedActor>() };
    }
    const guest = this.options.q3Guest;
    if (guest !== undefined) {
      const now = () => Math.trunc(this.timeSeconds * 1000);
      const state = new Q3ServerState({ session: this.session, now, print: guest.print,
        settings: { gameType: 0, singlePlayer: false, maxClients: this.options.maxClients,
          mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
          ...(this.options.restore !== undefined || this.options.sourceRegistry === undefined ? {} : { sourceRegistry: this.options.sourceRegistry }),
        ...(this.options.restore !== undefined || this.options.sourceArchive === undefined ? {} : { sourceArchive: this.options.sourceArchive }),
          ...(this.options.q3Cvars === undefined ? {} : { cvars: this.options.q3Cvars }) } });
      state.cvars.set("fs_game", guest.gameDirectory, true);
      this.initializeServerSettings(state.cvars);
      let combatBindings: QvmCombatBindings | null = null;
      let pickupBindings: QvmPrimaryPickups | null = null;
      const nativeInventory = q3NativeInventoryProfile(guest.prepared.artifact);
      const game = new Q3QvmServerGame({ artifact: guest.prepared.artifact, state,
        records: { actors: this.actors, bodies: this.bodies, scene: this.scene, provider: recipe.map.entities.provider,
          admit: actor => {
            combatBindings?.admit(actor);
            const slot = game.records.slot(actor.id);
            if (nativeInventory !== null && slot !== null && slot < game.game.data.numClients) {
              const saved = this.options.restore?.inventories.find(entry => this.actors.resolveSaved(entry.actor) === actor);
              this.bindSourceInventory(actor, qvmInventoryBinding({ module: game.game.module, data: game.game.data,
                profile: nativeInventory, weapons: guest.prepared.weapons, client: () => {
                  this.actors.assertOwned(actor);
                  const current = game.records.slot(actor.id);
                  if (current === null || game.records.isInputRetired(current)) throw new Error("QVM inventory owner is no longer admitted");
                  return current;
                } }), saved?.entries ?? []);
            }
          },
          collision: (actor, collision) => this.physics.setCollision(actor, collision) },
        mounts: this.options.mounts, writable: guest.writable, common: guest.common,
        maxClients: this.options.maxClients, seed: this.options.seed, dedicated: this.options.dedicated === true, entityText: this.options.world.entities,
        now, assertCurrent: () => { this.assertOpen(); }, clientChanged: (kind, actor) => this.notifyClientEvent(kind, actor),
        beforeRetire: () => { pickupBindings?.close(); combatBindings?.close(); },
        botCommand: (actor, command) => this.observeClientCommand({ actor, source: { kind: "bot", provider: guest.prepared.artifact.module.id },
          sequence: (this.modClientCommands.get(actor)?.input.sequence ?? 0) + 1, command: { kind: "q3", serverTimeMilliseconds: command.serverTime,
            angleWords: command.angles, buttons: command.buttons, weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove } }),
        beforeDisconnect: actor => {
          this.notifyClientEvent("disconnecting", actor);
          if (this.actors.isLive(actor)) { this.grapple?.release(actor); this.stepHandGrenade(actor, "removing"); }
        } });
      const nativeCombat = q3NativeCombatProfile(guest.prepared.artifact);
      if (nativeCombat !== null) combatBindings = new QvmCombatBindings({ game: game.game, artifact: guest.prepared.artifact, definition: nativeCombat,
        bodies: this.bodies, combat: this.combat, slot: actor => game.records.slot(actor), source: {
          actors: this.actors,
          actor: slot => { const reference = game.records.reference(slot); return reference === null ? null : this.actors.resolveOwned(reference); },
          provenance: () => ({ sequence: this.attackSequence++, time: { kind: "milliseconds", value: now() }, weapon: null,
            weaponProvider: recipe.map.entities.provider, combatProvider: recipe.combat.provider,
            inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider }),
          afterFree: (pointer, call) => pickupBindings?.afterFree(pointer, call),
        } });
      const nativePickups = q3NativePickupProfile(guest.prepared.artifact);
      if (nativePickups !== null) pickupBindings = new QvmPrimaryPickups({ game: game.game, artifact: guest.prepared.artifact, profile: nativePickups,
        actor: slot => game.records.isInputRetired(slot) ? null : this.actors.atSource(recipe.map.entities.provider, slot),
        current: (actor, slot) => this.actors.resolveOwned(actor.id) === actor && game.records.slot(actor.id) === slot && !game.records.isInputRetired(slot),
        resolveItem: record => {
          const weapon = guest.prepared.weapons.find(weapon => weapon.weapon === record.tag);
          const item: ItemId = record.type === nativePickups.items.weaponType ? weapon?.item ?? `q3:${record.className}`
            : record.type === nativePickups.items.ammoType ? weapon?.ammo ?? `q3:${record.className}` : `q3:${record.className}`;
          return { item, resource: record.type === ItemType.IT_ARMOR ? { kind: "protection", channel: "regular" }
            : record.type === nativePickups.items.weaponType || record.type === nativePickups.items.ammoType ? { kind: "inventory", item } : null };
        },
        time: () => ({ kind: "milliseconds", value: now() }), runSource: (offer, execute) => this.originalPickups.runSource(offer, execute),
        lifetime: combatBindings === null ? { kind: "own-free-hook", retire: actor => {
          if (this.actors.resolveOwned(actor.id) === actor) this.actors.release(actor);
        } } : { kind: "shared-free-hook" },
      });
      if (this.options.restore !== undefined) {
        const checkpoint = simulationQvmCheckpoint(this.options.restore);
        if (checkpoint === null) throw new Error("Saved Q3 guest memory is missing");
        game.restoreCheckpoint(checkpoint, saved => {
          const client = this.options.restoredClients?.find(client => client.slot === saved.slot);
          if (client === undefined || !this.options.identity.owns(client)) throw new Error("Saved Q3 guest client has no mapped session identity");
          return client;
        });
      }
      return { kind: "q3-qvm", game, combat: combatBindings, inventory: nativeInventory };
    }
    if (this.options.preparedQuakeC !== undefined) {
      const checkpoint = this.options.restore === undefined ? null : simulationQuakeCCheckpoint(this.options.restore);
      const game: QuakeCSource = new QuakeCSource(this.options.preparedQuakeC, { ...(this.options.sourceRegistry === undefined ? {} : { sourceRegistry: this.options.sourceRegistry }), recipe, world: this.options.world, scene: this.scene,
        ...(this.options.originalSaveCandidate === true ? { originalSaveCandidate: true } : {}),
        actors: this.actors, callbacks: this.callbacks, physics: this.physics, combat: this.combat, inventory: this.inventory, pickups: this.originalPickups, events: this.events,
        random: this.random, skill: this.options.skill, mode: this.options.mode, maxClients: this.options.maxClients,
        initialSourceTimeSeconds: this.timeSeconds,
        ...(qcWeaponStage(this.options.preparedQuakeC.program) === null ? {} : { primaryWeaponSelected: (actor: ActorId) => this.selectedArsenal === null && (this.weaponSlots.get(actor)?.primarySelected() ?? true) }),
        ...(checkpoint === null ? {} : { restore: { checkpoint, clients: this.options.restoredClients ?? [] } }),
        admit: (actor, _slot, source) => this.registerActorExecution({ kind: "quakec", actor, source, content }),
        changeLevel: map => {
          const campaign = recipe.campaign;
          this.transitions.push(campaign.kind === "campaign"
            ? { kind: "campaign-level", campaign: campaign.mission.provider, map: `q1:${map}`, spawnPoint: "", gates: [], cause: null }
            : { kind: "match-rotation", match: recipe.match.provider, map: `q1:${map}` });
          return undefined;
        },
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
    if (recipe.map.entities.provider.startsWith("q3:")) {
      const product = selectedSourceProgram(recipe) === "missionpack" ? "missionpack" : "baseq3";
      const host = createQ3SourceHost({ actors: this.actors, bodies: this.bodies, callbacks: this.callbacks, combat: this.combat, inventory: this.inventory,
        grantSelectedArsenal: (actor, category) => this.grantSelectedArsenal(actor, category),
        giveSelectedItem: (actor, args) => this.giveSelectedItem(actor, args),
        scene: this.scene, deathAnimations: this.deathAnimations, bots: this.botServices.source,
        now: () => Math.trunc(this.timeSeconds * 1000), schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due / 1000),
        runThink: actor => { this.scheduler.run(actor.id, { ...this.sourceFrame, phase: "entity-think" }, "during-physics"); return undefined; },
        collision: (actor, collision) => this.physics.setCollision(actor, collision), armorContext: request => this.victimArmorContext(request),
        primaryAttackAllowed: actor => this.selectedArsenal === null && (this.weaponSlots.get(actor)?.primarySelected() ?? true),
        admitPickup: item => this.admitSelectedQ3Pickup(item),
        originalPickups: this.originalPickups,
        ammoTimerStored: (actor, weapon, value) => this.selectedAmmoTimers?.stored(actor, weapon, value),
        timerOwnership: actor => ({ ordinaryDecay: true, ammo: this.selectedAmmo(actor) }),
        speedMultiplier: actor => {
          if (this.selectedQ3Source?.ownsEquipment === true) return this.selectedQ3Source.speedMultiplier(actor);
          const client = this.source.kind === "q3" ? this.source.game.records.nativeByActor(actor)?.client : null;
          if (client == null) throw new Error("Q3 movement speed lost its client");
          return clientSpeedMultiplier(client.ps);
        },
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
          return relativeQ3SourceCommand(input.source, input.command.kind, command, delta, input.angleSpace);
        },
        spawnPlayer: (entity, pose) => this.spawnQ3Player(entity, pose), moveClient: (entity, command, options) => this.moveQ3Client(entity, command, options),
        emit: event => { this.events.emit(content, { kind: "q3-source", event }); }, clientNumber: actor => this.requirePlayer(actor).client.slot,
      }, { gameType: this.options.mode === "singleplayer" ? 2 : 0, singlePlayer: this.options.mode === "singleplayer", maxClients: this.options.maxClients,
        mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        ...(this.options.restore !== undefined || this.options.sourceRegistry === undefined ? {} : { sourceRegistry: this.options.sourceRegistry }),
        ...(this.options.restore !== undefined || this.options.sourceArchive === undefined ? {} : { sourceArchive: this.options.sourceArchive }),
        ...(this.options.q3Cvars === undefined ? {} : { cvars: this.options.q3Cvars }) });
      const saved = this.options.restore;
      if (saved === undefined) {
        for (const definition of q3GameCvarDefinitions(product)) host.cvars.register(definition.name, definition.value, definition.flags);
        this.initializeServerSettings(host.cvars);
      }
      const objectives = adaptForeignQ3Objectives(this.options.world, product, host.cvars.variableValue("g_gametype"));
      if (objectives.kind !== "ready") throw new Error(`Selected Q3 objectives are unavailable: ${JSON.stringify(objectives)}`);
      return { kind: "q3", game: new Q3SourceRuntime({ recipe, weaponBehavior: this.weaponBehavior, weaponProvider: this.weaponProvider, product, entities: objectives.entities,
        seed: this.options.seed, maxClients: this.options.maxClients, buildDate: "TypeScript port",
        ...(this.options.q3Session === undefined ? {} : { sessionCarry: this.options.q3Session }) }, host,
        saved === undefined ? { kind: "new" } : { kind: "restore", state: decodeCheckpointValue(simulationProviderCheckpoint(saved, "q3:native").bytes) }) };
    }
    if (this.options.world.kind === "q1-bsp") {
      const host = this.q1ActorHost(recipe.map.entities, actorRuntime, "primary-world");
      const cvars = this.options.sourceRegistry ?? new CvarRegistry({ dialect: "q1-netquake", context: { session: this.session, origin: { kind: "server-console" } },
        print: text => { this.events.message({ kind: "print", level: 2, text }); } });
      if (this.options.restore === undefined && this.options.sourceRegistry === undefined) cvars.applyArchive(this.options.sourceArchive ?? []);
      if (this.options.sourceRegistry === undefined) for (const [name, value] of Object.entries({ skill: String(this.q1Campaign.skill), deathmatch: this.options.mode === "deathmatch" ? "1" : "0", coop: this.options.mode === "coop" ? "1" : "0",
        teamplay: "0", sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", sv_cheats: "0", footsteps: "1" })) cvars.register(name, value);
      cvars.set("skill", String(this.q1Campaign.skill), true);
      cvars.set("deathmatch", this.options.mode === "deathmatch" ? "1" : "0", true);
      cvars.set("coop", this.options.mode === "coop" ? "1" : "0", true);
      this.initializeServerSettings(cvars);
      const savedCvars = this.options.restore === undefined ? undefined : savedSourceCvars(this.options.restore);
      if (savedCvars !== undefined) cvars.restoreSaveState(savedCvars);
      if (recipe.match.provider === "q1:horde" && this.options.restore === undefined) {
        if (cvars.find("horde") === undefined) cvars.register("horde", "0");
        cvars.set("horde", "1", true);
      }
      const services: Q1CompositionServices = { sharedGrapple: this.sharedGrapple(),
        cvar: name => cvars.variableValue(name), setCvar: (name, value) => { cvars.set(name, value, true); if (name === "sv_gravity") this.setWorldGravity(cvars.variableValue(name)); if (name === "skill") { const skill = cvars.variableValue(name); if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Q1 skill must be 0..3"); this.q1Campaign.skill = skill; } return undefined; },
        emit: event => { if (event.kind === "level-presentation") return this.events.emit(content, { kind: "q1-level", event: event.event });
          if (event.kind === "addon") return this.emitQ1Addon(content, event.event, this.sourceFrame.time);
          return this.events.emit(content, { kind: "q1-composition", event }); },
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
        cheatArsenal: (actor, category) => category === undefined
          ? this.grantSelectedArsenal(actor, "weapons") && this.grantSelectedArsenal(actor, "ammo") : this.grantSelectedArsenal(actor, category),
        giveSelectedItem: (actor, args) => this.giveSelectedItem(actor, args),
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
      const program = selectedSourceProgram(recipe);
      if (program !== "id1" && program !== "hipnotic" && program !== "rogue" && program !== "dopa" && program !== "mg1" && program !== "mg3" && program !== "ctf") throw new Error(`Unsupported Q1 source program ${program}`);
      const composition = createQ1SourceComposition(host, { edition: content.includes(":rerelease:") ? "rerelease" : "classic", skill: this.q1Campaign.skill,
        physicsEdition: this.q1PhysicsEdition,
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
    const itemHooks: Q2ItemHooks = { ...(content.includes(":rerelease:")
      ? { weaponRespawnSeconds: () => serverCvars.variableValue("g_weapon_respawn_time") } : {}), weaponPicked: (actor, item, first) => {
      const state = weapons.states.get(actor), definition = weapons.registeredDefinitions().find(value => value.item === item);
      if (state !== undefined && definition !== undefined && first) state.pending = definition.name;
      return undefined;
    }, silencer: (actor, charges) => { if (this.source.kind !== "q2") throw new Error("Q2 silencer before source admission"); const source = this.q2ItemWeaponSource(); if (source === null) throw new Error("Q2 silencer has no arsenal source"); return source.weapons.grantSilencer(actor, source.game, charges); },
    powerArmor: (actor, kind) => this.events.message({ kind: "print", level: 2, text: `Power armor ${kind}\n` }, actor) };
    const playerHooks: Q2PlayerHooks = {
      persistentInventoryInitialized: entity => { this.pendingStartItems.add(entity.actor.id); return undefined; },
      grantSelectedArsenal: (actor, category) => this.grantSelectedArsenal(actor, category),
      giveSelectedItem: (actor, args) => this.giveSelectedItem(actor, args),
      weaponState: actor => { const source = this.q2ItemWeaponSource(), state = source?.weapons.states.get(actor);
        return source === null || state === undefined ? null : { q2Name: state.weapon,
          ammo: state.weapon === null ? null : source.weapons.definition(state.weapon).ammo, ...q2WeaponRecoil(state, source.game.options.edition, source.game.host.now()), loopSound: state.loopSound }; },
      movement: actor => { const player = this.requirePlayer(actor); return { viewAngles: player.viewAngles, commandAngles: player.commandAngles,
        waterLevel: player.waterLevel, waterType: player.waterType < 0 ? player.waterType === -3 ? 32 : player.waterType === -4 ? 16 : player.waterType === -5 ? 8 : 0 : player.waterType,
        grounded: player.ground.kind !== "none", ducked: player.bounds.max.z < player.standingBounds.max.z, buttons: player.buttons,
        standingBounds: player.standingBounds, animateQ2: player.character === "q2" }; },
      setMovement: (actor, change) => this.setPlayerMovement(actor, change),
      playerSpawned: entity => {
        if (this.selectedArsenal !== null) { weapons.resetSilencer(entity.actor.id); this.q2ItemWeaponSource()?.weapons.resetSilencer(entity.actor.id); }
        const player = this.requirePlayer(entity.actor.id);
        this.q1Characters.get(player.actor)?.respawn();
        if (this.selectedArsenal?.has(entity.actor.id)) {
          this.selectedArsenal.remove(entity.actor.id); player.arsenal = this.selectedArsenal.admit(entity.actor, 100, false);
        }
        this.selectedQ3Source?.respawn(entity.actor.id);
        this.handGrenades?.respawn(entity.actor.id); this.grapple?.release(entity.actor.id);
        if (this.selectedArsenal === null || this.selectedArsenal.has(entity.actor.id)) this.admitGrapple(entity.actor.id);
        if (this.pendingStartItems.has(entity.actor.id) && (this.selectedArsenal === null || this.selectedArsenal.has(entity.actor.id))) this.giveQ2StartItems(entity.actor.id);
        return undefined;
      },
      emit: event => { if (event.kind === "view") this.q2Views.set(event.actor, event.view); return this.events.emit(content, { kind: "q2-player", event }); },
      noise: (actor, origin) => { if (this.source.kind !== "q2") throw new Error("Q2 noise before source entry"); return this.source.monsters.reportNoise(actor, origin); }, weaponInput: actor => this.q2WeaponInput(this.requirePlayer(actor)), banned: () => false,
    };
    let owningMonsters: Q2ProductRuntime["monsters"] | null = null;
    const host = this.q2ActorHost(recipe.map.entities, actorRuntime, actor => owningMonsters?.context(actor)?.state, "primary-world");
    const serverCvars = this.options.sourceRegistry ?? new CvarRegistry({ dialect: content.includes(":rerelease:") ? "q2-rerelease" : "q2-classic",
      context: { session: this.session, origin: { kind: "server-console" } }, print: text => this.events.message({ kind: "print", level: 2, text }) });
    this.q2ServerRegistry = serverCvars;
    registerQ2ServerCvars(serverCvars, recipe.match.provider);
    if (this.options.restore === undefined && this.options.sourceRegistry === undefined) serverCvars.applyArchive(this.options.sourceArchive ?? []);
    for (const variable of this.options.q2Cvars ?? []) serverCvars.set(variable.name, variable.value, true);
    serverCvars.set("skill", String(this.options.skill), true);
    serverCvars.set("deathmatch", this.options.mode === "deathmatch" ? "1" : "0", true);
    serverCvars.set("coop", this.options.mode === "coop" ? "1" : "0", true);
    this.initializeServerSettings(serverCvars);
    if (this.options.restore === undefined) serverCvars.set("nextserver", this.options.q2NextServer ?? "", true);
    const savedCvars = this.options.restore === undefined ? undefined : savedSourceCvars(this.options.restore);
    if (savedCvars !== undefined) restoreQ2ServerCvars(serverCvars, savedCvars);
    const common: Q2CompositionCommon = { host, weapons, itemHooks, playerHooks, entityHooks,
      match: sourceQ2MatchSelection(recipe.match.provider, serverCvars, this.options.travel?.source.kind === "q2" ? this.options.travel.source.lmctf : undefined), playerRules: { spawnPoint: this.initialSpawnPoint },
      options: { mapName: recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
        skill: this.options.skill, mode: this.options.mode, deathmatchFlags: q2SourceDeathmatchFlags(serverCvars), maxClients: this.options.maxClients, provider: recipe.map.entities.provider,
        campaign, combatProvider: recipe.combat.provider, movementProvider: recipe.movement.provider, inventoryProvider: recipe.inventory.provider },
      services: { ...q2RereleaseItemServices(serverCvars), deathmatchFlags: { read: () => q2SourceDeathmatchFlags(serverCvars), write: flags => {
        const before = serverCvars.find("dmflags"), changed = Number(before?.value ?? 0) ^ flags;
        const desired = ((Number(before?.latchedValue ?? before?.value ?? 0) & ~changed) | (flags & changed)) >>> 0;
        serverCvars.set("dmflags", String(flags), true);
        if (desired !== flags) serverCvars.stage("dmflags", String(desired));
        return undefined;
      } }, sharedGrapple: this.sharedGrapple(), gravity: () => this.physics.gravity, hunterCamera: false, get strongMines() { return serverCvars.variableValue("g_dm_strong_mines") !== 0; },
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
    const selectedProgram = selectedSourceProgram(recipe);
    const program = selectedProgram === "ctf" || selectedProgram === "lmctf" ? "baseq2" : selectedProgram;
    let product: Q2ProductRuntime;
    if (content.includes(":rerelease:")) {
      if (program !== "baseq2" && program !== "xatrix" && program !== "rogue" && program !== "mg2" && program !== "n64") throw new Error(`Unsupported Q2 rerelease program ${program}`);
      const rereleaseHooks: Q2RereleaseHooks = {
        lightStyle: style => this.events.lightStyle(style),
        emit: event => { if (event.kind === "debug-shapes") return this.submitDebugShapes(event); if (event.kind === "world-text") { this.worldTextStore.submit({ ...event.text, content }, this.timeSeconds, event.lifetime); return undefined; } if (event.kind === "screen-blend") { const view = this.q2Views.get(event.actor); if (view !== undefined) this.q2Views.set(event.actor, { ...view, blend: event.blend }); } return this.events.emit(content, { kind: "q2-rerelease", event }); },
        playerIdentity: actor => { const identity = this.options.playerIdentity; if (identity === undefined) throw new Error("Q2 rerelease admission requires session seat identity"); return identity(this.requirePlayer(actor).client); },
        clipTrigger: (trigger, actor, game) => {
          const body = this.bodies.read(actor), brush = game.body(trigger), model = sourceModel(trigger.model);
          if (body === null || model === null) throw new Error("Exact Q2 trigger clipping requires a brush model and live player body");
          const trace = this.scene.trace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds },
            target: { kind: "model", model, origin: brush.origin, angles: brush.angles }, policy: { kind: "q2", contentsMask: -1, leafContents: "stored" },
            numeric: providerTiming(recipe, recipe.map.entities.provider).numeric, passActor: actor });
          return trace.startSolid || trace.allSolid;
        }, navigation: (start, goal, _actor) => {
          if (this.nativeNavigation === null) return { kind: "no-navigation" };
          const path = rereleasePathToGoal(this.nativeNavigation.runtime, { start, goal, flags: 0xffffffff, moveDistance: 0,
            ignoreNodeFlags: true, minHeight: 0, maxHeight: 0, radius: 0, dropHeight: 0, jumpHeight: 0 });
          return path.code < 5 ? { kind: "path", distanceSquared: path.distanceSquared, points: path.points } : { kind: "unreachable" };
        },
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
    if (savedCvars !== undefined) restoreQ2ServerCvars(serverCvars, savedCvars);
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
    if (providerFamily(id) === "q1") this.combat.register(this.selectedEquipmentCombat(createQ1CombatPolicy({ id, armor, sourceEffects: {
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
        const sourceScaled = selectedQ2Attack && request.attack.cause.kind === "q2" || this.selectedArsenal?.family === "q3" && request.attack.cause.kind === "q3"
          || this.source.kind === "q3" && this.selectedArsenal?.family === "q1" && request.attack.cause.kind === "q1";
        return sourceScaled && request.attack.weaponProvider === this.weaponProvider.provider && request.attack.weapon !== null ? { ...context, quad: false } : context;
      } })));
    else if (providerFamily(id) === "q2") this.combat.register(this.selectedEquipmentCombat(createQ2CombatPolicy({ id, armor,
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
      friendlyFire: this.q2ServerRegistry === null || (this.q2ServerRegistry.variableValue("dmflags") & 256) === 0, nuke: false, noKnockback: false, movable: !this.physics.isBrush(request.target), rejectTeamDamage: false, suppressPain: false }) })));
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
    return entry === undefined ? null : (entry.kind === "q3" || entry.kind === "q3-source") ? entry.provider : entry.kind === "quakec" ? this.recipe.map.entities.provider : entry.kind === "q1" ? entry.services.provider : entry.services.options.provider;
  }

  private q2WeaponTarget(actor: ActorId): Q2WeaponTarget | null {
    const owner = this.actors.resolveOwned(actor);
    if (owner === null) return null;
    const entry = this.actorExecutions.get(actor), native = entry?.kind === "q2" ? entry.entity : null;
    const collision = this.collision(owner), linked = this.scene.spatial.get(actor)?.collision;
    const solid = actor === this.worldActor() ? "brush" : (entry?.kind === "q3" || entry?.kind === "q3-source") || entry === undefined && this.player(actor) === null
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
    const source = this.actors.sourceOf(actor), native = this.source.kind === "q2-native" && source?.provider === this.source.game.module.id
      ? this.source.game.services.notarget(source.slot) : this.source.kind === "quakec" ? this.source.game.notarget(actor)
        : this.source.kind === "q3-qvm" ? this.source.combat?.notarget(actor) ?? null
          : this.source.kind === "q3" ? ((this.source.game.records.byActor(actor)?.flags ?? 0) & 32) !== 0 : null;
    return { viewHeight: player?.viewHeight ?? (entry?.kind === "q2" ? entry.entity.viewHeight : 25),
      notarget: native === true || this.source.kind === "q1" && this.source.composition.noTarget(actor)
        || (entry?.kind === "q1" ? (entry.entity.movementFlags & 128) !== 0 : entry?.kind === "q2" && (entry.entity.flags & (32 | (entry.services.options.edition === "rerelease" ? 0x1008000 : 0))) !== 0),
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
    if (player !== undefined && this.q1Characters.get(actor)?.presentation.solid === "none") return { family: "q1", solid: "none", model: null, owner: null };
    const entry = this.actorExecutions.get(actor.id);
    if (entry?.kind === "q2") return actorCollision(entry);
    if (player !== undefined) return { family: providerFamily(player.profile.id), solid: "box", model: null, owner: null };
    return entry === undefined ? null : actorCollision(entry);
  }

  private registerActorExecution(entry: ActorExecution): undefined {
    const actor = (entry.kind === "q3" || entry.kind === "q3-source") || entry.kind === "quakec" ? entry.actor : entry.entity.actor, previous = this.actorExecutions.get(actor.id);
    this.actors.assertOwned(actor);
    if (previous !== undefined && ((previous.kind === "q3" || previous.kind === "q3-source") || (entry.kind === "q3" || entry.kind === "q3-source") || previous.kind === "quakec" || entry.kind === "quakec" ? previous !== entry : previous.services !== entry.services)) throw new Error("Actor already has another source execution owner");
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
    const entry = this.actorExecutions.get(actor);
    if (entry?.kind === "q1" && entry.entity.fields.has("view_ofs")) return { origin: body.origin, viewOffset: entry.entity.vector("view_ofs") };
    if (this.playerClient(actor) !== null) {
      const view = this.playerView(actor);
      return { origin: body.origin, viewOffset: { x: view.origin.x - body.origin.x, y: view.origin.y - body.origin.y, z: view.origin.z + view.viewHeight - body.origin.z } };
    }
    if (entry?.kind === "q1" && entry.entity.monster !== null) {
      const eye = q1Creatures(entry.services).monsters.get(entry.entity.actor)?.eye();
      if (eye !== null && eye !== undefined) return { origin: eye, viewOffset: zero };
    }
    return { origin: body.origin, viewOffset: { x: 0, y: 0, z: this.monsterTarget(actor)?.viewHeight ?? 0 } };
  }

  private worldActor(): ActorId | null { return this.actors.atSource(this.recipe.map.entities.provider, this.recipe.map.entities.provider.startsWith("q3:") ? 1022 : 0)?.id ?? null; }
  private player(actor: ActorId | null): MovementPlayer | null { if (actor === null) return null; const owned = this.actors.resolveOwned(actor); return owned === null ? null : this.playerStates.get(owned) ?? null; }
  clientIdentities(): readonly ClientId[] {
    if (this.source.kind === "quakec" && this.source.game.kind === "netquake") return this.source.game.connectedClientIdentities();
    return this.source.kind === "q2-native" ? [...this.source.clients.keys()] : this.source.kind === "q3-qvm" ? this.source.game.players().map(player => player.client)
      : [...this.playerStates.values()].sort((a, b) => a.client.slot - b.client.slot).map(player => player.client);
  }
  players(): readonly ActorId[] { if (this.source.kind === "q2-native") return [...this.source.clients.values()].map(actor => actor.id); if (this.source.kind === "q3-qvm") return this.source.game.players().map(player => player.actor); return [...this.playerStates.values()].sort((a, b) => a.client.slot - b.client.slot).map(player => player.actor.id); }
  botEntity(actor: ActorId): { readonly classname: string; readonly model: string; readonly health: number; readonly spawnflags: number; readonly targetname: string; readonly hidden: boolean } | null {
    const entry = this.actorExecutions.get(actor);
    if (entry?.kind === "q1" || entry?.kind === "q2") return { classname: entry.entity.classname, model: entry.entity.model,
      health: this.combat.read(actor)?.health ?? 0, spawnflags: entry.entity.spawnflags, targetname: entry.entity.targetname,
      hidden: entry.kind === "q2" ? !entry.entity.visible : entry.entity.model.length === 0 };
    return null;
  }
  private classname(actor: ActorId): string { const entry = this.actorExecutions.get(actor); return this.playerClient(actor) !== null ? "player" : (entry?.kind === "q3" || entry?.kind === "q3-source") ? "q3:projectile" : entry?.kind === "quakec" ? entry.source.classname(actor) : entry?.entity.classname ?? ""; }

  private powerup(actor: OwnedActor, powerup: Q1Powerup, expires: number): undefined {
    if (powerup === "invulnerability") this.combat.setTraits(actor, { invulnerable: expires > this.timeSeconds
      || this.source.kind === "q1" && (this.source.composition.clients.get(actor.id)?.godMode ?? false) });
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
    const selectedClock = providerTiming(this.recipe, this.recipe.movement.provider).clock.kind;
    const mixedQc = source.kind === "quakec" && selectedClock !== (source.game.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake");
    const netQuake: NetQuakeClientBinding | undefined = source.kind === "quakec" && source.game.kind === "netquake" && !mixedQc ? {
      projection: { read: state => source.game.readClientState(actor.id, state), write: state => source.game.writeClientState(actor.id, state) },
      jumpAuthority: "source-gamecode", input: command => source.game.clientInput(actor.id, command),
      beforePhysics: () => { const before = source.game.clientArsenal(actor.id); source.game.clientPreThink(actor); this.projectQuakeCAttack(actor, before); return undefined; },
      think: frame => { const before = source.game.clientArsenal(actor.id); source.game.runThink(actor, frame); this.projectQuakeCAttack(actor, before); return undefined; }, afterPhysics: () => {
        const before = source.game.clientArsenal(actor.id);
        source.game.clientPostThink(actor); this.projectQuakeCAttack(actor, before); return undefined;
      },
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
    const player = new MovementPlayer(actor, client, this.recipe, {
      inputApplications: this.modClientApplications, acceptedInput: () => this.modClientCommands.get(actor.id) ?? null,
      ...(netQuake === undefined ? {} : { netQuake }),
      ...(source.kind !== "quakec" || !mixedQc ? {} : { sourceClient: {
        projectState: (state: MovementState) => source.game.isSpectatorClient(actor.id) ? quakeCFreeMovement(state) : state,
        beforeMovement: (input: ActorCommand, frame: FrameContext, sourceCommand?: QwUserCommand) => {
          const before = source.game.clientArsenal(actor.id), result = sourceCommand === undefined
            ? source.game.mixedClientPreThink(actor, input.command, frame)
            : source.game.mixedQuakeWorldPreThink(actor, sourceCommand, input.command, frame);
          this.projectQuakeCAttack(actor, before); return result;
        },
        afterMovement: (player: MovementPlayer, _frame: FrameContext, sourceCommand?: QwUserCommand): undefined => {
          const before = source.game.clientArsenal(actor.id);
          source.game.mixedClientPostThink(actor, player.ground, player.waterLevel, player.waterType, player.profile.kind, sourceCommand === undefined ? "immediate" : "deferred");
          this.projectQuakeCAttack(actor, before);
          player.arsenal = source.game.clientArsenal(actor.id);
          return undefined;
        },
      } }),
      ...(source.kind !== "quakec" || source.game.kind !== "quakeworld" || mixedQc ? {} : { quakeWorld: {
        read: (state: import("../../../contracts/movement.ts").QwMovementState) => source.game.readQuakeWorldState(actor.id, state),
        write: (state: import("../../../contracts/movement.ts").QwMovementState) => source.game.writeQuakeWorldState(actor.id, state),
        beforePhysics: (command: QwUserCommand, frame: FrameContext) => {
          const before = source.game.clientArsenal(actor.id); source.game.quakeWorldPreThink(actor, command, frame);
          this.projectQuakeCAttack(actor, before); return undefined;
        },
        water: (level: number, type: number) => source.game.quakeWorldWater(actor.id, level, type),
        profile: (profile: import("../../../contracts/movement.ts").QwMovementProfile) => source.game.quakeWorldProfile(actor.id, profile),
      } }), actors: this.actors, bodies: this.bodies, combat: this.combat, scene: this.scene, rereleaseMovement: this.physics.rereleaseMovement,
      q2MovementConfig: () => this.q2MovementConfig(),
      gibbed: () => this.q2Characters.get(actor)?.state.gibbed ?? (this.source.kind === "q2" && this.source.players.states.get(actor.id)?.gibbed === true),
      speedMultiplier: actor => {
        if (this.source.kind === "q3" && this.requirePlayer(actor.id).profile.kind === "q3") return 1;
        if (this.selectedQ3Source?.ownsEquipment === true) return this.selectedQ3Source.speedMultiplier(actor.id);
        const client = this.source.kind === "q3" ? this.source.game.records.nativeByActor(actor.id)?.client : null;
        return client == null ? 1 : clientSpeedMultiplier(client.ps);
      },
      fixedPose: actor => { const player = this.requirePlayer(actor.id); return this.selectedQ3Source?.fixedPose(actor, playerPostures(player)) ?? null; },
      weaponStep: input => this.weaponStep(input), animationStep: input => this.animationStep(input), touch: (contact, state) => this.touch(contact, state),
      sourcePunch: actor => this.source.kind === "quakec" && this.source.game.kind === "netquake" ? null : this.q1Punch.read(actor),
      worldActor: () => this.worldActor(), touchTriggers: owned => this.source.kind === "q3"
        || this.source.kind === "quakec" && this.source.game.kind === "quakeworld" && this.source.game.isSpectatorClient(owned.id)
        ? undefined : this.physics.touchTriggers(owned), isBrush: id => this.physics.isBrush(id), jump: (owned, action) => this.jump(owned, action),
      q3Hooks: { firing: context => (context.command.buttons & 1) !== 0 && context.motion.health > 0,
        animation: (request, context) => context.animation.state.kind === "q3" ? q3SourceAnimation(request, context) : { animation: context.animation, effects: [] }, torso: context => context.animation.state.kind === "q3" ? q3SourceTorso(11, context, true) : { animation: context.animation, effects: [] },
        weapon: context => { const result = context.services.weaponStep({ actor: context.input.actor, command: context.input.command, frame: context.frame,
          arsenal: context.arsenal, animation: context.animation, environment: context.input.environment, gauntletHit: this.playerStates.get(context.input.actor)?.sourceMovement?.gauntletHit ?? false }, context.state);
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
    this.notifyClientEvent("admitted", actor.id);
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
          emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event: { ...event, actor: event.actor.id } }),
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
      } else {
        const character = this.q1Characters.get(player.actor);
        if (character === undefined) this.attachQ1Character(player); else character.respawn();
      }
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
    this.notifyClientEvent("admitted", player.actor.id);
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
    const sourceBefore = pending === undefined ? before : relativeQ3SourceCommand(pending.source, pending.command.kind, before, client.ps.deltaAngles, pending.angleSpace);
    let input: ActorCommand = pending === undefined ? { actor: player.actor.id, sequence: player.lastSequence + 1,
      source: { kind: "bot", provider: this.recipe.map.entities.provider }, command: converted,
      ...(this.selectedArsenal === null ? {} : { arsenal: { provider: this.weaponProvider.provider, weapon: null,
        useHoldable: (command.buttons & CommandButtons.USE_HOLDABLE) !== 0 } }) }
      : applyQ3CommandPolicy(pending, sourceBefore, command, converted,
        client.ps.pmType === MoveType.PM_FREEZE || client.ps.pmType === MoveType.PM_INTERMISSION || client.ps.pmType === MoveType.PM_SPINTERMISSION);
    if (input.angleSpace === "absolute" && input.command.kind === "q3" && converted.kind === "q3")
      input = { ...input, angleSpace: "source-relative", command: { ...input.command, angleWords: converted.angleWords } };
    input = relativeMovementCommand(input, player.readState());
    player.sourceMovement = options;
    const lastSequence = player.lastSequence;
    const movementFrame = { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: elapsed } } satisfies FrameContext;
    const result = pending !== undefined && this.modClientApplications.active ? player.moveCommand(input, movementFrame) : player.move(input, movementFrame);
    if (pending === undefined) player.lastSequence = lastSequence;
    if (result.status !== "active") return { contacts: [], bounds: player.bounds, waterlevel: player.waterLevel, watertype: player.waterType, xyspeed: 0 };
    if (player.profile.kind === "q2-classic" || player.profile.kind === "q2-rerelease") {
      const weapon = this.weaponStep({ actor: player.actor, command: input.command, frame: { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: elapsed } },
        arsenal: this.arsenal(player), animation: player.animation, environment: player.sourceEnvironment, gauntletHit: options.gauntletHit });
      player.arsenal = weapon.arsenal; player.animation = weapon.animation;
      for (const effect of weapon.effects) if (effect.kind === "event" && providerFamily(effect.value.provider) === "q3"
        && effect.value.provider !== this.selectedQ3Source?.host.provider) client.ps.addEvent(effect.value.event, effect.value.parameter);
    }
    client.ps.commandTime = command.serverTime; client.ps.viewangles = player.viewAngles; client.ps.viewheight = player.viewHeight;
    client.ps.groundEntityNum = player.ground.kind === "world" ? 1022 : player.ground.kind === "actor" ? this.source.game.records.nativeByActor(player.ground.actor)?.slot ?? 1023 : 1023;
    if (player.state.kind === "q3") writeQ3MovementState(entity, player.state, this.source.game.records);
    if (player.animation.state.kind === "q3") { const animation = player.animation.state;
      client.ps.legsAnim = animation.legs; client.ps.torsoAnim = animation.torso; client.ps.legsTimer = animation.legsTimerMilliseconds; client.ps.torsoTimer = animation.torsoTimerMilliseconds;
      this.characters.get(player.actor)?.commitAnimation(player.animation);
    }
    writeQ3CharacterAnimation(entity, player.animation);
    for (const { effect } of result.effects) if (effect.kind === "event" && providerFamily(effect.value.provider) === "q3"
      && effect.value.provider !== this.selectedQ3Source?.host.provider && publishQ3CharacterMovementEvent(player.character, effect.value.event)) client.ps.addEvent(effect.value.event, effect.value.parameter);
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

  private restoreSelectedTravel(player: MovementPlayer, carriedPlayer: SimulationTravel["players"][number] | undefined): void {
    const actor = player.actor, source = this.source;
    this.selectedQ3Source?.admit(actor);
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
          const weapon = carry.weapon === null ? null : this.selectedWeaponSource.weapons.registeredDefinitions().find(value => value.item === carry.weapon);
          if (weapon === undefined) throw new Error("Selected Q2 travel weapon is not registered");
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
  }

  reserveNetQuakeClient(client: ClientId, userinfo?: ReadonlyMap<string, string>): ActorId {
    this.assertOpen();
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients) throw new Error("Client does not belong to an available session slot");
    const source = this.source;
    if (source.kind !== "quakec" || source.game.kind !== "netquake") throw new Error("NetQuake reservation requires its native QuakeC source");
    const existing = source.game.clientActor(client);
    if (existing !== null && source.game.isActiveClient(existing)) throw new Error("NetQuake client is already active");
    if (userinfo !== undefined) source.game.setClientInfo(client, userinfo);
    return source.game.reservedClient(client).id;
  }

  admitPlayer(client: ClientId, travel: SimulationTravel | undefined = this.options.travel, userinfo?: string): PlayerAdmission {
    this.assertOpen();
    if (!this.options.identity.owns(client) || client.slot >= this.options.maxClients) throw new Error("Client does not belong to an available session slot");
    for (const player of this.playerStates.values()) if (player.client.slot === client.slot) throw new Error("Client already has a player");
    const source = this.source;
    if (source.kind === "q2-native") {
      if (travel !== undefined) throw new Error("Native Quake II travel requires its source file lifecycle");
      return this.admitQ2NativePlayer(client, userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\male/grunt\\fov\\90`);
    }
    if (source.kind === "quakec") {
      const movement = providerTiming(this.recipe, this.recipe.movement.provider).clock.kind;
      if (travel !== undefined && travel.source.kind !== source.game.kind
        || this.options.dedicated === true && providerFamily(this.recipe.character.definition.provider) !== "q1"
        || source.game.kind === "quakeworld" && this.options.dedicated !== true
        || source.game.kind === "netquake" && movement === "q1-quakeworld")
        throw new Error("QC clients require matching source travel; native QuakeWorld requires dedicated operation and native wire servers require Q1 character presentation");
      if (userinfo !== undefined) source.game.setClientInfo(client, q2Userinfo(userinfo));
      const actor = source.game.admitClient(client), body = this.bodies.read(actor.id);
      if (body === null) throw new Error("QC reserved client has no shared body");
      const player = this.createPlayer(actor, client, body.origin, body.angles, source.game.clientArsenal(actor.id));
      this.playerStates.set(actor, player); player.state = player.readState(); if (player.character === "q1") player.animation = source.game.clientAnimation(actor.id);
      player.bounds = body.bounds; player.viewAngles = body.angles; player.commandAngles = body.angles;
      this.syncQuakeCClientView(player);
      this.notifyClientEvent("admitted", actor.id);
      return { actor: actor.id, viewHeight: player.viewHeight };
    }
    if (source.kind === "loading") throw new Error("Map spawn is incomplete");
    if (source.kind === "q3-qvm") throw new Error("Q3 guest admission requires the awaited native network lifecycle");
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
        emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event: { ...event, actor: event.actor.id } }),
        placement: "source-game", deathContext: owned => {
          const attack = this.lastAttack.get(owned); return { blood: true, noDrop: false,
            suicide: attack?.cause.kind === "q3" && attack.cause.meansOfDeath === 20,
            killerSourceSlot: attack?.attacker === null || attack?.attacker === undefined ? 1022 : this.actors.sourceOf(attack.attacker)?.slot ?? 1022 };
        } }, this.deathAnimations);
      this.characters.set(actor, character);
      character.spawn({ body, combat: q3InitialCombat("100", null), inventory: [] });
      player.animation = character.animation;
    } else {
      this.combat.create(actor, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
      this.inventory.create(actor, []);
    }
    if (source.kind === "q1") { source.game.attachPlayer(actor); source.composition.attach(actor, { slot: client.slot, userinfo: userinfo === undefined ? new Map([["name", `Player ${client.slot + 1}`], ["topcolor", "0"], ["bottomcolor", "0"]]) : q2Userinfo(userinfo) }); }
    else { source.items.configurePlayer(actor, source.game, true); if (entity !== null) {
      const model = player.character === "q2" ? this.recipe.character.appearance.provider.split("/").at(-1) ?? "male" : "male";
      source.product.admit(actor, { slot: client.slot, userinfo: userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\${model}/grunt\\fov\\90`, initializeInventory: false, useQ2Weapons: this.selectedArsenal === null }, travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot ? { ...travel.source.landmark, player: actor.id } : null);
    } }
    if (player.character === "q1") this.attachQ1Character(player);
    if (player.character === "q2" && source.kind === "q1") this.attachQ2Character(player);
    const carriedPlayer = travel?.players.find(record => record.client.slot === client.slot && record.client.generation === client.generation);
    const carried = carriedPlayer?.state;
    if (source.kind === "q1" && carried?.kind === "q1") source.composition.admitTravel(actor, carried.carry);
    else if (source.kind === "q2" && carried?.kind === "q2" && entity !== null) source.players.restoreCarry(entity, source.game, carried.carry);
    player.state = player.readState();
    this.restoreSelectedTravel(player, carriedPlayer);
    player.arsenal = this.arsenal(player);
    if (source.kind === "q2" && (carried === undefined || this.pendingStartItems.has(actor.id))) this.giveQ2StartItems(actor.id);
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
    this.notifyClientEvent("admitted", actor.id);
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
      source.players.emitFlashlight(player, this.source.game);
    }
    source.entities.resumePresentation(this.source.game, actor);
    return undefined;
  }

  private giveQ2StartItems(actor: ActorId): void {
    if (this.source.kind !== "q2") return;
    const source = this.source, owned = this.actors.resolveOwned(actor), entity = source.game.entity(actor), state = source.players.states.get(actor);
    if (owned === null || entity === null || state === undefined) throw new Error("Q2 starting inventory requires an admitted player");
    const worldspawn = parseQ2Entities(this.options.world.entities, source.game.options.edition).find(value => value.classname === "worldspawn");
    const expression = this.startItems || worldspawn?.values.get("start_items") || "";
    if (expression !== "") source.items.giveStartItems(owned, source.game, expression);
    this.pendingStartItems.delete(actor);
    state.spawnInventory = this.inventory.entries(actor);
    if (source.game.options.mode === "coop") state.coopRespawn = source.players.saveCarry(entity, source.game);
  }

  private q1CharacterSource(): Q1EntityServices {
    if (this.source.kind === "q1") return this.source.game;
    const selected = this.selectedWeaponSource?.kind === "q1" ? this.selectedWeaponSource.game : null;
    if (selected !== null) {
      if (!this.q1CharacterAdjuncts.has(selected)) {
        registerMapCallbacks(selected); registerCharacterCallbacks(selected); this.q1CharacterAdjuncts.add(selected);
      }
      return selected;
    }
    if (this.q1CharacterFoundation !== null) return this.q1CharacterFoundation;
    const reference = this.recipe.character.definition, timing = providerTiming(this.recipe, reference.provider);
    const game = new Q1EntityServices(this.q1ActorHost(reference, { numeric: timing.numeric, random: this.random,
      now: () => this.timeSeconds, frameSeconds: () => seconds(this.sourceFrame.elapsed),
      schedule: (actor, due) => due === null ? this.scheduler.cancel(actor) : this.schedule(actor, due) }), {
      provider: reference.provider, edition: reference.content.includes(":rerelease:") ? "rerelease" : "classic", skill: this.options.skill,
      physicsEdition: this.q1PhysicsEdition,
      deathmatch: this.options.mode === "deathmatch" ? 1 : 0, coop: this.options.mode === "coop", maxClients: this.options.maxClients,
      campaign: this.recipe.map.entities.provider, combatProvider: this.recipe.combat.provider, inventoryProvider: this.recipe.inventory.provider,
      movementProvider: this.recipe.movement.provider, gravity: this.physics.gravity });
    registerMapCallbacks(game); registerCharacterCallbacks(game); this.q1CharacterFoundation = game;
    return game;
  }

  private attachQ1Character(player: MovementPlayer): Q1CharacterActor {
    const game = this.q1CharacterSource(), actor = player.actor;
    const character = new Q1CharacterActor(game, actor, { requestRespawn: () => this.respawnPlayer(player),
      dropInventory: () => this.dropPlayerInventory(player), sourcePose: () => this.q1CharacterPose(actor.id),
      fallDamageAllowed: () => this.source.kind !== "q1" || this.source.composition.fallDamageAllowed(actor.id) });
    this.q1Characters.set(actor, character);
    this.callbacks.bind(actor, { think: null, touch: null, use: null, pain: reaction => character.pain(reaction.attacker, reaction.damage),
      die: reaction => { game.time = this.timeSeconds; character.die(reaction.attacker);
        if (player.state.kind === "q1-netquake") player.state = { ...player.state, moveType: character.presentation.movement === "bounce" ? 10 : 6 };
        return undefined; } });
    return character;
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
    if (this.options.mode === "singleplayer") return undefined;
    if (this.source.kind === "q3") { const entity = this.source.game.records.nativeByActor(player.actor.id); if (entity !== null) this.source.game.spawns.respawn(entity); return undefined; }
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
    this.selectedQ3Source?.respawn(player.actor.id);
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
        const intent = player.arsenalIntent;
        const impulse = client?.impulse || intent?.impulse || ("impulse" in input.command ? input.command.impulse : 0);
        const handled = this.selectedArsenal.impulse(player.actor.id, impulse);
        if (handled) { if (client !== null) client.impulse = 0; }
        else if (this.source.kind === "q1") this.source.composition.impulse(player.actor.id);
        const weaponPlayer = this.selectedArsenal.game.player(player.actor.id);
        if (intent?.impulse !== undefined && (handled || client !== null || weaponPlayer !== null && this.selectedArsenal.game.time >= weaponPlayer.attackFinished))
          player.arsenalIntent = { ...intent, impulse: 0 };
      } else if (this.source.kind === "q1") this.source.composition.impulse(player.actor.id);
      if (this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf && this.source.product.match.source.match.paused)
        return { arsenal: this.selectedArsenal.read(player.actor.id), animation: input.animation, effects: [] };
      const arsenal = this.selectedArsenal.read(player.actor.id);
      const gauntletHit = (this.weaponSlots.get(player.actor.id)?.primarySelected() ?? true) && arsenal.state.kind === "q3" && arsenal.state.sourceWeapon === 1 && arsenal.state.timeMilliseconds <= 0
        && (input.command.buttons & 1) !== 0 && (input.command.kind !== "q3" || (input.command.buttons & CommandButtons.TALK) === 0)
        && input.environment.health > 0 ? this.selectedQ3Source?.gauntletHit(player.actor) ?? false : false;
      if (this.source.kind === "q3") {
        const entity = this.source.game.records.nativeByActor(player.actor.id), client = entity?.client;
        if (client == null) throw new Error("Selected primary on Q3 map has no admitted source client");
        const useHoldable = player.arsenalIntent?.useHoldable ?? (input.command.kind === "q3" && (input.command.buttons & CommandButtons.USE_HOLDABLE) !== 0);
        if ((input.command.buttons & CommandButtons.ATTACK) === 0 && !useHoldable && input.environment.health > 0) client.ps.pmFlags &= ~MoveFlags.RESPAWNED;
        if (this.selectedQ3Source?.ownsEquipment !== true && this.source.game.stepHoldable(player.actor.id, useHoldable)) {
          this.primaryCommandBlocks.add(player.actor.id);
          return { arsenal, animation: input.animation, effects: [] };
        }
      }
      this.primaryCommandBlocks.delete(player.actor.id);
      const frame = this.selectedArsenal.family === "q1" ? this.selectedQ1Frame() : this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource.frame
        : { ...input.frame, time: { kind: "milliseconds", value: this.selectedMilliseconds } satisfies SourceTime };
      const result = this.selectedArsenal.step({ ...input, gauntletHit, frame }, player.arsenalIntent);
      player.arsenal = result.arsenal;
      this.characters.get(player.actor)?.commitAnimation(result.animation);
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
      notarget: selected && (this.monsterTarget(player.actor.id)?.notarget ?? false),
      hand: this.source.kind === "q2" ? this.source.players.states.get(player.actor.id)?.hand ?? "right" : "right", animatePlayer: player.character === "q2",
      quadUntil: this.source.kind === "q2" ? this.source.items.playerPowerups(player.actor.id).quadUntil : this.source.kind === "q1"
        ? this.source.game.player(player.actor.id)?.powerups.get("quad") ?? 0 : this.source.kind === "q3"
          ? (this.source.game.records.nativeByActor(player.actor.id)?.client?.ps.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000 : 0,
      doubleUntil: 0, quadFireUntil: 0, haste: false,
      noStackDouble: this.q2ServerRegistry?.dialect === "q2-rerelease" && this.q2ServerRegistry.variableValue("g_dm_no_stack_double") !== 0,
      instantSwitch: this.q2ServerRegistry?.dialect === "q2-rerelease" && this.q2ServerRegistry.variableValue("g_instant_weapon_switch") !== 0,
      quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: this.physics.gravity, weaponThunk: false } satisfies import("../../../content/q2/foundation/weapons/types.ts").Q2WeaponInput;
  }

  private setPlayerMovement(actor: ActorId, change: Q2PlayerMovementChange, link = true): undefined {
    const player = this.requirePlayer(actor), body = this.bodies.read(actor);
    if (body === null) throw new Error("Player has no body");
    const state = player.readState();
    if (change.kind === "teleport") { this.grapple?.release(actor); this.selectedQ3Source?.releaseHook(actor); }
    if (change.kind === "noclip") {
      player.setFlight(false);
      player.state = state.kind === "q1-netquake" ? { ...state, moveType: change.enabled ? 8 : 3 }
        : state.kind === "q2-classic" || state.kind === "q2-rerelease" ? { ...state, type: change.enabled ? 1 : 0 }
          : state.kind === "q3" ? { ...state, movementType: change.enabled ? 1 : 0 } : { ...state, spectator: change.enabled ? 1 : 0 };
      return undefined;
    }
    player.viewAngles = change.angles;
    if (change.kind === "spawn") { player.setFlight(false); player.cutscene = null; player.bounds = player.standingBounds; player.viewHeight = player.character === "q3" ? 26 : 22; }
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
    else if (state.kind === "q3") player.state = { ...state, origin: change.origin, velocity, viewAngles: change.angles,
      deltaAngleWords: this.source.kind === "q3" || this.source.kind === "q3-qvm" ? state.deltaAngleWords : [0, 0, 0],
      movementType: change.kind === "freeze" ? 4 : 0, ground: { kind: "none" },
      movementFlags: change.kind === "freeze" ? state.movementFlags : (state.movementFlags & ~(MoveFlags.TIME_LAND | MoveFlags.TIME_KNOCKBACK | MoveFlags.TIME_WATERJUMP)) | (change.holdMilliseconds > 0 ? MoveFlags.TIME_KNOCKBACK : 0),
      movementTimeMilliseconds: change.kind === "freeze" ? 0 : change.holdMilliseconds };
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

  private projectQuakeCAttack(actor: OwnedActor, before: ArsenalState): undefined {
    if (this.source.kind !== "quakec") return undefined;
    const after = this.source.game.clientArsenal(actor.id), player = this.playerStates.get(actor);
    if (player?.character === "q2" && before.state.kind === "q1" && after.state.kind === "q1"
      && after.state.attackFinishedSeconds > before.state.attackFinishedSeconds && (this.combat.read(actor.id)?.health ?? 0) > 0)
      player.animation = quakeCCharacterAnimation(player.animation, "attack", player.bounds.max.z < player.standingBounds.max.z);
    return undefined;
  }

  private quakeCCharacterStep(input: AnimationStepInput): AnimationStepResult {
    if (input.animation.state.kind === "q1") return { animation: input.animation, effects: [] };
      if (input.animation.state.kind === "q3") return stepQ3CharacterAnimation(input, this.recipe.character.definition.content.includes("missionpack") ? "missionpack" : "baseq3", (this.combat.read(input.actor.id)?.health ?? 0) <= 0);
      const qcPlayer = this.requirePlayer(input.actor.id);
      const selected = quakeCCharacterAnimation(input.animation, (this.combat.read(input.actor.id)?.health ?? 0) <= 0 ? "death" : "alive",
        qcPlayer.bounds.max.z < qcPlayer.standingBounds.max.z);
      const animation = selected.state;
      if (animation.kind !== "q2") throw new Error("Q2 character animation changed family");
      const entity = { frame: animation.frame };
      const state = { animationPriority: animation.priority, animationEnd: animation.endFrame, animationDuck: animation.duck, animationRun: animation.run };
      const now = seconds(input.frame.time), elapsed = seconds(input.frame.elapsed);
      const player = this.requirePlayer(input.actor.id), body = this.bodies.read(input.actor.id);
      const run = body !== null && Math.hypot(body.velocity.x, body.velocity.y) !== 0;
      for (let tick = Math.floor((now - elapsed) * 10); tick < Math.floor(now * 10); tick++)
        advanceQ2PlayerAnimation(state, entity, player.ground.kind !== "none", player.bounds.max.z < player.standingBounds.max.z,
          run);
      return { animation: { ...input.animation, state: { ...animation, frame: entity.frame, endFrame: state.animationEnd,
        priority: state.animationPriority, duck: state.animationDuck, run: state.animationRun } }, effects: [] };
  }

  private animationStep(input: AnimationStepInput): AnimationStepResult {
    if (this.source.kind === "quakec") return { animation: input.animation.state.kind === "q1" ? this.source.game.clientAnimation(input.actor.id) : input.animation, effects: [] };
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
    if (this.source.kind === "quakec" && this.source.game.isSpectatorClient(contact.self.id)) return { kind: "continue", state };
    player.commit(state, false, false);
    const other = contact.other.kind === "actor" ? contact.other.actor : this.worldActor();
    if (other !== null) {
      const { sourceTrace, ...sharedContact } = contact;
      const sourceQw = this.source.kind === "quakec" && this.source.game.kind === "quakeworld";
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
      const player = this.requirePlayer(actor.id);
      if (this.source.kind === "q3" && player.character === "q3") {
        if (player.profile.kind !== "q3") {
          const client = this.source.game.records.nativeByActor(actor.id)?.client;
          if (client == null) throw new Error("Q3 jump voice has no source client");
          client.ps.addEvent(MovementEntityEvent.EV_JUMP, 0);
        }
        return undefined;
      }
      const character = this.characters.get(actor);
      if (character !== undefined) return character.jump();
      if (this.requirePlayer(actor.id).character === "q2") return this.events.emit(this.recipe.character.definition.content,
        { kind: "q2", event: { kind: "sound", actor: actor.id, origin: this.requirePlayer(actor.id).view().origin, path: "*jump1.wav", channel: 2,
          volume: 1, attenuation: 1, reliable: false, loop: "once" } });
    }
    return this.events.emit(action === "jump" ? this.recipe.character.definition.content : this.recipe.movement.content, { kind: "q1", event: { kind: "sound", actor: actor.id,
      path: action === "jump" ? "player/plyrjmp8.wav" : "misc/water1.wav", channel: "body", volume: 1, attenuation: 1 } });
  }

  private prepareArsenalCommand(player: MovementPlayer, received: ActorCommand, paused: boolean): ActorCommand {
    let command = received;
    if (command.arsenal?.impulse !== undefined && (!Number.isInteger(command.arsenal.impulse) || command.arsenal.impulse < 0 || command.arsenal.impulse > 255))
      throw new RangeError("Source impulse must fit one byte");
    if (this.source.kind === "q1" && command.arsenal?.impulse !== undefined)
      command = { ...command, arsenal: { ...command.arsenal, impulse: 0 } };
    const slot = this.weaponSlots.get(player.actor.id);
    if (!paused && slot !== undefined && command.arsenal !== undefined) {
      const intent = command.arsenal;
      if (intent.weapon !== null && !this.requestWeapon(player.actor.id, { provider: intent.provider, item: intent.weapon })) throw new Error("Weapon request is unavailable to this actor");
      command = { ...command, arsenal: { ...intent, provider: this.weaponProvider.provider, weapon: null } };
    } else if (!paused && slot === undefined && this.selectedArsenal === null && command.arsenal !== undefined
      && (this.source.kind === "q1" || this.source.kind === "q2" || this.source.kind === "quakec")) {
      const intent = command.arsenal;
      if (intent.provider !== this.weaponProvider.provider) throw new Error("Arsenal command belongs to a different provider");
      if (intent.weapon !== null && (this.source.kind === "q2" || intent.weapon !== this.arsenal(player).activeWeapon)
        && !this.requestWeapon(player.actor.id, { provider: intent.provider, item: intent.weapon })) throw new Error("Weapon request is unavailable to this actor");
      command = { ...command, arsenal: { ...intent, provider: this.weaponProvider.provider, weapon: null } };
    }
    if (!paused && this.grapple?.selection.binding === "slot") this.grapple.input(player.actor.id, (command.command.buttons & 1) !== 0);
    const selectedBallistics = this.selectedQ3Source;
    if (!paused && selectedBallistics !== null) {
      const arsenal = this.arsenal(player), primary = slot?.primarySelected() ?? true;
      selectedBallistics.command(player.actor, (command.command.buttons & 1) !== 0
        && (command.command.kind !== "q3" || (command.command.buttons & CommandButtons.TALK) === 0),
      primary && arsenal.state.kind === "q3" && arsenal.state.sourceWeapon === 10,
      !player.intermission && player.cutscene === null && (this.combat.read(player.actor.id)?.health ?? 0) > 0);
      const point = selectedBallistics.grapplePoint(player.actor.id);
      if (player.state.kind === "q3") player.state = { ...player.state,
        movementFlags: point === null ? player.state.movementFlags & ~MoveFlags.GRAPPLE_PULL : player.state.movementFlags | MoveFlags.GRAPPLE_PULL,
        grapplePoint: point ?? zero };
      else {
        const velocity = selectedBallistics.pull(player.actor), body = this.bodies.read(player.actor.id);
        if (velocity !== null && body !== null) this.bodies.write(player.actor, { ...body, velocity, ground: null });
      }
    }
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
        player.arsenal = source.clientArsenal(player.actor.id); if (player.character === "q1") player.animation = source.clientAnimation(player.actor.id);
        player.state = player.readState(); this.syncQuakeCClientView(player);
        continue;
      }
      if (player === undefined || group.sequence <= player.lastSequence) continue;
      this.quakeWorldTouched = new Set<number>();
      try {
        const clock = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
        if (clock.kind !== "q1-quakeworld") throw new Error("Native QW source requires its command clock");
        for (const command of group.commands) {
          if (!this.actors.isLive(player.actor.id)) break;
          const input: ActorCommand = { actor: player.actor.id, source: { kind: "remote-client", client: group.client }, command, sequence: group.sequence };
          this.observeClientCommand(input);
          if (player.profile.kind === "q1-quakeworld") {
            player.move(input, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: command.milliseconds } });
          } else {
            let appliedMilliseconds = command.milliseconds;
            if (this.modClientApplications.active) {
              appliedMilliseconds = 0;
              for (const slice of quakeWorldCommandSlices(command, clock.maximumCommandMilliseconds)) appliedMilliseconds += slice.milliseconds;
            }
            player.withInputCommand(command, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: appliedMilliseconds } }, effective => {
              if (effective.kind !== "q1-quakeworld") throw new Error("Input output changed source command dialect");
              for (const slice of quakeWorldCommandSlices(effective, clock.maximumCommandMilliseconds)) {
                if (!this.actors.isLive(player.actor.id)) break;
                const state = player.readState();
                const milliseconds = (state.kind === "q3" ? state.commandTimeMilliseconds : this.timeSeconds * 1000) + slice.milliseconds;
                const physical = { ...slice, upMove: (slice.buttons & 2) !== 0 ? 320 : slice.upMove };
                const selected = selectedQ3Command(q3SourceCommand({ ...input, command: physical }, player, milliseconds, 0), player, slice.milliseconds);
                player.moveCommand(relativeMovementCommand({ ...input, command: selected, angleSpace: "absolute" }, state),
                  { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: slice.milliseconds } }, slice);
              }
            }, () => undefined);
          }
        }
        if (this.actors.isLive(player.actor.id)) {
          const before = source.clientArsenal(player.actor.id);
          source.clientPostThink(player.actor); this.projectQuakeCAttack(player.actor, before);
          if (!source.isSpectatorClient(player.actor.id)) this.runQuakeWorldNewMissile();
          player.arsenal = source.clientArsenal(player.actor.id); if (player.character === "q1") player.animation = source.clientAnimation(player.actor.id);
          player.state = player.readState(); this.syncQuakeCClientView(player);
        }
      } finally { this.quakeWorldTouched = null; }
    }
  }

  async stepAsync(input: InputBatch): Promise<SimulationOutput> {
    this.pendingSharedRestore?.assertComplete();
    if (this.source.kind !== "q3-qvm") return this.step(input);
    this.assertOpen();
    if (this.stepping || this.checkpointInProgress) throw new Error("Simulation step is already running or a checkpoint is active");
    if (!Number.isFinite(input.elapsedMilliseconds) || input.elapsedMilliseconds < 0) throw new RangeError("Host elapsed time must be finite and nonnegative");
    const guest = this.source.game;
    const seen = new Set<ActorId>();
    const commands = input.commands.map(command => {
      if (command.source.kind !== "local-seat" || command.command.kind !== "q3" || command.arsenal !== undefined
        || !this.options.identity.owns(command.source.seat) || !this.options.identity.owns(command.source.client))
        throw new Error("Q3 guest local input requires an owned seat and native Q3 command");
      const player = guest.player(command.source.client);
      if (player === null || !player.actor.equals(command.actor) || seen.has(player.actor))
        throw new Error("Q3 guest local input must target its admitted player once per frame");
      seen.add(player.actor);
      this.observeClientCommand(command);
      this.requireEquipmentPlayer(player.actor);
      this.grapple?.setJump(player.actor, command.command.upMove > 0);
      const slot = this.weaponSlots.get(player.actor);
      if (this.grapple?.selection.binding === "slot") this.grapple.input(player.actor, slot?.equipmentSelected() === true && (command.command.buttons & 1) !== 0);
      const native = fromQ3UserCommand(command.command), requested = this.nativeWeaponRequests.get(player.actor);
      return { player, command: { ...native, buttons: slot?.primarySelected() === false ? native.buttons & ~1 : native.buttons, ...(requested === undefined ? {} : { weapon: requested }) } };
    });
    const profile = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
    if (profile.kind !== "q3") throw new Error("Q3 guest lost its native frame clock");
    this.stepping = true;
    try {
      this.hostMilliseconds += input.elapsedMilliseconds;
      for (const entry of commands) {
        if (this.grapple?.source.kind === "q3-qvm") this.grapple.source.game.pull(entry.player.actor);
        const scale = this.grapple?.gravityScale(entry.player.actor) ?? 1;
        const artifact = this.options.q3Guest?.prepared.artifact, definition = artifact === undefined ? null : q3GrappleProfile(artifact);
        if (scale !== 1 && definition === null) throw new Error("Native Q3 equipment gravity requires a declared source Pmove entry");
        const remove = scale === 1 || definition === null ? null : guest.game.module.observeFunction({ kind: "qvm", module: definition.module, instructionIndex: definition.callbacks.playerMove }, call => {
          const movement = call.argument(0), pointer = guest.game.module.memory.view(movement, 4).getInt32(0, true);
          const expected = guest.game.data.checkpoint().clientsWord + entry.player.sourceEntity * definition.clientStride;
          if (pointer !== expected) throw new Error("Source Pmove does not target the admitted equipment player");
          const state = guest.records.player(entry.player.sourceEntity);
          guest.game.data.writePlayerState(entry.player.sourceEntity, { ...state, gravity: Math.trunc(state.gravity * scale) });
          return undefined;
        });
        try { await guest.think(entry.player, entry.command); } finally { remove?.(); }
        if (guest.records.player(entry.player.sourceEntity).weapon === this.nativeWeaponRequests.get(entry.player.actor)) this.nativeWeaponRequests.delete(entry.player.actor);
      }
      this.sourceSchedulingMilliseconds += input.elapsedMilliseconds;
      while (this.sourceSchedulingMilliseconds >= this.timeSeconds * 1000 + profile.serverFrameMilliseconds) {
        this.sourceFrame = this.clock.advance({ kind: "milliseconds", value: profile.serverFrameMilliseconds });
        this.advanceQ1Punch(); this.beginNativeEquipmentFrame();
        await this.source.game.runFrame(Math.trunc(this.timeSeconds * 1000));
        this.assertOpen();
        this.sourceFrame = this.clock.enter("frame-exit");
        this.modOwner?.advance(this.sourceFrame);
      }
      return { snapshot: this.snapshot(), events: this.events.take() };
    } finally { this.stepping = false; }
  }

  step(input: InputBatch): SimulationOutput {
    this.pendingSharedRestore?.assertComplete();
    this.assertOpen();
    this.assertBotRestoreReady();
    if (this.stepping || this.checkpointInProgress) throw new Error("Simulation step is already running or a checkpoint is active");
    if (this.source.kind === "q2-native") return this.stepNativeQ2(input);
    if (this.source.kind === "q3-qvm") throw new Error("Q3 guest requires the awaited simulation step");
    if (!Number.isFinite(input.elapsedMilliseconds) || input.elapsedMilliseconds < 0) throw new RangeError("Host elapsed time must be finite and nonnegative");
    const settlement = this.sourceRoundSettlement;
    if (settlement.kind === "failed") throw new Error("Source round settlement failed; close the session");
    if (settlement.kind === "active") {
      if (this.source.kind !== "q3" || this.source.game !== settlement.source) throw new Error("Source round settlement belongs to a retired source");
      if (settlement.completed >= 4) throw new Error("Source round settlement already completed four frames");
      if (input.elapsedMilliseconds !== 100 || input.commands.length !== 0) throw new Error("Source round settlement requires one empty 100ms input");
    } else if (settlement.kind === "ready") this.sourceRoundSettlement = { kind: "none" };
    this.stepping = true;
    try {
      if (this.source.kind === "q2" && this.q2ServerRegistry !== null) {
        const gravity = this.q2ServerRegistry.variableValue("sv_gravity");
        if (gravity !== this.physics.gravity) this.setWorldGravity(gravity);
      }
      for (const command of input.commands) {
        const player = this.player(command.actor);
        if (player === null) throw new Error("Command targets an unadmitted player");
        if (command.source.kind !== "bot" && (command.source.client.slot !== player.client.slot || command.source.client.generation !== player.client.generation || !this.options.identity.owns(command.source.client))) throw new Error("Command client does not own this player");
      }
      this.hostMilliseconds += input.elapsedMilliseconds;
      if (this.q1PauseState) return { snapshot: this.snapshot(), events: this.events.take() };
      const lmctf = this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf ? this.source.product.match.source : null;
      const paused = lmctf?.match.paused === true;
      const previousSelectedMilliseconds = this.selectedMilliseconds;
      if (!paused) this.selectedMilliseconds += input.elapsedMilliseconds;
      if (!paused) this.sourceSchedulingMilliseconds += input.elapsedMilliseconds;
      const profile = providerTiming(this.recipe, this.recipe.map.entities.provider).clock;
      const fixed = profile.kind === "q2-classic" ? 100 : profile.kind === "q2-rerelease" ? profile.frameMilliseconds : profile.kind === "q3" ? profile.serverFrameMilliseconds : null;
      const mapRun = settlement.kind === "active" || !paused && input.elapsedMilliseconds > 0 && (fixed === null || this.sourceSchedulingMilliseconds >= this.timeSeconds * 1000 + (profile.kind === "q3" ? profile.serverFrameMilliseconds : 0));
      const elapsed = settlement.kind === "active" ? 0.1 : fixed === null ? Math.min(0.1, Math.max(0.001, input.elapsedMilliseconds / 1000)) : fixed / 1000;
      const selectedQ2 = this.selectedWeaponSource?.kind === "q2" ? this.selectedWeaponSource : null;
      const mapStartMilliseconds = selectedQ2?.mapMilliseconds ?? this.timeSeconds * 1000;
      const mapDeadlines = new Set<number>();
      if (settlement.kind === "active") mapDeadlines.add(mapStartMilliseconds);
      else if (mapRun && profile.kind === "q3") {
        for (let due = this.timeSeconds * 1000 + profile.serverFrameMilliseconds; due <= this.sourceSchedulingMilliseconds; due += profile.serverFrameMilliseconds) mapDeadlines.add(due);
      } else if (mapRun && fixed !== null) {
        // Q2 runs when the current tick is due, one interval ahead of its host clock.
        // Bound shared-host work, not elapsed time: outstanding debt survives this bundle.
        const maximumQ2CatchupMilliseconds = 200;
        for (let due = mapStartMilliseconds; due <= this.sourceSchedulingMilliseconds && due - mapStartMilliseconds < maximumQ2CatchupMilliseconds; due += fixed) mapDeadlines.add(due + fixed);
      } else if (mapRun) mapDeadlines.add(mapStartMilliseconds + elapsed * 1000);
      const mapEndMilliseconds = mapDeadlines.size === 0 ? mapStartMilliseconds : Math.max(...mapDeadlines);
      const deadlines = new Set<number>(mapDeadlines.size === 0 ? [mapEndMilliseconds] : mapDeadlines);
      const selectedQ3Clock = this.selectedQ3Source === null ? null : providerTiming(this.recipe, this.weaponProvider.provider).clock;
      if (selectedQ3Clock !== null && selectedQ3Clock.kind !== "q3") throw new Error("Selected Q3 source clock changed");
      const q3Deadlines = new Set<number>();
      if (!paused && selectedQ3Clock !== null) for (let due = this.selectedQ3Next; due <= this.selectedMilliseconds; due += selectedQ3Clock.serverFrameMilliseconds) { deadlines.add(due); q3Deadlines.add(due); }
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
        map: mapDeadlines.has(milliseconds), q2: weaponDeadlines.has(milliseconds), q3: q3Deadlines.has(milliseconds), milliseconds,
      }));
      let commandsPending = true;
      for (const boundary of boundaries) {
      const previousQ3Time = this.selectedQ3Time;
      if (boundary.q3 && selectedQ3Clock !== null) { this.selectedQ3Time = boundary.milliseconds; this.selectedQ3Next = boundary.milliseconds + selectedQ3Clock.serverFrameMilliseconds; }
      this.selectedQ3Source?.synchronize();
      const run = boundary.map, commandTurn = commandsPending && (run || !mapRun);
      if (commandTurn) commandsPending = false;
      if (run && selectedQ2 !== null) selectedQ2.mapMilliseconds = boundary.milliseconds;
      if (boundary.q2 && selectedQ2 !== null) {
        const milliseconds = selectedQ2.frame.time.kind === "milliseconds";
        selectedQ2.frame = { frame: selectedQ2.frame.frame + 1, phase: "frame-entry",
          time: { kind: milliseconds ? "milliseconds" : "seconds", value: milliseconds ? boundary.milliseconds : boundary.milliseconds / 1000 },
          elapsed: { kind: milliseconds ? "milliseconds" : "seconds", value: milliseconds ? selectedQ2.intervalMilliseconds : selectedQ2.intervalMilliseconds / 1000 } };
        selectedQ2.nextMilliseconds = boundary.milliseconds + selectedQ2.intervalMilliseconds;
      }
      if (mapRun && !run) this.beginMonsterFrames(boundary.milliseconds, false);
      let botCommands: readonly ActorCommand[] = [];
      const pendingNetQuake = this.modClientApplications.active ? new Map<ActorId, ActorCommand>() : null;
      const pendingQ1PreThink = this.modClientApplications.active ? new Map<MovementPlayer, number>() : null;
      const preparesQ1Clients = this.source.kind === "q1" || this.source.kind === "quakec" && this.source.game.kind === "netquake";
      if (run) {
        if (settlement.kind === "active") this.sourceFrame = { ...this.clock.frame, frame: this.clock.frame.frame + 1,
          elapsed: { kind: "milliseconds", value: 100 }, phase: "frame-entry" };
        else if (fixed === null) this.sourceFrame = { ...this.clock.frame, elapsed: { kind: "seconds", value: elapsed }, phase: "frame-entry" };
        else this.sourceFrame = this.clock.advance({ kind: this.clock.frame.time.kind, value: this.clock.frame.time.kind === "seconds" ? elapsed : fixed });
        this.beginMonsterFrames(boundary.milliseconds, true);
        if (this.selectedArsenal?.family === "q1") {
          const frame = this.selectedQ1Frame();
          this.selectedArsenal.game.beginFrame(seconds(frame.time), seconds(frame.elapsed));
          if (this.selectedWeaponSource?.kind === "q1") this.selectedWeaponSource.missionWeapons.frame(seconds(frame.elapsed));
          this.selectedArsenal.frame(seconds(frame.time));
        }
        if (!paused) this.advanceQ1Punch();
        if (this.handGrenades !== null) this.equipmentFrame = providerFrame(this.sourceFrame, profile, providerTiming(this.recipe, this.handGrenades.selection.source.provider).clock);
        if (this.grapple !== null) {
          this.grappleFrame = providerFrame(this.sourceFrame, profile, providerTiming(this.recipe, this.grapple.selection.source.provider).clock);
          if (this.grapple.source.kind === "q1-threewave") this.grapple.source.game.beginFrame(seconds(this.grappleFrame.time), seconds(this.grappleFrame.elapsed));
          else if (this.grapple.source.kind === "q3-qvm") {
            this.grapple.source.game.beginFrame(Math.round(seconds(this.grappleFrame.time) * 1000), this.grappleFrame.frame);
            for (const player of this.playerStates.values()) this.grapple.source.game.pull(player.actor.id);
          }
        }
        if (this.source.kind === "q2" && this.source.product.rerelease?.players.intermissionFadeUntil != null) {
          this.checkingQ2Rules = true;
          try { this.source.product.rerelease.players.fadeFrame(this.source.game); } finally { this.checkingQ2Rules = false; }
          this.sourceFrame = this.clock.enter("frame-exit");
          if (this.transitions.length !== 0) break;
          continue;
        }
        if (this.source.kind === "q1") this.source.game.beginFrame(this.timeSeconds, elapsed);
        if (preparesQ1Clients) botCommands = this.botServices.frame(this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : Math.trunc(this.timeSeconds * 1000), elapsed * 1000);
        if (preparesQ1Clients) {
          for (const command of [...input.commands, ...botCommands]) {
            const player = this.requirePlayer(command.actor);
            if (player.profile.kind !== "q1-netquake" || command.sequence <= player.lastSequence) continue;
            this.observeClientCommand(command);
            if (this.modClientApplications.active) { player.receiveNetQuake(command); pendingNetQuake?.set(player.actor.id, command); }
            else {
              player.receiveNetQuake(this.prepareArsenalCommand(player, command, false));
              this.grapple?.setJump(player.actor.id, (command.command.buttons & 2) !== 0);
            }
            if (this.source.kind === "q1" && this.source.game.intermission !== null)
              this.source.composition.requestIntermissionExit(player.buttons !== 0, { actor: player.actor.id, attack: (player.buttons & 1) !== 0 });
          }
          for (const player of this.playerStates.values()) if (player.profile.kind === "q1-netquake" && player.cutscene === null && !player.intermission) {
            const gravityMultiplier = player.gravityMultiplier;
            player.gravityMultiplier *= this.grapple?.gravityScale(player.actor.id) ?? 1;
            try { player.prepareNetQuake({ ...this.sourceFrame, phase: "client-command" }, this.modClientApplications.active ? (effective, arsenal) => {
              const received = pendingNetQuake?.get(player.actor.id);
              this.grapple?.setJump(player.actor.id, (effective.buttons & 2) !== 0);
              return received === undefined ? arsenal : this.prepareArsenalCommand(player, { ...received, command: effective,
                ...(arsenal === undefined ? {} : { arsenal }) }, false).arsenal;
            } : undefined); }
            finally { player.gravityMultiplier = gravityMultiplier; }
          }
        }
        if (this.source.kind === "quakec") this.source.game.beginFrame(this.sourceFrame);
        if (this.source.kind === "q1") {
          this.setWorldGravity(this.source.cvars.variableValue("sv_gravity"));
          this.source.composition.preFrame(elapsed);
          for (const player of this.playerStates.values()) {
            if (player.profile.kind === "q1-netquake") continue;
            const received = [...input.commands].reverse().find(value => sameActor(value.actor, player.actor.id) && value.sequence > player.lastSequence);
            if (this.modClientApplications.active && received !== undefined && player.cutscene === null && !player.intermission) { pendingQ1PreThink?.set(player, received.sequence); continue; }
            const command = received?.command;
            const jump = command === undefined ? (player.buttons & 2) !== 0 : command.kind === "q1-netquake" ? (command.buttons & 2) !== 0
              : command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 : command.upMove > 0;
            this.source.composition.input(player.actor.id, { attack: player.cutscene === null && ((command?.buttons ?? player.buttons) & 1) !== 0, jump: player.cutscene === null && jump,
              use: ((command?.buttons ?? player.buttons) & 4) !== 0, impulse: command !== undefined && "impulse" in command ? command.impulse : received?.arsenal?.impulse ?? 0 });
            this.source.composition.playerPreThink(player.actor.id);
            this.source.game.playerFrame(player.actor, this.timeSeconds, player.waterLevel);
          }
        }
      }
      if (this.source.kind === "q2" && this.source.product.rerelease?.players.intermissionFadeUntil != null) {
        continue;
      }
      if (run && !preparesQ1Clients && settlement.kind !== "active") botCommands = this.botServices.frame(this.sourceFrame.time.kind === "milliseconds" ? this.sourceFrame.time.value : Math.trunc(this.timeSeconds * 1000), elapsed * 1000);
      for (const received of [...(commandTurn ? input.commands : []), ...botCommands]) {
        let command = paused ? { ...received, command: { ...received.command, buttons: received.command.buttons & ~1 } } : received;
        const player = this.player(command.actor);
        if (player === null) {
          if (pendingNetQuake?.has(command.actor) === true) continue;
          throw new Error("Command targets an unadmitted player");
        }
        if (command.sequence <= player.lastSequence) continue;
        this.observeClientCommand(command);
        const execute = (effective: UserCommand, arsenal: ArsenalIntent | undefined): undefined => {
          command = { ...command, command: effective, ...(arsenal === undefined ? {} : { arsenal }) };
          if (this.source.kind === "q1" && pendingQ1PreThink?.get(player) === command.sequence) {
            pendingQ1PreThink?.delete(player);
            const effective = command.command;
            const jump = effective.kind === "q1-netquake" || effective.kind === "q1-quakeworld" ? (effective.buttons & 2) !== 0
              : effective.kind === "q2-rerelease" ? (effective.buttons & 8) !== 0 : effective.upMove > 0;
            this.source.composition.input(player.actor.id, { attack: (effective.buttons & 1) !== 0, jump,
              use: (effective.buttons & 4) !== 0, impulse: command.arsenal?.impulse ?? ("impulse" in effective ? effective.impulse : 0) });
            this.source.composition.playerPreThink(player.actor.id);
            this.source.game.playerFrame(player.actor, this.timeSeconds, player.waterLevel);
            if (!this.actors.isLive(player.actor.id)) return undefined;
          }
          command = this.prepareArsenalCommand(player, command, paused);
          if (paused && lmctf !== null && !lmctf.canMove(player.actor.id)) {
            player.lastSequence = command.sequence;
            return undefined;
          }
          if (player.cutscene !== null) {
            player.previousButtons = player.buttons; player.buttons = command.command.buttons; player.lastSequence = command.sequence;
            return undefined;
          }
          if (this.source.kind === "q1" && this.source.game.intermission !== null) {
            player.previousButtons = player.buttons; player.buttons = command.command.buttons; player.lastSequence = command.sequence;
            this.source.composition.requestIntermissionExit(player.buttons !== 0, { actor: player.actor.id, attack: (player.buttons & 1) !== 0 });
            return undefined;
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
            try { const relative = relativeMovementCommand(command, player.readState());
            const movementFrame = { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: player.profile.kind === "q1-netquake" ? Math.min(100, Math.max(1, input.elapsedMilliseconds)) : input.elapsedMilliseconds } } satisfies FrameContext;
            const moved = this.modClientApplications.active ? player.moveCommand(relative, movementFrame) : player.move(relative, movementFrame);
            if (this.source.kind === "q2" && moved.kind === "q2-rerelease" && moved.status === "active") this.source.product.movementImpact(player.actor.id, moved.impactDelta, (moved.state.flags & 128) !== 0);
            } finally { player.gravityMultiplier = gravityMultiplier; }
          }
          if (!this.actors.isLive(player.actor.id)) return undefined;
          if (player.state.kind === "q1-netquake") player.state = { ...player.state, punchAngles: this.q1Punch.read(player.actor.id) };
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
            if (!player.intermission) entity.viewHeight = player.character === "q2" && (this.combat.read(player.actor.id)?.health ?? 0) <= 0
              ? this.source.players.states.get(player.actor.id)?.gibbed === true ? 8 : -2 : player.viewHeight;
            this.source.players.afterClientThink(entity, this.source.game);
          } }
          this.q2Characters.get(player.actor)?.afterClientThink();
          const q1Character = this.q1Characters.get(player.actor); if (q1Character !== undefined) q1Character.postMove();
          if (!paused) this.physics.commitAttachments();
          return undefined;
        };
        if (this.modClientApplications.active) {
          command = relativeMovementCommand(command, player.readState());
          player.withInputCommand(command.command, { ...this.sourceFrame, phase: "client-command", elapsed: { kind: "milliseconds", value: input.elapsedMilliseconds } },
            execute, () => undefined, command.arsenal);
        } else execute(command.command, command.arsenal);
      }
      if (!paused) {
        if (run && this.source.kind === "q2") this.source.monsters.beginFrame(this.source.game);
        if (run && this.source.kind === "q3") this.source.game.beginFrame(this.sourceFrame);
        const visited = new Set<OwnedActor>();
        for (const actor of orderedActorTurns(this.actors, actor => this.sourcePosition(actor.id), visited)) {
          if (this.grapple?.source.kind === "q3-qvm" && actor.owner === this.grapple.selection.source.provider) continue;
          if (this.modOwner?.owns(actor.owner) === true) continue;
          const execution = this.actorExecutions.get(actor.id), clientPlayer = this.playerStates.get(actor);
          if (run && clientPlayer?.profile.kind === "q1-netquake" && preparesQ1Clients) {
            if (this.source.kind === "quakec") this.source.game.beforeActor(actor);
            else if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) { this.bodies.link(actor); this.physics.touchTriggers(actor); }
            if (this.actors.isLive(actor.id) && clientPlayer.cutscene === null && !clientPlayer.intermission) {
              const gravityMultiplier = clientPlayer.gravityMultiplier;
              clientPlayer.gravityMultiplier *= this.grapple?.gravityScale(actor.id) ?? 1;
              try { clientPlayer.physicsNetQuake({ ...this.sourceFrame, phase: "entity-physics" }); }
              finally { clientPlayer.gravityMultiplier = gravityMultiplier; }
              if (!this.actors.isLive(actor.id)) continue;
              if (clientPlayer.state.kind === "q1-netquake") clientPlayer.state = { ...clientPlayer.state, punchAngles: this.q1Punch.read(actor.id) };
              this.syncQuakeCClientView(clientPlayer);
            } else clientPlayer.finishNetQuakeInput();
            if (boundary.q2) this.frameSelectedQ2Weapon(actor);
            if (this.actors.isLive(actor.id)) {
              this.q2Characters.get(actor)?.beginFrame();
              this.stepHandGrenade(clientPlayer.actor.id, (this.combat.read(actor.id)?.health ?? 0) > 0 ? "alive" : "dead");
              this.grapple?.step(actor.id, (this.combat.read(actor.id)?.health ?? 0) > 0 && !clientPlayer.intermission && clientPlayer.cutscene === null);
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
          if (execution?.kind === "q3-source") {
            if (boundary.q3) execution.step(previousQ3Time, this.selectedQ3Time);
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
            this.stepHandGrenade(equipmentPlayer.actor.id);
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
        if (this.source.kind === "q2") for (const player of this.playerStates.values()) { const entity = this.source.game.entity(player.actor.id); if (entity !== null) {
          if (!player.intermission && player.character === "q2" && (this.combat.read(player.actor.id)?.health ?? 0) <= 0) {
            entity.viewHeight = this.source.players.states.get(player.actor.id)?.gibbed === true ? 8 : -2; player.viewHeight = entity.viewHeight;
          }
          this.source.players.endFrame(entity, this.source.game);
          const state = this.source.players.states.get(player.actor.id);
          if (player.character === "q2" && state !== undefined) player.animation = { provider: this.recipe.character.definition.provider,
            state: { kind: "q2", frame: entity.frame, endFrame: state.animationEnd, priority: state.animationPriority, duck: state.animationDuck, run: state.animationRun } };
        } }
        if (run && this.source.kind === "q2") {
          const match = this.source.product.match.source;
          if (match instanceof Q2Lmctf && match.match.phase === "countdown" && !match.match.paused && match.match.remaining <= 0 && this.source.game.host.now() >= match.match.nextThink)
            this.q2ServerRegistry?.applyLatched("timelimit");
          this.source.product.afterPlayerFrames();
          this.source.monsters.endFrame(this.source.game);
          this.checkingQ2Rules = true;
          try { this.source.product.checkRules(); } finally { this.checkingQ2Rules = false; }
        }
        if (this.source.kind === "q3") {
          for (const player of this.playerStates.values()) {
            const entity = this.source.game.records.nativeByActor(player.actor.id);
            if (entity?.client !== null && entity?.client !== undefined && !player.intermission && player.character === "q3" && (this.combat.read(player.actor.id)?.health ?? 0) <= 0)
              entity.client.ps.viewheight = -16;
          }
          this.source.game.endFrame();
        }
        for (const [actor, character] of this.characters) { const player = this.playerStates.get(actor); if (player !== undefined) player.animation = character.animation; }
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
          for (const player of this.playerStates.values()) { const intermission = this.source.game.localClientIntermission(player.actor.id); if (intermission !== null) player.intermission = intermission; }
          if (this.source.game.kind === "quakeworld") { this.runQuakeWorldCommands(); this.source.game.messages.flush(); }
          for (const player of this.playerStates.values()) {
            if (player.character === "q1" || player.intermission || player.cutscene !== null) continue;
            const body = this.bodies.read(player.actor.id); if (body === null) continue;
            const moving = Math.hypot(body.velocity.x, body.velocity.y) !== 0;
            const locomotion = player.waterLevel >= 2 ? "swim" : player.ground.kind === "none" ? "jump"
              : player.bounds.max.z < player.standingBounds.max.z ? "crouch" : moving ? "run" : "idle";
            const yaw = player.viewAngles.y * Math.PI / 180;
            const backwards = body.velocity.x * Math.cos(yaw) + body.velocity.y * Math.sin(yaw) < 0;
            player.animation = this.quakeCCharacterStep({ actor: player.actor, frame: this.sourceFrame, animation: player.animation,
              locomotion, backwards, force: false }).animation;
          }
        }
        if (this.source.kind === "q1" && this.source.game.forceRetouch > 0) this.source.game.forceRetouch--;
        if (settlement.kind === "active") {
          this.sourceFrame = this.clock.advance({ kind: "milliseconds", value: 100 }, "frame-exit");
          settlement.completed++;
        } else if (fixed === null) this.sourceFrame = this.clock.advance({ kind: "seconds", value: elapsed }, "frame-exit");
        else this.sourceFrame = this.clock.enter("frame-exit");
        this.modOwner?.advance(this.sourceFrame);
      }
      if (this.source.kind === "q2" && this.transitions.length !== 0) break;
      }
      if (this.source.kind === "q2") emitQ2ShadowLights(this.source.game);
      return { snapshot: this.snapshot(), events: this.events.take() };
    } catch (error) {
      if (settlement.kind === "active") this.sourceRoundSettlement = { kind: "failed", source: settlement.source };
      throw error;
    } finally { this.primaryCommandBlocks.clear(); this.stepping = false; }
  }

  currentOutput(): SimulationOutput { this.assertOpen(); return { snapshot: this.snapshot(), events: [] }; }
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
    const native = this.source.kind === "q2-native" || this.source.kind === "q3-qvm", player = native ? null : this.requirePlayer(actor);
    const ui = native ? this.nativePlayerUi(actor) : this.primaryUi(actor), arsenal = player === null ? null : this.arsenal(player), slot = this.weaponSlots.get(actor), grapple = this.grapple;
    const q3Pending = player === null ? this.nativeWeaponRequests.get(actor) ?? null : this.q3Arsenals.get(player.actor)?.requestedWeapon ?? null;
    const pendingItem = this.selectedArsenal !== null ? this.selectedArsenal.pendingWeapon(actor) : arsenal?.state.kind === "q2" ? arsenal.state.pendingWeapon : q3Pending === null ? null : q3WeaponItem(q3Pending)?.item ?? null;
    const primary = { active: ui.activeWeapon === null ? null : { provider: this.weaponProvider.provider, item: ui.activeWeapon },
      pending: pendingItem === null ? null : { provider: this.weaponProvider.provider, item: pendingItem }, ui, model };
    if (slot === undefined) return primary;
    const view = this.playerView(actor), sources: SourceWeaponProjection[] = slot.presentations().map(source => {
      const definitions = source.items.filter(item => item.kind === "weapon"), active = definitions.find(item => item.item === source.active);
      const ammoItem = active?.ammo ?? null, ammo = ammoItem === null ? null : { item: ammoItem, count: this.inventory.count(actor, ammoItem) };
      const weaponStatus: PlayerUi["weaponStatus"] = active === undefined ? null : { source: source.source, item: active.item, label: active.label,
        ammo: ammo === null ? { kind: "unmetered" } : { kind: "finite", ...ammo, hasAmmoToStart: ammo.count > 0, low: false } };
      const asset = source.model, model: SimulationPresentation | null = asset === null ? null : { actor, content: source.source.content,
        family: source.source.content.startsWith("q1:") ? "q1" : source.source.content.startsWith("q2:") ? "q2" : "q3", path: asset.resource.requestedPath,
        frame: asset.frame, oldFrame: asset.frame, skin: 0, effects: 0, renderFlags: 0, origin: add(view.origin, { x: 0, y: 0, z: view.viewHeight }), angles: view.angles,
        scale: 1, visible: ui.health > 0 && (player === null || !player.intermission && player.cutscene === null), viewWeapon: true };
      if (asset !== null) this.events.registerResource(source.source.content, asset.resource.requestedPath, asset.resource);
      return { provider: source.source.provider, active: source.active === null ? null : { provider: source.source.provider, item: source.active },
        pending: source.pending === null ? null : { provider: source.source.provider, item: source.pending }, model, ammo, weaponStatus,
        items: definitions.map((definition, index) => ({ id: definition.item, label: definition.label, kind: "weapon", sourceOrdinal: ui.items.length + index,
          owned: this.inventory.count(actor, definition.item) > 0, hasAmmo: definition.ammo === null || this.inventory.count(actor, definition.ammo) > 0,
          count: definition.ammo === null ? null : this.inventory.count(actor, definition.ammo), warningCount: 0 })) };
    });
    if (grapple === null || grapple.selection.binding !== "slot") return projectWeaponSlot(slot.snapshot(), primary, undefined, sources);
    const gear = grapple.weaponView(actor), weapon = grapple.weapon();
    const gearModel: SimulationPresentation | null = gear === null ? null : { actor, content: grapple.selection.source.content, family: grapple.source.kind === "q1-threewave" ? "q1" : grapple.source.kind === "q3-qvm" ? "q3" : "q2",
      path: gear.path, frame: gear.frame, oldFrame: gear.frame, skin: 0, effects: 0, renderFlags: 0,
      ...("modelAttachments" in gear ? { modelAttachments: gear.modelAttachments } : {}),
      ...("modelAnchor" in gear ? { modelAnchor: gear.modelAnchor, q3Weapon: gear.q3Weapon } : {}),
      origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), gear.kickOrigin), angles: add(view.angles, { x: gear.kickPitch, y: 0, z: 0 }),
      scale: 1, visible: ui.health > 0 && (player === null || !player.intermission && player.cutscene === null), viewWeapon: true };
    return projectWeaponSlot(slot.snapshot(), primary, { source: grapple.selection.source, weapon, item: { id: weapon.item, label: grapple.selection.mechanic === "q2-lmctf" ? "Hook" : "Grapple", kind: "weapon",
      sourceOrdinal: ui.items.length, owned: this.inventory.count(actor, weapon.item) > 0, hasAmmo: true, count: null, warningCount: 0 }, model: gearModel }, sources);
  }
  private nativePlayerUi(actor: ActorId): PlayerUi {
    if (this.source.kind === "q3-qvm") {
      const player = this.source.game.players().find(player => player.actor.equals(actor));
      if (player === undefined) throw new Error("Actor has no Q3 guest client UI");
      const ui = q3GuestPlayerUi(this.source.game.records.player(player.sourceEntity), this.weaponProvider, this.timeSeconds * 1000,
        this.options.q3Guest?.prepared.weapons, this.options.q3Guest?.prepared.artifact.known?.product);
      if (this.source.combat === null) return ui;
      const combat = this.combat.read(actor);
      if (combat === null) throw new Error("Qualified Q3 guest client has no combat binding");
      return { ...ui, armor: combat.armor };
    }
    if (this.source.kind === "q2-native") return this.source.edition === "classic"
      ? classicGuestPlayerUi(this.source.game.playerState(this.nativeQ2Client(actor).slot + 1), this.source.game.configstrings(), this.weaponProvider)
      : rereleaseGuestPlayerUi(this.source.game.playerState(this.nativeQ2Client(actor).slot + 1), this.source.game.configstrings(), this.weaponProvider);
    throw new Error("Actor has no native source UI");
  }
  playerUi(actor: ActorId): PlayerUi { return this.slotProjection(actor, null).ui; }
  weaponSlot(actor: ActorId): WeaponSlotProjection {
    return this.slotProjection(actor, this.primaryPresentations().find(model => model.viewWeapon && sameActor(model.actor, actor)) ?? null);
  }

  private primaryUi(actor: ActorId): PlayerUi {
    if (this.source.kind === "q2") {
      const observer = this.source.players.states.get(actor), target = observer?.spectator === true ? observer.chaseTarget : null;
      const watched = target === null || target === undefined ? undefined : this.source.players.states.get(target);
      if (target != null && watched?.connected === true && !watched.spectator) actor = target;
    }
    const player = this.requirePlayer(actor), combat = this.combat.read(actor);
    if (combat === null) throw new Error("Player has no combat state");
    const source = this.source;
    const sourceClient = source.kind === "q3" ? source.game.records.nativeByActor(actor)?.client : null;
    const quakeCUi = source.kind === "quakec" ? source.game.clientUi(actor) : null;
    const powerups = source.kind === "q2" ? q2PowerupTimers(source.items.playerPowerups(actor), source.product.armory?.items.powerups(actor), source.game.host.now())
      : source.kind === "q1" ? q1PowerupTimers(source.game.player(actor)?.powerups ?? new Map<Q1Powerup, number>(), source.game.time)
      : source.kind === "q3" && sourceClient != null ? q3PowerupTimers(sourceClient, source.game.level.time, clientNumber => source.game.pool.clientAt(clientNumber)) : quakeCUi?.powerups ?? [];
    if (this.selectedArsenal !== null) return { powerups, health: combat.health, armor: combat.armor, inventory: this.inventory.entries(actor), ...this.selectedArsenal.ui(actor, this.weaponProvider) };
    if (quakeCUi !== null) return { health: combat.health, armor: combat.armor, inventory: this.inventory.entries(actor), ...quakeCUi };
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
    return { powerups, health: combat.health, armor: combat.armor, activeWeapon: arsenal.activeWeapon, ammo, inventory, items, weaponStatus, arsenalWarning };
  }

  setSourcePlayerIdentity(actor: ActorId, identity: { readonly name?: string; readonly skin?: string; readonly shirt?: number; readonly pants?: number }): void {
    this.requirePlayer(actor);
    const source = this.source;
    if (source.kind === "q1") {
      const client = source.composition.clients.require(actor), info = new Map(client.userinfo);
      if (identity.name !== undefined) info.set("name", identity.name);
      source.composition.clients.update(actor, info);
      if (identity.shirt !== undefined || identity.pants !== undefined)
        source.composition.clients.colors(actor, identity.shirt ?? client.shirt, identity.pants ?? client.pants);
      return;
    }
    if (source.kind === "q2") {
      const entity = source.game.entity(actor), state = source.players.states.get(actor);
      if (entity === null || state === undefined) throw new Error("Q2 source identity requires an admitted player");
      const info = new Map(q2Userinfo(state.userinfo));
      if (identity.name !== undefined) info.set("name", identity.name);
      if (identity.skin !== undefined) info.set("skin", identity.skin);
      source.players.userinfoChanged(entity, source.game, [...info].map(([key, value]) => `\\${key}\\${value}`).join(""));
      return;
    }
    throw new Error("Source identity updates require a native Q1 or Q2 player");
  }
  setPlayerFieldOfView(actor: ActorId, fieldOfView: number, mode: "change" | "restore" = "change"): void {
    if (this.source.kind === "q2-native") {
      const slot = this.nativeQ2Client(actor).slot + 1, source = this.source.game;
      const client = source.clients.find(client => client.slot === slot);
      if (client === undefined) throw new Error("Native player has no source userinfo");
      if (mode === "restore") return;
      const info = new Map(q2Userinfo(client.userinfo));
      info.set("fov", String(fieldOfView));
      source.userinfo(slot, [...info].map(([key, value]) => `\\${key}\\${value}`).join(""));
      return;
    }
    const player = this.requirePlayer(actor);
    const updateView = (previous: number, current: number): void => {
      if (player.intermission || this.source.kind === "q2" && this.source.players.intermission.kind === "intermission") return;
      const view = this.q2Views.get(actor);
      if (view?.fov === previous) this.q2Views.set(actor, { ...view, fov: current });
    };
    if (this.source.kind !== "q2") {
      const character = this.q2Characters.get(player.actor);
      if (character !== undefined) { updateView(character.state.fov, fieldOfView); character.state.fov = fieldOfView; }
      return;
    }
    const source = this.source, entity = source.game.entity(actor), state = source.players.states.get(actor);
    if (entity === null || state === undefined) return;
    const info = new Map(q2Userinfo(state.userinfo)), previous = state.fov;
    // Saved userinfo holds the ordinary request; source cameras can change only the effective FOV.
    const requested = Number.parseInt(info.get("fov") ?? "0", 10) || 0;
    const fixed = source.game.options.edition !== "rerelease" && source.game.options.mode === "deathmatch" && (source.game.options.deathmatchFlags & 32768) !== 0;
    const ordinary = fixed ? 90 : source.game.options.edition === "rerelease" ? Math.max(1, Math.min(160, requested))
      : requested < 1 ? 90 : Math.min(160, requested);
    const preserve = !fixed && (player.cutscene !== null || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0
      || mode === "restore" && previous !== ordinary);
    info.set("fov", String(fieldOfView));
    source.players.userinfoChanged(entity, source.game, [...info].map(([key, value]) => `\\${key}\\${value}`).join(""));
    if (preserve) state.fov = previous;
    updateView(previous, state.fov);
  }
  takeModClientDrops(): readonly { readonly client: ClientId; readonly actor: ActorId; readonly reason: string; readonly content: ContentId }[] { return this.modClientDrops.splice(0); }
  private rememberModClientCommand(input: ActorCommand): void { this.modClientCommands.set(input.actor, { input, time: this.sourceFrame.time }); }
  private requireModClient(client: ClientId): ActorId {
    this.assertOpen();
    const actor = this.modClients.actor(client);
    if (actor === null) throw new Error("Component client is no longer admitted");
    return actor;
  }
  notifyClientEvent(kind: ModClientEvent["kind"], actor: ActorId): void {
    const client = this.actors.isLive(actor) ? this.playerClient(actor) : null;
    if (client === null) return;
    if (kind === "admitted") {
      if (this.modClientAdmissions.has(actor)) return;
      this.modClientAdmissions.add(actor);
    }
    const event: ModClientEvent = { kind, identity: { client, actor } };
    for (const listener of [...this.modClientListeners]) listener(event);
    if (kind === "disconnecting") { this.modClientAdmissions.delete(actor); this.modClientCommands.delete(actor); }
  }
  observeClientCommand(input: ActorCommand): void {
    const client = this.playerClient(input.actor);
    if (client === null || !this.actors.isLive(input.actor)
      || input.source.kind !== "bot" && (!this.options.identity.owns(input.source.client) || !client.equals(input.source.client)))
      throw new Error("Component input does not belong to an admitted client");
    const previous = this.modClientCommands.get(input.actor);
    if (previous !== undefined && input.sequence < previous.input.sequence) return;
    const command = input.command;
    if (input.angleSpace === "absolute" || input.source.kind === "local-seat" && command.kind !== "q3"
      || command.kind === "q1-netquake" || command.kind === "q1-quakeworld") {
      this.rememberModClientCommand({ ...input, angleSpace: "absolute" }); return;
    }
    const source = this.source, player = this.player(input.actor);
    const state = source.kind === "q2-native" ? source.game.playerState(client.slot + 1).movement : player?.readState();
    if (command.kind === "q2-classic" && state?.kind === "q2-classic") {
      const delta = state.deltaAngleShorts;
      this.rememberModClientCommand({ ...input, angleSpace: "absolute", command: { ...command,
        angleShorts: [(command.angleShorts[0] + delta[0]) & 65535, (command.angleShorts[1] + delta[1]) & 65535, (command.angleShorts[2] + delta[2]) & 65535] } });
    } else if (command.kind === "q2-rerelease" && state?.kind === "q2-rerelease") {
      this.rememberModClientCommand({ ...input, angleSpace: "absolute", command: { ...command, angles: add(command.angles, state.deltaAngles) } });
    } else if (command.kind === "q3") {
      const native = source.kind === "q3" ? source.game.records.nativeByActor(input.actor)?.client?.ps.deltaAngles : undefined;
      const delta = source.kind === "q3-qvm" ? source.game.records.player(client.slot).deltaAngleWords
        : native === undefined ? state?.kind === "q3" ? state.deltaAngleWords : undefined : [native.x, native.y, native.z];
      const [x, y, z] = delta ?? [];
      if (x === undefined || y === undefined || z === undefined) throw new Error("Q3 component input has no authoritative angle delta");
      this.rememberModClientCommand({ ...input, angleSpace: "absolute", command: { ...command,
        angleWords: [(command.angleWords[0] + x) & 65535, (command.angleWords[1] + y) & 65535, (command.angleWords[2] + z) & 65535] } });
    } else throw new Error("Component input has no matching source movement state");
  }
  private storePlayerUserinfo(actor: ActorId, userinfo: string): void {
    const client = this.playerClient(actor), source = this.source;
    if (client === null) throw new Error("Component userinfo has no admitted client");
    if (source.kind === "q2-native") source.game.setUserinfoStorage(client.slot + 1, userinfo);
    else if (source.kind === "q3-qvm") source.game.state.setUserinfo(client.slot, userinfo);
    else if (source.kind === "q3") source.game.host.engine.setUserinfo(client.slot, userinfo);
    else if (source.kind === "quakec") source.game.setClientInfoStorage(client, q2Userinfo(userinfo));
    else if (source.kind === "q1") {
      const info = source.composition.clients.require(actor).userinfo; info.clear();
      for (const [name, value] of q2Userinfo(userinfo)) info.set(name, value);
    } else if (source.kind === "q2") {
      const player = source.players.states.get(actor); if (player === undefined) throw new Error("Component userinfo has no Q2 player");
      player.userinfo = userinfo;
    } else throw new Error("Component userinfo requires an initialized source");
  }
  sourcePlayerName(actor: ActorId): string { return q2Userinfo(this.sourcePlayerUserinfo(actor) ?? "").get("name") ?? "unconnected"; }
  get q1Paused(): boolean { return this.q1PauseState; }
  toggleQ1Pause(actor: ActorId | null): string {
    const source = this.source;
    if (source.kind !== "q1" && source.kind !== "quakec") throw new Error("Pause requires a Quake source server");
    const cvars = source.kind === "q1" ? source.cvars : source.game.cvars;
    if (actor !== null && cvars.find("pausable")?.numericValue === 0) return "Pause not allowed.\n";
    if (actor !== null && source.kind === "quakec" && source.game.kind === "quakeworld" && source.game.isSpectatorClient(actor))
      return "Spectators can not pause.\n";
    this.q1PauseState = !this.q1PauseState;
    const name = actor === null ? "Server" : q2Userinfo(this.sourcePlayerUserinfo(actor) ?? "").get("name") ?? "unconnected";
    return `${name} ${this.q1PauseState ? "paused" : "unpaused"} the game\n`;
  }
  sourcePlayerUserinfo(actor: ActorId): string | null {
    const source = this.source;
    if (source.kind === "q1") return [...source.composition.clients.require(actor).userinfo].map(([name, value]) => `\\${name}\\${value}`).join("");
    if (source.kind === "q2") return source.players.states.get(actor)?.userinfo ?? null;
    if (source.kind === "q3" || source.kind === "q3-qvm") {
      const client = this.playerClient(actor);
      return client === null ? null : source.kind === "q3" ? source.game.host.engine.getUserinfo(client.slot) : source.game.state.getUserinfo(client.slot) ?? null;
    }
    if (source.kind === "q2-native") return source.game.clients.find(client => client.slot === this.nativeQ2Client(actor).slot + 1)?.userinfo ?? null;
    if (source.kind === "quakec") {
      const client = this.playerClient(actor);
      return client === null ? null : [...source.game.clientInfo(client)].map(([name, value]) => `\\${name}\\${value}`).join("");
    }
    return null;
  }
  updatePlayerUserinfo(actor: ActorId, userinfo: string): void | Promise<void> {
    const source = this.source;
    const previousUserinfo = this.sourcePlayerUserinfo(actor);
    if (previousUserinfo === userinfo) return;
    if (source.kind === "q3-qvm") {
      const player = source.game.players().find(player => player.actor.equals(actor));
      if (player === undefined) throw new Error("Q3 guest userinfo has no admitted client");
      return source.game.userinfo(player, userinfo);
    }
    if (source.kind === "q2-native") {
      const slot = this.nativeQ2Client(actor).slot + 1;
      if (source.game.clients.find(client => client.slot === slot)?.userinfo !== userinfo) source.game.userinfo(slot, userinfo);
    } else if (source.kind === "q3") {
      const client = this.playerClient(actor); if (client === null) throw new Error("Q3 userinfo has no admitted client");
      source.game.host.engine.setUserinfo(client.slot, userinfo);
      source.game.admission.userinfoChanged(client.slot);
    } else if (source.kind === "q1") {
      const previous = source.composition.clients.require(actor).userinfo, values = q2Userinfo(userinfo);
      if (previous.size === values.size && [...values].every(([name, value]) => previous.get(name) === value)) return;
      source.composition.userinfo(actor, values);
    } else if (source.kind === "quakec") {
      const client = this.playerClient(actor); if (client === null) return;
      const previous = source.game.clientInfo(client), values = q2Userinfo(userinfo);
      if (previous.size === values.size && [...values].every(([name, value]) => previous.get(name) === value)) return;
      source.game.setClientInfo(client, values);
    } else if (source.kind === "q2") {
      const state = source.players.states.get(actor), entity = source.game.entity(actor);
      if (state === undefined || entity === null || state.userinfo === userinfo) return;
      const previousFov = state.fov, previousRequest = q2Userinfo(state.userinfo).get("fov"), player = this.requirePlayer(actor);
      source.players.userinfoChanged(entity, source.game, userinfo);
      if (player.cutscene !== null || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0 || previousRequest === q2Userinfo(userinfo).get("fov")) state.fov = previousFov;
      const view = this.q2Views.get(actor);
      if (view?.fov === previousFov) this.q2Views.set(actor, { ...view, fov: state.fov });
    }
    if (this.sourcePlayerUserinfo(actor) !== previousUserinfo) this.notifyClientEvent("userinfo", actor);
  }
  playerView(actor: ActorId): PlayerView {
    const view = this.sourcePlayerView(actor);
    return { ...view, kickAngles: add(view.kickAngles ?? zero, this.q1Punch.read(actor)) };
  }
  private sourcePlayerView(actor: ActorId): PlayerView {
    if (this.source.kind === "q2-native") return this.source.edition === "classic"
      ? classicGuestPlayerView(this.source.game.playerState(this.nativeQ2Client(actor).slot + 1))
      : rereleaseGuestPlayerView(this.source.game.playerState(this.nativeQ2Client(actor).slot + 1));
    if (this.source.kind === "q3-qvm") {
      const player = this.source.game.players().find(player => player.actor.equals(actor));
      if (player === undefined) throw new Error("Actor has no Q3 guest client view");
      const state = this.source.game.records.player(player.sourceEntity);
      return { origin: state.origin, angles: state.viewAngles, viewHeight: state.viewHeight };
    }
    const player = this.requirePlayer(actor), source = this.q2Views.get(actor), state = player.state;
    const view: PlayerView = { ...player.view(), ...(state.kind === "q1-netquake" || state.kind === "q1-quakeworld" ? {
      pitchDrift: { grounded: state.ground.kind !== "none", idealPitch: state.kind === "q1-netquake" ? state.idealPitch : 0,
        disabled: player.intermission || player.cutscene !== null || (this.combat.read(actor)?.health ?? 0) <= 0
          || (state.kind === "q1-netquake" ? state.moveType !== 3 : state.spectator !== 0) } } : {}) };
    const observer = this.source.kind === "q2" ? this.source.players.states.get(actor) : undefined;
    if (observer?.spectator === true && observer.chaseTarget !== null)
      return { origin: view.origin, angles: view.angles, viewHeight: 0, fieldOfView: source?.fov ?? 90 };
    if (player.cutscene !== null) return { origin: add(player.cutscene.origin, { ...player.cutscene.viewOffset, z: 0 }), angles: player.cutscene.angles, viewHeight: player.cutscene.viewOffset.z, fieldOfView: this.source.kind === "q2" ? source?.fov ?? 90 : 90 };
    if (this.source.kind === "quakec") {
      const camera = this.source.game.localClientView(actor);
      if (camera !== null) return camera;
    }
    if (this.source.kind === "quakec" && !player.intermission) {
      const offset = this.source.game.clientViewOffset(actor);
      return { ...view, origin: add(view.origin, { ...offset, z: 0 }), viewHeight: offset.z,
        angles: (this.combat.read(actor)?.health ?? 0) <= 0 ? { ...view.angles, z: 80 } : view.angles };
    }
    if (!player.intermission && (this.combat.read(actor)?.health ?? 0) <= 0) {
      const q1 = this.q1Characters.get(player.actor)?.lifecycle;
      if (q1 !== undefined && q1.life !== "alive") return { ...view, origin: add(view.origin, { ...q1.viewOffset, z: 0 }),
        viewHeight: q1.viewOffset.z, angles: { ...view.angles, z: 80 }, fieldOfView: source?.fov ?? 90,
        ...(this.source.kind === "q3" ? { foreignCharacterDeath: true } : {}) };
      if (player.character === "q3" && this.characters.has(player.actor)) {
        const attack = this.lastAttack.get(player.actor), killer = attack?.attacker == null ? null : this.bodies.read(attack.attacker);
        const yaw = killer === null || attack?.attacker?.equals(actor) === true ? view.angles.y : Math.atan2(killer.origin.y - view.origin.y, killer.origin.x - view.origin.x) * 180 / Math.PI;
        return { ...view, viewHeight: -16, angles: { x: -15, y: yaw, z: 40 }, fieldOfView: source?.fov ?? 90 };
      }
    }
    // Classic viewoffset includes eye height; rerelease sends it separately in pmove.viewheight.
    return player.character !== "q2" || source === undefined ? { ...view, ...(source === undefined ? {} : { fieldOfView: source.fov }) }
      : { origin: add(view.origin, { x: source.offset.x, y: source.offset.y, z: 0 }),
        angles: add(!player.intermission && (this.combat.read(actor)?.health ?? 0) > 0 ? view.angles : source.angles, source.kickAngles),
        ...(this.source.kind === "q3" && this.q2Characters.get(player.actor)?.state.dead === true && !player.intermission ? { foreignCharacterDeath: true } : {}),
        fieldOfView: source.fov, viewHeight: source.offset.z + (this.source.kind === "q2" && this.source.product.rerelease !== null && !player.intermission ? view.viewHeight : 0) };
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
  private sourceCollisionSettings: CollisionMapSettings | null = null;
  private initializeServerSettings(cvars: CvarRegistry): void {
    if (this.scene.geometry.kind === "q3-bsp") {
      this.sourceCollisionSettings = new CollisionMapSettings(cvars);
      this.sourceCollisionSettings.registerMap();
      if (this.options.restore === undefined) this.scene.bindCollisionSettings(this.sourceCollisionSettings);
    }
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
    const cvars = this.q2ServerRegistry ?? (this.source.kind === "q3" ? this.source.game.host.cvars : this.source.kind === "q3-qvm" ? this.source.game.state.cvars
      : this.source.kind === "q1" ? this.source.cvars : this.source.kind === "quakec" ? this.source.game.cvars : null);
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
  playerClient(actor: ActorId): ClientId | null {
    if (this.source.kind === "q2-native") return [...this.source.clients].find(([, owner]) => owner.id.equals(actor))?.[0] ?? null;
    if (this.source.kind === "q3-qvm") return this.source.game.players().find(player => player.actor.equals(actor))?.client ?? null;
    return this.movementPlayer(actor)?.client ?? null;
  }
  q2Native(): Q2NativeWorld | null { return this.source.kind === "q2-native" ? this.source.game : null; }
  q2NativePlayers(): readonly { readonly client: ClientId; readonly actor: ActorId }[] {
    return this.source.kind === "q2-native" ? [...this.source.clients].map(([client, actor]) => ({ client, actor: actor.id })) : [];
  }
  captureNativeQ2Travel(newUnit: boolean, spawnPoint: string): NativeQ2Travel {
    this.assertOpen();
    const source = this.source;
    if (source.kind !== "q2-native" || this.stepping) throw new Error("Native map travel requires a completed source frame");
    const clients = source.game.clients.map(record => {
      const client = [...source.clients.keys()].find(client => client.slot + 1 === record.slot);
      if (client === undefined) throw new Error("Native source client has no session identity");
      const actor = source.clients.get(client), handGrenades = actor === undefined ? undefined : this.handGrenades?.travel(actor.id);
      const projection = actor === undefined || !this.weaponSlots.has(actor.id) ? null : this.slotProjection(actor.id, null);
      const weaponSlot = projection?.pending ?? projection?.active;
      if (actor !== undefined) this.grapple?.release(actor.id);
      return { client, phase: record.phase, ...(handGrenades === undefined ? {} : { handGrenades }), ...(weaponSlot == null ? {} : { weaponSlot }) };
    });
    if (source.edition === "rerelease") {
      const visited = newUnit ? new Map<string, Q2RereleaseVisitedLevel>() : new Map(source.visited);
      if (!newUnit) {
        const map = this.recipe.map.geometry.requestedPath;
        visited.set(map, { version: 1, map, level: source.game.writeTravelLevel(),
          configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
          portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })) });
      }
      return { edition: "rerelease", world: source.game, clients, visited, spawnPoint };
    }
    const visited = newUnit ? new Map<string, Q2ClassicVisitedLevel>() : new Map(source.visited);
    if (!newUnit) {
      const level = source.files.captureTravelLevel(path => source.game.writeTravelLevel(path));
      const map = this.recipe.map.geometry.requestedPath;
      visited.set(map, { version: 1, map, level, configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
        portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })) });
    }
    return { edition: "classic", world: source.game, files: source.files, clients, visited, spawnPoint };
  }
  admitQ2NativePlayer(client: ClientId, userinfo: string, begin = true): PlayerAdmission {
    this.assertOpen();
    if (this.source.kind !== "q2-native" || !this.options.identity.owns(client) || client.slot >= this.options.maxClients || this.source.clients.has(client)) throw new Error("Invalid native client admission");
    const retained = this.options.nativeQ2Travel?.clients.find(entry => entry.client.equals(client));
    if (retained !== undefined) {
      const actor = this.registerQ2NativeClient(client);
      if (begin && retained.phase === "active") { this.source.game.begin(client.slot + 1); this.notifyClientEvent("admitted", actor.id); }
      return { actor: actor.id, viewHeight: this.playerView(actor.id).viewHeight };
    }
    const result = this.source.game.connect(client.slot + 1, userinfo);
    if (!result.allowed) throw new Error("Native Quake II rejected the local client");
    const actor = this.registerQ2NativeClient(client);
    if (begin) { this.source.game.begin(client.slot + 1); this.notifyClientEvent("admitted", actor.id); }
    return { actor: actor.id, viewHeight: this.playerView(actor.id).viewHeight };
  }
  registerQ2NativeClient(client: ClientId, mode: "live" | "restore" = "live"): OwnedActor {
    if (this.source.kind !== "q2-native" || !this.options.identity.owns(client) || client.slot >= this.options.maxClients || this.source.clients.has(client)) throw new Error("Invalid native client registration");
    const id = this.source.game.actor(client.slot + 1), actor = id === null ? null : this.actors.resolveOwned(id);
    if (actor === null) throw new Error("Native ClientConnect did not reserve its source actor");
    this.source.clients.set(client, actor);
    if (mode === "live" && this.source.game.services.hasSourceInventory) this.bindEquipmentInventory(actor);
    return actor;
  }
  private nativeQ2Client(actor: ActorId): ClientId {
    if (this.source.kind !== "q2-native") throw new Error("No native Quake II source");
    for (const [client, owner] of this.source.clients) if (owner.id.equals(actor)) return client;
    throw new Error("Actor has no native Quake II client");
  }
  private bindNativeInput(): void {
    const source = this.source;
    if (source.kind !== "q2-native") return;
    source.game.bindInput({ applications: this.modClientApplications, numeric: source.game.services.options.numeric,
      identity: slot => {
        const actor = source.game.actor(slot), client = actor === null ? null : this.playerClient(actor);
        return actor === null || client === null ? null : { client, actor };
      },
      live: identity => this.actors.isLive(identity.actor) && this.playerClient(identity.actor)?.equals(identity.client) === true,
      onRelease: listener => this.actors.onRelease(actor => listener(actor.id)),
      retired: identity => { if (source.clients.get(identity.client)?.id.equals(identity.actor) === true) source.clients.delete(identity.client); },
      accepted: actor => this.modClientCommands.get(actor) ?? null, frame: () => this.sourceFrame,
      movement: (identity, projection, run) => {
        const velocity = this.nativeEquipmentVelocity.get(identity.actor);
        if (velocity !== undefined) { projection.write({ ...projection.read(), velocity }); this.nativeEquipmentVelocity.delete(identity.actor); }
        return source.game.services.withInputMovement(identity.actor, projection, run);
      } });
  }
  private stepNativeQ2(input: InputBatch): SimulationOutput {
    if (this.source.kind !== "q2-native" || this.stepping) throw new Error("Native Quake II frame is unavailable");
    if (!Number.isFinite(input.elapsedMilliseconds) || input.elapsedMilliseconds < 0) throw new RangeError("Invalid host frame interval");
    const source = this.source;
    this.stepping = true;
    try {
      for (const command of input.commands) {
        const slot = this.nativeQ2Client(command.actor).slot + 1;
        this.observeClientCommand(command);
        this.requireEquipmentPlayer(command.actor);
        this.grapple?.setJump(command.actor, command.command.kind === "q2-rerelease" ? (command.command.buttons & 8) !== 0 : "upMove" in command.command && command.command.upMove > 0);
        const equipment = this.weaponSlots.get(command.actor);
        if (this.grapple?.selection.binding === "slot") this.grapple.input(command.actor, equipment?.equipmentSelected() === true && (command.command.buttons & 1) !== 0);
        if (this.grapple?.source.kind === "q3-qvm") this.grapple.source.game.pull(command.actor);
        const gated = equipment?.primarySelected() === false ? { ...command, command: { ...command.command, buttons: command.command.buttons & ~1 } } : command;
        const velocity = this.nativeEquipmentVelocity.get(command.actor), movement = this.grapple === null && velocity === undefined ? undefined
          : { ...(velocity === undefined ? {} : { velocity }), gravityScale: this.grapple?.gravityScale(command.actor) ?? 1, predictionSuppressed: this.grapple?.prediction(command.actor) ?? false };
        const observingInput = this.modClientApplications.active;
        if (observingInput) this.nativeEquipmentVelocity.delete(command.actor);
        if (source.edition === "classic") source.game.think(slot, classicGuestLocalCommand(gated, source.game.playerState(slot)), movement);
        else source.game.think(slot, rereleaseGuestLocalCommand(gated, source.game.playerState(slot)), movement);
        if (!observingInput) this.nativeEquipmentVelocity.delete(command.actor);
      }
      this.hostMilliseconds += input.elapsedMilliseconds; this.sourceSchedulingMilliseconds += input.elapsedMilliseconds;
      const frameMilliseconds = source.edition === "classic" ? 100 : source.game.services.options.frameMilliseconds;
      while (this.sourceSchedulingMilliseconds >= this.timeSeconds * 1000 + frameMilliseconds) {
        this.sourceFrame = this.clock.advance(source.edition === "classic" ? { kind: "seconds", value: frameMilliseconds / 1000 } : { kind: "milliseconds", value: frameMilliseconds });
        this.advanceQ1Punch(); this.beginNativeEquipmentFrame(); source.game.frame(frameMilliseconds); this.sourceFrame = this.clock.enter("frame-exit");
        this.modOwner?.advance(this.sourceFrame);
      }
      return { snapshot: this.snapshot(), events: this.events.take() };
    } finally { this.stepping = false; }
  }
  q3Guest(): Q3QvmServerGame | null { return this.source.kind === "q3-qvm" ? this.source.game : null; }
  async shutdownQ3Guest(): Promise<void> { await this.q3Guest()?.shutdown(); }
  sourceRestartPlan(): { readonly kind: "source-reset" } | { readonly kind: "replace-world"; readonly reason: string } {
    this.assertOpen();
    if (this.source.kind !== "q3") return { kind: "replace-world", reason: "Selected provider has no same-map source reset" };
    if (this.selectedArsenal !== null || this.selectedWeaponSource !== null
      || this.monsterSources.size !== 0 || this.grapple !== null || this.handGrenades !== null)
      return { kind: "replace-world", reason: "Selected adjunct providers require full world replacement" };
    const compatibility = this.source.game.restartCompatibility();
    return compatibility === "compatible" ? { kind: "source-reset" } : { kind: "replace-world", reason: compatibility };
  }

  restartSourceRound(): readonly ClientId[] {
    if (this.sourceRoundSettlement.kind === "active" || this.sourceRoundSettlement.kind === "failed") throw new Error("Complete or retire source round settlement before another restart");
    const plan = this.sourceRestartPlan();
    if (plan.kind === "replace-world") throw new Error("Source restart requires full world replacement: " + plan.reason);
    if (this.stepping) throw new Error("Source restart requires a completed simulation frame");
    const previous = this.source;
    if (previous.kind !== "q3") throw new Error("Source restart owner changed");
    if (this.botServices.configuration !== null) throw new Error("Detach bot round services before source restart");
    const clients = this.clientIdentities();
    const carry = previous.game.captureSession();
    try {
      for (const actor of this.actors.observations()) {
        const owned = this.actors.resolveOwned(actor.id);
        if (owned !== null) this.actors.release(owned);
      }
      this.disposeSourceCombat?.(); this.disposeSourceCombat = null;
      previous.game.close();
      this.events.take(); this.events.takePresentation(); this.transitions.length = 0; this.levelChange = null;
      this.debugLineStore.clear(); this.debugLineSnapshot = []; this.worldTextStore.clear(); this.worldTextSnapshot = [];
      const game = new Q3SourceRuntime({ ...previous.game.options, sessionCarry: carry }, previous.game.host);
      this.source = { kind: "q3", game };
      if (providerFamily(this.recipe.combat.provider) === "q3") this.disposeSourceCombat = this.combat.register(game.bridge.policy());
      game.load();
      this.sourceRoundSettlement = { kind: "ready", source: game };
      return clients;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  beginSourceRoundSettlement(): void {
    this.assertOpen();
    const settlement = this.sourceRoundSettlement;
    if (this.stepping || settlement.kind !== "ready" || this.source.kind !== "q3" || this.source.game !== settlement.source)
      throw new Error("Source round settlement requires a fresh matching source reset");
    if (this.sourceRestartPlan().kind !== "source-reset" || this.clock.frame.time.kind !== "milliseconds")
      throw new Error("Source round settlement requires a compatible native Q3 clock");
    this.sourceRoundSettlement = { kind: "active", source: settlement.source, completed: 0 };
  }

  completeSourceRoundSettlement(): void {
    this.assertOpen();
    const settlement = this.sourceRoundSettlement;
    if (this.stepping || settlement.kind !== "active" || this.source.kind !== "q3" || this.source.game !== settlement.source || settlement.completed !== 4)
      throw new Error("Source round settlement requires four completed frames before resuming");
    this.sourceRoundSettlement = { kind: "none" };
  }

  teamGame(): boolean {
    const source = this.source;
    if (source.kind === "q1") return source.composition.selection.program === "ctf" || source.cvars.variableValue("teamplay") !== 0;
    if (source.kind === "quakec") return source.game.cvars.variableValue("teamplay") !== 0;
    if (source.kind === "q3") return source.game.gameType >= 3;
    if (source.kind === "q3-qvm") return source.game.state.cvars.variableValue("g_gametype") >= 3;
    if (source.kind === "q2-native") return this.q2ServerRegistry !== null && (this.q2ServerRegistry.variableValue("ctf") !== 0
      || (this.q2ServerRegistry.variableValue("dmflags") & (64 | 128)) !== 0);
    if (source.kind !== "q2") throw new Error("Team match policy requires an initialized source");
    const selected = source.product.match;
    if (selected.source instanceof Q2Lmctf) return (selected.source.rules.ctfFlags & 128) === 0;
    const match = selected.selection.kind;
    return match === "ctf" || match === "lmctf" || match === "deathball" || source.game.options.mode === "deathmatch" && (source.game.options.deathmatchFlags & (64 | 128)) !== 0;
  }

  q3Source(): Q3SourceRuntime | null { return this.source.kind === "q3" ? this.source.game : null; }
  selectedQ3SourceState() { return this.selectedQ3Source === null ? null : { content: this.weaponProvider.content, source: this.selectedQ3Source, state: this.selectedQ3Source.sourceState() }; }
  movementPlayer(actor: ActorId): Readonly<MovementPlayer> | null { return this.player(actor); }
  weaponPresentationClock(): { readonly content: ContentId; readonly timeMilliseconds: number } | null {
    return this.selectedArsenal?.family !== "q3" ? null : { content: this.weaponProvider.content, timeMilliseconds: Math.trunc(this.selectedMilliseconds) };
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
    this.q2ServerRegistry?.set("sv_gravity", String(gravity), true);
    for (const player of this.playerStates.values()) {
      player.worldGravity = gravity;
      if (player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease" || player.state.kind === "q3") player.state = { ...player.state, gravity: Math.trunc(gravity * player.gravityMultiplier) };
    }
    return undefined;
  }
  disconnectPlayer(actor: ActorId): undefined {
    this.notifyClientEvent("disconnecting", actor);
    if (this.source.kind === "q2-native") { const client = this.nativeQ2Client(actor); this.grapple?.release(actor); this.stepHandGrenade(actor, "removing"); this.source.game.disconnect(client.slot + 1); this.source.clients.delete(client); return undefined; }
    const player = this.player(actor); if (player === null) return undefined;
    if (this.source.kind === "quakec") {
      this.source.game.disconnectClient(player.actor);
      this.playerStates.delete(player.actor);
      return undefined;
    }
    this.grapple?.release(actor);
    this.stepHandGrenade(player.actor.id, "removing");
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
  submitDebugShapes(event: { readonly lines: readonly DebugLine[]; readonly lifetimeMilliseconds: number }): undefined {
    this.assertOpen();
    this.debugLineStore.submit(event.lines, Math.round(this.timeSeconds * 1000), event.lifetimeMilliseconds);
    return undefined;
  }
  beginPresentationFrame(frame: number): void {
    this.assertOpen();
    if (this.debugLineFrame === frame) return;
    this.debugLineFrame = frame;
    this.debugLineSnapshot = this.debugLineStore.snapshot(Math.round(this.timeSeconds * 1000), frame);
  }
  debugLines(): readonly DebugLine[] { return this.debugLineSnapshot; }
  worldText(): readonly WorldText[] {
    if (this.worldTextFrame !== this.sourceFrame.frame) {
      this.worldTextFrame = this.sourceFrame.frame;
      this.worldTextSnapshot = this.worldTextStore.snapshot(this.timeSeconds, this.sourceFrame.frame);
    }
    return this.worldTextSnapshot;
  }

  drainPresentationEvents(): readonly SimulationPresentationEvent[] { return this.events.takePresentation(); }

  presentations(): readonly SimulationPresentation[] {
    const appearances = this.modOwner?.appearanceOverrides();
    let models = [...this.primaryPresentations(), ...(this.modOwner?.presentations() ?? []), ...(this.grapple?.source.kind === "q3-qvm" ? this.grapple.source.game.presentations(this.grapple.selection.source.content) : [])];
    if (appearances !== undefined && appearances.size !== 0) {
      models = models.filter(model => model.viewWeapon || !appearances.has(model.actor));
      for (const group of appearances.values()) for (const model of group) models.push({ ...model, replacesBody: true });
    }
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
    if (this.source.kind === "q2-native") {
      const source = this.source, content = this.recipe.map.entities.content;
      for (const state of source.game.entityStates()) {
        const info = source.game.entityInfo(state.number);
        if (state.number === 0 || info.actor === null || !info.active || (info.serverFlags & 1) !== 0) continue;
        const appearance = source.game.modelAppearance(state.number);
        const model = { actor: info.actor, content, family: "q2", frame: state.frame, oldFrame: "oldFrame" in state ? state.oldFrame : state.frame,
          skin: appearance.skin, skinPath: appearance.skinPath, effects: Number(state.effects), renderFlags: state.renderEffects,
          origin: state.origin, previousOrigin: state.oldOrigin, angles: state.angles,
          scale: "scale" in state && state.scale !== 0 ? state.scale : 1, alpha: "alpha" in state ? state.alpha !== 0 ? state.alpha : (state.renderEffects & 32) !== 0 ? 0.3 : 1 : 1, visible: true, viewWeapon: false } satisfies Omit<SimulationPresentation, "path">;
        if (appearance.path !== "") result.push({ ...model, path: appearance.path });
        for (const path of appearance.attachedModels) if (path !== "") result.push({ ...model, path, skin: 0, skinPath: null });
      }
      for (const [client, actor] of source.clients) {
        const state = source.game.playerState(client.slot + 1), view = this.playerView(actor.id), path = source.game.configstrings().get((source.edition === "classic" ? 32 : 62) + state.gunIndex);
        if (state.gunIndex === 0 || path === undefined || path === "") continue;
        result.push({ actor: actor.id, content, family: "q2", path, frame: state.gunFrame, oldFrame: state.gunFrame, skin: "gunSkin" in state ? state.gunSkin : 0, effects: 0, renderFlags: 0,
          origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), state.gunOffset), angles: add(view.angles, state.gunAngles), scale: 1, visible: true, viewWeapon: true });
      }
    }
    if (this.source.kind === "q3") result.push(...this.source.game.presentations());
    if (this.selectedQ3Source !== null) result.push(...this.selectedQ3Source.presentations());
    for (const entry of this.actorExecutions.values()) {
      if ((entry.kind === "q3" || entry.kind === "q3-source") || entry.kind === "quakec") continue;
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
        const frame = model?.frame ?? entity.frame, oldFrame = model?.oldFrame ?? entity.oldFrame;
        result.push({ actor: entity.actor.id, content: entry.content, family: "q2", path: entity.model,
          ...(entity.flare === null ? {} : { flare: entity.flare }),
          frame, oldFrame: oldFrame === -1 ? frame : oldFrame, skin: model?.skin ?? entity.skin, effects: model?.effects ?? entity.effects,
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
      const q2Entity = this.q2Characters.get(player.actor)?.entity ?? (player.character === "q2" && this.source.kind === "q2" ? this.source.game.entity(player.actor.id) : null);
      const q2Gibbed = this.q2Characters.get(player.actor)?.state.gibbed ?? (player.character === "q2" && this.source.kind === "q2" && this.source.players.states.get(player.actor.id)?.gibbed === true);
      const q1Player = this.source.kind === "q1" ? this.source.game.player(player.actor.id) : null;
      const colors = player.character === "q1" && this.source.kind === "q1" ? this.source.composition.clients.get(player.actor.id) : null;
      const visual = q1Player === null ? { alpha: 1, scale: 1 } : this.q1VisualFields(q1Player.alpha, q1Player.scale);
      result.push({ actor: player.actor.id, content: this.recipe.character.appearance.content, family: player.character,
        path: q2Entity?.model || this.q1Characters.get(player.actor)?.presentation.model || (player.character === "q1" ? "progs/player.mdl" : `players/${model}/tris.md2`), skinPath: player.character === "q2" && !q2Gibbed ? `players/${model}/grunt.pcx` : null,
        frame: q2Entity?.frame ?? (player.animation.state.kind === "q1" || player.animation.state.kind === "q2" ? player.animation.state.frame : 0), oldFrame: q2Entity?.oldFrame ?? 0,
        skin: q2Entity?.skin ?? 0, effects: q2Entity?.effects ?? 0, renderFlags: q2Entity?.renderFlags ?? 0, origin: body.origin, angles: body.angles, ...visual,
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
        ...selected.viewState(actor), timeMilliseconds: Math.trunc(this.selectedMilliseconds), weapon: arsenal.state.sourceWeapon,
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
    const appearances = this.modOwner?.appearanceOverrides();
    return [...this.playerStates].flatMap(([owner, player]): Q3CharacterView[] => {
      const character = this.characters.get(owner), body = this.bodies.read(owner.id), animation = character?.animation.state ?? player.animation.state;
      if (appearances?.has(owner.id) === true || player.character !== "q3" || player.intermission || player.cutscene !== null || body === null || animation.kind !== "q3") return [];
      const q1Player = this.source.kind === "q1" ? this.source.game.player(owner.id) : null;
      const visual = q1Player === null ? { alpha: 1, scale: 1 } : this.q1VisualFields(q1Player.alpha, q1Player.scale);
      return [{ actor: owner.id, origin: body.origin, angles: player.viewAngles, velocity: body.velocity,
        movementDirection: player.state.kind === "q3" ? player.state.movementDirection : 0, animation, sourceFlags: character?.sourceFlags ?? ((this.combat.read(owner.id)?.health ?? 0) <= 0 ? 1 : 0),
        powerups: 0, team: null, scale: visual.scale, opacity: visual.alpha, color: { x: 1, y: 1, z: 1, w: 1 } }];
    });
  }

  private grantSelectedArsenal(actor: ActorId, category: "weapons" | "ammo"): boolean {
    const arsenal = this.selectedArsenal; if (arsenal === null) return false;
    const player = this.requirePlayer(actor), weapons = new Set(arsenal.ui(actor, this.recipe.map.entities).items.filter(item => item.kind === "weapon").map(item => item.id));
    for (const entry of arsenal.read(actor).ammo) if ((category === "weapons") === weapons.has(entry.item))
      this.inventory.configure(player.actor, { ...entry, count: category === "weapons" ? 1 : entry.capacity });
    player.arsenal = arsenal.read(actor); return true;
  }

  private giveSelectedItem(actor: ActorId, args: readonly string[]): boolean {
    const arsenal = this.selectedArsenal; if (arsenal === null) return false;
    const last = args.at(-1), quantity = last !== undefined && /^-?\d+$/.test(last) ? Number(last) : null;
    const requested = (quantity === null ? args : args.slice(0, -1)).join(" ").toLowerCase();
    if (this.selectedQ3Source?.giveHoldable(this.requirePlayer(actor).actor, requested) === true) return true;
    const normalize = (value: string) => value.toLowerCase().replaceAll(" ", "").replaceAll("_", "");
    const entries = arsenal.read(actor).ammo, ui = arsenal.ui(actor, this.recipe.map.entities);
    const named = ui.items.find(item => normalize(item.id) === normalize(requested) || normalize(item.label) === normalize(requested));
    const entry = entries.find(entry => entry.item === named?.id || normalize(entry.item) === normalize(requested)
      || normalize(entry.item.split("/").at(-1) ?? "") === normalize(requested));
    if (entry === undefined) {
      const profile = this.source.kind === "q1" ? arsenal.family === "q3" ? Q1_Q3_SUPPLY_PROFILE : arsenal.family === "q2" ? Q1_Q2_SUPPLY_PROFILE : Q1_HIPNOTIC_SUPPLY_PROFILE
        : this.source.kind === "q2" ? arsenal.family === "q3" ? Q2_Q3_SUPPLY_PROFILE : arsenal.family === "q1" && arsenal.game.registeredWeapons.has("hipnotic:laser") ? Q2_HIPNOTIC_SUPPLY_PROFILE : Q2_Q1_SUPPLY_PROFILE
          : this.source.kind === "q3" ? arsenal.family === "q2" ? Q3_Q2_SUPPLY_PROFILE : arsenal.family === "q1" && arsenal.game.registeredWeapons.has("hipnotic:laser") ? Q3_HIPNOTIC_SUPPLY_PROFILE : Q3_Q1_SUPPLY_PROFILE : null;
      const weapon = profile?.weapons.find(item => item.source === requested), ammo = profile?.ammo.find(item => item.source === requested);
      const sourceItem = this.source.kind === "q2" ? this.source.items.lookup(requested) : null;
      const destinations = weapon?.destinations ?? ammo?.destinations;
      if (destinations === undefined) {
        if (sourceItem?.weapon === true || sourceItem?.kind === "ammo" || requested.startsWith("q1:weapon/") || requested.startsWith("q1:ammo/") || requested.startsWith("rogue:ammo/")) {
          this.events.message({ kind: "print", level: 2, text: `No selected-arsenal grant mapping for ${sourceItem?.name ?? requested}\n` }, actor); return true;
        }
        return false;
      }
      for (const item of destinations) {
        const target = this.inventory.entries(actor).find(entry => entry.item === item);
        if (target === undefined) throw new Error(`Selected grant destination is unavailable: ${item}`);
        const count = weapon === undefined ? quantity ?? (sourceItem?.kind === "ammo" ? target.count + sourceItem.quantity : target.capacity) : 1;
        this.inventory.configure(this.requirePlayer(actor).actor, { ...target, count: Math.max(0, count), capacity: Math.max(target.capacity, count) });
      }
      if (weapon !== undefined && this.source.kind === "q2") {
        const definition = this.source.weapons.registeredDefinitions().find(item => item.item === requested);
        const sourceAmmo = definition?.ammo == null ? null : this.source.items.lookup(definition.ammo);
        const mappedAmmo = sourceAmmo === null ? undefined : profile?.ammo.find(item => item.source === sourceAmmo.id);
        if (mappedAmmo !== undefined && sourceAmmo !== null) for (const item of mappedAmmo.destinations)
          this.inventory.give(this.requirePlayer(actor).actor, item, (this.source.game.options.deathmatchFlags & 8192) !== 0 ? 1000 : sourceAmmo.quantity);
        arsenal.pickupWeapons(this.requirePlayer(actor).actor, destinations, "better");
      }
      this.requirePlayer(actor).arsenal = arsenal.read(actor);
      return true;
    }
    const weapon = ui.items.some(item => item.id === entry.item && item.kind === "weapon"), count = weapon ? 1 : quantity ?? entry.capacity;
    this.inventory.configure(this.requirePlayer(actor).actor, { ...entry, count: Math.max(0, count), capacity: Math.max(entry.capacity, count) });
    this.requirePlayer(actor).arsenal = arsenal.read(actor); return true;
  }

  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
    if (this.source.kind === "q2-native") { const game = this.source.game, slot = this.nativeQ2Client(actor).slot + 1; q2GameCallback(() => game.command(slot, [name, ...args], args.join(" "))); return undefined; }
    if (name === "giveall") return this.playerCommand(actor, "give", ["all"]);
    if (name === "suicide") return this.playerCommand(actor, "kill", args);
    if (this.source.kind === "quakec" && name === "kill") {
      this.source.game.clientKill(actor); return undefined;
    }
    if (this.source.kind === "quakec" && (name === "god" || name === "notarget" || name === "noclip" || name === "fly" || name === "give")) {
      this.source.game.hostCheat(actor, name, args);
      if (name === "fly" || name === "noclip") this.requirePlayer(actor).setFlight(this.source.game.readMoveType(actor) === 5);
      return undefined;
    }
    const player = this.requirePlayer(actor);
    if (name === "fly" && this.source.kind === "q2") {
      const source = this.source, entity = source.game.entity(actor);
      if (entity === null) throw new Error("Q2 player entity missing");
      if (source.players.intermission.kind !== "playing") return undefined;
      const context = source.players.context(entity, source.game);
      if (!q2CheatsAllowed(context)) return undefined;
      const enabled = player.setFlight(!player.flight);
      if (enabled) context.state.noclip = false;
      context.hooks.emit({ kind: "print", target: actor, level: "high", text: `fly ${enabled ? "ON" : "OFF"}\n` });
      return undefined;
    }
    if (name === "fly" && this.source.kind === "q3") {
      const source = this.source, entity = source.game.records.byActor(actor);
      if (entity === null || entity.client === null) throw new Error("Q3 player entity missing");
      if (source.game.level.intermissionTime !== 0) { source.game.playerCommand(actor, name, args); return undefined; }
      if (!source.game.commands.cheatsOk(entity)) return undefined;
      const enabled = player.setFlight(!player.flight);
      if (enabled) entity.client.noclip = false;
      this.events.message({ kind: "print", level: 2, text: `fly ${enabled ? "ON" : "OFF"}\n` }, actor);
      return undefined;
    }
    if (this.source.kind === "q1" && (name === "say" || name === "say_team")) {
      if (args.length === 0) return undefined;
      const source = this.source, sender = source.composition.clients.require(actor), prefix = `\x01${sender.name}: `;
      const text = `${prefix}${args.join(" ").slice(0, Math.max(0, 62 - prefix.length))}\n`;
      for (const recipient of source.composition.clients.records.values()) {
        if (name === "say_team" && source.cvars.variableValue("teamplay") !== 0 && recipient.team !== sender.team) continue;
        source.game.message(recipient.actor.id, text, false);
      }
      return undefined;
    }
    if (this.source.kind === "q1" && name === "kill") {
      if (this.source.game.health(actor) <= 0) return this.source.game.message(actor, "Can't suicide -- already dead!\n", false);
      return this.source.composition.suicide(actor);
    }
    if (this.source.kind === "q1" && name === "give") {
      const source = this.source;
      if (source.game.options.deathmatch !== 0 && (source.game.options.edition === "classic" || source.cvars.variableValue("sv_cheats") === 0))
        return source.game.message(actor, "Cheats are disabled on this server.\n", false);
      return giveQ1(source.composition, actor, args);
    }
    if (this.source.kind === "q1" && (name === "god" || name === "notarget" || name === "noclip" || name === "fly")) {
      const source = this.source, client = source.composition.clients.require(actor);
      if (source.game.options.deathmatch !== 0 && (source.game.options.edition === "classic" || source.cvars.variableValue("sv_cheats") === 0)) {
        source.game.message(actor, "Cheats are disabled on this server.\n", false); return undefined;
      }
      let enabled: boolean;
      if (name === "god") {
        client.godMode = !client.godMode; enabled = client.godMode;
        this.combat.setTraits(player.actor, { invulnerable: enabled || (source.game.player(actor)?.powerups.get("invulnerability") ?? 0) > this.timeSeconds });
      } else if (name === "notarget") {
        enabled = !source.composition.noTarget(actor); source.composition.setNoTarget(actor, enabled);
      } else if (name === "fly") {
        enabled = player.setFlight(!player.flight);
      } else {
        const state = player.readState();
        enabled = !(state.kind === "q1-netquake" ? state.moveType === 8 : state.kind === "q1-quakeworld" ? state.spectator !== 0
          : state.kind === "q3" ? state.movementType === 1 : state.type === 1);
        this.setPlayerMovement(actor, { kind: "noclip", enabled });
      }
      source.game.message(actor, `${name === "god" ? "godmode" : name} ${enabled ? "ON" : "OFF"}\n`, false); return undefined;
    }
    if (this.weaponSlots.has(actor) && (name === "weapnext" || name === "weapprev" || name === "use")) {
      const ui = this.playerUi(actor), owned = ui.items.filter(item => item.kind === "weapon" && item.owned), requested = args.join("").toLowerCase().replaceAll(" ", "");
      const selected = name === "use" ? owned.find(item => item.id === requested || item.id === `q1:weapon/${requested}` || item.label.toLowerCase().replaceAll(" ", "") === requested)
        : owned[(owned.findIndex(item => item.id === ui.activeWeapon) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length];
      if (selected !== undefined) { const equipment = this.grapple?.weapon(); this.requestWeapon(actor, { provider: this.inventory.itemOwner(actor, selected.id) ?? (equipment?.item === selected.id ? equipment.provider : this.weaponProvider.provider), item: selected.id }); return undefined; }
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
    if (this.source.kind === "q3") {
      this.source.game.playerCommand(actor, name, args);
      if (name === "noclip" && this.source.game.records.byActor(actor)?.client?.noclip === true) player.setFlight(false);
      return undefined;
    }
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
    if (source.kind === "quakec") return { spawnPoint, source: source.game.captureTravel(), players: [] };
    if (source.kind === "loading" || source.kind === "q2-native") throw new Error("Source campaign travel requires its native source file lifecycle");
    if (source.kind === "q3" || source.kind === "q3-qvm") throw new Error("Q3 map rotation uses match session state instead of campaign travel carry");
    for (const player of this.playerStates.values()) this.grapple?.release(player.actor.id);
    const landmark = this.levelChange?.landmark ?? null;
    const landmarkPlayer = landmark === null ? null : this.player(landmark.player);
    return { spawnPoint, source: source.kind === "q1" ? { kind: "q1", flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }
      : { kind: "q2", serverFlags: this.levelChange?.serverFlags ?? source.game.counters.serverFlags,
        ...(source.product.match.source instanceof Q2Lmctf ? { lmctf: source.product.match.source.captureTravel() } : {}),
        ...(source.product.rerelease === null ? {} : { rerelease: structuredClone(source.product.rerelease.entities.campaign) }),
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

  private restoreCampaignTravel(travel: SimulationTravel): void {
    const source = this.source;
    if (source.kind !== "q2" || travel.source.kind !== "q2") throw new Error("Saved campaign revisits require matching Q2 source carry");
    source.game.counters.serverFlags = travel.source.serverFlags;
    if (travel.source.rerelease !== undefined) {
      if (source.product.rerelease === null) throw new Error("Rerelease campaign carry requires matching source state");
      source.product.rerelease.entities.restoreCampaign(travel.source.rerelease);
    }
    source.players.intermission = { kind: "playing" };
    this.levelChange = null; this.transitions.length = 0;
    for (const player of this.playerStates.values()) {
      const carried = travel.players.find(entry => entry.client.equals(player.client));
      const entity = source.game.entity(player.actor.id), state = source.players.states.get(player.actor.id);
      if (carried?.state.kind !== "q2" || entity === null || state === undefined) throw new Error("Campaign revisit requires current carry for every restored player");
      source.players.restoreCarry(entity, source.game, carried.state.carry);
      if (source.game.options.mode === "coop") state.coopRespawn = carried.state.carry;
      player.intermission = false; player.cutscene = null;
      const landmark = travel.source.landmark?.clientSlot === player.client.slot ? { ...travel.source.landmark, player: player.actor.id } : null;
      source.players.putInServer(entity, source.game, false, landmark);
      this.restoreSelectedTravel(player, carried);
      player.arsenal = this.arsenal(player); player.state = player.readState();
      this.handGrenades?.admit(player.actor.id, carried.handGrenades);
      if (carried.weaponSlot !== undefined && this.weaponSlots.has(player.actor.id)) {
        this.primaryHandoff(player.actor.id).holster();
        this.bindWeaponSlot(player.actor.id, { kind: "holstering-primary", next: carried.weaponSlot });
        this.weaponSlots.get(player.actor.id)?.reconcile();
      }
    }
    this.resumeQ2Presentation();
  }

  captureOriginalSave(format: import("../../../persistence/q1.ts").Q1SaveData["format"], comment: string): import("../../../persistence/q1.ts").Q1SaveData {
    this.assertCheckpointReady();
    if (this.source.kind !== "quakec") throw new Error("Original Quake export requires an idle NetQuake source");
    const recipe = this.recipe, owner = recipe.map.entities;
    const sourceOwned = (reference: ProviderReference): boolean => reference.content === owner.content && reference.provider === owner.provider;
    if (this.playerStates.size !== 1 || recipe.map.geometryContent !== owner.content
      || recipe.movement.provider !== "q1:movement" || !recipe.movement.content.startsWith("q1:")
      || recipe.character.definition.provider !== "q1:character" || !recipe.character.definition.content.startsWith("q1:")
      || recipe.character.appearance.provider !== "q1:model/player" || !recipe.character.appearance.content.startsWith("q1:")
      || recipe.weapons.length !== 1 || !recipe.weapons.every(sourceOwned)
      || ![recipe.combat, recipe.inventory, recipe.engineBehavior, recipe.transition, recipe.presentation.hud, recipe.presentation.effects, recipe.presentation.audio].every(sourceOwned)
      || recipe.presentation.assets !== owner.content
      || recipe.enemies.kind !== "map-defined" || (recipe.weaponBehaviors?.length ?? 0) !== 0
      || recipe.equipment.grapple.kind !== "disabled" || recipe.equipment.handGrenades.kind !== "disabled")
      throw new Error("Original Quake formats cannot preserve this mixed composition; use a shared save");
    return this.source.game.captureOriginalSave(format, comment);
  }

  restoreOriginalSave(save: import("../../../persistence/q1.ts").Q1SaveData): void {
    this.assertOpen();
    if (this.options.originalSaveCandidate !== true || this.source.kind !== "quakec" || this.stepping || this.timeSeconds !== save.time)
      throw new Error("Original save restoration requires a staged QuakeC world at the saved source time");
    this.source.game.restoreOriginalSave(save);
    for (const player of this.playerStates.values()) {
      player.arsenal = this.source.game.clientArsenal(player.actor.id);
      if (player.character === "q1") player.animation = this.source.game.clientAnimation(player.actor.id);
      player.state = player.readState();
      this.syncQuakeCClientView(player);
    }
  }

  pendingMatchMap(): string | null { return this.source.kind === "q2" && this.source.product.match.source instanceof Q2Lmctf ? this.source.product.match.source.match.pendingMap?.map ?? null : null; }

  takeTransitions(): readonly TransitionIntent[] { return this.transitions.splice(0); }
  takeLevelChange() { const change = this.levelChange; this.levelChange = null; return change; }
  private assertBotRestoreReady(): void {
    if (this.options.restore?.providers.some(record => record.schema === "world:bots") && this.botServices.configuration === null)
      throw new Error("Saved bot services must be restored before simulation advances or saves");
  }
  private assertCheckpointReady(): void {
    this.pendingSharedRestore?.assertComplete();
    this.combat.assertIdle();
    this.originalPickups.assertIdle();
    this.assertOpen();
    this.assertBotRestoreReady();
    if (this.sourceRoundSettlement.kind === "active" || this.sourceRoundSettlement.kind === "failed") throw new Error("Save requires completed source round settlement");
    if (this.stepping || this.checkpointInProgress || this.transitions.length !== 0 || this.levelChange !== null) throw new Error("Save requires a completed frame without pending world travel");
    const source = this.source;
    if (source.kind === "loading") throw new Error("The selected source world does not yet expose a complete saved-game checkpoint");
    if (this.quakeWorldCommands.length !== 0 || this.q3Commands.size !== 0 || this.primaryCommandBlocks.size !== 0) throw new Error("Save requires completed source commands");
    if (source.kind === "q3" || source.kind === "q3-qvm") this.events.assertOutputConsumed();
    if (source.kind === "q3" && [...this.playerStates.keys()].some(actor => !this.q3Arsenals.has(actor))) throw new Error("Q3 save requires completed client admission");
  }
  checkpoint(): SaveImage { return this.checkpointFromSource(); }
  async checkpointModsForTravel(): Promise<ModTravelCheckpoint | undefined> {
    this.assertOpen();
    if (this.stepping || this.checkpointInProgress) throw new Error("Mod checkpoint requires a completed frame");
    if (this.modOwner === null) return undefined;
    this.checkpointInProgress = true;
    try { return await this.modOwner.checkpointForTravel(); } finally { this.checkpointInProgress = false; }
  }
  async checkpointLoading(nextFrame: () => Promise<void>): Promise<SaveImage> {
    this.assertCheckpointReady();
    const source = this.source;
    if (source.kind === "q2-native" && source.edition === "rerelease" && (this.q2ServerRegistry === null || this.q2ServerRegistry.variableValue("deathmatch") !== 0))
      throw new Error("Native Quake II original saves require a non-deathmatch source game");
    this.checkpointInProgress = true;
    let captured: import("./rerelease-guest-world.ts").RereleaseGuestSave | undefined;
    let behaviors: WeaponBehaviorRuntimeCheckpoint;
    let mods: ModSessionCheckpoint | undefined;
    try {
      mods = await this.modOwner?.checkpoint();
      behaviors = await this.weaponBehavior.checkpointLoading(nextFrame);
      if (source.kind === "q2-native" && source.edition === "rerelease") captured = await source.game.writeSaveLoading(false, nextFrame);
    } finally { this.checkpointInProgress = false; }
    return this.checkpointFromSource(captured, behaviors, mods);
  }
  private checkpointFromSource(rereleaseSave?: import("./rerelease-guest-world.ts").RereleaseGuestSave, weaponBehaviors?: WeaponBehaviorRuntimeCheckpoint, mods?: ModSessionCheckpoint): SaveImage {
    this.assertCheckpointReady();
    if (mods === undefined && this.modOwner !== null && this.modOwner.enabled().length !== 0)
      throw new Error("Selected gameplay mods require asynchronous checkpointLoading");
    const source = this.source;
    if (source.kind === "loading") throw new Error("The selected source world has not completed loading");
    const nativeOriginal = source.kind !== "q2-native" ? null : (() => {
      const cvars = this.q2ServerRegistry;
      if (cvars === null || cvars.variableValue("deathmatch") !== 0) throw new Error("Native Quake II original saves require a non-deathmatch source game");
      if (source.edition === "rerelease") return encodeQ2RereleaseNativeSave({ module: source.game.module, map: this.recipe.map.geometry.requestedPath,
        api: { kind: "q2-rerelease-game", version: 2023 }, abi: "windows-x86-64", autosave: false,
        server: { configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
          portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })), cvars: encodeCheckpointValue(cvars.captureSaveState()) },
        ...(rereleaseSave ?? source.game.writeSave(false)), visitedLevels: [...source.visited.values()].filter(level => level.map !== this.recipe.map.geometry.requestedPath) });
      const captured = source.files.capture({ module: source.game.module, map: this.recipe.map.geometry.requestedPath }, () => ({
        configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
        portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })), cvars: encodeCheckpointValue(cvars.captureSaveState()),
      }), (game, level, autosave) => source.game.writeOriginal(game, level, autosave));
      return encodeQ2ClassicOriginalSave({ ...captured, visitedLevels: [...source.visited.values()].filter(level => level.map !== this.recipe.map.geometry.requestedPath) });
    })();
    const provider = this.recipe.map.entities.provider;
    for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    const providers: SaveImage["providers"][number][] = [sourceActorsCheckpoint(this.actors.sourceCheckpoint()), capturePrimaryProtection(this.actors, this.combat), captureSourceItems(this.actors, this.inventory), ...(nativeOriginal === null ? [] : [nativeOriginal])];
    const add = (schema: SaveImage["providers"][number]["schema"], bytes: Uint8Array) => providers.push({ provider, schema, version: schema === "world:simulation" ? 11 : 1, bytes });
    const bots = this.botServices.checkpoint();
    if (bots !== null) {
      this.events.assertOutputConsumed();
      add("world:bots", encodeCheckpointValue(bots));
    }
    const cvars = source.kind === "q1" ? source.cvars : source.kind === "q2" ? this.q2ServerRegistry : null;
    if (cvars !== null) add("world:source-cvars", encodeCheckpointValue(cvars.captureSaveState()));
    if (source.kind === "q1") add("q1:foundation", encodeQ1FoundationCheckpoint(source.game.capture()));
    else if (source.kind === "q2") providers.push(...captureQ2Product(source.product));
    else if (source.kind === "q3") {
      add("q3:native", source.game.captureNativeBytes());
      add("world:q3-runtime", encodeCheckpointValue({
        arsenals: [...this.q3Arsenals].map(([actor, state]) => ({ actor: savedActorId(actor.id), state })),
        movement: [...this.playerStates].map(([actor, player]) => ({ actor: savedActorId(actor.id), state: player.sourceMovement })),
        lastAttacks: [...this.lastAttack].map(([actor, attack]) => ({ actor: savedActorId(actor.id), attack: saveQ2Attack(attack) })),
      }));
    }
    const guests: SaveImage["guests"] = source.kind === "quakec" || source.kind === "q3-qvm" ? [source.game.checkpoint()] : [];

    add("world:simulation", encodeCheckpointValue({ settings: { skill: this.options.skill, mode: this.options.mode, maxClients: this.options.maxClients, seed: this.options.seed, startItems: this.startItems, initialSpawnPoint: this.initialSpawnPoint },
      modClientApplicationOrdinal: this.modClientApplications.checkpoint(), q1Punch: this.q1Punch.capture(),
      ...(source.kind === "q3-qvm" && source.combat !== null ? { qvmArmorProjection: 1 } : {}),
      ...(source.kind === "q3-qvm" && source.inventory !== null ? { qvmInventoryProjection: 1 } : {}),
      ...(source.kind === "q2-native" && source.game.services.hasSourceInventory ? { nativeInventoryProjection: 1 } : {}),
      players: [...this.playerStates.values()].map(captureMovementPlayer), hostMilliseconds: this.hostMilliseconds, q1Paused: this.q1PauseState,
      modClientCommands: [...this.modClientCommands.values()].map(value => {
        const client = this.playerClient(value.input.actor); if (client === null) throw new Error("Accepted command lost its live client");
        return captureModClientCommand(value, client);
      }),
      sourceSchedulingMilliseconds: this.sourceSchedulingMilliseconds,
      nativeClients: source.kind === "q2-native" ? source.game.clients.map(client => ({ clientSlot: client.slot - 1, phase: client.phase, userinfo: client.userinfo })) : null,
      attackSequence: this.attackSequence, q1ClientVisibility: this.q1ClientVisibility.capture(),
      sourceCvars: source.kind === "q1" && bots === null ? source.cvars.snapshots().map(value => ({ name: value.name, value: value.value })) : [],
      campaign: { flags: this.q1Campaign.flags, skill: this.q1Campaign.skill }, physics: this.physics.capture(), events: this.events.capture(),
      portals: [...this.areaPortals].map(([portal, open]) => ({ portal, open })),
      selectedQ3Source: this.selectedQ3Source === null ? null : { source: this.selectedQ3Source.capture(), milliseconds: this.selectedMilliseconds,
        time: this.selectedQ3Time, next: this.selectedQ3Next, strings: [...this.selectedQ3Strings].map(([index, value]) => ({ index, value })) },
      handGrenades: this.handGrenades?.capture() ?? null, grapple: this.grapple?.capture() ?? null, weaponSlots: [...this.weaponSlots].map(([actor, slot]) => ({ actor: savedActorId(actor), state: slot.snapshot() })),
      nativeEquipmentVelocity: [...this.nativeEquipmentVelocity].map(([actor, velocity]) => ({ actor: savedActorId(actor), velocity })),
      nativeWeaponRequests: [...this.nativeWeaponRequests].map(([actor, weapon]) => ({ actor: savedActorId(actor), weapon })),
      selectedMonsters: this.captureSelectedMonsters(), weaponBehaviors: weaponBehaviors ?? this.weaponBehavior.checkpoint(),
      selectedAmmoTimers: this.selectedAmmoTimers?.capture(this.selectedAmmoActors()) ?? null,
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
      q1CharacterFoundation: this.q1CharacterFoundation?.capture() ?? null,
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
      levelChange: null }));
    const actors = this.actors.observations();
    return { schemaVersion: 3, recipe: this.recipe, frame: this.sourceFrame, nextEventSequence: this.events.nextSequence, ...(mods === undefined ? {} : { mods }),
      clocks: [{ provider, time: this.sourceFrame.time }], random: [{ provider, state: this.random.checkpoint() }], actors: this.actors.checkpoint(),
      bodies: captureSharedBodies(this.actors, this.bodies),
      combat: actors.flatMap(actor => { const state = this.combat.read(actor.id); return state === null ? [] : [{ actor: savedActorId(actor.id), state }]; }),
      inventories: actors.flatMap(actor => this.inventory.has(actor.id) ? [{ actor: savedActorId(actor.id), entries: this.inventory.entries(actor.id) }] : []),
      configurations: this.players().map(actor => ({ actor: savedActorId(actor), movement: this.recipe.movement, character: this.recipe.character, weapons: this.recipe.weapons, inventory: this.recipe.inventory })),
      thinks: actors.flatMap(actor => { const pending = this.scheduler.pending(actor.id); return pending === null ? [] : [{ actor: savedActorId(actor.id), callback: pending.callback,
        ...(pending.timing.executionProvider === undefined ? {} : { executionProvider: pending.timing.executionProvider }),
        due: pending.timing.due, boundary: pending.timing.boundary, provider: pending.timing.order.provider, sequence: pending.timing.order.sequence }]; }), providers, guests };
  }

  private async restoreNativeLoading(save: SaveImage, nextFrame: () => Promise<void>): Promise<void> {
    const source = this.source;
    if (source.kind !== "q2-native") throw new Error("Native original loading requires its source provider");
    if (source.edition === "rerelease") {
      const original = nativeQ2RereleaseSave(save);
      if (original === null || this.q2ServerRegistry === null || this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Native rerelease save requires a matching non-deathmatch source");
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
      await source.game.initLoading(nextFrame);
      if (this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Selected DLL does not support non-deathmatch original saves");
      await source.game.readSaveLoading(original, { map: this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, source.edition, this.options.mode), spawnPoint: this.initialSpawnPoint }, () => {
        source.game.restoreConfigstrings(new Map(original.server.configstrings.map(entry => [entry.index, entry.value])));
        for (const { portal, open } of original.server.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
      }, nextFrame);
      return;
    }
      const original = nativeQ2OriginalSave(save);
      if (original === null || this.q2ServerRegistry === null || this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Native original save requires a matching non-deathmatch source");
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
      await source.game.initLoading(nextFrame);
      if (this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Selected DLL does not support non-deathmatch original saves");
      await source.files.restoreLoading(original, { module: source.game.module, map: this.recipe.map.geometry.requestedPath }, async (game, level) => {
        await source.game.restoreOriginalLoading(game, level, { map: this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, source.edition, this.options.mode), spawnPoint: this.initialSpawnPoint }, () => {
          source.game.restoreConfigstrings(new Map(original.server.configstrings.map(entry => [entry.index, entry.value])));
          for (const { portal, open } of original.server.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
        }, nextFrame);
      });
  }

  private restore(save: SaveImage, nativeRestored = false): undefined {
    save = this.sourceItemsRestore?.primary ?? save;
    const source = this.source;
    if (source.kind === "loading") throw new Error("The selected source world does not expose a complete saved-game restore");
    if (source.kind === "q2-native") {
      if (!nativeRestored && source.edition === "rerelease") {
      const original = nativeQ2RereleaseSave(save);
      if (original === null || this.q2ServerRegistry === null || this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Native rerelease save requires a matching non-deathmatch source");
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
      source.game.init();
      if (this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Selected DLL does not support non-deathmatch original saves");
      source.game.readSave(original, { map: this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, source.edition, this.options.mode), spawnPoint: this.initialSpawnPoint }, () => {
        source.game.restoreConfigstrings(new Map(original.server.configstrings.map(entry => [entry.index, entry.value])));
        for (const { portal, open } of original.server.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
      });
      }
      if (!nativeRestored && source.edition === "classic") {
      const original = nativeQ2OriginalSave(save);
      if (original === null || this.q2ServerRegistry === null || this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Native original save requires a matching non-deathmatch source");
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
      source.game.init();
      if (this.q2ServerRegistry.variableValue("deathmatch") !== 0) throw new Error("Selected DLL does not support non-deathmatch original saves");
      source.files.restore(original, { module: source.game.module, map: this.recipe.map.geometry.requestedPath }, (game, level) => {
        source.game.restoreOriginal(game, level, { map: this.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""), entities: prepareNativeQ2Map(this.options.world, source.edition, this.options.mode), spawnPoint: this.initialSpawnPoint }, () => {
          source.game.restoreConfigstrings(new Map(original.server.configstrings.map(entry => [entry.index, entry.value])));
          for (const { portal, open } of original.server.portals) { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); }
        });
      });
      }
      for (const saved of nativeQ2SavedClients(save)) {
        const client = this.options.restoredClients?.find(client => client.slot === saved.clientSlot);
        if (client === undefined) throw new Error("Native saved client has no retained session identity");
        const connected = source.game.connect(client.slot + 1, saved.userinfo);
        if (!connected.allowed) throw new Error("Native source rejected restored client");
        this.registerQ2NativeClient(client, "restore");
        if (saved.phase === "active") source.game.begin(client.slot + 1);
      }
      this.actors.rebindRestoredSource(source.game.module.id);
      if (source.game.services.hasSourceInventory) for (const actor of source.clients.values()) {
        const saved = save.inventories.find(entry => this.actors.resolveSaved(entry.actor) === actor);
        this.bindEquipmentInventory(actor, saved?.entries ?? []);
      }
    }
    const reconstructed = (actor: ActorId) => source.kind === "q2-native" && this.actors.sourceOf(actor)?.provider === source.game.module.id;
    const reader = simulationSaveReader(save), reference = (value: SaveReader) => this.actors.referenceSaved(readSavedActor(value));
    for (const entry of reader.field("nativeEquipmentVelocity").value === undefined ? [] : reader.field("nativeEquipmentVelocity").list(value => value))
      this.nativeEquipmentVelocity.set(reference(entry.field("actor")), readVector(entry.field("velocity")));
    for (const entry of reader.field("nativeWeaponRequests").value === undefined ? [] : reader.field("nativeWeaponRequests").list(value => value))
      this.nativeWeaponRequests.set(reference(entry.field("actor")), entry.field("weapon").integer(0));
    const owner = (value: SaveReader): OwnedActor => { const actor = this.actors.resolveSaved(readSavedActor(value)); if (actor === null) return value.fail("Missing restored actor"); return actor; };
    const random = save.random.find(value => value.provider === this.recipe.map.entities.provider)?.state;
    if (random?.kind !== "glibc-random" && random?.kind !== "q2-rerelease-mt19937") throw new Error("Save has no matching source random stream");
    this.random.restore(random);
    this.hostMilliseconds = reader.field("hostMilliseconds").finite();
    const paused = reader.field("q1Paused"); this.q1PauseState = paused.value === undefined ? false : paused.boolean();
    const scheduling = reader.field("sourceSchedulingMilliseconds");
    this.sourceSchedulingMilliseconds = scheduling.value === undefined ? this.hostMilliseconds : scheduling.finite();
    this.attackSequence = reader.field("attackSequence").integer(0);
    this.q1ClientVisibility.restore(reader.field("q1ClientVisibility").value);
    this.q1Campaign.flags = reader.field("campaign").field("flags").number(); this.q1Campaign.skill = reader.field("campaign").field("skill").choice(0, 1, 2, 3);
    if ((source.kind === "q2-native" || source.kind === "q3-qvm") && (this.recipe.equipment.grapple.kind === "enabled" || this.recipe.equipment.handGrenades.kind === "enabled")) {
      for (const entry of save.inventories) {
        const actor = this.actors.resolveSaved(entry.actor);
        if (actor !== null && this.playerClient(actor.id) !== null && !this.inventory.has(actor.id)) this.bindEquipmentInventory(actor, entry.entries);
      }
    }
    const qvmArmorProjection = reader.field("qvmArmorProjection");
    if (qvmArmorProjection.value !== undefined) qvmArmorProjection.literal(1);
    const legacyQvmCombat = qvmArmorProjection.value === undefined && source.kind === "q3-qvm" ? source.combat : null;
    const qvmInventoryProjection = reader.field("qvmInventoryProjection");
    if (qvmInventoryProjection.value !== undefined) {
      qvmInventoryProjection.literal(1);
      if (source.kind !== "q3-qvm" || source.inventory === null) throw new Error("Saved QVM inventory requires qualified source storage");
    }
    const nativeInventoryProjection = reader.field("nativeInventoryProjection");
    if (nativeInventoryProjection.value !== undefined) {
      nativeInventoryProjection.literal(1);
      if (source.kind !== "q2-native" || !source.game.services.hasSourceInventory) throw new Error("Saved native inventory requires qualified source storage");
    }
    let inventories = save.inventories;
    const restoreInventoryCoverage = (actors: readonly OwnedActor[], legacy: boolean): void => {
      inventories = [...inventories];
      for (const actor of actors) {
        const index = inventories.findIndex(entry => this.actors.resolveSaved(entry.actor) === actor);
        const previous = index < 0 ? undefined : inventories[index], entries = this.inventory.entries(actor.id);
        if (!legacy) {
          if (previous === undefined || !isDeepStrictEqual(previous.entries, entries)) throw new Error("Saved native inventory disagrees with restored source storage");
          continue;
        }
        if (previous?.entries.some(entry => !isDeepStrictEqual(entry, entries.find(current => current.item === entry.item))))
          throw new Error("Legacy source inventory disagrees with restored source storage");
        const savedActor = previous?.actor ?? save.actors.find(entry => this.actors.resolveSaved(entry) === actor);
        if (savedActor === undefined) throw new Error("Restored source inventory has no saved actor identity");
        const migrated = { actor: { slot: savedActor.slot, generation: savedActor.generation }, entries };
        inventories = index < 0 ? [...inventories, migrated] : inventories.map((entry, position) => position === index ? migrated : entry);
      }
    };
    if (source.kind === "q2-native" && source.game.services.hasSourceInventory)
      restoreInventoryCoverage([...source.clients.values()], nativeInventoryProjection.value === undefined);
    if (qvmInventoryProjection.value === undefined && source.kind === "q3-qvm" && source.inventory !== null) {
      restoreInventoryCoverage(this.actors.ownedBy(this.recipe.map.entities.provider).filter(actor => {
        const slot = source.game.records.slot(actor.id);
        return slot !== null && slot < source.game.game.data.numClients && this.inventory.has(actor.id);
      }), true);
    }
    const sharedSave = { ...save, inventories: this.sourceItemsRestore?.effective(inventories) ?? inventories, combat: legacyQvmCombat === null ? save.combat : save.combat.map(entry => {
      const actor = this.actors.resolveSaved(entry.actor);
      if (actor === null || this.actors.sourceOf(actor.id)?.provider !== this.recipe.map.entities.provider) return entry;
      return { ...entry, state: { ...entry.state, armor: legacyQvmCombat.normalizeLegacyArmor(actor.id, entry.state.armor) } };
    }) };
    this.pendingSharedRestore = restoreSharedWorldState(sharedSave, { actors: this.actors, bodies: this.bodies, combat: this.combat, inventory: this.inventory,
      storage: actor => reconstructed(actor.id) ? "source-reconstructed" : (source.kind === "quakec" || source.kind === "q3-qvm") && this.actors.sourceOf(actor.id)?.provider === this.recipe.map.entities.provider ? "prebound" : "copied" }, { deferProtection: true });
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
    if (source.kind === "q3") {
      const native = nativeQ3RuntimeReader(save);
      for (const entry of native.arsenals) {
        const actor = this.actors.resolveSaved(entry.actor);
        if (actor === null || !this.playerStates.has(actor) || this.q3Arsenals.has(actor) || entry.state.product !== source.game.options.product)
          throw new Error("Saved Q3 arsenal has no unique matching player and product");
        this.q3Arsenals.set(actor, entry.state);
      }
      const movement = new Set<OwnedActor>();
      for (const entry of native.movement) {
        const actor = this.actors.resolveSaved(entry.actor), player = actor === null ? undefined : this.playerStates.get(actor);
        if (actor === null || player === undefined || movement.has(actor)) throw new Error("Saved Q3 movement has no unique matching player");
        movement.add(actor); player.sourceMovement = entry.state;
      }
      if (movement.size !== this.playerStates.size || this.q3Arsenals.size !== this.playerStates.size) throw new Error("Saved Q3 player continuation is incomplete");
      for (const entry of native.lastAttacks) {
        const actor = this.actors.resolveSaved(entry.actor);
        if (actor === null || this.lastAttack.has(actor)) throw new Error("Saved Q3 attack has no unique matching actor");
        this.lastAttack.set(actor, restoreQ2Attack(entry.attack, saved => this.actors.referenceSaved(saved)));
      }
      if (providerFamily(this.recipe.combat.provider) === "q3") this.disposeSourceCombat = this.combat.register(source.game.bridge.policy());
      source.game.finishNativeRestore();
    }
    const selectedSource = reader.field("selectedWeaponSource"), weaponSource = this.selectedWeaponSource;
    if (weaponSource !== null) {
      selectedSource.field("kind").literal(weaponSource.kind);
      const random = readRandom(selectedSource.field("random"));
      if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") selectedSource.field("random").fail("Selected source requires its native random stream");
      else weaponSource.random.restore(random);
      if (weaponSource.kind === "q1") {
        if (providerFamily(this.recipe.character.definition.provider) === "q1") this.q1CharacterSource();
        weaponSource.game.restore(readQ1FoundationCheckpoint(selectedSource.field("entities")), { scheduleThinks: false });
      }
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
            arsenal.restoreTurn(owner(value.field("actor")).id, { buttons: state.field("buttons").integer(), latchedButtons: state.field("latchedButtons").integer(), weaponThunk: state.field("weaponThunk").boolean(),
              firing: state.field("firing").value === undefined || state.field("firing").value === null ? null : { weapon: state.field("firing").field("weapon").string(), credit: state.field("firing").field("credit").number() } });
          });
        }
      }
      for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    } else if (selectedSource.value !== null) selectedSource.fail("Saved selected weapon source has no matching authority");
    const bytes = (schema: SaveImage["providers"][number]["schema"]) => simulationProviderCheckpoint(save, schema).bytes;
    if (source.kind === "q1" && savedSourceCvars(save) === undefined) reader.field("sourceCvars").list(value => { source.cvars.set(value.field("name").string(), value.field("value").string(), true); return undefined; });
    if (source.kind === "q1") source.game.restore(decodeQ1FoundationCheckpoint(bytes("q1:foundation")), { scheduleThinks: false });
    else if (source.kind === "q2") {
      restoreQ2Product(source.product, save.providers);
      const savedCvars = savedSourceCvars(save);
      if (this.q2ServerRegistry !== null && savedCvars !== undefined) restoreQ2ServerCvars(this.q2ServerRegistry, savedCvars);
    }
    const selectedQ3 = reader.field("selectedQ3Source"), oldBallistics = reader.field("selectedBallistics");
    const legacyQ3 = oldBallistics.value !== undefined && oldBallistics.value !== null;
    const selectedClients = this.selectedArsenal?.family === "q3" ? reader.field("selectedArsenals").list(value => ({
      actor: owner(value.field("actor")), state: readQ3SelectedArsenalCheckpoint(value.field("state")),
    })) : [];
    if (this.selectedQ3Source !== null) {
      if (legacyQ3) {
        if (selectedQ3.value !== undefined && selectedQ3.value !== null) oldBallistics.fail("Saved Q3 source has two projectile owners");
        if (this.source.kind !== "q1" && this.source.kind !== "q2") oldBallistics.fail("Legacy Q3 source requires its original foreign map");
        const saved = readLegacyQ3Source(oldBallistics, owner, saved => this.actors.referenceSaved(saved));
        this.selectedMilliseconds = saved.milliseconds; this.selectedQ3Time = Math.trunc(saved.milliseconds);
        const timing = providerTiming(this.recipe, this.weaponProvider.provider).clock;
        if (timing.kind !== "q3" || this.selectedQ3Time < 0 || this.selectedQ3Time > 2147483647) oldBallistics.fail("Invalid legacy Q3 source clock");
        else this.selectedQ3Next = this.selectedQ3Time + timing.serverFrameMilliseconds;
        if (new Set(selectedClients.map(client => client.actor)).size !== this.playerStates.size
          || selectedClients.length !== this.playerStates.size || selectedClients.some(client => !this.playerStates.has(client.actor)))
          oldBallistics.fail("Legacy Q3 source client coverage differs from its saved players");
        this.selectedQ3Source.restoreLegacy(saved, selectedClients);
      } else {
        this.selectedMilliseconds = selectedQ3.field("milliseconds").finite(); this.selectedQ3Time = selectedQ3.field("time").finite(); this.selectedQ3Next = selectedQ3.field("next").finite();
        for (const value of selectedQ3.field("strings").list(value => ({ index: value.field("index").integer(0), value: value.field("value").string() }))) this.selectedQ3Strings.set(value.index, value.value);
        this.selectedQ3Source.restore(selectedQ3.field("source").value);
      }
    } else if (legacyQ3 || selectedQ3.value !== undefined && selectedQ3.value !== null) selectedQ3.fail("Saved Q3 source has no selected owner");
    const selected = reader.field("selectedArsenals");
    if (this.selectedArsenal?.family === "q3") {
      const arsenal = this.selectedArsenal;
      for (const client of selectedClients) {
        const state = legacyQ3 && (this.source.kind === "q1" || this.source.kind === "q2") ? migrateLegacyQ3Arsenal(client.state, this.source.kind) : client.state;
        arsenal.restore(client.actor, state);
      }
      for (const player of this.playerStates.values()) player.arsenal = this.arsenal(player);
    } else if (selected.value !== undefined && selected.value !== null) selected.fail("Saved selected arsenal has no matching authority");
    const monsters = reader.field("selectedMonsters");
    if (this.selectedMonsters !== null) this.restoreSelectedMonsters(readSelectedMonstersCheckpoint(monsters));
    else if (monsters.value !== null) monsters.fail("Saved selected monsters have no matching admission");
    const grapple = reader.field("grapple");
    if (this.grapple !== null) this.grapple.restore(readGrappleRuntimeCheckpoint(grapple));
    else if (this.recipe.equipment.grapple.kind === "enabled" && this.recipe.equipment.grapple.mechanic === "q3-qvm")
      this.pendingQvmGrappleRestore = { grapple: readGrappleRuntimeCheckpoint(grapple), slots: readWeaponSlots(reader.field("weaponSlots")) };
    else if (grapple.value !== undefined && grapple.value !== null) grapple.fail("Saved grapple has no selected controller");
    this.weaponSlots.clear();
    if (this.pendingQvmGrappleRestore === null) for (const saved of readWeaponSlots(reader.field("weaponSlots"))) { const actor = this.actors.resolveSaved(saved.actor); if (actor === null) throw new Error("Saved slot actor is missing"); this.bindWeaponSlot(actor.id, saved.state); }
    const equipment = reader.field("handGrenades");
    if (this.handGrenades !== null) this.handGrenades.restore(readHandGrenadeRuntimeCheckpoint(equipment));
    else if (equipment.value !== undefined && equipment.value !== null) equipment.fail("Saved equipment has no selected controller");
    if ((source.kind === "q2-native" || source.kind === "q3-qvm") && (this.grapple !== null || this.handGrenades !== null))
      for (const actor of this.players()) { this.nativeEquipmentPlayers.add(actor); this.nativeEquipmentAlive.set(actor, this.equipmentPlayerAvailable(actor)); }

    const characterFoundation = reader.field("q1CharacterFoundation");
    if (characterFoundation.value !== undefined && characterFoundation.value !== null) this.q1CharacterSource().restore(readQ1FoundationCheckpoint(characterFoundation), { scheduleThinks: false });
    reader.field("q1Characters").list(value => {
      const actor = owner(value.field("actor")), player = this.requirePlayer(actor.id);
      const character = this.attachQ1Character(player);
      character.restore(value.field("bytes").bytes());
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
        timeMilliseconds: () => Math.trunc(this.timeSeconds * 1000), emit: event => this.events.emit(this.recipe.character.definition.content, { kind: "q3-character", event: { ...event, actor: event.actor.id } }),
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
      const actor = reference(value.field("actor"));
      if (attached.length > 3) return value.fail("Q2 attached models exceed three slots");
      // Native original saves reconstruct authoritative model slots; older caches compacted empty slots.
      if (reconstructed(actor)) return;
      if (attached.length !== 3 || first === undefined || second === undefined || third === undefined) return value.fail("Q2 attached models must retain three slots");
      this.sourceModels.set(actor, { kind: "model", actor, path: value.field("path").string(), attachedModels: [first, second, third], frame: value.field("frame").number(), oldFrame: value.field("oldFrame").number(),
        scale: value.field("scale").number(), skin: value.field("skin").number(), effects: value.field("effects").number(), renderFlags: value.field("renderFlags").number(), alpha: value.field("alpha").value === undefined ? 1 : value.field("alpha").finite() });
    });
    this.levelChange = reader.field("levelChange").nullable(value => ({ map: value.field("map").string(), serverFlags: value.field("serverFlags").number(), landmark: value.field("landmark").nullable(value => ({ player: reference(value.field("player")), name: value.field("name").string(),
      relativeOrigin: readVector(value.field("relativeOrigin")), relativeVelocity: readVector(value.field("relativeVelocity")), relativeViewAngles: readVector(value.field("relativeViewAngles")) })) }));
    this.physics.restoreCheckpoint(reader.field("physics"), source.kind === "q3" || source.kind === "q3-qvm", reconstructed);
    reader.field("portals").list(value => { const portal = value.field("portal").integer(0), open = value.field("open").boolean(); this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); });
    restoreSharedBodyLinks(save, { actors: this.actors, bodies: this.bodies, storage: actor => reconstructed(actor.id) ? "source-reconstructed" : "copied" });
    this.physics.restoreSpatial(reader.field("physics"), reconstructed);
    if (source.kind === "q2" && this.q2ServerRegistry !== null) {
      if (savedSourceCvars(save) === undefined) this.q2ServerRegistry.set("sv_gravity", String(this.physics.gravity), true);
      else if (this.q2ServerRegistry.find("sv_gravity") === undefined) this.q2ServerRegistry.register("sv_gravity", String(this.physics.gravity), 0);
    }
    for (const think of save.thinks) {
      const actor = this.actors.resolveSaved(think.actor); if (actor === null) throw new Error("Saved think has no restored actor");
      this.scheduler.schedule(actor, think.callback, { due: think.due, boundary: think.boundary,
        ...(think.executionProvider === undefined ? {} : { executionProvider: think.executionProvider }),
        order: { actor: actor.id, provider: think.provider, sequence: think.sequence } });
    }
    this.q1Punch.restore(reader.field("q1Punch"));
    if (reader.field("q1Punch").value === undefined && this.selectedArsenal?.family === "q1" && this.selectedWeaponSource?.kind === "q1") {
      for (const actor of this.players()) {
        const previous = this.selectedWeaponSource.game.player(actor);
        if (previous !== null) this.q1Punch.write(actor, previous.punchAngles);
      }
    }
    this.weaponBehavior.restore(reader.field("weaponBehaviors"));
    this.modClientApplications.restore(reader.field("modClientApplicationOrdinal").value === undefined ? 0 : reader.field("modClientApplicationOrdinal").integer(0));
    for (const value of readModClientCommands(reader.field("modClientCommands"), { identity: this.options.identity,
      actor: saved => this.actors.referenceSaved(saved), client: actor => this.playerClient(actor) })) this.modClientCommands.set(value.input.actor, value);
    this.events.restore(reader.field("events"), actor => this.actors.referenceSaved(actor));
    this.resumeQ2Presentation();
    const ammoTimers = reader.field("selectedAmmoTimers");
    if (this.selectedAmmoTimers !== null && source.kind === "q3") this.selectedAmmoTimers.restore(ammoTimers, this.selectedAmmoActors(), (actor, weapon) => {
      const client = source.game.records.nativeByActor(actor)?.client;
      if (client == null) return ammoTimers.fail("Saved ammo timer has no original source client");
      return client.ammoTimes.get(weapon);
    });
    else if (ammoTimers.value !== undefined && ammoTimers.value !== null) ammoTimers.fail("Saved ammo timers have no selected source owner");
    if (this.events.nextSequence !== save.nextEventSequence) throw new Error("Save event sequence disagrees with its source journal");
    return undefined;
  }
  close(): undefined {
    if (this.checkpointInProgress) throw new Error("Await checkpoint completion before closing the simulation");
    if (this.closed) return undefined;
    const guest = this.q3Guest();
    if (guest !== null && !guest.isRetired) throw new Error("Q3 guest shutdown must be awaited before closing its shared world");
    const errors: unknown[] = [];
    try { this.modOwner?.close(); } catch (error) { errors.push(error); }
    try { if (this.grapple?.source.kind === "q3-qvm") this.grapple.source.game.close(); } catch (error) { errors.push(error); }
    try { this.weaponBehavior.close(); } catch (error) { errors.push(error); }
    try { this.q2Native()?.close(); } catch (error) { errors.push(error); }
    this.closed = true;
    this.modClientApplications.close();
    this.modClientListeners.clear(); this.modClientAdmissions.clear(); this.modClientCommands.clear(); this.modClientDrops.length = 0;
    this.debugLineStore.clear(); this.debugLineSnapshot = []; this.worldTextStore.clear(); this.worldTextSnapshot = [];
    for (const close of [() => this.selectedAmmoTimers?.close(), () => this.selectedQ3Source?.close(), () => this.actors.close(), () => this.q3Source()?.close(), () => this.disposeSourceCombat?.(), () => this.scheduler.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    this.disposeSourceCombat = null;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Simulation source and shared owner shutdown failed");
    return undefined;
  }
  private assertOpen(): undefined { if (this.closed) throw new Error("Simulation is closed"); return undefined; }
}

export function createSimulation(options: SimulationOptions): SharedSimulation { return new SharedSimulation(options); }
import { readSelectedMonstersCheckpoint } from "./monster-checkpoint.ts";
import type { SelectedMonstersCheckpoint } from "./monster-checkpoint.ts";


export function* orderedActorTurns(
  actors: SessionActorRegistry,
  positionOf: (actor: OwnedActor) => readonly [number, number],
  visited: Set<OwnedActor>,
): Generator<OwnedActor, void, unknown> {
  let revision = -1;
  let cursor: readonly [number, number] | null = null;
  let pending: { readonly actor: OwnedActor; readonly position: readonly [number, number] }[] = [];
  let index = 0;
  for (;;) {
    if (revision !== actors.revision) {
      pending = [];
      for (const observation of actors.observations()) {
        const actor = actors.resolveOwned(observation.id);
        if (actor !== null && !visited.has(actor)) pending.push({ actor, position: positionOf(actor) });
      }
      pending.sort((left, right) => left.position[0] - right.position[0] || left.position[1] - right.position[1]);
      revision = actors.revision;
      index = 0;
    }
    const next = pending[index++];
    if (next === undefined) return;
    if (visited.has(next.actor) || cursor !== null && (next.position[0] < cursor[0]
      || next.position[0] === cursor[0] && next.position[1] <= cursor[1])) continue;
    cursor = next.position;
    visited.add(next.actor);
    yield next.actor;
  }
}

export function loadSimulation(options: SimulationOptions, nextFrame: () => Promise<void>): Promise<SharedSimulation> { return SharedSimulation.load(options, nextFrame); }
