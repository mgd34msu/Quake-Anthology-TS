/* CPU texture storage adapted from quake-3-ts rasterizer.ts and tr_image.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec4 } from "../../contracts/math.ts";
import type { DepthImageLevel, ImageLevel, ImageResourceOperation, RenderImage, RendererImage,
  RendererResourceOwner, TextureBinding, TextureFilter, TextureSampling } from "../../contracts/render.ts";
import { expandIndexedImage } from "../../formats/images/palette.ts";
import type { BoundTexture, Sample, TextureStorage } from "./triangle-kernel.ts";

interface TextureObject {
  readonly content: Exclude<RenderImage, { readonly kind: "depth32f" }>;
  readonly levels: TextureStorage[];
  readonly mipmap: boolean;
  sampling: TextureSampling;
  readonly borderColor: Vec4;
}

function storage(level: ImageLevel): TextureStorage {
  if (!Number.isSafeInteger(level.width) || !Number.isSafeInteger(level.height) || level.width <= 0 || level.height <= 0
    || level.pixels.byteLength !== level.width * level.height * 4) throw new RangeError("Invalid CPU RGBA image level");
  const pixels = level.pixels.slice(), data = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const first = data.getUint32(0);
  let uniform: Readonly<Sample> | null = { r: data.getUint8(0) / 255, g: data.getUint8(1) / 255,
    b: data.getUint8(2) / 255, a: data.getUint8(3) / 255 };
  for (let offset = 4; offset < data.byteLength; offset += 4)
    if (data.getUint32(offset) !== first) { uniform = null; break; }
  return { width: level.width, height: level.height, pixels, data,
    internalFormat: "rgba8", hasAlpha: true, componentMaximum: 255, uniform };
}

function mipFilter(filter: TextureFilter): boolean { return filter !== "nearest" && filter !== "linear"; }
function linearFilter(filter: TextureFilter): boolean {
  return filter === "linear" || filter === "linear-mipmap-nearest" || filter === "linear-mipmap-linear";
}

/** Uploaded pixels are detached from the caller; image ordinals belong to one renderer generation. */
export class CpuImages {
  private readonly textures = new Map<number, TextureObject>();
  private readonly depths = new Map<number, readonly [DepthImageLevel, ...DepthImageLevel[]]>();
  private readonly units: [number | null, number | null] = [null, null];

  constructor(private readonly owner: RendererResourceOwner) {}

  private requireOwner(image: RendererImage): void {
    if (image.owner.identity !== this.owner.identity || image.owner.session !== this.owner.session
      || image.owner.generation !== this.owner.generation) throw new Error("CPU image belongs to another renderer owner");
    if (!Number.isSafeInteger(image.ordinal) || image.ordinal < 0) throw new RangeError("Invalid CPU image ordinal");
  }

  private require(image: RendererImage): TextureObject {
    this.requireOwner(image);
    const object = this.textures.get(image.ordinal);
    if (object === undefined) throw new Error("CPU image has not been uploaded");
    return object;
  }

  validate(image: RendererImage): void { this.require(image); }

  depthImage(image: RendererImage): DepthImageLevel {
    this.requireOwner(image);
    const levels = this.depths.get(image.ordinal);
    if (levels === undefined) throw new Error("CPU image is not a registered depth atlas");
    return levels[0];
  }

