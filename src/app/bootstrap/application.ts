import type { ActorId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import type { TransitionDecision } from "../../contracts/gameplay.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { DedicatedConsole } from "../../console/dedicated.ts";
import { loadQ3Character } from "../../content/q3/foundation/index.ts";
import { writeSaveImage } from "../../persistence/save-image.ts";
import { EngineSession } from "../../world/session/index.ts";
import { SharedTransitionCoordinator } from "../../world/gameplay/transitions.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationAudio } from "./audio.ts";
import { loadApplicationContent } from "./content.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { ApplicationInput, movementDialect } from "./input.ts";
import type { LocalPlayer } from "./input.ts";
import { mapResourcePath } from "./options.ts";
import type { ApplicationOptions } from "./options.ts";
import { WorldSeatPresentation } from "./presentation.ts";
import { NativeRenderer } from "./renderer.ts";
import { ApplicationSeatUi } from "./ui.ts";
import { readMenuArt } from "./menu-art.ts";
import { createSimulation } from "./simulation/index.ts";
import type { SharedSimulation } from "./simulation/index.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { SimulationTravel } from "./simulation/types.ts";

interface ApplicationCommandRequest { readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; }
interface GraphicalApplication {
  readonly renderer: NativeRenderer;
  readonly assets: ApplicationAssets;
  readonly input: ApplicationInput;
  readonly audio: ApplicationAudio;
  readonly art: NativeUiArt;
  readonly presentations: readonly WorldSeatPresentation[];
}

export interface ApplicationHost {
  print(text: string): undefined;
}

/** A single authoritative simulation owns every local and remote player's game state. */
export class Application {
  private graphical: GraphicalApplication | null = null;
  private dedicatedConsole: DedicatedConsole | null = null;
  private dedicatedCommands: CommandBuffer | null = null;
  private requestedCommands: ApplicationCommandRequest[] = [];
  private stopping = false;
  private closed = false;
  private stepping = false;
  private elapsed = 0;
  private frames = 0;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private readonly transitions = new SharedTransitionCoordinator(decision => { this.pendingTransition = decision; return undefined; });
  private pendingTransition: Exclude<TransitionDecision, { readonly kind: "stay" }> | null = null;
  private pendingMap: string | null = null;

  private constructor(private launchOptions: ApplicationOptions, private loadedContent: LoadedApplicationContent,
    readonly session: EngineSession, private worldSimulation: SharedSimulation, private readonly host: ApplicationHost, private readonly identity: IdentityOwner) {}

  static async open(options: ApplicationOptions, host: ApplicationHost): Promise<Application> {
    const content = await loadApplicationContent(options);
    const identity = createIdentityOwner(`quake:${options.product}:${options.map}`);
    const session = new EngineSession(identity, options.dedicated ? { kind: "headless" } : { kind: "local" });
    let application: Application | null = null;
    try {
      const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: options.skill, mode: options.mode, seed: options.seed, maxClients: options.mode === "singleplayer" ? 1 : 16 });
      session.attachWorld(simulation);
      application = new Application(options, content, session, simulation, host, identity);
      if (options.dedicated) application.openDedicatedConsole();
      else await application.openGraphical();
      host.print(`Loaded ${content.recipe.map.geometry.requestedPath} with ${content.recipe.movement.provider} and ${content.recipe.character.appearance.provider}.\n`);
      return application;
    } catch (error) {
      if (application !== null) await application.close();
      else { session.close(); await content.close(); }
      throw error;
    }
  }

  get frameCount(): number { return this.frames; }
  get options(): ApplicationOptions { return this.launchOptions; }
  get content(): LoadedApplicationContent { return this.loadedContent; }
  get simulation(): SharedSimulation { return this.worldSimulation; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] | null { return this.graphical?.renderer.window ?? null; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get localPlayers(): readonly LocalPlayer[] { return this.graphical?.input.locals.map(local => local.player) ?? []; }

  input(event: SeatInputEvent): boolean {
    if (this.closed) throw new Error("Application is closed");
    return this.graphical?.input.input(event) ?? false;
  }

  private openDedicatedConsole(): void {
    const commands = new CommandBuffer({ dialect: movementDialect(this.options),
      context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => { this.host.print(text); } });
    commands.register("quit", () => this.requestQuit());
    for (const name of ["save", "load", "map", "say"]) commands.register(name, invocation => this.queueCommand(name, invocation.args, null));
    this.dedicatedCommands = commands;
    this.dedicatedConsole = new DedicatedConsole();
  }

  private async openGraphical(): Promise<void> {
    const owner = { identity: Symbol("application renderer"), session: this.session.session, generation: 0 };
    const assets = new ApplicationAssets(this.content, owner);
    let renderer: NativeRenderer | null = null, input: ApplicationInput | null = null, audio: ApplicationAudio | null = null;
    let art: NativeUiArt | null = null;
    try {
      await assets.loadWorld();
      const font = await assets.loadConsoleFont();
      const characters = this.options.character === "q3" ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
        { model: this.options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
      renderer = NativeRenderer.open(this.options, owner);
      const players: LocalPlayer[] = [];
      for (let index = 0; index < this.options.seats; index++) {
        const client = this.session.createClient(index);
        client.connect("loopback");
        const player = this.simulation.admitPlayer(client.id);
        const seat = this.session.createSeat(index, client);
        players.push({ seat, actor: player.actor });
      }
      input = new ApplicationInput(renderer.window, players, this.options, this.simulation,
        { quit: () => this.requestQuit(), execute: (name, arguments_, seat) => this.queueCommand(name, arguments_, seat), print: text => this.host.print(text) }, () => performance.now());
      audio = new ApplicationAudio(this.content, () => this.elapsed, this.options.seed, this.options.characterModel, text => this.host.print(text));
      const fontSource = font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, assets.images, readMenuArt);
      const native = renderer;
      const inputOwner = input, audioOwner = audio, menuArt = art;
      const presentations = input.locals.map(local => {
        const ui = new ApplicationSeatUi(local, menuArt, inputOwner, this.simulation, font, audioOwner, () => this.requestQuit(),
          (name, args) => this.queueCommand(name, args, local.player.seat.id));
        const presentation = new WorldSeatPresentation(local, assets, native, this.simulation, this.options.seats, font, characters, ui);
        local.player.seat.attachPresentation(presentation, () => presentation.close());
        return presentation;
      });
      this.graphical = { renderer, assets, input, audio, art, presentations };
      await audio.startWorldMusic();
    } catch (error) {
      this.session.close(); audio?.close(); input?.close(); renderer?.close(); art?.close(); assets.close();
      this.graphical = null;
      throw error;
    }
  }

  requestQuit(): undefined { this.stopping = true; return undefined; }

  queueCommand(name: string, arguments_: readonly string[], seat: SeatId | null): undefined {
    this.requestedCommands.push({ name, arguments_: [...arguments_], seat });
    return undefined;
  }

  private async replaceWorld(map: string, carry: SimulationTravel | null): Promise<void> {
    const options = { ...this.options, map: mapResourcePath(map) };
    const content = await loadApplicationContent(options);
    const previousContent = this.content, previous = this.graphical;
    let simulation: SharedSimulation | null = null, assets: ApplicationAssets | null = null, art: NativeUiArt | null = null;
    let nextAudio: ApplicationAudio | null = null;
    let committed = false;
    try {
      simulation = createSimulation({ identity: this.identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: options.skill, mode: options.mode, seed: options.seed, maxClients: options.mode === "singleplayer" ? 1 : 16,
        ...(carry === null ? {} : { travel: carry }) });
      const clients = (carry ?? this.simulation.captureTravel()).players.map(player => player.client);
      const nextSimulation = simulation;
      const admissions = new Map(clients.map(client => [client.slot, nextSimulation.admitPlayer(client)]));
      if (previous === null) {
        this.session.attachWorld(simulation);
        this.worldSimulation = simulation;
        this.loadedContent = content;
        this.launchOptions = options;
        committed = true;
      } else {
        assets = new ApplicationAssets(content, previous.renderer.owner);
        await assets.loadWorld();
        const font = await assets.loadConsoleFont(), fontSource = font.classic.picture.image.source;
        if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
        art = await loadNativeUiArt(fontSource.resource.id, assets.images, readMenuArt);
        const characters = options.character === "q3" ? await loadQ3Character(await content.forContent(content.recipe.character.appearance.content),
          { model: options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
        const players = previous.input.locals.map(local => {
          const player = admissions.get(local.player.seat.client.id.slot);
          if (player === undefined) throw new Error("Travel admission is missing a connected local player");
          return { seat: local.player.seat, actor: player.actor };
        });
        const preferences = previous.presentations.map(presentation => presentation.ui.preferences.values);
        this.session.attachWorld(simulation);
        this.worldSimulation = simulation;
        this.loadedContent = content;
        this.launchOptions = options;
        committed = true;
        previous.audio.close(); previous.art.close(); previous.assets.close();
        previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.frames,
          commands: previous.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
        previous.input.rebindPlayers(players, simulation);
        const audio = new ApplicationAudio(content, () => this.elapsed, options.seed, options.characterModel, text => this.host.print(text));
        nextAudio = audio;
        audio.effectsVolume = previous.audio.effectsVolume;
        const current = simulation, worldAssets = assets, menuArt = art;
        const presentations = previous.input.locals.map((local, index) => {
          const ui = new ApplicationSeatUi(local, menuArt, previous.input, current, font, audio, () => this.requestQuit(),
            (name, args) => this.queueCommand(name, args, local.player.seat.id));
          const preference = preferences[index]; if (preference !== undefined) ui.preferences.values = preference;
          const presentation = new WorldSeatPresentation(local, worldAssets, previous.renderer, current, options.seats, font, characters, ui);
          local.player.seat.attachPresentation(presentation, () => presentation.close());
          return presentation;
        });
        this.graphical = { renderer: previous.renderer, input: previous.input, audio, art, assets, presentations };
        await audio.startWorldMusic();
      }
      this.elapsed = 0;
      this.sourceEvents = [];
      await previousContent.close();
      this.host.print(`Entered ${content.recipe.map.geometry.requestedPath}.\n`);
    } catch (error) {
      if (!committed) { simulation?.close(); art?.close(); assets?.close(); await content.close(); }
      else {
        if (nextAudio !== null && this.graphical?.audio !== nextAudio) nextAudio.close();
        if (assets !== null && this.graphical?.assets !== assets) { art?.close(); assets.close(); }
        await previousContent.close();
      }
      throw error;
    }
  }

  async changeLevel(map: string, spawnPoint = ""): Promise<void> {
    if (this.closed || this.stepping) throw new Error("World travel requires an idle open application");
    await this.replaceWorld(map, this.simulation.captureTravel(spawnPoint));
  }

  private async applyTransition(): Promise<void> {
    if (this.pendingMap !== null) {
      const map = this.pendingMap, previous = this.content;
      this.pendingMap = null;
      this.pendingTransition = null;
      try { await this.replaceWorld(map, null); }
      catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
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
        if (command.name === "save") {
          const path = command.arguments_[0];
          if (path === undefined || path.length === 0) throw new Error("Usage: save <path>");
          await writeSaveImage(path, this.simulation.checkpoint());
          this.host.print(`Saved ${path}.\n`);
        } else if (command.name === "weapnext" || command.name === "weapprev" || command.name === "use") {
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        } else if (command.name === "say" || command.name === "say_team") throw new Error("This session has no connected chat transport");
        else if (command.name === "load") throw new Error("Save restoration is not yet available for this gameplay provider");
        else if (command.name === "map") {
          const map = command.arguments_[0];
          if (map === undefined) throw new Error("Usage: map <name>");
          this.pendingMap = mapResourcePath(map);
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
      if (this.dedicatedCommands !== null) {
        this.dedicatedConsole?.drain(this.dedicatedCommands);
        this.dedicatedCommands.execute();
      }
      this.elapsed += elapsedMilliseconds;
      const output = this.session.step({ elapsedMilliseconds,
        commands: this.graphical?.input.build(elapsedMilliseconds, this.elapsed, this.frames) ?? [] });
      this.frames++;
      this.sourceEvents = this.simulation.drainPresentationEvents();
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
        for (const presentation of graphical.presentations) {
          presentation.sourceEvents(this.sourceEvents);
          await presentation.prepare(output.snapshot, presentations, characters);
          presentation.local.player.seat.present(output.snapshot, graphical.renderer.backend);
        }
        graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
        const listeners = graphical.presentations.map(presentation => {
          const camera = presentation.camera();
          return { seat: presentation.local.player.seat.id, actor: presentation.local.player.actor, origin: camera.origin,
            axis: camera.axis, gain: 1 / graphical.presentations.length, underwater: this.underwater(camera, presentation.local.player.actor) };
        });
        await graphical.audio.frame(output.snapshot, listeners, this.sourceEvents);
      }
      await this.commands();
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
    for (const close of [() => this.session.close(), () => graphical?.input.close(), () => graphical?.audio.close(), () => this.dedicatedConsole?.close(),
      () => graphical?.art.close(), () => graphical?.assets.close(), () => graphical?.renderer.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { await this.content.close(); } catch (error) { errors.push(error); }
    if (errors.length > 0) throw new AggregateError(errors, "Application shutdown failed");
  }
}

export function openApplication(options: ApplicationOptions, host: ApplicationHost): Promise<Application> { return Application.open(options, host); }
