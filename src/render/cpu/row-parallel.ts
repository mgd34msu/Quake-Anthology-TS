/* Row-parallel CPU rasterization: a synchronous worker pool sharing one
 * framebuffer. Every worker receives the same triangle setup list but only
 * rasterizes its own horizontal row bands, so each pixel has exactly one
 * owner processing triangles in draw order and output is bit-identical to
 * the serial kernel. Setups are encoded into a shared flat Float64 buffer;
 * textures and lighting parameters are registered once per worker by id. */
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import type { BatchLighting, BlendFactor, DepthImageLevel } from "../../contracts/render.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { BoundTexture, TriangleSetup } from "./triangle-kernel.ts";

export interface RowSharedFramebuffer {
  readonly width: number;
  readonly height: number;
  readonly color: SharedArrayBuffer;
  readonly depth: SharedArrayBuffer;
  readonly stencil: SharedArrayBuffer | null;
}

export const ROW_SETUP_STRIDE = 129;
const BLEND_FACTORS: readonly BlendFactor[] = ["zero", "one", "src-color", "one-minus-src-color",
  "dst-color", "one-minus-dst-color", "src-alpha", "one-minus-src-alpha",
  "dst-alpha", "one-minus-dst-alpha", "src-alpha-saturate"];
const BLENDINGS: readonly TriangleSetup["blending"][] = ["opaque", "alpha", "add", "multiply", "dst-color-inverse-dst-alpha", "general"];
const DEPTH_TESTS: readonly TriangleSetup["depthTest"][] = ["less-equal", "equal", "always"];
const ALPHA_TESTS: readonly TriangleSetup["alphaTest"][] = ["none", "gt0", "lt128", "ge128"];
const STENCIL_OPS: readonly TriangleSetup["stencilDepthFail"][] = ["keep", "increment", "decrement"];
const ENVIRONMENTS: readonly ("modulate" | "add" | "replace")[] = ["modulate", "add", "replace"];
const FOG_EFFECTS: readonly ("color" | "none" | "rgb" | "alpha" | "rgba" | "overlay")[] = ["color", "none", "rgb", "alpha", "rgba", "overlay"];

function code<T extends string>(values: readonly T[], value: T): number {
  const index = values.indexOf(value);
  if (index < 0) throw new RangeError(`Unknown row-parallel enum value ${value}`);
  return index;
}
function uncode<T extends string>(values: readonly T[], value: number): T {
  const found = values[value];
  if (found === undefined) throw new RangeError("Invalid row-parallel enum code");
  return found;
}

export interface RowRegistries {
  textureId(texture: BoundTexture): number;
  lightingId(parameters: BatchLighting): number;
  depthId(depth: DepthImageLevel | null): number;
}

