import type { GuestAddress, GuestMemory, ModuleIdentity } from "../../contracts/execution.ts";
import type { QvmMemory } from "./memory.ts";

/** Host addresses refer to the same raw allocation read by QVM LOAD/STORE. */
export class QvmGuestMemory implements GuestMemory {
  readonly addressSpace = Symbol("qvm-memory");
  readonly pointerBytes = 4;

  constructor(readonly module: ModuleIdentity, private readonly memory: QvmMemory) {}

  pointer(rawValue: bigint): GuestAddress | null {
    if (rawValue < -0x80000000n || rawValue > 0xffffffffn) throw new RangeError("QVM pointer is outside its 32-bit representation");
    const pointer = this.memory.pointer(Number(BigInt.asIntN(32, rawValue)));
    return pointer === null ? null : this.address(BigInt(pointer.byteOffset - this.memory.bytes.byteOffset));
  }

  private address(byteOffset: bigint): GuestAddress {
    if (byteOffset < 0 || byteOffset > BigInt(this.memory.bytes.length)) throw new RangeError("QVM address exceeds allocation");
    return { kind: "guest-address", addressSpace: this.addressSpace, byteOffset };
  }

  private checked(address: GuestAddress, byteLength: number): number {
    if (address.addressSpace !== this.addressSpace) throw new Error("QVM pointer belongs to another module instance");
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || address.byteOffset < 0
      || address.byteOffset + BigInt(byteLength) > BigInt(this.memory.bytes.length)) throw new RangeError("QVM address range exceeds allocation");
    return Number(address.byteOffset);
  }

  offset(address: GuestAddress, displacement: bigint): GuestAddress {
    this.checked(address, 0);
    return this.address(address.byteOffset + displacement);
  }

  borrow(address: GuestAddress, byteLength: number): DataView {
    return this.memory.dataView(this.checked(address, byteLength), byteLength);
  }

  copy(address: GuestAddress, byteLength: number): Uint8Array {
    const start = this.checked(address, byteLength);
    return this.memory.bytes.slice(start, start + byteLength);
  }

  write(address: GuestAddress, bytes: Uint8Array): undefined {
    this.memory.writeBytes(this.checked(address, bytes.length), bytes);
  }
}
