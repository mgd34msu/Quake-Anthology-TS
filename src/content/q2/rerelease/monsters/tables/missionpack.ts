// SPDX-License-Identifier: GPL-2.0-or-later
// Per-frame callbacks of the mission pack monsters as stored in the rerelease game DLL (game_x64.dll). The 1998 Xatrix and Rogue
// tables the port plays for these monsters carry the same distances and animation frames, but the rerelease DLL adds footsteps and
// drops or moves several callbacks. Every entry below was read from the shipped mmove_t (first/last frame, frame array, endfunc)
// and its think pointers were matched to the port's callbacks by function body or by the identical callback in another table;
// tests/content/q2/rerelease-missionpack-moves.test.ts re-reads the DLL and checks each entry. The gekk's two underwater moves differ in
// frame range as well, so they are replaced whole.
import type { MonsterFrame, MonsterMove } from "../../../foundation/monsters/types.ts";

export interface RereleaseMoveCallbacks {
  /** Port move name. */
  readonly move: string;
  /** Callback of each frame that has one in the DLL; every other frame has none. */
  readonly callbacks: Readonly<Record<number, string>>;
  /** Replaces the move's end function when present (null for none). */
  readonly end?: string | null;
}

const step = "monster_footstep";
export const rereleaseMissionPackCallbacks: Readonly<Record<string, readonly RereleaseMoveCallbacks[]>> = {
  monster_gekk: [{ move: "gekk_move_death1", callbacks: { 5: "gekk_shrink" } }],
  monster_fixbot: [{ move: "fixbot_move_stand2", callbacks: { 18: "change_to_roam" } }],
  monster_stalker: [
    { move: "stalker_move_run", callbacks: { 0: step, 2: step } },
    { move: "stalker_move_walk", callbacks: { 0: step, 4: step } },
    { move: "stalker_move_false_death_end", callbacks: { 3: step } },
    { move: "stalker_move_swing_l", callbacks: { 3: step, 4: "stalker_swing_attack", 7: step } },
    { move: "stalker_move_swing_r", callbacks: { 1: step, 2: "stalker_swing_attack", 4: step } },
    { move: "stalker_move_jump_straightup", callbacks: { 0: "stalker_jump_straightup", 1: "stalker_jump_wait_land", 2: step } },
    { move: "stalker_move_jump_up", callbacks: { 4: "stalker_jump_up", 5: "stalker_jump_wait_land", 6: step } },
    { move: "stalker_move_jump_down", callbacks: { 4: "stalker_jump_down", 5: "stalker_jump_wait_land", 6: step } },
    { move: "stalker_move_death", callbacks: { 8: step } },
  ],
  monster_daedalus: [
    { move: "hover_move_death1", callbacks: { 1: "hover_dying", 3: "hover_dying", 5: "hover_dying", 6: "hover_dying", 8: "hover_dying", 9: "hover_dying" } },
  ],
  monster_carrier: [
    { move: "carrier_move_death", callbacks: { 0: "BossExplode" } },
    {
      move: "carrier_move_spawn",
      callbacks: { 6: "carrier_prep_spawn", 7: "carrier_start_spawn", 8: "carrier_ready_spawn", 11: "carrier_spawn_check" },
      end: "carrier_run",
    },
  ],
  monster_widow2: [
    { move: "widow2_move_walk", callbacks: { 0: "widow2_step", 5: "widow2_step" } },
    { move: "widow2_move_run", callbacks: { 0: "widow2_step", 5: "widow2_step" } },
    { move: "widow2_move_attack_pre_beam", callbacks: { 1: "widow2_step", 3: "widow2_attack_beam" } },
  ],
};

/** The gekk swims and stands underwater on gekk_move_swim_start's frames 291-322 and distances (0x146e08, 0x146da8, 0x147098), with no per-frame callbacks. */
const gekkSwimDistances: readonly number[] = [
  14, 14, 14, 14, 16, 16, 16, 18, 18, 18, 20, 20, 22, 22, 24, 24, 26, 26, 24, 24, 22, 22, 22, 22, 22, 22, 22, 22, 18, 18, 18, 18,
];
const gekkSwimFrames = (ai: MonsterFrame["ai"]): readonly MonsterFrame[] => gekkSwimDistances.map(distance => ({ ai, distance, actions: [], lerpFrame: -1 }));

/** Moves whose animation range differs from the classic table, replaced whole by name. */
export const rereleaseMissionPackReplacements: Readonly<Record<string, readonly MonsterMove[]>> = {
  monster_gekk: [
    { name: "gekk_move_swim_loop", firstFrame: 291, lastFrame: 322, end: "gekk_swim_loop", sidestepScale: 0, frames: gekkSwimFrames("run") },
    {
      name: "gekk_move_standunderwater",
      firstFrame: 291,
      lastFrame: 322,
      end: null,
      sidestepScale: 0,
      frames: gekkSwimFrames({ kind: "source", name: "ai_stand2" }),
    },
  ],
};

/** The classic move list with the rerelease DLL's callbacks substituted for the monster's moves that differ. */
export function rereleaseMissionPackMoves(classname: string, moves: readonly MonsterMove[]): readonly MonsterMove[] {
  const specs = rereleaseMissionPackCallbacks[classname],
    replacements = rereleaseMissionPackReplacements[classname];
  if (specs === undefined && replacements === undefined) return moves;
  return moves.map(move => {
    const replacement = replacements?.find(candidate => candidate.name === move.name);
    if (replacement !== undefined) return replacement;
    const spec = specs?.find(candidate => candidate.move === move.name);
    if (spec === undefined) return move;
    return {
      ...move,
      end: spec.end === undefined ? move.end : spec.end,
      frames: move.frames.map((frame, index) => ({ ...frame, actions: spec.callbacks[index] === undefined ? [] : [spec.callbacks[index]] })),
    };
  });
}
