import { buildGammaTable } from "../formats/images/palette.ts";

/** Display gamma uses the Q3 convention: values above one brighten output. */
export function outputGammaTable(gamma: number): Uint8Array | null {
  if (!Number.isFinite(gamma) || gamma < 0.5 || gamma > 3) throw new RangeError("Output gamma must be between 0.5 and 3");
  return gamma === 1 ? null : buildGammaTable({ kind: "q3", gamma, intensity: 1, overbrightBits: 0, onlyGamma: true });
}
