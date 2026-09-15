import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import { nativeAtoi } from "../../../core/numeric.ts";
import { WEAPONS } from "../../q1/foundation/types.ts";
import { givePickup } from "../../q1/foundation/pickups.ts";
import type { Q1SourceComposition } from "./runtime.ts";

/** Host give syntax plus shared named/category grants, using the selected inventory and real item touches. */
export function giveQ1(source: Q1SourceComposition, actor: ActorId, args: readonly string[]): undefined {
  const { game, services } = source, player = game.player(actor);
  if (player === null) throw new Error("Q1 give requires an admitted player");
  const input = args[0]?.toLowerCase(); if (input === undefined) throw new Error("Usage: give <all|weapons|ammo|health|armor|keys|item> [amount]");
  const amount = args[1] === undefined ? undefined : nativeAtoi(args[1]), all = input === "all";
  const weapons = [...new Set([...WEAPONS, ...game.registeredWeapons.keys()])];
  const configure = (item: ItemId, count: number, capacity = count) => {
    const previous = game.host.inventory.entries(actor).find(entry => entry.item === item);
    return game.host.inventory.configure(player.actor, { item, count: Math.max(0, count), capacity: Math.max(capacity, previous?.capacity ?? 0, count) });
  };
  const ammoCount = (item: ItemId, count: number) => {
    if (game.pickupAdmission === null && services.giveSelectedItem?.(actor, [item, String(count)]) === true) return undefined;
    const mapped = game.pickupAdmission?.preview(actor, { kind: "ammo", offer: { item, amount: Math.max(1, count) } });
    if (mapped === undefined) return configure(item, count);
    for (const entry of mapped.ammo) configure(entry.item, count);
    return undefined;
  };
  if (all || input === "health" || input === "h") {
    game.host.combat.setHealth(player.actor, amount ?? (input === "h" ? 0 : player.maxHealth)); if (!all) return undefined;
  }
  if (all || input === "armor" || input === "a") {
    const points = amount ?? (input === "a" ? 0 : 200);
    game.host.combat.setArmor(player.actor, points <= 0 ? { kind: "none" } : { kind: "q1", points,
      absorption: points > 150 ? 0.8 : points > 100 ? 0.6 : 0.3,
      item: points > 150 ? "q1:item_armorInv" : points > 100 ? "q1:item_armor2" : "q1:item_armor1" });
    if (!all) return undefined;
  }
  if (all || input === "weapons") {
    if (!(services.cheatArsenal?.(actor, "weapons") ?? false)) for (const weapon of weapons) configure(game.weaponItem(weapon), 1, 1);
    if (!all) return undefined;
  }
  if (all || input === "ammo") {
    if (!(services.cheatArsenal?.(actor, "ammo") ?? false)) for (const item of new Set(weapons.flatMap(weapon => {
      const ammo = game.weaponAmmo(weapon); return ammo === null ? [] : [ammo];
    }))) configure(item, item.includes("nails") ? 200 : 100);
    if (!all) return undefined;
  }
  if (all || input === "keys") {
    configure("q1:key/silver", 1, 1); configure("q1:key/gold", 1, 1); return undefined;
  }
  if (input === "items") {
    for (const item of ["quad", "pent", "ring", "suit"]) giveQ1(source, actor, [item]);
    return undefined;
  }
  const shorthand = input === "s" ? "q1:ammo/shells" : input === "n" ? "q1:ammo/nails" : input === "r" ? "q1:ammo/rockets" : input === "c" ? "q1:ammo/cells"
    : input === "l" ? "rogue:ammo/lava-nails" : input === "m" ? "rogue:ammo/multi-rockets" : input === "p" ? "rogue:ammo/plasma" : null;
  if (shorthand !== null) {
    if (!weapons.some(weapon => game.weaponAmmo(weapon) === shorthand)) throw new Error(`Ammo ${input} is unavailable in this arsenal`);
    return ammoCount(shorthand, amount ?? 0);
  }
  const hipnotic = game.registeredWeapons.has("hipnotic:laser");
  const last = args.at(-1), namedInput = (args.length > 1 && last !== undefined && /^-?\d+$/.test(last) ? args.slice(0, -1) : args).join(" ").toLowerCase();
  const normalize = (name: string) => name.replaceAll(" ", "").replaceAll("_", "");
  const numbered = hipnotic && input === "6a" ? "hipnotic:proximity" : hipnotic && input === "9" ? "hipnotic:laser"
    : hipnotic && input === "0" ? "hipnotic:mjolnir" : /^[2-8]$/.test(input) ? WEAPONS[Number(input) - 1] : undefined;
  const weapon = weapons.find(weapon => weapon === numbered || normalize(weapon) === normalize(namedInput)
    || normalize(game.weaponItem(weapon)) === normalize(namedInput) || normalize(`weapon_${weapon}`) === normalize(namedInput));
  if (weapon !== undefined) {
    if (game.pickupAdmission === null && services.giveSelectedItem?.(actor, [game.weaponItem(weapon)]) === true) return undefined;
    if (game.pickupAdmission === null) return configure(game.weaponItem(weapon), 1, 1);
    game.pickupAdmission.weapon(player.actor, { item: game.weaponItem(weapon), ammo: [] }, "never"); return undefined;
  }
  const ammo = [...new Set(weapons.map(weapon => game.weaponAmmo(weapon)))].find(item => item !== null && (item === input || item.split("/").at(-1) === input));
  if (ammo !== undefined && ammo !== null) return ammoCount(ammo, amount ?? (game.host.inventory.count(actor, ammo) + 20));
  const classname = input === "quad" ? "item_artifact_super_damage" : input === "pent" ? "item_artifact_invulnerability"
    : input === "ring" ? "item_artifact_invisibility" : input === "suit" ? "item_artifact_envirosuit" : input;
  if (services.giveSelectedItem?.(actor, args) === true) return undefined;
  if (!classname.startsWith("item_") && !classname.startsWith("weapon_")) throw new Error(`Unknown Q1 item: ${args.join(" ")}`);
  const item = game.create(classname);
  try {
    if (givePickup(game, item, actor)) return undefined;
    game.spawnEntity(item); if (!game.live(item) || item.touch === null) throw new Error(`Item is not giveable: ${classname}`);
    game.cancel(item); item.solid = "trigger";
    game.host.callbacks.touch({ self: item.actor, other: actor, plane: null, surface: null });
  } finally { if (game.live(item)) game.remove(item); }
  return undefined;
}
