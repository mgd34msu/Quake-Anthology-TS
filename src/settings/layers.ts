// SPDX-License-Identifier: GPL-2.0-or-later
import { ConfigStore } from "./config.ts";
import { settingFor, spellingIn, toCanonical, type LayerFormat } from "./setting-spellings.ts";

export type { LayerFormat };

/**
 * Settings layering. The high level is the engine's own configuration and the default for every game: bindings and
 * the shared settings, stored under the canonical cvar names declared in core/cvars/setting-declarations.ts. Each game's native file
 * is a lower level that receives the full effective set, so the original game would see the complete configuration.
 * Precedence, highest first:
 *   1. the game's local overrides (hand-edits to its native file, `bind -local`, `unbind -local`, `set -local`);
 *   2. the high level;
 *   3. the game's own default.cfg and cvar defaults, which sit beneath both.
 */

const finite = (value: string): number | null => {
  const number = value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
};

export interface LayerBind {
  readonly key: string;
  /** Null unbinds the key in this layer. */
  readonly command: string | null;
}
export interface LayerCvar {
  readonly name: string;
  readonly value: string;
}

/** What the engine knows of a game's native file, in the engine's own spelling of keys and commands. */
export interface LayerSnapshot {
  readonly binds: ReadonlyMap<string, LayerBind>;
  readonly cvars: ReadonlyMap<string, LayerCvar>;
}

export interface HighLevel {
  /** Canonical cvar name to canonical value. */
  settings: Map<string, string>;
  /** A null command is an unbind that applies to every game. */
  binds: Map<string, LayerBind>;
}
export interface GameOverrides {
  binds: Map<string, LayerBind>;
  cvars: Map<string, LayerCvar>;
}

export interface EffectiveSet {
  /** Bound keys only. */
  readonly binds: readonly LayerBind[];
  /** Keys a layer unbinds, which cancels a binding from the game's default.cfg. */
  readonly unbound: readonly LayerBind[];
  /** Canonical settings this game has: the high level, then the game's overrides. */
  readonly cvars: ReadonlyMap<string, LayerCvar>;
}

const fold = (key: string): string => key.toLowerCase();

/** The full effective set for one game: high level mapped, then the game's real overrides. */
export function effectiveSet(format: LayerFormat, high: HighLevel, overrides: GameOverrides): EffectiveSet {
  const binds = new Map<string, LayerBind>();
  for (const [key, bind] of high.binds) binds.set(key, bind);
  for (const [key, bind] of overrides.binds) binds.set(key, bind);
  const cvars = new Map<string, LayerCvar>();
  for (const [name, value] of high.settings) if (spellingIn(format, name) !== null) cvars.set(name, { name, value });
  for (const [name, cvar] of overrides.cvars) if (spellingIn(format, name) !== null) cvars.set(name, cvar);
  const all = [...binds.values()];
  return { binds: all.filter(bind => bind.command !== null), unbound: all.filter(bind => bind.command === null), cvars };
}

/** Whether two cvar values are the same setting: numerically equal when both are numbers. */
export function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  const x = finite(a),
    y = finite(b);
  return x !== null && y !== null && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
}

export function emptyHigh(): HighLevel {
  return { settings: new Map<string, string>(), binds: new Map<string, LayerBind>() };
}
export function emptyOverrides(): GameOverrides {
  return { binds: new Map<string, LayerBind>(), cvars: new Map<string, LayerCvar>() };
}

/** What the engine last wrote to a game's native file; hand-edits are differences from it. */
export interface WrittenRecord {
  readonly binds: ReadonlyMap<string, string>;
  readonly cvars: ReadonlyMap<string, string>;
}

function commandOf(snapshot: LayerSnapshot, key: string): string | null {
  return snapshot.binds.get(key)?.command ?? null;
}

/**
 * Fold the differences between a game's native file and what the engine last wrote into the game's overrides. A
 * difference that the effective set below the overrides already says is no override; a difference that comes back to
 * it removes the override.
 */
export function detectHandEdits(format: LayerFormat, file: LayerSnapshot, record: WrittenRecord, high: HighLevel, overrides: GameOverrides): boolean {
  let changed = false;
  const base = effectiveSet(format, high, emptyOverrides());
  const baseBinds = new Map(base.binds.map(bind => [fold(bind.key), bind]));
  const keys = new Set([...file.binds.keys(), ...record.binds.keys()]);
  for (const key of keys) {
    const now = commandOf(file, key);
    if (now === (record.binds.get(key) ?? null)) continue;
    const below = baseBinds.get(key)?.command ?? null;
    if (now === below) {
      changed = overrides.binds.delete(key) || changed;
    } else {
      overrides.binds.set(key, { key: file.binds.get(key)?.key ?? key, command: now });
      changed = true;
    }
  }
  for (const [name, entry] of file.cvars) {
    if (spellingIn(format, name) === null) continue;
    const written = record.cvars.get(name);
    if (written !== undefined && sameValue(written, entry.value)) continue;
    const below = base.cvars.get(name)?.value;
    if (below !== undefined && sameValue(below, entry.value)) {
      changed = overrides.cvars.delete(name) || changed;
    } else {
      overrides.cvars.set(name, entry);
      changed = true;
    }
  }
  return changed;
}

