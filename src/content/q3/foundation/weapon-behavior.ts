import type { ProjectileRole } from "../../../contracts/weapon-behavior.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import { q3WeaponItem } from "./arsenal.ts";

export function q3ProjectileBehavior(weapon: number): { readonly weapon: ItemId; readonly role: ProjectileRole } {
  const item = q3WeaponItem(weapon);
  if (item === null) throw new Error(`Unknown Q3 projectile weapon ${weapon}`);
  switch (weapon) {
    case 4: case 12: return { weapon: item.item, role: "grenade" };
    case 5: return { weapon: item.item, role: "rocket" };
    case 8: return { weapon: item.item, role: "plasma" };
    case 9: return { weapon: item.item, role: "energy" };
    case 10: return { weapon: item.item, role: "grapple" };
    case 11: return { weapon: item.item, role: "nail" };
    default: throw new Error(`Q3 weapon ${weapon} does not launch a projectile`);
  }
}
