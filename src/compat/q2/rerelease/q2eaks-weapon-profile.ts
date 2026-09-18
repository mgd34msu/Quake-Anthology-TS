// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentDigest } from "../../../contracts/content.ts";
import type { GuestAddress, GuestLayout, GuestValueLayout } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { signature } from "./api.ts";
import { readGuestString } from "./imports.ts";

export const q2EaksWeaponDigest: ContentDigest = "sha256:b60b79f7fb6f115218681a9cbab8765267e34f72466975526df05ad288925dde";
const P: GuestValueLayout = { kind: "scalar", storage: "pointer" };
const I: GuestValueLayout = { kind: "scalar", storage: "int32" };
const F: GuestValueLayout = { kind: "scalar", storage: "float32" };
export const q2EaksWeaponThinkSignature = signature([P]);
export const q2EaksFireRocketSignature = signature([P, P, P, I, I, F, I], P);

/** Sparse fields independently present in the v0.21 launch/project-source instructions. */
export const q2EaksProjectileLayout: GuestLayout = {
  id: "q2eaks-v0.21:observed-projectile-fields", byteLength: 0x7a8, alignment: 8, pointerBytes: 8, byteOrder: "little-endian", fields: [
    { name: "s.origin", byteOffset: 4, storage: "float32", count: 3 },
    { name: "s.angles", byteOffset: 16, storage: "float32", count: 3 },
    { name: "client", byteOffset: 0x78, storage: "pointer", count: 1 },
    { name: "owner", byteOffset: 0x5b8, storage: "pointer", count: 1 },
    { name: "velocity", byteOffset: 0x694, storage: "float32", count: 3 },
    { name: "nextthink", byteOffset: 0x6d8, storage: "int64", count: 1 },
    { name: "think.value", byteOffset: 0x700, storage: "pointer", count: 1 },
    { name: "think.list", byteOffset: 0x708, storage: "pointer", count: 1 },
    { name: "touch.value", byteOffset: 0x710, storage: "pointer", count: 1 },
    { name: "touch.list", byteOffset: 0x718, storage: "pointer", count: 1 },
    { name: "viewheight", byteOffset: 0x7a0, storage: "int32", count: 1 },
  ],
};
export const q2EaksWeaponClientLayout: GuestLayout = {
  id: "q2eaks-v0.21:observed-weapon-client-fields", byteLength: 0x19b0, alignment: 8, pointerBytes: 8, byteOrder: "little-endian", fields: [
    { name: "pers.hand", byteOffset: 0xa50, storage: "int32", count: 1 },
    { name: "pers.weapon", byteOffset: 0xbe8, storage: "pointer", count: 1 },
    { name: "v_angle", byteOffset: 0x1998, storage: "float32", count: 3 },
    { name: "v_forward", byteOffset: 0x19a4, storage: "float32", count: 3 },
  ],
};
export interface Q2EaksWeaponEntries {
  readonly weaponRunThink: GuestAddress;
  readonly rocketLauncherFire: GuestAddress;
  readonly fireRocket: GuestAddress;
  readonly spawn: GuestAddress;
  readonly free: GuestAddress;
  readonly rocketTouch: GuestAddress;
  readonly levelTime: GuestAddress;
}

/** Exact PE entries; calling them retains all native side effects and requires an initialized source shooter.
 * Weapon_RunThink owns transient damage/silencer setup before the source weapon dispatcher.
 * RocketLauncherFire contains the actual cvar policy; fireRocket alone does not.
 */
