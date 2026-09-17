import type { SeatId } from "../../contracts/identity.ts";
import type { Rect, RenderCommand } from "../../contracts/render.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { cinematicAudio } from "../../media/audio.ts";
import { CinematicPlayback, cinematicBytes } from "../../media/playback.ts";
import { cinematicDimensions, FullscreenCinematic } from "../../media/presentation.ts";
import { cinematicPcx } from "../../media/still.ts";
import type { CinematicAudio, CinematicStatus, CinematicTimeline } from "../../media/types.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { Q2TravelTarget } from "./q2-travel.ts";

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
  private closed = false;
  private pausedAudio = false;
  private constructor(private readonly movie: FullscreenCinematic, private readonly renderer: NativeRenderer,
    private readonly assets: Pick<ApplicationAssets, "images">, private readonly audio: Pick<ApplicationAudio, "engine">, private readonly clock: { milliseconds: number },
    private readonly captions: ScreenCinematicCaptions | null) {}
  static async open(target: Q2TravelTarget, content: Pick<LoadedApplicationContent, "mounts">, assets: Pick<ApplicationAssets, "images">,
    audio: Pick<ApplicationAudio, "engine">, renderer: NativeRenderer, seat: SeatId, captions: ScreenCinematicCaptions | null = null): Promise<CampaignCinematic> {
    if (target.kind !== "cinematic" && target.kind !== "picture") throw new Error(`Unsupported campaign media: ${target.name}`);
    return this.openMedia({ name: target.name, loop: false, hold: false, silent: false }, content, assets, audio, renderer, seat, captions);
  }
  static async openMedia(request: ScreenCinematicRequest, content: Pick<LoadedApplicationContent, "mounts">, assets: Pick<ApplicationAssets, "images">,
    audio: Pick<ApplicationAudio, "engine">, renderer: NativeRenderer, seat: SeatId, captions: ScreenCinematicCaptions | null = null): Promise<CampaignCinematic> {
    const selected = /\.[^/]+$/.test(request.name) ? request.name : `${request.name}.roq`;
    if (selected.startsWith("/") || selected.includes("\\") || selected.includes("\0") || selected.split("/").some(part => part === ".." || part === "." || part.length === 0)) throw new Error("Invalid cinematic resource path");
    let path = selected.startsWith("video/") || selected.startsWith("pics/") ? selected : `${/\.pcx$/i.test(selected) ? "pics" : "video"}/${selected}`;
    let resource = await content.mounts.open(path);
    if (resource === null && /\.cin$/i.test(path)) { path = path.replace(/\.cin$/i, ".ogv"); resource = await content.mounts.open(path); }
    if (resource === null) throw new Error(`Missing campaign cinematic: ${path}`);
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (extension !== "cin" && extension !== "roq" && extension !== "ogv" && extension !== "pcx") throw new Error(`Unsupported cinematic format: ${extension}`);
    const source = extension === "pcx" ? cinematicPcx(resource.bytes, path) : cinematicBytes(extension, resource.bytes, path);
    const dimensions = cinematicDimensions(source), stream = cinematicAudio(audio.engine, "campaign-cinematic");
    const clock = { milliseconds: 0 }, initialAudio: CinematicAudio[] = [];
    let ready = false;
    const playback = new CinematicPlayback(source, { target: { kind: "seat", seat }, clock: { sample: () => clock.milliseconds },
      loop: request.loop, hold: request.hold, silent: request.silent,
      onAudio: block => { if (ready) stream.onAudio(block, { kind: "material", id: "campaign-cinematic" }); else initialAudio.push(block); },
      onAudioReset: target => { if (ready) stream.onAudioReset(target); },
      onAudioPause: (paused, target) => { if (ready) stream.onAudioPause(paused, target); }, onComplete: () => undefined });
    try {
      await captions?.prepare(path);
      const image = assets.images.allocate(dimensions.width, dimensions.height, { kind: "resource", resource: resource.reference });
      const movie = new FullscreenCinematic(playback, image, (width, height, origin) => assets.images.allocate(width, height, origin));
      audio.engine.stopAll(); audio.engine.pause(false); ready = true;
      for (const block of initialAudio) stream.onAudio(block, { kind: "material", id: "campaign-cinematic" });
      return new CampaignCinematic(movie, renderer, assets, audio, clock, captions);
    } catch (error) { playback.close(); throw error; }
  }
  get timeline(): CinematicTimeline { return this.movie.playback.timeline; }
  get status(): CinematicStatus { return this.movie.playback.status; }
  pause(paused: boolean): void { this.movie.playback.pause(paused); this.syncAudioPause(); }
  skip(): void { this.movie.playback.skip(); }
  private syncAudioPause(): void {
    const paused = this.status === "paused";
    if (paused !== this.pausedAudio) { this.audio.engine.pause(paused); this.pausedAudio = paused; }
  }
  input(event: SeatInputEvent): boolean {
    if ((event.kind === "key" && event.down && !event.repeat || event.kind === "mouse-button" && event.down
      || event.kind === "controller-button" && event.down) && this.movie.playback.playbackTimeMilliseconds > 1000) this.skip();
    // A still image has a held zero clock; source PCX pictures still accept a deliberate skip.
    else if (this.status === "held" && this.clock.milliseconds > 1000 && (event.kind === "key" && event.down && !event.repeat
      || event.kind === "mouse-button" && event.down || event.kind === "controller-button" && event.down)) this.skip();
    return true;
  }
  frame(elapsedMilliseconds: number, sequence: number, consoleOpen = false, menuOpen = false): boolean {
    if (this.closed) throw new Error("Fullscreen cinematic is closed");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) throw new RangeError("Invalid cinematic frame interval");
    this.clock.milliseconds += elapsedMilliseconds;
    const size = this.renderer.window.drawableSize, viewport = { x: 0, y: 0, width: size.width, height: size.height };
    const draw = this.movie.prepare(viewport, consoleOpen ? "console" : menuOpen ? "menu" : "game");
    this.syncAudioPause();
    if (!consoleOpen && !menuOpen) {
      const captions = draw.blank ? [] : this.captions?.commands(this.timeline, viewport) ?? [];
      this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, ...draw.commands, ...captions, { kind: "swap-buffers" }] });
      draw.complete();
    }
    this.audio.engine.pump();
    return this.status === "ended";
  }
  close(sequence: number): void {
    if (this.closed) return;
    this.closed = true;
    try {
      const operation = this.movie.close();
      if (operation !== null) this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "image-resource", operation }] });
    } finally { this.audio.engine.stopAll(); this.audio.engine.pause(false); }
  }
}
