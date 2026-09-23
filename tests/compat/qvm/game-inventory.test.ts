import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import { QvmGameData } from "../../../src/compat/qvm/game-data.ts";
import { qvmInventoryBinding } from "../../../src/compat/qvm/game-inventory.ts";

function fixture() {
  const code = new BinaryWriter(15);
  for (const opcode of [QvmOpcode.OP_ENTER, QvmOpcode.OP_CONST, QvmOpcode.OP_LEAVE]) { code.u8(opcode); code.i32(0); }
  const output = new BinaryWriter(47);
  for (const word of [0x12721444, 3, 32, 15, 47, 0, 0, 16384]) output.i32(word);
  output.bytes(code.finish()); const bytes = output.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "test:inventory", artifactPath: "vm/qagame.qvm", revision: "test", digest: digestBytes(bytes) } });
  if (artifact.kind !== "bytecode") throw new Error("Missing inventory fixture bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall }), data = new QvmGameData(module.memory);
  data.setClientCount(1); data.locate(64, 1, 808, 2048, 776);
  let live = true, capacity = 50;
  const options = { module, data, profile: { module: artifact.module, abiProfile: module.abiProfile, weaponsOffset: 204, ammoOffset: 376, capacity: () => capacity },
    weapons: [{ weapon: 3, item: "q3:weapon/shotgun", ammo: "q3:ammo/shotgun" }] satisfies readonly { weapon: number; item: `${string}:${string}`; ammo: `${string}:${string}` }[],
    client: () => { if (!live) throw new Error("Retired player"); return 0; } };
  return { module, data, options, binding: qvmInventoryBinding(options), retire: () => { live = false; }, capacity: (value: number) => { capacity = value; } };
}

test("QVM inventory retains source counters and commits only its own source words", () => {
  const f = fixture();
  try {
    const ps = f.data.publicPlayerBytes(0);
    ps.setInt32(204, 1 << 2, true); ps.setInt32(388, -1, true); ps.setInt32(392, 731, true);
    const ammo = f.binding.read().find(entry => entry.item === "q3:ammo/shotgun");
    if (ammo === undefined) throw new Error("Missing admitted ammo");
    expect(ammo).toMatchObject({ count: -1, capacity: 50, countPolicy: { kind: "source-counter", arithmetic: "int32" } });
    const observed: number[] = [], remove = f.module.memory.observeWrites([{ byteOffset: 2048 + 388, byteLength: 4 }], () => {
      observed.push(f.binding.read().find(entry => entry.item === ammo.item)?.count ?? 0); return undefined;
    });
    f.binding.write({ ...ammo, count: -3 }); remove();
    expect(observed).toEqual([-3]); expect(ps.getInt32(392, true)).toBe(731);
    f.binding.write({ item: "q3:weapon/shotgun", count: 1, capacity: 1 }); expect(ps.getInt32(204, true)).toBe((1 << 2) | (1 << 3));
    f.binding.write({ item: "q3:weapon/shotgun", count: 0, capacity: 1 }); expect(ps.getInt32(204, true)).toBe(1 << 2);
    f.binding.write({ ...ammo, count: 99 }); f.capacity(20);
    expect(f.binding.read().find(entry => entry.item === ammo.item)).toMatchObject({ count: 99, capacity: 20 });
    expect(f.binding.mutableCapacity).toBeUndefined();
    expect(() => f.binding.write({ ...ammo, count: 4 })).toThrow("capacity");
    expect(ps.getInt32(388, true)).toBe(99);
  } finally { f.module.retire(); }
});

test("QVM inventory follows relocated records and rejects expired source clients", () => {
  const f = fixture();
  try {
    f.data.publicPlayerBytes(0).setInt32(388, 41, true);
    const original = f.data.checkpoint(); f.data.locate(64, 1, 808, 4096, 776);
    f.data.publicPlayerBytes(0).setInt32(388, 17, true);
    expect(f.binding.read().find(entry => entry.item === "q3:ammo/shotgun")?.count).toBe(17);
    f.data.restore(original);
    expect(f.binding.read().find(entry => entry.item === "q3:ammo/shotgun")?.count).toBe(41);
    f.retire(); expect(() => f.binding.read()).toThrow("Retired player");
  } finally { f.module.retire(); }
  expect(() => f.binding.read()).toThrow();
});

test("QVM inventory rejects unadmitted fields, altered source identity and invalid ABI writes", () => {
  const f = fixture();
  try {
    expect(() => qvmInventoryBinding({ ...f.options, profile: { ...f.options.profile, module: { ...f.options.profile.module, revision: "other" } } })).toThrow("another source");
    expect(() => qvmInventoryBinding({ ...f.options, weapons: [...f.options.weapons, ...f.options.weapons] })).toThrow("distinct");
    expect(() => f.binding.write({ item: "q3:weapon/shotgun", count: 2, capacity: 1 })).toThrow("zero or one");
    expect(() => f.binding.write({ item: "q3:ammo/shotgun", count: 1, capacity: 50 })).toThrow("source counter");
    expect(() => f.binding.write({ item: "q3:ammo/other", count: 1, capacity: 50 })).toThrow("did not admit");
    const ammo = f.binding.read().find(entry => entry.item === "q3:ammo/shotgun");
    if (ammo === undefined) throw new Error("Missing admitted ammo");
    for (const count of [0.5, 0x80000000, -0x80000001, Infinity]) expect(() => f.binding.write({ ...ammo, count })).toThrow("source counter");
  } finally { f.module.retire(); }
});
