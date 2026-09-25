import type { QvmMemory, QvmWriteRange } from "./memory.ts";
import { SaveReader } from "../../persistence/value.ts";

/** Offsets describe the mod's private item table; public weapon numbers stay source-owned. */
export interface QvmItemLayout {
  readonly address: number | { readonly global: number };
  readonly count: number | { readonly global: number; readonly maximum: number };
  readonly source?: "live";
  readonly stride: number;
  readonly fields: { readonly className: number; readonly pickupName: number; readonly type: number; readonly tag: number };
  readonly weaponType: number;
  readonly ammoType: number;
}

export interface QvmCatalogItem {
  readonly className: string;
  readonly pickupName: string;
  readonly type: number;
  readonly tag: number;
}
export interface QvmCatalogRecord extends QvmCatalogItem { readonly index: number; readonly address: number; }

export function parseQvmItemLayout(reader: SaveReader): QvmItemLayout {
  const fields = reader.field("fields"), stride = reader.field("stride").integer(4);
  const offset = (name: string): number => {
    const value = fields.field(name).integer(0);
    if (value % 4 !== 0 || value + 4 > stride) fields.field(name).fail("item field exceeds its record or is unaligned");
    return value;
  };
  const pointer = reader.field("address"), count = reader.field("count");
  const layout: QvmItemLayout = { address: typeof pointer.value === "number" ? pointer.integer(4) : { global: pointer.field("global").integer(0) },
    count: typeof count.value === "number" ? count.integer(1) : { global: count.field("global").integer(0), maximum: count.field("maximum").integer(1) }, stride,
    ...(reader.field("source").value === undefined ? {} : { source: reader.field("source").literal("live") }),
    fields: { className: offset("className"), pickupName: offset("pickupName"), type: offset("type"), tag: offset("tag") },
    weaponType: reader.field("weaponType").integer(0), ammoType: reader.field("ammoType").integer(0) };
  if ((typeof layout.address === "number" ? layout.address : layout.address.global) % 4 !== 0 || typeof layout.count !== "number" && layout.count.global % 4 !== 0
    || stride % 4 !== 0 || layout.weaponType === layout.ammoType) reader.fail("invalid item table layout");
  if (layout.source !== "live" && (typeof layout.address !== "number" || typeof layout.count !== "number")) reader.fail("runtime item table locations require live source storage");
  return layout;
}

export function readQvmItemRecords(data: Uint8Array, layout: QvmItemLayout, types?: ReadonlySet<number>, range?: (offset: number, length: number) => void): readonly QvmCatalogRecord[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const global = (address: number): number => {
    if (!Number.isSafeInteger(address) || address < 0 || address % 4 !== 0 || address + 4 > data.length) throw new Error("QVM item table locator exceeds module data");
    range?.(address, 4); return view.getInt32(address, true);
  };
  const table = typeof layout.address === "number" ? layout.address : global(layout.address.global);
  const count = typeof layout.count === "number" ? layout.count : global(layout.count.global);
  if (!Number.isSafeInteger(count) || count < 0 || typeof layout.count !== "number" && count > layout.count.maximum
    || !Number.isSafeInteger(table) || table < 0 || table % 4 !== 0 || count > 0 && table === 0
    || !Number.isSafeInteger(table + count * layout.stride) || table + count * layout.stride > data.length)
    throw new Error("QVM item table exceeds initialized or live module data");
  if (count > 0) range?.(table, count * layout.stride);
  const string = (pointer: number): string => {
    if (pointer <= 0 || pointer >= data.length) throw new Error("QVM item string is outside initialized module data");
    const end = data.indexOf(0, pointer);
    if (end < 0) throw new Error("QVM item string is unterminated");
    range?.(pointer, end - pointer + 1);
    let text = "";
    for (const byte of data.subarray(pointer, end)) text += String.fromCharCode(byte);
    return text;
  };
  const items: QvmCatalogRecord[] = [];
  for (let index = 0; index < count; index++) {
    const address = table + index * layout.stride;
    const word = (offset: number) => view.getInt32(address + offset, true);
    if (word(layout.fields.className) === 0) continue;
    const type = word(layout.fields.type);
    if (types !== undefined && !types.has(type)) continue;
    const item = { index, address, className: string(word(layout.fields.className)), pickupName: string(word(layout.fields.pickupName)), type, tag: word(layout.fields.tag) };
    if (!item.className || !item.pickupName) throw new Error("QVM item has no source name");
    items.push(item);
  }
  return items;
}
export function readQvmItemCatalog(data: Uint8Array, layout: QvmItemLayout, privateInventory = false): readonly QvmCatalogItem[] {
  return readQvmItemRecords(data, layout, new Set([layout.weaponType, layout.ammoType])).map(item => {
    if (item.tag < 1 || !privateInventory && item.tag > 15) throw new Error("QVM item cannot be represented by its public weapon/ammo state");
    return { className: item.className, pickupName: item.pickupName, type: item.type, tag: item.tag };
  });
}

/** Catalog reads are cached until an original store changes its locator, records or strings. */
export class QvmSourceItemCatalog {
  private records_: readonly QvmCatalogRecord[] | null = null;
  private remove: () => undefined = () => undefined;
  private closed = false;
  constructor(private readonly memory: QvmMemory, private readonly layout: QvmItemLayout, private readonly initialized: Uint8Array) {}
  reset(): void { this.remove(); this.remove = () => undefined; this.records_ = null; }
  records(): readonly QvmCatalogRecord[] {
    this.memory.assertLive();
    if (this.closed) throw new Error("QVM item catalog owner is retired");
    if (this.records_ !== null) return this.records_;
    this.remove();
    const ranges: QvmWriteRange[] = [];
    const records = readQvmItemRecords(this.layout.source === "live" ? this.memory.bytes : this.initialized, this.layout, undefined,
      this.layout.source === "live" ? (byteOffset, byteLength) => { ranges.push({ byteOffset, byteLength }); } : undefined);
    this.records_ = records;
    this.remove = ranges.length === 0 ? () => undefined : this.memory.observeWrites(ranges, () => { this.records_ = null; return undefined; });
    return records;
  }
  close(): void { this.reset(); this.closed = true; }
}
