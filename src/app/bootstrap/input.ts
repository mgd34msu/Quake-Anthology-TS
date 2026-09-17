import { InputDevices, inputDeviceStore } from "./input-devices.ts";
import type { StartupConfigOptions } from "./startup-config.ts";
import type { ClientBootstrap } from "./client-bootstrap.ts";
import { prepareClientCommands, type PreparedStartup } from "./prepared-startup.ts";
import type { PreparedProfileConfiguration } from "./configuration.ts";
import { Q3ClientCvars } from "./q3-client/cvars.ts";
import type { QvmClientInput } from "./q3-client/qvm-scalars.ts";
import { loadCvarArchive, saveCvarArchive } from "./cvar-archives.ts";
import { bindRunCvar } from "./shared-setting-cvars.ts";
import { registerQ1ClientCommands } from "./q1-client-commands.ts";
import type { CvarArchiveEntry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import type { SeatSettings } from "../../settings/config.ts";
import { ControllerSettings } from "./controller-settings.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ContentId, ExecutableRecipe, ResourceRequest } from "../../contracts/content.ts";
import type { AudioAudience } from "../../audio/types.ts";
import { SeatHaptics } from "../../input/haptics.ts";
import type { ActorId, ProviderId, SeatId } from "../../contracts/identity.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { ArsenalIntent } from "../../contracts/gameplay.ts";
import type { InputBinding, SeatInputEvent, SeatInputFocus } from "../../contracts/ui.ts";
import { CommandBuffer, type CommandCvarRouting } from "../../core/commands/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { SeatConsole } from "../../console/session.ts";
import { defaultBindings, registerBindingCommands, registerWheelCommands } from "../../input/bindings.ts";
import type { WeaponBindingItem } from "../../input/weapon-bindings.ts";
import { InputRouter } from "../../input/router.ts";
import { SeatInput, registerInputCommands } from "../../input/seat.ts";
import { ClientCommandBindings, type ClientCommandRegistration } from "../../input/client-commands.ts";
import type { SeatInputSample } from "../../input/seat.ts";
import { InputCommandBuilder } from "../../input/user-command.ts";
import { MouseInput } from "../../input/mouse.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import type { UserCommandFrame } from "../../input/user-command.ts";
import { SdlControllers } from "../../platform/controller.ts";
import type { ControllerEvent } from "../../platform/controller.ts";
import { readSdlClipboard } from "../../platform/sdl.ts";
import type { SdlEvent, SdlWindow } from "../../platform/sdl.ts";
import type { SessionSeat } from "../../world/session/index.ts";
import type { ApplicationOptions } from "./options.ts";
import type { SimulationPresentationAccess } from "./simulation/types.ts";
import { ApplicationConsoleRouting } from "./console.ts";
import { registerDiscoveryCommands } from "../../console/discovery.ts";
import { registerLlmCommands, type LlmCommandRequester } from "../../console/llm.ts";
import { registerQ2ClientCommands } from "./q2-client-commands.ts";
import { applicationAudioCommands } from "./audio/commands.ts";
import type { ApplicationConsoleServer } from "./console.ts";
import type { BindingCapabilities } from "../../ui/settings/action-catalog.ts";
import { InputButton } from "../../input/buttons.ts";
import { consoleConfigRoot, ConsoleScriptFiles } from "./config-scripts.ts";

export interface LocalPlayer {
  readonly seat: SessionSeat;
  actor: ActorId;
}

export interface LocalInput {
  readonly player: LocalPlayer;
  readonly input: SeatInput;
  console: SeatConsole;
  readonly builder: InputCommandBuilder;
  readonly haptics: SeatHaptics;
}

export interface ApplicationInputCommands {
  readonly configuration?: PreparedProfileConfiguration;
  readonly scripts?: ConsoleScriptFiles;
  readScript?(name: string): Promise<Uint8Array | undefined>;
  readMountedScript?(name: string): Promise<Uint8Array | undefined>;
  startupReader?(scripts: ConsoleScriptFiles, options: ApplicationOptions): StartupConfigOptions["read"];
  readonly llm?: LlmCommandRequester;
  localPlayerCapacity?(): number;
  bindingCapabilities?(): BindingCapabilities;
  bindingItems?(seat: SeatId): readonly WeaponBindingItem[];
  arsenalImpulseProvider?(seat: SeatId): ProviderId | null;
  readonly sharedCvars?: CvarRegistry;
  quit(): undefined;
  execute(name: string, arguments_: readonly string[], seat: SeatId | null, source?: CommandContext): undefined;
  print(text: string): undefined;
  readonly console?: {
    dialect(): CommandDialect;
    server(): ApplicationConsoleServer | null;
    seat(id: SeatId): CvarRegistry | null;
  };
  clientInput?(event: SeatInputEvent): boolean;
  clientCapturesInput?(seat: SeatId): boolean;
}

export interface ApplicationInputUi {
  input(event: SeatInputEvent, focus: SeatInputFocus): boolean;
  closeMenus(): void;
  clearPrompt?(): void;
  sample(input: SeatInputSample): SeatInputSample;
  wheel(mode: "weapons" | "powerups", down: boolean): void;
  cycleWeapon?(direction: -1 | 1): boolean;
  switchWeapon?(first: number, second: number): boolean;
}

export interface Q3CommandSelection { readonly weapon: number; readonly sensitivity: number; }

export function movementDialect(options: Pick<ApplicationOptions, "movement"> & Partial<Pick<ApplicationOptions, "network">>, recipe?: ExecutableRecipe): CommandDialect {
  if (recipe !== undefined) {
    const timing = recipe.timing.find(profile => profile.provider === recipe.movement.provider);
    if (timing === undefined) throw new Error(`Recipe has no timing for ${recipe.movement.provider}`);
    return timing.clock.kind;
  }
  return options.network?.kind === "qw-client" ? "q1-quakeworld" : options.movement === "q1" ? "q1-netquake" : options.movement === "q2" ? "q2-classic" : "q3";
}

export interface ApplicationInputCommandOwner {
  readonly scripts?: ConsoleScriptFiles;
  readonly cvars: CvarRegistry;
  readonly commands: CommandBuffer;
  readonly routing: CommandCvarRouting;
  readonly inputSettings?: MouseSettings;
}

export class ApplicationInput {
  private readonly publishedRegistries = new Map<CvarRegistry, CvarRegistry>();
  readonly scripts: ConsoleScriptFiles;
  get bindingCapabilities(): BindingCapabilities {
    const capabilities = this.actions.bindingCapabilities?.() ?? { chat: this.options.network.kind.endsWith("-client"),
      scoreCommand: this.options.network.kind === "q2-client" ? "score" : "+scores",
      offhandGrapple: false, offhandGrenades: false } satisfies BindingCapabilities;
    return { ...capabilities, scoreCommand: capabilities.scoreCommand ?? "+scores" };
  }
  private sharedOwner: CvarRegistry | null;
  get sharedCvars(): CvarRegistry | null { return this.sharedOwner; }
  sharedSettings(): import("../../ui/settings/index.ts").SettingCvars | null {
    if (this.sharedOwner === null) return null;
    const current = (): CvarRegistry => {
      if (this.sharedOwner === null) throw new Error("Shared settings lost their owner");
      return this.sharedOwner;
    };
    return { get dialect() { return current().dialect; }, find: name => current().find(name),
      set: (...args) => current().set(...args), variableValue: name => current().variableValue(name) };
  }
  private candidateProgram: ReturnType<PreparedStartup["prepareClientCommands"]> | null = null;
  private readonly candidateDefaults = new Map<SeatId, readonly InputBinding[]>();
  private readonly candidateGamepads = new Map<SeatInput, SeatSettings["gamepad"]>();
  readonly guestCommands: Pick<CommandBuffer, "executeNow" | "insert" | "append"> = {
    executeNow: (text, source) => (this.candidateProgram?.commands ?? this.commands).executeNow(text, source),
    insert: (text, source) => (this.candidateProgram?.commands ?? this.commands).insert(text, source),
    append: (text, source, dialect) => (this.candidateProgram?.commands ?? this.commands).append(text, source, dialect),
  };
  guestCvars(seat: SeatId): Q3ClientCvars {
    const local = this.locals.find(local => local.player.seat.id.equals(seat));
    const routing = this.consoleRouting ?? this.externalRouting;
    if (local === undefined || routing === undefined) throw new Error("Guest cvars require a routed local seat");
    const context: CommandContext = { session: seat.session, origin: { kind: "local-seat", seat, client: local.player.seat.client.id } };
    return new Q3ClientCvars({ owner: name => routing.owner(name, context), visible: () => routing.visible(context),
      current: owner => this.publishedRegistries.get(owner) ?? owner, print: text => this.print(text, context) });
  }
  publishSharedCvars(registry: CvarRegistry): void {
    if (this.sharedOwner !== null) this.publishedRegistries.set(this.sharedOwner, registry);
    this.sharedOwner = registry;
  }
  adoptCvarOwner(candidate: CvarRegistry, retained: CvarRegistry): void {
    this.publishedRegistries.set(candidate, retained);
    if (this.cvarOwner === candidate) this.cvarOwner = retained;
    if (this.consoleCvars === candidate) this.consoleCvars = retained;
  }
  adoptMouseOwner(seat: SeatId, retained: MouseSettings): void {
    const candidate = this.mouseSettings.get(seat), local = this.locals.find(local => local.player.seat.id.equals(seat));
    if (candidate === undefined || local === undefined) throw new Error("Mouse publication lost its seat");
    this.publishedRegistries.set(candidate.cvars, retained.cvars);
    this.mouseSettings.set(seat, retained); local.builder.mouse.bindSettings(retained);
  }
  guestInput(seat: SeatId): QvmClientInput {
    const local = this.locals.find(local => local.player.seat.id.equals(seat));
    if (local === undefined) throw new Error("Guest input requires a local seat");
    const bindingOwner = () => this.candidateProgram?.input(seat) ?? local.input;
    return { get bindings() { return bindingOwner().bindings; }, binding: key => bindingOwner().binding(key),
      bind: binding => bindingOwner().bind(binding), unbind: key => bindingOwner().unbind(key), unbindAll: () => bindingOwner().unbindAll(),
      isDown: key => this.candidateProgram?.input(seat)?.isDown(key) ?? local.input.isDown(key),
      clearStates: () => { if (this.candidateProgram === null) local.input.release(this.now()); else this.candidateProgram.input(seat)?.clearStates(); } };
  }
  validateCandidateCommands(): void { this.candidateProgram?.validatePublication(); }
  releaseIntoCandidate(previous: ApplicationInput, worldChanged = false): void {
    if (worldChanged || this.profileChanged) previous.releaseForProfileChange(this.candidateProgram?.releaseCommands);
    else this.candidateProgram?.releaseInputs(this.now());
  }
  publishCandidateCommands(): void {
    this.candidateProgram?.publish(); this.candidateProgram = null;
    for (const [seat, defaults] of this.candidateDefaults) this.startup?.adoptBindingDefaults(seat, defaults);
    for (const [input, tuning] of this.candidateGamepads) input.gamepad.tuning = tuning;
    this.candidateDefaults.clear(); this.candidateGamepads.clear();
  }
  readonly commands: CommandBuffer;
  private cvarOwner: CvarRegistry;
  get cvars(): CvarRegistry { return this.cvarOwner; }
  get localPlayerCapacity(): number { return this.actions.localPlayerCapacity?.() ?? 4; }
  private readonly localInputs: LocalInput[];
  get locals(): readonly LocalInput[] { return this.localInputs; }
  readonly controllers: SdlControllers;
  readonly router: InputRouter;
  readonly controllerSettings: ControllerSettings;
  readonly inputDevices: InputDevices;
  private ownsInputDevices = false;
  private sequence = 0;
  private ownsControllers = true;
  private pendingWindowEvents: SdlEvent[] = [];
  private pendingControllerEvents: ControllerEvent[] = [];
  private hapticLoad: (request: ResourceRequest) => Promise<Uint8Array | null> = async () => null;
  private readonly seatUi = new Map<SeatId, ApplicationInputUi>();
  private readonly mouseSettings = new Map<SeatId, MouseSettings>();
  private readonly q3Selections = new Map<SeatId, Q3CommandSelection>();
  private readonly arsenalSelections = new Map<SeatId, Pick<ArsenalIntent, "provider" | "weapon">>();
  private readonly offhandButtons = new Map<SeatId, { readonly grapple: InputButton; readonly grenade: InputButton }>();
  private readonly unregister: (() => void)[] = [];
  private readonly uiCallbacks = new Map<SeatInput, (event: SeatInputEvent, focus: SeatInputFocus) => boolean>();
  private readonly releaseUi: (() => void)[] = [];
  private readonly clientCommands: ClientCommandBindings;
  private commandsActive = false;
  private readonly stagedCommands: ({ readonly kind: "console"; readonly text: string; readonly source: CommandContext }
    | { readonly kind: "reliable"; readonly text: string; readonly source: CommandContext; readonly dispatch: (text: string, source: CommandContext) => void })[] = [];
  private readonly consoleRouting: ApplicationConsoleRouting | null;
  private readonly externalRouting: CommandCvarRouting | undefined;
  private consoleCvars: CvarRegistry;
  private archivePersistence = false;
  enableArchivePersistence(): void { this.archivePersistence = true; }


  print(text: string, source?: CommandContext): void {
    const context = source ?? this.commands?.executionContext;
    if (context === undefined) {
      this.actions.print(text);
      for (const local of this.locals ?? []) local.console.print(text);
      return;
    }
    let origin = context.origin;
    while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "local-seat") {
      const seat = origin.seat;
      this.locals.find(local => local.player.seat.id.equals(seat))?.console.print(text);
    } else {
      this.actions.print(text);
      if (origin.kind === "local-console") this.locals[0]?.console.print(text);
    }
  }

  inputCvars(id: SeatId | null): CvarRegistry | null {
    for (const [seat, settings] of this.mouseSettings) if (id === null || seat.equals(id)) return settings.cvars;
    return null;
  }

  static async open(window: SdlWindow, players: readonly LocalPlayer[], options: ApplicationOptions, dialect: CommandDialect,
    simulation: Pick<SimulationPresentationAccess, "playerView">, actions: ApplicationInputCommands,
    now: () => number, settings: ConfigStore, owner?: ApplicationInputCommandOwner, previous?: ApplicationInput, prepared?: PreparedStartup): Promise<ApplicationInput> {
    return ApplicationInput.create(null, window, players, options, dialect, simulation, actions, now, settings, owner, previous, prepared);
  }
  static async prepare(liveRegistries: ReadonlySet<CvarRegistry>, ...args: Parameters<typeof ApplicationInput.open>): Promise<ApplicationInput> {
    return ApplicationInput.create(liveRegistries, ...args);
  }
  static async prepareForClient(client: ClientBootstrap, liveRegistries: ReadonlySet<CvarRegistry>, ...args: Parameters<typeof ApplicationInput.open>): Promise<ApplicationInput> {
    const [window, players, options, dialect, simulation, actions, now, settings, owner, previous, prepared] = args;
    if (window !== client.renderer.window || prepared !== undefined && prepared !== client.prepared)
      throw new Error("Client input preparation changed retained owners");
    const current = client.platform.current;
    const previousInput = previous ?? (current?.kind === "world" ? current.input : undefined);
    return ApplicationInput.create(liveRegistries, window, players, options, dialect, simulation, actions, now, settings,
      owner, previousInput, client.prepared, client);
  }
  private static async create(staging: ReadonlySet<CvarRegistry> | null, window: SdlWindow, players: readonly LocalPlayer[], options: ApplicationOptions, dialect: CommandDialect,
    simulation: Pick<SimulationPresentationAccess, "playerView">, actions: ApplicationInputCommands,
    now: () => number, settings: ConfigStore, owner?: ApplicationInputCommandOwner, previous?: ApplicationInput, prepared?: PreparedStartup, client?: ClientBootstrap): Promise<ApplicationInput> {
    const { saved, routing, archives } = await ApplicationInput.readSettings(players, dialect, actions, settings, owner, previous, prepared);
    const input = new ApplicationInput(staging, window, players, options, dialect, simulation, actions, now, settings, saved, routing, archives, owner, previous, prepared, client);
    try { await input.controllerSettings.settle(); if (previous === undefined && staging === null) { input.activateCommands(); input.adoptStartup(); } return input; }
    catch (error) { input.close(); throw error; }
  }

  private static async readSettings(players: readonly { readonly seat: SessionSeat }[], dialect: CommandDialect,
    actions: ApplicationInputCommands, settings: ConfigStore, owner?: ApplicationInputCommandOwner,
    previous?: ApplicationInput, prepared?: PreparedStartup) {
    const saved = await Promise.all(players.map(player => settings.loadSeat(`input/seat-${player.seat.id.index + 1}.json`)));
    const routing = await settings.loadInputRouting("input/routing.json");
    const sourceDialect = actions.console?.dialect() ?? dialect;
    const hasOwners = owner !== undefined || previous !== undefined || prepared !== undefined;
    const archives = {
      movement: hasOwners ? [] : await loadCvarArchive(settings, ["movement", dialect], dialect),
      fallback: hasOwners ? [] : await loadCvarArchive(settings, ["fallback", sourceDialect], sourceDialect),
      input: await Promise.all(players.map(player => owner?.inputSettings !== undefined
        || previous?.locals.some(local => local.player.seat.id.equals(player.seat.id))
        || prepared?.seats.some(seat => seat.id.equals(player.seat.id)) ? []
        : loadCvarArchive(settings, ["input", sourceDialect, String(player.seat.id.index)], sourceDialect))),
    };
    return { saved, routing, archives };
  }

  /** Load fallible profile resources before a live source admits a new player. No actor or device is touched. */
  async prepareLocalSeats(seats: readonly SessionSeat[]): Promise<{
    publish(players: readonly LocalPlayer[], client?: ClientBootstrap): void;
    discard(): void;
  }> {
    if (seats.length < 1 || seats.length > 4) throw new Error("A graphical world needs one to four local players");
    await this.controllerSettings.settle();
    const before = [...this.locals];
    const loaded = await ApplicationInput.readSettings(seats.map(seat => ({ seat })), this.dialect, this.actions, this.settings, undefined, this, this.startup);
    let phase: "prepared" | "published" | "discarded" = "prepared";
    return {
      publish: (players, client) => {
        if (phase !== "prepared" || this.locals.length !== before.length || this.locals.some((local, index) => local !== before[index])) throw new Error("Local input preparation is stale");
        if (players.length !== seats.length || players.some((player, index) => player.seat !== seats[index])) throw new Error("Local input admission changed prepared identities");
        const retained = players.map(player => before.find(local => local.player.seat === player.seat));
        const keyboard = this.router.keyboardSeat();
        const selections: readonly import("../../platform/controller.ts").ControllerSelection[] = players.map((player, index) => retained[index] === undefined ? loaded.saved[index]?.controller ?? { kind: "automatic" } satisfies import("../../platform/controller.ts").ControllerSelection : this.router.controllerSelection(player.seat.id));
        this.releaseForProfileChange();
        this.retireCommands();
        const next = players.map((player, index) => retained[index] ?? this.createJoinedLocal(player, loaded.saved[index] ?? null, loaded.archives?.input[index] ?? []));
        const removed = before.filter(local => !next.includes(local));
        for (const local of removed) {
          this.uiCallbacks.delete(local.input); this.seatUi.delete(local.player.seat.id);
          this.mouseSettings.delete(local.player.seat.id); this.q3Selections.delete(local.player.seat.id);
          this.arsenalSelections.delete(local.player.seat.id); this.offhandButtons.delete(local.player.seat.id);
          local.haptics.close();
        }
        this.localInputs.splice(0, this.localInputs.length, ...next);
        this.clientCommands.publishSeats(seats.map(seat => seat.id));
        this.router.publishSeats(next.map((local,index) => ({input:local.input, controller:selections[index] ?? {kind:"automatic"}})),
          keyboard === null ? null : next.some(local => local.player.seat.id.equals(keyboard)) ? keyboard : next[0]?.player.seat.id ?? null);
        this.controllerSettings.publishSeats(seats.map(seat => seat.id));
        if (client !== undefined) this.publishClientSeats(client, "replace");
        else if (this.startup !== undefined) this.startup.publishSeats(next.map(local => {
          const mouse = this.mouseSettings.get(local.player.seat.id), cvars = this.actions.console?.seat(local.player.seat.id);
          if (mouse === undefined || cvars === undefined || cvars === null) throw new Error("Local seat has no registry owners");
          return {id:local.player.seat.id, input:local.input, mouse, cvars, context:{session:local.player.seat.id.session,
            origin:{kind:"local-seat", seat:local.player.seat.id, client:local.player.seat.client.id}} satisfies CommandContext};
        }));
        this.adoptStartup(); this.activateCommands(true); phase = "published";
      },
      discard() { if (phase === "prepared") phase = "discarded"; },
    };
  }

  private createJoinedLocal(player: LocalPlayer, saved: SeatSettings | null, archive: readonly CvarArchiveEntry[]): LocalInput {
    const seat = player.seat.id, sourceDialect = this.actions.console?.dialect() ?? this.dialect;
    const context: CommandContext = {session:seat.session, origin:{kind:"local-seat", seat, client:player.seat.client.id}};
    const input = new SeatInput({seat, dialect:this.dialect, context, commands:this.commands, uiEvent:()=>false});
    const mouse = new MouseSettings(new CvarRegistry({dialect:sourceDialect, context, print:text=>this.print(text,context)}));
    mouse.cvars.applyArchive(archive);
    const builder = new InputCommandBuilder(this.dialect, new MouseInput(mouse));
    builder.setViewAngles(this.simulation.playerView(player.actor).angles);
    const defaults = defaultBindings(0,this.dialect,this.actions.bindingItems?.(seat) ?? []);
    for (const binding of saved?.bindings ?? defaults) input.bind(binding);
    if (saved !== null) { input.gamepad.tuning = structuredClone(saved.gamepad); builder.mouse.tuning = {...saved.mouse};
      if (saved.alwaysRun !== undefined) builder.tuning = {...builder.tuning, alwaysRun:saved.alwaysRun}; }
    const haptics = new SeatHaptics({seat, controllers:{rumble:(instance,low,high,duration)=>this.controllers.rumble(instance,low,high,duration)},
      controller:id=>this.router.controllerFor(id),load:request=>this.hapticLoad(request),now:this.now});
    if (saved !== null) {haptics.setEnabled(saved.rumble);haptics.setStrength(saved.rumbleStrength ?? 1);}
    const console = new SeatConsole({staged:true,seat,dialect:sourceDialect,context,commands:this.commands,cvars:this.consoleCvars,now:this.now,
      connected:()=>true,clipboard:()=>{const bytes=readSdlClipboard();return bytes===null?null:new TextDecoder().decode(bytes);},
      focus:focus=>{input.setFocus(focus,this.now());haptics.setActive(input.focused && focus.kind==="game");},
      chat:(text,team,target)=>this.actions.execute(team?"say_team":"say",target===null?[text]:[text,String(target)],seat)});
    if(saved!==null) console.history.replace(saved.history);
    this.mouseSettings.set(seat,mouse);
    this.uiCallbacks.set(input,(event,focus)=>{
      const ui=this.seatUi.get(seat);
      if(event.kind==="key" && (event.code===96 || event.code===126)) {
        if(event.down){if(!event.repeat)ui?.closeMenus();console.toggleFromKey(event.repeat);} return true;
      }
      return console.input(event,focus) || (this.actions.clientInput?.(event) ?? false) || (ui?.input(event,focus) ?? false);
    });
    return {player,input,console,builder,haptics};
  }

  private constructor(staging: ReadonlySet<CvarRegistry> | null, private currentWindow: SdlWindow, players: readonly LocalPlayer[], readonly options: ApplicationOptions, readonly dialect: CommandDialect,
    private simulation: Pick<SimulationPresentationAccess, "playerView">, private readonly actions: ApplicationInputCommands,
    readonly now: () => number, private readonly settings: ConfigStore, saved: readonly (SeatSettings | null)[],
    routing: { readonly keyboardSeat: number | null } | null,
    private readonly loadedArchives: { readonly movement: readonly CvarArchiveEntry[]; readonly fallback: readonly CvarArchiveEntry[]; readonly input: readonly (readonly CvarArchiveEntry[])[] } | null,
    owner?: ApplicationInputCommandOwner, previous?: ApplicationInput, prepared?: PreparedStartup, client?: ClientBootstrap) {
    const window = currentWindow;
    this.startup = prepared ?? previous?.startup;
    const configuration = actions.configuration;
    this.externalRouting = owner?.routing;
    this.sharedOwner = actions.sharedCvars ?? null;
    const archives = this.loadedArchives;
    this.ownsControllers = client === undefined && previous === undefined;
    const first = players[0];
    if (first === undefined) throw new Error("Native input requires at least one local player");
    const context: CommandContext = { session: first.actor.session, origin: { kind: "local-console" } };
    const print = (text: string, source?: CommandContext): void => this.print(text, source);
    if (owner !== undefined && (owner.cvars.dialect !== dialect || actions.console !== undefined)) throw new Error("Input command owner does not match its console dialect");
    const sourceDialect = actions.console?.dialect() ?? dialect;
    this.cvarOwner = configuration?.movement ?? (staging === null && previous === undefined && this.startup?.movement.dialect === dialect ? this.startup.movement : undefined) ?? owner?.cvars ?? new CvarRegistry({ dialect, context, print });
    const consoleCvars = configuration?.fallback ?? (staging === null && previous === undefined && this.startup?.fallback.dialect === sourceDialect ? this.startup.fallback : undefined) ?? (sourceDialect === dialect ? this.cvars : new CvarRegistry({ dialect: sourceDialect, context, print }));
    this.consoleCvars = consoleCvars;
    if (owner === undefined && configuration === undefined) {
      if (this.startup?.movement !== this.cvars) {
        if (previous?.cvars.dialect === dialect) this.cvars.restoreSaveState(previous.cvars.captureSaveState());
        else if (this.startup?.movement.dialect === dialect) this.cvars.restoreSaveState(this.startup.movement.captureSaveState());
        else this.cvars.applyArchive(archives?.movement ?? []);
      }
      if (this.startup?.fallback !== consoleCvars) {
        if (consoleCvars !== this.cvars) {
          if (previous?.consoleCvars.dialect === sourceDialect) consoleCvars.restoreSaveState(previous.consoleCvars.captureSaveState());
          else if (this.startup?.fallback.dialect === sourceDialect) consoleCvars.restoreSaveState(this.startup.fallback.captureSaveState());
          else consoleCvars.applyArchive(archives?.fallback ?? []);
        } else consoleCvars.applyArchive(archives?.fallback ?? []);
      }
    }
    this.consoleRouting = owner === undefined ? new ApplicationConsoleRouting({ fallback: consoleCvars,
      sourceDialect: () => actions.console?.dialect() ?? sourceDialect, server: () => actions.console?.server() ?? null,
      seat: id => actions.console?.seat(id) ?? null, input: id => this.inputCvars(id), movement: () => this.cvars, shared: () => this.sharedOwner }) : null;
    this.scripts = configuration?.scripts ?? actions.scripts ?? prepared?.scripts ?? owner?.scripts ?? new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings, mounted: actions.readScript,
      ...(actions.readMountedScript === undefined ? {} : { mountedScript: actions.readMountedScript }) });
    this.commands = this.startup?.commands ?? owner?.commands ?? new CommandBuffer({ dialect: sourceDialect, context, cvars: consoleCvars,
      readScript: (name, source) => this.startup?.readScript(name, source) ?? this.scripts.read(name, source),
      onScriptComplete: event => this.startup?.onScriptComplete(event),
      allowCommand: command => this.startup?.allowCommand(command) ?? true,
      ...(this.consoleRouting === null ? {} : { cvarRouting: this.consoleRouting }), print, forwardToServer: invocation => {
      const name = invocation.argv[0]; if (name === undefined) return undefined;
      this.startup?.noteWorldAction();
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
    } });
    const locals: LocalInput[] = [];
    const freshInputs = new Set<SeatInput>();
    for (const player of players) {
      const seatContext: CommandContext = { session: context.session, origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } };
      let localConsole: LocalInput | null = null;
      const preparedSeat = this.startup?.seats.find(seat => seat.id.equals(player.seat.id) && seat.context.origin.kind === "local-seat"
        && seat.context.origin.client.equals(player.seat.client.id));
      const configuredSeat = configuration?.seats.find(seat => seat.id.equals(player.seat.id) && seat.context.origin.kind === "local-seat"
        && seat.context.origin.client.equals(player.seat.client.id));
      const retainedInput = configuredSeat?.input ?? preparedSeat?.input ?? previous?.locals.find(local => local.player.seat.id.equals(player.seat.id)
        && local.player.seat.client.id.equals(player.seat.client.id))?.input;
      const input = retainedInput ?? new SeatInput({ seat: player.seat.id, dialect, context: seatContext, commands: this.commands,
        uiEvent: () => false });
      if (retainedInput === undefined || configuredSeat !== undefined && preparedSeat === undefined) freshInputs.add(input);
      this.uiCallbacks.set(input, (event, focus) => {
          const ui = this.seatUi.get(player.seat.id);
          if (event.kind === "key" && (event.code === 96 || event.code === 126)) {
            if (event.down) { if (!event.repeat) ui?.closeMenus(); localConsole?.console.toggleFromKey(event.repeat); }
            return true;
          }
          return (localConsole?.console.input(event, focus) ?? false) || (actions.clientInput?.(event) ?? false) || (ui?.input(event, focus) ?? false);
        });
      const console = new SeatConsole({ staged: true, seat: player.seat.id, dialect: sourceDialect, context: seatContext, commands: this.commands, cvars: consoleCvars,
        now, connected: () => true, clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); }, focus: focus => { input.setFocus(focus, now());
          locals.find(local => local.player.seat.id.equals(player.seat.id))?.haptics.setActive(input.focused && focus.kind === "game"); },
        chat: (text, team, target) => actions.execute(team ? "say_team" : "say", target === null ? [text] : [text, String(target)], player.seat.id) });
      const preparedMouse = configuredSeat?.mouse ?? (staging === null && previous === undefined && preparedSeat?.mouse.cvars.dialect === sourceDialect ? preparedSeat.mouse : undefined);
      const mouseSettings = preparedMouse ?? owner?.inputSettings ?? new MouseSettings(new CvarRegistry({ dialect: sourceDialect, context: seatContext, print }));
      const mouseOrigin = mouseSettings.cvars.context.origin;
      if (mouseSettings.cvars.dialect !== sourceDialect || mouseSettings.cvars.context.session !== context.session
        || mouseOrigin.kind !== "local-seat" || !mouseOrigin.seat.equals(player.seat.id) || !mouseOrigin.client.equals(player.seat.client.id)) {
        throw new Error("Mouse settings belong to another seat or source dialect");
      }
      this.mouseSettings.set(player.seat.id, mouseSettings);
      if (owner?.inputSettings === undefined && preparedMouse === undefined) {
        const previousMouse = previous?.inputCvars(player.seat.id);
        if (previousMouse?.dialect === sourceDialect) mouseSettings.cvars.restoreSaveState(previousMouse.captureSaveState());
        else if (preparedSeat?.mouse.cvars.dialect === sourceDialect) mouseSettings.cvars.restoreSaveState(preparedSeat.mouse.cvars.captureSaveState());
        else mouseSettings.cvars.applyArchive(archives?.input[locals.length] ?? []);
      }
      const builder = new InputCommandBuilder(dialect, new MouseInput(mouseSettings));
      builder.setViewAngles(simulation.playerView(player.actor).angles);
      const defaults = defaultBindings(0, dialect, actions.bindingItems?.(player.seat.id) ?? []);
      configuration?.applyBindingDefaults(player.seat.id, defaults);
      if (configuration === undefined && (previous === undefined || retainedInput === undefined)) {
        if (retainedInput === undefined) for (const binding of defaults) input.bind(binding);
        else if (staging !== null && preparedSeat !== undefined) this.candidateDefaults.set(player.seat.id, defaults);
        else for (const binding of this.startup?.bindings(player.seat.id, defaults) ?? defaults) input.bind(binding);
      }
      localConsole = { player, input, console, builder, haptics: new SeatHaptics({ seat: player.seat.id,
        controllers: { rumble: (instance, low, high, duration) => this.controllers.rumble(instance, low, high, duration) },
        controller: seat => this.router.controllerFor(seat), load: request => this.hapticLoad(request), now }) };
      locals.push(localConsole);
    }
    for (const [index, local] of locals.entries()) {
      const profile = saved[index]; if (profile === undefined || profile === null) continue;
      if (configuration === undefined && (this.startup === undefined && previous === undefined || freshInputs.has(local.input))) { local.input.unbindAll(); for (const binding of profile.bindings) local.input.bind(binding); }
      if (previous === undefined || freshInputs.has(local.input)) {
        if (staging !== null && this.startup !== undefined && !freshInputs.has(local.input)) {
          if (client === undefined) this.candidateGamepads.set(local.input, structuredClone(profile.gamepad));
        }
        else local.input.gamepad.tuning = structuredClone(profile.gamepad);
      }
      if (this.startup === undefined && profile.alwaysRun !== undefined) local.builder.tuning = { ...local.builder.tuning, alwaysRun: profile.alwaysRun };
      if (configuration === undefined && owner?.inputSettings === undefined && (this.startup === undefined || freshInputs.has(local.input))) local.builder.mouse.tuning = { ...profile.mouse };
      local.console.history.replace(profile.history); local.haptics.setEnabled(profile.rumble); local.haptics.setStrength(profile.rumbleStrength ?? 1);
    }
    if (previous?.startup?.pending) for (const local of locals) {
      const prior = previous.locals.find(prior => prior.player.seat.id.equals(local.player.seat.id));
      if (prior === undefined) continue;
      if (local.input !== prior.input) { local.input.unbindAll(); for (const binding of prior.input.bindings) local.input.bind(binding); }
      if (local.input !== prior.input) local.builder.mouse.tuning = { ...prior.builder.mouse.tuning };
      local.builder.tuning = { ...local.builder.tuning, alwaysRun: prior.builder.tuning.alwaysRun };
    }
    this.localInputs = locals;
    if (previous !== undefined && this.commands !== previous.commands) this.commands.copyPendingFrom(previous.commands);
    const candidateRouting = this.consoleRouting ?? this.externalRouting;
    if ((previous !== undefined || staging !== null) && candidateRouting !== undefined && candidateRouting !== null) {
      const commandOptions = { dialect: sourceDialect, context: this.commands.context,
        cvars: consoleCvars, cvarRouting: candidateRouting, print,
        readScript: (name, source) => this.scripts.read(name, source),
        forwardToServer: invocation => {
          const name = invocation.argv[0]; if (name === undefined) return undefined;
          let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
          return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
        } } satisfies ConstructorParameters<typeof CommandBuffer>[0];
      const contexts = locals.map(local => ({ id: local.player.seat.id, input: local.input, context: { session: context.session,
        origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } } satisfies CommandContext }));
      const oldRouting = previous?.consoleRouting ?? previous?.externalRouting;
      const live = staging ?? new Set(contexts.flatMap(local => oldRouting?.visible(local.context) ?? []));
      this.candidateProgram = configuration?.program ?? (this.startup !== undefined ? this.startup.prepareClientCommands(commandOptions, contexts)
        : prepareClientCommands(this.commands, contexts, live, commandOptions));
      configuration?.forwardCommands(request => { actions.execute(request.name, request.arguments_, request.seat, request.source); });
      for (const [seat, defaults] of this.candidateDefaults) {
        const input = this.candidateProgram.input(seat);
        if (input === null || input === undefined) throw new Error("Candidate defaults lost their retained seat");
        for (const binding of this.startup?.previewBindings(seat, defaults) ?? defaults) input.bind(binding);
      }
    }
    this.controllers = client?.controllers ?? previous?.controllers ?? SdlControllers.open();
    this.inputDevices = client?.inputDevices ?? previous?.inputDevices ?? new InputDevices(this.sharedOwner ?? this.cvars, inputDeviceStore(options.userContentRoot), actions.print);
    this.ownsInputDevices = client === undefined && previous === undefined;
    const previousKeyboard = previous?.router.keyboardSeat() ?? null;
    this.router = new InputRouter({ seats: locals.map((local, index) => ({ input: local.input,
      controller: previous !== undefined && previous.router.seat(local.player.seat.id) !== null ? previous.router.controllerSelection(local.player.seat.id) : saved[index]?.controller ?? (locals.length > 1 && index === 0 ? { kind: "none" } : { kind: "automatic" }) })),
      deferPlatform: previous !== undefined || staging !== null, keyboardSeat: previous === undefined
        ? routing === null ? first.seat.id : routing.keyboardSeat === null ? null : locals.find(local => local.player.seat.id.index === routing.keyboardSeat)?.player.seat.id ?? first.seat.id
        : previousKeyboard === null ? null : locals.find(local => local.player.seat.id.equals(previousKeyboard))?.player.seat.id ?? first.seat.id, controllers: this.controllers, now, ticks: () => this.window.ticks, subframe: true,
      unhandled: event => {
        if (event.kind === "assignment") locals[event.slot]?.haptics.cancel();
        if (event.kind === "quit" || event.kind === "window" && event.event === 14) actions.quit();
      } });
    this.clientCommands = new ClientCommandBindings(this.commands, locals.map(local => local.input.seat),
      (command, seat) => this.actions.execute(command.argv[0] ?? "", command.args, seat, command.source));
    this.controllerSettings = new ControllerSettings(this.router, locals.map(local => local.input.seat), () => this.controllers.devices, settings, actions.print);
    try {
      if (previous === undefined && staging === null) this.router.attachWindow(window);
      this.router.restart();
      const platform = client?.platform.current;
      const previousSettings = previous?.controllerSettings ?? (platform?.kind === "menu" ? platform.controllerSettings : platform?.input.controllerSettings);
      if (previousSettings === undefined) this.controllerSettings.update();
      else this.controllerSettings.copySettledProfilesFrom(previousSettings);
    } catch (error) { if (this.ownsControllers) this.controllers.close(); throw error; }
  }

  private executeUiCommand(name: string, args: readonly string[], seat: SeatId | null, source: CommandContext): undefined {
    if (seat !== null && (name === "weapnext" || name === "weapprev")
      && this.seatUi.get(seat)?.cycleWeapon?.(name === "weapnext" ? 1 : -1)) return undefined;
    if (seat !== null && name === "switchweapon" && args.length === 2) {
      const first = Number(args[0]), second = Number(args[1]);
      if (Number.isInteger(first) && Number.isInteger(second) && this.seatUi.get(seat)?.switchWeapon?.(first, second)) return undefined;
    }
    return this.actions.execute(name, args, seat, source);
  }

  private registerCommand(name: string, handler: Parameters<CommandBuffer["register"]>[1]): void {
    if (this.commands.exists(name)) return;
    if (this.commands.register(name, handler)) this.unregister.push(() => { this.commands.unregister(name); });
  }

  private activateCommands(preserveFocus = false): void {
    if (this.commandsActive) return;
    this.commandsActive = true;
    this.inputDevices.activate(this.router);
    this.registerCommand("in_restart", () => { this.releaseForProfileChange(); this.inputDevices.restart(); this.router.restart(); });
    this.registerCommand("midiinfo", () => { this.inputDevices.info(); return undefined; });
    if (this.startup !== undefined) this.unregister.push(this.startup.bindOutput((text, source) => this.print(text, source)));
    const locals = this.locals, actions = this.actions;
    const context = this.cvars.context;
    const sourceDialect = actions.console?.dialect() ?? this.dialect;
    const print = (text: string, source?: CommandContext): void => this.print(text, source);
    const settingBindings = locals.map(local => {
      const registry = this.inputCvars(local.player.seat.id);
      if (registry === null) throw new Error("Local input has no settings registry");
      local.builder.bindPitchDrift(() => ({ speed: registry.variableValue("v_centerspeed"), delay: registry.variableValue("v_centermove") }));
      const source: CommandContext = { session: context.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } };
      const previousRun = this.commands.findCvar("cl_run", source);
      if (registry.find("cl_run") === undefined && previousRun !== undefined) registry.applyArchive([{ name: "cl_run", value: previousRun.value }]);
      return bindRunCvar(registry, local.builder);
    });
    const lookup = (seat: SeatId): SeatInput | null => this.locals.find(local => local.player.seat.id.equals(seat))?.input ?? null;
    this.unregister.push(...settingBindings, registerWheelCommands(this.commands, (seat, mode, down) => this.seatUi.get(seat)?.wheel(mode, down)),
      registerInputCommands(this.commands, lookup, command => this.clientCommands.dispatch(command)), ...(this.startup === undefined ? [registerBindingCommands(this.commands, lookup, print)] : []), registerDiscoveryCommands(this.commands, print), registerLlmCommands(this.commands, print, actions.llm),
      registerQ2ClientCommands(this.commands, sourceDialect, (name, args, seat, source) => this.executeUiCommand(name, args, seat, source)),
      registerQ1ClientCommands(this.commands, sourceDialect, (name, args, seat, source) => actions.execute(name, args, seat, source)));
    this.registerCommand("quit", () => actions.quit());
    for (const name of ["+grapple", "-grapple", "+grenade", "-grenade"]) this.registerCommand(name, invocation => {
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      if (origin.kind !== "local-seat") return undefined;
      const capabilities = this.bindingCapabilities;
      if (!(name.endsWith("grapple") ? capabilities.offhandGrapple : capabilities.offhandGrenades)) {
        if (name.startsWith("+")) print("This session has no selected offhand action.\n");
        return undefined;
      }
      let buttons = this.offhandButtons.get(origin.seat);
      if (buttons === undefined) { buttons = { grapple: new InputButton(), grenade: new InputButton() }; this.offhandButtons.set(origin.seat, buttons); }
      const button = name.endsWith("grapple") ? buttons.grapple : buttons.grenade, active = button.active;
      const key = invocation.args[0] ?? "console", time = this.now();
      if (name.startsWith("+")) button.down(key, time);
      else if (invocation.args[0] === undefined) button.release(time);
      else button.up(key, time);
      return active === button.active ? undefined : actions.execute(name, [], origin.seat, invocation.source);
    });
    for (const name of ["local_join", "local_drop", "weapnext", "weapprev", "switchweapon", "use", "weapon", "save", "load", "map", "say", "say_team", "centerview", ...applicationAudioCommands]) {
      if ((sourceDialect === "q2-classic" || sourceDialect === "q2-rerelease") && this.commands.exists(name)) continue;
      this.registerCommand(name, invocation => {
        let origin = invocation.source.origin;
        while (origin.kind === "script") origin = origin.caller;
        return this.executeUiCommand(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
      });
    }
    for (const [input, callback] of this.uiCallbacks) {
      this.releaseUi.push(input.bindUiEvent(callback, this.now));
      if (!preserveFocus) input.setFocus({ kind: "game" }, this.now());
    }
    for (const local of locals) local.console.publish(local.input.focus);
    this.clientCommands.activate();
    for (const command of this.stagedCommands.splice(0)) {
      if (command.kind === "console") this.commands.append(command.text, command.source);
      else command.dispatch(command.text, command.source);
    }
  }

  private retireCommands(): void {
    this.clientCommands.deactivate();
    for (const release of this.releaseUi.splice(0)) release();
    for (const unregister of this.unregister.splice(0)) unregister();
    this.commandsActive = false;
  }

  pollLoadingEvents(): void {
    const events = this.window.pollEvents();
    this.pendingWindowEvents.push(...events);
    this.pendingControllerEvents.push(...this.controllers.pollEvents());
    if (events.some(event => event.kind === "quit" || event.kind === "window" && event.event === 14)) this.actions.quit();
  }

  private readonly startup: PreparedStartup | undefined;
  private configurationPublished = false;
  validateStartupAdoption(): void {
    if (this.startup === undefined) return;
    if (this.actions.startupReader?.(this.scripts, this.options) === undefined) throw new Error("Startup script reader adoption is missing");
    this.startup.validateOwners({ source: this.actions.console?.server()?.cvars ?? (this.externalRouting === undefined ? this.startup.source : this.cvars),
      movement: this.cvars, fallback: this.consoleCvars });
  }
  adoptStartup(): void {
    if (this.startup === undefined) return;
    const read = this.actions.startupReader?.(this.scripts, this.options);
    if (read === undefined) throw new Error("Startup script reader adoption is missing");
    const routing = this.consoleRouting ?? this.externalRouting;
    if (routing === undefined) throw new Error("Startup adoption has no cvar routing");
    this.startup.adopt(routing, (name, args, source) => {
      let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
      return this.actions.execute(name, args, origin.kind === "local-seat" ? origin.seat : null, source);
    }, { source: this.actions.console?.server()?.cvars ?? (this.externalRouting === undefined ? this.startup.source : this.cvars), movement: this.cvars, fallback: this.consoleCvars, scripts: this.scripts, read });
    for (const local of this.locals) this.startup.adoptSeat(local.player.seat.id,
      this.actions.console?.seat(local.player.seat.id) ?? (this.externalRouting === undefined ? undefined : this.cvars), this.mouseSettings.get(local.player.seat.id));
    const configuration = this.actions.configuration;
    if (configuration !== undefined && !this.configurationPublished) {
      if (this.candidateProgram !== null) throw new Error("Configuration commands must publish before their continuation");
      configuration.publishContinuation(this.startup);
      this.configurationPublished = true;
    }
  }
  advanceStartup(): Promise<boolean> { return this.startup?.advanceFrame() ?? Promise.resolve(false); }

  pump(executeCommands = true): void {
    this.releaseOffhand(false);
    this.synchronizeClientFocus();
    for (const event of [...this.pendingWindowEvents.splice(0), ...this.window.pollEvents()]) {
      if (event.kind === "window" && event.event === 13) this.stopHaptics();
      this.router.handlePlatform(event);
    }
    this.inputDevices.frame(this.now());
    for (const event of [...this.pendingControllerEvents.splice(0), ...this.controllers.pollEvents()]) this.router.handleController(event);
    this.controllerSettings.update();
    if (executeCommands) this.commands.execute();
    this.router.updateCapture();
    for (const local of this.locals) {
      local.haptics.setActive(local.input.focused && local.input.focus.kind === "game");
      local.haptics.update();
    }
  }

  private releaseOffhand(all: boolean): void {
    for (const local of this.locals) {
      if (!all && local.input.focused && local.input.focus.kind === "game") continue;
      const buttons = this.offhandButtons.get(local.player.seat.id);
      if (buttons === undefined) continue;
      for (const name of ["grapple", "grenade"] satisfies readonly ("grapple" | "grenade")[]) {
        if (!buttons[name].active) continue;
        buttons[name].release(this.now()); this.actions.execute(`-${name}`, [], local.player.seat.id);
      }
    }
  }

  bindHaptics(load: (request: ResourceRequest) => Promise<Uint8Array | null>): void {
    for (const local of this.locals) local.haptics.invalidateAssets();
    this.hapticLoad = load;
  }

  stopHaptics(): void { for (const local of this.locals) local.haptics.cancel(); }

  async soundHaptics(content: ContentId, sound: string, actor: ActorId | null, audience: AudioAudience): Promise<void> {
    if (actor === null) return;
    for (const local of this.locals) {
      if (!local.player.actor.equals(actor) || audience.kind === "seat" && !audience.seat.equals(local.player.seat.id)) continue;
      local.haptics.setActive(local.input.focused && local.input.focus.kind === "game");
      await local.haptics.sound(content, sound);
    }
  }

  build(elapsedMilliseconds: number, serverMilliseconds: number, serverFrame: number, wallElapsedMilliseconds = elapsedMilliseconds): readonly ActorCommand[] {
    const dialect = this.dialect;
    const frame: UserCommandFrame = dialect === "q1-netquake" ? { kind: "q1-netquake", acknowledgedServerTimeSeconds: serverMilliseconds / 1000 }
      : dialect === "q2-classic" ? { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true }
      : dialect === "q2-rerelease" ? { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame, attackAllowed: true }
      : dialect === "q1-quakeworld" ? { kind: "q1-quakeworld" }
      : { kind: "q3", serverTimeMilliseconds: Math.trunc(serverMilliseconds), weapon: 2, sensitivity: 1 };
    return this.locals.map(local => {
      const sample = local.input.sample(this.now(), wallElapsedMilliseconds);
      const selectedSample = this.seatUi.get(local.player.seat.id)?.sample(sample) ?? sample;
      const selection = this.q3Selections.get(local.player.seat.id);
      const drift = this.simulation.playerView(local.player.actor).pitchDrift;
      const sourceFrame = drift === undefined ? frame : { ...frame, pitchDrift: drift };
      const selectedFrame = frame.kind === "q3" && selection !== undefined ? { ...sourceFrame, ...selection } : sourceFrame;
      const impulseProvider = dialect === "q3" || dialect === "q2-rerelease" ? this.actions.arsenalImpulseProvider?.(local.player.seat.id) : null;
      const arsenal = impulseProvider == null ? this.arsenalSelections.get(local.player.seat.id) : { provider: impulseProvider, weapon: null };
      return { actor: local.player.actor,
        source: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id }, sequence: this.sequence++,
        command: local.builder.build(selectedSample, selectedFrame, elapsedMilliseconds),
        ...(arsenal === undefined ? {} : { arsenal: { ...arsenal, ...(impulseProvider == null || selectedSample.impulse === 0 ? {} : { impulse: selectedSample.impulse }), useHoldable: selectedSample.focus.kind === "game"
          && selectedSample.buttons.some(button => (button.action === "use" || button.action === "button2") && (button.active || button.pressed)) } }) };
    });
  }

  get nextCommandSequence(): number { return this.sequence; }

  resumeCommands(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError("Input command sequence must be a nonnegative safe integer");
    this.sequence = Math.max(this.sequence, sequence);
  }

  private synchronizeClientFocus(): void {
    for (const local of this.locals) {
      const focus = local.input.focus, captured = this.actions.clientCapturesInput?.(local.player.seat.id) ?? false;
      if (captured && focus.kind === "game") local.input.setFocus({ kind: "menu", menu: "menu:q3:cgame", control: null }, this.now());
      else if (!captured && focus.kind === "menu" && focus.menu === "menu:q3:cgame") local.input.setFocus({ kind: "game" }, this.now());
    }
  }

  input(event: SeatInputEvent): boolean {
    if (event.kind === "focus" && !event.focused) this.locals.find(local => local.player.seat.id.equals(event.seat))?.haptics.cancel();
    this.synchronizeClientFocus(); return this.router.seat(event.seat)?.input(event) ?? false; }

  setQ3CommandSelection(seat: SeatId, selection: Q3CommandSelection): void {
    if (!this.locals.some(local => local.player.seat.id.equals(seat))) throw new Error("Command selection has no local seat");
    this.q3Selections.set(seat, selection);
  }

  setArsenalSelection(seat: SeatId, selection: Pick<ArsenalIntent, "provider" | "weapon"> | null): void {
    if (!this.locals.some(local => local.player.seat.id.equals(seat))) throw new Error("Arsenal selection has no local seat");
    if (selection === null) this.arsenalSelections.delete(seat);
    else this.arsenalSelections.set(seat, selection);
  }

  clientCommandRegistration(seat: SeatId): ClientCommandRegistration { return this.clientCommands.createOwner(seat); }

  attachUi(seat: SeatId, ui: ApplicationInputUi): () => void {
    if (!this.locals.some(local => local.player.seat.id.equals(seat))) throw new Error("UI seat has no local input");
    if (this.seatUi.has(seat)) throw new Error("Seat UI is already attached");
    this.seatUi.set(seat, ui);
    return () => { this.seatUi.delete(seat); };
  }

  enqueueClientCommand(text: string, source: CommandContext): void {
    if (this.candidateProgram !== null) this.candidateProgram.commands.append(text, source);
    else if (this.commandsActive) this.commands.append(text, source);
    else this.stagedCommands.push({ kind: "console", text, source });
  }
  enqueueClientReliable(text: string, source: CommandContext, dispatch: (text: string, source: CommandContext) => void): void {
    if (this.commandsActive) dispatch(text, source);
    else this.stagedCommands.push({ kind: "reliable", text, source, dispatch });
  }
  get profileChanged(): boolean {
    return this.commands.dialect !== (this.actions.console?.dialect() ?? this.dialect) || this.locals.some(local => local.input.dialect !== this.dialect);
  }
  releaseForProfileChange(commands?: Pick<CommandBuffer, "append">): void {
    this.releaseOffhand(true);
    for (const local of this.locals) local.input.release(this.now(), commands);
    this.inputDevices.release(this.now(), commands);
  }
  get window(): SdlWindow { return this.currentWindow; }
  publishWindow(next: SdlWindow): void {
    if (next === this.currentWindow) return;
    const previous = this.currentWindow;
    this.releaseForProfileChange();
    this.stopHaptics();
    this.pendingWindowEvents = [];
    this.currentWindow = next;
    try { this.router.attachWindow(next); }
    catch (error) {
      this.currentWindow = previous;
      this.router.attachWindow(previous);
      throw error;
    }
  }
  transferPlatformTo(next: ApplicationInput): void {
    next.pendingWindowEvents = this.pendingWindowEvents; this.pendingWindowEvents = [];
    next.pendingControllerEvents = this.pendingControllerEvents; this.pendingControllerEvents = [];
    this.retireCommands();
    next.adoptStartup();
    this.router.transferWindowTo(next.router);
    next.activateCommands();
    next.router.updateCapture();
    next.ownsControllers = this.ownsControllers;
    this.ownsControllers = false;
    next.ownsInputDevices = this.ownsInputDevices;
    this.ownsInputDevices = false;
  }
  transferPlatformToFrontend(next: InputRouter, commands?: Pick<CommandBuffer, "append">): void {
    this.releaseForProfileChange(commands);
    this.retireCommands();
    this.router.transferWindowTo(next);
    for (const event of this.pendingWindowEvents.splice(0)) next.handlePlatform(event);
    for (const event of this.pendingControllerEvents.splice(0)) next.handleController(event);
    this.ownsControllers = false;
  }
  activatePreparedPlatform(): void {
    this.router.attachWindow(this.window);
    this.activateCommands();
    this.adoptStartup();
  }
  publishClientSeats(client: ClientBootstrap, seatPublication: "replace" | "retain"): void {
    for (const local of this.locals) {
      const retained = client.consoles.get(local.player.seat);
      if (retained !== undefined && retained !== local.console) {
        retained.adopt(local.console, local.input.focus); local.console = retained;
      } else if (retained === undefined) {
        local.console.publish(local.input.focus); client.consoles.set(local.player.seat, local.console);
      }
    }
    const seats = this.locals.map(local => {
      const mouse = this.mouseSettings.get(local.player.seat.id);
      const cvars = this.actions.console?.seat(local.player.seat.id) ?? (this.externalRouting === undefined ? undefined : this.cvars);
      if (mouse === undefined || cvars === undefined || cvars === null) throw new Error("Published client seat has no registry owners");
      return { id: local.player.seat.id, input: local.input, mouse, cvars,
        context: { session: local.player.seat.id.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } } satisfies CommandContext };
    });
    client.prepared.publishSeats(seatPublication === "replace" ? seats : client.prepared.seats.map(previous =>
      seats.find(seat => seat.id.equals(previous.id)) ?? previous), seats.map(seat => seat.id));
    for (const choices of this.actions.configuration?.bindingChoices ?? []) {
      const seat = client.prepared.seats.find(seat => seat.id.equals(choices.id));
      if (seat === undefined) throw new Error("Published configuration seat is missing");
      seat.overriddenKeys.clear();
      for (const key of choices.overriddenKeys) seat.overriddenKeys.add(key);
      seat.allBindingsChosen = choices.allBindingsChosen;
      seat.selectedBindings = choices.selectedBindings;
    }
    const locals = this.locals.map(local => {
      const prepared = client.prepared.seats.find(seat => seat.id.equals(local.player.seat.id));
      if (prepared === undefined) throw new Error("Published input seat is missing");
      return { client: local.player.seat.client, seat: local.player.seat, prepared };
    });
    if (seatPublication === "replace") {
      client.locals.splice(0, client.locals.length, ...locals);
      for (const seat of client.consoles.keys()) if (!locals.some(local => local.seat === seat)) client.consoles.delete(seat);
    }
    else for (const local of locals) {
      const index = client.locals.findIndex(previous => previous.seat === local.seat && previous.client === local.client);
      if (index < 0) throw new Error("Source input attempted to replace a retained client");
      client.locals.splice(index, 1, local);
    }
  }
  publishClientPlatform(client: ClientBootstrap, seatPublication: "replace" | "retain"): void {
    if (this.controllers !== client.controllers || this.commands !== client.prepared.commands)
      throw new Error("Client input publication changed retained owners");
    this.validateStartupAdoption();
    this.validateCandidateCommands();
    const previous = client.platform.current;
    if (previous?.kind === "world") this.releaseIntoCandidate(previous.input, true);
    else for (const seat of client.prepared.seats) seat.input.release(this.now(), this.candidateProgram?.releaseCommands);
    this.publishCandidateCommands();
    this.publishClientSeats(client, seatPublication);
    if (previous?.kind === "world") previous.input.transferPlatformTo(this);
    else {
      previous?.retireCommands();
      this.adoptStartup();
      if (previous === null) this.router.attachWindow(this.window);
      else previous.router.transferWindowTo(this.router);
      this.activateCommands();
      this.router.updateCapture();
    }
    this.ownsControllers = false;
    client.platform.current = { kind: "world", input: this };
  }

  rebindPlayers(players: readonly LocalPlayer[], simulation: Pick<SimulationPresentationAccess, "playerView">, mode: "world" | "source-round" = "world"): void {
    this.simulation = simulation;
    if (mode === "world") this.releaseOffhand(true);
    if (players.length !== this.locals.length) throw new Error("World travel changed the local seat count");
    for (const local of this.locals) {
      const player = players.find(player => player.seat.id.equals(local.player.seat.id));
      if (player === undefined) throw new Error("World travel has no player for a local seat");
      this.seatUi.get(local.player.seat.id)?.clearPrompt?.();
      local.haptics.invalidateAssets();
      if (mode === "world") local.input.release(this.now());
      local.player.actor = player.actor;
      if (mode === "world" || local.builder.dialect !== "q3") local.builder.setViewAngles(simulation.playerView(player.actor).angles);
    }
    this.q3Selections.clear();
    this.arsenalSelections.clear();
  }

  async saveSettings(): Promise<void> {
    if (this.startup?.pending) return;
    await this.inputDevices.save();
    await this.controllerSettings.settle();
    for (const local of this.locals) {
      const bindings = local.input.bindings.map(binding => binding.input.kind === "controller-button" || binding.input.kind === "controller-axis"
        ? { ...binding, input: { ...binding.input, device: 0 } } : binding);
      await this.settings.saveSeat(`input/seat-${local.player.seat.id.index + 1}.json`, { version: 1, bindings,
        alwaysRun: local.builder.tuning.alwaysRun, gamepad: structuredClone(local.input.gamepad.tuning), mouse: { ...local.builder.mouse.tuning }, history: local.console.history.lines,
        rumble: local.haptics.enabled, rumbleStrength: local.haptics.strength, controller: this.router.controllerSelection(local.player.seat.id) });
      await this.controllerSettings.save(local.player.seat.id);
    }
    const keyboard = this.router.keyboardSeat(), index = keyboard?.index ?? -1;
    await this.settings.saveInputRouting("input/routing.json", index < 0 ? null : index);
    if (this.archivePersistence && !this.startup?.pending) {
      await saveCvarArchive(this.settings, ["movement", this.cvars.dialect], this.cvars);
      if (this.consoleCvars !== this.cvars) await saveCvarArchive(this.settings, ["fallback", this.consoleCvars.dialect], this.consoleCvars);
      for (const [seat, mouse] of this.mouseSettings)
        await saveCvarArchive(this.settings, ["input", mouse.cvars.dialect, String(seat.index)], mouse.cvars);
    }
  }

  close(): undefined {
    this.releaseOffhand(true);
    if (this.ownsInputDevices) this.inputDevices.close();
    this.controllerSettings.close();
    for (const local of this.locals) local.haptics.close();
    this.router.close();
    if (this.ownsControllers) this.controllers.close();
    this.stagedCommands.length = 0;
    this.seatUi.clear();
    this.q3Selections.clear();
    this.arsenalSelections.clear();
    this.retireCommands();
    this.consoleRouting?.close();
    this.actions.configuration?.routing.close();
    return undefined;
  }
}
