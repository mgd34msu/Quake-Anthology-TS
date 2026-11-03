import type { QvmAbiProfile } from "../../contracts/execution.ts";

/** Reliable source commands carry canonical configstring indices into the client ABI; null means the command has no legacy mapping and is dropped. */
export function legacyClientCommand(argv: readonly string[], profile: QvmAbiProfile): readonly string[] | null {
  if (profile === "q3-modern" || argv[0] !== "cs") return argv;
  const index = Number(argv[1]);
  if (!Number.isInteger(index)) return null;
  if (index >= 20 && index <= 23) return ["cs", String(index - 8), ...argv.slice(2)];
  if (index >= 12 && index <= 26) return null;
  return argv;
}
