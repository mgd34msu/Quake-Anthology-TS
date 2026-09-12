// SPDX-License-Identifier: GPL-2.0-or-later
// Q3 tr_backend.c, tr_shade.c, tr_sky.c and tr_shadows.c backend operations.
// Copyright (C) 1999-2005 Id Software, Inc.
import { loadGl } from "../../platform/gl.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { BlendFactor, DepthImageLevel, DrawBatch, ImageResourceOperation, PreparedBackendDraw, Rect, RendererBackend, RendererDrawBuffer, RendererImage, RendererResourceOwner, RenderOperation, RenderState, RenderViewState } from "../../contracts/render.ts";
import { packGeometry, type GeometryArrays } from "./buffers.ts";
import { StageProgram } from "./programs.ts";
import { GlTextures, withPixelStore } from "./textures.ts";
import { DepthAtlasTarget } from "./depth-atlas.ts";
import { Q2FogPass } from "./fog.ts";
import { GlOutputGamma } from "./output-gamma.ts";
import { outputGammaTable } from "../output-gamma.ts";

const blendFactors: Record<BlendFactor, number> = {
  zero: 0, one: 1, "src-color": 0x300, "one-minus-src-color": 0x301,
  "src-alpha": 0x302, "one-minus-src-alpha": 0x303, "dst-alpha": 0x304,
  "one-minus-dst-alpha": 0x305, "dst-color": 0x306, "one-minus-dst-color": 0x307, "src-alpha-saturate": 0x308,
};
const drawBuffers: Record<RendererDrawBuffer, number> = { front: 0x404, back: 0x405, "back-left": 0x402, "back-right": 0x403 };
const activeContexts = new WeakSet<SdlRenderContext>();

function positionValues(position: Vec4): readonly number[] { return [position.x, position.y, position.z, position.w]; }
function finite32(value: number): boolean { return Number.isFinite(Math.fround(value)); }

export class GlRenderer implements RendererBackend {
  private readonly library: ReturnType<typeof loadGl>;
  private readonly gl: ReturnType<typeof loadGl>["symbols"];
  private readonly program: StageProgram;
  private readonly textures: GlTextures;
  private activeArrays: GeometryArrays | null = null;
  private depthAtlas: DepthAtlasTarget | null = null;
  private fog: Q2FogPass | null = null;
  private outputGamma: GlOutputGamma | null = null;
  private gamma = 1;
  private gammaFinished = false;
  private drawBuffer = drawBuffers.back;
  private alphaTest: RenderState["alphaTest"] = "none";
  private closed = false;
  readonly stencilBits: number;
  readonly depthBits: number;
  readonly colorBits: number;
  readonly alphaBits: number;
  readonly maxTextureSize: number;
  readonly textureUnits: number;
  readonly stereoEnabled: boolean;
  readonly driver: { readonly vendor: string; readonly renderer: string; readonly version: string; readonly shadingLanguage: string };

  constructor(readonly window: SdlRenderContext, readonly owner: RendererResourceOwner) {
    if (activeContexts.has(window)) throw new Error("SDL context already has an active OpenGL renderer");
    activeContexts.add(window);
    let library: ReturnType<typeof loadGl> | null = null;
    let program: StageProgram | null = null;
    try {
      window.setRenderingEnabled(true);
      window.makeCurrent();
      this.library = loadGl(window);
      library = this.library;
      this.gl = this.library.symbols;
      const gl = this.gl;
      this.driver = { vendor: String(gl.glGetString(0x1f00)), renderer: String(gl.glGetString(0x1f01)),
        version: String(gl.glGetString(0x1f02)), shadingLanguage: String(gl.glGetString(0x8b8c)) };
      this.stencilBits = this.integer(0xd57);
      this.depthBits = this.integer(0xd56);
      this.colorBits = this.integer(0xd52) + this.integer(0xd53) + this.integer(0xd54);
      this.alphaBits = this.integer(0xd55);
      this.maxTextureSize = this.integer(0xd33);
      this.textureUnits = Math.min(this.integer(0x8872), this.integer(0x8871));
      this.stereoEnabled = this.integer(0xc33) !== 0;
      if (this.textureUnits < 4 || this.maxTextureSize < 1 || this.depthBits < 1)
        throw new Error("OpenGL renderer requires four texture coordinate units and a depth framebuffer");
      this.program = new StageProgram(window);
      program = this.program;
      this.textures = new GlTextures(gl, owner, this.maxTextureSize);
      this.identityMatrices();
      gl.glFrontFace(0x901);
      gl.glShadeModel(0x1d01);
      gl.glPolygonMode(0x408, 0x1b02);
      gl.glDisable(0xb50);
      gl.glDisable(0xb60);
      gl.glDisable(0xbc0);
      gl.glDisable(0xb90);
      gl.glDisable(0x3000);
      gl.glDisable(0x8037);
      gl.glColorMask(1, 1, 1, 1);
      gl.glDepthMask(1);
      gl.glClearStencil(0);
      gl.glStencilMask(0xffffffff);
      gl.glColor4f(1, 1, 1, 1);
      this.disableArrays();
    } catch (error) {
      program?.close();
      library?.close();
      activeContexts.delete(window);
      throw error;
    }
  }

