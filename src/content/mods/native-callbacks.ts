import type { ModCallbackBinding, ModCallbackValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModActorField, NativeModAddress, NativeModEntry, NativeModDeclaration, NativeModSourceCall, NativeModValue, NativeModSourceActors } from "../../contracts/native-mod-callbacks.ts";
import { readDigest, readVector } from "../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";

function value(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "vector", "string")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result") };
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
    case "string": return { kind: "string", value: reader.field("value").string() };
  }
}
function address(reader: SaveReader): NativeModAddress { return { rva: reader.field("rva").integer(0), indirections: reader.field("indirections").list(value => value.integer(0)) }; }
function entry(reader: SaveReader): NativeModEntry { return reader.field("kind").choice("export", "rva") === "export"
  ? { kind: "export", name: reader.field("name").string() } : { kind: "rva", rva: reader.field("rva").integer(0) }; }
function argument(reader: SaveReader): NativeModValue {
  const kind = reader.field("kind").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "vector", "string", "actor", "time", "address");
  switch (kind) {
    case "actor": return { kind, record: reader.field("record").string(), input: reader.field("input").choice("self", "other", "activator", "attacker", "inflictor") };
    case "time": return { kind, input: reader.field("input").choice("time", "elapsed"), units: reader.field("units").choice("seconds", "milliseconds"), encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") };
    case "address": return { kind, value: reader.field("value").nullable(address) };
    default: return { kind, value: value(reader.field("value")) };
  }
}
function sourceCall(reader: SaveReader): NativeModSourceCall {
  return { entry: entry(reader.field("entry")), arguments: reader.field("arguments").list(argument),
    globals: reader.field("globals").list(global => ({ address: address(global.field("address")), value: argument(global.field("value")) })),
    returns: reader.field("returns").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "void") };
}
function binding(reader: SaveReader): ModCallbackBinding {
  const id = namespaced(reader.field("id")), operation = reader.field("operation").choice("damage", "inventory.give", "inventory.consume", "actor.think", "actor.touch", "actor.use", "actor.pain", "actor.die");
  switch (reader.field("stage").choice("observe", "transform", "replace")) {
    case "observe": return { id, operation, stage: "observe" };
    case "transform":
      if (operation === "damage") return { id, operation, stage: "transform", result: reader.field("result").choice("amount", "knockback") };
      if (operation === "inventory.give" || operation === "inventory.consume") return { id, operation, stage: "transform", result: reader.field("result").literal("amount") };
      return reader.fail("actor callbacks support observation or replacement");
    case "replace":
      if (operation === "damage" || operation === "inventory.give" || operation === "inventory.consume") return reader.fail("only actor callbacks support replacement");
      return { id, operation, stage: "replace", result: reader.field("result").literal("boolean") };
  }
}
function field(reader: SaveReader): NativeModActorField {
  const offset = reader.field("offset").integer(0), binding = reader.field("binding").choice("health", "inventory", "origin", "velocity", "angles", "bounds-min", "bounds-max", "record", "constant", "constant-vector", "private", "address");
  switch (binding) {
    case "address": return { offset, binding, value: reader.field("value").nullable(address) };
    case "health": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") };
    case "inventory": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"), item: namespaced(reader.field("item")) };
    case "record": return { offset, binding, record: reader.field("record").string() };
    case "constant": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"), value: reader.field("value").number() };
    case "constant-vector": return { offset, binding, value: readVector(reader.field("value")) };
    case "private": return { offset, binding, byteLength: reader.field("byteLength").integer(1) };
    default: return { offset, binding };
  }
}
function sourceActors(reader: SaveReader): NativeModSourceActors {
  const fields = reader.field("fields"), nextthink = fields.field("nextthink"), update = reader.field("update");
  const encoding = (reader: SaveReader) => reader.choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64");
  return { allocate: entry(reader.field("allocate")), release: entry(reader.field("release")),
    update: { entry: entry(update.field("entry")), returns: update.field("returns").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "void") },
    frameSeconds: reader.field("frameSeconds").number(),
    clock: reader.field("clock").list(value => ({ address: address(value.field("address")), input: value.field("input").choice("time", "frame"), encoding: encoding(value.field("encoding")), units: value.field("units").choice("seconds", "milliseconds") })),
    fields: { velocity: fields.field("velocity").integer(0), ground: fields.field("ground").integer(0), use: fields.field("use").nullable(value => value.integer(0)),
      think: fields.field("think").integer(0), nextthink: { offset: nextthink.field("offset").integer(0), encoding: encoding(nextthink.field("encoding")), units: nextthink.field("units").choice("seconds", "milliseconds") } } };
}
export function readNativeModCallbacks(bytes: Uint8Array): NativeModDeclaration {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return readNativeModDeclaration(new SaveReader(value));
}
export function readNativeModDeclaration(reader: SaveReader): NativeModDeclaration {
  const program = reader.field("program"), target = reader.field("target"), api = target.field("api"), abi = target.field("abi");
  const targetKind = api.field("kind").choice("q2-classic-game", "q2-rerelease-game");
  const parsedTarget: NativeModDeclaration["target"] = targetKind === "q2-classic-game"
    ? { api: { kind: targetKind, version: api.field("version").literal(3) }, abi: { kind: abi.field("kind").literal("windows-i386"), image: abi.field("image").literal("pe32"), pointerBytes: abi.field("pointerBytes").literal(4), call: abi.field("call").literal("cdecl") } }
    : { api: { kind: targetKind, version: api.field("version").literal(2023) }, abi: { kind: abi.field("kind").literal("windows-x86-64"), image: abi.field("image").literal("pe32+"), pointerBytes: abi.field("pointerBytes").literal(8), call: abi.field("call").literal("microsoft-x64") } };
  return { version: reader.field("version").literal(1), runtime: reader.field("runtime").literal("native"),
    program: { path: normalizeResourcePath(program.field("path").string()), digest: readDigest(program.field("digest")) }, target: parsedTarget,
    ...(reader.field("sourceActors").value === undefined ? {} : { sourceActors: sourceActors(reader.field("sourceActors")) }),
    cvars: reader.field("cvars").list(value => ({ name: value.field("name").string(), value: value.field("value").string() })),
    spawnEntities: reader.field("spawnEntities").nullable(value => value.string()), entityRecord: reader.field("entityRecord").nullable(value => value.string()),
    actorRecords: reader.field("actorRecords").list(record => ({ id: record.field("id").string(),
      base: record.field("base").field("kind").choice("entities", "address") === "entities" ? { kind: "entities" } : { kind: "address", ...address(record.field("base")) },
      stride: record.field("stride").integer(4), firstSlot: record.field("firstSlot").integer(0), capacity: record.field("capacity").integer(1), fields: record.field("fields").list(field) })),
    initialize: reader.field("initialize").list(sourceCall), project: reader.field("project").list(sourceCall), release: reader.field("release").list(sourceCall),
    callbacks: reader.field("callbacks").list(reader => ({ ...binding(reader), ...sourceCall(reader) })) };
}
