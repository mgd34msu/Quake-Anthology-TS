/* Row-parallel rasterization worker: decodes flat triangle setups from the
 * shared job buffer and rasterizes disjoint row bands into the shared
 * framebuffer. See row-parallel.ts for the coordinator and encoding. */
import { parentPort, workerData } from "node:worker_threads";
import type { BatchLighting, DepthImageLevel } from "../../contracts/render.ts";
import { decodeRowSetup, ROW_SETUP_STRIDE } from "./row-parallel.ts";
import type { RowDecodeRegistries } from "./row-parallel.ts";
import { runWorkerTriangleRows } from "./triangle-kernel.ts";
import type { BoundTexture, Framebuffer, Sample, TextureStorage } from "./triangle-kernel.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid row worker list");
  return value;
}
function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid row worker number");
  return value;
}
function int(value: unknown): number {
  const result = num(value);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid row worker integer");
  return result;
}
function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid row worker string");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid row worker boolean");
  return value;
}
function vec4(value: unknown): { x: number; y: number; z: number; w: number } {
  if (!record(value)) throw new Error("Invalid row worker vector");
  return { x: num(value["x"]), y: num(value["y"]), z: num(value["z"]), w: num(value["w"]) };
}
function sample(value: unknown): Sample {
  if (!record(value)) throw new Error("Invalid row worker sample");
  return { r: num(value["r"]), g: num(value["g"]), b: num(value["b"]), a: num(value["a"]) };
}

function decodeTexture(value: unknown): BoundTexture {
  if (!record(value)) throw new Error("Invalid row worker texture");
  const kind = str(value["kind"]);
  if (kind === "incomplete") return { kind: "incomplete" };
  if (kind === "constant") {
    const format = str(value["internalFormat"]);
    if (format !== "rgba8" && format !== "rgb8") throw new Error("Invalid row worker texture format");
    return { kind: "constant", internalFormat: format, sample: sample(value["sample"]) };
  }
  if (kind !== "image") throw new Error("Invalid row worker texture kind");
  const format = str(value["internalFormat"]);
  if (format !== "rgba8" && format !== "rgb8") throw new Error("Invalid row worker texture format");
  const wrap = str(value["wrap"]);
  if (wrap !== "repeat" && wrap !== "clamp") throw new Error("Invalid row worker texture wrap");
  const mipmapping = str(value["mipmapping"]);
  if (mipmapping !== "none" && mipmapping !== "nearest" && mipmapping !== "linear") throw new Error("Invalid row worker mipmapping");
  const levels: TextureStorage[] = list(value["levels"]).map(level => {
    if (!record(level)) throw new Error("Invalid row worker texture level");
    const wirePixels = level["pixels"];
    if (!(wirePixels instanceof Uint8Array)) throw new Error("Invalid row worker texture pixels");
    const pixels = new Uint8Array(wirePixels);
    const levelFormat = str(level["internalFormat"]);
    if (levelFormat !== "rgba8" && levelFormat !== "rgb8") throw new Error("Invalid row worker level format");
    const uniform = level["uniform"] === null ? null : sample(level["uniform"]);
    if (num(level["componentMaximum"]) !== 255) throw new Error("Invalid row worker component maximum");
    return { width: int(level["width"]), height: int(level["height"]), pixels,
      data: new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      internalFormat: levelFormat, hasAlpha: bool(level["hasAlpha"]), componentMaximum: 255, uniform };
  });
  const first = levels[0];
  if (first === undefined) throw new Error("Row worker texture has no levels");
  const rest = levels.slice(1);
  return { kind: "image", internalFormat: format, wrap, minifyLinear: bool(value["minifyLinear"]),
    magnifyLinear: bool(value["magnifyLinear"]), mipmapping, magnificationLimit: num(value["magnificationLimit"]),
    borderColor: vec4(value["borderColor"]), levels: [first, ...rest] };
}

function isBatchLighting(value: unknown): value is BatchLighting {
  return record(value) && (value["kind"] === "vertex" || value["kind"] === "q2-world" || value["kind"] === "q2-model-shadow");
}
function decodeDepth(value: unknown): DepthImageLevel {
  if (!record(value) || !(value["pixels"] instanceof Float32Array)) throw new Error("Invalid row worker depth image");
  return { width: int(value["width"]), height: int(value["height"]), pixels: value["pixels"] };
}

