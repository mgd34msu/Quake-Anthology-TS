import { SaveReader } from "../../persistence/value.ts";
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

export interface CvarArchiveEntry {
  readonly name: string;
  readonly value: string;
}

export interface CvarValueBinding {
  /** Return an explanation to reject the value before it enters registry state. */
  validate(value: string): string | null;
  changed(value: string): void;
}

export interface CvarAlias {
  readonly name: string;
  readonly target: string;
  readonly documentation: CommandDocumentation;
  readonly conversion: { readonly kind: "identity" } | {
    readonly kind: "converted";
    read(value: string): string;
    write(value: string): { readonly kind: "value"; readonly value: string } | { readonly kind: "invalid"; readonly message: string };
  };
}

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

function snapshot(state: CvarRead): CvarSnapshot {
  return Object.freeze({ name: state.name, value: state.value, resetValue: state.resetValue,
    latchedValue: state.latchedValue, flags: state.flags, modified: state.modified,
    modificationCount: state.modificationCount, numericValue: state.numericValue, integerValue: state.integerValue });
}

function validInfo(text: string): boolean { return !/[\\";]/.test(text); }

export class CvarRegistry {
  private readonly outputBindings = new Set<{ readonly print: (text: string) => void }>();
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
  private readonly valueBindings = new Map<string, CvarValueBinding>();
  private readonly aliases = new Map<string, CvarAlias>();
  private readonly aliasReads = new Map<string, CvarRead>();
  private readonly aliasHandles = new Map<number, string>();
  private mutationRevision = 0;

  constructor(private readonly options: CvarRegistryOptions) {
    this.dialect = options.dialect;
    this.context = options.context;
  }

  captureSaveState() { return { dialect: this.dialect, ...this.captureRegistryState() }; }
  /** Stage a new world without consuming or replaying the current world's pending effects. */
  captureWorldTransferState() { return { dialect: this.dialect, ...this.snapshotRegistryState() }; }
  prepareCandidate(print = this.options.print): { readonly cvars: CvarRegistry; validatePublication(): void; publish(): void } {
    const cvars = new CvarRegistry({ dialect: this.dialect, context: this.context,
      ...(print === undefined ? {} : { print }),
      ...(this.options.commandExists === undefined ? {} : { commandExists: this.options.commandExists }),
      ...(this.options.cheatsAllowed === undefined ? {} : { cheatsAllowed: this.options.cheatsAllowed }),
      ...(this.options.infoTargets === undefined ? {} : { infoTargets: this.options.infoTargets }) });
    for (const [name, binding] of this.valueBindings) cvars.valueBindings.set(name, { validate: binding.validate, changed: () => {} });
    return { cvars, ...this.prepareTransfer(cvars) };
  }
  prepareTransfer(candidate: CvarRegistry): { validatePublication(): void; publish(): void } {
    if (candidate === this || candidate.dialect !== this.dialect || candidate.context.session !== this.context.session)
      throw new Error("Cvar transfer requires a separate owner in the same session and dialect");
    const original = JSON.stringify(this.captureWorldTransferState());
    const revision = this.mutationRevision;
    const effects = [...this.effects], aliases = [...this.aliases], documents = [...this.documents];
    candidate.aliases.clear(); for (const [name, alias] of aliases) candidate.aliases.set(name, alias);
    candidate.aliasReads.clear();
    candidate.documents.clear(); for (const [name, document] of documents) candidate.documents.set(name, document);
    candidate.restoreSaveState(this.captureWorldTransferState());
    let published = false;
    const validatePublication = (): void => {
      if (published) throw new Error("Cvar transfer already published");
      if (revision !== this.mutationRevision || original !== JSON.stringify(this.captureWorldTransferState()) || this.effects.length !== effects.length
        || this.effects.some((effect, index) => effect !== effects[index]) || this.aliases.size !== aliases.length
        || aliases.some(([name, alias]) => this.aliases.get(name) !== alias) || this.documents.size !== documents.length
        || documents.some(([name, document]) => this.documents.get(name) !== document))
        throw new Error("Cvar owner changed during preparation");
      this.prepareRegistryRestore(candidate.captureWorldTransferState(), candidate.aliases);
    };
    return { validatePublication, publish: () => {
      validatePublication();
      const apply = this.prepareRegistryRestore(candidate.captureWorldTransferState(), candidate.aliases);
      const pending = [...candidate.effects];
      published = true;
      this.aliases.clear(); for (const [name, alias] of candidate.aliases) this.aliases.set(name, alias);
      this.documents.clear(); for (const [name, document] of candidate.documents) this.documents.set(name, document);
      apply([...effects, ...pending]);
      for (const effect of pending) this.options.onEffect?.(effect);
    } };
  }
  restoreSaveState(value: unknown): void {
    new SaveReader(value, "cvars").field("dialect").literal(this.dialect);
    this.restoreRegistryState(value);
  }
  captureQuakeCState() {
    if (!isQ1(this.dialect)) throw new Error("QC cvar save requires a Q1 registry");
    return this.captureRegistryState();
  }
  restoreQuakeCState(value: unknown): void {
    if (!isQ1(this.dialect)) throw new Error("QC cvar restore requires a Q1 registry");
    this.restoreRegistryState(value);
  }
  private captureRegistryState() {
    if (this.effects.length !== 0) throw new Error("Cvar save requires drained effects");
    return this.snapshotRegistryState();
  }
  private snapshotRegistryState() {
    return { variables: this.indexes.map(state => state === undefined ? null : { ...snapshot(state), latchedValue: state.latchedValue ?? null }),
      order: this.canonicalSnapshots().map(state => state.name), changedFlags: this.changedFlags, cheatsEnabled: this.cheatsEnabled,
      serverActive: this.serverActive, clientConnected: this.clientConnected, highCharacters: this.highCharacters,
      clientInfo: this.clientInfo, serverInfo: this.serverInfo, userinfoDirty: this.userinfoDirty, consoleVariables: [...this.consoleVariables],
      ...(this.aliasHandles.size === 0 ? {} : { aliasHandles: [...this.aliasHandles].map(([handle, name]) => ({ handle, name })) }) };
  }
  private restoreRegistryState(value: unknown): void {
    this.prepareRegistryRestore(value)([]);
  }
  private prepareRegistryRestore(value: unknown, aliases = this.aliases): (effects: readonly CvarEffect[]) => void {
    const reader = new SaveReader(value, "cvars");
    const states = reader.field("variables").list(entry => entry.nullable(item => ({ name: item.field("name").string(), value: item.field("value").string(),
      resetValue: item.field("resetValue").string(), latchedValue: item.field("latchedValue").nullable(field => field.string()) ?? undefined,
      flags: item.field("flags").integer(0), modified: item.field("modified").boolean(), modificationCount: item.field("modificationCount").integer(0),
      numericValue: item.field("numericValue").number(), integerValue: item.field("integerValue").integer() })));
    const variables = new Map<string, CvarState>(), indexes: (CvarState | undefined)[] = [];
    for (const [index, saved] of states.entries()) {
      if (saved === null) { indexes.push(undefined); continue; }
      if (aliases.has(this.key(saved.name))) reader.fail(`saved cvar ${saved.name} conflicts with an alias`);
      if (variables.has(this.key(saved.name))) reader.fail("duplicate cvar");
      const state: CvarState = { ...saved, index, next: undefined };
      indexes.push(state); variables.set(this.key(state.name), state);
    }
    const order = reader.field("order").list(item => item.string());
    if (new Set(order.map(name => this.key(name))).size !== variables.size || order.length !== variables.size) reader.fail("invalid cvar order");
    let first: CvarState | undefined;
    for (const name of [...order].reverse()) {
      const state = variables.get(this.key(name)); if (state === undefined) return reader.fail("unknown ordered cvar");
      state.next = first; first = state;
    }
    const changedFlags = reader.field("changedFlags").integer(0), cheatsEnabled = reader.field("cheatsEnabled").boolean();
    const serverActive = reader.field("serverActive").boolean(), clientConnected = reader.field("clientConnected").boolean();
    const highCharacters = reader.field("highCharacters").boolean(), clientInfo = reader.field("clientInfo").string(), serverInfo = reader.field("serverInfo").string();
    const userinfoDirty = reader.field("userinfoDirty").boolean(), consoleVariables = reader.field("consoleVariables").list(item => item.string());
    if (new Set(consoleVariables).size !== consoleVariables.length) reader.fail("duplicate console variable");
    const handlesReader = reader.field("aliasHandles"), handles = handlesReader.value === undefined ? [] : handlesReader.list(item => ({
      handle: item.field("handle").integer(0), name: item.field("name").string() }));
    const aliasHandles = new Map<number, string>();
    for (const { handle, name } of handles) {
      const alias = aliases.get(this.key(name));
      if (handle >= indexes.length || indexes[handle] !== undefined || aliasHandles.has(handle) || alias === undefined
        || alias.conversion.kind !== "converted" || !variables.has(this.key(alias.target))) reader.fail("invalid cvar alias handle");
      aliasHandles.set(handle, name);
    }
    for (const [name, binding] of this.valueBindings) {
      const state = variables.get(name);
      if (state === undefined) reader.fail(`missing bound cvar ${name}`);
      else for (const text of [state.value, state.resetValue, ...(state.latchedValue === undefined ? [] : [state.latchedValue])]) {
        const error = binding.validate(text); if (error !== null) reader.fail(`${name}: ${error}`);
      }
    }
    return effects => {
    this.mutationRevision++;
    this.variables.clear(); for (const [key, state] of variables) this.variables.set(key, state);
    this.aliasHandles.clear(); for (const [handle, name] of aliasHandles) this.aliasHandles.set(handle, name);
    this.indexes.splice(0, this.indexes.length, ...indexes); this.first = first; this.effects = [...effects];
    this.changedFlags = changedFlags; this.cheatsEnabled = cheatsEnabled; this.serverActive = serverActive; this.clientConnected = clientConnected;
    this.highCharacters = highCharacters; this.clientInfo = clientInfo; this.serverInfo = serverInfo; this.userinfoDirty = userinfoDirty;
    this.consoleVariables.clear(); for (const name of consoleVariables) this.consoleVariables.add(name);
    for (const [name, binding] of this.valueBindings) { const state = this.variables.get(name); if (state !== undefined) binding.changed(state.value); }
    };
  }

  get modifiedFlags(): number { return this.changedFlags; }
  get userinfoModified(): boolean { return this.userinfoDirty; }
  get indexCount(): number { return this.indexes.length; }
  bindOutput(print: (text: string) => void): () => void {
    const binding = { print };
    this.outputBindings.add(binding);
    return () => { this.outputBindings.delete(binding); };
  }
  private print(text: string): void {
    let output = this.options.print;
    for (const binding of this.outputBindings) output = binding.print;
    output?.(text);
  }
  private key(name: string): string { const text = sourceCommandText(name); return this.dialect === "q3" ? asciiFold(text) : text; }
  private numbers(value: string): { numericValue: number; integerValue: number } {
    const numericValue = Math.fround(isQ1(this.dialect) ? quakeAtof(value) : nativeAtof(value));
    return { numericValue, integerValue: nativeAtoi(value) };
  }

  registerAlias(alias: CvarAlias): void {
    this.mutationRevision++;
    const key = this.key(alias.name), target = this.key(alias.target);
    if (key === target || this.aliases.has(target)) throw new Error(`Cvar alias ${alias.name} must target a canonical variable, not an alias or itself`);
    if (this.variables.has(key) || this.aliases.has(key) || this.options.commandExists?.(alias.name)) throw new Error(`Cvar alias ${alias.name} is already declared`);
    if (!this.variables.has(target)) throw new Error(`Cvar alias ${alias.name} target ${alias.target} is not registered`);
    this.rejectAliasInfoFlags(alias.name, this.variables.get(target)?.flags ?? 0);
    this.aliases.set(key, alias);
  }
  canonicalName(name: string): string { return this.aliases.get(this.key(name))?.target ?? name; }
  private rejectAliasInfoFlags(name: string, flags: number): void {
    if ((flags & (CvarFlag.UserInfo | CvarFlag.ServerInfo | (this.dialect === "q3" ? CvarFlag.SystemInfo : 0))) !== 0)
      throw new Error(`Cvar alias ${name} requires an explicit protocol info-key mapping`);
  }
  private aliasValue(alias: CvarAlias, value: string): string { return alias.conversion.kind === "identity" ? value : alias.conversion.read(value); }
  private aliasWrite(alias: CvarAlias, value: string): string | undefined {
    if (alias.conversion.kind === "identity") return value;
    const converted = alias.conversion.write(value);
    if (converted.kind === "value") return converted.value;
    this.print(`${alias.name}: ${converted.message}\n`); return undefined;
  }
  find(name: string): CvarRead | undefined {
    const key = this.key(name), alias = this.aliases.get(key);
    if (alias === undefined) return this.variables.get(this.key(name));
    const state = this.variables.get(this.key(alias.target));
    if (state === undefined) return undefined;
    const existing = this.aliasReads.get(key); if (existing !== undefined) return existing;
    const current = () => this.variables.get(this.key(alias.target)) ?? state;
    const project = (value: string) => this.aliasValue(alias, value), numbers = (value: string) => this.numbers(value);
    const read = Object.freeze({ name: alias.name,
      get value() { return project(current().value); }, get resetValue() { return project(current().resetValue); },
      get latchedValue() { const value = current().latchedValue; return value === undefined ? undefined : project(value); },
      get flags() { return current().flags; }, get modified() { return current().modified; }, get modificationCount() { return current().modificationCount; },
      get numericValue() { return numbers(project(current().value)).numericValue; }, get integerValue() { return numbers(project(current().value)).integerValue; } });
    this.aliasReads.set(key, read); return read;
  }
  isConsoleCreated(name: string): boolean { return this.consoleVariables.has(this.key(this.canonicalName(name))); }
  bindValue(name: string, binding: CvarValueBinding): () => void {
    if (this.aliases.has(this.key(name))) throw new Error(`Bind the canonical cvar ${this.canonicalName(name)} instead of alias ${name}`);
    const key = this.key(name), state = this.variables.get(key);
    if (state === undefined) throw new Error(`Cannot bind unregistered cvar ${name}`);
    if (this.valueBindings.has(key)) throw new Error(`Cvar ${name} already has a value binding`);
    for (const value of [state.value, state.resetValue, ...(state.latchedValue === undefined ? [] : [state.latchedValue])]) {
      const error = binding.validate(value); if (error !== null) throw new Error(`${name}: ${error}`);
    }
    this.valueBindings.set(key, binding);
    return () => { if (this.valueBindings.get(key) === binding) this.valueBindings.delete(key); };
  }
  private validBoundValue(name: string, value: string): boolean {
    const error = this.valueBindings.get(this.key(name))?.validate(value);
    if (error === undefined || error === null) return true;
    this.print(`${name}: ${error}\n`); return false;
  }
  document(name: string, documentation: CommandDocumentation): void {
    this.mutationRevision++;
    if (this.find(name) === undefined) throw new Error(`Cannot document unregistered cvar ${name}`);
    this.documents.set(this.key(name), documentation);
  }
  documentation(name: string): CommandDocumentation | undefined { return this.find(name) === undefined ? undefined : this.documents.get(this.key(name)) ?? this.aliases.get(this.key(name))?.documentation; }
  get(name: string): CvarSnapshot | undefined { const state = this.find(name); return state === undefined ? undefined : snapshot(state); }
  variableString(name: string): string { return this.find(name)?.value ?? ""; }
  variableValue(name: string): number { return this.find(name)?.numericValue ?? 0; }
  setServerActive(active: boolean): void { if (this.serverActive !== active) this.mutationRevision++; this.serverActive = active; }
  setClientConnected(connected: boolean): void { if (this.clientConnected !== connected) this.mutationRevision++; this.clientConnected = connected; }
  setServerHighCharacters(enabled: boolean): void { if (this.highCharacters !== enabled) this.mutationRevision++; this.highCharacters = enabled; }

  register(nameInput: string, defaultInput: string, flags = 0): CvarSnapshot | undefined {
    this.mutationRevision++;
    let name = sourceCommandText(nameInput);
    // A donor declaration of an alias must not replace the canonical default or policy.
    if (this.aliases.has(this.key(name))) { this.rejectAliasInfoFlags(name, flags); return this.get(name); }
    const defaultValue = sourceCommandText(defaultInput);
    if (!this.validBoundValue(name, defaultValue)) return this.get(name);
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
    this.mutationRevision++;
    let name = sourceCommandText(nameInput);
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined) {
      const value = this.aliasWrite(alias, sourceCommandText(valueInput));
      if (value === undefined || this.set(alias.target, value, force) === undefined) return undefined;
      return this.get(name);
    }
    if (this.dialect === "q3" && !validInfo(name)) { this.print(`invalid cvar name string: ${name}\n`); name = "BADNAME"; }
    const value = sourceCommandText(valueInput), state = this.variables.get(this.key(name));
    if (!this.validBoundValue(name, value)) return undefined;
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
      if (value === state.value) { this.valueBindings.get(this.key(name))?.changed(value); return snapshot(state); }
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
    } else this.valueBindings.get(this.key(name))?.changed(value);
    return snapshot(state);
  }

  private allowCheats(): boolean {
    const cheats = this.find("sv_cheats");
    return this.options.cheatsAllowed?.() ?? (cheats === undefined ? this.cheatsEnabled : cheats.integerValue !== 0);
  }

  setConsole(name: string, value: string): CvarSnapshot | undefined {
    this.mutationRevision++;
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined) {
      const converted = this.aliasWrite(alias, sourceCommandText(value));
      if (converted === undefined || this.setConsole(alias.target, converted) === undefined) return undefined;
      return this.get(name);
    }
    const state = this.variables.get(this.key(name));
    if (isQ2(this.dialect) && state !== undefined && state.value === value) {
      state.latchedValue = undefined;
      this.valueBindings.get(this.key(name))?.changed(value);
      return snapshot(state);
    }
    return this.set(name, value);
  }

  setCommandFlags(name: string, value: string, kind: "archive" | "userinfo" | "serverinfo"): void {
    this.mutationRevision++;
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined) {
      if (kind !== "archive") { this.print(`Cvar alias ${name} requires an explicit protocol info-key mapping\n`); return; }
      const converted = this.aliasWrite(alias, sourceCommandText(value));
      if (converted !== undefined) this.setCommandFlags(alias.target, converted, kind);
      return;
    }
    if (!this.validBoundValue(name, sourceCommandText(value))) return;
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
      const created = this.register(name, value, flag | (q2 ? Q2CvarFlag.Custom : this.dialect === "q3" ? CvarFlag.UserCreated : 0));
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
    this.mutationRevision++;
    if (!isQ2(this.dialect)) throw new Error("Cvar_FullSet belongs to Quake II");
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined) {
      this.rejectAliasInfoFlags(name, flags);
      const converted = this.aliasWrite(alias, sourceCommandText(value));
      if (converted === undefined || this.fullSet(alias.target, converted, flags) === undefined) return undefined;
      return this.get(name);
    }
    const state = this.variables.get(this.key(name));
    if (!this.validBoundValue(name, sourceCommandText(value))) return state === undefined ? undefined : snapshot(state);
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
    this.mutationRevision++;
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined) {
      const value = this.aliasWrite(alias, sourceCommandText(input));
      if (value !== undefined) this.stage(alias.target, value);
      const projected = this.get(name); if (projected === undefined) throw new Error(`Cannot stage an unregistered cvar ${name}`);
      return projected;
    }
    const state = this.variables.get(this.key(name)), value = sourceCommandText(input);
    if (state === undefined) throw new Error(`Cannot stage an unregistered cvar ${name}`);
    if (!this.validBoundValue(name, value)) return snapshot(state);
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
    this.mutationRevision++;
    if (name !== undefined) name = this.canonicalName(name);
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
    this.mutationRevision++;
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
    this.mutationRevision++;
    this.cheatsEnabled = enabled;
    if (enabled || this.dialect !== "q3") return;
    for (let state = this.first; state !== undefined; state = state.next) {
      if ((state.flags & CvarFlag.Cheat) === 0) continue;
      state.latchedValue = undefined;
      this.set(state.name, state.resetValue, true);
    }
  }

  canonicalSnapshots(flags = 0): readonly CvarSnapshot[] {
    const values: CvarSnapshot[] = [];
    for (let state = this.first; state !== undefined; state = state.next) if (flags === 0 || (state.flags & flags) !== 0) values.push(snapshot(state));
    return Object.freeze(values);
  }
  snapshots(flags = 0): readonly CvarSnapshot[] {
    const values = [...this.canonicalSnapshots(flags)];
    for (const alias of this.aliases.values()) {
      const value = this.get(alias.name);
      if (value !== undefined && (flags === 0 || (value.flags & flags) !== 0)) values.push(value);
    }
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
  private *archiveStates(include: (name: string) => boolean): Generator<CvarState, void, undefined> {
    for (let state = this.first; state !== undefined; state = state.next) {
      if (!include(state.name)) continue;
      if (isQ2(this.dialect) && (state.flags & q2NoArchive) !== 0) continue;
      if ((state.flags & CvarFlag.Archive) === 0 || this.dialect === "q3" && asciiFold(state.name) === "cl_cdkey") continue;
      yield state;
    }
  }
  private archiveValue(state: CvarState): string {
    return this.dialect === "q3" ? state.latchedValue ?? state.value : state.value;
  }
  archiveEntries(include: (name: string) => boolean = () => true): readonly CvarArchiveEntry[] {
    return Object.freeze(Array.from(this.archiveStates(include), state => Object.freeze({ name: state.name, value: this.archiveValue(state) })));
  }
  applyArchive(entries: readonly CvarArchiveEntry[]): void {
    for (const entry of entries) this.setCommandFlags(entry.name, entry.value, "archive");
  }
  archiveCommands(include: (name: string) => boolean = () => true): readonly string[] {
    const commands: string[] = [];
    for (const state of this.archiveStates(include)) {
      const prefix = this.dialect === "q3" || this.consoleVariables.has(this.key(state.name)) || isQ2(this.dialect) && (state.flags & Q2CvarFlag.Custom) !== 0 ? "seta " : isQ2(this.dialect) ? "set " : "";
      commands.push(`${prefix}${state.name} "${this.archiveValue(state)}"`);
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
  takeModifiedFlags(): number { const flags = this.changedFlags; if (flags !== 0) this.mutationRevision++; this.changedFlags = 0; return flags; }
  markModifiedFlags(flags: number): void { if ((this.changedFlags | flags) !== this.changedFlags) this.mutationRevision++; this.changedFlags |= flags; }
  clearModifiedFlags(flags: number): void { if ((this.changedFlags & flags) !== 0) this.mutationRevision++; this.changedFlags &= ~flags; }
  clearUserinfoModified(): void { if (this.userinfoDirty) this.mutationRevision++; this.userinfoDirty = false; }
  addFlags(name: string, flags: number): void {
    this.mutationRevision++;
    if (this.aliases.has(this.key(name))) this.rejectAliasInfoFlags(name, flags);
    const state = this.variables.get(this.key(this.canonicalName(name))); if (state !== undefined) state.flags |= flags;
  }
  clearModified(name: string): void { const state = this.variables.get(this.key(this.canonicalName(name))); if (state?.modified) { this.mutationRevision++; state.modified = false; } }
  takeEffects(): readonly CvarEffect[] { const effects = this.effects; if (effects.length !== 0) this.mutationRevision++; this.effects = []; return Object.freeze(effects); }

  createVm(): VmCvar {
    if (this.dialect !== "q3") throw new Error("VM cvar mirrors belong to Quake III");
    return new RegistryVmCvar(this);
  }
  registerVm(name: string, defaultValue: string, flags = 0): VmCvar { const vm = this.createVm(); vm.register(name, defaultValue, flags); return vm; }
  bindVm(name: string, defaultValue: string, flags = 0): number {
    if (this.dialect !== "q3") throw new Error("VM cvar handles belong to Quake III");
    const alias = this.aliases.get(this.key(name));
    if (alias !== undefined && alias.conversion.kind === "converted") {
      this.rejectAliasInfoFlags(name, flags);
      for (const [handle, existing] of this.aliasHandles) if (this.key(existing) === this.key(name)) return handle;
      if (this.indexes.length === 1024) throw new RangeError("MAX_CVARS");
      const handle = this.indexes.length;
      this.mutationRevision++;
      this.indexes.push(undefined); this.aliasHandles.set(handle, alias.name); return handle;
    }
    const registered = this.register(name, defaultValue, flags);
    const state = registered === undefined ? undefined : this.variables.get(this.key(this.canonicalName(registered.name)));
    if (state === undefined) throw new Error("VM cvar registration failed");
    return state.index;
  }
  readVm(handle: number): CvarSnapshot | undefined {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.indexes.length) throw new RangeError("Cvar_Update: handle out of range");
    const alias = this.aliasHandles.get(handle); if (alias !== undefined) return this.get(alias);
    const state = this.indexes[handle];
    return state === undefined ? undefined : snapshot(state);
  }

  private applyValue(state: CvarState, value: string, mark: boolean): void {
    if (mark) { state.modified = true; state.modificationCount++; }
    state.value = value;
    const numbers = this.numbers(value);
    state.numericValue = numbers.numericValue;
    state.integerValue = numbers.integerValue;
    this.valueBindings.get(this.key(state.name))?.changed(value);
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
