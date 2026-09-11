// SPDX-License-Identifier: GPL-2.0-or-later
// Q3 tr_image.c texture lifetime and filtering; palette expansion is shared.
import type { loadGl } from "../../platform/gl.ts";
import type { DepthImageLevel, ImageLevel, ImageResourceOperation, RendererImage, RendererResourceOwner, RenderImage, TextureBinding, TextureFilter } from "../../contracts/render.ts";
import { expandIndexedImage } from "../../formats/images/palette.ts";

type Gl = ReturnType<typeof loadGl>["symbols"];
interface Texture {
  readonly handle: Uint32Array;
  readonly name: number;
  readonly mipmap: boolean;
  readonly width: number;
  readonly height: number;
  readonly content: RenderImage;
  readonly levels: readonly { readonly width: number; readonly height: number }[];
}
const filters: Record<TextureFilter, readonly [number, number]> = {
  nearest: [0x2600, 0x2600], linear: [0x2601, 0x2601],
  "nearest-mipmap-nearest": [0x2700, 0x2600], "linear-mipmap-nearest": [0x2701, 0x2601],
  "nearest-mipmap-linear": [0x2702, 0x2600], "linear-mipmap-linear": [0x2703, 0x2601],
};

/** Native read/write calls must see tightly packed client memory, never a PBO offset. */
export function withPixelStore(gl: Gl, direction: "pack" | "unpack", operation: () => void): void {
  const state = new Int32Array(1);
  gl.glGetIntegerv(direction === "pack" ? 0x88ed : 0x88ef, state);
  if (state[0] !== 0) throw new Error("OpenGL pixel transfers require client memory without a bound pixel buffer");
  const settings = direction === "pack" ? [0xd05, 0xd02, 0xd03, 0xd04, 0xd00] : [0xcf5, 0xcf2, 0xcf3, 0xcf4, 0xcf0];
  const saved = settings.map(name => {
    gl.glGetIntegerv(name, state);
    const value = state[0];
    if (value === undefined) throw new Error("OpenGL pixel store state is unavailable");
    return { name, value };
  });
  try {
    for (const [index, name] of settings.entries()) gl.glPixelStorei(name, index === 0 ? 1 : 0);
    operation();
  } finally {
    for (const { name, value } of saved) gl.glPixelStorei(name, value);
  }
}

export class GlTextures {
  private readonly images = new Map<number, Texture>();

  constructor(private readonly gl: Gl, private readonly owner: RendererResourceOwner, private readonly maximum: number) {}

  private own(image: RendererImage): void {
    if (image.owner.identity !== this.owner.identity || image.owner.session !== this.owner.session || image.owner.generation !== this.owner.generation)
      throw new Error("OpenGL image belongs to another renderer owner");
    if (!Number.isSafeInteger(image.ordinal) || image.ordinal < 0) throw new RangeError("OpenGL image ordinal must be a nonnegative safe integer");
  }

  registered(image: RendererImage): Texture {
    this.own(image);
    const texture = this.images.get(image.ordinal);
    if (texture === undefined) throw new Error("OpenGL image is not registered");
    if (image.width !== texture.width || image.height !== texture.height) throw new RangeError("OpenGL image handle dimensions differ from its allocation");
    return texture;
  }

  bind(binding: TextureBinding): void {
    if (binding.kind === "bind-image") this.gl.glBindTexture(0xde1, this.registered(binding.image).name);
  }

  private filter(filter: TextureFilter): void {
    const [min, mag] = filters[filter];
    this.gl.glTexParameteri(0xde1, 0x2801, min);
    this.gl.glTexParameteri(0xde1, 0x2800, mag);
  }