const initial: unknown = workerData;
if (!record(initial)) throw new Error("Invalid row worker bootstrap");
const controlBuffer = initial["control"], errorBuffer = initial["error"], colorBuffer = initial["color"];
const depthBuffer = initial["depth"], stencilBuffer = initial["stencil"];
if (!(controlBuffer instanceof SharedArrayBuffer) || !(errorBuffer instanceof SharedArrayBuffer)
  || !(colorBuffer instanceof SharedArrayBuffer) || !(depthBuffer instanceof SharedArrayBuffer)
  || (stencilBuffer !== null && !(stencilBuffer instanceof SharedArrayBuffer)))
  throw new Error("Invalid row worker shared buffers");
const width = int(initial["width"]), height = int(initial["height"]);
const control = new Int32Array(controlBuffer);
const errorBytes = new Uint8Array(errorBuffer);
const framebuffer: Framebuffer = { width, height, pixels: new Uint8Array(colorBuffer), colorWords: new Int32Array(colorBuffer),
  depth: new Float64Array(depthBuffer), stencil: stencilBuffer === null ? null : new Uint32Array(stencilBuffer),
  originX: 0, originY: 0, stride: width };
const textures = new Map<number, BoundTexture>();
const lightings = new Map<number, BatchLighting>();
const depths = new Map<number, DepthImageLevel>();
const registries: RowDecodeRegistries = {
  texture: id => {
    if (id === -1) return { kind: "incomplete" };
    const found = textures.get(id);
    if (found === undefined) throw new Error(`Row worker missing texture ${id}`);
    return found;
  },
  lighting: id => {
    const found = lightings.get(id);
    if (found === undefined) throw new Error(`Row worker missing lighting ${id}`);
    return found;
  },
  depth: id => {
    if (id === -1) return null;
    const found = depths.get(id);
    if (found === undefined) throw new Error(`Row worker missing depth ${id}`);
    return found;
  },
};
const sampled: Sample = { r: 1, g: 1, b: 1, a: 1 };
let jobData: Float64Array<SharedArrayBuffer> | null = null;

function fail(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  const encoded = new TextEncoder().encode(text.slice(0, 1024));
  errorBytes.set(encoded);
  Atomics.store(control, 4, encoded.length);
  Atomics.store(control, 3, 1);
}

if (parentPort === null) throw new Error("Row worker requires a parent port");
parentPort.on("message", (value: unknown) => {
  try {
    if (!record(value) || value["kind"] !== "job") throw new Error("Invalid row worker job");
    for (const entry of list(value["textures"])) {
      if (!record(entry)) throw new Error("Invalid row worker texture registration");
      textures.set(int(entry["id"]), decodeTexture(entry["texture"]));
    }
    for (const entry of list(value["lightings"])) {
      if (!record(entry) || !isBatchLighting(entry["parameters"])) throw new Error("Invalid row worker lighting registration");
      lightings.set(int(entry["id"]), entry["parameters"]);
    }
    for (const entry of list(value["depths"])) {
      if (!record(entry)) throw new Error("Invalid row worker depth registration");
      depths.set(int(entry["id"]), decodeDepth(entry["depth"]));
    }
    const fresh = value["jobBuffer"];
    if (fresh instanceof SharedArrayBuffer) jobData = new Float64Array(fresh);
    if (jobData === null) throw new Error("Row worker has no job buffer");
    const count = int(value["count"]), bandRows = Math.max(1, int(value["bandRows"]));
    const setups = Array.from({ length: count }, (_, index) => {
      const data = jobData;
      if (data === null) throw new Error("Row worker lost job buffer");
      return decodeRowSetup(data, index * ROW_SETUP_STRIDE, registries);
    });
    const bandCount = Math.ceil(height / bandRows);
    for (;;) {
      const band = Atomics.add(control, 0, 1);
      if (band >= bandCount) break;
      const firstY = band * bandRows, lastY = Math.min(height - 1, firstY + bandRows - 1);
      for (const setup of setups) runWorkerTriangleRows(setup, framebuffer, sampled, firstY, lastY);
    }
  } catch (error) { fail(error); }
  Atomics.add(control, 1, 1);
  Atomics.notify(control, 1);
});
Atomics.add(control, 2, 1);
Atomics.notify(control, 2);
