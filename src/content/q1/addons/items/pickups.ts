/* quakec_mg3/mg3_items.qc and items.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Weapon } from "../../foundation/types.ts";
import { vadd, vscale, vectors } from "../../foundation/types.ts";
import { spawnPickup, touchQ1Pickup } from "../../foundation/pickups.ts";
import type { Q1AddonContext } from "../context.ts";
import { BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED, BLOODY_NIGHTMARE_NEWGAME } from "../campaign.ts";
import { finishMg3Pickup, MG3_ITEM_PREFIX, MG3_SPAWNED_ITEM, startMg3Item } from "./common.ts";

export const MG3_BLOODY_SHOTGUN = 1;
export const MG3_BLOODY_SUPER_SHOTGUN = 2;
const TETTE = 512;

export function mg3WeaponRank(weapon: Q1Weapon): number {
  switch (weapon) {
    case "lightning": return 1;
    case "rocketlauncher": return 2;
    case "mg3:laser": return 3;
    case "supernailgun": return 4;
    case "grenadelauncher": return 5;
    case "supershotgun": return 6;
    case "nailgun": return 7;
    default: return 8;
  }
}

function weaponTouch(context: Q1AddonContext, entity: Q1Actor, other: ActorId): undefined {
  const { game } = context, player = game.player(other);
  if (player === null) return undefined;
  const weapon: Q1Weapon = entity.classname === "weapon_mjolnir" ? "mg3:mjolnir" : "mg3:laser";
  const leave = game.options.coop || [2, 3, 5].includes(game.options.deathmatch);
  const item = game.weaponItem(weapon), admission = game.pickupAdmission?.maps("weapons", item) === true ? game.pickupAdmission : null;
  const owned = admission === null ? game.host.inventory.count(other, item) !== 0 : admission.owns(other, item);
  if (leave && owned) return undefined;
  if (admission !== null) {
    const selection = player.autoSwitch === "always" || player.autoSwitch === "new" && !owned ? game.options.deathmatch === 0 ? "always" : "better" : "never";
    if (!admission.weapon(player.actor, { item, ammo: [{ item: "q1:ammo/cells", amount: 30 }] }, selection)) return undefined;
  } else {
    game.host.inventory.give(player.actor, "q1:ammo/cells", 30);
    game.host.inventory.configure(player.actor, { item: game.weaponItem(weapon), count: 1, capacity: 1 });
    if (player.autoSwitch === "always" || player.autoSwitch === "new" && !owned) {
      if (game.options.deathmatch === 0 || mg3WeaponRank(weapon) < mg3WeaponRank(player.weapon)) game.selectWeapon(player.actor, weapon);
    }
    game.selectWeapon(player.actor, player.weapon);
  }
  game.message(other, "$qc_got_item", true, [entity.text("netname")]); game.sound(player.actor, "weapons/pkup.wav", "item");
  game.effect("pickup", game.body(entity).origin, other); entity.activator = other; game.useTargets(entity, other);
  if (!game.live(entity)) return undefined;
  if (leave) { entity.target = ""; return undefined; }
  entity.model = ""; entity.solid = "none"; game.link(entity);
  const respawn = game.options.deathmatch !== 0 && game.options.deathmatch !== 2 ? 30 : entity.wait;
  return respawn > 0 ? game.schedule(entity, respawn, game.named.action(entity, "SUB_regen")) : game.cancel(entity);
}

export function registerMg3Pickups(context: Q1AddonContext): undefined {
  const { game, base } = context;
  game.named.register(MG3_ITEM_PREFIX + "ring_touch", { touch: (_game, entity, other, normal) => {
    if (!game.isPlayer(other)) return undefined;
    game.named.touch(entity, "mg3:trigger:silent_teleport")(other, normal);
    const body = game.host.bodies.read(other); if (body !== null) game.effect("teleport", body.origin);
    return undefined;
  } });
  for (const [name, model, label, height] of [
    ["item_draught_insight", "gold_ring", "$mg3_qc_ring_of_insight", -2048],
    ["item_draught_stupor", "onyx_ring", "$mg3_qc_ring_of_oblivion", 2048],
  ] satisfies readonly (readonly [string, string, string, number])[]) game.registerSpawn(name, (_game, entity) => {
    entity.model = `progs/${model}.mdl`; entity.fields.set("netname", label);
    game.setBounds(entity, { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    if (entity.number("height") === 0) context.setNumber(entity, "height", height);
    entity.touch = game.named.touch(entity, (entity.spawnflags & 1) !== 0 && entity.target !== "" ? "teleport_touch" : MG3_ITEM_PREFIX + "ring_touch");
    if ((entity.spawnflags & MG3_SPAWNED_ITEM) === 0 && entity.count === 0) {
      entity.count = 1; const origin = vadd(game.body(entity).origin, { x: 0, y: 0, z: 8 });
      game.host.emit({ kind: "ambient", origin, path: "ambience/hum1.wav", volume: 0.7, attenuation: 3 });
      const particles = game.create("particle_tele"); context.setNumber(particles, "distance", 48); game.setOrigin(particles, origin); game.spawnEntity(particles);
    }
    return startMg3Item(context, entity);
  });
  game.named.register(MG3_ITEM_PREFIX + "shard_touch", { touch: (_game, entity, other) => {
    const player = game.player(other); if (player === null || game.health(other) <= 0) return undefined;
    return touchQ1Pickup(game, entity, other, "q1:item_armor_shard", { kind: "protection", channel: "regular" }, {
      original: () => {
        const armor = game.host.combat.read(other)?.armor.regular;
        if (armor?.kind === "source") return false;
        if (armor?.kind === "q1" && armor.absorption < 0.3) game.host.combat.setRegularArmor(player.actor, { ...armor, absorption: 0.3 });
        const points = armor === undefined || armor.kind === "none" ? 0 : armor.points;
        if (points >= 200) return false;
        game.host.combat.setRegularArmor(player.actor, { kind: "q1", points: Math.min(200, points + 5), absorption: armor?.kind === "q1" ? Math.max(0.3, armor.absorption) : 0.3,
          item: armor?.kind === "q1" ? armor.item : "q1:item_armor1" });
        return true;
      },
      complete: taken => { if (taken) finishMg3Pickup(context, entity, other, "$mg3_qc_armor_shard_touch", "items/armor1.wav"); },
    });
  } });
  game.registerSpawn("item_armor_shard", (_game, entity) => {
    entity.model = "progs/armorshard.mdl"; entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + "shard_touch");
    game.setBounds(entity, { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } }); return startMg3Item(context, entity);
  });
  game.named.register(MG3_ITEM_PREFIX + "weapon_touch", { touch: (_game, entity, other) => weaponTouch(context, entity, other) });
  game.named.register(MG3_ITEM_PREFIX + "mjolnir_touch", { touch: (_game, entity, other, normal) => {
    weaponTouch(context, entity, other); return game.named.touch(entity, "mg3:trigger:silent_teleport")(other, normal);
  } });
  for (const [name, model, label] of [["weapon_laser_gun", "g_laserg", "$qc_laser_cannon"], ["weapon_mjolnir", "g_hammer", "$mg3_qc_hammer"]] satisfies readonly (readonly [string, string, string])[]) {
    game.registerSpawn(name, (_game, entity) => {
      entity.model = `progs/${model}.mdl`; entity.fields.set("netname", label);
      const teleport = name === "weapon_mjolnir" && (entity.spawnflags & 128) !== 0;
      if (teleport && entity.number("height") === 0) context.setNumber(entity, "height", -2048);
      entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + (teleport ? "mjolnir_touch" : "weapon_touch"));
      game.setBounds(entity, { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } }); return startMg3Item(context, entity);
    });
  }
  game.named.register(MG3_ITEM_PREFIX + "head_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other)) return undefined;
    game.host.emit({ kind: "achievement", player: null, id: "ACH_FIND_MG3_SECRET" }); context.broadcast("$mg3_selected_bloody_nightmare");
    base.campaign.writeFlags(base.campaign.readFlags() | BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_DISCOVERED);
    base.campaign.setSkill(3); context.services.setCvar("skill", "3");
    return finishMg3Pickup(context, entity, other, "", "player/tornoff2.wav");
  } });
  game.named.register(MG3_ITEM_PREFIX + "hug_tette", { touch: (_game, entity, other) => {
    base.campaign.writeFlags(base.campaign.readFlags() | TETTE);
    return finishMg3Pickup(context, entity, other, "$qc_got_item", "misc/secret.wav", [entity.text("netname")]);
  } });
  game.registerSpawn("item_head_hellknight", (_game, entity) => {
    const flags = base.campaign.readFlags();
    if ((flags & BLOODY_NIGHTMARE_ACTIVE) !== 0 && ((flags & BLOODY_NIGHTMARE_NEWGAME) === 0 || (flags & TETTE) !== 0)) {
      entity.classname = "item_health"; entity.spawnflags = 2;
      const basis = vectors(game.body(entity).angles); game.setOrigin(entity, vadd(vadd(game.body(entity).origin, vscale(basis.right, 16)), vscale(basis.forward, -16)));
      spawnPickup(game, entity); return undefined;
    }
    const bunny = (flags & BLOODY_NIGHTMARE_ACTIVE) !== 0;
    entity.model = bunny ? "progs/g_bunny.mdl" : "progs/item_h_hellkn.mdl";
    entity.fields.set("netname", bunny ? "$mg3_qc_newgameplus_item" : ""); entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + (bunny ? "hug_tette" : "head_touch"));
    game.setBounds(entity, { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 40 } }); return startMg3Item(context, entity);
  });
  game.named.register(MG3_ITEM_PREFIX + "bloody_start", { action: (_game, entity) => (base.campaign.readFlags() & BLOODY_NIGHTMARE_NEWGAME) === 0 ? game.remove(entity) : startMg3Item(context, entity) });
  game.named.register(MG3_ITEM_PREFIX + "bloody_touch", { touch: (_game, entity, other) => {
    const player = game.player(other); if (player === null) return undefined;
    const flag = entity.classname === "weapon_bloody_sg" ? MG3_BLOODY_SHOTGUN : MG3_BLOODY_SUPER_SHOTGUN;
    context.setPlayerNumber(other, "parm15", context.playerNumber(other, "parm15") | flag);
    game.host.inventory.give(player.actor, "q1:ammo/shells", 30);
    const weapon = flag === MG3_BLOODY_SHOTGUN ? "shotgun" : "supershotgun";
    game.host.inventory.configure(player.actor, { item: game.weaponItem(weapon), count: 1, capacity: 1 }); game.selectWeapon(player.actor, weapon);
    return finishMg3Pickup(context, entity, other, "$mg3_map2_secret_weapon", "weapons/pkup.wav");
  } });
  for (const [name, model] of [["weapon_bloody_sg", "g_bloodshot"], ["weapon_bloody_ssg", "g_bloodshot2"]] satisfies readonly (readonly [string, string])[]) game.registerSpawn(name, (_game, entity) => {
    entity.model = `progs/${model}.mdl`; entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + "bloody_touch");
    game.setBounds(entity, { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } });
    return game.schedule(entity, 0.5, game.named.action(entity, MG3_ITEM_PREFIX + "bloody_start"));
  });
  return undefined;
}
