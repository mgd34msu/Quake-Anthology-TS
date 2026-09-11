import type { SavedActorId } from "../../../contracts/session.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2FogState, Q2RereleaseOptions, Q2RereleasePlayerState } from "./types.ts";
import type { Q2RereleaseQ64Checkpoint } from "./q64/index.ts";
import type { Q2RereleaseLevelEntry } from "./campaign.ts";
import type { Q2RereleaseCampaignState } from "./campaign.ts";
import type { Q2RereleaseGoalsCheckpoint } from "./goals.ts";

export interface Q2RereleasePlayersCheckpoint {
  readonly version: 1;
  readonly options: Readonly<Q2RereleaseOptions>;
  readonly coopRestartTime: number;
  readonly deadlyKillBox: boolean;
  readonly intermissionFlags: number;
  readonly intermissionFadeUntil: number | null;
  readonly intermissionCamera: { readonly origin: Vec3; readonly angles: Vec3 } | null;
  readonly intermissionCameraSet: boolean;
  readonly players: readonly { readonly actor: SavedActorId; readonly state: Readonly<Q2RereleasePlayerState> }[];
  readonly squadSpawns: readonly { readonly actor: SavedActorId; readonly origin: Vec3; readonly angles: Vec3 }[];
}
export interface Q2RereleaseModuleCheckpoint {
  readonly version: 1;
  readonly worldFog: Q2FogState;
  readonly story: string;
  readonly sky: { readonly name: string; readonly rotation: number; readonly autoRotate: boolean; readonly axis: Vec3 };
  readonly poi: { readonly actor: SavedActorId; readonly origin: Vec3; readonly image: string; readonly dynamic: SavedActorId | null } | null;
  readonly poiStage: number;
  readonly lastAutoSave: number;
  readonly campaign: { readonly crossUnitFlags: number; readonly visitedMaps: readonly string[]; readonly levels: readonly Readonly<Q2RereleaseLevelEntry>[]; readonly mission: Readonly<Q2RereleaseCampaignState["mission"]> };
  readonly healthBars: readonly ({ readonly controller: SavedActorId; readonly target: SavedActorId; readonly deadUntil: number | null } | null)[];
  readonly healthTargets: readonly { readonly controller: SavedActorId; readonly target: SavedActorId }[];
  readonly pickedUpBy: readonly { readonly actor: SavedActorId; readonly slots: readonly number[] }[];
  readonly triggerSoundTimes: readonly { readonly actor: SavedActorId; readonly time: number }[];
  readonly q64: Q2RereleaseQ64Checkpoint;
  readonly lights: readonly { readonly actor: SavedActorId; readonly active: boolean }[];
  readonly goals: Q2RereleaseGoalsCheckpoint;
}
