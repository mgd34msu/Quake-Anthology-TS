import { readSdlClipboard } from "../../platform/sdl.ts";
import { serviceLoading } from "./loading.ts";
import { ControllerSettings } from "./controller-settings.ts";
import { StartupServerBrowser } from "./server-browser.ts";
import type { BrowserConnection } from "./server-browser.ts";
import { ConfigStore } from "../../settings/config.ts";
import { RemoteApplication } from "./remote-application.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../../contracts/common.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SeatId } from "../../contracts/identity.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { PresentationSelection, ProviderReference } from "../../contracts/content.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { SeatInput } from "../../input/seat.ts";
import { InputRouter } from "../../input/router.ts";
import { SdlControllers } from "../../platform/controller.ts";
import { readSaveImage } from "../../persistence/save-image.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import { Application } from "./application.ts";
import type { ApplicationHost } from "./application.ts";
import type { ApplicationOptions } from "./options.ts";
import { NativeRenderer } from "./renderer.ts";
import { readMenuArt } from "./menu-art.ts";
import { loadMenuFont, loadMenuTypography } from "./menu-font.ts";
import { StartupMenu } from "./startup-menu.ts";
import { createStartupSelection } from "./startup-selection.ts";
import type { StartupSelectionModel } from "./startup-selection.ts";
import { FrontendPreferences } from "./frontend-preferences.ts";
import { movementDialect } from "./input.ts";
import { StartupSaves } from "./startup-saves.ts";
import { savedSimulationSettings } from "./simulation/index.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { bindNativeVideoSettings } from "../../ui/settings/services.ts";

type StartupAction = { readonly kind: "connect"; readonly connection: BrowserConnection } | { readonly kind: "play" } | { readonly kind: "load"; readonly path: string };
type StartupDisplay = Pick<ApplicationOptions, "renderer" | "gamma" | "width" | "height" | "hidden">;
interface StartupGraphics {
  readonly imageSettings: ApplicationImageSettings;
  readonly display: StartupDisplay;
  readonly renderer: NativeRenderer;
  readonly menu: StartupMenu;
  readonly router: InputRouter;
  readonly controllers: SdlControllers;
  readonly controllerSettings: ControllerSettings;
  draw(): void;
  close(): void;
}

/** The front end has a native window and input seat, but no gameplay world or player. */
export class StartupApplication {
  private graphics: StartupGraphics | null = null;
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

  private constructor(readonly model: StartupSelectionModel, private readonly host: ApplicationHost, saveDirectory: string) {
    this.preferences = new FrontendPreferences(() => movementDialect(model.options));
    this.saves = new StartupSaves(model.catalog, saveDirectory);
  }

  static async open(options: ApplicationOptions, host: ApplicationHost, saveDirectory = join(homedir(), ".local", "share", "quake-typescript", "saves")): Promise<StartupApplication> {
    const application = new StartupApplication(await createStartupSelection(options), host, saveDirectory);
    try { application.browser = await StartupServerBrowser.open(new ConfigStore(join(saveDirectory, "..", "settings"))); await application.openGraphics(); return application; }
    catch (error) { await application.close(); throw error; }
  }

