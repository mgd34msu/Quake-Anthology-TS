import type { SourceItemActionCalls } from "../../contracts/source-items.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readItemActions<Call>(reader: SaveReader, readCall: (value: SaveReader) => Call): SourceItemActionCalls<Call> {
  const use = reader.field("use"), drop = reader.field("drop");
  if (use.value === undefined && drop.value === undefined) return reader.fail("Item actions require an original use or drop call");
  return { ...(use.value === undefined ? {} : { use: readCall(use) }), ...(drop.value === undefined ? {} : { drop: readCall(drop) }) };
}
