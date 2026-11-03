// SPDX-License-Identifier: GPL-2.0-or-later
// A Quake II save as the original game keeps it: `save/NAME/` holding `server.ssv`, `game.ssv` and, for every level of
// the unit, `MAP.sav` (the game module's WriteLevel output) and `MAP.sv2` (configstrings and portal state).
// Follows id Quake II 3.20 sv_ccmds.c: SV_WriteServerFile, SV_WriteLevelFile, SV_ReadServerFile, SV_ReadLevelFile.
import { CvarRegistry, Q2CvarFlag } from "../core/cvars/index.ts";
import { createIdentityOwner } from "../contracts/identity.ts";
import type { CommandDialect } from "../contracts/common.ts";
import {
  classicPortalBytes,
  classicPortalsFrom,
  decodeQ2ClassicLevelMetadata,
  decodeQ2ClassicServer,
  encodeQ2ClassicLevelMetadata,
  encodeQ2ClassicServer,
  type SavedCvar,
} from "./q2-containers.ts";
import type { Q2ClassicOriginalImport, Q2ClassicOriginalSave, Q2ClassicVisitedLevel } from "./q2-classic-guest.ts";
import { decodeCheckpointValue, SaveFormatError } from "./value.ts";

/** A save folder's files by exact name. */
export type Q2SaveFiles = ReadonlyMap<string, Uint8Array>;

