import type { QvmModSourceCall } from "./qvm-mod-callbacks.ts";

/** Original frame loops retain their locals, clocks, expiry, and entity dispatch. */
export interface QvmModActorFrame {
  readonly call: QvmModSourceCall;
  readonly clock: { readonly address: number; readonly store: number; readonly argument: number };
  readonly owned: readonly { readonly instruction: number; readonly localInstruction: number }[];
  /** Completing the declared entity loop returns from this invocation before later world phases. */
  readonly end: { readonly instruction: number; readonly completedTaken: boolean };
}
