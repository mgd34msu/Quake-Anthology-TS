import { resolveDrawTextures } from "../../render/commands/dynamic-texture.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { DrawBatch, ImageResourceOperation, RenderCommand, RendererBackend, RendererResourceOwner, RenderFrame, RenderOperation } from "../../contracts/render.ts";
import { SdlWindow } from "../../platform/sdl.ts";
import { SoftwareRenderer } from "../../render/cpu/index.ts";
import { GlRenderer } from "../../render/gl/index.ts";
import type { ApplicationOptions } from "./options.ts";

interface ResidentImage {
  readonly creation: Extract<ImageResourceOperation, { readonly kind: "create-image" }>;
  readonly updates: Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>;
}

/** Owns one native window and consumes the same ordered frame on either renderer. */
export class NativeRenderer {
  private current: SoftwareRenderer | GlRenderer;
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
  private readonly resident = new Map<number, ResidentImage>();
  private textureMode: Extract<ImageResourceOperation, { readonly kind: "texture-mode" }> | null = null;
  private closed = false;
  private readonly captures: { readonly resolve: (pixels: Uint8Array) => void; readonly reject: (reason: Error) => void }[] = [];

  private constructor(readonly window: SdlWindow, readonly owner: RendererResourceOwner, backend: SoftwareRenderer | GlRenderer, private gamma: number) {
    this.current = backend;
  }

  static open(options: Pick<ApplicationOptions, "renderer" | "width" | "height" | "hidden" | "gamma">, owner: RendererResourceOwner): NativeRenderer {
    const window = SdlWindow.open({ title: "Quake", backend: options.renderer, width: options.width, height: options.height,
      hidden: options.hidden, resizable: true });
    let backend: SoftwareRenderer | GlRenderer | null = null;
    try {
      backend = options.renderer === "cpu" ? new SoftwareRenderer(window.width, window.height, owner) : new GlRenderer(window, owner);
      backend.setOutputGamma(options.gamma);
      if (options.renderer === "gl") window.setSwapInterval(1);
      return new NativeRenderer(window, owner, backend, options.gamma);
    } catch (error) {
      try { backend?.close(); } finally { window.close(); }
      throw error;
    }
  }

  get backend(): RendererBackend { return this.current; }
  get outputGamma(): number { return this.gamma; }
  setOutputGamma(gamma: number): void { this.current.setOutputGamma(gamma); this.gamma = gamma; }

  private resize(): void {
    if (!(this.current instanceof SoftwareRenderer)) return;
    const { width, height } = this.window.drawableSize;
    if (width === this.current.width && height === this.current.height) return;
    const replacement = new SoftwareRenderer(width, height, this.owner);
    replacement.setOutputGamma(this.gamma);
    try {
      for (const record of this.resident.values()) {
        replacement.applyImageResource(record.creation);
        for (const update of record.updates.values()) replacement.applyImageResource(update);
      }
      if (this.textureMode !== null) replacement.applyImageResource(this.textureMode);
    } catch (error) { replacement.close(); throw error; }
    this.current.close();
    this.current = replacement;
  }

  private image(operation: ImageResourceOperation): void {
    this.current.applyImageResource(operation);
    switch (operation.kind) {
      case "create-image": {
        const updates: ResidentImage["updates"] = new Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>();
        this.resident.set(operation.image.ordinal, { creation: operation, updates }); break;
      }
      case "update-image": {
        const record = this.resident.get(operation.image.ordinal);
        if (record === undefined) throw new Error("Renderer update has no resident image");
        record.updates.set(operation.level, operation); break;
      }
      case "release-image": this.resident.delete(operation.image.ordinal); break;
      case "texture-mode": this.textureMode = operation; break;
    }
  }

  private draw(input: DrawBatch): void {
    const batch = resolveDrawTextures(input, operation => this.image(operation));
    const prepared = this.current.prepareGeometry(batch);
    try {
      prepared.begin();
      prepared.applyTexture(0, batch.texture);
      if (batch.texturing === "pair") prepared.applyTexture(1, batch.secondTexture.binding);
      prepared.draw();
    } finally { prepared.cleanup(); }
  }

