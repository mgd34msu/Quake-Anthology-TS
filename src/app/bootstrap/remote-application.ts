import { ApplicationCapture, applicationCaptureRoot } from "./capture.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import { compareQ3Packages } from "../../network/q3/pure.ts";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { existsSync } from "node:fs";
import { ServerPakSet } from "../../network/q3/pak-references.ts";
import { Q3ApplicationPackages } from "./network/q3-downloads.ts";
import { Q3ApplicationClientDownloads } from "./network/q3-client-downloads.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { q3InfoValue } from "../../network/q3/admission.ts";
import { Q3ClientContent } from "./network/q3-client-content.ts";
import type { Q3ClientConnection } from "../../network/q3/client.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import type { IpAddress } from "../../network/common/endpoint.ts";
import { addressKey, resolveAddress } from "../../network/common/endpoint.ts";
import { Q2_DATAGRAM_LIMITS, UNIFIED_DATAGRAM_LIMITS, UdpTransport } from "../../network/common/transport.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { ApplicationHost } from "./application.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { ApplicationConsoleRouting } from "./console.ts";
import { ApplicationAudio } from "./audio.ts";
import { loadApplicationContent } from "./content.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { ApplicationInput } from "./input.ts";
import type { ApplicationInputCommandOwner, LocalPlayer } from "./input.ts";
import { readMenuArt } from "./menu-art.ts";
import { Q3ClientNetwork } from "./network/q3-client.ts";
import { Q3RemotePresentation } from "./network/remote-q3.ts";
import { ApplicationQ3Client } from "./q3-client.ts";
import { q3WeaponItem } from "../../content/q3/foundation/arsenal.ts";
import { Q1ClientNetwork } from "./network/q1-client.ts";
import { Q1RemotePresentation } from "./network/remote-q1.ts";
import type { Q1RemoteWorld } from "./network/remote-q1.ts";
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
  font: TextFontSelection;
  readonly art: NativeUiArt;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly scene: SceneQueries;
}
interface RemoteCommand { readonly name: string; readonly args: readonly string[]; readonly seat: SeatId | null; }

/** One native seat presents received server state; its session has no authoritative world. */
export class RemoteApplication {
  readonly clientCommands: ApplicationInputCommandOwner | null;
  private readonly clientConfig: ConfigStore | null;
  readonly remote: Q2RemotePresentation | Q1RemotePresentation | Q3RemotePresentation;
  private readonly network: Q2ClientNetwork<IpAddress> | Q1ClientNetwork | Q3ClientNetwork;
  private frontend: RemoteWorldFrontend | null = null;
  private controls: ApplicationInput | null = null;
  private capture: ApplicationCapture | null = null;
  private presentation: WorldSeatPresentation | null = null;
  private commands: RemoteCommand[] = [];
  private elapsed = 0;
  private frames = 0;
  private stopping = false;
  private closed = false;
  private closing = false;
  private closeResult: Promise<void> | null = null;
  private worldLoadGeneration = 0;
  private stepping = false;
  private q3Content: Q3ClientContent | null = null;
  private q3Downloads: Q3ApplicationClientDownloads | null = null;
  private downloadCatalogSeed: LoadedApplicationContent | null = null;
  private q3InitialViewPending = false;
  private clientInputs: { readonly generation: number; readonly client: ApplicationQ3Client; readonly event: SeatInputEvent }[] = [];
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly reportedEffectGaps = new Set<string>();
  private uiPreferences: ApplicationSeatUi["preferences"]["values"] | null = null;