export function encodeRowSetup(data: Float64Array, offset: number, setup: TriangleSetup, registries: RowRegistries): void {
  const d = data;
  d[offset] = setup.minX; d[offset + 1] = setup.maxX; d[offset + 2] = setup.minY; d[offset + 3] = setup.maxY;
  d[offset + 4] = setup.inverseArea; d[offset + 5] = setup.depthNear; d[offset + 6] = setup.depthFar;
  d[offset + 7] = setup.edgeAX; d[offset + 8] = setup.edgeAY; d[offset + 9] = setup.edgeAC;
  d[offset + 10] = setup.edgeBX; d[offset + 11] = setup.edgeBY; d[offset + 12] = setup.edgeBC;
  d[offset + 13] = setup.edgeCX; d[offset + 14] = setup.edgeCY; d[offset + 15] = setup.edgeCC;
  d[offset + 16] = setup.attributeAX; d[offset + 17] = setup.attributeAY; d[offset + 18] = setup.attributeAC;
  d[offset + 19] = setup.attributeBX; d[offset + 20] = setup.attributeBY; d[offset + 21] = setup.attributeBC;
  d[offset + 22] = setup.attributeCX; d[offset + 23] = setup.attributeCY; d[offset + 24] = setup.attributeCC;
  d[offset + 25] = setup.az; d[offset + 26] = setup.bz; d[offset + 27] = setup.cz;
  d[offset + 28] = setup.polygonDepthOffset; d[offset + 29] = setup.planeDepth;
  d[offset + 30] = setup.aiw; d[offset + 31] = setup.biw; d[offset + 32] = setup.ciw;
  d[offset + 33] = setup.au; d[offset + 34] = setup.bu; d[offset + 35] = setup.cu;
  d[offset + 36] = setup.av; d[offset + 37] = setup.bv; d[offset + 38] = setup.cv;
  d[offset + 39] = setup.au2; d[offset + 40] = setup.bu2; d[offset + 41] = setup.cu2;
  d[offset + 42] = setup.av2; d[offset + 43] = setup.bv2; d[offset + 44] = setup.cv2;
  d[offset + 45] = setup.ar; d[offset + 46] = setup.br; d[offset + 47] = setup.cr;
  d[offset + 48] = setup.ag; d[offset + 49] = setup.bg; d[offset + 50] = setup.cg;
  d[offset + 51] = setup.ab; d[offset + 52] = setup.bb; d[offset + 53] = setup.cb;
  d[offset + 54] = setup.aa; d[offset + 55] = setup.ba; d[offset + 56] = setup.ca;
  d[offset + 57] = setup.edgeAInclusive ? 1 : 0; d[offset + 58] = setup.edgeBInclusive ? 1 : 0; d[offset + 59] = setup.edgeCInclusive ? 1 : 0;
  d[offset + 60] = setup.white ? 1 : 0; d[offset + 61] = setup.depthWrite ? 1 : 0; d[offset + 62] = setup.stencilEnabled ? 1 : 0;
  d[offset + 63] = setup.colorWrite ? 1 : 0; d[offset + 64] = setup.textureConsumed ? 1 : 0; d[offset + 65] = setup.primaryAlpha ? 1 : 0;
  d[offset + 66] = setup.secondaryAlpha ? 1 : 0; d[offset + 67] = setup.constantDepth ? 1 : 0;
  d[offset + 68] = setup.width; d[offset + 69] = setup.height; d[offset + 70] = setup.alphaBits;
  d[offset + 71] = code(BLENDINGS, setup.blending); d[offset + 72] = code(DEPTH_TESTS, setup.depthTest);
  d[offset + 73] = code(ALPHA_TESTS, setup.alphaTest);
  d[offset + 74] = setup.secondaryEnvironment === null ? -1 : code(ENVIRONMENTS, setup.secondaryEnvironment);
  d[offset + 75] = code(BLEND_FACTORS, setup.state.blend.source); d[offset + 76] = code(BLEND_FACTORS, setup.state.blend.destination);
  d[offset + 77] = setup.stencilFunction === "nonzero" ? 1 : 0;
  d[offset + 78] = setup.stencilCompareMask; d[offset + 79] = setup.stencilWriteMask; d[offset + 80] = setup.stencilMaximum;
  d[offset + 81] = code(STENCIL_OPS, setup.stencilDepthFail); d[offset + 82] = code(STENCIL_OPS, setup.stencilDepthPass);
  d[offset + 83] = registries.textureId(setup.texture); d[offset + 84] = registries.textureId(setup.secondaryTexture);
  d[offset + 85] = registries.lightingId(setup.lighting.parameters); d[offset + 86] = registries.depthId(setup.lighting.depth);
  const derivative = setup.derivative, secondary = setup.secondaryDerivative;
  d[offset + 87] = derivative.uAnchor; d[offset + 88] = derivative.vAnchor; d[offset + 89] = derivative.uDx;
  d[offset + 90] = derivative.vDx; d[offset + 91] = derivative.qDx; d[offset + 92] = derivative.uDy;
  d[offset + 93] = derivative.vDy; d[offset + 94] = derivative.qDy;
  d[offset + 95] = secondary.uAnchor; d[offset + 96] = secondary.vAnchor; d[offset + 97] = secondary.uDx;
  d[offset + 98] = secondary.vDx; d[offset + 99] = secondary.qDx; d[offset + 100] = secondary.uDy;
  d[offset + 101] = secondary.vDy; d[offset + 102] = secondary.qDy;
  const fog = setup.fog;
  d[offset + 103] = fog === undefined ? 0 : fog.kind === "exp2" ? 1 : 2;
  d[offset + 104] = fog !== undefined && fog.kind === "exp2" ? code(FOG_EFFECTS, fog.effect ?? "color") : 0;
  d[offset + 105] = fog?.color.x ?? 0; d[offset + 106] = fog?.color.y ?? 0; d[offset + 107] = fog?.color.z ?? 0;
  d[offset + 108] = fog === undefined ? 0 : fog.kind === "exp2" ? fog.density : fog.amount;
  d[offset + 109] = setup.fogDepthScale ?? 1;
  d[offset + 110] = setup.textureEffect === "luminance-alpha" ? 1 : 0;
  const positions = setup.lighting.positions, normals = setup.lighting.normals;
  for (let i = 0; i < 3; i++) {
    const position = positions[i], normal = normals[i];
    if (position === undefined || normal === undefined) throw new RangeError("Missing triangle lighting vertex");
    d[offset + 111 + i * 3] = position.x; d[offset + 112 + i * 3] = position.y; d[offset + 113 + i * 3] = position.z;
    d[offset + 120 + i * 3] = normal.x; d[offset + 121 + i * 3] = normal.y; d[offset + 122 + i * 3] = normal.z;
  }
}

