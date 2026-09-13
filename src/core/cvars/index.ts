/* Instance-owned registries adapted from quake-3-ts/src/core/cvar.ts;
 * family behavior follows Quake/QW cvar.c and Quake II qcommon/cvar.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CommandContext, CommandDialect, CvarInfoTarget } from "../../contracts/common.ts";
import { asciiFold, isQ1, isQ2, sourceCommandText } from "../commands/text.ts";
import { nativeAtof, nativeAtoi } from "../numeric.ts";
import { cvarValueText, quakeAtof } from "./numbers.ts";
import { setInfoValue } from "./info.ts";
import type { CommandDocumentation } from "../commands/documentation.ts";

/** The Q3 ABI flag words. Q1 uses Archive and ServerInfo for declaration booleans. */
export enum CvarFlag {
  None = 0, Archive = 1, UserInfo = 2, ServerInfo = 4, SystemInfo = 8,
  Init = 16, Latch = 32, ReadOnly = 64, UserCreated = 128, Temporary = 256,
  Cheat = 512, NoRestart = 1024,
}
export enum Q2CvarFlag {
  None = 0, Archive = 1, UserInfo = 2, ServerInfo = 4, NoSet = 8, Latch = 16,
  Cheat = 32, Private = 64, ReadOnly = 128, Modified = 256, Custom = 512, Weak = 1024,
  Game = 2048, NoArchive = 4096, Files = 8192, Refresh = 16384, Sound = 32768,
}
const q2NoArchive = Q2CvarFlag.NoSet | Q2CvarFlag.Cheat | Q2CvarFlag.Private | Q2CvarFlag.ReadOnly | Q2CvarFlag.NoArchive;

export interface CvarRead {
  readonly name: string;
  readonly value: string;
  readonly resetValue: string;
  readonly latchedValue: string | undefined;
  readonly flags: number;
  readonly modified: boolean;
  readonly modificationCount: number;
  readonly numericValue: number;
  readonly integerValue: number;
}
export type CvarSnapshot = CvarRead;

interface CvarState {
  readonly index: number;
  readonly name: string;
  value: string;
  resetValue: string;
  latchedValue: string | undefined;
  flags: number;
  modified: boolean;
  modificationCount: number;
  numericValue: number;
  integerValue: number;
  next: CvarState | undefined;
}

export type CvarEffect =
  | { readonly kind: "userinfo"; readonly context: CommandContext; readonly name: string; readonly value: string; readonly info: string; readonly command: string | null }
  | { readonly kind: "server-info"; readonly context: CommandContext; readonly name: string; readonly value: string; readonly info: string }
  | { readonly kind: "broadcast"; readonly context: CommandContext; readonly text: string }
  | { readonly kind: "game-directory"; readonly context: CommandContext; readonly directory: string; readonly executeAutoexec: true };

export interface CvarRegistryOptions {
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly print?: (text: string) => void;
  readonly onEffect?: (effect: CvarEffect) => undefined;
  readonly commandExists?: (name: string) => boolean;
  readonly infoTargets?: readonly CvarInfoTarget[];
  /** A local cgame consults its live session authority before protected writes. */
  readonly cheatsAllowed?: () => boolean | undefined;
}

export interface VmCvar {
  readonly value: string;
  readonly numericValue: number;
  readonly integerValue: number;
  readonly modificationCount: number;
  register(name: string, defaultValue: string, flags?: number): void;
  update(): void;
  writeInteger(value: number): void;
}

