import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { RenderExecutor } from "../../render/execution.ts";
import { RenderImageJournal } from "../../render/image-journal.ts";
import { WorkerRenderer } from "../../render/worker.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { ImageLevel, ImageResourceOperation, RendererBackend, RendererResourceOwner, RenderFrame, RenderImage } from "../../contracts/render.ts";
import { SdlWindow, type SdlDisplayMode } from "../../platform/sdl.ts";
import { SoftwareRenderer } from "../../render/cpu/index.ts";
import { GlRenderer } from "../../render/gl/index.ts";
import type { ApplicationOptions } from "./options.ts";

type NativeBackend = SoftwareRenderer | GlRenderer | WorkerRenderer;
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

class FrameCaptures {
  private nextId = 1;
  private armed: number[] = [];
  private failure: Error | null = null;
  private readonly pending = new Map<number, { resolve(image: ImageLevel): void; reject(error: Error): void }>();
  take(): readonly number[] { const armed = this.armed; this.armed = []; return armed; }
  complete(image: ImageLevel | null, ids: readonly number[]): void {
    if (ids.length !== 0 && image === null) throw new Error("Renderer capture has no pixels");
    if (image === null) return;
    for (const id of ids) {
      const capture = this.pending.get(id); this.pending.delete(id);
      capture?.resolve({ width: image.width, height: image.height, pixels: image.pixels.slice() });
    }
  }
  request(signal?: AbortSignal): Promise<ImageLevel> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const reason = (): Error => { const value: unknown = signal?.reason; return value instanceof Error ? value : new Error("Frame capture aborted"); };
    if (signal?.aborted) return Promise.reject(reason());
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const clear = (): void => { signal?.removeEventListener("abort", abort); };
      const abort = (): void => {
        this.pending.delete(id); this.armed = this.armed.filter(value => value !== id); clear(); reject(reason());
      };
      this.pending.set(id, { resolve: image => { clear(); resolve(image); }, reject: error => { clear(); reject(error); } });
      this.armed.push(id); signal?.addEventListener("abort", abort, { once: true });
    });
  }
  close(): void {
    this.fail(new Error("Renderer closed before the requested frame was presented"));
  }
  fail(reason: unknown): void {
    this.failure ??= reason instanceof Error ? reason : new Error(String(reason));
    for (const capture of this.pending.values()) capture.reject(this.failure);
    this.pending.clear(); this.armed = [];
  }
}

async function openBackend(window: SdlWindow, owner: RendererResourceOwner, gamma: number, worker: boolean,
  images: SceneImageRegistry, journal: RenderImageJournal, captures: FrameCaptures, failed: (error: unknown) => void): Promise<NativeBackend> {
  if (worker) return WorkerRenderer.open(window, owner, gamma, images, journal, (image, ids) => {
    captures.complete(image, ids);
    if (window.backend === "cpu") {
      if (image === null) throw new Error("CPU renderer presentation has no pixels");
      window.present(image.pixels);
    }
  }, failed);
  const backend = window.backend === "cpu" ? new SoftwareRenderer(window.width, window.height, owner) : new GlRenderer(window, owner);
  try { backend.setOutputGamma(gamma); return backend; } catch (error) { backend.close(); throw error; }
}

/** Owns the native surface, image identity, and ordered serial or worker execution. */
export class NativeRenderer {
  private readonly executor: RenderExecutor;
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
  private closed = false;
  private preparing = false;
  private pendingRestart: PreparedRendererRestart | null = null;
  private readonly retirements = new Set<() => void>();
  private interval: -1 | 0 | 1 = 1;

  private constructor(private currentWindow: SdlWindow, readonly owner: RendererResourceOwner, private current: NativeBackend,
    private gamma: number, readonly images: SceneImageRegistry, private journal: RenderImageJournal, private readonly captures: FrameCaptures) {
    this.executor = new RenderExecutor(current, {
      imageApplied: operation => this.journal.record(operation),
      swap: ids => this.swap(ids),
    });
  }

