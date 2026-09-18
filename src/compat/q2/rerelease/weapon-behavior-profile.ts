// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity, RawEntityView } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { WeaponBehaviorDefinition, WeaponTrajectoryUpdate } from "../../../contracts/weapon-behavior.ts";
import { q2EaksWeaponDigest, q2EaksWeaponDeclaration } from "./q2eaks-weapon-profile.ts";
import type { NativeWeaponBehaviorDeclaration, NativeWeaponEntry } from "../../../contracts/native-weapon-behavior.ts";
import { readNativeWeaponDeclaration } from "./native-weapon-declaration.ts";
import { readGuestString } from "./imports.ts";
import { edictLayout, fieldOffset } from "./layouts.ts";
import { rereleaseAbi, signature } from "./api.ts";
import { guestPointer, resultPointer, type RereleaseGuestModule } from "./module.ts";
import { parseQ1Entities, q1EntityValue } from "../../../formats/q1-map/entities.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";

export interface RereleaseWeaponShooter {
  readonly body: BodyState;
  readonly viewAngles: Vec3;
  readonly viewHeight: number;
}
export interface RereleaseWeaponProfile {
  readonly definition: WeaponBehaviorDefinition;
  readonly initializationClasses: readonly string[];
  readonly equipment: readonly { readonly arguments: readonly string[]; readonly tail: string }[];
  readonly ammunition: { readonly arguments: readonly string[]; readonly tail: string };
  readonly initialCvars: readonly { readonly name: string; readonly value: string }[];
  readonly provisioningCvars: readonly { readonly name: string; readonly value: string }[];
  equip(shooter: RawEntityView): void;
  launch(shooter: RawEntityView): void;
  matches(projectile: RawEntityView, shooter: RawEntityView): boolean;
  projectShooter(record: RawEntityView, shooter: RereleaseWeaponShooter): void;
  project(record: RawEntityView, body: BodyState): void;
  trajectory(record: RawEntityView): WeaponTrajectoryUpdate;
  generation(record: RawEntityView): number;
  time(milliseconds: bigint): void;
  nextThink(record: RawEntityView): bigint;
  think(record: RawEntityView): void;
  allocate(): RawEntityView;
  free(record: RawEntityView): void;
}

export function builtInRereleaseWeaponDeclaration(module: ModuleIdentity): NativeWeaponBehaviorDeclaration | null {
  return module.digest === q2EaksWeaponDigest ? readNativeWeaponDeclaration(q2EaksWeaponDeclaration(module.artifactPath), module) : null;
}
export function rereleaseWeaponDefinition(module: ModuleIdentity, declaration?: NativeWeaponBehaviorDeclaration): WeaponBehaviorDefinition | null {
  const profile = declaration === undefined ? builtInRereleaseWeaponDeclaration(module) : readNativeWeaponDeclaration(declaration, module);
  if (profile === null) return null;
  return { id: profile.id, title: profile.title, module, role: profile.role, aspect: profile.aspect,
    activate: profile.activateRva === null ? null : { kind: "native-artifact", module, imageOffset: BigInt(profile.activateRva), abi: rereleaseAbi },
    fire: { kind: "native-artifact", module, imageOffset: BigInt(profile.fireRva), abi: rereleaseAbi } };
}
export function rereleaseWeaponProfile(module: RereleaseGuestModule, imageBase: GuestAddress, declaration?: NativeWeaponBehaviorDeclaration): RereleaseWeaponProfile {
  const profile = declaration === undefined ? builtInRereleaseWeaponDeclaration(module.memory.module) : readNativeWeaponDeclaration(declaration, module.memory.module);
  if (profile === null) throw new Error("Native trajectory behavior requires an artifact-qualified executable profile");
  return bindNativeWeaponProfile(module, imageBase, profile);
}
export function rereleaseWeaponInitializationEntities(text: string, profile: Pick<RereleaseWeaponProfile, "initializationClasses">): string {
  const entities = parseQ1Entities(text).filter(entity => profile.initializationClasses.includes(q1EntityValue(entity, "classname") ?? ""));
  if (entities.filter(entity => q1EntityValue(entity, "classname") === "worldspawn").length !== 1) throw new Error("Native component initialization requires one authored worldspawn");
  const quote = (value: string): string => { if (value.includes('"') || value.includes("\0")) throw new Error("Native component entity field cannot be quoted"); return '"' + value + '"'; };
  return entities.map(entity => "{\n" + entity.properties.map(field => quote(field.key) + " " + quote(field.value)).join("\n") + "\n}\n").join("");
}
/** Provisioning may change private inventory, but its declared cvar capability ends with the command. */
export function withRereleaseWeaponProvisioning<T>(profile: Pick<RereleaseWeaponProfile, "provisioningCvars">, cvars: CvarRegistry, refresh: () => void, run: () => T): T {
  const saved = cvars.captureWorldTransferState(), names = new Set(profile.provisioningCvars.map(value => value.name));
  const independent = (state: typeof saved) => state.variables.filter(value => value !== null && !names.has(value.name));
  try {
    for (const override of profile.provisioningCvars) {
      if (cvars.get(override.name) === undefined) throw new Error("Native source has not registered its provisioning capability");
      cvars.set(override.name, override.value, true);
    }
    refresh(); const result = run();
    if (JSON.stringify(independent(cvars.captureWorldTransferState())) !== JSON.stringify(independent(saved)))
      throw new Error("Native provisioning changed an undeclared source cvar");
    return result;
  } finally { cvars.restoreSaveState(saved); refresh(); }
}

