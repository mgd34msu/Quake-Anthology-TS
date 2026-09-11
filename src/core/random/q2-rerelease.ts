/* Q2 rerelease g_local.h random helpers (GPL-2.0-or-later), using MT19937.
 * Distribution profile: Microsoft STL vs-2022-17.6 <random>,
 * Apache-2.0 WITH LLVM-exception, https://github.com/microsoft/STL/tree/vs-2022-17.6.
 * This pins the source distribution implementation, not an unidentified retail compiler revision. */
import type { RandomState } from "../../contracts/numeric.ts";

export type Q2RereleaseRandomState = Extract<RandomState, { readonly kind: "q2-rerelease-mt19937" }>;

export interface Q2RereleaseRandomSource {
  nextUint32(): number;
  float(): number;
  float(maxExclusive: number): number;
  float(minInclusive: number, maxExclusive: number): number;
  integer(): number;
  integer(maxExclusive: number): number;
  integer(minInclusive: number, maxExclusive: number): number;
  timeMilliseconds(minInclusive: number, maxInclusive: number): number;
}

const WORDS = 624;
const UINT32_RANGE = 0x100000000;

/** One instance belongs to the source session; monsters never create their own stream. */
export class Q2RereleaseRandom implements Q2RereleaseRandomSource {
  private words = new Uint32Array(WORDS);
  private index = WORDS;
  private draws = 0;

  constructor(seed = 5489) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) throw new RangeError("MT19937 seed must be uint32");
    this.words[0] = seed;
    for (let i = 1; i < WORDS; i++) {
      const previous = this.word(i - 1);
      this.words[i] = (Math.imul(1812433253, previous ^ previous >>> 30) + i) >>> 0;
    }
  }

  private word(index: number): number {
    const value = this.words[index];
    if (value === undefined) throw new RangeError("MT19937 state index out of range");
    return value;
  }

  nextUint32(): number {
    if (this.index === WORDS) {
      for (let i = 0; i < WORDS; i++) {
        const joined = (this.word(i) & 0x80000000) | (this.word((i + 1) % WORDS) & 0x7fffffff);
        this.words[i] = this.word((i + 397) % WORDS) ^ joined >>> 1 ^ ((joined & 1) === 0 ? 0 : 0x9908b0df);
      }
      this.index = 0;
    }
    let value = this.word(this.index++);
    value ^= value >>> 11;
    value ^= value << 7 & 0x9d2c5680;
    value ^= value << 15 & 0xefc60000;
    value ^= value >>> 18;
    this.draws++;
    return value >>> 0;
  }

  float(): number;
  float(maxExclusive: number): number;
  float(minInclusive: number, maxExclusive: number): number;
  float(first = 1, second?: number): number {
    const minimum = Math.fround(second === undefined ? 0 : first);
    const maximum = Math.fround(second === undefined ? first : second);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) throw new RangeError("Invalid rerelease float range");
    // This STL revision converts the entire MT word to float before division.
    // Its rounding can produce 1; masking low bits or clamping would change source behavior.
    const unit = Math.fround(Math.fround(this.nextUint32()) / UINT32_RANGE);
    return Math.fround(Math.fround(unit * Math.fround(maximum - minimum)) + minimum);
  }

  integer(): number;
  integer(maxExclusive: number): number;
  integer(minInclusive: number, maxExclusive: number): number;
  integer(first?: number, second?: number): number {
    if (first === undefined) return this.nextUint32();
    const minimum = second === undefined ? 0 : first;
    const maximum = second === undefined ? first : second;
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < -0x80000000 || maximum > 0x7fffffff) throw new RangeError("Invalid rerelease int32 range");
    if (second === undefined && maximum <= 0) return 0;
    if (minimum >= maximum) throw new RangeError("Empty rerelease int32 range");
    if (minimum === maximum - 1) return minimum;
    return Number(BigInt(minimum) + this.offset(BigInt(maximum) - BigInt(minimum)));
  }

  /** uniform_int_distribution<int64_t>: both bounds inclusive, including equal bounds. */
  integer64(minimum: bigint, maximum: bigint): bigint {
    if (minimum < -(1n << 63n) || maximum >= 1n << 63n || minimum > maximum) throw new RangeError("Invalid rerelease int64 range");
    return minimum + this.offset(maximum - minimum + 1n);
  }

  timeMilliseconds(minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) throw new RangeError("Rerelease millisecond bounds must be safe integers");
    return Number(this.integer64(BigInt(minimum), BigInt(maximum)));
  }

  private offset(range: bigint): bigint {
    // _Rng_from_urng_v2 gathers only as many whole engine words as the range needs,
    // even for int64_t. Lemire rejection uses the low product before its high result.
    const bits = range > 1n << 32n ? 64n : 32n;
    const modulus = 1n << bits;
    const mask = modulus - 1n;
    const threshold = (modulus - range) % range;
    for (;;) {
      let sample = BigInt(this.nextUint32());
      if (bits === 64n) sample = sample << 32n | BigInt(this.nextUint32());
      const product = sample * range;
      if ((product & mask) >= threshold) return product >> bits;
    }
  }

  checkpoint(): Q2RereleaseRandomState {
    return { kind: "q2-rerelease-mt19937", distribution: "msvc-2022-17.6", words: Array.from(this.words), index: this.index, draws: this.draws };
  }

  capture(): Q2RereleaseRandomState { return this.checkpoint(); }

  restore(state: Q2RereleaseRandomState): undefined {
    if (state.distribution !== "msvc-2022-17.6" || state.words.length !== WORDS
      || !state.words.every(value => Number.isInteger(value) && value >= 0 && value < UINT32_RANGE)
      || !Number.isInteger(state.index) || state.index < 0 || state.index > WORDS
      || !Number.isSafeInteger(state.draws) || state.draws < 0) throw new RangeError("Invalid rerelease MT19937 checkpoint");
    this.words = Uint32Array.from(state.words);
    this.index = state.index;
    this.draws = state.draws;
  }
}
