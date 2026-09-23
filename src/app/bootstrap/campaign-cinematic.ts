import type { SeatId } from "../../contracts/identity.ts";
import type { Rect, RenderCommand } from "../../contracts/render.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { cinematicAudio, type CinematicMixer } from "../../media/audio.ts";
import { CinematicPlayback, cinematicBytes } from "../../media/playback.ts";
import { cinematicDimensions, FullscreenCinematic } from "../../media/presentation.ts";
import { cinematicPcx } from "../../media/still.ts";
import type { CinematicAudio, CinematicStatus, CinematicTimeline } from "../../media/types.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { NativeRenderer } from "./renderer.ts";
let nextCinematic = 0;
type CinematicRenderer = Pick<NativeRenderer, "execute"> & { readonly window: Pick<NativeRenderer["window"], "drawableSize"> };
type CinematicOutput = { readonly engine: CinematicMixer & Pick<ApplicationAudio["engine"], "stopAll" | "pump"> };

export interface ScreenCinematicRequest {
  readonly name: string;
  readonly loop: boolean;
  readonly hold: boolean;
  readonly silent: boolean;
}
export interface ScreenCinematicCaptions {
  prepare(source: string): Promise<void>;
  commands(timeline: CinematicTimeline, viewport: Rect): readonly RenderCommand[];
}
/** One fullscreen owner serves campaign, remote server and standalone movie requests. */
export class CampaignCinematic {
  private state: "prepared" | "active" | "closed" = "prepared";
  private constructor(private readonly movie: FullscreenCinematic, private readonly renderer: CinematicRenderer,
    private readonly assets: Pick<ApplicationAssets, "images">, private readonly audio: CinematicOutput, private readonly clock: { milliseconds: number },
    private readonly captions: ScreenCinematicCaptions | null, private readonly current: () => boolean, private readonly startAudio: () => void) {}
  static async prepare(request: ScreenCinematicRequest, content: { readonly mounts: Pick<MountedContent, "open"> }, assets: Pick<ApplicationAssets, "images">,
    audio: CinematicOutput, renderer: CinematicRenderer, seat: SeatId, current: () => boolean, captions: ScreenCinematicCaptions | null = null): Promise<CampaignCinematic> {
    const assertCurrent = (): void => { if (!current()) throw new Error("Cinematic preparation belongs to a retired request"); };
    assertCurrent();
    const selected = /\.[^/]+$/.test(request.name) ? request.name : `${request.name}.roq`;
    if (selected.startsWith("/") || selected.includes("\\") || selected.includes("\0") || selected.split("/").some(part => part === ".." || part === "." || part.length === 0)) throw new Error("Invalid cinematic resource path");
    let path = selected.startsWith("video/") || selected.startsWith("pics/") ? selected : `${/\.pcx$/i.test(selected) ? "pics" : "video"}/${selected}`;
    let resource = await content.mounts.open(path); assertCurrent();
    if (resource === null && /\.cin$/i.test(path)) { path = path.replace(/\.cin$/i, ".ogv"); resource = await content.mounts.open(path); assertCurrent(); }
    if (resource === null) throw new Error(`Missing campaign cinematic: ${path}`);
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (extension !== "cin" && extension !== "roq" && extension !== "ogv" && extension !== "pcx") throw new Error(`Unsupported cinematic format: ${extension}`);
    const source = extension === "pcx" ? cinematicPcx(resource.bytes, path) : cinematicBytes(extension, resource.bytes, path);
    const dimensions = cinematicDimensions(source), lane = `campaign-cinematic:${++nextCinematic}`, stream = cinematicAudio(audio.engine, lane);
    const clock = { milliseconds: 0 }, initialAudio: CinematicAudio[] = [];
    let ready = false;
    const playback = new CinematicPlayback(source, { target: { kind: "seat", seat }, clock: { sample: () => clock.milliseconds },
      loop: request.loop, hold: request.hold, silent: request.silent,
      onAudio: block => { if (ready) stream.onAudio(block, { kind: "material", id: lane }); else initialAudio.push(block); },
      onAudioReset: target => { if (ready) stream.onAudioReset(target); },
      onAudioPause: (paused, target) => { if (ready) stream.onAudioPause(paused, target); }, onComplete: () => undefined });
    try {
      await captions?.prepare(path); assertCurrent();
      const image = assets.images.allocate(dimensions.width, dimensions.height, { kind: "resource", resource: resource.reference });
      const movie = new FullscreenCinematic(playback, image, (width, height, origin) => assets.images.allocate(width, height, origin));
      return new CampaignCinematic(movie, renderer, assets, audio, clock, captions, current, () => {
        audio.engine.stopAll(); ready = true;
        for (const block of initialAudio) stream.onAudio(block, { kind: "material", id: lane });
        initialAudio.length = 0;
        if (playback.status === "paused") stream.onAudioPause(true, playback.target);
      });
    } catch (error) { playback.close(); throw error; }
  }
  activate(): void {
    if (this.state === "closed" || !this.current()) throw new Error("Cinematic activation belongs to a retired request");
    if (this.state === "active") return;
    this.state = "active";
    if (this.movie.playback.status !== "ended" && this.movie.playback.status !== "stopped") this.startAudio();
  }
  get timeline(): CinematicTimeline { return this.movie.playback.timeline; }
  get status(): CinematicStatus { return this.state === "closed" || !this.current() ? "stopped" : this.movie.playback.status; }
  pause(paused: boolean): void { if (this.state !== "closed" && this.current()) this.movie.playback.pause(paused); }
  skip(): void { if (this.state !== "closed" && this.current()) this.movie.playback.skip(); }
  input(event: SeatInputEvent): boolean {
    if ((event.kind === "key" && event.down && !event.repeat || event.kind === "mouse-button" && event.down
      || event.kind === "controller-button" && event.down) && this.movie.playback.playbackTimeMilliseconds > 1000) this.skip();
    // A still image has a held zero clock; source PCX pictures still accept a deliberate skip.
    else if (this.status === "held" && this.clock.milliseconds > 1000 && (event.kind === "key" && event.down && !event.repeat
      || event.kind === "mouse-button" && event.down || event.kind === "controller-button" && event.down)) this.skip();
    return true;
  }
  frame(elapsedMilliseconds: number, sequence: number, consoleOpen = false, menuOpen = false): boolean {
    if (this.state !== "active" || !this.current()) throw new Error("Fullscreen cinematic is not the active request");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) throw new RangeError("Invalid cinematic frame interval");
    this.clock.milliseconds += elapsedMilliseconds;
    const size = this.renderer.window.drawableSize, viewport = { x: 0, y: 0, width: size.width, height: size.height };
    const draw = this.movie.prepare(viewport, consoleOpen ? "console" : menuOpen ? "menu" : "game");
    if (!consoleOpen && !menuOpen) {
      const captions = draw.blank ? [] : this.captions?.commands(this.timeline, viewport) ?? [];
      this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, ...draw.commands, ...captions, { kind: "swap-buffers" }] });
      draw.complete();
    }
    this.audio.engine.pump();
    return this.status === "ended";
  }
  close(sequence: number): void {
    if (this.state === "closed") return;
    this.state = "closed";
    const operation = this.movie.close();
    if (operation !== null) this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "image-resource", operation }] });
  }
}
