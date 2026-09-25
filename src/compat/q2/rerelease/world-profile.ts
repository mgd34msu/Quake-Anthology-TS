import type { ContentDigest } from "../../../contracts/content.ts";
import type { GuestLayout } from "../../../contracts/execution.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { NativeModRegionRegister } from "../../../contracts/native-mod-region.ts";
import { SaveReader, namespaced } from "../../../persistence/value.ts";
import { readLayout } from "../../../persistence/execution.ts";
import { storageBytes, validateValueLayout } from "../../../guest/abi/values.ts";
import { clientLayout, edictLayout, privateEdictPrefixLayout } from "./layouts.ts";
import { retailRereleaseClientProfile, type RereleaseClientProfile } from "./client-profile.ts";

export type RereleaseWorldLocation = { readonly kind: "register"; readonly register: NativeModRegionRegister; readonly storage: "pointer" | "int32" | "uint32" }
  | { readonly kind: "stack"; readonly offset: number; readonly storage: "pointer" | "int32" | "uint32" };
export interface RereleasePrimaryWorldProfile {
  readonly digest: ContentDigest;
  readonly edict: GuestLayout;
  readonly client: RereleaseClientProfile;
  readonly entries: { readonly spawn: number; readonly free: number; readonly damage: number; readonly powerArmor: number; readonly processPain: number; readonly time: number;
    readonly regularArmor: { readonly entry: number; readonly join: number } };
  readonly regularArmor: { readonly target: RereleaseWorldLocation; readonly amount: RereleaseWorldLocation; readonly point: RereleaseWorldLocation; readonly normal: RereleaseWorldLocation;
    readonly flags: RereleaseWorldLocation; readonly result: RereleaseWorldLocation; readonly repair: readonly { readonly source: RereleaseWorldLocation; readonly target: RereleaseWorldLocation }[] };
  readonly monster: { readonly attacker: number; readonly inflictor: number; readonly blood: number; readonly knockback: number; readonly point: number; readonly mod: number; readonly invincibleTime: number };
  readonly inventory: readonly { readonly item: ItemId; readonly source: { readonly kind: "classname"; readonly name: string } | { readonly kind: "index"; readonly index: number } | { readonly kind: "remaining" };
    readonly capacity: { readonly kind: "ammo"; readonly sourceIndex: number } | { readonly kind: "fixed"; readonly count: number } }[];
  readonly armor: { readonly table: number; readonly stride: number; readonly normal: number; readonly energy: number; readonly regular: readonly ItemId[]; readonly empty: ItemId;
    readonly screen: ItemId; readonly shield: ItemId; readonly cells: ItemId; readonly cellsIndex: number };
  readonly flags: { readonly godmode: number; readonly notarget: number; readonly noKnockback: number; readonly powerArmor: number };
  readonly movement: { readonly gameApi: number; readonly pmove: number; readonly speedLoads: readonly { readonly next: number; readonly register: number }[] };
}
// g_items.cpp itemlist classnames; disabled beta disintegrator is not an item.
const classnames: readonly string[] = [
  "item_armor_body",
  "item_armor_combat",
  "item_armor_jacket",
  "item_armor_shard",
  "item_power_screen",
  "item_power_shield",
  "weapon_grapple",
  "weapon_blaster",
  "weapon_chainfist",
  "weapon_shotgun",
  "weapon_supershotgun",
  "weapon_machinegun",
  "weapon_etf_rifle",
  "weapon_chaingun",
  "ammo_grenades",
  "ammo_trap",
  "ammo_tesla",
  "weapon_grenadelauncher",
  "weapon_proxlauncher",
  "weapon_rocketlauncher",
  "weapon_hyperblaster",
  "weapon_boomer",
  "weapon_plasmabeam",
  "weapon_railgun",
  "weapon_phalanx",
  "weapon_bfg",
  "weapon_disintegrator",
  "ammo_shells",
  "ammo_bullets",
  "ammo_cells",
  "ammo_rockets",
  "ammo_slugs",
  "ammo_magslug",
  "ammo_flechettes",
  "ammo_prox",
  "ammo_nuke",
  "ammo_disruptor",
  "item_quad",
  "item_quadfire",
  "item_invulnerability",
  "item_invisibility",
  "item_silencer",
  "item_breather",
  "item_enviro",
  "item_ancient_head",
  "item_legacy_head",
  "item_adrenaline",
  "item_bandolier",
  "item_pack",
  "item_ir_goggles",
  "item_double",
  "item_sphere_vengeance",
  "item_sphere_hunter",
  "item_sphere_defender",
  "item_doppleganger",
  "key_data_cd",
  "key_power_cube",
  "key_explosive_charges",
  "key_yellow_key",
  "key_power_core",
  "key_pyramid",
  "key_data_spinner",
  "key_pass",
  "key_blue_key",
  "key_red_key",
  "key_green_key",
  "key_commander_head",
  "key_airstrike_target",
  "key_nuke_container",
  "key_nuke",
  "item_health_small",
  "item_health",
  "item_health_large",
  "item_health_mega",
  "item_flag_team1",
  "item_flag_team2",
  "item_tech1",
  "item_tech2",
  "item_tech3",
  "item_tech4",
  "item_flashlight",
  "item_compass",
];
const ammoSlots: ReadonlyMap<string, number> = new Map([
  ["ammo_bullets", 0], ["ammo_shells", 1], ["ammo_rockets", 2], ["ammo_grenades", 3],
  ["ammo_cells", 4], ["ammo_slugs", 5], ["ammo_magslug", 6], ["ammo_trap", 7],
  ["ammo_flechettes", 8], ["ammo_tesla", 9], ["ammo_disruptor", 10], ["ammo_prox", 11],
]);


