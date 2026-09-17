import { BinaryError, BinaryWriter } from "../../core/binary/index.ts";

/** Decode the Q3 test disk layout into the shared IBSP46 loading contract. */
export function normalizeQ3Bsp(data: Uint8Array, source: string): Uint8Array {
  if (data.length < 8) return data;
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (input.getUint32(0, true) !== 0x50534249 || input.getInt32(4, true) !== 44) return data;
  const fail = (offset: number, message: string): never => { throw new BinaryError(source, offset, message); };
  if (data.length < 128) fail(8, "truncated IBSP44 directory");
  const sections = Array.from({ length: 15 }, (_, index) => {
    const offset = input.getInt32(8 + index * 8, true), length = input.getInt32(12 + index * 8, true);
    if (offset < 0 || length < 0 || offset > data.length - length || length > 0 && offset < 128) fail(8 + index * 8, "invalid IBSP44 lump range");
    return data.subarray(offset, offset + length);
  });
  const section = (index: number): Uint8Array => sections[index] ?? fail(8, "missing IBSP44 lump");
  const records = (index: number, stride: number): DataView[] => {
    const bytes = section(index);
    if (bytes.length % stride !== 0) fail(8 + index * 8, `invalid IBSP44 record size ${stride}`);
    return Array.from({ length: bytes.length / stride }, (_, i) => new DataView(bytes.buffer, bytes.byteOffset + i * stride, stride));
  };
  const int = (record: DataView, offset: number): number => record.getInt32(offset, true);
  const bytes = (record: DataView, offset: number, length: number): Uint8Array => new Uint8Array(record.buffer, record.byteOffset + offset, length);
  const at = (items: readonly DataView[], index: number): DataView => items[index] ?? fail(0, `invalid IBSP44 reference ${index}`);
  const range = (first: number, count: number, length: number): void => {
    if (first < 0 || count < 0 || first > length - count) fail(0, "invalid IBSP44 record range");
  };
  const planes = records(1, 20), nodes = records(2, 36), leaves = records(3, 48);
  const leafSurfaces = records(4, 4), leafBrushes = records(5, 4), models = records(6, 48);
  const brushes = records(7, 12), sides = records(8, 8), surfaces = records(12, 164), fogs = records(13, 68);
  const originalIndices = records(14, 4).map(record => int(record, 0));
  const indices = [...originalIndices];
  const sideNames = new Map<number, Uint8Array>();
  for (const surface of surfaces) {
    const side = int(surface, 68);
    if (side >= 0) { at(sides, side); sideNames.set(side, bytes(surface, 0, 64)); }
  }
  const sideContents = new Map<number, number>();
  for (const brush of brushes) {
    const first = int(brush, 0), count = int(brush, 4);
    range(first, count, sides.length);
    for (let i = first; i < first + count; i++) sideContents.set(i, int(brush, 8));
  }
  const shaderRecords: Uint8Array[] = [], shaderIds = new Map<string, number>();
  const shader = (name: Uint8Array, flags: number, contents: number): number => {
    const key = `${Array.from(name).join(",")}:${flags}:${contents}`;
    const existing = shaderIds.get(key);
    if (existing !== undefined) return existing;
    const writer = new BinaryWriter(72);
    writer.bytes(name); writer.i32(flags); writer.i32(contents);
    const id = shaderRecords.length;
    shaderRecords.push(writer.finish()); shaderIds.set(key, id); return id;
  };
  const emptyName = new Uint8Array(64);
  const brushRecords = brushes.map(brush => {
    const first = int(brush, 0), writer = new BinaryWriter(12);
    writer.i32(first); writer.i32(int(brush, 4)); writer.i32(shader(sideNames.get(first) ?? emptyName, 0, int(brush, 8)));
    return writer.finish();
  });
  const sideRecords = sides.map((side, index) => {
    const writer = new BinaryWriter(8);
    writer.i32(int(side, 0)); writer.i32(shader(sideNames.get(index) ?? emptyName, int(side, 4), sideContents.get(index) ?? 0));
    return writer.finish();
  });
  const surfaceRecords = surfaces.map(surface => {
    const sideIndex = int(surface, 68), flags = sideIndex < 0 ? 0 : int(at(sides, sideIndex), 4);
    const patchWidth = int(surface, 88), patchHeight = int(surface, 92), vertexCount = int(surface, 76);
    let firstIndex = int(surface, 80), indexCount = int(surface, 84);
    range(firstIndex, indexCount, originalIndices.length);
    const type = patchWidth > 0 && patchHeight > 0 ? 2 : indexCount > 0 ? 3 : 1;
    if (type === 1) {
      if (vertexCount < 3) fail(0, "IBSP44 polygon has fewer than three vertices");
      firstIndex = indices.length;
      for (let i = 1; i < vertexCount - 1; i++) indices.push(0, i, i + 1);
      indexCount = indices.length - firstIndex;
    }
    const writer = new BinaryWriter(104);
    writer.i32(shader(bytes(surface, 0, 64), flags, sideContents.get(sideIndex) ?? 0));
    writer.i32(int(surface, 64)); writer.i32(type);
    writer.i32(int(surface, 72)); writer.i32(vertexCount); writer.i32(firstIndex); writer.i32(indexCount);
    writer.bytes(bytes(surface, 96, 68));
    writer.i32(patchWidth); writer.i32(patchHeight);
    return writer.finish();
  });
  const modelRecords = models.map(model => {
    const surfaceIds = new Set<number>(), brushIds = new Set<number>(), visited = new Set<number>();
    const pending = [int(model, 36)];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (nodeId === undefined) break;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (nodeId >= 0) {
        const node = at(nodes, nodeId); pending.push(int(node, 4), int(node, 8)); continue;
      }
      const leaf = at(leaves, -nodeId - 1);
      const firstSurface = int(leaf, 32), surfaceCount = int(leaf, 36), firstBrush = int(leaf, 40), brushCount = int(leaf, 44);
      range(firstSurface, surfaceCount, leafSurfaces.length); range(firstBrush, brushCount, leafBrushes.length);
      for (let i = firstSurface; i < firstSurface + surfaceCount; i++) surfaceIds.add(int(at(leafSurfaces, i), 0));
      for (let i = firstBrush; i < firstBrush + brushCount; i++) brushIds.add(int(at(leafBrushes, i), 0));
    }
    const modelRange = (ids: ReadonlySet<number>, output: Uint8Array[], originals: number): readonly [number, number] => {
      const sorted = [...ids].sort((a, b) => a - b);
      for (const id of sorted) if (id < 0 || id >= originals) fail(0, "invalid IBSP44 model member");
      const first = sorted[0] ?? 0;
      if (sorted.every((id, index) => id === first + index)) return [first, sorted.length];
      const start = output.length;
      for (const id of sorted) output.push(output[id] ?? fail(0, "missing IBSP44 model member"));
      return [start, sorted.length];
    };
    const [firstSurface, surfaceCount] = modelRange(surfaceIds, surfaceRecords, surfaces.length);
    const [firstBrush, brushCount] = modelRange(brushIds, brushRecords, brushes.length);
    const writer = new BinaryWriter(40);
    writer.bytes(bytes(model, 0, 24)); writer.i32(firstSurface); writer.i32(surfaceCount); writer.i32(firstBrush); writer.i32(brushCount);
    return writer.finish();
  });
  const join = (parts: readonly Uint8Array[]): Uint8Array => {
    const writer = new BinaryWriter(parts.reduce((sum, part) => sum + part.length, 0));
    for (const part of parts) writer.bytes(part);
    return writer.finish();
  };
  const indexWriter = new BinaryWriter(indices.length * 4);
  for (const index of indices) indexWriter.i32(index);
  const convertedFogs = fogs.map(fog => {
    const writer = new BinaryWriter(72); writer.bytes(bytes(fog, 0, 68)); writer.i32(-1); return writer.finish();
  });
  const output = [section(0), join(shaderRecords), join(planes.map(plane => bytes(plane, 0, 16))), section(2), section(3),
    section(4), section(5), join(modelRecords), join(brushRecords), join(sideRecords), section(11), indexWriter.finish(),
    join(convertedFogs), join(surfaceRecords), section(9), new Uint8Array(), section(10)];
  const writer = new BinaryWriter(144 + output.reduce((sum, part) => sum + part.length, 0));
  writer.u32(0x50534249); writer.i32(46);
  let offset = 144;
  for (const part of output) { writer.i32(offset); writer.i32(part.length); offset += part.length; }
  for (const part of output) writer.bytes(part);
  return writer.finish();
}
