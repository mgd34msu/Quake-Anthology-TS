import { readClientOutputDeclarations } from "./client-outputs.ts";
import { readSourceTeamValues, readSourceObjectives } from "./match.ts";
import { QVM_MAX_PRIVATE_ARGUMENT_WORDS } from "../../compat/qvm/image.ts";
import { readQvmModItems } from "./qvm-items.ts";
import type { ModCallbackBinding, ModCallbackValue } from "../../contracts/mod-callbacks.ts";
import type { QvmModCombat, QvmModActorField, QvmModCallbackDeclaration, QvmModSourceCall, QvmModValue, QvmModProtection, QvmModProtectionScalar, QvmModProtectionSelection, QvmModInputOutput, QvmModInputPointer } from "../../contracts/qvm-mod-callbacks.ts";
import { readDigest, readVector } from "../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { readModClientInput } from "./client-input.ts";
import { readQvmModPresentationDeclaration } from "./qvm-presentation.ts";
import { readModPickupRule } from "./pickups.ts";

function combatCall<Role extends string>(reader: SaveReader, roles: Readonly<Record<Role, number>>) {
  return { roles, extras: reader.field("extras").list(extra => ({ index: extra.field("index").integer(0),
    kind: extra.field("kind").choice("int32", "float32", "address"), value: extra.field("value").number() })) };
}
function combatDefinition(combat: SaveReader): QvmModCombat {
  const fields = { entry: combat.field("entry").integer(0), health: combat.field("health").integer(0),
    takedamage: combat.field("takedamage").integer(0), flags: combat.field("flags").integer(0),
    godmode: combat.field("godmode").integer(1), noKnockback: combat.field("noKnockback").integer(1),
    globals: combat.field("globals").list(global => ({ address: global.field("address").integer(0), value: argument(global.field("value")) })),
    client: combat.field("client").nullable(client => ({ pointer: client.field("pointer").integer(0), record: client.field("record").string(),
      health: client.field("health").integer(0), armor: client.field("armor").integer(0), protection: client.field("protection").number(), team: client.field("team").integer(0) })) };
  if (combat.field("abi").choice("q3-g-damage", "declared") === "q3-g-damage") return { abi: "q3-g-damage", ...fields };
  const calls = combat.field("calls"), damage = calls.field("damage"), touch = calls.field("touch"), use = calls.field("use"), pain = calls.field("pain"), die = calls.field("die");
  const role = (call: SaveReader, name: string) => call.field("roles").field(name).integer(0);
  const flags = combat.field("damageFlags"), mass = combat.field("mass");
  return { abi: "declared", ...fields, calls: {
    damage: combatCall(damage, { target: role(damage, "target"), inflictor: role(damage, "inflictor"), attacker: role(damage, "attacker"),
      direction: role(damage, "direction"), point: role(damage, "point"), amount: role(damage, "amount"), flags: role(damage, "flags"), method: role(damage, "method") }),
    touch: combatCall(touch, { target: role(touch, "target"), other: role(touch, "other"), trace: role(touch, "trace") }),
    use: combatCall(use, { target: role(use, "target"), other: role(use, "other"), activator: role(use, "activator") }),
    pain: combatCall(pain, { target: role(pain, "target"), attacker: role(pain, "attacker"), amount: role(pain, "amount") }),
    die: combatCall(die, { target: role(die, "target"), inflictor: role(die, "inflictor"), attacker: role(die, "attacker"), amount: role(die, "amount"), method: role(die, "method") }),
  }, damageFlags: { radius: flags.field("radius").integer(1), noArmor: flags.field("noArmor").integer(1), noKnockback: flags.field("noKnockback").integer(1),
    noProtection: flags.field("noProtection").integer(1), noTeamProtection: flags.field("noTeamProtection").integer(1) },
    mass: mass.field("kind").choice("constant", "entity") === "constant" ? { kind: "constant", value: mass.field("value").number() }
      : { kind: "entity", offset: mass.field("offset").integer(0), storage: mass.field("storage").choice("int32", "float32") },
    teams: combat.field("teams").list(team => ({ value: team.field("value").integer(), team: namespaced(team.field("team")) })) };
}

