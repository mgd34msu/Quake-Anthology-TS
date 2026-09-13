import type { ImageLevel, Palette, RenderImage, RendererImage, TextureSampling } from "../../contracts/render.ts";
import type { Q1MipTexture } from "../../contracts/scene.ts";
import { decodeBmp, decodeGif, decodeJpeg, decodePcx, decodePng, decodeQ3Tga, decodeQpic, decodeTga, decodeWal, generateMipChain, indexedRenderImage } from "../../formats/images/index.ts";
import { SceneImageRegistry } from "./resources.ts";
import { floodSkin } from "./skin.ts";
import { q2MipmappedImage } from "./q2-image.ts";

export interface SceneAsset {
  readonly bytes: Uint8Array;
  readonly source: RendererImage["source"];
}
export interface SceneAssetReader {
  read(path: string): Promise<SceneAsset | null>;
  /** Alternate original source beneath a user replacement; null when the loaded asset is already original. */
  readOriginal?(path: string): Promise<SceneAsset | null>;
}
export interface SceneTexture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly image: RendererImage;
  readonly content: RenderImage;
  readonly fullbright: RendererImage | null;
}

export interface SceneTextureLoadOptions {
  readonly mipmap?: boolean;
  readonly wrap?: TextureSampling["wrap"];
  readonly family?: "q1" | "q2" | "q3";
  readonly usage?: "skin" | "sprite" | "picture" | "wall" | "sky";
}

type AnimatedFrame = Exclude<RenderImage, { readonly kind: "depth32f" }>;

const repeat: TextureSampling = { wrap: "repeat", filter: "linear-mipmap-nearest" };

/** Images retain palette data until the backend upload, including translated skins. */
export class SceneTextureLoader {
  private readonly loaded = new Map<string, Promise<SceneTexture | null>>();
  private animationFrames = new WeakMap<RendererImage, readonly [AnimatedFrame, ...AnimatedFrame[]]>();
  private readonly stopAnimations = new Set<() => void>();
  private closed = false;
  readonly white: SceneTexture;
  readonly missing: SceneTexture;

