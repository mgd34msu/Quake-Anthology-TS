import type { DebugLine } from './shapes.ts';
interface TimedLine { readonly line: DebugLine; readonly expires: number | null; readonly firstFrame: number | null; }

/** Server milliseconds own expiry; all seats share one presentation-frame snapshot. */
export class WorldDebugLineStore {
  private entries: TimedLine[] = [];
  constructor(readonly capacity = 9216) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('Invalid debug line capacity');
  }
  submit(lines: readonly DebugLine[], nowMilliseconds: number, lifetimeMilliseconds: number): void {
    if (!Number.isFinite(nowMilliseconds) || !Number.isSafeInteger(lifetimeMilliseconds) || lifetimeMilliseconds < 0 || lifetimeMilliseconds > 0xffffffff) throw new RangeError('Invalid debug line lifetime');
    for (const line of lines) {
      if (![line.start.x, line.start.y, line.start.z, line.end.x, line.end.y, line.end.z, line.color.x, line.color.y, line.color.z, line.color.w].every(Number.isFinite)) throw new RangeError('Invalid debug line geometry');
    }
    const now = Math.trunc(nowMilliseconds) >>> 0;
    const deadline = lifetimeMilliseconds === 0 ? 0 : (now + lifetimeMilliseconds) >>> 0;
    this.entries = this.entries.filter(entry => entry.expires === null || entry.expires > now);
    for (const line of lines) this.entries.push({ line: Object.freeze({ ...line, start: Object.freeze({ ...line.start }), end: Object.freeze({ ...line.end }), color: Object.freeze({ ...line.color }) }), expires: deadline === 0 ? null : deadline, firstFrame: null });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }
  snapshot(nowMilliseconds: number, frame: number): readonly DebugLine[] {
    if (!Number.isFinite(nowMilliseconds)) throw new RangeError('Invalid debug line clock');
    const now = Math.trunc(nowMilliseconds) >>> 0;
    this.entries = this.entries.filter(entry => entry.expires === null ? entry.firstFrame === null || entry.firstFrame === frame : entry.expires > now)
      .map(entry => entry.expires === null && entry.firstFrame === null ? { ...entry, firstFrame: frame } : entry);
    return Object.freeze(this.entries.map(entry => entry.line));
  }
  clear(): void { this.entries = []; }
}
