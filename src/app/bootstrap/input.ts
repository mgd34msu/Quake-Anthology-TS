import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { ArsenalIntent } from "../../contracts/gameplay.ts";
import type { SeatInputEvent, SeatInputFocus } from "../../contracts/ui.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { SeatConsole } from "../../console/session.ts";
import { defaultBindings, registerBindingCommands } from "../../input/bindings.ts";
import { InputRouter } from "../../input/router.ts";
import { SeatInput, registerInputCommands } from "../../input/seat.ts";
import type { SeatInputSample } from "../../input/seat.ts";
import { InputCommandBuilder } from "../../input/user-command.ts";
import type { UserCommandFrame } from "../../input/user-command.ts";
import { SdlControllers } from "../../platform/controller.ts";
import { readSdlClipboard } from "../../platform/sdl.ts";
import type { SdlWindow } from "../../platform/sdl.ts";
import type { SessionSeat } from "../../world/session/index.ts";
import type { ApplicationOptions } from "./options.ts";
import type { SimulationPresentationAccess } from "./simulation/types.ts";
import { ApplicationConsoleRouting } from "./console.ts";
import type { ApplicationConsoleServer } from "./console.ts";

export interface LocalPlayer {
  readonly seat: SessionSeat;
  actor: ActorId;
}

export interface LocalInput {
  readonly player: LocalPlayer;
  readonly input: SeatInput;
  readonly console: SeatConsole;
  readonly builder: InputCommandBuilder;
}

export interface ApplicationInputCommands {
  quit(): undefined;
  execute(name: string, arguments_: readonly string[], seat: SeatId | null): undefined;
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
  sample(input: SeatInputSample): SeatInputSample;
  wheel(mode: "weapons" | "powerups", down: boolean): void;
}

export interface Q3CommandSelection { readonly weapon: number; readonly sensitivity: number; }

export function movementDialect(options: Pick<ApplicationOptions, "movement">): CommandDialect {
  return options.movement === "q1" ? "q1-netquake" : options.movement === "q2" ? "q2-classic" : "q3";
}

export class ApplicationInput {
  readonly commands: CommandBuffer;
  readonly cvars: CvarRegistry;
  readonly locals: readonly LocalInput[];
  readonly controllers: SdlControllers;
  readonly router: InputRouter;
  private sequence = 0;
  private readonly seatUi = new Map<SeatId, ApplicationInputUi>();
  private readonly q3Selections = new Map<SeatId, Q3CommandSelection>();
  private readonly arsenalSelections = new Map<SeatId, Pick<ArsenalIntent, "provider" | "weapon">>();
  private readonly unregister: readonly (() => void)[];
  private readonly consoleRouting: ApplicationConsoleRouting | null;

