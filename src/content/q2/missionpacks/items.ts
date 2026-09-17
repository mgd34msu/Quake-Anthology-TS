import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2Edition, Q2Entity, Q2GameServices, Q2SpawnModule } from "../foundation/host.ts";
import type { Q2ItemDefinition, Q2ItemModule } from "../foundation/items.ts";
import type { Q2WeaponInput, Q2Weapons } from "../foundation/weapons/index.ts";
import { restoreQ2Actor } from "../foundation/checkpoint.ts";
import type { Q2MissionPack, Q2MissionPackPlayerEffect } from "./types.ts";
import type { Q2MissionPackProjectiles } from "./projectiles/index.ts";
import type { Q2MissionPackSpheres, Q2SphereKind } from "./spheres.ts";
import type { Q2MissionPackDoppleganger } from "./doppleganger.ts";
import { angleVectors } from "../foundation/weapons/vectors.ts";
import { rogueWeaponDefinitions, xatrixWeaponDefinitions } from "./weapons/definitions.ts";
import { q2RandomItem } from "./random-items.ts";
import type { Q2RandomItemSettings } from "./random-items.ts";

export interface Q2MissionPackPowerups { quadFireUntil: number; doubleUntil: number; irUntil: number; }
export interface Q2MissionPackItemsCheckpoint { readonly powers: readonly { readonly actor: SavedActorId; readonly state: Readonly<Q2MissionPackPowerups> }[]; }
export interface Q2MissionPackItemHooks { playerEffect(effect: Q2MissionPackPlayerEffect): undefined; }

const xatrixAmmo: readonly Q2ItemDefinition[] = [
  { kind: "ammo", classname: "ammo_magslug", name: "Mag Slug", icon: "a_mslugs", model: "models/objects/ammo/tris.md2", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 10, capacity: 50 },
  { kind: "ammo", classname: "ammo_trap", name: "Trap", icon: "a_trap", model: "models/weapons/g_trap/tris.md2", sound: "misc/am_pkup.wav", rotate: true, respawn: 30, quantity: 1, capacity: 5, weaponAmmo: true },
  { kind: "key", classname: "key_green_key", name: "Green Key", icon: "k_green", model: "models/items/keys/green_key/tris.md2", sound: "items/pkup.wav", rotate: true, respawn: 0 },
];
const rogueAmmo: readonly Q2ItemDefinition[] = [
  { kind: "ammo", classname: "ammo_flechettes", name: "Flechettes", icon: "a_flechettes", model: "models/ammo/am_flechette/tris.md2", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 50, capacity: 200 },
  { kind: "ammo", classname: "ammo_prox", name: "Prox", icon: "a_prox", model: "models/ammo/am_prox/tris.md2", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 5, capacity: 50 },
  { kind: "ammo", classname: "ammo_tesla", name: "Tesla", icon: "a_tesla", model: "models/ammo/am_tesl/tris.md2", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 5, capacity: 50, weaponAmmo: true, infiniteAmmoQuantity: null },
  { kind: "ammo", classname: "ammo_disruptor", name: "Rounds", icon: "a_disruptor", model: "models/ammo/am_disr/tris.md2", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 15, capacity: 100 },
  { kind: "key", classname: "key_nuke_container", name: "Antimatter Pod", icon: "i_contain", model: "models/weapons/g_nuke/tris.md2", sound: "items/pkup.wav", rotate: true, respawn: 0 },
  { kind: "key", classname: "key_nuke", name: "Antimatter Bomb", icon: "i_nuke", model: "models/weapons/g_nuke/tris.md2", sound: "items/pkup.wav", rotate: true, respawn: 0 },
];
const names: ReadonlyMap<string, { readonly name: string; readonly icon: string }> = new Map([
  ["ionripper", { name: "Ionripper", icon: "w_ripper" }], ["phalanx", { name: "Phalanx", icon: "w_phallanx" }],
  ["etf_rifle", { name: "ETF Rifle", icon: "w_etf_rifle" }], ["heatbeam", { name: "Plasma Beam", icon: "w_heatbeam" }],
  ["chainfist", { name: "Chainfist", icon: "w_chainfist" }], ["disintegrator", { name: "Disruptor", icon: "w_disintegrator" }],
  ["proxlauncher", { name: "Prox Launcher", icon: "w_proxlaunch" }],
]);

