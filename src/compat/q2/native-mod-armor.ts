import { isDeepStrictEqual } from "node:util";
import type { GuestAddress } from "../../contracts/execution.ts";
import type { ArmorState } from "../../contracts/gameplay.ts";
import type { NativeModArmor, NativeModArmorField, NativeModArmorSelection, NativeModDeclaration, NativeModScalarField } from "../../contracts/native-mod-callbacks.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";

interface Location { readonly base: GuestAddress; readonly field: NativeModArmorField; }
interface Store extends Location { readonly value: number; }
const bytes = (field: NativeModScalarField): number => field.encoding.endsWith("64") ? 8 : field.encoding.endsWith("16") ? 2 : field.encoding.endsWith("8") ? 1 : 4;
const selected = (selection: NativeModArmorSelection, value: number | null): boolean => value !== null && (selection.kind === "positive" ? value > 0 : value === selection.value);
function validateValue(field: NativeModScalarField, value: number): void {
  const bits = bytes(field) * 8, unsigned = field.encoding.startsWith("uint");
  if (!Number.isFinite(value) || field.encoding === "float32" && !Number.isFinite(Math.fround(value))
    || !field.encoding.startsWith("float") && (!Number.isSafeInteger(value) || value < (unsigned ? 0 : -(2 ** (bits - 1))) || value >= 2 ** (unsigned ? bits : bits - 1)))
    throw new Error("Native armor value exceeds its declared storage");
}