  private async openGraphics(display: StartupDisplay = this.model.options): Promise<StartupGraphics> {
    const options = { ...this.model.options, ...display }, identity = createIdentityOwner("startup-menu"), seat = identity.seat(0), client = identity.client(0, 0);
    const owner = { identity: Symbol("startup renderer"), session: identity.session, generation: 0 };
    const images = new SceneImageRegistry(owner);
    const installed = this.model.catalog.products.filter(product => product.availability.kind === "installed");
    const product = installed.find(product => product.expectation.id === options.product) ?? installed[0];
    if (product === undefined) throw new Error(`No installed game data found in ${options.corpusRoot}; a game charset is required for the startup menu`);
    const mounts = await this.model.catalog.mountsFor(product.id);
    const mounted = await openMountPlan({ id: createMountPlanId("startup", "font"), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    let font: Awaited<ReturnType<typeof loadMenuFont>> | null = null;
    let art: Awaited<ReturnType<typeof loadNativeUiArt>> | null = null;
    let typography: Awaited<ReturnType<typeof loadMenuTypography>> | null = null;
    let renderer: NativeRenderer | null = null, controllers: SdlControllers | null = null, router: InputRouter | null = null, menu: StartupMenu | null = null;
    try {
      const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client } };
      const imageSettings = await ApplicationImageSettings.open({ context, dialect: "q3", gamma: options.gamma, ...(options.displayOverrides === undefined ? {} : { displayOverrides: options.displayOverrides }), print: this.host.print,
        ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }) });
      font = await loadMenuFont({ catalog: this.model.catalog, mounts: mounted, family: product.expectation.family, rerelease: product.expectation.edition === "rerelease", images, imagePolicy: imageSettings.policy });
      typography = await loadMenuTypography(this.model.catalog, images, font.font.classic, imageSettings.policy);
      const fontSource = font.font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Startup font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, images, readMenuArt);
      renderer = NativeRenderer.open(options, owner);
      await imageSettings.refreshDisplay(renderer);
      controllers = SdlControllers.open();
      const commands = new CommandBuffer({ dialect: "q3", context });
      menu = new StartupMenu({ ...(this.host.llm === undefined ? {} : { llm: this.host.llm }),
        clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); }, seat, model: this.model, art, font: typography.body, titleFont: typography.title, now: () => performance.now(),
        ...(this.browser === null ? {} : { browser: this.browser, connect: (connection: BrowserConnection) => { this.pending = { kind: "connect", connection }; } }),
        play: () => { this.pending = { kind: "play" }; }, load: id => {
          try { this.pending = { kind: "load", path: this.saves.path(id) }; }
          catch (error) { this.status = error instanceof Error ? error.message : String(error); this.graphics?.menu.setStatus(this.status); }
        },
        quit: () => this.requestQuit(), settings: [...this.preferences.bindings(), ...bindNativeVideoSettings(renderer.window, imageSettings.cvars, message => this.graphics?.menu.setStatus(message))], applyDisplay: () => { this.applyDisplay = true; }, saves: () => this.saves.list, refreshSaves: () => { this.refreshSaves = true; } });
      menu.setStatus(this.status);
      const activeMenu = menu;
      const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: event => activeMenu.input(event) });
      input.setFocus({ kind: "menu", menu: activeMenu.controller.activeMenu ?? "menu:startup:main", control: null }, performance.now());
      const native = renderer;
      router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }], keyboardSeat: seat, controllers,
        now: () => performance.now(), ticks: () => native.window.ticks, subframe: false,
        unhandled: event => { if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit(); } });
      router.attachWindow(native.window);
      const controllerSettings = new ControllerSettings(router, [seat], () => controllers?.devices ?? [], new ConfigStore(join(this.saves.directory, "..", "settings")), this.host.print);
      controllerSettings.update(); activeMenu.bindGyro(controllerSettings.ui(seat));
      const builder = new SceneFrameBuilder(images), activeFont = font, activeTypography = typography, activeArt = art, activeRouter = router, pads = controllers;
      const provider: ProviderReference = { provider: `${product.expectation.family}:official`, content: product.id };
      const presentation: PresentationSelection = { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider };
      this.graphics = { imageSettings, display: { renderer: options.renderer, gamma: options.gamma, width: options.width, height: options.height, hidden: options.hidden }, renderer: native, menu: activeMenu, router: activeRouter, controllers: pads, controllerSettings,
        draw: () => {
          const viewport = { x: 0, y: 0, ...native.window.drawableSize };
          builder.begin("back", true);
          activeMenu.draw({ binding: { seat, client, viewport, safeArea: viewport, hudScale: 1, presentation }, timeMilliseconds: performance.now() },
            command => builder.command(command), () => { throw new Error("Startup charset unexpectedly requested a material draw"); });
          native.execute(builder.finish());
        },
        close: () => { controllerSettings.close(); activeRouter.close(); pads.close(); activeMenu.close(); activeArt.close(); activeTypography.close(); activeFont.close(); images.close(); native.close(); mounted.close(); } };
      return this.graphics;
    } catch (error) {
      router?.close(); controllers?.close(); menu?.close(); art?.close(); typography?.close(); font?.close(); images.close(); renderer?.close(); mounted.close();
      throw error;
    }
  }

  get activeGame(): Application | null { return this.game; }
  get inputSeat(): SeatId | null { return this.graphics?.menu.controller.seat ?? null; }
  input(event: SeatInputEvent): boolean { return this.graphics?.menu.input(event) ?? false; }
  requestQuit(): void { this.stopping = true; this.game?.requestQuit(); this.remote?.requestQuit(); }
  readPixels(): Uint8Array { if (this.graphics === null) throw new Error("Startup menu is not visible"); return this.graphics.renderer.readPixels(); }
  captureNextFrame(): Promise<Uint8Array> { if (this.graphics === null) return Promise.reject(new Error("Startup menu is not visible")); return this.graphics.renderer.captureNextFrame(); }

  private async launch(action: StartupAction): Promise<void> {
    this.graphics?.menu.setStatus("Loading...", true);
    this.graphics?.draw();
    try {
      if (action.kind === "connect") { await this.connect(action.connection); return; }
      const loading = this.graphics;
      loading?.controllerSettings.close(); loading?.router.close(); loading?.controllers.close();
      const game = await serviceLoading(async () => {
        loading?.menu.setStatus("Loading map...", true);
        const selected = action.kind === "play" ? await this.model.resolve() : await (async () => {
          const image = await readSaveImage(action.path), settings = savedSimulationSettings(image);
          return { recipe: image.recipe, options: { ...this.model.options, skill: settings.skill, mode: settings.mode, seed: settings.seed,
            seats: Math.min(this.model.options.seats, Math.max(1, settings.clientSlots.length)) } };
        })();
        loading?.menu.setStatus("Preparing world...", true);
        const game = await Application.open(selected.options, { ...this.host, saveDirectory: this.saves.directory, loading: { deferWindowVisibility: true,
          stage: message => loading?.menu.setStatus(message, true) } }, selected.recipe, this.preferences.values);
        this.game = game;
        try {
          if (action.kind === "load") await game.loadGame(action.path);
          loading?.menu.setStatus("Starting game...", true);
          if (!this.stopping) { const started = performance.now(); await Bun.sleep(4); await game.step(performance.now() - started); }
          return game;
        } catch (error) { this.game = null; await game.close(); throw error; }
      }, () => {
        if (loading === null) return;
        for (const event of loading.renderer.window.pollEvents()) {
          if (event.kind === "quit" || event.kind === "window" && event.event === 14) { this.requestQuit(); loading.renderer.window.setVisible(false); }
        }
        loading.draw();
      });
      this.graphics?.close(); this.graphics = null;
      if (!this.stopping) game.window?.setVisible(!game.options.hidden);
      try {
        if (this.stopping) game.requestQuit();
        await game.run();
      } finally { this.preferences.values = game.frontendSettings; this.game = null; await game.close(); }
      this.status = "";
    } catch (error) {
      if (this.game !== null) { const game = this.game; this.game = null; await game.close(); }
      this.graphics?.close(); this.graphics = null;
      this.status = error instanceof Error ? error.message : String(error);
      this.host.print(`${this.status}\n`);
    }
    if (!this.stopping) await this.openGraphics();
  }

  private async connect(connection: BrowserConnection): Promise<void> {
    const family = connection.protocol;
    const options: ApplicationOptions = { ...this.model.options, product: family === "q1" ? "q1-classic-id1" : family === "q2" ? "q2-classic-baseq2" : "q3-baseq3",
      map: family === "q1" ? "maps/e1m1.bsp" : family === "q2" ? "maps/base1.bsp" : "maps/q3dm1.bsp", movement: family, character: family,
      characterModel: family === "q1" ? "player" : family === "q2" ? "male" : "sarge", seats: 1, dedicated: false, rules: "standard",
      network: { kind: family === "q1" ? "q1-client" : family === "q2" ? "q2-client" : "q3-client", remote: connection.remote } };
    this.graphics?.close(); this.graphics = null;
    try {
      const remote = await RemoteApplication.open(options, { ...this.host, print: text => {
        this.host.print(text); const message = text.trim(); if (message !== "") this.status = message.slice(-512); return undefined;
      } }); this.remote = remote;
      try { if (this.stopping) remote.requestQuit(); await remote.run(); }
      finally { this.remote = null; await remote.close(); }
    } finally { if (!this.stopping && !this.closed) { const graphics = await this.openGraphics(); graphics.menu.resumeServerBrowser(); } }
  }

  async step(): Promise<void> {
    if (this.closed || this.stopping) return;
    this.browser?.poll();
    const graphics = this.graphics;
    if (graphics === null) throw new Error("Startup frame has no renderer");
    for (const event of graphics.renderer.window.pollEvents()) graphics.router.handlePlatform(event);
    for (const event of graphics.controllers.pollEvents()) graphics.router.handleController(event);
    graphics.controllerSettings.update();
    graphics.router.updateCapture();
    if (this.refreshSaves) {
      this.refreshSaves = false; graphics.menu.setStatus("Reading saved games...", true); graphics.draw();
      await this.saves.refresh(); graphics.menu.setStatus(this.saves.list.error ?? "");
    }
    await graphics.imageSettings.refreshDisplay(graphics.renderer);
    this.model.setDisplay({ ...graphics.renderer.window.logicalSize, gamma: graphics.renderer.outputGamma });
    let frameGraphics = graphics;
    if (this.applyDisplay) {
      this.applyDisplay = false; graphics.close(); this.graphics = null;
      let reopened: StartupGraphics;
      try { reopened = await this.openGraphics(); this.status = ""; }
      catch (error) {
        this.status = error instanceof Error ? error.message : String(error);
        reopened = await this.openGraphics(graphics.display);
      }
      reopened.menu.resumeDisplayOptions(); reopened.menu.setStatus(this.status); frameGraphics = reopened;
    }
    frameGraphics.draw(); this.frames++;
    const action = this.pending; this.pending = null;
    if (action !== null && !this.stopping) await this.launch(action);
  }

  async run(): Promise<void> {
    while (!this.stopping && !this.closed && (this.model.options.frameLimit === null || this.frames < this.model.options.frameLimit)) {
      await this.step(); await Bun.sleep(8);
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.stopping = true;
    this.game?.requestQuit(); this.remote?.requestQuit(); await this.browser?.close(); this.browser = null; this.graphics?.close(); this.graphics = null;
  }
}
