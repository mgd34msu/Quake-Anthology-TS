import type { ActorId, SeatId } from "../../contracts/identity.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import type { IpAddress } from "../../network/common/endpoint.ts";
import { addressKey, resolveAddress } from "../../network/common/endpoint.ts";
import { Q2_DATAGRAM_LIMITS, UdpTransport } from "../../network/common/transport.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { ApplicationHost } from "./application.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationAudio } from "./audio.ts";
import { loadApplicationContent } from "./content.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { ApplicationInput } from "./input.ts";
import type { LocalPlayer } from "./input.ts";
import { readMenuArt } from "./menu-art.ts";
import { Q2ClientNetwork } from "./network/q2.ts";
import { q2ApplicationLayout } from "./network/q2-layout.ts";
import { Q2RemotePresentation } from "./network/remote.ts";
import type { ApplicationNetworkPhase, Q2ApplicationGameState } from "./network/types.ts";
import { mapResourcePath } from "./options.ts";
import type { ApplicationOptions } from "./options.ts";
import { WorldSeatPresentation } from "./presentation.ts";
import { NativeRenderer } from "./renderer.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import { ApplicationSeatUi } from "./ui.ts";

interface RemoteWorldFrontend {
  readonly assets: ApplicationAssets;
  readonly font: TextFontSelection;
  readonly art: NativeUiArt;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly scene: SceneQueries;
}
interface RemoteCommand { readonly name: string; readonly args: readonly string[]; readonly seat: SeatId | null; }

/** One native seat presents received Q2 state; its session has no authoritative world. */
export class RemoteApplication {
  readonly remote: Q2RemotePresentation;
  private readonly network: Q2ClientNetwork<IpAddress>;
  private frontend: RemoteWorldFrontend | null = null;
  private controls: ApplicationInput | null = null;
  private presentation: WorldSeatPresentation | null = null;
  private commands: RemoteCommand[] = [];
  private elapsed = 0;
  private frames = 0;
  private stopping = false;
  private closed = false;
  private stepping = false;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly reportedEffectGaps = new Set<string>();
  private uiPreferences: ApplicationSeatUi["preferences"]["values"] | null = null;

  private constructor(private launchOptions: ApplicationOptions, private loadedContent: LoadedApplicationContent,
    readonly session: EngineSession, private readonly renderer: NativeRenderer, private readonly host: ApplicationHost,
    transport: UdpTransport, address: IpAddress, identity: ReturnType<typeof createIdentityOwner>) {
    this.remote = new Q2RemotePresentation({ identity, session, content: loadedContent, protocol: { kind: "q2-classic", version: 34 },
      userinfo: () => `\\name\\Player\\skin\\${launchOptions.characterModel}/${launchOptions.characterModel === "female" ? "athena" : launchOptions.characterModel === "cyborg" ? "oni911" : "grunt"}`,
      print: text => { this.print(text); },
      sendCommand: text => { this.network.command(text); }, loadContent: state => this.loadServerWorld(state) });
    this.network = new Q2ClientNetwork({ transport, remote: address, host: this.remote,
      qport: crypto.getRandomValues(new Uint16Array(1))[0] ?? 0 });
  }

  static async open(options: ApplicationOptions, host: ApplicationHost): Promise<RemoteApplication> {
    if (options.network.kind !== "q2-client") throw new Error("RemoteApplication requires --connect-q2 ADDRESS");
    if (options.dedicated || options.seats !== 1 || options.movement !== "q2" || options.character !== "q2")
      throw new Error("Native Q2 remote play requires one graphical seat with Q2 movement and character providers");
    if (!["male", "female", "cyborg"].includes(options.characterModel))
      throw new Error("Remote Q2 character selection requires an installed male, female or cyborg player appearance");
    const address = await resolveAddress(options.network.remote, 27910);
    const content = await loadApplicationContent(options);
    const identity = createIdentityOwner(`quake:remote:${addressKey(address)}`), session = new EngineSession(identity, { kind: "local" });
    let renderer: NativeRenderer | null = null, transport: UdpTransport | null = null, application: RemoteApplication | null = null;
    try {
      const product = content.catalog.product(options.product);
      if (product.expectation.family !== "q2" || product.expectation.edition === "rerelease")
        throw new Error("Remote application presentation currently requires classic Quake II protocol 34 content");
      renderer = NativeRenderer.open(options, { identity: Symbol("remote application renderer"), session: session.session, generation: 0 });
      transport = await UdpTransport.bind({ host: address.kind === "ipv4" ? "0.0.0.0" : "::", port: 0, limits: Q2_DATAGRAM_LIMITS });
      application = new RemoteApplication(options, content, session, renderer, host, transport, address, identity);
      application.frontend = await application.loadFrontend(content);
      host.print(`Connecting to Quake II server ${addressKey(address)}.\n`);
      return application;
    } catch (error) {
      if (application !== null) await application.close();
      else { transport?.close(); renderer?.close(); session.close(); await content.close(); }
      throw error;
    }
  }