export function q2MissionWeaponDisplayName(name: string): string | null {
  return names.get(name)?.name ?? [...xatrixAmmo, ...rogueAmmo].find(item => item.classname === `ammo_${name}`)?.name ?? null;
}

export function q2MissionWeaponInventory(pack: Q2MissionPack): readonly { readonly item: ItemId; readonly capacity: number }[] {
  const ammo = pack === "xatrix" ? xatrixAmmo : rogueAmmo;
  const weapons = pack === "xatrix" ? xatrixWeaponDefinitions : rogueWeaponDefinitions;
  return [...ammo.flatMap(item => item.kind === "ammo" ? [{ item: `q2:${item.classname}` satisfies ItemId, capacity: item.capacity }] : []),
    ...weapons.filter(weapon => weapon.item !== weapon.ammo).map(weapon => ({ item: weapon.item, capacity: 1 }))];
}

export function q2MissionWeaponIcons(): readonly { readonly item: ItemId; readonly icon: string }[] {
  return [...[...xatrixAmmo, ...rogueAmmo].filter(item => item.kind === "ammo").map(item => ({ item: `q2:${item.classname}` satisfies ItemId, icon: item.icon })),
    ...[...xatrixWeaponDefinitions, ...rogueWeaponDefinitions].flatMap(weapon => {
      const display = names.get(weapon.name);
      return display === undefined ? [] : [{ item: weapon.item, icon: display.icon }];
    })];
}