class RegistryVmCvar implements VmCvar {
  private handle: number | undefined;
  private text = "";
  private numeric = 0;
  private integer = 0;
  private count = 0;
  constructor(private readonly registry: CvarRegistry) {}
  get value(): string { return this.text; }
  get numericValue(): number { return this.numeric; }
  get integerValue(): number { return this.integer; }
  get modificationCount(): number { return this.count; }
  register(name: string, defaultValue: string, flags = 0): void {
    this.handle = this.registry.bindVm(name, defaultValue, flags);
    this.count = -1;
    this.update();
  }
  update(): void {
    if (this.handle === undefined) return;
    const source = this.registry.readVm(this.handle);
    if (source === undefined || source.modificationCount === this.count) return;
    this.count = source.modificationCount;
    if (source.value.length > 255) throw new RangeError("Cvar_Update: value exceeds MAX_CVAR_VALUE_STRING");
    this.text = source.value;
    this.numeric = source.numericValue;
    this.integer = source.integerValue;
  }
  writeInteger(value: number): void {
    if (!Number.isSafeInteger(value)) throw new RangeError("VM cvar integer write requires a safe integer");
    this.integer = value | 0;
  }
}

function snapshot(state: CvarState): CvarSnapshot {
  return Object.freeze({ name: state.name, value: state.value, resetValue: state.resetValue,
    latchedValue: state.latchedValue, flags: state.flags, modified: state.modified,
    modificationCount: state.modificationCount, numericValue: state.numericValue, integerValue: state.integerValue });
}

