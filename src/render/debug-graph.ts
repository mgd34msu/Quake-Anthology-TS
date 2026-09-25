// SPDX-License-Identifier: GPL-2.0-or-later
// Quake II cl_scrn.c: SCR_DebugGraph, SCR_DrawDebugGraph, CL_AddNetgraph.
import type { Vec4 } from "../contracts/math.ts";
import type { Palette, Rect } from "../contracts/render.ts";
import type { Draw2D, PictureAsset } from "../text/draw2d.ts";

export interface DebugGraphSettings {
  readonly debuggraph: number;
  readonly timegraph: number;
  readonly netgraph: number;
  readonly height: number;
  readonly scale: number;
  readonly shift: number;
}
export interface DebugGraphBar { readonly rect: Rect; readonly color: number; }
export function debugGraphColor(palette: Palette, index: number): Vec4 {
  const offset = (index & 255) * 3, r = palette.colors[offset], g = palette.colors[offset + 1], b = palette.colors[offset + 2];
  if (r === undefined || g === undefined || b === undefined) throw new Error("Incomplete debug graph palette");
  return { x: r / 255, y: g / 255, z: b / 255, w: 1 };
}
export class SourceDebugGraph {
  private readonly values = new Float32Array(1024);
  private readonly colors = new Int32Array(1024);
  private current = 0;
  add(value: number, color: number): void {
    this.values[this.current] = value;
    this.colors[this.current] = color;
    this.current = (this.current + 1) & 1023;
  }
  addFrame(seconds: number, settings: DebugGraphSettings): void {
    if (settings.timegraph !== 0) this.add(Math.fround(Math.fround(seconds) * 300), 0);
  }
  addNetwork(packet: { readonly dropped: number; readonly suppressed: number; readonly pingMilliseconds: number }, settings: DebugGraphSettings): void {
    if (settings.debuggraph !== 0 || settings.timegraph !== 0) return;
    for (let i = 0; i < packet.dropped; i++) this.add(30, 0x40);
    for (let i = 0; i < packet.suppressed; i++) this.add(30, 0xdf);
    this.add(Math.min(30, Math.trunc(packet.pingMilliseconds / 30)), 0xd0);
  }
  bars(rect: Rect, settings: DebugGraphSettings): readonly DebugGraphBar[] {
    if (settings.debuggraph === 0 && settings.timegraph === 0 && settings.netgraph === 0) return [];
    const height = Math.trunc(settings.height);
    // Source modulo by zero is undefined; invalid user heights produce no graph.
    if (!Number.isFinite(settings.height) || height <= 0) return [];
    const y = rect.y + rect.height;
    const bars: DebugGraphBar[] = [{ rect: { x: rect.x, y: y - settings.height, width: rect.width, height: settings.height }, color: 8 }];
    for (let a = 0; a < rect.width; a++) {
      const i = (this.current - 1 - a + 1024) & 1023;
      const value = this.values[i] ?? 0;
      let v = Math.fround(Math.fround(value * Math.fround(settings.scale)) + Math.fround(settings.shift));
      if (v < 0) v = Math.fround(v + Math.fround(settings.height * (1 + Math.trunc(-v / settings.height))));
      const h = Math.trunc(v) % height;
      bars.push({ rect: { x: rect.x + rect.width - 1 - a, y: y - h, width: 1, height: h }, color: this.colors[i] ?? 0 });
    }
    return bars;
  }
  draw(draw: Draw2D, rect: Rect, settings: DebugGraphSettings, paletteColor: (index: number) => Vec4, white: PictureAsset): void {
    for (const bar of this.bars(rect, settings)) draw.fillRect(bar.rect, paletteColor(bar.color), white);
  }
}