/** CS_NAME: the level's display name, which the original puts in the save slot's comment. */
const CS_NAME = 0;
/** SV_WriteServerFile's comment buffer is 32 bytes, NUL included. */
const COMMENT_BYTES = 32;
const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** The folder and file names the original builds from a map path. */
export function q2LevelName(map: string): string {
  const name = map.replace(/^maps\//, "").replace(/\.bsp$/i, "");
  if (!NAME_PATTERN.test(name)) throw new SaveFormatError("q2.save", `map ${map} cannot be named in a save folder`);
  return name;
}
/** A save slot name the original accepts: `Bad savedir.` for "..", "/" and "\", and `current` is the working folder. */
export function q2SaveSlotName(name: string): string {
  const slot = name.replace(/\.sav$/i, "");
  if (slot.length === 0 || slot.length > 64 || /\.\.|[\\/:*?"<>|\0]/.test(slot)) throw new SaveFormatError("q2.save", "Bad savedir.");
  if (slot.toLowerCase() === "current") throw new SaveFormatError("q2.save", "Can't save to 'current'");
  return slot;
}

/** `mapname`, `*mapname` or `mapname$spawnpoint` as `svs.mapcmd` holds them. */
export function parseQ2MapCommand(command: string): { readonly map: string; readonly spawnPoint: string } {
  const text = command.replace(/^\*/, "");
  const dollar = text.indexOf("$");
  const map = dollar < 0 ? text : text.slice(0, dollar);
  if (map.includes("+") || !NAME_PATTERN.test(map)) throw new SaveFormatError("q2.save", `save names an unsupported map command: ${command}`);
  return { map: `maps/${map}.bsp`, spawnPoint: dollar < 0 ? "" : text.slice(dollar + 1) };
}
export function q2MapCommand(map: string, spawnPoint: string): string {
  return spawnPoint === "" ? q2LevelName(map) : `${q2LevelName(map)}$${spawnPoint}`;
}

function scratchRegistry(dialect: CommandDialect): CvarRegistry {
  return new CvarRegistry({ dialect, context: { session: createIdentityOwner("q2-save-cvars").session, origin: { kind: "server-console" } } });
}
/**
 * The cvars SV_WriteServerFile records: every CVAR_LATCH variable (skill, coop, deathmatch, maxclients and whatever the
 * game module latched), newest registration first, which is the order of the original's cvar list.
 */
export function q2LatchedCvars(registry: Uint8Array, dialect: CommandDialect): readonly SavedCvar[] {
  const scratch = scratchRegistry(dialect);
  scratch.restoreSaveState(decodeCheckpointValue(registry));
  return scratch.canonicalSnapshots(Q2CvarFlag.Latch).map(variable => ({ name: variable.name, value: variable.value }));
}
function twoDigit(value: number): string {
  return String(value).padStart(2, " ");
}
/** `"%2i:%i%i %2i/%2i  "` and the level name; an autosave reads `ENTERING name`. */
export function q2SaveComment(levelName: string, autosave: boolean, now: Date): string {
  const text = autosave
    ? `ENTERING ${levelName}`
    : `${twoDigit(now.getHours())}:${Math.trunc(now.getMinutes() / 10)}${now.getMinutes() % 10} ${twoDigit(now.getMonth() + 1)}/${twoDigit(now.getDate())}  ${levelName}`;
  return text.slice(0, COMMENT_BYTES - 1);
}

export interface Q2ClassicFolderContext {
  /** The map command to resume from: the current map and its spawn point. */
  readonly mapCommand: string;
  readonly now: Date;
}

function levelFiles(files: Map<string, Uint8Array>, map: string, level: Uint8Array, state: Pick<Q2ClassicVisitedLevel, "configstrings" | "portals">): void {
  const name = q2LevelName(map);
  files.set(`${name}.sav`, level);
  files.set(`${name}.sv2`, encodeQ2ClassicLevelMetadata({ configstrings: state.configstrings, portalBytes: classicPortalBytes(state.portals) }));
}
/**
 * SV_WriteServerFile plus the per-level files of `current/`. An autosave taken on entering a level carries no file for
 * that level, because the original has not written one yet.
 */
export function q2ClassicFolder(save: Q2ClassicOriginalSave, context: Q2ClassicFolderContext): Q2SaveFiles {
  const files = new Map<string, Uint8Array>();
  const dialect: CommandDialect = "q2-classic";
  const comment = q2SaveComment(save.server.configstrings.find(entry => entry.index === CS_NAME)?.value ?? "", save.autosave, context.now);
  files.set(
    "server.ssv",
    encodeQ2ClassicServer({ comment, mapCommand: context.mapCommand, cvars: q2LatchedCvars(save.server.cvars, dialect).filter(fitsClassicCvar) }),
  );
  files.set("game.ssv", save.game);
  if (save.level !== null) levelFiles(files, save.map, save.level, save.server);
  for (const visited of save.visitedLevels) levelFiles(files, visited.map, visited.level, visited);
  return files;
}
/** SV_WriteServerFile prints `Cvar too long` and skips a pair that does not fit its 128 byte fields. */
function fitsClassicCvar(cvar: SavedCvar): boolean {
  return cvar.name.length < 127 && cvar.value.length < 127;
}

function fileKey(files: Q2SaveFiles, wanted: string): string | undefined {
  for (const name of files.keys()) if (name.toLowerCase() === wanted.toLowerCase()) return name;
  return undefined;
}
/**
 * Everything a loaded folder holds, bound to the map its `server.ssv` resumes. The level of that map is absent for an
 * autosave taken on entering it; every other `.sav` is a visited level whose `.sv2` must accompany it.
 */
export function readQ2ClassicFolder(files: Q2SaveFiles): Q2ClassicOriginalImport {
  const serverName = fileKey(files, "server.ssv"),
    gameName = fileKey(files, "game.ssv");
  const serverBytes = serverName === undefined ? undefined : files.get(serverName),
    game = gameName === undefined ? undefined : files.get(gameName);
  if (serverBytes === undefined) throw new SaveFormatError("q2.save", "save folder has no server.ssv");
  if (game === undefined || game.length === 0) throw new SaveFormatError("q2.save", "save folder has no game.ssv");
  const server = decodeQ2ClassicServer(serverBytes),
    resume = parseQ2MapCommand(server.mapCommand);
  const levels = new Map<string, { name: string; level: Uint8Array; metadata: ReturnType<typeof decodeQ2ClassicLevelMetadata> }>();
  for (const [name, bytes] of files) {
    if (!/\.sav$/i.test(name)) continue;
    const stem = name.slice(0, -4),
      metadataName = fileKey(files, `${stem}.sv2`),
      metadata = metadataName === undefined ? undefined : files.get(metadataName);
    if (metadata === undefined) throw new SaveFormatError("q2.save", `${name} has no ${stem}.sv2`);
    if (bytes.length === 0) throw new SaveFormatError("q2.save", `${name} is empty`);
    levels.set(q2LevelName(stem).toLowerCase(), { name: stem, level: bytes, metadata: decodeQ2ClassicLevelMetadata(metadata) });
  }
  const resumeName = resume.map.replace(/^maps\//, "").replace(/\.bsp$/, "");
  const current = levels.get(resumeName.toLowerCase());
  levels.delete(resumeName.toLowerCase());
  const visitedLevels = [...levels.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (entry): Q2ClassicVisitedLevel => ({
        version: 1,
        map: `maps/${entry.name}.bsp`,
        level: entry.level,
        configstrings: entry.metadata.configstrings,
        portals: classicPortalsFrom(entry.metadata.portalBytes),
      }),
    );
  return {
    map: resume.map,
    spawnPoint: resume.spawnPoint,
    // The original records the autosave as a flag inside game.ssv; the comment is how its menu tells the two apart.
    autosave: server.comment.startsWith("ENTERING "),
    server: {
      latched: server.cvars,
      configstrings: current === undefined ? [] : current.metadata.configstrings,
      portals: current === undefined ? [] : classicPortalsFrom(current.metadata.portalBytes),
    },
    game,
    level: current === undefined ? null : current.level,
    visitedLevels,
  };
}

/** The folder's header for a list: the slot comment and the map it resumes. */
export function q2ClassicFolderHeader(serverBytes: Uint8Array): {
  readonly comment: string;
  readonly map: string;
  readonly spawnPoint: string;
  readonly autosave: boolean;
} {
  const server = decodeQ2ClassicServer(serverBytes),
    resume = parseQ2MapCommand(server.mapCommand);
  return { comment: server.comment, map: resume.map, spawnPoint: resume.spawnPoint, autosave: server.comment.startsWith("ENTERING ") };
}

/**
 * Identity of a set of original files, so an engine-format sidecar can say which files it was written beside. File
 * names are compared without case, as the original's file system does.
 */
export function q2FilesDigest(files: Q2SaveFiles): Uint8Array {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const name of [...files.keys()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))) {
    const bytes = files.get(name);
    if (bytes === undefined) continue;
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.length, true);
    hasher.update(name.toLowerCase());
    hasher.update(new Uint8Array(1));
    hasher.update(header);
    hasher.update(bytes);
  }
  return new Uint8Array(hasher.digest());
}
