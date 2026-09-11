// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { argument, integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteDir, MSG_WriteFloat, MSG_WriteLong, MSG_WriteShort, SZ_Clear, SZ_Write } from "../../../network/q2/message.ts";
import type { SizeBuf } from "../../../network/q2/message.ts";
import type { RereleaseImportCall } from "./module.ts";

export interface RereleaseUnicast {
  readonly clientSlot: number;
  readonly reliable: boolean;
  readonly dupeKey: number;
  readonly bytes: Uint8Array;
}
export interface RereleaseMulticast {
  readonly origin: Vec3 | null;
  readonly destination: "all" | "phs" | "pvs";
  readonly reliable: boolean;
  readonly bytes: Uint8Array;
}
export interface RereleaseMessageServices {
  /** The server's existing message assembly buffer, shared by all game writes. */
  readonly buffer: SizeBuf;
  /** Source slot, with world at zero; false includes disconnected/zombie clients. */
  acceptsClient(slot: number): boolean;
  unicast(message: RereleaseUnicast): void;
  multicast(message: RereleaseMulticast): void;
}

/** game.h writers and q2repro PF_Unicast; transport retains recipient and duplicate key. */
export class RereleaseMessageImports {
  constructor(readonly memory: MappedGuestMemory, readonly services: RereleaseMessageServices, readonly sourceSlot: (address: GuestAddress) => number) {}
  #vector(address: GuestAddress): Vec3 {
    return { x: this.memory.readFloat32(address), y: this.memory.readFloat32(this.memory.offset(address, 4n)), z: this.memory.readFloat32(this.memory.offset(address, 8n)) };
  }
  invoke(call: RereleaseImportCall): GuestCallResult | undefined {
    if (call.api !== "game") return undefined;
    const args = call.arguments, buffer = this.services.buffer;
    switch (call.name) {
      case "WriteChar": MSG_WriteChar(buffer, Number(integer(args, 0))); break;
      case "WriteByte": MSG_WriteByte(buffer, Number(integer(args, 0))); break;
      case "WriteShort": MSG_WriteShort(buffer, Number(integer(args, 0))); break;
      case "WriteLong": MSG_WriteLong(buffer, Number(integer(args, 0))); break;
      case "WriteFloat": case "WriteAngle": {
        const value = argument(args, 0);
        if (value.kind !== "float32") throw new TypeError("Q2 message writer requires a source float");
        if (call.name === "WriteFloat") MSG_WriteFloat(buffer, value.value);
        else MSG_WriteByte(buffer, Math.trunc(Math.fround(Math.fround(value.value * 256) / 360)) & 255);
        break;
      }
      case "WritePosition": {
        // Rerelease's Q2P_PROTOCOL_MULTICAST_FLOAT encodes three float32 values.
        const position = this.#vector(requiredPointer(args, 0));
        MSG_WriteFloat(buffer, position.x); MSG_WriteFloat(buffer, position.y); MSG_WriteFloat(buffer, position.z);
        break;
      }
      case "WriteDir": {
        const address = pointer(args, 0);
        if (address === null) MSG_WriteByte(buffer, 0);
        else { const direction = this.#vector(address); MSG_WriteDir(buffer, new Float32Array([direction.x, direction.y, direction.z])); }
        break;
      }
      case "WriteString": {
        const address = pointer(args, 0);
        if (address === null) { MSG_WriteByte(buffer, 0); break; }
        let length = 0;
        while (this.memory.readUint8(this.memory.offset(address, BigInt(length))) !== 0) {
          if (++length >= buffer.maxsize) throw new RangeError("Q2 message string exceeds message capacity");
        }
        SZ_Write(buffer, this.memory.copy(address, length + 1), length + 1);
        break;
      }
      case "WriteEntity": MSG_WriteShort(buffer, this.sourceSlot(requiredPointer(args, 0))); break;
      case "unicast": {
        const address = pointer(args, 0);
        if (address === null) { SZ_Clear(buffer); break; }
        if (buffer.overflowed) throw new Error("Q2 unicast message buffer overflowed");
        const slot = this.sourceSlot(address);
        if (this.services.acceptsClient(slot) && buffer.cursize !== 0) this.services.unicast({ clientSlot: slot, reliable: integer(args, 1) !== 0n, dupeKey: Number(integer(args, 2)), bytes: buffer.data.slice(0, buffer.cursize) });
        SZ_Clear(buffer);
        break;
      }
      case "multicast": {
        if (buffer.overflowed) throw new Error("Q2 multicast message buffer overflowed");
        const target = integer(args, 1), address = pointer(args, 0);
        if (target !== 0n && target !== 1n && target !== 2n) throw new RangeError("Unknown Q2 multicast destination");
        if (target !== 0n && address === null) throw new TypeError("Q2 spatial multicast requires an origin");
        if (buffer.cursize !== 0) this.services.multicast({ origin: address === null ? null : this.#vector(address), destination: target === 0n ? "all" : target === 1n ? "phs" : "pvs", reliable: integer(args, 2) !== 0n, bytes: buffer.data.slice(0, buffer.cursize) });
        SZ_Clear(buffer);
        break;
      }
      default: return undefined;
    }
    return { kind: "void" };
  }
}
