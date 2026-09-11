/* Source W_ChangeWeapon and forward/reverse weapon cycling. GPL-2.0-or-later. */
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1PlayerState, Q1Weapon } from "../foundation/types.ts";
import { weaponItem } from "../foundation/types.ts";
import { missionMessage } from "./messages.ts";
import type { Q1MissionPack } from "./types.ts";

const hipnoticCycle: readonly Q1Weapon[] = ["axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "hipnotic:proximity", "rocketlauncher", "lightning", "hipnotic:laser", "hipnotic:mjolnir"];
const rogueCycle: readonly Q1Weapon[] = ["axe", "rogue:grapple", "shotgun", "supershotgun", "nailgun", "rogue:lava-nailgun", "supernailgun", "rogue:lava-supernailgun", "grenadelauncher", "rogue:multi-grenade", "rocketlauncher", "rogue:multi-rocket", "lightning", "rogue:plasma"];
function countRequired(weapon: Q1Weapon): number { return weapon === "supershotgun" || weapon === "supernailgun" || weapon === "rogue:lava-supernailgun" ? 2 : 1; }
function owns(game: Q1Foundation, player: Q1PlayerState, weapon: Q1Weapon): boolean { return game.host.inventory.count(player.actor.id, weaponItem(weapon)) > 0; }
function hasAmmo(game: Q1Foundation, player: Q1PlayerState, weapon: Q1Weapon, required = countRequired(weapon)): boolean {
  const ammo = game.weaponAmmo(weapon); return ammo === null || game.host.inventory.count(player.actor.id, ammo) >= required;
}
function cycle(game: Q1Foundation, player: Q1PlayerState, pack: Q1MissionPack, reverse: boolean): boolean {
  const order = pack === "hipnotic" ? hipnoticCycle : rogueCycle, current = order.indexOf(player.weapon);
  for (let step = 1; step <= order.length; step++) {
    const next = order[(current + (reverse ? -step : step) + order.length * 2) % order.length];
    if (next === "rogue:grapple" && !(game.options.deathmatch !== 0 && (game.options.teamplay ?? 0) >= 4)) continue;
    if (next !== undefined && owns(game, player, next) && hasAmmo(game, player, next, reverse && next === "rogue:lava-nailgun" ? 2 : countRequired(next))) return game.selectWeapon(player.actor, next);
  }
  return false;
}
function rogueSelected(game: Q1Foundation, player: Q1PlayerState, impulse: number): Q1Weapon | null {
  const ctf = game.options.deathmatch !== 0 && (game.options.teamplay ?? 0) >= 4;
  const paired = (base: Q1Weapon, powered: Q1Weapon): Q1Weapon => owns(game, player, powered) && (player.weapon === base || !hasAmmo(game, player, base)) ? powered : base;
  switch (impulse) {
    case 1: return ctf && player.weapon === "axe" ? "rogue:grapple" : "axe";
    case 2: return "shotgun";
    case 3: return "supershotgun";
    case 4: return paired("nailgun", "rogue:lava-nailgun");
    case 5: return paired("supernailgun", "rogue:lava-supernailgun");
    case 6: return paired("grenadelauncher", "rogue:multi-grenade");
    case 7: return paired("rocketlauncher", "rogue:multi-rocket");
    case 8: return paired("lightning", "rogue:plasma");
    case 22: return ctf ? "rogue:grapple" : null;
    case 60: return "rogue:lava-nailgun";
    case 61: return "rogue:lava-supernailgun";
    case 62: return "rogue:multi-grenade";
    case 63: return "rogue:multi-rocket";
    case 64: return "rogue:plasma";
    case 65: return game.options.edition === "rerelease" ? "nailgun" : null;
    case 66: return game.options.edition === "rerelease" ? "supernailgun" : null;
    case 67: return game.options.edition === "rerelease" ? "grenadelauncher" : null;
    case 68: return game.options.edition === "rerelease" ? "rocketlauncher" : null;
    default: return null;
  }
}
function hipnoticSelected(game: Q1Foundation, player: Q1PlayerState, impulse: number): Q1Weapon | null {
  switch (impulse) {
    case 1: return "axe";
    case 2: return "shotgun";
    case 3: return "supershotgun";
    case 4: return "nailgun";
    case 5: return "supernailgun";
    case 6: return player.weapon === "grenadelauncher" ? "hipnotic:proximity" : "grenadelauncher";
    case 7: return "rocketlauncher";
    case 8: return "lightning";
    case 225: return "hipnotic:laser";
    case 226: return "hipnotic:mjolnir";
    case 227: return game.options.edition === "rerelease" ? "hipnotic:proximity" : null;
    case 228: return game.options.edition === "rerelease" ? "grenadelauncher" : null;
    default: return null;
  }
}
export function missionWeaponImpulse(game: Q1Foundation, player: Q1PlayerState, pack: Q1MissionPack, impulse: number): boolean {
  if (impulse === 10 || impulse === 12) { cycle(game, player, pack, impulse === 12); return true; }
  let selected = pack === "hipnotic" ? hipnoticSelected(game, player, impulse) : rogueSelected(game, player, impulse);
  if (selected === null) return false;
  if (pack === "hipnotic" && selected === "grenadelauncher" && !owns(game, player, selected)) selected = "hipnotic:proximity";
  if (!owns(game, player, selected)) { missionMessage(game, player.actor.id, "$qc_no_weapon"); return true; }
  const required = pack === "rogue" && impulse === 61 ? 1 : countRequired(selected);
  const aliasAmmo = pack === "rogue" && impulse >= 65 && impulse <= 68 && player.weapon.startsWith("rogue:") && player.weapon !== "rogue:grapple" ? game.host.inventory.count(player.actor.id, impulse <= 66 ? "rogue:ammo/lava-nails" : "rogue:ammo/multi-rockets") : null;
  if (aliasAmmo === null ? !hasAmmo(game, player, selected, required) : aliasAmmo < required) { missionMessage(game, player.actor.id, "$qc_not_enough_ammo"); return true; }
  if (pack === "rogue" && selected !== player.weapon) {
    const old = player.weapon;
    const key = old === "rogue:lava-nailgun" || old === "rogue:lava-supernailgun" ? selected === "nailgun" || selected === "supernailgun" ? "$qc_normal_nails" : "" :
      old === "rogue:multi-grenade" ? selected === "grenadelauncher" ? "$qc_normal_grenades" : "" : old === "rogue:multi-rocket" ? selected === "rocketlauncher" ? "$qc_normal_rockets" : "" :
      old === "rogue:plasma" ? selected === "lightning" ? "$qc_lightning_gun" : "" : selected === "rogue:lava-nailgun" || selected === "rogue:lava-supernailgun" ? "$qc_lava_nails" :
      selected === "rogue:multi-grenade" ? "$qc_multi_gl" : selected === "rogue:multi-rocket" ? "$qc_multi_rl" : selected === "rogue:plasma" ? "$qc_plasma_gun" : "";
    if (key !== "") missionMessage(game, player.actor.id, key);
  }
  game.selectWeapon(player.actor, selected); return true;
}