  constructor(readonly images: SceneImageRegistry, readonly reader: SceneAssetReader,
    readonly palette: Palette | null = null, readonly fullbrightFirst = 224) {
    this.white = this.register("*white", { kind: "rgba8", levels: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }],
      borderColor: { x: 1, y: 1, z: 1, w: 1 } }, { wrap: "repeat", filter: "nearest" });
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      pixels.set(edge ? [255, 255, 255, 255] : [32, 32, 32, 255], (y * 16 + x) * 4);
    }
    this.missing = this.register("*default", { kind: "rgba8", levels: generateMipChain({ width: 16, height: 16, pixels }),
      borderColor: { x: 0, y: 0, z: 0, w: 1 } }, repeat);
  }

  register(name: string, content: RenderImage, sampling: TextureSampling = repeat,
    source: RendererImage["source"] = { kind: "generated", name }, logicalSize: Pick<ImageLevel, "width" | "height"> = content.levels[0]): SceneTexture {
    this.requireOpen();
    const image = this.images.register(name, content, sampling, source);
    let fullbright: RendererImage | null = null;
    if (content.kind === "indexed8" && content.fullbright !== null) {
      const range = content.fullbright;
      const convert = (level: ImageLevel): ImageLevel => {
        const pixels = new Uint8Array(level.width * level.height * 4);
        for (const [offset, index] of level.pixels.entries()) {
          if (index < range.first || index > range.last || content.transparency.kind !== "opaque" && index === content.transparency.index) continue;
          const translated = content.translation?.[index] ?? index;
          pixels.set([content.palette.colors[translated * 3] ?? 0, content.palette.colors[translated * 3 + 1] ?? 0,
            content.palette.colors[translated * 3 + 2] ?? 0, 255], offset * 4);
        }
        return { width: level.width, height: level.height, pixels };
      };
      const [first, ...rest] = content.levels;
      fullbright = this.images.register(`${name}:fullbright`, { kind: "rgba8", levels: [convert(first), ...rest.map(convert)],
        borderColor: { x: 0, y: 0, z: 0, w: 0 } }, sampling, source);
    }
    return { name, image, content, fullbright, width: logicalSize.width, height: logicalSize.height };
  }

  q1Embedded(texture: Q1MipTexture): SceneTexture | null {
    if (texture.kind === "external") return null;
    if (this.palette === null) throw new Error("Embedded Quake textures require their content palette");
    const level = (mip: 0 | 1 | 2 | 3): ImageLevel => ({ width: Math.max(1, texture.width >> mip), height: Math.max(1, texture.height >> mip), pixels: texture.levels[mip] });
    return this.register(texture.name, indexedRenderImage([level(0), level(1), level(2), level(3)], this.palette,
      texture.name.startsWith("{") ? { kind: "q1-fence", index: 255 } : { kind: "opaque" },
      texture.name.startsWith("sky") || texture.name.startsWith("*") ? null : { first: this.fullbrightFirst, last: 255 }));
  }

  async sampleSurface(texture: SceneTexture, options: { readonly mipmap: boolean; readonly wrap: TextureSampling["wrap"] }): Promise<SceneTexture> {
    this.requireOpen();
    if (options.mipmap && options.wrap === "repeat") return texture;
    const key = `\0surface:${texture.image.ordinal}\0${options.mipmap}\0${options.wrap}`;
    const existing = this.loaded.get(key);
    if (existing !== undefined) {
      const sampled = await existing;
      if (sampled === null) throw new Error("Surface sampling cache lost its texture");
      return sampled;
    }
    const original = texture.content;
    const content: RenderImage = options.mipmap ? original : original.kind === "depth32f"
      ? { ...original, levels: [original.levels[0]] } : { ...original, levels: [original.levels[0]] };
    const sampled = this.register(texture.name, content, { wrap: options.wrap, filter: options.mipmap ? "linear-mipmap-nearest" : "linear" },
      texture.image.source, texture);
    const frames = this.animationFrames.get(texture.image);
    if (frames !== undefined) {
      const surfaceFrame = (frame: AnimatedFrame): AnimatedFrame => options.mipmap ? frame : { ...frame, levels: [frame.levels[0]] };
      this.animate(sampled, [surfaceFrame(frames[0]), ...frames.slice(1).map(surfaceFrame)]);
    }
    this.loaded.set(key, Promise.resolve(sampled));
    return sampled;
  }

  load(name: string, options: SceneTextureLoadOptions = {}): Promise<SceneTexture | null> {
    this.requireOpen();
    const key = `${name}\0${options.mipmap !== false}\0${options.wrap ?? "repeat"}\0${options.family ?? "q3"}\0${options.usage ?? ""}`;
    const existing = this.loaded.get(key);
    if (existing !== undefined) return existing;
    const pending = this.loadUncached(name, options);
    this.loaded.set(key, pending);
    return pending;
  }

  private async loadUncached(name: string, options: SceneTextureLoadOptions): Promise<SceneTexture | null> {
    const dot = name.lastIndexOf("."), slash = name.lastIndexOf("/");
    const explicit = dot > slash, base = explicit ? name.slice(0, dot) : name;
    const wall = options.usage === "wall" || options.usage === undefined && (name.startsWith("textures/") || name.toLowerCase().endsWith(".wal"));
    const extensions = options.family === "q2" ? [".png", ".jpg", ".tga", ".jpeg", ".bmp", ".gif", wall ? ".wal" : ".pcx"]
      : options.family === "q1" ? [".lmp", ".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp", ".gif"] : [".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp", ".gif"];
    const overrideNative = options.family === "q2" && /\.(pcx|wal)$/i.test(name);
    const alternatives = extensions.map(extension => base + extension);
    const candidates = [...new Set([
      ...(overrideNative ? alternatives.slice(0, -1) : []),
      ...(explicit ? [name] : []), ...alternatives,
    ])];
    for (const path of candidates) {
      const asset = await this.reader.read(path);
      this.requireOpen();
      if (asset === null) continue;
      const suffix = path.slice(path.lastIndexOf(".")).toLowerCase();
      let content: RenderImage;
      let animation: readonly [AnimatedFrame, ...AnimatedFrame[]] | null = null;
      if (suffix === ".gif") {
        const decoded = decodeGif(asset.bytes, path);
        const convert = (image: ImageLevel): AnimatedFrame => {
          const rgba = this.rgba(image, options.mipmap !== false);
          const result = options.family === "q2" && options.mipmap !== false ? q2MipmappedImage(rgba) : rgba;
          if (result.kind === "depth32f") throw new Error("GIF mip processing produced depth pixels");
          return result;
        };
        animation = [convert(decoded.frames[0].image), ...decoded.frames.slice(1).map(frame => convert(frame.image))];
        content = animation[0];
      } else if (suffix === ".lmp") {
        if (this.palette === null) throw new Error("Quake picture textures require their content palette");
        const pic = decodeQpic(asset.bytes, path);
        content = indexedRenderImage([{ width: pic.width, height: pic.height, pixels: pic.indices }], this.palette,
          { kind: "opaque" }, { first: this.fullbrightFirst, last: 255 });
      } else if (suffix === ".wal") {
        if (this.palette === null) throw new Error("WAL textures require their content palette");
        const wal = decodeWal(asset.bytes, path);
        content = indexedRenderImage(wal.levels, this.palette);
      } else if (suffix === ".pcx") {
        const pcx = decodePcx(asset.bytes, path);
        if (this.palette === null && pcx.palette === null) throw new Error(`PCX has no palette: ${path}`);
        const palette = pcx.palette ?? this.palette?.colors;
        if (palette === undefined || palette === null) throw new Error(`PCX palette was lost: ${path}`);
        if (options.family === "q2" && (options.usage === "skin" || options.usage === "sprite") && this.palette !== null) {
          const pixels = options.usage === "skin" ? floodSkin(pcx.indices, pcx.width, pcx.height, this.palette) : pcx.indices;
          content = indexedRenderImage([{ width: pcx.width, height: pcx.height, pixels }], this.palette, { kind: "index", index: 255 });
        } else {
          const pixels = new Uint8Array(pcx.width * pcx.height * 4), count = pcx.indices.length;
          for (const [offset, index] of pcx.indices.entries()) {
            let color = index;
            if (options.family === "q2" && index === 255) {
              const above = offset > pcx.width ? pcx.indices[offset - pcx.width] : undefined;
              const below = offset < count - pcx.width ? pcx.indices[offset + pcx.width] : undefined;
              const left = offset > 0 ? pcx.indices[offset - 1] : undefined;
              const right = offset < count - 1 ? pcx.indices[offset + 1] : undefined;
              color = [above, below, left, right].find(value => value !== undefined && value !== 255) ?? 0;
            }
            pixels.set([palette[color * 3] ?? 0, palette[color * 3 + 1] ?? 0, palette[color * 3 + 2] ?? 0, options.family === "q2" && index === 255 ? 0 : 255], offset * 4);
          }
          content = this.rgba({ width: pcx.width, height: pcx.height, pixels }, options.mipmap !== false);
        }
      } else {
        if (![".png", ".tga", ".bmp", ".jpg", ".jpeg"].includes(suffix)) throw new Error(`Unsupported scene image format: ${path}`);
        const decoded = suffix === ".png" ? decodePng(asset.bytes, path) : suffix === ".tga" ? options.family === undefined || options.family === "q3"
          ? decodeQ3Tga(asset.bytes, path) : decodeTga(asset.bytes, path)
          : suffix === ".bmp" ? decodeBmp(asset.bytes, path) : decodeJpeg(asset.bytes, path);
        content = this.rgba(decoded, options.mipmap !== false);
      }
      let logicalSize: Pick<ImageLevel, "width" | "height"> = content.levels[0];
      if (options.family === "q2" && suffix !== ".wal" && (name.toLowerCase().endsWith(".wal") || !explicit && wall)) {
        const original = await this.reader.read(`${base}.wal`);
        if (original !== null) logicalSize = decodeWal(original.bytes, `${base}.wal`);
      }
      if (options.family === "q2" && name.toLowerCase().endsWith(".pcx") && suffix !== ".pcx") {
        const requested = await this.reader.readOriginal?.(name) ?? await this.reader.read(name);
        if (requested !== null) logicalSize = decodePcx(requested.bytes, name);
      }
      const original = await this.reader.readOriginal?.(path);
      if (original !== undefined && original !== null && logicalSize === content.levels[0]) {
        if (suffix === ".gif") logicalSize = decodeGif(original.bytes, path);
        else if (suffix === ".png") logicalSize = decodePng(original.bytes, path);
        else if (suffix === ".tga") logicalSize = decodeTga(original.bytes, path);
        else if (suffix === ".jpg" || suffix === ".jpeg") logicalSize = decodeJpeg(original.bytes, path);
        else if (suffix === ".bmp") logicalSize = decodeBmp(original.bytes, path);
      }
      if (animation === null && options.family === "q2" && options.mipmap !== false) content = q2MipmappedImage(content);
      const texture = this.register(name, content, { wrap: options.wrap ?? "repeat", filter: options.mipmap === false ? "linear" : "linear-mipmap-nearest" }, asset.source, logicalSize);
      if (animation !== null) this.animate(texture, animation);
      return texture;
    }
    return null;
  }

  close(): void {
    this.closed = true;
    for (const stop of this.stopAnimations) stop();
    this.stopAnimations.clear();
    this.animationFrames = new WeakMap();
    this.loaded.clear();
  }

  private requireOpen(): void { if (this.closed) throw new Error("Scene texture loader is closed"); }

  private animate(texture: SceneTexture, frames: readonly [AnimatedFrame, ...AnimatedFrame[]]): void {
    if (frames.length < 2) return;
    this.animationFrames.set(texture.image, frames);
    let previous = 0;
    const stop: () => void = this.images.trackAnimation(texture.image, milliseconds => {
      // The Q2 donor deliberately ignores GIF delays and loops forever at 10 Hz.
      const beat = Math.floor(milliseconds / 100), index = ((beat % frames.length) + frames.length) % frames.length;
      if (index === previous) return;
      const frame = frames[index];
      if (frame === undefined) throw new Error("GIF frame index is outside the decoded sequence");
      for (const [level, content] of frame.levels.entries()) this.images.update(texture.image, level, content);
      previous = index;
    }, () => { this.stopAnimations.delete(stop); this.animationFrames.delete(texture.image); });
    this.stopAnimations.add(stop);
  }

  private rgba(image: ImageLevel, mipmap: boolean): Extract<RenderImage, { readonly kind: "rgba8" }> {
    return { kind: "rgba8", levels: mipmap ? generateMipChain(image) : [image], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
  }
}
