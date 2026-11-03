// QuakeWorld clear-time pacing. GPL-2.0-or-later.
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