function value(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "vector", "string")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move", "damage-flags", "regular-protection-scale", "pickup-count", "pickup-has-count", "pickup-dropped") };
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
    case "string": return { kind: "string", value: reader.field("value").string() };
  }
}
function argument(reader: SaveReader): QvmModValue {
  const kind = reader.field("kind").choice("int32", "float32", "vector", "string", "actor", "client", "time", "address");
  switch (kind) {
    case "actor": return { kind, record: reader.field("record").string(), input: reader.field("input").choice("self", "other", "activator", "attacker", "inflictor") };
    case "client": return { kind, input: reader.field("input").choice("self", "other", "activator", "attacker", "inflictor") };
    case "time": return { kind, input: reader.field("input").choice("time", "elapsed"), units: reader.field("units").choice("seconds", "milliseconds"), encoding: reader.field("encoding").choice("int32", "float32") };
    case "address": return { kind, value: reader.field("value").integer(0) };
    default: return { kind, value: value(reader.field("value")) };
  }
}
function sourceCall(reader: SaveReader): QvmModSourceCall {
  return { entry: reader.field("entry").integer(0), arguments: reader.field("arguments").list(argument),
    globals: reader.field("globals").list(global => ({ address: global.field("address").integer(0), value: argument(global.field("value")) })),
    returns: reader.field("returns").choice("int32", "float32", "void") };
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
function field(reader: SaveReader): QvmModActorField {
  const offset = reader.field("offset").integer(0), binding = reader.field("binding").choice("health", "inventory", "origin", "velocity", "angles", "bounds-min", "bounds-max", "record", "constant", "constant-vector", "private", "team", "score");
  const access = reader.field("access").value === undefined ? {} : { access: reader.field("access").choice("read-only", "read-write") };
  if ("access" in access && !["health", "inventory", "origin", "velocity", "angles", "bounds-min", "bounds-max"].includes(binding)) reader.fail("Projection access applies only to canonical actor fields");
  switch (binding) {
    case "team": return { offset, binding, ...access, encoding: reader.field("encoding").choice("int32", "float32"), values: readSourceTeamValues(reader.field("values")) };
    case "score": return { offset, binding, ...access, encoding: reader.field("encoding").choice("int32", "float32") };
    case "health": return { offset, binding, ...access, encoding: reader.field("encoding").choice("int32", "float32") };
    case "inventory": return { offset, binding, ...access, encoding: reader.field("encoding").choice("int32", "float32"), item: namespaced(reader.field("item")) };
    case "record": return { offset, binding, record: reader.field("record").string() };
    case "constant": return { offset, binding, ...access, encoding: reader.field("encoding").choice("int32", "float32"), value: reader.field("value").number() };
    case "constant-vector": return { offset, binding, value: readVector(reader.field("value")) };
    case "private": return { offset, binding, byteLength: reader.field("byteLength").integer(1) };
    default: return { offset, binding, ...access };
  }
}
function protectionScalar(reader: SaveReader): QvmModProtectionScalar {
  return { record: reader.field("record").string(), offset: reader.field("offset").integer(0), encoding: reader.field("encoding").choice("int32", "float32") };
}
function protectionSelection<Value>(reader: SaveReader, selected: (reader: SaveReader) => Value): QvmModProtectionSelection<Value> {
  return { field: protectionScalar(reader.field("field")), mask: reader.field("mask").nullable(value => value.integer(0)),
    values: reader.field("values").list(value => ({ value: value.field("value").number(), selected: selected(value.field("selected")) })) };
}
function protection(reader: SaveReader): QvmModProtection {
  const admission = reader.field("admission"), flags = reader.field("flags"), storage = reader.field("storage");
  const kind = admission.field("kind").choice("claim", "replace-primary", "replace-current-primary");
  const claim = kind !== "replace-primary" ? { kind } satisfies QvmModProtection["admission"]
    : { kind: "replace-primary", owner: namespaced(admission.field("owner")) } satisfies QvmModProtection["admission"];
  const common = { id: namespaced(reader.field("id")), admission: claim, absorb: sourceCall(reader.field("absorb")),
    flags: { noArmor: flags.field("noArmor").integer(0), noPowerArmor: flags.field("noPowerArmor").integer(0), noRegularArmor: flags.field("noRegularArmor").integer(0),
      energy: flags.field("energy").integer(0), radius: flags.field("radius").value === undefined ? 0 : flags.field("radius").integer(0) } };
  return reader.field("channel").choice("regular", "powered") === "regular"
    ? { ...common, channel: "regular", storage: { points: protectionScalar(storage.field("points")), item: storage.field("item").nullable(namespaced),
      ...(storage.field("selection").value === undefined ? {} : { selection: protectionSelection(storage.field("selection"), value => value.nullable(namespaced)) }) } }
    : { ...common, channel: "powered", storage: { cells: protectionScalar(storage.field("cells")),
      selection: protectionSelection(storage.field("selection"), value => value.choice("none", "screen", "shield")) } };
}
export function readQvmModCallbacks(bytes: Uint8Array): QvmModCallbackDeclaration {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return readQvmModDeclaration(new SaveReader(value));
}

function inputPointer(reader: SaveReader): QvmModInputPointer {
  const common = { indirections: reader.field("indirections").list(value => value.integer(0)), offset: reader.field("offset").integer(0) };
  if (reader.field("kind").choice("argument", "global") === "global") return { ...common, kind: "global", address: reader.field("address").integer(0) };
  const index = reader.field("index").integer(0);
  if (index >= QVM_MAX_PRIVATE_ARGUMENT_WORDS) return reader.fail("Input pointer argument exceeds source call ABI");
  return { ...common, kind: "argument", index };
}
function inputOutput(reader: SaveReader): QvmModInputOutput {
  const kind = reader.field("kind").choice("field", "handler", "command");
  if (kind === "field") {
    const value = reader.field("value"), input = value.field("input").choice("view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move");
    const common = { kind, record: reader.field("record").string(), offset: reader.field("offset").integer(0) };
    if (input === "view-angles") return { ...common, value: { input } };
    const scale = value.field("scale").number();
    if (scale <= 0) return value.fail("Input field scale must be positive");
    return { ...common, value: { input, encoding: value.field("encoding").choice("int32", "float32"), scale } };
  }
  const actor = reader.field("actor"), common = { entry: reader.field("entry").integer(0),
    actor: { record: actor.field("record").string(), pointer: inputPointer(actor.field("pointer")) } };
  if (kind === "command") return { ...common, kind, command: inputPointer(reader.field("command")),
    inputs: reader.field("inputs").list(value => value.choice("view-angles", "attack", "jump", "forward-move", "side-move", "up-move")) };
  return { ...common, kind, inputs: reader.field("inputs").list(value => value.choice("attack", "jump", "impulse", "forward-move", "side-move", "up-move")),
    ...(reader.field("returns").value === undefined ? {} : { returns: {
      encoding: reader.field("returns").field("encoding").choice("int32", "float32"), value: reader.field("returns").field("value").number() } }) };
}

export function readQvmModDeclaration(reader: SaveReader): QvmModCallbackDeclaration {
  const program = reader.field("program"), actors = reader.field("sourceActors"), combat = reader.field("combat"), clients = reader.field("clients");
  return { version: reader.field("version").literal(1), runtime: reader.field("runtime").literal("qvm"),
    program: { path: normalizeResourcePath(program.field("path").string()), digest: readDigest(program.field("digest")) },
    abiProfile: reader.field("abiProfile").choice("q3-modern", "q3-1.16n-base"),
    ...(reader.field("presentation").value === undefined ? {} : { presentation: readQvmModPresentationDeclaration(reader.field("presentation")) }),
    spawnEntities: reader.field("spawnEntities").value === undefined ? null : reader.field("spawnEntities").nullable(value => value.string()),
    ...(clients.value === undefined ? {} : { clients: { maximum: clients.field("maximum").integer(1),
      ...(clients.field("outputs").value === undefined ? {} : { outputs: readClientOutputDeclarations(clients.field("outputs"),
        value => ({ record: value.field("record").string(), offset: value.field("offset").integer(0), encoding: value.field("encoding").choice("int32", "float32") }),
        value => ({ record: value.field("record").string(), offset: value.field("offset").integer(0) })) }),
      records: clients.field("records").list(value => value.string()), playerStateRecord: clients.field("playerStateRecord").string(), admit: clients.field("admit").list(sourceCall),
      userinfo: clients.field("userinfo").list(sourceCall), disconnect: clients.field("disconnect").list(sourceCall),
      ...(clients.field("frame").value === undefined ? {} : { frame: clients.field("frame").list(sourceCall) }),
      ...(clients.field("input").value === undefined ? {} : { input: readModClientInput(clients.field("input"), sourceCall, inputOutput) }) } }),
    entityRecord: reader.field("entityRecord").nullable(value => value.string()),
    ...(actors.value === undefined ? {} : { sourceActors: { allocate: actors.field("allocate").integer(0),
      release: { entry: actors.field("release").field("entry").integer(0), argument: actors.field("release").field("argument").integer(0) },
      ...(actors.field("initialStores").value === undefined ? {} : { initialStores: actors.field("initialStores").list(value => value.integer(0)) }),
      inuse: actors.field("inuse").integer(0), eventEntityType: actors.field("eventEntityType").integer(0), update: actors.field("update").nullable(sourceCall),
      ...(actors.field("frame").value === undefined ? {} : { frame: {
        call: sourceCall(actors.field("frame").field("call")),
        clock: { address: actors.field("frame").field("clock").field("address").integer(0), store: actors.field("frame").field("clock").field("store").integer(0), argument: actors.field("frame").field("clock").field("argument").integer(0) },
        owned: actors.field("frame").field("owned").list(value => ({ instruction: value.field("instruction").integer(0), localInstruction: value.field("localInstruction").integer(0) })),
        end: { instruction: actors.field("frame").field("end").field("instruction").integer(0), completedTaken: actors.field("frame").field("end").field("completedTaken").boolean() },
      } }),
      ...(actors.field("callbacks").value === undefined ? {} : { callbacks: {
        touch: actors.field("callbacks").field("touch").nullable(field => field.integer(0)), use: actors.field("callbacks").field("use").nullable(field => field.integer(0)),
        pain: actors.field("callbacks").field("pain").nullable(field => field.integer(0)), die: actors.field("callbacks").field("die").nullable(field => field.integer(0)),
      } }) } }),
    ...(combat.value === undefined ? {} : { combat: combatDefinition(combat) }),
    ...(reader.field("protection").value === undefined ? {} : { protection: reader.field("protection").list(protection) }),
    ...(reader.field("items").value === undefined ? {} : { items: readQvmModItems(reader.field("items"), sourceCall) }),
    ...(reader.field("pickups").value === undefined ? {} : { pickups: reader.field("pickups").list(rule => ({ ...readModPickupRule(rule, sourceCall),
      context: rule.field("context").list(field => ({ record: field.field("record").string(), offset: field.field("offset").integer(0), value: argument(field.field("value")) })) })) }),
    ...(reader.field("objectives").value === undefined ? {} : { objectives: readSourceObjectives(reader.field("objectives"), value => ({ address: value.field("address").integer(0), encoding: value.field("encoding").choice("int32", "float32") }), value => value.integer(0), sourceCall) }),
    actorRecords: reader.field("actorRecords").list(record => ({ id: record.field("id").string(), address: record.field("address").integer(1),
      stride: record.field("stride").integer(4), capacity: record.field("capacity").integer(1), fields: record.field("fields").list(field) })),
    initialize: reader.field("initialize").list(sourceCall), callbacks: reader.field("callbacks").list(reader => ({ ...binding(reader), ...sourceCall(reader) })) };
}
