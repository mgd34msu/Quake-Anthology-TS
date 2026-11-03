/**
 * Per-client movement time allowance in the manner of Q2 sv_enforcetime: a command spends its msec (at least 1)
 * from a balance that refills with wall time, so command bursts cannot exceed what the elapsed time allows.
 */
export class MovementBudget {
  private balance: number;
  private last: number | null = null;
  constructor(private readonly capMilliseconds = 1800, private readonly refillPerMillisecond = 1.8) { this.balance = capMilliseconds; }
  admit(milliseconds: number, now: number): boolean {
    if (this.last !== null) this.balance = Math.min(this.capMilliseconds, this.balance + Math.max(0, now - this.last) * this.refillPerMillisecond);
    this.last = now;
    const cost = Math.max(1, milliseconds);
    if (cost > this.balance) return false;
    this.balance -= cost;
    return true;
  }
}
