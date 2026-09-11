import type { Q2BaseEntitiesCheckpoint } from "../content/q2/base/entities/index.ts";
import { readSavedActor } from "./save-image.ts";
import { readVector } from "./shared.ts";
import { readQ2LinearMotionCheckpoint } from "./q2-movers.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

export function readQ2BaseEntitiesCheckpoint(reader: SaveReader): Q2BaseEntitiesCheckpoint {
  const movers = reader.field("movers"), scenery = reader.field("scenery"), turrets = reader.field("turrets");
  return { version: reader.field("version").literal(1), movers: {
    platforms: movers.field("platforms").list(value => {
      const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: {
        top: readVector(state.field("top")), bottom: readVector(state.field("bottom")), phase: state.field("phase").choice("top", "bottom", "up", "down") } };
    }),
    secrets: movers.field("secrets").list(value => {
      const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: {
        first: readVector(state.field("first")), second: readVector(state.field("second")), home: readVector(state.field("home")),
        shootable: state.field("shootable").boolean(), blockedTime: state.field("blockedTime").number(), messageTime: state.field("messageTime").number() } };
    }), linear: readQ2LinearMotionCheckpoint(movers.field("linear")),
  }, scenery: {
    animations: scenery.field("animations").list(value => ({ actor: readSavedActor(value.field("actor")), first: value.field("first").integer(0), end: value.field("end").integer(1) })),
    clocks: scenery.field("clocks").list(value => ({ actor: readSavedActor(value.field("actor")), value: value.field("value").number() })),
  }, turrets: {
    breaches: turrets.field("breaches").list(value => {
      const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: {
        goal: readVector(state.field("goal")), muzzle: readVector(state.field("muzzle")), pitchMax: state.field("pitchMax").number(),
        pitchMin: state.field("pitchMin").number(), yawMin: state.field("yawMin").number(), yawMax: state.field("yawMax").number() } };
    }),
    drivers: turrets.field("drivers").list(value => ({ actor: readSavedActor(value.field("actor")), breach: value.field("breach").nullable(readSavedActor),
      radius: value.field("radius").number(), yawOffset: value.field("yawOffset").number(), height: value.field("height").number(), monsterDie: value.field("monsterDie").string() })),
  }, windTimes: reader.field("windTimes").list(value => ({ actor: readSavedActor(value.field("actor")), until: value.field("until").number() })) };
}

export function encodeQ2BaseEntitiesCheckpoint(checkpoint: Q2BaseEntitiesCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2BaseEntitiesCheckpoint(bytes: Uint8Array): Q2BaseEntitiesCheckpoint {
  return readQ2BaseEntitiesCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-base-entities"));
}
