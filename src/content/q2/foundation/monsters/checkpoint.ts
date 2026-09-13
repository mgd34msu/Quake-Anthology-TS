import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { DeathReaction } from "../../../../contracts/world.ts";
import type { Q2AttackCheckpoint } from "../checkpoint.ts";
import type { MonsterState } from "./types.ts";

export interface Q2MonsterStateCheckpoint extends Omit<MonsterState, "move" | "nextMove" | "soundTarget" | "oldEnemy" | "moveTarget" | "commander"> {
  readonly move: string;
  readonly nextMove: string | null;
  readonly soundTarget: { readonly actor: SavedActorId; readonly owner: SavedActorId; readonly origin: Vec3; readonly time: number } | null;
  readonly oldEnemy: SavedActorId | null;
  readonly moveTarget: SavedActorId | null;
  readonly commander: SavedActorId | null;
}
export interface Q2MonsterDamageCheckpoint {
  readonly reaction: Omit<DeathReaction, "self" | "attacker" | "inflictor" | "attack"> & { readonly attacker: SavedActorId | null; readonly inflictor: SavedActorId | null };
  readonly attack: Q2AttackCheckpoint | null;
}
interface SavedSighting { readonly actor: SavedActorId; readonly time: number; }
interface SavedNoise extends SavedSighting { readonly owner: SavedActorId; readonly origin: Vec3; }
export interface Q2MonsterPerceptionCheckpoint {
  readonly sightClient: SavedActorId | null;
  readonly sight: SavedSighting | null;
  readonly alerted: readonly { readonly actor: SavedActorId; readonly sighting: SavedSighting }[];
  readonly primary: SavedNoise | null;
  readonly secondary: SavedNoise | null;
  readonly noises: readonly { readonly actor: SavedActorId; readonly primary: SavedActorId; readonly secondary: SavedActorId }[];
  readonly trails: readonly { readonly actor: SavedActorId; readonly points: readonly { readonly origin: Vec3; readonly time: number; readonly yaw: number }[] }[];
  readonly playerOrigins: readonly { readonly actor: SavedActorId; readonly origin: Vec3 }[];
  readonly hostile: readonly { readonly actor: SavedActorId; readonly time: number }[];
  readonly lastFrame: number | null;
}
export interface Q2MonstersCheckpoint {
  readonly version: 1;
  readonly actors: readonly { readonly actor: SavedActorId; readonly definition: string; readonly state: Q2MonsterStateCheckpoint; readonly pendingDamage: Q2MonsterDamageCheckpoint | null }[];
  readonly perception: Q2MonsterPerceptionCheckpoint;
}
