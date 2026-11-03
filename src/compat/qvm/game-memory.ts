// SPDX-License-Identifier: GPL-2.0-or-later
/** Quake III game-module pointer arguments, as the shared server-game traps read and write them. */
export interface Q3GameMemory {
  /** The readable allocation from a nonnull pointer to its end; null for a null pointer. */
  pointer(pointer: number): Uint8Array | null;
  /** The live bytes of an exact range; ranges that leave the allocation throw. */
  span(pointer: number, length: number, relativeOffset?: number): Uint8Array;
  view(pointer: number, length: number, relativeOffset?: number): DataView;
  readString(pointer: number): string;
  /** Q_strncpyz: at most capacity - 1 characters and a terminator, the rest of the capacity zeroed. */
  writeString(pointer: number, text: string, capacity: number): void;
  /** The flat address a nonnull pointer names (an allocation offset for interpreted modules, the absolute address for native ones). */
  address(pointer: number): number | null;
  /** The pointer word that denotes a flat address, or null; the inverse of {@link address}. */
  pointerWord(address: number | null): number;
  /** A live view by flat address; ranges that leave the allocation throw. */
  viewAt(address: number, length: number): DataView;
  /** A view of part of a region returned by {@link pointer} or {@link span}; the default covers the rest of the region. */
  regionView(region: Uint8Array, offset?: number, length?: number): DataView;
  regionWrite(region: Uint8Array, bytes: Uint8Array): void;
  regionFill(region: Uint8Array, start: number, length: number, value: number): void;
}