export interface RowDecodeRegistries {
  texture(id: number): BoundTexture;
  lighting(id: number): BatchLighting;
  depth(id: number): DepthImageLevel | null;
}

function vec3(data: Float64Array, offset: number): Vec3 {
  return { x: data[offset] ?? 0, y: data[offset + 1] ?? 0, z: data[offset + 2] ?? 0 };
}

export function decodeRowSetup(data: Float64Array, offset: number, registries: RowDecodeRegistries): TriangleSetup {
  const d = data, n = (index: number): number => d[offset + index] ?? 0, b = (index: number): boolean => n(index) !== 0;
  const positions: readonly [Vec3, Vec3, Vec3] = [vec3(d, offset + 111), vec3(d, offset + 114), vec3(d, offset + 117)];
  const normals: readonly [Vec3, Vec3, Vec3] = [vec3(d, offset + 120), vec3(d, offset + 123), vec3(d, offset + 126)];
  const fogKind = n(103);
  const fog = fogKind === 0 ? undefined : fogKind === 1
    ? { kind: "exp2", effect: uncode(FOG_EFFECTS, n(104)), color: vec3(d, offset + 105), density: n(108) } satisfies import("../../contracts/render.ts").BatchFog
    : { kind: "constant", color: vec3(d, offset + 105), amount: n(108) } satisfies import("../../contracts/render.ts").BatchFog;
  return {
    ...(fog === undefined ? {} : { fog, fogDepthScale: n(109) }),
    ...(n(110) === 0 ? {} : { textureEffect: "luminance-alpha" }),
    lighting: { parameters: registries.lighting(n(85)), depth: registries.depth(n(86)), positions, normals },
    minX: n(0), maxX: n(1), minY: n(2), maxY: n(3), inverseArea: n(4), depthNear: n(5), depthFar: n(6),
    edgeAX: n(7), edgeAY: n(8), edgeAC: n(9), edgeBX: n(10), edgeBY: n(11), edgeBC: n(12),
    edgeCX: n(13), edgeCY: n(14), edgeCC: n(15),
    attributeAX: n(16), attributeAY: n(17), attributeAC: n(18), attributeBX: n(19), attributeBY: n(20), attributeBC: n(21),
    attributeCX: n(22), attributeCY: n(23), attributeCC: n(24),
    az: n(25), bz: n(26), cz: n(27), polygonDepthOffset: n(28), planeDepth: n(29),
    aiw: n(30), biw: n(31), ciw: n(32), au: n(33), bu: n(34), cu: n(35), av: n(36), bv: n(37), cv: n(38),
    au2: n(39), bu2: n(40), cu2: n(41), av2: n(42), bv2: n(43), cv2: n(44),
    ar: n(45), br: n(46), cr: n(47), ag: n(48), bg: n(49), cg: n(50), ab: n(51), bb: n(52), cb: n(53),
    aa: n(54), ba: n(55), ca: n(56),
    edgeAInclusive: b(57), edgeBInclusive: b(58), edgeCInclusive: b(59), white: b(60), depthWrite: b(61),
    stencilEnabled: b(62), colorWrite: b(63), textureConsumed: b(64), primaryAlpha: b(65), secondaryAlpha: b(66),
    constantDepth: b(67), width: n(68), height: n(69),
    state: { blend: { source: uncode(BLEND_FACTORS, n(75)), destination: uncode(BLEND_FACTORS, n(76)) } },
    alphaBits: n(70) === 0 ? 0 : 8,
    blending: uncode(BLENDINGS, n(71)), depthTest: uncode(DEPTH_TESTS, n(72)), alphaTest: uncode(ALPHA_TESTS, n(73)),
    secondaryEnvironment: n(74) < 0 ? null : uncode(ENVIRONMENTS, n(74)),
    texture: registries.texture(n(83)), secondaryTexture: registries.texture(n(84)),
    derivative: { uAnchor: n(87), vAnchor: n(88), uDx: n(89), vDx: n(90), qDx: n(91), uDy: n(92), vDy: n(93), qDy: n(94) },
    secondaryDerivative: { uAnchor: n(95), vAnchor: n(96), uDx: n(97), vDx: n(98), qDx: n(99), uDy: n(100), vDy: n(101), qDy: n(102) },
    stencilFunction: n(77) === 0 ? "always" : "nonzero",
    stencilCompareMask: n(78), stencilWriteMask: n(79), stencilMaximum: n(80),
    stencilDepthFail: uncode(STENCIL_OPS, n(81)), stencilDepthPass: uncode(STENCIL_OPS, n(82)),
  };
}