  private dimensions(level: ImageLevel | DepthImageLevel, channels: number): void {
    if (!Number.isInteger(level.width) || !Number.isInteger(level.height) || level.width < 1 || level.height < 1
      || level.width > this.maximum || level.height > this.maximum || level.pixels.length !== level.width * level.height * channels)
      throw new RangeError("OpenGL image dimensions do not match its pixel allocation");
    if (level.pixels instanceof Float32Array && !level.pixels.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
      throw new RangeError("OpenGL depth samples must be finite values in 0..1");
  }

  apply(operation: ImageResourceOperation): void {
    const gl = this.gl;
    if (operation.kind === "texture-mode") {
      for (const texture of this.images.values()) {
        if (!texture.mipmap) continue;
        gl.glBindTexture(0xde1, texture.name);
        this.filter(operation.filter);
      }
      return;
    }
    this.own(operation.image);
    switch (operation.kind) {
      case "release-image": {
        const texture = this.registered(operation.image);
        gl.glDeleteTextures(1, texture.handle);
        this.images.delete(operation.image.ordinal);
        return;
      }
      case "create-image": {
        if (this.images.has(operation.image.ordinal)) throw new Error("OpenGL image is already registered");
        const content: RenderImage = operation.content.kind !== "indexed8" ? operation.content : {
          ...operation.content, palette: { ...operation.content.palette, colors: operation.content.palette.colors.slice() },
          translation: operation.content.translation?.slice() ?? null,
        };
        const first = content.levels[0];
        if (operation.image.width !== first.width || operation.image.height !== first.height)
          throw new RangeError("OpenGL image descriptor dimensions differ from its base mip level");
        for (const [index, level] of content.levels.entries()) {
          this.dimensions(level, content.kind === "rgba8" ? 4 : 1);
          if (level.width !== Math.max(1, Math.floor(first.width / 2 ** index)) || level.height !== Math.max(1, Math.floor(first.height / 2 ** index))
            || index > Math.floor(Math.log2(Math.max(first.width, first.height))))
            throw new RangeError("OpenGL mip levels must halve their preceding dimensions");
        }
        const levels = content.levels.map((level, index) => content.kind === "indexed8" ? expandIndexedImage(content, index) : level);
        const handle = new Uint32Array(1);
        gl.glGenTextures(1, handle);
        const name = handle[0];
        if (name === undefined || name === 0) throw new Error("OpenGL could not allocate a texture");
        try {
          gl.glBindTexture(0xde1, name);
          withPixelStore(gl, "unpack", () => {
            for (const [index, level] of levels.entries())
              gl.glTexImage2D(0xde1, index, content.kind === "depth32f" ? 0x8cac : 0x8058, level.width, level.height, 0,
                content.kind === "depth32f" ? 0x1902 : 0x1908, content.kind === "depth32f" ? 0x1406 : 0x1401, level.pixels);
          });
          gl.glTexParameteri(0xde1, 0x813d, levels.length - 1);
          this.filter(operation.sampling.filter);
          const wrap = operation.sampling.wrap === "repeat" ? 0x2901 : content.kind === "depth32f" ? 0x812f : 0x2900;
          gl.glTexParameteri(0xde1, 0x2802, wrap);
          gl.glTexParameteri(0xde1, 0x2803, wrap);
          if (content.kind === "rgba8") {
            const color = content.borderColor;
            gl.glTexParameterfv(0xde1, 0x1004, new Float32Array([color.x, color.y, color.z, color.w]));
          }
          const error = gl.glGetError();
          if (error !== 0) throw new Error(`OpenGL texture upload failed: 0x${error.toString(16)}`);
          this.images.set(operation.image.ordinal, { handle, name, content,
            width: first.width, height: first.height,
            mipmap: operation.sampling.filter !== "nearest" && operation.sampling.filter !== "linear",
            levels: levels.map(({ width, height }) => ({ width, height })) });
        } catch (error) {
          gl.glDeleteTextures(1, handle);
          throw error;
        }
        return;
      }
      case "update-image": {
        const texture = this.registered(operation.image);
        const descriptor = texture.levels[operation.level];
        if (!Number.isInteger(operation.level) || descriptor === undefined
          || descriptor.width !== operation.content.width || descriptor.height !== operation.content.height)
          throw new RangeError("OpenGL update dimensions differ from the registered mip level");
        this.dimensions(operation.content, texture.content.kind === "rgba8" ? 4 : 1);
        let content: ImageLevel | DepthImageLevel;
        if (texture.content.kind === "depth32f") {
          if (!(operation.content.pixels instanceof Float32Array)) throw new RangeError("OpenGL depth updates require float32 samples");
          content = { ...operation.content, pixels: operation.content.pixels };
        } else {
          if (!(operation.content.pixels instanceof Uint8Array)) throw new RangeError("OpenGL color updates require byte samples");
          const level: ImageLevel = { ...operation.content, pixels: operation.content.pixels };
          content = texture.content.kind === "indexed8" ? expandIndexedImage({ ...texture.content, levels: [level] }) : level;
        }
        gl.glBindTexture(0xde1, texture.name);
        withPixelStore(gl, "unpack", () => {
          gl.glTexSubImage2D(0xde1, operation.level, 0, 0, content.width, content.height,
            texture.content.kind === "depth32f" ? 0x1902 : 0x1908, texture.content.kind === "depth32f" ? 0x1406 : 0x1401, content.pixels);
        });
        const error = gl.glGetError();
        if (error !== 0) throw new Error(`OpenGL texture update failed: 0x${error.toString(16)}`);
        return;
      }
    }
  }

  close(): void {
    for (const texture of this.images.values()) this.gl.glDeleteTextures(1, texture.handle);
    this.images.clear();
  }
}