const retail: RereleasePrimaryWorldProfile = {
  digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd",
  edict: { ...privateEdictPrefixLayout, byteLength: 3688 }, client: retailRereleaseClientProfile,
  entries: { spawn: 0x964b0, free: 0x96600, damage: 0x5cae0, powerArmor: 0x5c100, processPain: 0x76e20, time: 0x241b28, regularArmor: { entry: 0x5d022, join: 0x5d154 } },
  regularArmor: { target: { kind: "register", register: "rdi", storage: "pointer" }, amount: { kind: "register", register: "r14", storage: "int32" },
    point: { kind: "register", register: "r13", storage: "pointer" }, normal: { kind: "stack", offset: 0x108, storage: "pointer" }, flags: { kind: "stack", offset: 0x120, storage: "int32" },
    result: { kind: "register", register: "r12", storage: "int32" }, repair: [{ source: { kind: "stack", offset: 0xe0, storage: "uint32" }, target: { kind: "register", register: "rbx", storage: "uint32" } }] },
  monster: { attacker: 3120, inflictor: 3128, blood: 3136, knockback: 3140, point: 3144, mod: 3156, invincibleTime: 0xb88 },
  inventory: [{ item: "q2:none", source: { kind: "index", index: 0 }, capacity: { kind: "fixed", count: 0 } },
    ...classnames.map((name): RereleasePrimaryWorldProfile["inventory"][number] => { const ammo = ammoSlots.get(name); return { item: `q2:${name}`, source: { kind: "classname", name },
      capacity: ammo === undefined ? { kind: "fixed", count: 0x7fffffff } : { kind: "ammo", sourceIndex: ammo } }; }),
    { item: "q2:item_tag_token", source: { kind: "remaining" }, capacity: { kind: "fixed", count: 0x7fffffff } }],
  armor: { table: 0x1953a8, stride: 192, normal: 8, energy: 12, regular: ["q2:item_armor_jacket", "q2:item_armor_combat", "q2:item_armor_body"], empty: "q2:item_armor_body",
    screen: "q2:item_power_screen", shield: "q2:item_power_shield", cells: "q2:ammo_cells", cellsIndex: 30 },
  flags: { godmode: 16, notarget: 32, noKnockback: 2048, powerArmor: 4096 },
  movement: { gameApi: 0x6bcd0, pmove: 0xea560, speedLoads: [{ next: 0xe8293, register: 0 }, { next: 0xe889c, register: 1 }, { next: 0xe88ce, register: 0 }, { next: 0xe8b15, register: 1 }, { next: 0xe8b1f, register: 1 }, { next: 0xe9e3e, register: 10 }] },
};
export function rereleasePrimaryWorldProfile(digest: ContentDigest): RereleasePrimaryWorldProfile | null { return digest === retail.digest ? retail : null; }

