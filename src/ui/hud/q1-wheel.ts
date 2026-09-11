// SPDX-License-Identifier: GPL-2.0-or-later
// Rerelease wwheel.txt grammar follows quake-1-re-ts/src/lib/wwheel.ts and retail files.
import type { ResourceId } from "../../contracts/content.ts";
import { Tokenizer } from "../../core/common-parse.ts";
import type { WheelItem } from "./wheel.ts";

export interface Q1WheelSlot {
  readonly slot: number;
  readonly impulse: number | null;
  readonly icon: string | null;
  readonly selectedIcon: string | null;
  readonly ammoIcon: string | null;
  readonly entityVariableByteOffset: number | null;
  readonly weaponBits: number | null;
  readonly unknown: ReadonlyMap<string, readonly string[]>;
}
export function parseQ1WeaponWheel(text: string): { readonly slots: readonly Q1WheelSlot[]; readonly errors: readonly string[] } {
  const parser = new Tokenizer(text, "wwheel.txt"), slots: Q1WheelSlot[] = [], errors: string[] = [];
  for (let header = parser.next(); header !== undefined; header = parser.next()) {
    const ordinal = parser.next(), opening = parser.next(), slot = Number(ordinal?.value);
    if (header.value !== "slot" || ordinal === undefined || !Number.isInteger(slot) || opening?.value !== "{") {
      errors.push(`line ${header.line}: expected slot N {`); break;
    }
    const fields = new Map<string, readonly string[]>();
    let closed = false;
    while (!closed) {
      const key = parser.next();
      if (key === undefined) { errors.push(`line ${header.line}: unclosed slot ${slot}`); break; }
      if (key.value === "}") { closed = true; break; }
      const values: string[] = [];
      for (let value = parser.next(false); value !== undefined; value = parser.next(false)) {
        if (value.value === "}") { closed = true; break; }
        values.push(value.value);
      }
      fields.set(key.value, values);
    }
    const string = (key: string): string | null => {
      const values = fields.get(key); fields.delete(key);
      if (values === undefined) return null;
      if (values.length !== 1) { errors.push(`slot ${slot}: ${key} expects one value`); return null; }
      return values[0] ?? null;
    };
    const integer = (key: string): number | null => {
      const value = string(key); if (value === null) return null;
      const numeric = Number(value);
      if (!Number.isInteger(numeric)) { errors.push(`slot ${slot}: ${key} expects an integer`); return null; }
      return numeric;
    };
    const impulse = integer("impulse"), icon = string("icon"), selectedIcon = string("icon_sel"), ammoIcon = string("ammoicon"),
      entityVariableByteOffset = integer("entvaroffs"), weaponBits = integer("weaponnum");
    slots.push({ slot, impulse, icon, selectedIcon, ammoIcon, entityVariableByteOffset, weaponBits, unknown: fields });
    if (!closed) break;
  }
  return { slots, errors };
}
export interface Q1WheelState {
  readonly items: number;
  readonly entityFloat: (byteOffset: number) => number;
  readonly label: (slot: Q1WheelSlot) => string;
  readonly image: (path: string) => ResourceId | null;
}
/** entvaroffs remains the source progs entity byte offset, not a host actor field index. */
export function q1WheelItems(slots: readonly Q1WheelSlot[], state: Q1WheelState): readonly WheelItem[] {
  return slots.map(slot => {
    const count = slot.entityVariableByteOffset === null ? null : state.entityFloat(slot.entityVariableByteOffset);
    return { id: `q1-wheel:${slot.slot}`, sourceOrdinal: slot.slot, sortOrder: slot.slot, label: state.label(slot),
      owned: slot.weaponBits !== null && (state.items & slot.weaponBits) !== 0, hasAmmo: count === null || count > 0,
      count, warningCount: 0, icon: slot.icon === null ? null : state.image(slot.icon),
      selectedIcon: slot.selectedIcon === null ? null : state.image(slot.selectedIcon) };
  });
}
