/* Hipnotic/Rogue QuakeC. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { normalize, vadd, vscale } from "../foundation/types.ts";

export type Q1MissionPack = "hipnotic" | "rogue";
export type MissionWeapon = "hipnotic:laser" | "hipnotic:mjolnir" | "hipnotic:proximity" |
  "rogue:lava-nailgun" | "rogue:lava-supernailgun" | "rogue:multi-grenade" | "rogue:multi-rocket" | "rogue:plasma";
export type MissionPowerup = "hipnotic:wetsuit" | "hipnotic:empathy" | "rogue:shield" | "rogue:antigrav";
export interface MissionWeaponDefinition {
  readonly id: MissionWeapon;
  readonly model: string;
  readonly pickup: string | null;
  readonly worldModel: string;
  readonly ammo: ItemId | null;
  readonly pickupAmmo: number;
  readonly rank: number;
}
export const missionWeapons: readonly MissionWeaponDefinition[] = [
  { id: "hipnotic:laser", model: "progs/v_laserg.mdl", pickup: "weapon_laser_gun", worldModel: "progs/g_laserg.mdl", ammo: "q1:ammo/cells", pickupAmmo: 30, rank: 3 },
  { id: "hipnotic:mjolnir", model: "progs/v_hammer.mdl", pickup: "weapon_mjolnir", worldModel: "progs/g_hammer.mdl", ammo: null, pickupAmmo: 30, rank: 9 },
  { id: "hipnotic:proximity", model: "progs/v_prox.mdl", pickup: "weapon_proximity_gun", worldModel: "progs/g_prox.mdl", ammo: "q1:ammo/rockets", pickupAmmo: 6, rank: 5 },
  { id: "rogue:lava-nailgun", model: "progs/v_lava.mdl", pickup: null, worldModel: "progs/g_nail.mdl", ammo: "rogue:ammo/lava-nails", pickupAmmo: 0, rank: 4 },
  { id: "rogue:lava-supernailgun", model: "progs/v_lava2.mdl", pickup: null, worldModel: "progs/g_nail2.mdl", ammo: "rogue:ammo/lava-nails", pickupAmmo: 0, rank: 2 },
  { id: "rogue:multi-grenade", model: "progs/v_multi.mdl", pickup: null, worldModel: "progs/g_rock.mdl", ammo: "rogue:ammo/multi-rockets", pickupAmmo: 0, rank: 6 },
  { id: "rogue:multi-rocket", model: "progs/v_multi2.mdl", pickup: null, worldModel: "progs/g_rock2.mdl", ammo: "rogue:ammo/multi-rockets", pickupAmmo: 0, rank: 1 },
  { id: "rogue:plasma", model: "progs/v_plasma.mdl", pickup: null, worldModel: "progs/g_light.mdl", ammo: "rogue:ammo/plasma", pickupAmmo: 0, rank: 0 },
];

/** Foundation remaps these references when the session is restored. */
export function setMissionReference(entity: Q1Actor, key: string, actor: ActorId | null): undefined {
  entity.references.set(key, actor); return undefined;
}
export function missionReference(game: Q1EntityServices, entity: Q1Actor, key: string): ActorId | null {
  const actor = entity.references.get(key) ?? null;
  return actor !== null && game.host.actors.isLive(actor) ? actor : null;
}
export function setMissionNumber(entity: Q1Actor, key: string, value: number): undefined {
  entity.fields.set(key, String(Math.fround(value))); return undefined;
}
export function velocityAngles(velocity: Vec3): Vec3 {
  const yaw = velocity.x === 0 && velocity.y === 0 ? 0 : Math.atan2(velocity.y, velocity.x) * 180 / Math.PI;
  const pitch = velocity.x === 0 && velocity.y === 0 ? velocity.z > 0 ? 90 : 270 : Math.atan2(velocity.z, Math.hypot(velocity.x, velocity.y)) * 180 / Math.PI;
  return { x: Math.fround(pitch < 0 ? pitch + 360 : pitch), y: Math.fround(yaw < 0 ? yaw + 360 : yaw), z: 0 };
}
export function grenadeVelocity(game: Q1EntityServices, angles: Vec3, aimed: Vec3): Vec3 {
  const basis = game.makeVectors(angles);
  return angles.x === 0 ? { ...vscale(aimed, 600), z: 200 } :
    vadd(vadd(vadd(vscale(basis.forward, 600), vscale(basis.up, 200)), vscale(basis.right, (game.host.random() * 2 - 1) * 10)), vscale(basis.up, (game.host.random() * 2 - 1) * 10));
}
export function moveMissile(game: Q1EntityServices, entity: Q1Actor, velocity: Vec3): undefined {
  return game.setBody(entity, { velocity, angles: velocityAngles(normalize(velocity)), ground: null });
}
