// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { argument, integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import type { RereleaseImportCall } from "./module.ts";

export interface RereleaseSoundEvent {
  readonly entitySlot: number | null;
  readonly origin: Vec3 | null;
  readonly channel: number;
  readonly soundIndex: number;
  readonly volume: number;
  readonly attenuation: number;
  readonly timeOffset: number;
  readonly audience: { readonly kind: "world" } | { readonly kind: "client"; readonly clientSlot: number; readonly dupeKey: number };
}

/** Preserves game.h sound arguments for server transport or shared audio playback. */
export class RereleaseSoundImports {
  constructor(readonly memory: MappedGuestMemory, readonly emit: (event: RereleaseSoundEvent) => void, readonly sourceSlot: (address: GuestAddress) => number) {}
  invoke(call: RereleaseImportCall): GuestCallResult | undefined {
    if (call.api !== "game" || (call.name !== "sound" && call.name !== "positioned_sound" && call.name !== "local_sound")) return undefined;
    const args = call.arguments;
    const offset = call.name === "sound" ? 0 : call.name === "positioned_sound" ? 1 : 2;
    const entity = pointer(args, offset);
    const origin = call.name === "sound" ? null : call.name === "positioned_sound" ? requiredPointer(args, 0) : pointer(args, 1);
    const float = (index: number): number => {
      const value = argument(args, index);
      if (value.kind !== "float32") throw new TypeError("Q2 sound requires a source float");
      return value.value;
    };
    this.emit({
      entitySlot: entity === null ? null : this.sourceSlot(entity),
      origin: origin === null ? null : { x: this.memory.readFloat32(origin), y: this.memory.readFloat32(this.memory.offset(origin, 4n)), z: this.memory.readFloat32(this.memory.offset(origin, 8n)) },
      channel: Number(integer(args, offset + 1)), soundIndex: Number(integer(args, offset + 2)),
      volume: float(offset + 3), attenuation: float(offset + 4), timeOffset: float(offset + 5),
      audience: call.name === "local_sound" ? { kind: "client", clientSlot: this.sourceSlot(requiredPointer(args, 0)), dupeKey: Number(integer(args, 8)) } : { kind: "world" },
    });
    return { kind: "void" };
  }
}
