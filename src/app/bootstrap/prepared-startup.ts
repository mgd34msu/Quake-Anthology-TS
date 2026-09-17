import { q3ProductMapCommands, registerQ3ProductPolicy, type Q3ProductPolicy } from "../../core/q3-product-policy.ts";
import { cdCommandDocumentation, musicCommandDocumentation } from "./audio/commands.ts";
import { startupCommandPhases } from "./startup-commands.ts";
import { registerQ1ViewCommands } from "./q1-client-settings.ts";
import { registerRunCvar } from "./shared-setting-cvars.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { InputBinding } from "../../contracts/ui.ts";
import { CvarFlag, CvarRegistry, type CvarArchiveEntry } from "../../core/cvars/index.ts";
import { CommandBuffer, asciiFold, type CommandInvocation, type CommandCvarRouting, type CommandBufferOptions } from "../../core/commands/index.ts";
import { SeatInput, physicalInputKey } from "../../input/seat.ts";
import { defaultBindings, namedPhysicalInput, registerBindingCommands, type BindingCommandSeat } from "../../input/bindings.ts";
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
  readonly input: SeatInput;
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

export interface PreparedConfigurationContinuation {
  readonly active: StartupConfig | null;
  advance(owner: PreparedStartup): Promise<boolean>;
}

