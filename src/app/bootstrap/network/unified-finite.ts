function plain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** True when a plain record or array holds NaN or an infinity; class instances and typed arrays are not searched. */
export function hasNonFinite(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value !== 'object' || value === null || depth > 32) return false;
  if (Array.isArray(value)) return value.some(item => hasNonFinite(item, depth + 1));
  if (!plain(value)) return false;
  return Object.values(value).some(item => hasNonFinite(item, depth + 1));
}

/** Copies only the paths that hold non-finite numbers, replacing each with zero. */
export function zeroNonFinite<T>(value: T, depth?: number): T;
export function zeroNonFinite(value: unknown, depth = 0): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'object' || value === null || depth > 32 || !hasNonFinite(value, depth)) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => zeroNonFinite(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, zeroNonFinite(item, depth + 1)]));
}
