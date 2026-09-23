import type { ModPickupRule, OriginalPickupOperation, PickupResource } from "../../contracts/original-pickups.ts";
import { namespaced, type SaveReader } from "../../persistence/value.ts";

export function readModPickupRule<Call>(reader: SaveReader, readCall: (reader: SaveReader) => Call): ModPickupRule<Call> {
  const id = reader.field("id").string(), offered = reader.field("offered").list(namespaced), resource = reader.field("resource"), operation = reader.field("operation");
  if (id.length === 0 || offered.length === 0 || new Set(offered).size !== offered.length) return reader.fail("Pickup rule requires an id and distinct offered items");
  const target: PickupResource = resource.field("kind").choice("protection", "inventory") === "protection"
    ? { kind: "protection", channel: resource.field("channel").choice("regular", "powered") }
    : { kind: "inventory", item: namespaced(resource.field("item")) };
  const grant = readCall(operation.field("grant"));
  const call: OriginalPickupOperation<Call> = operation.field("kind").choice("boolean-grant", "gate-then-grant") === "boolean-grant"
    ? { kind: "boolean-grant", grant }
    : { kind: "gate-then-grant", gate: readCall(operation.field("gate")), grant, grantAccepts: operation.field("grantAccepts").choice("nonzero", "always") };
  return { id, offered, resource: target, operation: call };
}
