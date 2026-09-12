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

type StartupAction = { readonly kind: "play" } | { readonly kind: "load"; readonly path: string };
type StartupDisplay = Pick<ApplicationOptions, "renderer" | "gamma" | "width" | "height" | "hidden">;
interface StartupGraphics {
  readonly display: StartupDisplay;
  readonly renderer: NativeRenderer;
  readonly menu: StartupMenu;
  readonly router: InputRouter;
  readonly controllers: SdlControllers;
  draw(): void;
  close(): void;
}

/** The front end has a native window and input seat, but no gameplay world or player. */
export class StartupApplication {
  private graphics: StartupGraphics | null = null;
  private game: Application | null = null;
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
    try { await application.openGraphics(); return application; }
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
      font = await loadMenuFont({ mounts: mounted, family: product.expectation.family, rerelease: product.expectation.edition === "rerelease", images });
      typography = await loadMenuTypography(this.model.catalog, images, font.font.classic);
      const fontSource = font.font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Startup font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, images, readMenuArt);
      renderer = NativeRenderer.open(options, owner);
      controllers = SdlControllers.open();
      const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client } };
      const commands = new CommandBuffer({ dialect: "q3", context });
      menu = new StartupMenu({ seat, model: this.model, art, font: typography.body, titleFont: typography.title, now: () => performance.now(),
        play: () => { this.pending = { kind: "play" }; }, load: id => {
          try { this.pending = { kind: "load", path: this.saves.path(id) }; }
          catch (error) { this.status = error instanceof Error ? error.message : String(error); this.graphics?.menu.setStatus(this.status); }
        },
        quit: () => this.requestQuit(), settings: this.preferences.bindings(), applyDisplay: () => { this.applyDisplay = true; }, saves: () => this.saves.list, refreshSaves: () => { this.refreshSaves = true; } });
      menu.setStatus(this.status);
      const activeMenu = menu;
      const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: event => activeMenu.input(event) });
      input.setFocus({ kind: "menu", menu: activeMenu.controller.activeMenu ?? "menu:startup:main", control: null }, performance.now());
      const native = renderer;
      router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }], keyboardSeat: seat, controllers,
        now: () => performance.now(), ticks: () => native.window.ticks, subframe: false,
        unhandled: event => { if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit(); } });
      router.attachWindow(native.window);
      const builder = new SceneFrameBuilder(images), activeFont = font, activeTypography = typography, activeArt = art, activeRouter = router, pads = controllers;
      const provider: ProviderReference = { provider: `${product.expectation.family}:official`, content: product.id };
      const presentation: PresentationSelection = { environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider };
      this.graphics = { display: { renderer: options.renderer, gamma: options.gamma, width: options.width, height: options.height, hidden: options.hidden }, renderer: native, menu: activeMenu, router: activeRouter, controllers: pads,
        draw: () => {
          const viewport = { x: 0, y: 0, ...native.window.drawableSize };
          builder.begin("back", true);
          activeMenu.draw({ binding: { seat, client, viewport, safeArea: viewport, hudScale: 1, presentation }, timeMilliseconds: performance.now() },
            command => builder.command(command), () => { throw new Error("Startup charset unexpectedly requested a material draw"); });
          native.execute(builder.finish());
        },
        close: () => { activeRouter.close(); pads.close(); activeMenu.close(); activeArt.close(); activeTypography.close(); activeFont.close(); images.close(); native.close(); mounted.close(); } };
      return this.graphics;
    } catch (error) {
      router?.close(); controllers?.close(); menu?.close(); art?.close(); typography?.close(); font?.close(); images.close(); renderer?.close(); mounted.close();
      throw error;
    }
  }

  get activeGame(): Application | null { return this.game; }
  get inputSeat(): SeatId | null { return this.graphics?.menu.controller.seat ?? null; }
  input(event: SeatInputEvent): boolean { return this.graphics?.menu.input(event) ?? false; }
  requestQuit(): void { this.stopping = true; this.game?.requestQuit(); }
  readPixels(): Uint8Array { if (this.graphics === null) throw new Error("Startup menu is not visible"); return this.graphics.renderer.readPixels(); }
  captureNextFrame(): Promise<Uint8Array> { if (this.graphics === null) return Promise.reject(new Error("Startup menu is not visible")); return this.graphics.renderer.captureNextFrame(); }

  private async launch(action: StartupAction): Promise<void> {
    this.graphics?.menu.setStatus("Loading...", true);
    this.graphics?.draw();
    try {
      const selected = action.kind === "play" ? await this.model.resolve() : await (async () => {
        const image = await readSaveImage(action.path), settings = savedSimulationSettings(image);
        return { recipe: image.recipe, options: { ...this.model.options, skill: settings.skill, mode: settings.mode, seed: settings.seed,
          seats: Math.min(this.model.options.seats, Math.max(1, settings.clientSlots.length)) } };
      })();
      this.graphics?.close(); this.graphics = null;
      const game = await Application.open(selected.options, this.host, selected.recipe, this.preferences.values);
      this.game = game;
      try {
        if (action.kind === "load") await game.loadGame(action.path);
        if (this.stopping) game.requestQuit();
        await game.run();
      } finally { this.preferences.values = game.frontendSettings; this.game = null; await game.close(); }
      this.status = "";
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      this.host.print(`${this.status}\n`);
    }
    if (!this.stopping) {
      if (this.graphics === null) await this.openGraphics();
      else this.graphics.menu.setStatus(this.status);
    }
  }

  async step(): Promise<void> {
    if (this.closed || this.stopping) return;
    const graphics = this.graphics;
    if (graphics === null) throw new Error("Startup frame has no renderer");
    for (const event of graphics.renderer.window.pollEvents()) graphics.router.handlePlatform(event);
    for (const event of graphics.controllers.pollEvents()) graphics.router.handleController(event);
    graphics.router.updateCapture();
    if (this.refreshSaves) {
      this.refreshSaves = false; graphics.menu.setStatus("Reading saved games...", true); graphics.draw();
      await this.saves.refresh(); graphics.menu.setStatus(this.saves.list.error ?? "");
    }
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
    this.game?.requestQuit(); this.graphics?.close(); this.graphics = null;
  }
}