  private constructor(private launchOptions: ApplicationOptions, private loadedContent: LoadedApplicationContent,
    readonly session: EngineSession, private readonly renderer: NativeRenderer, private readonly host: ApplicationHost,
    private readonly imageSettings: ApplicationImageSettings, private readonly transport: UdpTransport, address: IpAddress, identity: ReturnType<typeof createIdentityOwner>) {
    if (launchOptions.network.kind === "q3-client") {
      const context = { session: session.session, origin: { kind: "local-console" } } satisfies import("../../contracts/common.ts").CommandContext;
      const cvars = new CvarRegistry({ dialect: "q3", context, print: text => this.print(text),
        cheatsAllowed: () => this.remote instanceof Q3RemotePresentation && q3InfoValue(this.remote.sourceRecords[1] ?? "", "sv_cheats") === "1" });
      cvars.register("cl_allowDownload", "0", CvarFlag.Archive);
      cvars.register("cl_maxpackets", "30", CvarFlag.Archive);
      cvars.register("cl_packetdup", "1", CvarFlag.Archive);
      cvars.register("rate", "25000", CvarFlag.Archive | CvarFlag.UserInfo);
      cvars.register("snaps", "20", CvarFlag.Archive | CvarFlag.UserInfo);
      cvars.register("name", "Player", CvarFlag.Archive | CvarFlag.UserInfo);
      cvars.register("model", `${launchOptions.characterModel}/default`, CvarFlag.Archive | CvarFlag.UserInfo);
      cvars.register("handicap", "100", CvarFlag.Archive | CvarFlag.UserInfo);
      const cvarRouting = new ApplicationConsoleRouting({ fallback: cvars, sourceDialect: () => "q3", server: () => null,
        seat: () => null, shared: () => this.imageSettings.cvars });
      const commands = new CommandBuffer({ dialect: "q3", context, cvars, cvarRouting, print: text => this.print(text), forwardToServer: invocation => {
        const name = invocation.argv[0]; if (name === undefined) return undefined;
        let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
        this.queueCommand(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null); return undefined;
      } });
      this.clientCommands = { cvars, commands };
      const product = loadedContent.catalog.require(launchOptions.product);
      this.clientConfig = new ConfigStore(product.userContent?.root ?? userProductDirectory(launchOptions.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
    } else { this.clientCommands = null; this.clientConfig = null; }
    if (launchOptions.network.kind === "q1-client") {
      const remote = new Q1RemotePresentation({ identity, session, content: loadedContent,
        print: text => this.print(text), sendCommand: text => this.network.command(text),
        loadContent: world => this.loadServerWorld(world) });
      this.remote = remote;
      this.network = new Q1ClientNetwork({ transport, remote: address, host: remote,
        seat: { name: "Player", color: 0, spawnParameters: "", extensionFlags: null } });
    } else if (launchOptions.network.kind === "q3-client") {
      if (address.kind !== "ipv4") throw new Error("Native Q3 remote requires IPv4");
      const remote = new Q3RemotePresentation({ identity, session, content: loadedContent,
        userinfo: () => this.clientCommands?.cvars.infoString(CvarFlag.UserInfo) ?? "",
        print: text => this.print(text), sendCommand: text => this.network.command(text),
        loadContent: (world, connection) => this.loadQ3ServerWorld(world, connection), initialize: connection => this.bindSeat(connection),
        downloads: { prepare: connection => this.prepareQ3Downloads(connection),
          publishSize: size => { if (this.q3Downloads === null) throw new Error("Q3 download has no content owner"); return this.q3Downloads.publishSize(size); },
          receive: async block => { if (this.q3Downloads === null) throw new Error("Q3 download has no content owner"); await this.q3Downloads.receive(block); },
          close: () => { this.q3Downloads?.close(); this.q3Downloads = null; } }, shutdown: async () => {
          const presentation = this.presentation;
          if (presentation !== null) {
            this.uiPreferences = { ...presentation.ui.preferences.values };
            await presentation.q3Client?.shutdown();
            this.session.closeWorld(); this.presentation = null; this.clientInputs = [];
          }
        } });
      this.remote = remote;
      this.network = new Q3ClientNetwork({ transport, remote: address, host: remote, ...(this.clientCommands === null ? {} : { cvars: this.clientCommands.cvars }), qport: crypto.getRandomValues(new Uint16Array(1))[0] ?? 0 });
    } else {
      const remote = new Q2RemotePresentation({ identity, session, content: loadedContent, protocol: { kind: "q2-classic", version: 34 },
        userinfo: () => `\\name\\Player\\skin\\${launchOptions.characterModel}/${launchOptions.characterModel === "female" ? "athena" : launchOptions.characterModel === "cyborg" ? "oni911" : "grunt"}`,
        print: text => this.print(text), sendCommand: text => this.network.command(text),
        loadContent: state => this.loadQ2ServerWorld(state), refreshDownloads: assertCurrent => this.refreshDownloadCatalog(assertCurrent) });
      this.remote = remote;
      this.network = new Q2ClientNetwork({ transport, remote: address, host: remote, qport: crypto.getRandomValues(new Uint16Array(1))[0] ?? 0 });
    }
  }

  static async open(options: ApplicationOptions, host: ApplicationHost): Promise<RemoteApplication> {
    const q1 = options.network.kind === "q1-client", q3 = options.network.kind === "q3-client";
    if (!q1 && !q3 && options.network.kind !== "q2-client") throw new Error("RemoteApplication requires a native connect address");
    const family = q1 ? "q1" : q3 ? "q3" : "q2";
    if (options.dedicated || options.seats !== 1 || options.movement !== family || options.character !== family)
      throw new Error(`Native ${family} remote play requires one graphical seat with matching movement and character providers`);
    if (!q1 && !q3 && !["male", "female", "cyborg"].includes(options.characterModel))
      throw new Error("Remote Q2 character selection requires an installed male, female or cyborg player appearance");
    if (options.network.kind !== "q1-client" && options.network.kind !== "q2-client" && options.network.kind !== "q3-client") throw new Error("Missing remote address");
    const address = await resolveAddress(options.network.remote, q1 ? 26000 : q3 ? 27960 : 27910, q3 ? 4 : 0);
    const content = await loadApplicationContent(options);
    const identity = createIdentityOwner(`quake:remote:${addressKey(address)}`), session = new EngineSession(identity, { kind: "local" });
    let renderer: NativeRenderer | null = null, transport: UdpTransport | null = null, application: RemoteApplication | null = null, imageSettings: ApplicationImageSettings | null = null;
    try {
      const product = content.catalog.product(options.product);
      if (product.expectation.family !== family || product.expectation.edition === "rerelease" || q1 && options.product !== "q1-classic-id1" || q3 && options.product !== "q3-baseq3")
        throw new Error("Remote application requires classic id1 NetQuake 15 or classic Quake II protocol 34 or baseq3 protocol 68 content");
      imageSettings = await ApplicationImageSettings.open({ context: { session: session.session, origin: { kind: "local-console" } },
        dialect: q1 ? "q1-netquake" : q3 ? "q3" : "q2-classic", ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }),
        print: text => { if (application === null) host.print(text); else application.print(text); } });
      renderer = NativeRenderer.open(options, { identity: Symbol("remote application renderer"), session: session.session, generation: 0 });
      transport = await UdpTransport.bind({ host: address.kind === "ipv4" ? "0.0.0.0" : "::", port: 0, limits: q1 || q3 ? UNIFIED_DATAGRAM_LIMITS : Q2_DATAGRAM_LIMITS });
      application = new RemoteApplication(options, content, session, renderer, host, imageSettings, transport, address, identity);
      const saved = await application.clientConfig?.loadText("settings/client.cfg");
      if (saved !== null && saved !== undefined) { application.clientCommands?.commands.append(saved); application.clientCommands?.commands.execute(); }
      application.frontend = await application.loadFrontend(content);
      host.print(`Connecting to ${q1 ? "Quake" : q3 ? "Quake III" : "Quake II"} server ${addressKey(address)}.\n`);
      return application;
    } catch (error) {
      if (application !== null) await application.close();
      else { transport?.close(); renderer?.close(); session.close(); await imageSettings?.close(); await content.close(); }
      throw error;
    }
  }

