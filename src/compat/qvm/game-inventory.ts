import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { InventoryStateBinding } from "../../world/gameplay/inventory.ts";
import type { QvmGameData } from "./game-data.ts";
import type { QvmMemory } from "./memory.ts";
import type { QvmModule } from "./module.ts";

export interface QvmInventoryProfile {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly weaponsOffset: number;
  readonly ammoOffset: number;
  capacity(memory: QvmMemory, weapon: number, context: { readonly module: QvmModule; readonly client: number; readonly entity: number; readonly clientNumber: number }): number;
}
interface QvmInventoryWeapon { readonly weapon: number; readonly item: ItemId; readonly ammo: ItemId | null; }
interface QvmInventoryOptions {
  readonly module: QvmModule;
  readonly data: QvmGameData;
  readonly profile: QvmInventoryProfile;
  readonly weapons: readonly QvmInventoryWeapon[];
  /** Resolve the current actor generation; never retain a client view across restore. */
  client(): number;
}
type InventoryField = { readonly item: ItemId; readonly weapon: number; readonly kind: "weapon" | "ammo" };

/** Canonical inventory borrows original PS words; the guest remains their sole storage owner. */
export function qvmInventoryBinding(options: QvmInventoryOptions): InventoryStateBinding {
  const { module, data, profile } = options, identity = module.profile.module;
  if (identity.id !== profile.module.id || identity.digest !== profile.module.digest || identity.artifactPath !== profile.module.artifactPath
    || identity.revision !== profile.module.revision || module.abiProfile !== profile.abiProfile || data.abiProfile !== profile.abiProfile)
    throw new Error("QVM inventory profile belongs to another source module");
  const fields = new Map<ItemId, InventoryField>(), slots = new Set<number>();
  for (const definition of options.weapons) {
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
  for (const offset of [profile.weaponsOffset, profile.ammoOffset])
    if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) throw new Error("QVM inventory fields require aligned source offsets");
  if (profile.weaponsOffset >= profile.ammoOffset && profile.weaponsOffset < profile.ammoOffset + 64)
    throw new Error("QVM inventory weapon bits overlap ammo counters");
  const view = (): DataView => {
    module.memory.assertLive();
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
