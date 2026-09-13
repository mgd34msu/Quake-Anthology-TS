import type { GuestAddress, GuestCallResult } from '../../../contracts/execution.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { MappedGuestMemory } from '../../../guest/core/contracts.ts';
import { argument, integer, requiredPointer } from '../../../guest/runtime/common/memory.ts';
import { q2WorldText } from '../../../content/q2/rerelease/world-text.ts';
import type { WorldTextInput } from '../../../text/world.ts';
import type { RereleaseImportCall } from './module.ts';

export interface RereleaseWorldTextEvent { readonly text: WorldTextInput; readonly lifetime: number; }

/** Copies guest arguments; the receiving world owns timing, expiry and teardown. */
export class RereleaseWorldTextImports {
  constructor(private readonly memory: MappedGuestMemory, private readonly emit: (event: RereleaseWorldTextEvent) => void) {}
  invoke(call: RereleaseImportCall): GuestCallResult | undefined {
    if (call.api !== 'game' || (call.name !== 'Draw_OrientedWorldText' && call.name !== 'Draw_StaticWorldText')) return undefined;
    const args = call.arguments, fixed = call.name === 'Draw_StaticWorldText', offset = fixed ? 1 : 0;
    const vector = (address: GuestAddress): Vec3 => ({ x: this.memory.readFloat32(address),
      y: this.memory.readFloat32(this.memory.offset(address, 4n)), z: this.memory.readFloat32(this.memory.offset(address, 8n)) });
    const float = (index: number): number => {
      const value = argument(args, index); if (value.kind !== 'float32') throw new TypeError('Q2 world text requires a source float');
      return value.value;
    };
    const string = requiredPointer(args, 1 + offset), color = requiredPointer(args, 2 + offset);
    let text = '';
    for (let index = 0; index < 127; index++) {
      const byte = this.memory.readUint8(this.memory.offset(string, BigInt(index)));
      if (byte === 0) break;
      text += String.fromCharCode(byte);
    }
    const rgba = (index: bigint): number => this.memory.readUint8(this.memory.offset(color, index)) / 255;
    this.emit({ text: q2WorldText({ origin: vector(requiredPointer(args, 0)), angles: fixed ? vector(requiredPointer(args, 1)) : null,
      text, color: { x: rgba(0n), y: rgba(1n), z: rgba(2n), w: rgba(3n) }, size: float(3 + offset),
      depthTest: integer(args, 5 + offset) !== 0n }), lifetime: float(4 + offset) });
    return { kind: 'void' };
  }
}
