import { readClientOutputDeclarations } from "./client-outputs.ts";
import { readItemIconDeclaration } from "../item-icon.ts";
import { readItemActions } from "./item-actions.ts";
import type { NativeModRegionLocation } from "../../contracts/native-mod-region.ts";
import { readHeldWeaponDeclaration } from "../held-weapon.ts";
import type { NativeModItems, NativeItemStorage, NativeItemTest } from "../../contracts/native-mod-items.ts";
import type { ModCallbackBinding, ModCallbackValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModActorField, NativeModAddress, NativeModEntry, NativeModDeclaration, NativeModSourceCall, NativeModValue, NativeModSourceActors, NativeModArmor, NativeModArmorField, NativeModArmorSelection, NativeModPowerArmorItem, NativeModRegularArmorItem, NativeModProtectionDefinition } from "../../contracts/native-mod-callbacks.ts";
import { readDigest, readVector } from "../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { readModClientInput } from "./client-input.ts";
import { readModPickupRule } from "./pickups.ts";

function value(reader: SaveReader): ModCallbackValue {
  switch (reader.field("kind").choice("input", "float", "vector", "string")) {
    case "input": return { kind: "input", name: reader.field("name").choice("self", "other", "activator", "attacker", "inflictor", "amount", "damage-flags", "regular-protection-scale", "knockback", "point", "direction", "normal", "item", "time", "elapsed", "result", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move", "pickup-count", "pickup-has-count", "pickup-dropped") };
    case "float": return { kind: "float", value: reader.field("value").number() };
    case "vector": return { kind: "vector", value: readVector(reader.field("value")) };
    case "string": return { kind: "string", value: reader.field("value").string() };
  }
}
function address(reader: SaveReader): NativeModAddress { return { rva: reader.field("rva").integer(0), indirections: reader.field("indirections").list(value => value.integer(0)) }; }
function entry(reader: SaveReader): NativeModEntry { return reader.field("kind").choice("export", "rva") === "export"
  ? { kind: "export", name: reader.field("name").string() } : { kind: "rva", rva: reader.field("rva").integer(0) }; }
function argument(reader: SaveReader): NativeModValue {
  const kind = reader.field("kind").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "vector", "string", "actor", "client", "userinfo", "time", "address", "user-command");
  switch (kind) {
    case "user-command": return { kind };
    case "client": case "userinfo": return { kind, input: reader.field("input").choice("self", "other", "activator", "attacker", "inflictor") };
    case "actor": return { kind, record: reader.field("record").string(), input: reader.field("input").choice("self", "other", "activator", "attacker", "inflictor") };
    case "time": return { kind, input: reader.field("input").choice("time", "elapsed"), units: reader.field("units").choice("seconds", "milliseconds"), encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") };
    case "address": return { kind, value: reader.field("value").nullable(address) };
    default: return { kind, value: value(reader.field("value")) };
  }
}
function sourceCall(reader: SaveReader): NativeModSourceCall {
  return { entry: reader.field("entry").field("kind").string() === "game-export" ? { kind: "game-export", name: reader.field("entry").field("name").string() } : entry(reader.field("entry")), arguments: reader.field("arguments").list(argument),
    globals: reader.field("globals").list(global => ({ address: address(global.field("address")), value: argument(global.field("value")) })),
    returns: reader.field("returns").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "void"),
    ...(reader.field("skips").value === undefined ? {} : { skips: reader.field("skips").list(region => ({ entry: region.field("entry").integer(0), join: region.field("join").integer(0) })) }) };
}
function inputOutput(reader: SaveReader): import("../../contracts/native-mod-callbacks.ts").NativeModInputOutput {
  const kind = reader.field("kind").choice("field", "handler");
  return kind === "field" ? { kind, record: reader.field("record").string(), offset: reader.field("offset").integer(0) }
    : { kind, entry: entry(reader.field("entry")), arguments: reader.field("arguments").list(argument), inputs: reader.field("inputs").list(value => value.choice("attack", "jump", "impulse", "forward-move", "side-move", "up-move")) };
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
  const offset = reader.field("offset").integer(0), binding = reader.field("binding").choice("health", "inventory", "inventory-capacity", "origin", "velocity", "angles", "bounds-min", "bounds-max", "record", "constant", "constant-vector", "private", "address");
  switch (binding) {
    case "address": return { offset, binding, value: reader.field("value").nullable(address) };
    case "health": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") };
    case "inventory": case "inventory-capacity": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"), item: namespaced(reader.field("item")) };
    case "record": return { offset, binding, record: reader.field("record").string() };
    case "constant": return { offset, binding, encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"), value: reader.field("value").number() };
    case "constant-vector": return { offset, binding, value: readVector(reader.field("value")) };
    case "private": return { offset, binding, byteLength: reader.field("byteLength").integer(1) };
    default: return { offset, binding };
  }
}
function armorField(reader: SaveReader): NativeModArmorField { return { record: reader.field("record").string(), offset: reader.field("offset").integer(0),
  encoding: reader.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") }; }
function armorSelection(reader: SaveReader): NativeModArmorSelection {
  const field = armorField(reader.field("field"));
  return reader.field("kind").choice("positive", "enum") === "positive" ? { kind: "positive", field }
    : { kind: "enum", field, value: reader.field("value").number(), none: reader.field("none").number() };
}
function armor(reader: SaveReader): NativeModArmor {
  const kind = reader.field("kind").choice("none", "q2", "source");
  if (kind === "none") return { kind };
  if (kind === "source") return { kind, regular: reader.field("regular").list(regularArmorItem), power: reader.field("power").list(powerArmorItem) };
  return { kind: "q2", regular: reader.field("regular").list(value => ({ item: namespaced(value.field("item")), selection: armorSelection(value.field("selection")),
    points: armorField(value.field("points")), normalProtection: value.field("normalProtection").number(), energyProtection: value.field("energyProtection").number() })),
    power: reader.field("power").list(powerArmorItem) };
}
function regularArmorItem(reader: SaveReader): NativeModRegularArmorItem {
  return { item: reader.field("item").nullable(namespaced), selection: armorSelection(reader.field("selection")), points: armorField(reader.field("points")) };
}
function powerArmorItem(reader: SaveReader): NativeModPowerArmorItem {
  return { item: namespaced(reader.field("item")), kind: reader.field("kind").choice("screen", "shield"), selection: armorSelection(reader.field("selection")),
    cells: armorField(reader.field("cells")), enabled: reader.field("enabled").nullable(value => ({ field: armorField(value.field("field")), mask: value.field("mask").integer(1) })) };
}
function regionLocation(reader: SaveReader): NativeModRegionLocation {
  const kind = reader.field("kind").choice("register", "stack", "simd");
  const scalar = () => reader.field("storage").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64");
  if (kind === "simd") return { kind, index: reader.field("index").integer(0), offset: reader.field("offset").integer(0), storage: scalar() };
  const storage = reader.field("storage").value === "pointer" ? "pointer" : scalar();
  return kind === "stack" ? { kind, offset: reader.field("offset").integer(0), storage }
    : { kind, register: reader.field("register").choice("rax", "rcx", "rdx", "rbx", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"), storage };
}
function protection(reader: SaveReader, legacy = false): NativeModProtectionDefinition {
  const channel = legacy ? "powered" : reader.field("channel").choice("regular", "powered"), absorb = reader.field("absorb");
  const claim = { id: reader.field("id").string(),
    ...(reader.field("admission").value === undefined ? {} : { admission: reader.field("admission").field("kind").choice("claim", "replace-current-primary", "replace-primary") === "replace-primary"
      ? { kind: "replace-primary", owner: namespaced(reader.field("admission").field("owner")) } satisfies NativeModProtectionDefinition["admission"]
      : { kind: reader.field("admission").field("kind").choice("claim", "replace-current-primary") } satisfies NativeModProtectionDefinition["admission"] }) };
  const abi = absorb.field("abi").choice("q2-check-power-armor", "q2-check-armor", "source-call", "source-region");
  if (abi === "source-call" || abi === "source-region") {
    if (legacy) return absorb.fail("Legacy powered protection requires its original Q2 ABI");
    const call = sourceCall(absorb.field("call"));
    const definition = abi === "source-call" ? { abi, call } : { abi, call,
      frame: { entry: absorb.field("frame").field("entry").integer(0), exit: absorb.field("frame").field("exit").integer(0),
        stackBytes: absorb.field("frame").field("stackBytes").integer(0), argumentBytes: absorb.field("frame").field("argumentBytes").integer(0) },
      entry: absorb.field("entry").integer(0), join: absorb.field("join").integer(0), result: regionLocation(absorb.field("result")),
      inputs: absorb.field("inputs").list(value => ({ target: regionLocation(value.field("target")), value: argument(value.field("value")) })) };
    return channel === "regular" ? { ...claim, channel, storage: reader.field("storage").list(regularArmorItem), absorb: definition }
      : { ...claim, channel, storage: reader.field("storage").list(powerArmorItem), absorb: definition };
  }
  const call = { entry: entry(absorb.field("entry")), flags: absorb.field("flags").choice("q2-classic", "q2-rerelease"),
    ...(absorb.field("globals").value === undefined ? {} : { globals: absorb.field("globals").list(global => ({ address: address(global.field("address")), value: argument(global.field("value")) })) }) };
  if (channel === "regular") {
    if (abi !== "q2-check-armor") return absorb.fail("Regular protection requires its original regular armor ABI");
    return { ...claim, channel, storage: reader.field("storage").list(regularArmorItem), absorb: { ...call, abi, sparks: absorb.field("sparks").integer(0) } };
  }
  if (abi !== "q2-check-power-armor") return absorb.fail("Powered protection requires its original power armor ABI");
  return { ...claim, channel, storage: reader.field("storage").list(powerArmorItem), absorb: { ...call, abi } };
}
function protections(reader: SaveReader): readonly NativeModProtectionDefinition[] {
  const current = reader.field("protection"), legacy = reader.field("poweredProtection");
  if (current.value !== undefined && legacy.value !== undefined) return current.fail("Protection declarations cannot mix legacy and current layouts");
  return current.value !== undefined ? current.list(value => protection(value)) : legacy.value !== undefined ? [protection(legacy, true)] : [];
}
function sourceActors(reader: SaveReader): NativeModSourceActors {
  const fields = reader.field("fields"), nextthink = fields.field("nextthink"), update = reader.field("update");
  const encoding = (reader: SaveReader) => reader.choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64");
  return { allocate: entry(reader.field("allocate")), release: entry(reader.field("release")),
    update: { entry: entry(update.field("entry")), returns: update.field("returns").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "void") },
    frameSeconds: reader.field("frameSeconds").number(),
    clock: reader.field("clock").list(value => ({ address: address(value.field("address")), input: value.field("input").choice("time", "frame"), encoding: encoding(value.field("encoding")), units: value.field("units").choice("seconds", "milliseconds") })),
    ...(reader.field("callbacks").value === undefined ? {} : { callbacks: { abi: reader.field("callbacks").field("abi").choice("q2-classic", "q2-rerelease"),
      touch: reader.field("callbacks").field("touch").nullable(value => value.integer(0)), pain: reader.field("callbacks").field("pain").nullable(value => value.integer(0)), die: reader.field("callbacks").field("die").nullable(value => value.integer(0)) } }),
    ...(reader.field("combat").value === undefined ? {} : { combat: (() => {
      const combat = reader.field("combat"), causes = combat.field("causes"), damage = combat.field("damage"), flags = combat.field("flags"), deferred = combat.field("deferred");
      const scalar = (value: SaveReader) => ({ offset: value.field("offset").integer(0), encoding: encoding(value.field("encoding")) });
      return { damage: { entry: entry(damage.field("entry")), abi: damage.field("abi").choice("q2-classic", "q2-rerelease") },
        causes: causes.field("edition").choice("classic", "rerelease") === "classic" ? { edition: "classic", game: causes.field("game").choice("base", "xatrix", "rogue", "ctf") } satisfies NonNullable<NativeModSourceActors["combat"]>["causes"] : { edition: "rerelease" } satisfies NonNullable<NativeModSourceActors["combat"]>["causes"],
        health: scalar(combat.field("health")), mass: scalar(combat.field("mass")), takedamage: scalar(combat.field("takedamage")),
        flags: { ...scalar(flags), invulnerable: flags.field("invulnerable").integer(0), noKnockback: flags.field("noKnockback").integer(0) }, armor: armor(combat.field("armor")),
        ...(deferred.value === undefined ? {} : { deferred: { process: entry(deferred.field("process")), attacker: deferred.field("attacker").integer(0), inflictor: deferred.field("inflictor").integer(0),
          blood: scalar(deferred.field("blood")), knockback: scalar(deferred.field("knockback")), point: deferred.field("point").integer(0), mod: deferred.field("mod").integer(0), receipt: deferred.field("receipt").integer(0) } }) };
    })() }),
    fields: { velocity: fields.field("velocity").integer(0), ground: fields.field("ground").integer(0), use: fields.field("use").nullable(value => value.integer(0)),
      think: fields.field("think").integer(0), nextthink: { offset: nextthink.field("offset").integer(0), encoding: encoding(nextthink.field("encoding")), units: nextthink.field("units").choice("seconds", "milliseconds") } } };
}
function nativeItems(reader: SaveReader): NativeModItems {
  const pointer = (value: SaveReader) => ({ record: value.field("record").string(), offset: value.field("offset").integer(0) });
  const test = (value: SaveReader): NativeItemTest => value.field("kind").choice("scalar", "pointer") === "pointer"
    ? { kind: "pointer", field: pointer(value.field("field")), value: value.field("value").nullable(address) }
    : { kind: "scalar", field: armorField(value.field("field")), mask: value.field("mask").nullable(value => value.integer(0)), comparison: value.field("comparison").choice("equals", "at-most"), value: value.field("value").number() };
  return { definitions: reader.field("definitions").list(value => {
    const common = { item: namespaced(value.field("item")), label: value.field("label").string(), ...(value.field("icon").value === undefined ? {} : { icon: value.field("icon").nullable(readItemIconDeclaration) }), admission: value.field("admission").choice("add", "replace-primary"), ...(value.field("actions").value === undefined ? {} : { actions: readItemActions(value.field("actions"), sourceCall) }) };
    return value.field("kind").choice("counter", "weapon") === "counter" ? { ...common, kind: "counter" }
      : { ...common, kind: "weapon", ...(value.field("held").value === undefined ? {} : { held: readHeldWeaponDeclaration(value.field("held")) }), ammo: value.field("ammo").nullable(namespaced) };
  }), storage: reader.field("storage").list((value): NativeItemStorage => {
    const field = armorField(value.field("field"));
    if (value.field("kind").choice("counter", "bits") === "bits") return { kind: "bits", field, privateMask: value.field("privateMask").integer(0), items: value.field("items").list(value => ({ item: namespaced(value.field("item")), mask: value.field("mask").integer(1) })) };
    const capacity = value.field("capacity"), kind = capacity.field("kind").choice("constant", "field", "source");
    return { kind: "counter", field, item: namespaced(value.field("item")), capacity: kind === "constant" ? { kind, value: capacity.field("value").number() }
      : kind === "field" ? { kind, field: armorField(capacity.field("field")) }
      : { kind, address: address(capacity.field("address")), encoding: capacity.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") } };
  }), ...(reader.field("weapons").value === undefined ? {} : { weapons: (() => {
    const weapon = reader.field("weapons"), dispatcher = weapon.field("dispatcher"), selection = weapon.field("selection");
    return { dispatcher: { entry: entry(dispatcher.field("entry")), record: dispatcher.field("record").string(), argument: dispatcher.field("argument").integer(0), arguments: dispatcher.field("arguments").integer(1) },
      decisions: weapon.field("decisions").list(value => ({ entry: value.field("entry").integer(0), join: value.field("join").integer(0), fields: value.field("fields").list(value => ({ field: armorField(value.field("field")), clearMask: value.field("clearMask").integer(1) })) })),
      ...(weapon.field("committedInput").value === undefined ? {} : { committedInput: weapon.field("committedInput").list(value => value.list(test)) }),
      continuations: weapon.field("continuations").list(value => value.list(test)), settled: weapon.field("settled").list(value => value.list(test)), selection: { active: pointer(selection.field("active")), pending: selection.field("pending").nullable(pointer), values: selection.field("values").list(value => ({ item: namespaced(value.field("item")), address: address(value.field("address")), request: sourceCall(value.field("request")) })) } };
  })() }) };
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
    ...(reader.field("items").value === undefined ? {} : { items: nativeItems(reader.field("items")) }),
    program: { path: normalizeResourcePath(program.field("path").string()), digest: readDigest(program.field("digest")) }, target: parsedTarget,
    ...(reader.field("clientPresentation").value === undefined ? {} : { clientPresentation: {
      hud: reader.field("clientPresentation").field("hud").choice("none", "layout-overlay", "replace-status"),
      view: reader.field("clientPresentation").field("view").choice("none", "playerstate") } }),
    ...(reader.field("sourceActors").value === undefined ? {} : { sourceActors: sourceActors(reader.field("sourceActors")) }),
    ...(reader.field("protection").value === undefined && reader.field("poweredProtection").value === undefined ? {} : { protection: protections(reader) }),
    ...(reader.field("pickups").value === undefined ? {} : { pickups: reader.field("pickups").list(pickup => ({
      ...readModPickupRule(pickup, sourceCall), context: pickup.field("context").value === undefined ? [] : pickup.field("context").list(field => {
        const value = argument(field.field("value"));
        if (value.kind === "actor" || value.kind === "client" || value.kind === "userinfo" || value.kind === "string" || value.kind === "user-command") return field.fail("Native pickup context requires scalar, vector, time or image address values");
        return { record: field.field("record").string(), offset: field.field("offset").integer(0), value: value.kind === "time" || value.kind === "address" ? value : { kind: value.kind, value: value.value } };
      }) })) }),
    ...(reader.field("clients").value === undefined ? {} : { clients: {
      maximum: reader.field("clients").field("maximum").integer(1), records: reader.field("clients").field("records").list(value => value.string()),
      admit: reader.field("clients").field("admit").list(reader => ({ ...sourceCall(reader), accepts: reader.field("accepts").choice("always", "nonzero") })), userinfo: reader.field("clients").field("userinfo").list(sourceCall),
      disconnect: reader.field("clients").field("disconnect").list(sourceCall), command: reader.field("clients").field("command").list(sourceCall),
      ...(reader.field("clients").field("input").value === undefined ? {} : { input: readModClientInput(reader.field("clients").field("input"), sourceCall, inputOutput) }),
      ...(reader.field("clients").field("frame").value === undefined ? {} : { frame: reader.field("clients").field("frame").list(sourceCall) }),
      ...(reader.field("clients").field("endFrame").value === undefined ? {} : { endFrame: reader.field("clients").field("endFrame").list(sourceCall) }),
      ...(reader.field("clients").field("outputs").value === undefined ? {} : { outputs: readClientOutputDeclarations(reader.field("clients").field("outputs"),
        value => ({ record: value.field("record").string(), offset: value.field("offset").integer(0), encoding: value.field("encoding").choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64") }),
        value => ({ record: value.field("record").string(), offset: value.field("offset").integer(0) })) }),
      ...(reader.field("clients").field("pose").value === undefined ? {} : { pose: {
        viewHeight: armorField(reader.field("clients").field("pose").field("viewHeight")),
        crouched: { field: armorField(reader.field("clients").field("pose").field("crouched").field("field")), mask: reader.field("clients").field("pose").field("crouched").field("mask").integer(1) } } }),
      ...(reader.field("clients").field("inputFields").value === undefined ? {} : { inputFields: reader.field("clients").field("inputFields").list(field => {
        const value = argument(field.field("value"));
        if (value.kind === "actor" || value.kind === "client" || value.kind === "userinfo" || value.kind === "address" || value.kind === "string" || value.kind === "user-command") return field.fail("Native input fields require scalar, vector or time values");
        return { record: field.field("record").string(), offset: field.field("offset").integer(0), value: value.kind === "time" ? value : { kind: value.kind, value: value.value } };
      }) }),
    } }),
    cvars: reader.field("cvars").list(value => ({ name: value.field("name").string(), value: value.field("value").string() })),
    spawnEntities: reader.field("spawnEntities").nullable(value => value.string()), entityRecord: reader.field("entityRecord").nullable(value => value.string()),
    actorRecords: reader.field("actorRecords").list(record => ({ id: record.field("id").string(),
      base: (() => { const kind = record.field("base").field("kind").choice("entities", "clients", "address"); return kind === "address" ? { kind, ...address(record.field("base")) } : { kind }; })(),
      stride: record.field("stride").integer(4), firstSlot: record.field("firstSlot").integer(0), capacity: record.field("capacity").integer(1), fields: record.field("fields").list(field) })),
    initialize: reader.field("initialize").list(sourceCall), project: reader.field("project").list(sourceCall), release: reader.field("release").list(sourceCall),
    callbacks: reader.field("callbacks").list(reader => ({ ...binding(reader), ...sourceCall(reader) })) };
}
