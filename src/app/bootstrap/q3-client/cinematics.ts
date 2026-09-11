import type { SeatId } from "../../../contracts/identity.ts";
import type { RendererImage } from "../../../contracts/render.ts";
import type { EngineUiCinematics } from "../../../content/q3/presentation/ui-adapters.ts";
import type { UiCinematicAsset } from "../../../ui/common/legacy/runtime.ts";
import { CinematicPlayback, cinematicBytes } from "../../../media/playback.ts";
import type { CinematicSource } from "../../../media/playback.ts";
import { cinematicAudio } from "../../../media/audio.ts";
import type { ApplicationAudio } from "../audio.ts";
import type { ApplicationQ3Assets } from "./assets.ts";

export class ApplicationQ3Cinematics implements EngineUiCinematics {
  private readonly sources = new Map<string, CinematicSource>();
  private readonly movies = new Map<number, { readonly playback: CinematicPlayback; image: RendererImage | null }>();
  readonly owner = { prepare: (path: string) => this.prepare(path), stopSlot: (index: number) => this.stop(index) };
  constructor(readonly assets: ApplicationQ3Assets, readonly audio: ApplicationAudio, readonly seat: SeatId, readonly now: () => number) {}
  private async prepare(path: string): Promise<UiCinematicAsset> {
    if (!this.sources.has(path)) {
      const selected = path.includes("/") ? path : `video/${path}`, name = /\.[^/]+$/.test(selected) ? selected : `${selected}.roq`;
      const bytes = await this.assets.read(name);
      if (bytes.length === 0) throw new Error(`Missing cinematic ${name}`);
      this.sources.set(path, cinematicBytes("roq", bytes, name));
    }
    return { path };
  }
  play(asset: UiCinematicAsset) {
    const source = this.sources.get(asset.path); if (source === undefined) throw new Error(`Unprepared cinematic ${asset.path}`);
    let index = 0; while (this.movies.has(index)) index++;
    if (index >= 16) return undefined;
    const playback = new CinematicPlayback(source, { target: { kind: "seat", seat: this.seat }, clock: { sample: this.now }, loop: true, silent: true,
      ...cinematicAudio(this.audio.engine, `q3-ui:${this.seat.index}:${index}`), onComplete: () => undefined, developerPrint: this.assets.print });
    this.movies.set(index, { playback, image: null });
    return { asset, handle: { index } };
  }
  run(handle: number): void {
    const movie = this.movies.get(handle); if (movie === undefined) return;
    const tick = movie.playback.tick(); if (!tick.changed || tick.frame === null) return;
    const content = { width: tick.frame.width, height: tick.frame.height, pixels: tick.frame.rgba };
    if (movie.image === null) movie.image = this.assets.assets.images.register(`q3-ui:${this.seat.index}:${handle}`, { kind: "rgba8", levels: [content], borderColor: { x: 0, y: 0, z: 0, w: 1 } }, { wrap: "clamp", filter: "linear" });
    else this.assets.assets.images.update(movie.image, 0, content);
  }
  draw(...[handle, rect, draw]: Parameters<EngineUiCinematics["draw"]>): void {
    const image = this.movies.get(handle)?.image; if (image === null || image === undefined) return;
    draw.drawPic(rect, { kind: "image", name: `q3-cinematic:${handle}`, image });
  }
  stop(handle: number): void { const movie = this.movies.get(handle); if (movie === undefined) return; movie.playback.close(); if (movie.image !== null) this.assets.assets.images.release(movie.image); this.movies.delete(handle); }
  close(): void { for (const index of this.movies.keys()) this.stop(index); this.sources.clear(); }
}
