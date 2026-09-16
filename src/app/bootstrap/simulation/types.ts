import type { CvarArchiveEntry } from "../../../core/cvars/index.ts";
import type { DebugLine } from "../../../debug/shapes.ts";
import type { PreparedQ3Game } from "./q3/guest-artifact.ts";
import type { Q3GuestRuntimeOptions } from "./q3/guest-runtime.ts";
import type { SceneFlare } from "../../../contracts/flare.ts";
import type { WorldText } from "../../../text/world.ts";
import type { IndexedModelSkin } from "../../../contracts/scene.ts";
import type { PreparedQuakeCSource } from "./quakec-source.ts";
import type { ArsenalAmmoWarning, WeaponHudStatus } from "../../../contracts/ui.ts";
import type { WeaponReference } from "./weapon-slot.ts";
import type { HandGrenadeTravel } from "./equipment-runtime.ts";
import type { Q3SharedBallisticEvent } from "./q3-ballistics.ts";
import type { Q1SelectedArsenalTravel } from "./arsenal/q1.ts";
import type { Q3SelectedArsenalCheckpoint } from "./arsenal/q3.ts";
import type { LmctfTravel } from "../../../content/q2/multiplayer/lmctf/types.ts";
import type { ApplicationMonsterNavigation } from "./monster-navigation.ts";
import type { Q2RereleaseCampaignState } from "../../../content/q2/rerelease/campaign.ts";
import type { ContentId, ExecutableRecipe, GameFamily, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { ActorId, ClientId, IdentityOwner } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1CompositionEvent } from "../../../content/composition/q1/types.ts";
import type { Q1Event } from "../../../content/q1/foundation/types.ts";
import type { Q2PresentationEvent } from "../../../content/q2/foundation/host.ts";
import type { Q2WeaponEvent } from "../../../content/q2/foundation/weapons/types.ts";
import type { Q2CompositionEvent } from "../../../content/composition/q2/types.ts";
import type { Q2RereleaseEvent } from "../../../content/q2/rerelease/types.ts";
import type { Q2PlayerEvent } from "../../../content/q2/base/player/types.ts";
import type { Q2PlayerCarry } from "../../../content/q2/base/player/types.ts";
import type { Q1TravelState } from "../../../content/q1/base/travel.ts";
import type { Q1IntermissionResult } from "../../../content/q1/base/rules.ts";
import type { Q3CharacterView } from "../../../content/q3/foundation/presentation.ts";
import type { TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ArmorState, InventoryEntry, ItemId } from "../../../contracts/gameplay.ts";
import type { Q3CharacterEvent } from "../../../content/q3/foundation/character.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { ApplicationWorld } from "../content.ts";
import type { Q3SourceEvent } from "./q3/host.ts";
import type { Q3SourceSessionCarry } from "./q3/types.ts";
import type { SaveImage } from "../../../contracts/session.ts";

export interface SimulationOptions {
  readonly dedicated?: boolean;
  readonly promptSupported?: (client: ClientId) => boolean;
  readonly preparedQuakeC?: PreparedQuakeCSource;
  readonly q3Guest?: Pick<Q3GuestRuntimeOptions, "writable" | "common"> & {
    readonly prepared: PreparedQ3Game;
    readonly gameDirectory: string;
    print(text: string): void;
  };
  readonly identity: IdentityOwner;
  readonly recipe: ExecutableRecipe;
  readonly world: ApplicationWorld;
  readonly mounts: MountedContent;
  readonly skill: 0 | 1 | 2 | 3;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly seed: number;
  readonly maxClients: number;
  readonly travel?: SimulationTravel;
  readonly playerIdentity?: (client: ClientId) => { readonly seat: number; readonly socialId: string };
  readonly q3Session?: Q3SourceSessionCarry;
  readonly serverProfile?: import("../../../settings/server/types.ts").ServerProfile;
  readonly sourceRegistry?: import("../../../core/cvars/index.ts").CvarRegistry;
  readonly sourceArchive?: readonly CvarArchiveEntry[];
  readonly q2Cvars?: readonly { readonly name: string; readonly value: string }[];
  readonly q3Cvars?: readonly { readonly name: string; readonly value: string }[];
  readonly initialSourceMilliseconds?: number;
  readonly monsterNavigation?: ApplicationMonsterNavigation;
  readonly restore?: SaveImage;
  readonly restoredClients?: readonly ClientId[];
}

export interface QuakeCSourceTravel {
  readonly kind: "netquake" | "quakeworld";
  readonly serverFlags: number;
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
  readonly clients: readonly { readonly client: ClientId; readonly parameters: readonly number[]; readonly userInfo: ReadonlyMap<string, string> }[];
}

