import { applyFrontendPreferences, readFrontendPreferences, changedFrontendPreferences, readFrontendInput, applyFrontendInput } from "./frontend-preferences.ts";
import type { FrontendPreferenceOverrides, FrontendPreferenceValues } from "./frontend-preferences.ts";
import { ApplicationQ2Console } from "./q2-console.ts";
import { preloadApplicationMonsterNavigation } from "./simulation/monster-navigation.ts";
import { botAdmissionError, ApplicationBots, openApplicationBotLog } from "./simulation/bots.ts";
import type { ApplicationBotClient } from "./simulation/bots.ts";
import { createApplicationBotNavigation } from "./simulation/navigation.ts";
import { loadMountedBotAssetFiles } from "../../bots/behavior/index.ts";
import type { ActorId, ClientId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExecutableRecipe } from "../../contracts/content.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import type { TransitionDecision } from "../../contracts/gameplay.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SaveImage, SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import type { IpAddress } from "../../network/common/endpoint.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { UdpTransport, Q2_DATAGRAM_LIMITS, Q3_DATAGRAM_LIMITS, UNIFIED_DATAGRAM_LIMITS } from "../../network/common/transport.ts";
import { CommandBuffer, tokenizeCommand } from "../../core/commands/index.ts";
import type { CvarSnapshot } from "../../core/cvars/index.ts";
import { DedicatedConsole } from "../../console/dedicated.ts";
import { KEY_CHAR_FLAG, KeyCode } from "../../input/key-codes.ts";
import { loadQ3Character } from "../../content/q3/foundation/index.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../content/q3/foundation/arsenal.ts";
import { readSaveImage, writeSaveImage } from "../../persistence/save-image.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { SessionSeat } from "../../world/session/index.ts";
import { SharedTransitionCoordinator } from "../../world/gameplay/transitions.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationAudio } from "./audio.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { applicationOptionsForRecipe, loadApplicationContent, resolveApplicationTravel } from "./content.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { ApplicationInput, movementDialect } from "./input.ts";
import type { ApplicationInputCommands, LocalInput, LocalPlayer } from "./input.ts";
import { mapResourcePath } from "./options.ts";
import type { ApplicationOptions } from "./options.ts";
import { seatViewport, WorldSeatPresentation } from "./presentation.ts";
import { ApplicationQ3Client } from "./q3-client.ts";
import { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";
import { createSimulationPredictionHost } from "./simulation/prediction.ts";
import { NativeRenderer } from "./renderer.ts";
import { ApplicationSeatUi } from "./ui.ts";
import { readMenuArt } from "./menu-art.ts";
import { createSimulation, savedSimulationSettings } from "./simulation/index.ts";
import { createQ2ApplicationServerHost } from "./simulation/network.ts";
import { Q2ServerNetwork } from "./network/q2.ts";
import { Q1ServerNetwork } from "./network/q1.ts";
import { Q3ServerNetwork } from "./network/q3.ts";
import type { Q1ApplicationServerHost } from "./network/q1-types.ts";
import type { Q3ApplicationServerHost } from "./network/q3-types.ts";
import { createQ1ApplicationServerHost } from "./simulation/network-q1.ts";
import { createQ3ApplicationServerHost } from "./simulation/network-q3.ts";

import type { ApplicationNetworkPlayer, Q2ApplicationServerHost } from "./network/types.ts";
import type { SharedSimulation } from "./simulation/index.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { SimulationTravel } from "./simulation/types.ts";

type NativeServerHost = { readonly kind: "q1"; readonly host: Q1ApplicationServerHost }
  | { readonly kind: "q2"; readonly host: Q2ApplicationServerHost }
  | { readonly kind: "q3"; readonly host: Q3ApplicationServerHost };
type NativeServer = { readonly address: IpAddress } & (
  { readonly kind: "q1"; readonly server: Q1ServerNetwork<IpAddress> }
  | { readonly kind: "q2"; readonly server: Q2ServerNetwork<IpAddress> }
  | { readonly kind: "q3"; readonly server: Q3ServerNetwork });

interface ApplicationCommandRequest { readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; }
interface Q3SeatClient { readonly client: ApplicationQ3Client; readonly prediction: ReturnType<typeof createSimulationPredictionHost>; }
interface GraphicalApplication {
  readonly renderer: NativeRenderer;
  readonly assets: ApplicationAssets;
  readonly input: ApplicationInput;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly art: NativeUiArt;
  readonly presentations: readonly WorldSeatPresentation[];
  readonly q3: ReadonlyMap<SeatId, Q3SeatClient>;
  readonly rerelease: ApplicationRereleasePresentation;
}

export interface ApplicationHost {
  print(text: string): undefined;
}

/** A single authoritative simulation owns every local and remote player's game state. */
export class Application {
  private graphical: GraphicalApplication | null = null;
  private frontendOverrides: FrontendPreferenceOverrides = {};
  private frontendBaseline: FrontendPreferenceValues | null = null;
  private bots: ApplicationBots | null = null;
  private dedicatedConsole: DedicatedConsole | null = null;
  private dedicatedCommands: CommandBuffer | null = null;
  private requestedCommands: ApplicationCommandRequest[] = [];
  private clientInputs: SeatInputEvent[] = [];
  private stopping = false;
  private closed = false;
  private stepping = false;
  private elapsed = 0;
  private frames = 0;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly reportedEffectGaps = new Set<string>();
  private network: NativeServer | null = null;
  private readonly transitions = new SharedTransitionCoordinator(decision => { this.pendingTransition = decision; return undefined; });
  private pendingTransition: Exclude<TransitionDecision, { readonly kind: "stay" }> | null = null;
  private pendingMap: string | null = null;
  private sourceCommands: CommandBuffer | null = null;
  private q2Console: ApplicationQ2Console | null = null;
  private pendingRestart: number | null = null;
  private pendingSave: SaveImage | null = null;

  private constructor(private launchOptions: ApplicationOptions, private loadedContent: LoadedApplicationContent,
    readonly session: EngineSession, private worldSimulation: SharedSimulation, private readonly host: ApplicationHost, private readonly identity: IdentityOwner,
    private readonly localSeats: Map<ClientId, SessionSeat>) {}

  static async open(options: ApplicationOptions, host: ApplicationHost, recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides): Promise<Application> {
    if (options.network.kind === "q2-client") throw new Error("Remote clients require RemoteApplication without a local simulation");
    const content = await loadApplicationContent(options, recipe);
    if (recipe !== undefined) {
      try { options = applicationOptionsForRecipe(options, content); }
      catch (error) { await content.close(); throw error; }
    }
    const identity = createIdentityOwner(`quake:${options.product}:${options.map}`);
    const session = new EngineSession(identity, options.dedicated ? { kind: "headless" } : { kind: "local" });
    const localSeats = new Map<ClientId, SessionSeat>();
    let application: Application | null = null;
    try {
      const monsterNavigation = await preloadApplicationMonsterNavigation(content);
      const simulation = createSimulation({ ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: options.skill, mode: options.mode, seed: options.seed,
        maxClients: options.mode === "singleplayer" ? content.catalog.product(content.recipe.engineBehavior.content).expectation.family === "q3" ? 8 : 1 : 16,
        playerIdentity: client => ({ seat: localSeats.get(client)?.id.index ?? 0, socialId: "" }) });
      session.attachWorld(simulation);
      if (options.botSkill !== undefined) {
        const source = simulation.q3Source();
        if (source === null) throw new Error("--bot-skill requires the Quake III game provider");
        source.host.cvars.set("g_spSkill", String(options.botSkill), true);
      }
      application = new Application(options, content, session, simulation, host, identity, localSeats);
      application.frontendOverrides = preferences ?? {};
      await application.bindSourceCommands();
      if (options.dedicated) application.openDedicatedConsole();
      else await application.openGraphical();
      application.bots = await application.createBots(content, simulation);
      await application.openNetwork();
      host.print(`Loaded ${content.recipe.map.geometry.requestedPath} with ${content.recipe.movement.provider} and ${content.recipe.character.appearance.provider}.\n`);
      return application;
    } catch (error) {
      if (application !== null) await application.close();
      else { session.close(); await content.close(); }
      throw error;
    }
  }

  private async createBots(content: LoadedApplicationContent, simulation: SharedSimulation,
    clients: readonly ApplicationBotClient[] = [], restart = false, requested = false): Promise<ApplicationBots | null> {
    if (simulation.q3Source() === null && clients.length === 0 && !requested) return null;
    const unsupported = botAdmissionError(simulation);
    if (unsupported !== null) {
      if (clients.length !== 0 || requested) throw new Error(unsupported);
      return null;
    }
    const definitions = simulation.q3Source() === null ? content.catalog.product("q3-baseq3").id : content.recipe.map.entities.content;
    const files = await loadMountedBotAssetFiles(await content.forContent(definitions), content.catalog);
    const navigation = await createApplicationBotNavigation({ content, simulation });
    const configuration = simulation.q1Source()?.cvars ?? this.q2Console?.cvars;
    return new ApplicationBots({ session: this.session, simulation, files, navigation, clients, restart, automaticFrame: true,
      ...(configuration === undefined ? {} : { configuration }),
      leafCount: content.world.leaves.length, print: text => { this.host.print(text); },
      insertConsoleCommand: text => {
        if (this.sourceCommands === null) throw new Error("Bot console has no source command buffer");
        this.sourceCommands.insert(text);
      }, openLog: openApplicationBotLog });
  }

  get frontendSettings(): FrontendPreferenceOverrides {
    const current = this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio);
    return current === null || this.frontendBaseline === null ? this.frontendOverrides : changedFrontendPreferences(this.frontendBaseline, current, this.frontendOverrides);
  }
  get frontendValues(): FrontendPreferenceValues | null { return this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio); }
  get botClients(): readonly ApplicationBotClient[] { return this.bots?.clients() ?? []; }
  get frameCount(): number { return this.frames; }
  get options(): ApplicationOptions { return this.launchOptions; }
  get content(): LoadedApplicationContent { return this.loadedContent; }
  get simulation(): SharedSimulation { return this.worldSimulation; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] | null { return this.graphical?.renderer.window ?? null; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get unhandledPresentationEffects(): readonly UnhandledApplicationEffect[] { return this.unhandledEffects; }
  get networkAddress(): IpAddress | null { return this.network?.address ?? null; }
  get networkClients(): readonly ApplicationNetworkPlayer[] { return this.network?.server.clients ?? []; }
  get localPlayers(): readonly LocalPlayer[] { return this.graphical?.input.locals.map(local => local.player) ?? []; }

  input(event: SeatInputEvent): boolean {
    if (this.closed) throw new Error("Application is closed");
    return this.graphical?.input.input(event) ?? false;
  }

  private openDedicatedConsole(): void {
    if (this.sourceCommands !== null) {
      if (this.dedicatedCommands !== this.sourceCommands) {
        for (const name of ["save", "load"]) this.sourceCommands.register(name, invocation => this.queueCommand(name, invocation.args, null));
      }
      this.dedicatedCommands = this.sourceCommands;
      this.dedicatedConsole = new DedicatedConsole();
      return;
    }
    const commands = new CommandBuffer({ dialect: this.sourceDialect(),
      context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => { this.host.print(text); } });
    commands.register("quit", () => this.requestQuit());
    for (const name of ["save", "load", "map", "say", "addbot", "removebot", "botlist"]) commands.register(name, invocation => this.queueCommand(name, invocation.args, null));
    this.dedicatedCommands = commands;
    this.dedicatedConsole = new DedicatedConsole();
  }

  private sourceDialect(): CommandDialect {
    const source = this.content.catalog.product(this.content.recipe.engineBehavior.content).expectation;
    return source.family === "q1" ? "q1-netquake" : source.family === "q2" ? source.edition === "rerelease" ? "q2-rerelease" : "q2-classic" : "q3";
  }

  private inputActions(): ApplicationInputCommands {
    return { quit: () => this.requestQuit(), execute: (name, arguments_, seat) => this.queueCommand(name, arguments_, seat), print: text => this.host.print(text),
      console: { dialect: () => this.sourceDialect(), server: () => {
        const source = this.simulation.q3Source();
        return source === null ? this.q2Console === null ? null : { cvars: this.q2Console.cvars, sharedNames: this.q2Console.sharedNames } : { cvars: source.host.cvars, sharedNames: source.settings.definitions.map(definition => definition.name) };
      }, seat: id => this.graphical?.q3.get(id)?.client.cvars ?? null },
      clientCapturesInput: seat => this.graphical?.q3.get(seat)?.client.capturesInput ?? false,
      clientInput: event => {
        const source = this.graphical?.q3.get(event.seat);
        if (source === undefined || !source.client.capturesInput) return false;
        this.clientInputs.push(event); return true;
      } };
  }

  private async dispatchClientInputs(): Promise<void> {
    const events = this.clientInputs; this.clientInputs = [];
    for (const event of events) {
      const client = this.graphical?.q3.get(event.seat)?.client; if (client === undefined) continue;
      switch (event.kind) {
        case "key": await client.keyEvent(event.code, event.down); break;
        case "text": for (const character of event.text) { const code = character.codePointAt(0); if (code !== undefined) await client.keyEvent(code | KEY_CHAR_FLAG, true); } break;
        case "mouse-button": await client.keyEvent(KeyCode.Mouse1 + event.button - 1, event.down); break;
        case "mouse-motion": await client.mouseEvent(event.delta.x, event.delta.y); break;
        case "mouse-wheel": for (let count = 0; count < Math.abs(event.delta.y); count++) {
          const key = event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown;
          await client.keyEvent(key, true); await client.keyEvent(key, false);
        } break;
        case "controller-button": if (event.button >= 0 && event.button < 32) await client.keyEvent(KeyCode.Joy1 + event.button, event.down); break;
        case "controller-axis": case "focus": break;
      }
    }
  }

  private async bindSourceCommands(): Promise<void> {
    if (this.simulation.q2Source() !== null) {
      if (this.q2Console === null) {
        this.q2Console = new ApplicationQ2Console({ simulation: () => this.simulation, content: () => this.content,
          print: text => { this.host.print(text); return undefined; }, execute: (name, args) => this.queueCommand(name, args, null) });
        for (const name of ["addbot", "removebot", "botlist", "kick"]) this.q2Console.commands.register(name, invocation => this.queueCommand(name, invocation.args, null));
        await this.q2Console.initialize();
      } else await this.q2Console.bindCurrent();
      this.sourceCommands = this.q2Console.commands;
      return;
    }
    const q1 = this.simulation.q1Source();
    if (q1 !== null) {
      const commands = new CommandBuffer({ dialect: "q1-netquake", cvars: q1.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => { this.host.print(text); } });
      commands.register("quit", () => this.requestQuit());
      for (const name of ["map", "say", "addbot", "removebot", "botlist", "kick"]) commands.register(name, invocation => this.queueCommand(name, invocation.args, null));
      q1.cvars.register("bot_minplayers", "0"); this.sourceCommands = commands; return;
    }
    const source = this.simulation.q3Source();
    if (source === null) { this.sourceCommands = null; return; }
    source.host.cvars.set("dedicated", this.options.dedicated ? "1" : "0", true);
    if (this.sourceCommands !== null) return;
    const game = () => {
      const current = this.simulation.q3Source();
      if (current === null) throw new Error("Source console no longer owns a Quake III game");
      return current;
    };
    const commands = new CommandBuffer({ dialect: "q3", context: { session: this.session.session, origin: { kind: "server-console" } },
      get cvars() { return game().host.cvars; }, print: text => { this.host.print(text); },
      clientGame: command => {
        const name = command.argv[0]; if (name === undefined) return false;
        const local = this.graphical?.presentations.find(presentation => presentation.q3Client?.handlesCommand(name));
        if (local === undefined) return false;
        this.queueCommand(name, command.args, local.local.player.seat.id); return true;
      }, serverGame: command => game().serverCommands.consoleCommand(command.argv),
      forwardToServer: command => { this.host.print(`Unbound source engine command: ${command.raw}\n`); return undefined; } });
    commands.register("map", invocation => {
      const map = invocation.args[0]; if (map === undefined) throw new Error("Usage: map <name>");
      this.pendingMap = mapResourcePath(map); return undefined;
    });
    commands.register("map_restart", invocation => this.requestRestart(invocation.args));
    commands.register("kick", invocation => this.kickClients(invocation.args));
    commands.register("removebot", invocation => this.queueCommand("removebot", invocation.args, null));
    commands.register("centerview", () => {
      for (const local of this.graphical?.input.locals ?? []) local.builder.setViewAngles({ ...local.builder.viewAngles, x: 0 });
      return undefined;
    });
    commands.register("quit", () => this.requestQuit());
    this.sourceCommands = commands;
  }

  private kickClients(args: readonly string[]): undefined {
    const source = this.simulation.q3Source(), target = args[0];
    if (target === undefined) throw new Error("Usage: kick <player name|slot|all|allbots>");
    const selected = this.simulation.players().filter(actor => {
      const player = this.simulation.movementPlayer(actor);
      if (player === null || this.localSeats.has(player.client)) return false;
      if (target.toLowerCase() === "all") return true;
      if (target.toLowerCase() === "allbots") return this.bots !== null && this.bots.actor(player.client) !== null;
      const name = source?.pool.clientAt(player.client.slot).pers.netname ?? this.simulation.q2Source()?.players.states.get(actor)?.name ?? "";
      return String(player.client.slot) === target || name.replace(/\^[0-9]/g, "").toLowerCase() === target.toLowerCase();
    });
    if (selected.length === 0) throw new Error(`Player ${target} is not on the server`);
    for (const actor of selected) {
      const player = this.simulation.movementPlayer(actor);
      if (player === null) continue;
      if (source !== null) source.host.engine.dropClient(player.client.slot, "was kicked");
      else if (!this.bots?.disconnect(player.client.slot) && !this.network?.server.disconnectClient(player.client, "was kicked")) {
        this.simulation.disconnectPlayer(actor); this.session.closeClient(player.client);
      }
    }
    return undefined;
  }

  private requestRestart(args: readonly string[]): undefined {
    if (this.simulation.q3Source() === null) throw new Error("map_restart requires the Quake III game provider");
    const delay = args[0] === undefined ? 5 : Number(args[0]);
    if (!Number.isFinite(delay) || delay < 0) throw new Error("map_restart requires a nonnegative delay in seconds");
    this.pendingRestart = this.elapsed + delay * 1000; return undefined;
  }

  private async sourceActions(): Promise<void> {
    for (const source of this.sourceEvents) {
      if (source.kind === "q1-composition") {
        const event = source.event.kind === "addon" ? source.event.event : source.event;
        if (event.kind === "developer-message") {
          this.host.print(event.text);
          for (const local of this.graphical?.input.locals ?? []) local.console.print(event.text);
        }
        continue;
      }
      if (source.kind === "q2-composition" && source.event.kind === "kick") {
        const player = this.simulation.movementPlayer(source.event.actor);
        if (player !== null) {
          if (this.network?.server.disconnectClient(player.client, "was kicked")) continue;
          const local = this.localSeats.has(player.client);
          this.simulation.disconnectPlayer(source.event.actor);
          this.session.closeClient(player.client); this.localSeats.delete(player.client);
          if (local) this.requestQuit();
        }
        continue;
      }
      if (source.kind === "q2-rerelease") {
        if (source.event.kind === "restart-level") this.pendingMap = mapResourcePath(source.event.map);
        else if (source.event.kind === "autosave") {
          const directory = join(homedir(), ".local", "share", "quake-typescript", "saves", this.content.catalog.product(source.content).expectation.id);
          try {
            await mkdir(directory, { recursive: true });
            const path = join(directory, "autosave.sav"); await this.saveGame(path);
            this.host.print(`Autosaved ${path}.\n`);
          } catch (error) { this.host.print(`Autosave failed: ${error instanceof Error ? error.message : String(error)}\n`); }
        }
        continue;
      }
      if (source.kind !== "q3-source") continue;
      const event = source.event;
      if (event.kind === "print") this.host.print(event.text);
      else if (event.kind === "console-command") {
        if (this.sourceCommands === null) throw new Error("Q3 source console has no command owner");
        if (event.execution === "now") this.sourceCommands.executeNow(event.text);
        else this.sourceCommands.append(event.text);
      } else if (event.kind === "drop-client") {
        if (this.bots?.disconnect(event.client)) { this.host.print(`Client ${event.client}: ${event.reason}\n`); continue; }
        const actor = this.simulation.players().find(actor => this.simulation.movementPlayer(actor)?.client.slot === event.client);
        if (actor === undefined) continue;
        const player = this.simulation.movementPlayer(actor);
        if (player === null) throw new Error("Source disconnect lost its client identity");
        if (this.network?.server.disconnectClient(player.client, event.reason)) continue;
        const local = this.localPlayers.some(local => local.actor.equals(actor));
        this.simulation.disconnectPlayer(actor);
        this.session.closeClient(player.client);
        this.localSeats.delete(player.client);
        this.host.print(`Client ${event.client}: ${event.reason}\n`);
        if (local) this.requestQuit();
      }
    }
    this.sourceCommands?.execute();
  }

  private async networkHost(simulation = this.simulation, content = this.content): Promise<NativeServerHost> {
    const source = content.catalog.product(content.recipe.map.entities.content).expectation;
    if (this.options.network.kind === "q2-server" && source.family !== "q2") throw new Error("--listen-q2 requires a Quake II source game; use --listen for the selected native protocol");
    const common = { session: this.session, simulation, content, print: (text: string): void => { this.host.print(text); } };
    switch (source.family) {
      case "q1": return { kind: "q1", host: await createQ1ApplicationServerHost({ ...common, protocol: { kind: "q1-netquake", version: 15 } }) };
      case "q2": return { kind: "q2", host: await createQ2ApplicationServerHost({ ...common,
        protocol: source.edition === "rerelease" ? { kind: "q2-rerelease", version: 1038 } : { kind: "q2-classic", version: 34 } }) };
      case "q3": return { kind: "q3", host: await createQ3ApplicationServerHost(common) };
    }
  }

  private validateNetworkHost(next: NativeServerHost): void {
    if (this.network !== null && this.network.kind !== next.kind) throw new Error("A native server cannot change wire families while carrying connected clients");
    const supported = next.host.supportsSourceWire();
    if (supported.kind === "unsupported") throw new Error(`Native ${next.kind.toUpperCase()} wire is unavailable: ${supported.reasons.join("; ")}`);
  }

  private changeNetworkWorld(next: NativeServerHost): void {
    const network = this.network;
    if (network === null) throw new Error("Native world replacement requires an open server");
    switch (next.kind) {
      case "q1": if (network.kind !== "q1") throw new Error("Native Q1 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
      case "q2": if (network.kind !== "q2") throw new Error("Native Q2 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
      case "q3": if (network.kind !== "q3") throw new Error("Native Q3 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
    }
  }

  private async openNetwork(): Promise<void> {
    const selection = this.options.network;
    if (selection.kind !== "q2-server" && selection.kind !== "native-server") return;
    const selected = await this.networkHost();
    this.validateNetworkHost(selected);
    const limits = selected.kind === "q1" ? UNIFIED_DATAGRAM_LIMITS : selected.kind === "q2" ? Q2_DATAGRAM_LIMITS : Q3_DATAGRAM_LIMITS;
    const transport = await UdpTransport.bind({ host: selection.host, port: selection.port, limits });
    const random = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    try {
      switch (selected.kind) {
        case "q1": this.network = { kind: "q1", address: transport.address, server: new Q1ServerNetwork({ transport, host: selected.host }) }; break;
        case "q2": this.network = { kind: "q2", address: transport.address, server: new Q2ServerNetwork({ transport, host: selected.host, random }) }; break;
        case "q3": this.network = { kind: "q3", address: transport.address, server: new Q3ServerNetwork({ transport, host: selected.host, random }) }; break;
      }
      this.host.print(`Listening for ${selected.kind.toUpperCase()} peers on ${addressKey(transport.address)}.\n`);
    } catch (error) { transport.close(); throw error; }
  }


  private async openGraphical(): Promise<void> {
    const owner = { identity: Symbol("application renderer"), session: this.session.session, generation: 0 };
    const assets = new ApplicationAssets(this.content, owner);
    let renderer: NativeRenderer | null = null, input: ApplicationInput | null = null, audio: ApplicationAudio | null = null;
    let art: NativeUiArt | null = null;
    let effects: ApplicationEffects | null = null;
    try {
      await assets.loadWorld();
      const font = await assets.loadConsoleFont(), typography = await assets.loadMenuTypography();
      const characters = this.options.character === "q3" ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
        { model: this.options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
      renderer = NativeRenderer.open(this.options, owner);
      const players: LocalPlayer[] = [];
      for (let index = 0; index < this.options.seats; index++) {
        const client = this.session.createClient(index);
        client.connect("loopback");
        const seat = this.session.createSeat(index, client);
        this.localSeats.set(client.id, seat);
        const player = this.simulation.admitPlayer(client.id);
        players.push({ seat, actor: player.actor });
      }
      input = new ApplicationInput(renderer.window, players, this.options, this.simulation,
        this.inputActions(), () => performance.now());
      audio = new ApplicationAudio(this.content, () => this.elapsed, this.options.seed, this.options.characterModel, text => this.host.print(text));
      applyFrontendPreferences(this.frontendOverrides, input, audio);
      this.frontendBaseline = readFrontendPreferences(input, audio);
      const fontSource = font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, assets.images, readMenuArt);
      const effectSimulation = this.simulation;
      effects = new ApplicationEffects(assets, effectSimulation.scene, actor => effectSimulation.players().some(player => player.equals(actor)), this.options.seed);
      const native = renderer;
      const inputOwner = input, audioOwner = audio, menuArt = art, worldEffects = effects;
      const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor })));
      const presentations: WorldSeatPresentation[] = [], q3 = new Map<SeatId, Q3SeatClient>();
      for (const local of input.locals) {
        const sourceClient = await this.createQ3SeatClient(local, assets, audioOwner, inputOwner, native, this.simulation);
        if (sourceClient !== null) q3.set(local.player.seat.id, sourceClient);
        const ui = new ApplicationSeatUi(local, menuArt, inputOwner, this.simulation, font, audioOwner, () => this.requestQuit(),
          (name, args) => this.queueCommand(name, args, local.player.seat.id), typography);
        const presentation = new WorldSeatPresentation(local, assets, native, this.simulation, this.options.seats, font, characters, ui, worldEffects, sourceClient?.client ?? null, rerelease);
        local.player.seat.attachPresentation(presentation, () => presentation.close());
        presentations.push(presentation);
      }
      this.graphical = { renderer, assets, input, audio, effects, art, presentations, q3, rerelease };
      if (q3.size === 0) await audio.startWorldMusic();
    } catch (error) {
      this.session.close(); audio?.close(); effects?.close(); input?.close(); renderer?.close(); art?.close(); assets.close();
      this.graphical = null;
      throw error;
    }
  }

  private async createQ3SeatClient(local: LocalInput, assets: ApplicationAssets, audio: ApplicationAudio, input: ApplicationInput,
    renderer: NativeRenderer, simulation: SharedSimulation, settings?: readonly CvarSnapshot[]): Promise<Q3SeatClient | null> {
    const source = simulation.q3Source(); if (source === null) return null;
    const prediction = createSimulationPredictionHost(simulation, local.player.actor, local.player.seat.id);
    const initial = source.sourceState(); prediction.captureSource(initial);
    const client = await ApplicationQ3Client.create({ weaponHud: () => { const ui = simulation.playerUi(local.player.actor); return { status: ui.weaponStatus, warning: ui.arsenalWarning }; }, assets, queries: simulation.scene, initial, local, audio, movement: prediction,
      splitScreen: this.options.seats > 1,
      ...(settings === undefined ? {} : { settings }), predictionCommand: (command, time) => prediction.submit(command, time),
      linkBounds: number => source.world.linkState(number)?.absbounds ?? null,
      sourceActor: number => { const record = source.records.get(number); return record?.inuse ? record.actor.id : null; },
      serverSettings: () => source.host.cvars.snapshots().filter(variable => source.settings.definitions.some(definition => definition.name === variable.name)),
      viewport: () => { const size = renderer.window.drawableSize; return seatViewport(local.player.seat.id.index, this.options.seats, size.width, size.height); },
      now: () => performance.now(), commands: {
        reliable: text => { const [name, ...args] = tokenizeCommand(text, "q3").argv; if (name !== undefined) this.queueCommand(name, args, local.player.seat.id); },
        console: text => input.commands.append(text, { session: this.session.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } }),
        print: text => { this.host.print(text); local.console.print(text); },
      } });
    input.registerClientCommands([...client.commandNames]);
    return { client, prediction };
  }

  requestQuit(): undefined { this.stopping = true; return undefined; }

  queueCommand(name: string, arguments_: readonly string[], seat: SeatId | null): undefined {
    this.requestedCommands.push({ name, arguments_: [...arguments_], seat });
    return undefined;
  }

  private async replaceWorld(map: string, carry: SimulationTravel | null, initialSourceMilliseconds = 0, save?: SaveImage): Promise<void> {
    const settings = save === undefined ? null : savedSimulationSettings(save);
    let options = { ...this.options, map: mapResourcePath(map) };
    const recipe = save?.recipe ?? await resolveApplicationTravel(this.content, options.map);
    const content = await loadApplicationContent(options, recipe);
    const previousContent = this.content, previous = this.graphical;
    const q3 = this.simulation.q3Source();
    const previousBotClients = this.bots?.clients() ?? [];
    const preserveBots = initialSourceMilliseconds !== 0 || q3?.gameType !== 2;
    const botClients = preserveBots ? previousBotClients : [];
    const previousBots = this.bots;
    const q1BotCvars = this.simulation.q1Source()?.cvars.snapshots().filter(variable => variable.name.startsWith("bot_") || variable.name === "g_spSkill");
    const q3Session = q3?.captureSession();
    const q3Cvars = q3?.host.cvars.snapshots().filter(variable => variable.name !== "sv_mapname")
      .map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value }));
    let simulation: SharedSimulation | null = null, assets: ApplicationAssets | null = null, art: NativeUiArt | null = null;
    let nextBots: ApplicationBots | null = null;
    let nextAudio: ApplicationAudio | null = null;
    let nextEffects: ApplicationEffects | null = null;
    let nextInput: ApplicationInput | null = null;
    let committed = false;
    try {
      if (settings !== null) {
        options = { ...applicationOptionsForRecipe(options, content), skill: settings.skill, mode: settings.mode, seed: settings.seed };
        initialSourceMilliseconds = settings.hostMilliseconds;
      }
      const clients = this.simulation.players().map(actor => {
        const player = this.simulation.movementPlayer(actor);
        if (player === null) throw new Error("Connected player has no source client identity");
        return player.client;
      }).filter(client => preserveBots || !previousBotClients.some(bot => bot.client.id.equals(client)));
      if (settings !== null && (settings.clientSlots.length !== clients.length || settings.clientSlots.some(slot => !clients.some(client => client.slot === slot))))
        throw new Error("Saved players do not match the connected session client slots");
      const monsterNavigation = await preloadApplicationMonsterNavigation(content);
      simulation = createSimulation({ ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity: this.identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: options.skill, mode: options.mode, seed: options.seed, maxClients: settings?.maxClients ?? this.simulation.options.maxClients,
        playerIdentity: client => ({ seat: this.localSeats.get(client)?.id.index ?? 0, socialId: "" }),
        ...(save === undefined ? { ...(carry === null ? {} : { travel: carry }), ...(q3Session === undefined ? {} : { q3Session, initialSourceMilliseconds }),
          ...(q3Cvars === undefined ? {} : { q3Cvars }) } : { restore: save, restoredClients: clients }) });
      const nextSimulation = simulation;
      const nextQ1 = nextSimulation.q1Source();
      if (save === undefined && nextQ1 !== null) for (const variable of q1BotCvars ?? []) {
        nextQ1.cvars.register(variable.name, variable.resetValue); nextQ1.cvars.set(variable.name, variable.value, true);
      }
      const admissions = new Map(clients.filter(client => !botClients.some(bot => bot.client.id.equals(client))).map(client => {
        if (save === undefined) return [client.slot, nextSimulation.admitPlayer(client).actor];
        const actor = nextSimulation.players().find(actor => nextSimulation.movementPlayer(actor)?.client.equals(client));
        if (actor === undefined) throw new Error(`Restore did not bind client ${client.slot}`);
        return [client.slot, actor];
      }));
      nextBots = await this.createBots(content, simulation, botClients, initialSourceMilliseconds !== 0);
      const nextNetworkHost = this.network === null ? null : await this.networkHost(simulation, content);
      if (nextNetworkHost !== null) this.validateNetworkHost(nextNetworkHost);
      if (previous === null) {
        if (!preserveBots) for (const bot of previousBotClients) previousBots?.disconnect(bot.client.id.slot);
        previousBots?.close(initialSourceMilliseconds !== 0);
        this.bots = nextBots;
        this.session.attachWorld(simulation);
        this.worldSimulation = simulation;
        this.loadedContent = content;
        this.launchOptions = options;
        committed = true;
      } else {
        assets = new ApplicationAssets(content, previous.renderer.owner);
        await assets.loadWorld();
        const font = await assets.loadConsoleFont(), typography = await assets.loadMenuTypography(), fontSource = font.classic.picture.image.source;
        if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
        art = await loadNativeUiArt(fontSource.resource.id, assets.images, readMenuArt);
        const characters = options.character === "q3" ? await loadQ3Character(await content.forContent(content.recipe.character.appearance.content),
          { model: options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
        const players = previous.input.locals.map(local => {
          const player = admissions.get(local.player.seat.client.id.slot);
          if (player === undefined) throw new Error("Travel admission is missing a connected local player");
          return { seat: local.player.seat, actor: player };
        });
        const frontendOverrides = this.frontendSettings;
        const seatInputPreferences = new Map(previous.input.locals.map(local => [local.player.seat.id, readFrontendInput(local)]));
        const preferences = previous.presentations.map(presentation => presentation.ui.preferences.values);
        const cgameSettings = new Map([...previous.q3].map(([seat, source]) => [seat, source.client.cvars.snapshots()]));
        if (!preserveBots) for (const bot of previousBotClients) previousBots?.disconnect(bot.client.id.slot);
        previousBots?.close(initialSourceMilliseconds !== 0);
        this.bots = nextBots;
        this.session.attachWorld(simulation);
        this.worldSimulation = simulation;
        this.loadedContent = content;
        this.launchOptions = options;
        committed = true;
        previous.audio.close(); previous.effects.close(); previous.art.close(); previous.assets.close();
        previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.frames,
          commands: previous.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
        let input = previous.input;
        if (movementDialect(previous.input.options) !== movementDialect(options) || previous.input.commands.dialect !== this.sourceDialect()) {
          previous.input.close();
          input = new ApplicationInput(previous.renderer.window, players, options, simulation,
            this.inputActions(), () => performance.now());
          nextInput = input;
        } else input.rebindPlayers(players, simulation);
        input.resumeCommands(Math.max(previous.input.nextCommandSequence,
          ...players.map(player => (nextSimulation.movementPlayer(player.actor)?.lastSequence ?? -1) + 1)));
        const audio = new ApplicationAudio(content, () => this.elapsed, options.seed, options.characterModel, text => this.host.print(text));
        nextAudio = audio;
        const effects = new ApplicationEffects(assets, nextSimulation.scene, actor => nextSimulation.players().some(player => player.equals(actor)), options.seed);
        nextEffects = effects;
        audio.effectsVolume = previous.audio.effectsVolume;
        audio.musicVolume = previous.audio.musicVolume;
        if (input !== previous.input) {
          applyFrontendPreferences(frontendOverrides, input, audio);
          for (const local of input.locals) {
            const previousSettings = seatInputPreferences.get(local.player.seat.id);
            if (previousSettings !== undefined) applyFrontendInput(previousSettings, local);
          }
        }
        this.frontendOverrides = frontendOverrides;
        this.frontendBaseline = readFrontendPreferences(input, audio);
        const current = simulation, worldAssets = assets, menuArt = art;
        const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor })));
        const presentations: WorldSeatPresentation[] = [], q3Clients = new Map<SeatId, Q3SeatClient>();
        for (const [index, local] of input.locals.entries()) {
          const sourceClient = await this.createQ3SeatClient(local, worldAssets, audio, input, previous.renderer, current, cgameSettings.get(local.player.seat.id));
          if (sourceClient !== null) q3Clients.set(local.player.seat.id, sourceClient);
          const ui = new ApplicationSeatUi(local, menuArt, input, current, font, audio, () => this.requestQuit(),
            (name, args) => this.queueCommand(name, args, local.player.seat.id), typography);
          const preference = preferences[index]; if (preference !== undefined) ui.preferences.values = preference;
          const presentation = new WorldSeatPresentation(local, worldAssets, previous.renderer, current, options.seats, font, characters, ui, effects, sourceClient?.client ?? null, rerelease);
          local.player.seat.attachPresentation(presentation, () => presentation.close());
          presentations.push(presentation);
        }
        this.graphical = { renderer: previous.renderer, input, audio, effects, art, assets, presentations, q3: q3Clients, rerelease };
        if (q3Clients.size === 0) await audio.startWorldMusic();
      }
      if (nextNetworkHost !== null) this.changeNetworkWorld(nextNetworkHost);
      this.elapsed = initialSourceMilliseconds;
      await this.bindSourceCommands();
      if (options.dedicated) { this.dedicatedConsole?.close(); this.openDedicatedConsole(); }
      this.sourceEvents = [];
      this.clientInputs = [];
      this.unhandledEffects = [];
      this.reportedEffectGaps.clear();
      await previousContent.close();
      this.host.print(`Entered ${content.recipe.map.geometry.requestedPath}.\n`);
    } catch (error) {
      if (!committed) { nextBots?.close(); simulation?.close(); art?.close(); assets?.close(); await content.close(); }
      else {
        if (nextAudio !== null && this.graphical?.audio !== nextAudio) nextAudio.close();
        if (nextEffects !== null && this.graphical?.effects !== nextEffects) nextEffects.close();
        if (nextInput !== null && this.graphical?.input !== nextInput) nextInput.close();
        if (assets !== null && this.graphical?.assets !== assets) { art?.close(); assets.close(); }
        await previousContent.close();
      }
      throw error;
    }
  }

  async changeLevel(map: string, spawnPoint = ""): Promise<void> {
    if (this.closed || this.stepping) throw new Error("World travel requires an idle open application");
    await this.replaceWorld(map, this.simulation.q3Source() === null ? this.simulation.captureTravel(spawnPoint) : null);
  }

  async saveGame(path: string): Promise<void> {
    if (this.closed) throw new Error("Application is closed");
    if (this.botClients.length !== 0 && this.simulation.q3Source() === null) throw new Error("Saving bot decision state is not yet supported");
    await writeSaveImage(path, this.simulation.checkpoint());
  }

  async loadGame(path: string): Promise<void> {
    if (this.closed || this.stepping) throw new Error("Save restoration requires an idle open application");
    const image = await readSaveImage(path);
    await this.replaceWorld(image.recipe.map.geometry.requestedPath, null, 0, image);
    this.pendingMap = null; this.pendingRestart = null; this.pendingTransition = null; this.pendingSave = null;
  }

  private async applyTransition(): Promise<void> {
    if (this.pendingSave !== null) {
      const image = this.pendingSave, previous = this.content;
      this.pendingSave = null;
      try {
        await this.replaceWorld(image.recipe.map.geometry.requestedPath, null, 0, image);
        this.pendingMap = null; this.pendingRestart = null; this.pendingTransition = null;
      } catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    const matchMap = this.simulation.pendingMatchMap();
    if (matchMap !== null) { await this.replaceWorld(mapResourcePath(matchMap), this.simulation.captureTravel()); return; }
    if (this.pendingMap !== null) {
      const map = this.pendingMap, previous = this.content;
      this.pendingMap = null;
      this.pendingTransition = null;
      this.pendingRestart = null;
      try { await this.replaceWorld(map, null); }
      catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    if (this.pendingRestart !== null && this.elapsed >= this.pendingRestart) {
      this.pendingRestart = null;
      if (this.simulation.q3Source() === null) throw new Error("Quake III restart has no source game");
      await this.replaceWorld(this.options.map, null, this.elapsed);
      return;
    }
    const decision = this.pendingTransition;
    this.pendingTransition = null;
    if (decision === null) return;
    if (decision.kind === "travel") {
      const colon = decision.map.indexOf(":"), family = decision.map.slice(0, colon);
      if (family !== this.content.catalog.product(this.options.product).expectation.family) throw new Error("Campaign travel selected another content provider without a resolved launch recipe");
      const map = decision.map.slice(colon + 1).replace(/^\*/, "");
      await this.replaceWorld(map, this.simulation.captureTravel(decision.spawnPoint));
    } else if (decision.kind === "campaign-complete") this.host.print("Campaign complete.\n");
    else throw new Error("Round restart requires the selected match provider");
  }

  private underwater(camera: SceneCamera, actor: ActorId): boolean {
    const timing = this.content.recipe.timing.find(timing => timing.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("World has no numeric profile for camera contents");
    const contents = this.simulation.scene.pointContents({ point: camera.origin, target: { kind: "world" }, passActor: actor, numeric: timing.numeric,
      policy: this.content.world.kind === "q1-bsp" ? { kind: "q1", move: "normal", hull: null }
        : this.content.world.kind === "q2-bsp" ? { kind: "q2", contentsMask: -1, leafContents: "merged" }
        : { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
    return contents.kind === "q1" ? contents.contents <= -3 && contents.contents >= -5 : ((contents.kind === "q2" ? contents.merged : contents.contents) & 56) !== 0;
  }

  private commandActor(seat: SeatId | null): ActorId {
    const player = this.localPlayers.find(player => seat === null || player.seat.id.equals(seat));
    if (player === undefined) throw new Error("Command requires a player");
    return player.actor;
  }

  private async commands(): Promise<void> {
    const pending = this.requestedCommands;
    this.requestedCommands = [];
    for (const command of pending) {
      try {
        const sourceClient = command.seat === null ? this.graphical?.q3.values().next().value : this.graphical?.q3.get(command.seat);
        if (command.name === "use") {
          const actor = this.commandActor(command.seat), requested = command.arguments_.join("").toLowerCase().replaceAll(" ", "");
          const item = this.simulation.playerUi(actor).items.find(item => item.kind === "weapon" && item.owned
            && (item.id === requested || item.label.toLowerCase().replaceAll(" ", "") === requested));
          const weapon = Q3_WEAPON_ITEMS.find(weapon => weapon.item === item?.id), player = this.simulation.movementPlayer(actor);
          if (weapon !== undefined && player?.arsenal.state.kind === "q3") {
            if (sourceClient !== undefined) { await sourceClient.client.command(["weapon", String(weapon.weapon)]); continue; }
            const local = this.graphical?.input.locals.find(local => local.player.actor.equals(actor));
            if (local !== undefined) {
              this.graphical?.input.setArsenalSelection(local.player.seat.id, { provider: player.arsenal.provider, weapon: weapon.item });
              this.simulation.requestWeapon(actor, { provider: player.arsenal.provider, item: weapon.item });
              continue;
            }
          }
        }
        if (sourceClient !== undefined && await sourceClient.client.command([command.name, ...command.arguments_])) continue;
        if (command.name === "addbot" || command.name === "botlist") {
          if (this.bots === null) this.bots = await this.createBots(this.content, this.simulation, [], false, true);
          if (this.bots === null) throw new Error("Bot observations are unavailable for this world");
          this.bots.consoleCommand([command.name, ...command.arguments_]);
        } else if (command.name === "kick") { this.kickClients(command.arguments_);
        } else if (command.name === "removebot") {
          const argument = command.arguments_[0];
          const bot = this.botClients.find(bot => argument === undefined || String(bot.client.id.slot) === argument);
          if (bot !== undefined) this.bots?.disconnect(bot.client.id.slot);
        } else if (command.name === "save") {
          const path = command.arguments_[0];
          if (path === undefined || path.length === 0) throw new Error("Usage: save <path>");
          await this.saveGame(path);
          this.host.print(`Saved ${path}.\n`);
        } else if (command.name === "weapnext" || command.name === "weapprev" || command.name === "use") {
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        } else if (command.name === "say" || command.name === "say_team") {
          if (this.simulation.q2Source() === null && this.simulation.q3Source() === null) throw new Error("Selected Quake source chat commands are not yet joined");
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else if (command.name === "map_restart") this.requestRestart(command.arguments_);
        else if (command.name === "load") {
          const path = command.arguments_[0]; if (path === undefined || path.length === 0) throw new Error("Usage: load <path>");
          this.pendingSave = await readSaveImage(path);
        }
        else if (command.name === "map") {
          const map = command.arguments_[0];
          if (map === undefined) throw new Error("Usage: map <name>");
          this.pendingMap = mapResourcePath(map);
        }
        else if (this.simulation.q2Source() !== null || this.simulation.q3Source() !== null) {
          const handled = this.simulation.q3Source()?.serverCommands.consoleCommand([command.name, ...command.arguments_]) ?? false;
          if (!handled) this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else throw new Error(`Unknown application command: ${command.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
    }
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput> {
    if (this.closed) throw new Error("Application is closed");
    if (this.stepping) throw new Error("Application step is already in progress");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) throw new RangeError("Application step requires positive elapsed milliseconds");
    this.stepping = true;
    try {
      await this.applyTransition();
      this.graphical?.input.pump();
      await this.dispatchClientInputs();
      if (this.dedicatedCommands !== null) {
        this.dedicatedConsole?.drain(this.dedicatedCommands);
        this.dedicatedCommands.execute();
      }
      const botConfiguration = this.simulation.q1Source()?.cvars ?? this.q2Console?.cvars;
      if (this.bots === null && this.simulation.q3Source() === null && (botConfiguration?.variableValue("bot_minplayers") ?? 0) > 0) {
        const unsupported = botAdmissionError(this.simulation);
        if (unsupported === null) this.bots = await this.createBots(this.content, this.simulation, [], false, true);
        else { this.host.print(`${unsupported}\n`); botConfiguration?.set("bot_minplayers", "0", true); }
      }
      this.elapsed += elapsedMilliseconds;
      const remote = await this.network?.server.poll(performance.now()) ?? [];
      for (const [seat, source] of this.graphical?.q3 ?? []) {
        const selection = source.client.userCommandSelection;
        this.graphical?.input.setQ3CommandSelection(seat, selection);
        const player = this.simulation.movementPlayer(source.client.options.local.player.actor);
        this.graphical?.input.setArsenalSelection(seat, player?.arsenal.state.kind === "q3"
          ? { provider: player.arsenal.provider, weapon: q3WeaponItem(selection.weapon)?.item ?? null } : null);
      }
      const localCommands = this.graphical?.input.build(elapsedMilliseconds, this.elapsed, this.frames) ?? [];
      const output = this.session.step({ elapsedMilliseconds,
        commands: [...localCommands, ...remote] });
      this.frames++;
      this.sourceEvents = this.simulation.drainPresentationEvents();
      this.bots?.receive(this.sourceEvents);
      this.network?.server.publish(output, this.sourceEvents, performance.now());
      const intents = this.simulation.takeTransitions();
      if (intents.length !== 0) {
        const campaign = this.content.recipe.campaign;
        const mode = campaign.kind === "campaign" ? { kind: "campaign", campaign: campaign.mission.provider, allowRoundRestart: false } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0]
          : { kind: "competitive", match: this.content.recipe.match.provider } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0];
        this.transitions.commit(this.transitions.resolve(mode, intents));
      }
      const graphical = this.graphical;
      if (graphical !== null) {
        const presentations = this.simulation.presentations(), characters = this.simulation.characterViews();
        graphical.rerelease.receive(this.sourceEvents);
        await graphical.rerelease.prepare();
        const presentationEvents = [...this.sourceEvents.filter(event => event.kind !== "q2-composition" || event.event.kind !== "kick" && event.event.kind !== "grapple-prediction"), ...graphical.rerelease.drainPrints()];
        const nativeQ3 = this.simulation.q3Source()?.sourceState();
        for (const source of graphical.q3.values()) {
          if (nativeQ3 === undefined) throw new Error("Cgame has no authoritative source state");
          source.prediction.captureSource(nativeQ3);
          source.client.receive(nativeQ3, this.sourceEvents, localCommands);
        }
        const commonEvents = graphical.q3.size === 0 ? presentationEvents : presentationEvents.filter(event => event.kind !== "q3-source" && event.kind !== "q3-character");
        graphical.effects.receive(commonEvents);
        await graphical.effects.prepare(output.snapshot, presentations, characters, this.simulation.weaponPresentationClock());
        this.unhandledEffects = graphical.effects.drainUnhandled();
        for (const effect of this.unhandledEffects) {
          const key = `${effect.source.content}:${effect.reason}`;
          if (!this.reportedEffectGaps.has(key)) {
            this.reportedEffectGaps.add(key);
            this.host.print(`Unresolved ${effect.source.kind} effect: ${effect.reason}\n`);
          }
        }
        graphical.audio.receiveEffectSounds(graphical.effects.drainSounds());
        for (const presentation of graphical.presentations) {
          presentation.sourceEvents(presentationEvents);
          await presentation.prepare(output.snapshot, presentations, characters);
          presentation.local.player.seat.present(output.snapshot, graphical.renderer.backend);
        }
        graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
        const listeners = graphical.presentations.map(presentation => {
          const camera = presentation.camera();
          return { seat: presentation.local.player.seat.id, actor: presentation.local.player.actor, origin: camera.origin,
            axis: camera.axis, gain: 1 / graphical.presentations.length, underwater: this.underwater(camera, presentation.local.player.actor) };
        });
        await graphical.audio.frame(output.snapshot, listeners, commonEvents);
      }
      await this.commands();
      await this.sourceActions();
      return output;
    } finally { this.stepping = false; }
  }

  async run(): Promise<void> {
    let previous = performance.now();
    while (!this.stopping && !this.closed && (this.options.frameLimit === null || this.frames < this.options.frameLimit)) {
      const now = performance.now();
      const elapsed = now - previous;
      if (elapsed < 4) { await Bun.sleep(4 - elapsed); continue; }
      previous = now;
      await this.step(elapsed);
    }
  }

  readPixels(): Uint8Array {
    if (this.graphical === null) throw new Error("Dedicated applications have no framebuffer");
    return this.graphical.renderer.readPixels();
  }

  captureNextFrame(): Promise<Uint8Array> {
    if (this.graphical === null) return Promise.reject(new Error("Dedicated applications have no framebuffer"));
    return this.graphical.renderer.captureNextFrame();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    const graphical = this.graphical;
    this.graphical = null;
    const errors: unknown[] = [];
    for (const close of [() => this.bots?.close(), () => this.network?.server.close(), () => this.session.close(), () => graphical?.input.close(), () => graphical?.audio.close(), () => graphical?.effects.close(), () => this.dedicatedConsole?.close(),
      () => graphical?.art.close(), () => graphical?.assets.close(), () => graphical?.renderer.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { await this.content.close(); } catch (error) { errors.push(error); }
    this.localSeats.clear();
    if (errors.length > 0) throw new AggregateError(errors, "Application shutdown failed");
  }
}

export function openApplication(options: ApplicationOptions, host: ApplicationHost, recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides): Promise<Application> { return Application.open(options, host, recipe, preferences); }
