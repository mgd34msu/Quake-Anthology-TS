// SPDX-License-Identifier: GPL-2.0-or-later
// Virtual CPU feature enumeration, independent of the machine running Bun.
// CPUID register/feature encoding: Intel SDM Vol. 2A; Microsoft __cpuid docs.

export interface CpuidResult { readonly eax: bigint; readonly ebx: bigint; readonly ecx: bigint; readonly edx: bigint }

/** `compareExchange8` advertises CMPXCHG8B only for CPUs that implement it. */
export function virtualCpuid(leaf: bigint, compareExchange8: boolean): CpuidResult {
  let eax = 0n, ebx = 0n, ecx = 0n, edx = 0n;
  if (leaf === 0n) {
    eax = 7n;
    // EBX, EDX, ECX spell "QuakeTSguest".
    ebx = 0x6b617551n; edx = 0x67535465n; ecx = 0x74736575n;
  } else if (leaf === 1n) {
    eax = 0x600n; ebx = 0x10000n;
    // x87, CMOV, SSE, SSE2, and CMPXCHG8B where implemented. No AVX, XSAVE, RDRAND or TSC.
    edx = compareExchange8 ? 0x06008101n : 0x06008001n;
  } else if (leaf === 0x80000000n) eax = 0x80000001n;
  else if (leaf === 0x80000001n) { ecx = 1n; edx = 0x20000000n; }
  return { eax, ebx, ecx, edx };
}