  get options(): ApplicationOptions { return this.launchOptions; }
  get content(): LoadedApplicationContent { return this.loadedContent; }
  get frameCount(): number { return this.frames; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] { return this.renderer.window; }
  get networkAddress(): IpAddress { return this.transport.address; }
  get networkPhase(): ApplicationNetworkPhase { return this.network.phase; }
  get localPlayers(): readonly LocalPlayer[] { return this.controls?.locals.map(local => local.player) ?? []; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get unhandledPresentationEffects(): readonly UnhandledApplicationEffect[] { return this.unhandledEffects; }

  private print(text: string): void {
    this.host.print(text);
    for (const local of this.controls?.locals ?? []) local.console.print(text);
  }

  private async loadFrontend(content: LoadedApplicationContent): Promise<RemoteWorldFrontend> {
    const assets = new ApplicationAssets(content, this.renderer.owner, undefined, { imagePolicy: this.imageSettings.policy });
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
      await audio.prepareEnvironment(scene);
      effects = new ApplicationEffects(assets, scene, actor => this.remote.isPlayer(actor), this.options.seed);
      return { assets, font, art, audio, effects, scene };
    } catch (error) { effects?.close(); audio?.close(); art?.close(); assets.close(); throw error; }
  }

  private releaseFrontend(frontend: RemoteWorldFrontend): void {
    frontend.audio.close(); frontend.effects.close(); frontend.art.close(); frontend.assets.close();
    if (this.closed) return;
    this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
      commands: frontend.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
  }

