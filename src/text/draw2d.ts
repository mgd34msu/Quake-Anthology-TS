// SPDX-License-Identifier: GPL-2.0-or-later
// Coordinate transforms follow Q3 cg_drawtools.c and ui_atoms.c.
import type { Vec4 } from "../contracts/math.ts";
import type { Rect, RenderCommand, RendererImage } from "../contracts/render.ts";
import type { SeatId } from "../contracts/identity.ts";
import type { CompiledMaterial } from "../materials/compile.ts";
import { clipPicture } from "../render/commands/frame.ts";
import type { RegisteredFont } from "./q3-font.ts";

export interface TextureRect { readonly s: number; readonly t: number; readonly s2: number; readonly t2: number; }
export interface ImagePicture { readonly kind: "image"; readonly name: string; readonly image: RendererImage; }
export interface MaterialPicture {
  readonly kind: "material";
  readonly name: string;
  readonly material: { readonly order: number; readonly compiled: CompiledMaterial };
}
export type PictureAsset = ImagePicture | MaterialPicture;
export interface RetainedFontFile { readonly bytes: Uint8Array; readonly length: number; }
export interface FontFileReader {
  readFileLength(path: string): number | Promise<number>;
  readFileRetained(path: string): Promise<RetainedFontFile | undefined>;
  freeFile(file: RetainedFontFile): void;
}
export interface FontAssetServices {
  registerPicture(path: string, mode: "no-mip" | "mip"): Promise<PictureAsset>;
  readonly fonts: { registerFont(path: string | null, size: number, print: (text: string) => void): Promise<RegisteredFont | null> };
}
export interface TextDrawSink {
  readonly seat: SeatId;
  readonly target: Rect;
  setColor(color: Vec4 | null): void;
  stretchPixels(rect: Rect, uv: TextureRect, picture: PictureAsset): void;
}
export interface MaterialTextDraw {
  readonly seat: SeatId;
  readonly rect: Rect;
  readonly uv: TextureRect;
  readonly color: Vec4;
  readonly picture: MaterialPicture;
}
const white: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
const fullUv: TextureRect = { s: 0, t: 0, s2: 1, t2: 1 };
const f = Math.fround;

/** Material pictures retain shader stages for the scene's material evaluator. */
export class TextCommandSink implements TextDrawSink {
  private color: Vec4 = white;
  constructor(readonly seat: SeatId, readonly target: Rect,
    private readonly emit: (command: RenderCommand) => void,
    private readonly material: (draw: MaterialTextDraw) => void) {}
  setColor(color: Vec4 | null): void { this.color = color ?? white; this.emit({ kind: "set-color", color: this.color }); }
  stretchPixels(rect: Rect, uv: TextureRect, picture: PictureAsset): void {
    const destination = { ...rect, x: rect.x + this.target.x, y: rect.y + this.target.y };
    if (picture.kind === "material") {
      this.material({ seat: this.seat, rect: destination, uv, color: this.color, picture });
    } else {
      const clipped = clipPicture(destination, { s1: uv.s, t1: uv.t, s2: uv.s2, t2: uv.t2 }, this.target);
      if (clipped !== null) this.emit({ kind: "stretch-pic", ...clipped, image: picture.image });
    }
  }
}

export type CoordinateSpace = "pixels" | "stretch-640" | "base-ui-640" | "team-ui-640";
export class Draw2D {
  constructor(readonly commands: TextDrawSink, readonly space: CoordinateSpace) {}
  get width(): number { return this.commands.target.width; }
  get height(): number { return this.commands.target.height; }
  get scaleX(): number {
    switch (this.space) {
      case "pixels": return 1;
      case "stretch-640": return f(f(this.width) / 640);
      case "base-ui-640": return f(f(this.height) * f(1 / 480));
      case "team-ui-640": return f(f(this.width) * f(1 / 640));
    }
  }
  get scaleY(): number {
    switch (this.space) {
      case "pixels": return 1;
      case "stretch-640": return f(f(this.height) / 480);
      case "base-ui-640": return this.scaleX;
      case "team-ui-640": return f(f(this.height) * f(1 / 480));
    }
  }
  get biasX(): number {
    return this.space === "base-ui-640" && Math.imul(this.width, 480) > Math.imul(this.height, 640)
      ? f(0.5 * f(f(this.width) - f(f(this.height) * f(640 / 480)))) : 0;
  }
  setColor(color: Vec4 | null): void { this.commands.setColor(color); }
  adjust(rect: Rect): Rect {
    const x = f(f(rect.x) * this.scaleX);
    return { x: this.space === "team-ui-640" ? x : f(x + this.biasX), y: f(f(rect.y) * this.scaleY),
      width: f(f(rect.width) * this.scaleX), height: f(f(rect.height) * this.scaleY) };
  }
  stretchPic(rect: Rect, uv: TextureRect, picture: PictureAsset | (() => PictureAsset)): void {
    this.stretchPixels(this.adjust(rect), uv, picture);
  }
  stretchPixels(rect: Rect, uv: TextureRect, picture: PictureAsset | (() => PictureAsset)): void {
    this.commands.stretchPixels(rect, uv, typeof picture === "function" ? picture() : picture);
  }
  drawPic(rect: Rect, picture: PictureAsset): void { this.stretchPic(rect, fullUv, picture); }
  drawHandlePic(rect: Rect, picture: PictureAsset | (() => PictureAsset)): void {
    this.stretchPic({ ...rect, width: Math.abs(rect.width), height: Math.abs(rect.height) },
      { s: rect.width < 0 ? 1 : 0, s2: rect.width < 0 ? 0 : 1, t: rect.height < 0 ? 1 : 0, t2: rect.height < 0 ? 0 : 1 }, picture);
  }
  fillRect(rect: Rect, color: Vec4, picture: PictureAsset): void {
    this.setColor(color); this.stretchPic(rect, { s: 0, t: 0, s2: 0, t2: 0 }, picture); this.setColor(null);
  }
}
