// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { GameFamily } from "../contracts/content.ts";
import { nightdiveAddonDirectories } from "../content/roots.ts";
import type { ScreenshotNaming } from "../capture/index.ts";
import { writeAtomic } from "../core/files/atomic.ts";
import { sameValue, type EffectiveSet, type GameLayers, type LayerCvar, type LayerSnapshot } from "./layers.ts";
import { fileCvars, settingFor, spellingIn, toCanonical } from "./setting-spellings.ts";

/**
 * The configuration files a stock game keeps in its own folders, with the
 * original name, format and location. A stock game is every selected component
 * coming from one product or mod; those files are then the source of truth for
 * bindings and archived variables.
 */
export type NativeConfigFormat = "quake" | "quake2" | "quake3" | "kex-quake" | "kex-quake2";

export interface NativeConfigProduct {
  readonly family: GameFamily;
  readonly edition: string;
  readonly contentDirectory: string;
  readonly looseRoot: string | null;
}

export interface NativeConfigFile {
  readonly name: string;
  readonly path: string;
  /** Where writes go instead of `path`, when the layout is redirected. */
  readonly redirected?: string;
  /** Whether reads prefer the redirected copy; shared test roots only receive writes. */
  readonly readsRedirect?: boolean;
  readonly binds: boolean;
}

export interface NativeConfigLayout {
  readonly format: NativeConfigFormat;
  /** The startup script name whose read these files answer. */
  readonly script: "config.cfg" | "q3config.cfg";
  /** Files in the order the original executes them. */
  readonly files: readonly NativeConfigFile[];
  /**
   * The folder the original writes its demos, screenshots, logs and saves into: the game folder, or the Saved Games
   * folder for the rerelease. Writes go to `directory`; reads also look in `fallbacks`.
   */
  readonly directory: string;
  readonly fallbacks: readonly string[];
  /** Where the original puts unnamed screenshots, beneath `directory`. */
  readonly screenshots: ScreenshotNaming;
}

export type NativeBindings = readonly (readonly [key: string, command: string])[];

/**
 * Key names the rerelease engine writes in place of this engine's, from the key table in its executable. The first
 * name for a key is the one written back. Keypad digits follow the layout of the keypad navigation keys.
 */
const KEX_KEY_PAIRS: readonly (readonly [kex: string, ours: string])[] = [
  ["mouse_left", "mouse1"],
  ["mouse_right", "mouse2"],
  ["mouse_middle", "mouse3"],
  ["mouse_misc1", "mouse4"],
  ["mouse_misc2", "mouse5"],
  ["mouse_wheel_up", "mwheelup"],
  ["mouse_wheel_down", "mwheeldown"],
  ["lshift", "shift"],
  ["lctrl", "ctrl"],
  ["lalt", "alt"],
  ["up", "uparrow"],
  ["down", "downarrow"],
  ["left", "leftarrow"],
  ["right", "rightarrow"],
  ["pageup", "pgup"],
  ["pagedown", "pgdn"],
  ["insert", "ins"],
  ["delete", "del"],
  ["caps_lock", "capslock"],
  ["kp_0", "kp_ins"],
  ["kp_1", "kp_end"],
  ["kp_2", "kp_downarrow"],
  ["kp_3", "kp_pgdn"],
  ["kp_4", "kp_leftarrow"],
  ["kp_6", "kp_rightarrow"],
  ["kp_7", "kp_home"],
  ["kp_8", "kp_uparrow"],
  ["kp_9", "kp_pgup"],
  ["kp_period", "kp_del"],
  ["kp_divide", "kp_slash"],
  ["kp_mul", "kp_star"],
  ...Array.from({ length: 32 }, (_, index): readonly [string, string] => [`joy_${index}`, `joy${index + 1}`]),
];
/** Names the rerelease also accepts for a key; they are read but never written. */
const KEX_KEY_ALIASES: readonly (readonly [kex: string, ours: string])[] = [
  ["rshift", "shift"],
  ["rctrl", "ctrl"],
  ["ralt", "alt"],
  ["numlock", "kp_numlock"],
  ["grave", "`"],
  ["backquote", "`"],
  ["minus", "-"],
  ["equals", "="],
  ["comma", ","],
  ["period", "."],
  ["slash", "/"],
  ["backslash", "\\"],
  ["quote", "'"],
];
const KEX_KEYS: ReadonlyMap<string, string> = new Map([...KEX_KEY_PAIRS, ...KEX_KEY_ALIASES]);
const KEX_KEYS_BACK: ReadonlyMap<string, string> = new Map(KEX_KEY_PAIRS.map(([kex, ours]) => [ours, kex]));
/** The rerelease Quake binds actions with a leading star where this engine uses plus commands. */
const KEX_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["*in_attack", "+attack"],
  ["*in_back", "+back"],
  ["*in_down", "+movedown"],
  ["*in_forward", "+forward"],
  ["*in_jump", "+jump"],
  ["*in_left", "+left"],
  ["*in_lookdown", "+lookdown"],
  ["*in_lookup", "+lookup"],
  ["*in_right", "+right"],
  ["*in_strafe", "+strafe"],
  ["*in_moveleft", "+moveleft"],
  ["*in_moveright", "+moveright"],
  ["*in_speed", "+speed"],
  ["*in_up", "+moveup"],
  ["*showscores", "+showscores"],
]);
const KEX_COMMANDS_BACK: ReadonlyMap<string, string> = new Map([...KEX_COMMANDS].map(([kex, ours]) => [ours, kex]));

