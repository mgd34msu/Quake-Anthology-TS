import { readSourcePrimaryMatch } from "../../content/mods/match.ts";
import type { QvmPrimaryWeaponProfile } from "./game-weapons.ts";
import type { QvmInputDefinition } from "./game-input.ts";
import { validateQvmCombatCall, validateQvmCombatPositions, type QvmCombatCall, type QvmReactionCall } from "./game-combat.ts";
import type { QvmPrimaryCombatProfile } from "./game-combat-binding.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmModInputPointer } from "../../contracts/qvm-mod-callbacks.ts";
import type { QvmItemTest } from "../../contracts/qvm-mod-items.ts";
import type { QvmRegionEvaluation } from "./regions.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation } from "./regions.ts";
import { validateQvmWeaponDispatcher } from "./mod-weapon-stage.ts";
import { QvmOpcode, QVM_MAX_PRIVATE_ARGUMENT_WORDS } from "./image.ts";
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
  if (artifact.role !== "qagame") return reader.fail("primary player services require a qagame ABI");
  const abiProfile = artifact.abiProfile ?? "q3-modern";
  const entityStride = integer(reader.field("entityStride"), qvmSharedEntityBytes(abiProfile), artifact.image.allocatedDataLength);
  const clientStride = integer(reader.field("clientStride"), qvmPlayerStateBytes(abiProfile), artifact.image.allocatedDataLength);
  if (entityStride % 4 !== 0 || clientStride % 4 !== 0) return reader.fail("source record strides must be aligned");
  return { module: artifact.module, abiProfile, entityStride, clientStride };
}
function region(reader: SaveReader) { return { entry: reader.field("entry").integer(0), join: reader.field("join").integer(0) }; }
function evaluation(reader: SaveReader): QvmRegionEvaluation {
  return { ...region(reader), inputs: reader.field("inputs").list(value => value.integer(0)), result: reader.field("result").nullable(value => value.integer(0)) };
}
function sourcePointer(reader: SaveReader, dataBytes: number): QvmModInputPointer {
  const kind = reader.field("kind").choice("argument", "global"), path = { offset: reader.field("offset").integer(0), indirections: reader.field("indirections").list(value => value.integer(0)) };
  if ([path.offset, ...path.indirections].some(value => value % 4 !== 0)) return reader.fail("source pointer path must use aligned words");
  return kind === "argument" ? { ...path, kind, index: integer(reader.field("index"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1) }
    : { ...path, kind, address: aligned(reader.field("address"), dataBytes) };
}

export function readQvmPrimaryInput(reader: SaveReader, artifact: Artifact): QvmInputDefinition {
  const common = layout(reader, artifact), entries = reader.field("entries");
  const modes = reader.field("movementModes");
  return { ...common, ...(modes.value === undefined ? {} : { movementModes: { normal: modes.field("normal").integer(), noclip: modes.field("noclip").integer(), freeze: modes.field("freeze").integer() } }),
    clientPointer: aligned(reader.field("clientPointer"), common.entityStride), intermission: reader.field("intermission").list(value => value.integer()),
    entries: { clientThink: entry(entries.field("clientThink"), artifact), runClient: entry(entries.field("runClient"), artifact), clientSpawn: entry(entries.field("clientSpawn"), artifact),
      move: entry(entries.field("move"), artifact), slice: entry(entries.field("slice"), artifact) } };
}

/** Declarations locate original branches and records; the existing source dispatcher executes them. */
export function readQvmPrimaryWeapons(reader: SaveReader, artifact: Artifact, catalog: readonly { readonly weapon: number; readonly item: ItemId }[] | null): QvmPrimaryWeaponProfile {
  const common = layout(reader, artifact), dataBytes = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const global = (value: SaveReader) => aligned(value, dataBytes), client = (value: SaveReader, bytes = 4) => aligned(value, common.clientStride, bytes);
  const entity = (value: SaveReader) => aligned(value, common.entityStride);
  const field = (value: SaveReader) => ({ record: value.field("record").literal("client"), offset: client(value.field("offset")) });
  const test = (value: SaveReader): QvmItemTest => ({ field: field(value.field("field")), mask: value.field("mask").nullable(mask => integer(mask, 0, 0xffffffff)),
    comparison: value.field("comparison").choice("equals", "at-most"), value: integer(value.field("value"), -0x80000000, 0x7fffffff) });
  const stage = reader.field("stage"), dispatcher = stage.field("dispatcher"), selection = stage.field("selection"), request = stage.field("request"), actor = dispatcher.field("actor");
  const movement = reader.field("equipmentMovement"), availability = reader.field("availability"), powers = reader.field("powerups"), torso = reader.field("torsoAnimation");
  const equipmentContexts = reader.field("equipmentContexts").list(value => ({ provider: namespaced(value.field("provider")), item: value.field("item").nullable(namespaced) }));
  if (new Set(equipmentContexts.map(context => context.provider)).size !== equipmentContexts.length) reader.field("equipmentContexts").fail("duplicate equipment source context");
  const damage = reader.field("damageFactor"), delay = reader.field("delayPlayer"), water = reader.field("waterLevel"), teleport = reader.field("teleport"), drop = reader.field("drop"), give = reader.field("give"), named = give.field("named");
  const profile: QvmPrimaryWeaponProfile = { ...common, ...(reader.field("match").value === undefined ? {} : { match: readSourcePrimaryMatch(reader.field("match"), common.clientStride) }), clientPointer: entity(reader.field("clientPointer")), maxHealth: client(reader.field("maxHealth")), persistentMaxHealth: client(reader.field("persistentMaxHealth")),
    stage: { dispatcher: { entry: entry(dispatcher.field("entry"), artifact), actor: { record: actor.field("record").literal("client"), pointer: sourcePointer(actor.field("pointer"), dataBytes) } },
      predicates: stage.field("predicates").list(value => ({ instruction: value.field("instruction").integer(0), unselected: value.field("unselected").boolean() })),
      settled: stage.field("settled").list(test), selection: { field: field(selection.field("field")), values: selection.field("values").list(value => ({ value: integer(value.field("value"), 1, 0x7fffffff), item: namespaced(value.field("item")) })) },
      request: { entry: entry(request.field("entry"), artifact), argument: integer(request.field("argument"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1), accepted: request.field("accepted").list(test) } },
    equipmentMovement: { ...(movement.field("bodyTrace").value === undefined ? {} : { bodyTrace: { callback: aligned(movement.field("bodyTrace").field("callback"), artifact.image.allocatedDataLength, 4), mask: aligned(movement.field("bodyTrace").field("mask"), artifact.image.allocatedDataLength, 4) } }), move: entry(movement.field("move"), artifact), slice: entry(movement.field("slice"), artifact), duck: entry(movement.field("duck"), artifact), movementGlobal: global(movement.field("movementGlobal")),
      locomotion: region(movement.field("locomotion")), mins: aligned(movement.field("mins"), artifact.image.allocatedDataLength, 12), maxs: aligned(movement.field("maxs"), artifact.image.allocatedDataLength, 12) },
    availability: { movementType: client(availability.field("movementType")), excluded: availability.field("excluded").list(value => value.integer()), health: client(availability.field("health")), team: client(availability.field("team")), spectatorTeam: availability.field("spectatorTeam").integer(), flags: client(availability.field("flags")), respawnFlag: integer(availability.field("respawnFlag"), 1, 0x7fffffff) },
    powerups: { quad: client(powers.field("quad")), haste: client(powers.field("haste")), flight: client(powers.field("flight")) },
    torsoAnimation: { entry: entry(torso.field("entry"), artifact), attack: torso.field("attack").integer(0), melee: torso.field("melee").integer(0) },
    waterLevel: { entityOffset: entity(water.field("entityOffset")), movementOffset: aligned(water.field("movementOffset"), artifact.image.allocatedDataLength) },
    damageFactor: { entry: entry(damage.field("entry"), artifact), result: global(damage.field("result")), stop: region(damage.field("stop")) },
    equipmentContexts, delay: evaluation(reader.field("delay")), delayPlayer: { movementGlobal: global(delay.field("movementGlobal")), playerOffset: aligned(delay.field("playerOffset"), artifact.image.allocatedDataLength) },
    teleport: { entry: entry(teleport.field("entry"), artifact), region: evaluation(teleport.field("region")), objectives: evaluation(teleport.field("objectives")), spawn: entry(teleport.field("spawn"), artifact), view: entry(teleport.field("view"), artifact) },
    drop: { entry: entry(drop.field("entry"), artifact), argument: integer(drop.field("argument"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1), weapon: entity(drop.field("weapon")), ammo: drop.field("ammo").value === "inventory" ? drop.field("ammo").literal("inventory") : client(drop.field("ammo"), 64), region: region(drop.field("region")) },
    give: { entry: entry(give.field("entry"), artifact), argument: integer(give.field("argument"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1), weapons: give.field("weapons").integer(0), ammo: give.field("ammo").integer(0),
      named: { ...region(named), name: named.field("name").integer(0), item: named.field("item").integer(0) } } };
  if (new Set(profile.stage.selection.values.map(value => value.value)).size !== profile.stage.selection.values.length
    || new Set(profile.stage.selection.values.map(value => value.item)).size !== profile.stage.selection.values.length) return selection.fail("weapon selection repeats source values or identities");
  if (catalog !== null && (profile.stage.selection.values.length !== catalog.length || new Set(profile.stage.selection.values.map(value => value.value)).size !== catalog.length
    || profile.stage.selection.values.some(value => !catalog.some(item => item.weapon === value.value && item.item === value.item)))) return selection.fail("weapon selection differs from the original item catalog");
  if (typeof profile.drop.ammo === "number" && profile.stage.selection.values.some(value => profile.drop.ammo !== "inventory" && profile.drop.ammo + value.value * 4 + 4 > common.clientStride))
    return drop.fail("original drop ammo indexing exceeds its declared client record");
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

function reactionCall(reader: SaveReader): QvmReactionCall {
  const roles = reader.field("roles"), result = { arguments: integer(reader.field("arguments"), 2, QVM_MAX_PRIVATE_ARGUMENT_WORDS),
    roles: { target: integer(roles.field("target"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1), amount: integer(roles.field("amount"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1) } };
  try { validateQvmCombatPositions(Object.values(result.roles), result.arguments); }
  catch (error) { return reader.fail(error instanceof Error ? error.message : "invalid source reaction arguments"); }
  return result;
}

function combatExtras(reader: SaveReader): QvmCombatCall<string>["extras"] {
  return reader.list(extra => ({ index: integer(extra.field("index"), 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1), kind: extra.field("kind").choice("int32", "float32", "address"), value: extra.field("value").finite() }));
}

export function readQvmPrimaryCombat(reader: SaveReader, artifact: Artifact): QvmPrimaryCombatProfile {
  const common = layout(reader, artifact), fields = reader.field("fields"), callbacks = reader.field("callbacks"), reactions = reader.field("reactions"), armor = reader.field("armor");
  const privateField = (value: SaveReader) => {
    const offset = aligned(value, common.entityStride); if (offset < qvmSharedEntityBytes(common.abiProfile)) return value.fail("private field overlaps the public entity ABI"); return offset;
  };
  const fraction = (value: SaveReader): number => { const result = value.finite(); if (result < 0 || result > 1 || Math.fround(result) !== result) return value.fail("expected an original binary32 armor fraction"); return result; };
  const tiers = armor.field("tiers"), dataBytes = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const state = reader.field("state"), team = state.field("team"), flags = state.field("flags"), mass = state.field("mass"), damageFlags = reader.field("damageFlags");
  const mask = (value: SaveReader): number => { const result = integer(value, 1, 0xffffffff); if ((result & (result - 1)) !== 0) return value.fail("expected an individual source flag"); return result; };
  const damageCall = reader.field("damageCall"), damageRoles = damageCall.field("roles"), armorCall = armor.field("call"), armorRoles = armorCall.field("roles");
  const position = (value: SaveReader): number => integer(value, 0, QVM_MAX_PRIVATE_ARGUMENT_WORDS - 1);
  const result: QvmPrimaryCombatProfile = { ...common,
    damageCall: { roles: { target: position(damageRoles.field("target")), inflictor: position(damageRoles.field("inflictor")), attacker: position(damageRoles.field("attacker")),
      direction: position(damageRoles.field("direction")), point: position(damageRoles.field("point")), amount: position(damageRoles.field("amount")), flags: position(damageRoles.field("flags")), method: position(damageRoles.field("method")) },
      extras: combatExtras(damageCall.field("extras")) },
    state: { healthStat: integer(state.field("healthStat"), 0, 15), team: { persistentStat: integer(team.field("persistentStat"), 0, 15),
      values: team.field("values").list(value => ({ value: integer(value.field("value"), -0x80000000, 0x7fffffff), team: namespaced(value.field("team")) })) },
      flags: { notarget: mask(flags.field("notarget")), invulnerable: mask(flags.field("invulnerable")), noKnockback: mask(flags.field("noKnockback")) },
      mass: mass.field("kind").choice("constant", "entity") === "constant" ? { kind: "constant", value: mass.field("value").finite() }
        : { kind: "entity", offset: privateField(mass.field("offset")), storage: mass.field("storage").choice("int32", "float32") } },
    damageFlags: { radius: mask(damageFlags.field("radius")), noArmor: mask(damageFlags.field("noArmor")), noKnockback: mask(damageFlags.field("noKnockback")),
      noProtection: mask(damageFlags.field("noProtection")), noTeamProtection: mask(damageFlags.field("noTeamProtection")) }, fields: { inuse: privateField(fields.field("inuse")), health: privateField(fields.field("health")), takedamage: privateField(fields.field("takedamage")), parent: privateField(fields.field("parent")), client: privateField(fields.field("client")) },
    callbacks: { allocate: entry(callbacks.field("allocate"), artifact), free: entry(callbacks.field("free"), artifact), damage: entry(callbacks.field("damage"), artifact) },
    reactions: { flags: privateField(reactions.field("flags")), pain: privateField(reactions.field("pain")), die: privateField(reactions.field("die")), painCall: reactionCall(reactions.field("painCall")), dieCall: reactionCall(reactions.field("dieCall")) }, grappleDamageMethod: reader.field("grappleDamageMethod").integer(0),
    armor: { checkArmor: entry(armor.field("checkArmor"), artifact), call: { roles: { target: position(armorRoles.field("target")), amount: position(armorRoles.field("amount")), flags: position(armorRoles.field("flags")) }, extras: combatExtras(armorCall.field("extras")) }, pointsStat: integer(armor.field("pointsStat"), 0, 15), protection: fraction(armor.field("protection")), tiers: tiers.value === null ? null : {
      stat: integer(tiers.field("stat"), 0, 15), whenAny: tiers.field("whenAny").list(value => ({ offset: aligned(value.field("offset"), dataBytes), comparison: value.field("comparison").choice("equal", "not-equal"), value: integer(value.field("value"), -0x80000000, 0x7fffffff) })),
      values: tiers.field("values").list(value => ({ tier: integer(value.field("tier"), -0x80000000, 0x7fffffff), protection: fraction(value.field("protection")) })), fallback: fraction(tiers.field("fallback")) } } };
  for (const [call, location] of [[result.damageCall, damageCall], [result.armor.call, armorCall]] satisfies readonly (readonly [QvmCombatCall<string>, SaveReader])[]) {
    try { validateQvmCombatCall(call, dataBytes); }
    catch (error) { return location.fail(error instanceof Error ? error.message : "invalid source combat arguments"); }
  }
  if (result.state.mass.kind === "constant" && result.state.mass.value < 0) return mass.fail("source mass must be nonnegative");
  if (new Set(result.state.team.values.map(value => value.value)).size !== result.state.team.values.length) return team.fail("source team values must be unique");
  for (const values of [Object.values(result.state.flags), Object.values(result.damageFlags)]) if (new Set(values).size !== values.length) return reader.fail("source combat flags overlap");
  const tier = result.armor.tiers;
  if (tier !== null && (tier.stat === result.armor.pointsStat || tier.whenAny.length === 0 || tier.values.length === 0 || new Set(tier.values.map(value => value.tier)).size !== tier.values.length)) return tiers.fail("armor tier declaration is empty or ambiguous");
  return result;
}