  static async open(options: Pick<ApplicationOptions, "renderer" | "width" | "height" | "hidden" | "gamma"> & { readonly renderWorker?: boolean },
    owner: RendererResourceOwner, images: SceneImageRegistry = new SceneImageRegistry(owner)): Promise<NativeRenderer> {
    if (images.owner !== owner) throw new Error("Renderer image registry belongs to another owner");
    const window = WorkerRenderer.withParkedContexts(() => SdlWindow.open({ title: "Quake", backend: options.renderer, width: options.width, height: options.height,
      hidden: options.hidden, resizable: true }));
    const journal = new RenderImageJournal(), captures = new FrameCaptures();
    let backend: NativeBackend | null = null;
    let renderer: NativeRenderer | null = null;
    try {
      if (options.renderer === "gl") window.setSwapInterval(1);
      backend = await openBackend(window, owner, options.gamma, options.renderWorker ?? false, images, journal, captures,
        error => { if (renderer?.current === backend) captures.fail(error); });
      renderer = new NativeRenderer(window, owner, backend, options.gamma, images, journal, captures);
      return renderer;
    } catch (error) {
      const failures: unknown[] = [error];
      try { backend?.close(); } catch (cleanup) { failures.push(cleanup); }
      try { WorkerRenderer.withParkedContexts(() => window.close()); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length > 1) throw new AggregateError(failures, "Renderer opening and cleanup failed");
      throw error;
    }
  }

  get window(): SdlWindow { return this.currentWindow; }
  get backend(): RendererBackend { return this.current; }
  get renderWorker(): boolean { return this.current instanceof WorkerRenderer; }
  get driver(): GlRenderer["driver"] | null { return this.current instanceof WorkerRenderer ? this.current.description.driver : this.current instanceof GlRenderer ? this.current.driver : null; }
  get glConfig(): Pick<GlRenderer, "maxTextureSize" | "textureUnits" | "colorBits" | "depthBits" | "stereoEnabled"> | null {
    return this.current instanceof WorkerRenderer ? this.current.description.glConfig : this.current instanceof GlRenderer ? this.current : null;
  }
  get swapInterval(): -1 | 0 | 1 {
    if (this.current instanceof WorkerRenderer) return this.current.description.swapInterval;
    if (this.window.backend !== "gl") return 0;
    const interval = this.window.swapInterval;
    if (interval !== -1 && interval !== 0 && interval !== 1) throw new Error("SDL returned an unsupported swap interval");
    return interval;
  }
  setSwapInterval(interval: -1 | 0 | 1): void {
    this.writable();
    if (this.current instanceof WorkerRenderer) this.current.setSwapInterval(interval);
    else if (this.window.backend === "gl") this.window.setSwapInterval(interval);
    this.interval = interval;
  }
  mutateWindow(operation: () => void): void { this.writable(); WorkerRenderer.withParkedContexts(operation); }
  get outputGamma(): number { return this.gamma; }
  synchronize(): void { if (this.current instanceof WorkerRenderer) this.current.synchronize(); }

  private writable(): void {
    if (this.closed) throw new Error("Native renderer is closed");
    if (this.preparing || this.pendingRestart !== null) throw new Error("Native renderer restart is prepared");
  }
  private image(operation: ImageResourceOperation): void {
    if (this.current instanceof WorkerRenderer) this.current.applyImageResource(operation);
    else this.executor.image(operation);
  }

