// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResourceId } from "../../contracts/content.ts";
import type { Vec2, Vec4 } from "../../contracts/math.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiDrawCommand } from "../../contracts/ui.ts";
import type { TextFontSelection } from "../../text/atlas.ts";

export interface UiImageSlice {
  readonly resource: ResourceId;
  readonly width: number;
  readonly height: number;
  readonly uv: readonly [Vec2, Vec2];
  readonly border: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly borderScale?: number;
}
export interface UiSkin {
  readonly font: ResourceId;
  readonly titleFont?: ResourceId;
  readonly titleScale?: number;
  readonly fontScale: number;
  readonly lineHeight: number;
  readonly panel: UiImageSlice | null;
  readonly button: UiImageSlice | null;
  readonly focus: UiImageSlice | null;
  readonly background: ResourceId | null;
  readonly colors: { readonly text: Vec4; readonly disabled: Vec4; readonly accent: Vec4; readonly panel: Vec4; readonly control: Vec4; readonly focused: Vec4 };
}
export function defaultUiSkin(font: ResourceId): UiSkin {
  return { font, fontScale: 1.5, lineHeight: 14, panel: null, button: null, focus: null, background: null,
    colors: { text: { x: 0.92, y: 0.88, z: 0.78, w: 1 }, disabled: { x: 0.4, y: 0.4, z: 0.4, w: 1 },
      accent: { x: 1, y: 0.65, z: 0.22, w: 1 }, panel: { x: 0.055, y: 0.06, z: 0.065, w: 0.94 },
      control: { x: 0.12, y: 0.13, z: 0.14, w: 0.9 }, focused: { x: 0.3, y: 0.19, z: 0.09, w: 0.98 } } };
}
export function uiSkinFont(skin: UiSkin, font: TextFontSelection, lineHeight = 14): UiSkin {
  const height = font.kind === "atlas" ? font.font.lineHeight : font.classic.lineHeight;
  if (height <= 0 || lineHeight <= 0) throw new RangeError("Menu font line height must be positive");
  // W21 normalizes every atlas to an eight-unit text line before applying scale.
  return { ...skin, fontScale: lineHeight / 8, lineHeight };
}
/** Insets are pixels in the atlas region, independently scaled down for small destinations. */
export function nineSlice(slice: UiImageSlice, rect: Rect, color: Vec4): readonly UiDrawCommand[] {
  const { left, top, right, bottom } = slice.border;
  if (slice.width <= 0 || slice.height <= 0 || [left, top, right, bottom].some(value => value < 0)
    || left + right > slice.width || top + bottom > slice.height) throw new RangeError("Invalid UI nine-slice image");
  const borderScale = slice.borderScale ?? 1;
  const sx = Math.min(borderScale, rect.width / Math.max(1, left + right)), sy = Math.min(borderScale, rect.height / Math.max(1, top + bottom));
  const xs = [rect.x, rect.x + left * sx, rect.x + rect.width - right * sx, rect.x + rect.width];
  const ys = [rect.y, rect.y + top * sy, rect.y + rect.height - bottom * sy, rect.y + rect.height];
  const [uv0, uv1] = slice.uv, du = uv1.x - uv0.x, dv = uv1.y - uv0.y;
  const us = [uv0.x, uv0.x + du * left / slice.width, uv1.x - du * right / slice.width, uv1.x];
  const vs = [uv0.y, uv0.y + dv * top / slice.height, uv1.y - dv * bottom / slice.height, uv1.y];
  const commands: UiDrawCommand[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const x0 = xs[x], x1 = xs[x + 1], y0 = ys[y], y1 = ys[y + 1], u0 = us[x], u1 = us[x + 1], v0 = vs[y], v1 = vs[y + 1];
    if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined || u0 === undefined || u1 === undefined || v0 === undefined || v1 === undefined) continue;
    if (x1 <= x0 || y1 <= y0) continue;
    commands.push({ kind: "image", resource: slice.resource, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      texCoords: [{ x: u0, y: v0 }, { x: u1, y: v1 }], color });
  }
  return commands;
}
