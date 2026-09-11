import type { Q2ItemsCheckpoint } from "../content/q2/foundation/items.ts";
import { readSavedActor } from "./save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

export function readQ2ItemsCheckpoint(reader: SaveReader): Q2ItemsCheckpoint {
  return { powerCubeCount: reader.field("powerCubeCount").number(), pickups: reader.field("pickups").list(value => ({ actor: readSavedActor(value.field("actor")), classname: value.field("classname").string(), targetsUsed: value.field("targetsUsed").boolean(), retained: value.field("retained").boolean(), expiresAt: value.field("expiresAt").nullable(expiry => expiry.number()) })),
    powers: reader.field("powers").list(value => { const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: { quadUntil: state.field("quadUntil").number(), invulnerabilityUntil: state.field("invulnerabilityUntil").number(), breatherUntil: state.field("breatherUntil").number(), enviroUntil: state.field("enviroUntil").number() } }; }), powerArmorBindings: reader.field("powerArmorBindings").list(readSavedActor) };
}
export function encodeQ2ItemsCheckpoint(checkpoint: Q2ItemsCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2ItemsCheckpoint(bytes: Uint8Array): Q2ItemsCheckpoint { return readQ2ItemsCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-items")); }
