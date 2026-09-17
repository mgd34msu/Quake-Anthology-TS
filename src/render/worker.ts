import type { DrawBatch, ImageLevel, ImageResourceOperation, PreparedBackendDraw, Rect, RenderCommand, RendererBackend, RendererDrawBuffer, RendererImage, RendererResourceOwner, RenderOperation, RenderViewState } from "../contracts/render.ts";
import type { SdlWindow } from "../platform/sdl.ts";
import type { GlRenderer } from "./gl/index.ts";
import type { RenderImageJournal } from "./image-journal.ts";
import type { SceneImageRegistry } from "./scene/resources.ts";
import { RenderWorkerTransport } from "./worker-transport.ts";
import { decodeImageLevel, WireEncoder } from "./worker-protocol.ts";

export interface WorkerDescription {
  readonly backend: "cpu" | "gl";
  readonly width: number;
  readonly height: number;
  readonly stencilBits: number;
  readonly driver: GlRenderer["driver"] | null;
  readonly glConfig: Pick<GlRenderer, "maxTextureSize" | "textureUnits" | "colorBits" | "depthBits" | "stereoEnabled"> | null;
  readonly swapInterval: -1 | 0 | 1;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Invalid render worker response");
  return value;
}
function number(value: unknown): number { if (typeof value !== "number") throw new TypeError("Invalid render worker number"); return value; }
function integer(value: unknown): number { const result = number(value); if (!Number.isSafeInteger(result) || result < 0) throw new RangeError("Invalid render worker integer"); return result; }
function string(value: unknown): string { if (typeof value !== "string") throw new TypeError("Invalid render worker string"); return value; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new TypeError("Invalid render worker boolean"); return value; }
function isList(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function list(value: unknown): readonly unknown[] { if (!isList(value)) throw new TypeError("Invalid render worker list"); return value; }
function description(value: unknown): WorkerDescription {
  const p = record(value), backend = p["backend"], interval = p["swapInterval"];
  if (backend !== "cpu" && backend !== "gl") throw new TypeError("Invalid render worker backend");
  if (interval !== -1 && interval !== 0 && interval !== 1) throw new TypeError("Invalid render worker swap interval");
  const driver = p["driver"] === null ? null : record(p["driver"]), config = p["glConfig"] === null ? null : record(p["glConfig"]);
  return { backend, width: integer(p["width"]), height: integer(p["height"]), stencilBits: integer(p["stencilBits"]), swapInterval: interval,
    driver: driver === null ? null : { vendor: string(driver["vendor"]), renderer: string(driver["renderer"]), version: string(driver["version"]), shadingLanguage: string(driver["shadingLanguage"]) },
    glConfig: config === null ? null : { maxTextureSize: integer(config["maxTextureSize"]), textureUnits: integer(config["textureUnits"]), colorBits: integer(config["colorBits"]), depthBits: integer(config["depthBits"]), stereoEnabled: boolean(config["stereoEnabled"]) } };
}

function wireBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length * 2;
  if (typeof value !== "object") return 8;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  const values: readonly unknown[] = isList(value) ? value : isRecord(value) ? Object.values(value) : [];
  let bytes = 16;
  for (const entry of values) bytes += wireBytes(entry);
  return bytes;
}

/** One immutable command packet overlaps frontend work; synchronous calls are barriers. */
export class WorkerRenderer implements RendererBackend {
  private static readonly contexts = new Set<WorkerRenderer>();
  private readonly encoder: WireEncoder;
  private transport: RenderWorkerTransport | null = null;
  private metadata: WorkerDescription | null = null;
  private suffix: unknown[] = [];
  private callbackDepth = 0;
  private nextDraw = 1;
  private nextCallback = 1;
  private readonly callbacks = new Map<number, () => undefined>();
  private readonly draws = new Set<number>();
  private parked = false;
  private closed = false;

  private constructor(readonly owner: RendererResourceOwner, private readonly window: SdlWindow,
    private readonly images: SceneImageRegistry, private readonly journal: RenderImageJournal,
    private readonly swap: (image: ImageLevel | null, captures: readonly number[]) => void) {
    this.encoder = new WireEncoder(owner);
  }

