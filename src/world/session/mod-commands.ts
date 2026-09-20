import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import { modInstanceProvider, modSelectionKey, readModSelection, type ModSelection } from "../../contracts/mods.ts";
import type { CommandBuffer, CommandInvocation } from "../../core/commands/index.ts";
import { commandTextTail, tokenizeCommand } from "../../core/commands/text.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { ResourceScope, SessionResource } from "./resources.ts";

export interface ModCommandBinding {
  readonly selection: ModSelection;
  readonly module: ModuleIdentity;
  readonly cvars: CvarRegistry;
  readonly names?: readonly string[];
  /** Called only for this producer's original console entry or declared command. */
  invoke(command: CommandInvocation): boolean;
  readScript?(name: string): string | undefined | Promise<string | undefined>;
}

export interface ModCommandPort extends SessionResource {
  readonly producer: NonNullable<CommandContext["producer"]>;
  append(text: string, caller?: CommandContext): void;
  insert(text: string, caller?: CommandContext): void;
  executeNow(text: string | null, caller?: CommandContext): number;
}

interface Entry { readonly binding: ModCommandBinding; readonly port: ModCommandPort; }
interface PendingCommand { readonly kind: "append" | "insert"; readonly text: string; readonly source: CommandContext; readonly dialect: CommandDialect; }

export function readModCommand(raw: string): { readonly selection: ModSelection; readonly text: string } {
  const selected = tokenizeCommand(raw, "q3").argv[1], text = commandTextTail(raw, "q3", 2);
  if (selected === undefined || text.length === 0) throw new Error("Usage: modcmd PRODUCT/COMPONENT_ID <command>");
  return { selection: readModSelection(selected), text };
}

/** One registry belongs to one prepared world; Application supplies its staged or published buffer. */
export class ModCommands {
  private readonly entries = new Map<symbol, Entry>();
  private readonly selections = new Map<string, Entry>();
  private pending: PendingCommand[] = [];

  constructor(private readonly options: {
    readonly context: CommandContext;
    commands(): CommandBuffer | null;
  }) {}

  private submit(kind: PendingCommand["kind"], text: string, source: CommandContext, dialect: CommandDialect): void {
    if (source.session !== this.options.context.session) throw new Error("Staged command belongs to another session");
    const commands = this.options.commands();
    if (commands === null) { this.pending.push({ kind, text, source, dialect }); return; }
    this.flush(); commands[kind](text, source, dialect);
  }
  append(text: string, source: CommandContext, dialect: CommandDialect): void { this.submit("append", text, source, dialect); }
  insert(text: string, source: CommandContext, dialect: CommandDialect): void { this.submit("insert", text, source, dialect); }
  flush(): void {
    if (this.pending.length === 0) return;
    const commands = this.options.commands();
    if (commands === null) throw new Error("Source commands require the candidate's prepared command buffer");
    for (const entry of this.pending.splice(0)) commands[entry.kind](entry.text, entry.source, entry.dialect);
  }

  bind(binding: ModCommandBinding, resources: ResourceScope): ModCommandPort {
    resources.assertOpen();
    const key = modSelectionKey(binding.selection);
    if (binding.module.id !== modInstanceProvider(binding.selection)) throw new Error("Mod commands require their component's module identity");
    if (binding.cvars.context.session !== this.options.context.session) throw new Error("Mod command cvars belong to another session");
    if (this.selections.has(key)) throw new Error(`Mod commands are already bound: ${key}`);
    const instance = Symbol(key), producer = Object.freeze({ kind: "game-module", module: Object.freeze({ ...binding.module }), instance } satisfies NonNullable<CommandContext["producer"]>);
    const buffers = new Set<CommandBuffer>();
    let closed = false;
    const current = (): CommandBuffer | null => {
      resources.assertOpen();
      if (closed) throw new Error(`Mod commands are closed: ${key}`);
      const buffer = this.options.commands();
      if (buffer === null) return null;
      if (buffer.context.session !== this.options.context.session) throw new Error("Mod command buffer belongs to another session");
      buffers.add(buffer); return buffer;
    };
    const source = (buffer: CommandBuffer | null, caller: CommandContext | undefined): CommandContext => {
      const context = caller ?? buffer?.executionContext ?? this.options.context;
      if (context.session !== this.options.context.session) throw new Error("Mod command caller belongs to another session");
      return { session: context.session, origin: context.origin, producer };
    };
    const port: ModCommandPort = {
      producer,
      append: (text, caller) => { const buffer = current(); this.append(text, source(buffer, caller), binding.cvars.dialect); },
      insert: (text, caller) => { const buffer = current(); this.insert(text, source(buffer, caller), binding.cvars.dialect); },
      executeNow: (text, caller) => { const buffer = current();
        if (buffer === null) throw new Error("Immediate mod commands require the candidate's prepared command buffer");
        this.flush(); return buffer.executeNow(text, source(buffer, caller), binding.cvars.dialect); },
      close: () => {
        if (closed) return undefined;
        closed = true;
        this.entries.delete(instance); this.selections.delete(key);
        this.pending = this.pending.filter(entry => entry.source.producer?.instance !== instance);
        const current = this.options.commands(); if (current !== null) buffers.add(current);
        for (const buffer of buffers) buffer.discardProducer(instance);
        return undefined;
      },
    };
    const entry = { binding, port };
    this.entries.set(instance, entry); this.selections.set(key, entry);
    return resources.own(port);
  }

  private entry(source: CommandContext): Entry | null {
    const instance = source.producer?.instance;
    if (instance === undefined) return null;
    if (source.session !== this.options.context.session) throw new Error("Mod command source belongs to another session");
    const entry = this.entries.get(instance), module = source.producer?.module;
    if (entry === undefined || module === undefined) throw new Error("Mod command producer is no longer bound to this world");
    const expected = entry.port.producer.module;
    if (module.id !== expected.id || module.artifactPath !== expected.artifactPath || module.digest !== expected.digest || module.revision !== expected.revision)
      throw new Error("Mod command source differs from its admitted module");
    return entry;
  }

  cvars(source: CommandContext): CvarRegistry | null { return this.entry(source)?.binding.cvars ?? null; }
  active(source: CommandContext): boolean {
    const instance = source.producer?.instance;
    return instance !== undefined && this.entries.has(instance) && this.entry(source) !== null;
  }
  handles(name: string, source: CommandContext): boolean {
    return this.entry(source)?.binding.names?.some(command => command.toLowerCase() === name.toLowerCase()) ?? false;
  }
  readScript(name: string, source: CommandContext): string | undefined | Promise<string | undefined> {
    return this.entry(source)?.binding.readScript?.(name);
  }
  invoke(command: CommandInvocation): boolean {
    command.assertActive();
    return this.entry(command.source)?.binding.invoke(command) ?? false;
  }
  execute(selection: ModSelection, text: string, caller: CommandContext): number {
    const key = modSelectionKey(selection), entry = this.selections.get(key);
    if (entry === undefined) throw new Error(`Mod commands are unavailable: ${key}`);
    return entry.port.executeNow(text, caller);
  }
}
