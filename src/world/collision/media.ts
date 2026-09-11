import type { BspPlane } from '../../contracts/scene.ts';
import type { NumericOperations } from '../../contracts/numeric.ts';
import { convertContents } from './contents.ts';
import type { CollisionFamily } from './contents.ts';

export interface MediumBrush { readonly contents: number; readonly planes: readonly BspPlane[]; }
export interface TraceMedia { readonly inOpen: boolean; readonly inWater: boolean; }
interface Interval { readonly start: number; readonly end: number; }

/** Classifies the reached segment without changing brush visitation or impact selection. */
export function traceBrushMedia(brushes: Iterable<MediumBrush, undefined, unknown>, family: CollisionFamily,
    distance: (plane: BspPlane, endpoint: 'start' | 'end') => number,
    numeric: NumericOperations, fraction: number): TraceMedia {
    const solids: Interval[] = [], liquids: Interval[] = [];
    for (const brush of brushes) {
        const contents = convertContents(brush.contents, family, 'q1');
        if (contents === -1) continue;
        let start = 0, end = fraction, outside = false;
        for (const plane of brush.planes) {
            const first = distance(plane, 'start'), last = distance(plane, 'end');
            if (first > 0 && last > 0) { outside = true; break; }
            if (first <= 0 && last <= 0) continue;
            const crossing = numeric.divide(first, numeric.subtract(first, last));
            if (first > last) start = Math.max(start, crossing);
            else end = Math.min(end, crossing);
            if (start > end) { outside = true; break; }
        }
        if (!outside && brush.planes.length > 0) (contents === -2 ? solids : liquids).push({ start, end });
    }
    solids.sort((a, b) => a.start - b.start);
    const occupied = [...solids, ...liquids].sort((a, b) => a.start - b.start);
    return { inOpen: uncovered({ start: 0, end: fraction }, occupied),
        inWater: liquids.some(interval => uncovered(interval, solids)) };
}

function uncovered(interval: Interval, occupied: readonly Interval[]): boolean {
    if (interval.start === interval.end) return !occupied.some(part => part.start <= interval.start && part.end >= interval.end);
    let position = interval.start;
    for (const part of occupied) {
        if (part.end < position) continue;
        if (part.start > position) return true;
        position = Math.max(position, part.end);
        if (position >= interval.end) return false;
    }
    return position < interval.end;
}
