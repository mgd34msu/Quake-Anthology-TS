import { closeSync, constants, openSync, writeSync, fsyncSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { containedFileParts, openContainedParent } from "../platform/files/contained.ts";

export type SavePurpose = "manual" | "autosave" | "transition";
export interface SaveEligibility {
  readonly family: "q1" | "q2" | "q3";
  readonly authority: "offline" | "server" | "remote";
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly active: boolean;
  readonly intermission: boolean;
  readonly playerHealth: readonly number[];
}

/** Transition snapshots are internal world storage, never a user save slot. */
export function saveUnavailable(state: SaveEligibility, purpose: SavePurpose): string | null {
  if (!state.active) return "No active world to save.";
  if (purpose === "transition") return state.authority === "remote" ? "Only the authoritative world can retain transition state." : null;
  if (state.authority !== "offline") return "Save/load unavailable during a network game.";
  if (state.family !== "q3" && state.mode === "deathmatch") return "Cannot save a deathmatch game.";
  if (state.family !== "q3" && state.intermission) return "Cannot save during intermission.";
  if (state.playerHealth.length === 0) return "No active player to save.";
  if (state.family !== "q3" && state.playerHealth.some(health => !Number.isFinite(health) || health <= 0)) return "Cannot save with a dead player.";
  return null;
}

export function containedSaveName(directory: string, path: string): string {
  const name = relative(resolve(directory), resolve(path));
  if (isAbsolute(name)) throw new RangeError("Save path is outside the save directory");
  const parts = containedFileParts(name);
  if (parts.some(part => part.replace(/\.sav$/i, "").toLowerCase() === "current"))
    throw new RangeError("The current slot is reserved for transition state");
  if (!name.toLowerCase().endsWith(".sav")) throw new RangeError("Save path must end in .sav");
  return name;
}

/** Commit through a held parent descriptor so directory replacement cannot redirect a save. */
export async function writeContainedSave(directory: string, path: string, bytes: Uint8Array): Promise<void> {
  const name = containedSaveName(directory, path);
  await mkdir(directory, { recursive: true });
  const parent = openContainedParent(directory, name, true);
  const temporary = `/proc/self/fd/${parent.descriptor}/.${parent.leaf}.${crypto.randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let position = 0;
    while (position < bytes.length) {
      const count = writeSync(descriptor, bytes, position, bytes.length - position);
      if (count === 0) throw new Error("Save write made no progress");
      position += count;
    }
    fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    await rename(temporary, `/proc/self/fd/${parent.descriptor}/${parent.leaf}`);
    fsyncSync(parent.descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    try { await rm(temporary, { force: true }); } finally { closeSync(parent.descriptor); }
  }
}

/** Elapsed playable time, with one outstanding request and no catch-up burst. */
export class TimedAutosave {
  private elapsed = 0;
  private pending = false;
  constructor(readonly intervalMilliseconds: number) {
    if (!Number.isFinite(intervalMilliseconds) || intervalMilliseconds <= 0) throw new RangeError("Autosave interval must be positive");
  }
  advance(milliseconds: number, eligible: boolean): boolean {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Autosave elapsed time must be nonnegative");
    if (!eligible || this.pending) return false;
    this.elapsed = Math.min(this.intervalMilliseconds, this.elapsed + milliseconds);
    if (this.elapsed < this.intervalMilliseconds) return false;
    this.pending = true;
    return true;
  }
  /** Both success and failure wait a full interval before another attempt. */
  completed(): void { this.elapsed = 0; this.pending = false; }
  worldChanged(): void { this.completed(); }
}
