import type { QvmItemField, QvmItemStorage } from "../../contracts/qvm-mod-items.ts";
import type { QvmImage } from "./image.ts";
import { readQvmItemStorage, writeQvmItemStorage, type QvmItemStorageAccess } from "./item-storage.ts";
import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { InventoryStateBinding } from "../../world/gameplay/inventory.ts";
import type { QvmGameData } from "./game-data.ts";
import type { QvmMemory } from "./memory.ts";
import type { QvmModule } from "./module.ts";

export interface QvmPublicInventoryProfile {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly weaponsOffset: number;
  readonly ammoOffset: number;
  capacity(memory: QvmMemory, weapon: number, context: { readonly module: QvmModule; readonly client: number; readonly entity: number; readonly clientNumber: number }): number;
}
export interface QvmPrivateInventoryProfile {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly image: QvmImage;
  readonly storage: readonly QvmItemStorage[];
}
export type QvmInventoryProfile = QvmPublicInventoryProfile | QvmPrivateInventoryProfile;
interface QvmInventoryWeapon { readonly weapon: number; readonly item: ItemId; readonly ammo: ItemId | null; }
interface QvmInventoryOptions {
  readonly module: QvmModule;
  readonly data: QvmGameData;
  readonly profile: QvmInventoryProfile;
  readonly weapons: readonly QvmInventoryWeapon[] | (() => readonly QvmInventoryWeapon[]);
  /** Resolve the current actor generation; never retain a client view across restore. */
  client(): number;
}
type InventoryField = { readonly item: ItemId; readonly weapon: number; readonly kind: "weapon" | "ammo" };

function validateProfile(options: QvmInventoryOptions): void {
  const { module, data, profile } = options, identity = module.profile.module;
  if (identity.id !== profile.module.id || identity.digest !== profile.module.digest || identity.artifactPath !== profile.module.artifactPath
    || identity.revision !== profile.module.revision || module.abiProfile !== profile.abiProfile || data.abiProfile !== profile.abiProfile)
    throw new Error("QVM inventory profile belongs to another source module");
}

/** Canonical inventory borrows original PS words; the guest remains their sole storage owner. */
export function qvmInventoryBinding(options: QvmInventoryOptions): InventoryStateBinding {
  validateProfile(options);
  const { module, data, profile } = options;
  if ("storage" in profile) return privateInventoryBinding(options, profile);
  const fields = new Map<ItemId, InventoryField>(), slots = new Set<number>();
  let previous: readonly QvmInventoryWeapon[] | null = null;
  const refresh = (): void => {
    const definitions = typeof options.weapons === "function" ? options.weapons() : options.weapons;
    if (definitions === previous) return;
    fields.clear(); slots.clear();
    for (const definition of definitions) {
      if (!Number.isInteger(definition.weapon) || definition.weapon < 1 || definition.weapon >= 16 || slots.has(definition.weapon))
        throw new Error("QVM inventory requires distinct public weapon slots");
      slots.add(definition.weapon);
      const add = (item: ItemId, kind: InventoryField["kind"]): void => {
        if (fields.has(item)) throw new Error(`QVM inventory item ${item} aliases another source field`);
        fields.set(item, { item, kind, weapon: definition.weapon });
      };
      add(definition.item, "weapon");
      if (definition.ammo !== null) add(definition.ammo, "ammo");
    }
    previous = definitions;
  };
  if (typeof options.weapons !== "function") refresh();
  for (const offset of [profile.weaponsOffset, profile.ammoOffset])
    if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) throw new Error("QVM inventory fields require aligned source offsets");
  if (profile.weaponsOffset >= profile.ammoOffset && profile.weaponsOffset < profile.ammoOffset + 64)
    throw new Error("QVM inventory weapon bits overlap ammo counters");
  const view = (): DataView => {
    module.memory.assertLive(); refresh();
    const result = data.publicPlayerBytes(options.client());
    if (profile.weaponsOffset + 4 > result.byteLength || profile.ammoOffset + 64 > result.byteLength)
      throw new Error("QVM inventory fields exceed the public player record");
    return result;
  };
  const capacityContext = { module,
    get clientNumber(): number { return options.client(); },
    get client(): number { return data.clientBytes(options.client()).byteOffset - module.memory.bytes.byteOffset; },
    get entity(): number { return data.entityBytes(options.client()).byteOffset - module.memory.bytes.byteOffset; } };
  const capacity = (field: InventoryField): number => {
    const value = field.kind === "weapon" ? 1 : profile.capacity(module.memory, field.weapon, capacityContext);
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new Error("QVM source ammo capacity is not a nonnegative int32");
    return value;
  };
  return {
    read: () => {
      const source = view();
      return [...fields.values()].map((field): InventoryEntry => field.kind === "weapon"
        ? { item: field.item, count: (source.getInt32(profile.weaponsOffset, true) & 1 << field.weapon) === 0 ? 0 : 1, capacity: 1 }
        : { item: field.item, count: source.getInt32(profile.ammoOffset + field.weapon * 4, true), capacity: capacity(field),
          countPolicy: { kind: "source-counter", arithmetic: "int32" } });
    },
    write: entry => {
      const source = view(), field = fields.get(entry.item);
      if (field === undefined) throw new Error(`QVM inventory did not admit ${entry.item}`);
      if (entry.capacity !== capacity(field)) throw new Error("QVM inventory cannot change source capacity");
      if (field.kind === "weapon") {
        if (entry.count !== 0 && entry.count !== 1 || entry.countPolicy !== undefined && entry.countPolicy.kind !== "stack")
          throw new Error("QVM weapon ownership requires a zero or one stack");
        const before = source.getInt32(profile.weaponsOffset, true), bit = 1 << field.weapon;
        source.setInt32(profile.weaponsOffset, entry.count === 0 ? before & ~bit : before | bit, true);
      } else {
        if (!Number.isInteger(entry.count) || entry.count < -0x80000000 || entry.count > 0x7fffffff
          || entry.countPolicy?.kind !== "source-counter" || entry.countPolicy.arithmetic !== "int32")
          throw new Error("QVM ammo requires its signed int32 source counter");
        source.setInt32(profile.ammoOffset + field.weapon * 4, entry.count, true);
      }
      return undefined;
    },
  };
}

