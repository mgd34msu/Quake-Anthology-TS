// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult, GuestCallValue, GuestValueLayout, NativeAbi } from "../../../contracts/execution.ts";
import type { GuestCallbackTable, GuestHostCallback } from "../../../guest/core/index.ts";
import { integer } from "../../../guest/runtime/common/memory.ts";
import { nativeQ3Signature } from "./module.ts";

/** The words id's VM_DllSyscall copies for every trap: the trap number and fifteen arguments. */
export const NATIVE_Q3_SYSCALL_WORDS = 16;

/** The shared trap table receives each call as the same 16 little-endian words an interpreted module's trap carries. */
export type NativeQ3SyscallHandler = (words: DataView) => number | Promise<number>;

/**
 * The variadic `syscall(int arg, ...)` entry that dllEntry receives. Like VM_DllSyscall it reads a fixed sixteen words from the caller's
 * stack for every trap, since only the engine knows how many a given trap uses; the trap table decodes the ones it needs.
 * A trap the table cannot handle throws before it returns success.
 */
export class NativeQ3Syscalls {
  readonly address: GuestAddress;
  private readonly callback: GuestHostCallback;
  constructor(callbacks: GuestCallbackTable, abi: NativeAbi, handler: NativeQ3SyscallHandler) {
    if (abi.pointerBytes !== 4) throw new Error("Q3 1.32 syscalls require the i386 source ABI");
    this.callback = { id: `q3-native-syscall:${callbacks.memory.module.id}`, signature: nativeQ3Signature(abi, ["int32"], "int32", true),
      invoke: (_context, args) => {
        const words = new DataView(new ArrayBuffer(NATIVE_Q3_SYSCALL_WORDS * 4));
        for (let index = 0; index < NATIVE_Q3_SYSCALL_WORDS; index++) words.setInt32(index * 4, Number(BigInt.asIntN(32, integer(args, index))), true);
        const result = handler(words);
        const complete = (value: number): GuestCallResult => ({ kind: "int32", value: value | 0 });
        return typeof result === "number" ? complete(result) : result.then(complete);
      } };
    this.address = callbacks.bind(this.callback);
  }
  variadicLayouts(callback: GuestHostCallback, _fixed: readonly GuestCallValue[]): readonly GuestValueLayout[] | null {
    return callback.id === this.callback.id ? new Array<GuestValueLayout>(NATIVE_Q3_SYSCALL_WORDS - 1).fill({ kind: "scalar", storage: "int32" }) : null;
  }
}
