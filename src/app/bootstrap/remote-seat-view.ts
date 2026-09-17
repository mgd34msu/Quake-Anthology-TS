import type { LoadedApplicationContent } from "./content.ts";
import type { CommandContext } from "../../contracts/common.ts";
import type { Rect } from "../../contracts/render.ts";
import type { SimulationOutput } from "../../contracts/session.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { Q3ClientConnection } from "../../network/q3/client.ts";
import type { Q3BrowserView } from "../../network/q3/browser-view.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio, ApplicationAudioSeatEvents } from "./audio.ts";
import { ApplicationEffects } from "./effects.ts";
import type { ApplicationImageSettings } from "./image-settings.ts";
import type { ApplicationInput, LocalInput } from "./input.ts";
import type { ApplicationKeyProfile } from "./keys.ts";
import type { RemoteSeatSource } from "./remote-seat-source.ts";
import { Q3RemotePresentation } from "./network/remote-q3.ts";
import { Q3ClientNetwork } from "./network/q3-client.ts";
import type { ApplicationOptions } from "./options.ts";
import { WorldSeatPresentation } from "./presentation.ts";
import { ApplicationQ3Client } from "./q3-client.ts";
import type { NativeRenderer } from "./renderer.ts";
import { ApplicationSeatUi } from "./ui.ts";
import type { ApplicationViewSettings } from "./view-settings.ts";

export interface RemoteSeatViewOptions {
  readonly local: LocalInput;
  readonly controls: ApplicationInput;
  readonly source: RemoteSeatSource;
  readonly cvars: CvarRegistry;
  readonly assets: ApplicationAssets;
  readonly content: LoadedApplicationContent;
  readonly art: NativeUiArt;
  readonly font: TextFontSelection;
  readonly audio: ApplicationAudio;
  readonly renderer: NativeRenderer;
  readonly images: ApplicationImageSettings;
  readonly view: ApplicationViewSettings;
  readonly options: ApplicationOptions;
  readonly q3: { readonly connection: Q3ClientConnection; readonly browser: Q3BrowserView; readonly keys: ApplicationKeyProfile } | null;
  readonly viewport: () => Rect;
  readonly count: () => number;
  readonly index: () => number;
  readonly now: () => number;
  readonly assertCurrent: () => void;
  readonly quit: () => undefined;
  readonly execute: (name: string, args: readonly string[]) => undefined;
  readonly print: (text: string) => void;
}

/** A channel's view and PVS effects borrow the retained frontend assets and output. */
export class RemoteSeatView {
  private closed = false;
  private readonly reportedEffects = new Set<string>();
  private constructor(readonly presentation: WorldSeatPresentation, readonly effects: ApplicationEffects,
    private readonly options: RemoteSeatViewOptions, readonly assets: ApplicationAssets, private readonly ownsAssets: boolean) {}

