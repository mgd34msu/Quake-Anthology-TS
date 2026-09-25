import type { QvmPrimaryWeaponProfile } from "./game-weapons.ts";
import type { QvmInputDefinition } from "./game-input.ts";
import type { QvmPrimaryCombatProfile } from "./game-combat-binding.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmModInputPointer } from "../../contracts/qvm-mod-callbacks.ts";
import type { QvmItemTest } from "../../contracts/qvm-mod-items.ts";
import type { QvmRegionEvaluation } from "./regions.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation } from "./regions.ts";
import { validateQvmWeaponDispatcher } from "./mod-weapon-stage.ts";
import { QvmOpcode } from "./image.ts";
import { qvmPlayerStateBytes } from "./player-record.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";
import { namespaced, type SaveReader } from "../../persistence/value.ts";
import type { ItemId } from "../../contracts/gameplay.ts";

type Artifact = QvmModuleOptions["artifact"];
function integer(reader: SaveReader, minimum: number, maximum: number): number {
  const value = reader.integer(minimum); if (value > maximum) return reader.fail("value exceeds its source range"); return value;
}
function aligned(reader: SaveReader, bytes: number, size = 4): number {
  const value = integer(reader, 0, bytes - size); if (value % 4 !== 0) return reader.fail("source word is unaligned"); return value;
}
function entry(reader: SaveReader, artifact: Artifact): number {
  const value = reader.integer(0); if (artifact.image.instructions[value]?.opcode !== QvmOpcode.OP_ENTER) return reader.fail("not an original function entry"); return value;
}
function layout(reader: SaveReader, artifact: Artifact) {
  if (artifact.role !== "qagame" || artifact.abiProfile !== "q3-modern") return reader.fail("primary player services require their modern Q3 public ABI");
  const entityStride = integer(reader.field("entityStride"), qvmSharedEntityBytes(artifact.abiProfile), artifact.image.allocatedDataLength);
  const clientStride = integer(reader.field("clientStride"), qvmPlayerStateBytes(artifact.abiProfile), artifact.image.allocatedDataLength);
  if (entityStride % 4 !== 0 || clientStride % 4 !== 0) return reader.fail("source record strides must be aligned");
  return { module: artifact.module, abiProfile: artifact.abiProfile, entityStride, clientStride };
}
function region(reader: SaveReader) { return { entry: reader.field("entry").integer(0), join: reader.field("join").integer(0) }; }
function evaluation(reader: SaveReader): QvmRegionEvaluation {
  return { ...region(reader), inputs: reader.field("inputs").list(value => value.integer(0)), result: reader.field("result").nullable(value => value.integer(0)) };
}
function sourcePointer(reader: SaveReader, dataBytes: number): QvmModInputPointer {
  const kind = reader.field("kind").choice("argument", "global"), path = { offset: reader.field("offset").integer(0), indirections: reader.field("indirections").list(value => value.integer(0)) };
  if ([path.offset, ...path.indirections].some(value => value % 4 !== 0)) return reader.fail("source pointer path must use aligned words");
  return kind === "argument" ? { ...path, kind, index: integer(reader.field("index"), 0, 9) }
    : { ...path, kind, address: aligned(reader.field("address"), dataBytes) };
}

export function readQvmPrimaryInput(reader: SaveReader, artifact: Artifact): QvmInputDefinition {
  const common = layout(reader, artifact), entries = reader.field("entries");
  return { ...common, clientPointer: aligned(reader.field("clientPointer"), common.entityStride), intermission: reader.field("intermission").list(value => value.integer()),
    entries: { clientThink: entry(entries.field("clientThink"), artifact), runClient: entry(entries.field("runClient"), artifact), clientSpawn: entry(entries.field("clientSpawn"), artifact),
      move: entry(entries.field("move"), artifact), slice: entry(entries.field("slice"), artifact) } };
}

