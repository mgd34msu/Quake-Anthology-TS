import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { openArchive } from "../../../src/content/archive/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { parseEntities } from "../../../src/core/common-parse.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { qvmClientCollisionSyscall } from "../../../src/compat/qvm/client-collision-syscalls.ts";
import { writeQvmTrace } from "../../../src/compat/qvm/trace-record.ts";
import type { TemporaryTraceQuery } from "../../../src/world/collision/q3/model.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";

const path = resolve(import.meta.dir, "../../../../qfiles/q3a/baseq3/pak0.pk3");
test.skipIf(!existsSync(path))("QVM collision traps use the mounted retail collision owner and source trace ABI", async () => {
  const archive = await openArchive(path);
  try {
    const entry = archive.findEntries("maps/q3dm1.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail map");
    const world = decodeQ3World(await archive.readEntry(entry)), scene = createSceneQueries(world);
    const models = scene.nativeQ3ClipModels();
    if (models === null) throw new Error("Missing native owner");
    expect(scene.nativeQ3ClipModels()).toBe(models);
    const guest = new QvmMemory(new Uint8Array(4096));
    let loaded = "";
    const services = { models: () => models, loadMap: async (name: string) => {
      if (name !== "maps/q3dm1.bsp") throw new Error("Map lifetime mismatch");
      loaded = name;
    } };
    const call = (code: QvmCgameImport, args: readonly number[] = []): QvmHostCall => {
      const words = new DataView(new ArrayBuffer((args.length + 1) * 4));
      words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
      return { words, memory: guest.bytes, guest, code, role: "cgame", kind: "engine", commandArguments: null,
        invoke: () => { throw new Error("Unexpected callback"); }, invokeAsync: async () => { throw new Error("Unexpected callback"); } };
    };
    const vector = (offset: number, value: Vec3) => {
      const view = guest.view(offset, 12); view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
    };
    guest.bytes.set(new TextEncoder().encode("maps/q3dm1.bsp\0"), 64);
    expect(await qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_LOADMAP, [64]), services)).toBe(0);
    expect(loaded).toBe("maps/q3dm1.bsp");
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_NUMINLINEMODELS), services)).toBe(world.models.length);
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_INLINEMODEL, [0]), services)).toBe(0);
    expect(() => qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_INLINEMODEL, [world.models.length]), services)).toThrow();
    const origin = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_deathmatch")?.get("origin")?.trim().split(/\s+/).map(Number);
    if (origin?.[0] === undefined || origin[1] === undefined || origin[2] === undefined) throw new Error("No spawn");
    const start = { x: origin[0], y: origin[1], z: origin[2] + 32 }, end = { ...start, z: start.z - 512 };
    const mins = { x: -15, y: -15, z: -24 }, maxs = { x: 15, y: 15, z: 32 }, zero = { x: 0, y: 0, z: 0 };
    vector(128, start); vector(144, end); vector(160, mins); vector(176, maxs); vector(192, zero); vector(208, { x: 0, y: 90, z: 0 });
    for (const shape of ["box", "capsule"]) {
      if (shape !== "box" && shape !== "capsule") throw new Error("Invalid shape");
      for (const transformed of [false, true]) {
        const code = shape === "box" ? transformed ? QvmCgameImport.CG_CM_TRANSFORMEDBOXTRACE : QvmCgameImport.CG_CM_BOXTRACE
          : transformed ? QvmCgameImport.CG_CM_TRANSFORMEDCAPSULETRACE : QvmCgameImport.CG_CM_CAPSULETRACE;
        const query: TemporaryTraceQuery = { start, end, shape: { kind: shape, mins, maxs }, mask: 0x02010001 };
        const expected = transformed ? models.transformedTrace(query, 0, zero, zero) : models.trace(query, 0);
        expect(expected.fraction).toBeLessThan(1);
        expect(qvmClientCollisionSyscall(call(code, [256, 128, 144, 160, 176, 0, query.mask, 192, 192]), services)).toBe(0);
        const bytes = new Uint8Array(56); writeQvmTrace(new DataView(bytes.buffer), { ...expected, entityNum: 0 });
        expect(guest.bytes.slice(256, 312)).toEqual(bytes);
        const record = guest.view(256, 56);
        expect(record.getInt32(0, true)).toBe(Number(expected.allSolid));
        expect(record.getInt32(4, true)).toBe(Number(expected.startSolid));
        expect(record.getFloat32(8, true)).toBe(Math.fround(expected.fraction));
        expect(record.getFloat32(20, true)).toBe(Math.fround(expected.end.z));
        expect(record.getFloat32(32, true)).toBe(Math.fround(expected.plane.normal.z));
        expect(record.getFloat32(36, true)).toBe(Math.fround(expected.plane.distance));
        expect(record.getUint8(40)).toBe(expected.plane.type);
        expect(record.getUint8(41)).toBe(expected.plane.signbits);
        expect(record.getUint16(42, true)).toBe(0);
        expect(record.getInt32(44, true)).toBe(expected.surfaceFlags);
        expect(record.getInt32(48, true)).toBe(expected.contents);
        expect(record.getInt32(52, true)).toBe(0);
      }
    }
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_POINTCONTENTS, [128, 0]), services)).toBe(models.pointContents(start, 0));
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_TRANSFORMEDPOINTCONTENTS, [128, 0, 192, 208]), services)).toBe(models.transformedPointContents(start, 0, zero, { x: 0, y: 90, z: 0 }));
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_TEMPBOXMODEL, [160, 176]), services)).toBe(255);
    // Source handle 255 ignores the rotation pointer, including an otherwise invalid pointer.
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_TRANSFORMEDPOINTCONTENTS, [192, 255, 192, 999999]), services)).toBe(models.pointContents(zero, 255));
    const temporary = models.transformedTrace({ start, end, shape: { kind: "box", mins: zero, maxs: zero }, mask: -1 }, 255, zero, zero);
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_TRANSFORMEDBOXTRACE, [256, 128, 144, 0, 0, 255, -1, 192, 999999]), services)).toBe(0);
    expect(guest.view(256, 56).getFloat32(8, true)).toBe(Math.fround(temporary.fraction));
    guest.bytes.set(new TextEncoder().encode("maps/other.bsp\0"), 64);
    await expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_LOADMAP, [64]), services)).rejects.toThrow("Map lifetime mismatch");
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_TEMPCAPSULEMODEL, [160, 176]), services)).toBe(254);
    expect(() => qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_POINTCONTENTS, [192, 254]), services)).toThrow();
    expect(() => qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_BOXTRACE, [4090, 128, 144, 0, 0, 0, 1]), services)).toThrow();
    expect(qvmClientCollisionSyscall(call(QvmCgameImport.CG_CM_LOADMODEL), services)).toBeNull();
  } finally { await archive.close(); }
});
