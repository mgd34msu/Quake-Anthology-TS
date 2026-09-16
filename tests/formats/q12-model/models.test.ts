import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ModelFrame, Q1AliasFrame, Q1AliasModel, Q2AliasModel } from "../../../src/contracts/scene.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { BinaryError, BinaryWriter } from "../../../src/core/binary/index.ts";
import { buildMd2Geometry, buildMdlGeometry, decodeAliasNormal, decodeMd2Commands, interpolateAliasFrames, parseMd2, parseMdl, parseSp2, parseSpr, sampleTimedFrame } from "../../../src/formats/q12-model/index.ts";

const q1Pak = new URL("../../../../qfiles/q1/id1/PAK0.PAK", import.meta.url).pathname;
const q2Pak = new URL("../../../../qfiles/q2/baseq2/pak0.pak", import.meta.url).pathname;

async function asset(pak: string, path: string): Promise<Uint8Array> {
  const archive = await openArchive(pak);
  try {
    const entry = archive.findEntries(path)[0];
    if (entry === undefined) throw new Error(`Missing ${path} in ${pak}`);
    return await archive.readEntry(entry);
  } finally { archive.close(); }
}

function frameAt(frames: readonly ModelFrame[], index: number): ModelFrame {
  const frame = frames[index];
  if (frame === undefined) throw new Error(`Missing frame ${index}`);
  return frame;
}

function bounded(frame: ModelFrame): void {
  for (const vertex of frame.vertices) {
    expect(vertex.position.x).toBeGreaterThanOrEqual(frame.bounds.min.x);
    expect(vertex.position.y).toBeGreaterThanOrEqual(frame.bounds.min.y);
    expect(vertex.position.z).toBeGreaterThanOrEqual(frame.bounds.min.z);
    expect(vertex.position.x).toBeLessThanOrEqual(frame.bounds.max.x);
    expect(vertex.position.y).toBeLessThanOrEqual(frame.bounds.max.y);
    expect(vertex.position.z).toBeLessThanOrEqual(frame.bounds.max.z);
  }
}

test.skipIf(!existsSync(q1Pak))("real Q1 player MDL retains frames, skins, normals and seam topology", async () => {
  const bytes = await asset(q1Pak, "progs/player.mdl");
  const model = parseMdl(bytes, "progs/player.mdl");
  expect(model.frames.length).toBe(143);
  expect(model.triangles.length).toBe(408);
  const first = model.frames[0];
  if (first === undefined) throw new Error("No player frame");
  const frame = sampleTimedFrame<Q1AliasFrame>(first, 0);
  expect(frame.vertices.length).toBe(212);
  expect(frame.compressedVertices.length).toBe(212);
  bounded(frame);
  const geometry = buildMdlGeometry(model, frame.vertices);
  expect(geometry.indices.length).toBe(model.triangles.length * 3);
  expect(geometry.vertices.length).toBe(model.triangles.length * 3);
  expect(() => parseMdl(bytes.subarray(0, 83))).toThrow(BinaryError);
});

test.skipIf(!existsSync(q1Pak))("real Q1 explosion SPR retains palette pixels and orientation", async () => {
  const model = parseSpr(await asset(q1Pak, "progs/s_explod.spr"));
  expect(model.frames.length).toBe(6);
  expect(model.orientation).toBe(2);
  expect(model.maxWidth).toBe(56);
  const first = model.frames[0];
  if (first === undefined) throw new Error("No explosion frame");
  const frame = sampleTimedFrame(first, 0);
  expect(frame.originX).toBe(-28);
  expect(frame.originY).toBe(28);
  expect(frame.pixels.length).toBe(frame.width * frame.height);
  expect(frame.pixels.includes(255)).toBe(true);
});

test.skipIf(!existsSync(q2Pak))("real Q2 soldier MD2 retains skins, animation, GL commands and bounds", async () => {
  const bytes = await asset(q2Pak, "models/monsters/soldier/tris.md2");
  const model = parseMd2(bytes);
  expect(model.frames.length).toBe(475);
  expect(model.skins.length).toBe(6);
  expect(model.triangles.length).toBe(434);
  const first = frameAt(model.frames, 0);
  expect(first.vertices.length).toBe(227);
  bounded(first);
  const geometry = buildMd2Geometry(model, first.vertices);
  expect(geometry.indices.length).toBe(434 * 3);
  const commands = decodeMd2Commands(model);
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.reduce((sum, command) => sum + command.vertices.length - 2, 0)).toBe(434);
  const blended = interpolateAliasFrames(first, frameAt(model.frames, 1), 0.5);
  expect(blended.length).toBe(227);
  expect(() => parseMd2(bytes.subarray(0, bytes.length - 1))).toThrow(BinaryError);
});

