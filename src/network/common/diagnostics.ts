// SPDX-License-Identifier: GPL-2.0-or-later
/** Peer text can carry terminal escape sequences; replace control characters and bound the length. */
export function printablePeerText(text: string, limit = 256): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "?").slice(0, limit);
}

/** Bounds per-packet diagnostics so malformed traffic cannot flood the console or log. */
export class DiagnosticBudget {
  private tokens: number;
  private last = performance.now();
  constructor(
    private readonly burst = 20,
    private readonly perSecond = 2,
  ) {
    this.tokens = burst;
  }
  allow(): boolean {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
