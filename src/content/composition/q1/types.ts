import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "../../q1/foundation/entity.ts";
import type { Q1CampaignBinding, Q1SourceFinale, Q1TravelState } from "../../q1/base/index.ts";
import type { Q1AddonEvent } from "../../q1/addons/context.ts";
import type { CtfStatus, CtfTeam } from "../../q1/addons/ctf/types.ts";

export type Q1SourceProgram = "id1" | "hipnotic" | "rogue" | "dopa" | "mg1" | "mg3" | "ctf";
export interface Q1SourceSelection {
  readonly program: Q1SourceProgram;
  readonly campaign: Q1CampaignBinding;
  readonly registered: boolean;
  readonly officialCampaign: boolean;
}
export interface Q1ClientAdmission {
  /** Native client index, zero based. The actor's source edict remains slot + 1. */
  readonly slot: number;
  readonly userinfo: ReadonlyMap<string, string>;
}
export interface Q1SourceInput {
  readonly attack: boolean;
  readonly jump: boolean;
  readonly use: boolean;
  readonly impulse: number;
}
export interface Q1SelectedPlayer {
  readonly deadFlag: 0 | 1 | 2 | 3;
  readonly isBot: boolean;
  readonly viewAngles: Vec3;
  readonly viewOffset: Vec3;
  readonly frame: number;
  readonly waterType: "empty" | "water" | "slime" | "lava";
  readonly waterLevel: 0 | 1 | 2 | 3;
  readonly teleportUntil: number;
}
export interface Q1ClientSnapshot {
  readonly actor: ActorId;
  readonly slot: number;
  readonly name: string;
  readonly frags: number;
  readonly shirt: number;
  readonly pants: number;
  readonly team: number;
  readonly observer: boolean;
  readonly noTarget: boolean;
  readonly userinfo: readonly { readonly key: string; readonly value: string }[];
}
export type Q1CompositionEvent =
  | { readonly kind: "addon"; readonly event: Q1AddonEvent }
  | { readonly kind: "client"; readonly client: Q1ClientSnapshot }
  | { readonly kind: "client-left"; readonly actor: ActorId; readonly slot: number }
  | { readonly kind: "ctf-status"; readonly actor: ActorId; readonly status: CtfStatus }
  | { readonly kind: "ctf-capture"; readonly team: CtfTeam; readonly total: number }
  | { readonly kind: "prompt"; readonly actor: ActorId; readonly title: string; readonly choices: readonly { readonly label: string; readonly impulse: number }[] }
  | { readonly kind: "clear-prompt"; readonly actor: ActorId }
  | { readonly kind: "source-log"; readonly actor: ActorId; readonly action: string }
  | { readonly kind: "developer-message"; readonly text: string }
  | { readonly kind: "level-presentation"; readonly event: Q1SourceFinale };

/** Operations on the already selected session movement, character, arsenal and UI. */
export interface Q1CompositionServices {
  cvar(name: string): number;
  setCvar(name: string, value: string): undefined;
  emit(event: Q1CompositionEvent): undefined;
  selectedPlayer(actor: ActorId): Q1SelectedPlayer;
  setObserver(actor: ActorId, enabled: boolean): undefined;
  /** Resets the selected character/movement and applies the supplied source travel once. */
  placePlayer(actor: OwnedActor, spot: Q1Actor, travel: Q1TravelState): undefined;
  disconnect(actor: ActorId): undefined;
  teleport(actor: ActorId, origin: Vec3, angles: Vec3, velocity: Vec3, until: number): undefined;
  selectedWeapon(actor: ActorId): ItemId | null;
  selectedAmmo(actor: ActorId): ItemId | null;
  selectWeapon(actor: ActorId, item: ItemId): boolean;
  weaponChanged(actor: ActorId, acquired: ItemId | null): undefined;
  promptSupported(actor: ActorId): boolean;
  /** Starts a source session restart, including SetNewParms rather than ordinary level carry. */
  restartSession(map: string, startingServerFlags: number): undefined;
  finishCampaign(): undefined;
}
