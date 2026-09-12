import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2WeaponInput, Q2WeaponState } from "./types.ts";

export interface Q2NoiseCheckpoint { readonly actor: SavedActorId; readonly origin: Vec3; readonly time: number; readonly secondary: boolean; }
export interface Q2WeaponsCheckpoint {
  readonly formatVersion: 2;
  readonly silencerCharges: readonly { readonly actor: SavedActorId; readonly charges: number }[];
  readonly sourceRules: "base" | "ctf" | "lmctf";
  readonly registered: readonly string[];
  readonly fallbackOrder: readonly string[] | null;
  readonly states: readonly { readonly actor: SavedActorId; readonly state: Readonly<Q2WeaponState> }[];
  readonly inputs: readonly { readonly actor: SavedActorId; readonly input: Q2WeaponInput }[];
  readonly noises: readonly { readonly actor: SavedActorId; readonly primary: Q2NoiseCheckpoint | null; readonly secondary: Q2NoiseCheckpoint | null }[];
  readonly soundEntity: Q2NoiseCheckpoint | null;
  readonly sound2Entity: Q2NoiseCheckpoint | null;
  readonly blasterCauses: readonly { readonly actor: SavedActorId; readonly meansOfDeath: number }[];
}
