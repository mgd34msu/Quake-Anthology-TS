import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2LandmarkCarry, Q2Entity } from "../../foundation/host.ts";
import type { Q2AttackCheckpoint } from "../../foundation/checkpoint.ts";
import type { Q2PlayerRules, Q2PlayerState } from "./types.ts";

export interface Q2PlayerStateCheckpoint extends Omit<Q2PlayerState, "chaseTarget"> { readonly chaseTarget: SavedActorId | null; }
export type Q2PlayerIntermissionCheckpoint = { readonly kind: "playing" } | {
  readonly kind: "intermission"; readonly map: string; readonly started: number; readonly exit: boolean;
  readonly landmark: (Omit<Q2LandmarkCarry, "player"> & { readonly player: SavedActorId }) | null;
};
export interface Q2PlayersCheckpoint {
  readonly version: 1;
  readonly corpseIndex: number;
  readonly deathAnimation: number;
  readonly painAnimation: number;
  readonly rules: Readonly<Q2PlayerRules>;
  readonly intermission: Q2PlayerIntermissionCheckpoint;
  readonly players: readonly { readonly actor: SavedActorId; readonly state: Q2PlayerStateCheckpoint }[];
}

export interface Q2CharacterCheckpoint {
  readonly version: 1;
  readonly painIndex: number;
  readonly deathIndex: number;
  readonly state: Q2PlayerStateCheckpoint;
  readonly rules: Readonly<Q2PlayerRules>;
  readonly entity: Pick<Q2Entity, "model" | "model2" | "model3" | "model4" | "skin" | "frame" | "oldFrame" | "scale" | "effects" | "renderFlags" | "flags" | "serverFlags" | "viewHeight" | "maxHealth" | "sound" | "visible">;
  readonly lastAttack: Q2AttackCheckpoint | null;
}
