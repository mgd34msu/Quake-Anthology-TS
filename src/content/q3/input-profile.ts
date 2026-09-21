import type { QvmModuleOptions } from "../../compat/qvm/module.ts";
import type { QvmInputDefinition } from "../../compat/qvm/game-input.ts";
import { LRCTF_GRAPPLE_DIGEST } from "./equipment/lrctf-grapple-profile.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./equipment/threewave-grapple-profile.ts";

/** Original qagame bytecode; all pointers still come from G_LOCATE_GAME_DATA. */
export function q3InputProfile(artifact: QvmModuleOptions["artifact"]): QvmInputDefinition | null {
  switch (artifact.module.digest) {
    case LRCTF_GRAPPLE_DIGEST: return { module: artifact.module, entityStride: 856, clientStride: 872, clientPointer: 516,
      intermission: [5, 6], entries: { clientThink: 114858, runClient: 114917, clientSpawn: 125027, move: 22369, slice: 21620 } };
    case THREEWAVE_GRAPPLE_DIGEST: return { module: artifact.module, entityStride: 876, clientStride: 944, clientPointer: 516,
      intermission: [7, 8], entries: { clientThink: 120292, runClient: 120383, clientSpawn: 132015, move: 35535, slice: 34707 } };
    default: return null;
  }
}
