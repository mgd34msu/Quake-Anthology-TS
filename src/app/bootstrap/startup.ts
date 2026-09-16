import { SeatConsole } from "../../console/session.ts";
import { registerDiscoveryCommands } from "../../console/discovery.ts";
import { drawConsole } from "../../console/draw.ts";
import { consoleMetrics } from "../../console/metrics.ts";
import { SeatTextPresentation } from "../../text/layout.ts";
import { Draw2D, TextCommandSink } from "../../text/draw2d.ts";
import { StartupAudio } from "./startup-audio.ts";
import { readSdlClipboard } from "../../platform/sdl.ts";
import { serviceLoading } from "./loading.ts";
import { ControllerSettings } from "./controller-settings.ts";
import { StartupServerBrowser } from "./server-browser.ts";
import type { BrowserConnection } from "./server-browser.ts";
import { ConfigStore } from "../../settings/config.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { RemoteApplication } from "./remote-application.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { ClientId, SeatId } from "../../contracts/identity.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { PresentationSelection, ProviderReference } from "../../contracts/content.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import { EngineSession, type SessionSeat } from "../../world/session/index.ts";
import { InputRouter } from "../../input/router.ts";
import { SdlControllers } from "../../platform/controller.ts";
import { readSaveImage } from "../../persistence/save-image.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import { Application } from "./application.ts";
import type { ApplicationHost } from "./application.ts";
import type { ApplicationOptions } from "./options.ts";
import { mapResourcePath } from "./options.ts";
import type { CommandContext } from "../../contracts/common.ts";
import { NativeRenderer } from "./renderer.ts";
import { loadMenuArtImage } from "./menu-art.ts";
import { loadMenuFont, loadMenuTypography } from "./menu-font.ts";
import { StartupMenu } from "./startup-menu.ts";
import { createStartupSelection } from "./startup-selection.ts";
import type { StartupSelectionModel } from "./startup-selection.ts";
import { FrontendPreferences } from "./frontend-preferences.ts";
import { movementDialect } from "./input.ts";
import { StartupSaves } from "./startup-saves.ts";
import { savedSimulationSettings, savedBotCheckpoint } from "./simulation/index.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { bindNativeVideoSettings } from "../../ui/settings/services.ts";
import { sharedBindingActions } from "../../ui/settings/action-catalog.ts";
import { StartupInputProfile } from "./startup-input-profile.ts";
import { ClientSourcePublicationError, type ClientBootstrap, type ClientSourceLifetime } from "./client-bootstrap.ts";
import { configurationDialect, configurationStore, openInitialConfigurationContent, prepareInitialConfiguration, type ConfigurationCommandRequest } from "./configuration.ts";
import { loadCvarArchive } from "./cvar-archives.ts";
import type { ConsoleScriptFiles } from "./config-scripts.ts";
import { ClientDemoCommands, type ClientDemoIntent } from "./demo-commands.ts";
import { openDemoResource, type DemoRequest, type DemoFamily } from "./demo-playback.ts";
import type { PreparedStartup } from "./prepared-startup.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import { ApplicationConsoleRouting } from "./console.ts";

type StartupAction = { readonly kind: "connect"; readonly connection: BrowserConnection } | { readonly kind: "initial"; readonly options: ApplicationOptions }
  | { readonly kind: "frontend" } | { readonly kind: "play" } | { readonly kind: "preset"; readonly id: string; readonly skill: number } | { readonly kind: "load"; readonly path: string };
type StartupDisplay = Pick<ApplicationOptions, "renderer" | "gamma" | "width" | "height" | "hidden">;
interface StartupGraphics {
  readonly audio: StartupAudio;
  readonly imageSettings: ApplicationImageSettings;
  readonly display: StartupDisplay;
  readonly renderer: NativeRenderer;
  readonly menu: StartupMenu;
  router: InputRouter;
  readonly controllers: SdlControllers;
  controllerSettings: ControllerSettings;
  inputProfile: StartupInputProfile;
  draw(loadingOwner?: ClientSourceLifetime | null): void;
  close(): void;
}

/** The front end has a native window and input seat, but no gameplay world or player. */
export class StartupApplication {
  private readonly identity = createIdentityOwner("startup-client");
  private readonly session = new EngineSession(this.identity, { kind: "local" });
  private graphics: StartupGraphics | null = null;
  private imageSettings: ApplicationImageSettings | null = null;
  private game: Application | null = null;
  private remote: RemoteApplication | null = null;
  private browser: StartupServerBrowser | null = null;
  private pending: StartupAction | null = null;
  private stopping = false;
  private closed = false;
  private frames = 0;
  private status = "";
  private refreshSaves = false;
  private readonly saves: StartupSaves;
  readonly preferences: FrontendPreferences;
  private applyDisplay = false;
  private baselineProduct: string | null = null;
  private baselineInput = "";
  private preferenceStore: ConfigStore | null = null;
  private client: ClientBootstrap | null = null;
  private scripts: ConsoleScriptFiles | null = null;
  private releaseMenuInput: (() => void) | null = null;
  private lastFrame = performance.now();
  private demos: ClientDemoCommands | null = null;
  private releaseDemos: (() => void) | null = null;
  private pendingDemo: ClientDemoIntent | null = null;
  private activeDemo: DemoRequest | null = null;
  private readonly releaseSourceCommands: (() => void)[] = [];
  private frontendRouting: ApplicationConsoleRouting | null = null;