/** Seed an empty high level from the first native file the engine meets, so existing bindings and settings become the shared defaults. */
export function seedHigh(format: LayerFormat, file: LayerSnapshot): HighLevel {
  const high = emptyHigh();
  for (const [key, bind] of file.binds) if (bind.command !== null) high.binds.set(key, bind);
  for (const [name, entry] of file.cvars) if (spellingIn(format, name) !== null) high.settings.set(name, entry.value);
  return high;
}

export interface AbsorbContext {
  /** The bindings the game's default.cfg gave; they sit beneath the high level and are not the user's decisions. */
  readonly defaultBinds: ReadonlyMap<string, LayerBind>;
  /** The game's reset value for a canonical setting, or undefined when it has none. */
  readonly resetValue: (name: string) => string | undefined;
  /** Keys the player chose to keep to this game with `bind -local` or `unbind -local` in this session. */
  readonly localBinds: ReadonlySet<string>;
  /** Canonical settings the player kept to this game with `set -local` in this session. */
  readonly localCvars: ReadonlySet<string>;
}

/**
 * Take the session's changes into the layers. `loaded` is the effective set the game started from; `current` is its
 * state now. A change goes to the high level and clears this game's override of that entry, unless it was made with
 * a local form, which becomes this game's override and leaves the high level alone.
 */