test.skipIf(!existsSync(q2Pak))("real Q2 explosion SP2 retains image references and quad extents", async () => {
  const model = parseSp2(await asset(q2Pak, "sprites/s_explod.sp2"));
  expect(model.frames.length).toBe(6);
  const first = model.frames[0];
  if (first === undefined) throw new Error("No explosion frame");
  expect(first).toEqual({ width: 56, height: 56, originX: 28, originY: 28, image: "sprites/s_explod_0.pcx" });
  expect(model.bounds.max.x).toBeCloseTo(Math.hypot(28, 28));
});

function groupedMdl(): Uint8Array {
  const writer = new BinaryWriter(512);
  writer.bytes(new TextEncoder().encode("IDPO")); writer.i32(6);
  for (const n of [1, 1, 1, 10, 20, 30, 20, 0, 0, 8]) writer.f32(n);
  for (const n of [1, 4, 1, 3, 1, 1, 1, 8]) writer.i32(n);
  writer.f32(2);
  writer.i32(1); writer.i32(2); writer.f32(0.1); writer.f32(0.3);
  writer.bytes(new Uint8Array([1, 2, 224, 255, 5, 6, 7, 8]));
  for (const n of [32, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 2]) writer.i32(n);
  writer.i32(1); writer.i32(2);
  writer.bytes(new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]));
  writer.f32(0.2); writer.f32(0.5);
  for (const z of [0, 10]) {
    writer.bytes(new Uint8Array([0, 0, z, 255, 10, 10, z, 255]));
    const name = new Uint8Array(16); name.set(new TextEncoder().encode(`pose${z}`)); writer.bytes(name);
    writer.bytes(new Uint8Array([0, 0, z, 5, 10, 0, z, 5, 0, 10, z, 5]));
  }
  return writer.finish();
}

test("MDL skin/frame groups preserve cumulative timing, source bounds and seam UVs", () => {
  const model = parseMdl(groupedMdl());
  const frames = model.frames[0];
  const skin = model.skins[0];
  if (frames === undefined || skin === undefined) throw new Error("Missing group");
  expect(model.flags).toBe(8);
  expect(model.sync).toBe("random");
  expect(model.bounds).toEqual({ min: { x: 10, y: 20, z: 30 }, max: { x: 20, y: 30, z: 40 } });
  expect(sampleTimedFrame(skin, 0.2)).toEqual(new Uint8Array([5, 6, 7, 8]));
  expect(sampleTimedFrame(skin, 0, 0.2)).toEqual(new Uint8Array([5, 6, 7, 8]));
  const start = sampleTimedFrame<Q1AliasFrame>(frames, 0);
  const next = sampleTimedFrame<Q1AliasFrame>(frames, 0.3);
  expect(start.name).toBe("pose0"); expect(next.name).toBe("pose10");
  expect(sampleTimedFrame<Q1AliasFrame>(frames, 0.5).name).toBe("pose0");
  expect(buildMdlGeometry(model, start.vertices).vertices[0]?.texCoord).toEqual({ x: 0.625, y: 0.5 });
  expect(interpolateAliasFrames(next, start, 0.5)[0]?.position.z).toBe(35);
  expect(decodeAliasNormal(5)).toEqual({ x: 0, y: 0, z: 1 });
  expect(() => decodeAliasNormal(162)).toThrow(RangeError);
});

test("SPR grouped frames preserve orientation, beam length and interval boundaries", () => {
  const writer = new BinaryWriter(128);
  writer.bytes(new TextEncoder().encode("IDSP")); writer.i32(1); writer.i32(4); writer.f32(2);
  writer.i32(1); writer.i32(1); writer.i32(1); writer.f32(3); writer.i32(1);
  writer.i32(1); writer.i32(2); writer.f32(0.25); writer.f32(0.75);
  for (const pixel of [224, 255]) {
    writer.i32(0); writer.i32(1); writer.i32(1); writer.i32(1); writer.u8(pixel);
  }
  const model = parseSpr(writer.finish());
  const frames = model.frames[0];
  if (frames === undefined) throw new Error("Missing sprite group");
  expect(model.orientation).toBe(4); expect(model.beamLength).toBe(3);
  expect(sampleTimedFrame(frames, 0.25).pixels[0]).toBe(255);
  expect(sampleTimedFrame(frames, 0.75).pixels[0]).toBe(224);
});

