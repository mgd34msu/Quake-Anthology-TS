import type { SeatId } from "../../contracts/identity.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { cinematicAudio } from "../../media/audio.ts";
import { CinematicPlayback, cinematicBytes } from "../../media/playback.ts";
import { cinematicDimensions, FullscreenCinematic } from "../../media/presentation.ts";
import { cinematicPcx } from "../../media/still.ts";
import type { CinematicAudio } from "../../media/types.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { Q2TravelTarget } from "./q2-travel.ts";

/** One campaign movie replaces the shared screen and uses the existing audio output. */
export class CampaignCinematic {
  private constructor(private readonly movie: FullscreenCinematic, private readonly renderer: NativeRenderer,
    private readonly assets: ApplicationAssets, private readonly audio: ApplicationAudio, private readonly clock: { milliseconds: number }) {}
  static async open(target: Q2TravelTarget, content: LoadedApplicationContent, assets: ApplicationAssets,
    audio: ApplicationAudio, renderer: NativeRenderer, seat: SeatId): Promise<CampaignCinematic> {
    if (target.kind !== "cinematic" && target.kind !== "picture") throw new Error(`Unsupported campaign media: ${target.name}`);
    const path = target.kind === "cinematic" ? `video/${target.name}` : `pics/${target.name}`;
    const resource = await content.mounts.open(path);
    if (resource === null) throw new Error(`Missing campaign cinematic: ${path}`);
    const source = target.kind === "cinematic" ? cinematicBytes("cin", resource.bytes, path) : cinematicPcx(resource.bytes, path);
    const dimensions = cinematicDimensions(source), stream = cinematicAudio(audio.engine, "campaign-cinematic");
    const clock = { milliseconds: 0 };
    const initialAudio: CinematicAudio[] = [];
    let ready = false;
    const playback = new CinematicPlayback(source, { target: { kind: "seat", seat }, clock: { sample: () => clock.milliseconds },
      ...stream, onAudio: block => { if (ready) stream.onAudio(block, { kind: "material", id: "campaign-cinematic" }); else initialAudio.push(block); }, onComplete: () => undefined });
    try {
      const image = assets.images.allocate(dimensions.width, dimensions.height, { kind: "resource", resource: resource.reference });
      const movie = new FullscreenCinematic(playback, image, (width, height, origin) => assets.images.allocate(width, height, origin));
      audio.engine.stopAll(); ready = true;
      for (const block of initialAudio) stream.onAudio(block, { kind: "material", id: "campaign-cinematic" });
      return new CampaignCinematic(movie, renderer, assets, audio, clock);
    } catch (error) { playback.close(); throw error; }
  }
  input(event: SeatInputEvent): boolean {
    if ((event.kind === "key" && event.down && !event.repeat || event.kind === "mouse-button" && event.down
      || event.kind === "controller-button" && event.down) && this.clock.milliseconds > 1000) this.movie.playback.skip();
    return true;
  }
  frame(elapsedMilliseconds: number, sequence: number, consoleOpen = false): boolean {
    this.clock.milliseconds += elapsedMilliseconds;
    const size = this.renderer.window.drawableSize;
    const draw = this.movie.prepare({ x: 0, y: 0, width: size.width, height: size.height }, consoleOpen ? "console" : "game");
    if (!consoleOpen) {
      this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, ...draw.commands, { kind: "swap-buffers" }] });
      draw.complete();
    }
    this.audio.engine.pump();
    return this.movie.playback.status === "ended";
  }
  close(sequence: number): void {
    const operation = this.movie.close();
    if (operation !== null) this.renderer.execute({ owner: this.assets.images.owner, sequence, commands: [{ kind: "image-resource", operation }] });
  }
}