/** Prepared registries and the command buffer become the live client's owners after world creation. */
export class PreparedStartup {
  private readonly outputBindings = new Set<{ readonly print: (text: string, source?: CommandContext) => void }>();
  private readonly registryOutputs = new Map<CvarRegistry, () => void>();
  private releaseView: () => void;
  readonly commands: CommandBuffer;
  private seatOwners: PreparedSeat[] = [];
  private activeSeatIds: readonly SeatId[] = [];
  private get activeSeats(): readonly PreparedSeat[] { return this.seats.filter(seat => this.activeSeatIds.some(id => id.equals(seat.id))); }
  get seats(): readonly PreparedSeat[] { return this.seatOwners; }
  fallback: CvarRegistry;
  private routing: CommandCvarRouting;
  private active: StartupConfig | undefined;
  private readonly profileContinuations: PreparedConfigurationContinuation[] = [];
  private get currentStartup(): StartupConfig | undefined { const profile = this.profileContinuations.at(-1); return profile === undefined ? this.active : profile.active ?? undefined; }
  get sharedCvars(): CvarRegistry | null { return this.options.shared; }
  get configurationCanContinue(): boolean { return !this.worldAction; }
  readConfiguration(name: string, context: CommandContext, scope: Parameters<StartupConfigOptions["read"]>[2]): Promise<string | undefined> {
    if (this.scopedReader === undefined) throw new Error("Startup script reader is missing");
    return this.scopedReader(name, context, scope);
  }
  adoptConfigurationContinuation(continuation: PreparedConfigurationContinuation): void {
    if (!this.commands.hasPreparationPrefix) throw new Error("Configuration continuation requires its published command prefix");
    this.profileContinuations.push(continuation);
  }
  private scopedReader: StartupConfigOptions["read"] | undefined;
  private continuation: AsyncGenerator<void, void, void> | undefined;
  private worldAction = false;
  get pending(): boolean { return this.profileContinuations.length !== 0 || this.continuation !== undefined; }
  private readonly q3Policy: Q3ProductPolicy;
  private readonly deferredCommands = ["map", "save", "load", "weapnext", "weapprev", "use", "weapon", "say", "say_team"];
  private forward: (name: string, args: readonly string[], source: CommandContext) => undefined;
  constructor(public source: CvarRegistry, public movement: CvarRegistry, public scripts: ConsoleScriptFiles,
    private readonly options: {
      readonly startupCommands?: readonly string[];
      readonly q3Policy?: Q3ProductPolicy;
      readonly dialect: CommandDialect;
      readonly movementDialect: CommandDialect;
      readonly seats: readonly PreparedSeatConfiguration[];
      readonly shared: CvarRegistry | null;
      readonly sharedNames: readonly string[];
      readonly print: (text: string, source?: CommandContext) => void;
      readonly forward: (name: string, args: readonly string[], source: CommandContext) => undefined;
    }) {
    this.forward = options.forward;
    this.q3Policy = options.q3Policy ?? (options.dialect === "q3" ? registerQ3ProductPolicy(source) : { kind: "retail" });
    if (options.dialect === "q3") this.deferredCommands.push(...q3ProductMapCommands(this.q3Policy).filter(name => name !== "map"));
    for (const seat of options.seats) registerRunCvar(seat.mouse.cvars, options.movementDialect);
    this.fallback = movement.dialect === options.dialect ? movement : new CvarRegistry({ dialect: options.dialect, context: source.context, print: text => this.print(text) });
    this.routing = new ApplicationConsoleRouting({ fallback: this.fallback, sourceDialect: () => options.dialect,
      server: () => ({ cvars: this.source, sharedNames: options.sharedNames }),
      seat: id => options.seats.find(seat => seat.id.equals(id))?.cvars ?? null,
      input: id => options.seats.find(seat => id === null || seat.id.equals(id))?.mouse.cvars ?? null,
      movement: () => this.movement, shared: () => options.shared });
    const phases = startupCommandPhases(options.startupCommands ?? [], options.dialect);
    this.commands = new CommandBuffer({ startupCommandText: phases.stuffed, dialect: options.dialect, context: source.context, cvars: this.fallback,
      cvarRouting: { owner: (name, context) => this.routing.owner(name, context), visible: context => this.routing.visible(context) },
      readScript: (name, context) => this.readScript(name, context),
      onScriptComplete: event => this.currentStartup?.onScriptComplete(event), print: (text, source) => this.print(text, source),
      allowCommand: command => this.allowCommand(command),
      forwardToServer: invocation => { this.worldAction = true; return this.forward(invocation.argv[0] ?? "", invocation.args, invocation.source); } });
    this.seatOwners = options.seats.map(seat => ({ ...seat, input: new SeatInput({ seat: seat.id, dialect: options.movementDialect,
      context: seat.context, commands: this.commands, uiEvent: () => false }), overriddenKeys: new Set<string>(), allBindingsChosen: false, collectingBindings: false, selectedBindings: undefined }));
    this.activeSeatIds = this.seats.map(seat => seat.id);
    for (const name of this.deferredCommands) this.commands.register(name, invocation => {
      this.worldAction = true; return this.forward(name, invocation.args, invocation.source);
    });
    for (const name of ["in_restart", "midiinfo", "local_join", "local_drop", "downloadstatus", "stopdownload", "retrydownload", "demopause"])
      this.commands.register(name, invocation => this.forward(name, invocation.args, invocation.source));
    this.commands.register("snd_restart", invocation => this.forward("snd_restart", invocation.args, invocation.source));
    this.commands.register("cd", invocation => this.forward("cd", invocation.args, invocation.source), cdCommandDocumentation);
    this.commands.register("music", invocation => this.forward("music", invocation.args, invocation.source), musicCommandDocumentation);
    registerBindingCommands(this.commands, id => this.seats.find(seat => seat.id.equals(id))?.input ?? null, text => this.print(text));
    this.releaseView = registerQ1ViewCommands(this.commands);
  }
  bindOutput(print: (text: string, source?: CommandContext) => void): () => void {
    const binding = { print };
    this.outputBindings.add(binding);
    this.refreshRegistryOutput();
    return () => {
      if (this.outputBindings.delete(binding)) this.refreshRegistryOutput();
    };
  }
  private print(text: string, source?: CommandContext): void {
    const context = source ?? this.commands?.executionContext;
    if (context !== undefined && !this.currentContext(context)) return;
    let output = this.options.print;
    for (const binding of this.outputBindings) output = binding.print;
    output(text, context);
  }
  private currentContext(context: CommandContext): boolean {
    let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind !== "local-seat") return true;
    const source = origin;
    return this.activeSeatIds.some(id => id.equals(source.seat)) && this.seats.some(seat => seat.id.equals(source.seat) && seat.context.origin.kind === "local-seat"
      && seat.context.origin.client.equals(source.client));
  }
  private refreshRegistryOutput(): void {
    const registries = new Set<CvarRegistry>();
    if (this.outputBindings.size !== 0) {
      registries.add(this.source); registries.add(this.movement); registries.add(this.fallback);
      for (const context of [this.source.context, ...this.activeSeats.map(seat => seat.context)].filter(context => this.currentContext(context)))
        for (const registry of this.routing.visible(context)) registries.add(registry);
    }
    for (const [registry, release] of this.registryOutputs) if (!registries.has(registry)) {
      release(); this.registryOutputs.delete(registry);
    }
    for (const registry of registries) if (!this.registryOutputs.has(registry))
      this.registryOutputs.set(registry, registry.bindOutput(text => this.print(text, this.commands.executionContext ?? registry.context)));
  }
  allowCommand(command: CommandInvocation): boolean {
    const name = asciiFold(command.argv[0] ?? "");
    if (this.options.dialect === "q3" && ["devmap", "spmap", "spdevmap"].includes(name) && !q3ProductMapCommands(this.q3Policy).includes(name)) {
      this.print(`Unknown command "${name}"\n`, command.source); return false;
    }
    if (!this.currentContext(command.source)) {
      this.options.print("Command ignored because its local client is inactive or has retired.\n"); return false;
    }
    if (this.pending && this.deferredCommands.includes(asciiFold(command.argv[0] ?? ""))) this.worldAction = true;
    if (!this.currentStartup?.restrictSharedConfiguration) return true;
    return allowSeatConfigurationCommand(command, this.routing, this.seats, (text, source) => this.print(text, source));
  }
  isConfigurationSource(source: CommandContext): boolean { return this.currentStartup?.ownsSource(source) ?? false; }
  noteWorldAction(): void { if (this.pending) this.worldAction = true; }
  prepareClientCommands(options: CommandBufferOptions, inputs: readonly Pick<PreparedSeat, "id" | "input" | "context">[] = this.seats): PreparedClientCommands {
    const contexts = [this.source.context, this.commands.context, ...this.activeSeats.map(seat => seat.context)].filter(context => this.currentContext(context));
    const liveRegistries = new Set([this.source, this.movement, this.fallback,
      ...this.seats.flatMap(seat => [seat.cvars, seat.mouse.cvars]),
      ...contexts.flatMap(context => this.routing.visible(context))]);
    return prepareClientCommands(this.commands, inputs, liveRegistries, options);
  }
  publishSeats(seats: readonly Pick<PreparedSeat, "id" | "input" | "context" | "cvars" | "mouse">[], activeSeatIds: readonly SeatId[] = seats.map(seat => seat.id)): void {
    for (const id of activeSeatIds) if (!seats.some(seat => seat.id.equals(id))) throw new Error("Active seat is not retained by this client");
    this.seatOwners = seats.map(seat => {
      const previous = this.seats.find(prior => prior.id.equals(seat.id) && prior.input === seat.input);
      if (previous !== undefined) { previous.cvars = seat.cvars; previous.mouse = seat.mouse; return previous; }
      return { ...seat, overriddenKeys: new Set<string>(), allBindingsChosen: true, collectingBindings: false, selectedBindings: undefined };
    });
    this.setActiveSeats(activeSeatIds);
  }
  setActiveSeats(ids: readonly SeatId[]): void {
    for (const id of ids) if (!this.seats.some(seat => seat.id.equals(id))) throw new Error("Active seat is not retained by this client");
    this.activeSeatIds = [...ids];
    this.refreshRegistryOutput();
  }
  forwardCommands(forward: PreparedStartup["forward"]): void { this.forward = forward; }
  readScript(name: string, context: CommandContext): Promise<string | undefined> {
    if (!this.currentContext(context)) return Promise.resolve(undefined);
    return this.currentStartup?.readScript(name, context) ?? this.scripts.read(name, context);
  }
  onScriptComplete(event: import("../../core/commands/index.ts").ScriptCompletion): void { this.currentStartup?.onScriptComplete(event); }
  adoptReaders(scripts: ConsoleScriptFiles, read: StartupConfigOptions["read"]): void {
    this.scripts = scripts; this.scopedReader = read;
  }
  validateOwners(owners: { readonly source: CvarRegistry; readonly movement: CvarRegistry; readonly fallback: CvarRegistry }): void {
    if (owners.fallback.dialect !== owners.source.dialect || [owners.source, owners.movement, owners.fallback].some(registry => registry.context.session !== this.commands.context.session))
      throw new Error("Prepared profile registry belongs to another session or dialect");
    this.commands.validateProfile(owners.source.dialect, owners.fallback);
  }
  adopt(routing: CommandCvarRouting, forward: PreparedStartup["forward"], owners?: {
    readonly source: CvarRegistry; readonly movement: CvarRegistry; readonly fallback: CvarRegistry;
    readonly scripts: ConsoleScriptFiles; readonly read: StartupConfigOptions["read"];
  }): void {
    const profileChanged = owners !== undefined && (this.commands.dialect !== owners.source.dialect || this.activeSeats.some(seat => seat.input.dialect !== owners.movement.dialect));
    if (profileChanged && this.activeSeats.some(seat => seat.input.hasHeldInput))
      throw new Error("Prepared profile requires released input");
    if (owners !== undefined) this.validateOwners(owners);
    if (profileChanged && owners !== undefined) this.commands.setProfile(owners.source.dialect, owners.fallback);
    this.routing = routing; this.forward = forward;
    if (owners !== undefined) {
      this.source = owners.source; this.movement = owners.movement; this.fallback = owners.fallback;
      this.adoptReaders(owners.scripts, owners.read);
      if (profileChanged) {
        this.releaseView();
        for (const seat of this.activeSeats) seat.input.setProfile(owners.movement.dialect);
        this.releaseView = registerQ1ViewCommands(this.commands);
      }
    }
    this.refreshRegistryOutput();
  }
  bindings(id: SeatId, selectedDefaults: readonly InputBinding[]): readonly InputBinding[] {
    const bindings = this.previewBindings(id, selectedDefaults);
    this.adoptBindingDefaults(id, selectedDefaults);
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat !== undefined) for (const binding of bindings) seat.input.bind(binding);
    return bindings;
  }
  adoptBindingDefaults(id: SeatId, selectedDefaults: readonly InputBinding[]): void {
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat !== undefined) seat.selectedBindings = selectedDefaults;
  }
  previewBindings(id: SeatId, selectedDefaults: readonly InputBinding[]): readonly InputBinding[] {
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat === undefined) return selectedDefaults;
    const bindings = new Map(seat.input.bindings.map(binding => [physicalInputKey(binding.input), binding]));
    if (!seat.allBindingsChosen) for (const binding of selectedDefaults)
      if (!seat.overriddenKeys.has(physicalInputKey(binding.input))) bindings.set(physicalInputKey(binding.input), binding);
    return [...bindings.values()];
  }
  async execute(options: Parameters<PreparedStartup["run"]>[0]): Promise<void> {
    this.scopedReader = options.read;
    this.continuation = this.run(options);
    await this.advanceFrame();
    while (this.pending && !this.worldAction) { await options.nextFrame(); await this.advanceFrame(); }
    if (this.pending) options.applyLaunchOptions();
  }
  async advanceFrame(): Promise<boolean> {
    const profile = this.profileContinuations.at(-1);
    if (profile !== undefined) {
      this.worldAction = false;
      if (await profile.advance(this)) {
        this.commands.finishPreparation();
        this.profileContinuations.pop();
      }
      return true;
    }
    const continuation = this.continuation;
    if (continuation === undefined) return false;
    this.worldAction = false;
    if ((await continuation.next()).done) this.continuation = undefined;
    return true;
  }
  adoptSeat(id: SeatId, cvars?: CvarRegistry, mouse?: MouseSettings): void {
    const seat = this.seats.find(seat => seat.id.equals(id));
    if (seat !== undefined) { if (cvars !== undefined) seat.cvars = cvars; if (mouse !== undefined) seat.mouse = mouse; }
    this.refreshRegistryOutput();
  }
  private async *run(options: Pick<StartupConfigOptions, "read" | "hasMod" | "applyLaunchOptions"> & {
    readonly sourceArchive: readonly CvarArchiveEntry[];
    readonly movementArchive: readonly CvarArchiveEntry[];
    readonly fallbackArchive: readonly CvarArchiveEntry[];
    readonly sharedArchive: readonly CvarArchiveEntry[];
    readonly nextFrame: () => Promise<void>;
  }): AsyncGenerator<void, void, void> {
    const phases = startupCommandPhases(this.options.startupCommands ?? [], this.options.dialect);
    const commandContext = this.seats[0]?.context ?? this.source.context;
    const applyStartupVariables = (): void => {
      for (const variable of phases.variables) {
        const owner = this.routing.owner(variable.name, commandContext);
        owner.set(variable.name, variable.value, true);
        const registered = owner.register(variable.name, "");
        if (registered === undefined) throw new Error(`Q3 startup variable registration rejected: ${variable.name}`);
        owner.addFlags(registered.name, CvarFlag.UserCreated);
      }
    };
    applyStartupVariables();
    this.commands.append(phases.early, commandContext);
    await this.commands.executeScriptsAsync(async () => {});
    if (this.options.dialect === "q1-quakeworld" && this.seats.length === 0) this.commands.append(phases.stuffed, commandContext);
    const configurations = this.seats.length === 0 ? [undefined] : this.seats;
    for (const [index, seat] of configurations.entries()) {
      const saved = this.options.seats[index];
      if (seat !== undefined && saved === undefined) throw new Error("Startup seat configuration is missing");
      const startup = new StartupConfig({ safeMode: phases.safe, dialect: this.options.dialect, context: seat?.context ?? this.source.context, hasMod: options.hasMod,
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
        }, applyLaunchOptions: () => {},
        replayStartupVariables: () => { if (index === 0) { applyStartupVariables(); this.commands.insert(phases.early, commandContext); } },
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
    if (this.options.dialect !== "q1-netquake" && this.options.dialect !== "q1-quakeworld") {
      this.commands.append(phases.late, commandContext);
      do {
        await this.commands.executeScriptsAsync(async () => {}, () => !this.worldAction);
        if (this.worldAction || this.commands.hasPendingCommands) yield;
        else break;
      } while (true);
    }
    options.applyLaunchOptions();
  }
}

export function allowSeatConfigurationCommand(command: CommandInvocation, routing: CommandCvarRouting,
  seats: readonly Pick<PreparedSeat, "id" | "cvars" | "mouse">[], print: (text: string, source?: CommandContext) => void): boolean {
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
    print("Ignoring shared cvar restart in saved secondary-seat configuration.\n", command.source); return false;
  }
  const target = ["set", "seta", "sets", "setu", "toggle", "reset"].includes(name) ? argument : name;
  if (target === undefined) return true;
  const owner = routing.owner(target, command.source);
  if (!["set", "seta", "sets", "setu", "toggle", "reset"].includes(name) && owner.find(target) === undefined) return true;
  let origin = command.source.origin;
  while (origin.kind === "script") origin = origin.caller;
  const seatId = origin.kind === "local-seat" ? origin.seat : undefined;
  const seat = seatId === undefined ? undefined : seats.find(seat => seat.id.equals(seatId));
  if (seat !== undefined && (owner === seat.cvars || owner === seat.mouse.cvars)) return true;
  print(`Ignoring shared cvar ${target} in saved secondary-seat configuration; use autoexec.cfg for intentional shared overrides.\n`, command.source);
  return false;
}

