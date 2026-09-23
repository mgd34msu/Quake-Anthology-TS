import type { ModActorField, ModCallback, ModCallbackDeclaration, ModCallbackValue, ModConsoleValue, ModSourceCall, ModQcArmorStage, ModQcProtection, ModQcInputOutput } from "../../contracts/mod-callbacks.ts";
import { readDigest, readVector } from "../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { readModClientInput } from "./client-input.ts";

function value(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "string", "vector")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "damage-flags", "regular-protection-scale", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move") };
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "string": return { kind: "string", value: reader.field("value").string() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
  }
}
function field(reader: SaveReader): ModActorField {
  const name = reader.field("field").string(), binding = reader.field("binding").choice("health", "origin", "velocity", "angles", "bounds-min", "bounds-max", "think", "nextthink", "inventory", "constant", "private", "classname", "client-flags", "view-offset", "userinfo", "client-input");
  if (binding === "client-input") return { field: name, binding, input: reader.field("input").choice("view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"), update: reader.field("update").choice("always", "nonzero"), ...(reader.field("scale").value === undefined ? {} : { scale: reader.field("scale").number() }) };
  if (binding === "client-flags") return { field: name, binding,
    ...(reader.field("grounded").value === undefined ? {} : { grounded: reader.field("grounded").literal(true) }),
    ...(reader.field("privateMask").value === undefined ? {} : { privateMask: reader.field("privateMask").integer(0) }) };
  if (binding === "userinfo") return { field: name, binding, key: reader.field("key").string() };
  if (binding === "inventory") return { field: name, binding, item: namespaced(reader.field("item")) };
  if (binding === "constant") {
    const constant = value(reader.field("value"));
    if (constant.kind === "input") return reader.fail("actor field constants cannot reference callback inputs");
    return { field: name, binding, value: constant };
  }
  return { field: name, binding };
}
function callback(reader: SaveReader): ModCallback {
  const base = { id: namespaced(reader.field("id")), function: reader.field("function").string(), arguments: reader.field("arguments").list(value),
    globals: reader.field("globals").list(entry => ({ name: entry.field("name").string(), value: value(entry.field("value")) })) };
  if (base.arguments.length > 8) return reader.fail("source callbacks accept at most eight arguments");
  const operation = reader.field("operation").choice("damage", "inventory.give", "inventory.consume", "actor.think", "actor.touch", "actor.use", "actor.pain", "actor.die");
  switch (reader.field("stage").choice("observe", "transform", "replace")) {
    case "observe": return { ...base, operation, stage: "observe" };
    case "transform":
      if (operation === "damage") return { ...base, operation, stage: "transform", result: reader.field("result").choice("amount", "knockback") };
      if (operation === "inventory.give" || operation === "inventory.consume") return { ...base, operation, stage: "transform", result: reader.field("result").literal("amount") };
      return reader.fail("actor callbacks support observation or replacement");
    case "replace":
      if (operation === "damage" || operation === "inventory.give" || operation === "inventory.consume") return reader.fail("this source contract replaces actor callbacks only");
      return { ...base, operation, stage: "replace", result: reader.field("result").literal("boolean") };
  }
}
export function readModCallbacks(bytes: Uint8Array): ModCallbackDeclaration {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return readQuakeCModDeclaration(new SaveReader(value));
}

function sourceCall(reader: SaveReader): ModSourceCall {
  return { function: reader.field("function").string(), arguments: reader.field("arguments").list(value),
    globals: reader.field("globals").list(entry => ({ name: entry.field("name").string(), value: value(entry.field("value")) })) };
}