const CONTROL_NEXT = 0, CONTROL_DONE = 1, CONTROL_READY = 2, CONTROL_ERROR = 3, CONTROL_ERROR_LENGTH = 4;
const ERROR_BYTES = 4096;

export interface RowTextureRegistration { readonly id: number; readonly texture: unknown }
export interface RowLightingRegistration { readonly id: number; readonly parameters: BatchLighting }
export interface RowDepthRegistration { readonly id: number; readonly depth: DepthImageLevel }
export interface RowJobMessage {
  readonly kind: "job";
  readonly count: number;
  readonly bandRows: number;
  readonly jobBuffer: SharedArrayBuffer | null;
  readonly textures: readonly RowTextureRegistration[];
  readonly lightings: readonly RowLightingRegistration[];
  readonly depths: readonly RowDepthRegistration[];
}

function serializeTexture(texture: BoundTexture): unknown {
  if (texture.kind === "incomplete") return { kind: "incomplete" };
  if (texture.kind === "constant") return { kind: "constant", internalFormat: texture.internalFormat, sample: { ...texture.sample } };
  return { kind: "image", internalFormat: texture.internalFormat, wrap: texture.wrap,
    minifyLinear: texture.minifyLinear, magnifyLinear: texture.magnifyLinear, mipmapping: texture.mipmapping,
    magnificationLimit: texture.magnificationLimit, borderColor: { ...texture.borderColor },
    levels: texture.levels.map(level => ({ width: level.width, height: level.height, pixels: level.pixels,
      internalFormat: level.internalFormat, hasAlpha: level.hasAlpha, componentMaximum: level.componentMaximum,
      uniform: level.uniform === null ? null : { ...level.uniform } })) };
}

function configuredWorkerCount(): number {
  const raw = process.env["QTS_CPU_WORKERS"];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(16, parsed)) : 0;
  }
  try { return Math.max(0, Math.min(4, availableParallelism() - 1)); } catch { return 0; }
}

export class RowParallelPool implements RowRegistries {
  jobsRun = 0;
  readonly #workers: Worker[] = [];
  readonly #control: Int32Array<SharedArrayBuffer>;
  readonly #errorBytes: Uint8Array<SharedArrayBuffer>;
  readonly #shared: RowSharedFramebuffer;
  #jobBuffer: SharedArrayBuffer | null = null;
  #closed = false;
  readonly #textureIds = new WeakMap<object, number>();
  readonly #constantIds = new Map<string, number>();
  readonly #lightingIds = new WeakMap<object, number>();
  readonly #depthIds = new WeakMap<object, number>();
  #nextTexture = 0;
  #nextLighting = 0;
  #nextDepth = 0;
  #pendingTextures: RowTextureRegistration[] = [];
  #pendingLightings: RowLightingRegistration[] = [];
  #pendingDepths: RowDepthRegistration[] = [];