function bounded(reader: SaveReader, min: number, max: number): number {
  const value = reader.integer(min); if (value > max) reader.fail(`Expected integer at most ${max}`); return value;
}
function location(reader: SaveReader): RereleaseWorldLocation {
  const kind = reader.field("kind").choice("register", "stack"), storage = reader.field("storage").choice("pointer", "int32", "uint32");
  return kind === "register" ? { kind, storage, register: reader.field("register").choice("rax", "rcx", "rdx", "rbx", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15") }
    : { kind, storage, offset: bounded(reader.field("offset"), 0, 1048576 - storageBytes(storage, 8)) };
}
export function readRereleasePrimaryWorldProfile(reader: SaveReader, digest: ContentDigest): RereleasePrimaryWorldProfile {
  const client = reader.field("client"), entries = reader.field("entries"), regular = reader.field("regularArmor"), monster = reader.field("monster"), armor = reader.field("armor"), flags = reader.field("flags"), movement = reader.field("movement");
  const rva = (value: SaveReader): number => bounded(value, 1, 0xffffffff);
  const profile: RereleasePrimaryWorldProfile = { digest, edict: readLayout(reader.field("edict")),
    client: { authority: { kind: "artifact", digest }, layout: readLayout(client.field("layout")), inventoryCount: bounded(client.field("inventoryCount"), 1, 65536), ammoCount: bounded(client.field("ammoCount"), 1, 65536) },
    entries: { spawn: rva(entries.field("spawn")), free: rva(entries.field("free")), damage: rva(entries.field("damage")), powerArmor: rva(entries.field("powerArmor")), processPain: rva(entries.field("processPain")), time: rva(entries.field("time")), regularArmor: { entry: rva(entries.field("regularArmor").field("entry")), join: rva(entries.field("regularArmor").field("join")) } },
    regularArmor: { target: location(regular.field("target")), amount: location(regular.field("amount")), point: location(regular.field("point")), normal: location(regular.field("normal")), flags: location(regular.field("flags")), result: location(regular.field("result")),
      repair: regular.field("repair").list(value => ({ source: location(value.field("source")), target: location(value.field("target")) })) },
    monster: { attacker: monster.field("attacker").integer(0), inflictor: monster.field("inflictor").integer(0), blood: monster.field("blood").integer(0), knockback: monster.field("knockback").integer(0), point: monster.field("point").integer(0), mod: monster.field("mod").integer(0), invincibleTime: monster.field("invincibleTime").integer(0) },
    inventory: reader.field("inventory").list(value => { const source = value.field("source"), kind = source.field("kind").choice("classname", "index", "remaining"), capacity = value.field("capacity");
      return { item: namespaced(value.field("item")), source: kind === "classname" ? { kind, name: source.field("name").string() } : kind === "index" ? { kind, index: source.field("index").integer(0) } : { kind },
        capacity: capacity.field("kind").choice("ammo", "fixed") === "ammo" ? { kind: "ammo", sourceIndex: capacity.field("sourceIndex").integer(0) } : { kind: "fixed", count: bounded(capacity.field("count"), 0, 0x7fffffff) } }; }),
    armor: { table: rva(armor.field("table")), stride: bounded(armor.field("stride"), 8, 65536), normal: armor.field("normal").integer(0), energy: armor.field("energy").integer(0), regular: armor.field("regular").list(namespaced), empty: namespaced(armor.field("empty")), screen: namespaced(armor.field("screen")), shield: namespaced(armor.field("shield")), cells: namespaced(armor.field("cells")), cellsIndex: armor.field("cellsIndex").integer(0) },
    flags: { godmode: flags.field("godmode").integer(1), notarget: flags.field("notarget").integer(1), noKnockback: flags.field("noKnockback").integer(1), powerArmor: flags.field("powerArmor").integer(1) },
    movement: { gameApi: rva(movement.field("gameApi")), pmove: rva(movement.field("pmove")), speedLoads: movement.field("speedLoads").list(value => ({ next: rva(value.field("next")), register: bounded(value.field("register"), 0, 15) })) },
  };
  validateRereleasePrimaryWorldProfile(profile, digest); return profile;
}

export function validateRereleasePrimaryWorldProfile(profile: RereleasePrimaryWorldProfile, digest: ContentDigest): void {
  if (profile.digest !== digest || profile.client.authority.kind !== "artifact" || profile.client.authority.digest !== digest) throw new Error("Rerelease source world profile belongs to another artifact");
  const range = (value: number, min: number, max: number): void => {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Source world metadata is outside its declared range");
  };
  for (const value of [profile.entries.spawn, profile.entries.free, profile.entries.damage, profile.entries.powerArmor, profile.entries.processPain,
    profile.entries.time, profile.entries.regularArmor.entry, profile.entries.regularArmor.join, profile.armor.table, profile.movement.gameApi, profile.movement.pmove]) range(value, 1, 0xffffffff);
  range(profile.client.inventoryCount, 1, 65536); range(profile.client.ammoCount, 1, 65536);
  range(profile.armor.stride, 8, 65536); range(profile.armor.normal, 0, 65532); range(profile.armor.energy, 0, 65532);
  range(profile.armor.cellsIndex, 0, profile.client.inventoryCount - 1);
  for (const value of Object.values(profile.flags)) range(value, 1, Number.MAX_SAFE_INTEGER);
  const loads = new Set<number>();
  for (const load of profile.movement.speedLoads) {
    range(load.next, 1, 0xffffffff); range(load.register, 0, 15);
    if (loads.has(load.next)) throw new Error("Repeated source movement load would apply equipment twice"); loads.add(load.next);
  }
  for (const value of [profile.regularArmor.target, profile.regularArmor.amount, profile.regularArmor.point, profile.regularArmor.normal, profile.regularArmor.flags,
    profile.regularArmor.result, ...profile.regularArmor.repair.flatMap(value => [value.source, value.target])]) {
    if (value.kind === "stack") range(value.offset, 0, 1048576 - storageBytes(value.storage, 8));
  }
  const validate = (layout: GuestLayout, publicLayout: GuestLayout): void => {
    validateValueLayout({ kind: "aggregate", layout }, 8);
    const names = new Set<string>(), ranges: { start: number; end: number }[] = [];
    for (const field of layout.fields) {
      const end = field.byteOffset + storageBytes(field.storage, 8) * field.count;
      if (field.count <= 0 || names.has(field.name) || ranges.some(range => field.byteOffset < range.end && end > range.start)) throw new Error("Overlapping or empty native source fields");
      names.add(field.name); ranges.push({ start: field.byteOffset, end });
    }
    for (const field of publicLayout.fields) {
      const actual = layout.fields.find(value => value.name === `shared.${field.name}`);
      if (actual === undefined || actual.byteOffset !== field.byteOffset || actual.storage !== field.storage || actual.count !== field.count) throw new Error("Source world layout changes the public API2023 prefix");
    }
  };
  validate(profile.edict, edictLayout); validate(profile.client.layout, clientLayout);
  for (const expected of privateEdictPrefixLayout.fields.filter(field => !field.name.startsWith("shared."))) {
    const field = profile.edict.fields.find(field => field.name === expected.name);
    if (field === undefined || field.storage !== expected.storage || field.count !== expected.count) throw new Error(`Missing typed source edict field ${expected.name}`);
  }
  const requireClient = (name: string, storage: GuestLayout["fields"][number]["storage"], count: number): void => {
    const field = profile.client.layout.fields.find(value => value.name === name);
    if (field?.storage !== storage || field.count !== count) throw new Error(`Missing typed source client field ${name}`);
  };
  requireClient("pers.inventory", "int32", profile.client.inventoryCount); requireClient("pers.max_ammo", "int16", profile.client.ammoCount);
  requireClient("v_angle", "float32", 3); requireClient("invincible_time", "int64", 1);
  for (const [key, bytes] of [["attacker", 8], ["inflictor", 8], ["blood", 4], ["knockback", 4], ["point", 12], ["mod", 3], ["invincibleTime", 8]] satisfies readonly (readonly [keyof RereleasePrimaryWorldProfile["monster"], number])[])
    if (!Number.isSafeInteger(profile.monster[key]) || profile.monster[key] < 0 || profile.monster[key] + bytes > profile.edict.byteLength) throw new Error("Source monster accumulator exceeds its edict");
  for (const field of [profile.regularArmor.target, profile.regularArmor.point, profile.regularArmor.normal]) if (field.storage !== "pointer") throw new Error("Source armor geometry requires pointer locations");
  for (const field of [profile.regularArmor.amount, profile.regularArmor.flags, profile.regularArmor.result]) if (field.storage !== "int32") throw new Error("Source armor values require int32 locations");
  for (const repair of profile.regularArmor.repair) if (repair.source.storage !== repair.target.storage) throw new Error("Source armor repair changes scalar representation");
  if (profile.entries.regularArmor.entry === profile.entries.regularArmor.join) throw new Error("Source armor region is empty");
  const items = new Set(profile.inventory.map(value => value.item));
  if (items.size !== profile.inventory.length || profile.inventory.length !== profile.client.inventoryCount || profile.inventory.filter(value => value.source.kind === "remaining").length > 1) throw new Error("Source inventory requires one complete unique roster");
  for (const row of profile.inventory) {
    if (row.source.kind === "index") range(row.source.index, 0, profile.client.inventoryCount - 1);
    if (row.capacity.kind === "ammo") range(row.capacity.sourceIndex, 0, profile.client.ammoCount - 1); else range(row.capacity.count, 0, 0x7fffffff);
    if (row.source.kind === "index" && row.source.index >= profile.client.inventoryCount || row.source.kind === "classname" && (!row.source.name || row.source.name.includes("\0")) || row.capacity.kind === "ammo" && row.capacity.sourceIndex >= profile.client.ammoCount) throw new Error("Source inventory mapping exceeds its private storage");
  }
  if (new Set(profile.armor.regular).size !== profile.armor.regular.length || !profile.armor.regular.includes(profile.armor.empty) || profile.armor.cellsIndex >= profile.client.inventoryCount
    || [...profile.armor.regular, profile.armor.screen, profile.armor.shield, profile.armor.cells].some(item => !items.has(item))) throw new Error("Source armor metadata has no declared inventory item");
  if (profile.armor.normal + 4 > 65536 || profile.armor.energy + 4 > 65536 || profile.movement.speedLoads.length === 0) throw new Error("Invalid source armor or movement metadata");
}
