// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallValue, GuestStorage, GuestValueLayout, NativeAbi } from "../../../contracts/execution.ts";
import type { GuestCallbackTable, GuestHostCallback } from "../../../guest/core/index.ts";
import { integer } from "../../../guest/runtime/common/memory.ts";
import { nativeQ3Signature } from "./module.ts";

export interface NativeQ3SyscallBinding {
  readonly code: number;
  readonly name: string;
  /** Pointer arguments remain guest pointers; PASSFLOAT arguments use int32 bits. */
  readonly parameters: readonly GuestStorage[];
  invoke(context: GuestCallContext, arguments_: readonly GuestCallValue[]): number;
}

/** Attach layouts to the shared runner's variadicLayouts resolver. This decodes
 * only the arguments declared by the owning source host for the actual syscall.
 * Unsupported operations throw before reading guessed arguments or returning success.
 */
export class NativeQ3Syscalls {
  readonly address: GuestAddress;
  private readonly services = new Map<number, NativeQ3SyscallBinding>();
  private readonly callback: GuestHostCallback;
  constructor(callbacks: GuestCallbackTable, abi: NativeAbi, bindings: readonly NativeQ3SyscallBinding[]) {
    if (abi.pointerBytes !== 4) throw new Error("Q3 1.32 syscalls require the i386 source ABI");
    for (const service of bindings) {
      if (this.services.has(service.code)) throw new Error(`Duplicate native Q3 syscall ${service.code}`);
      this.services.set(service.code, service);
    }
    this.callback = { id: `q3-native-syscall:${callbacks.memory.module.id}`, signature: nativeQ3Signature(abi, ["int32"], "int32", true),
      invoke: (context, args) => ({ kind: "int32", value: this.service(args).invoke(context, args.slice(1)) }) };
    this.address = callbacks.bind(this.callback);
  }
  private service(args: readonly GuestCallValue[]): NativeQ3SyscallBinding {
    const code = Number(integer(args, 0)), service = this.services.get(code);
    if (service === undefined) throw new Error(`Unbound Q3 native syscall ${code}`);
    return service;
  }
  variadicLayouts(callback: GuestHostCallback, fixed: readonly GuestCallValue[]): readonly GuestValueLayout[] | null {
    return callback.id === this.callback.id ? this.service(fixed).parameters.map(storage => ({ kind: "scalar", storage })) : null;
  }
}
