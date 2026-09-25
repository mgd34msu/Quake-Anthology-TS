import { readNativeCombatCall } from "../native-combat-call.ts";
import { CLASSIC_Q2_ABI } from "./layout.ts";
import type { ContentDigest } from "../../../contracts/content.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import { SaveReader, namespaced } from "../../../persistence/value.ts";
import { classicCombatProfile, validateClassicCombatProfile, type ClassicCombatProfile } from "./combat-profile.ts";
import { nativeOffset as offset } from "../native-primary-reader.ts";

export interface ClassicPrimaryWorldProfile extends ClassicCombatProfile {
  readonly inventoryTable: {
    readonly count: number; readonly className: number; readonly label: number; readonly flags: number; readonly ammoFlag: number; readonly tag: number;
    readonly capacities: readonly number[];
    readonly unnamed: readonly { readonly index: number; readonly label: string; readonly item: ItemId }[];
    readonly emptyIndex: number; readonly sentinel: boolean;
  };
}
export function classicPrimaryWorldProfile(digest: ContentDigest): ClassicPrimaryWorldProfile | null {
  const profile = classicCombatProfile(digest); if (profile === null) return null;
  return { ...profile, inventoryTable: { count: 48, className: 0, label: 40, flags: 56, ammoFlag: 2, tag: 68,
    capacities: [0x6e4, 0x6e8, 0x6ec, 0x6f0, 0x6f4, 0x6f8, 0x6fc, 0x700],
    unnamed: [{ index: 0, label: "", item: "q2:none" }, { index: 47, label: "Health", item: "q2:item_health" }], emptyIndex: 0, sentinel: true } };
}
export function readClassicPrimaryWorldProfile(reader: SaveReader, digest: ContentDigest): ClassicPrimaryWorldProfile {
  const fields = reader.field("fields"), client = reader.field("client"), entries = reader.field("entries"), globals = reader.field("globals"), items = reader.field("items"),
    itemFields = reader.field("itemFields"), armorInfo = reader.field("armorInfo"), flags = reader.field("flags"), teams = reader.field("teams"), armor = reader.field("armor"), table = reader.field("inventoryTable");
  const calls = reader.field("calls");
  const profile: ClassicPrimaryWorldProfile = { calls: { pain: readNativeCombatCall(calls.field("pain"), "pain", CLASSIC_Q2_ABI), death: readNativeCombatCall(calls.field("death"), "death", CLASSIC_Q2_ABI), damage: readNativeCombatCall(calls.field("damage"), "damage", CLASSIC_Q2_ABI),
    regularArmor: readNativeCombatCall(calls.field("regularArmor"), "regular-armor", CLASSIC_Q2_ABI), powerArmor: readNativeCombatCall(calls.field("powerArmor"), "power-armor", CLASSIC_Q2_ABI) }, digest, game: reader.field("game").choice("base", "xatrix", "rogue", "ctf"), entityBytes: reader.field("entityBytes").integer(1),
    fields: { health: offset(fields.field("health")), damageable: offset(fields.field("damageable")), flags: offset(fields.field("flags")), mass: offset(fields.field("mass")), velocity: offset(fields.field("velocity")), pain: offset(fields.field("pain")), die: offset(fields.field("die")) },
    client: { inventory: offset(client.field("inventory")), inventoryCount: client.field("inventoryCount").integer(1), maxGrenades: offset(client.field("maxGrenades")), invincibleFrame: offset(client.field("invincibleFrame")), userinfo: offset(client.field("userinfo")), viewAngles: offset(client.field("viewAngles")), userinfoBytes: client.field("userinfoBytes").integer(1) },
    entries: { damage: offset(entries.field("damage")), powerArmor: offset(entries.field("powerArmor")), regularArmor: offset(entries.field("regularArmor")), spawn: offset(entries.field("spawn")), free: offset(entries.field("free")) },
    globals: { levelFrame: offset(globals.field("levelFrame")), itemList: offset(globals.field("itemList")), itemBytes: globals.field("itemBytes").integer(1) },
    items: { jacket: offset(items.field("jacket")), combat: offset(items.field("combat")), body: offset(items.field("body")), screen: offset(items.field("screen")), shield: offset(items.field("shield")), cells: offset(items.field("cells")), grenades: offset(items.field("grenades")) },
    itemFields: { className: offset(itemFields.field("className")), armorInfo: offset(itemFields.field("armorInfo")) }, armorInfo: { normalProtection: offset(armorInfo.field("normalProtection")), energyProtection: offset(armorInfo.field("energyProtection")) },
    flags: { invulnerable: offset(flags.field("invulnerable")), notarget: offset(flags.field("notarget")), noKnockback: offset(flags.field("noKnockback")), powerArmor: offset(flags.field("powerArmor")) },
    teams: { model: offset(teams.field("model")), skin: offset(teams.field("skin")) }, armor: { regular: armor.field("regular").list(offset), empty: offset(armor.field("empty")) },
    inventoryTable: { count: table.field("count").integer(1), className: offset(table.field("className")), label: offset(table.field("label")), flags: offset(table.field("flags")), ammoFlag: table.field("ammoFlag").integer(1), tag: offset(table.field("tag")),
      capacities: table.field("capacities").list(offset), unnamed: table.field("unnamed").list(value => ({ index: offset(value.field("index")), label: value.field("label").string(), item: namespaced(value.field("item")) })),
      emptyIndex: table.field("emptyIndex").integer(0), sentinel: table.field("sentinel").boolean() } };
  validateClassicCombatProfile(profile);
  if (profile.inventoryTable.count > profile.client.inventoryCount || profile.inventoryTable.emptyIndex >= profile.inventoryTable.count) table.fail("item table exceeds original inventory storage");
  for (const index of [...Object.values(profile.items), ...profile.armor.regular]) if (index >= profile.inventoryTable.count) table.fail("combat item is outside the original source table");
  for (const field of [profile.inventoryTable.className, profile.inventoryTable.label, profile.inventoryTable.flags, profile.inventoryTable.tag]) if (field + 4 > profile.globals.itemBytes) table.fail("item field exceeds declared stride");
  const indices = new Set<number>(), names = new Set<ItemId>();
  for (const entry of profile.inventoryTable.unnamed) {
    if (entry.index >= profile.inventoryTable.count || indices.has(entry.index) || names.has(entry.item)) table.fail("unnamed item identities must be unique source slots");
    indices.add(entry.index); names.add(entry.item);
  }
  return profile;
}
