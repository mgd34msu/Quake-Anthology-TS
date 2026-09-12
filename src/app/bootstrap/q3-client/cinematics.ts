import type { SeatId } from "../../../contracts/identity.ts";
import type { ResolvedResourceReference } from "../../../contracts/content.ts";
import type { MaterialPicture } from "../../../text/draw2d.ts";
import { compileImplicitMaterial, DEFAULT_SHADER_PROFILE } from "../../../materials/compile.ts";
import type { ShaderCinematicSource } from "../../../materials/cinematic.ts";
import { CinematicImage, cinematicDimensions } from "../../../media/presentation.ts";
import type { EngineUiCinematics } from "../../../content/q3/presentation/ui-adapters.ts";
import type { UiCinematicAsset } from "../../../ui/common/legacy/runtime.ts";
import { CinematicPlayback, cinematicBytes } from "../../../media/playback.ts";
import type { CinematicSource } from "../../../media/playback.ts";
import { cinematicAudio } from "../../../media/audio.ts";
import type { ApplicationAudio } from "../audio.ts";
import type { ApplicationQ3Assets } from "./assets.ts";

export class ApplicationQ3Cinematics implements EngineUiCinematics {
  private readonly sources = new Map<string, { readonly source: CinematicSource; readonly resource: ResolvedResourceReference }>();
  private closed = false;
  private readonly movies = new Map<number, { readonly playback: CinematicPlayback; readonly image: CinematicImage; readonly picture: MaterialPicture }>();
  readonly owner = { prepare: (path: string) => this.prepare(path), stopSlot: (index: number) => this.stop(index) };
  constructor(readonly assets: ApplicationQ3Assets, readonly audio: ApplicationAudio, readonly seat: SeatId, readonly now: () => number) {}
  private async prepare(path: string): Promise<UiCinematicAsset> {
    if (this.closed) throw new Error("UI cinematics are closed");
    if (!this.sources.has(path)) {
      const selected = path.includes("/") ? path : `video/${path}`, name = /\.[^/]+$/.test(selected) ? selected : `${selected}.roq`;
      const resource = await this.assets.provider.mounts.open(name);
      if (this.closed) throw new Error("UI cinematic loaded after close");
      if (resource === null || resource.bytes.length === 0) throw new Error(`Missing cinematic ${name}`);
      this.sources.set(path, { source: cinematicBytes("roq", resource.bytes, name), resource: resource.reference });
    }
    return { path };
  }
  play(asset: UiCinematicAsset) {
    if (this.closed) throw new Error("UI cinematics are closed");
    const prepared = this.sources.get(asset.path); if (prepared === undefined) throw new Error(`Unprepared cinematic ${asset.path}`);
    let index = 0; while (this.movies.has(index)) index++;
    if (index >= 16) return undefined;
    const playback = new CinematicPlayback(prepared.source, { target: { kind: "seat", seat: this.seat }, clock: { sample: this.now }, loop: true, silent: true,
      ...cinematicAudio(this.audio.engine, `q3-ui:${this.seat.index}:${index}`), onComplete: () => undefined, developerPrint: this.assets.print });
    const images = this.assets.assets.images, dimensions = cinematicDimensions(prepared.source);
    const image = new CinematicImage(images.allocate(dimensions.width, dimensions.height, { kind: "resource", resource: prepared.resource }),
      (width, height, source) => images.allocate(width, height, source));
    const source: ShaderCinematicSource = {
      get image() { return image.image; },
      resolve: apply => {
        const frame = playback.currentFrame;
        if (frame === null) throw new Error("UI cinematic draw has no decoded frame");
        return image.resolve(frame, playback.revision, operation => { apply(operation); images.commit(operation); });
      },
    };
    const name = `q3-cinematic:${this.seat.index}:${index}`;
    const picture: MaterialPicture = { kind: "material", name, material: { order: 0, compiled: compileImplicitMaterial({
      kind: "picture", name, profile: DEFAULT_SHADER_PROFILE, baseImage: { kind: "loaded", tmu: 0, binding: { kind: "video", source } },
    }) } };
    this.movies.set(index, { playback, image, picture });
    return { asset, handle: { index } };
  }
  run(handle: number): void {
    const movie = this.movies.get(handle); if (movie === undefined) return;
    movie.playback.tick();
  }
  draw(...[handle, rect, draw]: Parameters<EngineUiCinematics["draw"]>): void {
    const movie = this.movies.get(handle); if (movie === undefined || movie.playback.currentFrame === null) return;
    draw.drawPic(rect, movie.picture);
  }
  stop(handle: number): void {
    const movie = this.movies.get(handle); if (movie === undefined) return;
    const release = movie.image.release();
    movie.playback.close();
    if (release !== null) this.assets.assets.images.release(release.image);
    this.movies.delete(handle);
  }
  close(): void { for (const index of this.movies.keys()) this.stop(index); this.sources.clear(); this.closed = true; }
}
