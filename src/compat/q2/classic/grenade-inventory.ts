import type { RawEntityView } from "../../../contracts/execution.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import type { ClassicQ2GuestHost } from "./host.ts";
import { classicCombatProfile } from "./combat-profile.ts";

export function classicGrenadeInventory(host: ClassicQ2GuestHost, record: RawEntityView): InventoryStateBinding | null {
  const profile = classicCombatProfile(host.memory.module.digest);
  if (profile === null) return null;
  const memory = host.memory;
  const at = (offset: number) => {
    const client = memory.readPointer(memory.offset(record.address, 84n));
    if (client === null) throw new Error("Native grenade inventory requires a source client");
    return memory.offset(client, BigInt(offset));
  };
  const counter = profile.client.inventory + profile.items.grenades * 4;
  return {
    read: () => [{ item: "q2:ammo_grenades", count: memory.readInt32(at(counter)), capacity: memory.readInt32(at(profile.client.maxGrenades)), countPolicy: { kind: "source-counter", arithmetic: "int32" } }],
    write: entry => {
      if (entry.item !== "q2:ammo_grenades") throw new Error("Item has no native grenade inventory binding");
      if (!Number.isSafeInteger(entry.count) || entry.count < -0x80000000 || entry.count > 0x7fffffff || !Number.isSafeInteger(entry.capacity) || entry.capacity < 0 || entry.capacity > 0x7fffffff)
        throw new RangeError("Native grenade inventory exceeds int32");
      memory.writeInt32(at(counter), entry.count); memory.writeInt32(at(profile.client.maxGrenades), entry.capacity);
      return undefined;
    },
  };
}