  async prepareRestart(kind: "cpu" | "gl", worker = this.renderWorker): Promise<PreparedRendererRestart> {
    this.writable(); this.synchronize();
    for (const operation of this.images.drainPendingOperations()) this.image(operation);
    const previousWindow = this.window, previousBackend = this.current, previousJournal = this.journal;
    const presentation = previousWindow.capturePresentation(), dimensions = previousWindow.drawableSize;
    if (previousWindow.backend === "gl") this.interval = this.swapInterval;
    this.preparing = true;
    const restoreContext = (): void => { if (!this.closed && !this.renderWorker && this.window.backend === "gl") this.window.makeCurrent(); };
    let window: SdlWindow | null = null, backend: NativeBackend | null = null;
    const journal = new RenderImageJournal();
    try {
      window = WorkerRenderer.withParkedContexts(() => SdlWindow.open({ title: "Quake", backend: kind, width: presentation.size.width, height: presentation.size.height,
        hidden: true, resizable: (previousWindow.flags & 0x20) !== 0, displayIndex: presentation.displayIndex, position: presentation.position }));
      if (kind === "gl") window.setSwapInterval(this.interval);
      backend = await openBackend(window, this.owner, this.gamma, worker, this.images, journal, this.captures,
        error => { if (this.current === backend) this.captures.fail(error); });
      previousJournal.replay(backend);
      if (!(backend instanceof WorkerRenderer)) {
        // Serial backend calls have no transport acknowledgment; retain the same successful journal.
        previousJournal.replay({ applyImageResource: operation => { journal.record(operation); return undefined; } });
      } else {
        backend.execute([{ kind: "set-color", color: this.color }], [], []); backend.synchronize();
      }
      if (window.width !== dimensions.width || window.height !== dimensions.height) throw new Error("Prepared renderer drawable dimensions changed");
      if (this.closed) throw new Error("Renderer closed during restart preparation");
      restoreContext();
    } catch (error) {
      this.preparing = false;
      const errors: unknown[] = [error];
      try { backend?.close(); } catch (failure) { errors.push(failure); }
      try { WorkerRenderer.withParkedContexts(() => window?.close()); } catch (failure) { errors.push(failure); }
      try { restoreContext(); } catch (failure) { errors.push(failure); }
      if (errors.length > 1) throw new AggregateError(errors, "Renderer restart preparation and cleanup failed");
      throw error;
    }
    const dispose = (window: SdlWindow, backend: NativeBackend): void => WorkerRenderer.withParkedContexts(() => {
      const errors: unknown[] = [];
      try { if (window.backend === "gl" && !(backend instanceof WorkerRenderer)) window.makeCurrent(); } catch (error) { errors.push(error); }
      try { backend.close(); } catch (error) { errors.push(error); }
      try { window.close(); } catch (error) { errors.push(error); }
      try { restoreContext(); } catch (error) { errors.push(error); }
      if (errors.length !== 0) throw new AggregateError(errors, "Renderer resource retirement failed");
    });
    const candidateWindow = window, candidateBackend = backend;
    let phase: "prepared" | "published" | "discarded" = "prepared", retired = false;
    const retire = (): void => {
      if (retired) return;
      dispose(previousWindow, previousBackend);
      retired = true; this.retirements.delete(retire);
    };
    const prepared: PreparedRendererRestart = {
      window: candidateWindow, backend: candidateBackend,
      get published() { return phase === "published"; },
      publish: () => {
        if (phase !== "prepared" || this.pendingRestart !== prepared || this.closed) throw new Error("Renderer restart is no longer prepared");
        try {
          WorkerRenderer.withParkedContexts(() => {
            candidateWindow.restorePresentation(presentation);
            if (kind === "gl" && !(candidateBackend instanceof WorkerRenderer)) candidateWindow.makeCurrent();
            previousWindow.setVisible(false);
          });
        } catch (error) {
          const errors: unknown[] = [error];
          try { candidateWindow.setVisible(false); } catch (failure) { errors.push(failure); }
          try { WorkerRenderer.withParkedContexts(() => previousWindow.restorePresentation(presentation)); } catch (failure) { errors.push(failure); }
          try { restoreContext(); } catch (failure) { errors.push(failure); }
          if (errors.length > 1) throw new AggregateError(errors, "Renderer restart publication and restoration failed");
          throw error;
        }
        this.currentWindow = candidateWindow; this.current = candidateBackend; this.journal = journal;
        this.executor.replaceBackend(candidateBackend);
        this.executor.execute({ kind: "set-color", color: this.color });
        phase = "published"; this.pendingRestart = null; this.retirements.add(retire);
        return retire;
      },
      discard: () => {
        if (phase !== "prepared") return;
        dispose(candidateWindow, candidateBackend);
        phase = "discarded"; this.pendingRestart = null;
      },
    };
    this.preparing = false; this.pendingRestart = prepared;
    return prepared;
  }