/** GLQuake writes quakeNN.tga beside the game, Quake II scrnshot/quakeNN, Quake III screenshots/shotNNNN. */
function screenshotNaming(family: GameFamily): ScreenshotNaming {
  switch (family) {
    case "q1":
      return { directory: "", prefix: "quake", digits: 2 };
    case "q2":
      return { directory: "scrnshot", prefix: "quake", digits: 2 };
    case "q3":
      return { directory: "screenshots", prefix: "shot", digits: 4 };
  }
}

function savedGamesRoot(family: GameFamily, home: string): string | null {
  return nightdiveAddonDirectories(home).find(root => root.family === family)?.root ?? null;
}

function placed(
  file: {
    name: string;
    real: string | null;
    alt: string | null;
    binds: boolean;
  },
  readsRedirect: boolean,
): NativeConfigFile | null {
  const path = file.real ?? file.alt;
  if (path === null) return null;
  return {
    name: file.name,
    path,
    binds: file.binds,
    ...(file.alt === null ? {} : { redirected: file.alt, readsRedirect }),
  };
}

/**
 * Null when the product keeps no native files this engine can place (no folder to write into).
 * `redirect` is for sandboxes and tests whose game folders are read-only: writes land beneath it with the
 * original names and relative layout. With `readsRedirect` it replaces the real location for reads as well;
 * otherwise reads still come from the real location.
 */
export function nativeConfigLayout(product: NativeConfigProduct, home: string = homedir(), redirect?: string, readsRedirect = true): NativeConfigLayout | null {
  const rerelease = product.edition === "rerelease";
  // A redirect that answers reads too replaces the real location outright.
  const exclusive = redirect !== undefined && readsRedirect;
  const classicAlt = (name: string): string | null => (redirect === undefined ? null : join(redirect, product.contentDirectory, name));
  const classic = (name: "config.cfg" | "q3config.cfg", format: NativeConfigFormat): NativeConfigLayout | null => {
    const file = placed(
      {
        name,
        real: product.looseRoot === null || exclusive ? null : join(product.looseRoot, name),
        alt: classicAlt(name),
        binds: true,
      },
      readsRedirect,
    );
    if (file === null) return null;
    const directory = dirname(file.redirected ?? file.path);
    const fallbacks = dirname(file.path) === directory ? [] : [dirname(file.path)];
    return {
      format,
      script: name,
      files: [file],
      directory,
      fallbacks,
      screenshots: screenshotNaming(product.family),
    };
  };
  if (product.family === "q3") return classic("q3config.cfg", "quake3");
  if (!rerelease) return classic("config.cfg", product.family === "q1" ? "quake" : "quake2");
  const real = exclusive ? null : savedGamesRoot(product.family, home);
  const alt = redirect === undefined ? null : join(redirect, "Saved Games", "Nightdive Studios", product.family === "q1" ? "Quake" : "Quake II");
  if (real === null && alt === null) return null;
  const at = (name: string, directory?: string, binds = false): NativeConfigFile | null =>
    placed(
      {
        name,
        binds,
        real: real === null ? null : join(real, directory ?? "", name),
        alt: alt === null ? null : join(alt, directory ?? "", name),
      },
      readsRedirect,
    );
  const files = (
    product.family === "q1"
      ? [at("kexengine.cfg", undefined, true)]
      : [
          at("kexengine.cfg"),
          at("system.cfg"),
          at("settings.cfg", basename(product.contentDirectory)),
          at("keybinds.cfg", basename(product.contentDirectory), true),
        ]
  ).filter((file): file is NativeConfigFile => file !== null);
  const directory = alt ?? real;
  if (directory === null) return null;
  return {
    format: product.family === "q1" ? "kex-quake" : "kex-quake2",
    script: "config.cfg",
    files,
    directory,
    fallbacks: alt !== null && real !== null ? [real] : [],
    screenshots: screenshotNaming(product.family),
  };
}

