import type { QvmAbiProfile } from "../../contracts/execution.ts";

/** Reliable source commands carry canonical configstring indices into the client ABI. */
export function legacyClientCommand(argv: readonly string[], profile: QvmAbiProfile): readonly string[] {
  if (profile === "q3-modern" || argv[0] !== "cs") return argv;
  const index = Number(argv[1]);
  if (!Number.isInteger(index)) throw new Error("Invalid configstring command index");
  if (index >= 20 && index <= 23) return ["cs", String(index - 8), ...argv.slice(2)];
  if (index >= 12 && index <= 26) throw new Error(`Configstring ${index} has no legacy client mapping`);
  return argv;
}