  private constructor(shared: RowSharedFramebuffer, count: number) {
    this.#shared = shared;
    const controlBuffer = new SharedArrayBuffer(32);
    this.#control = new Int32Array(controlBuffer);
    const errorBuffer = new SharedArrayBuffer(ERROR_BYTES);
    this.#errorBytes = new Uint8Array(errorBuffer);
    const workerData = { control: controlBuffer, error: errorBuffer, color: shared.color, depth: shared.depth,
      stencil: shared.stencil, width: shared.width, height: shared.height };
    for (let i = 0; i < count; i++) this.#workers.push(new Worker(new URL("./row-worker.ts", import.meta.url), { workerData }));
    const deadline = Date.now() + 30_000;
    while (Atomics.load(this.#control, CONTROL_READY) < count) {
      if (Date.now() > deadline) { this.close(); throw new Error("Row-parallel workers did not become ready"); }
      Atomics.wait(this.#control, CONTROL_READY, Atomics.load(this.#control, CONTROL_READY), 1000);
    }
  }

  static tryCreate(shared: RowSharedFramebuffer): RowParallelPool | null {
    const count = configuredWorkerCount();
    if (count < 1 || typeof SharedArrayBuffer !== "function") return null;
    try {
      const probe = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(probe, 0, 0, 0);
      return new RowParallelPool(shared, count);
    } catch { return null; }
  }

  get workerCount(): number { return this.#workers.length; }

  textureId(texture: BoundTexture): number {
    if (texture.kind === "incomplete") return -1;
    const key = texture.kind === "constant"
      ? `${texture.internalFormat}|${texture.sample.r},${texture.sample.g},${texture.sample.b},${texture.sample.a}` : null;
    const known = key === null ? this.#textureIds.get(texture) : this.#constantIds.get(key);
    if (known !== undefined) return known;
    const id = this.#nextTexture++;
    if (key === null) this.#textureIds.set(texture, id); else this.#constantIds.set(key, id);
    this.#pendingTextures.push({ id, texture: serializeTexture(texture) });
    return id;
  }

  lightingId(parameters: BatchLighting): number {
    const known = this.#lightingIds.get(parameters);
    if (known !== undefined) return known;
    const id = this.#nextLighting++;
    this.#lightingIds.set(parameters, id);
    this.#pendingLightings.push({ id, parameters });
    return id;
  }

  depthId(depth: DepthImageLevel | null): number {
    if (depth === null) return -1;
    const known = this.#depthIds.get(depth);
    if (known !== undefined) return known;
    const id = this.#nextDepth++;
    this.#depthIds.set(depth, id);
    this.#pendingDepths.push({ id, depth });
    return id;
  }

  run(setups: readonly TriangleSetup[]): void {
    if (this.#closed) throw new Error("Row-parallel pool is closed");
    const floats = setups.length * ROW_SETUP_STRIDE;
    let freshBuffer: SharedArrayBuffer | null = null;
    if (this.#jobBuffer === null || this.#jobBuffer.byteLength < floats * 8) {
      this.#jobBuffer = new SharedArrayBuffer(Math.max(floats * 8, 64 * 1024));
      freshBuffer = this.#jobBuffer;
    }
    const data = new Float64Array(this.#jobBuffer);
    this.#pendingTextures = []; this.#pendingLightings = []; this.#pendingDepths = [];
    for (let i = 0; i < setups.length; i++) {
      const setup = setups[i];
      if (setup === undefined) throw new RangeError("Missing row-parallel triangle setup");
      encodeRowSetup(data, i * ROW_SETUP_STRIDE, setup, this);
    }
    const workers = this.#workers.length;
    const bandRows = Math.max(1, Math.ceil(this.#shared.height / (workers * 4)));
    Atomics.store(this.#control, CONTROL_NEXT, 0);
    Atomics.store(this.#control, CONTROL_DONE, 0);
    Atomics.store(this.#control, CONTROL_ERROR, 0);
    Atomics.store(this.#control, CONTROL_ERROR_LENGTH, 0);
    const message: RowJobMessage = { kind: "job", count: setups.length, bandRows, jobBuffer: freshBuffer,
      textures: this.#pendingTextures, lightings: this.#pendingLightings, depths: this.#pendingDepths };
    for (const worker of this.#workers) worker.postMessage(message);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const done = Atomics.load(this.#control, CONTROL_DONE);
      if (done >= workers) break;
      if (Date.now() > deadline) throw new Error("Row-parallel rasterization timed out");
      Atomics.wait(this.#control, CONTROL_DONE, done, 5000);
    }
    this.jobsRun++;
    if (Atomics.load(this.#control, CONTROL_ERROR) !== 0) {
      const length = Math.min(Atomics.load(this.#control, CONTROL_ERROR_LENGTH), ERROR_BYTES);
      const text = new TextDecoder().decode(this.#errorBytes.slice(0, length));
      throw new Error(`Row-parallel worker failed: ${text}`);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const worker of this.#workers) void worker.terminate();
  }
}
