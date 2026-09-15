// Quake screen.c center-string reveal and sbar.c finale overlay. GPL-2.0-or-later.
import type { ContentId } from "../../contracts/content.ts";
import type { ImagePicture, Draw2D } from "../../text/draw2d.ts";
import type { SeatTextPresentation } from "../../text/layout.ts";
import { Q1MessageLocalization } from "./q1-localization.ts";
import { decodeQpic, indexedRenderImage } from "../../formats/images/index.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

interface FinaleState { readonly content: ContentId; readonly sourceText: string; readonly started: number; readonly banner: boolean; }
interface FinaleAssets { readonly banner: ImagePicture; readonly width: number; readonly height: number; }

/** The source game controls stages and input gating; each seat reveals its own text. */
export class SourceFinale {
  private state: FinaleState | null = null;
  private readonly loaded = new Map<ContentId, Promise<FinaleAssets>>();
  private prepared: FinaleAssets | null = null;
  private message = "";
  constructor(private readonly assets: ApplicationAssets, private readonly text: SeatTextPresentation,
    private readonly messages = new Q1MessageLocalization(text.seat, assets)) {}

  get active(): boolean { return this.state !== null; }

  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      if (source.kind === "q1-level" && source.event.kind === "finale")
        this.state = { content: source.content, sourceText: source.event.text, started: source.seconds, banner: true };
      else if (source.kind === "q1" && source.event.kind === "finale" && source.event.stage <= 4)
        this.state = { content: source.content, sourceText: source.event.text, started: source.seconds, banner: source.event.stage >= 4 };
    }
  }

  private load(content: ContentId): Promise<FinaleAssets> {
    const prior = this.loaded.get(content); if (prior !== undefined) return prior;
    const pending = (async (): Promise<FinaleAssets> => {
      const provider = await this.assets.provider(content);
      if (provider.family !== "q1" || provider.palette === null) throw new Error("Quake finale requires its source palette");
      const picture = await provider.mounts.open("gfx/finale.lmp");
      if (picture === null) throw new Error("Quake finale picture is absent from selected content");
      const decoded = decodeQpic(picture.bytes, "gfx/finale.lmp");
      const image = this.assets.images.register("gfx/finale.lmp", indexedRenderImage([{ width: decoded.width, height: decoded.height, pixels: decoded.indices }],
        provider.palette, { kind: "index", index: 255 }), { wrap: "clamp", filter: "nearest" }, { kind: "resource", resource: picture.reference });
      return { banner: { kind: "image", name: "gfx/finale.lmp", image }, width: decoded.width, height: decoded.height };
    })();
    this.loaded.set(content, pending); return pending;
  }

  async prepare(): Promise<void> {
    if (this.state === null) return;
    this.prepared = await this.load(this.state.content);
    this.message = await this.messages.resolve(this.state.content, this.state.sourceText, []);
  }

  draw(draw: Draw2D, seconds: number): void {
    const state = this.state, assets = this.prepared;
    if (state === null || assets === null) return;
    const scale = Math.min(draw.width / 320, draw.height / 200), height = draw.height / scale;
    if (state.banner) draw.drawPic({ x: (draw.width - assets.width * scale) / 2, y: 16 * scale, width: assets.width * scale, height: assets.height * scale }, assets.banner);
    const lines = this.message.split("\n"), color = { x: 1, y: 1, z: 1, w: 1 };
    let y = (lines.length <= 4 ? Math.trunc(height * 0.35) : 48) * scale;
    let remaining = Math.max(0, Math.trunc(8 * (seconds - state.started))) + 1;
    for (const sourceLine of lines) {
      const line = sourceLine.slice(0, 40), width = this.text.layout({ text: line, scale, color }).width;
      this.text.draw(draw, { text: line, scale, color, maxGlyphs: remaining }, { x: Math.trunc((draw.width - width) / 2), y });
      remaining -= line.length;
      if (remaining <= 0) break;
      y += 8 * scale;
    }
  }
}
