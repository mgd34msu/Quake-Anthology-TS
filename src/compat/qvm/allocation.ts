/** An engine arena can account for QVM storage without owning VM execution. */
export interface QvmAllocation {
  /** Reading bytes must reject a released allocation. */
  readonly bytes: Uint8Array;
}
export type QvmAllocationProfile =
  | { readonly kind: "unaccounted" }
  | { readonly kind: "accounted"; readonly allocate: (request: { readonly purpose: string; readonly resource: string; readonly byteLength: number }) => QvmAllocation };
