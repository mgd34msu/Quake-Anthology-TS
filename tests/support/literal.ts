// SPDX-License-Identifier: GPL-2.0-or-later
/** Preserves the literal and tuple types of a fixture table without a type assertion. */
export function literal<const T>(value: T): T {
  return value;
}
