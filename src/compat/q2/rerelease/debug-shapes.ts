import { rereleaseDebugLifetime } from '../../../content/q2/rerelease/debug-shapes.ts';
export { rereleaseDebugLifetime } from '../../../content/q2/rerelease/debug-shapes.ts';
import type { GuestCallResult } from '../../../contracts/execution.ts';
import type { Vec3, Vec4 } from '../../../contracts/math.ts';
import type { MappedGuestMemory } from '../../../guest/core/contracts.ts';
import { argument, integer, requiredPointer } from '../../../guest/runtime/common/memory.ts';
import { debugShapeLines } from '../../../debug/shapes.ts';
import type { DebugLine, DebugShape } from '../../../debug/shapes.ts';
import type { RereleaseImportCall } from './module.ts';

export interface RereleaseDebugShapesEvent { readonly lines: readonly DebugLine[]; readonly lifetimeMilliseconds: number; }
export class RereleaseDebugShapeImports {
  constructor(private readonly memory: MappedGuestMemory, private readonly emit: (event: RereleaseDebugShapesEvent) => void) {}
  invoke(call: RereleaseImportCall): GuestCallResult | undefined {
    if (call.api !== 'game') return undefined;
    const args = call.arguments;
    const vector = (index: number): Vec3 => {
      const address = requiredPointer(args, index);
      return { x: this.memory.readFloat32(address), y: this.memory.readFloat32(this.memory.offset(address, 4n)), z: this.memory.readFloat32(this.memory.offset(address, 8n)) };
    };
    const float = (index: number): number => {
      const value = argument(args, index);
      if (value.kind !== 'float32' || !Number.isFinite(value.value)) throw new TypeError('Q2 debug shape requires a finite source float');
      return value.value;
    };
    const color = (index: number): Vec4 => {
      const address = requiredPointer(args, index), byte = (offset: bigint): number => this.memory.readUint8(this.memory.offset(address, offset)) / 255;
      return { x: byte(0n), y: byte(1n), z: byte(2n), w: byte(3n) };
    };
    let shape: DebugShape, colorIndex: number, lifetimeIndex: number;
    switch (call.name) {
      case 'Draw_Line': shape = { kind: 'line', start: vector(0), end: vector(1) }; colorIndex = 2; lifetimeIndex = 3; break;
      case 'Draw_Point': shape = { kind: 'point', origin: vector(0), size: float(1) }; colorIndex = 2; lifetimeIndex = 3; break;
      case 'Draw_Circle': case 'Draw_Sphere': shape = { kind: call.name === 'Draw_Circle' ? 'circle' : 'sphere', origin: vector(0), radius: float(1) }; colorIndex = 2; lifetimeIndex = 3; break;
      case 'Draw_Bounds': shape = { kind: 'bounds', min: vector(0), max: vector(1) }; colorIndex = 2; lifetimeIndex = 3; break;
      case 'Draw_Cylinder': shape = { kind: 'cylinder', origin: vector(0), halfHeight: float(1), radius: float(2) }; colorIndex = 3; lifetimeIndex = 4; break;
      case 'Draw_Ray': shape = { kind: 'ray', origin: vector(0), direction: vector(1), length: float(2), size: float(3) }; colorIndex = 4; lifetimeIndex = 5; break;
      case 'Draw_Arrow': shape = { kind: 'arrow', start: vector(0), end: vector(1), size: float(2), capColor: color(4) }; colorIndex = 3; lifetimeIndex = 5; break;
      default: return undefined;
    }
    this.emit({ lines: debugShapeLines(shape, color(colorIndex), integer(args, lifetimeIndex + 1) !== 0n), lifetimeMilliseconds: rereleaseDebugLifetime(float(lifetimeIndex)) });
    return { kind: 'void' };
  }
}
