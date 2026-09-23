import type { GuestAddress, RawEntityView } from "../../../contracts/execution.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import type { ClassicQ2GuestHost } from "./host.ts";
import { classicCombatProfile, type ClassicCombatProfile } from "./combat-profile.ts";
import { readClassicString } from "./records.ts";

interface NativeItem {
  readonly item: ItemId;
  readonly index: number;
  readonly capacity: { readonly kind: "counter" } | { readonly kind: "ammo"; readonly offset: number };
}

/** The qualified Xatrix item table and Add_Ammo use these live client fields. */
export class ClassicSourceInventory {
  private constructor(private readonly host: ClassicQ2GuestHost, private readonly profile: ClassicCombatProfile,
    private readonly items: readonly NativeItem[]) {}

  static create(host: ClassicQ2GuestHost, image: GuestAddress): ClassicSourceInventory | null {
    const profile = classicCombatProfile(host.memory.module.digest);
    if (profile === null) return null;
    const memory = host.memory, items: NativeItem[] = [], names = new Set<ItemId>();
    const capacities = [0x6e4, 0x6e8, 0x6ec, 0x6f0, 0x6f4, 0x6f8, 0x6fc, 0x700];
    for (let index = 0; index < 48; index++) {
      const address = memory.offset(image, BigInt(profile.globals.itemList + index * profile.globals.itemBytes));
      const classname = readClassicString(memory, memory.readPointer(address));
      const name = readClassicString(memory, memory.readPointer(memory.offset(address, 40n)));
      let item: ItemId;
      if (index === 0 && classname === "" && name === "") item = "q2:none";
      else if (index === 47 && classname === "" && name === "Health") item = "q2:item_health";
      else {
        if (!/^[a-z][a-z0-9_]*$/.test(classname)) throw new Error("Native item has no qualified classname");
        item = `q2:${classname}`;
      }
      if (names.has(item)) throw new Error("Duplicate native inventory item");
      names.add(item);
      const flags = memory.readInt32(memory.offset(address, 56n));
      if ((flags & 2) === 0) items.push({ item, index, capacity: { kind: "counter" } });
      else {
        const tag = memory.readInt32(memory.offset(address, 68n)), offset = capacities[tag];
        if (offset === undefined) throw new Error("Native ammo tag has no qualified capacity field");
        items.push({ item, index, capacity: { kind: "ammo", offset } });
      }
    }
    const sentinel = memory.offset(image, BigInt(profile.globals.itemList + 48 * profile.globals.itemBytes));
    if (memory.copy(sentinel, profile.globals.itemBytes).some(byte => byte !== 0)) throw new Error("Native item table exceeds its qualified roster");
    return new ClassicSourceInventory(host, profile, items);
  }

  bind(record: RawEntityView): InventoryStateBinding {
    const host = this.host, memory = host.memory, actor = host.edicts.current(record);
    if (actor === null) throw new Error("Native inventory requires a live source actor");
    const client = (): GuestAddress => {
      if (host.edicts.current(record) !== actor)
        throw new Error("Native inventory owner was released");
      const address = memory.readPointer(memory.offset(record.address, 84n));
      if (address === null) throw new Error("Native inventory requires a source client");
      return address;
    };
    const count = (address: GuestAddress, item: NativeItem) => memory.offset(address, BigInt(this.profile.client.inventory + item.index * 4));
    return {
      mutableCapacity: item => { client(); return this.items.some(value => value.item === item && value.capacity.kind === "ammo"); },
      read: () => {
        const address = client();
        return this.items.map(item => ({ item: item.item, count: memory.readInt32(count(address, item)),
          capacity: item.capacity.kind === "ammo" ? memory.readInt32(memory.offset(address, BigInt(item.capacity.offset))) : item.index === 0 ? 0 : 0x7fffffff,
          countPolicy: { kind: "source-counter", arithmetic: "int32" } }));
      },
      write: entry => {
        const item = this.items.find(item => item.item === entry.item);
        if (item === undefined) throw new Error("Item has no native inventory binding");
        if (!Number.isSafeInteger(entry.count) || entry.count < -0x80000000 || entry.count > 0x7fffffff
          || !Number.isSafeInteger(entry.capacity) || entry.capacity < 0 || entry.capacity > 0x7fffffff)
          throw new RangeError("Native inventory exceeds int32");
        if (item.capacity.kind === "counter" && entry.capacity !== (item.index === 0 ? 0 : 0x7fffffff))
          throw new Error("Native item has a fixed source counter capacity");
        const address = client();
        if (item.capacity.kind === "ammo") memory.writeInt32(memory.offset(address, BigInt(item.capacity.offset)), entry.capacity);
        memory.writeInt32(count(address, item), entry.count);
        return undefined;
      },
    };
  }
}