  get width(): number { return this.window.drawableSize.width; }
  get height(): number { return this.window.drawableSize.height; }

  private opened(): void {
    if (this.closed) throw new Error("OpenGL renderer is closed");
    this.window.makeCurrent();
  }

  setOutputGamma(gamma: number): undefined {
    const table = outputGammaTable(gamma); this.opened();
    if (gamma === this.gamma) return undefined;
    if (this.activeArrays !== null) throw new Error("OpenGL gamma cannot interrupt a prepared draw");
    if (table === null) {
      this.outputGamma?.restore(this.drawBuffer); this.outputGamma?.close(); this.outputGamma = null;
    } else {
      if (this.outputGamma === null) {
        const pass = new GlOutputGamma(this.window, this.gl, this, table);
        try { pass.bind(this.drawBuffer, this.width, this.height); }
        catch (error) { pass.close(); throw error; }
        this.outputGamma = pass;
      } else this.outputGamma.update(table);
    }
    this.gamma = gamma; this.gammaFinished = false;
    return undefined;
  }

  private drawTarget(rendering = true): void {
    if (this.outputGamma !== null) {
      if (this.width > this.maxTextureSize || this.height > this.maxTextureSize) throw new Error("OpenGL gamma target exceeds maximum texture size");
      const changed = this.outputGamma.bind(this.drawBuffer, this.width, this.height);
      if (rendering || changed) this.gammaFinished = false;
    }
  }

  private integer(name: number): number {
    const result = new Int32Array(1);
    this.gl.glGetIntegerv(name, result);
    const value = result[0];
    if (value === undefined || value < 0) throw new Error("OpenGL returned an invalid capability");
    return value;
  }

  private selectTexture(unit: 0 | 1 | 2 | 3): void {
    this.gl.glActiveTexture(0x84c0 + unit);
    this.gl.glClientActiveTexture(0x84c0 + unit);
  }

  private identityMatrices(): void {
    for (const matrix of [0x1700, 0x1701]) { this.gl.glMatrixMode(matrix); this.gl.glLoadIdentity(); }
  }

  private cull(cull: RenderState["cull"]): void {
    if (cull === "none") this.gl.glDisable(0xb44);
    else { this.gl.glEnable(0xb44); this.gl.glCullFace(cull === "back" ? 0x405 : 0x404); }
  }

  private polygonOffset(value: RenderState["polygonOffset"]): void {
    if (value === null) this.gl.glDisable(0x8037);
    else {
      if (!finite32(value.factor) || !finite32(value.units)) throw new RangeError("OpenGL polygon offset must be finite");
      this.gl.glEnable(0x8037);
      this.gl.glPolygonOffset(value.factor, value.units);
    }
  }

  private depthRange(range: RenderState["depthRange"]): void {
    if (!range.every(Number.isFinite)) throw new RangeError("OpenGL depth range must be finite");
    this.gl.glDepthRange(range[0], range[1]);
  }

