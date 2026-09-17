/** Portable replacement for Q3's optional macOS OmniTimer stack and stamp lists. */
export interface TimerReport { readonly name: string; readonly calls: number; readonly totalMilliseconds: number; readonly selfMilliseconds: number; readonly maximumMilliseconds: number; }
export interface TimerStamp { readonly name: string; readonly milliseconds: number; }
interface ActiveTimer { readonly name: string; readonly start: number; children: number; }
interface Aggregate { calls: number; totalMilliseconds: number; selfMilliseconds: number; maximumMilliseconds: number; }
export class OmniTimer {
  private readonly stack: ActiveTimer[] = [];
  private readonly totals = new Map<string, Aggregate>();
  private readonly stamps: TimerStamp[] = [];
  private epoch: number;
  private active = false;
  constructor(private readonly clock: () => number = () => performance.now(), readonly stampCapacity = 4096) {
    if (!Number.isSafeInteger(stampCapacity) || stampCapacity < 1) throw new RangeError("Invalid timer stamp capacity");
    this.epoch = clock();
  }
  get enabled(): boolean { return this.active; }
  setEnabled(enabled: boolean): void {
    if (this.stack.length !== 0) throw new Error("Cannot change timer mode inside an active scope");
    this.active = enabled;
  }
  push(name: string): void { if (this.active) this.stack.push({ name, start: this.clock(), children: 0 }); }
  pop(): void {
    if (!this.active) return;
    const item = this.stack.pop();
    if (item === undefined) throw new Error("Unbalanced timer pop");
    const elapsed = Math.max(0, this.clock() - item.start), parent = this.stack.at(-1);
    if (parent !== undefined) parent.children += elapsed;
    const total = this.totals.get(item.name) ?? { calls: 0, totalMilliseconds: 0, selfMilliseconds: 0, maximumMilliseconds: 0 };
    total.calls++; total.totalMilliseconds += elapsed; total.selfMilliseconds += Math.max(0, elapsed - item.children);
    total.maximumMilliseconds = Math.max(total.maximumMilliseconds, elapsed); this.totals.set(item.name, total);
  }
  measure<T>(name: string, operation: () => T): T { if (!this.active) return operation(); this.push(name); try { return operation(); } finally { this.pop(); } }
  stamp(name: string): void {
    if (!this.active) return;
    if (this.stamps.length === this.stampCapacity) this.stamps.shift();
    this.stamps.push({ name, milliseconds: this.clock() - this.epoch });
  }
  report(): readonly TimerReport[] { return [...this.totals].map(([name, total]) => ({ name, ...total })); }
  stampList(): readonly TimerStamp[] { return this.stamps.slice(); }
  reset(): void {
    if (this.stack.length !== 0) throw new Error("Cannot reset timers inside an active scope");
    this.totals.clear(); this.stamps.length = 0; this.epoch = this.clock();
  }
  format(): string {
    return "name\tcalls\ttotal_ms\tself_ms\tmax_ms\n" + this.report().map(row =>
      `${row.name}\t${row.calls}\t${row.totalMilliseconds.toFixed(3)}\t${row.selfMilliseconds.toFixed(3)}\t${row.maximumMilliseconds.toFixed(3)}`).join("\n") + "\n";
  }
}
