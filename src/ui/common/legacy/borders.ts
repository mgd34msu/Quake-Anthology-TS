// CG_DrawRect, CG_DrawTopBottom and CG_DrawSides from code/cgame/cg_drawtools.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Vec4 } from "../../../contracts/math.ts";
import type { Rect } from "../../../contracts/render.ts";
import type { Draw2D, PictureAsset } from "../../../text/draw2d.ts";

const f = Math.fround;
const uv = { s: 0, t: 0, s2: 0, t2: 0 };

export function drawCgTopBottom(draw: Draw2D, rect: Rect, size: number, picture: PictureAsset): void {
  const r = draw.adjust(rect);
  const vertical = f(f(size) * draw.scaleY);
  draw.stretchPixels({ ...r, height: vertical }, uv, picture);
  draw.stretchPixels({ ...r, y: f(f(r.y + r.height) - vertical), height: vertical }, uv, picture);
}

export function drawCgSides(draw: Draw2D, rect: Rect, size: number, picture: PictureAsset): void {
  const r = draw.adjust(rect);
  const horizontal = f(f(size) * draw.scaleX);
  draw.stretchPixels({ ...r, width: horizontal }, uv, picture);
  draw.stretchPixels({ ...r, x: f(f(r.x + r.width) - horizontal), width: horizontal }, uv, picture);
}

export function drawCgRect(draw: Draw2D, rect: Rect, size: number, color: Vec4, picture: PictureAsset): void {
  draw.setColor(color);
  drawCgTopBottom(draw, rect, size, picture);
  drawCgSides(draw, rect, size, picture);
  draw.setColor(null);
}
