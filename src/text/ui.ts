// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResourceId } from "../contracts/content.ts";
import type { SeatId } from "../contracts/identity.ts";
import type { UiDrawCommand, UiDrawContext } from "../contracts/ui.ts";
import type { TextFontSelection } from "./atlas.ts";
import type { Draw2D } from "./draw2d.ts";
import { drawTextLayout, layoutText } from "./layout.ts";
import type { TextLayout } from "./layout.ts";

export class UiTextRenderer {
  private readonly fonts = new Map<ResourceId, TextFontSelection>();
  constructor(readonly seat: SeatId) {}
  bind(resource: ResourceId, font: TextFontSelection): void { this.fonts.set(resource, font); }
  release(resource: ResourceId): void { this.fonts.delete(resource); }
  clear(): void { this.fonts.clear(); }
  draw(context: UiDrawContext, command: Extract<UiDrawCommand, { readonly kind: "text" }>, draw: Draw2D): TextLayout {
    if (!this.seat.equals(context.binding.seat) || !this.seat.equals(draw.commands.seat)) throw new Error("UI text belongs to a different seat");
    const font = this.fonts.get(command.font);
    if (font === undefined) throw new Error("UI font has not been registered for this seat");
    const layout = layoutText({ text: command.text, font, scale: command.scale, color: command.color });
    const offset = command.align === "center" ? layout.width / 2 : command.align === "right" ? layout.width : 0;
    drawTextLayout(draw, layout, { x: command.origin.x - offset, y: command.origin.y }, command.shadow ? 1 : 0);
    return layout;
  }
}
