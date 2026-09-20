import { SaveReader } from "../../persistence/value.ts";

/** Offsets describe the mod's private item table; public weapon numbers stay source-owned. */
export interface QvmItemLayout {
  readonly address: number;
  readonly count: number;
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

export function parseQvmItemLayout(reader: SaveReader): QvmItemLayout {
  const fields = reader.field("fields"), stride = reader.field("stride").integer(4);
  const offset = (name: string): number => {
    const value = fields.field(name).integer(0);
    if (value % 4 !== 0 || value + 4 > stride) fields.field(name).fail("item field exceeds its record or is unaligned");
    return value;
  };
  const layout = { address: reader.field("address").integer(4), count: reader.field("count").integer(1), stride,
    fields: { className: offset("className"), pickupName: offset("pickupName"), type: offset("type"), tag: offset("tag") },
    weaponType: reader.field("weaponType").integer(0), ammoType: reader.field("ammoType").integer(0) };
  if (layout.address % 4 !== 0 || stride % 4 !== 0 || layout.weaponType === layout.ammoType) reader.fail("invalid item table layout");
  return layout;
}

export function readQvmItemCatalog(data: Uint8Array, layout: QvmItemLayout): readonly QvmCatalogItem[] {
  if (layout.address + layout.count * layout.stride > data.length) throw new Error("QVM item table exceeds initialized module data");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const string = (pointer: number): string => {
    if (pointer <= 0 || pointer >= data.length) throw new Error("QVM item string is outside initialized module data");
    const end = data.indexOf(0, pointer);
    if (end < 0) throw new Error("QVM item string is unterminated");
    let text = "";
    for (const byte of data.subarray(pointer, end)) text += String.fromCharCode(byte);
    return text;
  };
  const items: QvmCatalogItem[] = [];
  for (let index = 0; index < layout.count; index++) {
    const address = layout.address + index * layout.stride;
    const word = (offset: number) => view.getInt32(address + offset, true);
    if (word(layout.fields.className) === 0) continue;
    const type = word(layout.fields.type);
    if (type !== layout.weaponType && type !== layout.ammoType) continue;
    const item = { className: string(word(layout.fields.className)), pickupName: string(word(layout.fields.pickupName)), type, tag: word(layout.fields.tag) };
    if (item.tag < 1 || item.tag > 15 || !item.className || !item.pickupName) throw new Error("QVM item cannot be represented by its public weapon/ammo state");
    items.push(item);
  }
  return items;
}
