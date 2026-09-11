/** Arithmetic selection belongs to the executable recipe, independently of wire format. */
export type ArithmeticProfile =
  | { readonly kind: "binary32"; readonly round: "each-operation" }
  | { readonly kind: "donor-binary64"; readonly source: "q1-ts" | "q2-ts" }
  | { readonly kind: "x87"; readonly precisionBits: 24 | 53 | 64; readonly rounding: FloatingRounding }
  | { readonly kind: "sse"; readonly flushToZero: boolean; readonly denormalsAreZero: boolean; readonly rounding: FloatingRounding };

export type FloatingRounding = "nearest-even" | "toward-zero" | "toward-positive" | "toward-negative";
export type FloatToIntProfile = "qvm-indefinite" | "x86-indefinite" | "checked-c-truncation";
export type NumericProfileId = `${string}:${string}`;

export interface NumericProfile {
  readonly id: NumericProfileId;
  readonly arithmetic: ArithmeticProfile;
  readonly scalarStorage: "binary32";
  readonly floatToInt: FloatToIntProfile;
  readonly integerOverflow: "wrap32";
}

/** Implementations preserve the selected operations. Unsupported guest profiles fail selection. */
export interface NumericOperations {
  readonly profile: NumericProfile;
  store(value: number): number;
  add(left: number, right: number): number;
  subtract(left: number, right: number): number;
  multiply(left: number, right: number): number;
  divide(left: number, right: number): number;
  squareRoot(value: number): number;
  toInt32(value: number): number;
  wrapInt32(value: number): number;
  wrapUint32(value: number): number;
}

export interface RandomStep { readonly seed: number; readonly value: number; }
export type RandomState =
  | { readonly kind: "q3-lcg"; readonly seed: number; readonly draws: number }
  | { readonly kind: "msvcrt-rand"; readonly seed: number; readonly draws: number }
  | { readonly kind: "glibc-random"; readonly words: readonly number[]; readonly front: number; readonly rear: number; readonly draws: number }
  | { readonly kind: "q2-rerelease-mt19937"; readonly distribution: "msvc-2022-17.6"; readonly words: readonly number[]; readonly index: number; readonly draws: number }
  | { readonly kind: "guest"; readonly module: string; readonly bytes: Uint8Array; readonly draws: number };

export interface RandomSource {
  nextInteger(): number;
  nextUnit(): number;
  checkpoint(): RandomState;
}
