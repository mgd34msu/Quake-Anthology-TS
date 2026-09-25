import { readQcWeaponStageDeclaration } from "../q1/quakec/weapon-stage-declaration.ts";
import { readItemIconDeclaration } from "../item-icon.ts";
import { readItemActions } from "./item-actions.ts";
import { readHeldWeaponDeclaration } from "../held-weapon.ts";
import type { ModActorField, ModCallback, ModCallbackDeclaration, ModCallbackValue, ModConsoleValue, ModSourceCall, ModQcArmorStage, ModQcProtection, ModQcInputOutput, ModQcItems } from "../../contracts/mod-callbacks.ts";
import { readDigest, readVector } from "../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { readModClientInput } from "./client-input.ts";
import { readModPickupRule } from "./pickups.ts";

function value(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "string", "vector")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "damage-flags", "regular-protection-scale", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move", "pickup-count", "pickup-has-count", "pickup-dropped") };
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
    ...(reader.field("clientPresentation").value === undefined ? {} : { clientPresentation: {
      hud: reader.field("clientPresentation").field("hud").choice("none", "replace-vitals"),
      view: reader.field("clientPresentation").field("view").choice("none", "set-view") } }),
    ...(clients.value === undefined ? {} : { clients: { maximum: clients.field("maximum").integer(1), admit: clients.field("admit").list(sourceCall),
      userinfo: clients.field("userinfo").list(sourceCall), disconnect: clients.field("disconnect").list(sourceCall),
      ...(clients.field("frame").value === undefined ? {} : { frame: clients.field("frame").list(sourceCall) }),
      ...(clients.field("input").value === undefined ? {} : { input: readModClientInput(clients.field("input"), sourceCall, inputOutput) }) } }),
    ...(initialize.value === undefined ? {} : { initialize: initialize.list(sourceCall) }),
    ...(frame.value === undefined ? {} : { frame: sourceCall(frame) }),
    ...(cvars.value === undefined ? {} : { cvars: cvars.list(entry => ({ name: entry.field("name").string(), value: entry.field("value").string() })) }),
    ...(commands.value === undefined ? {} : { commands: commands.list(entry => ({ name: entry.field("name").string(), function: entry.field("function").string(),
      arguments: entry.field("arguments").list(consoleValue), globals: entry.field("globals").list(global => ({ name: global.field("name").string(), value: consoleValue(global.field("value")) })) })) }),
    ...(reader.field("protection").value === undefined ? {} : { protection: reader.field("protection").list(protection) }),
    ...(reader.field("pickups").value === undefined ? {} : { pickups: reader.field("pickups").list(entry => readModPickupRule(entry, sourceCall)) }),
    ...(reader.field("items").value === undefined ? {} : { items: items(reader.field("items")) }),
    ...(combat.value === undefined ? {} : { combat: readQcCombat(combat) }) };

}

export function readQcCombat(reader: SaveReader): NonNullable<ModCallbackDeclaration["combat"]> {
  const scale = reader.field("damageScale");
  return { damage: sourceCall(reader.field("damage")),
    ...(scale.value === undefined ? {} : { damageScale: { ...(scale.field("kind").value === undefined ? {} : { kind: scale.field("kind").choice("multiplier", "identity", "transform") }), function: scale.field("function").string(), entry: scale.field("entry").integer(0), exit: scale.field("exit").integer(0), damage: scale.field("damage").integer(28),
      statements: scale.field("statements").list(at => ({ opcode: at.field("opcode").integer(0), a: at.field("a").integer(), b: at.field("b").integer(), c: at.field("c").integer() })) } }),
    ...(reader.field("armorStage").value === undefined ? {} : { armorStage: armorStage(reader.field("armorStage")) }),
    ...(reader.field("emptyArmor").value === undefined ? {} : { emptyArmor: { item: reader.field("emptyArmor").field("item").choice("q1:item_armor1", "q1:item_armor2", "q1:item_armorInv"), absorption: reader.field("emptyArmor").field("absorption").finite() } }) };
}

function items(reader: SaveReader): ModQcItems {
  const selection = (value: SaveReader) => ({ field: value.field("field").string(), values: value.field("values").list(entry => ({ value: entry.field("value").finite(), item: namespaced(entry.field("item")) })) });
  const weapons = reader.field("weapons");
  return { definitions: reader.field("definitions").list(entry => {
    const base = { item: namespaced(entry.field("item")), label: entry.field("label").string(), ...(entry.field("icon").value === undefined ? {} : { icon: entry.field("icon").nullable(readItemIconDeclaration) }), admission: entry.field("admission").choice("add", "replace-primary"), ...(entry.field("actions").value === undefined ? {} : { actions: readItemActions(entry.field("actions"), sourceCall) }) };
    return entry.field("kind").choice("counter", "weapon") === "counter" ? { ...base, kind: "counter" } : { ...base, kind: "weapon", ...(entry.field("held").value === undefined ? {} : { held: readHeldWeaponDeclaration(entry.field("held")) }), ammo: entry.field("ammo").value === null ? null : namespaced(entry.field("ammo")) };
  }), storage: reader.field("storage").list(entry => {
    const field = entry.field("field").string();
    if (entry.field("kind").choice("counter", "bits") === "bits") return { kind: "bits", field, privateMask: entry.field("privateMask").integer(0),
      items: entry.field("items").list(value => ({ item: namespaced(value.field("item")), mask: value.field("mask").integer(1) })) };
    const capacity = entry.field("capacity");
    return { kind: "counter", field, item: namespaced(entry.field("item")), capacity: capacity.field("kind").choice("constant", "field") === "constant"
      ? { kind: "constant", value: capacity.field("value").finite() } : { kind: "field", field: capacity.field("field").string() } };
  }), ...(weapons.value === undefined ? {} : { weapons: { stage: readQcWeaponStageDeclaration(weapons.field("stage")), selected: selection(weapons.field("selected")),
    select: { ...selection(weapons.field("select")), call: sourceCall(weapons.field("select").field("call")) },
    resume: weapons.field("resume").list(sourceCall), model: { field: weapons.field("model").field("field").string(), frame: weapons.field("model").field("frame").string() } } }) };
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
