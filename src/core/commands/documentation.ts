// SPDX-License-Identifier: GPL-2.0-or-later
export interface CommandDocumentation {
  readonly summary: string;
  readonly usage: string;
  readonly examples: readonly string[];
  readonly allowedValues?: readonly string[];
}
