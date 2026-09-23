import type { Rect } from "../../../contracts/render.ts";
import type { Draw2D } from "../../../text/draw2d.ts";
import type { CinematicMixer } from "../../../media/audio.ts";
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
import type { ApplicationQ3Assets } from "./assets.ts";
import type { ScreenCinematicRequest } from "../campaign-cinematic.ts";
import type { CinematicStatus } from "../../../media/types.ts";
import { cinematicPcx } from "../../../media/still.ts";

export interface SystemCinematicHandle { readonly status: CinematicStatus; skip(): void; stop(): void; }
export interface SystemCinematicHost { open(request: ScreenCinematicRequest, current: () => boolean): Promise<SystemCinematicHandle>; }
let nextConsumer = 0;

interface Q3CinematicMode {
  readonly loop: boolean;
  readonly hold: boolean;
  readonly silent: boolean;
  readonly shader: boolean;
  readonly rect: Rect;
}
type CinematicAssets = {
  readonly provider: { readonly mounts: Pick<ApplicationQ3Assets["provider"]["mounts"], "open"> };
  readonly assets: { readonly images: Pick<ApplicationQ3Assets["assets"]["images"], "allocate" | "commit" | "release"> };
  readonly print: ApplicationQ3Assets["print"];
};
class MissingCinematicError extends Error {}

