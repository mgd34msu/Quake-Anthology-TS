import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { InputBinding } from "../../contracts/ui.ts";
import { CvarRegistry, type CvarArchiveEntry } from "../../core/cvars/index.ts";
import { CommandBuffer, asciiFold, type CommandInvocation, type CommandCvarRouting } from "../../core/commands/index.ts";
import { SeatInput, physicalInputKey } from "../../input/seat.ts";
import { defaultBindings, namedPhysicalInput, registerBindingCommands } from "../../input/bindings.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import type { SeatSettings } from "../../settings/config.ts";
import { ApplicationConsoleRouting } from "./console.ts";
import { StartupConfig, type StartupConfigOptions } from "./startup-config.ts";
import type { ConsoleScriptFiles } from "./config-scripts.ts";

export interface PreparedSeat {
  readonly context: CommandContext;
  readonly id: SeatId;
  cvars: CvarRegistry;
  mouse: MouseSettings;
  input: SeatInput;
  readonly overriddenKeys: Set<string>;
  allBindingsChosen: boolean;
  collectingBindings: boolean;
  selectedBindings: readonly InputBinding[] | undefined;
}
export interface PreparedSeatConfiguration {
  readonly context: CommandContext;
  readonly id: SeatId;
  readonly cvars: CvarRegistry;
  readonly mouse: MouseSettings;
  readonly profile: SeatSettings | null;
  readonly archive: readonly CvarArchiveEntry[];
  readonly mouseArchive: readonly CvarArchiveEntry[];
}

