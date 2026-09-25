import { isDeepStrictEqual } from "node:util";
import type { ModuleIdentity } from "../contracts/execution.ts";
import type { ProviderCheckpoint } from "../contracts/session.ts";
import type { WindowsCapabilities, WindowsFile } from "../guest/runtime/windows/contracts.ts";
import { readModule } from "./execution.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

export interface Q2ClassicOriginalIdentity { readonly module: ModuleIdentity; readonly map: string; }
export interface Q2ClassicLevelState {
  readonly configstrings: readonly { readonly index: number; readonly value: string }[];
  readonly portals: readonly { readonly portal: number; readonly open: boolean }[];
}
export interface Q2ClassicVisitedLevel extends Q2ClassicLevelState { readonly version: 1; readonly map: string; readonly level: Uint8Array; }
export interface Q2ClassicOriginalServerState extends Q2ClassicLevelState {
  /** Encoded complete cvar registry, restored before the fresh module Init call. */
  readonly cvars: Uint8Array;
}
/** Files written by the selected DLL's API 3 callbacks, not a suspended Windows process. */
export interface Q2ClassicOriginalSave extends Q2ClassicOriginalIdentity {
  readonly api: { readonly kind: "q2-classic-game"; readonly version: 3 };
  readonly abi: "windows-i386";
  readonly autosave: boolean;
  readonly server: Q2ClassicOriginalServerState;
  readonly game: Uint8Array;
  readonly level: Uint8Array;
  readonly visitedLevels: readonly Q2ClassicVisitedLevel[];
}

export function encodeQ2ClassicOriginalSave(save: Q2ClassicOriginalSave): ProviderCheckpoint {
  validate(save, save);
  return { provider: save.module.id, schema: "q2:classic-native-original", version: 1, bytes: encodeCheckpointValue(save) };
}
export function decodeQ2ClassicOriginalSave(record: ProviderCheckpoint, expected: Q2ClassicOriginalIdentity): Q2ClassicOriginalSave {
  if (record.schema !== "q2:classic-native-original" || record.version !== 1 || record.provider !== expected.module.id)
    throw new Error("Unsupported classic native source save provider");
  const reader = new SaveReader(decodeCheckpointValue(record.bytes), "q2.classic-native-original");
  const api = reader.field("api"); api.field("kind").literal("q2-classic-game"); api.field("version").literal(3);
  reader.field("abi").literal("windows-i386");
  const state = reader.field("server");
  const server: Q2ClassicOriginalServerState = { ...readLevelState(state), cvars: state.field("cvars").bytes() };
  const visits = reader.field("visitedLevels");
  const visitedLevels: readonly Q2ClassicVisitedLevel[] = visits.value === undefined ? [] : visits.list(entry => {
    entry.field("version").literal(1);
    return { version: 1, ...readLevelState(entry), map: entry.field("map").string(), level: entry.field("level").bytes() };
  });
  const save: Q2ClassicOriginalSave = { module: readModule(reader.field("module")), map: reader.field("map").string(),
    api: { kind: "q2-classic-game", version: 3 }, abi: "windows-i386", autosave: reader.field("autosave").boolean(), server,
    game: reader.field("game").bytes(), level: reader.field("level").bytes(), visitedLevels };
  validate(save, expected);
  return save;
}
function readLevelState(reader: SaveReader): Q2ClassicLevelState {
  return {
    configstrings: reader.field("configstrings").list(entry => ({ index: entry.field("index").integer(0), value: entry.field("value").string() })),
    portals: reader.field("portals").list(entry => ({ portal: entry.field("portal").integer(0), open: entry.field("open").boolean() })),
  };
}
function validateLevelState(state: Q2ClassicLevelState): void {
  if (new Set(state.configstrings.map(entry => entry.index)).size !== state.configstrings.length
    || new Set(state.portals.map(entry => entry.portal)).size !== state.portals.length
    || state.configstrings.some(entry => !Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= 2080)
    || state.portals.some(entry => !Number.isSafeInteger(entry.portal) || entry.portal < 0 || entry.portal >= 1024))
    throw new Error("Invalid classic native level metadata");
}
function validate(save: Q2ClassicOriginalSave, expected: Q2ClassicOriginalIdentity): void {
  if (!isDeepStrictEqual(save.module, expected.module) || save.map !== expected.map
    || save.api.kind !== "q2-classic-game" || save.api.version !== 3 || save.abi !== "windows-i386")
    throw new Error("Classic native save differs from the selected module, ABI or map");
  validateLevelState(save.server);
  if (save.server.cvars.length === 0) throw new Error("Invalid classic native server state");
  const visited = new Set<string>();
  for (const level of save.visitedLevels) {
    if (level.version !== 1 || !level.map.startsWith("maps/") || !level.map.endsWith(".bsp") || /[\x00-\x1f\x7f\\:]/.test(level.map) || level.map.length <= 9
      || level.map.split("/").some(part => part === "" || part === "." || part === "..")
      || level.map === save.map || visited.has(level.map) || level.level.length === 0)
      throw new Error("Invalid classic native visited level");
    validateLevelState(level); visited.add(level.map);
  }
  decodeCheckpointValue(save.server.cvars);
  if (save.game.length === 0 || save.level.length === 0) throw new Error("Classic native save requires both original files");
}

