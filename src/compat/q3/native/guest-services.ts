// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../../guest/core/index.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";

/** Q_strncpyz into guest memory: at most capacity - 1 characters and a terminator, with the rest of the capacity zeroed. */
export function writeGuestString(memory: MappedGuestMemory, address: GuestAddress, value: string, capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Native string output requires positive source capacity");
  memory.check(address, capacity, "write");
  const bytes = new Uint8Array(capacity),
    end = Math.min(value.length, capacity - 1);
  for (let i = 0; i < end; i++) bytes[i] = value.charCodeAt(i) & 255;
  memory.write(address, bytes);
}

/** Cvar_Update for one vmCvar_t, which has the same int/int/float/int/char[256] layout on both guest widths. */
export function updateGuestCvar(memory: MappedGuestMemory, cvars: Pick<CvarRegistry, "readVm">, address: GuestAddress): void {
  const value = cvars.readVm(memory.readInt32(address));
  if (value === undefined || memory.readInt32(memory.offset(address, 4n)) === value.modificationCount) return;
  memory.check(address, 272, "write");
  memory.writeInt32(memory.offset(address, 4n), value.modificationCount);
  if (value.value.length >= 256) throw new RangeError("Cvar_Update: source value exceeds MAX_CVAR_VALUE_STRING");
  writeGuestString(memory, memory.offset(address, 16n), value.value, 256);
  memory.writeFloat32(memory.offset(address, 8n), Math.fround(value.numericValue));
  memory.writeInt32(memory.offset(address, 12n), value.integerValue);
}
