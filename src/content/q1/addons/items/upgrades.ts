/* quakec_mg3/mg3_upgrades.qc and client.qc. GPL-2.0-or-later. */
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1PlayerState } from "../../foundation/types.ts";
import { vadd } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../persistence/value.ts";
import { BLOODY_NIGHTMARE_ACTIVE } from "../campaign.ts";
import { MG3_BLOODY_SUPER_SHOTGUN } from "./pickups.ts";
import { finishMg3Pickup, MG3_ITEM_PREFIX, startMg3Item } from "./common.ts";

export type Mg3Upgrade = "health" | "shells" | "nails" | "rockets" | "cells";
interface UpgradeDefinition {
  readonly type: Mg3Upgrade; readonly parm: string; readonly base: number; readonly deathmatch: number;
  readonly model: string; readonly label: string; readonly ammo: ItemId | null;
}
const upgrades: readonly UpgradeDefinition[] = [
  { type: "health", parm: "parm10", base: 50, deathmatch: 100, model: "item_h_player", label: "health", ammo: null },
  { type: "shells", parm: "parm11", base: 50, deathmatch: 100, model: "backpackshells", label: "shell", ammo: "q1:ammo/shells" },
  { type: "nails", parm: "parm12", base: 100, deathmatch: 200, model: "backpacknails", label: "nail", ammo: "q1:ammo/nails" },
  { type: "rockets", parm: "parm13", base: 20, deathmatch: 100, model: "backpacker", label: "rocket", ammo: "q1:ammo/rockets" },
  { type: "cells", parm: "parm14", base: 100, deathmatch: 200, model: "backpackcells", label: "cell", ammo: "q1:ammo/cells" },
];

const travelParms = ["parm10", "parm11", "parm12", "parm13", "parm14", "parm15"];

export function captureMg3UpgradeTravel(context: Q1AddonContext, player: Q1PlayerState): Uint8Array {
  return encodeCheckpointValue(travelParms.map(parm => context.playerNumber(player.actor.id, parm)));
}

export function restoreMg3UpgradeTravel(context: Q1AddonContext, player: Q1PlayerState, bytes: Uint8Array): undefined {
  const reader = new SaveReader(decodeCheckpointValue(bytes), "mg3:upgrade-travel"), values = reader.list(value => {
    const number = value.integer(0); return number <= 8388607 ? number : value.fail("MG3 source parameter exceeds its flag word");
  });
  if (values.length !== travelParms.length) return reader.fail("expected six MG3 source travel parameters");
  for (const [index, parm] of travelParms.entries()) {
    const value = values[index]; if (value === undefined) return reader.fail("missing source travel parameter");
    context.setPlayerNumber(player.actor.id, parm, value);
  }
  const { game, base } = context, flags = base.campaign.readFlags();
  if ((flags & BLOODY_NIGHTMARE_ACTIVE) !== 0) {
    if (context.services.cvar("skill") !== 3) base.campaign.writeFlags(flags & ~BLOODY_NIGHTMARE_ACTIVE);
    else {
      const hammer = game.host.inventory.count(player.actor.id, game.weaponItem("mg3:mjolnir")) !== 0;
      const bloodySuper = (context.playerNumber(player.actor.id, "parm15") & MG3_BLOODY_SUPER_SHOTGUN) !== 0;
      for (const entry of game.host.inventory.entries(player.actor.id)) if (entry.item.startsWith("q1:weapon/")) {
        const owned = entry.item === game.weaponItem("axe") || entry.item === game.weaponItem("shotgun")
          || hammer && entry.item === game.weaponItem("mg3:mjolnir") || bloodySuper && entry.item === game.weaponItem("supershotgun");
        game.host.inventory.configure(player.actor, { ...entry, count: owned ? 1 : 0 });
      }
      if (bloodySuper) game.host.inventory.configure(player.actor, { item: game.weaponItem("supershotgun"), count: 1, capacity: 1 });
      if (player.weapon !== "axe" && player.weapon !== "mg3:mjolnir" && player.weapon !== "shotgun") player.weapon = "shotgun";
    }
  }
  initializeMg3Capacities(context, player); game.selectWeapon(player.actor, player.weapon); return undefined;
}

export function mg3UpgradeFlag(map: string): number {
  if (map === "map2b") return 8192;
  const maps = ["map1", "map2", "map3", "map4", "map5", "map6", "map7", "map8", "secret1", "secret2", "secret3", "secret4", "secret5"];
  const index = maps.indexOf(map);
  return index >= 0 ? 1 << index : map === "secret6" ? 16384 : 0;
}

export function mg3UpgradedMaximum(base: number, flags: number): number {
  let result = base;
  for (let bit = 0; bit < 23; bit++) if ((flags & (1 << bit)) !== 0) result += 10;
  return result;
}

function definition(type: string): UpgradeDefinition {
  const result = upgrades.find(upgrade => upgrade.type === type);
  if (result === undefined) throw new Error(`Unknown MG3 upgrade ${type}`);
  return result;
}

