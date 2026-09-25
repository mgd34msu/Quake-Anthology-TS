import type { QvmModule } from "../../compat/qvm/module.ts";
import type { QvmInventoryProfile } from "../../compat/qvm/game-inventory.ts";
import type { QvmModuleOptions } from "../../compat/qvm/module.ts";
import { parseQvmItemLayout, readQvmItemCatalog, QvmSourceItemCatalog, type QvmCatalogRecord, type QvmItemLayout } from "../../compat/qvm/item-catalog.ts";
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

export async function q3GuestWeapons(artifact: QvmModuleOptions["artifact"], mounts: Pick<MountedContent, "open">, declaredLayout?: QvmItemLayout, privateInventory = false): Promise<readonly Q3GuestWeapon[]> {
  let layout = declaredLayout ?? layouts.get(artifact.module.digest);
  const metadata = declaredLayout === undefined ? await mounts.open("qvm-items.json") : null;
  if (metadata !== null) {
    const value: unknown = JSON.parse(new TextDecoder().decode(metadata.bytes));
    const reader = new SaveReader(value, "qvm-items.json"); reader.field("version").literal(1);
    if (reader.field("artifactDigest").string() !== artifact.module.digest) reader.fail("item declaration belongs to different qagame bytes");
    layout = parseQvmItemLayout(reader.field("items"));
  }
  if (layout === undefined) return artifact.known?.product === "missionpack" ? standardQ3GuestWeapons : baseQ3GuestWeapons;
  if (layout.source === "live") {
    if (declaredLayout === undefined) throw new Error("Live QVM catalogs require the complete declared primary interface");
    return [];
  }
  const entries = readQvmItemCatalog(artifact.image.initializedData, layout, privateInventory);
  return catalogWeapons(artifact, layout, entries);
}
function catalogWeapons(artifact: QvmModuleOptions["artifact"], layout: QvmItemLayout, entries: readonly Pick<QvmCatalogRecord, "className" | "pickupName" | "type" | "tag">[],
  selection?: readonly { readonly value: number; readonly item: ItemId }[]): readonly Q3GuestWeapon[] {
  const weaponType = layout.weaponType, ammoType = layout.ammoType;
  return entries.filter((item, index) => item.type === weaponType && entries.findIndex(other => other.type === weaponType && other.tag === item.tag) === index).map(item => {
    const original = sourceItems.find(entry => entry.type === ItemType.IT_WEAPON && entry.className === item.className);
    const canonical = original === undefined ? undefined : Q3_WEAPON_ITEMS.find(entry => entry.weapon === original.tag);
    const ammo = entries.find(entry => entry.type === ammoType && entry.tag === item.tag);
    const originalAmmo = ammo === undefined ? undefined : sourceItems.find(entry => entry.type === ItemType.IT_AMMO && entry.className === ammo.className);
    const canonicalAmmo = originalAmmo === undefined ? undefined : Q3_WEAPON_ITEMS.find(entry => entry.weapon === originalAmmo.tag)?.ammo;
    return { weapon: item.tag, item: selection?.find(value => value.value === item.tag)?.item ?? canonical?.item ?? `q3:guest/${artifact.module.digest}/${item.className}`,
      ammo: ammo === undefined ? null : canonicalAmmo ?? `q3:guest/${artifact.module.digest}/${ammo.className}`, label: item.pickupName };
  });
}

/** One live original module owns discovery; preparation never executes a second game initialization. */
export class Q3GuestCatalog {
  private readonly table: QvmSourceItemCatalog | null;
  private closed = false;
  private previous: readonly QvmCatalogRecord[] | null = null;
  private weapons_: readonly Q3GuestWeapon[];
  private readonly privateItems: ReadonlySet<ItemId> | null;
  constructor(private readonly artifact: QvmModuleOptions["artifact"], module: QvmModule, private readonly layout: QvmItemLayout | undefined,
    initial: readonly Q3GuestWeapon[], private readonly selection: readonly { readonly value: number; readonly item: ItemId }[] | undefined, inventory: QvmInventoryProfile | null) {
    if (module.profile.module.digest !== artifact.module.digest || module.profile.module.id !== artifact.module.id
      || module.profile.module.artifactPath !== artifact.module.artifactPath || module.profile.module.revision !== artifact.module.revision) throw new Error("QVM item catalog belongs to a different original module");
    this.table = layout === undefined ? null : new QvmSourceItemCatalog(module.memory, layout, artifact.image.initializedData);
    this.weapons_ = initial;
    this.privateItems = inventory !== null && "storage" in inventory ? new Set(inventory.storage.flatMap(storage => storage.kind === "counter" ? [storage.item] : storage.items.map(item => item.item))) : null;
    this.validate(initial);
  }
  records(): readonly QvmCatalogRecord[] {
    if (this.closed) throw new Error("QVM item catalog owner is retired");
    if (this.table === null) throw new Error("QVM source has no declared item table");
    return this.table.records();
  }
  weapons(): readonly Q3GuestWeapon[] {
    if (this.closed) throw new Error("QVM item catalog owner is retired");
    if (this.table === null || this.layout === undefined || this.layout.source !== "live") return this.weapons_;
    const entries = this.table.records();
    if (entries === this.previous) return this.weapons_;
    const weapons = catalogWeapons(this.artifact, this.layout, entries, this.selection);
    this.validate(weapons);
    this.previous = entries; this.weapons_ = weapons; return weapons;
  }
  private validate(weapons: readonly Q3GuestWeapon[]): void {
    for (const weapon of weapons) {
      if (weapon.weapon < 1 || this.privateItems === null && weapon.weapon > 15) throw new Error("QVM item cannot be represented by its declared inventory storage");
      if (this.selection !== undefined && !this.selection.some(value => value.value === weapon.weapon && value.item === weapon.item)) throw new Error("QVM weapon has no declared original selection value");
      if (this.privateItems !== null && (!this.privateItems.has(weapon.item) || weapon.ammo !== null && !this.privateItems.has(weapon.ammo))) throw new Error("QVM item has no declared original inventory storage");
    }
  }
  reset(): void { this.table?.reset(); this.previous = null; }
  close(): void { this.table?.close(); this.previous = null; this.closed = true; }
}
