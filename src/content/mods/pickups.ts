import type { ModPickupRule, OriginalPickupOperation, PickupWrite, PickupWrites } from "../../contracts/original-pickups.ts";
import { namespaced, type SaveReader } from "../../persistence/value.ts";

export function readModPickupRule<Call>(reader: SaveReader, readCall: (reader: SaveReader) => Call): ModPickupRule<Call> {
  const id = reader.field("id").string(), offered = reader.field("offered").list(namespaced), resource = reader.field("resource"), operation = reader.field("operation");
  if (id.length === 0 || offered.length === 0 || new Set(offered).size !== offered.length) return reader.fail("Pickup rule requires an id and distinct offered items");
  const write = (value: SaveReader, legacy: boolean): PickupWrite => value.field("kind").choice("protection", "inventory") === "protection"
    ? { kind: "protection", channel: value.field("channel").choice("regular", "powered") }
    : { kind: "inventory", item: namespaced(value.field("item")), fields: legacy ? "count" : value.field("fields").choice("count", "capacity", "count-and-capacity") };
  if (resource.value !== undefined && reader.field("writes").value !== undefined) return reader.fail("Pickup rule has both resource and writes");
  const [first, ...rest] = reader.field("writes").value === undefined ? [write(resource, true)] : reader.field("writes").list(value => write(value, false));
  if (first === undefined) return reader.fail("Pickup rule requires a nonempty write set");
  const writes: PickupWrites = [first, ...rest], keys = writes.map(value => value.kind === "protection" ? `protection:${value.channel}` : `inventory:${value.item}`);
  if (new Set(keys).size !== keys.length) return reader.fail("Pickup rule has duplicate resource writes");
  const grant = readCall(operation.field("grant"));
  const call: OriginalPickupOperation<Call> = operation.field("kind").choice("boolean-grant", "gate-then-grant") === "boolean-grant"
    ? { kind: "boolean-grant", grant }
    : { kind: "gate-then-grant", gate: readCall(operation.field("gate")), grant, grantAccepts: operation.field("grantAccepts").choice("nonzero", "always") };
  return { id, offered, writes, operation: call };
}
