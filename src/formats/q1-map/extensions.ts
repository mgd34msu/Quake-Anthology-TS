/* BSPX layouts adapted from FTE specs/bspx.txt and q2repro/common/bsp.c.
 * GPL-2.0-or-later. */
import type { Plane } from "../../contracts/math.ts";
import type { DecoupledLightmap, Q1BrushListModel } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { bounds, index, optionalOffset, records, vec3, vec4 } from "./records.ts";
import type { Q1BspxLump, Q1BspxMetadata, Q1FaceNormals, Q1Lump } from "./types.ts";

export function readBspx(reader: BinaryReader, lumps: readonly Q1Lump[]): readonly Q1BspxLump[] {
  let end = 124;
  for (const lump of lumps) end = Math.max(end, lump.offset + lump.length);
  const candidates = [Math.ceil(end / 4) * 4];
  if (!lumps.some((lump) => lump.length > 0 && lump.offset < 132 && lump.offset + lump.length > 124)) candidates.push(124);
  for (const offset of candidates) {
    if (offset > reader.length - 8 || reader.section(offset, 4).fixedByteString(4) !== "BSPX") continue;
    const directory = reader.section(offset + 4, reader.length - offset - 4);
    const count = directory.u32();
    if (count > directory.remaining / 32) throw new BinaryError(reader.source, offset, `invalid BSPX count ${count}`);
    const result: Q1BspxLump[] = [];
    for (let i = 0; i < count; i++) {
      const name = directory.fixedByteString(24);
      const lumpOffset = directory.u32();
      const length = directory.u32();
      result.push({ name, offset: lumpOffset, length, data: reader.section(lumpOffset, length).bytes(length) });
    }
    return result;
  }
  return [];
}

export function bspxData(lumps: readonly Q1BspxLump[], name: string): Uint8Array | null {
  return lumps.find((lump) => lump.name === name)?.data ?? null;
}

export function readDecoupledLightmaps(data: Uint8Array | null, faceCount: number): readonly DecoupledLightmap[] | null {
  if (data === null) return null;
  const reader = new BinaryReader(data, "BSPX DECOUPLED_LM");
  if (data.length !== faceCount * 40) throw new BinaryError(reader.source, 0, "record count does not match faces");
  return records(reader, 40, (r) => {
    const width = r.u16();
    const height = r.u16();
    const lightingOffset = optionalOffset(r.u32());
    const s = vec4(r);
    const t = vec4(r);
    return { width, height, lightingOffset, axes: [{ x: s.x, y: s.y, z: s.z }, { x: t.x, y: t.y, z: t.z }], offset: { x: s.w, y: t.w } };
  });
}

/** Plane arrays contain authored non-axial planes. Collision adds bounds planes later. */
export function readBrushList(data: Uint8Array | null, modelCount: number): readonly Q1BrushListModel[] | null {
  if (data === null) return null;
  const reader = new BinaryReader(data, "BSPX BRUSHLIST");
  const models: Q1BrushListModel[] = [];
  while (reader.remaining > 0) {
    const version = reader.u32();
    if (version !== 1) return null;
    const model = reader.u32();
    index(model, modelCount, reader.source);
    const count = reader.u32();
    const expectedPlanes = reader.u32();
    if (count > reader.remaining / 28 || expectedPlanes > (reader.remaining - count * 28) / 16) {
      throw new BinaryError(reader.source, reader.offset, "brushes or planes exceed lump");
    }
    const brushes: Q1BrushListModel["brushes"][number][] = [];
    let planeTotal = 0;
    for (let i = 0; i < count; i++) {
      const box = bounds(reader);
      const contents = reader.i16();
      const planeCount = reader.u16();
      planeTotal += planeCount;
      if (planeTotal > expectedPlanes) throw new BinaryError(reader.source, reader.offset, "brush plane count exceeds model total");
      const planes: Plane[] = [];
      for (let j = 0; j < planeCount; j++) planes.push({ normal: vec3(reader), distance: reader.finiteF32() });
      brushes.push({ bounds: box, contents, planes });
    }
    if (planeTotal !== expectedPlanes) throw new BinaryError(reader.source, reader.offset, "brush plane count differs from model total");
    models.push({ model, brushes });
  }
  return models;
}

function perFaceStyles(data: Uint8Array | null, faceCount: number, wide: boolean): readonly (readonly number[])[] | null {
  if (data === null) return null;
  const reader = new BinaryReader(data, wide ? "BSPX LMSTYLE16" : "BSPX LMSTYLE");
  const width = wide ? 2 : 1;
  if (faceCount === 0) {
    if (data.length > 0) throw new BinaryError(reader.source, 0, "styles with no faces");
    return [];
  }
  if (data.length % (width * faceCount) !== 0) throw new BinaryError(reader.source, 0, "style count does not match faces");
  const count = data.length / (width * faceCount);
  const result: number[][] = [];
  for (let i = 0; i < faceCount; i++) {
    const styles: number[] = [];
    for (let j = 0; j < count; j++) styles.push(wide ? reader.u16() : reader.u8());
    result.push(styles);
  }
  return result;
}

function readFaceNormals(data: Uint8Array | null, cornerCount: number): Q1FaceNormals | null {
  if (data === null) return null;
  const reader = new BinaryReader(data, "BSPX FACENORMALS");
  const count = reader.u32();
  const vectors = records(reader.section(reader.offset, count * 12), 12, vec3);
  reader.skip(count * 12);
  const indices: [number, number, number][] = [];
  for (let i = 0; i < cornerCount; i++) {
    const normal = reader.u32();
    const tangent = reader.u32();
    const bitangent = reader.u32();
    index(normal, count, reader.source);
    index(tangent, count, reader.source);
    index(bitangent, count, reader.source);
    indices.push([normal, tangent, bitangent]);
  }
  return { vectors, indices };
}

export function readBspxMetadata(lumps: readonly Q1BspxLump[], faceCount: number, vertexCount: number, cornerCount: number): Q1BspxMetadata {
  const get = (name: string): Uint8Array | null => bspxData(lumps, name);
  const exact = (name: string, length: number): Uint8Array | null => {
    const data = get(name);
    if (data !== null && data.length !== length) throw new BinaryError(`BSPX ${name}`, 0, `expected ${length} bytes, got ${data.length}`);
    return data;
  };
  const offsets = exact("LMOFFSET", faceCount * 4);
  const hdr = get("LIGHTING_E5BGR9");
  const normals = exact("VERTEXNORMALS", vertexCount * 12);
  return {
    lightmapShifts: exact("LMSHIFT", faceCount),
    lightmapOffsets: offsets === null ? null : records(new BinaryReader(offsets, "BSPX LMOFFSET"), 4, (r) => optionalOffset(r.u32())),
    lightmapStyles: perFaceStyles(get("LMSTYLE"), faceCount, false),
    lightmapStyles16: perFaceStyles(get("LMSTYLE16"), faceCount, true),
    rgbLighting: get("RGBLIGHTING"),
    hdrLighting: hdr === null ? null : records(new BinaryReader(hdr, "BSPX LIGHTING_E5BGR9"), 4, (r) => r.u32()),
    lightingDirections: get("LIGHTINGDIR"),
    vertexNormals: normals === null ? null : records(new BinaryReader(normals, "BSPX VERTEXNORMALS"), 12, vec3),
    faceNormals: readFaceNormals(get("FACENORMALS"), cornerCount),
  };
}
