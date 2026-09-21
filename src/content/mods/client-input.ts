import type { ModClientInputBinding } from "../../contracts/mod-callbacks.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readModClientInput<Call>(reader: SaveReader, readCall: (reader: SaveReader) => Call): readonly ModClientInputBinding<Call>[] {
  return reader.list(entry => ({ scope: entry.field("scope").choice("client-command", "movement-slice"),
    phase: entry.field("phase").choice("before", "after"), calls: entry.field("calls").list(readCall) }));
}
