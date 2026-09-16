/* Shared command storage and dispatch adapted from quake-3-ts/core/commands.ts.
 * Family rules follow Quake/QW cmd.c and Quake II qcommon/cmd.c.
 * Extended cvar commands follow q2repro src/common/cvar.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CommandContext, CommandDialect, CommandOrigin } from "../../contracts/common.ts";
import { CvarFlag, Q2CvarFlag } from "../cvars/index.ts";
import type { CvarRead, CvarRegistry, CvarSnapshot } from "../cvars/index.ts";
import { cvarValueText } from "../cvars/numbers.ts";
import { nativeAtof, nativeAtoi } from "../numeric.ts";
import { asciiFold, commandSeparatorOffset, expandCommandMacros, isQ1, isQ2, sourceCommandText, tokenizeCommand, type CommandTextMode } from "./text.ts";
import { sourceFilter } from "./filter.ts";
import type { CommandDocumentation } from "./documentation.ts";
export { asciiFold, sourceCommandText, tokenizeCommand, expandCommandMacros } from "./text.ts";
export { sourceFilter } from "./filter.ts";

export interface CommandInvocation {
  readonly source: CommandContext;
  readonly direct: boolean;
  readonly dialect: CommandDialect;
  readonly argv: readonly string[];
  readonly args: readonly string[];
  readonly argsText: string;
  readonly raw: string;
  append(text: string): void;
  insert(text: string): void;
  executeNow(text: string): number;
  assertActive(): void;
}
export type CommandHandler = (command: CommandInvocation) => undefined;
export type CommandFallback = (command: CommandInvocation) => boolean | undefined;

/** Resolves live owners; command parsing never copies or merges their variable state. */
export interface CommandCvarRouting {
  owner(name: string, source: CommandContext): CvarRegistry;
  visible(source: CommandContext): readonly CvarRegistry[];
}

export interface ScriptCompletion {
  readonly name: string;
  readonly source: CommandContext;
  readonly result: { readonly kind: "completed" } | { readonly kind: "missing" } | { readonly kind: "failed"; readonly error: unknown };
}

export interface CommandBufferOptions {
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly cvars?: CvarRegistry;
  readonly cvarRouting?: CommandCvarRouting;
  readonly print?: (text: string, source?: CommandContext) => void;
  readonly readScript?: (name: string, source: CommandContext) => string | undefined | Promise<string | undefined>;
  readonly onScriptComplete?: (event: ScriptCompletion) => void;
  readonly commandLine?: readonly string[];
  readonly startupCommandText?: string;
  readonly allowCommand?: (command: CommandInvocation) => boolean;
  readonly clientGame?: CommandFallback;
  readonly serverGame?: CommandFallback;
  readonly ui?: CommandFallback;
  readonly forwardToServer?: CommandHandler;
  readonly maxBufferLength?: number;
  readonly maxCommandLength?: number;
  readonly builtins?: boolean;
}

interface RegisteredEntry { readonly name: string; readonly handler: CommandHandler | null; readonly documentation: CommandDocumentation | undefined; next: RegisteredEntry | undefined; }
interface AliasEntry { readonly name: string; value: string; textMode: CommandTextMode; dialect: CommandDialect; }
interface TextChunk { readonly dialect: CommandDialect; readonly kind: "text"; readonly text: string; readonly source: CommandContext; readonly direct: boolean; readonly textMode: CommandTextMode; }
type CommandChunk = TextChunk | { readonly kind: "completion"; readonly event: ScriptCompletion; readonly dialect: CommandDialect; readonly textMode: CommandTextMode };
interface ExecutionFrame { readonly dialect: CommandDialect; readonly source: CommandContext; readonly direct: boolean; readonly textMode: CommandTextMode; readonly parent: ExecutionFrame | undefined; active: boolean; }
interface ScriptRead {
  readonly dialect: CommandDialect;
  readonly textMode: CommandTextMode;
  readonly settled: Promise<void>;
  readonly name: string;
  readonly source: CommandContext;
  result: { readonly kind: "pending" } | { readonly kind: "ready"; readonly text: string | undefined } | { readonly kind: "failed"; readonly error: unknown };
}

function sameOrigin(left: CommandOrigin, right: CommandOrigin): boolean {
  switch (left.kind) {
    case "local-console": case "server-console": return right.kind === left.kind;
    case "local-seat": return right.kind === "local-seat" && left.seat.equals(right.seat) && left.client.equals(right.client);
    case "remote-client": return right.kind === "remote-client" && left.client.equals(right.client);
    case "script": return right.kind === "script" && left.name === right.name && sameOrigin(left.caller, right.caller);
  }
}