  apply(operation: ImageResourceOperation): void {
    switch (operation.kind) {
      case "create-image": {
        const { image, sampling } = operation;
        this.requireOwner(image);
        if (this.textures.has(image.ordinal) || this.depths.has(image.ordinal)) throw new Error("CPU image is already uploaded");
        if (operation.content.kind === "depth32f") {
          const copy = (level: DepthImageLevel): DepthImageLevel => {
            if (level.pixels.length !== level.width * level.height || level.width < 1 || level.height < 1)
              throw new RangeError("Invalid CPU depth image dimensions");
            return { width: level.width, height: level.height, pixels: level.pixels.slice() };
          };
          const [base, ...levels] = operation.content.levels;
          this.depths.set(image.ordinal, [copy(base), ...levels.map(copy)]);
          return;
        }
        const content: RenderImage = operation.content.kind === "rgba8" ? operation.content : {
          ...operation.content, palette: { ...operation.content.palette, colors: operation.content.palette.colors.slice() },
          translation: operation.content.translation?.slice() ?? null,
        };
        this.requireOwner(image);
        if (this.textures.has(image.ordinal)) throw new Error("CPU image is already uploaded");
        const base = content.levels[0];
        if (base.width !== image.width || base.height !== image.height) throw new RangeError("CPU image dimensions disagree");
        const levels = content.levels.map((level, index) => storage(content.kind === "rgba8"
          ? level : expandIndexedImage(content, index)));
        this.textures.set(image.ordinal, { content, levels, mipmap: mipFilter(sampling.filter), sampling: { ...sampling },
          borderColor: content.kind === "rgba8" ? { ...content.borderColor } : { x: 0, y: 0, z: 0, w: 0 } });
        return;
      }
      case "update-image": {
        if (operation.content.pixels instanceof Float32Array) {
          this.requireOwner(operation.image);
          const levels = this.depths.get(operation.image.ordinal), level = levels?.[operation.level];
          if (level === undefined || level.width !== operation.content.width || level.height !== operation.content.height
            || level.pixels.length !== operation.content.pixels.length) throw new RangeError("CPU depth update dimensions disagree");
          level.pixels.set(operation.content.pixels);
          return;
        }
        const object = this.require(operation.image), level = operation.level;
        if (!Number.isSafeInteger(level) || level < 0 || level >= object.levels.length)
          throw new RangeError("CPU update level is outside its image");
        const content = object.content;
        const incoming: ImageLevel = { width: operation.content.width, height: operation.content.height, pixels: operation.content.pixels };
        const updated = content.kind === "rgba8" ? incoming
          : expandIndexedImage({ ...content, levels: [incoming] });
        const old = object.levels[level];
        if (old === undefined || old.width !== updated.width || old.height !== updated.height)
          throw new RangeError("CPU update dimensions must match the existing image level");
        object.levels[level] = storage(updated);
        return;
      }
      case "release-image": {
        this.requireOwner(operation.image);
        if (this.depths.delete(operation.image.ordinal)) return;
        this.require(operation.image);
        this.textures.delete(operation.image.ordinal);
        if (this.units[0] === operation.image.ordinal) this.units[0] = null;
        if (this.units[1] === operation.image.ordinal) this.units[1] = null;
        return;
      }
      case "texture-mode":
        for (const object of this.textures.values()) if (object.mipmap)
          object.sampling = { ...object.sampling, filter: operation.filter };
        return;
      default: {
        const invalid: never = operation;
        throw new Error(`Invalid CPU image operation ${invalid}`);
      }
    }
  }

  bind(unit: 0 | 1, operation: TextureBinding): void {
    if (operation.kind === "retain-current-texture") return;
    this.require(operation.image);
    this.units[unit] = operation.image.ordinal;
  }

  bound(unit: 0 | 1): BoundTexture {
    const ordinal = this.units[unit], object = ordinal === null ? undefined : this.textures.get(ordinal);
    if (object === undefined) return { kind: "incomplete" };
    const base = object.levels[0];
    if (base === undefined) return { kind: "incomplete" };
    const filter = object.sampling.filter, linear = linearFilter(filter);
    const mipmapping = !mipFilter(filter) ? "none"
      : filter === "nearest-mipmap-linear" || filter === "linear-mipmap-linear" ? "linear" : "nearest";
    const levels: [TextureStorage, ...TextureStorage[]] = [base];
    if (mipmapping !== "none") {
      let width = base.width, height = base.height;
      for (let index = 1; index < object.levels.length && (width > 1 || height > 1); index++) {
        width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
        const child = object.levels[index];
        if (child === undefined || child.width !== width || child.height !== height) return { kind: "incomplete" };
        levels.push(child);
      }
    }
    return { kind: "image", internalFormat: "rgba8", wrap: object.sampling.wrap,
      minifyLinear: linear, magnifyLinear: linear, mipmapping, magnificationLimit: 1, levels, borderColor: object.borderColor };
  }

  clear(): void { this.textures.clear(); this.depths.clear(); this.units[0] = null; this.units[1] = null; }
}