function validInfo(text: string): boolean { return !/[\\";]/.test(text); }

export class CvarRegistry {
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  private readonly variables = new Map<string, CvarState>();
  private readonly indexes: (CvarState | undefined)[] = [];
  private first: CvarState | undefined;
  private changedFlags = 0;
  private cheatsEnabled = true;
  private serverActive = false;
  private clientConnected = false;
  private highCharacters = false;
  private clientInfo = "";
  private serverInfo = "";
  private effects: CvarEffect[] = [];
  private userinfoDirty = false;
  private readonly consoleVariables = new Set<string>();
  private readonly documents = new Map<string, CommandDocumentation>();

  constructor(private readonly options: CvarRegistryOptions) {
    this.dialect = options.dialect;
    this.context = options.context;
  }

  get modifiedFlags(): number { return this.changedFlags; }
  get userinfoModified(): boolean { return this.userinfoDirty; }
  get indexCount(): number { return this.indexes.length; }
  private print(text: string): void { this.options.print?.(text); }
  private key(name: string): string { const text = sourceCommandText(name); return this.dialect === "q3" ? asciiFold(text) : text; }
  private numbers(value: string): { numericValue: number; integerValue: number } {
    const numericValue = Math.fround(isQ1(this.dialect) ? quakeAtof(value) : nativeAtof(value));
    return { numericValue, integerValue: nativeAtoi(value) };
  }

  find(name: string): CvarRead | undefined { return this.variables.get(this.key(name)); }
  document(name: string, documentation: CommandDocumentation): void {
    if (this.find(name) === undefined) throw new Error(`Cannot document unregistered cvar ${name}`);
    this.documents.set(this.key(name), documentation);
  }
  documentation(name: string): CommandDocumentation | undefined { return this.find(name) === undefined ? undefined : this.documents.get(this.key(name)); }
  get(name: string): CvarSnapshot | undefined { const state = this.variables.get(this.key(name)); return state === undefined ? undefined : snapshot(state); }
  variableString(name: string): string { return this.find(name)?.value ?? ""; }
  variableValue(name: string): number { return this.find(name)?.numericValue ?? 0; }
  setServerActive(active: boolean): void { this.serverActive = active; }
  setClientConnected(connected: boolean): void { this.clientConnected = connected; }
  setServerHighCharacters(enabled: boolean): void { this.highCharacters = enabled; }

  register(nameInput: string, defaultInput: string, flags = 0): CvarSnapshot | undefined {
    let name = sourceCommandText(nameInput);
    const defaultValue = sourceCommandText(defaultInput);
    if (this.dialect === "q3" && !validInfo(name)) { this.print(`invalid cvar name string: ${name}\n`); name = "BADNAME"; }
    if (isQ2(this.dialect) && (flags & 6) !== 0 && !validInfo(name)) { this.print("invalid info cvar name\n"); return undefined; }
    const key = this.key(name), existing = this.variables.get(key);
    if (existing !== undefined) {
      if (isQ1(this.dialect)) {
        if (this.consoleVariables.delete(key)) {
          existing.resetValue = defaultValue;
          existing.flags |= flags;
          if (this.dialect === "q1-quakeworld") this.propagate(existing, existing.value, true);
        } else this.print(`Can't register variable ${name}, allready defined\n`);
        return snapshot(existing);
      }
      if (this.dialect === "q3") {
        if ((existing.flags & CvarFlag.UserCreated) !== 0 && (flags & CvarFlag.UserCreated) === 0 && defaultValue.length > 0) {
          existing.flags &= ~CvarFlag.UserCreated;
          existing.resetValue = defaultValue;
          this.changedFlags |= flags;
        }
        if (existing.resetValue.length === 0) existing.resetValue = defaultValue;
      }
      if (isQ2(this.dialect) && (existing.flags & Q2CvarFlag.Custom) !== 0 && (flags & Q2CvarFlag.Custom) === 0) {
        existing.resetValue = defaultValue;
        existing.flags &= ~Q2CvarFlag.Custom;
        if ((flags & (Q2CvarFlag.ReadOnly | Q2CvarFlag.NoSet)) !== 0
          || (flags & Q2CvarFlag.Cheat) !== 0 && !this.allowCheats()
          || (flags & (Q2CvarFlag.UserInfo | Q2CvarFlag.ServerInfo)) !== 0 && !validInfo(existing.value)) {
          this.set(existing.name, defaultValue, true);
        }
      }
      existing.flags |= flags;
      if (isQ2(this.dialect) && (flags & q2NoArchive) !== 0) existing.flags &= ~Q2CvarFlag.Archive;
      if (this.dialect === "q3" && existing.latchedValue !== undefined) {
        const value = existing.latchedValue;
        existing.latchedValue = undefined;
        this.set(existing.name, value, true);
      }
      return snapshot(existing);
    }
    if (isQ1(this.dialect) && this.options.commandExists?.(name)) { this.print(`Cvar_RegisterVariable: ${name} is a command\n`); return undefined; }
    if (isQ2(this.dialect) && (flags & 6) !== 0 && !validInfo(defaultValue)) { this.print("invalid info cvar value\n"); return undefined; }
    if (this.dialect === "q3" && this.indexes.length === 1024) throw new RangeError("MAX_CVARS");
    const state: CvarState = { index: this.indexes.length, name, value: defaultValue, resetValue: defaultValue,
      latchedValue: undefined, flags, modified: true, modificationCount: 1, ...this.numbers(defaultValue), next: this.first };
    this.indexes.push(state);
    this.variables.set(key, state);
    this.first = state;
    if (this.dialect === "q1-quakeworld") this.propagate(state, defaultValue, true);
    return snapshot(state);
  }

  set(nameInput: string, valueInput: string, force = false): CvarSnapshot | undefined {
    let name = sourceCommandText(nameInput);
    if (this.dialect === "q3" && !validInfo(name)) { this.print(`invalid cvar name string: ${name}\n`); name = "BADNAME"; }
    const value = sourceCommandText(valueInput), state = this.variables.get(this.key(name));
    if (state === undefined) {
      if (isQ1(this.dialect)) { this.print(`Cvar_Set: variable ${name} not found\n`); return undefined; }
      return this.register(name, value, this.dialect === "q3" && !force ? CvarFlag.UserCreated : 0);
    }
    if (isQ1(this.dialect)) {
      this.propagate(state, value, state.value !== value);
      this.applyValue(state, value, false);
      return snapshot(state);
    }
    if (isQ2(this.dialect)) {
      if ((state.flags & 6) !== 0 && !validInfo(value)) { this.print("invalid info cvar value\n"); return snapshot(state); }
      if (!force) {
        if ((state.flags & Q2CvarFlag.ReadOnly) !== 0) { this.print(`${name} is read only.\n`); return snapshot(state); }
        if ((state.flags & Q2CvarFlag.Cheat) !== 0 && !this.allowCheats()) { this.print(`${name} is cheat protected.\n`); return snapshot(state); }
        if ((state.flags & Q2CvarFlag.NoSet) !== 0) { this.print(`${name} is write protected.\n`); return snapshot(state); }
        if ((state.flags & Q2CvarFlag.Latch) !== 0) {
          if (value === (state.latchedValue ?? state.value)) return snapshot(state);
          state.latchedValue = undefined;
          if (this.serverActive) { this.print(`${name} will be changed for next game.\n`); state.latchedValue = value; }
          else { this.applyValue(state, value, false); this.gameDirectory(state); }
          return snapshot(state);
        }
      } else state.latchedValue = undefined;
    } else {
      // Q3 checks equality before forced writes clear an outstanding latch.
      if (value === state.value) return snapshot(state);
      this.changedFlags |= state.flags;
      if (!force) {
        if ((state.flags & CvarFlag.ReadOnly) !== 0) { this.print(`${name} is read only.\n`); return snapshot(state); }
        if ((state.flags & CvarFlag.Init) !== 0) { this.print(`${name} is write protected.\n`); return snapshot(state); }
        if ((state.flags & CvarFlag.Latch) !== 0) {
          if (state.latchedValue === value) return snapshot(state);
          this.print(`${name} will be changed upon restarting.\n`);
          state.latchedValue = value;
          state.modified = true;
          state.modificationCount++;
          return snapshot(state);
        }
        if ((state.flags & CvarFlag.Cheat) !== 0) {
          const cheats = this.find("sv_cheats");
          const cheatsAllowed = this.options.cheatsAllowed?.() ?? (cheats === undefined ? this.cheatsEnabled : cheats.integerValue !== 0);
          if (!cheatsAllowed) { this.print(`${name} is cheat protected.\n`); return snapshot(state); }
        }
      } else state.latchedValue = undefined;
    }
    if (state.value !== value) {
      this.applyValue(state, value, true);
      if (isQ2(this.dialect) && (state.flags & CvarFlag.UserInfo) !== 0) this.userinfoDirty = true;
    }
    return snapshot(state);
  }

  private allowCheats(): boolean {
    const cheats = this.find("sv_cheats");
    return this.options.cheatsAllowed?.() ?? (cheats === undefined ? this.cheatsEnabled : cheats.integerValue !== 0);
  }

  setConsole(name: string, value: string): CvarSnapshot | undefined {
    const state = this.variables.get(this.key(name));
    if (isQ2(this.dialect) && state !== undefined && state.value === value) {
      state.latchedValue = undefined;
      return snapshot(state);
    }
    return this.set(name, value);
  }

  setCommandFlags(name: string, value: string, kind: "archive" | "userinfo" | "serverinfo"): void {
    const q2 = isQ2(this.dialect);
    const flag = kind === "archive" ? q2 ? Q2CvarFlag.Archive : CvarFlag.Archive
      : kind === "userinfo" ? q2 ? Q2CvarFlag.UserInfo : CvarFlag.UserInfo
      : q2 ? Q2CvarFlag.ServerInfo : CvarFlag.ServerInfo;
    let state = this.variables.get(this.key(name));
    const previousFlags = state?.flags ?? 0;
    if (kind !== "archive" && (!validInfo(name) || !validInfo(value) || q2 && (name.length >= 64 || value.length >= 64))) {
      this.print("invalid info cvar name or value\n"); return;
    }
    if (state === undefined) {
      const created = this.register(name, value, flag | (q2 ? Q2CvarFlag.Custom : 0));
      if (created === undefined) return;
      state = this.variables.get(this.key(created.name));
      if (state === undefined) return;
      if (isQ1(this.dialect)) this.consoleVariables.add(this.key(created.name));
    } else {
      this.setConsole(name, value);
      if (kind !== "archive" && (!validInfo(state.value) || q2 && state.value.length >= 64)) {
        this.print("invalid retained info cvar value\n"); return;
      }
      if (kind !== "archive" && q2) state.flags &= ~(Q2CvarFlag.UserInfo | Q2CvarFlag.ServerInfo);
      if (kind !== "archive" || !q2 || (state.flags & q2NoArchive) === 0) state.flags |= flag;
    }
    if (q2 && (state.flags & q2NoArchive) !== 0) state.flags &= ~Q2CvarFlag.Archive;
    if (kind !== "archive") {
      if (q2) { if (((previousFlags | state.flags) & Q2CvarFlag.UserInfo) !== 0) this.userinfoDirty = true; }
      else this.propagate(state, state.value, true);
    }
  }

  resetConsole(name: string, all = false): void {
    const state = this.find(name);
    if (state === undefined) return;
    if (all && (name === "game" || name === "fs_game")) return;
    if (all && (isQ2(this.dialect) ? (state.flags & (Q2CvarFlag.NoSet | Q2CvarFlag.ReadOnly)) !== 0
      : this.dialect === "q3" && (state.flags & (CvarFlag.ReadOnly | CvarFlag.Init | CvarFlag.NoRestart)) !== 0)) return;
    this.setConsole(name, state.resetValue);
  }

  fullSet(name: string, value: string, flags: number): CvarSnapshot | undefined {
    if (!isQ2(this.dialect)) throw new Error("Cvar_FullSet belongs to Quake II");
    const state = this.variables.get(this.key(name));
    if (state === undefined) return this.register(name, value, flags);
    if ((state.flags & CvarFlag.UserInfo) !== 0) this.userinfoDirty = true;
    this.applyValue(state, sourceCommandText(value), true);
    state.flags = flags;
    return snapshot(state);
  }

  setValue(name: string, value: number): CvarSnapshot | undefined {
    const text = cvarValueText(value, !isQ1(this.dialect));
    if (text.length >= 32) {
      if (isQ1(this.dialect)) throw new RangeError("Cvar_SetValue overflows source val[32]");
      this.print(`Com_sprintf: overflow of ${text.length} in 32\n`);
    }
    return this.set(name, text.slice(0, 31), this.dialect === "q3");
  }

  /** Host configuration can defer a value without changing native cvar declaration flags. */
  stage(name: string, input: string): CvarSnapshot {
    const state = this.variables.get(this.key(name)), value = sourceCommandText(input);
    if (state === undefined) throw new Error(`Cannot stage an unregistered cvar ${name}`);
    if (this.dialect === "q3" ? (state.flags & (CvarFlag.ReadOnly | CvarFlag.Init)) !== 0 : isQ2(this.dialect) && (state.flags & Q2CvarFlag.NoSet) !== 0)
      throw new Error(`Cannot stage a protected cvar ${name}`);
    if (isQ2(this.dialect) && (state.flags & 6) !== 0 && !validInfo(value)) throw new Error(`Invalid staged info cvar ${name}`);
    const pending = value === state.value ? undefined : value;
    if (state.latchedValue !== pending) {
      state.latchedValue = pending; state.modified = true; state.modificationCount++;
      if (this.dialect === "q3") this.changedFlags |= state.flags;
    }
    return snapshot(state);
  }

  applyLatched(name?: string): readonly CvarSnapshot[] {
    const changed: CvarSnapshot[] = [];
    for (let state = this.first; state !== undefined; state = state.next) {
      if ((name !== undefined && this.key(state.name) !== this.key(name)) || state.latchedValue === undefined) continue;
      const value = state.latchedValue;
      state.latchedValue = undefined;
      this.applyValue(state, value, this.dialect === "q3");
      if (isQ2(this.dialect)) this.gameDirectory(state);
      changed.push(snapshot(state));
    }
    return Object.freeze(changed);
  }

  reset(name: string, force = false): CvarSnapshot | undefined {
    const state = this.find(name);
    return state === undefined ? undefined : this.set(name, state.resetValue, force);
  }

  resetAll(): void {
    if (this.dialect !== "q3") throw new Error("cvar_restart belongs to Quake III");
    let previous: CvarState | undefined;
    while (true) {
      const state = previous === undefined ? this.first : previous.next;
      if (state === undefined) break;
      if ((state.flags & (CvarFlag.ReadOnly | CvarFlag.Init | CvarFlag.NoRestart)) !== 0) { previous = state; continue; }
      if ((state.flags & CvarFlag.UserCreated) !== 0) {
        if (previous === undefined) this.first = state.next; else previous.next = state.next;
        this.variables.delete(this.key(state.name));
        this.documents.delete(this.key(state.name));
        this.indexes[state.index] = undefined;
        state.next = undefined;
      } else { this.set(state.name, state.resetValue, true); previous = state; }
    }
  }

  setCheatsEnabled(enabled: boolean): void {
    this.cheatsEnabled = enabled;
    if (enabled || this.dialect !== "q3") return;
    for (let state = this.first; state !== undefined; state = state.next) {
      if ((state.flags & CvarFlag.Cheat) === 0) continue;
      state.latchedValue = undefined;
      this.set(state.name, state.resetValue, true);
    }
  }

  snapshots(flags = 0): readonly CvarSnapshot[] {
    const values: CvarSnapshot[] = [];
    for (let state = this.first; state !== undefined; state = state.next) if (flags === 0 || (state.flags & flags) !== 0) values.push(snapshot(state));
    return Object.freeze(values);
  }
  complete(partialInput: string): string | undefined {
    const partial = sourceCommandText(partialInput);
    if (partial.length === 0) return undefined;
    if (this.dialect !== "q1-netquake") {
      const exact = this.find(partial);
      if (exact !== undefined) return exact.name;
    }
    return this.snapshots().find(state => this.key(state.name).startsWith(this.key(partial)))?.name;
  }

  infoString(flags: number, maximumLength = this.dialect === "q3" ? 1024 : 512): string {
    let info = "";
    for (let state = this.first; state !== undefined; state = state.next) if ((state.flags & flags) !== 0) {
      if (isQ2(this.dialect) && (state.flags & Q2CvarFlag.Private) !== 0) continue;
      info = setInfoValue(info, state.name, state.value, { dialect: this.dialect, maximumLength,
        target: (flags & CvarFlag.UserInfo) !== 0 ? "client-userinfo" : "server-info", serverHighCharacters: this.highCharacters, print: text => this.print(text) });
    }
    return info;
  }
  propagatedInfo(target: CvarInfoTarget): string { return target === "client-userinfo" ? this.clientInfo : this.serverInfo; }
  archiveCommands(include: (name: string) => boolean = () => true): readonly string[] {
    const commands: string[] = [];
    for (let state = this.first; state !== undefined; state = state.next) {
      if (!include(state.name)) continue;
      if (isQ2(this.dialect) && (state.flags & q2NoArchive) !== 0) continue;
      if ((state.flags & CvarFlag.Archive) === 0 || this.dialect === "q3" && asciiFold(state.name) === "cl_cdkey") continue;
      const prefix = this.dialect === "q3" || this.consoleVariables.has(this.key(state.name)) || isQ2(this.dialect) && (state.flags & Q2CvarFlag.Custom) !== 0 ? "seta " : isQ2(this.dialect) ? "set " : "";
      commands.push(`${prefix}${state.name} "${this.dialect === "q3" ? state.latchedValue ?? state.value : state.value}"`);
    }
    return Object.freeze(commands);
  }
  writeVariables(write: (text: string) => void): void {
    for (const command of this.archiveCommands()) {
      const line = `${command}\n`;
      if (!isQ1(this.dialect) && line.length >= 1024) this.print(`Com_sprintf: overflow of ${line.length} in 1024\n`);
      write(isQ1(this.dialect) ? line : line.slice(0, 1023));
    }
  }
  takeModifiedFlags(): number { const flags = this.changedFlags; this.changedFlags = 0; return flags; }
  markModifiedFlags(flags: number): void { this.changedFlags |= flags; }
  clearModifiedFlags(flags: number): void { this.changedFlags &= ~flags; }
  clearUserinfoModified(): void { this.userinfoDirty = false; }
  addFlags(name: string, flags: number): void { const state = this.variables.get(this.key(name)); if (state !== undefined) state.flags |= flags; }
  clearModified(name: string): void { const state = this.variables.get(this.key(name)); if (state !== undefined) state.modified = false; }
  takeEffects(): readonly CvarEffect[] { const effects = this.effects; this.effects = []; return Object.freeze(effects); }

  createVm(): VmCvar {
    if (this.dialect !== "q3") throw new Error("VM cvar mirrors belong to Quake III");
    return new RegistryVmCvar(this);
  }
  registerVm(name: string, defaultValue: string, flags = 0): VmCvar { const vm = this.createVm(); vm.register(name, defaultValue, flags); return vm; }
  bindVm(name: string, defaultValue: string, flags = 0): number {
    if (this.dialect !== "q3") throw new Error("VM cvar handles belong to Quake III");
    const registered = this.register(name, defaultValue, flags);
    const state = registered === undefined ? undefined : this.variables.get(this.key(registered.name));
    if (state === undefined) throw new Error("VM cvar registration failed");
    return state.index;
  }
  readVm(handle: number): CvarSnapshot | undefined {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.indexes.length) throw new RangeError("Cvar_Update: handle out of range");
    const state = this.indexes[handle];
    return state === undefined ? undefined : snapshot(state);
  }

  private applyValue(state: CvarState, value: string, mark: boolean): void {
    if (mark) { state.modified = true; state.modificationCount++; }
    state.value = value;
    const numbers = this.numbers(value);
    state.numericValue = numbers.numericValue;
    state.integerValue = numbers.integerValue;
  }
  private emit(effect: CvarEffect): void { this.effects.push(effect); this.options.onEffect?.(effect); }
  private gameDirectory(state: CvarState): void {
    if (state.name === "game") this.emit({ kind: "game-directory", context: this.context, directory: state.value, executeAutoexec: true });
  }
  private propagate(state: CvarState, value: string, changed: boolean): void {
    if (this.dialect === "q1-netquake") {
      if ((state.flags & CvarFlag.ServerInfo) !== 0 && changed && this.serverActive) {
        this.emit({ kind: "broadcast", context: this.context, text: `"${state.name}" changed to "${value}"\n` });
      }
      return;
    }
    if (this.dialect !== "q1-quakeworld") return;
    for (const target of this.options.infoTargets ?? ["client-userinfo", "server-info"] satisfies readonly CvarInfoTarget[]) {
      const flag = target === "client-userinfo" ? CvarFlag.UserInfo : CvarFlag.ServerInfo;
      if ((state.flags & flag) === 0) continue;
      const info = setInfoValue(this.propagatedInfo(target), state.name, value, { dialect: this.dialect,
        maximumLength: target === "client-userinfo" ? 196 : 512, target, serverHighCharacters: this.highCharacters, print: text => this.print(text) });
      if (target === "client-userinfo") {
        this.clientInfo = info;
        this.emit({ kind: "userinfo", context: this.context, name: state.name, value, info,
          command: this.clientConnected ? `setinfo "${state.name}" "${value}"\n` : null });
      } else { this.serverInfo = info; this.emit({ kind: "server-info", context: this.context, name: state.name, value, info }); }
    }
  }
}