export function initializeMg3Capacities(context: Q1AddonContext, player: Q1PlayerState): undefined {
  const { game } = context;
  for (const upgrade of upgrades) {
    const capacity = game.options.deathmatch !== 0 ? upgrade.deathmatch : mg3UpgradedMaximum(upgrade.base, context.playerNumber(player.actor.id, upgrade.parm));
    if (upgrade.ammo === null) {
      player.maxHealth = capacity;
      if (game.health(player.actor.id) > capacity) game.host.combat.setHealth(player.actor, capacity);
    } else game.host.inventory.configure(player.actor, { item: upgrade.ammo, capacity, count: Math.min(capacity, game.host.inventory.count(player.actor.id, upgrade.ammo)) });
  }
  return undefined;
}

function upgradeTouch(context: Q1AddonContext, entity: Q1Actor, other: ActorId): undefined {
  const { game } = context, player = game.player(other);
  if (player === null) return undefined;
  const upgrade = definition(entity.text("mg3.upgrade")), flag = entity.number("upgrade_flag"), flags = context.playerNumber(other, upgrade.parm);
  const collected = (flags & flag) !== 0;
  let maximum = player.maxHealth;
  if (!collected) {
    context.setPlayerNumber(other, upgrade.parm, flags | flag);
    if (upgrade.ammo === null) {
      maximum = player.maxHealth = Math.fround(player.maxHealth + 10);
      const health = game.health(other);
      if (health > 0 && health < maximum) game.host.combat.setHealth(player.actor, Math.min(maximum, health + maximum));
    } else {
      const current = game.host.inventory.entries(other).find(entry => entry.item === upgrade.ammo);
      maximum = (current?.capacity ?? upgrade.base) + 10;
      game.host.inventory.configure(player.actor, { item: upgrade.ammo, count: maximum, capacity: maximum });
    }
  }
  // GiveUpgradeBonus only bounds existing ammunition; its former bonus is commented out in QC.
  for (const entry of game.host.inventory.entries(other)) if (entry.item.startsWith("q1:ammo/") && entry.count > entry.capacity)
    game.host.inventory.configure(player.actor, { ...entry, count: entry.capacity });
  game.selectWeapon(player.actor, player.weapon);
  return finishMg3Pickup(context, entity, other, collected ? `$mg3_qc_upgrade_fail $mg3_qc_upgrade_${upgrade.label}`
    : `$mg3_qc_upgrade_success $mg3_qc_upgrade_${upgrade.label} ${maximum}`, upgrade.type === "health" ? "player/tornoff2.wav" : "weapons/lock4.wav");
}

export function registerMg3Upgrades(context: Q1AddonContext): undefined {
  const { game } = context;
  game.named.register(MG3_ITEM_PREFIX + "upgrade_touch", { touch: (_game, entity, other) => upgradeTouch(context, entity, other) });
  game.named.register(MG3_ITEM_PREFIX + "upgrade_start", { action: (_game, entity) => {
    const upgrade = definition(entity.text("mg3.upgrade"));
    if (game.host.players().some(player => (context.playerNumber(player, upgrade.parm) & entity.number("upgrade_flag")) !== 0)) context.alpha(entity, 0.6);
    entity.solid = "trigger"; entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + "upgrade_touch");
    return startMg3Item(context, entity);
  } });
  for (const upgrade of upgrades) game.registerSpawn(`item_upgrade_${upgrade.type}`, (_game, entity) => {
    if (entity.number("upgrade_flag") === 0) context.setNumber(entity, "upgrade_flag", mg3UpgradeFlag(game.mapName));
    entity.fields.set("mg3.upgrade", upgrade.type); entity.fields.set("netname", `$mg3_qc_upgrade_${upgrade.label}`);
    entity.model = `progs/${upgrade.model}.mdl`;
    if (upgrade.type === "health") game.setOrigin(entity, vadd(game.body(entity).origin, { x: 0, y: 0, z: 8 }));
    game.setBounds(entity, { min: { x: -16, y: -16, z: upgrade.type === "health" ? -8 : 0 }, max: { x: 16, y: 16, z: upgrade.type === "health" ? 48 : 56 } });
    return game.schedule(entity, 0.5, game.named.action(entity, MG3_ITEM_PREFIX + "upgrade_start"));
  });
  return undefined;
}

/** The source debug impulse grants the next uncollected bit through the ordinary touch path. */
export function giveNextMg3Upgrade(context: Q1AddonContext, type: Mg3Upgrade, player: Q1PlayerState): boolean {
  const upgrade = definition(type), flags = context.playerNumber(player.actor.id, upgrade.parm);
  for (let bit = 1; bit <= 16384; bit *= 2) if ((flags & bit) === 0) {
    const entity = context.game.create(`item_upgrade_${type}`); entity.fields.set("mg3.upgrade", type); context.setNumber(entity, "upgrade_flag", bit);
    upgradeTouch(context, entity, player.actor.id); return true;
  }
  return false;
}
