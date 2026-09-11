// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResourceId } from "../../contracts/content.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { Rect, RenderCommand } from "../../contracts/render.ts";
import type { UiDrawCommand, UiDrawContext } from "../../contracts/ui.ts";
import { clipPicture } from "../../render/commands/frame.ts";
import { Draw2D } from "../../text/draw2d.ts";
import type { MaterialTextDraw, PictureAsset, TextDrawSink, TextureRect } from "../../text/draw2d.ts";
import type { UiTextRenderer } from "../../text/ui.ts";
import { intersect } from "./layout.ts";

export interface UiRenderServices {
  readonly text: UiTextRenderer;
  readonly white: PictureAsset;
  readonly picture: (resource: ResourceId) => PictureAsset;
  readonly emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void;
  readonly material: (draw: MaterialTextDraw) => void;
}
class UiDrawSink implements TextDrawSink {
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
  clip: Rect;
  constructor(readonly seat: SeatId, readonly target: Rect, private readonly services: UiRenderServices) { this.clip = target; }
  setColor(color: Vec4 | null): void { this.color = color ?? { x: 1, y: 1, z: 1, w: 1 }; }
  stretchPixels(rect: Rect, uv: TextureRect, picture: PictureAsset): void {
    const clipped = clipPicture(rect, { s1: uv.s, t1: uv.t, s2: uv.s2, t2: uv.t2 }, this.clip);
    if (clipped === null) return;
    if (picture.kind === "material") this.services.material({ seat: this.seat, rect: clipped.rect,
      uv: { s: clipped.uv.s1, t: clipped.uv.t1, s2: clipped.uv.s2, t2: clipped.uv.t2 }, color: this.color, picture });
    else {
      this.services.emit({ kind: "set-color", color: this.color });
      this.services.emit({ kind: "stretch-pic", image: picture.image, ...clipped });
    }
  }
}
/** UiDrawCommand coordinates are absolute drawable pixels; all glyphs and images are seat-clipped. */
export function renderUiCommands(context: UiDrawContext, commands: readonly UiDrawCommand[], services: UiRenderServices): void {
  const sink = new UiDrawSink(context.binding.seat, context.binding.viewport, services), draw = new Draw2D(sink, "pixels");
  for (const command of commands) switch (command.kind) {
    case "clip": sink.clip = command.rect === null ? context.binding.viewport : intersect(context.binding.viewport, command.rect); break;
    case "text": services.text.draw(context, command, draw); break;
    case "fill": sink.setColor(command.color); sink.stretchPixels(command.rect, { s: 0, t: 0, s2: 0, t2: 0 }, services.white); break;
    case "image": sink.setColor(command.color); sink.stretchPixels(command.rect,
      { s: command.texCoords[0].x, t: command.texCoords[0].y, s2: command.texCoords[1].x, t2: command.texCoords[1].y }, services.picture(command.resource)); break;
  }
  services.emit({ kind: "set-color", color: { x: 1, y: 1, z: 1, w: 1 } });
}