  private state(state: RenderState): void {
    const gl = this.gl;
    if (state.blend.destination === "src-alpha-saturate") throw new RangeError("OpenGL destination blend cannot use source alpha saturate");
    gl.glEnable(0xb71);
    gl.glDepthFunc(state.depthTest === "less-equal" ? 0x203 : state.depthTest === "equal" ? 0x202 : 0x207);
    gl.glDepthMask(state.depthWrite ? 1 : 0);
    if (state.blend.source === "one" && state.blend.destination === "zero") gl.glDisable(0xbe2);
    else {
      gl.glEnable(0xbe2);
      gl.glBlendFunc(blendFactors[state.blend.source], blendFactors[state.blend.destination]);
    }
    gl.glDisable(0xbc0);
    this.alphaTest = state.alphaTest;
    this.cull(state.cull);
    this.depthRange(state.depthRange);
    this.polygonOffset(state.polygonOffset);
  }

  applyImageResource(operation: ImageResourceOperation): undefined {
    this.opened();
    this.selectTexture(0);
    this.textures.apply(operation);
  }

  selectDrawBuffer(buffer: RendererDrawBuffer, clear: boolean): undefined {
    this.opened();
    if (buffer === "back-right" && !this.stereoEnabled)
      throw new Error("OpenGL stereo draw buffer requires a stereo context");
    this.drawBuffer = drawBuffers[buffer];
    if (this.outputGamma === null) this.gl.glDrawBuffer(this.drawBuffer); else this.drawTarget();
    if (clear) { this.gl.glClearColor(1, 0, 0.5, 1); this.gl.glClear(0x4000 | 0x100); }
  }

  beginView(view: RenderViewState): undefined {
    this.opened(); this.drawTarget();
    const { x, y, width, height } = view.viewport;
    const bottom = this.height - y - height;
    if (![x, y, width, height, bottom].every(value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff)
      || width < 1 || height < 1) throw new RangeError("OpenGL viewport requires positive int32 dimensions");
    const gl = this.gl;
    gl.glViewport(x, bottom, width, height);
    gl.glEnable(0xc11);
    gl.glScissor(x, bottom, width, height);
    this.identityMatrices();
    if (view.clipPlane === null) gl.glDisable(0x3000);
    else {
      const plane = positionValues(view.clipPlane);
      if (!plane.every(Number.isFinite)) throw new RangeError("OpenGL clip plane must be finite");
      gl.glClipPlane(0x3000, new Float64Array(plane));
      gl.glEnable(0x3000);
    }
    if (view.clear !== null) {
      const { depth, color, stencil } = view.clear;
      if (!Number.isFinite(depth) || color !== null && !positionValues(color).every(finite32))
        throw new RangeError("OpenGL clear values must be finite");
      gl.glDepthMask(1);
      gl.glClearDepth(depth);
      if (color !== null) gl.glClearColor(color.x, color.y, color.z, color.w);
      if (stencil) { gl.glStencilMask(0xffffffff); gl.glClearStencil(0); }
      gl.glClear(0x100 | (color === null ? 0 : 0x4000) | (stencil ? 0x400 : 0));
    }
  }