type OpenFile = NonNullable<WindowsCapabilities["openFile"]>;
interface Entry { bytes: Uint8Array; read: boolean; readonly handles: Set<WindowsFile>; }
interface Operation { readonly kind: "capture" | "restore" | "capture-level" | "restore-level"; readonly game: string; readonly level: string; readonly entries: Map<string, Entry>; }
const ROOT = "__qts_original_save/";

/** Only callback-owned save files enter this overlay; ordinary guest files keep their original owner. */
export class ClassicOriginalSaveFiles {
  private operation: Operation | null = null;
  constructor(private readonly fallback?: OpenFile) {}

  readonly openFile: OpenFile = (path, mode) => {
    const normalized = path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
    if (!normalized.startsWith(ROOT)) return this.fallback?.(path, mode) ?? null;
    const operation = this.operation;
    if (operation === null || normalized !== operation.game && normalized !== operation.level
      || (operation.kind === "capture-level" || operation.kind === "restore-level") && normalized !== operation.level)
      throw new Error("Native save file is outside the active callback operation");
    if (!Number.isInteger(mode.creation) || mode.creation < 1 || mode.creation > 5) throw new RangeError("Invalid native save file disposition");
    if ((operation.kind === "restore" || operation.kind === "restore-level") && (mode.write || mode.creation !== 3)) throw new Error("Original restore files are read-only");
    if (!mode.write && mode.creation !== 3) return null;
    let entry = operation.entries.get(normalized);
    if (mode.creation === 1 && entry !== undefined || (mode.creation === 3 || mode.creation === 5) && entry === undefined) return null;
    if (entry === undefined) {
      entry = { bytes: new Uint8Array(0), read: false, handles: new Set() };
      operation.entries.set(normalized, entry);
    }
    if (mode.creation === 2 || mode.creation === 5) entry.bytes = new Uint8Array(0);
    const owned = entry;
    let closed = false;
    const live = (): void => { if (closed || this.operation !== operation) throw new Error("Native save handle is retired"); };
    const range = (offset: number, length: number): number => {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length))
        throw new RangeError("Invalid native save file range");
      return offset + length;
    };
    const file: WindowsFile = {
      read: (offset, length) => { live(); if (!mode.read) throw new Error("Native save file is not readable"); range(offset, length); if (length > 0 && offset < owned.bytes.length) owned.read = true; return owned.bytes.slice(offset, offset + length); },
      write: (offset, bytes) => {
        live(); if (!mode.write) throw new Error("Native save file is not writable");
        const end = range(offset, bytes.length);
        if (end > owned.bytes.length) { const grown = new Uint8Array(end); grown.set(owned.bytes); owned.bytes = grown; }
        owned.bytes.set(bytes, offset); return bytes.length;
      },
      size: () => { live(); return owned.bytes.length; },
      truncate: length => {
        live(); if (!mode.write) throw new Error("Native save file is not writable"); range(length, 0);
        const resized = new Uint8Array(length); resized.set(owned.bytes.subarray(0, length)); owned.bytes = resized;
      },
      flush: () => { live(); },
      close: () => { closed = true; owned.handles.delete(file); },
    };
    owned.handles.add(file); return file;
  };

  capture(identity: Q2ClassicOriginalIdentity, serverState: () => Q2ClassicOriginalServerState, write: (gamePath: string, levelPath: string, autosave: boolean) => void,
    autosave = false): Q2ClassicOriginalSave {
    return this.run("capture", new Map<string, Uint8Array>(), (operation) => {
      write(operation.game, operation.level, autosave);
      this.assertClosed(operation);
      const game = operation.entries.get(operation.game), level = operation.entries.get(operation.level);
      if (game === undefined || level === undefined) throw new Error("Native save callbacks did not write both original files");
      const server = serverState();
      const result: Q2ClassicOriginalSave = { ...identity, module: { ...identity.module }, api: { kind: "q2-classic-game", version: 3 },
        abi: "windows-i386", autosave, server: { cvars: server.cvars.slice(), configstrings: server.configstrings.map(entry => ({ ...entry })),
          portals: server.portals.map(entry => ({ ...entry })) }, game: game.bytes.slice(), level: level.bytes.slice(), visitedLevels: [] };
      validate(result, identity); return result;
    });
  }

  restore(save: Q2ClassicOriginalSave, expected: Q2ClassicOriginalIdentity, read: (gamePath: string, levelPath: string) => void): void {
    validate(save, expected);
    this.run("restore", new Map([["game", save.game], ["level", save.level]]), operation => {
      read(operation.game, operation.level);
      this.assertClosed(operation);
      if ([...operation.entries.values()].some(entry => !entry.read)) throw new Error("Native restore callbacks did not consume both original files");
    });
  }
  async restoreLoading(save: Q2ClassicOriginalSave, expected: Q2ClassicOriginalIdentity, read: (gamePath: string, levelPath: string) => Promise<void>): Promise<void> {
    validate(save, expected);
    await this.runLoading("restore", new Map([["game", save.game], ["level", save.level]]), async operation => {
      await read(operation.game, operation.level);
      this.assertClosed(operation);
      if ([...operation.entries.values()].some(entry => !entry.read)) throw new Error("Native restore callbacks did not consume both original files");
    });
  }

  /** Normal gamemap retains the DLL and game globals; only departed level bytes are captured. */
  captureTravelLevel(write: (levelPath: string) => void): Uint8Array {
    return this.run("capture-level", new Map<string, Uint8Array>(), operation => {
      write(operation.level);
      this.assertClosed(operation);
      const level = operation.entries.get(operation.level);
      if (level === undefined || level.bytes.length === 0) throw new Error("Native travel callback did not write a level file");
      return level.bytes.slice();
    });
  }

  async captureTravelLevelLoading(write: (levelPath: string) => Promise<void>): Promise<Uint8Array> {
    return this.runLoading("capture-level", new Map<string, Uint8Array>(), async operation => {
      await write(operation.level);
      this.assertClosed(operation);
      const level = operation.entries.get(operation.level);
      if (level === undefined || level.bytes.length === 0) throw new Error("Native travel callback did not write a level file");
      return level.bytes.slice();
    });
  }

  /** The retained source owns SpawnEntities/ReadLevel ordering and engine metadata restoration. */
  withTravelLevel<T>(bytes: Uint8Array, read: (levelPath: string) => T): T {
    if (bytes.length === 0) throw new Error("Native travel requires original level bytes");
    return this.run("restore-level", new Map<string, Uint8Array>([["level", bytes]]), operation => {
      const result = read(operation.level);
      this.assertClosed(operation);
      if (operation.entries.get(operation.level)?.read !== true) throw new Error("Native travel callback did not consume the level file");
      return result;
    });
  }
  async withTravelLevelLoading<T>(bytes: Uint8Array, read: (levelPath: string) => Promise<T>): Promise<T> {
    if (bytes.length === 0) throw new Error("Native travel requires original level bytes");
    return this.runLoading("restore-level", new Map<string, Uint8Array>([["level", bytes]]), async operation => {
      const result = await read(operation.level);
      this.assertClosed(operation);
      if (operation.entries.get(operation.level)?.read !== true) throw new Error("Native travel callback did not consume the level file");
      return result;
    });
  }

  private assertClosed(operation: Operation): void {
    if ([...operation.entries.values()].some(entry => entry.handles.size !== 0)) throw new Error("Native save callback retained an open original file");
  }
  private run<T>(kind: Operation["kind"], bytes: ReadonlyMap<string, Uint8Array>, action: (operation: Operation) => T): T {
    if (this.operation !== null) throw new Error("Native save callbacks cannot overlap");
    const operation: Operation = { kind, game: `${ROOT}game.ssv`, level: `${ROOT}level.sav`, entries: new Map<string, Entry>() };
    for (const [key, data] of bytes) operation.entries.set(key === "game" ? operation.game : operation.level, { bytes: data.slice(), read: false, handles: new Set() });
    this.operation = operation;
    try { return action(operation); }
    finally {
      for (const entry of operation.entries.values()) for (const file of [...entry.handles]) file.close();
      this.operation = null;
    }
  }  private async runLoading<T>(kind: Operation["kind"], bytes: ReadonlyMap<string, Uint8Array>, action: (operation: Operation) => Promise<T>): Promise<T> {
    if (this.operation !== null) throw new Error("Native save callbacks cannot overlap");
    const operation: Operation = { kind, game: `${ROOT}game.ssv`, level: `${ROOT}level.sav`, entries: new Map<string, Entry>() };
    for (const [key, data] of bytes) operation.entries.set(key === "game" ? operation.game : operation.level, { bytes: data.slice(), read: false, handles: new Set() });
    this.operation = operation;
    try { return await action(operation); }
    finally {
      for (const entry of operation.entries.values()) for (const file of [...entry.handles]) file.close();
      this.operation = null;
    }
  }
}