/** Declarations locate original branches and records; the existing source dispatcher executes them. */
export function readQvmPrimaryWeapons(reader: SaveReader, artifact: Artifact, catalog: readonly { readonly weapon: number; readonly item: ItemId }[]): QvmPrimaryWeaponProfile {
  const common = layout(reader, artifact), dataBytes = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const global = (value: SaveReader) => aligned(value, dataBytes), client = (value: SaveReader, bytes = 4) => aligned(value, common.clientStride, bytes);
  const entity = (value: SaveReader) => aligned(value, common.entityStride);
  const field = (value: SaveReader) => ({ record: value.field("record").literal("client"), offset: client(value.field("offset")) });
  const test = (value: SaveReader): QvmItemTest => ({ field: field(value.field("field")), mask: value.field("mask").nullable(mask => integer(mask, 0, 0xffffffff)),
    comparison: value.field("comparison").choice("equals", "at-most"), value: integer(value.field("value"), -0x80000000, 0x7fffffff) });
  const stage = reader.field("stage"), dispatcher = stage.field("dispatcher"), selection = stage.field("selection"), request = stage.field("request"), actor = dispatcher.field("actor");
  const movement = reader.field("equipmentMovement"), availability = reader.field("availability"), powers = reader.field("powerups"), torso = reader.field("torsoAnimation");
  const damage = reader.field("damageFactor"), delay = reader.field("delayPlayer"), water = reader.field("waterLevel"), teleport = reader.field("teleport"), drop = reader.field("drop"), give = reader.field("give"), named = give.field("named");
  const profile: QvmPrimaryWeaponProfile = { ...common, clientPointer: entity(reader.field("clientPointer")), maxHealth: client(reader.field("maxHealth")), persistentMaxHealth: client(reader.field("persistentMaxHealth")),
    stage: { dispatcher: { entry: entry(dispatcher.field("entry"), artifact), actor: { record: actor.field("record").literal("client"), pointer: sourcePointer(actor.field("pointer"), dataBytes) } },
      predicates: stage.field("predicates").list(value => ({ instruction: value.field("instruction").integer(0), unselected: value.field("unselected").boolean() })),
      settled: stage.field("settled").list(test), selection: { field: field(selection.field("field")), values: selection.field("values").list(value => ({ value: integer(value.field("value"), 1, 15), item: namespaced(value.field("item")) })) },
      request: { entry: entry(request.field("entry"), artifact), argument: integer(request.field("argument"), 0, 9), accepted: request.field("accepted").list(test) } },
    equipmentMovement: { move: entry(movement.field("move"), artifact), slice: entry(movement.field("slice"), artifact), duck: entry(movement.field("duck"), artifact), movementGlobal: global(movement.field("movementGlobal")),
      locomotion: region(movement.field("locomotion")), mins: aligned(movement.field("mins"), artifact.image.allocatedDataLength, 12), maxs: aligned(movement.field("maxs"), artifact.image.allocatedDataLength, 12) },
    availability: { movementType: client(availability.field("movementType")), excluded: availability.field("excluded").list(value => value.integer()), health: client(availability.field("health")), team: client(availability.field("team")), spectatorTeam: availability.field("spectatorTeam").integer(), flags: client(availability.field("flags")), respawnFlag: integer(availability.field("respawnFlag"), 1, 0x7fffffff) },
    powerups: { quad: client(powers.field("quad")), haste: client(powers.field("haste")), flight: client(powers.field("flight")) },
    torsoAnimation: { entry: entry(torso.field("entry"), artifact), attack: torso.field("attack").integer(0), melee: torso.field("melee").integer(0) },
    waterLevel: { entityOffset: entity(water.field("entityOffset")), movementOffset: aligned(water.field("movementOffset"), artifact.image.allocatedDataLength) },
    damageFactor: { entry: entry(damage.field("entry"), artifact), result: global(damage.field("result")), stop: region(damage.field("stop")) },
    delay: evaluation(reader.field("delay")), delayPlayer: { movementGlobal: global(delay.field("movementGlobal")), playerOffset: aligned(delay.field("playerOffset"), artifact.image.allocatedDataLength) },
    teleport: { entry: entry(teleport.field("entry"), artifact), region: evaluation(teleport.field("region")), objectives: evaluation(teleport.field("objectives")), spawn: entry(teleport.field("spawn"), artifact), view: entry(teleport.field("view"), artifact) },
    drop: { entry: entry(drop.field("entry"), artifact), argument: integer(drop.field("argument"), 0, 9), weapon: entity(drop.field("weapon")), ammo: client(drop.field("ammo"), 64), region: region(drop.field("region")) },
    give: { entry: entry(give.field("entry"), artifact), argument: integer(give.field("argument"), 0, 9), weapons: give.field("weapons").integer(0), ammo: give.field("ammo").integer(0),
      named: { ...region(named), name: named.field("name").integer(0), item: named.field("item").integer(0) } } };
  if (profile.stage.selection.values.length !== catalog.length || new Set(profile.stage.selection.values.map(value => value.value)).size !== catalog.length
    || profile.stage.selection.values.some(value => !catalog.some(item => item.weapon === value.value && item.item === value.item))) return selection.fail("weapon selection differs from the original item catalog");
  validateQvmWeaponDispatcher(profile.stage, artifact.image);
  qualifyQvmRegion(artifact.image.instructions, profile.equipmentMovement.slice, profile.equipmentMovement.locomotion.entry, profile.equipmentMovement.locomotion.join);
  qualifyQvmRegion(artifact.image.instructions, profile.damageFactor.entry, profile.damageFactor.stop.entry, profile.damageFactor.stop.join);
  qualifyQvmRegionEvaluation(artifact.image.instructions, profile.stage.dispatcher.entry, profile.delay);
  qualifyQvmRegionEvaluation(artifact.image.instructions, profile.teleport.entry, profile.teleport.region);
  qualifyQvmRegionEvaluation(artifact.image.instructions, profile.teleport.entry, profile.teleport.objectives);
  qualifyQvmRegion(artifact.image.instructions, profile.give.entry, profile.give.named.entry, profile.give.named.join);
  qualifyQvmRegion(artifact.image.instructions, profile.drop.entry, profile.drop.region.entry, profile.drop.region.join);
  if (profile.delay.inputs.length !== 1 || profile.delay.result === null || profile.teleport.region.inputs.length !== 0 || profile.teleport.objectives.inputs.length !== 0)
    return reader.fail("source effect region inputs differ from the primary player ABI");
  const giveEntry = artifact.image.instructions[profile.give.entry];
  if (giveEntry?.opcode !== QvmOpcode.OP_ENTER) return give.fail("give entry disappeared");
  for (const offset of [profile.give.named.name, profile.give.named.item])
    if (offset < 8 || offset % 4 !== 0 || offset + 4 > giveEntry.operand) return named.fail("named grant local exceeds its original function frame");
  const entries = [profile.stage.dispatcher.entry, profile.stage.request.entry, profile.equipmentMovement.duck, profile.give.entry,
    profile.drop.entry, profile.damageFactor.entry, profile.teleport.entry];
  if (new Set(entries).size !== entries.length) return reader.fail("primary weapon interfaces overlap original function ownership");
  for (const pc of [profile.give.weapons, profile.give.ammo]) {
    const opcode = artifact.image.instructions[pc]?.opcode;
    let owner = pc; while (owner >= 0 && artifact.image.instructions[owner]?.opcode !== QvmOpcode.OP_ENTER) owner--;
    if (owner !== profile.give.entry || opcode === undefined || opcode < QvmOpcode.OP_EQ || opcode > QvmOpcode.OP_GEF || pc <= profile.give.entry) return give.fail("give completion is not an original decision");
  }
  return profile;
}

