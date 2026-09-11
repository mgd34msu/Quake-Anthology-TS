// SPDX-License-Identifier: GPL-2.0-or-later
// Q3 ui_atoms.c's aspect-correct 640x480 space, fitted to each seat's safe area.
import type { Vec2 } from "../../contracts/math.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiDrawCommand } from "../../contracts/ui.ts";

export interface UiTransform { readonly x: number; readonly y: number; readonly scale: number; }
export function fitUi(area: Rect, scale = 1): UiTransform {
  if (!Number.isFinite(scale) || scale <= 0 || area.width <= 0 || area.height <= 0) throw new RangeError("UI requires a positive scale and safe area");
  const factor = Math.min(area.width / 640, area.height / 480) * scale;
  return { x: area.x + (area.width - 640 * factor) / 2, y: area.y + (area.height - 480 * factor) / 2, scale: factor };
}
export function uiPoint(point: Vec2, transform: UiTransform): Vec2 {
  return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale };
}
export function contains(rect: Rect, point: Vec2): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}
export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
export function transformUi(command: UiDrawCommand, transform: UiTransform): UiDrawCommand {
  const rect = (value: Rect): Rect => ({ x: transform.x + value.x * transform.scale, y: transform.y + value.y * transform.scale,
    width: value.width * transform.scale, height: value.height * transform.scale });
  switch (command.kind) {
    case "fill": case "image": return { ...command, rect: rect(command.rect) };
    case "clip": return { ...command, rect: command.rect === null ? null : rect(command.rect) };
    case "text": return { ...command, origin: { x: transform.x + command.origin.x * transform.scale,
      y: transform.y + command.origin.y * transform.scale }, scale: command.scale * transform.scale };
  }
}
export function menuRow(index: number, options: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number } = {}): Rect {
  const height = options.height ?? 28;
  return { x: options.x ?? 64, y: (options.y ?? 92) + index * height, width: options.width ?? 512, height };
}
