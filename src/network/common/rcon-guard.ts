import { createHash, timingSafeEqual } from "node:crypto";
import { addressKey } from "./endpoint.ts";
import type { NetworkAddress } from "./endpoint.ts";

/** Compares fixed-length digests so a mismatch does not reveal how much of the password matched. */
export function passwordMatches(expected: string, supplied: string): boolean {
  const left = createHash("sha256").update(expected).digest(), right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right) && expected.length > 0;
}

/** Per-source failure backoff for rcon password guesses, with a bounded table. */
export class RconGuard {
  private readonly sources = new Map<string, { failures: number; until: number }>();
  constructor(private readonly freeAttempts = 3, private readonly maxSources = 1024) {}
  permitted(from: NetworkAddress, now: number): boolean {
    const entry = this.sources.get(addressKey(from, false));
    return entry === undefined || now >= entry.until;
  }
  failed(from: NetworkAddress, now: number): void {
    const key = addressKey(from, false), entry = this.sources.get(key) ?? { failures: 0, until: 0 };
    if (!this.sources.has(key) && this.sources.size >= this.maxSources) {
      const oldest = this.sources.keys().next();
      if (!oldest.done) this.sources.delete(oldest.value);
    }
    entry.failures++;
    if (entry.failures >= this.freeAttempts) entry.until = now + Math.min(60000, 1000 * 2 ** (entry.failures - this.freeAttempts));
    this.sources.set(key, entry);
  }
  succeeded(from: NetworkAddress): void { this.sources.delete(addressKey(from, false)); }
}