/** This decodes source storage; the original damage body owns absorption and cell costs. */
export class NativeModArmorState {
  private readonly fields: readonly NativeModArmorField[];
  constructor(readonly definition: NativeModArmor, readonly declaration: NativeModDeclaration, readonly host: NativeModHost,
    private readonly scalar: (base: GuestAddress, field: NativeModScalarField, value?: number) => number) {
    this.fields = definition.kind === "none" ? [] : [...definition.regular.flatMap(item => [item.selection.field, item.points]),
      ...definition.power.flatMap(item => [item.selection.field, item.cells, ...(item.enabled === null ? [] : [item.enabled.field])])];
    for (const field of this.fields) {
      const record = declaration.actorRecords.find(record => record.id === field.record);
      if (record === undefined || record.id !== declaration.entityRecord && record.base.kind !== "clients"
        || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset + bytes(field) > record.stride)
        throw new Error("Native armor field requires a declared entity or public client record");
    }
    for (const [index, field] of this.fields.entries()) for (const previous of this.fields.slice(0, index))
      if (field.record === previous.record && field.offset < previous.offset + bytes(previous) && previous.offset < field.offset + bytes(field)
        && (field.offset !== previous.offset || field.encoding !== previous.encoding)) throw new Error("Overlapping native armor fields have incompatible storage");
    if (definition.kind === "none") return;
    if (new Set(definition.regular.map(item => item.item)).size !== definition.regular.length
      || new Set(definition.power.map(item => item.kind)).size !== definition.power.length) throw new Error("Native armor selection is ambiguous");
    for (const item of [...definition.regular, ...definition.power]) if (item.selection.kind === "enum") {
      validateValue(item.selection.field, item.selection.value); validateValue(item.selection.field, item.selection.none);
      if (item.selection.value === item.selection.none) throw new Error("Native armor selection equals its inactive value");
      if (item.selection.field.encoding === "float32" && (Math.fround(item.selection.value) !== item.selection.value || Math.fround(item.selection.none) !== item.selection.none))
        throw new Error("Native armor selection is not exact in its declared storage");
    }
    for (const item of definition.regular) if (![item.normalProtection, item.energyProtection].every(Number.isFinite)) throw new Error("Native armor protection must be finite");
    for (const item of definition.power) if (item.enabled !== null) {
      if (item.enabled.field.encoding.startsWith("float") || !Number.isSafeInteger(item.enabled.mask) || item.enabled.mask <= 0) throw new Error("Native power armor requires an integer enabled mask");
      validateValue(item.enabled.field, item.enabled.mask);
    }
  }
  private location(slot: number, field: NativeModArmorField): Location | null {
    const base = field.record === this.declaration.entityRecord ? this.host.entity(slot).address : this.host.client(slot);
    if (base === null) return null;
    this.host.memory.check(this.host.memory.offset(base, BigInt(field.offset)), bytes(field), "read");
    return { base, field };
  }
  private value(slot: number, field: NativeModArmorField): number | null {
    const location = this.location(slot, field); return location === null ? null : this.scalar(location.base, field);
  }
  private required(slot: number, field: NativeModArmorField): number {
    const value = this.value(slot, field); if (value === null) throw new Error("Selected native armor has no source storage"); return value;
  }
  read(slot: number): ArmorState { return this.capture(field => this.value(slot, field)); }
  private capture(read: (field: NativeModArmorField) => number | null): ArmorState {
    const definition = this.definition; if (definition.kind === "none") return { kind: "none" };
    const required = (field: NativeModArmorField): number => { const value = read(field); if (value === null) throw new Error("Selected native armor has no source storage"); return value; };
    const regular = definition.regular.find(item => selected(item.selection, read(item.selection.field)));
    const power = definition.power.find(item => selected(item.selection, read(item.selection.field)) && (item.enabled === null
      || (BigInt(required(item.enabled.field)) & BigInt(item.enabled.mask)) !== 0n));
    const item = regular ?? power; if (item === undefined) return { kind: "none" };
    return { kind: "q2", item: item.item, points: regular === undefined ? 0 : required(regular.points),
      normalProtection: regular?.normalProtection ?? 0, energyProtection: regular?.energyProtection ?? 0,
      powerArmor: power === undefined ? { kind: "none" } : { kind: power.kind, cells: required(power.cells) } };
  }
  write(slot: number, armor: ArmorState): undefined {
    const definition = this.definition;
    if (definition.kind === "none") { if (armor.kind !== "none") throw new Error("Native owned actor declares no armor storage"); return undefined; }
    if (armor.kind !== "none" && armor.kind !== "q2") throw new Error("Native armor declaration cannot represent another armor family");
    const regular = armor.kind === "none" ? undefined : definition.regular.find(item => item.item === armor.item);
    const power = armor.kind === "none" || armor.powerArmor.kind === "none" ? undefined : definition.power.find(item => item.kind === armor.powerArmor.kind);
    if (armor.kind === "q2" && (armor.points !== 0 && regular === undefined || armor.powerArmor.kind !== "none" && power === undefined
      || regular !== undefined && (armor.normalProtection !== regular.normalProtection || armor.energyProtection !== regular.energyProtection)))
      throw new Error("Armor state differs from its declared native representation");
    const stores = new Map<bigint, Store>();
    const pending = (field: NativeModArmorField): number | null => {
      const location = this.location(slot, field); return location === null ? null
        : stores.get(location.base.byteOffset + BigInt(field.offset))?.value ?? this.scalar(location.base, field);
    };
    const store = (field: NativeModArmorField, value: number): void => {
      validateValue(field, value); const location = this.location(slot, field);
      if (location === null) { if (value !== 0) throw new Error("Native armor write requires its source record"); return; }
      const address = this.host.memory.offset(location.base, BigInt(field.offset)); this.host.memory.check(address, bytes(field), "write");
      stores.set(address.byteOffset, { ...location, value: field.encoding === "float32" ? Math.fround(value) : value });
    };
    const select = (selection: NativeModArmorSelection, active: boolean): void => store(selection.field, selection.kind === "enum"
      ? active ? selection.value : selection.none : active ? Math.max(1, this.required(slot, selection.field)) : 0);
    const enable = (item: Extract<NativeModArmor, { readonly kind: "q2" }>["power"][number], active: boolean): void => {
      if (item.enabled === null) select(item.selection, active);
      else {
        const current = pending(item.enabled.field); if (current === null) { if (active) throw new Error("Native power armor has no enabled storage"); return; }
        const mask = BigInt(item.enabled.mask); store(item.enabled.field, Number(active ? BigInt(current) | mask : BigInt(current) & ~mask));
        if (active) select(item.selection, true);
      }
    };
    if (armor.kind === "none" || armor.points <= 0) {
      const current = definition.regular.find(item => selected(item.selection, this.value(slot, item.selection.field)));
      if (current !== undefined) { select(current.selection, false); store(current.points, 0); }
    }
    for (const item of definition.power) enable(item, false);
    if (armor.kind === "q2") {
      if (regular !== undefined && armor.points > 0) { select(regular.selection, true); store(regular.points, armor.points); }
      if (power !== undefined && armor.powerArmor.kind !== "none") { enable(power, true); store(power.cells, armor.powerArmor.cells); }
    }
    const result = this.capture(pending), requestedPower = armor.kind === "q2" ? armor.powerArmor.kind : "none", actualPower = result.kind === "q2" ? result.powerArmor.kind : "none";
    const requestedPoints = armor.kind === "q2" ? regular?.points.encoding === "float32" ? Math.fround(armor.points) : armor.points : 0;
    if (requestedPower !== actualPower || requestedPoints !== (result.kind === "q2" ? result.points : 0) || armor.kind === "none" && result.kind !== "none"
      || armor.kind === "q2" && armor.points > 0 && (result.kind !== "q2" || result.item !== armor.item))
      throw new Error("Native source selection cannot represent this armor without changing other ownership");
    for (const { base, field, value } of stores.values()) this.scalar(base, field, value);
    return undefined;
  }
  observe(slot: number, changed: (before: ArmorState, after: ArmorState) => void): () => void {
    const groups = new Map<bigint, { readonly base: GuestAddress; readonly fields: NativeModArmorField[] }>();
    for (const field of this.fields) {
      const location = this.location(slot, field); if (location === null) continue;
      let group = groups.get(location.base.byteOffset);
      if (group === undefined) { group = { base: location.base, fields: [] }; groups.set(location.base.byteOffset, group); }
      group.fields.push(field);
    }
    let previous = this.read(slot); const removals: (() => void)[] = [];
    try { for (const group of groups.values()) {
      const start = Math.min(...group.fields.map(field => field.offset)), end = Math.max(...group.fields.map(field => field.offset + bytes(field)));
      removals.push(this.host.memory.observeWrites(this.host.memory.offset(group.base, BigInt(start)), end - start, ranges => {
        if (!ranges.some(range => group.fields.some(field => range.byteOffset + start < field.offset + bytes(field) && field.offset < range.byteOffset + start + range.byteLength))) return;
        const before = previous, after = this.read(slot); previous = after; if (!isDeepStrictEqual(before, after)) changed(before, after);
      }));
    } } catch (error) { for (const remove of removals) remove(); throw error; }
    return () => { for (const remove of removals) remove(); };
  }
}