export type PreparedClientCommands = {
    readonly commands: CommandBuffer; readonly releaseCommands: Pick<CommandBuffer, "append">;
    preparePrefix(run: () => Promise<boolean>): Promise<boolean>;
    input(seat: SeatId): (BindingCommandSeat & Pick<SeatInput, "isDown"> & { clearStates(): void }) | null;
    releaseInputs(time: number): void;
    validatePublication(): void; publish(): void;
  };

export function prepareClientCommands(commands: CommandBuffer, inputs: readonly Pick<PreparedSeat, "id" | "input" | "context">[],
  liveRegistries: ReadonlySet<CvarRegistry>, options: CommandBufferOptions): PreparedClientCommands {
    const candidateRegistries = new Set([options.cvars,
      ...[options.context, ...inputs.map(seat => seat.context)].flatMap(context => options.cvarRouting?.visible(context) ?? [])]);
    for (const registry of candidateRegistries) if (registry !== undefined && liveRegistries.has(registry))
      throw new Error("Candidate client commands require isolated cvar owners");
    const program = commands.prepareProgram(options);
    const releaseDialect = commands.dialect;
    const seats = inputs.map(seat => {
      const original = seat.input.bindings;
      const bindings = new Map(original.map(binding => [physicalInputKey(binding.input), binding]));
      let cleared = false;
      const staged = {
        get bindings() { return [...bindings.values()]; },
        binding: (input: Parameters<BindingCommandSeat["binding"]>[0]) => bindings.get(physicalInputKey(input))?.target ?? null,
        bind: (binding: Parameters<BindingCommandSeat["bind"]>[0]) => { bindings.set(physicalInputKey(binding.input), binding); },
        unbind: (input: Parameters<BindingCommandSeat["unbind"]>[0]) => { bindings.delete(physicalInputKey(input)); },
        unbindAll: () => { bindings.clear(); },
        isDown: (input: Parameters<SeatInput["isDown"]>[0]) => !cleared && seat.input.isDown(input),
        clearStates: () => { cleared = true; },
      };
      return { seat, original, staged, release: (time: number) => {
        if (cleared) seat.input.release(time, { append: (text, source) => program.commands.append(text, source, releaseDialect) });
      } };
    });
    registerBindingCommands(program.commands, id => seats.find(entry => entry.seat.id.equals(id))?.staged ?? null,
      text => options.print?.(text, program.commands.executionContext));
    registerQ1ViewCommands(program.commands);
    const validatePublication = (): void => {
      program.validatePublication();
      for (const { seat, original } of seats) {
        const current = seat.input.bindings;
        if (current.length !== original.length || current.some((binding, index) => binding !== original[index]))
          throw new Error("Client bindings changed during preparation");
      }
    };
    return { commands: program.commands, preparePrefix: program.preparePrefix,
      input: id => seats.find(entry => entry.seat.id.equals(id))?.staged ?? null,
      releaseInputs: time => { validatePublication(); for (const entry of seats) entry.release(time); },
      releaseCommands: { append: (text, source) => program.commands.append(text, source, releaseDialect) },
      validatePublication, publish: () => {
      validatePublication();
      program.publish();
      for (const { seat, staged } of seats) {
        seat.input.unbindAll();
        for (const binding of staged.bindings) seat.input.bind(binding);
      }
    } };
}
