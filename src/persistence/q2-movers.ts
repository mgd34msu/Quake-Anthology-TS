import type { Q2MoversCheckpoint } from "../content/q2/foundation/movers.ts";
import type { Q2LinearMotionCheckpoint } from "../content/q2/foundation/motion.ts";
import type { Q2AngularMotionCheckpoint } from "../content/q2/foundation/angular-motion.ts";
import { readSavedActor } from "./save-image.ts";
import { readVector } from "./shared.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

export function readQ2LinearMotionCheckpoint(reader: SaveReader): Q2LinearMotionCheckpoint {
  return reader.list(value => { const state = value.field("state"), n = (key: string): number => state.field(key).number(); return { actor: readSavedActor(value.field("actor")), state: {
    direction: readVector(state.field("direction")), destination: readVector(state.field("destination")), reference: readVector(state.field("reference")), remaining: n("remaining"), currentSpeed: n("currentSpeed"), moveSpeed: n("moveSpeed"), nextSpeed: n("nextSpeed"), decelDistance: n("decelDistance"), done: state.field("done").string(),
    curve: state.field("curve").nullable(curve => ({ positions: curve.field("positions").list(position => position.number()), frame: curve.field("frame").number(), subframe: curve.field("subframe").number(), subframes: curve.field("subframes").number() })) } }; });
}
export function readQ2AngularMotionCheckpoint(reader: SaveReader): Q2AngularMotionCheckpoint {
  return reader.list(value => ({ actor: readSavedActor(value.field("actor")), destination: readVector(value.field("destination")), speed: value.field("speed").number(), done: value.field("done").string() }));
}
export function readQ2MoversCheckpoint(reader: SaveReader): Q2MoversCheckpoint {
  return { doors: reader.field("doors").list(value => { const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), master: readSavedActor(value.field("master")), team: value.field("team").list(readSavedActor), state: {
    start: readVector(state.field("start")), end: readVector(state.field("end")), distance: state.field("distance").number(), button: state.field("button").boolean(), angular: state.field("angular").boolean(), water: state.field("water").boolean(), safeDirection: readVector(state.field("safeDirection")), waterDivisor: state.field("waterDivisor").number(), reversed: state.field("reversed").boolean(), activated: state.field("activated").boolean(), phase: state.field("phase").choice("bottom", "up", "top", "down"), debounce: state.field("debounce").number() } }; }),
    trains: reader.field("trains").list(value => ({ actor: readSavedActor(value.field("actor")), destination: value.field("destination").nullable(readSavedActor), debounce: value.field("debounce").number(), ship: value.field("ship").boolean() })), linear: readQ2LinearMotionCheckpoint(reader.field("linear")), angular: readQ2AngularMotionCheckpoint(reader.field("angular")) };
}
export function encodeQ2MoversCheckpoint(checkpoint: Q2MoversCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2MoversCheckpoint(bytes: Uint8Array): Q2MoversCheckpoint { return readQ2MoversCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-movers")); }