export function absorbChanges(
  format: LayerFormat,
  loaded: EffectiveSet,
  current: { readonly binds: readonly (readonly [key: string, command: string])[]; readonly cvars: ReadonlyMap<string, LayerCvar> },
  context: AbsorbContext,
  high: HighLevel,
  overrides: GameOverrides,
): { high: boolean; overrides: boolean } {
  const touched = { high: false, overrides: false };
  const spelled = new Map<string, string>([...context.defaultBinds].map(([key, bind]) => [key, bind.key]));
  const startBinds = new Map<string, string>();
  for (const [key, bind] of context.defaultBinds) if (bind.command !== null) startBinds.set(key, bind.command);
  for (const bind of loaded.unbound) {
    startBinds.delete(fold(bind.key));
    spelled.set(fold(bind.key), bind.key);
  }
  for (const bind of loaded.binds) {
    if (bind.command !== null) startBinds.set(fold(bind.key), bind.command);
    spelled.set(fold(bind.key), bind.key);
  }
  const nowBinds = new Map(current.binds.map(([key, command]) => [fold(key), { key, command }]));
  for (const key of new Set([...startBinds.keys(), ...nowBinds.keys()])) {
    const before = startBinds.get(key),
      after = nowBinds.get(key);
    if (before === (after?.command ?? undefined)) continue;
    const bind: LayerBind = { key: after?.key ?? spelled.get(key) ?? key, command: after?.command ?? null };
    if (context.localBinds.has(key)) {
      overrides.binds.set(key, bind);
      touched.overrides = true;
    } else {
      high.binds.set(key, bind);
      touched.high = true;
      touched.overrides = overrides.binds.delete(key) || touched.overrides;
    }
  }
  for (const [name, entry] of current.cvars) {
    if (spellingIn(format, name) === null) continue;
    const before = loaded.cvars.get(name)?.value ?? context.resetValue(name);
    if (before !== undefined && sameValue(before, entry.value)) continue;
    if (context.localCvars.has(name)) {
      overrides.cvars.set(name, entry);
      touched.overrides = true;
      continue;
    }
    high.settings.set(name, entry.value);
    touched.high = true;
    touched.overrides = overrides.cvars.delete(name) || touched.overrides;
  }
  return touched;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const LAYER_VERSION = 2;
/** Version 1 named the high level's settings by a vocabulary of its own; version 2 uses the canonical cvar names. */
const V1_SETTINGS: Readonly<Record<string, string>> = {
  sensitivity: "sensitivity",
  volume: "volume",
  musicVolume: "bgmvolume",
  gamma: "r_gamma",
  fullscreen: "r_fullscreen",
  width: "r_customwidth",
  height: "r_customheight",
  fov: "fov",
};

/** The high level and each game's layer state persist as JSON beside the engine's other settings. */
export class LayerStore {
  private readonly store: ConfigStore;
  constructor(root: string) {
    this.store = new ConfigStore(root);
  }

  private static binds(value: unknown): Map<string, LayerBind> {
    const out = new Map<string, LayerBind>();
    if (!isRecord(value)) return out;
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      const bound = entry["key"],
        command = entry["command"];
      if (typeof bound === "string" && (typeof command === "string" || command === null)) out.set(key, { key: bound, command });
    }
    return out;
  }
  /** Version 1 cvars were kept in the game's own spelling and values; convert them. */
  private static cvars(value: unknown, version: number): Map<string, LayerCvar> {
    const out = new Map<string, LayerCvar>();
    if (!isRecord(value)) return out;
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      const name = entry["name"],
        text = entry["value"];
      if (typeof name !== "string" || typeof text !== "string") continue;
      const canonical = version >= LAYER_VERSION ? { canonical: name, value: text } : toCanonical(name, text);
      if (canonical !== null) out.set(canonical.canonical, { name: canonical.canonical, value: canonical.value });
      else if (version >= LAYER_VERSION) out.set(key, { name, value: text });
    }
    return out;
  }
  private async read(name: string): Promise<{ readonly version: number; readonly document: Record<string, unknown> } | null> {
    const text = await this.store.loadText(name);
    if (text === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null; // A damaged layer file is the absent one; the next save replaces it.
    }
    if (!isRecord(value)) return null;
    return { version: value["version"] === LAYER_VERSION ? LAYER_VERSION : 1, document: value };
  }

  /** Null when no game has ever written a high level. */
  async loadHigh(): Promise<HighLevel | null> {
    const read = await this.read("layers/high.json");
    if (read === null) return null;
    const high = emptyHigh();
    const settings = read.document["settings"];
    if (isRecord(settings))
      for (const [name, value] of Object.entries(settings)) {
        if (typeof value !== "string") continue;
        if (read.version >= LAYER_VERSION) high.settings.set(name, value);
        else if (name === "invertPitch") high.settings.set("m_pitch", value === "1" ? "-0.022" : "0.022");
        else {
          const canonical = V1_SETTINGS[name];
          if (canonical !== undefined) high.settings.set(canonical, value);
        }
      }
    high.binds = LayerStore.binds(read.document["binds"]);
    if (read.version < LAYER_VERSION) await this.saveHigh(high);
    return high;
  }
  async saveHigh(high: HighLevel): Promise<void> {
    await this.store.dump(
      "layers/high.json",
      `${JSON.stringify({ version: LAYER_VERSION, settings: Object.fromEntries(high.settings), binds: Object.fromEntries(high.binds) }, null, 2)}\n`,
    );
  }

  async loadGame(id: string): Promise<{ overrides: GameOverrides; record: WrittenRecord | null }> {
    const read = await this.read(`layers/games/${encodeURIComponent(id)}.json`);
    if (read === null) return { overrides: emptyOverrides(), record: null };
    const { version, document } = read;
    const overrides = document["overrides"],
      written = document["written"];
    const record = isRecord(written)
      ? {
          binds: new Map([...LayerStore.binds(written["binds"])].map(([key, bind]) => [key, bind.command ?? ""])),
          cvars: new Map([...LayerStore.cvars(written["cvars"], version)].map(([key, cvar]) => [key, cvar.value])),
        }
      : null;
    const loaded = {
      overrides: {
        binds: LayerStore.binds(isRecord(overrides) ? overrides["binds"] : undefined),
        cvars: LayerStore.cvars(isRecord(overrides) ? overrides["cvars"] : undefined, version),
      },
      record,
    };
    if (version < LAYER_VERSION) await this.saveGame(id, loaded.overrides, record === null ? null : snapshotOf(record));
    return loaded;
  }
  async saveGame(id: string, overrides: GameOverrides, record: LayerSnapshot | null): Promise<void> {
    const written = record === null ? null : { binds: Object.fromEntries(record.binds), cvars: Object.fromEntries(record.cvars) };
    await this.store.dump(
      `layers/games/${encodeURIComponent(id)}.json`,
      `${JSON.stringify({ version: LAYER_VERSION, overrides: { binds: Object.fromEntries(overrides.binds), cvars: Object.fromEntries(overrides.cvars) }, written }, null, 2)}\n`,
    );
  }
}

/**
 * One game's view of the layers: the high level shared by every game, and this game's overrides and record. The
 * game's native file is read and written through it.
 */
