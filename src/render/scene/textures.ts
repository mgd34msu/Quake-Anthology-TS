import type { ImageLevel, Palette, RenderImage, RendererImage, TextureSampling } from "../../contracts/render.ts";
import type { Q1MipTexture } from "../../contracts/scene.ts";
import { decodeBmp, decodeJpeg, decodePcx, decodePng, decodeQ3Tga, decodeQpic, decodeTga, decodeWal, generateMipChain, indexedRenderImage } from "../../formats/images/index.ts";
import { SceneImageRegistry } from "./resources.ts";
import { q2MipmappedImage } from "./q2-image.ts";

export interface SceneAsset {
  readonly bytes: Uint8Array;
  readonly source: RendererImage["source"];
}
export interface SceneAssetReader {
  read(path: string): Promise<SceneAsset | null>;
  /** Content's original mount, excluding user replacement directories. */
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

const repeat: TextureSampling = { wrap: "repeat", filter: "linear-mipmap-nearest" };

/** Images retain palette data until the backend upload, including translated skins. */
export class SceneTextureLoader {
  private readonly loaded = new Map<string, Promise<SceneTexture | null>>();
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

  load(name: string, options: { readonly mipmap?: boolean; readonly wrap?: TextureSampling["wrap"]; readonly family?: "q1" | "q2" | "q3" } = {}): Promise<SceneTexture | null> {
    const key = `${name}\0${options.mipmap !== false}\0${options.wrap ?? "repeat"}\0${options.family ?? "q3"}`;
    const existing = this.loaded.get(key);
    if (existing !== undefined) return existing;
    const pending = this.loadUncached(name, options);
    this.loaded.set(key, pending);
    return pending;
  }

  private async loadUncached(name: string, options: { readonly mipmap?: boolean; readonly wrap?: TextureSampling["wrap"]; readonly family?: "q1" | "q2" | "q3" }): Promise<SceneTexture | null> {
    const dot = name.lastIndexOf("."), slash = name.lastIndexOf("/");
    const explicit = dot > slash, base = explicit ? name.slice(0, dot) : name;
    const extensions = options.family === "q2" ? [".png", ".tga", ".jpg", ".wal", ".pcx"]
      : options.family === "q1" ? [".lmp", ".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp"] : [".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp"];
    const candidates = explicit ? [name, ...extensions.map(extension => base + extension).filter(path => path !== name)] : extensions.map(extension => name + extension);
    for (const path of candidates) {
      const asset = await this.reader.read(path);
      if (asset === null) continue;
      const suffix = path.slice(path.lastIndexOf(".")).toLowerCase();
      let content: RenderImage;
      if (suffix === ".lmp") {
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
      } else {
        const decoded = suffix === ".png" ? decodePng(asset.bytes, path) : suffix === ".tga" ? options.family === undefined || options.family === "q3"
          ? decodeQ3Tga(asset.bytes, path) : decodeTga(asset.bytes, path)
          : suffix === ".bmp" ? decodeBmp(asset.bytes, path) : decodeJpeg(asset.bytes, path);
        content = this.rgba(decoded, options.mipmap !== false);
      }
      let logicalSize: Pick<ImageLevel, "width" | "height"> = content.levels[0];
      if (options.family === "q2" && suffix !== ".wal") {
        const original = await this.reader.read(`${base}.wal`);
        if (original !== null) logicalSize = decodeWal(original.bytes, `${base}.wal`);
      }
      const original = await this.reader.readOriginal?.(path);
      if (original !== undefined && original !== null && logicalSize === content.levels[0]) {
        if (suffix === ".png") logicalSize = decodePng(original.bytes, path);
        else if (suffix === ".tga") logicalSize = decodeTga(original.bytes, path);
        else if (suffix === ".jpg" || suffix === ".jpeg") logicalSize = decodeJpeg(original.bytes, path);
      }
      if (options.family === "q2" && options.mipmap !== false) content = q2MipmappedImage(content);
      return this.register(name, content, { wrap: options.wrap ?? "repeat", filter: options.mipmap === false ? "linear" : "linear-mipmap-nearest" }, asset.source, logicalSize);
    }
    return null;
  }

  private rgba(image: ImageLevel, mipmap: boolean): RenderImage {
    return { kind: "rgba8", levels: mipmap ? generateMipChain(image) : [image], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
  }
}