export function q2EaksWeaponEntries(module: Pick<RereleaseGuestModule, "memory">, imageBase: GuestAddress): Q2EaksWeaponEntries {
  const memory = module.memory;
  if (memory.module.digest !== q2EaksWeaponDigest || memory.pointerBytes !== 8) throw new Error("Q2Eaks weapon profile requires the exact v0.21 Windows x64 artifact");
  const entry = (rva: bigint): GuestAddress => {
    const address = memory.offset(imageBase, rva);
    memory.check(address, 1, "execute");
    return address;
  };
  const registered = (rva: bigint, name: string, tag: number, expectedRva: bigint): GuestAddress => {
    const record = memory.offset(imageBase, rva);
    const text = memory.readPointer(record), callback = memory.readPointer(memory.offset(record, 16n));
    if (text === null || callback === null || readGuestString(memory, text, name.length + 1) !== name
      || memory.readUint32(memory.offset(record, 8n)) !== tag || callback.byteOffset !== entry(expectedRva).byteOffset)
      throw new Error(`Q2Eaks typed source callback registration differs: ${name}`);
    memory.check(callback, 1, "execute");
    return callback;
  };
  const levelTime = memory.offset(imageBase, 0x2999c8n);
  memory.check(levelTime, 8, "read");
  return {
    weaponRunThink: entry(0xed420n), rocketLauncherFire: entry(0xef900n), fireRocket: entry(0x98310n), spawn: entry(0x95010n),
    free: registered(0x21e0c8n, "G_FreeEdict", 20, 0x95140n),
    rocketTouch: registered(0x21e1e8n, "rocket_touch", 21, 0x98060n), levelTime,
  };
}

/** Built-in evidence is expressed through the same declaration contract as mounted profiles. */
export function q2EaksWeaponDeclaration(artifactPath: string): import('../../../contracts/native-weapon-behavior.ts').NativeWeaponBehaviorDeclaration {
  const layout = { byteLength: 24, name: 0, tag: 8, callback: 16 };
  const entry = (rva: number): import('../../../contracts/native-weapon-behavior.ts').NativeWeaponEntry => ({ rva, registration: null });
  return {
    version: 1, kind: 'q2-api2023-trajectory', abi: 'windows-x86-64', artifactPath, artifactDigest: q2EaksWeaponDigest,
    id: 'native:rocket-trajectory', title: 'Faster rockets', role: 'rocket', aspect: 'trajectory',
    entity: { byteLength: 0x7a8, origin: 4, angles: 16, velocity: 0x694, client: 0x78, owner: 0x5b8, viewHeight: 0x7a0,
      generation: 0x5c0, nextThink: 0x6d8, thinkCallback: 0x700, thinkRegistration: 0x708, touchCallback: 0x710 },
    client: { byteLength: 0x19b0, weapon: 0xbe8, viewAngles: 0x1998, forward: 0x19a4 },
    equippedWeapon: { byteLength: 0x30, callback: 0x28, expected: entry(0xefaf0) },
    time: { storage: 'int64-milliseconds', rva: 0x2999c8 },
    think: { signature: 'entity-void', tag: 20, registration: layout },
    allocate: { signature: 'void-pointer', entry: entry(0x95010) },
    free: { signature: 'entity-void', entry: { rva: 0x95140, registration: { rva: 0x21e0c8, name: 'G_FreeEdict', tag: 20, layout } } },
    projectileTouch: { rva: 0x98060, registration: { rva: 0x21e1e8, name: 'rocket_touch', tag: 21, layout } },
    equip: { signature: 'entity-void', calls: [entry(0xed4d0)] },
    launch: { signature: 'entity-void', calls: [entry(0xed420), entry(0xef900)] },
    activateRva: 0xed4d0, fireRva: 0xef900,
    initializationClasses: ['worldspawn', 'info_player_start', 'info_player_deathmatch', 'info_player_coop', 'info_player_team1', 'info_player_team2', 'info_player_intermission'],
    equipment: [{ arguments: ['give', 'Rocket Launcher'], tail: 'Rocket Launcher' }, { arguments: ['give', 'Rockets'], tail: 'Rockets' }, { arguments: ['use', 'Rocket Launcher'], tail: 'Rocket Launcher' }],
    ammunition: { arguments: ['give', 'Rockets'], tail: 'Rockets' }, initialCvars: [{ name: 'g_faster_rockets', value: '1' }], provisioningCvars: [{ name: 'cheats', value: '1' }],
  };
}