export class GameLayers {
  private high: HighLevel | null = null;
  private overrides: GameOverrides = emptyOverrides();
  private record: WrittenRecord | null = null;
  private currentLoaded: EffectiveSet = { binds: [], unbound: [], cvars: new Map<string, LayerCvar>() };
  private defaultBinds: ReadonlyMap<string, LayerBind> = new Map<string, LayerBind>();
  private readonly localBinds = new Set<string>();
  private readonly localCvars = new Set<string>();
  /** True once this session has read the layers. */
  private ready = false;

  constructor(
    private readonly store: LayerStore,
    readonly format: LayerFormat,
    readonly gameId: string,
  ) {}

  /** The effective set the game started from, which the next absorb measures changes against. */
  get loaded(): EffectiveSet {
    return this.currentLoaded;
  }
  get highLevel(): HighLevel {
    return this.high ?? emptyHigh();
  }
  get gameOverrides(): GameOverrides {
    return this.overrides;
  }

  /** The bindings in force once the game's default.cfg ran; they sit beneath the high level and are not the player's decisions. */
  noteDefaultBinds(binds: readonly (readonly [key: string, command: string])[]): void {
    this.defaultBinds = new Map(binds.map(([key, command]) => [fold(key), { key, command }]));
  }

  /** The player kept this binding to this game with a local form; the key is in the engine's own spelling. */
  noteLocalBind(key: string): void {
    this.localBinds.add(fold(key));
  }
  /** The player kept a cvar, in any of its spellings, to this game. */
  noteLocalCvar(name: string): void {
    this.localCvars.add(settingFor(name)?.setting.canonical ?? name.toLowerCase());
  }

  /**
   * Resolve the layers against the game's native file: seed an empty high level from the first file met, fold
   * hand-edits into the overrides, and answer the effective set.
   */
  async resolve(file: LayerSnapshot): Promise<EffectiveSet> {
    const game = await this.store.loadGame(this.gameId);
    this.overrides = game.overrides;
    this.record = game.record;
    let high = await this.store.loadHigh();
    let dirtyHigh = false,
      dirtyGame = false;
    if (high === null) {
      high = game.record === null ? seedHigh(this.format, file) : emptyHigh();
      // Nothing to keep leaves the high level unwritten, so the next game with a file can still seed it.
      dirtyHigh = high.binds.size > 0 || high.settings.size > 0;
    } else if (game.record === null) {
      // A native file the engine has not written yet is the player's own: where it differs from the high level it is this game's override.
      dirtyGame = detectHandEdits(this.format, file, { binds: new Map<string, string>(), cvars: new Map<string, string>() }, high, this.overrides);
    }
    if (game.record !== null) dirtyGame = detectHandEdits(this.format, file, game.record, high, this.overrides);
    this.high = high;
    if (dirtyHigh) await this.store.saveHigh(high);
    if (dirtyGame) await this.store.saveGame(this.gameId, this.overrides, game.record === null ? null : snapshotOf(game.record));
    this.currentLoaded = effectiveSet(this.format, high, this.overrides);
    this.ready = true;
    return this.currentLoaded;
  }

  /** Take the session's changes into the layers and answer the full effective set to write. */
  async absorb(
    current: { readonly binds: readonly (readonly [key: string, command: string])[]; readonly cvars: ReadonlyMap<string, LayerCvar> },
    resetValue: AbsorbContext["resetValue"],
  ): Promise<EffectiveSet> {
    if (!this.ready || this.high === null) throw new Error("Settings layers were not read before they were written");
    const touched = absorbChanges(
      this.format,
      this.currentLoaded,
      current,
      { defaultBinds: this.defaultBinds, resetValue, localBinds: this.localBinds, localCvars: this.localCvars },
      this.high,
      this.overrides,
    );
    if (touched.high) await this.store.saveHigh(this.high);
    this.currentLoaded = effectiveSet(this.format, this.high, this.overrides);
    this.localBinds.clear();
    this.localCvars.clear();
    if (touched.overrides) await this.store.saveGame(this.gameId, this.overrides, this.record === null ? null : snapshotOf(this.record));
    return this.currentLoaded;
  }

  /** Remember what was just written, so later differences in the file are the player's hand-edits. */
  async recordWritten(file: LayerSnapshot): Promise<void> {
    this.record = {
      binds: new Map([...file.binds].map(([key, bind]) => [key, bind.command ?? ""])),
      cvars: new Map([...file.cvars].map(([key, cvar]) => [key, cvar.value])),
    };
    await this.store.saveGame(this.gameId, this.overrides, file);
  }

  get isReady(): boolean {
    return this.ready;
  }
}

function snapshotOf(record: WrittenRecord): LayerSnapshot {
  return {
    binds: new Map([...record.binds].map(([key, command]) => [key, { key, command }])),
    cvars: new Map([...record.cvars].map(([key, value]) => [key, { name: key, value }])),
  };
}
