import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { resolveDrawTextures } from "../../render/commands/dynamic-texture.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { DrawBatch, ImageResourceOperation, RenderCommand, RendererBackend, RendererResourceOwner, RenderFrame, RenderOperation, RenderImage } from "../../contracts/render.ts";
import { SdlWindow, type SdlDisplayMode } from "../../platform/sdl.ts";
import { SoftwareRenderer } from "../../render/cpu/index.ts";
import { GlRenderer } from "../../render/gl/index.ts";
import type { ApplicationOptions } from "./options.ts";

interface ResidentImage {
  beforeTextureMode: boolean;
  readonly creation: Extract<ImageResourceOperation, { readonly kind: "create-image" }>;
  readonly updates: Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>;
}

export interface RendererDiagnostics {
  readonly backend: "cpu" | "gl";
  readonly width: number;
  readonly height: number;
  readonly driver: GlRenderer["driver"] | null;
  readonly displayModes: readonly SdlDisplayMode[];
  readonly images: readonly { readonly ordinal: number; readonly name: string; readonly width: number; readonly height: number;
    readonly encoding: RenderImage["kind"]; readonly mipLevels: number }[];
}

export interface PreparedRendererRestart {
  readonly window: SdlWindow;
  readonly backend: RendererBackend;
  readonly published: boolean;
  publish(): () => void;
  discard(): void;
}

function snapshotImage(content: RenderImage): RenderImage {
  if (content.kind === "depth32f") {
    const [first, ...rest] = content.levels;
    return { ...content, levels: [{ ...first, pixels: first.pixels.slice() }, ...rest.map(level => ({ ...level, pixels: level.pixels.slice() }))] };
  }
  const [first, ...rest] = content.levels;
  const levels: typeof content.levels = [{ ...first, pixels: first.pixels.slice() }, ...rest.map(level => ({ ...level, pixels: level.pixels.slice() }))];
  return content.kind === "rgba8" ? { ...content, levels, borderColor: { ...content.borderColor } }
    : { ...content, levels, palette: { ...content.palette, colors: content.palette.colors.slice() }, translation: content.translation?.slice() ?? null,
      transparency: { ...content.transparency }, fullbright: content.fullbright === null ? null : { ...content.fullbright } };
}

/** Owns one native window and consumes the same ordered frame on either renderer. */
export class NativeRenderer {
  private current: SoftwareRenderer | GlRenderer;
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
  private readonly resident = new Map<number, ResidentImage>();
  private textureMode: Extract<ImageResourceOperation, { readonly kind: "texture-mode" }> | null = null;
  private closed = false;
  private pendingRestart: PreparedRendererRestart | null = null;
  private readonly retirements = new Set<() => void>();
  private interval: -1 | 0 | 1 = 1;
  private readonly captures: { readonly resolve: (pixels: Uint8Array) => void; readonly reject: (reason: Error) => void }[] = [];

  private constructor(private currentWindow: SdlWindow, readonly owner: RendererResourceOwner, backend: SoftwareRenderer | GlRenderer, private gamma: number, readonly images: SceneImageRegistry) {
    this.current = backend;
  }

  static open(options: Pick<ApplicationOptions, "renderer" | "width" | "height" | "hidden" | "gamma">, owner: RendererResourceOwner, images: SceneImageRegistry = new SceneImageRegistry(owner)): NativeRenderer {
    if (images.owner !== owner) throw new Error("Renderer image registry belongs to another owner");
    const window = SdlWindow.open({ title: "Quake", backend: options.renderer, width: options.width, height: options.height,
      hidden: options.hidden, resizable: true });
    let backend: SoftwareRenderer | GlRenderer | null = null;
    try {
      backend = options.renderer === "cpu" ? new SoftwareRenderer(window.width, window.height, owner) : new GlRenderer(window, owner);
      backend.setOutputGamma(options.gamma);
      if (options.renderer === "gl") window.setSwapInterval(1);
      return new NativeRenderer(window, owner, backend, options.gamma, images);
    } catch (error) {
      try { backend?.close(); } finally { window.close(); }
      throw error;
    }
  }

  get window(): SdlWindow { return this.currentWindow; }

  private writable(): void {
    if (this.closed) throw new Error("Native renderer is closed");
    if (this.pendingRestart !== null) throw new Error("Native renderer restart is prepared");
  }