/** Prepared registries and the command buffer become the live client's owners after world creation. */
export class PreparedStartup {
  commands: CommandBuffer;
  readonly seats: readonly PreparedSeat[];
  fallback: CvarRegistry;
  private routing: CommandCvarRouting;
  private active: StartupConfig | undefined;
  private scopedReader: StartupConfigOptions["read"] | undefined;
  private continuation: AsyncGenerator<void, void, void> | undefined;
  private worldAction = false;
  get pending(): boolean { return this.continuation !== undefined; }
  private readonly releaseBindings: () => void;
  private bindingsReleased = false;
  private readonly deferredCommands = ["map", "save", "load", "weapnext", "weapprev", "use", "weapon", "say", "say_team"];
  private forward: (name: string, args: readonly string[], source: CommandContext) => undefined;
  constructor(public source: CvarRegistry, public movement: CvarRegistry, public scripts: ConsoleScriptFiles,
    private readonly options: {
      readonly dialect: CommandDialect;
      readonly movementDialect: CommandDialect;
      readonly seats: readonly PreparedSeatConfiguration[];
      readonly shared: CvarRegistry | null;
      readonly sharedNames: readonly string[];
      readonly print: (text: string, source?: CommandContext) => void;
      readonly forward: (name: string, args: readonly string[], source: CommandContext) => undefined;
    }) {
    this.forward = options.forward;
    this.fallback = movement.dialect === options.dialect ? movement : new CvarRegistry({ dialect: options.dialect, context: source.context, print: text => options.print(text) });
    this.routing = new ApplicationConsoleRouting({ fallback: this.fallback, sourceDialect: () => options.dialect,
      server: () => ({ cvars: this.source, sharedNames: options.sharedNames }),
      seat: id => options.seats.find(seat => seat.id.equals(id))?.cvars ?? null,
      input: id => options.seats.find(seat => id === null || seat.id.equals(id))?.mouse.cvars ?? null,
      movement: () => this.movement, shared: () => options.shared });
    this.commands = new CommandBuffer({ dialect: options.dialect, context: source.context, cvars: this.fallback,
      cvarRouting: { owner: (name, context) => this.routing.owner(name, context), visible: context => this.routing.visible(context) },
      readScript: (name, context) => this.active?.readScript(name, context) ?? this.scripts.read(name, context),
      onScriptComplete: event => this.active?.onScriptComplete(event), print: options.print,
      allowCommand: command => this.allowCommand(command),
      forwardToServer: invocation => { this.worldAction = true; return this.forward(invocation.argv[0] ?? "", invocation.args, invocation.source); } });
    this.seats = options.seats.map(seat => ({ ...seat, input: new SeatInput({ seat: seat.id, dialect: options.movementDialect,
      context: seat.context, commands: this.commands, uiEvent: () => false }), overriddenKeys: new Set<string>(), allBindingsChosen: false, collectingBindings: false, selectedBindings: undefined }));
    for (const name of this.deferredCommands) this.commands.register(name, invocation => {
      this.worldAction = true; return this.forward(name, invocation.args, invocation.source);
    });
    this.releaseBindings = registerBindingCommands(this.commands, id => this.seats.find(seat => seat.id.equals(id))?.input ?? null, text => options.print(text));
  }
  allowCommand(command: CommandInvocation): boolean {
    if (this.pending && this.deferredCommands.includes(asciiFold(command.argv[0] ?? ""))) this.worldAction = true;
    if (!this.active?.restrictSharedConfiguration) return true;
    let script = command.source.origin, savedConfiguration = false;
    while (script.kind === "script") {
      if (script.name === "config.cfg" || script.name === "q3config.cfg") savedConfiguration = true;
      script = script.caller;
    }
    if (!savedConfiguration) return true;
    const [rawName, argument] = command.argv;
    if (rawName === undefined) return true;
    const name = asciiFold(rawName);
    if (name === "cvar_restart") {
      this.options.print("Ignoring shared cvar restart in saved secondary-seat configuration.\n", command.source); return false;
    }
    const target = ["set", "seta", "sets", "setu", "toggle", "reset"].includes(name) ? argument : name;
    if (target === undefined) return true;
    const owner = this.routing.owner(target, command.source);
    if (!["set", "seta", "sets", "setu", "toggle", "reset"].includes(name) && owner.find(target) === undefined) return true;
    let origin = command.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    const seatId = origin.kind === "local-seat" ? origin.seat : undefined;
    const seat = seatId === undefined ? undefined : this.seats.find(seat => seat.id.equals(seatId));
    if (seat !== undefined && (owner === seat.cvars || owner === seat.mouse.cvars)) return true;
    this.options.print(`Ignoring shared cvar ${target} in saved secondary-seat configuration; use autoexec.cfg for intentional shared overrides.\n`, command.source);
    return false;
  }
  noteWorldAction(): void { if (this.pending) this.worldAction = true; }
  forwardCommands(forward: PreparedStartup["forward"]): void { this.forward = forward; }
  readScript(name: string, context: CommandContext): Promise<string | undefined> { return this.active?.readScript(name, context) ?? this.scripts.read(name, context); }
  onScriptComplete(event: import("../../core/commands/index.ts").ScriptCompletion): void { this.active?.onScriptComplete(event); }
  adoptReaders(scripts: ConsoleScriptFiles, read: StartupConfigOptions["read"]): void {
    this.scripts = scripts; this.scopedReader = read;
  }
  adopt(routing: CommandCvarRouting, forward: PreparedStartup["forward"], owners?: {
    readonly commands: CommandBuffer; readonly source: CvarRegistry; readonly movement: CvarRegistry; readonly fallback: CvarRegistry;
    readonly scripts: ConsoleScriptFiles; readonly read: StartupConfigOptions["read"];
  }): void {
    if (!this.bindingsReleased) {
      this.releaseBindings();
      for (const name of this.deferredCommands) this.commands.unregister(name);
      this.bindingsReleased = true;
    }
    this.routing = routing; this.forward = forward;
    if (owners !== undefined) {
      this.commands = owners.commands; this.source = owners.source; this.movement = owners.movement; this.fallback = owners.fallback;
      this.adoptReaders(owners.scripts, owners.read);
    }
  }
  bindings(id: SeatId, selectedDefaults: readonly InputBinding[]): readonly InputBinding[] {
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat === undefined) return selectedDefaults;
    seat.selectedBindings = selectedDefaults;
    if (!seat.allBindingsChosen) for (const binding of selectedDefaults)
      if (!seat.overriddenKeys.has(physicalInputKey(binding.input))) seat.input.bind(binding);
    return seat.input.bindings;
  }
  async execute(options: Parameters<PreparedStartup["run"]>[0]): Promise<void> {
    this.scopedReader = options.read;
    this.continuation = this.run(options);
    await this.advanceFrame();
    while (this.pending && !this.worldAction) { await options.nextFrame(); await this.advanceFrame(); }
    if (this.pending) options.applyLaunchOptions();
  }
  async advanceFrame(): Promise<boolean> {
    const continuation = this.continuation;
    if (continuation === undefined) return false;
    this.worldAction = false;
    if ((await continuation.next()).done) this.continuation = undefined;
    return true;
  }
  adoptSeat(id: SeatId, input: SeatInput, cvars?: CvarRegistry, mouse?: MouseSettings): void {
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat !== undefined) { seat.input = input; if (cvars !== undefined) seat.cvars = cvars; if (mouse !== undefined) seat.mouse = mouse; }
  }
  private async *run(options: Pick<StartupConfigOptions, "read" | "hasMod" | "applyLaunchOptions"> & {
    readonly sourceArchive: readonly CvarArchiveEntry[];
    readonly movementArchive: readonly CvarArchiveEntry[];
    readonly fallbackArchive: readonly CvarArchiveEntry[];
    readonly sharedArchive: readonly CvarArchiveEntry[];
    readonly nextFrame: () => Promise<void>;
  }): AsyncGenerator<void, void, void> {
    const configurations = this.seats.length === 0 ? [undefined] : this.seats;
    for (const [index, seat] of configurations.entries()) {
      const saved = this.options.seats[index];
      if (seat !== undefined && saved === undefined) throw new Error("Startup seat configuration is missing");
      const startup = new StartupConfig({ dialect: this.options.dialect, context: seat?.context ?? this.source.context, hasMod: options.hasMod,
        scope: index === 0 ? "source" : "seat", read: (name, context, scope) => {
          const read = this.scopedReader;
          if (read === undefined) throw new Error("Startup script reader is missing");
          return read(name, context, scope);
        },
        applySelectedDefaults: () => {
          if (seat === undefined) return;
          for (const binding of seat.input.bindings) if (binding.target.kind === "command" && /^(?:weapon|impulse|use)\s/i.test(binding.target.text)) seat.input.unbind(binding.input);
          for (const binding of seat.selectedBindings ?? defaultBindings(0, this.options.movementDialect)) seat.input.bind(binding);
          seat.collectingBindings = true;
        },
        applyArchive: () => {
          if (index === 0) {
            this.source.applyArchive(options.sourceArchive); this.movement.applyArchive(options.movementArchive);
            this.fallback.applyArchive(options.fallbackArchive); this.options.shared?.applyArchive(options.sharedArchive);
          }
          if (seat === undefined || saved === undefined) return;
          seat.cvars.applyArchive(saved.archive); seat.mouse.cvars.applyArchive(saved.mouseArchive);
          if (saved.profile !== null) {
            seat.input.unbindAll(); for (const binding of saved.profile.bindings) seat.input.bind(binding);
            seat.allBindingsChosen = true; seat.mouse.write({ ...saved.profile.mouse });
            if (saved.profile.alwaysRun !== undefined) seat.mouse.cvars.setCommandFlags("cl_run", saved.profile.alwaysRun ? "1" : "0", "archive");
          }
          seat.collectingBindings = true;
        }, applyLaunchOptions: () => { if (index === configurations.length - 1) options.applyLaunchOptions(); },
      });
      this.active = startup;
      if (seat !== undefined) seat.collectingBindings = index !== 0;
      while (!await startup.executeFrame(this.commands, async () => {
        if (seat === undefined || !seat.collectingBindings) return;
        const [name, key] = this.commands.tokenizedArguments;
        if (name === "unbindall") seat.allBindingsChosen = true;
        if ((name === "bind" || name === "unbind") && key !== undefined) {
          const input = namedPhysicalInput(key); if (input !== null) seat.overriddenKeys.add(physicalInputKey(input));
        }
      }, () => !this.worldAction)) yield;
      this.active = undefined;
    }
  }
}
