/* quakec_mg3/weapons.qc equipment branches of ImpulseCommands. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Q1PlayerState, Q1Weapon } from "../../foundation/types.ts";
import { WEAPONS } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { giveNextMg3Upgrade } from "./upgrades.ts";
import type { Mg3Upgrade } from "./upgrades.ts";
import { MG3_BLOODY_SHOTGUN, MG3_BLOODY_SUPER_SHOTGUN } from "./pickups.ts";

function count(context: Q1AddonContext, player: Q1PlayerState, item: ItemId, amount: number, capacity: number): undefined {
  const previous = context.game.host.inventory.entries(player.actor.id).find(entry => entry.item === item);
  return context.game.host.inventory.configure(player.actor, previous === undefined ? { item, count: amount, capacity } : { ...previous, count: amount });
}
function restock(context: Q1AddonContext, player: Q1PlayerState): undefined {
  count(context, player, "q1:ammo/shells", 100, 100); count(context, player, "q1:ammo/nails", 200, 200);
  count(context, player, "q1:ammo/rockets", 100, 100); count(context, player, "q1:ammo/cells", 200, 100); return undefined;
}
function enoughAmmo(context: Q1AddonContext, player: Q1PlayerState, weapon: Q1Weapon): boolean {
  if (weapon === "axe" || weapon === "mg3:mjolnir") return true;
  const item = context.game.weaponAmmo(weapon), minimum = weapon === "supershotgun" || weapon === "supernailgun" ? 2 : 1;
  return item === null || context.game.host.inventory.count(player.actor.id, item) >= minimum;
}
function melee(context: Q1AddonContext, player: Q1PlayerState): Q1Weapon {
  return context.game.host.inventory.count(player.actor.id, context.game.weaponItem("mg3:mjolnir")) !== 0 ? "mg3:mjolnir" : "axe";
}
function cycle(context: Q1AddonContext, player: Q1PlayerState, reverse: boolean): undefined {
  const order: readonly Q1Weapon[] = [melee(context, player), "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "rocketlauncher", "lightning", "mg3:laser"];
  let index = player.weapon === "axe" || player.weapon === "mg3:mjolnir" ? 0 : order.indexOf(player.weapon);
  // Native MG3 limits even an unrecognized source weapon to ten attempts.
  if (index < 0) return undefined;
  for (let remaining = 10; remaining > 0; remaining--) {
    index = (index + (reverse ? -1 : 1) + order.length) % order.length;
    const weapon = order[index];
    if (weapon !== undefined && enoughAmmo(context, player, weapon) && context.game.selectWeapon(player.actor, weapon)) return undefined;
  }
  return undefined;
}

/** Called after the source attack_finished gate; returns whether its source command was handled. */
export function handleMg3ItemImpulse(context: Q1AddonContext, actor: ActorId, impulse: number, developerMessage: (text: string) => undefined): boolean {
  if (context.program !== "mg3") return false;
  const { game } = context, player = game.player(actor); if (player === null) return false;
  if (impulse === 1 || impulse === 225) {
    const weapon = impulse === 1 ? melee(context, player) : "mg3:laser";
    if (game.host.inventory.count(actor, game.weaponItem(weapon)) === 0) game.message(actor, "$qc_no_weapon", false);
    else if (!enoughAmmo(context, player, weapon)) game.message(actor, "$qc_not_enough_ammo", false);
    else game.selectWeapon(player.actor, weapon);
    return true;
  }
  if (impulse === 10 || impulse === 12) { cycle(context, player, impulse === 12); return true; }
  if (impulse === 9 || impulse === 99) {
    if ((game.options.deathmatch !== 0 || game.options.coop) && context.services.cvar("sv_cheats") === 0) return true;
    restock(context, player);
    for (const weapon of [...WEAPONS, "mg3:laser"] satisfies readonly Q1Weapon[]) count(context, player, game.weaponItem(weapon), 1, 1);
    if (impulse !== 99) { count(context, player, "q1:key/silver", 1, 1); count(context, player, "q1:key/gold", 1, 1); }
    game.selectWeapon(player.actor, "rocketlauncher"); return true;
  }
  if (impulse === 100) {
    developerMessage("Resetting to defaults\n"); player.maxHealth = 100; game.host.combat.setHealth(player.actor, 100);
    for (const [item, capacity] of [["q1:ammo/shells", 100], ["q1:ammo/nails", 200], ["q1:ammo/rockets", 100], ["q1:ammo/cells", 100]] satisfies readonly (readonly [ItemId, number])[])
      game.host.inventory.configure(player.actor, { item, capacity, count: game.host.inventory.count(actor, item) });
    return true;
  }
  if (impulse >= 111 && impulse <= 115) {
    const types: readonly Mg3Upgrade[] = ["health", "shells", "nails", "rockets", "cells"], type = types[impulse - 111];
    if (type !== undefined) giveNextMg3Upgrade(context, type, player); return true;
  }
  if (impulse === 118) { count(context, player, game.weaponItem("mg3:mjolnir"), 1, 1); return true; }
  if (impulse === 122) {
    developerMessage("$m_inf_ammo"); const enabled = context.playerNumber(actor, "infiniteammo") === 0;
    context.setPlayerNumber(actor, "infiniteammo", enabled ? 1 : 0); if (enabled) restock(context, player); return true;
  }
  if (impulse === 227 || impulse === 228) {
    const flag = impulse === 227 ? MG3_BLOODY_SHOTGUN : MG3_BLOODY_SUPER_SHOTGUN, flags = context.playerNumber(actor, "parm15"), enabled = (flags & flag) === 0;
    context.setPlayerNumber(actor, "parm15", flags ^ flag);
    developerMessage(`${enabled ? "activated" : "deactivated"} 'bloody ${impulse === 227 ? "shotgun" : "Super Shotgun"}' upgrade\n`); return true;
  }
  return false;
}
