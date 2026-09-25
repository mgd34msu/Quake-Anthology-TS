import type { QvmModuleOptions } from "../../compat/qvm/module.ts";
import { parseQvmItemLayout, readQvmItemCatalog, type QvmItemLayout } from "../../compat/qvm/item-catalog.ts";
import type { MountedContent } from "../mounts/index.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import { SaveReader } from "../../persistence/value.ts";
import { Q3_WEAPON_ITEMS } from "./foundation/arsenal.ts";
import { itemList } from "./base/shared/items.ts";
import { ItemType } from "./base/shared/definitions.ts";

export interface Q3GuestWeapon {
  readonly weapon: number;
  readonly item: ItemId;
  readonly ammo: ItemId | null;
  readonly label: string;
}

const sourceItems = itemList("missionpack");
export const standardQ3GuestWeapons: readonly Q3GuestWeapon[] = Q3_WEAPON_ITEMS.map(weapon => ({ ...weapon,
  label: sourceItems.find(item => item.type === ItemType.IT_WEAPON && item.tag === weapon.weapon)?.pickupName ?? weapon.item }));
export const baseQ3GuestWeapons: readonly Q3GuestWeapon[] = standardQ3GuestWeapons.filter(weapon => weapon.weapon <= 10);

// Threewave 1.7 bg_itemlist: original initialized records, excluding its empty terminal record.
const layouts: ReadonlyMap<string, QvmItemLayout> = new Map([
  ["sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337", {
    address: 5356, count: 49, stride: 52, fields: { className: 0, pickupName: 28, type: 36, tag: 40 }, weaponType: 1, ammoType: 2,
  }],
]);

export async function q3GuestWeapons(artifact: QvmModuleOptions["artifact"], mounts: Pick<MountedContent, "open">, declaredLayout?: QvmItemLayout): Promise<readonly Q3GuestWeapon[]> {
  let layout = declaredLayout ?? layouts.get(artifact.module.digest);
  const metadata = declaredLayout === undefined ? await mounts.open("qvm-items.json") : null;
  if (metadata !== null) {
    const value: unknown = JSON.parse(new TextDecoder().decode(metadata.bytes));
    const reader = new SaveReader(value, "qvm-items.json"); reader.field("version").literal(1);
    if (reader.field("artifactDigest").string() !== artifact.module.digest) reader.fail("item declaration belongs to different qagame bytes");
    layout = parseQvmItemLayout(reader.field("items"));
  }
  if (layout === undefined) return artifact.known?.product === "missionpack" ? standardQ3GuestWeapons : baseQ3GuestWeapons;
  const entries = readQvmItemCatalog(artifact.image.initializedData, layout), weaponType = layout.weaponType, ammoType = layout.ammoType;
  return entries.filter((item, index) => item.type === weaponType && entries.findIndex(other => other.type === weaponType && other.tag === item.tag) === index).map(item => {
    const original = sourceItems.find(entry => entry.type === ItemType.IT_WEAPON && entry.className === item.className);
    const canonical = original === undefined ? undefined : Q3_WEAPON_ITEMS.find(entry => entry.weapon === original.tag);
    const ammo = entries.find(entry => entry.type === ammoType && entry.tag === item.tag);
    return { weapon: item.tag, item: canonical?.item ?? `q3:guest/${artifact.module.digest}/${item.className}`,
      ammo: ammo === undefined ? null : canonical?.ammo ?? `q3:guest/${artifact.module.digest}/${ammo.className}`, label: item.pickupName };
  });
}