  static async prepare(options: RemoteSeatViewOptions): Promise<RemoteSeatView> {
    const { local, controls, source, audio, renderer } = options;
    const ownsAssets = options.content !== options.assets.content;
    const assets = ownsAssets ? new ApplicationAssets(options.content,renderer.owner,undefined,{imageRegistry:renderer.images,imagePolicy:options.images.policy,modelPolicy:options.images.modelPolicy}) : options.assets;
    const remote = source.remote, seat = local.player.seat;
    const context: CommandContext = { session: seat.id.session, origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } };
    const effects = new ApplicationEffects(assets, remote.scene, actor => remote.isPlayer(actor), options.options.seed);
    let ui: ApplicationSeatUi | null = null, q3: ApplicationQ3Client | null = null;
    try {
      if(ownsAssets)await assets.loadWorld();
      const font=ownsAssets ? await assets.loadConsoleFont() : options.font;
      const typography = await assets.loadMenuTypography(); options.assertCurrent();
      for (const failure of await effects.preloadTransientResources()) options.print(`Optional effect preload skipped: ${failure.content}/${failure.path}: ${failure.error}\n`);
      options.assertCurrent();
      ui = new ApplicationSeatUi(local, options.art, controls, operation => renderer.mutateWindow(operation), remote, font, audio,
        options.quit, options.execute, typography, undefined, undefined, undefined, options.view.binding());
      if (remote instanceof Q3RemotePresentation) {
        const guest = options.q3;
        if (guest === null) throw new Error("Q3 remote seat requires its admitted guest owners");
        const command = guest.connection.commands.read(guest.connection.commands.currentNumber);
        local.builder.setViewAngles(command === null ? { x: 0, y: 0, z: 0 } : {
          x: (command.angles[0] << 16 >> 16) * (360 / 65536),
          y: (command.angles[1] << 16 >> 16) * (360 / 65536),
          z: (command.angles[2] << 16 >> 16) * (360 / 65536) });
        q3 = await ApplicationQ3Client.create({
          kind: "qvm", source: remote.cgameSource, connection: guest.connection,
          keys: guest.keys, cvars: options.cvars, timeCvars: options.cvars,
          get splitScreen() { return options.count() > 1; },
          saveFontData: () => (controls.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0,
          assertCurrent: options.assertCurrent, commandBuffer: controls.guestCommands,
          guestCvars: controls.guestCvars(seat.id), guestInput: controls.guestInput(seat.id),
          commandRegistration: controls.clientCommandRegistration(seat.id),
          renderer, browser: guest.browser, assets, queries: remote.scene, local, audio,
          viewport: options.viewport, now: options.now,
          clientState: () => ({ phase: source.network.phase === "active" ? 8 : source.network.phase === "loading" ? 6 : 5,
            connectPacketCount: source.network instanceof Q3ClientNetwork ? source.network.connectPacketCount : 0,
            clientNumber: guest.connection.clientNumber,
            serverName: options.options.network.kind === "q3-client" ? options.options.network.remote : "", message: "" }),
          commands: {
            reliable: text => controls.enqueueClientReliable(text, context, command => source.network.command(command)),
            console: text => controls.enqueueClientCommand(text, {session:context.session, origin:{kind:"script",name:"q3-cgame",caller:context.origin}}),
            print: text => controls.print(text, context),
          },
        });
        options.assertCurrent();
      }
      const presentation = new WorldSeatPresentation(local, assets, renderer, remote, options.count(), font,
        null, ui, effects, q3, null, () => options.images.cvars.variableValue("gl_debug_distfrac"),
        () => options.view.fieldOfView, null, () => options.images.cvars.variableValue("con_scale"));
      presentation.publishLayout(options.index(),options.count());
      seat.validatePresentation(presentation);
      return new RemoteSeatView(presentation, effects, options,assets,ownsAssets);
    } catch (error) {
      const failures: unknown[] = [error];
      for (const close of [() => q3?.close(), () => ui?.close(), () => effects.close(), () => {if(ownsAssets)assets.close();}]) try { close(); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length !== 1) throw new AggregateError(failures, "Remote seat view preparation failed");
      throw error;
    }
  }

  publish(index: number, count: number): void {
    this.options.assertCurrent();
    this.presentation.publishLayout(index, count);
    const seat = this.presentation.local.player.seat;
    seat.attachPresentation(this.presentation, () => this.presentation.close());
  }

  async prepareFrame(output: SimulationOutput): Promise<ApplicationAudioSeatEvents> {
    if (this.closed) throw new Error("Remote seat view is closed");
    const remote = this.options.source.remote, events = remote.drainPresentationEvents();
    const models = remote.presentations(), characters = remote.characterViews();
    this.effects.receive(events);
    if (!(remote instanceof Q3RemotePresentation)) await this.effects.prepare(output.snapshot, models, characters);
    for(const effect of this.effects.drainUnhandled()){const key=`${effect.source.content}:${effect.reason}`;if(!this.reportedEffects.has(key)){this.reportedEffects.add(key);this.options.print(`Player ${this.presentation.local.player.seat.id.index+1}: unresolved ${effect.source.kind} effect: ${effect.reason}\n`);}}
    this.presentation.sourceEvents(events);
    await this.presentation.prepare(output.snapshot, models, characters);
    return { seat: this.presentation.local.player.seat.id, snapshot: output.snapshot, events, scene: remote.scene, music: false,
      effectSounds: this.effects.drainSounds() };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    try { await this.presentation.q3Client?.shutdown(); } catch (error) { errors.push(error); }
    const seat = this.presentation.local.player.seat;
    try { if (seat.presentation === this.presentation) seat.clearPresentation(); else this.presentation.close(); } catch (error) { errors.push(error); }
    try { this.effects.close(); } catch (error) { errors.push(error); }
    if(this.ownsAssets)try{this.assets.close();}catch(error){errors.push(error);}
    if (errors.length !== 0) throw new AggregateError(errors, "Remote seat view retirement failed");
  }
}
