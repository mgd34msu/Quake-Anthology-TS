/*
 * Memory traps from server/sv_game.c, client/cl_cgame.c and client/cl_ui.c.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { Q3GameMemory } from "./game-memory.ts";

/**
 * All roles share these trap numbers and return zero from memset/memcpy.
 * The typed strncpy profile returns the original signed destination word.
 * Source returns a host pointer cast to int; its address bits are not reproduced.
 * Overlapping copies behave as memmove, as they do on the shipped C runtime, and a self-copy writes nothing.
 * Negative counts reject before mutation.
 */
export function qvmMemorySyscall(_role: "game" | "cgame" | "ui", words: DataView, memory: Q3GameMemory): number | null {
  const trap = words.getInt32(0, true);
  if (trap !== 100 && trap !== 101 && trap !== 102) return null;
  const destinationWord = words.getInt32(4, true);
  const sourceWord = words.getInt32(8, true);
  const count = words.getInt32(12, true);
  const destination = memory.span(destinationWord, count);
  if (trap === 100) {
    memory.regionFill(destination, 0, count, sourceWord & 255);
    return 0;
  }
  if (trap === 101) {
    const source = memory.span(sourceWord, count);
    if (destination.buffer !== source.buffer || destination.byteOffset !== source.byteOffset) memory.regionWrite(destination, source);
    return 0;
  }
  const source = memory.pointer(sourceWord);
  if (source === null) throw new RangeError("QVM strncpy requires a nonnull source pointer");
  const terminator = source.subarray(0, count).indexOf(0);
  const copiedLength = terminator < 0 ? count : terminator;
  memory.span(sourceWord, terminator < 0 ? count : terminator + 1);
  memory.regionWrite(destination, source.subarray(0, copiedLength));
  memory.regionFill(destination, copiedLength, count - copiedLength, 0);
  return destinationWord;
}
