import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import { QvmGameData } from "../../../src/compat/qvm/game-data.ts";
import { qvmInventoryBinding, qvmInventoryProjection } from "../../../src/compat/qvm/game-inventory.ts";

import { parseQvmItemLayout } from "../../../src/compat/qvm/item-catalog.ts";
import { readQvmPrimaryInventoryProfile } from "../../../src/compat/qvm/primary-inventory-profile.ts";
import { Q3GuestCatalog } from "../../../src/content/q3/guest-items.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { q3GuestPlayerUi } from "../../../src/app/bootstrap/simulation/q3/guest-player.ts";
import { toQ3PlayerState } from "../../../src/network/q3/adapters.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import type { ItemId } from "../../../src/contracts/gameplay.ts";

function fixture(stores: readonly { readonly address: number; readonly value: number }[] = []) {
  const length = 15 + stores.length * 11, code = new BinaryWriter(length);
  code.u8(QvmOpcode.OP_ENTER); code.i32(0);
  for (const store of stores) {
    code.u8(QvmOpcode.OP_CONST); code.i32(store.address); code.u8(QvmOpcode.OP_CONST); code.i32(store.value); code.u8(QvmOpcode.OP_STORE4);
  }
  code.u8(QvmOpcode.OP_CONST); code.i32(0); code.u8(QvmOpcode.OP_LEAVE); code.i32(0);
  const output = new BinaryWriter(32 + length);
  for (const word of [0x12721444, 3 + stores.length * 3, 32, length, 32 + length, 0, 0, 16384]) output.i32(word);
  output.bytes(code.finish()); const bytes = output.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "test:inventory", artifactPath: "vm/qagame.qvm", revision: "test", digest: digestBytes(bytes) } });
  if (artifact.kind !== "bytecode") throw new Error("Missing inventory fixture bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall }), data = new QvmGameData(module.memory);
  data.setClientCount(1); data.locate(64, 1, 808, 2048, 776);
  let live = true, capacity = 50;
  const options = { module, data, profile: { module: artifact.module, abiProfile: module.abiProfile, weaponsOffset: 204, ammoOffset: 376, capacity: () => capacity },
    weapons: [{ weapon: 3, item: "q3:weapon/shotgun", ammo: "q3:ammo/shotgun" }] satisfies readonly { weapon: number; item: `${string}:${string}`; ammo: `${string}:${string}` }[],
    client: () => { if (!live) throw new Error("Retired player"); return 0; } };
  return { artifact, module, data, options, binding: qvmInventoryBinding(options), retire: () => { live = false; }, capacity: (value: number) => { capacity = value; } };
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


test("original QVM initialization publishes a live catalog with private inventory beyond public weapon tags", () => {
  const stores: { address: number; value: number }[] = [], data = new Uint8Array(12000), view = new DataView(data.buffer);
  let next = 10000;
  const string = (text: string): number => { const address = next; const bytes = new TextEncoder().encode(text); data.set(bytes, address); next += bytes.length + 1; return address; };
  const label = string("Arc Thrower");
  for (const [index, type, classname, name] of [[0, 7, "weapon_arc", label], [1, 9, "ammo_arc", string("Arc Charges")]] satisfies readonly (readonly [number, number, string, number])[]) {
    const record = 9000 + index * 20;
    view.setInt32(record, type, true); view.setInt32(record + 4, string(classname), true); view.setInt32(record + 8, 36, true); view.setInt32(record + 12, name, true);
  }
  view.setInt32(8800, 9000, true); view.setInt32(8804, 2, true);
  view.setInt32(64 + 700, 0x88, true); view.setInt32(2048 + 704, -1, true); view.setInt32(2048 + 708, 99, true);
  view.setInt32(2048 + 204, 711, true);
  for (let address = 0; address < data.length; address += 4) if (view.getInt32(address, true) !== 0) stores.push({ address, value: view.getInt32(address, true) });
  const f = fixture(stores);
  const ammo: ItemId = `q3:guest/${f.artifact.module.digest}/ammo_arc`;
  const profile = readQvmPrimaryInventoryProfile(new SaveReader({ storage: [
    { kind: "bits", field: { record: "entity", offset: 700 }, privateMask: 128, items: [{ item: "test:arc", mask: 8 }] },
    { kind: "counter", field: { record: "client", offset: 704 }, item: ammo, capacity: { kind: "field", field: { record: "client", offset: 708 } } },
  ] }), f.artifact, { entityStride: 808, clientStride: 776 });
  const layout = parseQvmItemLayout(new SaveReader({ source: "live", address: { global: 8800 }, count: { global: 8804, maximum: 4 }, stride: 20,
    fields: { className: 4, pickupName: 12, type: 0, tag: 8 }, weaponType: 7, ammoType: 9 }));
  const catalog = new Q3GuestCatalog(f.artifact, f.module, layout, [], [{ value: 36, item: "test:arc" }], profile);
  const options = { ...f.options, profile, weapons: () => catalog.weapons() }, inventory = qvmInventoryBinding(options);
  try {
    expect(catalog.weapons()).toEqual([]);
    f.module.call([]);
    const weapons = catalog.weapons();
    expect(weapons).toEqual([{ weapon: 36, item: "test:arc", ammo, label: "Arc Thrower" }]);
    expect(inventory.read()).toEqual([{ item: "test:arc", count: 1, capacity: 1 }, { item: ammo, count: -1, capacity: 99, countPolicy: { kind: "source-counter", arithmetic: "int32" } }]);
    const state = toQ3PlayerState(new PlayerStateRecord("baseq3", 0, 0, 0));
    const ui = q3GuestPlayerUi(state, { provider: "q3:official", content: "q3:classic:baseq3:installed" }, 0, weapons, "baseq3", inventory.read(), "test:arc");
    expect(ui.activeWeapon).toBe("test:arc"); expect(ui.ammo?.count).toBe(-1); expect(ui.items[0]?.owned).toBe(true);
    let writes = 0;
    const remove = f.module.memory.observeWrites([{ byteOffset: 764, byteLength: 4 }, { byteOffset: 2752, byteLength: 8 }], () => { writes++; return undefined; });
    expect(qvmInventoryProjection(options, "test:arc", 0)).toEqual([{ address: 764, value: 128 }]);
    expect(qvmInventoryProjection(options, ammo, 52)).toEqual([{ address: 2752, value: 52 }]);
    expect(writes).toBe(0); expect(inventory.entry?.(ammo)?.count).toBe(-1);
    const entry = inventory.entry?.(ammo); if (entry === undefined) throw new Error("Missing original private counter");
    inventory.write({ ...entry, count: 81, capacity: 120 });
    expect(writes).toBe(2); remove();
    expect(inventory.entry?.(ammo)).toMatchObject({ count: 81, capacity: 120 });
    expect(f.data.publicPlayerBytes(0).getInt32(204, true)).toBe(711);
    f.module.memory.dataView(12000, 4).setInt32(0, 9, true); expect(catalog.weapons()).toBe(weapons);
    const checkpoint = f.module.memory.bytes.slice();
    f.module.memory.dataView(label, 4).setInt32(0, 0x20656741, true);
    expect(catalog.weapons()[0]?.label).toBe("Age Thrower"); expect(catalog.weapons()).not.toBe(weapons);
    f.module.memory.writeBytes(11000, f.module.memory.bytes.slice(9000, 9040)); f.module.memory.dataView(8800, 4).setInt32(0, 11000, true);
    expect(catalog.records()[0]?.address).toBe(11000);
    f.module.memory.dataView(8804, 4).setInt32(0, 1, true); expect(catalog.weapons()[0]?.ammo).toBeNull();
    f.module.interpreter.restoreData(checkpoint); catalog.reset();
    expect(catalog.weapons()).toEqual(weapons); expect(catalog.records()[0]?.address).toBe(9000); expect(inventory.entry?.(ammo)?.count).toBe(81);
    f.module.memory.dataView(label, 4).setInt32(0, 0x20656741, true); expect(catalog.weapons()[0]?.label).toBe("Age Thrower");
    f.module.memory.dataView(8804, 4).setInt32(0, 5, true); expect(() => catalog.weapons()).toThrow("exceeds initialized or live");
    catalog.close(); expect(() => catalog.weapons()).toThrow("retired");
    f.retire(); expect(() => inventory.read()).toThrow("Retired player");
  } finally { catalog.close(); f.module.retire(); }
});