function copyOrigin(origin: CommandOrigin, context: CommandContext): CommandOrigin {
  switch (origin.kind) {
    case "local-console": case "server-console": return Object.freeze({ kind: origin.kind });
    case "local-seat":
      if (origin.seat.session !== context.session || origin.client.session !== context.session) throw new RangeError("Command seat belongs to another session");
      return Object.freeze({ kind: origin.kind, seat: origin.seat, client: origin.client });
    case "remote-client":
      if (origin.client.session !== context.session) throw new RangeError("Command client belongs to another session");
      return Object.freeze({ kind: origin.kind, client: origin.client });
    case "script": return Object.freeze({ kind: origin.kind, name: origin.name, caller: copyOrigin(origin.caller, context) });
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

export class CommandBuffer {
  private currentDialect: CommandDialect;
  get dialect(): CommandDialect { return this.currentDialect; }
  private get executionDialect(): CommandDialect { return this.frame?.dialect ?? this.currentDialect; }
  private builtinDialect: CommandDialect | undefined;
  private afterDispatch = false;
  private programRevision = 0;
  private inheritedAsyncDrain = false;
  private waitDialect: CommandDialect | undefined;
  private fallbackCvars: CvarRegistry | undefined;
  private readonly builtinHandlers = new Map<string, CommandHandler>();
  readonly context: CommandContext;
  private handlers: RegisteredEntry | undefined;
  private readonly aliases: AliasEntry[] = [];
  private chunks: CommandChunk[] = [];
  private deferred: CommandChunk[] = [];
  private waitFrames = 0;
  private startupCommandText: string | undefined;
  private aliasCount = 0;
  private asyncDraining = false;
  private scriptRead: ScriptRead | undefined;
  private frame: ExecutionFrame | undefined;
  private tokens: readonly string[] = [];
  private batchBudget: { remaining: number; readonly signal: AbortSignal | undefined } | undefined;
  private maximumBuffer: number;
  private readonly maximumCommand: number;

  constructor(private readonly options: CommandBufferOptions) {
    this.currentDialect = options.dialect;
    this.fallbackCvars = options.cvars;
    this.startupCommandText = options.startupCommandText;
    this.context = Object.freeze({ session: options.context.session, origin: copyOrigin(options.context.origin, options.context) });
    if (options.cvars !== undefined && (options.cvars.context.session !== this.context.session || options.cvars.dialect !== this.executionDialect)) {
      throw new RangeError("Commands and cvars require the same session and dialect");
    }
    this.maximumBuffer = positiveInteger(options.maxBufferLength ?? (this.executionDialect === "q3" ? 16384 : 8192), "maxBufferLength");
    this.maximumCommand = positiveInteger(options.maxCommandLength ?? 1024, "maxCommandLength");
    if (options.builtins !== false) this.registerBuiltins();
  }

  get programComplete(): boolean {
    return this.frame === undefined && !this.asyncDraining && this.batchBudget === undefined && this.scriptRead === undefined
      && this.chunks.length === 0 && this.deferred.length === 0 && this.waitFrames === 0;
  }
  async advanceProgramFrame(): Promise<void> {
    if (this.frame !== undefined || this.asyncDraining || this.batchBudget !== undefined) throw new Error("Command program is already executing");
    if (this.deferred.length !== 0) this.insertFromDefer();
    if (this.chunks.length === 0 && this.scriptRead === undefined && this.waitFrames !== 0) {
      this.programRevision++; this.waitFrames = (this.waitFrames - 1) | 0; return;
    }
    await this.executeScriptsAsync(async () => {});
  }
  validateProfile(dialect: CommandDialect, cvars: CvarRegistry | undefined): void {
    if (this.frame !== undefined || this.batchBudget !== undefined || this.asyncDraining && !this.afterDispatch)
      throw new Error("Command profile requires a completed program or after-dispatch boundary");
    if (cvars !== undefined && (cvars.context.session !== this.context.session || cvars.dialect !== dialect))
      throw new Error("Command profile registry belongs to another session or dialect");
  }
  setProfile(dialect: CommandDialect, cvars: CvarRegistry | undefined): void {
    this.validateProfile(dialect, cvars);
    const sameProfile = this.currentDialect === dialect;
    this.currentDialect = dialect; this.fallbackCvars = cvars;
    this.maximumBuffer = this.options.maxBufferLength ?? (dialect === "q3" ? 16384 : 8192);
    if (sameProfile && this.options.builtins !== false) this.registerBuiltins(dialect);
    else this.selectBuiltins(dialect);
  }

  private selectBuiltins(dialect: CommandDialect): void {
    if (this.options.builtins === false || this.builtinDialect === dialect) return;
    for (const [name, handler] of this.builtinHandlers) {
      for (let entry = this.handlers; entry !== undefined; entry = entry.next) if (entry.name === name && entry.handler === handler) {
        this.unregister(name); break;
      }
    }
    this.builtinHandlers.clear();
    this.registerBuiltins(dialect);
  }

  prepareProgram(options: CommandBufferOptions): {
    readonly commands: CommandBuffer; executePreparation(run: () => Promise<void>): Promise<void>; validatePublication(): void; publish(): void;
  } {
    this.validateProfile(this.currentDialect, this.fallbackCvars);
    if (options.context.session !== this.context.session || !sameOrigin(options.context.origin, this.context.origin))
      throw new Error("Prepared command program requires the same owner");
    const commands = new CommandBuffer(options), revision = this.programRevision;
    commands.copyProgramState(this);
    commands.inheritedAsyncDrain = this.asyncDraining;
    let phase: "ready" | "preparing" | "failed" | "published" = "ready";
    const validatePublication = (): void => {
      if (phase === "published") throw new Error("Prepared command program already published");
      if (phase !== "ready") throw new Error(`Prepared command program is ${phase}`);
      this.validateProfile(this.currentDialect, this.fallbackCvars);
      if (this.programRevision !== revision) throw new Error("Authority command program changed during preparation");
      if (commands.frame !== undefined || commands.asyncDraining || commands.batchBudget !== undefined)
        throw new Error("Prepared command program is still executing");
    };
    return { commands, validatePublication, executePreparation: async run => {
      validatePublication();
      const pending = { chunks: commands.chunks, deferred: commands.deferred, waitFrames: commands.waitFrames,
        waitDialect: commands.waitDialect, scriptRead: commands.scriptRead, tokens: commands.tokens,
        aliasCount: commands.aliasCount, startupCommandText: commands.startupCommandText,
        inheritedAsyncDrain: commands.inheritedAsyncDrain };
      phase = "preparing";
      commands.chunks = []; commands.deferred = []; commands.waitFrames = 0;
      commands.waitDialect = undefined; commands.scriptRead = undefined; commands.tokens = [];
      commands.aliasCount = 0; commands.startupCommandText = undefined; commands.inheritedAsyncDrain = false;
      try {
        await run();
        if (!commands.programComplete) throw new Error("Prepared configuration has unfinished commands");
        phase = "ready";
      } catch (error) { phase = "failed"; throw error; }
      finally {
        commands.chunks = pending.chunks; commands.deferred = pending.deferred; commands.waitFrames = pending.waitFrames;
        commands.waitDialect = pending.waitDialect; commands.scriptRead = pending.scriptRead; commands.tokens = pending.tokens;
        commands.aliasCount = pending.aliasCount; commands.startupCommandText = pending.startupCommandText;
        commands.inheritedAsyncDrain = pending.inheritedAsyncDrain;
      }
    }, publish: () => {
      validatePublication(); this.copyProgramState(commands); this.programRevision++; phase = "published";
    } };
  }

  private copyProgramState(previous: CommandBuffer): void {
    this.chunks = [...previous.chunks]; this.deferred = [...previous.deferred];
    this.waitFrames = previous.waitFrames; this.waitDialect = previous.waitDialect;
    this.aliasCount = previous.aliasCount; this.tokens = previous.tokens;
    this.startupCommandText = previous.startupCommandText; this.scriptRead = previous.scriptRead;
    this.aliases.splice(0, this.aliases.length, ...previous.aliases.map(alias => ({ ...alias })));
  }

  copyPendingFrom(previous: CommandBuffer): void {
    if (this.frame !== undefined || this.asyncDraining || previous.frame !== undefined || previous.asyncDraining)
      throw new Error("Cannot copy commands during execution");
    if (this.context.session !== previous.context.session) throw new Error("Commands belong to another session");
    if (previous.pendingText.length + previous.deferredText.length >= this.maximumBuffer)
      throw new Error("Replacement command buffer cannot hold pending commands");
    this.copyProgramState(previous); this.programRevision++;
  }

  get hasPendingCommands(): boolean { return this.chunks.length > 0 || this.scriptRead !== undefined; }
  get pendingText(): string { return this.chunks.map(chunk => chunk.kind === "text" ? chunk.text : "").join(""); }
  get deferredText(): string { return this.deferred.map(chunk => chunk.kind === "text" ? chunk.text : "").join(""); }
  get tokenizedArguments(): readonly string[] { return this.tokens; }
  get maximumCommandLength(): number { return this.maximumCommand; }
  get maximumBufferLength(): number { return this.maximumBuffer; }
  get executionContext(): CommandContext | undefined { return this.frame?.source; }
  private print(text: string): void { this.options.print?.(text, this.frame?.source); }

  private cvarOwner(name: string, source: CommandContext): CvarRegistry | undefined {
    const owner = this.options.cvarRouting?.owner(name, source) ?? this.fallbackCvars;
    if (owner !== undefined && owner.context.session !== source.session) {
      throw new RangeError("Command cvar owner belongs to another session");
    }
    return owner;
  }
  private visibleCvars(source: CommandContext): readonly CvarRegistry[] {
    const registries = this.options.cvarRouting?.visible(source) ?? (this.fallbackCvars === undefined ? [] : [this.fallbackCvars]);
    for (const registry of registries) if (registry.context.session !== source.session) {
      throw new RangeError("Visible cvar owner belongs to another session");
    }
    return registries;
  }
  findCvar(name: string, source?: CommandContext): CvarRead | undefined {
    return this.cvarOwner(name, this.inputContext(source))?.find(name);
  }
  cvarSnapshots(source?: CommandContext): readonly CvarSnapshot[] {
    const context = this.inputContext(source), result: CvarSnapshot[] = [];
    for (const registry of this.visibleCvars(context)) for (const variable of registry.snapshots()) {
      if (this.cvarOwner(variable.name, context) === registry) result.push(variable);
    }
    return Object.freeze(result);
  }

  archiveCommands(source?: CommandContext): readonly string[] {
    const context = this.inputContext(source);
    return Object.freeze(this.visibleCvars(context).flatMap(registry =>
      registry.archiveCommands(name => this.cvarOwner(name, context) === registry)));
  }

  register(nameInput: string, handler: CommandHandler | null, documentation?: CommandDocumentation): boolean {
    const name = sourceCommandText(nameInput);
    if (this.exists(name)) {
      if (handler !== null || this.executionDialect !== "q3") this.print(`Cmd_AddCommand: ${name} already defined\n`);
      return false;
    }
    if (this.executionDialect !== "q3" && this.cvarOwner(name, this.frame?.source ?? this.context)?.variableString(name)) {
      this.print(`Cmd_AddCommand: ${name} already defined as a var\n`); return false;
    }
    this.handlers = { name, handler, documentation, next: this.handlers };
    return true;
  }
  registerFallbackName(name: string): boolean { return this.register(name, null); }
  exists(nameInput: string): boolean {
    const name = sourceCommandText(nameInput);
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) if (entry.name === name) return true;
    return false;
  }
  unregister(nameInput: string, expectedHandler?: CommandHandler | null): boolean {
    const name = sourceCommandText(nameInput);
    let previous: RegisteredEntry | undefined;
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) {
      if (entry.name === name) {
        if (expectedHandler !== undefined && entry.handler !== expectedHandler) return false;
        if (previous === undefined) this.handlers = entry.next; else previous.next = entry.next;
        return true;
      }
      previous = entry;
    }
    return false;
  }
  registeredNames(): readonly string[] {
    const names: string[] = [];
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) names.push(entry.name);
    return Object.freeze(names);
  }
  commandDocumentation(name: string): CommandDocumentation | undefined {
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) if (asciiFold(entry.name) === asciiFold(name)) return entry.documentation;
    return undefined;
  }
  cvarDocumentation(name: string, source?: CommandContext): CommandDocumentation | undefined {
    return this.cvarOwner(name, this.inputContext(source))?.documentation(name);
  }
  aliasValue(name: string): string | undefined { return this.aliases.find(alias => asciiFold(alias.name) === asciiFold(name))?.value; }
  completeNames(visitor: (name: string) => undefined): void {
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) visitor(entry.name);
  }
  complete(partialInput: string): string | undefined {
    const partial = sourceCommandText(partialInput);
    if (partial.length === 0) return undefined;
    const names = [...this.registeredNames(), ...(isQ2(this.executionDialect) || this.executionDialect === "q1-quakeworld" ? this.aliases.map(alias => alias.name) : [])];
    if (this.executionDialect !== "q1-netquake") {
      const exact = names.find(name => name === partial);
      if (exact !== undefined) return exact;
    }
    return names.find(name => this.executionDialect === "q3" ? asciiFold(name).startsWith(asciiFold(partial)) : name.startsWith(partial));
  }

  defineAlias(nameInput: string, textInput: string): boolean {
    if (this.executionDialect === "q3") throw new Error("Quake III uses vstr instead of console aliases");
    const name = sourceCommandText(nameInput), text = sourceCommandText(textInput);
    if (name.length >= 32) { this.print("Alias name is too long\n"); return false; }
    this.programRevision++;
    const existing = this.aliases.find(alias => alias.name === name);
    const textMode = this.frame?.textMode ?? "source";
    if (existing === undefined) this.aliases.unshift({ name, value: text, textMode, dialect: this.executionDialect }); else { existing.value = text; existing.textMode = textMode; existing.dialect = this.executionDialect; }
    return true;
  }
  aliasNames(): readonly string[] { return Object.freeze(this.executionDialect === "q3" ? [] : this.aliases.map(alias => alias.name)); }

  append(text: string, source?: CommandContext, dialect?: CommandDialect): void {
    this.appendFor(text, this.inputContext(source), undefined, undefined, dialect);
  }
  insert(text: string, source?: CommandContext): void { this.insertFor(text, this.inputContext(source)); }
  private inputContext(source: CommandContext | undefined): CommandContext {
    if (source === undefined) return this.frame?.source ?? this.context;
    if (source.session !== this.context.session) throw new RangeError("Command input belongs to another session");
    return Object.freeze({ session: source.session, origin: copyOrigin(source.origin, source) });
  }
  private inputTextMode(source: CommandContext, direct: boolean): CommandTextMode {
    if (source.origin.kind !== "local-seat" && source.origin.kind !== "local-console") return "source";
    return this.frame?.textMode ?? (direct ? "console" : "source");
  }
  private appendFor(input: string, source: CommandContext, direct = this.frame === undefined && source.origin.kind !== "script", textMode = this.inputTextMode(source, direct), dialect = this.executionDialect): void {
    const text = sourceCommandText(input);
    if (this.pendingText.length + text.length >= (this.options.maxBufferLength ?? (dialect === "q3" ? 16384 : 8192))) { this.print("Cbuf_AddText: overflow\n"); return; }
    if (text.length > 0) { this.chunks.push({ kind: "text", text, source, direct, textMode, dialect }); this.programRevision++; }
  }
  private insertFor(input: string, source: CommandContext, direct = this.frame === undefined && source.origin.kind !== "script", completion?: ScriptCompletion, textMode = this.inputTextMode(source, direct), dialect = this.executionDialect): void {
    const text = sourceCommandText(input) + (dialect === "q1-quakeworld" || dialect === "q3" ? "\n" : "");
    const limit = this.options.maxBufferLength ?? (dialect === "q3" ? 16384 : 8192);
    if (dialect === "q3") {
      if (this.pendingText.length + text.length > limit) { this.print("Cbuf_InsertText overflowed\n"); return; }
    } else {
      if (text.length >= limit) { this.print("Cbuf_AddText: overflow\n"); return; }
      if (this.pendingText.length + text.length > limit) throw new RangeError("Cbuf_InsertText overflows source sizebuf");
    }
    if (completion !== undefined || text.length > 0) this.programRevision++;
    if (completion !== undefined) this.chunks.unshift({ kind: "completion", event: completion, dialect, textMode });
    if (text.length > 0) this.chunks.unshift({ kind: "text", text, source, direct, textMode, dialect });
  }
  copyToDefer(): void {
    if (!isQ2(this.executionDialect)) throw new Error("Deferred command buffers belong to Quake II");
    this.programRevision++;
    this.deferred = this.chunks;
    this.chunks = [];
  }
  insertFromDefer(): void {
    if (!isQ2(this.executionDialect)) throw new Error("Deferred command buffers belong to Quake II");
    if (this.pendingText.length + this.deferredText.length > this.maximumBuffer) throw new RangeError("Deferred commands overflow source sizebuf");
    this.programRevision++;
    this.chunks = [...this.deferred, ...this.chunks];
    this.deferred = [];
  }

  execute(): number {
    if (this.asyncDraining || this.inheritedAsyncDrain) throw new Error("Command buffer is already draining asynchronously");
    let executed = 0;
    for (const count of this.drain()) executed += count;
    return executed;
  }

  executeAsync(afterDispatch: () => Promise<void>, shouldContinue?: () => boolean): Promise<number> {
    return this.drainAsync(afterDispatch, false, shouldContinue);
  }

  /** Await nested script reads, stopping at the same wait boundary as one frame. */
  executeScriptsAsync(afterDispatch: () => Promise<void>, shouldContinue?: () => boolean): Promise<number> {
    return this.drainAsync(afterDispatch, true, shouldContinue);
  }

  private async drainAsync(afterDispatch: () => Promise<void>, awaitScripts: boolean, shouldContinue?: () => boolean): Promise<number> {
    if (this.asyncDraining || this.inheritedAsyncDrain || this.frame !== undefined) throw new Error("Command buffer is already executing");
    this.asyncDraining = true;
    try {
      let executed = 0;
      let firstDrain = true;
      do {
        for (const count of this.drain(firstDrain, shouldContinue)) {
          executed += count; this.afterDispatch = true;
          try { await afterDispatch(); } finally { this.afterDispatch = false; }
        }
        const read = this.scriptRead;
        if (!awaitScripts || read === undefined || shouldContinue?.() === false) break;
        await read.settled;
        firstDrain = false;
      } while (true);
      return executed;
    } finally { this.asyncDraining = false; }
  }

  private *drain(resetAliases = true, shouldContinue?: () => boolean): Generator<number, void, void> {
    if (resetAliases) this.aliasCount = 0;
    while ((this.chunks.length > 0 || this.scriptRead !== undefined) && shouldContinue?.() !== false) {
      const script = this.scriptRead;
      if (script !== undefined) {
        if (script.result.kind === "pending") return;
        this.programRevision++; this.scriptRead = undefined;
        if (script.result.kind === "failed") {
          this.options.print?.(`couldn't exec ${script.name}: ${script.result.error instanceof Error ? script.result.error.message : String(script.result.error)}\n`, script.source);
          this.chunks.unshift({ kind: "completion", event: this.scriptCompletion(script.name, script.source, { kind: "failed", error: script.result.error }), dialect: script.dialect, textMode: script.textMode });
        }
        else this.insertScript(script.name, script.result.text, script.source, script.dialect, script.textMode);
        continue;
      }
      if (this.waitDialect === "q3" && this.waitFrames !== 0) { this.programRevision++; this.waitFrames = (this.waitFrames - 1) | 0; break; }
      const first = this.chunks[0];
      if (first === undefined) break;
      if (first.kind === "completion") {
        this.programRevision++; this.chunks.shift();
        const frame: ExecutionFrame = { dialect: first.dialect, source: first.event.source, direct: false,
          textMode: first.textMode, parent: this.frame, active: true };
        this.frame = frame; this.selectBuiltins(first.dialect);
        try { this.options.onScriptComplete?.(first.event); }
        finally { frame.active = false; this.frame = frame.parent; this.selectBuiltins(this.executionDialect); }
        continue;
      }
      const buffer = this.commandText(first);
      let offset = commandSeparatorOffset(buffer, first.dialect);
      if (offset >= this.maximumCommand) {
        if (first.dialect !== "q3") throw new RangeError("Command line overflows source line buffer");
        offset = this.maximumCommand - 1;
      }
      const line = buffer.slice(0, offset), consumed = offset === buffer.length ? offset : offset + 1;
      this.consume(consumed);
      const count = this.dispatch(line, first.source, first.direct, first.textMode, first.dialect);
      if (count !== 0) yield count;
      if (this.waitDialect !== "q3" && this.waitFrames !== 0) { this.programRevision++; this.waitFrames = 0; break; }
    }
  }

  executeNow(text: string | null, source?: CommandContext): number {
    const value = text === null ? "" : sourceCommandText(text);
    return value.length === 0 ? this.execute() : this.dispatch(value, this.inputContext(source), this.frame === undefined);
  }
  /** Execute a bounded batch without draining another seat's pending input. */
  executeBatch(text: string, source: CommandContext, signal?: AbortSignal): number {
    const context = this.inputContext(source), value = sourceCommandText(text);
    if (value !== text || value.length >= this.maximumBuffer) throw new RangeError("Command batch exceeds the engine buffer limit.");
    let quoted = false, length = 0;
    for (const character of value) {
      if (character === '"') quoted = !quoted;
      if ((!quoted && character === ";") || character === "\n" || this.executionDialect === "q3" && character === "\r") length = 0;
      else if (++length >= this.maximumCommand) throw new RangeError("Command batch line exceeds the engine line limit.");
    }
    if (this.batchBudget !== undefined) throw new Error("Nested command batches are not supported.");
    const saved = { chunks: this.chunks, deferred: this.deferred, waitFrames: this.waitFrames, waitDialect: this.waitDialect, aliasCount: this.aliasCount, tokens: this.tokens, scriptRead: this.scriptRead };
    this.scriptRead = undefined;
    this.chunks = []; this.deferred = []; this.waitFrames = 0; this.aliasCount = 0;
    this.batchBudget = { remaining: 128, signal };
    try {
      this.appendFor(value, context, false);
      const count = this.execute();
      if (this.chunks.length > 0 || this.deferred.length > 0 || this.scriptRead !== undefined) throw new Error("Command batch paused or deferred execution; remaining batch discarded. Use immediate commands.");
      return count;
    } finally {
      this.chunks = saved.chunks; this.deferred = saved.deferred; this.waitFrames = saved.waitFrames; this.waitDialect = saved.waitDialect;
      this.aliasCount = saved.aliasCount; this.tokens = saved.tokens; this.batchBudget = undefined;
      this.scriptRead = saved.scriptRead;
    }
  }

  private commandText(first: TextChunk): string {
    let text = "";
    for (const chunk of this.chunks) {
      if (chunk.kind !== "text" || chunk.dialect !== first.dialect || chunk.direct !== first.direct
        || chunk.textMode !== first.textMode || !sameOrigin(chunk.source.origin, first.source.origin)) break;
      text += chunk.text;
    }
    return text;
  }

  private consume(count: number): void {
    if (count > 0) this.programRevision++;
    let index = 0;
    while (count > 0) {
      const chunk = this.chunks[index];
      if (chunk === undefined) return;
      if (chunk.kind === "completion") { index++; continue; }
      if (chunk.text.length > count) {
        this.chunks[index] = { ...chunk, text: chunk.text.slice(count) };
        return;
      }
      this.chunks.splice(index, 1);
      count -= chunk.text.length;
    }
  }

  private dispatch(raw: string, source: CommandContext, direct = false, textMode = this.inputTextMode(source, direct), dialect = this.executionDialect): number {
    this.programRevision++;
    if (this.batchBudget?.signal?.aborted) throw new Error("Command batch cancelled; remaining batch discarded.");
    if (this.batchBudget !== undefined && --this.batchBudget.remaining < 0) throw new Error("Command batch exceeded 128 dispatched commands; remaining batch discarded.");
    const expanded = isQ2(dialect) ? expandCommandMacros(raw, name => {
      const owner = this.cvarOwner(name, source), variable = owner?.find(name);
      return owner !== undefined && isQ2(owner.dialect) && variable !== undefined && (variable.flags & Q2CvarFlag.Private) !== 0 ? "" : variable?.value ?? "";
    }, text => this.print(text), textMode) : raw;
    if (expanded === undefined) { this.tokens = []; return 0; }
    const tokens = tokenizeCommand(expanded, dialect, textMode), name = tokens.argv[0];
    this.tokens = tokens.argv;
    if (name === undefined) return 0;
    const frame: ExecutionFrame = { dialect, source, direct: direct && (source.origin.kind === "local-console" || source.origin.kind === "local-seat"), textMode, parent: this.frame, active: true };
    this.frame = frame;
    this.selectBuiltins(dialect);
    const requireActive = (): void => { if (!frame.active || this.frame !== frame) throw new Error("Command invocation is no longer active"); };
    const command: CommandInvocation = Object.freeze({ source, direct: frame.direct, dialect: this.executionDialect, argv: tokens.argv,
      args: Object.freeze(tokens.argv.slice(1)), argsText: tokens.argsText, raw,
      append: (text: string): void => { requireActive(); this.appendFor(text, source); },
      insert: (text: string): void => { requireActive(); this.insertFor(text, source); },
      executeNow: (text: string): number => { requireActive(); return this.executeNow(text); }, assertActive: requireActive });
    try {
      if (this.options.allowCommand?.(command) === false) return 1;
      for (let entry = this.handlers; entry !== undefined; entry = entry.next) {
        if (asciiFold(entry.name) !== asciiFold(name)) continue;
        if (this.executionDialect === "q3") this.touch(entry);
        if (entry.handler !== null) entry.handler(command);
        else if (isQ2(this.executionDialect)) this.dispatch(`cmd ${raw}`, source);
        else if (this.executionDialect === "q3") this.fallback(command);
        else throw new Error("Quake I command registration has a null callback");
        return 1;
      }
      if (this.executionDialect !== "q3") {
        const alias = this.aliases.find(value => asciiFold(value.name) === asciiFold(name));
        if (alias !== undefined) {
          if (isQ2(this.executionDialect) && ++this.aliasCount === 16) { this.print("ALIAS_LOOP_COUNT\n"); return 1; }
          this.insertFor(alias.value, source, false, undefined, alias.textMode, alias.dialect);
          return 1;
        }
      }
      this.fallback(command);
      return 1;
    } finally { frame.active = false; this.frame = frame.parent; this.selectBuiltins(this.executionDialect); }
  }
  private touch(entry: RegisteredEntry): void {
    if (entry === this.handlers) return;
    for (let previous = this.handlers; previous !== undefined; previous = previous.next) {
      if (previous.next !== entry) continue;
      previous.next = entry.next; entry.next = this.handlers; this.handlers = entry; return;
    }
  }
  private fallback(command: CommandInvocation): void {
    const name = command.argv[0] ?? "", cvars = this.cvarOwner(name, command.source), variable = cvars?.find(name);
    if (variable !== undefined && cvars !== undefined) {
      const value = command.argv[1];
      if (value === undefined) {
        this.print(this.executionDialect === "q3" ? `"${variable.name}" is:"${variable.value}^7" default:"${variable.resetValue}^7"\n` : `"${variable.name}" is "${variable.value}"\n`);
        if (this.executionDialect === "q3" && variable.latchedValue !== undefined) this.print(`latched: "${variable.latchedValue}"\n`);
      }
      else cvars.set(variable.name, value);
      return;
    }
    if (this.executionDialect === "q3") {
      if (this.options.clientGame?.(command) || this.options.serverGame?.(command) || this.options.ui?.(command)) return;
    }
    if (this.executionDialect === "q3" || isQ2(this.executionDialect)) { this.options.forwardToServer?.(command); return; }
    if (this.executionDialect !== "q1-quakeworld" || this.findCvar("cl_warncmd", command.source)?.numericValue || this.findCvar("developer", command.source)?.numericValue) this.print(`Unknown command "${name}"\n`);
  }

  private scriptCompletion(name: string, caller: CommandContext, result: ScriptCompletion["result"]): ScriptCompletion {
    const source: CommandContext = Object.freeze({ session: caller.session,
      origin: Object.freeze({ kind: "script", name, caller: caller.origin }) });
    return Object.freeze({ name, source, result });
  }

  private insertScript(filename: string, file: string | undefined, caller: CommandContext, dialect = this.executionDialect, textMode = this.frame?.textMode ?? "source"): void {
    if (file === undefined) {
      this.options.print?.(`couldn't exec ${filename}\n`, caller);
      this.chunks.unshift({ kind: "completion", event: this.scriptCompletion(filename, caller, { kind: "missing" }), dialect, textMode });
      return;
    }
    this.options.print?.(`execing ${filename}\n`, caller);
    let text = sourceCommandText(file);
    // Preserve the Q1 donor repair without changing NQ Cbuf_InsertText semantics.
    if (isQ1(dialect) && !text.endsWith("\n")) text += "\n";
    const completion = this.scriptCompletion(filename, caller, { kind: "completed" });
    this.insertFor(text, completion.source, false, completion, textMode, dialect);
  }

  private registerBuiltins(dialect = this.executionDialect): void {
    this.builtinDialect = dialect;
    const handlers = new Map<string, CommandHandler>();
    const documents = new Map<string, CommandDocumentation>();
    const register = (name: string, handler: CommandHandler, documentation?: CommandDocumentation): void => { handlers.set(name, handler); if (documentation !== undefined) documents.set(name, documentation); };
    const install = (): void => {
      const order = dialect === "q1-netquake" ? ["stuffcmds", "exec", "echo", "alias", "cmd", "wait"]
        : dialect === "q1-quakeworld" ? ["stuffcmds", "exec", "echo", "alias", "wait", "cmd"]
        : isQ2(dialect) ? ["cmdlist", "exec", "echo", "alias", "wait", "set", "cvarlist", "cmd"]
        : ["toggle", "set", "sets", "setu", "seta", "reset", "cvarlist", "cvar_restart", "cmdlist", "exec", "vstr", "echo", "wait", "cmd"];
      for (const name of [...order, ...["inc", "dec", "resetall", "seta", "setu", "sets", "reset", "toggle"].filter(name => !order.includes(name))]) {
        const handler = handlers.get(name);
        if (handler !== undefined && !this.exists(name) && this.register(name, handler, documents.get(name))) this.builtinHandlers.set(name, handler);
      }
    };
    register("wait", command => { this.programRevision++; this.waitDialect = command.dialect; this.waitFrames = this.executionDialect === "q3" && command.argv.length === 2 ? nativeAtoi(command.argv[1] ?? "") : 1; });
    register("echo", command => { this.print(`${command.args.join(" ")}${command.args.length > 0 ? " " : ""}\n`); }, { summary: "Print text to the console.", usage: "echo <text>", examples: ["echo hello"] });
    register("cmd", command => { this.options.forwardToServer?.(command); });
    register("exec", command => {
      if (command.argv.length !== 2) { this.print("exec <filename> : execute a script file\n"); return; }
      if (this.scriptRead !== undefined) { this.insertFor(`${command.raw}\n`, command.source); return; }
      const requested = command.argv[1] ?? "";
      const filename = this.executionDialect === "q3" && !requested.slice(requested.lastIndexOf("/") + 1).includes(".") ? `${requested}.cfg` : requested;
      const file = this.options.readScript?.(filename, command.source);
      if (file instanceof Promise) {
        const read: ScriptRead = { name: filename, source: command.source, dialect: command.dialect, textMode: this.frame?.textMode ?? "source", result: { kind: "pending" },
          settled: file.then(text => { read.result = { kind: "ready", text }; }, (error: unknown) => { read.result = { kind: "failed", error }; }) };
        this.programRevision++; this.scriptRead = read;
      } else this.insertScript(filename, file, command.source);
    });
    if (dialect !== "q3") register("alias", command => {
      const name = command.argv[1];
      if (name === undefined) { this.print("Current alias commands:\n"); for (const alias of this.aliases) this.print(`${alias.name} : ${alias.value}\n`); return; }
      const args = command.argv.slice(2), text = `${args.join(" ")}${isQ1(this.executionDialect) && args.length > 0 ? " " : ""}\n`;
      if (text.length >= 1024) throw new RangeError("Alias body overflows source cmd[1024]");
      this.defineAlias(name, text);
    });
    if (isQ1(dialect)) register("stuffcmds", command => {
      if (this.executionDialect === "q1-netquake" && command.argv.length !== 1) { this.print("stuffcmds : execute command line parameters\n"); return; }
      if (this.startupCommandText !== undefined) { command.insert(this.startupCommandText); return; }
      const text = (this.options.commandLine ?? []).slice(1).join(" ");
      let script = "";
      for (let offset = 0; offset < text.length; offset++) {
        if (text.charAt(offset) !== "+") continue;
        const start = ++offset;
        while (offset < text.length && text.charAt(offset) !== "+" && text.charAt(offset) !== "-") offset++;
        script += `${text.slice(start, offset)}\n`;
        offset--;
      }
      if (script.length > 0) command.insert(script);
    });
    if (!isQ1(dialect)) {
      register("set", command => { this.setCommand(command, 0); }, { summary: "Set a console variable.", usage: "set <variable> <value>", examples: ['set name "Player"'] });
      register("cmdlist", command => {
        const pattern = this.executionDialect === "q3" ? command.argv[1] : undefined;
        const names = this.registeredNames().filter(name => pattern === undefined || sourceFilter(pattern, name, false));
        for (const name of names) this.print(`${name}\n`);
        this.print(`${names.length} commands\n`);
      }, { summary: "List registered console commands.", usage: dialect === "q3" ? "cmdlist [pattern]" : "cmdlist", examples: ["cmdlist"] });
      register("cvarlist", command => {
        const variables = this.cvarSnapshots(command.source), pattern = this.executionDialect === "q3" ? command.argv[1] : undefined;
        for (const variable of variables) {
          if (pattern !== undefined && !sourceFilter(pattern, variable.name, false)) continue;
          const flag = (mask: number, marker: string): string => (variable.flags & mask) !== 0 ? marker : " ";
          const markers = this.executionDialect === "q3"
            ? flag(4, "S") + flag(2, "U") + flag(64, "R") + flag(16, "I") + flag(1, "A") + flag(32, "L") + flag(512, "C")
            : flag(1, "*") + flag(2, "U") + flag(4, "S") + ((variable.flags & 8) !== 0 ? "-" : flag(16, "L"));
          this.print(`${markers} ${variable.name} "${variable.value}"\n`);
        }
        const indexes = this.visibleCvars(command.source).reduce((total, registry) => total + registry.indexCount, 0);
        this.print(this.executionDialect === "q3" ? `\n${variables.length} total cvars\n${indexes} cvar indexes\n` : `${variables.length} cvars\n`);
      }, { summary: "List visible console variables and their current values.", usage: dialect === "q3" ? "cvarlist [pattern]" : "cvarlist", examples: ["cvarlist"] });
    }
    for (const name of ["inc", "dec"]) register(name, command => {
      const variableName = command.argv[1];
      if (variableName === undefined) { this.print(`Usage: ${name} <variable> [value]\n`); return; }
      const cvars = this.cvarOwner(variableName, command.source), variable = cvars?.find(variableName);
      if (variable === undefined || cvars === undefined) { this.print(`${variableName} is not a variable\n`); return; }
      if (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]*)$/u.test(variable.value)) {
        this.print(`"${variable.name}" is "${variable.value}", can't ${name}\n`); return;
      }
      const amount = Math.fround(command.argv[2] === undefined ? 1 : nativeAtof(command.argv[2]));
      const value = Math.fround(variable.numericValue + (name === "dec" ? -amount : amount));
      const text = value === variable.numericValue ? variable.value
        : !Number.isFinite(value) ? Number.isNaN(value) ? "nan" : value < 0 ? "-inf" : "inf"
        : Math.fround(value - Math.floor(value)) < Math.fround(1e-6) ? value.toFixed(0) : cvarValueText(value, false);
      cvars.setConsole(variable.name, text.slice(0, 31));
    });
    register("resetall", command => {
      for (const variable of this.cvarSnapshots(command.source)) {
        const cvars = this.cvarOwner(variable.name, command.source);
        if (cvars !== undefined && cvars.canonicalName(variable.name) !== variable.name) continue;
        cvars?.resetConsole(variable.name, true);
      }
    });
    if (dialect === "q3") register("vstr", command => {
      if (command.argv.length !== 2) { this.print("vstr <variablename> : execute a variable command\n"); return; }
      command.insert(`${this.findCvar(command.argv[1] ?? "", command.source)?.value ?? ""}\n`);
    });
    for (const [name, flag] of [["seta", CvarFlag.Archive], ["setu", CvarFlag.UserInfo], ["sets", CvarFlag.ServerInfo]] satisfies readonly (readonly [string, number])[]) {
      register(name, command => {
        const variable = command.argv[1];
        if (variable === undefined || command.argv.length < 3 || this.executionDialect === "q3" && command.argv.length !== 3) {
          this.print(`Usage: ${name} <variable> <value>\n`); return;
        }
        const cvars = this.cvarOwner(variable, command.source);
        if (cvars?.dialect === "q3") { this.setCommand(command, flag); return; }
        cvars?.setCommandFlags(variable, command.argv.slice(2).join(" "),
          name === "seta" ? "archive" : name === "setu" ? "userinfo" : "serverinfo");
      });
    }
    register("toggle", command => {
      const name = command.argv[1];
      if (name === undefined) { this.print("Usage: toggle <variable> [values]\n"); return; }
      const cvars = this.cvarOwner(name, command.source);
      if (this.executionDialect === "q3" && command.argv.length === 2) {
        cvars?.set(name, Math.trunc(cvars.variableValue(name)) === 0 ? "1" : "0"); return;
      }
      const variable = cvars?.find(name);
      if (variable === undefined || cvars === undefined) { this.print(`${name} is not a variable\n`); return; }
      const values = command.argv.slice(2);
      if (values.length === 0) {
        if (variable.value === "0" || variable.value === "1") cvars.setConsole(name, variable.value === "0" ? "1" : "0");
        else this.print(`"${name}" is "${variable.value}", can't toggle\n`);
      } else {
        const index = values.findIndex(value => asciiFold(value) === asciiFold(variable.value));
        const next = index < 0 ? undefined : values[(index + 1) % values.length];
        if (next === undefined) this.print(`"${name}" is "${variable.value}", can't cycle\n`);
        else cvars.setConsole(name, next);
      }
    });
    register("reset", command => {
      if (command.argv.length < 2 || this.executionDialect === "q3" && command.argv.length !== 2) { this.print("reset <variable> : reset a cvar\n"); return; }
      const name = command.argv[1] ?? "";
      this.cvarOwner(name, command.source)?.resetConsole(name);
    });
    register("cvar_restart", command => { for (const cvars of this.visibleCvars(command.source)) if (cvars.dialect === "q3") cvars.resetAll(); });
    install();
  }
  private setCommand(command: CommandInvocation, flags: number): void {
    const cvars = this.cvarOwner(command.argv[1] ?? "", command.source);
    if (cvars === undefined) return;
    if (command.argv.length < 3 || isQ2(this.executionDialect) && command.argv.length > 4 || flags !== 0 && command.argv.length !== 3) { this.print("set <variable> <value>\n"); return; }
    const name = command.argv[1] ?? "", value = command.argv[2] ?? "";
    if (isQ2(this.executionDialect) && command.argv.length === 4) {
      const requested = command.argv[3];
      if (requested !== "u" && requested !== "s") { this.print("flags can only be 'u' or 's'\n"); return; }
      cvars.fullSet(name, value, requested === "u" ? CvarFlag.UserInfo : CvarFlag.ServerInfo);
    } else {
      let combined = value;
      if (this.executionDialect === "q3") {
        combined = "";
        let length = 0;
        for (let index = 2; index < command.argv.length; index++) {
          const argument = command.argv[index] ?? "", sourceLength = Math.max(0, argument.length - 1);
          if (length + sourceLength >= 1022) break;
          combined += argument + (index !== command.argv.length - 1 ? " " : "");
          if (combined.length >= 1024) throw new RangeError("Cvar_Set overflows source combined buffer");
          length += sourceLength;
        }
      }
      if (cvars.set(name, combined) !== undefined) cvars.addFlags(name, flags);
    }
  }
}