  constructor(readonly window: SdlWindow, players: readonly LocalPlayer[], readonly options: ApplicationOptions,
    private simulation: Pick<SimulationPresentationAccess, "playerView">, private readonly actions: ApplicationInputCommands,
    readonly now: () => number) {
    const first = players[0];
    if (first === undefined) throw new Error("Native input requires at least one local player");
    const dialect = movementDialect(options);
    const context: CommandContext = { session: first.actor.session, origin: { kind: "local-console" } };
    const print = (text: string): void => {
      actions.print(text);
      for (const local of this.locals ?? []) local.console.print(text);
    };
    this.cvars = new CvarRegistry({ dialect, context, print });
    const sourceDialect = actions.console?.dialect() ?? dialect;
    const consoleCvars = sourceDialect === dialect ? this.cvars : new CvarRegistry({ dialect: sourceDialect, context, print });
    this.consoleRouting = actions.console === undefined ? null : new ApplicationConsoleRouting({ fallback: consoleCvars,
      sourceDialect: () => actions.console?.dialect() ?? sourceDialect, server: () => actions.console?.server() ?? null,
      seat: id => actions.console?.seat(id) ?? null, movement: () => this.cvars });
    this.commands = new CommandBuffer({ dialect: sourceDialect, context, cvars: consoleCvars,
      ...(this.consoleRouting === null ? {} : { cvarRouting: this.consoleRouting }), print, forwardToServer: invocation => {
      const name = invocation.argv[0]; if (name === undefined) return undefined;
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
    } });
    const locals: LocalInput[] = [];
    for (const player of players) {
      const seatContext: CommandContext = { session: context.session, origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } };
      let console: SeatConsole | null = null;
      const input = new SeatInput({ seat: player.seat.id, dialect, context: seatContext, commands: this.commands,
        uiEvent: (event, focus) => {
          const ui = this.seatUi.get(player.seat.id);
          if (event.kind === "key" && event.down && !event.repeat && event.code === 96) {
            ui?.closeMenus(); console?.toggle(); return true;
          }
          return (ui?.input(event, focus) ?? false) || (console?.input(event, focus) ?? false) || (actions.clientInput?.(event) ?? false);
        } });
      console = new SeatConsole({ seat: player.seat.id, dialect: sourceDialect, context: seatContext, commands: this.commands, cvars: consoleCvars,
        now, connected: () => true, clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); }, focus: focus => { input.setFocus(focus, now()); },
        chat: (text, team, target) => actions.execute(team ? "say_team" : "say", target === null ? [text] : [text, String(target)], player.seat.id) });
      const builder = new InputCommandBuilder(dialect);
      builder.setViewAngles(simulation.playerView(player.actor).angles);
      for (const binding of defaultBindings(0, dialect)) input.bind(binding);
      input.bind({ input: { kind: "key", code: 113 }, target: { kind: "command", text: "+weaponwheel" } });
      locals.push({ player, input, console, builder });
    }
    this.locals = locals;
    const lookup = (seat: SeatId): SeatInput | null => this.locals.find(local => local.player.seat.id.equals(seat))?.input ?? null;
    this.unregister = [registerInputCommands(this.commands, lookup), registerBindingCommands(this.commands, lookup, print)];
    this.commands.register("quit", () => actions.quit());
    for (const name of ["+weaponwheel", "-weaponwheel", "+powerupwheel", "-powerupwheel"]) this.commands.register(name, invocation => {
      let origin = invocation.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      if (origin.kind === "local-seat") this.seatUi.get(origin.seat)?.wheel(name.includes("powerup") ? "powerups" : "weapons", name.startsWith("+"));
      return undefined;
    });
    this.commands.register("toggleconsole", invocation => {
      let origin = invocation.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      const local = origin.kind === "local-seat" ? locals.find(local => local.player.seat.id.equals(origin.seat)) : locals[0];
      local?.console.toggle(); return undefined;
    });
    for (const name of ["weapnext", "weapprev", "use", "save", "load", "map", "say", "say_team"]) this.commands.register(name, invocation => {
      let origin = invocation.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      return actions.execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
    });
    this.controllers = SdlControllers.open();
    this.router = new InputRouter({ seats: locals.map((local, index) => ({ input: local.input,
      controller: locals.length > 1 && index === 0 ? { kind: "none" } : { kind: "automatic" } })),
      keyboardSeat: first.seat.id, controllers: this.controllers, now, ticks: () => window.ticks, subframe: true,
      unhandled: event => {
        if (event.kind === "assignment" && event.instance !== null) {
          const input = locals[event.slot]?.input;
          if (input !== undefined) for (const binding of defaultBindings(event.instance, dialect)) input.bind(binding);
        }
        if (event.kind === "quit" || event.kind === "window" && event.event === 14) actions.quit();
      } });
    try { this.router.attachWindow(window); this.router.restart(); }
    catch (error) { this.controllers.close(); throw error; }
  }

  pump(): void {
    this.synchronizeClientFocus();
    for (const event of this.window.pollEvents()) {
      this.router.handlePlatform(event);
    }
    for (const event of this.controllers.pollEvents()) this.router.handleController(event);
    this.commands.execute();
    this.router.updateCapture();
  }

  build(elapsedMilliseconds: number, serverMilliseconds: number, serverFrame: number): readonly ActorCommand[] {
    const dialect = movementDialect(this.options);
    const frame: UserCommandFrame = dialect === "q1-netquake" ? { kind: "q1-netquake", acknowledgedServerTimeSeconds: serverMilliseconds / 1000 }
      : dialect === "q2-classic" ? { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true }
      : dialect === "q2-rerelease" ? { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame, attackAllowed: true }
      : dialect === "q1-quakeworld" ? { kind: "q1-quakeworld" }
      : { kind: "q3", serverTimeMilliseconds: Math.trunc(serverMilliseconds), weapon: 2, sensitivity: 1 };
    return this.locals.map(local => {
      const sample = local.input.sample(this.now(), elapsedMilliseconds);
      const selectedSample = this.seatUi.get(local.player.seat.id)?.sample(sample) ?? sample;
      const selection = this.q3Selections.get(local.player.seat.id);
      const selectedFrame = frame.kind === "q3" && selection !== undefined ? { ...frame, ...selection } : frame;
      const arsenal = this.arsenalSelections.get(local.player.seat.id);
      return { actor: local.player.actor,
        source: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id }, sequence: this.sequence++,
        command: local.builder.build(selectedSample, selectedFrame),
        ...(arsenal === undefined ? {} : { arsenal: { ...arsenal, useHoldable: selectedSample.focus.kind === "game"
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

  input(event: SeatInputEvent): boolean { this.synchronizeClientFocus(); return this.router.seat(event.seat)?.input(event) ?? false; }

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
      if (name === "+scores" || name === "-scores" || name === "+zoom" || name === "-zoom") this.commands.unregister(name);
      if (this.commands.exists(name)) continue;
      this.commands.register(name, invocation => {
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

  synchronizeView(actor: ActorId): void {
    const local = this.locals.find(local => local.player.actor.equals(actor));
    local?.builder.setViewAngles(this.simulation.playerView(actor).angles);
  }

  rebindPlayers(players: readonly LocalPlayer[], simulation: Pick<SimulationPresentationAccess, "playerView">): void {
    if (players.length !== this.locals.length) throw new Error("World travel changed the local seat count");
    for (const local of this.locals) {
      const player = players.find(player => player.seat.id.equals(local.player.seat.id));
      if (player === undefined) throw new Error("World travel has no player for a local seat");
      local.input.release(this.now());
      local.player.actor = player.actor;
      local.builder.setViewAngles(simulation.playerView(player.actor).angles);
    }
    this.simulation = simulation;
    this.q3Selections.clear();
    this.arsenalSelections.clear();
  }

  close(): undefined {
    this.router.close();
    this.controllers.close();
    this.seatUi.clear();
    this.q3Selections.clear();
    this.arsenalSelections.clear();
    for (const unregister of this.unregister) unregister();
    this.consoleRouting?.close();
    return undefined;
  }
}
