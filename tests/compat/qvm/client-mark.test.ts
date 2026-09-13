import { expect, test } from "bun:test";
import { qvmClientMarkSyscall } from "../../../src/compat/qvm/client-mark-syscalls.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { BspMarkProjector } from "../../../src/content/q3/presentation/mark-projector.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { MaterialVertex } from "../../../src/materials/geometry.ts";

function projector(surfaceFlags = 0) {
  const vertices: MaterialVertex[] = [[-32, -32], [32, -32], [-32, 32], [32, 32]].map(([x = 0, y = 0]) => ({
    position: { x, y, z: 0 }, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0, y: 0 }, lightmapCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 } }));
  return new BspMarkProjector({ map: { nodes: [], planes: [], leaves: [{ firstSurface: 0, surfaceCount: 1 }], leafSurfaces: [0], surfaceCount: 1 },
    surfaces: [{ kind: "face", surfaceFlags, contentFlags: 1, plane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 }, vertices, indices: [0, 2, 1, 1, 2, 3] }] });
}
function writeVector(view: DataView, offset: number, point: Vec3): void {
  view.setFloat32(offset, point.x, true); view.setFloat32(offset + 4, point.y, true); view.setFloat32(offset + 8, point.z, true);
}
const points: readonly Vec3[] = [{ x: -8, y: -8, z: 1 }, { x: -8, y: 8, z: 1 }, { x: 8, y: 8, z: 1 }, { x: 8, y: -8, z: 1 }];
const projection: Vec3 = { x: 0, y: 0, z: -20 };
function fixture() {
  const memory = new QvmMemory(new Uint8Array(2048));
  const words = new DataView(new ArrayBuffer(32));
  [QvmCgameImport.CG_CM_MARKFRAGMENTS, 4, 64, 128, 128, 256, 32, 1800].forEach((word, index) => words.setInt32(index * 4, word, true));
  points.forEach((point, index) => writeVector(memory.view(64, 48), index * 12, point)); writeVector(memory.view(128, 12), 0, projection);
  const call: QvmHostCall = { kind: "engine", role: "cgame", code: QvmCgameImport.CG_CM_MARKFRAGMENTS, words, memory: memory.bytes, guest: memory,
    commandArguments: null, invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  return { memory, words, call };
}

test("QVM mark output matches source projection against the existing shared face geometry", () => {
  const f = fixture(), source = projector();
  const expected = source.markFragments({ points, projection, maxPoints: 128, maxFragments: 32 });
  expect(expected.fragments).toHaveLength(2);
  expect(qvmClientMarkSyscall(f.call, source)).toBe(expected.fragments.length);
  for (const [index, fragment] of expected.fragments.entries()) {
    const view = f.memory.view(1800, 8, index * 8);
    expect([view.getInt32(0, true), view.getInt32(4, true)]).toEqual([fragment.firstPoint, fragment.pointCount]);
  }
  for (const [index, point] of expected.points.entries()) {
    const view = f.memory.view(256, 12, index * 12);
    expect({ x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) }).toEqual(point);
  }
});

test("mark trap only touches reached outputs and masks bases once", () => {
  const f = fixture();
  f.words.setInt32(8, 2048 + 64, true);
  f.words.setInt32(20, 0, true); f.words.setInt32(28, 0, true);
  expect(qvmClientMarkSyscall(f.call, projector(0x20))).toBe(0);
  f.words.setInt32(28, 1800, true);
  expect(() => qvmClientMarkSyscall(f.call, projector())).toThrow("output points requires a nonnull pointer");
  expect(f.memory.view(1800, 8).getInt32(4, true)).toBeGreaterThan(0);
  f.words.setInt32(20, 2040, true);
  expect(() => qvmClientMarkSyscall(f.call, projector())).toThrow("output points exceeds allocation");
});

test("mark buffers obey source fragment limits without writing subsequent entries", () => {
  const f = fixture(); f.words.setInt32(24, 1, true); f.memory.view(1800, 16).setInt32(8, 0x12345678, true);
  expect(qvmClientMarkSyscall(f.call, projector())).toBe(1);
  expect(f.memory.view(1800, 16).getInt32(8, true)).toBe(0x12345678);
  f.words.setInt32(16, 0, true); f.words.setInt32(20, 0, true); f.words.setInt32(28, 0, true);
  expect(qvmClientMarkSyscall(f.call, projector())).toBe(0);
});
