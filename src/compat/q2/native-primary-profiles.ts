import type { ContentDigest } from "../../contracts/content.ts";
import type { NativeAbi } from "../../contracts/execution.ts";
import { namespaced } from "../../persistence/value.ts";
import type { SaveReader } from "../../persistence/value.ts";
import type { NativePrimaryWeaponProfile } from "./native-primary-weapons.ts";
import type { NativePrimaryPlayerProfile } from "./native-primary-player.ts";
import type { NativePrimaryCommandProfile } from "./native-primary-commands.ts";
import type { NativePrimaryInventoryProfile } from "./native-primary-inventory.ts";
import type { NativePrimaryDropProfile } from "./native-primary-drop.ts";
import type { NativePickupProfile, NativePickupGrant } from "./native-pickups.ts";
import { nativeOffset as offset, nativeRegion as region, nativeScalar as scalar, nativeField as field, nativeTest as test, nativeRegister as register, nativeSignature as signature } from "./native-primary-reader.ts";

export function readNativePrimaryWeapons(reader: SaveReader, digest: ContentDigest, abi: NativeAbi): NativePrimaryWeaponProfile {
  const dispatcher = reader.field("dispatcher"), spawn = reader.field("spawn"), time = reader.field("time"), entity = reader.field("entity"), client = reader.field("client"),
    animation = reader.field("animation"), attack = reader.field("attackAnimation"), delay = reader.field("delay"), evaluate = delay.field("evaluate"), damage = reader.field("damage");
  dispatcher.field("entry").field("kind").literal("rva");
  const argument = dispatcher.field("argument").integer(0), arguments_ = dispatcher.field("arguments").integer(1);
  if (argument >= arguments_) dispatcher.fail("dispatcher actor argument is outside its call");
  const milliseconds = time.field("milliseconds").finite(); if (milliseconds <= 0) time.fail("clock scale must be positive");
  return { digest, abi, dispatcher: { entry: { kind: "rva", rva: offset(dispatcher.field("entry").field("rva")) }, record: dispatcher.field("record").literal("entity"), argument, arguments: arguments_ },
    decisions: reader.field("decisions").list(value => ({ ...region(value), fields: value.field("fields").list(value => ({ field: field(value.field("field")), clearMask: value.field("clearMask").integer(1) })) })),
    spawn: { entry: offset(spawn.field("entry")), accepted: spawn.field("accepted").list(test) }, active: reader.field("active").list(test),
    committedInput: reader.field("committedInput").list(value => value.list(test)), continuations: reader.field("continuations").list(value => value.list(test)),
    time: { address: offset(time.field("address")), encoding: scalar(time.field("encoding")), milliseconds },
    entity: { client: offset(entity.field("client")), waterLevel: field(entity.field("waterLevel")), viewHeight: field(entity.field("viewHeight")), maxHealth: field(entity.field("maxHealth")) },
    client: { byteLength: client.field("byteLength").integer(1), viewAngles: offset(client.field("viewAngles")), buttons: field(client.field("buttons")), latchedButtons: field(client.field("latchedButtons")) },
    attackAnimation: { entry: offset(attack.field("entry")), skip: attack.field("skip").list(region) },
    animation: { frame: field(animation.field("frame")), end: field(animation.field("end")), priority: field(animation.field("priority")), duck: field(animation.field("duck")), run: field(animation.field("run")) },
    delay: { flag: field(delay.field("flag")), region: region(delay.field("region")), evaluate: evaluate.field("kind").choice("source-flag", "source-animation") === "source-flag"
      ? { kind: "source-flag", factors: evaluate.field("factors").list(value => value.finite()) }
      : { kind: "source-animation", entry: offset(evaluate.field("entry")), baselineMilliseconds: evaluate.field("baselineMilliseconds").finite(),
        projection: evaluate.field("projection").list(value => ({ field: field(value.field("field")), value: value.field("value").finite() })), writes: evaluate.field("writes").list(field) } },
    damage: damage.field("kind").choice("source-result", "source-flag") === "source-result"
      ? { kind: "source-result", entry: offset(damage.field("entry")), result: damage.field("result").choice("uint8", "int32") }
      : { kind: "source-flag", address: offset(damage.field("address")), encoding: scalar(damage.field("encoding")), factors: damage.field("factors").list(value => value.finite()), region: region(damage.field("region")) } };
}
export function readNativePrimaryPlayer(reader: SaveReader, digest: ContentDigest): NativePrimaryPlayerProfile {
  const objectives = reader.field("objectives");
  return { digest, spawn: offset(reader.field("spawn")), objectives: objectives.field("kind").choice("none", "entry") === "none" ? { kind: "none" } : { kind: "entry", entry: offset(objectives.field("entry")) },
    commandAngles: offset(reader.field("commandAngles")), velocity: offset(reader.field("velocity")), forward: reader.field("forward").nullable(offset) };
}
export function readNativePrimaryCommands(reader: SaveReader, digest: ContentDigest, abi: NativeAbi): NativePrimaryCommandProfile {
  const give = reader.field("give"), drop = reader.field("drop"), client = reader.field("client"), items = reader.field("items"), ammo = items.field("ammo");
  return { digest, abi, give: { entry: offset(give.field("entry")), weapons: offset(give.field("weapons")), ammo: offset(give.field("ammo")), unknown: region(give.field("unknown")),
    ammoGrants: give.field("ammoGrants").list(value => ({ ...region(value), descriptor: register(value.field("descriptor")), kind: value.field("kind").choice("set", "add") })), argc: offset(give.field("argc")), argv: offset(give.field("argv")) },
    drop: { entry: offset(drop.field("entry")), eligibility: region(drop.field("eligibility")) },
    client: { pointer: offset(client.field("pointer")), weapon: offset(client.field("weapon")), ammoIndex: client.field("ammoIndex").nullable(offset), inventory: offset(client.field("inventory")) },
    items: { table: offset(items.field("table")), stride: items.field("stride").integer(1), count: items.field("count").integer(1), classname: offset(items.field("classname")), flags: offset(items.field("flags")), weaponFlag: items.field("weaponFlag").integer(1), ammunitionFlag: items.field("ammunitionFlag").integer(1), icon: offset(items.field("icon")),
      ammo: ammo.field("kind").choice("name", "index") === "name" ? { kind: "name", offset: offset(ammo.field("offset")), label: offset(ammo.field("label")) } : { kind: "index", offset: offset(ammo.field("offset")) } } };
}
export function readNativePrimaryInventory(reader: SaveReader, digest: ContentDigest, abi: NativeAbi): NativePrimaryInventoryProfile {
  const prototypes = reader.field("prototypes");
  const next = reader.field("next"), previous = reader.field("previous"), validate = reader.field("validate"), use = reader.field("use"), namedUse = reader.field("namedUse");
  return { digest, abi, client: offset(reader.field("client")), inventory: offset(reader.field("inventory")), count: reader.field("count").integer(1), cursor: offset(reader.field("cursor")), empty: reader.field("empty").integer(),
    prototypes: { weapon: namespaced(prototypes.field("weapon")), ammunition: namespaced(prototypes.field("ammunition")), usable: namespaced(prototypes.field("usable")), passive: namespaced(prototypes.field("passive")), droppable: namespaced(prototypes.field("droppable")), undroppable: namespaced(prototypes.field("undroppable")) },
    selectionWrites: reader.field("selectionWrites").list(value => ({ offset: offset(value.field("offset")), bytes: value.field("bytes").integer(1) })),
    next: { ...region(next), scan: offset(next.field("scan")), menuArgument: next.field("menuArgument").boolean() }, previous: { ...region(previous), scan: offset(previous.field("scan")) },
    validate: { entry: offset(validate.field("entry")), scan: validate.field("scan").nullable(region) },
    use: { ...region(use), call: offset(use.field("call")) }, namedUse: { ...region(namedUse), call: offset(namedUse.field("call")), lookupCall: offset(namedUse.field("lookupCall")), lookupReturn: offset(namedUse.field("lookupReturn")) } };
}
export function readNativePrimaryDrop(reader: SaveReader, digest: ContentDigest, abi: NativeAbi): NativePrimaryDropProfile {
  const client = reader.field("client"), inventory = reader.field("inventory");
  return { digest, abi, client: { pointer: offset(client.field("pointer")), inventory: offset(client.field("inventory")), cursor: offset(client.field("cursor")), weapon: offset(client.field("weapon")), pending: offset(client.field("pending")) },
    named: offset(reader.field("named")), inventory: { entry: offset(inventory.field("entry")), admitted: offset(inventory.field("admitted")) }, find: offset(reader.field("find")), lookupReturn: offset(reader.field("lookupReturn")),
    allocate: offset(reader.field("allocate")), free: offset(reader.field("free")), callbacks: reader.field("callbacks").list(region), debits: reader.field("debits").list(region), consumer: reader.field("consumer").nullable(region) };
}
export function readNativePrimaryPickups(reader: SaveReader, digest: ContentDigest, abi: NativeAbi): NativePickupProfile {
  const items = reader.field("items"), entity = reader.field("entity"), time = reader.field("time"), supply = reader.field("supply"), ammo = supply.field("ammo");
  return { digest, touch: offset(reader.field("touch")), grantReturn: offset(reader.field("grantReturn")), targetsReturn: offset(reader.field("targetsReturn")),
    touchSignature: signature(reader.field("touchSignature"), abi), grantSignature: signature(reader.field("grantSignature"), abi),
    grants: reader.field("grants").list((value): NativePickupGrant => ({ entry: offset(value.field("entry")), recipient: region(value.field("recipient")), resource: value.field("resource").choice("regular", "inventory"),
      ...(value.field("consumers").value === undefined ? {} : { consumers: value.field("consumers").list(value => ({ entry: offset(value.field("entry")), signature: signature(value.field("signature"), abi), protection: value.field("protection").choice("regular", "powered") })) }),
      ...(value.field("supply").value === undefined ? {} : { supply: value.field("supply").field("kind").choice("ammo", "weapon") === "ammo"
        ? { kind: "ammo", entry: offset(value.field("supply").field("entry")), amount: register(value.field("supply").field("amount")) }
        : { kind: "weapon", ammoReturn: offset(value.field("supply").field("ammoReturn")), settle: offset(value.field("supply").field("settle")), autoswitch: region(value.field("supply").field("autoswitch")) } }) })),
    items: { table: offset(items.field("table")), stride: items.field("stride").integer(1), count: items.field("count").integer(1), classname: offset(items.field("classname")), pickup: offset(items.field("pickup")) },
    entity: { item: offset(entity.field("item")), count: offset(entity.field("count")), spawnflags: offset(entity.field("spawnflags")), inuse: offset(entity.field("inuse")), inuseBytes: entity.field("inuseBytes").choice(1, 4), generation: entity.field("generation").nullable(offset) },
    time: { address: offset(time.field("address")), storage: time.field("storage").choice("float32-seconds", "int64-milliseconds") },
    supply: { client: offset(supply.field("client")), inventory: offset(supply.field("inventory")), flags: offset(supply.field("flags")), weaponFlag: supply.field("weaponFlag").integer(1),
      ammo: { entry: offset(ammo.field("entry")), signature: signature(ammo.field("signature"), abi), stop: ammo.field("stop").nullable(offset), tag: offset(ammo.field("tag")), capacities: ammo.field("capacities").list(offset), capacityBytes: ammo.field("capacityBytes").choice(2, 4) } } };
}