  private replay(backend: SoftwareRenderer | GlRenderer): void {
    const upload = (record: ResidentImage): void => {
      backend.applyImageResource(record.creation);
      for (const update of record.updates.values()) backend.applyImageResource(update);
    };
    for (const record of this.resident.values()) if (record.beforeTextureMode) upload(record);
    if (this.textureMode !== null) backend.applyImageResource(this.textureMode);
    for (const record of this.resident.values()) if (!record.beforeTextureMode) upload(record);
  }

  prepareRestart(kind: "cpu" | "gl"): PreparedRendererRestart {
    this.writable();
    for (const operation of this.images.drainPendingOperations()) this.image(operation);
    const previousWindow = this.window, previousBackend = this.current, presentation = previousWindow.capturePresentation();
    const dimensions = previousWindow.drawableSize;
    if (previousWindow.backend === "gl") {
      const interval = previousWindow.swapInterval;
      if (interval !== -1 && interval !== 0 && interval !== 1) throw new Error("SDL returned an unsupported swap interval");
      this.interval = interval;
    }
    const restoreContext = (): void => { if (!this.closed && this.window.backend === "gl") this.window.makeCurrent(); };
    let window: SdlWindow | null = null, backend: SoftwareRenderer | GlRenderer | null = null;
    try {
      window = SdlWindow.open({ title: "Quake", backend: kind, width: presentation.size.width, height: presentation.size.height,
        hidden: true, resizable: (previousWindow.flags & 0x20) !== 0, displayIndex: presentation.displayIndex, position: presentation.position });
      backend = kind === "cpu" ? new SoftwareRenderer(window.width, window.height, this.owner) : new GlRenderer(window, this.owner);
      backend.setOutputGamma(this.gamma);
      if (kind === "gl") window.setSwapInterval(this.interval);
      this.replay(backend);
      if (window.width !== dimensions.width || window.height !== dimensions.height) throw new Error("Prepared renderer drawable dimensions changed");
      restoreContext();
    } catch (error) {
      const errors: unknown[] = [error];
      try { backend?.close(); } catch (failure) { errors.push(failure); }
      try { window?.close(); } catch (failure) { errors.push(failure); }
      try { restoreContext(); } catch (failure) { errors.push(failure); }
      if (errors.length > 1) throw new AggregateError(errors, "Renderer restart preparation and cleanup failed");
      throw error;
    }
    const dispose = (window: SdlWindow, backend: SoftwareRenderer | GlRenderer): void => {
      const errors: unknown[] = [];
      try { if (window.backend === "gl") window.makeCurrent(); } catch (error) { errors.push(error); }
      try { backend.close(); } catch (error) { errors.push(error); }
      try { window.close(); } catch (error) { errors.push(error); }
      try { restoreContext(); } catch (error) { errors.push(error); }
      if (errors.length !== 0) throw new AggregateError(errors, "Renderer resource retirement failed");
    };
    const candidateWindow = window, candidateBackend = backend;
    let phase: "prepared" | "published" | "discarded" = "prepared", retired = false;
    const retire = (): void => {
      if (retired) return;
      retired = true;
      this.retirements.delete(retire);
      dispose(previousWindow, previousBackend);
    };
    const prepared: PreparedRendererRestart = {
      window: candidateWindow, backend: candidateBackend,
      get published() { return phase === "published"; },
      publish: () => {
        if (phase !== "prepared" || this.pendingRestart !== prepared || this.closed) throw new Error("Renderer restart is no longer prepared");
        try {
          candidateWindow.restorePresentation(presentation);
          if (kind === "gl") candidateWindow.makeCurrent();
          previousWindow.setVisible(false);
        } catch (error) {
          const errors: unknown[] = [error];
          try { candidateWindow.setVisible(false); } catch (failure) { errors.push(failure); }
          try { previousWindow.restorePresentation(presentation); } catch (failure) { errors.push(failure); }
          try { restoreContext(); } catch (failure) { errors.push(failure); }
          if (errors.length > 1) throw new AggregateError(errors, "Renderer restart publication and restoration failed");
          throw error;
        }
        this.currentWindow = candidateWindow;
        this.current = candidateBackend;
        phase = "published";
        this.pendingRestart = null;
        this.retirements.add(retire);
        return retire;
      },
      discard: () => {
        if (phase !== "prepared") return;
        phase = "discarded";
        this.pendingRestart = null;
        dispose(candidateWindow, candidateBackend);
      },
    };
    this.pendingRestart = prepared;
    return prepared;
  }

