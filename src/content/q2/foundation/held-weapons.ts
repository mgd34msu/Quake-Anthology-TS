import type { ItemId } from "../../../contracts/gameplay.ts";
import { Q2_BASE_WEAPONS } from "./weapons/definitions.ts";
import { xatrixWeaponDefinitions, rogueWeaponDefinitions } from "../missionpacks/weapons/definitions.ts";
import type { HeldWeaponModel } from "../../../contracts/held-weapon.ts";
import type { ModelTransform } from "../../../contracts/scene.ts";

/* All authored male held weapons share the same stand01 player-space registration.
 * Their rerelease Weapon joint transforms agree at frame 0. Male blaster stand01, players/male/w_blaster.md2 vertices 36..47 form the
 * angled pistol grip, held by the native male's right hand. Vertices 0..7
 * form the separate rectangular underside box, not the grip.
 * The matching rerelease MD5 Weapon joint supplies forward=Y, left=-Z, up=-X.
 * Native CL_AddPacketEntities
 * places this mesh in player coordinates, with the player's frame and transform. */
const MALE_BLASTER_GRIP: ModelTransform = {
  origin: { x: -2.5316378672917685, y: -9.27009121576945, z: 4.795252025127411 },
  axis: [
    { x: 0.9701912999153137, y: -0.16778743267059326, z: -0.17486034333705902 },
    { x: 0.16538193821907043, y: 0.9858221411705017, z: -0.02834496460855007 },
    { x: 0.17713716626167297, y: -0.0014186727348715067, z: 0.9841850996017456 },
  ],
  scale: { x: 1, y: 1, z: 1 },
};

const nativeModels: ReadonlyMap<ItemId, string> = new Map([
  ["q2:weapon_blaster", "w_blaster"], ["q2:weapon_shotgun", "w_shotgun"], ["q2:weapon_supershotgun", "w_sshotgun"],
  ["q2:weapon_machinegun", "w_machinegun"], ["q2:weapon_chaingun", "w_chaingun"], ["q2:ammo_grenades", "a_grenades"],
  ["q2:weapon_grenadelauncher", "w_glauncher"], ["q2:weapon_rocketlauncher", "w_rlauncher"], ["q2:weapon_hyperblaster", "w_hyperblaster"],
  ["q2:weapon_railgun", "w_railgun"], ["q2:weapon_bfg", "w_bfg"], ["q2:ammo_trap", "a_trap"], ["q2:weapon_boomer", "w_ripper"],
  ["q2:weapon_phalanx", "w_phalanx"], ["q2:ammo_tesla", "a_tesla"], ["q2:weapon_proxlauncher", "w_plauncher"],
  ["q2:weapon_chainfist", "w_chainfist"], ["q2:weapon_disintegrator", "w_disrupt"], ["q2:weapon_etf_rifle", "w_etfrifle"], ["q2:weapon_plasmabeam", "w_plasma"],
]);
const weapons = [...Q2_BASE_WEAPONS, ...xatrixWeaponDefinitions, ...rogueWeaponDefinitions];

export function q2HeldWeapon(viewModel: string, item?: ItemId): HeldWeaponModel | null {
  const weapon = item === undefined ? weapons.find(weapon => weapon.viewModel === viewModel) : weapons.find(weapon => weapon.item === item);
  const name = weapon === undefined ? viewModel === "models/weapons/grapple/tris.md2" ? "w_grapple" : undefined : nativeModels.get(weapon.item);
  return name === undefined ? null : { path: `players/male/${name}.md2`, fallback: "players/male/weapon.md2", referenceFrame: 0, grip: MALE_BLASTER_GRIP };
}