  static async open(window: SdlWindow, owner: RendererResourceOwner, gamma: number, images: SceneImageRegistry,
    journal: RenderImageJournal, swap: (image: ImageLevel | null, captures: readonly number[]) => void, failed: (error: unknown) => void): Promise<WorkerRenderer> {
    const renderer = new WorkerRenderer(owner, window, images, journal, swap);
    const initialization = window.backend === "cpu"
      ? { backend: "cpu", ...window.drawableSize, gamma }
      : { backend: "gl", transfer: window.detachRenderContext(), gamma };
    try {
      renderer.transport = await RenderWorkerTransport.open(new URL("./worker-entry.ts", import.meta.url), initialization, {
        request: payload => renderer.hostRequest(payload),
        completed: payload => { renderer.metadata = description(payload); return undefined; },
        failed: error => { failed(error); return undefined; },
      });
      renderer.metadata = description(renderer.transport.description);
      if (window.backend === "gl") WorkerRenderer.contexts.add(renderer);
      return renderer;
    } catch (error) {
      try { window.restoreRenderContext(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Render worker startup failed while retaining its context"); }
      throw error;
    }
  }

  static withParkedContexts<T>(operation: () => T): T {
    const parked: WorkerRenderer[] = [];
    let failure: { readonly error: unknown } | null = null;
    try {
      for (const renderer of WorkerRenderer.contexts) {
        if (renderer.parked) continue;
        if (renderer.callbackDepth !== 0) throw new Error("Cannot change SDL windows during a render callback");
        renderer.connection().call({ kind: "park" }); renderer.parked = true; parked.push(renderer);
      }
      return operation();
    } catch (error) { failure = { error }; throw error; }
    finally {
      const failures: unknown[] = [];
      for (const renderer of parked.reverse()) {
        if (renderer.closed) continue;
        try { renderer.connection().call({ kind: "resume" }); renderer.parked = false; } catch (error) { failures.push(error); }
      }
      if (failures.length !== 0) throw new AggregateError(failure === null ? failures : [failure.error, ...failures], "SDL window change could not resume its render workers");
    }
  }

  private connection(): RenderWorkerTransport {
    if (this.closed || this.transport === null) throw new Error("Render worker is not open");
    return this.transport;
  }
  get description(): WorkerDescription { if (this.metadata === null) throw new Error("Render worker is not initialized"); return this.metadata; }
  get width(): number { return this.description.width; }
  get height(): number { return this.description.height; }
  get stencilBits(): number { return this.description.stencilBits; }

  private hostRequest(payload: unknown): unknown {
    const execute = (): unknown => {
      this.callbackDepth++;
      try { return this.dispatchHost(payload); } finally { this.callbackDepth--; }
    };
    return this.callbackDepth === 0
      ? this.images.isolatePendingOperations(execute, operations => {
        for (const operation of operations) this.suffix.push(this.encoder.imageOperation(operation));
      })
      : execute();
  }

  private dispatchHost(payload: unknown): unknown {
    const request = record(payload);
    switch (request["kind"]) {
      case "image-applied": this.journal.record(this.encoder.acknowledge(request["token"])); return undefined;
      case "dynamic-image": {
        const source = this.encoder.source(integer(request["token"]));
        return this.encoder.image(source.resolve(operation => { this.applyImageResource(operation); }));
      }
      case "pending-images": {
        const pending = this.suffix; this.suffix = [];
        return pending;
      }
      case "opacity-callback": {
        const callback = this.callbacks.get(integer(request["callback"]));
        if (callback === undefined) throw new Error("Unknown render worker opacity callback");
        return callback();
      }
      case "swap": {
        const frame = request["image"] === null ? null : decodeImageLevel(request["image"]);
        this.swap(frame, list(request["captures"]).map(integer)); return undefined;
      }
      default: throw new Error("Unknown render worker host request");
    }
  }

  private call(payload: unknown): unknown {
    if (this.parked) throw new Error("Render context is parked for an SDL window change");
    return this.connection().callbackCall(payload);
  }
  synchronize(): void { this.connection().synchronize(); }

  execute(commands: readonly RenderCommand[], captures: readonly number[], suffix: readonly ImageResourceOperation[]): void {
    if (this.callbackDepth !== 0) throw new Error("Cannot submit a frame during a render callback");
    this.synchronize();
    if (this.draws.size === 0) this.encoder.clearSources();
    for (const operation of suffix) this.suffix.push(this.encoder.imageOperation(operation));
    let pending: unknown[] = [], bytes = 0, armed = captures;
    const issue = (final: boolean): void => {
      this.connection().issue({ kind: "execute", commands: pending, final }); pending = []; bytes = 0;
    };
    for (const command of commands) {
      const encoded = this.encoder.command(command, command.kind === "swap-buffers" ? armed : []);
      if (command.kind === "swap-buffers") armed = [];
      const size = wireBytes(encoded);
      if (pending.length !== 0 && bytes + size > 8 * 1024 * 1024) issue(false);
      pending.push(encoded); bytes += size;
      // An indivisible oversized command executes alone before recording more data.
      if (bytes > 8 * 1024 * 1024) { issue(false); this.synchronize(); }
    }
    issue(true);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.metadata = description(this.call({ kind: "resize", width, height }));
  }
  setOutputGamma(gamma: number): void { this.call({ kind: "gamma", gamma }); }
  setSwapInterval(interval: -1 | 0 | 1): void {
    this.call({ kind: "swap-interval", interval });
    this.metadata = description(this.call({ kind: "description" }));
  }
  readPixels(): ImageLevel { return decodeImageLevel(this.call({ kind: "pixels" })); }
  applyImageResource(operation: ImageResourceOperation): undefined { this.call({ kind: "image", operation: this.encoder.imageOperation(operation) }); return undefined; }
  selectDrawBuffer(buffer: RendererDrawBuffer, clear: boolean): undefined { this.call({ kind: "draw-buffer", buffer, clear }); return undefined; }
  setOverdrawMeasurement(enabled: boolean): undefined { this.call({ kind: "overdraw", enabled }); return undefined; }
  readStencilOverdraw(destination: Uint8Array): undefined {
    const result = this.call({ kind: "stencil", length: destination.length });
    if (!(result instanceof Uint8Array) || result.length !== destination.length) throw new Error("Invalid worker stencil readback");
    destination.set(result); return undefined;
  }
  readDepthPixel(x: number, y: number): number { return number(this.call({ kind: "depth", x, y })); }
  beginView(view: RenderViewState): undefined { this.call({ kind: "begin-view", view }); return undefined; }
  withObjectOpacity(opacity: number, draw: () => undefined): undefined {
    const callback = this.nextCallback++;
    this.callbacks.set(callback, draw);
    try { this.call({ kind: "opacity", opacity, callback }); } finally { this.callbacks.delete(callback); }
    return undefined;
  }
  drawImmediate(operation: Exclude<RenderOperation, { readonly kind: "draw" | "object-opacity" }>): undefined {
    this.call({ kind: "immediate", operation: this.encoder.operation(operation) }); return undefined;
  }
  prepareGeometry(batch: DrawBatch): PreparedBackendDraw {
    const id = this.nextDraw++;
    this.call({ kind: "prepare", id, batch: this.encoder.batch(batch) });
    this.draws.add(id);
    return {
      begin: () => { this.call({ kind: "prepared", id, phase: "begin" }); return undefined; },
      applyTexture: (unit, texture) => { this.call({ kind: "prepared", id, phase: "texture", unit, texture: this.encoder.binding(texture) }); return undefined; },
      draw: () => { this.call({ kind: "prepared", id, phase: "draw" }); return undefined; },
      cleanup: () => { this.call({ kind: "prepared", id, phase: "cleanup" }); this.draws.delete(id); return undefined; },
    };
  }
  clearColorBuffer(): undefined { this.call({ kind: "clear-color" }); return undefined; }
  drawShowImage(image: RendererImage, rect: Rect, proportional: boolean): undefined {
    this.call({ kind: "show-image", image: this.encoder.image(image), rect, proportional }); return undefined;
  }
  finish(): undefined { this.call({ kind: "finish" }); return undefined; }
  close(): undefined {
    if (this.closed) return undefined;
    const connection = this.connection();
    try { connection.close(); }
    finally {
      if (connection.retired) {
        this.closed = true; this.encoder.clear(); this.callbacks.clear(); this.draws.clear(); WorkerRenderer.contexts.delete(this);
        this.window.restoreRenderContext();
      }
    }
    return undefined;
  }
}
