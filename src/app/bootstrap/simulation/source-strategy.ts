// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, ClientId, ProviderId } from "../../../contracts/identity.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { q2Userinfo } from "../../../content/q2/base/player/index.ts";
import type { Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { ArsenalState, MovementState, QwMovementProfile, QwMovementState } from "../../../contracts/movement.ts";
import type { QwUserCommand } from "../../../contracts/protocol.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { Q1TravelState } from "../../../content/q1/base/index.ts";
import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import type { Q3SourceRuntime } from "./q3/runtime.ts";
import type { Q1Powerup } from "../../../content/q1/foundation/types.ts";
import type { DamageDecision, InventoryEntry, ItemId, SourceDamageModifier } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import type { SharedPickupAdmission } from "../../../world/gameplay/pickups.ts";
import type { NativePrimaryPlayer } from "../../../compat/q2/native-primary-player.ts";
import type { NativePrimaryWeapons } from "../../../compat/q2/native-primary-weapons.ts";
import type { QvmPrimaryWeapons } from "../../../compat/qvm/game-weapons.ts";
import { q3WeaponDelay } from "../../../movement/q3/weapon.ts";
import { q3WeaponDamageFactor } from "../../../content/q3/base/game/weapon.ts";
import { returnQ3PersistentPowerup } from "../../../content/q3/base/game/death.ts";
import { Powerup, statSchema } from "../../../content/q3/base/shared/definitions.ts";
import { itemAt } from "../../../content/q3/base/shared/items.ts";
import { dropQ3TeleportObjectives } from "../../../content/q3/team-arena/client-events.ts";
import { dropFlag as dropQ1CtfFlag } from "../../../content/q1/addons/ctf/flags.ts";
import { Q2Ctf } from "../../../content/q2/multiplayer/ctf/index.ts";
import { WEAPONS as Q1_WEAPONS, isQ1BaseWeapon, q1WeaponBit } from "../../../content/q1/foundation/types.ts";
import { Q2RereleasePlayers } from "../../../content/q2/rerelease/players.ts";
import type { Q2WeaponEvent } from "../../../content/q2/foundation/weapons/index.ts";
import type { SaveImage } from "../../../contracts/session.ts";
import { captureQ2Product } from "../../../content/composition/q2/index.ts";
import { encodeCheckpointValue, encodeQ1FoundationCheckpoint } from "../../../persistence/index.ts";
import { MoveType } from "../../../movement/q3/constants.ts";
import { seconds } from "./actor-execution.ts";
import { quakeCFreeMovement } from "./quakec-client-adapter.ts";
import type { MovementPlayer, PlayerMovementHost } from "./players.ts";
const Q1_CORPSE_FRAME = 60;
import type { PlayerAdmission, SimulationTravel } from "./types.ts";
import { sourceTeamCommand, sourceScore } from "../../../contracts/source-match.ts";
import { q2GameCallback } from "../network/types.ts";
import { PersistentIndex } from "../../../content/q3/base/shared/definitions.ts";
import type { preparedNativePrimary } from "./q2-native-world.ts";
import { q3GuestPlayerUi } from "./q3/guest-player.ts";
import { rereleaseGuestPlayerView, rereleaseGuestPlayerUi } from "./rerelease-guest-player.ts";
import { classicGuestPlayerView, classicGuestPlayerUi } from "./classic-guest-player.ts";
import { q1WeaponStatus, q2WeaponStatus, q3WeaponStatus, q3ArsenalWarning } from "./arsenal/weapon-status.ts";
import { q3WeaponItem, Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import { q1PowerupTimers, q2PowerupTimers, q3PowerupTimers } from "./powerup-timers.ts";
import { add3 as add } from "../../../core/math.ts";
import { providerFamily } from "./players.ts";
import type { PlayerUi, PlayerUiItem, PlayerView, SimulationPresentation } from "./types.ts";
import type { Q1SelectedArsenal } from "./arsenal/q1.ts";
import type { Q2SelectedArsenal } from "./arsenal/q2.ts";
import type { Q3SelectedArsenal } from "./arsenal/q3.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import type { ExecutableRecipe, ProviderReference } from "../../../contracts/content.ts";
import type { SimulationOptions } from "./types.ts";
import type { NativePrimaryInventory } from "../../../compat/q2/native-primary-inventory.ts";
import { giveQ1 } from "../../../content/composition/q1/give.ts";
import { q2CheatsAllowed } from "../../../content/q2/base/player/commands.ts";
import { Q2_Q1_SUPPLY_PROFILE, Q2_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q2-q1-supply.ts";
import { Q3_Q1_SUPPLY_PROFILE, Q3_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q3-q1-supply.ts";
import { Q1_HIPNOTIC_SUPPLY_PROFILE } from "../../../content/composition/q1-hipnotic-supply.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../content/composition/q2-q3-supply.ts";
import { Q1_Q3_SUPPLY_PROFILE } from "../../../content/composition/q1-q3-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE } from "../../../content/composition/q1-q2-supply.ts";
import { Q3_Q2_SUPPLY_PROFILE } from "../../../content/composition/q3-q2-supply.ts";
import type { PickupSupplyProfile } from "../../../contracts/pickups.ts";
import type { Q2PlayerMovementChange } from "../../../content/q2/base/player/types.ts";
import { stepQ3Arsenal, type Q3ArsenalRuntimeState } from "../../../content/q3/foundation/arsenal.ts";
import { projectQ2Arsenal } from "./arsenal/q2.ts";
import { readQ3ArsenalRuntime, writeQ3ArsenalRuntime } from "./q3/index.ts";
import { resolveQ3ArsenalControls } from "./arsenal-intent.ts";
import { CommandButtons, MoveFlags, EntityEvent as MovementEntityEvent } from "../../../movement/q3/constants.ts";
import type { AnimationStepInput, AnimationStepResult, WeaponStepInput, WeaponStepResult } from "../../../contracts/movement.ts";
import { emitQ2ShadowLights } from "../../../content/q2/foundation/shadow-lights.ts";
import type { CvarRegistry as ServerCvarRegistry } from "../../../core/cvars/index.ts";
import type { ServerSettingsOwner } from "../../../settings/server/index.ts";
import type { Q3SourceRuntime as Q3Game } from "./q3/runtime.ts";
import { q3RequestWeapon, q3RequestWeaponHolster, q3RequestWeaponResume } from "../../../content/q3/foundation/arsenal.ts";
import { writeQ3CharacterAnimation } from "./q3/index.ts";
import type { PrimaryWeaponHandoff } from "./weapon-slot.ts";
import type { Q2WeaponInput } from "../../../content/q2/foundation/weapons/types.ts";
import { quakeCCharacterAnimation } from "./quakec-character-animation.ts";
import { decodeQ1FoundationCheckpoint, type SaveReader } from "../../../persistence/index.ts";
import { restoreQ2Product } from "../../../content/composition/q2/index.ts";
import { restoreQ2ServerCvars, savedQ2ServerCvarsHave } from "../../../settings/server/index.ts";
import {
  simulationProviderCheckpoint,
  nativeQ3RuntimeReader,
  savedSourceCvars,
  nativeQ2RereleaseSave,
  nativeQ2OriginalSave,
  nativeQ2SavedClients,
} from "./save.ts";
import { encodeQ2RereleaseNativeSave, type Q2RereleaseNativeImport } from "./native-q2-rerelease-save.ts";
import type { Q2ClassicOriginalImport } from "../../../persistence/q2-classic-guest.ts";
import type { RereleaseGuestSave } from "./rerelease-guest-world.ts";
import { encodeQ2ClassicOriginalSave } from "../../../persistence/q2-classic-guest.ts";
import { restoreQ2Attack } from "../../../content/q2/foundation/checkpoint.ts";
import type { AttackProvenance } from "../../../contracts/gameplay.ts";
import type { SourceRuntime } from "./runtime.ts";

/** The files of an original save folder or archive, read back and not yet bound to a module. */
export type NativeQ2Import = Q2ClassicOriginalImport | Q2RereleaseNativeImport;
function isRereleaseImport(imported: NativeQ2Import): imported is Q2RereleaseNativeImport {
  return !(imported.game instanceof Uint8Array);
}

export interface GuestMonsterProxy {
  allocate(): number | null;
  bind(slot: number, actor: OwnedActor): void;
}

/** The server state an original native save carries. */
export interface NativeSavedServer {
  /** Null when the save never wrote the current level, which leaves the freshly spawned level and its configstrings alone. */
  readonly level: unknown;
  readonly server: {
    readonly configstrings: readonly { readonly index: number; readonly value: string }[];
    readonly portals: readonly { readonly portal: number; readonly open: boolean }[];
  };
}

/** The checks and request a restore of an original native save runs with. */
export interface NativeRestorePlan<O> {
  readonly original: O;
  afterInit(): void;
  readonly request: { readonly map: string; readonly entities: string; readonly spawnPoint: string };
  applyServerState(): void;
}

type Of<K extends SourceRuntime["kind"]> = Extract<SourceRuntime, { readonly kind: K }>;

/** What a strategy may ask of the simulation that owns it; the simulation's own stores stay the single copy. */
export interface SourceStrategyHost {
  readonly q2Views: Map<ActorId, Q2PlayerView>;
  playerClient(actor: ActorId): ClientId | null;
  nativeQ2Client(actor: ActorId): ClientId;
  /** Whether the Q2 player has a cutscene camera. */
  hasCutscene(actor: ActorId): boolean;
  /** Raises the userinfo client event when the source's stored userinfo no longer equals `previous`. */
  userinfoChanged(actor: ActorId, previous: string | null): void;
  readonly playerStates: ReadonlyMap<OwnedActor, MovementPlayer>;
  /** The simulation's current clock reading in seconds. */
  readonly timeSeconds: number;
  readonly sourceFrame: FrameContext;
  requirePlayer(actor: ActorId): MovementPlayer;
  isLive(actor: ActorId): boolean;
  admitPlayer(client: ClientId): PlayerAdmission;
  admitQ2NativePlayer(client: ClientId, userinfo: string): PlayerAdmission;
  admitQuakeCPlayer(source: Of<"quakec">, client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission;
  admitQ3Player(client: ClientId, game: Q3SourceRuntime): PlayerAdmission;
  prepareQ3Client(client: ClientId, game: Q3SourceRuntime, bot: boolean): OwnedActor;
  /** Whether a bot may take the client's slot: owned by this session, in range and unoccupied. */
  botSlotAvailable(client: ClientId): boolean;
  spawnQ1Player(source: Of<"q1">, actor: OwnedActor, player: MovementPlayer): void;
  attachQ2Character(player: MovementPlayer): void;
  /** Whether the Q2 weapon set drives the player: no selected arsenal replaces it. */
  usesQ2Weapons(): boolean;
  hasPendingStartItems(actor: ActorId): boolean;
  giveQ2StartItems(actor: ActorId): void;
  resumeQ2Presentation(actor: ActorId): void;
  projectQuakeCAttack(actor: OwnedActor, before: ArsenalState): void;
  arsenal(player: MovementPlayer): ArsenalState;
  syncQuakeCClientView(player: MovementPlayer): void;
  syncQ3Player(player: MovementPlayer): void;
  runQuakeWorldNewMissile(): void;
  runEntityThink(actor: ActorId, frame: FrameContext): void;
  /** The Q1 and Q2 character presentation steps that follow a client's think. */
  afterClientThink(actor: OwnedActor): void;
  /** Re-links the actor's body and fires the triggers it now touches. */
  relink(actor: OwnedActor): void;
  commitAttachments(): void;
  setQ3Command(actor: OwnedActor, command: ActorCommand | null): void;
  setWorldGravity(gravity: number): void;
  health(actor: ActorId): number;
  body(actor: ActorId): { readonly origin: Vec3; readonly velocity: Vec3 } | null;
  sourceOf(actor: ActorId): { readonly provider: ProviderId; readonly slot: number } | null;
  readonly q2ServerRegistry: CvarRegistry | null;
  readonly areaPortals: ReadonlyMap<number, boolean>;
  registerQ2NativeClient(client: ClientId, mode: "live" | "restore"): OwnedActor;
  bindEquipmentInventory(actor: OwnedActor, initial: readonly InventoryEntry[]): void;
  nativeRestorePrelude<O extends NativeSavedServer>(source: Of<"q2-native">, original: O | null, visit: (original: O) => void): NativeRestorePlan<O>;
  readonly q1Campaign: Pick<Extract<SimulationTravel["source"], { readonly kind: "q1" }>, "flags" | "skill">;
  assertOutputConsumed(): void;
  q3ArsenalsComplete(): boolean;
  q3RuntimeBytes(): Uint8Array;
  qvmDeclaration(): string | null;
  requireOwned(actor: ActorId): OwnedActor;
  sharedTravelState(actor: ActorId): CarriedShared | null;
  readonly q1Restart: boolean;
  /** The actors the map's entity provider owns. */
  entityActors(): readonly OwnedActor[];
  hasInventory(actor: ActorId): boolean;
  nativeWeapons(): NativePrimaryWeapons;
  qvmWeapons(): QvmPrimaryWeapons;
  nativePlayer(): NativePrimaryPlayer;
  /** Whether the foreign match's haste rules apply to the actor. */
  hasteFlag(actor: ActorId): boolean;
  /** The selected arsenal's firing delay through the original native weapon policy. */
  nativeWeaponDelay(actor: ActorId, seconds: number): number;
  nativeEquipmentDelay(actor: ActorId, provider: ProviderId, seconds: number): number;
  nativeAvailable(actor: ActorId): boolean;
  /** The Q1 powerup expiry the selected Q1 weapon source tracks for the actor. */
  selectedQ1Powerup(actor: ActorId, powerup: Q1Powerup): number;
  readonly entitiesProvider: ProviderId;
  /** The native Q2 primary's declared match profile, when it has one. */
  nativeMatch(): NonNullable<ReturnType<typeof preparedNativePrimary>>["player"]["match"];
  notifyClientEvent(kind: "userinfo", actor: ActorId): void;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly weaponProvider: ProviderReference;
  readonly recipe: ExecutableRecipe;
  readonly options: SimulationOptions;
  readonly selectedArsenal: Q1SelectedArsenal | Q2SelectedArsenal | Q3SelectedArsenal | null;
  playerView(actor: ActorId): PlayerView;
  foreignNativeCharacter(): boolean;
  hasNativeCharacterHost(actor: ActorId): boolean;
  nativeInventory(actor: ActorId): ReturnType<NativePrimaryInventory["read"]> | undefined;
  readonly selectedOriginalSupply: PickupSupplyProfile | null;
  printMessage(actor: ActorId, text: string): void;
  setPlayerMovement(actor: ActorId, change: Q2PlayerMovementChange): void;
  readonly q3Arsenals: Map<OwnedActor, Q3ArsenalRuntimeState>;
  commitCharacterAnimation(actor: OwnedActor, animation: WeaponStepResult["animation"]): void;
  reconcileSlot(actor: ActorId): void;
  /** Whether the selected Q3 ballistics own the equipment, so the source's holdable steps are skipped. */
  ownsQ3Equipment(): boolean;
  playerWeapon(player: MovementPlayer): void;
  readonly worldGravity: number;
  withQ2Rules(run: () => void): void;
  quakeCCharacterStep(input: AnimationStepInput): AnimationStepResult;
  runQuakeWorldCommands(): void;
  releaseGrapple(actor: ActorId): void;
  removeHandGrenade(actor: ActorId): void;
  releasePickupBinding(actor: ActorId): void;
  forgetPlayer(player: MovementPlayer): void;
  entryCarry(actor: OwnedActor): Q1TravelState | null;
  readonly nativeWeaponRequests: Map<ActorId, number>;
  q2WeaponInput(player: MovementPlayer): Q2WeaponInput;
  primaryUi(actor: ActorId): PlayerUi;
  readonly characters: ReadonlyMap<OwnedActor, { readonly respawnEligibleAfterMilliseconds: number }>;
  readonly lastAttack: Map<OwnedActor, AttackProvenance>;
  readonly actors: import("../../../world/actors/registry.ts").SessionActorRegistry;
  readonly combatAuthority: GameplayAuthority;
  setSourceCombatDisposer(dispose: () => undefined): void;
}

/** What a selected Q3 arsenal reads from the primary source's player. */
export interface SelectedPlayerStats {
  readonly maxHealth: number;
  /** The source's own team number, or null when the combat team decides. */
  readonly team: number | null;
  readonly quadUntil: number;
  readonly hasteUntil: number;
}

/** The original player services a native or QVM primary exposes to a selected arsenal. */
export interface OriginalPlayer {
  setMaxHealth(actor: ActorId, health: number): void;
  teleport(actor: ActorId, origin: Vec3, velocity: Vec3, angles: Vec3, holdMilliseconds: number): void;
}

type Q2MatchDamageEffects = ReturnType<Of<"q2">["product"]["match"]["sourceEffects"]>;
type CarriedShared = Extract<CarriedPlayerState, { readonly kind: "shared" }>;
type SaveProvider = SaveImage["providers"][number];
type TravelLandmark = NonNullable<Extract<SimulationTravel["source"], { readonly kind: "q2" }>["landmark"]>;
/** What a source needs to describe the level change a campaign travel captures. */
export interface TravelContext {
  readonly serverFlags: number | null;
  readonly landmark: TravelLandmark | null;
}
export interface InventoryCoverage {
  readonly actors: readonly OwnedActor[];
  readonly legacy: boolean;
}
export interface EquipmentSuppression {
  readonly quad: boolean;
  readonly quadFire: boolean;
  readonly haste: boolean;
}
export type SupplyFamily = "q1" | "q2" | "q3";
type SpawnPoint = { readonly origin: Vec3; readonly angles: Vec3 };
const NO_SUPPRESSION: EquipmentSuppression = { quad: false, quadFire: false, haste: false };
const NATIVE_SUPPRESSION: EquipmentSuppression = { quad: true, quadFire: true, haste: true };

export type CarriedPlayerState = SimulationTravel["players"][number]["state"];
export type PlayerBindings = Pick<PlayerMovementHost, "netQuake" | "sourceClient" | "quakeWorld">;
type Q3NativeClient = NonNullable<ReturnType<Of<"q3">["game"]["records"]["nativeByActor"]>>["client"];
type SelectedArsenal = Q1SelectedArsenal | Q2SelectedArsenal | Q3SelectedArsenal;
type Q2Entity = ReturnType<Of<"q2">["game"]["attachPlayer"]> | null;
type Moved = ReturnType<MovementPlayer["move"]>;

/** One command batch the Q1 pre-think phase reads. */
export interface PreFrameInput {
  readonly elapsed: number;
  readonly commands: readonly ActorCommand[];
  readonly players: Iterable<MovementPlayer, undefined, unknown>;
  /** Whether a mod client application defers the command's own pre-think to its execution. */
  readonly deferred: boolean;
  readonly pending: Map<MovementPlayer, number> | null;
}

export interface PauseControl {
  readonly cvars: CvarRegistry;
  isSpectator(actor: ActorId): boolean;
}

/** The per-source behavior of a SharedSimulation, chosen once when its source is created. */
export interface SourceStrategy {
  /** The actor's userinfo string as the source stores it, or null when the source has none. */
  userinfo(actor: ActorId): string | null;
  /** Replaces the stored userinfo without running the source's change callbacks. */
  storeUserinfo(actor: ActorId, client: ClientId, userinfo: string): void;
  /** Applies a userinfo change through the source's own path; the result is awaited by the caller. */
  updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void | Promise<void>;
  /** Pause settings, or null when the source cannot pause. */
  pause(): PauseControl | null;

  // Spawn.
  /** Admits through the source's own path, or null when the shared Q1/Q2 admission applies. */
  admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission | null;
  prepareBot(client: ClientId): OwnedActor;
  initialArsenalState(): ArsenalState["state"];
  /** Attaches the source entity of a new player; null when the source has none. */
  attachEntity(actor: OwnedActor, player: MovementPlayer): Q2Entity;
  configureAdmitted(
    actor: OwnedActor,
    client: ClientId,
    player: MovementPlayer,
    entity: Q2Entity,
    userinfo: string | undefined,
    travel: SimulationTravel | undefined,
  ): void;
  /** Attaches the Q2 character presentation a Q1 source gives its Q2-dressed players. */
  attachForeignCharacter(player: MovementPlayer): void;
  /** Lands the source's own carry; true when it carried the player. */
  admitCarry(actor: OwnedActor, entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean;
  enterWorld(actor: OwnedActor, player: MovementPlayer, fresh: boolean): void;
  captureEntryCarry(actor: OwnedActor): Q1TravelState | null;
  movementBindings(actor: OwnedActor, selectedClock: string): PlayerBindings;
  q2Gibbed(actor: ActorId): boolean;
  /** The native Q3 client of the actor: null when the source is not Q3, undefined when it has no record. */
  q3Client(actor: ActorId): Q3NativeClient | null | undefined;
  /** Whether the source's own gamecode supplies the punch angles. */
  suppliesPunch(): boolean;
  skipsTriggerTouch(actor: ActorId): boolean;

  // Step.
  lmctf(): Q2Lmctf | null;
  preparesQ1Clients(): boolean;
  intermissionFading(): boolean;
  fadeIntermission(): void;
  beginTimedFrame(elapsed: number): void;
  beginGuestFrame(frame: FrameContext): void;
  /** Starts the source's turn over its actors for one boundary. */
  beginActorTurns(frame: FrameContext): void;
  intermissionActive(): boolean;
  requestIntermissionExit(actor: ActorId, buttons: number): void;
  preFrame(input: PreFrameInput): void;
  /** Runs the deferred pre-think of a Q1 player; false when the player did not survive it. */
  preThink(player: MovementPlayer, command: ActorCommand): boolean;
  /** Runs the player's command through the source's own think; false when the shared movement applies. */
  playerThink(player: MovementPlayer, command: ActorCommand): boolean;
  /** Whether the source tracks per-player gravity in the movement state. */
  tracksGravity(): boolean;
  gravityScale(actor: ActorId): number;
  movementApplied(actor: ActorId, moved: Moved): void;
  afterPlayerCommand(player: MovementPlayer, paused: boolean): void;
  beforeClientActor(actor: OwnedActor): void;
  retouch(actor: OwnedActor): void;
  spectating(actor: ActorId): boolean;
  /** Runs the actor through the source's own player turn; false when it has none. */
  runPlayerActor(actor: OwnedActor): boolean;
  watchesTransitions(): boolean;

  // Selected arsenals and combat.
  selectedPlayer(actor: ActorId): SelectedPlayerStats;
  /** The Q3 game type the source runs, or null when the recipe's match decides. */
  q3GameType(): number | null;
  q3ServerInfo(): string;
  /** Whether the source runs the Team Arena equipment natively. */
  primaryEquipment(): boolean;
  /** Whether the source supplies the selected Q3 weapon effects. */
  hasEquipmentEffects(): boolean;
  /** The source's damage factor for the actor's weapons; null when the shared rule applies. `quad` includes the source's quad factor. */
  weaponDamageFactor(actor: ActorId, quad: boolean): number | null;
  equipmentDamageFactor(actor: ActorId): number;
  equipmentFiringDelay(actor: ActorId, milliseconds: number, persistent: number): number;
  weaponDelay(actor: ActorId, seconds: number): number;
  equipmentDelay(actor: ActorId, provider: ProviderId, seconds: number): number;
  curvesEnabled(): boolean;
  playerCurveClip(): boolean;
  friendlyFire(): boolean;
  knockback(): number;
  intermissionQueued(): number;
  checkHurtCarrier(target: ActorId, attacker: ActorId): void;
  checkObeliskAttack(target: ActorId, attacker: ActorId): boolean;
  quadFactor(): number;
  proximityTimeout(): number;
  returnPickup(actor: ActorId): void;
  teleportSpawn(actor: OwnedActor): SpawnPoint;
  dropObjectives(actor: OwnedActor): void;
  /** The original player services of a native or QVM primary; null when the source has none. */
  originalPlayer(): OriginalPlayer | null;
  setMaxHealth(actor: ActorId, health: number): void;
  installPickupAdmission(admission: SharedPickupAdmission): void;
  /** The weapon family the source's own arsenal belongs to. */
  supplyFamily(): SupplyFamily;
  /** Whether the source gamecode owns the arsenal's pickup supply. */
  ownsSupply(): boolean;
  /** Whether the source's supply is its own Q3 weapon set unchanged. */
  identitySupply(): boolean;
  extraReplacedItems(): readonly ItemId[];
  animatesWeaponFire(): boolean;
  noteFired(actor: ActorId, item: ItemId | null): void;
  weaponNoise(actor: ActorId, origin: Vec3, kind: "weapon" | "impact"): undefined;
  allowsAutoSwitch(actor: ActorId): boolean;
  /** The source's own server cvars; null when the shared server settings registry applies. */
  cvars(): CvarRegistry | null;
  q1PowerupExpires(actor: ActorId, powerup: Q1Powerup): number;
  damageModifier(): SourceDamageModifier | null;
  runsQ3Powerups(): boolean;
  equipmentSuppression(): EquipmentSuppression;
  monsterNoise(actor: ActorId, origin: Vec3, secondary: boolean | undefined): undefined;
  /** Whether the source's native player owns the grapple and offhand equipment state. */
  ownsEquipmentPlayers(): boolean;
  sourceInventory(actor: ActorId): InventoryStateBinding | null;
  /** Whether the equipment owner counts as alive; null when the shared player rule applies. */
  playerAvailable(actor: ActorId): boolean | null;
  /** Whether the shared hand grenade step runs for the source's players. */
  stepsHandGrenades(): boolean;
  /** The source's teleport toggle bits for the actor, or null when it keeps none. */
  teleportBits(actor: ActorId): number | null;

  // Combat and monsters.
  /** Whether the source marks the actor notarget; null when the source keeps no such flag for it. */
  notarget(actor: ActorId): boolean | null;
  cloakAlpha(actor: ActorId): number | null;
  godMode(actor: ActorId): boolean;
  /** Runs the source's own handling of a Q2 weapon event; false when the source has none. */
  weaponEvent(event: Q2WeaponEvent): boolean;
  hasEnemy(target: ActorId): boolean;
  teamDamageEnabled(matchProvider: string): boolean;
  matchDamageEffects(): Q2MatchDamageEffects;
  /** Reports weapon noise to the monsters; throws `message` when the source has none yet. */
  requiredMonsterNoise(actor: ActorId, origin: Vec3, secondary: boolean | undefined, message: string): undefined;
  /** Throws `message` unless the source is a Q2 game. */
  requireQ2(message: string): void;
  pushed(actor: ActorId, velocity: Vec3): void;
  setEntityGravity(actor: ActorId, gravity: number): void;
  monstersSearching(player: ActorId | null): boolean;
  /** The Q1 game that owns weapon selection when no selected arsenal does. */
  q1Game(): Of<"q1">["game"] | null;
  selectWeapon(actor: OwnedActor, item: ItemId): boolean;
  /** The source's connected clients in its own order; null when the shared session order applies. */
  connectedClients(): readonly ClientId[] | null;
  /** The source's player actors in its own order; null when the shared session order applies. */
  playerActors(): readonly ActorId[] | null;

  // Saves, restore and travel.
  /** Throws `message` while the source world is still loading. */
  requireLoaded(message: string): void;
  /** Throws unless the source can save at this frame. */
  assertSaveReady(): void;
  /** Whether the guest's own save projects its selected monsters instead of recreating them. */
  projectsMonsters(): boolean;
  /** Whether selected monsters on this source restore as copied shared state. */
  usesGuestMonsters(): boolean;
  /** Whether the source gamecode rebuilds the actor itself on restore. */
  reconstructsActor(actor: ActorId): boolean;
  /** Adds the source's own checkpoint providers. */
  checkpointProviders(add: (schema: SaveProvider["schema"], bytes: Uint8Array) => void, providers: SaveProvider[]): void;
  checkpointGuests(): SaveImage["guests"];
  /** Source-specific fields of the simulation checkpoint. */
  checkpointExtras(): Readonly<Record<string, number | string | null>>;
  nativeClients(): readonly { readonly clientSlot: number; readonly phase: string; readonly userinfo: string }[] | null;
  sourceCvarSnapshots(): readonly { readonly name: string; readonly value: string }[];
  /** The primary QVM interface digest a save must match; null when the source has none. */
  expectedDeclaration(): string | null;
  legacyCombat(): Of<"q3-qvm">["combat"];
  /** Throws unless the source has the storage a saved inventory projection of `kind` needs. */
  requireInventoryProjection(kind: "qvm" | "native"): void;
  /** The actors whose inventory the source's own storage owns; null when the source keeps none. */
  inventoryCoverage(projected: { readonly native: boolean; readonly qvm: boolean }): InventoryCoverage | null;
  travelSource(context: TravelContext): SimulationTravel["source"];
  /** The clients that carry through a campaign travel, in the source's own order; null for the shared player order. */
  travelers(): readonly { readonly client: ClientId; readonly actor: ActorId }[] | null;
  travelPlayerState(actor: ActorId): CarriedPlayerState;
  guestHealth(actor: ActorId): number | null;
  setGuestHealth(actor: ActorId, health: number): void;
  /** Guest players whose pending travel carry may land, with whether they are in the world. */
  guestTravelPlayers(): readonly { readonly actor: ActorId; readonly client: ClientId; readonly alive: boolean }[];
  /** Maps the source's own team name onto the shared team ids. */
  canonicalTeam(original: string | null): string | null;
  /** Whether the source declares a match score and team command for its players. */
  declaresMatch(): boolean;
  matchScore(actor: ActorId): number;
  setMatchScore(actor: ActorId, value: number): void;
  setMatchTeam(actor: ActorId, requested: string | null): void;
  /** Whether the source draws its players' UI and view from guest records instead of the shared player state. */
  hasGuestUi(): boolean;
  guestUi(actor: ActorId): PlayerUi;
  /** The player whose state the UI shows: a spectating Q2 observer follows its chase target. */
  uiSubject(actor: ActorId): ActorId;
  clientUi(actor: ActorId): ReturnType<Of<"quakec">["game"]["clientUi"]> | null;
  uiPowerups(actor: ActorId): PlayerUi["powerups"];
  arsenalUi(actor: ActorId, arsenal: ArsenalState): ArsenalUiParts;
  /** The view built from the source's guest records, or null when the shared player state draws it. */
  guestView(actor: ActorId): PlayerView | null;
  /** Whether the actor is a Q2 observer following a chase target. */
  chasing(actor: ActorId): boolean;
  cutsceneFov(fov: number | undefined): number;
  /** A view the source overrides after the shared one is built, or null to keep it. */
  overrideView(actor: ActorId, view: PlayerView, intermission: boolean, health: number): PlayerView | null;
  /** Whether the source draws a foreign character's death view and body from its own player. */
  foreignCharacterDeath(): boolean;
  rereleaseViewHeight(): boolean;
  presentations(fraction: number, backLerp: number): readonly SimulationPresentation[];
  /** Whether a first-person weapon model may exist for an actor without shared player state. */
  guestWeaponViews(): boolean;
  usesQ2Views(): boolean;
  q2PlayerEntity(actor: ActorId): Q2Entity;
  q1Player(actor: ActorId): ReturnType<Of<"q1">["game"]["player"]> | null;
  q1Colors(actor: ActorId): { readonly shirt: number; readonly pants: number } | null | undefined;
  /** The first-person weapon model's visibility when the source decides it, else null for the health rule. */
  weaponVisible(actor: ActorId): boolean | null;
  guestBobCycle(actor: ActorId): number;
  /** Whether the source renders its own intermission instead of the chosen character. */
  rendersOwnIntermission(): boolean;
  /** Whether the source answers every player command itself. */
  forwardsCommands(): boolean;
  /** Runs a command only this source owns; true when it consumed the command. */
  preCommand(actor: ActorId, name: string, args: readonly string[]): boolean;
  /** The weapon and item commands the source handles after the shared ones decline. */
  afterCommand(actor: ActorId, player: MovementPlayer, name: string, args: readonly string[]): void;
  setIdentity(actor: ActorId, identity: SourceIdentity): void;
  /** Applies a field-of-view change the source owns; false leaves it to the shared character. */
  setFieldOfView(actor: ActorId, fieldOfView: number, mode: "change" | "restore"): boolean;
  /** The source's authoritative angle delta for a Q3 command, when it keeps one. */
  angleDelta(actor: ActorId, client: ClientId): readonly number[] | undefined;
  /** The movement state a component command's angles are relative to; undefined defers to the shared player. */
  commandMovement(client: ClientId): MovementState | undefined;
  /** Items the guest's own ammo rows keep out of a shared grant. */
  guestGrantExclusions(): ReadonlySet<ItemId> | null;
  grantProfile(arsenal: SelectedArsenal): PickupSupplyProfile | null;
  sourceItem(requested: string): ReturnType<Of<"q2">["items"]["lookup"]> | null;
  /** Gives the weapon's own ammo and selects it after a mapped weapon grant. */
  grantedWeapon(owner: OwnedActor, arsenal: SelectedArsenal, requested: string, destinations: readonly ItemId[], profile: PickupSupplyProfile | null): void;
  /** The arsenal the source reports before any selected arsenal replaces it. */
  baseArsenal(player: MovementPlayer): ArsenalState;
  q1Client(actor: ActorId): ReturnType<Of<"q1">["composition"]["clients"]["require"]> | null;
  q1Impulse(actor: ActorId): void;
  /** Whether a match pause freezes the selected arsenal. */
  weaponsPaused(): boolean;
  /** Steps a source holdable before the selected arsenal; true when it consumed the step. */
  stepSelectedHoldable(player: MovementPlayer, input: WeaponStepInput): boolean;
  /** Steps the source's own arsenal; null leaves the shared weapon projection to answer. */
  primaryWeaponStep(player: MovementPlayer, input: WeaponStepInput): WeaponStepResult | null;
  /** The source's weapon-frame facts for the Q2 weapon engine. */
  weaponFacts(actor: ActorId): WeaponFacts;
  /** Whether source impulses are consumed by the source itself rather than the shared arsenal. */
  dropsImpulse(): boolean;
  /** Whether an arsenal command without a weapon slot goes straight to the weapon request. */
  requestsWeaponDirectly(): boolean;
  /** Whether such a request is made even for the weapon already held. */
  alwaysRequestsWeapon(): boolean;
  /** Whether a movement contact is handled by the source's own physics. */
  ownsContacts(actor: ActorId): boolean;
  quakeWorldContacts(): boolean;
  /** Voices the jump through the source's own player; true when it did. */
  jumpVoice(actor: OwnedActor, player: MovementPlayer): boolean;
  animation(input: AnimationStepInput): AnimationStepResult | null;
  /** The arsenal after a client's attack, for sources that project it onto a foreign character. */
  attackArsenal(actor: ActorId): ArsenalState | null;
  playerWeapon(player: MovementPlayer): void;
  /** Typed access to the source this strategy wraps; null for every other source. */
  /** Whether the source hosts guest monsters projected onto the shared world. */
  /** The kind of source this strategy wraps, for descriptors. */
  readonly kind: SourceRuntime["kind"];
  /** Gives the player a thirty second quad where the source has one. */
  grantQuad(actor: ActorId): void;
  admitsGuestMonsters(): boolean;
  /** Refuses an original save the source cannot represent. */
  assertSavable(): void;
  /** The source's own save taken a frame at a time, when it has one. */
  captureGuestSave(nextFrame: () => Promise<void>, autosave: boolean): Promise<RereleaseGuestSave | undefined>;
  /**
   * The source's own original save as a checkpoint provider; null when it keeps none. An autosave is what the original
   * writes on entering a level: it carries no file for a level the unit has not left before.
   */
  originalSave(guestSave: RereleaseGuestSave | undefined, autosave: boolean): SaveProvider | null;
  /** Restores the source's own original save a frame at a time. */
  restoreLoading(save: SaveImage, nextFrame: () => Promise<void>): Promise<void>;
  /** Starts the world from the files of an original save folder, a frame at a time. */
  importLoading(imported: NativeQ2Import, nextFrame: () => Promise<void>): Promise<void>;
  /** Starts the world from the files of an original save folder. */
  importOriginal(imported: NativeQ2Import): void;
  /** Restores the source's own original save and reconnects its saved clients. */
  restoreGuest(save: SaveImage, nativeRestored: boolean): void;
  /** The map edition a native guest declares itself; null defers to the map's own edition. */
  guestEdition(): "classic" | "rerelease" | null;
  /** The guest stand-in entities shared monsters need to be addressed by guest slot; null when the guest needs none. */
  monsterProxy(): GuestMonsterProxy | null;
  asQ1(): Of<"q1"> | null;
  asQ2(): Of<"q2"> | null;
  asQuakeC(): Of<"quakec"> | null;
  asQ3(): Of<"q3"> | null;
  asQ3Qvm(): Of<"q3-qvm"> | null;
  asQ2Native(): Of<"q2-native"> | null;
  /** How a step is driven: the native frame loop, an awaited guest step, or the shared step. */
  stepRoute(): "native" | "awaited" | "shared";
  /** Whether a round settlement belongs to this source. */
  settles(game: Q3Game): boolean;
  /** Pulls the source's own gravity setting into the shared world before a step. */
  syncGravity(): void;
  afterStep(): void;
  /** The source's end-of-frame work after its actors have run. */
  finishFrame(run: boolean): void;
  concludeFrame(): void;
  q1Powerups(actor: ActorId): ReadonlyMap<Q1Powerup, number> | undefined;
  /** The player's powerup expiry times as foreign monsters read them; guest worlds keep no public timers. */
  foreignPowerups(actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number };
  q1CharacterFrame(actor: ActorId, frame: Parameters<Of<"q1">["composition"]["characterFrame"]>[1]): void;
  teamGame(): boolean;
  serverCvars(): ServerCvarRegistry | null;
  serverSettingsOwner(owner: ServerSettingsOwner): ServerSettingsOwner;
  /** The client a player belongs to when the source keeps its own roster; undefined defers to the shared players. */
  clientOf(actor: ActorId): ClientId | null | undefined;
  /** Removes a player from the source; "release" asks the caller to release the shared actor. */
  disconnect(actor: ActorId, player: MovementPlayer | null): "release" | "done";
  /** Drops the player's inventory on death; only Q1 sources drop a backpack. */
  dropInventory(player: MovementPlayer): void;
  respawn(player: MovementPlayer): void;
  /** Whether the source's own player keeps Q3 angle deltas. */
  keepsAngleDeltas(): boolean;
  telefragCause(): { readonly kind: "q1"; readonly deathType: "telefrag" } | { readonly kind: "q2"; readonly meansOfDeath: 21; readonly damageFlags: 32 };
  cutsceneControl(player: MovementPlayer, angles: Vec3): void;
  checkOutputClaim(channels: readonly string[], movement: string | undefined): void;
  guestGrounded(actor: ActorId): boolean | null;
  guestClientView(actor: ActorId): { readonly viewOffset: Vec3; readonly crouched: boolean } | null;
  /** Whether the source's own intermission or camera hides a component's client outputs. */
  outputsSuspended(actor: ActorId, player: MovementPlayer | null): boolean;
  handoff(actor: ActorId): PrimaryWeaponHandoff;
  /** The powerups the equipment weapon input reads; a null quad defers to the weapon input's own. */
  equipmentPowerups(actor: ActorId): { readonly quadUntil: number | null; readonly hasteUntil: number };
  refineWeaponInput(actor: ActorId, input: Q2WeaponInput): Q2WeaponInput;
  /** Plays an equipment attack animation through the source's own player; true when it did. */
  guestWeaponAnimation(actor: ActorId, priority: "attack" | "reverse", melee: boolean): boolean;
  writeCharacterAnimation(actor: ActorId, animation: import("../../../contracts/movement.ts").ActorAnimationState): void;
  characterPose(actor: ActorId): ReturnType<Of<"q1">["composition"]["characterPose"]> | null;
  /** Source reactions that run before the shared selected-source damage reaction. */
  reactionStart(actor: OwnedActor, decision: DamageDecision): void;
  /** Source reactions that run after the shared death handling. */
  reactionEnd(actor: OwnedActor, decision: DamageDecision): void;
  /** Source bookkeeping after a damage call committed on a live actor. */
  damageCommitted(actor: OwnedActor, decision: DamageDecision): void;
  stopSpeed(): number;
  /** Restores the source's own per-player continuation from a saved image. */
  restoreContinuation(save: SaveImage): void;
  /** Restores the source's foundation checkpoint and server variables. */
  restoreFoundation(save: SaveImage, reader: SaveReader): void;
  /** Re-registers the world gravity a saved Q2 server variable set omitted. */
  restoreGravity(save: SaveImage): void;
  /** The source's saved ammo timer for a weapon; null when the actor has no source client. */
  ammoTimer(actor: ActorId, weapon: number): number | null;
  /** The family a legacy Q3 arsenal save migrates from, or null for sources that cannot read it. */
  legacyQ3Family(): "q1" | "q2" | null;
}

export interface WeaponFacts {
  readonly q3Ps: NonNullable<Q3NativeClient>["ps"] | undefined;
  readonly spectator: boolean;
  readonly hand: "right" | "left" | "center";
  readonly quadUntil: number;
  readonly infiniteAmmo: boolean;
}

export interface SourceIdentity {
  readonly name?: string;
  readonly skin?: string;
  readonly shirt?: number;
  readonly pants?: number;
}

export interface ArsenalUiParts {
  readonly items: PlayerUiItem[];
  readonly ammo: PlayerUi["ammo"];
  readonly weaponStatus: PlayerUi["weaponStatus"];
  readonly arsenalWarning: PlayerUi["arsenalWarning"];
}

const STANCE_CLAIM_ERROR = "Selected original Quake movement has no crouch-request interface; authored collision changes require an explicit source boundary";

function joinInfo(values: Iterable<readonly [string, string], undefined, unknown>): string {
  return [...values].map(([name, value]) => `\\${name}\\${value}`).join("");
}
function sameInfo(previous: ReadonlyMap<string, string>, values: ReadonlyMap<string, string>): boolean {
  return previous.size === values.size && [...values].every(([name, value]) => previous.get(name) === value);
}

class LoadingStrategy implements SourceStrategy {
  readonly kind: SourceRuntime["kind"] = "loading";
  grantQuad(_actor: ActorId): void {
    /* the source has no quad */
  }
  userinfo(_actor: ActorId): string | null {
    return null;
  }
  storeUserinfo(_actor: ActorId, _client: ClientId, _userinfo: string): void {
    throw new Error("Component userinfo requires an initialized source");
  }
  updateUserinfo(_actor: ActorId, _userinfo: string, _previous: string | null): void | Promise<void> {
    /* no source yet: nothing stores userinfo */
  }
  pause(): PauseControl | null {
    return null;
  }

  admitClient(_client: ClientId, _travel: SimulationTravel | undefined, _userinfo: string | undefined): PlayerAdmission | null {
    throw new Error("Map spawn is incomplete");
  }
  prepareBot(_client: ClientId): OwnedActor {
    throw new Error("Bot admission requires a supported source observation binding");
  }
  initialArsenalState(): ArsenalState["state"] {
    throw new Error("Player spawn requires a Q1 or Q2 source");
  }
  attachEntity(_actor: OwnedActor, _player: MovementPlayer): Q2Entity {
    return null;
  }
  configureAdmitted(
    _actor: OwnedActor,
    _client: ClientId,
    _player: MovementPlayer,
    _entity: Q2Entity,
    _userinfo: string | undefined,
    _travel: SimulationTravel | undefined,
  ): void {
    /* only Q1 and Q2 sources configure a shared admission */
  }
  attachForeignCharacter(_player: MovementPlayer): void {
    /* only Q1 sources dress their players in a Q2 character */
  }
  admitCarry(_actor: OwnedActor, _entity: Q2Entity, _carried: CarriedPlayerState | undefined): boolean {
    return false;
  }
  enterWorld(_actor: OwnedActor, _player: MovementPlayer, _fresh: boolean): void {
    /* only Q1 and Q2 sources enter the world through the shared admission */
  }
  captureEntryCarry(_actor: OwnedActor): Q1TravelState | null {
    return null;
  }
  movementBindings(_actor: OwnedActor, _selectedClock: string): PlayerBindings {
    return {};
  }
  q2Gibbed(_actor: ActorId): boolean {
    return false;
  }
  q3Client(_actor: ActorId): Q3NativeClient | null | undefined {
    return null;
  }
  suppliesPunch(): boolean {
    return false;
  }
  skipsTriggerTouch(_actor: ActorId): boolean {
    return false;
  }

  lmctf(): Q2Lmctf | null {
    return null;
  }
  preparesQ1Clients(): boolean {
    return false;
  }
  intermissionFading(): boolean {
    return false;
  }
  fadeIntermission(): void {
    /* only a Q2 rerelease source fades an intermission */
  }
  beginTimedFrame(_elapsed: number): void {
    /* only a Q1 source takes timed frames */
  }
  beginGuestFrame(_frame: FrameContext): void {
    /* only a QuakeC source takes guest frames */
  }
  beginActorTurns(_frame: FrameContext): void {
    /* the source has no per-boundary actor setup */
  }
  intermissionActive(): boolean {
    return false;
  }
  requestIntermissionExit(_actor: ActorId, _buttons: number): void {
    /* only a Q1 source has an intermission to leave */
  }
  preFrame(_input: PreFrameInput): void {
    /* only a Q1 source runs a client pre-frame */
  }
  preThink(_player: MovementPlayer, _command: ActorCommand): boolean {
    return true;
  }
  playerThink(_player: MovementPlayer, _command: ActorCommand): boolean {
    return false;
  }
  tracksGravity(): boolean {
    return false;
  }
  gravityScale(_actor: ActorId): number {
    return 1;
  }
  movementApplied(_actor: ActorId, _moved: Moved): void {
    /* only a Q2 source reacts to movement impacts */
  }
  afterPlayerCommand(_player: MovementPlayer, _paused: boolean): void {
    /* the source has no post-command client think */
  }
  beforeClientActor(_actor: OwnedActor): void {
    /* the source has no per-client actor setup */
  }
  retouch(_actor: OwnedActor): void {
    /* only a Q1 source forces retouches */
  }
  spectating(_actor: ActorId): boolean {
    return false;
  }
  runPlayerActor(_actor: OwnedActor): boolean {
    return false;
  }
  watchesTransitions(): boolean {
    return false;
  }

  selectedPlayer(_actor: ActorId): SelectedPlayerStats {
    return { maxHealth: 100, team: null, quadUntil: 0, hasteUntil: 0 };
  }
  q3GameType(): number | null {
    return null;
  }
  q3ServerInfo(): string {
    return "";
  }
  primaryEquipment(): boolean {
    return false;
  }
  hasEquipmentEffects(): boolean {
    return false;
  }
  weaponDamageFactor(_actor: ActorId, _quad: boolean): number | null {
    return null;
  }
  equipmentDamageFactor(actor: ActorId): number {
    const factor = this.weaponDamageFactor(actor, true);
    if (factor === null) throw new Error("Primary Q3 equipment lost its source");
    return factor;
  }
  equipmentFiringDelay(_actor: ActorId, _milliseconds: number, _persistent: number): number {
    throw new Error("Primary Q3 equipment lost its source");
  }
  weaponDelay(_actor: ActorId, seconds: number): number {
    return seconds;
  }
  equipmentDelay(actor: ActorId, _provider: ProviderId, seconds: number): number {
    return this.weaponDelay(actor, seconds);
  }
  curvesEnabled(): boolean {
    return true;
  }
  playerCurveClip(): boolean {
    return true;
  }
  friendlyFire(): boolean {
    return true;
  }
  knockback(): number {
    return 1000;
  }
  intermissionQueued(): number {
    return 0;
  }
  checkHurtCarrier(_target: ActorId, _attacker: ActorId): void {
    /* only a Q3 source tracks carrier defense */
  }
  checkObeliskAttack(_target: ActorId, _attacker: ActorId): boolean {
    return false;
  }
  quadFactor(): number {
    return 4;
  }
  proximityTimeout(): number {
    return 20000;
  }
  returnPickup(_actor: ActorId): void {
    throw new Error("Borrowed persistent pickup has no original Q3 map owner");
  }
  teleportSpawn(_actor: OwnedActor): SpawnPoint {
    throw new Error("Selected map travel is unavailable while the world is loading");
  }
  dropObjectives(_actor: OwnedActor): void {
    throw new Error("Selected objective drop has no source map owner");
  }
  originalPlayer(): OriginalPlayer | null {
    return null;
  }
  setMaxHealth(_actor: ActorId, _health: number): void {
    /* the source has no max health of its own */
  }
  installPickupAdmission(_admission: SharedPickupAdmission): void {
    /* the source admits its pickups itself */
  }
  supplyFamily(): SupplyFamily {
    return "q3";
  }
  ownsSupply(): boolean {
    return false;
  }
  identitySupply(): boolean {
    return false;
  }
  extraReplacedItems(): readonly ItemId[] {
    return [];
  }
  animatesWeaponFire(): boolean {
    return false;
  }
  noteFired(_actor: ActorId, _item: ItemId | null): void {
    /* only a Q1 source records weapon use */
  }
  weaponNoise(_actor: ActorId, _origin: Vec3, _kind: "weapon" | "impact"): undefined {
    /* only a Q2 source wakes monsters by weapon noise */ return undefined;
  }
  allowsAutoSwitch(_actor: ActorId): boolean {
    return true;
  }
  cvars(): CvarRegistry | null {
    return null;
  }
  q1PowerupExpires(_actor: ActorId, _powerup: Q1Powerup): number {
    return 0;
  }
  damageModifier(): SourceDamageModifier | null {
    return null;
  }
  runsQ3Powerups(): boolean {
    return false;
  }
  equipmentSuppression(): EquipmentSuppression {
    return NO_SUPPRESSION;
  }
  monsterNoise(_actor: ActorId, _origin: Vec3, _secondary: boolean | undefined): undefined {
    /* only a Q2 source has noise-driven monsters */ return undefined;
  }
  ownsEquipmentPlayers(): boolean {
    return false;
  }
  sourceInventory(_actor: ActorId): InventoryStateBinding | null {
    return null;
  }
  playerAvailable(_actor: ActorId): boolean | null {
    return null;
  }
  stepsHandGrenades(): boolean {
    return true;
  }
  teleportBits(_actor: ActorId): number | null {
    return null;
  }

  notarget(_actor: ActorId): boolean | null {
    return null;
  }
  cloakAlpha(_actor: ActorId): number | null {
    return null;
  }
  godMode(_actor: ActorId): boolean {
    return false;
  }
  weaponEvent(_event: Q2WeaponEvent): boolean {
    return false;
  }
  hasEnemy(_target: ActorId): boolean {
    return false;
  }
  teamDamageEnabled(_matchProvider: string): boolean {
    return false;
  }
  matchDamageEffects(): Q2MatchDamageEffects {
    throw new Error("Q2 match damage requires its source runtime");
  }
  requiredMonsterNoise(_actor: ActorId, _origin: Vec3, _secondary: boolean | undefined, message: string): undefined {
    throw new Error(message);
  }
  requireQ2(message: string): void {
    throw new Error(message);
  }
  pushed(_actor: ActorId, _velocity: Vec3): void {
    /* only a Q2 source keeps the previous velocity */
  }
  setEntityGravity(_actor: ActorId, _gravity: number): void {
    /* only a Q2 source keeps entity gravity */
  }
  monstersSearching(_player: ActorId | null): boolean {
    return false;
  }
  q1Game(): Of<"q1">["game"] | null {
    return null;
  }
  selectWeapon(_actor: OwnedActor, _item: ItemId): boolean {
    return false;
  }
  connectedClients(): readonly ClientId[] | null {
    return null;
  }
  playerActors(): readonly ActorId[] | null {
    return null;
  }

  requireLoaded(message: string): void {
    throw new Error(message);
  }
  assertSaveReady(): void {
    /* the source has no extra save conditions */
  }
  projectsMonsters(): boolean {
    return false;
  }
  usesGuestMonsters(): boolean {
    return false;
  }
  reconstructsActor(_actor: ActorId): boolean {
    return false;
  }
  checkpointProviders(_add: (schema: SaveProvider["schema"], bytes: Uint8Array) => void, _providers: SaveProvider[]): void {
    /* the shared providers cover the source */
  }
  checkpointGuests(): SaveImage["guests"] {
    return [];
  }
  checkpointExtras(): Readonly<Record<string, number | string | null>> {
    return {};
  }
  nativeClients(): ReturnType<SourceStrategy["nativeClients"]> {
    return null;
  }
  sourceCvarSnapshots(): readonly { readonly name: string; readonly value: string }[] {
    return [];
  }
  expectedDeclaration(): string | null {
    return null;
  }
  legacyCombat(): Of<"q3-qvm">["combat"] {
    return null;
  }
  requireInventoryProjection(kind: "qvm" | "native"): void {
    throw new Error(kind === "qvm" ? "Saved QVM inventory requires qualified source storage" : "Saved native inventory requires qualified source storage");
  }
  inventoryCoverage(_projected: { readonly native: boolean; readonly qvm: boolean }): InventoryCoverage | null {
    return null;
  }
  travelSource(_context: TravelContext): SimulationTravel["source"] {
    throw new Error("Source campaign travel requires its native source file lifecycle");
  }
  travelers(): ReturnType<SourceStrategy["travelers"]> {
    return null;
  }
  travelPlayerState(_actor: ActorId): CarriedPlayerState {
    throw new Error("Source campaign travel requires its native source file lifecycle");
  }
  guestHealth(_actor: ActorId): number | null {
    return null;
  }
  setGuestHealth(_actor: ActorId, _health: number): void {
    /* only a QVM guest keeps a health stat outside the shared combat view */
  }
  guestTravelPlayers(): readonly { readonly actor: ActorId; readonly client: ClientId; readonly alive: boolean }[] {
    return [];
  }
  canonicalTeam(original: string | null): string | null {
    return original;
  }
  declaresMatch(): boolean {
    return false;
  }
  matchScore(_actor: ActorId): number {
    throw new Error("The selected source declares no match score");
  }
  setMatchScore(_actor: ActorId, _value: number): void {
    throw new Error("The selected source declares no match score");
  }
  setMatchTeam(_actor: ActorId, _requested: string | null): void {
    throw new Error("This original source has no declared team-change command");
  }
  hasGuestUi(): boolean {
    return false;
  }
  guestUi(_actor: ActorId): PlayerUi {
    throw new Error("Actor has no native source UI");
  }
  uiSubject(actor: ActorId): ActorId {
    return actor;
  }
  clientUi(_actor: ActorId): ReturnType<Of<"quakec">["game"]["clientUi"]> | null {
    return null;
  }
  uiPowerups(_actor: ActorId): PlayerUi["powerups"] {
    return [];
  }
  arsenalUi(_actor: ActorId, _arsenal: ArsenalState): ArsenalUiParts {
    return { items: [], ammo: null, weaponStatus: null, arsenalWarning: "none" };
  }
  guestView(_actor: ActorId): PlayerView | null {
    return null;
  }
  chasing(_actor: ActorId): boolean {
    return false;
  }
  cutsceneFov(_fov: number | undefined): number {
    return 90;
  }
  overrideView(_actor: ActorId, _view: PlayerView, _intermission: boolean, _health: number): PlayerView | null {
    return null;
  }
  foreignCharacterDeath(): boolean {
    return false;
  }
  rereleaseViewHeight(): boolean {
    return false;
  }
  presentations(_fraction: number, _backLerp: number): readonly SimulationPresentation[] {
    return [];
  }
  guestWeaponViews(): boolean {
    return false;
  }
  usesQ2Views(): boolean {
    return false;
  }
  q2PlayerEntity(_actor: ActorId): Q2Entity {
    return null;
  }
  q1Player(_actor: ActorId): ReturnType<Of<"q1">["game"]["player"]> | null {
    return null;
  }
  q1Colors(_actor: ActorId): { readonly shirt: number; readonly pants: number } | null | undefined {
    return null;
  }
  weaponVisible(_actor: ActorId): boolean | null {
    return null;
  }
  guestBobCycle(_actor: ActorId): number {
    return 0;
  }
  rendersOwnIntermission(): boolean {
    return false;
  }
  forwardsCommands(): boolean {
    return false;
  }
  preCommand(_actor: ActorId, _name: string, _args: readonly string[]): boolean {
    return false;
  }
  afterCommand(_actor: ActorId, _player: MovementPlayer, _name: string, _args: readonly string[]): void {
    /* the source has no commands of its own after the shared ones */
  }
  setIdentity(_actor: ActorId, _identity: SourceIdentity): void {
    throw new Error("Source identity updates require a native Q1 or Q2 player");
  }
  setFieldOfView(_actor: ActorId, _fieldOfView: number, _mode: "change" | "restore"): boolean {
    return false;
  }
  angleDelta(_actor: ActorId, _client: ClientId): readonly number[] | undefined {
    return undefined;
  }
  commandMovement(_client: ClientId): MovementState | undefined {
    return undefined;
  }
  guestGrantExclusions(): ReadonlySet<ItemId> | null {
    return null;
  }
  grantProfile(_arsenal: SelectedArsenal): PickupSupplyProfile | null {
    return null;
  }
  sourceItem(_requested: string): ReturnType<Of<"q2">["items"]["lookup"]> | null {
    return null;
  }
  grantedWeapon(
    _owner: OwnedActor,
    _arsenal: SelectedArsenal,
    _requested: string,
    _destinations: readonly ItemId[],
    _profile: PickupSupplyProfile | null,
  ): void {
    /* only Q2 weapons carry their own ammo grant */
  }
  baseArsenal(_player: MovementPlayer): ArsenalState {
    throw new Error("Arsenal accessed before source admission");
  }
  q1Client(_actor: ActorId): ReturnType<Of<"q1">["composition"]["clients"]["require"]> | null {
    return null;
  }
  q1Impulse(_actor: ActorId): void {
    /* only a Q1 source consumes impulses */
  }
  weaponsPaused(): boolean {
    return false;
  }
  stepSelectedHoldable(_player: MovementPlayer, _input: WeaponStepInput): boolean {
    return false;
  }
  primaryWeaponStep(_player: MovementPlayer, _input: WeaponStepInput): WeaponStepResult | null {
    return null;
  }
  weaponFacts(_actor: ActorId): WeaponFacts {
    return { q3Ps: undefined, spectator: false, hand: "right", quadUntil: 0, infiniteAmmo: false };
  }
  dropsImpulse(): boolean {
    return false;
  }
  requestsWeaponDirectly(): boolean {
    return false;
  }
  alwaysRequestsWeapon(): boolean {
    return false;
  }
  ownsContacts(_actor: ActorId): boolean {
    return false;
  }
  quakeWorldContacts(): boolean {
    return false;
  }
  jumpVoice(_actor: OwnedActor, _player: MovementPlayer): boolean {
    return false;
  }
  animation(_input: AnimationStepInput): AnimationStepResult | null {
    return null;
  }
  attackArsenal(_actor: ActorId): ArsenalState | null {
    return null;
  }
  playerWeapon(_player: MovementPlayer): void {
    /* only Q1 and Q2 sources run a client weapon frame */
  }
  admitsGuestMonsters(): boolean {
    return false;
  }
  assertSavable(): void {
    /* the source has no original save restrictions */
  }
  captureGuestSave(_nextFrame: () => Promise<void>, _autosave: boolean): Promise<RereleaseGuestSave | undefined> {
    return Promise.resolve(undefined);
  }
  originalSave(_guestSave: RereleaseGuestSave | undefined, _autosave: boolean): SaveProvider | null {
    return null;
  }
  restoreLoading(_save: SaveImage, _nextFrame: () => Promise<void>): Promise<void> {
    throw new Error("Native original loading requires its source provider");
  }
  importLoading(_imported: NativeQ2Import, _nextFrame: () => Promise<void>): Promise<void> {
    throw new Error("An original save folder needs a native Quake II game module");
  }
  importOriginal(_imported: NativeQ2Import): void {
    throw new Error("An original save folder needs a native Quake II game module");
  }
  restoreGuest(_save: SaveImage, _nativeRestored: boolean): void {
    /* only a native Q2 source restores its own original save */
  }
  guestEdition(): "classic" | "rerelease" | null {
    return null;
  }
  monsterProxy(): GuestMonsterProxy | null {
    return null;
  }
  asQ1(): Of<"q1"> | null {
    return null;
  }
  asQ2(): Of<"q2"> | null {
    return null;
  }
  asQuakeC(): Of<"quakec"> | null {
    return null;
  }
  asQ3(): Of<"q3"> | null {
    return null;
  }
  asQ3Qvm(): Of<"q3-qvm"> | null {
    return null;
  }
  asQ2Native(): Of<"q2-native"> | null {
    return null;
  }
  stepRoute(): "native" | "awaited" | "shared" {
    return "shared";
  }
  settles(_game: Q3Game): boolean {
    return false;
  }
  syncGravity(): void {
    /* only a Q2 source owns the world gravity setting */
  }
  afterStep(): void {
    /* the source has no post-step work */
  }
  finishFrame(_run: boolean): void {
    /* the source has no end-of-frame work */
  }
  concludeFrame(): void {
    /* the source has no frame conclusion */
  }
  q1Powerups(_actor: ActorId): ReadonlyMap<Q1Powerup, number> | undefined {
    return undefined;
  }
  foreignPowerups(_actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number } {
    return { quadUntil: 0, doubleUntil: 0, invulnerabilityUntil: 0 };
  }
  q1CharacterFrame(_actor: ActorId, _frame: Parameters<Of<"q1">["composition"]["characterFrame"]>[1]): void {
    /* only a Q1 source records its character frames */
  }
  teamGame(): boolean {
    throw new Error("Team match policy requires an initialized source");
  }
  serverCvars(): ServerCvarRegistry | null {
    return null;
  }
  serverSettingsOwner(owner: ServerSettingsOwner): ServerSettingsOwner {
    return owner;
  }
  clientOf(_actor: ActorId): ClientId | null | undefined {
    return undefined;
  }
  disconnect(_actor: ActorId, _player: MovementPlayer | null): "release" | "done" {
    return "release";
  }
  dropInventory(_player: MovementPlayer): void {
    /* only a Q1 source drops a backpack */
  }
  respawn(_player: MovementPlayer): void {
    throw new Error("Respawn before source entry");
  }
  keepsAngleDeltas(): boolean {
    return false;
  }
  telefragCause(): { readonly kind: "q1"; readonly deathType: "telefrag" } | { readonly kind: "q2"; readonly meansOfDeath: 21; readonly damageFlags: 32 } {
    return { kind: "q2", meansOfDeath: 21, damageFlags: 32 };
  }
  cutsceneControl(_player: MovementPlayer, _angles: Vec3): void {
    /* only a Q1 source clears the held input */
  }
  checkOutputClaim(channels: readonly string[], movement: string | undefined): void {
    if (channels.includes("stance") && movement === "q1-netquake") throw new Error(STANCE_CLAIM_ERROR);
  }
  guestGrounded(_actor: ActorId): boolean | null {
    return null;
  }
  guestClientView(_actor: ActorId): { readonly viewOffset: Vec3; readonly crouched: boolean } | null {
    return null;
  }
  outputsSuspended(_actor: ActorId, player: MovementPlayer | null): boolean {
    return player?.intermission === true || (player?.cutscene !== null && player?.cutscene !== undefined);
  }
  handoff(_actor: ActorId): PrimaryWeaponHandoff {
    throw new Error("Primary source is not ready");
  }
  equipmentPowerups(_actor: ActorId): { readonly quadUntil: number | null; readonly hasteUntil: number } {
    return { quadUntil: null, hasteUntil: 0 };
  }
  refineWeaponInput(_actor: ActorId, input: Q2WeaponInput): Q2WeaponInput {
    return input;
  }
  guestWeaponAnimation(_actor: ActorId, _priority: "attack" | "reverse", _melee: boolean): boolean {
    return false;
  }
  writeCharacterAnimation(_actor: ActorId, _animation: import("../../../contracts/movement.ts").ActorAnimationState): void {
    /* only a Q3 source mirrors the character animation into its entity */
  }
  characterPose(_actor: ActorId): ReturnType<Of<"q1">["composition"]["characterPose"]> | null {
    return null;
  }
  reactionStart(_actor: OwnedActor, _decision: DamageDecision): void {
    /* the source has no early damage reaction */
  }
  reactionEnd(_actor: OwnedActor, _decision: DamageDecision): void {
    /* the source has no late damage reaction */
  }
  damageCommitted(_actor: OwnedActor, _decision: DamageDecision): void {
    /* the source records no committed damage */
  }
  stopSpeed(): number {
    return 100;
  }
  restoreContinuation(_save: SaveImage): void {
    /* the source keeps no per-player continuation outside the shared tables */
  }
  restoreFoundation(_save: SaveImage, _reader: SaveReader): void {
    /* the source has no foundation checkpoint */
  }
  restoreGravity(_save: SaveImage): void {
    /* only a Q2 source stores its gravity in a server variable */
  }
  ammoTimer(_actor: ActorId, _weapon: number): number | null {
    return null;
  }
  legacyQ3Family(): "q1" | "q2" | null {
    return null;
  }
}

class LoadedStrategy extends LoadingStrategy {
  override requireLoaded(_message: string): void {
    /* the source has loaded */
  }
}

class Q1Strategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"q1">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "q1" = "q1";
  override restoreFoundation(save: SaveImage, reader: SaveReader): void {
    if (savedSourceCvars(save) === undefined)
      reader.field("sourceCvars").list(value => {
        this.source.cvars.set(value.field("name").string(), value.field("value").string(), true);
        return undefined;
      });
    this.source.game.restore(decodeQ1FoundationCheckpoint(simulationProviderCheckpoint(save, "q1:foundation").bytes), { scheduleThinks: false });
  }
  override legacyQ3Family(): "q1" {
    return "q1";
  }
  override reactionEnd(actor: OwnedActor, decision: DamageDecision): void {
    this.source.composition.beforeReaction(actor, decision);
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    return this.source.game.primaryWeaponHandoff(this.host.requirePlayer(actor).actor);
  }
  override equipmentPowerups(actor: ActorId): { readonly quadUntil: number | null; readonly hasteUntil: number } {
    return { quadUntil: this.source.game.player(actor)?.powerups.get("quad") ?? 0, hasteUntil: 0 };
  }
  override characterPose(actor: ActorId): ReturnType<Of<"q1">["composition"]["characterPose"]> {
    return this.source.composition.characterPose(actor);
  }
  override grantQuad(actor: ActorId): void {
    this.source.game.player(actor)?.powerups.set("quad", this.source.game.time + 30);
  }
  override q1Powerups(actor: ActorId): ReadonlyMap<Q1Powerup, number> | undefined {
    return this.source.game.player(actor)?.powerups;
  }
  override foreignPowerups(actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number } {
    const powers = this.source.game.player(actor)?.powerups;
    return { quadUntil: powers?.get("quad") ?? 0, doubleUntil: 0, invulnerabilityUntil: powers?.get("invulnerability") ?? 0 };
  }
  override q1CharacterFrame(actor: ActorId, frame: Parameters<Of<"q1">["composition"]["characterFrame"]>[1]): void {
    this.source.composition.characterFrame(actor, frame);
  }
  override concludeFrame(): void {
    if (this.source.game.forceRetouch > 0) this.source.game.forceRetouch--;
  }
  override teamGame(): boolean {
    return this.source.composition.selection.program === "ctf" || this.source.cvars.variableValue("teamplay") !== 0;
  }
  override serverCvars(): ServerCvarRegistry {
    return this.source.cvars;
  }
  override disconnect(actor: ActorId): "done" {
    this.source.composition.disconnect(actor);
    return "done";
  }
  override dropInventory(player: MovementPlayer): void {
    this.source.composition.dropInventory(player.actor);
  }
  override respawn(player: MovementPlayer): void {
    this.source.composition.requestRespawn(player.actor.id, this.host.entryCarry(player.actor));
  }
  override telefragCause(): { readonly kind: "q1"; readonly deathType: "telefrag" } {
    return { kind: "q1", deathType: "telefrag" };
  }
  override cutsceneControl(player: MovementPlayer, angles: Vec3): void {
    this.source.game.playerInput(player.actor, { attack: false, jump: false });
    this.source.game.weaponInput(player.actor, false, angles, this.host.timeSeconds, player.waterLevel);
  }
  override asQ1(): Of<"q1"> {
    return this.source;
  }
  override baseArsenal(player: MovementPlayer): ArsenalState {
    const state = this.source.game.player(player.actor.id);
    if (state === null) throw new Error("Q1 player has no arsenal");
    return {
      provider: this.host.weaponProvider.provider,
      activeWeapon: this.source.game.weaponItem(state.weapon),
      ammo: this.host.inventory.entries(player.actor.id),
      state: {
        kind: "q1",
        frame: state.weaponFrame,
        attackFinishedSeconds: state.attackFinished,
        sourceWeapon: isQ1BaseWeapon(state.weapon) ? q1WeaponBit(state.weapon) : 0,
      },
    };
  }
  override q1Client(actor: ActorId): ReturnType<Of<"q1">["composition"]["clients"]["require"]> {
    return this.source.composition.clients.require(actor);
  }
  override q1Impulse(actor: ActorId): void {
    this.source.composition.impulse(actor);
  }
  override primaryWeaponStep(player: MovementPlayer): null {
    this.host.playerWeapon(player);
    return null;
  }
  override playerWeapon(player: MovementPlayer): void {
    const source = this.source,
      host = this.host,
      pressed = (player.buttons & 1) !== 0;
    source.composition.impulse(player.actor.id);
    if (host.selectedArsenal === null && source.game.weaponInput(player.actor, pressed, player.viewAngles, host.timeSeconds, player.waterLevel))
      source.composition.fired(player.actor.id, host.arsenal(player).activeWeapon);
  }
  override weaponFacts(actor: ActorId): WeaponFacts {
    return { q3Ps: undefined, spectator: false, hand: "right", quadUntil: this.source.game.player(actor)?.powerups.get("quad") ?? 0, infiniteAmmo: false };
  }
  override dropsImpulse(): boolean {
    return true;
  }
  override requestsWeaponDirectly(): boolean {
    return true;
  }
  private cheatsDenied(actor: ActorId): boolean {
    const game = this.source.game;
    if (game.options.deathmatch !== 0 && (game.options.edition === "classic" || this.source.cvars.variableValue("sv_cheats") === 0)) {
      game.message(actor, "Cheats are disabled on this server.\n", false);
      return true;
    }
    return false;
  }
  override preCommand(actor: ActorId, name: string, args: readonly string[]): boolean {
    const source = this.source,
      host = this.host;
    if (name === "say" || name === "say_team") {
      if (args.length === 0) return true;
      const sender = source.composition.clients.require(actor),
        prefix = `\x01${sender.name}: `;
      const text = `${prefix}${args.join(" ").slice(0, Math.max(0, 62 - prefix.length))}\n`;
      for (const recipient of source.composition.clients.records.values()) {
        if (name === "say_team" && source.cvars.variableValue("teamplay") !== 0 && recipient.team !== sender.team) continue;
        source.game.message(recipient.actor.id, text, false);
      }
      return true;
    }
    if (name === "kill") {
      if (source.game.health(actor) <= 0) source.game.message(actor, "Can't suicide -- already dead!\n", false);
      else source.composition.suicide(actor);
      return true;
    }
    if (name === "give") {
      if (source.game.options.deathmatch !== 0 && (source.game.options.edition === "classic" || source.cvars.variableValue("sv_cheats") === 0))
        source.game.message(actor, "Cheats are disabled on this server.\n", false);
      else giveQ1(source.composition, actor, args);
      return true;
    }
    if (name !== "god" && name !== "notarget" && name !== "noclip" && name !== "fly") return false;
    const player = host.requirePlayer(actor),
      client = source.composition.clients.require(actor);
    if (this.cheatsDenied(actor)) return true;
    let enabled: boolean;
    if (name === "god") {
      client.godMode = !client.godMode;
      enabled = client.godMode;
      host.combat.setTraits(player.actor, { invulnerable: enabled || (source.game.player(actor)?.powerups.get("invulnerability") ?? 0) > host.timeSeconds });
    } else if (name === "notarget") {
      enabled = !source.composition.noTarget(actor);
      source.composition.setNoTarget(actor, enabled);
    } else if (name === "fly") {
      enabled = player.setFlight(!player.flight);
    } else {
      const state = player.readState();
      enabled = !(state.kind === "q1-netquake"
        ? state.moveType === 8
        : state.kind === "q1-quakeworld"
          ? state.spectator !== 0
          : state.kind === "q3"
            ? state.movementType === 1
            : state.type === 1);
      host.setPlayerMovement(actor, { kind: "noclip", enabled });
    }
    source.game.message(actor, `${name === "god" ? "godmode" : name} ${enabled ? "ON" : "OFF"}\n`, false);
    return true;
  }
  override afterCommand(actor: ActorId, player: MovementPlayer, name: string, args: readonly string[]): void {
    const game = this.source.game,
      active = game.player(actor)?.weapon,
      owned = Q1_WEAPONS.filter(weapon => this.host.inventory.count(actor, `q1:weapon/${weapon}`) > 0);
    const requested = args.join("").toLowerCase().replaceAll(" ", "");
    const weapon =
      name === "weapnext" || name === "weapprev"
        ? owned[(owned.findIndex(value => value === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length]
        : Q1_WEAPONS.find(value => value === requested || `q1:weapon/${value}` === requested);
    if (weapon !== undefined && this.host.selectedArsenal === null) game.selectWeapon(player.actor, weapon);
  }
  override setIdentity(actor: ActorId, identity: SourceIdentity): void {
    const clients = this.source.composition.clients,
      client = clients.require(actor),
      info = new Map(client.userinfo);
    if (identity.name !== undefined) info.set("name", identity.name);
    clients.update(actor, info);
    if (identity.shirt !== undefined || identity.pants !== undefined) clients.colors(actor, identity.shirt ?? client.shirt, identity.pants ?? client.pants);
  }
  override grantProfile(arsenal: SelectedArsenal): PickupSupplyProfile {
    return arsenal.family === "q3" ? Q1_Q3_SUPPLY_PROFILE : arsenal.family === "q2" ? Q1_Q2_SUPPLY_PROFILE : Q1_HIPNOTIC_SUPPLY_PROFILE;
  }
  override uiPowerups(actor: ActorId): PlayerUi["powerups"] {
    return q1PowerupTimers(this.source.game.player(actor)?.powerups ?? new Map<Q1Powerup, number>(), this.source.game.time);
  }
  override arsenalUi(actor: ActorId, _arsenal: ArsenalState): ArsenalUiParts {
    const game = this.source.game,
      inventory = this.host.inventory,
      items: PlayerUiItem[] = [];
    let ammo: PlayerUi["ammo"] = null,
      weaponStatus: PlayerUi["weaponStatus"] = null;
    for (const [sourceOrdinal, weapon] of [...Q1_WEAPONS, ...game.registeredWeapons.keys()].entries()) {
      const item = game.weaponAmmo(weapon),
        count = item === null ? null : inventory.count(actor, item);
      items.push({
        id: game.weaponItem(weapon),
        label: weapon,
        kind: "weapon",
        sourceOrdinal,
        owned: inventory.count(actor, game.weaponItem(weapon)) > 0,
        hasAmmo:
          count === null || count >= (game.registeredWeapons.get(weapon)?.ammoPerShot ?? (weapon === "supernailgun" || weapon === "supershotgun" ? 2 : 1)),
        count,
        warningCount: 0,
      });
    }
    const state = game.player(actor),
      weapon = state?.weapon;
    if (state !== null) weaponStatus = q1WeaponStatus(game, state, this.host.weaponProvider);
    if (weapon !== undefined) {
      const item = game.weaponAmmo(weapon);
      if (item !== null) ammo = { item, count: inventory.count(actor, item) };
    }
    return { items, ammo, weaponStatus, arsenalWarning: "none" };
  }
  override q1Player(actor: ActorId): ReturnType<Of<"q1">["game"]["player"]> | null {
    return this.source.game.player(actor);
  }
  override q1Colors(actor: ActorId): { readonly shirt: number; readonly pants: number } | null | undefined {
    return this.source.composition.clients.get(actor);
  }
  override canonicalTeam(original: string | null): string | null {
    return this.source.composition.clients.program === "ctf" ? (original === "red" ? "team:red" : original === "blue" ? "team:blue" : original) : original;
  }
  override declaresMatch(): boolean {
    return true;
  }
  override matchScore(actor: ActorId): number {
    return this.source.composition.clients.require(actor).frags;
  }
  override setMatchScore(actor: ActorId, value: number): void {
    if (!Number.isFinite(value)) throw new Error("Quake score must be finite");
    const client = this.source.composition.clients.require(actor);
    client.frags = Math.fround(value);
    this.source.composition.clients.publish(client);
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const clients = this.source.composition.clients,
      entry = clients.require(actor),
      value = clients.program === "ctf" ? (requested === "team:red" ? 5 : requested === "team:blue" ? 14 : NaN) : requested === null ? NaN : Number(requested);
    if (!Number.isInteger(value) || value < 1 || value > 14) throw new Error("Team has no original Quake color command");
    clients.colors(actor, entry.shirt, value - 1);
  }
  override userinfo(actor: ActorId): string | null {
    return joinInfo(this.source.composition.clients.require(actor).userinfo);
  }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const info = this.source.composition.clients.require(actor).userinfo;
    info.clear();
    for (const [name, value] of q2Userinfo(userinfo)) info.set(name, value);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const current = this.source.composition.clients.require(actor).userinfo,
      values = q2Userinfo(userinfo);
    if (sameInfo(current, values)) return;
    this.source.composition.userinfo(actor, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl {
    return { cvars: this.source.cvars, isSpectator: () => false };
  }

  override admitClient(): null {
    return null;
  }
  override prepareBot(client: ClientId): OwnedActor {
    return this.host.requirePlayer(this.host.admitPlayer(client).actor).actor;
  }
  override initialArsenalState(): ArsenalState["state"] {
    return { kind: "q1", frame: 0, attackFinishedSeconds: 0, sourceWeapon: 1 };
  }
  override configureAdmitted(actor: OwnedActor, client: ClientId, _player: MovementPlayer, _entity: Q2Entity, userinfo: string | undefined): void {
    const source = this.source;
    source.game.attachPlayer(actor);
    source.composition.attach(actor, {
      slot: client.slot,
      userinfo:
        userinfo === undefined
          ? new Map([
              ["name", `Player ${client.slot + 1}`],
              ["topcolor", "0"],
              ["bottomcolor", "0"],
            ])
          : q2Userinfo(userinfo),
    });
  }
  override attachForeignCharacter(player: MovementPlayer): void {
    if (player.character === "q2") this.host.attachQ2Character(player);
  }
  override admitCarry(actor: OwnedActor, _entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean {
    if (carried?.kind !== "q1") return false;
    this.source.composition.admitTravel(actor, carried.carry);
    return true;
  }
  override enterWorld(actor: OwnedActor, player: MovementPlayer): void {
    this.host.spawnQ1Player(this.source, actor, player);
  }
  override captureEntryCarry(actor: OwnedActor): Q1TravelState {
    return this.source.composition.captureTravel(actor);
  }
  override movementBindings(actor: OwnedActor): PlayerBindings {
    const source = this.source,
      host = this.host;
    return {
      netQuake: {
        projection: null,
        jumpAuthority: "selected-movement",
        input: command =>
          source.composition.input(actor.id, {
            attack: (command.buttons & 1) !== 0,
            jump: (command.buttons & 2) !== 0,
            use: (command.buttons & 4) !== 0,
            impulse: command.impulse,
          }),
        beforePhysics: frame => {
          const player = host.requirePlayer(actor.id);
          source.composition.playerPreThink(actor.id);
          source.game.playerFrame(actor, seconds(frame.time), player.waterLevel);
          return undefined;
        },
        think: frame => {
          host.runEntityThink(actor.id, frame);
          return undefined;
        },
        afterPhysics: frame => {
          source.game.playerAfterPhysics(actor, seconds(frame.time));
          source.composition.playerPostThink(actor.id);
          host.afterClientThink(actor);
          return undefined;
        },
      },
    };
  }

  override preparesQ1Clients(): boolean {
    return true;
  }
  override beginTimedFrame(elapsed: number): void {
    this.source.game.beginFrame(this.host.timeSeconds, elapsed);
  }
  override intermissionActive(): boolean {
    return this.source.game.intermission !== null;
  }
  override requestIntermissionExit(actor: ActorId, buttons: number): void {
    this.source.composition.requestIntermissionExit(buttons !== 0, { actor, attack: (buttons & 1) !== 0 });
  }
  override preFrame(input: PreFrameInput): void {
    const source = this.source,
      host = this.host;
    host.setWorldGravity(source.cvars.variableValue("sv_gravity"));
    source.composition.preFrame(input.elapsed);
    for (const player of input.players) {
      if (player.profile.kind === "q1-netquake") continue;
      const received = [...input.commands].reverse().find(value => sameActor(value.actor, player.actor.id) && value.sequence > player.lastSequence);
      if (input.deferred && received !== undefined && player.cutscene === null && !player.intermission) {
        input.pending?.set(player, received.sequence);
        continue;
      }
      const command = received?.command;
      const jump =
        command === undefined
          ? (player.buttons & 2) !== 0
          : command.kind === "q1-netquake"
            ? (command.buttons & 2) !== 0
            : command.kind === "q2-rerelease"
              ? (command.buttons & 8) !== 0
              : command.upMove > 0;
      source.composition.input(player.actor.id, {
        attack: player.cutscene === null && ((command?.buttons ?? player.buttons) & 1) !== 0,
        jump: player.cutscene === null && jump,
        use: ((command?.buttons ?? player.buttons) & 4) !== 0,
        impulse: command !== undefined && "impulse" in command ? command.impulse : (received?.arsenal?.impulse ?? 0),
      });
      source.composition.playerPreThink(player.actor.id);
      source.game.playerFrame(player.actor, host.timeSeconds, player.waterLevel);
    }
  }
  override preThink(player: MovementPlayer, command: ActorCommand): boolean {
    const source = this.source,
      effective = command.command;
    const jump =
      effective.kind === "q1-netquake" || effective.kind === "q1-quakeworld"
        ? (effective.buttons & 2) !== 0
        : effective.kind === "q2-rerelease"
          ? (effective.buttons & 8) !== 0
          : effective.upMove > 0;
    source.composition.input(player.actor.id, {
      attack: (effective.buttons & 1) !== 0,
      jump,
      use: (effective.buttons & 4) !== 0,
      impulse: command.arsenal?.impulse ?? ("impulse" in effective ? effective.impulse : 0),
    });
    source.composition.playerPreThink(player.actor.id);
    source.game.playerFrame(player.actor, this.host.timeSeconds, player.waterLevel);
    return this.host.isLive(player.actor.id);
  }
  override afterPlayerCommand(player: MovementPlayer): void {
    if (!this.host.isLive(player.actor.id)) return;
    this.source.game.playerAfterPhysics(player.actor, this.host.timeSeconds);
    this.source.composition.playerPostThink(player.actor.id);
  }
  override beforeClientActor(actor: OwnedActor): void {
    this.retouch(actor);
  }
  override retouch(actor: OwnedActor): void {
    if (this.source.game.forceRetouch > 0) this.host.relink(actor);
  }

  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    const player = this.source.game.player(actor);
    return { maxHealth: player?.maxHealth ?? 100, team: null, quadUntil: Math.trunc((player?.powerups.get("quad") ?? 0) * 1000), hasteUntil: 0 };
  }
  override intermissionQueued(): number {
    return this.source.game.intermission === null ? 0 : 1;
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    const spot = this.source.composition.selectSpawn(actor.id, true);
    if (spot === null) throw new Error("Selected teleporter has no source spawn");
    const body = this.source.game.body(spot);
    return { origin: body.origin, angles: body.angles };
  }
  override dropObjectives(actor: OwnedActor): void {
    const composition = this.source.composition;
    if (composition.ctf !== null) dropQ1CtfFlag(composition.ctf, actor.id);
    composition.packs?.world.dropCarriedFlag(actor.id);
  }
  override setMaxHealth(actor: ActorId, health: number): void {
    const target = this.source.game.player(actor);
    if (target === null) throw new Error("Selected max health has no Q1 player");
    target.maxHealth = health;
  }
  override installPickupAdmission(admission: SharedPickupAdmission): void {
    this.source.game.pickupAdmission = admission;
  }
  override supplyFamily(): SupplyFamily {
    return "q1";
  }
  override noteFired(actor: ActorId, item: ItemId | null): void {
    this.source.composition.fired(actor, item);
  }
  override allowsAutoSwitch(actor: ActorId): boolean {
    return this.source.game.player(actor)?.autoSwitch !== "never";
  }
  override cvars(): CvarRegistry {
    return this.source.cvars;
  }
  override q1PowerupExpires(actor: ActorId, powerup: Q1Powerup): number {
    return this.source.game.player(actor)?.powerups.get(powerup) ?? 0;
  }
  override notarget(actor: ActorId): boolean {
    return this.source.composition.noTarget(actor);
  }
  override godMode(actor: ActorId): boolean {
    return this.source.composition.clients.get(actor)?.godMode ?? false;
  }
  override q1Game(): Of<"q1">["game"] {
    return this.source.game;
  }
  override selectWeapon(actor: OwnedActor, item: ItemId): boolean {
    const game = this.source.game;
    const weapon = [...Q1_WEAPONS, ...game.registeredWeapons.keys()].find(value => game.weaponItem(value) === item);
    return weapon !== undefined && game.selectWeapon(actor, weapon);
  }

  override checkpointProviders(add: (schema: SaveProvider["schema"], bytes: Uint8Array) => void): void {
    add("world:source-cvars", encodeCheckpointValue(this.source.cvars.captureSaveState()));
    add("q1:foundation", encodeQ1FoundationCheckpoint(this.source.game.capture()));
  }
  override sourceCvarSnapshots(): readonly { readonly name: string; readonly value: string }[] {
    return this.source.cvars.snapshots().map(value => ({ name: value.name, value: value.value }));
  }
  override travelSource(): SimulationTravel["source"] {
    return { kind: "q1", flags: this.host.q1Campaign.flags, skill: this.host.q1Campaign.skill };
  }
  override travelPlayerState(actor: ActorId): CarriedPlayerState {
    const composition = this.source.composition;
    return { kind: "q1", carry: this.host.q1Restart ? composition.newTravel() : composition.captureTravel(this.host.requireOwned(actor)) };
  }
}

class QuakeCStrategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"quakec">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "quakec" = "quakec";
  override damageCommitted(actor: OwnedActor, decision: DamageDecision): void {
    const player = this.host.playerStates.get(actor);
    if (player?.character === "q2" && decision.appliedDamage > 0)
      player.animation = quakeCCharacterAnimation(
        player.animation,
        this.host.health(actor.id) <= 0 ? "death" : "pain",
        player.bounds.max.z < player.standingBounds.max.z,
      );
  }
  override checkOutputClaim(channels: readonly string[], movement: string | undefined): void {
    super.checkOutputClaim(channels, movement);
    if (channels.includes("stance") && movement === "q1-quakeworld" && this.source.game.kind === "quakeworld") throw new Error(STANCE_CLAIM_ERROR);
  }
  override outputsSuspended(actor: ActorId, player: MovementPlayer | null): boolean {
    return (
      super.outputsSuspended(actor, player) || this.source.game.localClientIntermission(actor) === true || this.source.game.localClientView(actor) !== null
    );
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    const game = this.source.game,
      host = this.host;
    host.requirePlayer(actor);
    return {
      kind: "immediate",
      provider: host.weaponProvider.provider,
      accepts: item => host.primaryUi(actor).items.some(entry => entry.id === item && entry.kind === "weapon" && entry.owned),
      select: item => game.requestClientWeapon(actor, item),
      holster: () => {
        if (!host.isLive(actor)) throw new Error("QC weapon owner retired");
      },
      isHolstered: () => game.clientWeaponSettled(actor),
      resume: item => item === null || game.requestClientWeapon(actor, item),
    };
  }
  override concludeFrame(): void {
    const host = this.host,
      game = this.source.game;
    game.endFrame();
    for (const player of host.playerStates.values()) {
      const intermission = game.localClientIntermission(player.actor.id);
      if (intermission !== null) player.intermission = intermission;
    }
    if (game.kind === "quakeworld") {
      host.runQuakeWorldCommands();
      game.messages.flush();
    }
    for (const player of host.playerStates.values()) {
      if (player.character === "q1" || player.intermission || player.cutscene !== null) continue;
      const body = host.body(player.actor.id);
      if (body === null) continue;
      const moving = Math.hypot(body.velocity.x, body.velocity.y) !== 0;
      const locomotion =
        player.waterLevel >= 2
          ? "swim"
          : player.ground.kind === "none"
            ? "jump"
            : player.bounds.max.z < player.standingBounds.max.z
              ? "crouch"
              : moving
                ? "run"
                : "idle";
      const yaw = (player.viewAngles.y * Math.PI) / 180;
      const backwards = body.velocity.x * Math.cos(yaw) + body.velocity.y * Math.sin(yaw) < 0;
      player.animation = host.quakeCCharacterStep({
        actor: player.actor,
        frame: host.sourceFrame,
        animation: player.animation,
        locomotion,
        backwards,
        force: false,
      }).animation;
    }
  }
  override teamGame(): boolean {
    return this.source.game.cvars.variableValue("teamplay") !== 0;
  }
  override serverCvars(): ServerCvarRegistry {
    return this.source.game.cvars;
  }
  override disconnect(_actor: ActorId, player: MovementPlayer | null): "done" {
    if (player === null) return "done";
    this.source.game.disconnectClient(player.actor);
    // The reserved QC slot keeps its actor, so the release handler may never clear the adjunct bindings.
    this.host.releasePickupBinding(player.actor.id);
    this.host.selectedArsenal?.remove(player.actor.id);
    this.host.forgetPlayer(player);
    return "done";
  }
  override admitsGuestMonsters(): boolean {
    return true;
  }
  override asQuakeC(): Of<"quakec"> {
    return this.source;
  }
  override baseArsenal(player: MovementPlayer): ArsenalState {
    return this.source.game.clientArsenal(player.actor.id);
  }
  override weaponFacts(actor: ActorId): WeaponFacts {
    return { q3Ps: undefined, spectator: false, hand: "right", quadUntil: this.source.game.clientPowerupExpires(actor, "quad"), infiniteAmmo: false };
  }
  override requestsWeaponDirectly(): boolean {
    return true;
  }
  override ownsContacts(actor: ActorId): boolean {
    return this.source.game.isSpectatorClient(actor);
  }
  override quakeWorldContacts(): boolean {
    return this.source.game.kind === "quakeworld";
  }
  override animation(input: AnimationStepInput): AnimationStepResult {
    return { animation: input.animation.state.kind === "q1" ? this.source.game.clientAnimation(input.actor.id) : input.animation, effects: [] };
  }
  override attackArsenal(actor: ActorId): ArsenalState {
    return this.source.game.clientArsenal(actor);
  }
  override preCommand(actor: ActorId, name: string, args: readonly string[]): boolean {
    if (name === "kill") {
      this.source.game.clientKill(actor);
      return true;
    }
    if (name !== "god" && name !== "notarget" && name !== "noclip" && name !== "fly" && name !== "give") return false;
    this.source.game.hostCheat(actor, name, args);
    if (name === "fly" || name === "noclip") this.host.requirePlayer(actor).setFlight(this.source.game.readMoveType(actor) === 5);
    return true;
  }
  override clientUi(actor: ActorId): ReturnType<Of<"quakec">["game"]["clientUi"]> {
    return this.source.game.clientUi(actor);
  }
  override uiPowerups(actor: ActorId): PlayerUi["powerups"] {
    return this.source.game.clientUi(actor).powerups;
  }
  override overrideView(actor: ActorId, view: PlayerView, intermission: boolean, health: number): PlayerView | null {
    const camera = this.source.game.localClientView(actor);
    if (camera !== null) return camera;
    if (intermission) return null;
    const offset = this.source.game.clientViewOffset(actor);
    return { ...view, origin: add(view.origin, { ...offset, z: 0 }), viewHeight: offset.z, angles: health <= 0 ? { ...view.angles, z: 80 } : view.angles };
  }
  override canonicalTeam(original: string | null): string | null {
    const mapping = this.source.game.prepared.teams?.find(value => value.source === original);
    return mapping === undefined ? original : mapping.team;
  }
  override declaresMatch(): boolean {
    return true;
  }
  override matchScore(actor: ActorId): number {
    return this.source.game.matchScore(actor);
  }
  override setMatchScore(actor: ActorId, value: number): void {
    this.source.game.setMatchScore(actor, value);
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const mapping = this.source.game.prepared.teams?.find(value => value.team === requested);
    this.source.game.setMatchTeam(actor, mapping === undefined ? requested : mapping.source);
    this.host.notifyClientEvent("userinfo", actor);
  }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : joinInfo(this.source.game.clientInfo(client));
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void {
    this.source.game.setClientInfoStorage(client, q2Userinfo(userinfo));
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor);
    if (client === null) return;
    const values = q2Userinfo(userinfo);
    if (sameInfo(this.source.game.clientInfo(client), values)) return;
    this.source.game.setClientInfo(client, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl {
    const game = this.source.game;
    return { cvars: game.cvars, isSpectator: actor => game.kind === "quakeworld" && game.isSpectatorClient(actor) };
  }

  override admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission {
    return this.host.admitQuakeCPlayer(this.source, client, travel, userinfo);
  }
  override movementBindings(actor: OwnedActor, selectedClock: string): PlayerBindings {
    const source = this.source,
      host = this.host,
      game = source.game;
    const mixedQc = selectedClock !== (game.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake");
    if (game.kind === "netquake" && !mixedQc)
      return {
        netQuake: {
          projection: { read: state => game.readClientState(actor.id, state), write: state => game.writeClientState(actor.id, state) },
          jumpAuthority: "source-gamecode",
          input: command => game.clientInput(actor.id, command),
          beforePhysics: () => {
            const before = game.clientArsenal(actor.id);
            game.clientPreThink(actor);
            host.projectQuakeCAttack(actor, before);
            return undefined;
          },
          think: frame => {
            const before = game.clientArsenal(actor.id);
            game.runThink(actor, frame);
            host.projectQuakeCAttack(actor, before);
            return undefined;
          },
          afterPhysics: () => {
            const before = game.clientArsenal(actor.id);
            game.clientPostThink(actor);
            host.projectQuakeCAttack(actor, before);
            return undefined;
          },
        },
      };
    if (mixedQc)
      return {
        sourceClient: {
          projectState: (state: MovementState) => (game.isSpectatorClient(actor.id) ? quakeCFreeMovement(state) : state),
          beforeMovement: (input: ActorCommand, frame: FrameContext, sourceCommand?: QwUserCommand) => {
            const before = game.clientArsenal(actor.id),
              result =
                sourceCommand === undefined
                  ? game.mixedClientPreThink(actor, input.command, frame)
                  : game.mixedQuakeWorldPreThink(actor, sourceCommand, input.command, frame);
            host.projectQuakeCAttack(actor, before);
            return result;
          },
          afterMovement: (player: MovementPlayer, _frame: FrameContext, sourceCommand?: QwUserCommand): undefined => {
            const before = game.clientArsenal(actor.id);
            game.mixedClientPostThink(
              actor,
              player.ground,
              player.waterLevel,
              player.waterType,
              player.profile.kind,
              sourceCommand === undefined ? "immediate" : "deferred",
            );
            host.projectQuakeCAttack(actor, before);
            player.arsenal = host.arsenal(player);
            return undefined;
          },
        },
      };
    if (game.kind !== "quakeworld") return {};
    return {
      quakeWorld: {
        read: (state: QwMovementState) => game.readQuakeWorldState(actor.id, state),
        write: (state: QwMovementState) => game.writeQuakeWorldState(actor.id, state),
        beforePhysics: (command: QwUserCommand, frame: FrameContext) => {
          const before = game.clientArsenal(actor.id);
          game.quakeWorldPreThink(actor, command, frame);
          host.projectQuakeCAttack(actor, before);
          return undefined;
        },
        water: (level: number, type: number) => game.quakeWorldWater(actor.id, level, type),
        profile: (profile: QwMovementProfile) => game.quakeWorldProfile(actor.id, profile),
      },
    };
  }
  override suppliesPunch(): boolean {
    return this.source.game.kind === "netquake";
  }
  override skipsTriggerTouch(actor: ActorId): boolean {
    const game = this.source.game;
    return game.kind === "quakeworld" && game.isSpectatorClient(actor);
  }

  override preparesQ1Clients(): boolean {
    return this.source.game.kind === "netquake";
  }
  override beginGuestFrame(frame: FrameContext): void {
    this.source.game.beginFrame(frame);
  }
  override beforeClientActor(actor: OwnedActor): void {
    this.source.game.beforeActor(actor);
  }
  override afterPlayerCommand(player: MovementPlayer): void {
    const game = this.source.game,
      host = this.host;
    if (game.kind !== "quakeworld" || player.profile.kind !== "q1-quakeworld" || !host.isLive(player.actor.id)) return;
    const before = game.clientArsenal(player.actor.id);
    game.clientPostThink(player.actor);
    host.projectQuakeCAttack(player.actor, before);
    if (!game.isSpectatorClient(player.actor.id)) host.runQuakeWorldNewMissile();
    player.arsenal = host.arsenal(player);
    if (player.character === "q1") player.animation = game.clientAnimation(player.actor.id);
    player.state = player.readState();
    host.syncQuakeCClientView(player);
  }

  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    const equipment = this.source.game.clientEquipment(actor);
    return { maxHealth: equipment?.maxHealth ?? 100, team: null, quadUntil: Math.trunc((equipment?.quadUntil ?? 0) * 1000), hasteUntil: 0 };
  }
  override hasEquipmentEffects(): boolean {
    return true;
  }
  override weaponDamageFactor(): number {
    return 1;
  }
  override equipmentFiringDelay(actor: ActorId, milliseconds: number, persistent: number): number {
    return q3WeaponDelay(milliseconds, persistent, this.host.hasteFlag(actor));
  }
  override quadFactor(): number {
    return 1;
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    return this.source.game.clientSpawnPoint(actor.id);
  }
  override dropObjectives(actor: OwnedActor): void {
    this.source.game.dropClientObjectives(actor.id);
  }
  override setMaxHealth(actor: ActorId, health: number): void {
    this.source.game.setClientMaxHealth(actor, health);
  }
  override supplyFamily(): SupplyFamily {
    return "q1";
  }
  override ownsSupply(): boolean {
    return true;
  }
  override cvars(): CvarRegistry {
    return this.source.game.cvars;
  }
  override q1PowerupExpires(actor: ActorId, powerup: Q1Powerup): number {
    return powerup === "quad" || powerup === "invulnerability" || powerup === "invisibility" || powerup === "suit"
      ? this.source.game.clientPowerupExpires(actor, powerup)
      : this.host.selectedQ1Powerup(actor, powerup);
  }
  override damageModifier(): SourceDamageModifier {
    const game = this.source.game;
    return { owner: this.host.entitiesProvider, transform: (attacker, amount) => game.damageAmount(attacker, amount) };
  }
  override equipmentSuppression(): EquipmentSuppression {
    return { quad: true, quadFire: false, haste: false };
  }
  override notarget(actor: ActorId): boolean | null {
    return this.source.game.notarget(actor);
  }
  override connectedClients(): readonly ClientId[] | null {
    return this.source.game.kind === "netquake" ? this.source.game.connectedClientIdentities() : null;
  }

  override usesGuestMonsters(): boolean {
    return true;
  }
  override checkpointGuests(): SaveImage["guests"] {
    return [this.source.game.checkpoint()];
  }
  override travelSource(): SimulationTravel["source"] {
    return this.source.game.captureTravel();
  }
  // Same-dialect QC destinations travel through program parms in the source record; the shared snapshot serves every other destination.
  override travelPlayerState(actor: ActorId): CarriedPlayerState {
    return this.host.sharedTravelState(actor) ?? { kind: "quakec" };
  }
}

class Q2Strategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"q2">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "q2" = "q2";
  override restoreFoundation(save: SaveImage): void {
    restoreQ2Product(this.source.product, save.providers);
    const savedCvars = savedSourceCvars(save),
      registry = this.host.q2ServerRegistry;
    if (registry !== null && savedCvars !== undefined) restoreQ2ServerCvars(registry, savedCvars);
  }
  override restoreGravity(save: SaveImage): void {
    const registry = this.host.q2ServerRegistry;
    if (registry === null) return;
    const saved = savedSourceCvars(save);
    // The merge in restoreQ2ServerCvars preserves registered defaults, so
    // presence must be tested against the saved state itself.
    if (saved === undefined || !savedQ2ServerCvarsHave(registry, saved, "sv_gravity")) {
      if (registry.find("sv_gravity") === undefined) registry.register("sv_gravity", String(this.host.worldGravity), 0);
      else registry.set("sv_gravity", String(this.host.worldGravity), true);
    }
  }
  override legacyQ3Family(): "q2" {
    return "q2";
  }
  override reactionEnd(actor: OwnedActor, decision: DamageDecision): void {
    const host = this.host,
      source = this.source,
      entity = source.game.entity(actor.id),
      player = host.playerStates.get(actor);
    if (entity !== null) {
      entity.lastAttack = decision.request.attack;
      if (player !== undefined) source.product.beforeReaction(actor.id, decision.request.attack);
    }
    if (decision.reaction === "death" && player !== undefined && player.character !== "q2" && entity !== null)
      source.players.recordDeath(entity, source.game, {
        attack: decision.request.attack,
        self: actor,
        attacker: decision.request.attack.attacker,
        inflictor: decision.request.attack.inflictor,
        damage: decision.appliedDamage,
        kick: decision.request.knockback,
        point: decision.request.point,
      });
  }
  override damageCommitted(actor: OwnedActor, decision: DamageDecision): void {
    const host = this.host,
      source = this.source,
      entity = source.game.entity(actor.id);
    if (entity !== null && host.playerStates.get(actor)?.character === "q2") source.players.recordDamage(entity, source.game, decision);
    const feedback = decision.feedback;
    if (feedback?.kind === "q2" && feedback.powerArmor > 0 && !host.playerStates.has(actor)) source.monsters.notePowerArmor(actor.id, source.game.host.now());
    const character = host.characters.get(actor),
      state = source.players.states.get(actor.id);
    if (character !== undefined && state !== undefined && state.dead)
      state.respawnTime = Math.max(state.respawnTime, character.respawnEligibleAfterMilliseconds / 1000);
  }
  override stopSpeed(): number {
    return this.source.product.movementStopSpeed ?? 100;
  }
  override outputsSuspended(actor: ActorId, player: MovementPlayer | null): boolean {
    return super.outputsSuspended(actor, player) || this.source.players.states.get(actor)?.chaseTarget != null;
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    const source = this.source,
      host = this.host,
      player = host.requirePlayer(actor),
      entity = source.game.entity(actor);
    if (entity === null) throw new Error("Q2 primary has no source player");
    const definition = (item: ItemId) => source.weapons.registeredDefinitions().find(weapon => weapon.item === item);
    return {
      kind: "immediate",
      provider: host.weaponProvider.provider,
      accepts: item => definition(item) !== undefined && host.inventory.count(actor, item) > 0,
      select: item => {
        const weapon = definition(item);
        if (weapon === undefined) return false;
        const result = source.weapons.requestWeapon(entity, source.game, weapon.name);
        return result === "selected" || result === "current";
      },
      holster: () => source.weapons.requestHolster(entity),
      isHolstered: () => source.weapons.isHolstered(entity),
      resume: item => {
        source.weapons.resumePrimary(entity, source.game, host.q2WeaponInput(player), item === null ? null : (definition(item)?.name ?? null));
        return item === null || host.arsenal(player).activeWeapon === item;
      },
    };
  }
  override refineWeaponInput(actor: ActorId, input: Q2WeaponInput): Q2WeaponInput {
    return this.source.product.weaponInput(actor, input);
  }
  override syncGravity(): void {
    const registry = this.host.q2ServerRegistry;
    if (registry === null) return;
    const gravity = registry.variableValue("sv_gravity");
    if (gravity !== this.host.worldGravity) this.host.setWorldGravity(gravity);
  }
  override afterStep(): void {
    emitQ2ShadowLights(this.source.game);
  }
  override finishFrame(run: boolean): void {
    const source = this.source,
      host = this.host;
    for (const player of host.playerStates.values()) {
      const entity = source.game.entity(player.actor.id);
      if (entity !== null) {
        if (!player.intermission && player.character === "q2" && host.health(player.actor.id) <= 0) {
          entity.viewHeight = source.players.states.get(player.actor.id)?.gibbed === true ? 8 : -2;
          player.viewHeight = entity.viewHeight;
        }
        source.players.endFrame(entity, source.game);
        const state = source.players.states.get(player.actor.id);
        if (player.character === "q2" && state !== undefined)
          player.animation = {
            provider: host.recipe.character.definition.provider,
            state: {
              kind: "q2",
              frame: entity.frame,
              endFrame: state.animationEnd,
              priority: state.animationPriority,
              duck: state.animationDuck,
              run: state.animationRun,
            },
          };
      }
    }
    if (!run) return;
    const match = source.product.match.source;
    if (
      match instanceof Q2Lmctf &&
      match.match.phase === "countdown" &&
      !match.match.paused &&
      match.match.remaining <= 0 &&
      source.game.host.now() >= match.match.nextThink
    )
      host.q2ServerRegistry?.applyLatched("timelimit");
    source.product.afterPlayerFrames();
    source.monsters.endFrame(source.game);
    host.withQ2Rules(() => {
      source.product.checkRules();
    });
  }
  override teamGame(): boolean {
    const source = this.source,
      selected = source.product.match;
    if (selected.source instanceof Q2Lmctf) return (selected.source.rules.ctfFlags & 128) === 0;
    const match = selected.selection.kind;
    return (
      match === "ctf" ||
      match === "lmctf" ||
      match === "deathball" ||
      (source.game.options.mode === "deathmatch" && (source.game.options.deathmatchFlags & (64 | 128)) !== 0)
    );
  }
  override serverCvars(): ServerCvarRegistry | null {
    return this.host.q2ServerRegistry;
  }
  override disconnect(actor: ActorId): "release" | "done" {
    const entity = this.source.game.entity(actor);
    if (entity === null) return "release";
    this.source.players.disconnect(entity, this.source.game);
    this.source.game.remove(entity);
    return this.host.isLive(actor) ? "release" : "done";
  }
  override respawn(player: MovementPlayer): void {
    const entity = this.source.game.entity(player.actor.id);
    if (entity !== null) this.source.players.respawn(entity, this.source.game);
  }
  override asQ2(): Of<"q2"> {
    return this.source;
  }
  override baseArsenal(player: MovementPlayer): ArsenalState {
    return projectQ2Arsenal(player.actor.id, this.host.weaponProvider.provider, this.source.weapons, this.host.inventory);
  }
  override weaponsPaused(): boolean {
    const match = this.source.product.match.source;
    return match instanceof Q2Lmctf && match.match.paused;
  }
  override playerWeapon(player: MovementPlayer): void {
    const entity = this.source.game.entity(player.actor.id);
    if (entity !== null) {
      this.source.product.match.beforePlayer(entity, this.source.game);
      this.source.players.beginFrame(entity, this.source.game);
    }
  }
  override weaponFacts(actor: ActorId): WeaponFacts {
    const state = this.source.players.states.get(actor);
    return {
      q3Ps: undefined,
      spectator: state?.spectator === true,
      hand: state?.hand ?? "right",
      quadUntil: this.source.items.playerPowerups(actor).quadUntil,
      infiniteAmmo: (this.source.game.options.deathmatchFlags & 8192) !== 0,
    };
  }
  override requestsWeaponDirectly(): boolean {
    return true;
  }
  override alwaysRequestsWeapon(): boolean {
    return true;
  }
  override preCommand(actor: ActorId, name: string): boolean {
    if (name !== "fly") return false;
    const source = this.source,
      player = this.host.requirePlayer(actor),
      entity = source.game.entity(actor);
    if (entity === null) throw new Error("Q2 player entity missing");
    if (source.players.intermission.kind !== "playing") return true;
    const context = source.players.context(entity, source.game);
    if (!q2CheatsAllowed(context)) return true;
    const enabled = player.setFlight(!player.flight);
    if (enabled) context.state.noclip = false;
    context.hooks.emit({ kind: "print", target: actor, level: "high", text: `fly ${enabled ? "ON" : "OFF"}\n` });
    return true;
  }
  override afterCommand(actor: ActorId, player: MovementPlayer, name: string, args: readonly string[]): void {
    const source = this.source,
      host = this.host,
      entity = source.game.entity(actor);
    if (entity === null) throw new Error("Q2 player entity missing");
    if (name !== "weapnext" && name !== "weapprev" && name !== "use") {
      source.players.clientCommand(entity, source.game, name, args);
      return;
    }
    const match = source.product.match.source;
    if (match instanceof Q2Lmctf && !match.canMove(actor)) return;
    const active = source.weapons.states.get(actor)?.weapon,
      owned = source.weapons.registeredDefinitions().filter(weapon => host.inventory.count(actor, weapon.item) > 0);
    const requested = args.join("").toLowerCase().replaceAll(" ", "");
    const weapon =
      name === "weapnext" || name === "weapprev"
        ? owned[(owned.findIndex(value => value.name === active) + (name === "weapnext" ? 1 : owned.length - 1)) % owned.length]
        : source.weapons.registeredDefinitions().find(value => value.name === requested || value.item === requested);
    if (weapon !== undefined) {
      if (host.selectedArsenal === null) source.weapons.requestWeapon(entity, source.game, weapon.name);
    } else if (name === "use") {
      const item = host.inventory.entries(actor).find(value => value.item === requested || value.item === `q2:item_${requested}`);
      if (item !== undefined) source.items.use(player.actor, item.item, source.game);
    }
  }
  override setIdentity(actor: ActorId, identity: SourceIdentity): void {
    const source = this.source,
      entity = source.game.entity(actor),
      state = source.players.states.get(actor);
    if (entity === null || state === undefined) throw new Error("Q2 source identity requires an admitted player");
    const info = new Map(q2Userinfo(state.userinfo));
    if (identity.name !== undefined) info.set("name", identity.name);
    if (identity.skin !== undefined) info.set("skin", identity.skin);
    source.players.userinfoChanged(entity, source.game, joinInfo(info));
  }
  override setFieldOfView(actor: ActorId, fieldOfView: number, mode: "change" | "restore"): boolean {
    const source = this.source,
      host = this.host,
      player = host.requirePlayer(actor);
    const updateView = (previous: number, current: number): void => {
      if (player.intermission || source.players.intermission.kind === "intermission") return;
      const view = host.q2Views.get(actor);
      if (view?.fov === previous) host.q2Views.set(actor, { ...view, fov: current });
    };
    const entity = source.game.entity(actor),
      state = source.players.states.get(actor);
    if (entity === null || state === undefined) return true;
    const info = new Map(q2Userinfo(state.userinfo)),
      previous = state.fov;
    // Saved userinfo holds the ordinary request; source cameras can change only the effective FOV.
    const requested = Number.parseInt(info.get("fov") ?? "0", 10) || 0;
    const fixed =
      source.game.options.edition !== "rerelease" && source.game.options.mode === "deathmatch" && (source.game.options.deathmatchFlags & 32768) !== 0;
    const ordinary = fixed
      ? 90
      : source.game.options.edition === "rerelease"
        ? Math.max(1, Math.min(160, requested))
        : requested < 1
          ? 90
          : Math.min(160, requested);
    const preserve =
      !fixed && (player.cutscene !== null || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0 || (mode === "restore" && previous !== ordinary));
    info.set("fov", String(fieldOfView));
    source.players.userinfoChanged(entity, source.game, joinInfo(info));
    if (preserve) state.fov = previous;
    updateView(previous, state.fov);
    return true;
  }
  override grantProfile(arsenal: SelectedArsenal): PickupSupplyProfile {
    return arsenal.family === "q3"
      ? Q2_Q3_SUPPLY_PROFILE
      : arsenal.family === "q1" && arsenal.game.registeredWeapons.has("hipnotic:laser")
        ? Q2_HIPNOTIC_SUPPLY_PROFILE
        : Q2_Q1_SUPPLY_PROFILE;
  }
  override sourceItem(requested: string): ReturnType<Of<"q2">["items"]["lookup"]> {
    return this.source.items.lookup(requested);
  }
  override grantedWeapon(
    owner: OwnedActor,
    arsenal: SelectedArsenal,
    requested: string,
    destinations: readonly ItemId[],
    profile: PickupSupplyProfile | null,
  ): void {
    const definition = this.source.weapons.registeredDefinitions().find(item => item.item === requested);
    const sourceAmmo = definition?.ammo == null ? null : this.source.items.lookup(definition.ammo);
    const mappedAmmo = sourceAmmo === null ? undefined : profile?.ammo.find(item => item.source === sourceAmmo.id);
    if (mappedAmmo !== undefined && sourceAmmo !== null)
      for (const item of mappedAmmo.destinations)
        this.host.inventory.give(owner, item, (this.source.game.options.deathmatchFlags & 8192) !== 0 ? 1000 : sourceAmmo.quantity);
    arsenal.pickupWeapons(owner, destinations, "better");
  }
  override uiSubject(actor: ActorId): ActorId {
    const observer = this.source.players.states.get(actor),
      target = observer?.spectator === true ? observer.chaseTarget : null;
    const watched = target === null || target === undefined ? undefined : this.source.players.states.get(target);
    return target != null && watched?.connected === true && !watched.spectator ? target : actor;
  }
  override uiPowerups(actor: ActorId): PlayerUi["powerups"] {
    return q2PowerupTimers(this.source.items.playerPowerups(actor), this.source.product.armory?.items.powerups(actor), this.source.game.host.now());
  }
  override arsenalUi(actor: ActorId, arsenal: ArsenalState): ArsenalUiParts {
    const source = this.source,
      inventory = this.host.inventory,
      items: PlayerUiItem[] = [];
    let ammo: PlayerUi["ammo"] = null;
    for (const [sourceOrdinal, definition] of source.items.list().entries()) {
      if (!definition.usable) continue;
      const weapon = source.weapons.registeredDefinitions().find(value => value.item === definition.id),
        quantity = inventory.count(actor, definition.id);
      const count = weapon === undefined ? quantity : weapon.ammo === null ? null : inventory.count(actor, weapon.ammo);
      items.push({
        id: definition.id,
        label: definition.name,
        kind: weapon === undefined ? "powerup" : "weapon",
        sourceOrdinal,
        owned: quantity > 0,
        hasAmmo: count === null || count >= (weapon?.quantity ?? 1),
        count,
        warningCount: weapon?.warning ?? 0,
      });
    }
    const weapon = source.weapons.registeredDefinitions().find(value => value.item === arsenal.activeWeapon);
    const weaponStatus = q2WeaponStatus(weapon ?? null, item => inventory.count(actor, item), this.host.weaponProvider);
    if (weapon !== undefined && weapon.ammo !== null) ammo = { item: weapon.ammo, count: inventory.count(actor, weapon.ammo) };
    return { items, ammo, weaponStatus, arsenalWarning: "none" };
  }
  override chasing(actor: ActorId): boolean {
    const observer = this.source.players.states.get(actor);
    return observer?.spectator === true && observer.chaseTarget !== null;
  }
  override cutsceneFov(fov: number | undefined): number {
    return fov ?? 90;
  }
  override rereleaseViewHeight(): boolean {
    return this.source.product.rerelease !== null;
  }
  override usesQ2Views(): boolean {
    return true;
  }
  override q2PlayerEntity(actor: ActorId): Q2Entity {
    return this.source.game.entity(actor);
  }
  override canonicalTeam(original: string | null): string | null {
    const match = this.source.product.match.source;
    return match instanceof Q2Ctf || match instanceof Q2Lmctf ? (original === "RED" ? "team:red" : original === "BLUE" ? "team:blue" : original) : original;
  }
  override declaresMatch(): boolean {
    return true;
  }
  override matchScore(actor: ActorId): number {
    const state = this.source.players.states.get(actor);
    if (state === undefined) throw new Error("Original Q2 score has no player");
    const match = this.source.product.match.source;
    return match instanceof Q2Lmctf ? (match.states.get(actor)?.statistics.get("score") ?? 0) : state.score;
  }
  override setMatchScore(actor: ActorId, value: number): void {
    const state = this.source.players.states.get(actor);
    if (state === undefined) throw new Error("Original Q2 score has no player");
    state.score = sourceScore(value);
    const match = this.source.product.match.source;
    if (match instanceof Q2Lmctf) match.states.get(actor)?.statistics.set("score", state.score);
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const match = this.source.product.match.source;
    if (!(match instanceof Q2Ctf || match instanceof Q2Lmctf)) throw new Error("This original source has no declared team-change command");
    const entity = this.source.game.entity(actor),
      argument = requested === "team:red" ? "red" : requested === "team:blue" ? "blue" : null;
    if (entity === null || argument === null) throw new Error("Team has no original Q2 team command");
    match.command(entity, this.source.game, "team", [argument]);
  }
  override userinfo(actor: ActorId): string | null {
    return this.source.players.states.get(actor)?.userinfo ?? null;
  }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const player = this.source.players.states.get(actor);
    if (player === undefined) throw new Error("Component userinfo has no Q2 player");
    player.userinfo = userinfo;
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const source = this.source,
      state = source.players.states.get(actor),
      entity = source.game.entity(actor);
    if (state === undefined || entity === null || state.userinfo === userinfo) return;
    const previousFov = state.fov,
      previousRequest = q2Userinfo(state.userinfo).get("fov");
    source.players.userinfoChanged(entity, source.game, userinfo);
    if (this.host.hasCutscene(actor) || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0 || previousRequest === q2Userinfo(userinfo).get("fov"))
      state.fov = previousFov;
    const view = this.host.q2Views.get(actor);
    if (view?.fov === previousFov) this.host.q2Views.set(actor, { ...view, fov: state.fov });
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(): null {
    return null;
  }
  override prepareBot(client: ClientId): OwnedActor {
    const admitted = this.host.admitPlayer(client),
      entity = this.source.game.entity(admitted.actor);
    if (entity === null) throw new Error("Bot admission lost its shared source entity");
    entity.serverFlags |= 16;
    return entity.actor;
  }
  override initialArsenalState(): ArsenalState["state"] {
    return { kind: "q2", gunFrame: 0, state: 0, pendingWeapon: null, machinegunShots: 0, grenadeTime: { kind: "seconds", value: 0 }, grenadeBlewUp: false };
  }
  override attachEntity(actor: OwnedActor, player: MovementPlayer): Q2Entity {
    const entity = this.source.game.attachPlayer(actor);
    if (entity !== null) {
      entity.viewHeight = player.viewHeight;
      entity.solid = "box";
    }
    return entity;
  }
  override configureAdmitted(
    actor: OwnedActor,
    client: ClientId,
    player: MovementPlayer,
    entity: Q2Entity,
    userinfo: string | undefined,
    travel: SimulationTravel | undefined,
  ): void {
    const source = this.source;
    source.items.configurePlayer(actor, source.game, true);
    if (entity === null) return;
    const model = player.character === "q2" ? (player.characterAppearance.provider.split("/").at(-1) ?? "male") : "male";
    source.product.admit(
      actor,
      {
        slot: client.slot,
        userinfo: userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\${model}/grunt\\fov\\90`,
        initializeInventory: false,
        useQ2Weapons: this.host.usesQ2Weapons(),
      },
      travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot ? { ...travel.source.landmark, player: actor.id } : null,
    );
  }
  override admitCarry(_actor: OwnedActor, entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean {
    if (carried?.kind !== "q2") return false;
    if (entity !== null) this.source.players.restoreCarry(entity, this.source.game, carried.carry);
    return true;
  }
  override enterWorld(actor: OwnedActor, _player: MovementPlayer, fresh: boolean): void {
    if (fresh || this.host.hasPendingStartItems(actor.id)) this.host.giveQ2StartItems(actor.id);
    this.host.resumeQ2Presentation(actor.id);
  }
  override q2Gibbed(actor: ActorId): boolean {
    return this.source.players.states.get(actor)?.gibbed === true;
  }

  override lmctf(): Q2Lmctf | null {
    const match = this.source.product.match.source;
    return match instanceof Q2Lmctf ? match : null;
  }
  override intermissionFading(): boolean {
    return this.source.product.rerelease?.players.intermissionFadeUntil != null;
  }
  override fadeIntermission(): void {
    this.source.product.rerelease?.players.fadeFrame(this.source.game);
  }
  override beginActorTurns(): void {
    this.source.monsters.beginFrame(this.source.game);
  }
  override tracksGravity(): boolean {
    return true;
  }
  override gravityScale(actor: ActorId): number {
    const source = this.source;
    const matchGravity = source.product.match.gravityScale(actor);
    const flightGravity = source.product.items.playerPowerups(actor).flightUntil > this.host.timeSeconds ? 0.1 : 1;
    return matchGravity * flightGravity;
  }
  override movementApplied(actor: ActorId, moved: Moved): void {
    if (moved.kind === "q2-rerelease" && moved.status === "active")
      this.source.product.movementImpact(actor, moved.impactDelta, (moved.state.flags & 128) !== 0);
  }
  override afterPlayerCommand(player: MovementPlayer, paused: boolean): void {
    const source = this.source;
    if (paused || !this.host.isLive(player.actor.id)) return;
    const entity = source.game.entity(player.actor.id);
    if (entity === null) return;
    if (!player.intermission)
      entity.viewHeight =
        player.character === "q2" && this.host.health(player.actor.id) <= 0
          ? source.players.states.get(player.actor.id)?.gibbed === true
            ? 8
            : -2
          : player.viewHeight;
    source.players.afterClientThink(entity, source.game);
  }
  override spectating(actor: ActorId): boolean {
    return this.source.players.states.get(actor)?.spectator === true;
  }
  override watchesTransitions(): boolean {
    return true;
  }

  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    return {
      maxHealth: this.source.game.entity(actor)?.maxHealth ?? 100,
      team: null,
      quadUntil: Math.trunc(this.source.items.playerPowerups(actor).quadUntil * 1000),
      hasteUntil: 0,
    };
  }
  override friendlyFire(): boolean {
    return (this.source.game.options.deathmatchFlags & 256) === 0;
  }
  override intermissionQueued(): number {
    return this.source.players.intermission.kind !== "playing" ? 1 : 0;
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    const entity = this.source.game.entity(actor.id);
    if (entity === null) throw new Error("Selected teleporter has no Q2 player");
    return this.source.players.selectTeleportSpawn(entity, this.source.game);
  }
  override dropObjectives(actor: OwnedActor): void {
    const match = this.source.product.match.source,
      entity = this.source.game.entity(actor.id);
    if (entity !== null && (match instanceof Q2Ctf || match instanceof Q2Lmctf)) match.flags.drop(entity, this.source.game);
  }
  override setMaxHealth(actor: ActorId, health: number): void {
    const target = this.source.game.entity(actor);
    if (target === null) throw new Error("Selected max health has no Q2 player");
    target.maxHealth = health;
  }
  override installPickupAdmission(admission: SharedPickupAdmission): void {
    this.source.items.setPickupAdmission(admission);
  }
  override supplyFamily(): SupplyFamily {
    return "q2";
  }
  override extraReplacedItems(): readonly ItemId[] {
    return ["q2:weapon_blaster"];
  }
  override weaponNoise(actor: ActorId, origin: Vec3, kind: "weapon" | "impact"): undefined {
    return this.source.weapons.playerNoiseForActor(actor, this.source.game, origin, kind);
  }
  override q1PowerupExpires(actor: ActorId, powerup: Q1Powerup): number {
    const powers = this.source.items.playerPowerups(actor);
    return powerup === "quad" ? powers.quadUntil : powerup === "invulnerability" ? powers.invulnerabilityUntil : powerup === "suit" ? powers.enviroUntil : 0;
  }
  override monsterNoise(actor: ActorId, origin: Vec3, secondary: boolean | undefined): undefined {
    return this.source.monsters.reportNoise(actor, origin, secondary);
  }
  override requiredMonsterNoise(actor: ActorId, origin: Vec3, secondary: boolean | undefined): undefined {
    return this.source.monsters.reportNoise(actor, origin, secondary);
  }
  override requireQ2(): void {
    /* the source is Q2 */
  }
  override cloakAlpha(actor: ActorId): number | null {
    return this.source.players instanceof Q2RereleasePlayers ? this.source.players.cloakAlpha(actor, this.source.game.host.now()) : null;
  }
  override weaponEvent(event: Q2WeaponEvent): boolean {
    this.source.players.weaponEvent(event);
    return true;
  }
  override hasEnemy(target: ActorId): boolean {
    return (this.source.game.entity(target)?.enemy ?? null) !== null;
  }
  override teamDamageEnabled(matchProvider: string): boolean {
    return matchProvider === "q2:ctf" || matchProvider === "q2:lmctf" || (this.source.game.options.deathmatchFlags & (64 | 128)) !== 0;
  }
  override matchDamageEffects(): Q2MatchDamageEffects {
    return this.source.product.match.sourceEffects(this.source.game);
  }
  override pushed(actor: ActorId, velocity: Vec3): void {
    const state = this.source.players.states.get(actor);
    if (state !== undefined) state.oldVelocity = velocity;
  }
  override setEntityGravity(actor: ActorId, gravity: number): void {
    const entity = this.source.game.entity(actor);
    if (entity !== null) entity.gravity = gravity;
  }
  override monstersSearching(player: ActorId | null): boolean {
    const source = this.source,
      host = this.host;
    for (const entity of source.game.entities.values()) {
      if ((entity.serverFlags & 4) === 0 || host.health(entity.actor.id) <= 0) continue;
      const state = source.monsters.context(entity.actor.id)?.state;
      if (player === null ? entity.enemy !== null && !source.game.host.isPlayer(entity.enemy) : entity.enemy === null || !sameActor(entity.enemy, player))
        continue;
      if (state?.lostSight && host.timeSeconds > state.trailTime + 5) continue;
      return true;
    }
    return false;
  }

  override checkpointProviders(add: (schema: SaveProvider["schema"], bytes: Uint8Array) => void, providers: SaveProvider[]): void {
    const registry = this.host.q2ServerRegistry;
    if (registry !== null) add("world:source-cvars", encodeCheckpointValue(registry.captureSaveState()));
    providers.push(...captureQ2Product(this.source.product));
  }
  override travelSource(context: TravelContext): SimulationTravel["source"] {
    const source = this.source;
    return {
      kind: "q2",
      serverFlags: context.serverFlags ?? source.game.counters.serverFlags,
      ...(source.product.match.source instanceof Q2Lmctf ? { lmctf: source.product.match.source.captureTravel() } : {}),
      ...(source.product.rerelease === null ? {} : { rerelease: structuredClone(source.product.rerelease.entities.campaign) }),
      landmark: context.landmark,
    };
  }
  override travelPlayerState(actor: ActorId): CarriedPlayerState {
    const source = this.source;
    this.host.requireOwned(actor);
    const entity = source.game.entity(actor);
    if (entity === null) throw new Error("Q2 travel player entity is missing");
    return {
      kind: "q2",
      carry:
        source.product.match.source instanceof Q2Lmctf
          ? { ...source.players.saveCarry(entity, source.game), score: 0 }
          : source.players.saveCarry(entity, source.game),
    };
  }
}

class Q2NativeStrategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"q2-native">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "q2-native" = "q2-native";
  override checkOutputClaim(channels: readonly string[], movement: string | undefined): void {
    super.checkOutputClaim(channels, movement);
    if (
      channels.includes("body-shape") &&
      this.source.edition === "rerelease" &&
      this.source.game.source.host.module.requireWorldProfile().movement.body === undefined
    )
      throw new Error("Selected original rerelease movement has no admitted body trace interface");
  }
  override guestGrounded(actor: ActorId): boolean {
    return this.source.game.services.playerGrounded(this.host.nativeQ2Client(actor).slot + 1, actor);
  }
  override guestClientView(actor: ActorId): { readonly viewOffset: Vec3; readonly crouched: boolean } {
    return this.source.game.services.playerView(this.host.nativeQ2Client(actor).slot + 1, actor);
  }
  override outputsSuspended(actor: ActorId): boolean {
    return this.source.game.playerState(this.host.nativeQ2Client(actor).slot + 1).movement.type === (this.source.edition === "classic" ? 4 : 6);
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    const host = this.host;
    let holstered = false;
    const accepts = (item: ItemId) => {
      const ui = this.guestUi(actor);
      return ui.activeWeapon === item || ui.items.some(entry => entry.id === item && entry.kind === "weapon" && entry.owned);
    };
    const select = (item: ItemId): boolean => {
      if (!accepts(item)) return false;
      const ui = this.guestUi(actor);
      if (ui.activeWeapon === item) return true;
      const itemName = ui.items.find(entry => entry.id === item)?.label;
      if (itemName === undefined) return false;
      this.source.game.command(host.nativeQ2Client(actor).slot + 1, ["use", itemName], itemName);
      return true;
    };
    return {
      kind: "immediate",
      provider: host.weaponProvider.provider,
      accepts,
      select,
      holster: () => {
        holstered = true;
      },
      isHolstered: () => holstered,
      resume: item => {
        holstered = false;
        return item === null || select(item);
      },
    };
  }
  override equipmentPowerups(): { readonly quadUntil: number; readonly hasteUntil: number } {
    return { quadUntil: 0, hasteUntil: 0 };
  }
  override guestWeaponAnimation(actor: ActorId, priority: "attack" | "reverse"): boolean {
    if (priority === "attack") this.host.nativeWeapons().attackAnimation(actor);
    return true;
  }
  override stepRoute(): "native" {
    return "native";
  }
  override teamGame(): boolean {
    const registry = this.host.q2ServerRegistry;
    return registry !== null && (registry.variableValue("ctf") !== 0 || (registry.variableValue("dmflags") & (64 | 128)) !== 0);
  }
  override serverCvars(): ServerCvarRegistry | null {
    return this.host.q2ServerRegistry;
  }
  override clientOf(actor: ActorId): ClientId | null {
    return [...this.source.clients].find(([, owner]) => owner.id.equals(actor))?.[0] ?? null;
  }
  override disconnect(actor: ActorId): "done" {
    const client = this.host.nativeQ2Client(actor);
    this.host.releaseGrapple(actor);
    this.host.removeHandGrenade(actor);
    this.source.game.disconnect(client.slot + 1);
    this.source.clients.delete(client);
    return "done";
  }
  override admitsGuestMonsters(): boolean {
    return true;
  }
  override guestEdition(): "classic" | "rerelease" {
    return this.source.edition;
  }
  override assertSavable(): void {
    const registry = this.host.q2ServerRegistry;
    if (this.source.edition === "rerelease" && (registry === null || registry.variableValue("deathmatch") !== 0))
      throw new Error("Native Quake II original saves require a non-deathmatch source game");
  }
  override captureGuestSave(nextFrame: () => Promise<void>, autosave: boolean): Promise<RereleaseGuestSave | undefined> {
    return this.source.edition === "rerelease" ? this.source.game.writeSaveLoading(autosave, nextFrame) : Promise.resolve(undefined);
  }
  override originalSave(rereleaseSave: RereleaseGuestSave | undefined, autosave: boolean): SaveProvider | null {
    const source = this.source,
      host = this.host,
      cvars = host.q2ServerRegistry,
      map = host.recipe.map.geometry.requestedPath;
    if (cvars === null || cvars.variableValue("deathmatch") !== 0) throw new Error("Native Quake II original saves require a non-deathmatch source game");
    const portals = [...host.areaPortals].map(([portal, open]) => ({ portal, open }));
    // The original has written no file for a level it was only just entered; it has one for a level the unit returned to.
    const unwritten = autosave && !source.visited.has(map);
    if (source.edition === "rerelease") {
      const written = rereleaseSave ?? source.game.writeSave(autosave);
      return encodeQ2RereleaseNativeSave({
        module: source.game.module,
        map,
        api: { kind: "q2-rerelease-game", version: 2023 },
        abi: "windows-x86-64",
        autosave,
        server: {
          configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
          portals,
          cvars: encodeCheckpointValue(cvars.captureSaveState()),
        },
        game: written.game,
        level: unwritten ? null : written.level,
        visitedLevels: [...source.visited.values()].filter(level => level.map !== map),
      });
    }
    const captured = source.files.capture(
      { module: source.game.module, map },
      () => ({
        configstrings: [...source.game.configstrings()].map(([index, value]) => ({ index, value })),
        portals,
        cvars: encodeCheckpointValue(cvars.captureSaveState()),
      }),
      (game, level, written) => source.game.writeOriginal(game, level, written),
      autosave,
    );
    return encodeQ2ClassicOriginalSave({
      ...captured,
      level: unwritten ? null : captured.level,
      visitedLevels: [...source.visited.values()].filter(level => level.map !== map),
    });
  }
  override async restoreLoading(save: SaveImage, nextFrame: () => Promise<void>): Promise<void> {
    const source = this.source,
      host = this.host;
    if (source.edition === "rerelease") {
      const plan = host.nativeRestorePrelude(source, nativeQ2RereleaseSave(save, source.game.module), original => {
        for (const level of original.visitedLevels) source.visited.set(level.map, level);
      });
      await source.game.initLoading(nextFrame);
      plan.afterInit();
      await source.game.readSaveLoading(plan.original, plan.request, plan.applyServerState, nextFrame);
      return;
    }
    const plan = host.nativeRestorePrelude(source, nativeQ2OriginalSave(save, source.game.module), original => {
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
    });
    await source.game.initLoading(nextFrame);
    plan.afterInit();
    await source.files.restoreLoading(plan.original, async (game, level) => {
      await source.game.restoreOriginalLoading(game, level, plan.request, plan.applyServerState, nextFrame);
    });
  }
  /** SV_Loadgame on the files of a save folder: game state first, then the map, then its level file. */
  override async importLoading(imported: NativeQ2Import, nextFrame: () => Promise<void>): Promise<void> {
    const source = this.source,
      host = this.host;
    if (source.edition === "rerelease") {
      if (!isRereleaseImport(imported)) throw new Error("A classic save folder needs a classic game module");
      const plan = host.nativeRestorePrelude(source, imported, original => {
        for (const level of original.visitedLevels) source.visited.set(level.map, level);
      });
      await source.game.initLoading(nextFrame);
      plan.afterInit();
      await source.game.readSaveLoading({ game: imported.game, level: imported.level }, plan.request, plan.applyServerState, nextFrame);
      return;
    }
    if (isRereleaseImport(imported)) throw new Error("A rerelease save archive needs a rerelease game module");
    const plan = host.nativeRestorePrelude(source, imported, original => {
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
    });
    await source.game.initLoading(nextFrame);
    plan.afterInit();
    await source.files.restoreLoading(imported, async (game, level) => {
      await source.game.restoreOriginalLoading(game, level, plan.request, plan.applyServerState, nextFrame);
    });
  }
  override importOriginal(imported: NativeQ2Import): void {
    const source = this.source,
      host = this.host;
    if (source.edition === "rerelease") {
      if (!isRereleaseImport(imported)) throw new Error("A classic save folder needs a classic game module");
      const plan = host.nativeRestorePrelude(source, imported, original => {
        for (const level of original.visitedLevels) source.visited.set(level.map, level);
      });
      source.game.init();
      plan.afterInit();
      source.game.readSave({ game: imported.game, level: imported.level }, plan.request, plan.applyServerState);
      return;
    }
    if (isRereleaseImport(imported)) throw new Error("A rerelease save archive needs a rerelease game module");
    const plan = host.nativeRestorePrelude(source, imported, original => {
      for (const level of original.visitedLevels) source.visited.set(level.map, level);
    });
    source.game.init();
    plan.afterInit();
    source.files.restore(imported, (game, level) => {
      source.game.restoreOriginal(game, level, plan.request, plan.applyServerState);
    });
  }
  override restoreGuest(save: SaveImage, nativeRestored: boolean): void {
    const source = this.source,
      host = this.host;
    if (!nativeRestored && source.edition === "rerelease") {
      const plan = host.nativeRestorePrelude(source, nativeQ2RereleaseSave(save, source.game.module), original => {
        for (const level of original.visitedLevels) source.visited.set(level.map, level);
      });
      source.game.init();
      plan.afterInit();
      source.game.readSave(plan.original, plan.request, plan.applyServerState);
    }
    if (!nativeRestored && source.edition === "classic") {
      const plan = host.nativeRestorePrelude(source, nativeQ2OriginalSave(save, source.game.module), original => {
        for (const level of original.visitedLevels) source.visited.set(level.map, level);
      });
      source.game.init();
      plan.afterInit();
      source.files.restore(plan.original, (game, level) => {
        source.game.restoreOriginal(game, level, plan.request, plan.applyServerState);
      });
    }
    for (const saved of nativeQ2SavedClients(save)) {
      const client = host.options.restoredClients?.find(client => client.slot === saved.clientSlot);
      if (client === undefined) throw new Error("Native saved client has no retained session identity");
      const connected = source.game.connect(client.slot + 1, saved.userinfo);
      if (!connected.allowed) throw new Error("Native source rejected restored client");
      host.registerQ2NativeClient(client, "restore");
      if (saved.phase === "active") source.game.begin(client.slot + 1);
    }
    host.actors.rebindRestoredSource(source.game.module.id);
    if (source.game.services.hasSourceInventory)
      for (const actor of source.clients.values()) {
        const saved = save.inventories.find(entry => host.actors.resolveSaved(entry.actor) === actor);
        host.bindEquipmentInventory(actor, saved?.entries ?? []);
      }
  }
  override monsterProxy(): GuestMonsterProxy | null {
    const source = this.source;
    if (source.edition !== "classic") return null;
    const game = source.game;
    return {
      allocate: () => game.allocateMonsterProxy(),
      bind: (slot, actor) => {
        game.bindMonsterProxy(slot, actor);
      },
    };
  }
  override asQ2Native(): Of<"q2-native"> {
    return this.source;
  }
  override primaryWeaponStep(_player: MovementPlayer, input: WeaponStepInput): WeaponStepResult {
    return { arsenal: input.arsenal, animation: input.animation, effects: [] };
  }
  override forwardsCommands(): boolean {
    return true;
  }
  override preCommand(actor: ActorId, name: string, args: readonly string[]): boolean {
    const game = this.source.game,
      slot = this.host.nativeQ2Client(actor).slot + 1;
    q2GameCallback(() => game.command(slot, [name, ...args], args.join(" ")));
    return true;
  }
  override setFieldOfView(actor: ActorId, fieldOfView: number, mode: "change" | "restore"): boolean {
    const slot = this.host.nativeQ2Client(actor).slot + 1,
      game = this.source.game;
    const client = game.clients.find(client => client.slot === slot);
    if (client === undefined) throw new Error("Native player has no source userinfo");
    if (mode === "restore") return true;
    const info = new Map(q2Userinfo(client.userinfo));
    info.set("fov", String(fieldOfView));
    game.userinfo(slot, joinInfo(info));
    return true;
  }
  override commandMovement(client: ClientId): MovementState | undefined {
    return this.source.game.playerState(client.slot + 1).movement;
  }
  override grantProfile(): PickupSupplyProfile | null {
    return this.host.selectedOriginalSupply;
  }
  override hasGuestUi(): boolean {
    return true;
  }
  override guestUi(actor: ActorId): PlayerUi {
    const source = this.source,
      host = this.host,
      reference = host.recipe.map.entities,
      slot = host.nativeQ2Client(actor).slot + 1;
    const original =
      source.edition === "classic"
        ? classicGuestPlayerUi(source.game.playerState(slot), source.game.configstrings(), reference)
        : rereleaseGuestPlayerUi(source.game.playerState(slot), source.game.configstrings(), reference);
    const nativeInventory = host.nativeInventory(actor),
      arsenal = host.selectedArsenal;
    if (arsenal?.has(actor) !== true) return nativeInventory == null ? original : { ...original, nativeInventory, inventory: host.inventory.entries(actor) };
    return {
      ...original,
      selectedArsenal: true,
      ...(nativeInventory == null ? {} : { nativeInventory }),
      inventory: host.inventory.entries(actor),
      ...arsenal.ui(actor, host.weaponProvider),
    };
  }
  override guestView(actor: ActorId): PlayerView {
    const source = this.source,
      slot = this.host.nativeQ2Client(actor).slot + 1;
    return source.edition === "classic" ? classicGuestPlayerView(source.game.playerState(slot)) : rereleaseGuestPlayerView(source.game.playerState(slot));
  }
  override guestWeaponViews(): boolean {
    return true;
  }
  override rendersOwnIntermission(): boolean {
    return false;
  }
  override weaponVisible(actor: ActorId): boolean {
    return this.source.game.playerState(this.host.nativeQ2Client(actor).slot + 1).gunIndex !== 0 && this.host.nativeWeapons().available(actor);
  }
  override presentations(fraction: number, backLerp: number): readonly SimulationPresentation[] {
    const source = this.source,
      host = this.host,
      content = host.recipe.map.entities.content,
      result: SimulationPresentation[] = [];
    for (const state of source.game.entityStates()) {
      const info = source.game.entityInfo(state.number);
      if (state.number === 0 || info.actor === null || !info.active || (info.serverFlags & 1) !== 0) continue;
      // A foreign selected character replaces the guest player model;
      // the selected-character presentation draws this actor.
      if (host.foreignNativeCharacter() && host.hasNativeCharacterHost(info.actor)) continue;
      const appearance = source.game.modelAppearance(state.number);
      const delta = { x: state.origin.x - state.oldOrigin.x, y: state.origin.y - state.oldOrigin.y, z: state.origin.z - state.oldOrigin.z };
      const continuous = fraction < 1 && delta.x * delta.x + delta.y * delta.y + delta.z * delta.z <= 512 * 512;
      const model = {
        actor: info.actor,
        content,
        family: "q2",
        frame: state.frame,
        oldFrame: "oldFrame" in state ? state.oldFrame : state.frame,
        ...(continuous ? { backLerp } : {}),
        skin: appearance.skin,
        skinPath: appearance.skinPath,
        effects: Number(state.effects),
        renderFlags: state.renderEffects,
        origin: continuous
          ? { x: state.oldOrigin.x + delta.x * fraction, y: state.oldOrigin.y + delta.y * fraction, z: state.oldOrigin.z + delta.z * fraction }
          : state.origin,
        previousOrigin: state.oldOrigin,
        angles: state.angles,
        scale: "scale" in state && state.scale !== 0 ? state.scale : 1,
        alpha: "alpha" in state ? (state.alpha !== 0 ? state.alpha : (state.renderEffects & 32) !== 0 ? 0.3 : 1) : 1,
        visible: true,
        viewWeapon: false,
      } satisfies Omit<SimulationPresentation, "path">;
      // A body-queue corpse copies the guest player model (modelindex 255). With a Quake 1 character selected it is
      // drawn as that character's last death frame; Quake III characters keep the guest corpse model.
      if (appearance.path.startsWith("players/") && host.foreignNativeCharacter() && providerFamily(host.recipe.character.definition.provider) === "q1") {
        result.push({
          ...model,
          content: host.recipe.character.definition.content,
          family: "q1",
          path: "progs/player.mdl",
          frame: Q1_CORPSE_FRAME,
          oldFrame: Q1_CORPSE_FRAME,
          skin: 0,
          skinPath: null,
          effects: 0,
          renderFlags: 0,
          playerColors: { top: host.options.playerColors?.top ?? 0, bottom: host.options.playerColors?.bottom ?? 0 },
        });
        continue;
      }
      if (appearance.path !== "") result.push({ ...model, path: appearance.path });
      for (const [index, path] of appearance.attachedModels.entries())
        if (path !== "")
          result.push({
            ...model,
            path,
            skin: 0,
            skinPath: null,
            ...(index === 0 && host.selectedArsenal?.has(info.actor) === true ? { nativeHeldWeapon: true } : {}),
          });
    }
    for (const [client, actor] of source.clients) {
      if (host.selectedArsenal?.has(actor.id) === true) continue;
      const state = source.game.playerState(client.slot + 1),
        view = host.playerView(actor.id),
        path = source.game.configstrings().get((source.edition === "classic" ? 32 : 62) + state.gunIndex);
      if (state.gunIndex === 0 || path === undefined || path === "") continue;
      result.push({
        actor: actor.id,
        content,
        family: "q2",
        path,
        frame: state.gunFrame,
        oldFrame: state.gunFrame,
        skin: "gunSkin" in state ? state.gunSkin : 0,
        effects: 0,
        renderFlags: 0,
        origin: add(add(view.origin, { x: 0, y: 0, z: view.viewHeight }), state.gunOffset),
        viewOrigin: add(view.origin, { x: 0, y: 0, z: view.viewHeight }),
        viewAngles: view.angles,
        angles: add(view.angles, state.gunAngles),
        scale: 1,
        visible: true,
        viewWeapon: true,
      });
    }
    return result;
  }
  override canonicalTeam(original: string | null): string | null {
    const mapping = this.host.nativeMatch()?.teams.find(value => value.source === original);
    return mapping === undefined ? original : mapping.team;
  }
  override declaresMatch(): boolean {
    return this.host.nativeMatch() !== undefined;
  }
  override matchScore(actor: ActorId): number {
    return this.host.nativePlayer().score(actor);
  }
  override setMatchScore(actor: ActorId, value: number): void {
    this.host.nativePlayer().setScore(actor, value);
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const profile = this.host.nativeMatch();
    if (profile === undefined) throw new Error("Original native team commands have no declaration");
    const args = sourceTeamCommand(profile, requested),
      name = args[0];
    if (name === undefined) throw new Error("Original team command is empty");
    const client = this.host.playerClient(actor);
    if (client === null) throw new Error("Original team command has no client");
    q2GameCallback(() => this.source.game.command(client.slot + 1, args, args.slice(1).join(" ")));
  }
  override userinfo(actor: ActorId): string | null {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    return this.source.game.clients.find(client => client.slot === slot)?.userinfo ?? null;
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void {
    this.source.game.setUserinfoStorage(client.slot + 1, userinfo);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    if (this.source.game.clients.find(client => client.slot === slot)?.userinfo !== userinfo) this.source.game.userinfo(slot, userinfo);
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission {
    if (travel !== undefined) throw new Error("Native Quake II travel requires its source file lifecycle");
    return this.host.admitQ2NativePlayer(client, userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\male/grunt\\fov\\90`);
  }

  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    return { maxHealth: this.host.nativePlayer().maxHealth(actor), team: null, quadUntil: 0, hasteUntil: 0 };
  }
  override hasEquipmentEffects(): boolean {
    return true;
  }
  override weaponDamageFactor(actor: ActorId): number {
    return this.host.nativeWeapons().damageFactor(actor);
  }
  override equipmentFiringDelay(actor: ActorId, milliseconds: number, persistent: number): number {
    return q3WeaponDelay(this.host.nativeWeaponDelay(actor, milliseconds / 1000) * 1000, persistent, false);
  }
  override weaponDelay(actor: ActorId, seconds: number): number {
    return this.host.nativeWeaponDelay(actor, seconds);
  }
  override equipmentDelay(actor: ActorId, provider: ProviderId, seconds: number): number {
    return this.host.nativeEquipmentDelay(actor, provider, seconds);
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    return this.host.nativePlayer().spawnPoint(actor.id);
  }
  override dropObjectives(actor: OwnedActor): void {
    this.host.nativePlayer().dropObjectives(actor.id);
  }
  override originalPlayer(): OriginalPlayer {
    const player = this.host.nativePlayer();
    return {
      setMaxHealth: (actor, health) => player.setMaxHealth(actor, health),
      teleport: (actor, origin, velocity, angles, hold) => player.teleport(actor, origin, velocity, angles, hold),
    };
  }
  override supplyFamily(): SupplyFamily {
    return "q2";
  }
  override animatesWeaponFire(): boolean {
    return true;
  }
  override equipmentSuppression(): EquipmentSuppression {
    return NATIVE_SUPPRESSION;
  }
  override ownsEquipmentPlayers(): boolean {
    return true;
  }
  override sourceInventory(actor: ActorId): InventoryStateBinding | null {
    return this.source.game.services.sourceInventory(this.host.nativeQ2Client(actor).slot + 1);
  }
  override playerAvailable(actor: ActorId): boolean {
    return this.host.playerClient(actor) !== null && this.host.nativeAvailable(actor);
  }
  override stepsHandGrenades(): boolean {
    return false;
  }
  override notarget(actor: ActorId): boolean | null {
    const source = this.host.sourceOf(actor);
    return source?.provider === this.source.game.module.id ? this.source.game.services.notarget(source.slot) : null;
  }
  override connectedClients(): readonly ClientId[] {
    return [...this.source.clients.keys()];
  }
  override playerActors(): readonly ActorId[] {
    return [...this.source.clients.values()].map(actor => actor.id);
  }
  override teleportBits(actor: ActorId): number {
    return this.source.game.playerState(this.host.nativeQ2Client(actor).slot + 1).movement.flags & 32;
  }

  override projectsMonsters(): boolean {
    return true;
  }
  override usesGuestMonsters(): boolean {
    return true;
  }
  override reconstructsActor(actor: ActorId): boolean {
    return this.host.sourceOf(actor)?.provider === this.source.game.module.id;
  }
  override checkpointExtras(): Readonly<Record<string, number | string | null>> {
    return this.source.game.services.hasSourceInventory ? { nativeInventoryProjection: 1 } : {};
  }
  override nativeClients() {
    return this.source.game.clients.map(client => ({ clientSlot: client.slot - 1, phase: client.phase, userinfo: client.userinfo }));
  }
  override requireInventoryProjection(): void {
    if (!this.source.game.services.hasSourceInventory) throw new Error("Saved native inventory requires qualified source storage");
  }
  override inventoryCoverage(projected: { readonly native: boolean; readonly qvm: boolean }): InventoryCoverage | null {
    return this.source.game.services.hasSourceInventory ? { actors: [...this.source.clients.values()], legacy: !projected.native } : null;
  }
}

class Q3Strategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"q3">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "q3" = "q3";
  override ammoTimer(actor: ActorId, weapon: number): number | null {
    const client = this.source.game.records.nativeByActor(actor)?.client;
    return client == null ? null : client.ammoTimes.get(weapon);
  }
  override restoreContinuation(save: SaveImage): void {
    const host = this.host,
      game = this.source.game,
      native = nativeQ3RuntimeReader(save);
    for (const entry of native.arsenals) {
      const actor = host.actors.resolveSaved(entry.actor);
      if (actor === null || !host.playerStates.has(actor) || host.q3Arsenals.has(actor) || entry.state.product !== game.options.product)
        throw new Error("Saved Q3 arsenal has no unique matching player and product");
      host.q3Arsenals.set(actor, entry.state);
    }
    const movement = new Set<OwnedActor>();
    for (const entry of native.movement) {
      const actor = host.actors.resolveSaved(entry.actor),
        player = actor === null ? undefined : host.playerStates.get(actor);
      if (actor === null || player === undefined || movement.has(actor)) throw new Error("Saved Q3 movement has no unique matching player");
      movement.add(actor);
      player.sourceMovement = entry.state;
    }
    if (movement.size !== host.playerStates.size || host.q3Arsenals.size !== host.playerStates.size)
      throw new Error("Saved Q3 player continuation is incomplete");
    for (const entry of native.lastAttacks) {
      const actor = host.actors.resolveSaved(entry.actor);
      if (actor === null || host.lastAttack.has(actor)) throw new Error("Saved Q3 attack has no unique matching actor");
      host.lastAttack.set(
        actor,
        restoreQ2Attack(entry.attack, saved => host.actors.referenceSaved(saved)),
      );
    }
    if (providerFamily(host.recipe.combat.provider) === "q3") host.setSourceCombatDisposer(host.combatAuthority.register(game.bridge.policy()));
    game.finishNativeRestore();
  }
  override reactionStart(actor: OwnedActor, decision: DamageDecision): void {
    this.source.game.beforeReaction(actor, decision);
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    const host = this.host,
      player = host.requirePlayer(actor);
    const runtime = () => {
      const state = host.q3Arsenals.get(player.actor);
      if (state === undefined) throw new Error("Missing Q3 primary continuation");
      return state;
    };
    const select = (item: ItemId): boolean => {
      const weapon = Q3_WEAPON_ITEMS.find(value => value.item === item);
      if (weapon === undefined || host.inventory.count(actor, item) <= 0 || (runtime().product === "baseq3" && weapon.weapon > 10)) return false;
      host.q3Arsenals.set(player.actor, q3RequestWeapon(runtime(), weapon.weapon));
      return true;
    };
    return {
      kind: "immediate",
      provider: host.weaponProvider.provider,
      accepts: item =>
        Q3_WEAPON_ITEMS.some(weapon => weapon.item === item && (runtime().product === "missionpack" || weapon.weapon <= 10)) &&
        host.inventory.count(actor, item) > 0,
      select,
      holster: () => {
        host.q3Arsenals.set(player.actor, q3RequestWeaponHolster(runtime()));
      },
      isHolstered: () => runtime().externalSlot === "holstered",
      resume: item => {
        host.q3Arsenals.set(player.actor, q3RequestWeaponResume(runtime()));
        return item === null || select(item);
      },
    };
  }
  override equipmentPowerups(actor: ActorId): { readonly quadUntil: number; readonly hasteUntil: number } {
    const ps = this.source.game.records.byActor(actor)?.client?.ps;
    return { quadUntil: (ps?.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000, hasteUntil: ps?.powerups.get(Powerup.PW_HASTE) ?? 0 };
  }
  override writeCharacterAnimation(actor: ActorId, animation: import("../../../contracts/movement.ts").ActorAnimationState): void {
    const entity = this.source.game.records.byActor(actor);
    if (entity !== null) writeQ3CharacterAnimation(entity, animation);
  }
  override settles(game: Q3Game): boolean {
    return this.source.game === game;
  }
  override finishFrame(): void {
    const host = this.host,
      game = this.source.game;
    for (const player of host.playerStates.values()) {
      const entity = game.records.nativeByActor(player.actor.id);
      if (entity?.client !== null && entity?.client !== undefined && !player.intermission && player.character === "q3" && host.health(player.actor.id) <= 0)
        entity.client.ps.viewheight = -16;
    }
    game.endFrame();
  }
  override teamGame(): boolean {
    return this.source.game.gameType >= 3;
  }
  override serverCvars(): ServerCvarRegistry {
    return this.source.game.host.cvars;
  }
  override serverSettingsOwner(owner: ServerSettingsOwner): ServerSettingsOwner {
    const settings = this.source.game.settings;
    return {
      write: owner.write,
      read: target => ({ ...owner.read(target), effective: target.kind === "value" ? settings.snapshot(target.name).value : owner.read(target).effective }),
    };
  }
  override disconnect(actor: ActorId): "release" {
    this.source.game.disconnectPlayer(actor);
    return "release";
  }
  override respawn(player: MovementPlayer): void {
    const entity = this.source.game.records.nativeByActor(player.actor.id);
    if (entity !== null) this.source.game.spawns.respawn(entity);
  }
  override keepsAngleDeltas(): boolean {
    return true;
  }
  override admitsGuestMonsters(): boolean {
    return true;
  }
  override grantQuad(actor: ActorId): void {
    const client = this.source.game.records.nativeByActor(actor)?.client;
    if (client != null) client.ps.powerups.set(Powerup.PW_QUAD, this.source.game.level.time + 30000);
  }
  override foreignPowerups(actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number } {
    const powers = this.source.game.records.nativeByActor(actor)?.client?.ps.powerups;
    return {
      quadUntil: (powers?.get(Powerup.PW_QUAD) ?? 0) / 1000,
      doubleUntil: 0,
      invulnerabilityUntil: (powers?.get(Powerup.PW_INVULNERABILITY) ?? 0) / 1000,
    };
  }
  override asQ3(): Of<"q3"> {
    return this.source;
  }
  override baseArsenal(player: MovementPlayer): ArsenalState {
    return { ...player.arsenal, ammo: this.host.inventory.entries(player.actor.id) };
  }
  override stepSelectedHoldable(player: MovementPlayer, input: WeaponStepInput): boolean {
    const client = this.source.game.records.nativeByActor(player.actor.id)?.client;
    if (client == null) throw new Error("Selected primary on Q3 map has no admitted source client");
    const useHoldable = player.arsenalIntent?.useHoldable ?? (input.command.kind === "q3" && (input.command.buttons & CommandButtons.USE_HOLDABLE) !== 0);
    if ((input.command.buttons & CommandButtons.ATTACK) === 0 && !useHoldable && input.environment.health > 0) client.ps.pmFlags &= ~MoveFlags.RESPAWNED;
    return !this.host.ownsQ3Equipment() && this.source.game.stepHoldable(player.actor.id, useHoldable);
  }
  override primaryWeaponStep(player: MovementPlayer, input: WeaponStepInput): WeaponStepResult {
    const host = this.host,
      entity = this.source.game.records.byActor(player.actor.id),
      runtime = host.q3Arsenals.get(player.actor);
    if (entity?.client == null || runtime === undefined) throw new Error("Q3 arsenal has no source client state");
    const ps = entity.client.ps;
    const result = stepQ3Arsenal(
      { ...input, arsenal: host.arsenal(player), gauntletHit: player.sourceMovement?.gauntletHit ?? input.gauntletHit },
      readQ3ArsenalRuntime(entity, runtime),
      resolveQ3ArsenalControls(host.arsenal(player), player.arsenalIntent, input.command, runtime.product),
    );
    host.q3Arsenals.set(player.actor, result.runtime);
    player.arsenal = result.arsenal;
    writeQ3ArsenalRuntime(entity, result.runtime);
    for (const entry of result.arsenal.ammo) host.inventory.configure(player.actor, entry);
    if (result.arsenal.state.kind === "q3") {
      ps.weapon = result.arsenal.state.sourceWeapon;
      ps.weaponState = result.arsenal.state.state;
      ps.weaponTime = result.arsenal.state.timeMilliseconds;
    }
    host.commitCharacterAnimation(player.actor, result.animation);
    host.reconcileSlot(player.actor.id);
    return result;
  }
  override weaponFacts(actor: ActorId): WeaponFacts {
    const ps = this.source.game.records.nativeByActor(actor)?.client?.ps;
    return { q3Ps: ps, spectator: false, hand: "right", quadUntil: (ps?.powerups.get(Powerup.PW_QUAD) ?? 0) / 1000, infiniteAmmo: false };
  }
  override ownsContacts(): boolean {
    return true;
  }
  override jumpVoice(actor: OwnedActor, player: MovementPlayer): boolean {
    if (player.character !== "q3") return false;
    if (player.profile.kind !== "q3") {
      const client = this.source.game.records.nativeByActor(actor.id)?.client;
      if (client == null) throw new Error("Q3 jump voice has no source client");
      client.ps.addEvent(MovementEntityEvent.EV_JUMP, 0);
    }
    return true;
  }
  override preCommand(actor: ActorId, name: string, args: readonly string[]): boolean {
    if (name !== "fly") return false;
    const source = this.source,
      player = this.host.requirePlayer(actor),
      entity = source.game.records.byActor(actor);
    if (entity === null || entity.client === null) throw new Error("Q3 player entity missing");
    if (source.game.level.intermissionTime !== 0) {
      source.game.playerCommand(actor, name, args);
      return true;
    }
    if (!source.game.commands.cheatsOk(entity)) return true;
    const enabled = player.setFlight(!player.flight);
    if (enabled) entity.client.noclip = false;
    this.host.printMessage(actor, `fly ${enabled ? "ON" : "OFF"}\n`);
    return true;
  }
  override afterCommand(actor: ActorId, player: MovementPlayer, name: string, args: readonly string[]): void {
    this.source.game.playerCommand(actor, name, args);
    if (name === "noclip" && this.source.game.records.byActor(actor)?.client?.noclip === true) player.setFlight(false);
  }
  override angleDelta(actor: ActorId): readonly number[] | undefined {
    const native = this.source.game.records.nativeByActor(actor)?.client?.ps.deltaAngles;
    return native === undefined ? undefined : [native.x, native.y, native.z];
  }
  override grantProfile(arsenal: SelectedArsenal): PickupSupplyProfile {
    return arsenal.family === "q2"
      ? Q3_Q2_SUPPLY_PROFILE
      : arsenal.family === "q1" && arsenal.game.registeredWeapons.has("hipnotic:laser")
        ? Q3_HIPNOTIC_SUPPLY_PROFILE
        : Q3_Q1_SUPPLY_PROFILE;
  }
  override uiPowerups(actor: ActorId): PlayerUi["powerups"] {
    const source = this.source,
      client = source.game.records.nativeByActor(actor)?.client;
    return client == null ? [] : q3PowerupTimers(client, source.game.level.time, clientNumber => source.game.pool.clientAt(clientNumber));
  }
  override arsenalUi(actor: ActorId, arsenal: ArsenalState): ArsenalUiParts {
    const inventory = this.host.inventory,
      items: PlayerUiItem[] = [];
    let ammo: PlayerUi["ammo"] = null;
    for (const definition of Q3_WEAPON_ITEMS) {
      const count = definition.ammo === null ? null : inventory.count(actor, definition.ammo);
      items.push({
        id: definition.item,
        label: definition.item.slice("q3:weapon/".length),
        kind: "weapon",
        sourceOrdinal: definition.weapon,
        owned: inventory.count(actor, definition.item) > 0,
        hasAmmo: count === null || count > 0,
        count,
        warningCount: 0,
      });
    }
    const definition = arsenal.state.kind === "q3" ? q3WeaponItem(arsenal.state.sourceWeapon) : null;
    if (definition?.ammo != null) ammo = { item: definition.ammo, count: inventory.count(actor, definition.ammo) };
    const product = this.source.game.options.product;
    return {
      items,
      ammo,
      weaponStatus: q3WeaponStatus(arsenal.activeWeapon, product, item => inventory.count(actor, item), this.host.weaponProvider),
      arsenalWarning: q3ArsenalWarning(product, item => inventory.count(actor, item)),
    };
  }
  override presentations(): readonly SimulationPresentation[] {
    return this.source.game.presentations();
  }
  override foreignCharacterDeath(): boolean {
    return true;
  }
  override rendersOwnIntermission(): boolean {
    return true;
  }
  override canonicalTeam(original: string | null): string | null {
    return original === "q3-team:1" ? "team:red" : original === "q3-team:2" ? "team:blue" : original;
  }
  override declaresMatch(): boolean {
    return true;
  }
  override matchScore(actor: ActorId): number {
    const native = this.source.game.records.nativeByActor(actor)?.client;
    if (native == null) throw new Error("Original Q3 score has no player");
    return native.ps.persistant.get(PersistentIndex.PERS_SCORE);
  }
  override setMatchScore(actor: ActorId, value: number): void {
    const native = this.source.game.records.nativeByActor(actor)?.client;
    if (native == null) throw new Error("Original Q3 score has no player");
    native.ps.persistant.set(PersistentIndex.PERS_SCORE, sourceScore(value));
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const values = [
      { team: "team:red", argument: "red" },
      { team: "team:blue", argument: "blue" },
      { team: null, argument: "free" },
    ];
    const command = values.find(value => value.team === requested);
    if (command === undefined) throw new Error("Team has no original Q3 command");
    this.source.game.playerCommand(actor, "team", [command.argument]);
  }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : this.source.game.host.engine.getUserinfo(client.slot);
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void {
    this.source.game.host.engine.setUserinfo(client.slot, userinfo);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor);
    if (client === null) throw new Error("Q3 userinfo has no admitted client");
    this.source.game.host.engine.setUserinfo(client.slot, userinfo);
    this.source.game.admission.userinfoChanged(client.slot);
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(client: ClientId): PlayerAdmission {
    return this.host.admitQ3Player(client, this.source.game);
  }
  override prepareBot(client: ClientId): OwnedActor {
    if (!this.host.botSlotAvailable(client)) throw new Error("Bot client is not an available session slot");
    const actor = this.host.prepareQ3Client(client, this.source.game, true);
    this.source.game.prepareClient(actor, client.slot);
    return actor;
  }
  override q3Client(actor: ActorId): Q3NativeClient | undefined {
    return this.source.game.records.nativeByActor(actor)?.client;
  }
  override skipsTriggerTouch(): boolean {
    return true;
  }
  override beginActorTurns(frame: FrameContext): void {
    this.source.game.beginFrame(frame);
  }
  override playerThink(player: MovementPlayer, command: ActorCommand): boolean {
    this.host.setQ3Command(player.actor, command);
    try {
      this.source.game.playerThink(command);
    } finally {
      this.host.setQ3Command(player.actor, null);
    }
    this.host.syncQ3Player(player);
    return true;
  }
  override runPlayerActor(actor: OwnedActor): boolean {
    const game = this.source.game,
      host = this.host;
    if (!(host.playerStates.has(actor) || game.records.byActor(actor.id) !== null)) return false;
    game.runActor(actor);
    host.commitAttachments();
    const player = host.playerStates.get(actor);
    if (player !== undefined) host.syncQ3Player(player);
    return true;
  }

  private client(actor: ActorId) {
    return this.source.game.records.nativeByActor(actor)?.client;
  }
  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    const client = this.client(actor);
    return {
      maxHealth: client?.ps.stats.get(statSchema(client.ps.product).maxHealth) ?? 100,
      team: client?.sess.sessionTeam ?? null,
      quadUntil: client?.ps.powerups.get(Powerup.PW_QUAD) ?? 0,
      hasteUntil: client?.ps.powerups.get(Powerup.PW_HASTE) ?? 0,
    };
  }
  override q3GameType(): number {
    return this.source.game.gameType;
  }
  override q3ServerInfo(): string {
    return this.source.game.host.serverState.serverInfo();
  }
  override primaryEquipment(): boolean {
    return this.source.game.options.product === "missionpack";
  }
  override hasEquipmentEffects(): boolean {
    return this.primaryEquipment();
  }
  override weaponDamageFactor(actor: ActorId, quad: boolean): number {
    const client = this.client(actor);
    return client == null ? 1 : q3WeaponDamageFactor(client, quad ? this.source.game.quadDamageFactor() : 1, client.ps.product);
  }
  override equipmentDamageFactor(actor: ActorId): number {
    if (this.client(actor) == null) throw new Error("Primary Q3 equipment lost its client");
    return this.weaponDamageFactor(actor, true);
  }
  override equipmentFiringDelay(actor: ActorId, milliseconds: number): number {
    const client = this.client(actor);
    if (client == null) throw new Error("Primary Q3 equipment lost its client");
    return q3WeaponDelay(milliseconds, client.persistantPowerup?.item?.tag ?? 0, client.ps.powerups.get(Powerup.PW_HASTE) !== 0 || this.host.hasteFlag(actor));
  }
  override weaponDelay(actor: ActorId, seconds: number): number {
    const client = this.client(actor);
    if (client == null) return seconds;
    const schema = statSchema(client.ps.product),
      persistent = schema.product === "missionpack" ? itemAt(client.ps.product, client.ps.stats.get(schema.persistentPowerup)).tag : 0;
    const milliseconds = seconds * 1000,
      delay = q3WeaponDelay(milliseconds, persistent, client.ps.powerups.get(Powerup.PW_HASTE) !== 0);
    return delay === milliseconds ? seconds : delay / 1000;
  }
  override curvesEnabled(): boolean {
    return this.source.game.host.cvars.variableValue("cm_noCurves") === 0;
  }
  override playerCurveClip(): boolean {
    return this.source.game.host.cvars.variableValue("cm_playerCurveClip") !== 0;
  }
  override friendlyFire(): boolean {
    return this.source.game.host.cvars.variableValue("g_friendlyFire") !== 0;
  }
  override knockback(): number {
    return this.source.game.host.cvars.variableValue("g_knockback");
  }
  override intermissionQueued(): number {
    return this.source.game.level.intermissionQueued;
  }
  override checkHurtCarrier(target: ActorId, attacker: ActorId): void {
    const nativeTarget = this.source.game.records.nativeByActor(target),
      nativeAttacker = this.source.game.records.nativeByActor(attacker);
    if (nativeTarget !== null && nativeAttacker !== null) this.source.game.team.checkHurtCarrier(nativeTarget, nativeAttacker);
  }
  override checkObeliskAttack(target: ActorId, attacker: ActorId): boolean {
    const nativeTarget = this.source.game.records.nativeByActor(target),
      nativeAttacker = this.source.game.records.nativeByActor(attacker);
    return nativeTarget !== null && nativeAttacker !== null && this.source.game.team.checkObeliskAttack(nativeTarget, nativeAttacker);
  }
  override quadFactor(): number {
    return this.source.game.quadDamageFactor();
  }
  override proximityTimeout(): number {
    return this.source.game.host.cvars.variableValue("g_proxMineTimeout");
  }
  override returnPickup(actor: ActorId): void {
    const pickup = this.source.game.records.nativeByActor(actor);
    if (pickup === null || !pickup.inuse) throw new Error("Borrowed persistent pickup was retired");
    returnQ3PersistentPowerup(pickup, this.source.game.world);
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    const body = this.host.body(actor.id);
    if (body === null) throw new Error("Selected teleporter lost its body");
    return this.source.game.spawns.selectSpawnPoint(body.origin);
  }
  override dropObjectives(actor: OwnedActor): void {
    const entity = this.source.game.records.nativeByActor(actor.id);
    if (entity === null) throw new Error("Selected objective drop has no map player");
    dropQ3TeleportObjectives({ product: this.source.game.options.product, combat: this.source.game.bridge.context, drops: this.source.game.drops }, entity);
  }
  override setMaxHealth(actor: ActorId, health: number): void {
    const target = this.client(actor);
    if (target == null) throw new Error("Selected max health has no Q3 client");
    target.pers.maxHealth = health;
    target.ps.stats.set(statSchema(target.ps.product).maxHealth, health);
  }
  override cvars(): CvarRegistry {
    return this.source.game.host.cvars;
  }
  override q1PowerupExpires(actor: ActorId, powerup: Q1Powerup): number {
    const client = this.client(actor);
    const key = powerup === "quad" ? Powerup.PW_QUAD : powerup === "invisibility" ? Powerup.PW_INVIS : powerup === "suit" ? Powerup.PW_BATTLESUIT : null;
    return powerup === "invulnerability" ? (client?.invulnerabilityTime ?? 0) / 1000 : key === null ? 0 : (client?.ps.powerups.get(key) ?? 0) / 1000;
  }
  override runsQ3Powerups(): boolean {
    return true;
  }
  override equipmentSuppression(): EquipmentSuppression {
    return { quad: false, quadFire: false, haste: true };
  }
  override notarget(actor: ActorId): boolean {
    return ((this.source.game.records.byActor(actor)?.flags ?? 0) & 32) !== 0;
  }

  override assertSaveReady(): void {
    this.host.assertOutputConsumed();
    if (!this.host.q3ArsenalsComplete()) throw new Error("Q3 save requires completed client admission");
  }
  override checkpointProviders(add: (schema: SaveProvider["schema"], bytes: Uint8Array) => void): void {
    add("q3:native", this.source.game.captureNativeBytes());
    add("world:q3-runtime", this.host.q3RuntimeBytes());
  }
  override travelSource(): SimulationTravel["source"] {
    return { kind: "shared" };
  }
  override travelPlayerState(actor: ActorId): CarriedPlayerState {
    return this.host.sharedTravelState(actor) ?? { kind: "quakec" };
  }
}

class Q3QvmStrategy extends LoadedStrategy {
  constructor(
    private readonly source: Of<"q3-qvm">,
    private readonly host: SourceStrategyHost,
  ) {
    super();
  }
  override readonly kind: "q3-qvm" = "q3-qvm";
  override checkOutputClaim(channels: readonly string[], movement: string | undefined): void {
    super.checkOutputClaim(channels, movement);
    const options = this.host.options.q3Guest?.prepared.primary;
    if (channels.includes("movement-mode") && options?.input?.movementModes === undefined)
      throw new Error("Original QVM movement modes require an artifact-qualified input declaration");
    if (channels.includes("body-shape") && options?.weapons?.equipmentMovement.bodyTrace === undefined)
      throw new Error("Selected original QVM movement has no admitted body trace interface");
  }
  override guestGrounded(actor: ActorId): boolean {
    const slot = this.source.game.records.slot(actor);
    if (slot === null) throw new Error("QVM movement state requires a source client");
    return this.source.game.records.player(slot).groundEntityNumber !== 1023;
  }
  override guestClientView(actor: ActorId): { readonly viewOffset: Vec3; readonly crouched: boolean } {
    const slot = this.source.game.records.slot(actor);
    if (slot === null) throw new Error("QVM view requires a live source client");
    const state = this.source.game.records.player(slot);
    return { viewOffset: { x: 0, y: 0, z: state.viewHeight }, crouched: (state.movementFlags & 1) !== 0 };
  }
  override outputsSuspended(actor: ActorId): boolean {
    const slot = this.source.game.records.slot(actor),
      input = this.host.options.q3Guest?.prepared.primary.input;
    return slot === null || input?.intermission.includes(this.source.game.records.player(slot).movementType) === true;
  }
  override handoff(actor: ActorId): PrimaryWeaponHandoff {
    const host = this.host;
    let holstered = false;
    const accepts = (item: ItemId) => {
      const ui = this.guestUi(actor);
      return ui.activeWeapon === item || ui.items.some(entry => entry.id === item && entry.kind === "weapon" && entry.owned);
    };
    const select = (item: ItemId): boolean => {
      if (!accepts(item)) return false;
      const ui = this.guestUi(actor);
      if (ui.activeWeapon === item) return true;
      const weapon = ui.items.find(entry => entry.id === item && entry.kind === "weapon");
      if (weapon === undefined) return false;
      host.nativeWeaponRequests.set(actor, weapon.sourceOrdinal);
      return true;
    };
    return {
      kind: "immediate",
      provider: host.weaponProvider.provider,
      accepts,
      select,
      holster: () => {
        holstered = true;
      },
      isHolstered: () => holstered,
      resume: item => {
        holstered = false;
        return item === null || select(item);
      },
    };
  }
  override equipmentPowerups(actor: ActorId): { readonly quadUntil: number; readonly hasteUntil: number } {
    const state = this.source.game.records.player(this.source.game.records.requireSlot(actor));
    return { quadUntil: (state.powerups[Powerup.PW_QUAD] ?? 0) / 1000, hasteUntil: state.powerups[Powerup.PW_HASTE] ?? 0 };
  }
  override guestWeaponAnimation(actor: ActorId, priority: "attack" | "reverse", melee: boolean): boolean {
    if (priority === "attack") this.host.qvmWeapons().attackAnimation(actor, melee);
    return true;
  }
  override stepRoute(): "awaited" {
    return "awaited";
  }
  override teamGame(): boolean {
    return this.source.game.state.cvars.variableValue("g_gametype") >= 3;
  }
  override serverCvars(): ServerCvarRegistry {
    return this.source.game.state.cvars;
  }
  override clientOf(actor: ActorId): ClientId | null {
    return this.source.game.players().find(player => player.actor.equals(actor))?.client ?? null;
  }
  override keepsAngleDeltas(): boolean {
    return true;
  }
  override admitsGuestMonsters(): boolean {
    return true;
  }
  override monsterProxy(): GuestMonsterProxy {
    const source = this.source;
    return {
      allocate: () => (source.combat === null ? null : source.combat.spawnProxyEntity()),
      bind: (slot, actor) => {
        if (source.combat === null) return;
        source.game.records.registerForeign(slot, actor);
        source.combat.bindProxy(slot, actor);
      },
    };
  }
  override asQ3Qvm(): Of<"q3-qvm"> {
    return this.source;
  }
  override angleDelta(_actor: ActorId, client: ClientId): readonly number[] {
    return this.source.game.records.player(client.slot).deltaAngleWords;
  }
  override guestGrantExclusions(): ReadonlySet<ItemId> {
    return new Set(this.source.catalog.weapons().flatMap(weapon => (weapon.ammo === null ? [weapon.item] : [weapon.item, weapon.ammo])));
  }
  override hasGuestUi(): boolean {
    return true;
  }
  override guestUi(actor: ActorId): PlayerUi {
    const source = this.source,
      host = this.host;
    const player = source.game.players().find(player => player.actor.equals(actor));
    if (player === undefined) throw new Error("Actor has no Q3 guest client UI");
    const original = q3GuestPlayerUi(
      source.game.records.player(player.sourceEntity),
      host.recipe.map.entities,
      host.timeSeconds * 1000,
      source.catalog.weapons(),
      host.options.q3Guest?.prepared.product,
      source.inventory === null ? undefined : host.inventory.entries(actor),
      source.weapons?.active(actor),
    );
    const arsenal = host.selectedArsenal;
    const ui = arsenal?.has(actor) === true ? { ...original, inventory: host.inventory.entries(actor), ...arsenal.ui(actor, host.weaponProvider) } : original;
    if (source.combat === null) return ui;
    const combat = host.combat.read(actor);
    if (combat === null) throw new Error("Qualified Q3 guest client has no combat binding");
    return { ...ui, armor: combat.armor };
  }
  override guestView(actor: ActorId): PlayerView {
    const player = this.source.game.players().find(player => player.actor.equals(actor));
    if (player === undefined) throw new Error("Actor has no Q3 guest client view");
    const state = this.source.game.records.player(player.sourceEntity);
    return { origin: state.origin, angles: state.viewAngles, viewHeight: state.viewHeight };
  }
  override guestWeaponViews(): boolean {
    return true;
  }
  override weaponVisible(): boolean {
    return true;
  }
  override guestBobCycle(actor: ActorId): number {
    return this.source.game.records.player(this.source.game.records.requireSlot(actor)).bobCycle;
  }
  override rendersOwnIntermission(): boolean {
    return true;
  }
  override canonicalTeam(original: string | null): string | null {
    const mapping = this.source.weapons?.match?.teams.find(value => value.source === original);
    return mapping === undefined ? original : mapping.team;
  }
  override declaresMatch(): boolean {
    return this.source.weapons?.match != null;
  }
  override matchScore(actor: ActorId): number {
    return this.host.qvmWeapons().score(actor);
  }
  override setMatchScore(actor: ActorId, value: number): void {
    this.host.qvmWeapons().setScore(actor, value);
  }
  override setMatchTeam(actor: ActorId, requested: string | null): void {
    const profile = this.source.weapons?.match,
      player = this.source.game.players().find(value => value.actor.equals(actor));
    if (profile == null || player === undefined) throw new Error("Original QVM team commands have no declaration");
    this.source.game.commandImmediate(player, sourceTeamCommand(profile, requested));
  }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : (this.source.game.state.getUserinfo(client.slot) ?? null);
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void {
    this.source.game.state.setUserinfo(client.slot, userinfo);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, _previous: string | null): void | Promise<void> {
    const player = this.source.game.players().find(player => player.actor.equals(actor));
    if (player === undefined) throw new Error("Q3 guest userinfo has no admitted client");
    return this.source.game.userinfo(player, userinfo);
  }

  override admitClient(): PlayerAdmission {
    throw new Error("Q3 guest admission requires the awaited native network lifecycle");
  }

  override selectedPlayer(actor: ActorId): SelectedPlayerStats {
    const weapons = this.host.qvmWeapons();
    return {
      maxHealth: weapons.maxHealth(actor),
      team: null,
      quadUntil: weapons.powerupUntil(actor, "quad"),
      hasteUntil: weapons.powerupUntil(actor, "haste"),
    };
  }
  override q3GameType(): number {
    return this.source.game.state.cvars.variableValue("g_gametype");
  }
  override hasEquipmentEffects(): boolean {
    return true;
  }
  override weaponDamageFactor(actor: ActorId): number {
    return this.host.qvmWeapons().damageFactor(actor);
  }
  override equipmentFiringDelay(actor: ActorId, milliseconds: number, persistent: number): number {
    return persistent === Powerup.PW_SCOUT || persistent === Powerup.PW_AMMOREGEN
      ? q3WeaponDelay(milliseconds, persistent, false)
      : this.host.qvmWeapons().weaponDelay(actor, milliseconds);
  }
  override weaponDelay(actor: ActorId, seconds: number): number {
    return this.host.qvmWeapons().weaponDelay(actor, Math.trunc(seconds * 1000)) / 1000;
  }
  override equipmentDelay(actor: ActorId, provider: ProviderId, seconds: number): number {
    return this.host.qvmWeapons().equipmentDelay(actor, provider, Math.round(seconds * 1000)) / 1000;
  }
  override teleportSpawn(actor: OwnedActor): SpawnPoint {
    return this.host.qvmWeapons().spawnPoint(actor.id);
  }
  override dropObjectives(actor: OwnedActor): void {
    this.host.qvmWeapons().dropObjectives(actor.id);
  }
  override originalPlayer(): OriginalPlayer {
    const weapons = this.host.qvmWeapons();
    return {
      setMaxHealth: (actor, health) => weapons.setMaxHealth(actor, health),
      teleport: (actor, origin, velocity, angles, hold) => weapons.teleportState(actor, origin, velocity, angles, hold),
    };
  }
  override identitySupply(): boolean {
    return true;
  }
  override ownsSupply(): boolean {
    return true;
  }
  override animatesWeaponFire(): boolean {
    return true;
  }
  override cvars(): CvarRegistry {
    return this.source.game.state.cvars;
  }
  override runsQ3Powerups(): boolean {
    return true;
  }
  override equipmentSuppression(): EquipmentSuppression {
    return NATIVE_SUPPRESSION;
  }
  override ownsEquipmentPlayers(): boolean {
    return true;
  }
  override notarget(actor: ActorId): boolean | null {
    return this.source.combat?.notarget(actor) ?? null;
  }
  override connectedClients(): readonly ClientId[] {
    return this.source.game.players().map(player => player.client);
  }
  override playerActors(): readonly ActorId[] {
    return this.source.game.players().map(player => player.actor);
  }
  override teleportBits(actor: ActorId): number {
    return this.source.game.records.player(this.source.game.records.requireSlot(actor)).flags & 4;
  }
  override playerAvailable(actor: ActorId): boolean {
    const player = this.source.game.players().find(entry => entry.actor.equals(actor));
    if (player === undefined) return false;
    const state = this.source.game.records.player(player.sourceEntity);
    return (
      this.source.weapons?.available(actor) ??
      ((state.stats[0] ?? 0) > 0 &&
        state.movementType !== MoveType.PM_SPECTATOR &&
        state.movementType !== MoveType.PM_INTERMISSION &&
        state.movementType !== MoveType.PM_SPINTERMISSION)
    );
  }
  override assertSaveReady(): void {
    this.host.assertOutputConsumed();
  }
  override projectsMonsters(): boolean {
    return true;
  }
  override usesGuestMonsters(): boolean {
    return true;
  }
  override checkpointGuests(): SaveImage["guests"] {
    return [this.source.game.checkpoint()];
  }
  override checkpointExtras(): Readonly<Record<string, number | string | null>> {
    return {
      qvmPrimaryDeclaration: this.host.qvmDeclaration(),
      ...(this.source.combat !== null ? { qvmArmorProjection: 1 } : {}),
      ...(this.source.inventory !== null ? { qvmInventoryProjection: 1 } : {}),
    };
  }
  override expectedDeclaration(): string | null {
    return this.host.qvmDeclaration();
  }
  override legacyCombat(): Of<"q3-qvm">["combat"] {
    return this.source.combat;
  }
  override setMaxHealth(actor: ActorId, health: number): void {
    this.host.qvmWeapons().setMaxHealth(actor, health);
  }
  override requireInventoryProjection(): void {
    if (this.source.inventory === null) throw new Error("Saved QVM inventory requires qualified source storage");
  }
  override inventoryCoverage(projected: { readonly native: boolean; readonly qvm: boolean }): InventoryCoverage | null {
    const source = this.source,
      host = this.host;
    if (projected.qvm || source.inventory === null) return null;
    return {
      legacy: true,
      actors: host.entityActors().filter(actor => {
        const slot = source.game.records.slot(actor.id);
        return slot !== null && slot < source.game.engine.data.numClients && host.hasInventory(actor.id);
      }),
    };
  }
  override travelSource(): SimulationTravel["source"] {
    return { kind: "shared" };
  }
  override travelers(): readonly { readonly client: ClientId; readonly actor: ActorId }[] {
    return this.source.game.players().map(player => ({ client: player.client, actor: player.actor }));
  }
  override travelPlayerState(actor: ActorId): CarriedPlayerState {
    return this.host.sharedTravelState(actor) ?? { kind: "quakec" };
  }
  override guestHealth(actor: ActorId): number | null {
    const slot = this.source.game.records.slot(actor);
    return slot === null ? null : (this.source.game.records.player(slot).stats[0] ?? null);
  }
  override setGuestHealth(actor: ActorId, health: number): void {
    const game = this.source.game,
      slot = game.records.slot(actor);
    if (slot === null) return;
    const state = game.records.player(slot);
    game.engine.data.writePlayerState(slot, { ...state, stats: state.stats.map((value, index) => (index === 0 ? health : value)) });
  }
  override guestTravelPlayers(): readonly { readonly actor: ActorId; readonly client: ClientId; readonly alive: boolean }[] {
    const game = this.source.game;
    return game.players().map(player => ({ actor: player.actor, client: player.client, alive: (game.records.player(player.sourceEntity).stats[0] ?? 0) > 0 }));
  }
}

export function createSourceStrategy(source: SourceRuntime, host: SourceStrategyHost): SourceStrategy {
  switch (source.kind) {
    case "loading":
      return new LoadingStrategy();
    case "quakec":
      return new QuakeCStrategy(source, host);
    case "q1":
      return new Q1Strategy(source, host);
    case "q3":
      return new Q3Strategy(source, host);
    case "q3-qvm":
      return new Q3QvmStrategy(source, host);
    case "q2-native":
      return new Q2NativeStrategy(source, host);
    case "q2":
      return new Q2Strategy(source, host);
  }
}
