import type { NativePrimaryProfile } from "./native-primary.ts";
import type { NativeItemField, NativeItemTest } from "../../contracts/native-mod-items.ts";
import type { NativeModScalar } from "../../contracts/native-mod-callbacks.ts";
import type { PeFile } from "../../guest/pe/format.ts";
import { fieldOffset } from "./rerelease/layouts.ts";

const widths: Readonly<Record<NativeModScalar, number>> = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, int64: 8, uint64: 8, float32: 4, float64: 8 };
/** Admission checks the exact source records and executable addresses before Init can run. */
export function validateNativePrimary(profile: NativePrimaryProfile, pe: PeFile): void {
  const { weapons, player, commands, inventory, drop, pickups } = profile;
  const entityBytes = profile.edition === "classic" ? profile.world.entityBytes : profile.world.edict.byteLength, clientBytes = weapons.client.byteLength;
  const bound = (offset: number, bytes: number, limit: number): void => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(bytes) || offset < 0 || bytes < 1 || offset + bytes > limit) throw new Error("Native primary field exceeds its declared source record");
  };
  const image = (offset: number, bytes: number, execute = false): void => {
    bound(offset, bytes, pe.imageSize);
    if (!pe.sections.some(section => offset >= section.rva && offset + bytes <= section.rva + section.mappedSize
      && (execute ? section.permissions.includes("execute") : section.permissions !== "none"))) throw new Error("Native primary address has no matching image section");
  };
  for (const call of Object.values(profile.world.calls)) for (const argument of call.arguments)
    if (argument.kind === "address" && argument.address !== null) image(argument.address.rva + (argument.address.indirections[0] ?? 0), argument.address.indirections.length === 0 ? 1 : pe.abi.pointerBytes);
  const record = (name: string, offset: number, bytes: number): void => {
    if (name === "image") image(offset, bytes);
    else if (name === "entity") bound(offset, bytes, entityBytes);
    else if (name === "client") bound(offset, bytes, clientBytes);
    else throw new Error("Native primary field has no declared source record");
  };
  const field = (value: NativeItemField): void => record(value.record, value.offset, widths[value.encoding]);
  const test = (value: NativeItemTest): void => {
    if (value.kind === "scalar") field(value.field);
    else { record(value.field.record, value.field.offset, pe.abi.pointerBytes); if (value.value !== null) image(value.value.rva, pe.abi.pointerBytes); }
  };
  const entries: number[] = [weapons.spawn.entry, weapons.attackAnimation.entry, player.spawn, commands.give.entry, commands.give.weapons, commands.give.ammo, commands.drop.entry,
    inventory.next.entry, inventory.next.scan, inventory.previous.entry, inventory.previous.scan, inventory.validate.entry, inventory.use.entry, inventory.use.call,
    inventory.namedUse.entry, inventory.namedUse.call, inventory.namedUse.lookupCall, inventory.namedUse.lookupReturn,
    drop.named, drop.inventory.entry, drop.inventory.admitted, drop.find, drop.lookupReturn, drop.allocate, drop.free,
    pickups.touch, pickups.grantReturn, pickups.targetsReturn, pickups.supply.ammo.entry];
  if (weapons.dispatcher.entry.kind !== "rva") throw new Error("Primary source dispatcher requires a declared executable address");
  entries.push(weapons.dispatcher.entry.rva);
  const regions = [...weapons.decisions, ...weapons.attackAnimation.skip, weapons.delay.region, commands.give.unknown, ...commands.give.ammoGrants, commands.drop.eligibility,
    inventory.next, inventory.previous, inventory.use, inventory.namedUse, ...drop.callbacks, ...drop.debits];
  if (inventory.validate.scan !== null) regions.push(inventory.validate.scan);
  if (drop.consumer !== null) regions.push(drop.consumer);
  if (player.objectives.kind === "entry") entries.push(player.objectives.entry);
  if (weapons.damage.kind === "source-result") entries.push(weapons.damage.entry);
  else { image(weapons.damage.address, widths[weapons.damage.encoding]); regions.push(weapons.damage.region); }
  if (weapons.delay.evaluate.kind === "source-animation") { entries.push(weapons.delay.evaluate.entry); weapons.delay.evaluate.writes.forEach(field); weapons.delay.evaluate.projection.forEach(value => field(value.field));
    if (weapons.delay.evaluate.baselineMilliseconds <= 0) throw new Error("Original weapon animation interval must be positive"); }
  for (const grant of pickups.grants) {
    entries.push(grant.entry); regions.push(grant.recipient);
    for (const consumer of grant.consumers ?? []) entries.push(consumer.entry);
    if (grant.supply?.kind === "ammo") entries.push(grant.supply.entry);
    else if (grant.supply?.kind === "weapon") { entries.push(grant.supply.ammoReturn, grant.supply.settle); regions.push(grant.supply.autoswitch); }
  }
  if (pickups.supply.ammo.stop !== null) entries.push(pickups.supply.ammo.stop);
  for (const region of regions) { entries.push(region.entry, region.join); if (region.entry === region.join) throw new Error("Native source region is empty"); }
  for (const entry of entries) image(entry, 1, true);
  for (const value of [weapons.entity.waterLevel, weapons.entity.viewHeight, weapons.entity.maxHealth, weapons.client.buttons, weapons.client.latchedButtons, weapons.delay.flag, ...Object.values(weapons.animation)]) field(value);
  for (const decision of weapons.decisions) for (const value of decision.fields) { field(value.field); if (!Number.isInteger(value.clearMask) || value.clearMask < 1 || value.clearMask > 0xffffffff) throw new Error("Native input mask is outside uint32"); }
  for (const value of [...weapons.spawn.accepted, ...weapons.active, ...weapons.committedInput.flat(), ...weapons.continuations.flat()]) test(value);
  if (weapons.entity.maxHealth.record !== "entity" || weapons.entity.maxHealth.encoding !== "int32") throw new Error("Native source max health requires its declared int32 entity field");
  for (const offset of [weapons.client.viewAngles, player.commandAngles]) bound(offset, 12, clientBytes);
  if (player.forward !== null) bound(player.forward, 12, clientBytes);
  bound(player.velocity, 12, entityBytes);
  if (inventory.client !== (profile.edition === "classic" ? 84 : 120)) throw new Error("Native client pointer differs from the selected public game API");
  bound(inventory.inventory, inventory.count * 4, clientBytes); bound(inventory.cursor, 4, clientBytes);
  for (const span of inventory.selectionWrites) bound(span.offset, span.bytes, clientBytes);
  for (const offset of [commands.client.weapon, drop.client.weapon, drop.client.pending]) bound(offset, pe.abi.pointerBytes, clientBytes);
  if (commands.client.ammoIndex !== null) bound(commands.client.ammoIndex, 4, clientBytes);
  for (const offset of pickups.supply.ammo.capacities) bound(offset, pickups.supply.ammo.capacityBytes, clientBytes);
  for (const offset of [commands.give.argc, commands.give.argv]) image(offset, pe.abi.pointerBytes);
  for (const offset of [commands.items.classname, commands.items.icon, pickups.items.pickup]) bound(offset, pe.abi.pointerBytes, commands.items.stride);
  for (const offset of [commands.items.flags, pickups.supply.flags, pickups.supply.ammo.tag]) bound(offset, 4, commands.items.stride);
  bound(commands.items.ammo.offset, commands.items.ammo.kind === "name" ? pe.abi.pointerBytes : 4, commands.items.stride);
  if (commands.items.ammo.kind === "name") bound(commands.items.ammo.label, pe.abi.pointerBytes, commands.items.stride);
  image(commands.items.table, commands.items.count * commands.items.stride);
  image(weapons.time.address, widths[weapons.time.encoding]); image(pickups.time.address, pickups.time.storage === "float32-seconds" ? 4 : 8);
  for (const offset of [pickups.entity.count, pickups.entity.spawnflags]) bound(offset, 4, entityBytes);
  bound(pickups.entity.item, pe.abi.pointerBytes, entityBytes); bound(pickups.entity.inuse, pickups.entity.inuseBytes, entityBytes);
  if (pickups.entity.generation !== null) bound(pickups.entity.generation, 4, entityBytes);
  if (commands.items.weaponFlag !== pickups.supply.weaponFlag || commands.items.classname !== pickups.items.classname || commands.items.flags !== pickups.supply.flags || inventory.cursor !== drop.client.cursor
    || commands.client.weapon !== drop.client.weapon) throw new Error("Native primary interfaces disagree about original source fields");
  if (profile.edition === "classic") {
    const world = profile.world;
    if (world.client.inventory !== inventory.inventory || world.client.inventoryCount !== inventory.count || world.globals.itemList !== commands.items.table
      || world.globals.itemBytes !== commands.items.stride || world.inventoryTable.count !== commands.items.count || world.inventoryTable.className !== commands.items.classname
      || world.inventoryTable.flags !== commands.items.flags || world.inventoryTable.ammoFlag !== commands.items.ammunitionFlag) throw new Error("Classic source world and item interfaces disagree");
    for (const entry of Object.values(world.entries)) image(entry, 1, true);
    image(world.globals.levelFrame, 4);
    for (const [name, offset] of Object.entries(world.client)) {
      if (name !== "inventoryCount" && name !== "userinfoBytes") bound(offset, name === "userinfo" ? world.client.userinfoBytes : name === "viewAngles" ? 12 : 4, clientBytes);
    }
    world.inventoryTable.capacities.forEach(offset => bound(offset, 4, clientBytes));
  } else {
    const world = profile.world;
    if (world.client.layout.byteLength !== clientBytes || world.client.inventoryCount !== inventory.count || fieldOffset(world.client.layout, "pers.inventory") !== inventory.inventory
      || fieldOffset(world.client.layout, "pers.weapon") !== commands.client.weapon || fieldOffset(world.client.layout, "pers.selected_item") !== inventory.cursor)
      throw new Error("Rerelease source world and item interfaces disagree");
  }
}
