// SPDX-License-Identifier: GPL-2.0-or-later
/* Quake III Arena server/sv_game.c SV_GameSystemCalls for native i386 modules: the call record the shared server-game trap table decodes. */
import { decodeQvmGameImport } from "../../qvm/abi.ts";
import type { SharedHostCall } from "../../qvm/syscalls.ts";
import type { NativeGameMemory } from "./memory.ts";

/**
 * A native module's trap, decoded exactly like the same trap from an interpreted module: the code selects an engine import (or an
 * extension the table rejects), the words carry the arguments, and pointer arguments resolve through the module's own address space.
 */
export function nativeQ3GameCall(words: DataView, guest: NativeGameMemory, commandArguments: readonly string[] | null): SharedHostCall {
  const trap = words.getInt32(0, true),
    code = decodeQvmGameImport(trap);
  return code === null
    ? { kind: "extension", role: "qagame", code: trap, words, guest, abiProfile: "q3-modern", commandArguments }
    : { kind: "engine", role: "qagame", code, words, guest, abiProfile: "q3-modern", commandArguments };
}
