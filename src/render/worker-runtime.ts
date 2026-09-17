import { createIdentityOwner } from "../contracts/identity.ts";
import type { ResolvedResourceReference } from "../contracts/content.ts";
import type { ImageLevel, PreparedBackendDraw, RendererResourceOwner } from "../contracts/render.ts";
import { SdlWorkerRenderContext } from "../platform/sdl-render-context.ts";
import { SoftwareRenderer } from "./cpu/index.ts";
import { GlRenderer } from "./gl/index.ts";
import { RenderExecutor } from "./execution.ts";
import { RenderImageJournal } from "./image-journal.ts";
import { WireDecoder } from "./worker-protocol.ts";
import type { RenderWorkerRuntime } from "./worker-transport.ts";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isList(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Invalid render worker request");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid render worker number");
  return value;
}
function integer(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError("Invalid render worker integer");
  return result;
}
function dimension(value: unknown): number {
  const result = integer(value);
  if (result === 0) throw new RangeError("Empty render worker dimension");
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Invalid render worker boolean");
  return value;
}
function list(value: unknown): readonly unknown[] {
  if (!isList(value)) throw new TypeError("Invalid render worker list");
  return value;
}
function interval(value: unknown): -1 | 0 | 1 {
  if (value !== -1 && value !== 0 && value !== 1) throw new RangeError("Invalid render worker swap interval");
  return value;
}

