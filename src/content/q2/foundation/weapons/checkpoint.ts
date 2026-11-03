// SPDX-License-Identifier: GPL-2.0-or-later
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2WeaponInput, Q2WeaponState } from "./types.ts";

export interface Q2WeaponsCheckpoint {
  readonly formatVersion: 3;
  readonly silencerCharges: readonly { readonly actor: SavedActorId; readonly charges: number }[];
  readonly sourceRules: "base" | "ctf" | "lmctf";
  readonly registered: readonly string[];
  readonly fallbackOrder: readonly string[] | null;
  readonly states: readonly { readonly actor: SavedActorId; readonly state: Readonly<Q2WeaponState> }[];
  readonly inputs: readonly { readonly actor: SavedActorId; readonly input: Q2WeaponInput }[];
  readonly blasterCauses: readonly { readonly actor: SavedActorId; readonly meansOfDeath: number }[];
}
