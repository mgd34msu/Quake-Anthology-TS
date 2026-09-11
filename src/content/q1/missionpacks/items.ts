/* Hipnotic hipitems.qc/items.qc and Rogue items.qc/newitems.qc/random.qc. GPL-2.0-or-later. */
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Bounds } from "../../../contracts/math.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1PlayerState, Q1Powerup } from "../foundation/types.ts";
import { ZERO, weaponItem } from "../foundation/types.ts";
import { missionWeapons } from "./types.ts";
import type { MissionWeaponDefinition, Q1MissionPack } from "./types.ts";
import { missionMessage, missionPickupMessage } from "./messages.ts";

interface ItemAppearance { readonly model: string; readonly sound: string; readonly name: string; readonly bounds: Bounds; }
type MissionItem = ItemAppearance & (
  { readonly kind: "weapon"; readonly weapon: MissionWeaponDefinition } |
  { readonly kind: "ammo"; readonly item: ItemId; readonly amount: number } |
  { readonly kind: "powerup"; readonly powerup: Q1Powerup; readonly seconds: number } |
  { readonly kind: "horn" | "sphere" }
);
export interface MissionItemServices {
  readonly pack: Q1MissionPack;
  horn(item: Q1Actor, player: Q1PlayerState): undefined;
  sphere(item: Q1Actor, player: Q1PlayerState): boolean;
  powerup(player: Q1PlayerState, powerup: Q1Powerup, seconds: number): undefined;
  enableCombos(player: Q1PlayerState): undefined;
}
const artifactBounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
const floorBounds: Bounds = { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 32 } };
const weaponBounds: Bounds = { min: floorBounds.min, max: { x: 16, y: 16, z: 56 } };
function randomType(game: Q1Foundation, item: Q1Actor): undefined {
  const value = game.host.random();
  item.fields.set("rogue:random-type", value < 0.2 ? "item_powerup_shield" : value < 0.4 ? "item_powerup_belt" : value < 0.6 ? "item_artifact_invulnerability" : value < 0.8 ? "item_artifact_invisibility" : "item_artifact_super_damage"); return undefined;
}
function definition(entity: Q1Actor): MissionItem | null {
  const name = entity.classname === "item_random_powerup" ? entity.text("rogue:random-type") : entity.classname;
  const weapon = missionWeapons.find(candidate => candidate.pickup === name);
  if (weapon !== undefined) return { kind: "weapon", weapon, model: weapon.worldModel, sound: "weapons/pkup.wav", name: weapon.id === "hipnotic:laser" ? "$qc_laser_cannon" : weapon.id === "hipnotic:mjolnir" ? "$qc_mjolnir" : "$qc_prox_gun", bounds: weaponBounds };
  if (name === "item_artifact_wetsuit") return { kind: "powerup", powerup: "hipnotic:wetsuit", seconds: 30, model: "progs/wetsuit.mdl", sound: "misc/weton.wav", name: "$qc_wetsuit", bounds: artifactBounds };
  if (name === "item_artifact_empathy_shields") return { kind: "powerup", powerup: "hipnotic:empathy", seconds: 30, model: "progs/empathy.mdl", sound: "hipitems/empathy.wav", name: "$qc_empathy_shields", bounds: floorBounds };
  if (name === "item_hornofconjuring") return { kind: "horn", model: "progs/horn.mdl", sound: "hipitems/horn.wav", name: "$qc_horn_of_conjuring", bounds: floorBounds };
  if (name === "item_powerup_shield") return { kind: "powerup", powerup: "rogue:shield", seconds: 30, model: "progs/shield.mdl", sound: "shield/pickup.wav", name: "$qc_power_shield", bounds: artifactBounds };
  if (name === "item_powerup_belt") return { kind: "powerup", powerup: "rogue:antigrav", seconds: 45, model: "progs/beltup.mdl", sound: "belt/pickup.wav", name: "$qc_anti_grav_belt", bounds: artifactBounds };
  if (name === "item_sphere") return { kind: "sphere", model: "progs/sphere.mdl", sound: "sphere/sphere.wav", name: "$qc_vengeance_sphere", bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } };
  const big = (entity.spawnflags & 1) !== 0;
  if (name === "item_lava_spikes" || name === "item_multi_rockets" || name === "item_plasma") {
    const lava = name === "item_lava_spikes", rockets = name === "item_multi_rockets";
    return { kind: "ammo", item: lava ? "rogue:ammo/lava-nails" : rockets ? "rogue:ammo/multi-rockets" : "rogue:ammo/plasma", amount: (lava ? 25 : rockets ? 5 : 6) * (big ? 2 : 1),
      model: `maps/b_${lava ? "lnail" : rockets ? "mrock" : "plas"}${big ? 1 : 0}.bsp`, sound: "weapons/lock4.wav", name: lava ? "$qc_lava_nails" : rockets ? "$qc_multi_rockets" : "plasma", bounds: { min: ZERO, max: { x: 32, y: 32, z: 56 } } };
  }
  if (entity.classname === "item_random_powerup") {
    const powerup: Q1Powerup = name === "item_artifact_invulnerability" ? "invulnerability" : name === "item_artifact_invisibility" ? "invisibility" : "quad";
    return { kind: "powerup", powerup, seconds: 30, model: `progs/${powerup === "invulnerability" ? "invulner" : powerup === "invisibility" ? "invisibl" : "quaddama"}.mdl`,
      sound: `items/${powerup === "invulnerability" ? "protect" : powerup === "invisibility" ? "inv1" : "damage"}.wav`, name: powerup === "quad" ? "$qc_quad_damage" : powerup === "invisibility" ? "$qc_ring_of_shadows" : "$qc_pentagram_of_protection", bounds: artifactBounds };
  }
  return null;
}
export function hipnoticWeaponRank(weapon: Q1PlayerState["weapon"]): number {
  switch (weapon) {
    case "lightning": return 1;
    case "rocketlauncher": return 2;
    case "hipnotic:laser": return 3;
    case "supernailgun": return 4;
    case "hipnotic:proximity": return 5;
    case "grenadelauncher": return 6;
    case "supershotgun": return 7;
    case "nailgun": return 8;
    case "hipnotic:mjolnir": return 9;
    default: return 10;
  }
}
function takeWeapon(game: Q1Foundation, player: Q1PlayerState, weapon: MissionWeaponDefinition): "refused" | "leave" | "taken" {
  const leave = game.pickupRules?.weaponLeave?.(game) ?? false, item = weaponItem(weapon.id), owned = game.host.inventory.count(player.actor.id, item) > 0;
  if (leave && owned) return "refused";
  game.host.inventory.give(player.actor, item, 1); game.host.inventory.give(player.actor, weapon.ammo ?? "q1:ammo/cells", weapon.pickupAmmo);
  if (game.pickupRules?.autoSwitch?.(game, player, owned) ?? true) {
    if (game.options.deathmatch === 0 || weapon.rank < hipnoticWeaponRank(player.weapon)) game.selectWeapon(player.actor, weapon.id);
  }
  return leave ? "leave" : "taken";
}
function pickup(game: Q1Foundation, entity: Q1Actor, other: ActorId, services: MissionItemServices): undefined {
  const item = definition(entity), player = game.player(other);
  if (item === null || player === null || entity.solid !== "trigger" || item.kind !== "horn" && game.health(other) <= 0) return undefined;
  let result: "refused" | "leave" | "taken" = "taken";
  switch (item.kind) {
    case "weapon": result = takeWeapon(game, player, item.weapon); break;
    case "ammo": {
      const best = game.chooseBest(player.actor);
      if (game.host.inventory.give(player.actor, item.item, item.amount) === 0) return undefined;
      services.enableCombos(player); if (player.weapon === best && (game.options.edition === "classic" || player.autoSwitch !== "never")) game.selectWeapon(player.actor, game.chooseBest(player.actor)); break;
    }
    case "powerup": services.powerup(player, item.powerup, item.seconds); break;
    case "sphere": if (!services.sphere(entity, player)) return undefined; break;
    case "horn": break;
  }
  if (result === "refused") return undefined;
  if (item.kind === "horn") missionMessage(game, other, "$qc_got_horn"); else missionPickupMessage(game, other, item.name);
  game.sound(player.actor, item.sound, item.kind === "weapon" || item.kind === "ammo" ? "item" : "voice", item.kind === "horn" ? 0 : 1);
  game.effect("pickup", game.body(entity).origin, other);
  if (result === "leave") return undefined;
  entity.solid = "none"; entity.model = ""; game.link(entity);
  const respawn = item.kind === "sphere" ? 180 : item.kind === "ammo" && game.options.edition === "rerelease" && [3, 5].includes(game.options.deathmatch) ? 15 :
    item.kind === "weapon" || item.kind === "ammo" || entity.classname === "item_random_powerup" && item.kind === "powerup" && item.powerup !== "rogue:shield" && item.powerup !== "rogue:antigrav" ? 30 : 60;
  const returns = item.kind === "weapon" || item.kind === "ammo" ? game.options.edition === "classic" ? game.options.deathmatch === 1 : game.options.deathmatch !== 0 && game.options.deathmatch !== 2 : game.options.deathmatch !== 0;
  if (returns)
    game.schedule(entity, respawn, game.named.action(entity, entity.classname === "item_random_powerup" ? "missionpack:random-regen" : "SUB_regen"));
  else game.cancel(entity);
  if (item.kind === "horn") services.horn(entity, player); else game.useTargets(entity, other);
  return undefined;
}
export function registerMissionPackItems(game: Q1Foundation, services: MissionItemServices): undefined {
  game.named.register("missionpack:item-touch", { touch: (runtime, entity, other) => pickup(runtime, entity, other, services) });
  game.named.register("missionpack:random-regen", { action: (runtime, entity) => {
    randomType(runtime, entity); const item = definition(entity); if (item === null) throw new Error("Missing Rogue random powerup definition");
    entity.model = item.model; entity.originalModel = item.model; entity.solid = "trigger"; runtime.sound(entity, "items/itembk2.wav"); return runtime.link(entity);
  } });
  const classnames = services.pack === "hipnotic" ? ["weapon_laser_gun", "weapon_mjolnir", "weapon_proximity_gun", "item_artifact_wetsuit", "item_artifact_empathy_shields", "item_hornofconjuring"] :
    ["item_lava_spikes", "item_multi_rockets", "item_plasma", "item_powerup_shield", "item_powerup_belt", "item_sphere", "item_random_powerup"];
  for (const classname of classnames) game.registerSpawn(classname, (runtime, entity) => {
    if (runtime.options.deathmatch === 0 && (classname === "item_sphere" || classname === "item_random_powerup")) return runtime.remove(entity);
    if (classname === "item_random_powerup") randomType(runtime, entity);
    const item = definition(entity); if (item === null) throw new Error(`Unknown mission-pack item ${classname}`);
    entity.model = item.model; entity.originalModel = item.model; entity.solid = "none"; entity.movement = "none";
    if (item.kind === "sphere") entity.angularVelocity = { x: 40, y: 40, z: 40 };
    entity.touch = runtime.named.touch(entity, "missionpack:item-touch"); runtime.setBounds(entity, item.bounds);
    return runtime.schedule(entity, 0.2, runtime.named.action(entity, "PlaceItem"));
  });
  return undefined;
}