export function createRenderWorkerRuntime(payload: unknown, request: (payload: unknown) => unknown): RenderWorkerRuntime {
  const initialization = record(payload), owner: RendererResourceOwner = {
    identity: Symbol("render-worker"), session: createIdentityOwner("render-worker").session, generation: 0,
  };
  const paletteSource: ResolvedResourceReference = {
    id: "resource:render-worker-palette", requestedPath: "palette", byteLength: 768,
    digest: `sha256:${"0".repeat(64)}`,
    provenance: { kind: "loose", memberPath: "palette", mount: { kind: "loose", rootPath: "/render-worker",
      identity: { id: "mount:render:worker", content: "q3:worker:palette:1", generation: 0 } } },
    resolution: { kind: "default-order", plan: "mount-plan:render:worker", rank: 0 },
  };
  let context: SdlWorkerRenderContext | null = null;
  let backend: SoftwareRenderer | GlRenderer;
  let gamma = number(initialization["gamma"]), swapInterval: -1 | 0 | 1 = 0;
  if (initialization["backend"] === "cpu") backend = new SoftwareRenderer(dimension(initialization["width"]), dimension(initialization["height"]), owner);
  else if (initialization["backend"] === "gl") {
    context = SdlWorkerRenderContext.adopt(initialization["transfer"]);
    try { backend = new GlRenderer(context, owner); }
    catch (error) {
      try { context.release(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Worker GL initialization and release failed"); }
      throw error;
    }
  } else throw new Error("Unknown render worker backend");
  try { backend.setOutputGamma(gamma); swapInterval = context?.swapInterval ?? 0; }
  catch (error) {
    try { backend.close(); context?.release(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Worker gamma initialization and close failed"); }
    throw error;
  }
  const journal = new RenderImageJournal(), prepared = new Map<number, PreparedBackendDraw>();
  const decoder: WireDecoder = new WireDecoder(owner, token => decoder.image(request({ kind: "dynamic-image", token })), paletteSource);
  let closed = false, overdraw = false, parked = false;
  const pixels = (): ImageLevel => {
    return backend instanceof SoftwareRenderer ? backend.readRgba() : { width: backend.width, height: backend.height, pixels: backend.readPixels() };
  };
  const executor = new RenderExecutor(backend, {
    imageApplied: operation => {
      journal.record(operation);
      request({ kind: "image-applied", token: decoder.acknowledgment(operation) });
    },
    swap: captures => {
      if (backend instanceof SoftwareRenderer) {
        backend.finish();
        request({ kind: "swap", captures, image: pixels() });
      } else {
        if (captures.length !== 0) request({ kind: "swap", captures, image: pixels() });
        backend.present();
      }
    },
  });
  const description = () => ({ backend: backend instanceof GlRenderer ? "gl" : "cpu", width: backend.width, height: backend.height,
    stencilBits: backend.stencilBits, driver: backend instanceof GlRenderer ? backend.driver : null, swapInterval,
    glConfig: backend instanceof GlRenderer ? { maxTextureSize: backend.maxTextureSize, textureUnits: backend.textureUnits,
      colorBits: backend.colorBits, depthBits: backend.depthBits, stereoEnabled: backend.stereoEnabled } : null });
  const resize = (width: number, height: number): void => {
    if (!(backend instanceof SoftwareRenderer) || width === backend.width && height === backend.height) return;
    if (prepared.size !== 0) throw new Error("Cannot resize with prepared worker geometry");
    const next = new SoftwareRenderer(width, height, owner);
    try { next.setOutputGamma(gamma); next.setOverdrawMeasurement(overdraw); journal.replay(next); }
    catch (error) { next.close(); throw error; }
    backend.close(); backend = next; executor.replaceBackend(next);
  };
  return {
    get description() { return description(); },
    dispatch(payload: unknown): unknown {
      if (closed) throw new Error("Render worker is closed");
      const input = record(payload);
      if (input["kind"] === "park") { context?.park(); parked = true; return undefined; }
      if (input["kind"] === "resume") { context?.resume(); parked = false; return undefined; }
      if (parked) throw new Error("Render worker is parked");
      switch (input["kind"]) {
        case "execute":
          for (const command of list(input["commands"])) executor.execute(decoder.command(command));
          if (boolean(input["final"])) {
            for (const operation of list(request({ kind: "pending-images" }))) executor.image(decoder.imageOperation(operation));
            if (prepared.size === 0) decoder.clearSources();
          }
          return description();
        case "image": executor.image(decoder.imageOperation(input["operation"])); return undefined;
        case "begin-view": backend.beginView(decoder.viewState(input["view"])); return undefined;
        case "immediate": {
          const operation = decoder.operation(input["operation"]);
          if (operation.kind === "draw" || operation.kind === "object-opacity") throw new Error("Non-immediate render operation");
          backend.drawImmediate(operation); return undefined;
        }
        case "prepare": {
          const id = integer(input["id"]);
          if (prepared.has(id)) throw new Error("Duplicate prepared worker draw");
          prepared.set(id, backend.prepareGeometry(decoder.batch(input["batch"]))); return undefined;
        }
        case "prepared": {
          const id = integer(input["id"]), draw = prepared.get(id);
          if (draw === undefined) throw new Error("Unknown prepared worker draw");
          switch (input["phase"]) {
            case "begin": return draw.begin();
            case "texture": return draw.applyTexture(integer(input["unit"]), decoder.binding(input["texture"]));
            case "draw": return draw.draw();
            case "cleanup": draw.cleanup(); prepared.delete(id); return undefined;
            default: throw new Error("Unknown prepared worker phase");
          }
        }
        case "opacity": return backend.withObjectOpacity(number(input["opacity"]), () => { request({ kind: "opacity-callback", callback: integer(input["callback"]) }); return undefined; });
        case "draw-buffer": {
          const buffer = input["buffer"];
          if (buffer !== "front" && buffer !== "back" && buffer !== "back-left" && buffer !== "back-right") throw new Error("Invalid worker draw buffer");
          return backend.selectDrawBuffer(buffer, boolean(input["clear"]));
        }
        case "overdraw": { const enabled = boolean(input["enabled"]); backend.setOverdrawMeasurement(enabled); overdraw = enabled; return undefined; }
        case "stencil": { const destination = new Uint8Array(integer(input["length"])); backend.readStencilOverdraw(destination); return destination; }
        case "depth": return backend.readDepthPixel(number(input["x"]), number(input["y"]));
        case "show-image": {
          const rect = record(input["rect"]);
          return backend.drawShowImage(decoder.image(input["image"]), { x: number(rect["x"]), y: number(rect["y"]), width: number(rect["width"]), height: number(rect["height"]) }, boolean(input["proportional"]));
        }
        case "clear-color": return backend.clearColorBuffer();
        case "gamma": { const value = number(input["gamma"]); backend.setOutputGamma(value); gamma = value; return undefined; }
        case "resize": resize(dimension(input["width"]), dimension(input["height"])); return description();
        case "finish": return backend.finish();
        case "pixels": return pixels();
        case "description": return description();
        case "swap-interval": { const value = interval(input["interval"]); context?.setSwapInterval(value); swapInterval = context === null ? 0 : value; return swapInterval; }
        default: throw new Error(`Unknown render worker operation: ${String(input["kind"])}`);
      }
    },
    close(): undefined {
      if (closed) return;
      if (parked) { context?.resume(); parked = false; }
      const failures: unknown[] = [];
      for (const [id, draw] of prepared) {
        try { draw.cleanup(); prepared.delete(id); } catch (error) { failures.push(error); }
      }
      let backendClosed = false;
      try { backend.close(); backendClosed = true; } catch (error) { failures.push(error); }
      if (backendClosed) {
        try { context?.release(); closed = true; journal.clear(); } catch (error) { failures.push(error); }
      }
      if (failures.length !== 0) throw new AggregateError(failures, "Render worker close failed");
      return undefined;
    },
  };
}