  prepareGeometry(batch: DrawBatch): PreparedBackendDraw {
    this.opened();
    const arrays = packGeometry(batch);
    const state: RenderState = { ...batch.state, blend: { ...batch.state.blend },
      depthRange: [batch.state.depthRange[0], batch.state.depthRange[1]],
      polygonOffset: batch.state.polygonOffset === null ? null : { ...batch.state.polygonOffset } };
    const paired = batch.texturing === "pair";
    const environment = paired ? batch.secondTexture.environment : null;
    const mode = batch.primitive === "lines" ? 1 : 4;
    const lineWidth = batch.primitive === "lines" ? batch.lineWidth : 1;
    let phase: "prepared" | "active" | "drawn" | "cleaned" = "prepared";
    let nextUnit = 0;
    return {
      begin: () => {
        this.opened();
        if (phase !== "prepared" || this.activeArrays !== null) throw new Error("OpenGL prepared draw is already active");
        const atlas = batch.lighting.kind !== "vertex" && batch.lighting.atlas !== null
          ? this.textures.registered(batch.lighting.atlas.image) : null;
        if (atlas !== null && atlas.content.kind !== "depth32f") throw new Error("Q2 shadow atlas requires a depth32f image");
        this.drawTarget();
        this.state(state);
        this.identityMatrices();
        this.program.use(environment, state.alphaTest, batch.lighting);
        this.activeArrays = arrays;
        const gl = this.gl;
        gl.glEnableClientState(0x8074);
        gl.glEnableClientState(0x8076);
        if (arrays.positions.length > 0) {
          gl.glVertexPointer(4, 0x1406, 0, arrays.positions);
          gl.glColorPointer(4, 0x1406, 0, arrays.colors);
        }
        for (const [unit, coordinates] of [[2, arrays.worldPositions], [3, arrays.normals]] satisfies readonly (readonly [2 | 3, Float32Array])[]) {
          this.selectTexture(unit);
          if (coordinates.length > 0) {
            gl.glEnableClientState(0x8078);
            gl.glTexCoordPointer(3, 0x1406, 0, coordinates);
          } else gl.glDisableClientState(0x8078);
        }
        if (atlas !== null) {
          this.selectTexture(2);
          gl.glBindTexture(0xde1, atlas.name);
        }
        this.selectTexture(0);
        gl.glLineWidth(lineWidth);
        phase = "active";
      },
      applyTexture: (unit, operation) => {
        this.opened();
        if (phase !== "active" || unit !== nextUnit || unit !== 0 && unit !== 1 || unit === 1 && !paired)
          throw new Error("OpenGL prepared texture order is invalid");
        this.selectTexture(unit);
        this.textures.bind(operation);
        const coordinates = unit === 0 ? arrays.coordinates : arrays.coordinates2;
        this.gl.glEnableClientState(0x8078);
        if (coordinates.length > 0) this.gl.glTexCoordPointer(2, 0x1406, 0, coordinates);
        nextUnit++;
      },
      draw: () => {
        this.opened();
        if (phase !== "active" || nextUnit !== (paired ? 2 : 1)) throw new Error("OpenGL prepared draw has unapplied texture slots");
        if (arrays.indices.length > 0) this.gl.glDrawElements(mode, arrays.indices.length, 0x1405, arrays.indices);
        phase = "drawn";
      },
      cleanup: () => {
        if (phase === "cleaned") return;
        this.opened();
        if (phase === "prepared") { phase = "cleaned"; return; }
        this.disableArrays();
        this.gl.glLineWidth(1);
        phase = "cleaned";
      },
    };
  }

  private disableArrays(): void {
    this.gl.glDisableClientState(0x8074);
    this.gl.glDisableClientState(0x8076);
    for (const unit of [3, 2, 1, 0] satisfies readonly (0 | 1 | 2 | 3)[]) {
      this.selectTexture(unit);
      this.gl.glDisableClientState(0x8078);
    }
    this.activeArrays = null;
  }

