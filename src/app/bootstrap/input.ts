import type { StartupConfigOptions } from "./startup-config.ts";
import type { PreparedStartup } from "./prepared-startup.ts";
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
import type { SeatInputEvent, SeatInputFocus } from "../../contracts/ui.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { SeatConsole } from "../../console/session.ts";
import { defaultBindings, registerBindingCommands, registerWheelCommands } from "../../input/bindings.ts";
import type { WeaponBindingItem } from "../../input/weapon-bindings.ts";
import { InputRouter } from "../../input/router.ts";
import { SeatInput, registerInputCommands } from "../../input/seat.ts";
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
  readonly console: SeatConsole;
  readonly builder: InputCommandBuilder;
  readonly haptics: SeatHaptics;
}

export interface ApplicationInputCommands {
  readScript?(name: string): Promise<Uint8Array | undefined>;
  startupReader?(scripts: ConsoleScriptFiles, options: ApplicationOptions): StartupConfigOptions["read"];
  readonly llm?: LlmCommandRequester;
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
  readonly inputSettings?: MouseSettings;
}

export class ApplicationInput {
  readonly scripts: ConsoleScriptFiles;
  get bindingCapabilities(): BindingCapabilities {
    const capabilities = this.actions.bindingCapabilities?.() ?? { chat: this.options.network.kind.endsWith("-client"),
      scoreCommand: this.options.network.kind === "q2-client" ? "score" : "+scores",
      offhandGrapple: false, offhandGrenades: false } satisfies BindingCapabilities;
    return { ...capabilities, scoreCommand: capabilities.scoreCommand ?? "+scores" };
  }
  get sharedCvars(): CvarRegistry | null { return this.actions.sharedCvars ?? null; }
  readonly commands: CommandBuffer;
  readonly cvars: CvarRegistry;
  readonly locals: readonly LocalInput[];
  readonly controllers: SdlControllers;
  readonly router: InputRouter;
  readonly controllerSettings: ControllerSettings;
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
  private readonly clientCommands = new Set<string>();
  private commandsActive = false;
  private readonly stagedCommands: ({ readonly kind: "console"; readonly text: string; readonly source: CommandContext }
    | { readonly kind: "reliable"; readonly text: string; readonly source: CommandContext; readonly dispatch: (text: string, source: CommandContext) => void })[] = [];
  private readonly consoleRouting: ApplicationConsoleRouting | null;
  private readonly consoleCvars: CvarRegistry;
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
    const saved = await Promise.all(players.map((_, index) => settings.loadSeat(`input/seat-${index + 1}.json`)));
    const routing = await settings.loadInputRouting("input/routing.json");
    const sourceDialect = actions.console?.dialect() ?? dialect;
    const archives = owner !== undefined || previous !== undefined || prepared !== undefined ? null : {
      movement: await loadCvarArchive(settings, ["movement", dialect], dialect),
      fallback: await loadCvarArchive(settings, ["fallback", sourceDialect], sourceDialect),
      input: await Promise.all(players.map(player => loadCvarArchive(settings, ["input", sourceDialect, String(player.seat.id.index)], sourceDialect))),
    };
    const input = new ApplicationInput(window, players, options, dialect, simulation, actions, now, settings, saved, routing, archives, owner, previous, prepared);
    try { await input.controllerSettings.settle(); if (previous === undefined) { input.activateCommands(); input.adoptStartup(); } return input; }
    catch (error) { input.close(); throw error; }
  }

  private constructor(readonly window: SdlWindow, players: readonly LocalPlayer[], readonly options: ApplicationOptions, readonly dialect: CommandDialect,
    simulation: Pick<SimulationPresentationAccess, "playerView">, private readonly actions: ApplicationInputCommands,
    readonly now: () => number, private readonly settings: ConfigStore, saved: readonly (SeatSettings | null)[],
    routing: { readonly keyboardSeat: number | null } | null,
    private readonly loadedArchives: { readonly movement: readonly CvarArchiveEntry[]; readonly fallback: readonly CvarArchiveEntry[]; readonly input: readonly (readonly CvarArchiveEntry[])[] } | null,
    owner?: ApplicationInputCommandOwner, previous?: ApplicationInput, prepared?: PreparedStartup) {
    this.startup = prepared ?? previous?.startup;
    const archives = this.loadedArchives;
    this.ownsControllers = previous === undefined;
    const first = players[0];
    if (first === undefined) throw new Error("Native input requires at least one local player");
    const context: CommandContext = { session: first.actor.session, origin: { kind: "local-console" } };
    const print = (text: string, source?: CommandContext): void => this.print(text, source);
    if (owner !== undefined && (owner.cvars.dialect !== dialect || actions.console !== undefined)) throw new Error("Input command owner does not match its console dialect");
    const sourceDialect = actions.console?.dialect() ?? dialect;
    this.cvars = (this.startup?.movement.dialect === dialect ? this.startup.movement : undefined) ?? owner?.cvars ?? new CvarRegistry({ dialect, context, print });
    const consoleCvars = (this.startup?.fallback.dialect === sourceDialect ? this.startup.fallback : undefined) ?? (sourceDialect === dialect ? this.cvars : new CvarRegistry({ dialect: sourceDialect, context, print }));
    this.consoleCvars = consoleCvars;
    if (owner === undefined) {
      if (this.startup?.movement !== this.cvars) {
        if (previous?.cvars.dialect === dialect) this.cvars.restoreSaveState(previous.cvars.captureSaveState());
        else this.cvars.applyArchive(archives?.movement ?? []);
      }
      if (this.startup?.fallback !== consoleCvars) {
        if (consoleCvars !== this.cvars) {
          if (previous?.consoleCvars.dialect === sourceDialect) consoleCvars.restoreSaveState(previous.consoleCvars.captureSaveState());
          else consoleCvars.applyArchive(archives?.fallback ?? []);
        } else consoleCvars.applyArchive(archives?.fallback ?? []);
      }
    }
    this.consoleRouting = owner === undefined ? new ApplicationConsoleRouting({ fallback: consoleCvars,
      sourceDialect: () => actions.console?.dialect() ?? sourceDialect, server: () => actions.console?.server() ?? null,
      seat: id => actions.console?.seat(id) ?? null, input: id => this.inputCvars(id), movement: () => this.cvars, shared: () => actions.sharedCvars ?? null }) : null;
    this.scripts = prepared?.scripts ?? owner?.scripts ?? new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings, mounted: actions.readScript });
    this.commands = this.startup?.commands ?? owner?.commands ?? new CommandBuffer({ dialect: sourceDialect, context, cvars: consoleCvars,
      readScript: (name, source) => this.startup?.readScript(name, source) ?? this.scripts.read(name, source),
      onScriptComplete: event => this.startup?.onScriptComplete(event),
      allowCommand: command => this.startup?.allowCommand(command) ?? true,
      ...(this.consoleRouting === null ? {} : { cvarRouting: this.consoleRouting }), print, forwardToServer: invocation => {
      const name = invocation.argv[0]; if (name === undefined) return undefined;
      this.startup?.noteWorldAction();
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
    } });
    const locals: LocalInput[] = [];
    for (const player of players) {
      const seatContext: CommandContext = { session: context.session, origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } };
      let console: SeatConsole | null = null;
      const preparedSeat = this.startup?.seats.find(seat => seat.id.equals(player.seat.id));
      const input = preparedSeat?.input ?? new SeatInput({ seat: player.seat.id, dialect, context: seatContext, commands: this.commands,
        uiEvent: () => false });
      this.uiCallbacks.set(input, (event, focus) => {
          const ui = this.seatUi.get(player.seat.id);
          if (event.kind === "key" && (event.code === 96 || event.code === 126)) {
            if (event.down) { if (!event.repeat) ui?.closeMenus(); console?.toggleFromKey(event.repeat); }
            return true;
          }
          return (console?.input(event, focus) ?? false) || (actions.clientInput?.(event) ?? false) || (ui?.input(event, focus) ?? false);
        });
      console = new SeatConsole({ seat: player.seat.id, dialect: sourceDialect, context: seatContext, commands: this.commands, cvars: consoleCvars,
        now, connected: () => true, clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); }, focus: focus => { input.setFocus(focus, now());
          locals.find(local => local.player.seat.id.equals(player.seat.id))?.haptics.setActive(input.focused && focus.kind === "game"); },
        chat: (text, team, target) => actions.execute(team ? "say_team" : "say", target === null ? [text] : [text, String(target)], player.seat.id) });
      const preparedMouse = preparedSeat?.mouse.cvars.dialect === sourceDialect ? preparedSeat.mouse : undefined;
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
        else mouseSettings.cvars.applyArchive(archives?.input[locals.length] ?? []);
      }
      const builder = new InputCommandBuilder(dialect, new MouseInput(mouseSettings));
      builder.setViewAngles(simulation.playerView(player.actor).angles);
      const defaults = defaultBindings(0, dialect, actions.bindingItems?.(player.seat.id) ?? []);
      if (previous === undefined || preparedSeat === undefined) for (const binding of this.startup?.bindings(player.seat.id, defaults) ?? defaults) input.bind(binding);
      locals.push({ player, input, console, builder, haptics: new SeatHaptics({ seat: player.seat.id,
        controllers: { rumble: (instance, low, high, duration) => this.controllers.rumble(instance, low, high, duration) },
        controller: seat => this.router.controllerFor(seat), load: request => this.hapticLoad(request), now }) });
    }
    for (const [index, local] of locals.entries()) {
      const profile = saved[index]; if (profile === undefined || profile === null) continue;
      if (this.startup === undefined) { local.input.unbindAll(); for (const binding of profile.bindings) local.input.bind(binding); }
      if (previous === undefined || this.startup === undefined) local.input.gamepad.tuning = structuredClone(profile.gamepad);
      if (this.startup === undefined && profile.alwaysRun !== undefined) local.builder.tuning = { ...local.builder.tuning, alwaysRun: profile.alwaysRun };
      if (owner?.inputSettings === undefined && this.startup === undefined) local.builder.mouse.tuning = { ...profile.mouse };
      local.console.history.replace(profile.history); local.haptics.setEnabled(profile.rumble); local.haptics.setStrength(profile.rumbleStrength ?? 1);
    }
    if (previous?.startup?.pending) for (const local of locals) {
      const prior = previous.locals.find(prior => prior.player.seat.id.equals(local.player.seat.id));
      if (prior === undefined) continue;
      if (local.input !== prior.input) { local.input.unbindAll(); for (const binding of prior.input.bindings) local.input.bind(binding); }
      if (local.input !== prior.input) local.builder.mouse.tuning = { ...prior.builder.mouse.tuning };
      local.builder.tuning = { ...local.builder.tuning, alwaysRun: prior.builder.tuning.alwaysRun };
    }
    this.locals = locals;
    this.controllers = previous?.controllers ?? SdlControllers.open();
    this.router = new InputRouter({ seats: locals.map((local, index) => ({ input: local.input,
      controller: saved[index]?.controller ?? (locals.length > 1 && index === 0 ? { kind: "none" } : { kind: "automatic" }) })),
      deferPlatform: previous !== undefined, keyboardSeat: routing === null ? first.seat.id : routing.keyboardSeat === null ? null : locals[routing.keyboardSeat]?.player.seat.id ?? first.seat.id, controllers: this.controllers, now, ticks: () => window.ticks, subframe: true,
      unhandled: event => {
        if (event.kind === "assignment") locals[event.slot]?.haptics.cancel();
        if (event.kind === "quit" || event.kind === "window" && event.event === 14) actions.quit();
      } });
    this.controllerSettings = new ControllerSettings(this.router, locals.map(local => local.input.seat), () => this.controllers.devices, settings, actions.print);
    try {
      if (previous === undefined) this.router.attachWindow(window);
      this.router.restart();
      if (previous === undefined) this.controllerSettings.update();
      else this.controllerSettings.copySettledProfilesFrom(previous.controllerSettings);
    } catch (error) { if (this.ownsControllers) this.controllers.close(); throw error; }
  }

  private registerCommand(name: string, handler: Parameters<CommandBuffer["register"]>[1]): void {
    if (this.commands.exists(name)) return;
    if (this.commands.register(name, handler)) this.unregister.push(() => { this.commands.unregister(name); });
  }

  private activateCommands(): void {
    if (this.commandsActive) return;
    this.commandsActive = true;
    if (this.startup !== undefined) this.unregister.push(this.startup.bindOutput((text, source) => this.print(text, source)));
    const locals = this.locals, actions = this.actions;
    const context = this.cvars.context;
    const sourceDialect = actions.console?.dialect() ?? this.dialect;
    const print = (text: string, source?: CommandContext): void => this.print(text, source);
    const settingBindings = locals.map(local => {
      const registry = this.inputCvars(local.player.seat.id);
      if (registry === null) throw new Error("Local input has no settings registry");
      const source: CommandContext = { session: context.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } };
      const previousRun = this.commands.findCvar("cl_run", source);
      if (registry.find("cl_run") === undefined && previousRun !== undefined) registry.applyArchive([{ name: "cl_run", value: previousRun.value }]);
      return bindRunCvar(registry, local.builder);
    });
    const lookup = (seat: SeatId): SeatInput | null => this.locals.find(local => local.player.seat.id.equals(seat))?.input ?? null;
    this.unregister.push(...settingBindings, registerWheelCommands(this.commands, (seat, mode, down) => this.seatUi.get(seat)?.wheel(mode, down)),
      registerInputCommands(this.commands, lookup), ...(this.startup === undefined ? [registerBindingCommands(this.commands, lookup, print)] : []), registerDiscoveryCommands(this.commands, print), registerLlmCommands(this.commands, print, actions.llm),
      registerQ2ClientCommands(this.commands, sourceDialect, (name, args, seat, source) => actions.execute(name, args, seat, source)),
      registerQ1ClientCommands(this.commands, sourceDialect, (name, args, seat, source) => actions.execute(name, args, seat, source)));
    this.registerCommand("quit", () => actions.quit());
    this.registerCommand("toggleconsole", invocation => {
      let origin = invocation.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      const local = origin.kind === "local-seat" ? locals.find(local => local.player.seat.id.equals(origin.seat)) : locals[0];
      local?.console.toggle(); return undefined;
    });
    for (const name of ["messagemode", "messagemode2"]) this.registerCommand(name, invocation => {
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      if (origin.kind === "local-seat" && this.bindingCapabilities.chat) {
        const seat = origin.seat;
        locals.find(local => local.player.seat.id.equals(seat))?.console.message(name === "messagemode2");
      }
      return undefined;
    });
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
      return active === button.active ? undefined : actions.execute(name, [], origin.seat);
    });
    for (const name of ["weapnext", "weapprev", "use", "weapon", "save", "load", "map", "say", "say_team", "centerview", ...applicationAudioCommands]) {
      if ((sourceDialect === "q2-classic" || sourceDialect === "q2-rerelease") && this.commands.exists(name)) continue;
      this.registerCommand(name, invocation => {
        let origin = invocation.source.origin;
        while (origin.kind === "script") origin = origin.caller;
        return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
      });
    }
    for (const [input, callback] of this.uiCallbacks) {
      this.releaseUi.push(input.bindUiEvent(callback, this.now));
      input.setFocus({ kind: "game" }, this.now());
    }
    const clientCommands = [...this.clientCommands];
    this.clientCommands.clear();
    this.registerClientCommands(clientCommands);
    for (const command of this.stagedCommands.splice(0)) {
      if (command.kind === "console") this.commands.append(command.text, command.source);
      else command.dispatch(command.text, command.source);
    }
  }

  private retireCommands(): void {
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
  validateStartupAdoption(): void {
    if (this.startup === undefined) return;
    if (this.actions.startupReader?.(this.scripts, this.options) === undefined) throw new Error("Startup script reader adoption is missing");
    this.startup.validateOwners({ source: this.actions.console?.server()?.cvars ?? this.startup.source,
      movement: this.cvars, fallback: this.consoleCvars });
  }
  adoptStartup(): void {
    if (this.startup === undefined) return;
    const read = this.actions.startupReader?.(this.scripts, this.options);
    if (read === undefined) throw new Error("Startup script reader adoption is missing");
    if (this.startup !== undefined && this.consoleRouting !== null) this.startup.adopt(this.consoleRouting, (name, args, source) => {
      let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
      return this.actions.execute(name, args, origin.kind === "local-seat" ? origin.seat : null, source);
    }, { source: this.actions.console?.server()?.cvars ?? this.startup.source, movement: this.cvars, fallback: this.consoleCvars, scripts: this.scripts, read });
    for (const local of this.locals) this.startup?.adoptSeat(local.player.seat.id, this.actions.console?.seat(local.player.seat.id) ?? undefined, this.mouseSettings.get(local.player.seat.id));
  }
  advanceStartup(): Promise<boolean> { return this.startup?.advanceFrame() ?? Promise.resolve(false); }

  pump(executeCommands = true): void {
    this.releaseOffhand(false);
    this.synchronizeClientFocus();
    for (const event of [...this.pendingWindowEvents.splice(0), ...this.window.pollEvents()]) {
      if (event.kind === "window" && event.event === 13) this.stopHaptics();
      this.router.handlePlatform(event);
    }
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
      const selectedFrame = frame.kind === "q3" && selection !== undefined ? { ...frame, ...selection } : frame;
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

  registerClientCommands(names: readonly string[]): void {
    for (const name of names) {
      if (this.clientCommands.has(name)) continue;
      this.clientCommands.add(name);
      if (!this.commandsActive) continue;
      if (name === "+scores" || name === "-scores" || name === "+zoom" || name === "-zoom") this.commands.unregister(name);
      if (this.commands.exists(name)) continue;
      this.registerCommand(name, invocation => {
        let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
        return this.actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
      });
    }
  }

  attachUi(seat: SeatId, ui: ApplicationInputUi): () => void {
    if (!this.locals.some(local => local.player.seat.id.equals(seat))) throw new Error("UI seat has no local input");
    if (this.seatUi.has(seat)) throw new Error("Seat UI is already attached");
    this.seatUi.set(seat, ui);
    return () => { this.seatUi.delete(seat); };
  }

  enqueueClientCommand(text: string, source: CommandContext): void {
    if (this.commandsActive) this.commands.append(text, source);
    else this.stagedCommands.push({ kind: "console", text, source });
  }
  enqueueClientReliable(text: string, source: CommandContext, dispatch: (text: string, source: CommandContext) => void): void {
    if (this.commandsActive) dispatch(text, source);
    else this.stagedCommands.push({ kind: "reliable", text, source, dispatch });
  }
  get profileChanged(): boolean {
    return this.commands.dialect !== (this.actions.console?.dialect() ?? this.dialect) || this.locals.some(local => local.input.dialect !== this.dialect);
  }
  releaseForProfileChange(): void {
    this.releaseOffhand(true);
    for (const local of this.locals) local.input.release(this.now());
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
  }

  rebindPlayers(players: readonly LocalPlayer[], simulation: Pick<SimulationPresentationAccess, "playerView">, mode: "world" | "source-round" = "world"): void {
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
    await this.controllerSettings.settle();
    for (const [index, local] of this.locals.entries()) {
      const bindings = local.input.bindings.map(binding => binding.input.kind === "controller-button" || binding.input.kind === "controller-axis"
        ? { ...binding, input: { ...binding.input, device: 0 } } : binding);
      await this.settings.saveSeat(`input/seat-${index + 1}.json`, { version: 1, bindings,
        alwaysRun: local.builder.tuning.alwaysRun, gamepad: structuredClone(local.input.gamepad.tuning), mouse: { ...local.builder.mouse.tuning }, history: local.console.history.lines,
        rumble: local.haptics.enabled, rumbleStrength: local.haptics.strength, controller: this.router.controllerSelection(local.player.seat.id) });
      await this.controllerSettings.save(local.player.seat.id);
    }
    const keyboard = this.router.keyboardSeat(), index = keyboard === null ? -1 : this.locals.findIndex(local => local.player.seat.id.equals(keyboard));
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
    return undefined;
  }
}
