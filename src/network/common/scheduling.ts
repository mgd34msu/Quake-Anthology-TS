// QuakeWorld clear-time pacing and ordered network work. GPL-2.0-or-later.
export class PacketRate {
  private clearTime = 0;
  constructor(public bytesPerSecond: number, readonly backupBytes = 200) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) throw new RangeError("Network rate must be positive");
  }
  canSend(nowMilliseconds: number, paused = false): boolean {
    return paused || this.clearTime < nowMilliseconds + this.backupBytes * 1000 / this.bytesPerSecond;
  }
  sent(bytes: number, nowMilliseconds: number, paused = false): void {
    this.clearTime = paused ? nowMilliseconds : Math.max(this.clearTime, nowMilliseconds) + bytes * 1000 / this.bytesPerSecond;
  }
  get nextSendMilliseconds(): number { return this.clearTime; }
  reset(): void { this.clearTime = 0; }
}

interface ScheduledPacket<T> { readonly sequence: number; readonly due: number; readonly value: T; }
export class PacketScheduler<T> {
  private readonly pending: ScheduledPacket<T>[] = [];
  private sequence = 0;
  schedule(dueMilliseconds: number, value: T): number {
    if (!Number.isFinite(dueMilliseconds)) throw new RangeError("Invalid packet time");
    const sequence = this.sequence++;
    this.pending.push({ sequence, due: dueMilliseconds, value });
    this.pending.sort((left, right) => left.due - right.due || left.sequence - right.sequence);
    return sequence;
  }
  cancel(sequence: number): boolean {
    const index = this.pending.findIndex(value => value.sequence === sequence);
    if (index < 0) return false;
    this.pending.splice(index, 1); return true;
  }
  drain(nowMilliseconds: number, deliver: (value: T) => void): void {
    while (true) {
      const first = this.pending[0];
      if (first === undefined || first.due > nowMilliseconds) return;
      this.pending.shift(); deliver(first.value);
    }
  }
  clear(): void { this.pending.length = 0; }
}