  private operations(operations: readonly RenderOperation[]): void {
    for (const operation of operations) {
      if (operation.kind === "draw") for (const batch of operation.batches) this.draw(batch);
      else if (operation.kind === "object-opacity") this.current.withObjectOpacity(operation.opacity, () => {
        for (const batch of operation.batches) this.draw(batch);
        return undefined;
      });
      else this.current.drawImmediate(operation);
    }
  }

  private picture(command: Extract<RenderCommand, { readonly kind: "stretch-pic" }>): void {
    const { width, height } = this.current;
    this.current.beginView({ viewport: { x: 0, y: 0, width, height }, clear: null, clipPlane: null });
    const left = command.rect.x / width * 2 - 1, right = (command.rect.x + command.rect.width) / width * 2 - 1;
    const top = 1 - command.rect.y / height * 2, bottom = 1 - (command.rect.y + command.rect.height) / height * 2;
    this.draw({ primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image: command.image }, lighting: { kind: "vertex" },
      vertices: [
        { position: { x: left, y: top, z: 0, w: 1 }, texCoord: { x: command.uv.s1, y: command.uv.t1 }, color: this.color },
        { position: { x: right, y: top, z: 0, w: 1 }, texCoord: { x: command.uv.s2, y: command.uv.t1 }, color: this.color },
        { position: { x: right, y: bottom, z: 0, w: 1 }, texCoord: { x: command.uv.s2, y: command.uv.t2 }, color: this.color },
        { position: { x: left, y: bottom, z: 0, w: 1 }, texCoord: { x: command.uv.s1, y: command.uv.t2 }, color: this.color },
      ], indices: [0, 1, 2, 0, 2, 3], state: { blend: { source: "src-alpha", destination: "one-minus-src-alpha" },
        depthTest: "always", depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } });
  }

  execute(frame: RenderFrame): undefined {
    if (this.closed) throw new Error("Native renderer is closed");
    if (frame.owner.identity !== this.owner.identity || frame.owner.session !== this.owner.session || frame.owner.generation !== this.owner.generation)
      throw new Error("Frame belongs to another renderer lifetime");
    this.resize();
    for (const command of frame.commands) {
      switch (command.kind) {
        case "draw-buffer": this.current.selectDrawBuffer(command.buffer, command.clear); break;
        case "image-resource": this.image(command.operation); break;
        case "set-color": this.color = command.color; break;
        case "stretch-pic": this.picture(command); break;
        case "view":
          this.operations(command.view.beforeView);
          this.current.beginView(command.view);
          this.operations(command.view.operations);
          break;
        case "swap-buffers":
          this.current.finish();
          if (this.captures.length !== 0) {
            const pixels = this.current instanceof SoftwareRenderer ? this.current.pixels : this.current.readPixels();
            for (const capture of this.captures.splice(0)) capture.resolve(pixels.slice());
          }
          if (this.current instanceof SoftwareRenderer) this.window.present(this.current.pixels);
          else this.current.present();
          break;
      }
    }
    return undefined;
  }

  readPixels(): Uint8Array {
    if (!(this.current instanceof SoftwareRenderer)) throw new Error("GL captures must be requested before presentation with captureNextFrame()");
    this.current.finish();
    return this.current.pixels.slice();
  }

  captureNextFrame(signal?: AbortSignal): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new Error("Native renderer is closed"));
    const abortReason = (): Error => { const reason: unknown = signal?.reason; return reason instanceof Error ? reason : new Error("Frame capture aborted"); };
    if (signal?.aborted) return Promise.reject(abortReason());
    return new Promise((resolve, reject) => {
      const clear = (): void => { signal?.removeEventListener("abort", abort); };
      const capture = { resolve: (pixels: Uint8Array): void => { clear(); resolve(pixels); },
        reject: (reason: Error): void => { clear(); reject(reason); } };
      const abort = (): void => {
        const index = this.captures.indexOf(capture);
        if (index >= 0) this.captures.splice(index, 1);
        capture.reject(abortReason());
      };
      this.captures.push(capture);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    for (const capture of this.captures.splice(0)) capture.reject(new Error("Renderer closed before the requested frame was presented"));
    try { this.current.close(); }
    finally { this.resident.clear(); this.window.close(); }
    return undefined;
  }
}
