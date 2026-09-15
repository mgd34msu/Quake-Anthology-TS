import { readFile } from "node:fs/promises";
import { findContentPath } from "../../content/mounts/paths.ts";
import type { CommandContext, CommandDialect, CommandOrigin } from "../../contracts/common.ts";
import type { CommandBuffer, ScriptCompletion } from "../../core/commands/index.ts";

export type StartupScriptScope = "mounted" | "user" | "base-loose" | "game-loose" | "loose" | "seat";
interface StartupScript {
  readonly name: string;
  readonly scope: StartupScriptScope;
}
export interface StartupConfigOptions {
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly hasMod: boolean;
  readonly scope?: "source" | "seat";
  readonly safeMode?: boolean;
  readonly read: (name: string, source: CommandContext, scope: StartupScriptScope) => Promise<string | undefined>;
  readonly applySelectedDefaults: () => void;
  readonly applyArchive: () => void;
  readonly applyLaunchOptions: () => void;
  readonly replayStartupVariables?: () => void;
}

function scriptDepth(origin: CommandOrigin): number {
  let depth = 0;
  while (origin.kind === "script") { depth++; origin = origin.caller; }
  return depth;
}

function startupScripts(dialect: CommandDialect, hasMod: boolean, dedicatedQuakeWorld: boolean): readonly StartupScript[] {
  if (dedicatedQuakeWorld) return [{ name: "server.cfg", scope: "user" }];
  if (dialect === "q1-netquake" || dialect === "q1-quakeworld") return [{ name: "quake.rc", scope: "mounted" }];
  if (dialect === "q3") return [
    { name: "default.cfg", scope: "mounted" }, { name: "q3config.cfg", scope: "user" }, { name: "autoexec.cfg", scope: "user" },
  ];
  if (dialect === "q2-rerelease") return [
    { name: "default.cfg", scope: "mounted" }, { name: "config.cfg", scope: "loose" },
    ...(hasMod ? [{ name: "autoexec.cfg", scope: "base-loose" } satisfies StartupScript] : []),
    { name: "autoexec.cfg", scope: "game-loose" }, { name: "postexec.cfg", scope: "loose" },
  ];
  return [
    { name: "default.cfg", scope: "mounted" }, { name: "config.cfg", scope: "user" }, { name: "autoexec.cfg", scope: "game-loose" },
  ];
}

/** Owns initial script ordering; the application supplies live owners and scoped file reads. */
export class StartupConfig {
  private readonly scripts: readonly StartupScript[];
  private readonly callerDepth: number;
  private index = 0;
  private active: StartupScript | undefined;
  private completed = false;
  private failure: { readonly error: unknown } | undefined;
  private readonly dedicatedQuakeWorld: boolean;
  private defaultsApplied = false;
  private archiveApplied = false;
  constructor(private readonly options: StartupConfigOptions) {
    let origin = options.context.origin;
    while (origin.kind === "script") origin = origin.caller;
    this.dedicatedQuakeWorld = options.dialect === "q1-quakeworld" && origin.kind === "server-console";
    this.scripts = options.scope === "seat" ? [
      { name: options.dialect === "q3" ? "q3config.cfg" : "config.cfg", scope: "seat" }, { name: "autoexec.cfg", scope: "seat" },
    ] : startupScripts(options.dialect, options.hasMod, this.dedicatedQuakeWorld);
    this.defaultsApplied = options.scope === "seat";
    this.callerDepth = scriptDepth(options.context.origin);
  }

  get restrictSharedConfiguration(): boolean {
    return this.options.scope === "seat" && (this.active?.name === "config.cfg" || this.active?.name === "q3config.cfg");
  }

  readonly readScript = (name: string, source: CommandContext): Promise<string | undefined> => {
    const depth = scriptDepth(source.origin);
    const active = this.active;
    const direct = active !== undefined && depth === this.callerDepth && name === active.name;
    const q1Default = active?.name === "quake.rc" && depth === this.callerDepth + 1
      && source.origin.kind === "script" && source.origin.name === "quake.rc" && name === "default.cfg";
    return this.options.read(name, source, direct ? active.scope : q1Default ? "mounted" : this.options.scope === "seat" ? "seat" : "user");
  };