export interface SimulationTravel {
  readonly spawnPoint: string;
  readonly source: { readonly kind: "q1"; readonly flags: number; readonly skill: 0 | 1 | 2 | 3 }
    | QuakeCSourceTravel
    | { readonly kind: "q2"; readonly serverFlags: number; readonly lmctf?: LmctfTravel; readonly rerelease?: Q2RereleaseCampaignState; readonly landmark: { readonly clientSlot: number; readonly name: string;
      readonly relativeOrigin: Vec3; readonly relativeVelocity: Vec3; readonly relativeViewAngles: Vec3 } | null };
  readonly players: readonly { readonly client: ClientId; readonly weaponSlot?: WeaponReference; readonly handGrenades?: HandGrenadeTravel; readonly selectedArsenal?: { readonly kind: "q1"; readonly state: Q1SelectedArsenalTravel }
    | { readonly kind: "q2"; readonly weapon: ItemId | null; readonly inventory: readonly InventoryEntry[] }
    | { readonly kind: "q3"; readonly state: Q3SelectedArsenalCheckpoint; readonly milliseconds: number }; readonly state: { readonly kind: "q1"; readonly carry: Q1TravelState } | { readonly kind: "q2"; readonly carry: Q2PlayerCarry } }[];
}

export interface PlayerAdmission { readonly actor: ActorId; readonly viewHeight: number; }
export interface PlayerView { readonly origin: Vec3; readonly angles: Vec3; readonly viewHeight: number; readonly kickAngles?: Vec3; readonly fieldOfView?: number; readonly foreignCharacterDeath?: true; }
export interface PlayerUiItem {
  readonly id: ItemId;
  readonly label: string;
  readonly kind: "weapon" | "powerup";
  readonly sourceOrdinal: number;
  readonly owned: boolean;
  readonly hasAmmo: boolean;
  readonly count: number | null;
  readonly warningCount: number;
}
export interface PlayerUi {
  readonly weaponStatus: WeaponHudStatus | null;
  readonly arsenalWarning: ArsenalAmmoWarning;
  readonly health: number;
  readonly armor: ArmorState;
  readonly activeWeapon: ItemId | null;
  readonly ammo: { readonly item: ItemId; readonly count: number } | null;
  readonly inventory: readonly InventoryEntry[];
  readonly items: readonly PlayerUiItem[];
}

export interface SimulationPresentation {
  readonly flare?: SceneFlare;
  readonly actor: ActorId;
  readonly content: ContentId;
  readonly family: GameFamily;
  readonly path: string;
  readonly frame: number;
  readonly oldFrame: number;
  readonly backLerp?: number;
  readonly skin: number;
  readonly skinPath?: string | null;
  readonly indexedSkin?: IndexedModelSkin;
  readonly playerColors?: { readonly top: number; readonly bottom: number };
  readonly effects: number;
  readonly renderFlags: number;
  readonly origin: Vec3;
  readonly previousOrigin?: Vec3;
  readonly modelBeam?: { readonly segmentLength: number };
  readonly angles: Vec3;
  readonly scale: number;
  readonly alpha?: number;
  readonly visible: boolean;
  readonly viewWeapon: boolean;
  readonly q3Weapon?: { readonly timeMilliseconds: number; readonly torsoAnimation: number; readonly lastFireMilliseconds: number | null;
    readonly firing: boolean; readonly horizontalSpeed: number; readonly bobCycle: number; readonly weapon: number };
}

export type SourcePresentationEvent = { readonly kind: "q1"; readonly event: Q1Event }
  | { readonly kind: "music"; readonly event: { readonly kind: "cd-track"; readonly track: number } }
  | { readonly kind: "q1-composition"; readonly event: Q1CompositionEvent }
  | { readonly kind: "q1-level"; readonly event: Q1IntermissionResult }
  | { readonly kind: "q2"; readonly event: Q2PresentationEvent }
  | { readonly kind: "q2-weapon"; readonly event: Q2WeaponEvent }
  | { readonly kind: "view-reset"; readonly reason: "spawn" | "teleport" | "freeze" | "source"; readonly actor: ActorId; readonly angles: Vec3 }
  | { readonly kind: "q2-composition"; readonly event: Q2CompositionEvent }
  | { readonly kind: "q2-rerelease"; readonly event: Q2RereleaseEvent }
  | { readonly kind: "q2-player"; readonly event: Q2PlayerEvent }
  | { readonly kind: "q3-character"; readonly event: Q3CharacterEvent }
  | { readonly kind: "q3-ballistics"; readonly event: Q3SharedBallisticEvent }
  | { readonly kind: "q3-source"; readonly event: Q3SourceEvent };
export type SimulationPresentationEvent = SourcePresentationEvent & { readonly sequence: number; readonly content: ContentId; readonly seconds: number; readonly sourceEntity?: number | null };

export interface DebugShapePresentationAccess {
  lines(): readonly DebugLine[];
  lineWidth(): number;
}

export interface SimulationPresentationAccess {
  worldText(): readonly WorldText[];
  playerUi(actor: ActorId): PlayerUi;
  captureTravel(spawnPoint?: string): SimulationTravel;
  admitTravel(client: ClientId, travel: SimulationTravel): PlayerAdmission;
  characterViews(): readonly Q3CharacterView[];
  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined;
  takeTransitions(): readonly TransitionIntent[];
  presentations(): readonly SimulationPresentation[];
  drainPresentationEvents(): readonly SimulationPresentationEvent[];
  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined;
  playerView(actor: ActorId): PlayerView;
  admitPlayer(client: ClientId): PlayerAdmission;
}
