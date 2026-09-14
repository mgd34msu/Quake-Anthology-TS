import type { Vec4 } from '../../../contracts/math.ts';
import { debugShapeLines } from '../../../debug/shapes.ts';
import type { DebugShape } from '../../../debug/shapes.ts';
import type { Q2RereleaseEvent } from './types.ts';

/** PF_Draw_* converts float seconds to unsigned milliseconds, including negative wrapping. */
export function rereleaseDebugLifetime(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new RangeError('Invalid debug lifetime');
  return Math.trunc(Math.fround(Math.fround(seconds) * 1000)) >>> 0;
}
export function q2DebugShape(shape: DebugShape, color: Vec4, lifetimeSeconds: number, depthTest: boolean): Extract<Q2RereleaseEvent, { readonly kind: 'debug-shapes' }> {
  return { kind: 'debug-shapes', lines: debugShapeLines(shape, color, depthTest), lifetimeMilliseconds: rereleaseDebugLifetime(lifetimeSeconds) };
}
