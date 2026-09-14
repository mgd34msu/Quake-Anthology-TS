import { SaveReader } from "../../persistence/value.ts";
import { EntityStateT, vec3, type Vec3 } from "./wire-types.ts";
import { QwEntityStateT } from "./qw-constants.ts";

function vector(reader: SaveReader): Vec3 {
  const values = reader.list(item => item.number());
  const [x, y, z] = values;
  if (values.length !== 3 || x === undefined || y === undefined || z === undefined) reader.fail("expected a three component vector");
  const result = vec3(); result[0] = x; result[1] = y; result[2] = z; return result;
}
export function captureWireEntity(state: EntityStateT | QwEntityStateT) {
  return { origin: [state.origin[0], state.origin[1], state.origin[2]], angles: [state.angles[0], state.angles[1], state.angles[2]], modelindex: state.modelindex, frame: state.frame,
    colormap: state.colormap, skin: "skinnum" in state ? state.skinnum : state.skin, alpha: state.alpha, scale: state.scale, effects: state.effects };
}
function restoreFields(state: EntityStateT | QwEntityStateT, reader: SaveReader): void {
  state.origin = vector(reader.field("origin")); state.angles = vector(reader.field("angles"));
  state.modelindex = reader.field("modelindex").integer(0); state.frame = reader.field("frame").integer(0);
  state.colormap = reader.field("colormap").integer(0); state.alpha = reader.field("alpha").integer(0);
  state.scale = reader.field("scale").integer(0); state.effects = reader.field("effects").integer();
  if ("skinnum" in state) state.skinnum = reader.field("skin").integer(); else state.skin = reader.field("skin").integer();
}
export function readNqWireEntity(reader: SaveReader): EntityStateT { const state = new EntityStateT(); restoreFields(state, reader); return state; }
export function captureQwWireEntity(state: QwEntityStateT) { return { ...captureWireEntity(state), number: state.number, flags: state.flags }; }
export function readQwWireEntity(reader: SaveReader): QwEntityStateT {
  const state = new QwEntityStateT(); restoreFields(state, reader);
  state.number = reader.field("number").integer(0); state.flags = reader.field("flags").integer(); return state;
}
