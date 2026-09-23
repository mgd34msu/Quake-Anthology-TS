import type { ModClientInputBinding } from "../../contracts/mod-callbacks.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readModClientInput<Call, Output = never>(reader: SaveReader, readCall: (reader: SaveReader) => Call,
  readOutput?: (reader: SaveReader) => Output): readonly ModClientInputBinding<Call, Output>[] {
  return reader.list(entry => {
    const scope = entry.field("scope").choice("client-command", "movement-slice"), phase = entry.field("phase").choice("before", "after"), calls = entry.field("calls").list(readCall);
    if (entry.field("outputs").value === undefined) return { scope, phase, calls };
    if (phase !== "before" || readOutput === undefined) throw new Error("Input outputs require a declared before source adapter");
    return { scope, phase, calls, outputs: entry.field("outputs").list(readOutput) };
  });
}