export function readQvmPrimaryCombat(reader: SaveReader, artifact: Artifact): QvmPrimaryCombatProfile {
  const common = layout(reader, artifact), fields = reader.field("fields"), callbacks = reader.field("callbacks"), reactions = reader.field("reactions"), armor = reader.field("armor");
  const privateField = (value: SaveReader) => {
    const offset = aligned(value, common.entityStride); if (offset < qvmSharedEntityBytes(common.abiProfile)) return value.fail("private field overlaps the public entity ABI"); return offset;
  };
  const fraction = (value: SaveReader): number => { const result = value.finite(); if (result < 0 || result > 1 || Math.fround(result) !== result) return value.fail("expected an original binary32 armor fraction"); return result; };
  const tiers = armor.field("tiers"), dataBytes = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const result: QvmPrimaryCombatProfile = { ...common, fields: { inuse: privateField(fields.field("inuse")), health: privateField(fields.field("health")), takedamage: privateField(fields.field("takedamage")), parent: privateField(fields.field("parent")), client: fields.field("client").literal(516) },
    callbacks: { allocate: entry(callbacks.field("allocate"), artifact), free: entry(callbacks.field("free"), artifact), damage: entry(callbacks.field("damage"), artifact) },
    reactions: { flags: privateField(reactions.field("flags")), pain: privateField(reactions.field("pain")), die: privateField(reactions.field("die")) }, grappleDamageMethod: reader.field("grappleDamageMethod").integer(0),
    armor: { checkArmor: entry(armor.field("checkArmor"), artifact), pointsStat: integer(armor.field("pointsStat"), 0, 15), protection: fraction(armor.field("protection")), tiers: tiers.value === null ? null : {
      stat: integer(tiers.field("stat"), 0, 15), whenAny: tiers.field("whenAny").list(value => ({ offset: aligned(value.field("offset"), dataBytes), comparison: value.field("comparison").choice("equal", "not-equal"), value: integer(value.field("value"), -0x80000000, 0x7fffffff) })),
      values: tiers.field("values").list(value => ({ tier: integer(value.field("tier"), -0x80000000, 0x7fffffff), protection: fraction(value.field("protection")) })), fallback: fraction(tiers.field("fallback")) } } };
  const tier = result.armor.tiers;
  if (tier !== null && (tier.stat === result.armor.pointsStat || tier.whenAny.length === 0 || tier.values.length === 0 || new Set(tier.values.map(value => value.tier)).size !== tier.values.length)) return tiers.fail("armor tier declaration is empty or ambiguous");
  return result;
}
