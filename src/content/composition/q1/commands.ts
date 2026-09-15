/* weapons.qc W_ChangeWeapon, CycleWeaponCommand and base ImpulseCommands. GPL-2.0-or-later. */
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1EntityServices } from "../../q1/foundation/entity-services.ts";
import type { Q1Foundation } from "../../q1/foundation/runtime.ts";
import type { Q1BaseWeapon, Q1PlayerState } from "../../q1/foundation/types.ts";
import { WEAPONS } from "../../q1/foundation/types.ts";
import type { Q1SourceComposition } from "./runtime.ts";

function ammunition(game: Q1EntityServices, player: Q1PlayerState, weapon: Q1BaseWeapon): boolean {
  const ammo = game.weaponAmmo(weapon), minimum = weapon === "supershotgun" || weapon === "supernailgun" ? 2 : 1;
  return ammo === null || game.host.inventory.count(player.actor.id, ammo) >= minimum;
}
function setCount(game: Q1Foundation, player: Q1PlayerState, item: ItemId, count: number, capacity: number): undefined {
  const previous = game.host.inventory.entries(player.actor.id).find(entry => entry.item === item);
  return game.host.inventory.configure(player.actor, previous === undefined ? { item, count, capacity } : { ...previous, count });
}
export function q1WeaponImpulse(game: Q1EntityServices, player: Q1PlayerState, impulse: number): boolean {
  if (impulse >= 1 && impulse <= 8) {
    const weapon = WEAPONS[impulse - 1]; if (weapon === undefined) return false;
    if (game.host.inventory.count(player.actor.id, game.weaponItem(weapon)) === 0) game.message(player.actor.id, game.options.edition === "classic" ? "no weapon.\n" : "$qc_no_weapon", false);
    else if (!ammunition(game, player, weapon)) game.message(player.actor.id, game.options.edition === "classic" ? "not enough ammo.\n" : "$qc_not_enough_ammo", false);
    else game.selectWeapon(player.actor, weapon);
    return true;
  }
  if (impulse === 10 || impulse === 12) {
    const index = WEAPONS.findIndex(weapon => weapon === player.weapon), direction = impulse === 10 ? 1 : -1;
    for (let offset = 1; offset <= WEAPONS.length; offset++) {
      const weapon = WEAPONS[(index + direction * offset + WEAPONS.length * 2) % WEAPONS.length];
      if (weapon !== undefined && ammunition(game, player, weapon) && game.selectWeapon(player.actor, weapon)) break;
    }
    return true;
  }
  return false;
}
export function baseQ1Impulse(source: Q1SourceComposition, player: Q1PlayerState, impulse: number): boolean {
  const { game, services, selection } = source;
  if (impulse === 11) { source.base.campaign.writeFlags(Math.fround(source.base.campaign.readFlags() * 2 + 1)); return true; }
  if (impulse === 9) {
    if ((game.options.deathmatch !== 0 || game.options.coop) && (game.options.edition === "classic" || services.cvar("sv_cheats") === 0)) return true;
    const foreignArsenal = services.cheatArsenal?.(player.actor.id) ?? false;
    if (!foreignArsenal) {
      for (const weapon of WEAPONS) setCount(game, player, game.weaponItem(weapon), 1, 1);
      setCount(game, player, "q1:ammo/shells", 100, 100); setCount(game, player, "q1:ammo/nails", 200, 200);
      setCount(game, player, "q1:ammo/rockets", 100, 100); setCount(game, player, "q1:ammo/cells", 200, 100);
    }
    setCount(game, player, "q1:key/silver", 1, 1); setCount(game, player, "q1:key/gold", 1, 1);
    if (selection.program === "ctf") setCount(game, player, "q1:ctf/weapon/grapple", 1, 1);
    if (game.options.edition === "rerelease" && (selection.program === "id1" || selection.program === "ctf")) game.host.combat.setArmor(player.actor, { kind: "q1", points: 200, absorption: 0.8, item: "q1:item_armorInv" });
    if (!foreignArsenal) services.selectWeapon(player.actor.id, game.weaponItem("rocketlauncher"));
    return true;
  }
  if (impulse === 255) {
    const sourceCheats = game.options.edition === "rerelease" && (selection.program === "id1" || selection.program === "ctf");
    if (sourceCheats ? services.cvar("sv_cheats") === 0 : game.options.deathmatch !== 0 || game.options.coop) return true;
    game.givePowerup(player, "quad"); services.emit({ kind: "developer-message", text: "quad cheat\n" }); return true;
  }
  return false;
}