  drawImmediate(operation: Exclude<RenderOperation, { readonly kind: "draw" }>): undefined {
    this.opened(); this.drawTarget();
    const gl = this.gl;
    switch (operation.kind) {
      case "q2-fog": {
        if (this.activeArrays !== null) throw new Error("OpenGL fog cannot interrupt a prepared draw");
        this.fog ??= new Q2FogPass(this.window, gl);
        this.fog.draw(operation, this.width, this.height);
        return;
      }
      case "depth-atlas": {
        if (this.activeArrays !== null) throw new Error("OpenGL depth atlas cannot interrupt a prepared draw");
        const texture = this.textures.registered(operation.image);
        if (texture.content.kind !== "depth32f") throw new Error("OpenGL depth atlas target requires a depth32f image");
        this.depthAtlas ??= new DepthAtlasTarget(this.window, gl, this.program);
        this.depthAtlas.draw(texture.name, operation.image.width, operation.image.height, operation.passes);
        return;
      }
      case "depth-range": this.depthRange(operation.range); return;
      case "cull": this.cull(operation.cull); return;
      case "polygon-offset": this.polygonOffset(operation.value); return;
      case "disable-portal-clip": gl.glDisable(0x3000); return;
      case "sky-side": {
        for (const strip of operation.strips) {
          if (strip.length < 2 || strip.length % 2 !== 0) throw new RangeError("OpenGL sky strips require paired row vertices");
          for (const { position, texCoord } of strip)
            if (![...positionValues(position), texCoord.x, texCoord.y].every(finite32)) throw new RangeError("OpenGL sky vertices must be finite");
        }
        this.identityMatrices();
        this.program.use(null, this.alphaTest);
        this.selectTexture(0);
        this.textures.bind({ kind: "bind-image", image: operation.image });
        gl.glColor4f(operation.color.x, operation.color.y, operation.color.z, operation.color.w);
        for (const strip of operation.strips) {
          gl.glBegin(5);
          for (const { position, texCoord } of strip) {
            gl.glTexCoord2f(texCoord.x, texCoord.y);
            gl.glVertex4f(position.x, position.y, position.z, position.w);
          }
          gl.glEnd();
        }
        return;
      }
      case "shadow-volume": case "shadow-finish": {
        if (this.stencilBits < 4) throw new Error("OpenGL stencil shadows require at least four stencil bits");
        for (const position of operation.positions)
          if (!positionValues(position).every(finite32)) throw new RangeError("OpenGL shadow positions must be finite");
        const positions = operation.kind === "shadow-finish" ? operation.positions : operation.indices.map(index => {
          const position = operation.positions[index];
          if (!Number.isInteger(index) || index < 0 || position === undefined) throw new RangeError("OpenGL shadow vertex index is invalid");
          return position;
        });
        if (operation.kind === "shadow-volume" && positions.length % 3 !== 0) throw new RangeError("OpenGL shadow triangles are incomplete");
        this.selectTexture(0);
        this.textures.bind({ kind: "bind-image", image: operation.whiteImage });
        this.identityMatrices();
        this.program.use(null, "none");
        this.alphaTest = "none";
        gl.glEnable(0xb71);
        gl.glDepthFunc(0x203);
        gl.glEnable(0xb90);
        const draw = (mode: number): void => {
          gl.glBegin(mode);
          for (const position of positions) gl.glVertex4f(position.x, position.y, position.z, position.w);
          gl.glEnd();
        };
        if (operation.kind === "shadow-finish") {
          gl.glStencilFunc(0x205, 0, 255);
          gl.glDisable(0x3000);
          gl.glDisable(0xb44);
          gl.glEnable(0xbe2);
          gl.glBlendFunc(0x306, 0);
          gl.glDepthMask(1);
          gl.glColor3f(0.6, 0.6, 0.6);
          draw(7);
          gl.glColor3f(1, 1, 1);
          gl.glDisable(0xb90);
        } else {
          gl.glEnable(0xb44);
          gl.glDisable(0xbe2);
          gl.glDepthMask(0);
          gl.glColor3f(0.2, 0.2, 0.2);
          gl.glColorMask(0, 0, 0, 0);
          gl.glStencilFunc(0x207, 1, 255);
          try {
            gl.glCullFace(operation.mirror ? 0x404 : 0x405);
            gl.glStencilOp(0x1e00, 0x1e00, 0x1e02); draw(4);
            gl.glCullFace(operation.mirror ? 0x405 : 0x404);
            gl.glStencilOp(0x1e00, 0x1e00, 0x1e03); draw(4);
          } finally { gl.glColorMask(1, 1, 1, 1); }
        }
        return;
      }
    }
  }

  clearColorBuffer(): undefined { this.opened(); this.drawTarget(); this.gl.glClear(0x4000); }

  drawShowImage(image: RendererImage, rect: Rect, proportional: boolean): undefined {
    this.opened(); this.drawTarget();
    this.textures.registered(image);
    const width = Math.fround(rect.width * (proportional ? image.width / 512 : 1));
    const height = Math.fround(rect.height * (proportional ? image.height / 512 : 1));
    if (![rect.x, rect.y, width, height, rect.x + width, rect.y + height].every(finite32))
      throw new RangeError("OpenGL image grid rectangle must be finite");
    const gl = this.gl;
    gl.glMatrixMode(0x1701); gl.glLoadIdentity(); gl.glOrtho(0, this.width, this.height, 0, 0, 1);
    gl.glMatrixMode(0x1700); gl.glLoadIdentity();
    this.program.use(null, this.alphaTest);
    this.selectTexture(0);
    this.textures.bind({ kind: "bind-image", image });
    gl.glColor4f(1, 1, 1, 1);
    gl.glBegin(7);
    gl.glTexCoord2f(0, 0); gl.glVertex2f(rect.x, rect.y);
    gl.glTexCoord2f(1, 0); gl.glVertex2f(rect.x + width, rect.y);
    gl.glTexCoord2f(1, 1); gl.glVertex2f(rect.x + width, rect.y + height);
    gl.glTexCoord2f(0, 1); gl.glVertex2f(rect.x, rect.y + height);
    gl.glEnd();
  }

