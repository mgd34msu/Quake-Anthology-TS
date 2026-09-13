/* Synchronous command storage and dispatch adapted from quake-3-ts/core/commands.ts.
 * Family rules follow Quake/QW cmd.c and Quake II qcommon/cmd.c.
 * Extended cvar commands follow q2repro src/common/cvar.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CommandContext, CommandDialect, CommandOrigin } from "../../contracts/common.ts";
import { CvarFlag, Q2CvarFlag } from "../cvars/index.ts";
import type { CvarRead, CvarRegistry, CvarSnapshot } from "../cvars/index.ts";
import { cvarValueText } from "../cvars/numbers.ts";
import { nativeAtof, nativeAtoi } from "../numeric.ts";
import { asciiFold, expandCommandMacros, isQ1, isQ2, sourceCommandText, tokenizeCommand } from "./text.ts";
import { sourceFilter } from "./filter.ts";
import type { CommandDocumentation } from "./documentation.ts";
export { asciiFold, sourceCommandText, tokenizeCommand, expandCommandMacros } from "./text.ts";
export { sourceFilter } from "./filter.ts";

export interface CommandInvocation {
  readonly source: CommandContext;
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

export interface CommandBufferOptions {
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly cvars?: CvarRegistry;
  readonly cvarRouting?: CommandCvarRouting;
  readonly print?: (text: string) => void;
  readonly readScript?: (name: string, source: CommandContext) => string | undefined;
  readonly commandLine?: readonly string[];
  readonly clientGame?: CommandFallback;
  readonly serverGame?: CommandFallback;
  readonly ui?: CommandFallback;
  readonly forwardToServer?: CommandHandler;
  readonly maxBufferLength?: number;
  readonly maxCommandLength?: number;
  readonly builtins?: boolean;
}

interface RegisteredEntry { readonly name: string; readonly handler: CommandHandler | null; readonly documentation: CommandDocumentation | undefined; next: RegisteredEntry | undefined; }
interface AliasEntry { readonly name: string; value: string; }
interface TextChunk { readonly text: string; readonly source: CommandContext; }
interface ExecutionFrame { readonly source: CommandContext; readonly parent: ExecutionFrame | undefined; active: boolean; }

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
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  private handlers: RegisteredEntry | undefined;
  private readonly aliases: AliasEntry[] = [];
  private chunks: TextChunk[] = [];
  private deferred: TextChunk[] = [];
  private waitFrames = 0;
  private aliasCount = 0;
  private frame: ExecutionFrame | undefined;
  private tokens: readonly string[] = [];
  private readonly maximumBuffer: number;
  private readonly maximumCommand: number;

  constructor(private readonly options: CommandBufferOptions) {
    this.dialect = options.dialect;
    this.context = Object.freeze({ session: options.context.session, origin: copyOrigin(options.context.origin, options.context) });
    if (options.cvars !== undefined && (options.cvars.context.session !== this.context.session || options.cvars.dialect !== this.dialect)) {
      throw new RangeError("Commands and cvars require the same session and dialect");
    }
    this.maximumBuffer = positiveInteger(options.maxBufferLength ?? (this.dialect === "q3" ? 16384 : 8192), "maxBufferLength");
    this.maximumCommand = positiveInteger(options.maxCommandLength ?? 1024, "maxCommandLength");
    if (options.builtins !== false) this.registerBuiltins();
  }

  get pendingText(): string { return this.chunks.map(chunk => chunk.text).join(""); }
  get deferredText(): string { return this.deferred.map(chunk => chunk.text).join(""); }
  get tokenizedArguments(): readonly string[] { return this.tokens; }
  private print(text: string): void { this.options.print?.(text); }

  private cvarOwner(name: string, source: CommandContext): CvarRegistry | undefined {
    const owner = this.options.cvarRouting?.owner(name, source) ?? this.options.cvars;
    if (owner !== undefined && owner.context.session !== source.session) {
      throw new RangeError("Command cvar owner belongs to another session");
    }
    return owner;
  }
  private visibleCvars(source: CommandContext): readonly CvarRegistry[] {
    const registries = this.options.cvarRouting?.visible(source) ?? (this.options.cvars === undefined ? [] : [this.options.cvars]);
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
      if (handler !== null || this.dialect !== "q3") this.print(`Cmd_AddCommand: ${name} already defined\n`);
      return false;
    }
    if (this.dialect !== "q3" && this.cvarOwner(name, this.frame?.source ?? this.context)?.variableString(name)) {
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
  unregister(nameInput: string): boolean {
    const name = sourceCommandText(nameInput);
    let previous: RegisteredEntry | undefined;
    for (let entry = this.handlers; entry !== undefined; entry = entry.next) {
      if (entry.name === name) {
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
    const names = [...this.registeredNames(), ...(isQ2(this.dialect) || this.dialect === "q1-quakeworld" ? this.aliases.map(alias => alias.name) : [])];
    if (this.dialect !== "q1-netquake") {
      const exact = names.find(name => name === partial);
      if (exact !== undefined) return exact;
    }
    return names.find(name => this.dialect === "q3" ? asciiFold(name).startsWith(asciiFold(partial)) : name.startsWith(partial));
  }

  defineAlias(nameInput: string, textInput: string): boolean {
    if (this.dialect === "q3") throw new Error("Quake III uses vstr instead of console aliases");
    const name = sourceCommandText(nameInput), text = sourceCommandText(textInput);
    if (name.length >= 32) { this.print("Alias name is too long\n"); return false; }
    const existing = this.aliases.find(alias => alias.name === name);
    if (existing === undefined) this.aliases.unshift({ name, value: text }); else existing.value = text;
    return true;
  }
  aliasNames(): readonly string[] { return Object.freeze(this.aliases.map(alias => alias.name)); }

  append(text: string, source?: CommandContext): void { this.appendFor(text, this.inputContext(source)); }
  insert(text: string, source?: CommandContext): void { this.insertFor(text, this.inputContext(source)); }
  private inputContext(source: CommandContext | undefined): CommandContext {
    if (source === undefined) return this.frame?.source ?? this.context;
    if (source.session !== this.context.session) throw new RangeError("Command input belongs to another session");
    return Object.freeze({ session: source.session, origin: copyOrigin(source.origin, source) });
  }
  private appendFor(input: string, source: CommandContext): void {
    const text = sourceCommandText(input);
    if (this.pendingText.length + text.length >= this.maximumBuffer) { this.print("Cbuf_AddText: overflow\n"); return; }
    if (text.length > 0) this.chunks.push({ text, source });
  }
  private insertFor(input: string, source: CommandContext): void {
    const text = sourceCommandText(input) + (this.dialect === "q1-quakeworld" || this.dialect === "q3" ? "\n" : "");
    if (this.dialect === "q3") {
      if (this.pendingText.length + text.length > this.maximumBuffer) { this.print("Cbuf_InsertText overflowed\n"); return; }
    } else {
      if (text.length >= this.maximumBuffer) { this.print("Cbuf_AddText: overflow\n"); return; }
      if (this.pendingText.length + text.length > this.maximumBuffer) throw new RangeError("Cbuf_InsertText overflows source sizebuf");
    }
    if (text.length > 0) this.chunks.unshift({ text, source });
  }
  copyToDefer(): void {
    if (!isQ2(this.dialect)) throw new Error("Deferred command buffers belong to Quake II");
    this.deferred = this.chunks;
    this.chunks = [];
  }
  insertFromDefer(): void {
    if (!isQ2(this.dialect)) throw new Error("Deferred command buffers belong to Quake II");
    if (this.pendingText.length + this.deferredText.length > this.maximumBuffer) throw new RangeError("Deferred commands overflow source sizebuf");
    this.chunks = [...this.deferred, ...this.chunks];
    this.deferred = [];
  }

  execute(): number {
    if (isQ2(this.dialect)) this.aliasCount = 0;
    let executed = 0;
    while (this.chunks.length > 0) {
      if (this.dialect === "q3" && this.waitFrames !== 0) { this.waitFrames = (this.waitFrames - 1) | 0; break; }
      const first = this.chunks[0];
      if (first === undefined) break;
      const buffer = this.pendingText;
      let quoted = false, offset = 0;
      while (offset < buffer.length) {
        const character = buffer.charAt(offset);
        if (character === '"') quoted = !quoted;
        if ((!quoted && character === ";") || character === "\n" || this.dialect === "q3" && character === "\r") break;
        offset++;
      }
      if (offset >= this.maximumCommand) {
        if (this.dialect !== "q3") throw new RangeError("Command line overflows source line buffer");
        offset = this.maximumCommand - 1;
      }
      const line = buffer.slice(0, offset), consumed = offset === buffer.length ? offset : offset + 1;
      this.consume(consumed);
      executed += this.dispatch(line, first.source);
      if (this.dialect !== "q3" && this.waitFrames !== 0) { this.waitFrames = 0; break; }
    }
    return executed;
  }

  executeNow(text: string | null): number {
    const value = text === null ? "" : sourceCommandText(text);
    return value.length === 0 ? this.execute() : this.dispatch(value, this.frame?.source ?? this.context);
  }
  private consume(count: number): void {
    while (count > 0) {
      const chunk = this.chunks.shift();
      if (chunk === undefined) return;
      if (chunk.text.length > count) { this.chunks.unshift({ text: chunk.text.slice(count), source: chunk.source }); return; }
      count -= chunk.text.length;
    }
  }

  private dispatch(raw: string, source: CommandContext): number {
    const expanded = isQ2(this.dialect) ? expandCommandMacros(raw, name => {
      const owner = this.cvarOwner(name, source), variable = owner?.find(name);
      return owner !== undefined && isQ2(owner.dialect) && variable !== undefined && (variable.flags & Q2CvarFlag.Private) !== 0 ? "" : variable?.value ?? "";
    }, text => this.print(text)) : raw;
    if (expanded === undefined) { this.tokens = []; return 0; }
    const tokens = tokenizeCommand(expanded, this.dialect), name = tokens.argv[0];
    this.tokens = tokens.argv;
    if (name === undefined) return 0;
    const frame: ExecutionFrame = { source, parent: this.frame, active: true };
    this.frame = frame;
    const requireActive = (): void => { if (!frame.active || this.frame !== frame) throw new Error("Command invocation is no longer active"); };
    const command: CommandInvocation = Object.freeze({ source, dialect: this.dialect, argv: tokens.argv,
      args: Object.freeze(tokens.argv.slice(1)), argsText: tokens.argsText, raw,
      append: (text: string): void => { requireActive(); this.appendFor(text, source); },
      insert: (text: string): void => { requireActive(); this.insertFor(text, source); },
      executeNow: (text: string): number => { requireActive(); return this.executeNow(text); }, assertActive: requireActive });
    try {
      for (let entry = this.handlers; entry !== undefined; entry = entry.next) {
        if (asciiFold(entry.name) !== asciiFold(name)) continue;
        if (this.dialect === "q3") this.touch(entry);
        if (entry.handler !== null) entry.handler(command);
        else if (isQ2(this.dialect)) this.dispatch(`cmd ${raw}`, source);
        else if (this.dialect === "q3") this.fallback(command);
        else throw new Error("Quake I command registration has a null callback");
        return 1;
      }
      if (this.dialect !== "q3") {
        const alias = this.aliases.find(value => asciiFold(value.name) === asciiFold(name));
        if (alias !== undefined) {
          if (isQ2(this.dialect) && ++this.aliasCount === 16) { this.print("ALIAS_LOOP_COUNT\n"); return 1; }
          this.insertFor(alias.value, source);
          return 1;
        }
      }
      this.fallback(command);
      return 1;
    } finally { frame.active = false; this.frame = frame.parent; }
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
        this.print(this.dialect === "q3" ? `"${variable.name}" is:"${variable.value}^7" default:"${variable.resetValue}^7"\n` : `"${variable.name}" is "${variable.value}"\n`);
        if (this.dialect === "q3" && variable.latchedValue !== undefined) this.print(`latched: "${variable.latchedValue}"\n`);
      }
      else cvars.set(variable.name, value);
      return;
    }
    if (this.dialect === "q3") {
      if (this.options.clientGame?.(command) || this.options.serverGame?.(command) || this.options.ui?.(command)) return;
    }
    if (this.dialect === "q3" || isQ2(this.dialect)) { this.options.forwardToServer?.(command); return; }
    if (this.dialect !== "q1-quakeworld" || this.findCvar("cl_warncmd", command.source)?.numericValue || this.findCvar("developer", command.source)?.numericValue) this.print(`Unknown command "${name}"\n`);
  }

  private registerBuiltins(): void {
    const handlers = new Map<string, CommandHandler>();
    const documents = new Map<string, CommandDocumentation>();
    const register = (name: string, handler: CommandHandler, documentation?: CommandDocumentation): void => { handlers.set(name, handler); if (documentation !== undefined) documents.set(name, documentation); };
    const install = (): void => {
      const order = this.dialect === "q1-netquake" ? ["stuffcmds", "exec", "echo", "alias", "cmd", "wait"]
        : this.dialect === "q1-quakeworld" ? ["stuffcmds", "exec", "echo", "alias", "wait", "cmd"]
        : isQ2(this.dialect) ? ["cmdlist", "exec", "echo", "alias", "wait", "set", "cvarlist", "cmd"]
        : ["toggle", "set", "sets", "setu", "seta", "reset", "cvarlist", "cvar_restart", "cmdlist", "exec", "vstr", "echo", "wait", "cmd"];
      for (const name of [...order, ...["inc", "dec", "resetall", "seta", "setu", "sets", "reset", "toggle"].filter(name => !order.includes(name))]) {
        const handler = handlers.get(name);
        if (handler !== undefined) this.register(name, handler, documents.get(name));
      }
    };
    register("wait", command => { this.waitFrames = this.dialect === "q3" && command.argv.length === 2 ? nativeAtoi(command.argv[1] ?? "") : 1; });
    register("echo", command => { this.print(`${command.args.join(" ")}${command.args.length > 0 ? " " : ""}\n`); }, { summary: "Print text to the console.", usage: "echo <text>", examples: ["echo hello"] });
    register("cmd", command => { this.options.forwardToServer?.(command); });
    register("exec", command => {
      if (command.argv.length !== 2) { this.print("exec <filename> : execute a script file\n"); return; }
      const requested = command.argv[1] ?? "";
      const filename = this.dialect === "q3" && !requested.slice(requested.lastIndexOf("/") + 1).includes(".") ? `${requested}.cfg` : requested;
      const file = this.options.readScript?.(filename, command.source);
      if (file === undefined) { this.print(`couldn't exec ${filename}\n`); return; }
      this.print(`execing ${filename}\n`);
      let text = sourceCommandText(file);
      // Preserve the Q1 donor repair without changing NQ Cbuf_InsertText semantics.
      if (isQ1(this.dialect) && !text.endsWith("\n")) text += "\n";
      const source: CommandContext = Object.freeze({ session: command.source.session,
        origin: Object.freeze({ kind: "script", name: filename, caller: command.source.origin }) });
      this.insertFor(text, source);
    });
    if (this.dialect !== "q3") register("alias", command => {
      const name = command.argv[1];
      if (name === undefined) { this.print("Current alias commands:\n"); for (const alias of this.aliases) this.print(`${alias.name} : ${alias.value}\n`); return; }
      const args = command.argv.slice(2), text = `${args.join(" ")}${isQ1(this.dialect) && args.length > 0 ? " " : ""}\n`;
      if (text.length >= 1024) throw new RangeError("Alias body overflows source cmd[1024]");
      this.defineAlias(name, text);
    });
    if (isQ1(this.dialect)) register("stuffcmds", command => {
      if (this.dialect === "q1-netquake" && command.argv.length !== 1) { this.print("stuffcmds : execute command line parameters\n"); return; }
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
    if (!isQ1(this.dialect)) {
      register("set", command => { this.setCommand(command, 0); }, { summary: "Set a console variable.", usage: "set <variable> <value>", examples: ['set name "Player"'] });
      register("cmdlist", command => {
        const pattern = this.dialect === "q3" ? command.argv[1] : undefined;
        const names = this.registeredNames().filter(name => pattern === undefined || sourceFilter(pattern, name, false));
        for (const name of names) this.print(`${name}\n`);
        this.print(`${names.length} commands\n`);
      }, { summary: "List registered console commands.", usage: this.dialect === "q3" ? "cmdlist [pattern]" : "cmdlist", examples: ["cmdlist"] });
      register("cvarlist", command => {
        const variables = this.cvarSnapshots(command.source), pattern = this.dialect === "q3" ? command.argv[1] : undefined;
        for (const variable of variables) {
          if (pattern !== undefined && !sourceFilter(pattern, variable.name, false)) continue;
          const flag = (mask: number, marker: string): string => (variable.flags & mask) !== 0 ? marker : " ";
          const markers = this.dialect === "q3"
            ? flag(4, "S") + flag(2, "U") + flag(64, "R") + flag(16, "I") + flag(1, "A") + flag(32, "L") + flag(512, "C")
            : flag(1, "*") + flag(2, "U") + flag(4, "S") + ((variable.flags & 8) !== 0 ? "-" : flag(16, "L"));
          this.print(`${markers} ${variable.name} "${variable.value}"\n`);
        }
        const indexes = this.visibleCvars(command.source).reduce((total, registry) => total + registry.indexCount, 0);
        this.print(this.dialect === "q3" ? `\n${variables.length} total cvars\n${indexes} cvar indexes\n` : `${variables.length} cvars\n`);
      }, { summary: "List visible console variables and their current values.", usage: this.dialect === "q3" ? "cvarlist [pattern]" : "cvarlist", examples: ["cvarlist"] });
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
        cvars?.resetConsole(variable.name, true);
      }
    });
    if (this.dialect === "q3") register("vstr", command => {
      if (command.argv.length !== 2) { this.print("vstr <variablename> : execute a variable command\n"); return; }
      command.insert(`${this.findCvar(command.argv[1] ?? "", command.source)?.value ?? ""}\n`);
    });
    for (const [name, flag] of [["seta", CvarFlag.Archive], ["setu", CvarFlag.UserInfo], ["sets", CvarFlag.ServerInfo]] satisfies readonly (readonly [string, number])[]) {
      register(name, command => {
        const variable = command.argv[1];
        if (variable === undefined || command.argv.length < 3 || this.dialect === "q3" && command.argv.length !== 3) {
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
      if (this.dialect === "q3" && command.argv.length === 2) {
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
      if (command.argv.length < 2 || this.dialect === "q3" && command.argv.length !== 2) { this.print("reset <variable> : reset a cvar\n"); return; }
      const name = command.argv[1] ?? "";
      this.cvarOwner(name, command.source)?.resetConsole(name);
    });
    register("cvar_restart", command => { for (const cvars of this.visibleCvars(command.source)) if (cvars.dialect === "q3") cvars.resetAll(); });
    install();
  }
  private setCommand(command: CommandInvocation, flags: number): void {
    const cvars = this.cvarOwner(command.argv[1] ?? "", command.source);
    if (cvars === undefined) return;
    if (command.argv.length < 3 || isQ2(this.dialect) && command.argv.length > 4 || flags !== 0 && command.argv.length !== 3) { this.print("set <variable> <value>\n"); return; }
    const name = command.argv[1] ?? "", value = command.argv[2] ?? "";
    if (isQ2(this.dialect) && command.argv.length === 4) {
      const requested = command.argv[3];
      if (requested !== "u" && requested !== "s") { this.print("flags can only be 'u' or 's'\n"); return; }
      cvars.fullSet(name, value, requested === "u" ? CvarFlag.UserInfo : CvarFlag.ServerInfo);
    } else {
      let combined = value;
      if (this.dialect === "q3") {
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
      cvars.set(name, combined); cvars.addFlags(name, flags);
    }
  }
}
