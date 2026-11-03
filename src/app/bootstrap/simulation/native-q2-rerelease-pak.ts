// SPDX-License-Identifier: GPL-2.0-or-later
// A rerelease Quake II native save as the Nightdive engine keeps it: `saveN.pak.gz`, a gzip PACK holding `game.ssv`
// (the game module's WriteGameJson), `server.ssv` ("EVAS" binary), and for every level of the unit `MAP.sav`
// (WriteLevelJson) with `MAP.sv2` (configstrings and area portal state). The engine builds the pak from the same
// `save/current/` working folder id's engine used; its strings name `save/{}/{}.sav`, `save/{}/{}.sv2` and
// `{}/save/{}.pak.gz`.
import type { RereleaseSourceSave } from "../../../compat/q2/rerelease/host.ts";
import { packKexQ2SaveArchive, type KexQ2SaveArchive } from "../../../persistence/kex-q2-save.ts";
import {
  decodeQ2RereleaseLevelMetadata,
  encodeQ2RereleaseLevelMetadata,
  encodeQ2RereleaseServer,
  rereleasePortalBytes,
  rereleasePortalsFrom,
  type Q2LevelMetadata,
} from "../../../persistence/q2-containers.ts";
import { parseQ2MapCommand, q2LatchedCvars, q2LevelName, q2MapCommand, q2SaveSlotName } from "../../../persistence/q2-save-folder.ts";
import { SaveFormatError } from "../../../persistence/value.ts";
import { readRereleaseSourceSave, type Q2RereleaseNativeImport, type Q2RereleaseNativeSave, type Q2RereleaseVisitedLevel } from "./native-q2-rerelease-save.ts";
import { SaveReader } from "../../../persistence/value.ts";

export interface Q2RereleasePakContext {
  readonly spawnPoint: string;
  readonly now: Date;
  /** The area portal count of a map, which the engine compares with its own when it reads the level file. */
  portalCount(map: string): number | Promise<number>;
}

/** The slot that the engine writes an autosave to; a cooperative game keeps its own. */
export function rereleaseAutosaveName(coop: boolean): string {
  return coop ? "coop_save0" : "save0";
}
export function rereleaseSlotName(name: string): string {
  return q2SaveSlotName(name.replace(/\.pak\.gz$/i, ""));
}

function sourceJson(source: RereleaseSourceSave): Uint8Array {
  return source.native;
}
async function levelEntries(
  map: string,
  level: RereleaseSourceSave,
  state: Pick<Q2RereleaseVisitedLevel, "configstrings" | "portals">,
  context: Q2RereleasePakContext,
): Promise<[string, Uint8Array][]> {
  const name = q2LevelName(map);
  const metadata: Q2LevelMetadata = {
    configstrings: state.configstrings,
    portalBytes: rereleasePortalBytes(state.portals, await context.portalCount(map)),
  };
  return [
    [`${name}.sav`, sourceJson(level)],
    [`${name}.sv2`, encodeQ2RereleaseLevelMetadata(metadata)],
  ];
}

/** The pak a rerelease save is stored as. */
export async function q2RereleasePak(save: Q2RereleaseNativeSave, context: Q2RereleasePakContext): Promise<Uint8Array> {
  const entries = await q2RereleasePakEntries(save, context);
  return packKexQ2SaveArchive(entries);
}
/** The archive's entries before packing, which is also what the sidecar's digest covers. */
export async function q2RereleasePakEntries(save: Q2RereleaseNativeSave, context: Q2RereleasePakContext): Promise<[string, Uint8Array][]> {
  const levelName = q2LevelName(save.map),
    cvars = q2LatchedCvars(save.server.cvars, "q2-rerelease");
  const comment = save.server.configstrings.find(entry => entry.index === 0)?.value ?? levelName;
  const server = encodeQ2RereleaseServer({
    timestamp: BigInt(Math.floor(context.now.getTime() / 1000)),
    kind: save.autosave ? 1 : 0,
    comment,
    mapCommand: q2MapCommand(save.map, context.spawnPoint),
    cvars,
  });
  const entries: [string, Uint8Array][] = [
    ["game.ssv", sourceJson(save.game)],
    ["server.ssv", server],
  ];
  if (save.level !== null) entries.push(...(await levelEntries(save.map, save.level, save.server, context)));
  for (const visited of save.visitedLevels) entries.push(...(await levelEntries(visited.map, visited.level, visited, context)));
  return entries;
}

function pair(archive: KexQ2SaveArchive, name: string): { readonly level: Uint8Array; readonly metadata: Q2LevelMetadata } {
  const level = archive.entries.get(`${name.toLowerCase()}.sav`),
    metadata = archive.entries.get(`${name.toLowerCase()}.sv2`);
  if (level === undefined || metadata === undefined) throw new SaveFormatError("q2-kex", `level ${name} needs both its .sav and .sv2 entries`);
  return { level, metadata: decodeQ2RereleaseLevelMetadata(metadata) };
}
function source(bytes: Uint8Array): RereleaseSourceSave {
  return readRereleaseSourceSave(new SaveReader({ native: bytes, deferredDamage: [], projections: [] }, "q2-kex.json"));
}
/**
 * Everything a retail pak holds. Entries beginning with a dot are the engine's map-restart backup and are not part of
 * the saved game; any other entry that is not a `.sav` and `.sv2` pair, game.ssv or server.ssv is refused.
 */
export function readQ2RereleasePak(archive: KexQ2SaveArchive): Q2RereleaseNativeImport {
  const gameBytes = archive.entries.get("game.ssv");
  if (gameBytes === undefined) throw new SaveFormatError("q2-kex", "save archive has no game.ssv");
  const resume = parseQ2MapCommand(archive.server.mapCommand),
    resumeName = resume.map.replace(/^maps\//, "").replace(/\.bsp$/, "");
  const stems = new Set<string>();
  for (const name of archive.files) {
    if (name === "game.ssv" || name === "server.ssv" || name.startsWith(".")) continue;
    const match = /^(.+)\.(sav|sv2)$/.exec(name);
    if (match === null || match[1] === undefined) throw new SaveFormatError("q2-kex", `save archive holds an unknown entry ${name}`);
    stems.add(match[1]);
  }
  const visitedLevels: Q2RereleaseVisitedLevel[] = [];
  let current: ReturnType<typeof pair> | undefined;
  for (const stem of [...stems].sort()) {
    const entry = pair(archive, stem);
    if (stem === resumeName.toLowerCase()) current = entry;
    else
      visitedLevels.push({
        version: 1,
        map: `maps/${stem}.bsp`,
        level: source(entry.level),
        configstrings: entry.metadata.configstrings,
        portals: rereleasePortalsFrom(entry.metadata.portalBytes),
      });
  }
  return {
    map: resume.map,
    spawnPoint: resume.spawnPoint,
    autosave: archive.server.kind === 1,
    server: {
      latched: archive.server.cvars,
      configstrings: current === undefined ? [] : current.metadata.configstrings,
      portals: current === undefined ? [] : rereleasePortalsFrom(current.metadata.portalBytes),
    },
    game: source(gameBytes),
    level: current === undefined ? null : source(current.level),
    visitedLevels,
  };
}