function consoleValue(reader: SaveReader): ModConsoleValue {
  switch (reader.field("kind").choice("float", "string", "vector", "argument", "arguments-text", "argument-count")) {
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "string": return { kind: "string", value: reader.field("value").string() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
    case "argument": return { kind: "argument", index: reader.field("index").integer(0), type: reader.field("type").choice("string", "float") };
    case "arguments-text": return { kind: "arguments-text" };
    case "argument-count": return { kind: "argument-count" };
  }
}

export function readQuakeCModDeclaration(reader: SaveReader): ModCallbackDeclaration {
  const program = reader.field("program"), clients = reader.field("clients");
  const combat = reader.field("combat"), initialize = reader.field("initialize"), frame = reader.field("frame"), cvars = reader.field("cvars"), commands = reader.field("commands");
  return { version: reader.field("version").literal(1), runtime: reader.field("runtime").literal("quakec"),
    program: { path: normalizeResourcePath(program.field("path").string()), digest: readDigest(program.field("digest")) },
    actorFields: reader.field("actorFields").list(field), callbacks: reader.field("callbacks").list(callback),
    ...(clients.value === undefined ? {} : { clients: { maximum: clients.field("maximum").integer(1), admit: clients.field("admit").list(sourceCall),
      userinfo: clients.field("userinfo").list(sourceCall), disconnect: clients.field("disconnect").list(sourceCall),
      ...(clients.field("input").value === undefined ? {} : { input: readModClientInput(clients.field("input"), sourceCall, inputOutput) }) } }),
    ...(initialize.value === undefined ? {} : { initialize: initialize.list(sourceCall) }),
    ...(frame.value === undefined ? {} : { frame: sourceCall(frame) }),
    ...(cvars.value === undefined ? {} : { cvars: cvars.list(entry => ({ name: entry.field("name").string(), value: entry.field("value").string() })) }),
    ...(commands.value === undefined ? {} : { commands: commands.list(entry => ({ name: entry.field("name").string(), function: entry.field("function").string(),
      arguments: entry.field("arguments").list(consoleValue), globals: entry.field("globals").list(global => ({ name: global.field("name").string(), value: consoleValue(global.field("value")) })) })) }),
    ...(reader.field("protection").value === undefined ? {} : { protection: reader.field("protection").list(protection) }),
    ...(combat.value === undefined ? {} : { combat: { damage: sourceCall(combat.field("damage")),
      ...(combat.field("armorStage").value === undefined ? {} : { armorStage: armorStage(combat.field("armorStage")) }) } }) };
}

function protection(reader: SaveReader): ModQcProtection {
  const admission = reader.field("admission"), source = reader.field("absorb"), flags = reader.field("flags"), storage = reader.field("storage"), selection = storage.field("selection");
  const absorb = source.field("kind").choice("function", "region") === "function"
    ? { kind: "function", call: sourceCall(source.field("call")) } satisfies ModQcProtection["absorb"]
    : { kind: "region", call: sourceCall(source.field("call")), stage: armorStage(source.field("stage")) } satisfies ModQcProtection["absorb"];
  const base = { id: namespaced(reader.field("id")), absorb,
    ...(admission.value === undefined ? {} : { admission: readProtectionAdmission(admission) }),
    flags: { noArmor: flags.field("noArmor").integer(0), noPowerArmor: flags.field("noPowerArmor").integer(0),
      noRegularArmor: flags.field("noRegularArmor").integer(0), energy: flags.field("energy").integer(0), radius: flags.field("radius").integer(0) } };
  if (reader.field("channel").choice("regular", "powered") === "regular") return { ...base, channel: "regular", storage: {
    points: storage.field("points").string(), item: storage.field("item").value === null ? null : namespaced(storage.field("item")),
    ...(selection.value === undefined ? {} : { selection: { field: selection.field("field").string(),
      ...(selection.field("mask").value === undefined ? {} : { mask: selection.field("mask").integer(0) }),
      values: selection.field("values").list(entry => ({ value: entry.field("value").number(), item: entry.field("item").value === null ? null : namespaced(entry.field("item")) })) } }) } };
  return { ...base, channel: "powered", storage: { cells: storage.field("cells").string(), kind: storage.field("kind").choice("screen", "shield"),
    ...(selection.value === undefined ? {} : { selection: { field: selection.field("field").string(),
      ...(selection.field("mask").value === undefined ? {} : { mask: selection.field("mask").integer(0) }),
      values: selection.field("values").list(entry => ({ value: entry.field("value").number(), kind: entry.field("kind").choice("none", "screen", "shield") })) } }) } };
}

function armorStage(reader: SaveReader): ModQcArmorStage {
  const flags = reader.field("flags");
  return { function: reader.field("function").string(), entry: reader.field("entry").integer(0), exit: reader.field("exit").integer(0),
    target: reader.field("target").integer(0), damage: reader.field("damage").integer(0), saved: reader.field("saved").integer(0),
    ...(reader.field("regularScale").value === undefined ? {} : { regularScale: reader.field("regularScale").list(site => ({
      caller: site.field("caller").string(), statement: site.field("statement").integer(0), scale: site.field("scale").number() })) }),
    flags: flags.field("kind").choice("none", "bits") === "none" ? { kind: "none" } : { kind: "bits", word: flags.field("word").integer(0),
      noArmor: flags.field("noArmor").integer(0), noPowerArmor: flags.field("noPowerArmor").integer(0),
      noRegularArmor: flags.field("noRegularArmor").integer(0), energy: flags.field("energy").integer(0) },
    statements: reader.field("statements").list(statement => ({ opcode: statement.field("opcode").integer(0), a: statement.field("a").integer(0),
      b: statement.field("b").integer(0), c: statement.field("c").integer(0) })) };
}

function readProtectionAdmission(reader: SaveReader): NonNullable<ModQcProtection["admission"]> {
  const kind = reader.field("kind").choice("claim", "replace-primary", "replace-current-primary");
  return kind === "replace-primary" ? { kind, owner: namespaced(reader.field("owner")) } : { kind };
}

function inputOutput(reader: SaveReader): ModQcInputOutput {
  if (reader.field("kind").choice("field", "handler") === "field") return { kind: "field", field: reader.field("field").string() };
  return { kind: "handler", function: reader.field("function").string(), inputs: reader.field("inputs").list(input => input.choice("attack", "jump", "impulse", "forward-move", "side-move", "up-move")) };
}
