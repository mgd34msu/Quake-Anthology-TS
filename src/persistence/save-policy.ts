// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSync, constants, openSync, writeSync, fsyncSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CommandContext } from "../contracts/common.ts";
import { containedFileParts, openContainedParent } from "../core/files/contained.ts";

export type SavePurpose = "manual" | "autosave" | "transition";
export interface SaveEligibility {
  readonly family: "q1" | "q2" | "q3";
  readonly authority: "offline" | "server" | "remote";
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  /** Server-administration saves (dedicated hosts, LMCTF referee) persist match state by design. */
  readonly matchSave?: boolean;
  readonly active: boolean;
  readonly intermission: boolean;
  readonly playerHealth: readonly number[];
}

/** Transition snapshots are internal world storage, never a user save slot. */
export function saveUnavailable(state: SaveEligibility, purpose: SavePurpose): string | null {
  if (!state.active) return "No active world to save.";
  if (purpose === "transition") return state.authority === "remote" ? "Only the authoritative world can retain transition state." : null;
  if (state.authority !== "offline") return "Save/load unavailable while hosting a network game.";
  if (state.family !== "q3" && state.mode === "deathmatch" && state.matchSave !== true) return "Cannot save a deathmatch game.";
  if (state.family !== "q3" && state.intermission && state.matchSave !== true) return "Cannot save during intermission.";
  // Server-administration saves persist world state even with no players in it.
  if (state.playerHealth.length === 0 && state.matchSave !== true) return "No active player to save.";
  if (state.family !== "q3" && state.matchSave !== true && state.playerHealth.some(health => !Number.isFinite(health) || health <= 0))
    return "Cannot save with a dead player.";
  return null;
}

export function saveCommandPath(directory: string, name: string): string {
  if (name.length === 0) throw new RangeError("Enter a save name or file path");
  return resolve(directory, extname(name) === "" ? `${name}.sav` : name);
}

/**
 * `load` of a file outside the save directory imports original saves, which id's engines refuse; the port keeps
 * it for the person at the local console. A script, a game or client module, or a remote client must not be able
 * to point the loader at an arbitrary file, so those sources are refused unless the operator turned the option on.
 */
export function assertLoadPathAllowed(
  directory: string,
  path: string,
  source: CommandContext | undefined,
  options: { readonly allowAnyPath: boolean; readonly trustedDirectories: readonly string[] },
): void {
  if (options.allowAnyPath) return;
  const inside = (root: string): boolean => {
    const name = relative(resolve(root), resolve(path));
    return !isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`);
  };
  if (inside(directory) || options.trustedDirectories.some(inside)) return;
  const origin = source?.origin;
  if (
    origin === undefined ||
    (source?.producer === undefined && (origin.kind === "local-console" || origin.kind === "server-console" || origin.kind === "local-seat"))
  )
    return;
  throw new RangeError(
    `load of a path outside the save directory is only accepted from the local console; start with --allow-load-paths to allow it from scripts, game modules and remote clients: ${resolve(path)}`,
  );
}

export function containedSaveName(directory: string, path: string): string {
  const name = relative(resolve(directory), resolve(path));
  if (isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`)) throw new RangeError(`Save path is outside the save directory: ${resolve(directory)}`);
  const parts = containedFileParts(name);
  if (parts.some(part => part.replace(/\.sav$/i, "").toLowerCase() === "current")) throw new RangeError("The current slot is reserved for transition state");
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
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    await rename(temporary, `/proc/self/fd/${parent.descriptor}/${parent.leaf}`);
    fsyncSync(parent.descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    try {
      await rm(temporary, { force: true });
    } finally {
      closeSync(parent.descriptor);
    }
  }
}
