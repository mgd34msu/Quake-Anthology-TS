import type { ModCallbackValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import { readVector } from "../../persistence/shared.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readModSourceValue(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "string", "vector")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "damage-flags", "regular-protection-scale", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move", "pickup-count", "pickup-has-count", "pickup-dropped") };
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "string": return { kind: "string", value: reader.field("value").string() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
  }
}
export function readModSourceCall(reader: SaveReader): ModSourceCall {
  return { function: reader.field("function").string(), arguments: reader.field("arguments").list(readModSourceValue),
    globals: reader.field("globals").list(entry => ({ name: entry.field("name").string(), value: readModSourceValue(entry.field("value")) })) };
}