  diagnostics(): RendererDiagnostics {
    if (this.closed) throw new Error("Native renderer is closed");
    this.synchronize();
    return { backend: this.window.backend, width: this.current.width, height: this.current.height, driver: this.driver,
      displayModes: this.window.displayModes.map(mode => ({ ...mode })), images: this.journal.describe() };
  }
  setOutputGamma(gamma: number): void { this.writable(); this.current.setOutputGamma(gamma); this.gamma = gamma; }

  private resize(): void {
    if (this.current instanceof GlRenderer) return;
    const { width, height } = this.window.drawableSize;
    if (this.current instanceof WorkerRenderer) { this.current.resize(width, height); return; }
    if (width === this.current.width && height === this.current.height) return;
    const replacement = new SoftwareRenderer(width, height, this.owner);
    replacement.setOutputGamma(this.gamma);
    try { this.journal.replay(replacement); } catch (error) { replacement.close(); throw error; }
    this.current.close(); this.current = replacement; this.executor.replaceBackend(replacement);
  }
  private swap(ids: readonly number[]): void {
    if (this.current instanceof WorkerRenderer) throw new Error("Worker swaps execute on their owning thread");
    if (this.current instanceof SoftwareRenderer) this.current.finish();
    if (ids.length !== 0) this.captures.complete({ width: this.current.width, height: this.current.height,
      pixels: this.current instanceof SoftwareRenderer ? this.current.pixels : this.current.readPixels() }, ids);
    if (this.current instanceof SoftwareRenderer) this.window.present(this.current.pixels);
    else this.current.present();
  }
  execute(frame: RenderFrame): undefined {
    this.writable();
    if (frame.owner.identity !== this.owner.identity || frame.owner.session !== this.owner.session || frame.owner.generation !== this.owner.generation)
      throw new Error("Frame belongs to another renderer lifetime");
    this.resize();
    if (this.current instanceof WorkerRenderer) {
      const captures = frame.commands.some(command => command.kind === "swap-buffers") ? this.captures.take() : [];
      this.current.execute(frame.commands, captures, this.images.drainPendingOperations());
      for (const command of frame.commands) if (command.kind === "set-color") this.color = { ...command.color };
    } else {
      for (const command of frame.commands) {
        if (command.kind === "set-color") this.color = command.color;
        this.executor.execute(command.kind === "swap-buffers" ? { kind: "swap-buffers", captures: this.captures.take() } : command);
      }
      for (const operation of this.images.drainPendingOperations()) this.image(operation);
    }
    return undefined;
  }
  readPixels(): Uint8Array {
    if (this.window.backend !== "cpu") throw new Error("GL captures must be requested before presentation with captureNextFrame()");
    if (this.current instanceof WorkerRenderer) return this.current.readPixels().pixels;
    if (!(this.current instanceof SoftwareRenderer)) throw new Error("CPU renderer backend is unavailable");
    this.current.finish(); return this.current.pixels.slice();
  }
  captureNextFrame(signal?: AbortSignal): Promise<ImageLevel> {
    return this.closed ? Promise.reject(new Error("Native renderer is closed")) : this.captures.request(signal);
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const errors: unknown[] = [];
    try { this.pendingRestart?.discard(); } catch (error) { errors.push(error); }
    this.captures.close();
    try { if (this.currentWindow.backend === "gl" && !(this.current instanceof WorkerRenderer)) this.currentWindow.makeCurrent(); } catch (error) { errors.push(error); }
    try { this.current.close(); } catch (error) { errors.push(error); }
    try { this.images.close(); this.images.drainPendingOperations(); } catch (error) { errors.push(error); }
    this.journal.clear();
    try { WorkerRenderer.withParkedContexts(() => this.window.close()); } catch (error) { errors.push(error); }
    for (const retire of this.retirements) { try { retire(); } catch (error) { errors.push(error); } }
    if (errors.length !== 0) throw new AggregateError(errors, "Native renderer cleanup failed");
    return undefined;
  }
}
