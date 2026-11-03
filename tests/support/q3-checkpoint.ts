// SPDX-License-Identifier: GPL-2.0-or-later
import type { QvmCheckpoint } from "../../src/contracts/execution.ts";
import type { Q3GuestCheckpoint } from "../../src/app/bootstrap/simulation/q3/engine.ts";

/** An interpreted-module save, for tests that read the QVM image directly. */
export function qvmCheckpoint(checkpoint: Q3GuestCheckpoint): QvmCheckpoint {
  if (checkpoint.kind !== "qvm") throw new Error("Expected an interpreted Q3 guest checkpoint");
  return checkpoint;
}
