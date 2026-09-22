/* items.qc, Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { PickupSelection, PickupSupplyOffer, PickupSupplyObservation, PickupSupplyPreview } from "../../../contracts/pickups.ts";
import { previewPickupGrants } from "../../../world/gameplay/pickups.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1Actor } from "./entity.ts";
import type { Q1EntityServices } from "./entity-services.ts";
import type { Q1PlayerState, Q1Powerup, Q1Weapon } from "./types.ts";
import { vadd, ZERO, WEAPONS, weaponItem } from "./types.ts";
import { ammoItem } from "./entity-services.ts";

interface Pickup {
  readonly supply?: PickupSupplyOffer;
  readonly model: string;
  readonly sound: string;
  readonly bounds: "box" | "weapon" | "artifact";
  readonly skin: number;
  readonly respawn: number;
  readonly take: (game: Q1EntityServices, entity: Q1Actor, player: Q1PlayerState) => "refused" | "taken" | "leave";
}
function pickupDefinition(game: Q1EntityServices, entity: Q1Actor): Pickup | null {
  const name = entity.classname, big = (entity.spawnflags & (name === "item_weapon" ? 8 : 1)) !== 0;
  if (name === "item_health") {
    const mega = !big && (entity.spawnflags & 2) !== 0, amount = big ? 15 : mega ? 100 : 25;
    return { model: `maps/b_bh${big ? 10 : mega ? 100 : 25}.bsp`, sound: big ? "items/r_item1.wav" : mega ? "items/r_item2.wav" : "items/health1.wav", bounds: "box", skin: 0,
      respawn: mega ? 120 : 20, take: (runtime, _item, player) => {
        const health = runtime.health(player.actor.id); if (health <= 0 || health >= (mega ? 250 : player.maxHealth)) return "refused";
        runtime.host.combat.setHealth(player.actor, Math.min(mega ? 250 : player.maxHealth, health + amount));
        if (mega && runtime.options.edition === "rerelease") player.megaRotAt = runtime.time + 5; return "taken";
      } };
  }
  if (name === "item_armor1" || name === "item_armor2" || name === "item_armorInv") {
    const absorption = name === "item_armor1" ? 0.3 : name === "item_armor2" ? 0.6 : 0.8;
    const points = name === "item_armor1" ? 100 : name === "item_armor2" ? 150 : 200;
    const item: ItemId = `q1:${name}`;
    return { model: "progs/armor.mdl", sound: "items/armor1.wav", bounds: "weapon", skin: name === "item_armor1" ? 0 : name === "item_armor2" ? 1 : 2, respawn: 20,
      take: (runtime, _entity, player) => {
        const armor = runtime.host.combat.read(player.actor.id)?.armor.regular;
        if (armor?.kind === "source") return "refused";
        const current = armor === undefined || armor.kind === "none" ? 0 : armor.points * (armor.kind === "q1" ? armor.absorption : armor.kind === "q2" ? armor.normalProtection : armor.protection);
        if (current >= absorption * points) return "refused";
        runtime.host.combat.setRegularArmor(player.actor, { kind: "q1", points, absorption, item }); return "taken";
      } };
  }
  const weapon = WEAPONS.find(candidate => name === `weapon_${candidate}`);
  if (weapon !== undefined && weapon !== "axe" && weapon !== "shotgun") {
    const model = weapon === "supershotgun" ? "g_shot" : weapon === "nailgun" ? "g_nail" : weapon === "supernailgun" ? "g_nail2" : weapon === "grenadelauncher" ? "g_rock" : weapon === "rocketlauncher" ? "g_rock2" : "g_light";
    return { supply: { kind: "weapon", offer: weaponOffer(weapon) }, model: `progs/${model}.mdl`, sound: "weapons/pkup.wav", bounds: "weapon", skin: 0, respawn: 30,
      take: (runtime, _entity, player) => takeWeapon(runtime, player, weapon) };
  }
  const ammo: { readonly item: ItemId; readonly model: string; readonly amount: number } | null =
    name === "item_weapon" && (entity.spawnflags & 2) !== 0 ? { item: "q1:ammo/rockets", model: "rock", amount: big ? 10 : 5 } :
    name === "item_weapon" && (entity.spawnflags & 4) !== 0 ? { item: "q1:ammo/nails", model: "nail", amount: big ? 40 : 20 } :
    name === "item_weapon" && (entity.spawnflags & 1) !== 0 ? { item: "q1:ammo/shells", model: "shell", amount: big ? 40 : 20 } :
    name === "item_shells" ? { item: "q1:ammo/shells", model: "shell", amount: big ? 40 : 20 } :
    name === "item_spikes" ? { item: "q1:ammo/nails", model: "nail", amount: big ? 50 : 25 } :
    name === "item_rockets" ? { item: "q1:ammo/rockets", model: "rock", amount: big ? 10 : 5 } :
    name === "item_cells" ? { item: "q1:ammo/cells", model: "batt", amount: big ? 12 : 6 } : null;
  if (ammo !== null) {
    const offer = { item: ammo.item, amount: ammo.amount };
    return { supply: { kind: "ammo", offer }, model: `maps/b_${ammo.model}${big ? 1 : 0}.bsp`, sound: "weapons/lock4.wav", bounds: "box", skin: 0,
    respawn: game.options.deathmatch === 3 || game.options.deathmatch === 5 ? 15 : 30,
    take: (runtime, _entity, player) => {
      if (runtime.pickupAdmission !== null) return runtime.pickupAdmission.ammo(player.actor, offer) ? "taken" : "refused";
      const best = runtime.chooseBest(player.actor);
      if (runtime.host.inventory.give(player.actor, offer.item, offer.amount) === 0) return "refused";
      q1AmmoPickupSelection(runtime, player, best, player.autoSwitch !== "never"); return "taken";
    } };
  }
  if (name === "item_key1" || name === "item_key2") {
    const item: ItemId = name === "item_key1" ? "q1:key/silver" : "q1:key/gold";
    const prefix = game.worldType === 0 ? "w" : game.worldType === 1 ? "m" : "b";
    return { model: `progs/${prefix}_${name === "item_key1" ? "s" : "g"}_key.mdl`, sound: game.worldType === 2 ? "misc/basekey.wav" : game.worldType === 1 ? "misc/runekey.wav" : "misc/medkey.wav", bounds: "weapon", skin: 0, respawn: -1,
      take: (runtime, _entity, player) => {
        if (runtime.host.inventory.give(player.actor, item, 1) === 0) return "refused"; return runtime.options.coop ? "leave" : "taken";
      } };
  }
  const powerup: { readonly kind: Q1Powerup; readonly model: string; readonly sound: string } | null =
    name === "item_artifact_invulnerability" ? { kind: "invulnerability", model: "invulner", sound: "protect" } :
    name === "item_artifact_invisibility" ? { kind: "invisibility", model: "invisibl", sound: "inv1" } :
    name === "item_artifact_envirosuit" ? { kind: "suit", model: "suit", sound: "suit" } :
    name === "item_artifact_super_damage" ? { kind: "quad", model: "quaddama", sound: "damage" } : null;
  if (powerup !== null) return { model: `progs/${powerup.model}.mdl`, sound: `items/${powerup.sound}.wav`, bounds: "artifact", skin: 0,
    respawn: powerup.kind === "invulnerability" || powerup.kind === "invisibility" ? 300 : 60,
    take: (runtime, _entity, player) => { runtime.givePowerup(player, powerup.kind); return "taken"; } };
  if (name === "item_backpack") return { model: "progs/backpack.mdl", sound: "weapons/lock4.wav", bounds: "artifact", skin: 0, respawn: -1,
    take: (runtime, item, player) => { runtime.host.inventory.give(player.actor, "q1:ammo/shells", item.number("shells")); return "taken"; } };
  return null;
}
function weaponOffer(weapon: Q1Weapon): Extract<PickupSupplyOffer, { readonly kind: "weapon" }>["offer"] {
  const ammo = ammoItem(weapon), amount = weapon === "nailgun" || weapon === "supernailgun" ? 30 : weapon === "lightning" ? 15 : 5;
  return { item: weaponItem(weapon), ammo: ammo === null ? [] : [{ item: ammo, amount }] };
}
function weaponEligibility(game: Q1EntityServices, player: Q1PlayerState, item: ItemId): { readonly leave: boolean; readonly owned: boolean } {
  const leave = game.pickupRules?.weaponLeave?.(game) ?? (game.options.coop || [2, 3, 5].includes(game.options.deathmatch));
  const owned = game.pickupAdmission?.owns(player.actor.id, item) ?? game.host.inventory.count(player.actor.id, item) > 0;
  return { leave, owned };
}
function pickupPlayer(game: Q1EntityServices, other: ActorId): Q1PlayerState | null {
  return game.health(other) <= 0 ? null : game.player(other);
}
function takeWeapon(game: Q1EntityServices, player: Q1PlayerState, weapon: Q1Weapon): "refused" | "taken" | "leave" {
  const offer = weaponOffer(weapon), { leave, owned } = weaponEligibility(game, player, offer.item);
  if (leave && owned) return "refused";
  if (game.pickupAdmission !== null) {
    const autoSwitch = game.pickupRules?.autoSwitch?.(game, player, owned) ?? (player.autoSwitch === "always" || player.autoSwitch === "new" && !owned);
    const accepted = game.pickupAdmission.weapon(player.actor, offer, !autoSwitch ? "never" : game.options.deathmatch === 0 ? "always" : "better");
    return !accepted ? "refused" : leave ? "leave" : "taken";
  }
  game.host.inventory.give(player.actor, offer.item, 1);
  const selected = game.pickupRules?.weaponGranted?.(game, player, weapon) ?? weapon;
  for (const ammo of offer.ammo) game.host.inventory.give(player.actor, ammo.item,
    game.pickupRules?.weaponAmmoGrant?.(game, player, weapon, ammo.amount) ?? ammo.amount);
  if (game.pickupRules?.autoSwitch?.(game, player, owned) ?? (player.autoSwitch === "always" || player.autoSwitch === "new" && !owned)) {
    q1WeaponPickupSelection(game, player, selected, game.options.deathmatch === 0 ? "always" : "better");
  }
  return leave ? "leave" : "taken";
}

/** Null also covers unsupported source callbacks or native custom weapon grants; it is not proof of absence. */
export function observeQ1Supply(game: Q1EntityServices, pickup: ActorId, other: ActorId): PickupSupplyObservation | null {
  const entity = game.entity(pickup);
  if (entity === null) return null;
  const offer = pickupDefinition(game, entity)?.supply;
  if (offer === undefined || entity.touch === null || !("q1CallbackName" in entity.touch) || entity.touch.q1CallbackName !== "item_touch") return null;
  if (offer.kind === "weapon" && game.pickupAdmission === null && (game.pickupRules?.weaponGranted !== undefined || game.pickupRules?.weaponAmmoGrant !== undefined)) return null;
  if (entity.solid === "trigger") {
    const player = pickupPlayer(game, other);
    const weapon = player !== null && offer.kind === "weapon" ? weaponEligibility(game, player, offer.offer.item) : null;
    return { actor: pickup, offer, availability: { kind: "ready", eligible: player !== null && !(weapon?.leave && weapon.owned) } };
  }
  const regenerating = entity.nextThink >= 0 && entity.think !== null && "q1CallbackName" in entity.think && entity.think.q1CallbackName === "SUB_regen";
  return { actor: pickup, offer, availability: regenerating ? { kind: "respawning", atSeconds: entity.nextThink } : { kind: "inactive" } };
}
export function previewQ1Supply(game: Q1EntityServices, pickup: ActorId, recipient: ActorId): PickupSupplyPreview | null {
  const observation = observeQ1Supply(game, pickup, recipient);
  if (observation === null) return null;
  const offer = observation.offer;
  if (game.pickupAdmission !== null) return game.pickupAdmission.preview(recipient, offer);
  if (offer.kind === "weapon") return previewPickupGrants(game.host.inventory.entries(recipient), {
    kind: "weapon", weapons: [{ item: offer.offer.item, amount: 1 }], ammo: offer.offer.ammo,
  });
  if (offer.kind === "ammo") return previewPickupGrants(game.host.inventory.entries(recipient), {
    kind: "ammo", acceptance: "nonzero", ammo: [offer.offer], weapons: { kind: "grant", grants: [] },
  });
  return null;
}
export function q1AmmoPickupSelection(game: Q1EntityServices, player: Q1PlayerState, before: Q1Weapon, autoSwitch: boolean): undefined {
  if (autoSwitch && player.weapon === before) game.selectWeapon(player.actor, game.chooseBest(player.actor));
  return undefined;
}
export function q1WeaponPickupSelection(game: Q1EntityServices, player: Q1PlayerState, weapon: Q1Weapon, selection: PickupSelection): undefined {
  if (selection === "always" || selection === "better" && (game.pickupRules?.weaponRank?.(weapon) ?? rank(weapon)) < (game.pickupRules?.weaponRank?.(player.weapon) ?? rank(player.weapon))) game.selectWeapon(player.actor, weapon);
  return undefined;
}
function rank(weapon: Q1Weapon): number {
  return ["lightning", "rocketlauncher", "supernailgun", "grenadelauncher", "supershotgun", "nailgun", "shotgun", "axe"].indexOf(weapon);
}
export function spawnPickup(game: Q1EntityServices, entity: Q1Actor): boolean {
  const definition = pickupDefinition(game, entity); if (definition === null) return false;
  if (game.usesId1Precaches) {
    if (entity.classname === "item_weapon") {
      const size = (entity.spawnflags & 8) !== 0 ? 1 : 0;
      if ((entity.spawnflags & 1) !== 0) game.precacheModel(`maps/b_shell${size}.bsp`);
      if ((entity.spawnflags & 4) !== 0) game.precacheModel(`maps/b_nail${size}.bsp`);
      if ((entity.spawnflags & 2) !== 0) game.precacheModel(`maps/b_rock${size}.bsp`);
    } else if (entity.classname !== "item_backpack") {
      game.precacheModel(definition.model);
    }
    if (entity.classname === "item_health" || entity.classname === "item_key1" || entity.classname === "item_key2") {
      game.precacheSound(definition.sound);
    } else if (entity.classname === "item_artifact_invulnerability") {
      game.precacheSound("items/protect.wav");
      game.precacheSound("items/protect2.wav");
      game.precacheSound("items/protect3.wav");
    } else if (entity.classname === "item_artifact_envirosuit") {
      game.precacheSound("items/suit.wav");
      game.precacheSound("items/suit2.wav");
    } else if (entity.classname === "item_artifact_invisibility") {
      game.precacheSound("items/inv1.wav");
      game.precacheSound("items/inv2.wav");
      game.precacheSound("items/inv3.wav");
    } else if (entity.classname === "item_artifact_super_damage") {
      game.precacheSound("items/damage.wav");
      game.precacheSound("items/damage2.wav");
      game.precacheSound("items/damage3.wav");
    }
  }
  entity.model = definition.model; entity.originalModel = entity.model; entity.skin = definition.skin;
  entity.solid = "none"; entity.movement = "none";
  game.setBounds(entity, definition.bounds === "box" ? { min: ZERO, max: { x: 32, y: 32, z: 56 } } : definition.bounds === "weapon" ? { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } : { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
  entity.touch = game.named.touch(entity, "item_touch");
  if (entity.classname === "item_backpack") {
    entity.solid = "trigger"; entity.movement = "toss"; entity.movementFlags = 256;
    game.setBounds(entity, { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } });
    game.setBody(entity, { velocity: { x: -100 + game.host.random() * 200, y: -100 + game.host.random() * 200, z: 300 } }); game.link(entity); return true;
  }
  // PlaceItem waits until all brush entities exist, lifts six units, then drops 256 units.
  game.schedule(entity, 0.2, game.named.action(entity, "PlaceItem"));
  return true;
}

export function givePickup(game: Q1EntityServices, entity: Q1Actor, other: ActorId): boolean {
  if (pickupDefinition(game, entity) === null) return false;
  entity.solid = "trigger";
  pickupTouch(game, entity, other);
  return true;
}

function pickupTouch(game: Q1EntityServices, entity: Q1Actor, other: import("../../../contracts/identity.ts").ActorId): undefined {
    const definition = pickupDefinition(game, entity); if (definition === null) throw new Error(`Unknown saved Q1 pickup: ${entity.classname}`);
    if (entity.solid !== "trigger") return undefined;
    const player = pickupPlayer(game, other); if (player === null) return undefined;
    const result = definition.take(game, entity, player); if (result === "refused") return undefined;
    game.sound(player.actor, definition.sound, "item"); game.effect("pickup", game.body(entity).origin, player.actor.id);
    if (result === "leave") { if (!entity.classname.startsWith("weapon_")) game.useTargets(entity, other); return undefined; }
    entity.solid = "none"; entity.model = ""; game.link(entity);
    const respawn = game.pickupRules?.respawn?.(game, entity, definition.respawn) ?? definition.respawn;
    const respawns = game.options.deathmatch !== 0 && respawn > 0 && (game.options.deathmatch !== 2 || entity.classname.startsWith("item_artifact_"));
    if (game.options.edition === "classic" && entity.classname === "item_health" && (entity.spawnflags & 3) === 2) {
      entity.owner = player.actor.id;
      game.schedule(entity, 5, game.named.action(entity, "health_rot"));
    } else if (respawns) game.schedule(entity, respawn, game.named.action(entity, "SUB_regen"));
    else game.cancel(entity);
    game.useTargets(entity, other); return undefined;
}

function placeItem(game: Q1EntityServices, entity: Q1Actor): undefined {
    const body = game.body(entity); const start = vadd(body.origin, { x: 0, y: 0, z: 6 });
    const trace = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (trace.allSolid || trace.fraction === 1) return game.remove(entity);
    entity.solid = "trigger"; entity.movement = "toss"; entity.movementFlags = 256 | 512;
    game.setBody(entity, { origin: trace.end, velocity: ZERO, ground: trace.actor }); game.link(entity); return undefined;
}
export function registerPickupCallbacks(game: Q1EntityServices): undefined {
  game.named.register("item_touch", { touch: pickupTouch });
  game.named.register("PlaceItem", { action: placeItem });
  game.named.register("SUB_regen", { action: (runtime, entity) => { entity.solid = "trigger"; entity.model = entity.originalModel; runtime.sound(entity, "items/itembk2.wav"); return runtime.link(entity); } });
  game.named.register("health_rot", { action: (runtime, entity) => {
    const player = entity.owner === null ? null : runtime.player(entity.owner);
    if (player !== null && runtime.health(player.actor.id) > player.maxHealth) { runtime.host.combat.setHealth(player.actor, runtime.health(player.actor.id) - 1); return runtime.schedule(entity, 1, runtime.named.action(entity, "health_rot")); }
    if (runtime.options.deathmatch === 1) return runtime.schedule(entity, 20, runtime.named.action(entity, "SUB_regen")); return undefined;
  } });
  return undefined;
}