export class Q2MissionPackItems implements Q2SpawnModule {
  private powers = new Map<ActorId, Q2MissionPackPowerups>();
  constructor(readonly hooks: Q2MissionPackItemHooks, readonly pack: Q2MissionPack, readonly sharedItems: Q2ItemModule) {}

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (this.pack === "rogue" || game.options.edition === "rerelease") {
      if (entity.classname === "weapon_nailgun") entity.classname = "weapon_etf_rifle";
      else if (entity.classname === "ammo_nails") entity.classname = "ammo_flechettes";
      else if (entity.classname === "weapon_heatbeam") entity.classname = "weapon_plasmabeam";
    }
    const classname = entity.classname;
    const classicRogue = this.pack === "rogue" && game.options.edition === "classic";
    let descriptor = classname;
    if (classicRogue) {
      if (classname === "ammo_magslug") descriptor = "ammo_flechettes";
      else if (classname === "ammo_trap") descriptor = "weapon_proxlauncher";
      else if (classname === "weapon_boomer") descriptor = "weapon_etf_rifle";
      else if (classname === "weapon_phalanx") descriptor = "weapon_plasmabeam";
      else if (classname === "item_quadfire") { const chance = game.host.random(); descriptor = chance < 0.2 ? "item_sphere_hunter" : chance < 0.6 ? "item_sphere_vengeance" : "item_sphere_defender"; }
    }
    if (this.sharedItems.itemName(descriptor) === null) return false;
    const deathmatch = game.options.mode === "deathmatch", flags = game.options.deathmatchFlags;
    const sphere = descriptor.startsWith("item_sphere_");
    const power = descriptor === "item_quadfire" || descriptor === "item_double" || descriptor === "item_ir_goggles" || descriptor === "item_compass" && classicRogue;
    if (deathmatch && ((flags & 1) !== 0 && classname === "item_foodcube" || (flags & 2) !== 0 && (power || sphere || classname === "item_doppleganger") ||
      this.pack === "rogue" && ((flags & 0x20000) !== 0 && (classname === "ammo_prox" || classname === "ammo_tesla") ||
        (flags & 0x80000) !== 0 && classname === "ammo_nuke" || (flags & 0x100000) !== 0 && sphere)) ||
      classicRogue && (classname === "ammo_disruptor" || classname === "weapon_disintegrator" ||
        !deathmatch && (descriptor === "ammo_nuke" || descriptor === "item_doppleganger" || descriptor === "item_sphere_hunter" || descriptor === "item_sphere_vengeance"))) {
      game.remove(entity); return true;
    }
    if (classicRogue && entity.spawnflags > 1 && classname !== "key_power_cube") entity.spawnflags = 0;
    if (!this.sharedItems.spawnItem(entity, game, descriptor)) return false;
    if (classname === "item_foodcube") { entity.spawnflags |= 0x10000; entity.classname = "foodcube"; }
    return true;
  }

  randomRespawn(entity: Q2Entity, game: Q2GameServices, settings: Q2RandomItemSettings): Q2Entity | null {
    if (game.options.edition === "classic" && this.pack !== "rogue") return null;
    const item = this.sharedItems.itemDefinition(entity);
    if (item === null) return null;
    const classname = q2RandomItem(entity, item, game, settings);
    if (classname === null) return null;
    if (game.options.edition === "rerelease") { this.sharedItems.replaceItem(entity, game, classname); return entity; }
    const replacement = game.create(classname), body = game.body(entity);
    game.move(replacement, { origin: body.origin, bounds: body.bounds }, false);
    replacement.gravityVector = { x: 0, y: 0, z: -1 };
    if (!this.spawn(replacement, game)) throw new Error(`Rogue random item is not registered: ${classname}`);
    replacement.renderFlags |= 0x8000;
    return replacement;
  }

  register(items: Q2ItemModule, weapons: Q2Weapons, pack: Q2MissionPack, projectiles: Q2MissionPackProjectiles, spheres: Q2MissionPackSpheres, doppleganger: Q2MissionPackDoppleganger, edition: Q2Edition = "classic"): undefined {
    for (const item of pack === "xatrix" ? xatrixAmmo : rogueAmmo) items.register(item.kind === "ammo" && item.classname === "ammo_trap" && edition === "rerelease" ? { ...item, infiniteAmmoQuantity: null } : item);
    for (const definition of pack === "xatrix" ? xatrixWeaponDefinitions : rogueWeaponDefinitions) {
      const visual = names.get(definition.name);
      if (visual !== undefined) items.register({ kind: "weapon", classname: definition.classname, model: definition.worldModel,
        icon: visual.icon, name: visual.name, sound: "misc/w_pkup.wav", rotate: true, respawn: 30, ammo: definition.ammo, coopStay: edition === "rerelease" });
    }
    if (pack === "xatrix") {
      items.register(this.power("item_quadfire", "DualFire Damage", "p_quadfire", "models/items/quadfire/tris.md2", "items/quadfire1.wav", "quadFireUntil", 30));
      items.register({ kind: "custom", classname: "item_foodcube", name: "Health", icon: "i_health", model: "models/objects/trapfx/tris.md2",
        sound: "items/s_health.wav", rotate: false, respawn: 0, capacity: 0, quantity: 0, coopStay: false, droppable: false,
        pickup: (entity, game, player) => {
          const health = game.host.combat.read(player.id)?.health;
          if (health === undefined) return false;
          game.host.combat.setHealth(player, health + entity.count); return true;
        }, use: null });
    } else {
      if (edition === "classic") items.register({ kind: "custom", classname: "item_compass", name: "compass", icon: "p_compass", model: "models/objects/fire/tris.md2",
        sound: "items/pkup.wav", rotate: true, respawn: 60, capacity: 32767, quantity: 1, coopStay: false, droppable: false,
        pickup: (_entity, game, player) => {
          const count = game.host.inventory.count(player.id, "q2:item_compass");
          return !(game.options.skill === 1 && count >= 2 || game.options.skill >= 2 && count >= 1) && game.host.inventory.give(player, "q2:item_compass", 1) > 0;
        }, use: (player, game) => {
          const body = game.host.bodies.read(player.id);
          if (body === null) return false;
          let yaw = Math.trunc(weapons.inputs.get(player.id)?.angles.y ?? body.angles.y); if (yaw < 0) yaw += 360;
          game.host.emit({ kind: "print", actor: player.id, level: "high", text: `Origin: ${body.origin.x.toFixed(0)},${body.origin.y.toFixed(0)},${body.origin.z.toFixed(0)}    Dir: ${yaw}\n` }); return true;
        } });
      items.register({ kind: "custom", classname: "item_doppleganger", name: "Doppleganger", icon: "p_doppleganger", model: "models/items/dopple/tris.md2",
        sound: "items/pkup.wav", rotate: true, respawn: 90, capacity: 1, quantity: 1, coopStay: false, droppable: true,
        pickup: (_entity, game, player) => game.options.mode === "deathmatch" && game.host.inventory.give(player, "q2:item_doppleganger", 1) > 0,
        use: (player, game) => { const owner = game.entity(player.id); return owner !== null && doppleganger.use(owner, game); } });
      items.register(this.power("item_double", "Double Damage", "p_double", "models/items/ddamage/tris.md2", "misc/ddamage1.wav", "doubleUntil", 30));
      items.register(this.power("item_ir_goggles", "IR Goggles", "p_ir", "models/items/goggles/tris.md2", "misc/ir_start.wav", "irUntil", 60));
      items.register({ kind: "custom", classname: "ammo_nuke", name: "A-M Bomb", icon: "p_nuke", model: "models/weapons/g_nuke/tris.md2",
        sound: "misc/am_pkup.wav", rotate: true, respawn: 300, capacity: 1, quantity: 1, coopStay: false, droppable: true,
        pickup: (_entity, game, player) => game.host.inventory.give(player, "q2:ammo_nuke", 1) > 0,
        use: (player, game) => {
          const entity = game.entity(player.id), input = weapons.inputs.get(player.id);
          if (entity === null || !game.host.inventory.consume(player, "q2:ammo_nuke", 1)) return false;
          const powers = this.powerups(player.id), quad = (input?.quadUntil ?? 0) > game.host.now();
          const multiplier = (quad ? 4 : 1) * (Math.max(powers.doubleUntil, input?.doubleUntil ?? 0) > game.host.now() && !(quad && input?.noStackDouble === true) ? 2 : 1);
          projectiles.fireNuke(entity, game, game.body(entity).origin, angleVectors(input?.angles ?? game.body(entity).angles).forward, 100, multiplier);
          return true;
        } });
      for (const kind of ["defender", "hunter", "vengeance"] satisfies readonly Q2SphereKind[]) {
        const id: ItemId = `q2:item_sphere_${kind}`;
        const use = (player: OwnedActor, game: Q2GameServices): boolean => {
          const entity = game.entity(player.id);
          if (entity === null || spheres.ownedSphere(player.id, game) !== null || !game.host.inventory.consume(player, id, 1)) return false;
          spheres.launch(entity, game, kind); return true;
        };
        items.register({ kind: "custom", classname: `item_sphere_${kind}`, name: `${kind} sphere`, icon: `p_${kind}`,
          model: `models/items/${kind === "vengeance" ? "vengnce" : kind}/tris.md2`, sound: "items/pkup.wav", rotate: true,
          respawn: kind === "hunter" ? 120 : 60, capacity: 32767, quantity: 1, coopStay: false, droppable: false, use,
          pickup: (_entity, game, player) => {
            const count = game.host.inventory.count(player.id, id);
            if (spheres.ownedSphere(player.id, game) !== null || game.options.skill === 1 && count >= 2 || game.options.skill >= 2 && count >= 1) return false;
            if (game.host.inventory.give(player, id, 1) === 0) return false;
            if (game.options.mode === "deathmatch" && (game.options.deathmatchFlags & 16) !== 0) use(player, game);
            return true;
          } });
      }
    }
    return undefined;
  }

  powerups(actor: ActorId): Readonly<Q2MissionPackPowerups> { return this.powers.get(actor) ?? { quadFireUntil: 0, doubleUntil: 0, irUntil: 0 }; }

  input(actor: ActorId, input: Q2WeaponInput): Q2WeaponInput {
    const powers = this.powerups(actor);
    return { ...input, quadFireUntil: Math.max(input.quadFireUntil, powers.quadFireUntil), doubleUntil: Math.max(input.doubleUntil, powers.doubleUntil) };
  }

  reset(actor: ActorId): undefined { this.powers.delete(actor); return undefined; }

  ammoPack(player: OwnedActor, game: Q2GameServices, full: boolean, pack: Q2MissionPack): undefined {
    const changes: readonly { readonly item: ItemId; readonly capacity: number; readonly give: number }[] = pack === "xatrix"
      ? [{ item: "q2:ammo_magslug", capacity: full ? 100 : 75, give: full ? 10 : 0 }]
      : [{ item: "q2:ammo_flechettes", capacity: full ? 200 : 250, give: full ? 50 : 0 },
        { item: "q2:ammo_disruptor", capacity: full ? 200 : 150, give: full ? 15 : 0 }];
    for (const change of changes) {
      const current = game.host.inventory.entries(player.id).find(entry => entry.item === change.item);
      game.host.inventory.configure(player, { item: change.item, count: current?.count ?? 0, capacity: Math.max(current?.capacity ?? 0, change.capacity) });
      game.host.inventory.give(player, change.item, change.give);
    }
    return undefined;
  }

  capture(game: Q2GameServices): Q2MissionPackItemsCheckpoint {
    return { powers: [...this.powers].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, state]) => ({ actor: { slot: actor.slot, generation: actor.generation }, state: { ...state } })) };
  }

  restore(game: Q2GameServices, checkpoint: Q2MissionPackItemsCheckpoint): undefined {
    this.powers = new Map(checkpoint.powers.map(saved => [restoreQ2Actor(game, saved.actor).id, { ...saved.state }])); return undefined;
  }

  private power(classname: string, name: string, icon: string, model: string, sound: string, field: keyof Q2MissionPackPowerups, duration: number): Q2ItemDefinition {
    const item: ItemId = `q2:${classname}`;
    const use = (player: OwnedActor, game: Q2GameServices, timeout = duration): boolean => {
      if (!game.host.inventory.consume(player, item, 1)) return false;
      const powers = this.powers.get(player.id) ?? { quadFireUntil: 0, doubleUntil: 0, irUntil: 0 };
      powers[field] = Math.max(game.host.now(), powers[field]) + timeout; this.powers.set(player.id, powers);
      const entity = game.entity(player.id); if (entity !== null) game.sound(entity, sound, 3);
      if (field === "irUntil") this.hooks.playerEffect({ kind: "ir", actor: player.id, until: powers.irUntil });
      return true;
    };
    return { kind: "custom", classname, name, icon, model, sound: "items/pkup.wav", rotate: true, respawn: 60,
      capacity: 32767, quantity: 1, coopStay: false, droppable: true, use,
      pickup: (entity: Q2Entity, game, player) => {
        const count = game.host.inventory.count(player.id, item);
        if (game.options.skill === 1 && count >= 2 || game.options.skill >= 2 && count >= 1) return false;
        if (game.host.inventory.give(player, item, 1) === 0) return false;
        const droppedQuadFire = field === "quadFireUntil" && (entity.spawnflags & 0x20000) !== 0;
        if ((game.options.deathmatchFlags & 16) !== 0 || droppedQuadFire)
          use(player, game, droppedQuadFire && entity.nextThink !== null ? Math.max(0, entity.nextThink - game.host.now()) : duration);
        return true;
      } };
  }
}
