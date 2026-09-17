import { BinaryError, BinaryReader } from "../core/binary/index.ts";

/** Container ownership does not determine a map's stored codec. */
export function classifyBsp(data: Uint8Array, source = "<bsp>"): "q1" | "q2" | "q3" {
  const reader = new BinaryReader(data, source), magic = reader.u32();
  if (magic === 29 || magic === 0x32505342 || magic === 0x42535032 || magic === 0x51363420) return "q1";
  if (magic === 0x50534249 || magic === 0x50534251) {
    const version = reader.u32();
    if (version === 38) return "q2";
    if (magic === 0x50534249 && (version === 44 || version === 46)) return "q3";
    throw new BinaryError(source, 4, `unsupported BSP version ${version}`);
  }
  throw new BinaryError(source, 0, `unsupported BSP identifier ${magic}`);
}