  private constructor(readonly model: StartupSelectionModel, private readonly host: ApplicationHost, saveDirectory: string, private readonly entry: "menu" | "run") {
    this.preferences = new FrontendPreferences(() => movementDialect(model.options));
    this.saves = new StartupSaves(model.catalog, saveDirectory);
  }

  static async open(options: ApplicationOptions, host: ApplicationHost, saveDirectory = join(homedir(), ".local", "share", "quake-typescript", "saves"), entry: "menu" | "run" = "menu"): Promise<StartupApplication> {
    const application = new StartupApplication(await createStartupSelection(options), host, saveDirectory, entry);
    try { application.browser = await StartupServerBrowser.open(new ConfigStore(join(saveDirectory, "..", "settings"))); await application.openGraphics(); return application; }
    catch (error) { await application.close(); throw error; }
  }

  private get frontendHistory(): readonly string[] | undefined {
    const local = this.client?.locals[0];
    return local === undefined ? undefined : this.client?.consoles.get(local.seat)?.history.lines;
  }

  private async refreshPreferenceBaseline(force = false): Promise<void> {
    const options = this.model.options;
    const inputKey = JSON.stringify([movementDialect(options), this.model.bindingItems()]);
    if (!force && this.baselineProduct === options.product && this.baselineInput === inputKey) return;
    await this.graphics?.inputProfile.save(this.preferences.values, this.frontendHistory);
    if (this.preferenceStore !== null) await this.preferences.saveAudioBaseline(this.preferenceStore);
    const product = this.model.catalog.product(options.product);
    const settings = new ConfigStore(product.userContent?.root
      ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
    await this.preferences.loadBaseline(settings);
    this.preferenceStore = settings;
    this.baselineProduct = options.product;
    this.baselineInput = inputKey;
    if (this.graphics !== null) this.graphics.inputProfile = StartupInputProfile.retained(settings, this.graphics.inputProfile.input);
  }

  private async openGraphics(): Promise<StartupGraphics> {
    await this.refreshPreferenceBaseline(true);
    if (this.model.options.rendererSelection === "default") {
      const selected = (await this.preferenceStore?.loadText("renderer"))?.trim();
      if (selected === "cpu" || selected === "gl") this.model.select("renderer", selected);
    }
    let options = this.model.options;
    const identity = this.identity, session = this.session;
    const configuration = await openInitialConfigurationContent(options, undefined, this.model.catalog);
    const settings = configurationStore(options, configuration, configuration.selection.engineBehavior.content);
    const localSeats = new Map<ClientId, SessionSeat>();
    let initial: Awaited<ReturnType<typeof prepareInitialConfiguration>>;
    try {
      const archive = await loadCvarArchive(configurationStore(options, configuration, configuration.selection.source.content),
        ["source", configuration.selection.source.content, configuration.selection.source.provider], configurationDialect(configuration));
      initial = await prepareInitialConfiguration(options, configuration, session, identity, localSeats, settings, this.host, archive,
        options.mode === "singleplayer" ? configuration.catalog.product(configuration.selection.engineBehavior.content).expectation.family === "q3" ? 8 : options.seats : 16,
        async () => { await Bun.sleep(0); }, prepared => this.bindDemoCommands(prepared));
    } catch (error) { await session.close(); configuration.close(); throw error; }
    this.scripts = initial.scripts;
    this.imageSettings = initial.image;
    options = initial.options;
    const primary = initial.prepared.seats[0];
    const primarySeat = [...localSeats.values()][0];
    if (primary === undefined || primarySeat === undefined || initial.image === null) {
      await session.close(); await initial.scripts.close(); throw new Error("Graphical startup requires a prepared local client");
    }
    const seat = primary.id, client = primarySeat.client.id;
    const owner = { identity: Symbol("startup renderer"), session: identity.session, generation: 0 };
    const images = new SceneImageRegistry(owner);
    const installed = this.model.catalog.products.filter(product => product.availability.kind === "installed");
    const product = installed.find(product => product.expectation.id === options.product) ?? installed[0];
    if (product === undefined) throw new Error(`No installed game data found in ${options.corpusRoot}; a game charset is required for the startup menu`);
    const mounts = await this.model.catalog.mountsFor(product.id);
    const mounted = await openMountPlan({ id: createMountPlanId("startup", "font"), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    let themeMounts: Awaited<ReturnType<typeof openMountPlan>> | null = null;
    let audio: StartupAudio | null = null;
    let font: Awaited<ReturnType<typeof loadMenuFont>> | null = null;
    let art: Awaited<ReturnType<typeof loadNativeUiArt>> | null = null;
    let typography: Awaited<ReturnType<typeof loadMenuTypography>> | null = null;
    let renderer: NativeRenderer | null = null, controllers: SdlControllers | null = null, router: InputRouter | null = null, menu: StartupMenu | null = null;
    try {
      const imageSettings = initial.image;
      font = await loadMenuFont({ catalog: this.model.catalog, mounts: mounted, family: product.expectation.family, rerelease: product.expectation.edition === "rerelease", images, imagePolicy: imageSettings.policy });
      typography = await loadMenuTypography(this.model.catalog, images, font.font.classic, imageSettings.policy);
      const fontSource = font.font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Startup font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, images, loadMenuArtImage);
      renderer = NativeRenderer.open(options, owner, images);
      await imageSettings.refreshDisplay(renderer);
      controllers = SdlControllers.open();
      const themeProduct = installed.find(candidate => candidate.expectation.family === "q2" && candidate.expectation.edition === "rerelease" && candidate.expectation.campaign === "baseq2");
      if (themeProduct !== undefined) {
        const themePlan = await this.model.catalog.mountsFor(themeProduct.id);
        themeMounts = await openMountPlan({ id: createMountPlanId("startup", "music"), mounts: themePlan, defaultOrder: themePlan.map(mount => mount.identity.id), prefixOrders: [] });
      }
      const activeThemeMounts = themeMounts;
      audio = await StartupAudio.open({ theme: themeProduct === undefined || themeMounts === null ? null : { source: { content: themeProduct.id, ...themeProduct.expectation }, mounts: themeMounts }, mounts: mounted, source: { content: product.id, ...product.expectation }, seat, print: this.host.print,
        preferences: { ...this.preferences.audioBaseline, ...this.preferences.audioValues } });
      audio.openOutput(this.preferences.audioBaseline.deviceName ?? null, this.host.print);
      const activeAudio = audio;
      menu = new StartupMenu({ sound: sound => { const volume = this.preferences.audioValues; activeAudio.setVolumes(volume.effectsVolume, volume.musicVolume); activeAudio.sound(sound); }, ...(this.host.llm === undefined ? {} : { llm: this.host.llm }),
        clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); }, seat, model: this.model, art, font: typography.body, titleFont: typography.title, now: () => performance.now(),
        ...(this.browser === null ? {} : { browser: this.browser, connect: (connection: BrowserConnection) => { this.pending = { kind: "connect", connection }; } }),
        playPreset: (id, skill) => { this.pending = { kind: "preset", id, skill }; },
        play: () => { this.pending = { kind: "play" }; }, load: id => {
          try { this.pending = { kind: "load", path: this.saves.path(id) }; }
          catch (error) { this.status = error instanceof Error ? error.message : String(error); this.graphics?.menu.setStatus(this.status); }
        },
        quit: () => this.requestQuit(), settings: [...this.preferences.bindings(), ...bindNativeVideoSettings(renderer.window, imageSettings.cvars, message => this.graphics?.menu.setStatus(message))], applyDisplay: () => { this.applyDisplay = true; }, saves: () => this.saves.list, refreshSaves: () => { this.refreshSaves = true; } });
      menu.setStatus(this.status);
      const activeMenu = menu;
      const input = primary.input;
      const inputProfile = StartupInputProfile.retained(settings, input);

      activeMenu.bindInput(input, () => sharedBindingActions(movementDialect(this.model.options), this.model.bindingItems(), this.model.bindingCapabilities()));
      input.setFocus({ kind: "menu", menu: activeMenu.controller.activeMenu ?? "menu:startup:main", control: null }, performance.now());
      const native = renderer;
      router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }], keyboardSeat: seat, controllers,
        now: () => performance.now(), ticks: () => native.window.ticks, subframe: false,
        unhandled: event => { if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit(); } });
      router.attachWindow(native.window);
      const controllerSettings = new ControllerSettings(router, [seat], () => controllers?.devices ?? [], new ConfigStore(join(this.saves.directory, "..", "settings")), this.host.print);
      controllerSettings.update(); activeMenu.bindGyro(controllerSettings.ui(seat));
      const builder = new SceneFrameBuilder(images), activeFont = font, activeTypography = typography, activeArt = art, activeRouter = router, pads = controllers;
      let consoleText = new SeatTextPresentation(seat, activeFont.font);
      const provider: ProviderReference = { provider: `${product.expectation.family}:official`, content: product.id };
      const presentation: PresentationSelection = { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider };
      this.graphics = { audio: activeAudio, imageSettings, inputProfile, display: { renderer: options.renderer, gamma: options.gamma, width: options.width, height: options.height, hidden: options.hidden }, renderer: native, menu: activeMenu, router: activeRouter, controllers: pads, controllerSettings,
        draw: loadingOwner => {
          const output = this.client?.output.current ?? activeAudio.engine;
          if (output === activeAudio.engine) {
            const volume = this.preferences.audioValues; activeAudio.setVolumes(volume.effectsVolume, volume.musicVolume);
          }
          output.updateMusic(); output.pump();
          if (this.client?.platform.current?.kind === "world"
            && (loadingOwner === undefined || this.client.source.current !== loadingOwner)) return;
          const viewport = { x: 0, y: 0, ...native.window.drawableSize };
          builder.begin("back", true);
          const primary = this.client?.locals[0];
          activeMenu.draw({ binding: { seat: primary?.seat.id ?? seat, client: primary?.client.id ?? client, viewport, safeArea: viewport, hudScale: 1, presentation }, timeMilliseconds: performance.now() },
            command => builder.command(command), () => { throw new Error("Startup charset unexpectedly requested a material draw"); });
          const console = primary === undefined ? undefined : this.client?.consoles.get(primary.seat);
          if (primary !== undefined && console !== undefined && primary.prepared.input.focus.kind === "console") {
            if (!consoleText.seat.equals(primary.seat.id)) consoleText = new SeatTextPresentation(primary.seat.id, activeFont.font);
            const draw = new Draw2D(new TextCommandSink(primary.seat.id, viewport, command => {
              if (command.kind === "swap-buffers") throw new Error("Text cannot present a frame");
              builder.command(command);
            },
              () => { throw new Error("Console charset unexpectedly requested a material draw"); }), "pixels");
            const logical = native.window.logicalSize, height = Math.trunc(viewport.height * 0.5);
            const metrics = consoleMetrics({ width: viewport.width, height: viewport.height,
              pixelRatio: Math.max(viewport.width / logical.width, viewport.height / logical.height),
              requestedScale: imageSettings.cvars.variableValue("con_scale"), font: consoleText.font });
            draw.fillRect({ x: 0, y: 0, width: viewport.width, height }, { x: 0, y: 0, z: 0, w: 0.85 }, activeArt.white);
            if (console.buffer.width !== metrics.columns) console.buffer.resize(metrics.columns);
            drawConsole({ draw, text: consoleText, rows: console.buffer.visible(Math.max(1, Math.trunc(height / metrics.lineHeight))),
              field: console.field, selectedEntry: console.selectedCompletionEntry, height, scale: metrics.scale,
              cellWidth: metrics.cellWidth, nowMilliseconds: performance.now(), background: null });
          }
          native.execute(builder.finish());
        },
        close: () => { activeAudio.close(); activeThemeMounts?.close(); (this.graphics?.controllerSettings ?? controllerSettings).close();
          (this.graphics?.router ?? activeRouter).close(); pads.close(); activeMenu.close(); activeArt.close(); activeTypography.close(); activeFont.close(); images.close(); native.close(); mounted.close(); } };
      const locals = initial.prepared.seats.map(prepared => {
        const local = [...localSeats.values()].find(candidate => candidate.id.equals(prepared.id));
        if (local === undefined) throw new Error("Prepared startup seat has no session owner");
        return { client: local.client, seat: local, prepared };
      });
      const hasPendingSource = (): boolean => this.pending !== null || this.pendingDemo !== null;
      this.client = { consoles: new Map<SessionSeat, SeatConsole>(), identity, session, locals, prepared: initial.prepared, renderer: native, imageSettings, controllers: pads, settings,
        output: { current: activeAudio.engine }, platform: { current: { kind: "menu", router: activeRouter, controllerSettings,
          retireCommands: () => { this.releaseMenuInput?.(); this.releaseMenuInput = null; } } },
        source: { current: null }, sourceProfile: { current: configuration.selection.source }, configuration: { current: { scripts: initial.scripts, options: initial.options } }, activateFrontend: () => this.activateFrontend(),
        routeCommand: (name, args, source) => this.routeCommand(name, args, source),
        dispatchApplicationRequest: request => this.dispatchApplicationRequest(request),
        get hasPendingSource() { return hasPendingSource(); } };
      this.bindFrontendConsole();
      const savedInput = await settings.loadSeat("input/seat-1.json");
      if (savedInput !== null) this.client.consoles.get(primarySeat)?.history.replace(savedInput.history);
      initial.prepared.forwardCommands((name, args, source) => { this.frontendCommand(name, args, source); return undefined; });
      for (const request of initial.requests) this.frontendCommand(request.name, request.arguments_, request.source);
      if (this.pending === null && this.pendingDemo === null && this.entry === "run") this.pending = { kind: "initial", options: initial.options };
      return this.graphics;
    } catch (error) {
      audio?.close(); themeMounts?.close(); router?.close(); controllers?.close(); menu?.close(); art?.close(); typography?.close(); font?.close(); images.close(); renderer?.close(); mounted.close();
      await session.close(); await initial.image.close(); await initial.scripts.close();
      throw error;
    }
  }

  get activeGame(): Application | null { return this.game; }
  get inputSeat(): SeatId | null { return this.client?.platform.current?.kind === "menu" ? this.graphics?.menu.controller.seat ?? null : null; }
  input(event: SeatInputEvent): boolean {
    return this.client?.platform.current?.kind === "world" ? (this.game ?? this.remote)?.input(event) ?? false
      : this.client?.locals[0]?.prepared.input.input(event) ?? false;
  }
  requestQuit(): void { this.stopping = true; this.game?.requestQuit(); this.remote?.requestQuit(); }
  readPixels(): Uint8Array { if (this.graphics === null) throw new Error("Startup menu is not visible"); return this.graphics.renderer.readPixels(); }
  captureNextFrame(): Promise<Uint8Array> { if (this.graphics === null) return Promise.reject(new Error("Startup menu is not visible")); return this.graphics.renderer.captureNextFrame(); }

  private bindDemoCommands(prepared: PreparedStartup): void {
    const family = (): DemoFamily => prepared.commands.dialect === "q1-netquake" ? "q1" : prepared.commands.dialect === "q1-quakeworld" ? "qw"
      : prepared.commands.dialect === "q3" ? "q3" : "q2";
    const demos = new ClientDemoCommands({ dedicated: false,
      current: () => this.activeDemo !== null ? { kind: "demo", family: this.activeDemo.family, request: this.activeDemo }
        : this.game !== null ? { kind: "local", family: family() } : this.remote !== null ? { kind: "network", family: family() }
        : { kind: "idle", family: family(), explicitStartup: this.entry === "run" },
      stage: intent => { this.pendingDemo = intent; prepared.noteWorldAction(); },
      print: text => this.print(text), append: (text, source) => prepared.commands.append(text, source),
      takeCompletionCommand: source => {
        const name = source === "q2" ? "nextserver" : "nextdemo", command = prepared.source.variableString(name);
        prepared.source.set(name, "", true); return command;
      } });
    this.demos = demos; this.releaseDemos = demos.attach(prepared.commands);
    for (const name of ["connect", "disconnect", "quit"]) {
      const handler = (command: import("../../core/commands/index.ts").CommandInvocation): undefined => {
        this.routeCommand(name, command.args, command.source, prepared); prepared.noteWorldAction();
        return undefined;
      };
      if (prepared.commands.register(name, handler)) this.releaseSourceCommands.push(() => { prepared.commands.unregister(name, handler); });
    }
  }

  private routeCommand(name: string, args: readonly string[], source: CommandContext, prepared = this.client?.prepared): boolean {
    let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "remote-client") return false;
    if (this.demos?.handle(name, args, source)) return true;
    if (name === "quit") { this.requestQuit(); return true; }
    if (name === "disconnect") { this.pending = { kind: "frontend" }; return true; }
    const options = this.game?.options ?? this.remote?.options ?? this.model.options;
    if (name === "connect") {
      if (args.length !== 1 || args[0] === undefined) { this.print("Usage: connect <address>\n"); return true; }
      if (prepared === undefined) throw new Error("Connect has no prepared command owner");
      const dialect = prepared.commands.dialect;
      const kind = dialect === "q1-netquake" ? "q1-client" : dialect === "q1-quakeworld" ? "qw-client" : dialect === "q3" ? "q3-client" : "q2-client";
      this.pending = { kind: "initial", options: { ...options, seats: 1, network: { kind, remote: args[0] } } }; return true;
    }
    if (this.game === null && name === "map") {
      if (args.length !== 1 || args[0] === undefined) { this.print("Usage: map <name>\n"); return true; }
      this.pending = { kind: "initial", options: { ...options, map: mapResourcePath(args[0]), network: { kind: "offline" } } }; return true;
    }
    if (this.game === null && name === "load" && args[0] !== undefined) { this.pending = { kind: "load", path: args[0] }; return true; }
    return false;
  }

  private async publishDemoIntent(): Promise<void> {
    const intent = this.pendingDemo; this.pendingDemo = null;
    if (intent === null) return;
    if (intent.kind === "stop") { await this.returnToFrontend(); this.activeDemo = null; this.demos?.refresh(); return; }
    const client = this.client;
    if (client === null) throw new Error("Demo playback has no retained client");
    try {
      const options = this.game?.options ?? this.remote?.options ?? client.configuration.current.options;
      const browser = this.browser;
      if (browser === null) throw new Error("Startup browser is unavailable");
      const resource = await openDemoResource(intent.request, path => this.game !== null ? this.game.readClientResource(path)
        : this.remote !== null ? this.remote.readClientResource(path) : this.readFrontendResource(path), text => this.print(text));
      const remote = await RemoteApplication.openDemoBorrowed(client, options, { ...this.host, saveDirectory: this.saves.directory, serverBrowser: browser }, { resource, timedemo: intent.request.timedemo },
        reason => this.demos?.complete(intent.request, reason));
      this.game = null; this.remote = remote; this.activeDemo = intent.request; this.demos?.refresh();
      this.lastFrame = performance.now();
    } catch (error) {
      this.demos?.failed(intent.request);
      this.lastFrame = performance.now();
      if (error instanceof ClientSourcePublicationError) { this.stopping = true; throw error; }
      this.print(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  private readFrontendResource(path: string): Promise<Uint8Array | undefined> {
    const scripts = this.client?.configuration.current.scripts ?? this.scripts;
    if (scripts === null) throw new Error("Frontend configuration reader is unavailable");
    return scripts.readMounted(path);
  }

  private frontendCommand(name: string, args: readonly string[], source: CommandContext): void {
    if (this.routeCommand(name, args, source)) return;
    this.print(`Cannot execute ${name} without an active world.\n`);
  }

  private print(text: string): undefined {
    this.host.print(text);
    const client = this.client, local = client?.locals[0];
    if (client?.platform.current?.kind === "menu" && local !== undefined) client.consoles.get(local.seat)?.print(text);
    return undefined;
  }

  private bindFrontendConsole(): void {
    const client = this.client, graphics = this.graphics, local = client?.locals[0];
    if (client === null || graphics === null || local === undefined) throw new Error("Frontend console has no retained seat");
    this.releaseMenuInput?.(); this.releaseMenuInput = null;
    const prepared = client.prepared, input = local.prepared.input;
    const candidate = new SeatConsole({ staged: true, seat: local.seat.id,
      get dialect() { return prepared.commands.dialect; },
      context: { session: local.seat.id.session, origin: { kind: "local-seat", seat: local.seat.id, client: local.client.id } },
      commands: prepared.commands, cvars: local.prepared.cvars, now: () => performance.now(), connected: () => false,
      clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); },
      focus: focus => {
        input.setFocus(focus.kind === "game" ? { kind: "menu", menu: graphics.menu.controller.activeMenu ?? "menu:startup:main", control: null } : focus, performance.now());
        graphics.router.updateCapture();
      }, chat: () => { this.print("Chat requires an active connection.\n"); } });
    const retained = client.consoles.get(local.seat), console = retained ?? candidate;
    if (retained === undefined) { candidate.publish(input.focus); client.consoles.set(local.seat, candidate); }
    else retained.adopt(candidate, input.focus);
    const releaseInput = input.bindUiEvent((event, focus) => {
      if (event.kind === "key" && (event.code === 96 || event.code === 126)) {
        if (event.down) console.toggleFromKey(event.repeat);
        return true;
      }
      return console.input(event, focus) || focus.kind === "console" || graphics.menu.input(event);
    }, () => performance.now());
    const releaseOutput = prepared.bindOutput((text, source) => {
      this.host.print(text);
      let origin = source?.origin; while (origin?.kind === "script") origin = origin.caller;
      if (origin?.kind !== "local-seat" || origin.seat.equals(local.seat.id) && origin.client.equals(local.client.id)) console.print(text);
    });
    const releaseDiscovery = registerDiscoveryCommands(prepared.commands, text => console.print(text));
    const toggle = (): undefined => { console.toggle(); return undefined; };
    const registered = prepared.commands.register("toggleconsole", toggle);
    this.releaseMenuInput = () => {
      releaseInput(); releaseOutput(); releaseDiscovery();
      if (registered) prepared.commands.unregister("toggleconsole", toggle);
    };
  }

  private activateFrontend(): void {
    const client = this.client, graphics = this.graphics;
    if (client === null || graphics === null) throw new Error("Retained frontend is unavailable");
    const primary = client.prepared.seats[0];
    if (primary === undefined) throw new Error("Frontend has no retained primary seat");
    if (graphics.router.seat(primary.id) !== primary.input) {
      this.releaseMenuInput?.(); this.releaseMenuInput = null;
      const oldRouter = graphics.router;
      const router = new InputRouter({ seats: [{ input: primary.input, controller: { kind: "automatic" } }], keyboardSeat: primary.id,
        controllers: client.controllers, deferPlatform: true, now: () => performance.now(), ticks: () => client.renderer.window.ticks, subframe: false,
        unhandled: event => { if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit(); } });
      if (client.platform.current?.kind === "menu") oldRouter.transferWindowTo(router);
      graphics.controllerSettings.close(); oldRouter.close(); graphics.router = router;
      graphics.controllerSettings = new ControllerSettings(router, [primary.id], () => client.controllers.devices, client.settings, this.host.print);
      graphics.inputProfile = StartupInputProfile.retained(client.settings, primary.input);
      graphics.menu.bindInput(primary.input, () => sharedBindingActions(movementDialect(this.model.options), this.model.bindingItems(), this.model.bindingCapabilities()));
      graphics.menu.bindGyro(graphics.controllerSettings.ui(primary.id));
    }
    const platform = client.platform.current;
    if (platform?.kind === "world") platform.input.transferPlatformToFrontend(graphics.router);
    if (client.output.current !== graphics.audio.engine) {
      client.output.current.prepareOutputTransfer(graphics.audio.engine)(); client.output.current = graphics.audio.engine;
    }

    primary.input.setFocus({ kind: "menu", menu: graphics.menu.controller.activeMenu ?? "menu:startup:main", control: null }, performance.now());
    client.prepared.setActiveSeats([primary.id]);
    client.platform.current = { kind: "menu", router: graphics.router, controllerSettings: graphics.controllerSettings,
      retireCommands: () => { this.releaseMenuInput?.(); this.releaseMenuInput = null; } };
    this.publishFrontendRouting(client);
    this.bindFrontendConsole();
    graphics.router.updateCapture();
  }

  private async returnToFrontend(): Promise<void> {
    const client = this.client;
    if (client === null) throw new Error("Retained client is unavailable");
    const source = client.source.current;
    await source?.prepareRetirement();
    this.activateFrontend();
    source?.releaseSettings();
    const retired = client.session.detachWorld();
    this.game = null; this.remote = null;
    client.source.current = null;
    try { await source?.retire(); } finally { await retired.close(); }
    this.activeDemo = null;
    this.graphics?.menu.setStatus(this.status);
    this.demos?.refresh();
  }

  private publishFrontendRouting(client: ClientBootstrap): void {
    const scripts = client.configuration.current.scripts;
    const prepared = client.prepared;
    const seatContexts = new Map<CvarRegistry, CommandContext>();
    for (const seat of prepared.seats) {
      const context = seat.context, origin = context.origin;
      if (origin.kind !== "local-seat" || !origin.seat.equals(seat.id)) throw new Error("Frontend cvar owner has no actual seat context");
      for (const owner of [seat.cvars, seat.mouse.cvars]) {
        const previous = seatContexts.get(owner)?.origin;
        if (previous !== undefined && (previous.kind !== "local-seat" || !previous.seat.equals(origin.seat) || !previous.client.equals(origin.client)))
          throw new Error("Frontend cvar registry is shared by different client seats");
        seatContexts.set(owner, context);
      }
    }
    const copies = new Map<CvarRegistry, CvarRegistry>();
    const copy = (owner: CvarRegistry): CvarRegistry => {
      const prior = copies.get(owner); if (prior !== undefined) return prior;
      const cvars = new CvarRegistry({ dialect: owner.dialect, context: seatContexts.get(owner) ?? owner.context, print: this.host.print });
      owner.prepareTransfer(cvars); copies.set(owner, cvars); return cvars;
    };
    const source = copy(prepared.source), movement = copy(prepared.movement), fallback = copy(prepared.fallback);
    const seats = prepared.seats.map(seat => ({ ...seat, cvars: copy(seat.cvars), mouse: new MouseSettings(copy(seat.mouse.cvars)) }));
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => source.dialect,
      server: () => ({ cvars: source, sharedNames: source.snapshots().map(variable => variable.name) }),
      seat: id => seats.find(seat => seat.id.equals(id) && seat.cvars.dialect === source.dialect)?.cvars ?? null,
      input: id => seats.find(seat => (id === null || seat.id.equals(id)) && seat.mouse.cvars.dialect === source.dialect)?.mouse.cvars ?? null,
      movement: () => movement, shared: () => client.imageSettings.cvars });
    prepared.validateOwners({ source, movement, fallback });
    prepared.publishSeats(seats, seats.slice(0, 1).map(seat => seat.id));
    prepared.adopt(routing, (name, args, context) => { this.frontendCommand(name, args, context); return undefined; },
      { source, movement, fallback, scripts, read: (name, context) => scripts.read(name, context) });
    this.frontendRouting?.close(); this.frontendRouting = routing;
  }

  private async launch(action: StartupAction): Promise<void> {
    const previous = this.client?.source.current;
    if (this.game !== null) this.preferences.values = this.game.frontendSettings;
    await this.graphics?.inputProfile.save(this.preferences.values, this.frontendHistory);
    if (this.preferenceStore !== null) await this.preferences.saveAudioBaseline(this.preferenceStore);
    this.graphics?.menu.setStatus("Loading...", true);
    this.graphics?.draw(previous ?? null);
    try {
      if (action.kind === "frontend") { await this.returnToFrontend(); return; }
      if (action.kind === "connect") { await this.connect(action.connection); return; }
      if (action.kind === "initial" && (action.options.network.kind === "q1-client" || action.options.network.kind === "qw-client"
        || action.options.network.kind === "q2-client" || action.options.network.kind === "q3-client")) {
        await this.connectOptions(action.options); return;
      }
      const loading = this.graphics;
      const client = this.client;
      if (client === null) throw new Error("Startup has no retained client");
      const game = await serviceLoading(async nextFrame => {
        loading?.menu.setStatus("Loading map...", true);
        const selected = action.kind === "initial" ? { options: action.options, recipe: undefined, image: undefined }
          : action.kind === "preset" ? { ...await this.model.resolvePreset(action.id, action.skill), image: undefined }
          : action.kind === "play" ? { ...await this.model.resolve(), image: undefined } : await (async () => {
          const image = await readSaveImage(action.path), settings = savedSimulationSettings(image);
          const bots = savedBotCheckpoint(image);
          const seats = settings.clientSlots.filter(slot => !bots?.transport.connections.some(connection => connection.client.slot === slot)).length;
          if (seats < 1 || seats > 4) throw new Error("This saved game requires between 1 and 4 local players.");
          const { botSkill: _botSkill, ...options } = this.model.options;
          return { recipe: image.recipe, image, options: { ...options, skill: settings.skill, mode: settings.mode, seed: settings.seed,
            seats } };
        })();
        loading?.menu.setStatus("Preparing world...", true);
        const game = await Application.openBorrowed(client, { ...selected.options, renderer: loading?.display.renderer ?? selected.options.renderer }, { ...this.host, saveDirectory: this.saves.directory, loading: { deferWindowVisibility: true, nextFrame: async () => {
          await nextFrame(); if (this.stopping) throw new Error("Startup cancelled");
        },
          stage: message => loading?.menu.setStatus(message, true) } }, selected.recipe, this.preferences.values, selected.image);
        this.game = game;
        this.remote = null;
        await game.flushClientCommands();
        this.lastFrame = performance.now();
        return game;
      }, () => {
        if (loading === null) return;
        for (const event of loading.renderer.window.pollEvents()) {
          if (event.kind === "quit" || event.kind === "window" && event.event === 14) { this.requestQuit(); loading.renderer.window.setVisible(false); }
        }
        loading.draw(previous ?? null);
      });
      if (this.game !== game) return;
      if (!this.stopping) game.window?.setVisible(!game.options.hidden);
      this.activeDemo = null; this.demos?.manualGame(); this.demos?.refresh();
      this.status = "";
    } catch (error) {
      this.lastFrame = performance.now();
      this.status = error instanceof Error ? error.message : String(error);
      this.print(`${this.status}\n`);
      this.graphics?.menu.setStatus(this.status);
      if (error instanceof ClientSourcePublicationError || this.client?.source.current !== previous) { this.stopping = true; throw error; }
    }
  }

  private async connect(connection: BrowserConnection): Promise<void> {
    const family = connection.protocol;
    const options: ApplicationOptions = { ...this.model.options, product: family === "q1" ? "q1-classic-id1" : family === "q2" ? "q2-classic-baseq2" : "q3-baseq3",
      map: family === "q1" ? "maps/e1m1.bsp" : family === "q2" ? "maps/base1.bsp" : "maps/q3dm1.bsp", movement: family, character: family,
      characterModel: family === "q1" ? "player" : family === "q2" ? "male" : "sarge", seats: 1, dedicated: false, rules: "standard",
      network: { kind: family === "q1" ? "q1-client" : family === "q2" ? "q2-client" : "q3-client", remote: connection.remote } };
    await this.connectOptions(options);
  }

  private async connectOptions(options: ApplicationOptions): Promise<void> {
    {
      const client = this.client;
      if (client === null) throw new Error("Startup has no retained client");
      const browser = this.browser;
      if (browser === null) throw new Error("Startup browser is unavailable");
      const remote = await RemoteApplication.openBorrowed(client, { ...options, renderer: this.graphics?.display.renderer ?? options.renderer }, { ...this.host, saveDirectory: this.saves.directory, serverBrowser: browser, print: text => {
        this.print(text); const message = text.trim(); if (message !== "") this.status = message.slice(-512); return undefined;
      } }); this.remote = remote; this.game = null; this.activeDemo = null; this.demos?.manualGame(); this.demos?.refresh();
      this.lastFrame = performance.now();
    }
  }

  private async publishPendingSource(): Promise<void> {
    const action = this.pending; this.pending = null;
    if (action !== null && !this.stopping) await this.launch(action);
    if (!this.stopping) await this.publishDemoIntent();
  }

  private async dispatchApplicationRequest(request: ConfigurationCommandRequest): Promise<void> {
    if (this.stopping) return;
    let origin = request.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "local-seat") {
      const caller = origin, platform = this.client?.platform.current;
      const active = platform?.kind === "world" ? platform.input.locals.map(local => local.player.seat) : this.client?.locals.slice(0, 1).map(local => local.seat) ?? [];
      if (!active.some(seat => seat.id.equals(caller.seat) && seat.client.id.equals(caller.client))) {
        this.print("Ignoring application request from an inactive or retired client seat.\n");
        return;
      }
    }
    if (this.routeCommand(request.name, request.arguments_, request.source)) {
      await this.publishPendingSource();
      return;
    }
    const source = this.game ?? this.remote;
    if (source !== null) await source.executeApplicationRequest(request);
    else this.frontendCommand(request.name, request.arguments_, request.source);
  }

  async step(): Promise<void> {
    if (this.closed || this.stopping) return;
    const now = performance.now(), elapsed = Math.max(4, now - this.lastFrame); this.lastFrame = now;
    this.browser?.poll();
    const graphics = this.graphics, client = this.client;
    if (graphics === null || client === null) throw new Error("Startup frame has no client");
    const source = this.game ?? this.remote;
    if (client.platform.current?.kind === "menu") {
      for (const event of graphics.renderer.window.pollEvents()) graphics.router.handlePlatform(event);
      for (const event of graphics.controllers.pollEvents()) graphics.router.handleController(event);
    } else source?.pumpClientInput();
    const afterDispatch = async (): Promise<void> => {
      await (this.game ?? this.remote)?.flushClientCommands();
      await this.publishPendingSource();
    };
    await afterDispatch();
    const startupSource = this.game ?? this.remote;
    const startupFrame = startupSource === null ? await client.prepared.advanceFrame() : await startupSource.advanceClientStartup();
    await afterDispatch();
    if (!startupFrame && !(this.game ?? this.remote)?.clientCommandsBlocked) await client.prepared.commands.executeScriptsAsync(afterDispatch,
      () => !this.closed && !this.stopping && !(this.game ?? this.remote)?.clientCommandsBlocked);
    await afterDispatch();
    const active = this.game ?? this.remote;
    if (active !== null && !this.stopping) {
      await active.step(active === source ? elapsed : 4);
      if (client.hasPendingSource) {
        const remaining = active instanceof Application ? active.takePendingClientCommands() : null;
        await this.publishPendingSource();
        await remaining?.();
      }
      if (active === (this.game ?? this.remote) && active.finished) {
        if (this.game !== null) this.preferences.values = this.game.frontendSettings;
        await this.returnToFrontend();
      }
    }
    this.frames++;
    if (client.platform.current?.kind !== "menu") return;
    await this.refreshPreferenceBaseline();
    graphics.controllerSettings.update();
    graphics.router.updateCapture();
    if (this.refreshSaves) {
      this.refreshSaves = false; graphics.menu.setStatus("Reading saved games...", true); graphics.draw();
      await this.saves.refresh(); graphics.menu.setStatus(this.saves.list.error ?? "");
    }
    await graphics.imageSettings.refreshDisplay(graphics.renderer);
    this.model.setDisplay({ ...graphics.renderer.window.logicalSize, gamma: graphics.renderer.outputGamma });
    if (this.applyDisplay) {
      await graphics.inputProfile.save(this.preferences.values, this.frontendHistory);
      this.applyDisplay = false;
      await this.preferenceStore?.dump("renderer", `${this.model.options.renderer}\n`);
      await graphics.imageSettings.refreshDisplay(graphics.renderer);
      graphics.menu.setStatus("Renderer selection saved for the next application launch.");
      graphics.menu.resumeDisplayOptions();
    }
    graphics.draw();
  }

  async run(): Promise<void> {
    while (!this.stopping && !this.closed && (this.model.options.frameLimit === null || this.frames < this.model.options.frameLimit)) {
      const started = performance.now();
      await this.step();
      const wait = this.game === null && this.remote === null ? 8 : 4 - (performance.now() - started);
      if (wait > 0) await Bun.sleep(wait);
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.stopping = true;
    try { await this.graphics?.inputProfile.save(this.preferences.values, this.frontendHistory); }
    catch (error) { this.print(`Could not save controls: ${error instanceof Error ? error.message : String(error)}\n`); }
    try { if (this.preferenceStore !== null) await this.preferences.saveAudioBaseline(this.preferenceStore); }
    catch (error) { this.print(`Could not save audio settings: ${error instanceof Error ? error.message : String(error)}\n`); }
    const errors: unknown[] = [];
    this.game?.requestQuit(); this.remote?.requestQuit();
    try { await this.client?.source.current?.retire(); } catch (error) { errors.push(error); }
    try { await this.browser?.close(); } catch (error) { errors.push(error); }
    this.browser = null;
    try { await this.session.close(); } catch (error) { errors.push(error); }
    try { await (this.client?.configuration.current.scripts ?? this.scripts)?.close(); } catch (error) { errors.push(error); }
    this.scripts = null;
    try { await this.imageSettings?.close(); } catch (error) { errors.push(error); }
    this.imageSettings = null;
    this.releaseMenuInput?.(); this.releaseMenuInput = null;
    this.releaseDemos?.(); this.releaseDemos = null;
    for (const release of this.releaseSourceCommands.splice(0)) release();
    this.frontendRouting?.close(); this.frontendRouting = null;
    try { this.graphics?.close(); } catch (error) { errors.push(error); }
    this.graphics = null; this.client = null; this.game = null; this.remote = null;
    if (errors.length !== 0) throw new AggregateError(errors, "Shared client shutdown failed");
  }
}