function bindNativeWeaponProfile(module: RereleaseGuestModule, imageBase: GuestAddress, profile: NativeWeaponBehaviorDeclaration): RereleaseWeaponProfile {
  const memory = module.memory;
  if (memory.pointerBytes !== 8) throw new Error("Native trajectory declaration requires Windows x64 pointers");
  const definition = rereleaseWeaponDefinition(memory.module, profile);
  if (definition === null) throw new Error("Native trajectory declaration has no definition");
  const image = (rva: number) => memory.offset(imageBase, BigInt(rva));
  const entry = (value: NativeWeaponEntry): GuestAddress => {
    const address = image(value.rva); memory.check(address, 1, "execute");
    if (value.registration !== null) {
      const declared = value.registration, record = image(declared.rva), layout = declared.layout;
      memory.check(record, layout.byteLength, "read");
      const name = memory.readPointer(memory.offset(record, BigInt(layout.name)));
      const callback = memory.readPointer(memory.offset(record, BigInt(layout.callback)));
      if (name === null || readGuestString(memory, name, new TextEncoder().encode(declared.name).length + 1) !== declared.name
        || memory.readUint32(memory.offset(record, BigInt(layout.tag))) !== declared.tag || callback?.byteOffset !== address.byteOffset)
        throw new Error(`Native typed source callback registration differs: ${declared.name}`);
    }
    return address;
  };
  const equip = profile.equip.calls.map(entry), launch = profile.launch.calls.map(entry), allocate = entry(profile.allocate.entry),
    free = entry(profile.free.entry), touch = entry(profile.projectileTouch), weaponThink = entry(profile.equippedWeapon.expected), time = image(profile.time.rva);
  memory.check(time, 8, "write");
  const recordAddress = (record: RawEntityView): GuestAddress => {
    if (record.module.digest !== memory.module.digest || record.module.id !== memory.module.id || record.address.addressSpace !== memory.addressSpace
      || profile.entity.byteLength > record.strideBytes) throw new Error("Native trajectory record differs from declared source layout");
    return record.address;
  };
  const at = (record: RawEntityView, offset: number) => memory.offset(recordAddress(record), BigInt(offset));
  const vector = (address: GuestAddress): Vec3 => ({ x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) });
  const writeVector = (address: GuestAddress, value: Vec3): void => { memory.writeFloat32(address, value.x); memory.writeFloat32(memory.offset(address, 4n), value.y); memory.writeFloat32(memory.offset(address, 8n), value.z); };
  const clientField = (record: RawEntityView, offset: number): GuestAddress => {
    const client = memory.readPointer(at(record, profile.entity.client));
    if (client === null) throw new Error("Native weapon context requires an admitted source client");
    memory.check(client, profile.client.byteLength, "read"); return memory.offset(client, BigInt(offset));
  };
  const project = (record: RawEntityView, body: BodyState): void => {
    writeVector(at(record, profile.entity.origin), body.origin); writeVector(at(record, profile.entity.angles), body.angles); writeVector(at(record, profile.entity.velocity), body.velocity);
    writeVector(at(record, fieldOffset(edictLayout, "mins")), body.bounds.min);
    writeVector(at(record, fieldOffset(edictLayout, "maxs")), body.bounds.max);
  };
  const thinkSignature = signature([{ kind: "scalar", storage: "pointer" }]);
  const invoke = (address: GuestAddress, record: RawEntityView): void => { module.invoke(address, thinkSignature, [guestPointer(recordAddress(record))], record); };
  return {
    definition, initializationClasses: profile.initializationClasses, equipment: profile.equipment, ammunition: profile.ammunition,
    initialCvars: profile.initialCvars, provisioningCvars: profile.provisioningCvars,
    equip: record => {
      for (const address of equip) invoke(address, record);
      const weapon = memory.readPointer(clientField(record, profile.client.weapon));
      if (weapon === null) throw new Error("Native source did not equip the artifact-qualified weapon");
      memory.check(weapon, profile.equippedWeapon.byteLength, "read");
      if (memory.readPointer(memory.offset(weapon, BigInt(profile.equippedWeapon.callback)))?.byteOffset !== weaponThink.byteOffset)
        throw new Error("Native source did not equip the artifact-qualified weapon");
    },
    launch: record => { for (const address of launch) invoke(address, record); },
    matches: (record, shooter) => memory.readPointer(at(record, profile.entity.owner))?.byteOffset === recordAddress(shooter).byteOffset
      && memory.readPointer(at(record, profile.entity.touchCallback))?.byteOffset === touch.byteOffset,
    projectShooter: (record, shooter) => {
      project(record, shooter.body); writeVector(clientField(record, profile.client.viewAngles), shooter.viewAngles);
      const pitch = shooter.viewAngles.x * Math.PI / 180, yaw = shooter.viewAngles.y * Math.PI / 180;
      writeVector(clientField(record, profile.client.forward), { x: Math.cos(pitch) * Math.cos(yaw), y: Math.cos(pitch) * Math.sin(yaw), z: -Math.sin(pitch) });
      memory.writeInt32(at(record, profile.entity.viewHeight), shooter.viewHeight);
    },
    project,
    trajectory: record => ({ origin: vector(at(record, profile.entity.origin)), angles: vector(at(record, profile.entity.angles)), velocity: vector(at(record, profile.entity.velocity)) }),
    generation: record => memory.readInt32(at(record, profile.entity.generation)),
    time: milliseconds => memory.writeInt64(time, milliseconds),
    nextThink: record => memory.readInt64(at(record, profile.entity.nextThink)),
    think: record => {
      const callback = memory.readPointer(at(record, profile.entity.thinkCallback)), registration = memory.readPointer(at(record, profile.entity.thinkRegistration));
      if (callback === null) throw new Error("Native projectile has a due think with no callback");
      const layout = profile.think.registration;
      if (registration === null) throw new Error("Native projectile think lacks its typed source save registration");
      memory.check(registration, layout.byteLength, "read"); memory.check(callback, 1, "execute");
      if (memory.readUint32(memory.offset(registration, BigInt(layout.tag))) !== profile.think.tag
        || memory.readPointer(memory.offset(registration, BigInt(layout.callback)))?.byteOffset !== callback.byteOffset)
        throw new Error("Native projectile think lacks its typed source save registration");
      memory.writeInt64(at(record, profile.entity.nextThink), 0n); invoke(callback, record);
    },
    allocate: () => {
      const address = resultPointer(module.invoke(allocate, signature([], { kind: "scalar", storage: "pointer" }), []));
      if (address === null) throw new Error("Native source entity allocation returned null");
      const record = module.entities().fromPointer(address); recordAddress(record); return record;
    },
    free: record => { if (memory.readUint8(at(record, fieldOffset(edictLayout, "inuse")))) invoke(free, record); },
  };
}