  setOverdrawMeasurement(enabled: boolean): undefined {
    this.opened(); this.drawTarget();
    const gl = this.gl;
    if (!enabled) { gl.glDisable(0xb90); return; }
    if (this.stencilBits === 0) throw new Error("OpenGL overdraw measurement requires a stencil framebuffer");
    gl.glEnable(0xb90);
    gl.glStencilMask(0xffffffff);
    gl.glClearStencil(0);
    gl.glStencilFunc(0x207, 0, 0xffffffff);
    gl.glStencilOp(0x1e00, 0x1e02, 0x1e02);
  }

  readStencilOverdraw(destination: Uint8Array): undefined {
    this.opened(); this.drawTarget(false);
    const width = this.width, height = this.height;
    if (destination.length < width * height) throw new RangeError("OpenGL stencil destination is too small");
    withPixelStore(this.gl, "pack", () => this.gl.glReadPixels(0, 0, width, height, 0x1901, 0x1401, destination));
  }

  /** Absolute window coordinates use OpenGL's bottom-left origin, matching Q3 flares. */
  readDepthPixel(windowX: number, windowY: number): number {
    this.opened(); this.drawTarget(false);
    if (!Number.isInteger(windowX) || !Number.isInteger(windowY) || windowX < 0 || windowY < 0 || windowX >= this.width || windowY >= this.height)
      throw new RangeError("OpenGL depth coordinates are outside the framebuffer");
    const pixel = new Float32Array(1);
    withPixelStore(this.gl, "pack", () => this.gl.glReadPixels(windowX, windowY, 1, 1, 0x1902, 0x1406, pixel));
    const value = pixel[0];
    if (value === undefined) throw new Error("OpenGL depth pixel is unavailable");
    return value;
  }

  /** Returned RGBA pixels use top-left origin for SDL and captures. */
  readPixels(): Uint8Array {
    this.opened();
    if (this.outputGamma !== null) this.finish();
    const width = this.width, height = this.height;
    const pixels = new Uint8Array(width * height * 4), topDown = new Uint8Array(pixels.length);
    withPixelStore(this.gl, "pack", () => this.gl.glReadPixels(0, 0, width, height, 0x1908, 0x1401, pixels));
    for (let row = 0; row < height; row++)
      topDown.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), (height - row - 1) * width * 4);
    return topDown;
  }

  readDepthImage(image: RendererImage): DepthImageLevel {
    this.opened();
    const texture = this.textures.registered(image);
    if (texture.content.kind !== "depth32f") throw new Error("OpenGL depth readback requires a depth32f image");
    this.selectTexture(2);
    const previous = this.integer(0x8069), pixels = new Float32Array(image.width * image.height);
    try {
      this.gl.glBindTexture(0xde1, texture.name);
      withPixelStore(this.gl, "pack", () => this.gl.glGetTexImage(0xde1, 0, 0x1902, 0x1406, pixels));
    } finally { this.gl.glBindTexture(0xde1, previous); this.selectTexture(0); }
    return { width: image.width, height: image.height, pixels };
  }

  finish(): undefined {
    this.opened();
    if (this.outputGamma !== null) {
      if (this.activeArrays !== null) throw new Error("OpenGL gamma cannot interrupt a prepared draw");
      this.drawTarget(false);
      if (!this.gammaFinished) { this.outputGamma.finish(this.drawBuffer); this.gammaFinished = true; }
      else this.outputGamma.selectDefault(this.drawBuffer);
    }
    this.gl.glFinish();
  }
  getError(): number { this.opened(); return this.gl.glGetError(); }
  present(): void { this.opened(); this.window.swap(); }

  close(): undefined {
    if (this.closed) return;
    this.window.setRenderingEnabled(true);
    this.window.makeCurrent();
    this.disableArrays();
    this.outputGamma?.close(); this.outputGamma = null;
    this.depthAtlas?.close(); this.depthAtlas = null;
    this.fog?.close(); this.fog = null;
    this.textures.close();
    for (const unit of [3, 2, 1, 0] satisfies readonly (0 | 1 | 2 | 3)[]) { this.selectTexture(unit); this.gl.glBindTexture(0xde1, 0); }
    this.program.close();
    this.library.close();
    this.closed = true;
    activeContexts.delete(this.window);
  }

  [Symbol.dispose](): void { this.close(); }
}
