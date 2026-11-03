// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { GameFamily } from "../contracts/content.ts";
import { nightdiveAddonDirectories } from "../content/roots.ts";
import { writeAtomic } from "../core/files/atomic.ts";

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
}

export type NativeBindings = readonly (readonly [key: string, command: string])[];

/** Key names the rerelease engine writes in place of this engine's. */
const KEX_KEYS: ReadonlyMap<string, string> = new Map([
  ["mouse_left", "mouse1"],
  ["mouse_right", "mouse2"],
  ["mouse_middle", "mouse3"],
  ["mouse_wheel_up", "mwheelup"],
  ["mouse_wheel_down", "mwheeldown"],
  ["lshift", "shift"],
  ["lctrl", "ctrl"],
  ["lalt", "alt"],
]);
const KEX_KEYS_BACK: ReadonlyMap<string, string> = new Map([...KEX_KEYS].map(([kex, ours]) => [ours, kex]));
/** The rerelease Quake binds actions with a leading star where this engine uses plus commands. */
const KEX_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["*in_attack", "+attack"],
  ["*in_back", "+back"],
  ["*in_down", "+movedown"],
  ["*in_forward", "+forward"],
  ["*in_jump", "+jump"],
  ["*in_moveleft", "+moveleft"],
  ["*in_moveright", "+moveright"],
  ["*in_speed", "+speed"],
  ["*in_up", "+moveup"],
  ["*showscores", "+showscores"],
]);
const KEX_COMMANDS_BACK: ReadonlyMap<string, string> = new Map([...KEX_COMMANDS].map(([kex, ours]) => [ours, kex]));

function savedGamesRoot(family: GameFamily, home: string): string | null {
  return nightdiveAddonDirectories(home).find(root => root.family === family)?.root ?? null;
}

function placed(file: { name: string; real: string | null; alt: string | null; binds: boolean }, readsRedirect: boolean): NativeConfigFile | null {
  const path = file.real ?? file.alt;
  if (path === null) return null;
  return { name: file.name, path, binds: file.binds, ...(file.alt === null ? {} : { redirected: file.alt, readsRedirect }) };
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
      { name, real: product.looseRoot === null || exclusive ? null : join(product.looseRoot, name), alt: classicAlt(name), binds: true },
      readsRedirect,
    );
    return file === null ? null : { format, script: name, files: [file] };
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
  return { format: product.family === "q1" ? "kex-quake" : "kex-quake2", script: "config.cfg", files };
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

export class NativeConfig {
  private loadedFiles = 0;
  private names = new Set<string>();
  private bound = false;

  constructor(readonly layout: NativeConfigLayout) {}

  /** True when the last read found a file that held at least one binding or variable. */
  get loaded(): boolean {
    return this.loadedFiles > 0;
  }

  /** True when the last read found a binding. */
  get hasBindings(): boolean {
    return this.bound;
  }

  /** The text the original would execute for its saved configuration, or null when no file holds anything. */
  async readScript(): Promise<string | null> {
    this.loadedFiles = 0;
    this.names = new Set();
    this.bound = false;
    const out: string[] = [];
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
          out.push(`bind "${translated[0]}" "${translated[1]}"`);
          continue;
        }
        const cvar = cvarLine(line);
        if (cvar === null) continue;
        useful = true;
        this.names.add(cvar.name.toLowerCase());
        out.push(line.trim());
      }
      if (useful) this.loadedFiles++;
    }
    return this.loadedFiles === 0 ? null : `${out.join("\n")}\n`;
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

  /**
   * Write what the original writes at quit: bindings, then archived variables.
   * `cvars` are archive commands in the dialect's own spelling.
   */
  async write(bindings: NativeBindings, cvars: readonly string[]): Promise<void> {
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

  /** Replace only the bindings, keeping every other line; the front end edits bindings without the game's variables. */
  async writeBindings(bindings: NativeBindings): Promise<void> {
    if (this.layout.format === "kex-quake" || this.layout.format === "kex-quake2") {
      await this.merge(bindings, null);
      return;
    }
    const file = this.layout.files[0];
    if (file === undefined) return;
    const existing = (await readNative(file)) ?? "";
    const kept = lines(existing).filter(line => bindLine(line) === null && !/^\s*unbindall\s*$/i.test(line) && !/^\s*\/\/ generated by quake/i.test(line));
    const header = this.layout.format === "quake" ? [] : ["// generated by quake, do not modify"];
    const text = [...header, ...bindings.map(([key, command]) => this.writtenBind(key, command)).filter(line => line !== null), ...kept].join("\n");
    await writeAtomic(file.redirected ?? file.path, `${text}\n`);
  }

  /** The rerelease files hold many variables this engine does not own: update the lines present, keep the rest, and leave variables they do not name in the user store. */
  private async merge(bindings: NativeBindings, cvars: readonly string[] | null): Promise<void> {
    const wanted = new Map<string, CvarLine>();
    for (const command of cvars ?? []) {
      const parsed = cvarLine(command);
      if (parsed !== null) wanted.set(parsed.name.toLowerCase(), parsed);
    }
    for (const file of this.layout.files) {
      const existing = await readNative(file);
      if ((existing === null && !file.binds) || (cvars === null && !file.binds)) continue;
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
          output.push(`${cvar.keyword === "" ? "" : `${cvar.keyword} `}${cvar.name} "${next.value}"`);
        } else output.push(line);
      }
      if (file.binds && !boundHere) output.unshift(...bindLines);
      if (existing === null && output.length === 0) continue;
      await writeAtomic(file.redirected ?? file.path, `${output.join(crlf ? "\r\n" : "\n")}${crlf ? "\r\n" : "\n"}`);
    }
  }
}
