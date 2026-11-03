/** Preserves the literal and tuple types of a fixture table without a type assertion. */
export function literal<const T>(value: T): T {
  return value;
}