  get options(): ApplicationOptions { return this.launchOptions; }
  get content(): LoadedApplicationContent { return this.loadedContent; }
  get frameCount(): number { return this.frames; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] { return this.renderer.window; }
  get networkAddress(): IpAddress { return this.network.options.transport.address; }
  get networkPhase(): ApplicationNetworkPhase { return this.network.phase; }
  get localPlayers(): readonly LocalPlayer[] { return this.controls?.locals.map(local => local.player) ?? []; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get unhandledPresentationEffects(): readonly UnhandledApplicationEffect[] { return this.unhandledEffects; }

  private print(text: string): void {
    this.host.print(text);
    for (const local of this.controls?.locals ?? []) local.console.print(text);
  }

  private async loadFrontend(content: LoadedApplicationContent): Promise<RemoteWorldFrontend> {
    const assets = new ApplicationAssets(content, this.renderer.owner);
    let art: NativeUiArt | null = null, audio: ApplicationAudio | null = null, effects: ApplicationEffects | null = null;
    try {
      await assets.loadWorld();
      const font = await assets.loadConsoleFont(), source = font.classic.picture.image.source;
      if (source.kind !== "resource") throw new Error("Remote console font has no mounted resource identity");
      art = await loadNativeUiArt(source.resource.id, assets.images, readMenuArt);
      audio = new ApplicationAudio(content, () => this.elapsed, this.options.seed, this.options.characterModel, text => this.host.print(text));
      const scene: SceneQueries = {
        trace: query => this.remote.scene.trace(query), pointContents: query => this.remote.scene.pointContents(query),
        boxLeaves: (bounds, limit) => this.remote.scene.boxLeaves(bounds, limit),
        areasConnected: (first, second) => this.remote.scene.areasConnected(first, second),
        clusterVisible: (from, to, kind) => this.remote.scene.clusterVisible(from, to, kind),
      };
      effects = new ApplicationEffects(assets, scene, actor => this.remote.isPlayer(actor), this.options.seed);
      return { assets, font, art, audio, effects, scene };
    } catch (error) { effects?.close(); audio?.close(); art?.close(); assets.close(); throw error; }
  }

  private releaseFrontend(frontend: RemoteWorldFrontend): void {
    frontend.audio.close(); frontend.effects.close(); frontend.art.close(); frontend.assets.close();
    this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
      commands: frontend.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
  }

  private async loadServerWorld(state: Q2ApplicationGameState): Promise<LoadedApplicationContent> {
    const layout = q2ApplicationLayout(this.remote.protocol), path = state.configStrings.get(layout.models + 1);
    if (path === undefined) throw new Error("Q2 server supplied no world model");
    const map = mapResourcePath(path);
    if (this.presentation !== null) this.uiPreferences = { ...this.presentation.ui.preferences.values };
    const differentMap = map !== this.content.recipe.map.geometry.requestedPath;
    if (differentMap || this.remote.player !== null) {
      const options = { ...this.options, map }, content = differentMap ? await loadApplicationContent(options) : this.content;
      let frontend: RemoteWorldFrontend;
      try { frontend = await this.loadFrontend(content); }
      catch (error) { if (differentMap) await content.close(); throw error; }
      const previous = this.frontend, oldContent = this.content;
      this.session.closeWorld(); this.presentation = null;
      if (previous !== null) {
        frontend.audio.effectsVolume = previous.audio.effectsVolume;
        frontend.audio.musicVolume = previous.audio.musicVolume;
        this.releaseFrontend(previous);
      }
      this.frontend = frontend; this.loadedContent = content; this.launchOptions = options;
      if (differentMap) await oldContent.close();
    } else {
      this.session.closeWorld(); this.presentation = null;
    }
    const frontend = this.frontend;
    if (frontend === null) throw new Error("Remote frontend has not loaded");
    const provider = await frontend.assets.provider(this.content.recipe.map.entities.content);
    for (let index = 2; index < layout.maxModels; index++) {
      const model = state.configStrings.get(layout.models + index);
      if (model === undefined || model.length === 0 || model.startsWith("#")) continue;
      const asset = await frontend.assets.model(this.content.recipe.map.entities.content, model);
      this.remote.registerResource(this.content.recipe.map.entities.content, model, asset.resource);
    }
    for (let index = 1; index < layout.maxSounds; index++) {
      const sound = state.configStrings.get(layout.sounds + index);
      if (sound === undefined || sound.length === 0 || sound.startsWith("*")) continue;
      const path = sound.startsWith("#") ? sound.slice(1) : `sound/${sound}`;
      if (await provider.mounts.open(path) === null) throw new Error(`Server sound is absent from mounted content: ${path}`);
    }
    for (let index = 1; index < layout.maxImages; index++) {
      const image = state.configStrings.get(layout.images + index);
      if (image === undefined || image.length === 0) continue;
      const path = image.startsWith("/") || image.startsWith("\\") ? image.slice(1) : `pics/${image}.pcx`;
      if (await provider.textures.load(path, { mipmap: false, wrap: "clamp" }) === null)
        throw new Error(`Server image is absent from mounted content: ${path}`);
    }
    this.commands = [];
    this.sourceEvents = [];
    this.print(`Loaded remote world ${map}.\n`);
    return this.content;
  }

  private async bindSeat(): Promise<void> {
    const player = this.remote.player, frontend = this.frontend;
    if (player === null || this.remote.output === null || frontend === null || this.presentation !== null) return;
    if (this.controls === null) {
      const seat = this.session.createSeat(0, this.remote.client);
      this.controls = new ApplicationInput(this.window, [{ seat, actor: player.actor }], this.options, this.remote,
        { quit: () => this.requestQuit(), execute: (name, args, seat) => this.queueCommand(name, args, seat), print: text => this.host.print(text) }, () => performance.now());
    } else {
      const local = this.controls.locals[0];
      if (local === undefined) throw new Error("Remote input lost its local seat");
      this.controls.rebindPlayers([{ seat: local.player.seat, actor: player.actor }], this.remote);
    }
    const input = this.controls, local = input.locals[0];
    if (local === undefined) throw new Error("Remote input has no local seat");
    const ui = new ApplicationSeatUi(local, frontend.art, input, this.remote, frontend.font, frontend.audio,
      () => this.requestQuit(), (name, args) => this.queueCommand(name, args, local.player.seat.id), await frontend.assets.loadMenuTypography());
    if (this.uiPreferences !== null) ui.preferences.values = this.uiPreferences;
    const presentation = new WorldSeatPresentation(local, frontend.assets, this.renderer, this.remote, 1, frontend.font, null, ui, frontend.effects);
    local.player.seat.attachPresentation(presentation, () => presentation.close());
    this.presentation = presentation;
    await frontend.audio.startWorldMusic();
  }

  input(event: SeatInputEvent): boolean {
    if (this.closed) throw new Error("Remote application is closed");
    return this.controls?.input(event) ?? false;
  }

  queueCommand(name: string, args: readonly string[], seat: SeatId | null): undefined {
    if (this.closed) throw new Error("Remote application is closed");
    this.commands.push({ name, args: [...args], seat });
    return undefined;
  }

  private dispatchCommands(): void {
    const pending = this.commands; this.commands = [];
    for (const command of pending) {
      try {
        if (command.name === "quit" || command.name === "disconnect") { this.requestQuit(); continue; }
        if (["map", "save", "load"].includes(command.name)) throw new Error(`${command.name} requires the authoritative server console`);
        const player = this.localPlayers.find(player => command.seat === null || player.seat.id.equals(command.seat));
        if (player === undefined || this.network.phase !== "active") throw new Error("Remote command requires a connected local player");
        this.remote.playerCommand(player.actor, command.name, command.args);
      } catch (error) { this.print(`${error instanceof Error ? error.message : String(error)}\n`); }
    }
  }

  private underwater(camera: SceneCamera, actor: ActorId, scene: SceneQueries): boolean {
    const timing = this.content.recipe.timing.find(timing => timing.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("Remote world has no numeric profile for camera contents");
    const contents = scene.pointContents({ point: camera.origin, target: { kind: "world" }, passActor: actor, numeric: timing.numeric,
      policy: { kind: "q2", contentsMask: -1, leafContents: "merged" } });
    return contents.kind === "q2" && (contents.merged & 56) !== 0;
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput | null> {
    if (this.closed) throw new Error("Remote application is closed");
    if (this.stepping) throw new Error("Remote application step is already in progress");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) throw new RangeError("Remote application step requires positive elapsed milliseconds");
    this.stepping = true;
    try {
      this.sourceEvents = []; this.unhandledEffects = [];
      this.elapsed += elapsedMilliseconds;
      if (this.controls !== null) this.controls.pump();
      else for (const event of this.window.pollEvents()) if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit();
      const now = performance.now();
      await this.network.poll(now);
      this.frames++;
      if (this.network.phase === "closed" || this.network.phase === "rejected") { this.requestQuit(); return null; }
      if (this.network.phase !== "active" || this.remote.output === null) {
        this.dispatchCommands();
        this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
          commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "swap-buffers" }] });
        return null;
      }
      await this.bindSeat();
      this.network.submit(this.controls?.build(elapsedMilliseconds, this.elapsed, this.remote.output.snapshot.frame.frame) ?? [], now);
      this.dispatchCommands();
      await this.network.poll(now);
      if (this.network.phase !== "active") return null;
      await this.bindSeat();
      const output = this.remote.samplePresentation(performance.now()), frontend = this.frontend, presentation = this.presentation;
      if (output === null) return null;
      if (frontend === null || presentation === null) throw new Error("Active remote player has no frontend");
      this.sourceEvents = this.remote.drainPresentationEvents();
      const models = this.remote.presentations(), characters = this.remote.characterViews();
      frontend.effects.receive(this.sourceEvents);
      await frontend.effects.prepare(output.snapshot, models, characters);
      this.unhandledEffects = frontend.effects.drainUnhandled();
      for (const effect of this.unhandledEffects) {
        const key = `${effect.source.content}:${effect.reason}`;
        if (!this.reportedEffectGaps.has(key)) { this.reportedEffectGaps.add(key); this.print(`Unresolved ${effect.source.kind} effect: ${effect.reason}\n`); }
      }
      frontend.audio.receiveEffectSounds(frontend.effects.drainSounds());
      presentation.sourceEvents(this.sourceEvents);
      await presentation.prepare(output.snapshot, models, characters);
      presentation.local.player.seat.present(output.snapshot, this.renderer.backend);
      this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
      const camera = presentation.camera();
      await frontend.audio.frame(output.snapshot, [{ seat: presentation.local.player.seat.id, actor: presentation.local.player.actor,
        origin: camera.origin, axis: camera.axis, gain: 1, underwater: this.underwater(camera, presentation.local.player.actor, frontend.scene) }], this.sourceEvents);
      return output;
    } finally { this.stepping = false; }
  }

  requestQuit(): undefined { this.stopping = true; return undefined; }
  async run(): Promise<void> {
    let previous = performance.now();
    while (!this.stopping && !this.closed && (this.options.frameLimit === null || this.frames < this.options.frameLimit)) {
      const now = performance.now(), elapsed = now - previous;
      if (elapsed < 4) { await Bun.sleep(4 - elapsed); continue; }
      previous = now; await this.step(elapsed);
    }
  }
  readPixels(): Uint8Array { return this.renderer.readPixels(); }
  captureNextFrame(): Promise<Uint8Array> { return this.renderer.captureNextFrame(); }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.stopping = true;
    const frontend = this.frontend; this.frontend = null;
    const errors: unknown[] = [];
    for (const close of [() => this.network.close(), () => this.session.close(), () => this.controls?.close(), () => frontend?.audio.close(),
      () => frontend?.effects.close(), () => frontend?.art.close(), () => frontend?.assets.close(), () => this.renderer.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { await this.content.close(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Remote application shutdown failed");
  }
}