interface CvarLine {
  readonly keyword: string;
  readonly name: string;
  readonly value: string;
}

const CVAR_LINE = /^(?:(seta|setu|sets|set)\s+)?([^\s";]+)\s+"([^"]*)"$/i;
function cvarLine(line: string): CvarLine | null {
  const match = CVAR_LINE.exec(line.trim());
  if (match === null) return null;
  const keyword = match[1] ?? "",
    name = match[2] ?? "",
    value = match[3] ?? "";
  if (keyword === "" && /^(?:bind|unbind|unbindall|exec|alias|echo)$/i.test(name)) return null;
  return { keyword, name, value };
}
const BIND_LINE = /^bind\s+(?:"([^"]*)"|(\S+))\s+(?:"([^"]*)"|(\S+))\s*$/i;
function bindLine(line: string): readonly [string, string] | null {
  const match = BIND_LINE.exec(line.trim());
  return match === null ? null : [match[1] ?? match[2] ?? "", match[3] ?? match[4] ?? ""];
}

async function readFrom(path: string): Promise<string | null> {
  try {
    return (await readFile(path)).toString("latin1");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

/** A redirected file is read from its redirect first, so what a run wrote is what it reads back. */
async function readNative(file: NativeConfigFile): Promise<string | null> {
  return (file.redirected === undefined || file.readsRedirect !== true ? null : await readFrom(file.redirected)) ?? (await readFrom(file.path));
}

function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line, index, all) => index < all.length - 1 || line !== "");
}

/** The original writes key names bare (`bind TAB "inven"`); anything the tokenizer would split stays quoted. */
function writtenKey(format: NativeConfigFormat, key: string): string {
  return format === "quake" || format === "kex-quake" ? `"${key}"` : /^[A-Za-z0-9_+,./\-=[\]`'\\]+$/.test(key) && key !== ";" ? key : `"${key}"`;
}

function kexKey(key: string): string {
  return KEX_KEYS_BACK.get(key.toLowerCase()) ?? key.toLowerCase();
}

/** What the engine knows of the game at quit that the layers cannot see in the files. */
export interface NativeWriteContext {
  /** The game's reset value for a cvar. */
  readonly resetValue?: (name: string) => string | undefined;
}

/** The keyword a variable line starts with when the layers add one the file lacks. */
function defaultKeyword(format: NativeConfigFormat): string {
  switch (format) {
    case "quake":
      return "";
    case "quake2":
      return "set ";
    default:
      return "seta ";
  }
}

/**
 * Take a running game's state into the layers (changes go to the high level unless made with a local form) and answer
 * the bindings and variable lines to write: the full effective set. Games with a native file and mixed combinations,
 * which have none, both go through this.
 */
export async function absorbSession(
  layers: GameLayers,
  format: NativeConfigFormat,
  bindings: NativeBindings,
  cvars: readonly string[] | null,
  context: NativeWriteContext,
): Promise<{ bindings: NativeBindings; cvars: readonly string[] | null }> {
  if (!layers.isReady) throw new Error("Settings layers were not read before they were written");
  // The state is canonical settings: a cvar in any spelling reads as its canonical name and value, and where two
  // spellings of one setting are archived, the one that differs from its reset value is the player's.
  const current = new Map<string, LayerCvar>();
  for (const command of cvars ?? []) {
    const parsed = cvarLine(command);
    const canonical =
      parsed === null || spellingIn(format, settingFor(parsed.name)?.setting.canonical ?? "") === null ? null : toCanonical(parsed.name, parsed.value);
    if (canonical === null) continue;
    const reset = context.resetValue?.(canonical.canonical);
    const kept = current.get(canonical.canonical);
    if (kept === undefined || (reset !== undefined && sameValue(kept.value, reset)))
      current.set(canonical.canonical, { name: canonical.canonical, value: canonical.value });
  }
  const effective = await layers.absorb({ binds: bindings, cvars: current }, context.resetValue ?? (() => undefined));
  // Unchanged default.cfg bindings stay in the file; bindings a layer cancels leave it.
  const cancelled = new Set(effective.unbound.map(bind => bind.key.toLowerCase()));
  const written = new Map<string, readonly [string, string]>();
  for (const [key, command] of bindings) if (!cancelled.has(key.toLowerCase())) written.set(key.toLowerCase(), [key, command]);
  for (const bind of effective.binds) if (bind.command !== null) written.set(bind.key.toLowerCase(), [bind.key, bind.command]);
  if (cvars === null) return { bindings: [...written.values()], cvars };
  // The game's file spells each setting its own way: the archived canonical lines give way to the effective set in that spelling.
  const values = new Map([...current].map(([name, cvar]) => [name, cvar.value]));
  for (const [name, cvar] of effective.cvars) values.set(name, cvar.value);
  const wanted = fileCvars(format, values);
  const lines = cvars.filter(command => {
    const parsed = cvarLine(command);
    const setting = parsed === null ? null : settingFor(parsed.name);
    return setting === null || spellingIn(format, setting.setting.canonical) === null;
  });
  const present = new Set(lines.map(command => cvarLine(command)?.name.toLowerCase()));
  for (const [name, cvar] of wanted) if (!present.has(name)) lines.push(`${defaultKeyword(format)}${cvar.name} "${cvar.value}"`);
  return { bindings: [...written.values()], cvars: lines };
}

export class NativeConfig {
  private loadedFiles = 0;
  private names = new Set<string>();
  private bound = false;

  /** `layers` makes the files one level of the settings layering; without it they are read and written as they are. */
  constructor(
    readonly layout: NativeConfigLayout,
    readonly layers?: GameLayers,
  ) {}

  /** True when the last read found a file that held at least one binding or variable. */
  get loaded(): boolean {
    return this.loadedFiles > 0;
  }

  /** True when the last read found a binding. */
  get hasBindings(): boolean {
    return this.bound;
  }

  /** What the files hold now, in this engine's spelling of keys and commands. */
  async snapshot(): Promise<LayerSnapshot> {
    const binds = new Map<string, { key: string; command: string }>();
    const cvars = new Map<string, LayerCvar>();
    for (const file of this.layout.files) {
      const text = await readNative(file);
      if (text === null) continue;
      for (const line of lines(text)) {
        const bind = bindLine(line);
        if (bind !== null) {
          const translated = this.translateBind(bind);
          if (translated !== null) binds.set(translated[0].toLowerCase(), { key: translated[0], command: translated[1] });
          continue;
        }
        const cvar = cvarLine(line);
        const canonical = cvar === null ? null : toCanonical(cvar.name, cvar.value);
        if (canonical !== null && spellingIn(this.layout.format, canonical.canonical) !== null)
          cvars.set(canonical.canonical, { name: canonical.canonical, value: canonical.value });
      }
    }
    return { binds, cvars };
  }

  /** The text the original would execute for its saved configuration, or null when no file holds anything. */
  async readScript(): Promise<string | null> {
    this.loadedFiles = 0;
    this.names = new Set();
    this.bound = false;
    const out: string[] = [];
    // Positions the layers rewrite: where the first binding stood, and each variable's keyword.
    let bindAt = -1;
    const variables: { index: number; cvar: CvarLine }[] = [];
    for (const file of this.layout.files) {
      const text = await readNative(file);
      if (text === null) continue;
      let useful = false;
      for (const line of lines(text)) {
        const bind = bindLine(line);
        if (bind !== null) {
          const translated = this.translateBind(bind);
          if (translated === null) continue;
          useful = true;
          this.bound = true;
          if (bindAt < 0) bindAt = out.length;
          out.push(`bind "${translated[0]}" "${translated[1]}"`);
          continue;
        }
        const cvar = cvarLine(line);
        if (cvar === null) continue;
        useful = true;
        this.names.add(cvar.name.toLowerCase());
        variables.push({ index: out.length, cvar });
        out.push(line.trim());
      }
      if (useful) this.loadedFiles++;
    }
    const layers = this.layers;
    if (layers === undefined) return this.loadedFiles === 0 ? null : `${out.join("\n")}\n`;
    const effective = await layers.resolve(await this.snapshot());
    const merged = this.layered(out, bindAt, variables, effective);
    if (effective.binds.length > 0) this.bound = true;
    return merged.length === 0 ? null : `${merged.join("\n")}\n`;
  }

  /** The script lines with the file's bindings and mapped variables replaced by the effective set, and the rest of it appended. */
  private layered(out: readonly string[], bindAt: number, variables: readonly { index: number; cvar: CvarLine }[], effective: EffectiveSet): string[] {
    const replaced = new Map<number, string>();
    const emitted = new Set<string>();
    const wanted = fileCvars(this.layout.format, new Map([...effective.cvars].map(([name, cvar]) => [name, cvar.value])));
    for (const { index, cvar } of variables) {
      const replacement = wanted.get(cvar.name.toLowerCase());
      if (replacement === undefined) continue;
      emitted.add(cvar.name.toLowerCase());
      replaced.set(index, `${cvar.keyword === "" ? "" : `${cvar.keyword} `}${cvar.name} "${replacement.value}"`);
    }
    const binds = [...effective.unbound.map(bind => `unbind "${bind.key}"`), ...effective.binds.map(bind => `bind "${bind.key}" "${bind.command ?? ""}"`)];
    const merged: string[] = [];
    if (bindAt < 0) merged.push(...binds);
    out.forEach((line, index) => {
      if (index === bindAt) merged.push(...binds);
      if (bindLine(line) !== null) return;
      merged.push(replaced.get(index) ?? line);
    });
    for (const [name, cvar] of wanted) if (!emitted.has(name)) merged.push(`${defaultKeyword(this.layout.format)}${cvar.name} "${cvar.value}"`);
    return merged;
  }

  /** The bindings the files hold, or null when they hold none. */
  async readBindings(): Promise<NativeBindings | null> {
    const script = await this.readScript();
    if (script === null || !this.bound) return null;
    const pairs: [string, string][] = [];
    for (const line of lines(script)) {
      const bind = bindLine(line);
      if (bind !== null) pairs.push([bind[0], bind[1]]);
    }
    return pairs;
  }

  /** JSON archive entries the native files do not already answer; a stock game's own files win over the user store. */
  filterArchive<T extends { readonly name: string }>(entries: readonly T[]): readonly T[] {
    if (!this.loaded) return entries;
    if (this.layout.format === "kex-quake" || this.layout.format === "kex-quake2") return entries.filter(entry => !this.names.has(entry.name.toLowerCase()));
    return [];
  }

  /** Whether a seat profile's saved bindings must give way to bindings the native files supplied. */
  suppressesProfileBindings(): boolean {
    return this.layout.format === "kex-quake" || this.layout.format === "kex-quake2" ? this.bound : this.loaded;
  }

  private translateBind(bind: readonly [string, string]): readonly [string, string] | null {
    if (this.layout.format !== "kex-quake") return bind;
    const [key, command] = bind;
    if (command.startsWith("*")) {
      const translated = KEX_COMMANDS.get(command.toLowerCase());
      return translated === undefined ? null : [KEX_KEYS.get(key.toLowerCase()) ?? key, translated];
    }
    return [KEX_KEYS.get(key.toLowerCase()) ?? key, command];
  }

  private writtenBind(key: string, command: string): string | null {
    switch (this.layout.format) {
      case "kex-quake": {
        const star = KEX_COMMANDS_BACK.get(command.toLowerCase());
        return `bind ${kexKey(key)} "${star ?? command}"`;
      }
      default:
        return `bind ${writtenKey(this.layout.format, key)} "${command}"`;
    }
  }

  private async layeredState(bindings: NativeBindings, cvars: readonly string[] | null, context: NativeWriteContext) {
    if (this.layers === undefined) return { bindings, cvars };
    if (!this.layers.isReady) await this.readScript();
    return absorbSession(this.layers, this.layout.format, bindings, cvars, context);
  }

  /**
   * Write what the original writes at quit: bindings, then archived variables.
   * `cvars` are archive commands in the dialect's own spelling. With layers this is the full effective set.
   */
  async write(bindings: NativeBindings, cvars: readonly string[], context: NativeWriteContext = {}): Promise<void> {
    const state = await this.layeredState(bindings, cvars, context);
    await this.writeFiles(state.bindings, state.cvars ?? cvars);
    await this.layers?.recordWritten(await this.snapshot());
  }

  private async writeFiles(bindings: NativeBindings, cvars: readonly string[]): Promise<void> {
    if (this.layout.format === "kex-quake" || this.layout.format === "kex-quake2") {
      await this.merge(bindings, cvars);
      return;
    }
    const header = this.layout.format === "quake" ? [] : ["// generated by quake, do not modify"];
    const text = [...header, ...bindings.map(([key, command]) => this.writtenBind(key, command)).filter(line => line !== null), ...cvars].join("\n");
    const file = this.layout.files[0];
    if (file === undefined) return;
    await writeAtomic(file.redirected ?? file.path, `${text}\n`);
  }

  /**
   * Replace only the bindings, keeping every other line; the front end edits bindings without the game's variables.
   * A change goes to the high level and so to every game; with `local` it stays this game's override.
   */
  async writeBindings(bindings: NativeBindings, options: NativeWriteContext & { readonly local?: boolean } = {}): Promise<void> {
    const layers = this.layers;
    if (layers !== undefined) {
      if (!layers.isReady) await this.readScript();
      if (options.local === true) {
        const before = new Map(layers.loaded.binds.map(bind => [bind.key.toLowerCase(), bind.command]));
        const after = new Map(bindings.map(([key, command]) => [key.toLowerCase(), command]));
        for (const key of new Set([...before.keys(), ...after.keys()])) if (before.get(key) !== after.get(key)) layers.noteLocalBind(key);
      }
      const state = await this.layeredState(bindings, null, options);
      bindings = state.bindings;
    }
    if (this.layout.format === "kex-quake" || this.layout.format === "kex-quake2") {
      await this.merge(bindings, null);
    } else {
      const file = this.layout.files[0];
      if (file === undefined) return;
      const existing = (await readNative(file)) ?? "";
      const kept = lines(existing).filter(line => bindLine(line) === null && !/^\s*unbindall\s*$/i.test(line) && !/^\s*\/\/ generated by quake/i.test(line));
      const header = this.layout.format === "quake" ? [] : ["// generated by quake, do not modify"];
      const text = [...header, ...bindings.map(([key, command]) => this.writtenBind(key, command)).filter(line => line !== null), ...kept].join("\n");
      await writeAtomic(file.redirected ?? file.path, `${text}\n`);
    }
    await layers?.recordWritten(await this.snapshot());
  }

  /** The rerelease files hold many variables this engine does not own: update the lines present, keep the rest, and leave variables they do not name in the user store. */
  private async merge(bindings: NativeBindings, cvars: readonly string[] | null): Promise<void> {
    const wanted = new Map<string, CvarLine>();
    for (const command of cvars ?? []) {
      const parsed = cvarLine(command);
      if (parsed !== null) wanted.set(parsed.name.toLowerCase(), parsed);
    }
    const missing = new Map(wanted);
    for (const [index, file] of this.layout.files.entries()) {
      const existing = await readNative(file);
      if ((existing === null && !file.binds && index !== 0) || (cvars === null && !file.binds)) continue;
      const crlf = existing?.includes("\r\n") ?? false;
      const output: string[] = [];
      const bindLines = file.binds ? bindings.map(([key, command]) => this.writtenBind(key, command)).filter(line => line !== null) : [];
      let boundHere = false;
      for (const line of existing === null ? [] : lines(existing)) {
        const bind = bindLine(line);
        if (bind !== null && file.binds) {
          // Engine-owned actions keep their lines; the player's own bindings are replaced as a block.
          if (this.layout.format === "kex-quake" && bind[1].startsWith("*") && !KEX_COMMANDS.has(bind[1].toLowerCase())) output.push(line);
          else if (!boundHere) {
            boundHere = true;
            output.push(...bindLines);
          }
          continue;
        }
        const cvar = cvarLine(line);
        const next = cvar === null ? undefined : wanted.get(cvar.name.toLowerCase());
        if (cvar !== null && next !== undefined) {
          missing.delete(cvar.name.toLowerCase());
          output.push(`${cvar.keyword === "" ? "" : `${cvar.keyword} `}${cvar.name} "${next.value}"`);
        } else output.push(line);
      }
      if (file.binds && !boundHere) output.unshift(...bindLines);
      // The layered set is complete: variables the file never named go into the first file.
      if (index === 0 && this.layers !== undefined)
        for (const cvar of missing.values())
          if (settingFor(cvar.name) !== null) output.push(`${defaultKeyword(this.layout.format)}${cvar.name} "${cvar.value}"`);
      if (existing === null && output.length === 0) continue;
      await writeAtomic(file.redirected ?? file.path, `${output.join(crlf ? "\r\n" : "\n")}${crlf ? "\r\n" : "\n"}`);
    }
  }
}