  readonly onScriptComplete = (event: ScriptCompletion): void => {
    const active = this.active;
    if (active === undefined) return;
    const origin = event.source.origin;
    const depth = scriptDepth(origin);
    const direct = depth === this.callerDepth + 1 && event.name === active.name;
    const q1Child = active.name === "quake.rc" && depth === this.callerDepth + 2
      && origin.kind === "script" && origin.caller.kind === "script" && origin.caller.name === "quake.rc";
    if (event.result.kind === "failed") throw event.result.error;
    if (!direct && !q1Child) return;
    if (event.name === "default.cfg" && !this.defaultsApplied) {
      this.defaultsApplied = true; this.options.applySelectedDefaults();
    }
    if ((event.name === "config.cfg" || event.name === "q3config.cfg") && !this.archiveApplied) {
      this.archiveApplied = true; this.options.applyArchive();
    }
    if ((this.options.dialect === "q3" && direct && event.name === "autoexec.cfg")
      || ((this.options.dialect === "q2-classic" || this.options.dialect === "q2-rerelease") && direct && event.name === "config.cfg"))
      this.options.replayStartupVariables?.();
    if (direct) this.active = undefined;
  };

  /** Use an exclusively owned startup buffer. False means a native wait left work for another frame. */
  async executeFrame(commands: CommandBuffer, afterDispatch: () => Promise<void>, shouldContinue?: () => boolean): Promise<boolean> {
    if (this.failure !== undefined) throw this.failure.error;
    try { return await this.advanceFrame(commands, afterDispatch, shouldContinue); }
    catch (error: unknown) { this.failure = { error }; throw error; }
  }

  private async advanceFrame(commands: CommandBuffer, afterDispatch: () => Promise<void>, shouldContinue?: () => boolean): Promise<boolean> {
    if (this.completed) return true;
    if (this.dedicatedQuakeWorld && !this.archiveApplied) {
      this.defaultsApplied = true; this.options.applySelectedDefaults();
      this.archiveApplied = true; this.options.applyArchive();
    }
    while (true) {
      if (this.active === undefined) {
        const script = this.scripts[this.index];
        if (script === undefined) {
          if (!this.defaultsApplied || !this.archiveApplied) throw new Error("Startup script did not reach default and archived configuration stages");
          this.completed = true;
          this.options.applyLaunchOptions();
          return true;
        }
        this.index++;
        if (this.options.dialect === "q3" && this.options.safeMode && script.name === "q3config.cfg") {
          this.archiveApplied = true;
          continue;
        }
        this.active = script;
        commands.append(`exec ${script.name}\n`, this.options.context);
      }
      await commands.executeScriptsAsync(afterDispatch, shouldContinue);
      if (this.active !== undefined || shouldContinue?.() === false) return false;
    }
  }
}

export interface StartupScriptReaderOptions {
  readonly mounted: (name: string) => Promise<Uint8Array | undefined>;
  readonly user: (name: string, source: CommandContext) => Promise<string | undefined>;
  readonly baseLooseRoots: readonly string[];
  readonly gameLooseRoots: readonly string[];
  readonly seatRoot?: string;
}

/** Root arrays are already ordered by the selected content owner, highest priority first. */
export function createStartupScriptReader(options: StartupScriptReaderOptions): StartupConfigOptions["read"] {
  return async (name, source, scope) => {
    if (scope === "seat") {
      let origin = source.origin;
      while (origin.kind === "script") origin = origin.caller;
      if (origin.kind !== "local-seat" || options.seatRoot === undefined) return undefined;
      const path = await findContentPath(options.seatRoot, `settings/seat-${origin.seat.index}/${name}`);
      return path === null ? undefined : (await readFile(path)).toString("latin1");
    }
    if (scope === "user") return options.user(name, source);
    if (scope === "mounted") {
      const bytes = await options.mounted(name);
      return bytes === undefined ? undefined : Buffer.from(bytes).toString("latin1");
    }
    const roots = scope === "base-loose" ? options.baseLooseRoots : scope === "game-loose" ? options.gameLooseRoots
      : [...options.gameLooseRoots, ...options.baseLooseRoots];
    for (const root of roots) {
      const path = await findContentPath(root, name);
      if (path !== null) return (await readFile(path)).toString("latin1");
    }
    return undefined;
  };
}
