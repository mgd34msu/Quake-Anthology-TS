// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity, RawEntityView } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { WeaponBehaviorDefinition, WeaponTrajectoryUpdate } from "../../../contracts/weapon-behavior.ts";
import { q2EaksWeaponDigest, q2EaksWeaponEntries, q2EaksWeaponThinkSignature, q2EaksProjectileLayout, q2EaksWeaponClientLayout } from "./q2eaks-weapon-profile.ts";
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

type Factory = (module: RereleaseGuestModule, imageBase: GuestAddress) => RereleaseWeaponProfile;
const profiles: readonly { readonly digest: ModuleIdentity["digest"]; readonly create: Factory; readonly definition: (module: ModuleIdentity) => WeaponBehaviorDefinition }[] = [
  { digest: q2EaksWeaponDigest, create: q2EaksRocketProfile, definition: q2EaksRocketDefinition },
];
export function rereleaseWeaponDefinition(module: ModuleIdentity): WeaponBehaviorDefinition | null {
  return profiles.find(value => value.digest === module.digest)?.definition(module) ?? null;
}
function q2EaksRocketDefinition(module: ModuleIdentity): WeaponBehaviorDefinition {
  return { id: "native:rocket-trajectory", title: "Faster rockets", module, role: "rocket", aspect: "trajectory",
    activate: { kind: "native-artifact", module, imageOffset: 0xed4d0n, abi: rereleaseAbi },
    fire: { kind: "native-artifact", module, imageOffset: 0xef900n, abi: rereleaseAbi } };
}
export function rereleaseWeaponProfile(module: RereleaseGuestModule, imageBase: GuestAddress): RereleaseWeaponProfile {
  const entry = profiles.find(value => value.digest === module.memory.module.digest);
  if (entry === undefined) throw new Error("Native trajectory behavior requires an artifact-qualified executable profile");
  return entry.create(module, imageBase);
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

function q2EaksRocketProfile(module: RereleaseGuestModule, imageBase: GuestAddress): RereleaseWeaponProfile {
  const memory = module.memory, entries = q2EaksWeaponEntries(module, imageBase);
  const changeWeapon = memory.offset(imageBase, 0xed4d0n), weaponThink = memory.offset(imageBase, 0xefaf0n);
  memory.check(changeWeapon, 1, "execute"); memory.check(weaponThink, 1, "execute");
  const at = (record: RawEntityView, field: string) => memory.offset(record.address, BigInt(fieldOffset(q2EaksProjectileLayout, field)));
  const vector = (address: GuestAddress): Vec3 => ({ x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) });
  const writeVector = (address: GuestAddress, value: Vec3): void => { memory.writeFloat32(address, value.x); memory.writeFloat32(memory.offset(address, 4n), value.y); memory.writeFloat32(memory.offset(address, 8n), value.z); };
  const client = (record: RawEntityView): GuestAddress => { const value = memory.readPointer(at(record, "client")); if (value === null) throw new Error("Native weapon context requires an admitted source client"); return value; };
  const clientField = (record: RawEntityView, name: string) => memory.offset(client(record), BigInt(fieldOffset(q2EaksWeaponClientLayout, name)));
  const project = (record: RawEntityView, body: BodyState): void => {
    writeVector(at(record, "s.origin"), body.origin); writeVector(at(record, "s.angles"), body.angles); writeVector(at(record, "velocity"), body.velocity);
    writeVector(memory.offset(record.address, BigInt(fieldOffset(edictLayout, "mins"))), body.bounds.min);
    writeVector(memory.offset(record.address, BigInt(fieldOffset(edictLayout, "maxs"))), body.bounds.max);
  };
  const invoke = (entry: GuestAddress, record: RawEntityView): void => { module.invoke(entry, q2EaksWeaponThinkSignature, [guestPointer(record.address)], record); };
  return {
    initializationClasses: ["worldspawn", "info_player_start", "info_player_deathmatch", "info_player_coop", "info_player_team1", "info_player_team2", "info_player_intermission"],
    definition: q2EaksRocketDefinition(memory.module),
    equipment: [{ arguments: ["give", "Rocket Launcher"], tail: "Rocket Launcher" }, { arguments: ["give", "Rockets"], tail: "Rockets" }, { arguments: ["use", "Rocket Launcher"], tail: "Rocket Launcher" }],
    ammunition: { arguments: ["give", "Rockets"], tail: "Rockets" },
    initialCvars: [{ name: "g_faster_rockets", value: "1" }],
    provisioningCvars: [{ name: "cheats", value: "1" }],
    equip: record => {
      invoke(changeWeapon, record);
      const weapon = memory.readPointer(clientField(record, "pers.weapon"));
      if (weapon === null || memory.readPointer(memory.offset(weapon, 0x28n))?.byteOffset !== weaponThink.byteOffset)
        throw new Error("Native source did not equip the artifact-qualified rocket launcher");
    },
    launch: record => { invoke(entries.weaponRunThink, record); invoke(entries.rocketLauncherFire, record); },
    matches: (record, shooter) => memory.readPointer(at(record, "owner"))?.byteOffset === shooter.address.byteOffset
      && memory.readPointer(at(record, "touch.value"))?.byteOffset === entries.rocketTouch.byteOffset,
    projectShooter: (record, shooter) => {
      project(record, shooter.body); writeVector(clientField(record, "v_angle"), shooter.viewAngles);
      const pitch = shooter.viewAngles.x * Math.PI / 180, yaw = shooter.viewAngles.y * Math.PI / 180;
      writeVector(clientField(record, "v_forward"), { x: Math.cos(pitch) * Math.cos(yaw), y: Math.cos(pitch) * Math.sin(yaw), z: -Math.sin(pitch) });
      memory.writeInt32(at(record, "viewheight"), shooter.viewHeight);
    },
    project,
    trajectory: record => ({ origin: vector(at(record, "s.origin")), angles: vector(at(record, "s.angles")), velocity: vector(at(record, "velocity")) }),
    // G_FreeEdict preserves and increments this exact field around its record clear.
    generation: record => memory.readInt32(memory.offset(record.address, 0x5c0n)),
    time: milliseconds => memory.writeInt64(entries.levelTime, milliseconds),
    nextThink: record => memory.readInt64(at(record, "nextthink")),
    think: record => {
      const callback = memory.readPointer(at(record, "think.value")), registration = memory.readPointer(at(record, "think.list"));
      if (callback === null) throw new Error("Native projectile has a due think with no callback");
      if (registration === null || memory.readUint32(memory.offset(registration, 8n)) !== 20
        || memory.readPointer(memory.offset(registration, 16n))?.byteOffset !== callback.byteOffset)
        throw new Error("Native projectile think lacks its typed source save registration");
      memory.writeInt64(at(record, "nextthink"), 0n); invoke(callback, record);
    },
    allocate: () => {
      const address = resultPointer(module.invoke(entries.spawn, signature([], { kind: "scalar", storage: "pointer" }), []));
      if (address === null) throw new Error("Native source entity allocation returned null");
      return module.entities().fromPointer(address);
    },
    free: record => { if (memory.readUint8(memory.offset(record.address, BigInt(fieldOffset(edictLayout, "inuse")))) !== 0) invoke(entries.free, record); },
  };
}