  private async refreshImages(): Promise<void> {
    const frontend = this.frontend;
    if (frontend === null) return;
    await this.imageSettings.refresh(frontend.assets, this.presentation === null ? [] : [this.presentation], null);
    frontend.font = await frontend.assets.loadConsoleFont();
  }

  private async loadQ2ServerWorld(state: Q2ApplicationGameState): Promise<LoadedApplicationContent> {
    const layout = q2ApplicationLayout({ kind: "q2-classic", version: 34 });
    const map = state.configStrings.get(layout.models + 1);
    if (map === undefined) throw new Error("Q2 server supplied no world model");
    const names = (first: number, maximum: number): string[] => Array.from({ length: maximum - 1 }, (_, index) => state.configStrings.get(first + index + 1) ?? '').filter(Boolean);
    const seed = this.downloadCatalogSeed;
    const content = await this.loadServerWorld({ map, models: names(layout.models, layout.maxModels), sounds: names(layout.sounds, layout.maxSounds), images: names(layout.images, layout.maxImages) }, undefined, seed !== null);
    if (this.downloadCatalogSeed === seed) this.downloadCatalogSeed = null;
    await seed?.close();
    return content;
  }
  private async refreshDownloadCatalog(assertOwnerCurrent: () => void): Promise<LoadedApplicationContent> {
    const generation = this.worldLoadGeneration;
    const assertCurrent = (): void => {
      assertOwnerCurrent();
      if (this.closed || this.closing || generation !== this.worldLoadGeneration) throw new Error("Remote package refresh was cancelled");
    };
    assertCurrent();
    const fresh = await loadApplicationContent({ ...this.options, map: this.content.recipe.map.geometry.requestedPath });
    try { assertCurrent(); } catch (error) { await fresh.close(); throw error; }
    const old = this.downloadCatalogSeed; this.downloadCatalogSeed = fresh;
    try { await old?.close(); assertCurrent(); }
    catch (error) { if (this.downloadCatalogSeed === fresh) { this.downloadCatalogSeed = null; await fresh.close(); } throw error; }
    return fresh;
  }
  private async prepareQ3Downloads(connection: Q3ClientConnection): Promise<boolean> {
    const generation = connection.generation;
    const assertCurrent = (): void => {
      if (this.closed || !(this.network instanceof Q3ClientNetwork) || this.network.native !== connection || generation !== connection.generation)
        throw new Error("Q3 package download belongs to a retired connection");
    };
    assertCurrent();
    const seed = this.downloadCatalogSeed ?? this.content, product = seed.catalog.require(this.options.product);
    const directory = product.userContent?.root ?? userProductDirectory(this.options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory);
    const root = dirname(directory), packages = await Q3ApplicationPackages.open(seed, connection.checksumFeed);
    assertCurrent();
    const info = connection.gameState.get(1) ?? "", referenced = new ServerPakSet();
    referenced.setChecksums(q3InfoValue(info, "sv_referencedPaks"));
    referenced.setNames(q3InfoValue(info, "sv_referencedPakNames"));
    this.q3Downloads?.close();
    const downloads = new Q3ApplicationClientDownloads(root, { assertCurrent: () => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 package download was replaced"); },
      reliable: text => connection.reliable.add(text), sendPacket: () => { assertCurrent(); if (this.network instanceof Q3ClientNetwork) this.network.sendPacket(); },
      progress: (name, count, size) => { if (count === 0 || count === size) this.print(`Downloading ${name}: ${count}/${size} bytes\n`); },
      reloadPackages: async () => {
        await this.refreshDownloadCatalog(() => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 package refresh was cancelled"); });
      } });
    this.q3Downloads = downloads;
    const loadedChecksums = packages.packs.map(pack => pack.pack.checksum), exists = (path: string): boolean => existsSync(join(root, path));
    if ((this.clientCommands?.cvars.get("cl_allowDownload")?.integerValue ?? 0) === 0) {
      const missing = compareQ3Packages(referenced.snapshot(), loadedChecksums, exists, false);
      if (missing.length !== 0) this.print(`Missing server packages: ${missing}\nDownloads are disabled. Enable cl_allowDownload to download server packages.\n`);
      return false;
    }
    const pending = downloads.begin(referenced.snapshot(), loadedChecksums, exists);
    if (pending) { await mkdir(root, { recursive: true }); assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 download setup was cancelled"); }
    return pending;
  }

  private async loadQ3ServerWorld(world: Q1RemoteWorld, connection: Q3ClientConnection): Promise<LoadedApplicationContent> {
    const generation = connection.generation;
    const prepared = await Q3ClientContent.open({ ...this.options, map: mapResourcePath(world.map) }, connection.gameState.get(1) ?? "", connection.checksumFeed, this.downloadCatalogSeed ?? this.content);
    try {
      if (this.closed || generation !== connection.generation) throw new Error("Remote Q3 content loading was cancelled");
      const content = await this.loadServerWorld(world, prepared.content);
      if (this.closed || generation !== connection.generation) throw new Error("Remote Q3 content loading was cancelled");
      this.q3Content = prepared;
      const seed = this.downloadCatalogSeed; this.downloadCatalogSeed = null; await seed?.close();
      return content;
    } catch (error) { await prepared.close(); throw error; }
  }

  private async loadServerWorld(world: Q1RemoteWorld & { readonly images?: readonly string[] }, preparedContent?: LoadedApplicationContent, refreshContent = false): Promise<LoadedApplicationContent> {
    await this.capture?.beforeWorldChange();
    const generation = ++this.worldLoadGeneration;
    const assertCurrent = (): void => { if (this.closed || generation !== this.worldLoadGeneration) throw new Error("Remote world loading was cancelled"); };
    assertCurrent();
    this.controls?.stopHaptics();
    const path = world.map;
    const map = mapResourcePath(path);
    if (this.presentation !== null) this.uiPreferences = { ...this.presentation.ui.preferences.values };
    const differentMap = map !== this.content.recipe.map.geometry.requestedPath;
    const replaceContent = differentMap || preparedContent !== undefined || refreshContent;
    if (replaceContent || this.presentation !== null || this.remote.player !== null) {
      const options = { ...this.options, map }, content = preparedContent ?? (differentMap || refreshContent ? await loadApplicationContent(options) : this.content);
      let frontend: RemoteWorldFrontend;
      try {
        assertCurrent();
        frontend = await this.loadFrontend(content);
        try { assertCurrent(); } catch (error) { this.releaseFrontend(frontend); throw error; }
      }
      catch (error) { if (replaceContent) await content.close(); throw error; }
      const previous = this.frontend, oldContent = this.content;
      this.session.closeWorld(); this.presentation = null;
      if (previous !== null) {
        frontend.audio.effectsVolume = previous.audio.effectsVolume;
        frontend.audio.musicVolume = previous.audio.musicVolume;
        this.releaseFrontend(previous);
      }
      this.frontend = frontend; this.loadedContent = content; this.launchOptions = options;
      if (replaceContent) await oldContent.close();
    } else {
      this.session.closeWorld(); this.presentation = null;
    }
    const frontend = this.frontend;
    if (frontend === null) throw new Error("Remote frontend has not loaded");
    const provider = await frontend.assets.provider(this.content.recipe.map.entities.content);
    assertCurrent();
    for (const model of world.models) {
      if (model === path || model.startsWith("#")) continue;
      const asset = await frontend.assets.model(this.content.recipe.map.entities.content, model);
      assertCurrent();
      this.remote.registerResource(this.content.recipe.map.entities.content, model, asset.resource);
    }
    for (const sound of world.sounds) {
      if (sound.startsWith("*")) continue;
      const path = sound.startsWith("#") ? sound.slice(1) : this.remote instanceof Q3RemotePresentation ? sound : `sound/${sound}`;
      const resource = await provider.mounts.resolve(path);
      assertCurrent();
      if (resource === null) throw new Error(`Server sound is absent from mounted content: ${path}`);
      this.remote.registerResource(this.content.recipe.map.entities.content, path, resource);
    }
    for (const image of world.images ?? []) {
      const path = image.startsWith("/") || image.startsWith("\\") ? image.slice(1) : `pics/${image}.pcx`;
      if (await provider.textures.load(path, { mipmap: false, wrap: "clamp" }) === null) throw new Error(`Server image is absent from mounted content: ${path}`);
    }
    assertCurrent();
    this.commands = [];
    this.sourceEvents = [];
    this.print(`Loaded remote world ${map}.\n`);
    return this.content;
  }

  private async bindSeat(connection?: Q3ClientConnection): Promise<void> {
    const generation = this.worldLoadGeneration;
    const assertCurrent = (): void => { if (this.closed || generation !== this.worldLoadGeneration) throw new Error("Remote seat loading was cancelled"); };
    const player = connection !== undefined && this.remote instanceof Q3RemotePresentation ? this.remote.admittedPlayer : this.remote.player, frontend = this.frontend;
    if (connection === undefined && this.q3InitialViewPending && player !== null && this.remote.output !== null && this.controls !== null) {
      const local = this.controls.locals[0];
      if (local === undefined) throw new Error("Q3 first snapshot lost its seat");
      this.controls.rebindPlayers([{ seat: local.player.seat, actor: player.actor }], this.remote);
      this.q3InitialViewPending = false;
    }
    if (player === null || (connection === undefined && this.remote.output === null) || frontend === null || this.presentation !== null) return;
    if (this.controls === null) {
      const seat = this.session.createSeat(0, this.remote.client);
      this.controls = new ApplicationInput(this.window, [{ seat, actor: player.actor }], this.options, this.remote,
        { quit: () => this.requestQuit(), execute: (name, args, seat) => this.queueCommand(name, args, seat), print: text => this.host.print(text), sharedCvars: this.imageSettings.cvars,
          clientCapturesInput: seat => { const client = this.presentation?.q3Client; return client !== null && client !== undefined && client.options.local.player.seat.id.equals(seat) && client.capturesInput; },
          clientInput: event => {
            const client = this.presentation?.q3Client;
            if (client === null || client === undefined || !client.options.local.player.seat.id.equals(event.seat) || !client.capturesInput) return false;
            this.clientInputs.push({ generation: this.worldLoadGeneration, client, event }); return true;
          } }, () => performance.now(), this.clientCommands ?? undefined);
      this.capture = new ApplicationCapture(this.controls, this.renderer, applicationCaptureRoot(this.options.userContentRoot), () => this.options.map, text => this.print(text));
    } else {
      const local = this.controls.locals[0];
      if (local === undefined) throw new Error("Remote input lost its local seat");
      this.controls.rebindPlayers([{ seat: local.player.seat, actor: player.actor }], this.remote);
    }
    const input = this.controls, local = input.locals[0];
    frontend.audio.bindHaptics(input);
    if (local === undefined) throw new Error("Remote input has no local seat");
    const typography = await frontend.assets.loadMenuTypography();
    assertCurrent();
    const ui = new ApplicationSeatUi(local, frontend.art, input, this.remote, frontend.font, frontend.audio,
      () => this.requestQuit(), (name, args) => this.queueCommand(name, args, local.player.seat.id), typography);
    if (this.uiPreferences !== null) ui.preferences.values = this.uiPreferences;
    const remote = this.remote;
    let q3: ApplicationQ3Client | null = null;
    try {
      if (remote instanceof Q3RemotePresentation) {
        if (connection === undefined) throw new Error("Q3 guest seat must initialize with its gamestate");
        q3 = await ApplicationQ3Client.create({ kind: "qvm", assertCurrent, source: remote.cgameSource, connection,
          commandBuffer: input.commands, cvars: input.cvars, renderer: this.renderer,
          clientState: () => ({ phase: this.network.phase === "active" ? 8 : this.network.phase === "loading" ? 6 : 5,
            connectPacketCount: this.network instanceof Q3ClientNetwork ? this.network.connectPacketCount : 0, clientNumber: connection.clientNumber, serverName: this.options.network.kind === "q3-client" ? this.options.network.remote : "", message: "" }),
          assets: frontend.assets, queries: remote.scene, local, audio: frontend.audio,
          viewport: () => { const size = this.window.drawableSize; return { x: 0, y: 0, width: size.width, height: size.height }; }, now: () => performance.now(),
          commands: { reliable: text => this.network.command(text), console: text => input.commands.append(text, { session: this.session.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } }), print: text => this.print(text) } });
      }
      assertCurrent();
      if (connection !== undefined) {
        if (this.q3Content === null) throw new Error("Q3 guest initialization has no content owner");
        connection.reliable.add(this.q3Content.referencedPureCommand(nativeAtoi(q3InfoValue(connection.gameState.get(1) ?? "", "sv_serverid"))));
      }
    } catch (error) { q3?.close(); ui.close(); throw error; }
    if (q3 !== null) input.registerClientCommands([...q3.commandNames]);
    const presentation = new WorldSeatPresentation(local, frontend.assets, this.renderer, this.remote, 1, frontend.font, null, ui, frontend.effects, q3);
    local.player.seat.attachPresentation(presentation, () => presentation.close());
    this.presentation = presentation;
    this.q3InitialViewPending = connection !== undefined;
    if (q3 === null) await frontend.audio.startWorldMusic();
  }

  input(event: SeatInputEvent): boolean {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
    return this.controls?.input(event) ?? false;
  }

  queueCommand(name: string, args: readonly string[], seat: SeatId | null): undefined {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
    this.commands.push({ name, args: [...args], seat });
    return undefined;
  }

  private async dispatchCommands(): Promise<void> {
    const pending = this.commands; this.commands = [];
    for (const command of pending) {
      try {
        if (command.name === "quit" || command.name === "disconnect") { this.requestQuit(); continue; }
        if (this.frontend !== null && await this.frontend.audio.command({ name: command.name, args: command.args, seat: command.seat,
          registrations: this.presentation?.q3Client?.media.bank.registrations() ?? [], print: text => this.print(text) })) continue;
        if (["map", "save", "load"].includes(command.name)) throw new Error(`${command.name} requires the authoritative server console`);
        const player = this.localPlayers.find(player => command.seat === null || player.seat.id.equals(command.seat));
        if (player === undefined || this.network.phase !== "active") throw new Error("Remote command requires a connected local player");
        const q3 = this.presentation?.q3Client;
        if (q3 !== null && q3 !== undefined) {
          if (command.name === "use") { const selected = this.remote.playerUi(player.actor).items.find(item => item.id === command.args[0]); if (selected !== undefined && await q3.command(["weapon", String(selected.sourceOrdinal)])) continue; }
          if (await q3.command([command.name, ...command.args])) continue;
        }
        this.remote.playerCommand(player.actor, command.name, command.args);
      } catch (error) { this.print(`${error instanceof Error ? error.message : String(error)}\n`); }
    }
  }

  private underwater(camera: SceneCamera, actor: ActorId, scene: SceneQueries): boolean {
    const timing = this.content.recipe.timing.find(timing => timing.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("Remote world has no numeric profile for camera contents");
    const contents = scene.pointContents({ point: camera.origin, target: { kind: "world" }, passActor: actor, numeric: timing.numeric,
      policy: this.options.network.kind === "q1-client" ? { kind: "q1", move: "normal", hull: null } : this.options.network.kind === "q3-client" ? { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } : { kind: "q2", contentsMask: -1, leafContents: "merged" } });
    return contents.kind === "q1" ? contents.contents <= -3 && contents.contents >= -5 : contents.kind === "q3" ? (contents.contents & 56) !== 0 : contents.kind === "q2" && (contents.merged & 56) !== 0;
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput | null> {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
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
      const clientInputs = this.clientInputs; this.clientInputs = [];
      for (const input of clientInputs) {
        if (!this.closed && input.generation === this.worldLoadGeneration && this.presentation?.q3Client === input.client) await input.client.input(input.event);
      }
      if (this.network.phase === "closed" || this.network.phase === "rejected") { this.controls?.stopHaptics(); this.requestQuit(); return null; }
      if (this.network.phase !== "active" || this.remote.output === null) {
        this.controls?.stopHaptics();
        await this.dispatchCommands();
        await this.refreshImages();
        this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
          commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "swap-buffers" }] });
        await this.capture?.drain();
        return null;
      }
      this.remote.samplePresentation(now);
      await this.bindSeat();
      const q3 = this.presentation?.q3Client;
      if (q3 !== null && q3 !== undefined) {
        const seat = q3.options.local.player.seat.id, selection = q3.userCommandSelection;
        this.controls?.setQ3CommandSelection(seat, selection);
        this.controls?.setArsenalSelection(seat, { provider: this.content.recipe.inventory.provider, weapon: q3WeaponItem(selection.weapon)?.item ?? null });
      }
      this.network.submit(this.controls?.build(elapsedMilliseconds, this.elapsed, this.remote.output.snapshot.frame.frame) ?? [], now);
      await this.dispatchCommands();
      await this.network.poll(now);
      if (this.network.phase !== "active") { this.controls?.stopHaptics(); return null; }
      await this.bindSeat();
      await this.refreshImages();
      const output = this.remote.samplePresentation(performance.now()), frontend = this.frontend, presentation = this.presentation;
      if (output === null) return null;
      if (frontend === null || presentation === null) throw new Error("Active remote player has no frontend");
      this.sourceEvents = this.remote.drainPresentationEvents();
      const models = this.remote.presentations(), characters = this.remote.characterViews();
      frontend.effects.receive(this.sourceEvents);
      if (!(this.remote instanceof Q3RemotePresentation)) await frontend.effects.prepare(output.snapshot, models, characters);
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
      await this.capture?.drain();
      const camera = presentation.camera();
      await frontend.audio.frame(output.snapshot, [{ seat: presentation.local.player.seat.id, actor: presentation.local.player.actor,
        origin: camera.origin, axis: camera.axis, gain: 1, underwater: this.underwater(camera, presentation.local.player.actor, frontend.scene) }], this.sourceEvents);
      return output;
    } catch (error) { await this.capture?.beforeWorldChange(); throw error; }
    finally { this.stepping = false; }
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

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closing = true; this.stopping = true;
    this.closeResult = this.closeOwned();
    return this.closeResult;
  }
  private async closeOwned(): Promise<void> {
    const errors: unknown[] = [];
    try { await this.capture?.close(); } catch (error) { errors.push(error); }
    this.capture = null;
    if (!this.stepping) {
      try { await this.presentation?.q3Client?.shutdown(); } catch (error) { errors.push(error); }
    }
    this.closed = true; this.stopping = true; this.worldLoadGeneration++; this.clientInputs = [];
    const frontend = this.frontend; this.frontend = null;
    for (const close of [() => this.q3Downloads?.close(), () => this.network.close(), () => this.session.close(), () => this.controls?.close(), () => frontend?.audio.close(),
      () => frontend?.effects.close(), () => frontend?.art.close(), () => frontend?.assets.close(), () => this.renderer.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { await this.downloadCatalogSeed?.close(); this.downloadCatalogSeed = null; } catch (error) { errors.push(error); }
    try { if (this.clientCommands !== null) await this.clientConfig?.saveCvars("settings/client.cfg", this.clientCommands.cvars); } catch (error) { errors.push(error); }
    try { await this.imageSettings.close(); } catch (error) { errors.push(error); }
    try { await this.content.close(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Remote application shutdown failed");
  }
}
