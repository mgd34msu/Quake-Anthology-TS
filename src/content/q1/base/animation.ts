/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
export type MonsterAi = "stand" | "walk" | "run" | "charge_side" | "melee_side" | "charge" | "melee" | "painforward" | "turn" | "face" | "pain" | "forward";
export type MonsterOperation =
  | { readonly kind: "ai"; readonly mode: MonsterAi; readonly distance: number }
  | { readonly kind: "sound"; readonly path: string; readonly channel: "voice" | "weapon" | "body"; readonly attenuation: number; readonly comparison: "greater" | "less"; readonly chance: number | null }
  | { readonly kind: "solid"; readonly solid: "none" }
  | { readonly kind: "lightstyle"; readonly pattern: string }
  | { readonly kind: "action"; readonly name: string };
export interface MonsterFrame {
  readonly frame: number;
  readonly next: string;
  readonly operations: readonly MonsterOperation[];
}