test("MDL geometry retains fresh topology, seams and per-call pose validation", () => {
  const decoded = parseMdl(groupedMdl()), frames = decoded.frames[0];
  if (frames === undefined) throw Error("Missing frames");
  const model: Q1AliasModel = { ...decoded, triangles: [
    { front: true, vertices: [0, 1, 2] }, { front: false, vertices: [0, 2, 1] },
  ] };
  const first = sampleTimedFrame<Q1AliasFrame>(frames, 0).vertices;
  const next = sampleTimedFrame<Q1AliasFrame>(frames, .3).vertices;
  expect(() => buildMdlGeometry(model, [])).toThrow("pose vertex");
  const cold = buildMdlGeometry(model, first), warm = buildMdlGeometry(model, next);
  expect(cold.indices).toEqual([0, 1, 2, 3, 4, 5]);
  expect(warm.indices).not.toBe(cold.indices);
  const expected = [0, 1, 2, 0, 2, 1].map(index => {
    const vertex = next[index]; if (vertex === undefined) throw Error("Missing expected pose vertex"); return vertex;
  });
  expect(warm.vertices.map(vertex => vertex.position)).toEqual(expected.map(vertex => vertex.position));
  expect(warm.vertices.map(vertex => vertex.normal)).toEqual(expected.map(vertex => vertex.normal));
  expect(warm.vertices[0]?.texCoord).not.toBe(cold.vertices[0]?.texCoord);
  expect(warm.vertices[0]?.texCoord).toEqual({x:.125,y:.5});
  expect(warm.vertices[3]?.texCoord).toEqual({x:.625,y:.5});
  expect(cold.vertices[0]?.position).not.toEqual(warm.vertices[0]?.position);
  expect(() => buildMdlGeometry(model, [])).toThrow("pose vertex");
  expect(buildMdlGeometry({...model}, first).indices).not.toBe(cold.indices);
  const malformed = {...model, textureCoordinates: []};
  expect(() => buildMdlGeometry(malformed, [])).toThrow("pose vertex");
  expect(() => buildMdlGeometry(malformed, first)).toThrow("texture coordinate");
});

test("MD2 topology reuse preserves independent UV indices and fresh animated vertices", () => {
  const position={x:1,y:2,z:3},normal={x:0,y:0,z:1};
  const pose=[{position,normal},{position:{x:4,y:5,z:6},normal}];
  const model: Q2AliasModel={kind:"q2-md2",bounds:{min:position,max:position},skinWidth:8,skinHeight:4,
    skins:[],frames:[],glCommands:new Int32Array(),textureCoordinates:[{x:0,y:0},{x:3,y:2}],
    triangles:[{vertices:[1,0,1],texCoords:[0,1,1]}]};
  expect(() => buildMd2Geometry(model, [])).toThrow("pose vertex");
  const cold=buildMd2Geometry(model,pose);
  const next=pose.map(vertex=>({position:{...vertex.position,z:9},normal:{x:0,y:1,z:0}}));
  const warm=buildMd2Geometry(model,next);
  expect(warm.indices).toBe(cold.indices); expect(warm.indices).toEqual([0,1,2]);
  expect(warm.vertices.map(vertex=>vertex.texCoord)).toEqual([{x:.0625,y:.125},{x:.4375,y:.625},{x:.4375,y:.625}]);
  expect(warm.vertices[1]?.texCoord).toBe(cold.vertices[1]?.texCoord);
  const expected = [1, 0, 1].map(index => {
    const vertex = next[index]; if (vertex === undefined) throw Error("Missing expected pose vertex"); return vertex.position;
  });
  expect(warm.vertices.map(vertex=>vertex.position)).toEqual(expected);
  expect(warm.vertices[0]?.normal).toEqual({x:0,y:1,z:0});
  expect(cold.vertices[0]?.position.z).toBe(6);
  expect(warm.vertices[0]).not.toBe(cold.vertices[0]);
  expect(() => buildMd2Geometry(model, [])).toThrow("pose vertex");
  const malformed={...model,textureCoordinates:[]};
  expect(() => buildMd2Geometry(malformed, [])).toThrow("pose vertex");
  expect(() => buildMd2Geometry(malformed,pose)).toThrow("texture coordinate");
});