export class ApplicationQ3Cinematics implements EngineUiCinematics {
  private readonly sources = new Map<string, { readonly source: CinematicSource; readonly resource: ResolvedResourceReference }>();
  private closed = false;
  private readonly systems = new Map<number, SystemCinematicHandle>();
  private readonly pendingSystems = new Map<number, object>();
  private readonly namespace = `q3-cinematic:${++nextConsumer}`;
  private readonly movies = new Map<number, { readonly playback: CinematicPlayback; readonly image: CinematicImage; readonly picture: MaterialPicture; readonly path: string; rect: Rect }>();
  readonly owner = { prepare: (path: string) => this.prepare(path), stopSlot: (index: number) => this.stop(index) };
  constructor(readonly assets: CinematicAssets, readonly audio: { readonly engine: CinematicMixer }, readonly seat: SeatId, readonly now: () => number,
    private readonly system?: SystemCinematicHost) {}
  private async prepare(path: string): Promise<UiCinematicAsset> {
    if (this.closed) throw new Error("UI cinematics are closed");
    if (!this.sources.has(path)) {
      const selected = path.includes("/") ? path : `video/${path}`, name = /\.[^/]+$/.test(selected) ? selected : `${selected}.roq`;
      const resource = await this.assets.provider.mounts.open(name);
      if (this.closed) throw new Error("UI cinematic loaded after close");
      if (resource === null || resource.bytes.length === 0) throw new MissingCinematicError(`Missing cinematic ${name}`);
      const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      if (extension !== "roq" && extension !== "cin" && extension !== "ogv" && extension !== "pcx") throw new Error(`Unsupported cinematic format: ${extension}`);
      this.sources.set(path, { source: extension === "pcx" ? cinematicPcx(resource.bytes, name) : cinematicBytes(extension, resource.bytes, name), resource: resource.reference });
    }
    return { path };
  }
  play(asset: UiCinematicAsset, rect: Rect = { x: 0, y: 0, width: 0, height: 0 }) {
    return this.playMode(asset, { loop: true, hold: false, silent: true, shader: false, rect });
  }
  private playMode(asset: UiCinematicAsset, mode: Q3CinematicMode) {
    if (this.closed) throw new Error("UI cinematics are closed");
    const prepared = this.sources.get(asset.path); if (prepared === undefined) throw new Error(`Unprepared cinematic ${asset.path}`);
    let index = 0; while (this.movies.has(index) || this.systems.has(index) || this.pendingSystems.has(index)) index++;
    if (index >= 16) return undefined;
    const dimensions = cinematicDimensions(prepared.source);
    const audio = cinematicAudio(this.audio.engine, `${this.namespace}:${index}`);
    const playback = new CinematicPlayback(prepared.source, { target: mode.shader ? { kind: "material", id: `${this.namespace}:${index}` } : { kind: "seat", seat: this.seat },
      clock: { sample: this.now }, loop: mode.loop, hold: mode.hold, silent: mode.silent,
      onAudio: block => audio.onAudio(block, { kind: "seat", seat: this.seat }), onAudioReset: target => audio.onAudioReset(target), onAudioPause: (paused, target) => audio.onAudioPause(paused, target), onComplete: () => undefined, developerPrint: this.assets.print });
    try {
    const images = this.assets.assets.images;
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
    const name = `${this.namespace}:${index}`;
    const picture: MaterialPicture = { kind: "material", name, material: { order: 0, compiled: compileImplicitMaterial({
      kind: "picture", name, profile: DEFAULT_SHADER_PROFILE, baseImage: { kind: "loaded", tmu: 0, binding: { kind: "video", source } },
    }) } };
    this.movies.set(index, { playback, image, picture, path: prepared.source.source, rect: { ...mode.rect } });
    return { asset, handle: { index } };
    } catch (error) { playback.close(); throw error; }
  }
  async playGuest(path: string, rect: Rect, bits: number): Promise<number> {
    if ((bits & 1) !== 0) {
      if (this.closed) throw new Error("UI cinematics are closed");
      if (this.system === undefined) throw new Error("System cinematic requires an attached client transition owner");
      let index = 0; while (this.movies.has(index) || this.systems.has(index) || this.pendingSystems.has(index)) index++;
      if (index >= 16) throw new Error("CIN_HandleForVideo: none free");
      const token = {}; this.pendingSystems.set(index, token);
      let installed: SystemCinematicHandle | null = null;
      const current = (): boolean => !this.closed && (this.pendingSystems.get(index) === token || installed !== null && this.systems.get(index) === installed);
      try {
        const movie = await this.system.open({ name: path, loop: (bits & 2) !== 0, hold: (bits & 4) !== 0, silent: (bits & 8) !== 0 }, current);
        if (!current()) { movie.stop(); throw new Error("System cinematic loaded after close"); }
        installed = movie; this.systems.set(index, movie); return index;
      } finally { if (this.pendingSystems.get(index) === token) this.pendingSystems.delete(index); }
    }
    let asset: UiCinematicAsset;
    try { asset = await this.prepare(path); }
    catch (error: unknown) { if (error instanceof MissingCinematicError) return -1; throw error; }
    if (this.closed) throw new Error("UI cinematic loaded after close");
    const prepared = this.sources.get(asset.path);
    for (const [index, movie] of this.movies) if (movie.path === prepared?.source.source) return index;
    const played = this.playMode(asset, { loop: (bits & 2) !== 0, hold: (bits & 4) !== 0, silent: (bits & 8) !== 0, shader: (bits & 16) !== 0, rect });
    if (played === undefined) throw new Error("CIN_HandleForVideo: none free");
    return played.handle.index;
  }
  runGuest(handle: number): number {
    const system = this.systems.get(handle);
    if (system !== undefined) {
      if (system.status === "held") return 0;
      if (system.status === "playing" || system.status === "paused") return 1;
      this.stop(handle); return 2;
    }
    const movie = this.movies.get(handle); if (movie === undefined) return 2;
    movie.playback.tick();
    switch (movie.playback.sourceStatus) {
      case "playing": case "paused": return 1;
      case "looped": return 5;
      case "held": return 0;
      case "ended": case "stopped": this.stop(handle); return 2;
    }
  }
  stopGuest(handle: number): number {
    this.pendingSystems.delete(handle);
    const system = this.systems.get(handle);
    if (system !== undefined) { try { system.skip(); } finally { if (this.systems.get(handle) === system) this.systems.delete(handle); } }
    else this.stop(handle);
    return 2;
  }
  drawGuest(handle: number, draw: Draw2D): void {
    const movie = this.movies.get(handle); if (movie !== undefined) this.draw(handle, movie.rect, draw);
  }
  setExtents(handle: number, rect: Rect): void { const movie = this.movies.get(handle); if (movie !== undefined) movie.rect = { ...rect }; }
  run(handle: number): void {
    const movie = this.movies.get(handle); if (movie === undefined) return;
    movie.playback.tick();
  }
  draw(...[handle, rect, draw]: Parameters<EngineUiCinematics["draw"]>): void {
    const movie = this.movies.get(handle); if (movie === undefined || movie.playback.currentFrame === null) return;
    draw.drawPic(rect, movie.picture);
  }
  stop(handle: number): void {
    this.pendingSystems.delete(handle);
    const system = this.systems.get(handle);
    if (system !== undefined) { this.systems.delete(handle); system.stop(); return; }
    const movie = this.movies.get(handle); if (movie === undefined) return;
    const release = movie.image.release();
    movie.playback.close();
    if (release !== null) this.assets.assets.images.release(release.image);
    this.movies.delete(handle);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.pendingSystems.clear();
    for (const index of this.movies.keys()) this.stop(index);
    for (const index of this.systems.keys()) this.stop(index);
    this.sources.clear();
  }
}
