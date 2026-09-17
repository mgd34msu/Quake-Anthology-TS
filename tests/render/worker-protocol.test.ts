import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import type { BatchLighting, DrawBatch, Q2ShadowProjection, DynamicImageSource, ImageResourceOperation, RenderCommand, RendererImage, RendererResourceOwner, RenderOperation } from "../../src/contracts/render.ts";
import { WireDecoder, WireEncoder, decodeImageLevel } from "../../src/render/worker-protocol.ts";
import type { ExecutionOperation } from "../../src/render/execution.ts";
import { resolveDrawTextures } from "../../src/render/commands/dynamic-texture.ts";

function owner(): RendererResourceOwner { return { identity: Symbol("wire test"), session: createIdentityOwner("wire test").session, generation: 0 }; }
const paletteSource: ResolvedResourceReference = {
  id: "resource:worker-palette", requestedPath: "worker/palette", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000", byteLength: 768,
  provenance: { kind: "loose", memberPath: "worker/palette", mount: { kind: "loose", rootPath: "/worker", identity: { id: "mount:worker:palette", content: "q2:worker:palette:0", generation: 0 } } },
  resolution: { kind: "default-order", plan: "mount-plan:worker:palette", rank: 0 },
};
function image(resourceOwner: RendererResourceOwner, ordinal = 0): RendererImage { return { owner: resourceOwner, ordinal, width: 1, height: 1, source: { kind: "generated", name: "wire test" } }; }
function batch(texture: DrawBatch["texture"]): DrawBatch {
  return { primitive: "triangles", texturing: "single", texture, lighting: { kind: "vertex" }, indices: [0],
    vertices: [{ position: { x: 0, y: 0, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, texCoord: { x: 0, y: 0 } }],
    state: { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true, alphaTest: "none", cull: "back", depthRange: [0, 1], polygonOffset: null } };
}
function setup() {
  const frontend = owner(), receiver = owner(), encoder = new WireEncoder(frontend);
  const decoder = new WireDecoder(receiver, () => { throw new Error("Unexpected dynamic request"); }, paletteSource);
  return { frontend, receiver, encoder, decoder };
}
test("wire images retain frontend identity and reconstruct canonical receiver allocations before create", () => {
  const { frontend, receiver, encoder, decoder } = setup(), original = image(frontend);
  const first = decoder.image(encoder.image(original)), second = decoder.image(encoder.image(original));
  expect(first).toBe(second); expect(first.owner).toBe(receiver); expect(first).not.toBe(original);
  expect(encoder.originalImage(0)).toBe(original);
  expect(() => encoder.image(image(owner()))).toThrow("another renderer lifetime");
  expect(() => encoder.image({ ...original })).toThrow("another identity");
  expect(() => decoder.image({ ordinal: 0, width: 2, height: 1, name: "wire test" })).toThrow("metadata changed");
});
test("wire snapshots mutable data without detaching pixels or copying source provenance", () => {
  const { frontend, encoder, decoder } = setup(), pixels = new Uint8Array([1]), colors = new Uint8Array(768);
  colors[0] = 33;
  const creation: ImageResourceOperation = { kind: "create-image", image: image(frontend), sampling: { filter: "nearest", wrap: "repeat" },
    content: { kind: "indexed8", levels: [{ width: 1, height: 1, pixels }], palette: { colors, source: { ...paletteSource, requestedPath: "original/palette" } }, transparency: { kind: "opaque" }, translation: null, fullbright: null } };
  const wire = encoder.imageOperation(creation); pixels[0] = 9; colors[0] = 88;
  const restored = decoder.imageOperation(wire);
  expect(pixels.byteLength).toBe(1);
  if (restored.kind !== "create-image" || restored.content.kind !== "indexed8") throw new Error("Wrong roundtrip kind");
  expect(restored.content.levels[0].pixels[0]).toBe(1); expect(restored.content.palette.colors[0]).toBe(33);
  expect(restored.content.palette.source).toBe(paletteSource);
});
test("paired dynamic bindings share reached source identity and resolve once per draw", () => {
  const frontend = owner(), receiver = owner(), encoder = new WireEncoder(frontend), original = image(frontend);
  let calls = 0;
  const source: DynamicImageSource = { resolve: () => { calls++; return original; } };
  const decoder: WireDecoder = new WireDecoder(receiver, (token): RendererImage => decoder.image(encoder.image(encoder.source(token).resolve(() => undefined))), paletteSource);
  const single = batch({ kind: "dynamic-image", source });
  const paired: DrawBatch = { ...single, texturing: "pair", vertices: single.vertices.map(vertex => ({ ...vertex, texCoord2: { x: 1, y: 1 } })), secondTexture: { environment: "modulate", binding: { kind: "dynamic-image", source } } };
  const decoded = decoder.batch(encoder.batch(paired));
  expect(calls).toBe(0);
  if (decoded.texturing !== "pair" || decoded.texture.kind !== "dynamic-image" || decoded.secondTexture.binding.kind !== "dynamic-image") throw new Error("Wrong paired bindings");
  expect(decoded.texture.source).toBe(decoded.secondTexture.binding.source);
  resolveDrawTextures(decoded, () => undefined);
  expect(calls).toBe(1);
});
test("later invalid batch preserves valid operation and draw prefix", () => {
  const { frontend, encoder, decoder } = setup();
  const valid = batch({ kind: "bind-image", image: image(frontend) }), invalid = batch({ kind: "bind-image", image: image(owner()) });
  const command: RenderCommand = { kind: "view", view: { target: { kind: "preview", id: "test" }, time: { kind: "seconds", value: 0 },
    viewport: { x: 0, y: 0, width: 10, height: 10 }, clear: null, clipPlane: null,
    beforeView: [{ kind: "cull", cull: "none" }], operations: [{ kind: "draw", batches: [valid, invalid] }] } };
  const decoded = decoder.command(encoder.command(command));
  if (decoded.kind !== "view") throw new Error("Wrong command");
  expect([...decoded.view.beforeView]).toEqual([{ kind: "cull", cull: "none" }]);
  const next: IteratorResult<ExecutionOperation, undefined> = decoded.view.operations[Symbol.iterator]().next();
  if (next.done) throw new Error("Missing operation");
  const op = next.value;
  if (op === undefined || op.kind !== "draw") throw new Error("Wrong operation");
  const draws = op.batches[Symbol.iterator]();
  expect(draws.next().done).toBe(false);
  expect(() => draws.next()).toThrow("another renderer lifetime");
});
test("all immediate operation families preserve data and replace images", () => {
  const { frontend, encoder, decoder } = setup(), white = image(frontend), v = { x: 0, y: 0, z: 0, w: 1 };
  const operations: RenderOperation[] = [
    { kind: "disable-portal-clip" }, { kind: "depth-range", range: [0, 1] }, { kind: "cull", cull: "back" }, { kind: "polygon-offset", value: { factor: 1, units: 2 } },
    { kind: "depth-atlas", image: white, passes: [{ viewport: { x: 0, y: 0, width: 1, height: 1 }, clearDepth: 1, draws: [{ positions: [v], indices: [0], cull: "none", polygonOffset: null }] }] },
    { kind: "sky-side", image: white, color: v, strips: [[{ position: v, texCoord: { x: 0, y: 0 } }]] },
    { kind: "shadow-volume", whiteImage: white, positions: [v], indices: [0], mirror: false },
    { kind: "shadow-finish", whiteImage: white, positions: [v, v, v, v] },
    { kind: "q2-fog", camera: { origin: { x: 0, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], viewport: { x: 0, y: 0, width: 1, height: 1 }, clip: { kind: "none" } },
      farDepth: 1, skyDrawn: true, fog: { kind: "q2", color: { x: 1, y: 1, z: 1 }, density: 0.1, skyFactor: 1, height: { start: { color: { x: 1, y: 0, z: 0 }, distance: 0 }, end: { color: { x: 0, y: 1, z: 0 }, distance: 100 }, density: 0.2, falloff: 0.5 } } },
  ];
  for (const operation of operations) expect(decoder.operation(encoder.operation(operation)).kind).toBe(operation.kind);
});
test("malformed boundary variants and readback dimensions reject", () => {
  const { decoder } = setup();
  expect(() => decoder.command({ kind: "draw-buffer", buffer: "invented", clear: false })).toThrow();
  expect(() => decoder.image({ ordinal: -1, width: 1, height: 1, name: "bad" })).toThrow();
  expect(() => decodeImageLevel({ width: 2, height: 1, pixels: new Uint8Array(4) })).toThrow();
  expect(decodeImageLevel({ width: 1, height: 1, pixels: new Uint8Array(4) }).width).toBe(1);
});

test("successful resource acknowledgments consume exact immutable frontend operations", () => {
  const { frontend, encoder, decoder } = setup(), original = image(frontend), pixels = new Uint8Array([4, 3, 2, 1]);
  const operation: ImageResourceOperation = { kind: "create-image", image: original, sampling: { filter: "nearest", wrap: "repeat" },
    content: { kind: "rgba8", levels: [{ width: 1, height: 1, pixels }], borderColor: { x: 0, y: 0, z: 0, w: 1 } } };
  const decoded = decoder.imageOperation(encoder.imageOperation(operation)); pixels.fill(0);
  const token = decoder.acknowledgment(decoded), acknowledged = encoder.acknowledge(token);
  if (acknowledged.kind !== "create-image") throw new Error("Wrong acknowledged operation");
  expect(acknowledged.image).toBe(original);
  expect([...acknowledged.content.levels[0].pixels]).toEqual([4, 3, 2, 1]);
  expect(() => encoder.acknowledge(token)).toThrow("Unknown");
});
test("view state decoding waits until after before-view operations", () => {
  const { decoder } = setup();
  const command = decoder.command({ kind: "view", view: { viewport: null, clear: null, clipPlane: null, beforeView: [{ kind: "cull", cull: "front" }], operations: [] } });
  if (command.kind !== "view") throw new Error("Wrong view command");
  expect([...command.view.beforeView]).toEqual([{ kind: "cull", cull: "front" }]);
  expect(() => command.view.viewport).toThrow();
});

test("Q2 fragment lighting and shadow atlas variants roundtrip with data snapshots", () => {
  const { frontend, receiver, encoder, decoder } = setup(), white = image(frontend), atlas = { image: white, texelSize: 0.01, nearPlane: 4 };
  const position = { x: 1, y: 2, z: 3 }, fraction = { x: 0.1, y: 0.2, z: 0.3 };
  const point = { kind: "point", atlasRect: { x: 0, y: 0, z: 1, w: 1 } } satisfies Q2ShadowProjection;
  const lights = [{ origin: position, radius: 20, color: { x: -1, y: 1, z: 1 }, scale: 1, cone: null, shadow: point }];
  const lighting: BatchLighting[] = [
    { kind: "q2-world", pass: "lightmap", worldPositions: [position], normals: [position], atlas: null, lights },
    { kind: "q2-world", pass: "texture", worldPositions: [position], normals: [position], atlas, lights },
    { kind: "q2-world", pass: "material-lightmap", worldPositions: [position], normals: [position], atlas, lights },
    { kind: "q2-world", pass: "model", worldPositions: [position], normals: [position], atlas, lights: lights.map(light => ({ ...light, fraction })), shadeScale: null },
    { kind: "q2-model-shadow", worldPositions: [position], atlas, lights: [{ origin: position, radius: 20, fraction, shadow: point }], shadeScale: 0.5 },
  ];
  const receiverEncoder = new WireEncoder(receiver);
  for (const entry of lighting) {
    const original: DrawBatch = { ...batch({ kind: "bind-image", image: white }), primitive: "lines", lineWidth: 2, lighting: entry,
      fog: { kind: "exp2", color: fraction, density: 0.1, effect: "rgba" }, textureEffect: "luminance-alpha" };
    const wire = encoder.batch(original);
    const restored = decoder.batch(wire);
    expect(receiverEncoder.batch(restored)).toEqual(wire);
  }
});
test("image operations preserve depth storage, update levels, filters and acknowledgments", () => {
  const { frontend, encoder, decoder } = setup(), allocated = image(frontend), pixels = new Float32Array([0.75]);
  const operations: ImageResourceOperation[] = [
    { kind: "create-image", image: allocated, content: { kind: "depth32f", levels: [{ width: 1, height: 1, pixels }] }, sampling: { wrap: "clamp", filter: "linear" } },
    { kind: "update-image", image: allocated, level: 0, content: { width: 1, height: 1, pixels } },
    { kind: "texture-mode", filter: "linear-mipmap-linear" },
    { kind: "release-image", image: allocated },
  ];
  for (const operation of operations) {
    const decoded = decoder.imageOperation(encoder.imageOperation(operation));
    expect(decoded.kind).toBe(operation.kind);
    expect(encoder.acknowledge(decoder.acknowledgment(decoded))).toEqual(operation);
  }
});
