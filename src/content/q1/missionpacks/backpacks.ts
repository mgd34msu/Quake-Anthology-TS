/* Hipnotic/Rogue items.qc DropBackpack changes over the shared source lifecycle. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState, Q1Weapon } from "../foundation/types.ts";
import { vadd, vscale, weaponItem } from "../foundation/types.ts";
import { aim } from "../foundation/weapons.ts";
import { dropBackpack } from "../base/projectiles.ts";
import type { Q1MissionPack } from "./types.ts";
import type { MissionPackPlayers } from "./player.ts";
import { missionMessage, missionPickupMessage } from "./messages.ts";

function baseWeapon(weapon: Q1Weapon): Q1Weapon {
  switch (weapon) {
    case "rogue:lava-nailgun": return "nailgun";
    case "rogue:lava-supernailgun": return "supernailgun";
    case "rogue:multi-grenade": return "grenadelauncher";
    case "rogue:multi-rocket": return "rocketlauncher";
    case "rogue:plasma": return "lightning";
    default: return weapon;
  }
}
export function dropMissionPackBackpack(game: Q1EntityServices, actor: OwnedActor, pack: Q1MissionPack): Q1Actor | null {
  const player = game.player(actor.id), body = game.host.bodies.read(actor.id); if (player === null || body === null) return null;
  const inventory = game.host.inventory;
  const shells = inventory.count(actor.id, "q1:ammo/shells"), nails = inventory.count(actor.id, "q1:ammo/nails"), rockets = inventory.count(actor.id, "q1:ammo/rockets"), cells = inventory.count(actor.id, "q1:ammo/cells");
  if (pack === "hipnotic") {
    if (shells + nails + rockets + cells === 0) return null;
    return dropBackpack(game, body.origin, { weapon: player.weapon, shells, nails, rockets,
      cells: game.options.edition === "rerelease" && (player.weapon === "hipnotic:laser" || player.weapon === "hipnotic:mjolnir") ? Math.max(15, cells) : cells,
      selection: "rank", avoidUnderwaterLightning: true });
  }
  const lava = inventory.count(actor.id, "rogue:ammo/lava-nails"), multi = inventory.count(actor.id, "rogue:ammo/multi-rockets"), plasma = inventory.count(actor.id, "rogue:ammo/plasma");
  // Both source editions omit plasma from this early empty-backpack check.
  if (shells + nails + rockets + cells + lava + multi === 0) return null;
  return dropBackpack(game, body.origin, { weapon: baseWeapon(player.weapon), shells, nails, rockets, cells, ownerPickupDelay: 1,
    extra: [{ item: "rogue:ammo/lava-nails", count: lava }, { item: "rogue:ammo/multi-rockets", count: multi }, { item: "rogue:ammo/plasma", count: plasma }] });
}

interface TossAmmo { readonly item: ItemId; readonly amount: number; readonly selected: readonly Q1Weapon[]; readonly owners: readonly Q1Weapon[]; }
const tossAmmo: readonly TossAmmo[] = [
  { item: "q1:ammo/shells", amount: 20, selected: ["shotgun", "supershotgun"], owners: ["shotgun", "supershotgun"] },
  { item: "q1:ammo/nails", amount: 20, selected: ["nailgun", "supernailgun"], owners: ["nailgun", "supernailgun"] },
  { item: "rogue:ammo/lava-nails", amount: 20, selected: ["rogue:lava-nailgun", "rogue:lava-supernailgun"], owners: ["nailgun", "supernailgun"] },
  { item: "q1:ammo/rockets", amount: 10, selected: ["grenadelauncher", "rocketlauncher"], owners: ["grenadelauncher", "rocketlauncher"] },
  { item: "rogue:ammo/multi-rockets", amount: 10, selected: ["rogue:multi-grenade", "rogue:multi-rocket"], owners: ["grenadelauncher", "rocketlauncher"] },
  { item: "q1:ammo/cells", amount: 20, selected: ["lightning"], owners: ["lightning"] },
  { item: "rogue:ammo/plasma", amount: 10, selected: ["rogue:plasma"], owners: ["lightning"] },
];
export function tossRogueBackpack(game: Q1EntityServices, player: Q1PlayerState): Q1Actor | null {
  const ammo = game.weaponAmmo(player.weapon), body = game.host.bodies.read(player.actor.id), inventory = game.host.inventory;
  if ((game.options.teamplay ?? 0) < 1 || ammo === null || inventory.count(player.actor.id, ammo) <= 0 || body === null) return null;
  const amounts = new Map<ItemId, number>();
  for (const rule of tossAmmo) {
    const take = (): undefined => { const count = Math.min(rule.amount, inventory.count(player.actor.id, rule.item)); inventory.consume(player.actor, rule.item, count); amounts.set(rule.item, count); return undefined; };
    if (rule.selected.includes(player.weapon)) take();
    if (rule.owners.every(weapon => inventory.count(player.actor.id, weaponItem(weapon)) === 0)) take();
  }
  if ([...amounts.values()].reduce((sum, value) => sum + value, 0) === 0) { missionMessage(game, player.actor.id, "$qc_no_ammo_available"); return null; }
  const forward = game.makeVectors(player.viewAngles).forward;
  const backpack = dropBackpack(game, body.origin, { weapon: null, shells: amounts.get("q1:ammo/shells") ?? 0, nails: amounts.get("q1:ammo/nails") ?? 0,
    rockets: amounts.get("q1:ammo/rockets") ?? 0, cells: amounts.get("q1:ammo/cells") ?? 0, ownerPickupDelay: 1,
    extra: [{ item: "rogue:ammo/lava-nails", count: amounts.get("rogue:ammo/lava-nails") ?? 0 }, { item: "rogue:ammo/multi-rockets", count: amounts.get("rogue:ammo/multi-rockets") ?? 0 }, { item: "rogue:ammo/plasma", count: amounts.get("rogue:ammo/plasma") ?? 0 }],
  }, { origin: vadd(body.origin, { x: 0, y: 0, z: 16 }), velocity: vscale(aim(game, player.actor, forward), 500), movement: "bounce" });
  if (backpack !== null) backpack.owner = player.actor.id;
  return backpack;
}
interface TossWeapon { readonly weapon: Q1Weapon; readonly powered?: Q1Weapon; readonly classname: string; readonly model: string; readonly name: string; }
const tossWeapons: readonly TossWeapon[] = [
  { weapon: "supershotgun", classname: "weapon_supershotgun", model: "progs/g_shot.mdl", name: "$qc_double_shotgun" },
  { weapon: "nailgun", powered: "rogue:lava-nailgun", classname: "weapon_nailgun", model: "progs/g_nail.mdl", name: "$qc_nailgun" },
  { weapon: "supernailgun", powered: "rogue:lava-supernailgun", classname: "weapon_supernailgun", model: "progs/g_nail2.mdl", name: "$qc_super_nailgun" },
  { weapon: "grenadelauncher", powered: "rogue:multi-grenade", classname: "weapon_grenadelauncher", model: "progs/g_rock.mdl", name: "$qc_grenade_launcher" },
  { weapon: "rocketlauncher", powered: "rogue:multi-rocket", classname: "weapon_rocketlauncher", model: "progs/g_rock2.mdl", name: "$qc_rocket_launcher" },
  { weapon: "lightning", powered: "rogue:plasma", classname: "weapon_lightning", model: "progs/g_light.mdl", name: "$qc_thunderbolt" },
];
export function tossRogueWeapon(game: Q1EntityServices, player: Q1PlayerState): Q1Actor | null {
  const definition = tossWeapons.find(candidate => candidate.weapon === player.weapon || candidate.powered === player.weapon), body = game.host.bodies.read(player.actor.id);
  if (game.options.deathmatch !== 1 || (game.options.teamplay ?? 0) < 1 || definition === undefined || body === null) return null;
  const item = game.create(definition.classname); item.owner = player.actor.id; item.model = definition.model; item.movement = "bounce"; item.solid = "trigger";
  const forward = game.makeVectors(player.viewAngles).forward;
  game.setBody(item, { origin: vadd(body.origin, { x: 0, y: 0, z: 16 }), velocity: vscale(aim(game, player.actor, forward), 500), bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
  game.host.inventory.consume(player.actor, weaponItem(definition.weapon), 1);
  if (definition.powered !== undefined) game.host.inventory.consume(player.actor, weaponItem(definition.powered), 1);
  item.touch = game.named.touch(item, "rogue:tossed-weapon-touch"); game.schedule(item, 120, game.named.action(item, "SUB_Remove")); game.link(item);
  game.selectWeapon(player.actor, game.chooseBest(player.actor)); return item;
}
export function registerRogueTossCallbacks(game: Q1EntityServices, players: MissionPackPlayers): undefined {
  return game.named.register("rogue:tossed-weapon-touch", { touch: (runtime, item, other: ActorId) => {
    const player = runtime.player(other), definition = tossWeapons.find(candidate => candidate.classname === item.classname);
    if (player === null || definition === undefined || item.owner !== null && sameActor(item.owner, other) && item.nextThink - runtime.time > 119) return undefined;
    missionPickupMessage(runtime, other, definition.name); runtime.sound(player.actor, "weapons/pkup.wav", "item"); runtime.effect("pickup", runtime.body(item).origin, other);
    runtime.host.inventory.give(player.actor, weaponItem(definition.weapon), 1); runtime.remove(item);
    if (runtime.options.deathmatch === 0 || (runtime.pickupRules?.weaponRank?.(definition.weapon) ?? 12) < (runtime.pickupRules?.weaponRank?.(player.weapon) ?? 12)) runtime.selectWeapon(player.actor, definition.weapon);
    return players.enableCombos(player);
  } });
}
