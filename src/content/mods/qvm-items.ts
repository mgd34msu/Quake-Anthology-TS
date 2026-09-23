import type { QvmItemCapacity, QvmItemField, QvmItemTest, QvmModItems, QvmWeaponActor } from "../../contracts/qvm-mod-items.ts";
import type { QvmModInputPointer, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import { namespaced, type SaveReader } from "../../persistence/value.ts";

function field(reader: SaveReader): QvmItemField {
  return { record: reader.field("record").string(), offset: reader.field("offset").integer(0) };
}
function test(reader: SaveReader): QvmItemTest {
  return { field: field(reader.field("field")), mask: reader.field("mask").nullable(value => value.integer(0)),
    comparison: reader.field("comparison").choice("equals", "at-most"), value: reader.field("value").integer() };
}
function pointer(reader: SaveReader): QvmModInputPointer {
  const kind = reader.field("kind").choice("argument", "global");
  const path = { indirections: reader.field("indirections").list(value => value.integer(0)), offset: reader.field("offset").integer(0) };
  return kind === "argument" ? { ...path, kind, index: reader.field("index").integer(0) } : { ...path, kind, address: reader.field("address").integer(0) };
}
function actor(reader: SaveReader): QvmWeaponActor {
  return { record: reader.field("record").string(), pointer: pointer(reader.field("pointer")) };
}
function capacity(reader: SaveReader): QvmItemCapacity {
  const kind = reader.field("kind").choice("constant", "field", "source");
  if (kind === "constant") return { kind, value: reader.field("value").integer(0) };
  if (kind === "field") return { kind, field: field(reader.field("field")) };
  return { kind, instruction: reader.field("instruction").integer(0), overrides: reader.field("overrides").list(value => ({
    address: value.field("address").integer(0), comparison: value.field("comparison").choice("equals", "not-equals"),
    value: value.field("value").integer(), instruction: value.field("instruction").integer(0),
  })) };
}
export function readQvmModItems(reader: SaveReader, readCall: (reader: SaveReader) => QvmModSourceCall): QvmModItems {
  const weapons = reader.field("weapons");
  return { definitions: reader.field("definitions").list(value => {
    const common = { item: namespaced(value.field("item")), label: value.field("label").string(), admission: value.field("admission").choice("add", "replace-primary") };
    return value.field("kind").choice("counter", "weapon") === "counter" ? { ...common, kind: "counter" }
      : { ...common, kind: "weapon", ammo: value.field("ammo").nullable(namespaced) };
  }), storage: reader.field("storage").list(value => {
    const source = field(value.field("field"));
    return value.field("kind").choice("counter", "bits") === "counter"
      ? { kind: "counter", field: source, item: namespaced(value.field("item")), capacity: capacity(value.field("capacity")) }
      : { kind: "bits", field: source, privateMask: value.field("privateMask").integer(0),
        items: value.field("items").list(entry => ({ item: namespaced(entry.field("item")), mask: entry.field("mask").integer(1) })) };
  }), ...(weapons.value === undefined ? {} : { weapons: { input: { entry: weapons.field("input").field("entry").integer(0), clock: field(weapons.field("input").field("clock")) }, stage: {
    dispatcher: { entry: weapons.field("stage").field("dispatcher").field("entry").integer(0), actor: actor(weapons.field("stage").field("dispatcher").field("actor")) },
    predicates: weapons.field("stage").field("predicates").list(value => ({ instruction: value.field("instruction").integer(0), unselected: value.field("unselected").boolean() })),
    settled: weapons.field("stage").field("settled").list(test),
    selection: { field: field(weapons.field("stage").field("selection").field("field")),
      values: weapons.field("stage").field("selection").field("values").list(value => ({ value: value.field("value").integer(), item: namespaced(value.field("item")) })) },
    request: { entry: weapons.field("stage").field("request").field("entry").integer(0), argument: weapons.field("stage").field("request").field("argument").integer(0),
      accepted: weapons.field("stage").field("request").field("accepted").list(test) },
    continuation: { entry: weapons.field("stage").field("continuation").field("entry").integer(0),
      actor: actor(weapons.field("stage").field("continuation").field("actor")),
      instruction: weapons.field("stage").field("continuation").field("instruction").integer(0),
      originalTaken: weapons.field("stage").field("continuation").field("originalTaken").boolean(),
      when: weapons.field("stage").field("continuation").field("when").list(test),
      predicates: weapons.field("stage").field("continuation").field("predicates").list(value => ({ instruction: value.field("instruction").integer(0), unselected: value.field("unselected").boolean() })),
      projection: { movement: pointer(weapons.field("stage").field("continuation").field("projection").field("movement")),
        byteLength: weapons.field("stage").field("continuation").field("projection").field("byteLength").integer(1),
        minimum: weapons.field("stage").field("continuation").field("projection").field("minimum").integer(0), maximum: weapons.field("stage").field("continuation").field("projection").field("maximum").integer(0),
        viewHeight: field(weapons.field("stage").field("continuation").field("projection").field("viewHeight")), ground: field(weapons.field("stage").field("continuation").field("projection").field("ground")) },
      calls: weapons.field("stage").field("continuation").field("calls").list(value => ({ instruction: value.field("instruction").integer(0), call: readCall(value.field("call")) })) },
  } } }) };
}
