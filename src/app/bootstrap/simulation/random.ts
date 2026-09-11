/* Instance-owned glibc TYPE_3 rand/srand, adapted from the Q3 donor native-random.ts.
 * Copyright (C) Free Software Foundation, Inc. SPDX-License-Identifier: LGPL-2.1-or-later */
import type { RandomSource, RandomState } from "../../../contracts/numeric.ts";

import { Q2RereleaseRandom } from "../../../core/random/q2-rerelease.ts";

export class SourceRandom implements RandomSource {
  readonly rerelease: Q2RereleaseRandom | null;
  private readonly words = new Int32Array(31);
  private front = 3;
  private rear = 0;
  private draws = 0;

  constructor(seed: number, profile: "classic" | "q2-rerelease" = "classic") {
    this.rerelease = profile === "q2-rerelease" ? new Q2RereleaseRandom(seed) : null;
    if (this.rerelease !== null) return;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError("Source random seed must be uint32");
    let word = (seed === 0 ? 1 : seed) | 0;
    this.words[0] = word;
    for (let index = 1; index < this.words.length; index++) {
      word = 16807 * (word % 127773) - 2836 * Math.trunc(word / 127773);
      if (word < 0) word += 2147483647;
      this.words[index] = word;
    }
    for (let count = 0; count < 310; count++) this.draw();
  }

  nextInteger(): number { if (this.rerelease !== null) return this.rerelease.nextUint32(); this.draws++; return this.draw(); }
  nextUnit(): number { if (this.rerelease !== null) return this.rerelease.float(); return Math.fround((this.nextInteger() & 0x7fff) / 0x7fff); }

  checkpoint(): Extract<RandomState, { readonly kind: "glibc-random" | "q2-rerelease-mt19937" }> {
    if (this.rerelease !== null) return this.rerelease.checkpoint();
    return { kind: "glibc-random", words: Array.from(this.words), front: this.front, rear: this.rear, draws: this.draws };
  }

  restore(state: Extract<RandomState, { readonly kind: "glibc-random" | "q2-rerelease-mt19937" }>): undefined {
    if (state.kind === "q2-rerelease-mt19937") {
      if (this.rerelease === null) throw new Error("Rerelease random state cannot restore a classic source stream");
      return this.rerelease.restore(state);
    }
    if (this.rerelease !== null) throw new Error("Classic random state cannot restore a rerelease source stream");
    if (state.words.length !== this.words.length || state.front < 0 || state.front >= this.words.length || state.rear < 0 || state.rear >= this.words.length)
      throw new RangeError("Invalid source random state");
    this.words.set(state.words); this.front = state.front; this.rear = state.rear; this.draws = state.draws;
    return undefined;
  }

  private draw(): number {
    const first = this.words[this.front], second = this.words[this.rear];
    if (first === undefined || second === undefined) throw new Error("Source random cursor is outside its state");
    const sum = (first + (second >>> 0)) >>> 0;
    this.words[this.front] = sum | 0;
    this.front = (this.front + 1) % 31;
    this.rear = (this.rear + 1) % 31;
    return sum >>> 1;
  }
}