function privateInventoryBinding(options: QvmInventoryOptions, profile: QvmPrivateInventoryProfile): InventoryStateBinding {
  const { module, data } = options;
  const fields = new Map<ItemId, QvmItemStorage>();
  for (const storage of profile.storage) for (const item of storage.kind === "counter" ? [storage.item] : storage.items.map(value => value.item)) fields.set(item, storage);
  const address = (field: QvmItemField): number => {
    module.memory.assertLive();
    const slot = options.client();
    if (data.entityStrideBytes !== profile.entityStride || data.clientStrideBytes !== profile.clientStride) throw new Error("Private QVM inventory source records changed");
    const record = field.record === "client" ? data.clientBytes(slot) : field.record === "entity" ? data.entityBytes(slot) : null;
    if (record === null || field.offset < 0 || field.offset % 4 !== 0 || field.offset + 4 > record.byteLength) throw new Error("Private QVM inventory field exceeds its source record");
    return record.byteOffset - module.memory.bytes.byteOffset + field.offset;
  };
  const access: QvmItemStorageAccess = { read: field => module.memory.dataView(address(field), 4).getInt32(0, true),
    global: at => module.memory.dataView(at, 4).getInt32(0, true), write: (field, value) => module.memory.dataView(address(field), 4).setInt32(0, value, true) };
  return { read: () => profile.storage.flatMap(storage => readQvmItemStorage(profile.image, storage, access)),
    entry: item => { const storage = fields.get(item); return storage === undefined ? undefined : readQvmItemStorage(profile.image, storage, access).find(value => value.item === item); },
    mutableCapacity: item => { const storage = fields.get(item); return storage?.kind === "counter" && storage.capacity.kind === "field"; },
    write: value => { const storage = fields.get(value.item); if (storage === undefined) throw new Error(`QVM inventory did not admit ${value.item}`);
      return writeQvmItemStorage(profile.image, storage, value, access); } };
}

export interface QvmInventoryWord { readonly address: number; readonly value: number; }
/** Compute borrowed source words without publishing temporary inventory as a committed grant. */
export function qvmInventoryProjection(options: QvmInventoryOptions, item: ItemId, count: number): readonly QvmInventoryWord[] {
  validateProfile(options);
  const { module, data, profile } = options;
  if (!Number.isInteger(count) || count < -0x80000000 || count > 0x7fffffff) throw new Error("QVM inventory projection requires an int32 counter");
  if ("storage" in profile) {
    const binding = qvmInventoryBinding(options), entry = binding.entry?.(item);
    const storage = profile.storage.find(value => value.kind === "counter" ? value.item === item : value.items.some(value => value.item === item));
    if (entry === undefined || storage === undefined) throw new Error("Projected QVM item has no original inventory storage");
    const words = new Map<number, number>();
    const address = (field: QvmItemField): number => {
      const slot = options.client(), record = field.record === "client" ? data.clientBytes(slot) : field.record === "entity" ? data.entityBytes(slot) : null;
      if (record === null || field.offset < 0 || field.offset + 4 > record.byteLength) throw new Error("Projected QVM item field exceeds its original record");
      return record.byteOffset - module.memory.bytes.byteOffset + field.offset;
    };
    writeQvmItemStorage(profile.image, storage, { ...entry, count }, { read: field => { const at = address(field); return words.get(at) ?? module.memory.dataView(at, 4).getInt32(0, true); },
      global: at => module.memory.dataView(at, 4).getInt32(0, true), write: (field, value) => { words.set(address(field), value); } });
    return [...words].filter(([address, value]) => module.memory.dataView(address, 4).getInt32(0, true) !== value).map(([address, value]) => ({ address, value }));
  }
  const definitions = typeof options.weapons === "function" ? options.weapons() : options.weapons;
  const weapon = definitions.find(value => value.item === item || value.ammo === item);
  if (weapon === undefined || weapon.weapon < 1 || weapon.weapon > 15) throw new Error("Projected QVM item has no public inventory slot");
  const source = data.publicPlayerBytes(options.client()), base = source.byteOffset - module.memory.bytes.byteOffset;
  if (weapon.item === item) {
    if (count !== 0 && count !== 1) throw new Error("Projected QVM ownership requires zero or one");
    const before = source.getInt32(profile.weaponsOffset, true), mask = 1 << weapon.weapon;
    return [{ address: base + profile.weaponsOffset, value: count === 0 ? before & ~mask : before | mask }];
  }
  return [{ address: base + profile.ammoOffset + weapon.weapon * 4, value: count }];
}
