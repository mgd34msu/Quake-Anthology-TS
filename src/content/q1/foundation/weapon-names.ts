import { isQ1BaseWeapon, type Q1BaseWeapon, type Q1Weapon } from "./types.ts";

const q1DisplayNames: Readonly<Record<Q1BaseWeapon, string>> = {
  axe: "Axe", shotgun: "Shotgun", supershotgun: "Double-barrelled Shotgun", nailgun: "Nailgun",
  supernailgun: "Super Nailgun", grenadelauncher: "Grenade Launcher", rocketlauncher: "Rocket Launcher", lightning: "Thunderbolt",
};

export function q1WeaponDisplayName(weapon: Q1Weapon): string {
  if (isQ1BaseWeapon(weapon)) return q1DisplayNames[weapon];
  if (weapon === "hipnotic:laser") return "Laser Cannon";
  if (weapon === "hipnotic:mjolnir") return "Mjolnir";
  if (weapon === "hipnotic:proximity") return "Proximity Gun";
  const name = weapon.split(":").at(-1) ?? weapon;
  return name.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, character => character.toUpperCase());
}
