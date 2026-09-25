import type { ItemId } from "../../../../contracts/gameplay.ts";
import { q2ItemPickupName } from "../../../../content/q2/foundation/items.ts";
import { q2MissionWeaponDisplayName } from "../../../../content/q2/missionpacks/items.ts";
import { itemList } from "../../../../content/q3/base/shared/items.ts";
import { ItemType } from "../../../../content/q3/base/shared/definitions.ts";
import { Q3_WEAPON_ITEMS } from "../../../../content/q3/foundation/arsenal.ts";

const q1Ammo: ReadonlyMap<ItemId, string> = new Map([
  ["q1:ammo/shells", "Shells"], ["q1:ammo/nails", "Nails"], ["q1:ammo/rockets", "Rockets"], ["q1:ammo/cells", "Cells"],
  ["rogue:ammo/lava-nails", "Lava Nails"], ["rogue:ammo/multi-rockets", "Multi Rockets"], ["rogue:ammo/plasma", "Plasma"],
]);
export function selectedAmmoLabel(family: "q1" | "q2" | "q3", item: ItemId): string {
  let label: string | null | undefined;
  if (family === "q1") label = q1Ammo.get(item);
  else if (family === "q2") label = q2ItemPickupName(item.slice(3)) ?? q2MissionWeaponDisplayName(item.slice("q2:ammo_".length));
  else {
    const weapon = Q3_WEAPON_ITEMS.find(weapon => weapon.ammo === item);
    label = itemList("missionpack").find(value => value.type === ItemType.IT_AMMO && value.tag === weapon?.weapon)?.pickupName;
  }
  if (label == null) throw new Error(`Selected ammunition lacks a source catalog label: ${item}`);
  return label;
}
