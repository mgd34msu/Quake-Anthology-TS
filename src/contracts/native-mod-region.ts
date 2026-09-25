import type { NativeModScalar, NativeModSourceCall, NativeModValue } from "./native-mod-callbacks.ts";

export type NativeModRegionRegister = "rax" | "rcx" | "rdx" | "rbx" | "rbp" | "rsi" | "rdi"
  | "r8" | "r9" | "r10" | "r11" | "r12" | "r13" | "r14" | "r15";
export type NativeModRegionStorage = NativeModScalar | "pointer";
export type NativeModRegionLocation =
  | { readonly kind: "register"; readonly register: NativeModRegionRegister; readonly storage: NativeModRegionStorage }
  | { readonly kind: "simd"; readonly index: number; readonly offset: number; readonly storage: NativeModScalar }
  | { readonly kind: "stack"; readonly offset: number; readonly storage: NativeModRegionStorage };
/** Boundaries and live machine inputs belong to the declaration's exact module digest. */
export interface NativeModProtectionRegion {
  readonly abi: "source-region";
  readonly call: NativeModSourceCall;
  readonly frame: { readonly entry: number; readonly exit: number; readonly stackBytes: number; readonly argumentBytes: number };
  readonly entry: number;
  readonly join: number;
  readonly inputs: readonly { readonly target: NativeModRegionLocation; readonly value: NativeModValue }[];
  readonly result: NativeModRegionLocation;
}
