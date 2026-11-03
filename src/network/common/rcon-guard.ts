// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash, timingSafeEqual } from "node:crypto";
import { PeerTable } from "./peer-table.ts";
import type { NetworkAddress } from "./endpoint.ts";

/** Compares fixed-length digests so a mismatch does not reveal how much of the password matched. */
export function passwordMatches(expected: string, supplied: string): boolean {
  const left = createHash("sha256").update(expected).digest(),
    right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right) && expected.length > 0;
}

/** Per-source failure backoff for rcon password guesses, with a bounded table. */
export class RconGuard {
  private readonly sources: PeerTable;
  private readonly failures: Int32Array;
  private readonly until: Float64Array;
  constructor(
    private readonly freeAttempts = 3,
    maxSources = 1024,
  ) {
    this.sources = new PeerTable(maxSources);
    this.failures = new Int32Array(maxSources);
    this.until = new Float64Array(maxSources);
  }
  permitted(from: NetworkAddress, now: number): boolean {
    const slot = this.sources.find(from);
    return slot < 0 || now >= (this.until[slot] ?? 0);
  }
  failed(from: NetworkAddress, now: number): void {
    let slot = this.sources.find(from);
    if (slot < 0) {
      if (this.sources.count >= this.sources.capacity) this.sources.release(this.sources.oldest());
      slot = this.sources.claim(from);
      this.failures[slot] = 0;
      this.until[slot] = 0;
    }
    const failures = (this.failures[slot] ?? 0) + 1;
    this.failures[slot] = failures;
    if (failures >= this.freeAttempts) this.until[slot] = now + Math.min(60000, 1000 * 2 ** (failures - this.freeAttempts));
  }
  succeeded(from: NetworkAddress): void {
    this.sources.release(this.sources.find(from));
  }
}