  get backend(): RendererBackend { return this.current; }
  get outputGamma(): number { return this.gamma; }
  diagnostics(): RendererDiagnostics {
    if (this.closed) throw new Error("Native renderer is closed");
    const backend = this.current;
    return { backend: backend instanceof GlRenderer ? "gl" : "cpu", width: backend.width, height: backend.height,
      driver: backend instanceof GlRenderer ? { ...backend.driver } : null,
      displayModes: this.currentWindow.displayModes.map(mode => ({ ...mode })),
      images: [...this.resident.values()].map(({ creation, updates }) => {
        const level = updates.get(0)?.content ?? creation.content.levels[0];
        return { ordinal: creation.image.ordinal, name: creation.image.source.kind === "generated" ? creation.image.source.name : creation.image.source.resource.requestedPath,
          width: level.width, height: level.height,
          encoding: creation.content.kind, mipLevels: creation.content.levels.length };
      }) };
  }
  setOutputGamma(gamma: number): void { this.writable(); this.current.setOutputGamma(gamma); this.gamma = gamma; }

  private resize(): void {
    if (!(this.current instanceof SoftwareRenderer)) return;
    const { width, height } = this.window.drawableSize;
    if (width === this.current.width && height === this.current.height) return;
    const replacement = new SoftwareRenderer(width, height, this.owner);
    replacement.setOutputGamma(this.gamma);
    try {
      this.replay(replacement);
    } catch (error) { replacement.close(); throw error; }
    this.current.close();
    this.current = replacement;
  }

  private image(operation: ImageResourceOperation): void {
    this.current.applyImageResource(operation);
    switch (operation.kind) {
      case "create-image": {
        const updates: ResidentImage["updates"] = new Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>();
        this.resident.set(operation.image.ordinal, { creation: { ...operation, content: snapshotImage(operation.content), sampling: { ...operation.sampling } }, updates, beforeTextureMode: false }); break;
      }
      case "update-image": {
        const record = this.resident.get(operation.image.ordinal);
        if (record === undefined) throw new Error("Renderer update has no resident image");
        const content = operation.content;
        record.updates.set(operation.level, content.pixels instanceof Float32Array
          ? { ...operation, content: { ...content, pixels: content.pixels.slice() } }
          : { ...operation, content: { ...content, pixels: content.pixels.slice() } }); break;
      }
      case "release-image": this.resident.delete(operation.image.ordinal); break;
      case "texture-mode": this.textureMode = operation; for (const record of this.resident.values()) record.beforeTextureMode = true; break;
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
    this.writable();
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
          if (this.current instanceof SoftwareRenderer) this.current.finish();
          if (this.captures.length !== 0) {
            const pixels = this.current instanceof SoftwareRenderer ? this.current.pixels : this.current.readPixels();
            for (const capture of this.captures.splice(0)) capture.resolve(pixels.slice());
          }
          if (this.current instanceof SoftwareRenderer) this.window.present(this.current.pixels);
          else this.current.present();
          break;
      }
    }
    for (const operation of this.images.drainPendingOperations()) this.image(operation);
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
    const errors: unknown[] = [];
    try { this.pendingRestart?.discard(); } catch (error) { errors.push(error); }
    for (const capture of this.captures.splice(0)) {
      try { capture.reject(new Error("Renderer closed before the requested frame was presented")); } catch (error) { errors.push(error); }
    }
    try { this.images.close(); } catch (error) { errors.push(error); }
    try { if (this.currentWindow.backend === "gl") this.currentWindow.makeCurrent(); } catch (error) { errors.push(error); }
    try { this.current.close(); } catch (error) { errors.push(error); }
    try { this.images.drainPendingOperations(); } catch (error) { errors.push(error); }
    this.resident.clear();
    try { this.window.close(); } catch (error) { errors.push(error); }
    for (const retire of this.retirements) {
      try { retire(); } catch (error) { errors.push(error); }
    }
    if (errors.length !== 0) throw new AggregateError(errors, "Native renderer cleanup failed");
    return undefined;
  }
}
