/* Pickup and inventory behaviors adapted from Quake II game/g_items.c and p_weapon.c. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ArmorState, ItemId } from "../../../contracts/gameplay.ts";
import type { PickupAdmission, PickupAmmoGrant } from "../../../contracts/pickups.ts";
import { add, movedir, scale, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think } from "./host.ts";
import { Q2_BASE_WEAPONS } from "./weapons/definitions.ts";
import type { Q2BaseWeaponName } from "./weapons/types.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "./callbacks.ts";
import { freeQ2Entity } from "./callbacks.ts";
import { restoreQ2Actor } from "./checkpoint.ts";
import type { Q2Touch, Q2Use } from "./host.ts";

interface ItemVisual { readonly classname: string; readonly model: string; readonly icon: string; readonly name: string; readonly sound: string; readonly rotate: boolean; readonly respawn: number; }
export type Q2ItemDefinition = ItemVisual & (
  | { readonly kind: "ammo"; readonly quantity: number; readonly capacity: number; readonly weaponAmmo?: boolean; readonly infiniteAmmoQuantity?: number | null }
  | { readonly kind: "weapon"; readonly ammo: ItemId | null; readonly coopStay?: boolean }
  | { readonly kind: "health"; readonly amount: number; readonly ignoreMaximum: boolean; readonly timed: boolean }
  | { readonly kind: "armor"; readonly points: number; readonly maximum: number; readonly normal: number; readonly energy: number }
  | { readonly kind: "shard" }
  | { readonly kind: "power"; readonly coopStay: boolean }
  | { readonly kind: "power-armor"; readonly armor: "screen" | "shield" }
  | { readonly kind: "maximum-health"; readonly increase: number; readonly fill: boolean }
  | { readonly kind: "key" }
  | { readonly kind: "ammo-pack"; readonly full: boolean }
  | { readonly kind: "custom"; readonly capacity: number; readonly quantity: number; readonly coopStay: boolean; readonly droppable: boolean;
      readonly pickup: (entity: Q2Entity, game: Q2GameServices, player: OwnedActor) => boolean;
      readonly use: ((player: OwnedActor, game: Q2GameServices) => boolean) | null; }
);
type Item = Q2ItemDefinition;

const ammunition: readonly Item[] = [
  { kind: "ammo", classname: "ammo_shells", model: "models/items/ammo/shells/medium/tris.md2", icon: "a_shells", name: "Shells", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 10, capacity: 100 },
  { kind: "ammo", classname: "ammo_bullets", model: "models/items/ammo/bullets/medium/tris.md2", icon: "a_bullets", name: "Bullets", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 50, capacity: 200 },
  { kind: "ammo", classname: "ammo_cells", model: "models/items/ammo/cells/medium/tris.md2", icon: "a_cells", name: "Cells", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 50, capacity: 200 },
  { kind: "ammo", classname: "ammo_rockets", model: "models/items/ammo/rockets/medium/tris.md2", icon: "a_rockets", name: "Rockets", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 5, capacity: 50 },
  { kind: "ammo", classname: "ammo_slugs", model: "models/items/ammo/slugs/medium/tris.md2", icon: "a_slugs", name: "Slugs", sound: "misc/am_pkup.wav", rotate: false, respawn: 30, quantity: 10, capacity: 50 },
  { kind: "ammo", classname: "ammo_grenades", model: "models/items/ammo/grenades/medium/tris.md2", icon: "a_grenades", name: "Grenades", sound: "misc/am_pkup.wav", rotate: true, respawn: 30, quantity: 5, capacity: 50, weaponAmmo: true },
];

const weaponNames: Readonly<Record<Q2BaseWeaponName, { readonly name: string; readonly icon: string }>> = {
  blaster: { name: "Blaster", icon: "w_blaster" }, shotgun: { name: "Shotgun", icon: "w_shotgun" },
  supershotgun: { name: "Super Shotgun", icon: "w_sshotgun" }, machinegun: { name: "Machinegun", icon: "w_machinegun" },
  chaingun: { name: "Chaingun", icon: "w_chaingun" }, grenades: { name: "Grenades", icon: "a_grenades" },
  grenadelauncher: { name: "Grenade Launcher", icon: "w_glauncher" }, rocketlauncher: { name: "Rocket Launcher", icon: "w_rlauncher" },
  hyperblaster: { name: "HyperBlaster", icon: "w_hyperblaster" }, railgun: { name: "Railgun", icon: "w_railgun" }, bfg: { name: "BFG10K", icon: "w_bfg" },
};

const keys: readonly Item[] = [
  { classname: "key_data_cd", model: "models/items/keys/data_cd/tris.md2", icon: "k_datacd", name: "Data CD" },
  { classname: "key_power_cube", model: "models/items/keys/power/tris.md2", icon: "k_powercube", name: "Power Cube" },
  { classname: "key_pyramid", model: "models/items/keys/pyramid/tris.md2", icon: "k_pyramid", name: "Pyramid Key" },
  { classname: "key_data_spinner", model: "models/items/keys/spinner/tris.md2", icon: "k_dataspin", name: "Data Spinner" },
  { classname: "key_pass", model: "models/items/keys/pass/tris.md2", icon: "k_security", name: "Security Pass" },
  { classname: "key_blue_key", model: "models/items/keys/key/tris.md2", icon: "k_bluekey", name: "Blue Key" },
  { classname: "key_red_key", model: "models/items/keys/red_key/tris.md2", icon: "k_redkey", name: "Red Key" },
  { classname: "key_commander_head", model: "models/monsters/commandr/head/tris.md2", icon: "k_comhead", name: "Commander's Head" },
  { classname: "key_airstrike_target", model: "models/items/keys/target/tris.md2", icon: "i_airstrike", name: "Airstrike Marker" },
].map((key): Item => ({ ...key, kind: "key", sound: "items/pkup.wav", rotate: key.classname !== "key_commander_head", respawn: 0 }));

const items: readonly Item[] = [...ammunition, ...keys,
  { kind: "ammo-pack", classname: "item_bandolier", model: "models/items/band/tris.md2", icon: "p_bandolier", name: "Bandolier", sound: "items/pkup.wav", rotate: true, respawn: 60, full: false },
  { kind: "ammo-pack", classname: "item_pack", model: "models/items/pack/tris.md2", icon: "i_pack", name: "Ammo Pack", sound: "items/pkup.wav", rotate: true, respawn: 180, full: true },
  { kind: "health", classname: "item_health", model: "models/items/healing/medium/tris.md2", icon: "i_health", name: "Health", sound: "items/n_health.wav", rotate: false, respawn: 30, amount: 10, ignoreMaximum: false, timed: false },
  { kind: "health", classname: "item_health_small", model: "models/items/healing/stimpack/tris.md2", icon: "i_health", name: "Health", sound: "items/s_health.wav", rotate: false, respawn: 30, amount: 2, ignoreMaximum: true, timed: false },
  { kind: "health", classname: "item_health_large", model: "models/items/healing/large/tris.md2", icon: "i_health", name: "Health", sound: "items/l_health.wav", rotate: false, respawn: 30, amount: 25, ignoreMaximum: false, timed: false },
  { kind: "health", classname: "item_health_mega", model: "models/items/mega_h/tris.md2", icon: "i_health", name: "Health", sound: "items/m_health.wav", rotate: false, respawn: 20, amount: 100, ignoreMaximum: true, timed: true },
  { kind: "armor", classname: "item_armor_jacket", model: "models/items/armor/jacket/tris.md2", icon: "i_jacketarmor", name: "Jacket Armor", sound: "misc/ar1_pkup.wav", rotate: true, respawn: 20, points: 25, maximum: 50, normal: 0.3, energy: 0 },
  { kind: "armor", classname: "item_armor_combat", model: "models/items/armor/combat/tris.md2", icon: "i_combatarmor", name: "Combat Armor", sound: "misc/ar1_pkup.wav", rotate: true, respawn: 20, points: 50, maximum: 100, normal: 0.6, energy: 0.3 },
  { kind: "armor", classname: "item_armor_body", model: "models/items/armor/body/tris.md2", icon: "i_bodyarmor", name: "Body Armor", sound: "misc/ar1_pkup.wav", rotate: true, respawn: 20, points: 100, maximum: 200, normal: 0.8, energy: 0.6 },
  { kind: "shard", classname: "item_armor_shard", model: "models/items/armor/shard/tris.md2", icon: "i_jacketarmor", name: "Armor Shard", sound: "misc/ar2_pkup.wav", rotate: true, respawn: 20 },
  { kind: "power", classname: "item_quad", model: "models/items/quaddama/tris.md2", icon: "p_quad", name: "Quad Damage", sound: "items/pkup.wav", rotate: true, respawn: 60, coopStay: false },
  { kind: "power", classname: "item_invulnerability", model: "models/items/invulner/tris.md2", icon: "p_invulnerability", name: "Invulnerability", sound: "items/pkup.wav", rotate: true, respawn: 300, coopStay: false },
  { kind: "power", classname: "item_silencer", model: "models/items/silencer/tris.md2", icon: "p_silencer", name: "Silencer", sound: "items/pkup.wav", rotate: true, respawn: 60, coopStay: false },
  { kind: "power", classname: "item_breather", model: "models/items/breather/tris.md2", icon: "p_rebreather", name: "Rebreather", sound: "items/pkup.wav", rotate: true, respawn: 60, coopStay: true },
  { kind: "power", classname: "item_enviro", model: "models/items/enviro/tris.md2", icon: "p_envirosuit", name: "Environment Suit", sound: "items/pkup.wav", rotate: true, respawn: 60, coopStay: true },
  { kind: "power-armor", classname: "item_power_screen", model: "models/items/armor/screen/tris.md2", icon: "i_powerscreen", name: "Power Screen", sound: "misc/ar3_pkup.wav", rotate: true, respawn: 60, armor: "screen" },
  { kind: "power-armor", classname: "item_power_shield", model: "models/items/armor/shield/tris.md2", icon: "i_powershield", name: "Power Shield", sound: "misc/ar3_pkup.wav", rotate: true, respawn: 60, armor: "shield" },
  { kind: "maximum-health", classname: "item_adrenaline", model: "models/items/adrenal/tris.md2", icon: "p_adrenaline", name: "Adrenaline", sound: "items/pkup.wav", rotate: true, respawn: 60, increase: 1, fill: true },
  { kind: "maximum-health", classname: "item_ancient_head", model: "models/items/c_head/tris.md2", icon: "i_fixme", name: "Ancient Head", sound: "items/pkup.wav", rotate: true, respawn: 60, increase: 2, fill: false },
  ...Q2_BASE_WEAPONS.filter(weapon => weapon.name !== "grenades").map((weapon): Item => ({
    kind: "weapon", classname: weapon.classname, model: weapon.worldModel, icon: weaponNames[weapon.name].icon, name: weaponNames[weapon.name].name,
    sound: "misc/w_pkup.wav", rotate: true, respawn: 30, ammo: weapon.ammo,
  })),
];

export interface Q2ItemHooks {
  weaponPicked(player: ActorId, item: ItemId, first: boolean): undefined;
  /** Silencer charges are held by the weapon state; other powerups use expiry seconds below. */
  silencer(player: ActorId, charges: number): undefined;
  powerArmor(player: ActorId, kind: "none" | "screen" | "shield"): undefined;
  ammoPack?(player: OwnedActor, game: Q2GameServices, full: boolean): undefined;
  randomRespawn?(entity: Q2Entity, game: Q2GameServices): Q2Entity | null;
}

export interface Q2PickupPolicy {
  instancedCoop?(game: Q2GameServices): boolean;
  beforePickup(entity: Q2Entity, game: Q2GameServices, player: ActorId): boolean;
  beforeTargets?(entity: Q2Entity, game: Q2GameServices, player: ActorId, taken: boolean): undefined;
  afterPickup(entity: Q2Entity, game: Q2GameServices, player: ActorId, taken: boolean): undefined;
  keepAfterPickup(entity: Q2Entity, game: Q2GameServices, player: ActorId): boolean;
}

export interface Q2PlayerPowerups { quadUntil: number; invulnerabilityUntil: number; breatherUntil: number; enviroUntil: number; }
interface PickupState { readonly item: Item; targetsUsed: boolean; retained: boolean; expiresAt: number | null; }
export interface Q2InventoryItem {
  readonly id: ItemId;
  readonly classname: string;
  readonly name: string;
  readonly kind: Item["kind"];
  readonly quantity: number;
  readonly usable: boolean;
  readonly droppable: boolean;
  readonly stayCoop: boolean;
}
export interface Q2DropOptions { readonly playerDeath: boolean; readonly yawOffset?: number; readonly expiresAt?: number; }

export interface Q2ItemsCheckpoint {
  readonly powerCubeCount: number;
  readonly pickups: readonly { readonly actor: SavedActorId; readonly classname: string; readonly targetsUsed: boolean; readonly retained: boolean; readonly expiresAt: number | null }[];
  readonly powers: readonly { readonly actor: SavedActorId; readonly state: Readonly<Q2PlayerPowerups> }[];
  readonly powerArmorBindings: readonly SavedActorId[];
}

function id(item: Item): ItemId { return `q2:${item.classname}`; }
const baseAmmoIds = new Set(ammunition.map(id));
const baseWeaponIds = new Set(Q2_BASE_WEAPONS.map(weapon => weapon.item));
function isDropped(entity: Q2Entity): boolean { return (entity.spawnflags & 0x30000) !== 0; }
function staysCoop(item: Item): boolean {
  return item.kind === "key" || item.kind === "weapon" && (item.coopStay ?? true) || (item.kind === "power" || item.kind === "custom") && item.coopStay;
}

export function q2ItemPickupName(classname: string): string | null { return items.find(item => item.classname === classname)?.name ?? null; }

export class Q2ItemModule implements Q2SpawnModule {
  private readonly catalog = new Map(items.map(item => [item.classname, item]));
  private pickups = new WeakMap<Q2Entity, PickupState>();
  private powers = new WeakMap<ActorId, Q2PlayerPowerups>();
  private powerArmorBindings = new WeakSet<ActorId>();
  private powerCubeCount = 0;
  private pickupPolicy: Q2PickupPolicy | null = null;
  private pickupAdmission: PickupAdmission | null = null;
  constructor(private readonly hooks: Q2ItemHooks) {}

  register(item: Q2ItemDefinition): undefined {
    if (this.catalog.has(item.classname)) throw new Error(`Q2 item already registered: ${item.classname}`);
    this.catalog.set(item.classname, item); return undefined;
  }

  itemName(classname: string): string | null { return this.catalog.get(classname)?.name ?? null; }

  setPickupPolicy(policy: Q2PickupPolicy): undefined { this.pickupPolicy = policy; return undefined; }
  setPickupAdmission(admission: PickupAdmission | null): undefined { this.pickupAdmission = admission; return undefined; }

  get callbacks(): Q2CallbackDefinitions {
    return { think: { q2_items_respawn: this.respawn, q2_items_drop_to_floor: this.dropToFloor, q2_items_make_touchable: this.makeTouchable,
      q2_items_mega_health: this.megaHealth, q2_items_invulnerability_expiry: this.invulnerabilityExpiry },
      touch: { Touch_Item: this.touchPickup, drop_temp_touch: this.temporaryTouch }, use: { Use_Item: this.useItem } };
  }

  capture(game: Q2GameServices): Q2ItemsCheckpoint {
    const pickups: { actor: SavedActorId; classname: string; targetsUsed: boolean; retained: boolean; expiresAt: number | null }[] = [];
    const powers: { actor: SavedActorId; state: Q2PlayerPowerups }[] = [], powerArmorBindings: SavedActorId[] = [];
    for (const entity of game.entities.values()) {
      const actor = { slot: entity.actor.id.slot, generation: entity.actor.id.generation }, pickup = this.pickups.get(entity), power = this.powers.get(entity.actor.id);
      if (pickup !== undefined) pickups.push({ actor, classname: pickup.item.classname, targetsUsed: pickup.targetsUsed, retained: pickup.retained, expiresAt: pickup.expiresAt });
      if (power !== undefined) powers.push({ actor, state: { ...power } });
      if (this.powerArmorBindings.has(entity.actor.id)) powerArmorBindings.push(actor);
    }
    return { powerCubeCount: this.powerCubeCount, pickups, powers, powerArmorBindings };
  }

  restore(game: Q2GameServices, checkpoint: Q2ItemsCheckpoint): undefined {
    this.pickups = new WeakMap<Q2Entity, PickupState>(); this.powers = new WeakMap<ActorId, Q2PlayerPowerups>(); this.powerArmorBindings = new WeakSet<ActorId>();
    this.powerCubeCount = checkpoint.powerCubeCount;
    for (const saved of checkpoint.pickups) {
      const actor = restoreQ2Actor(game, saved.actor), entity = game.entity(actor.id), item = this.catalog.get(saved.classname);
      if (entity === null || item === undefined) throw new Error(`Q2 item checkpoint cannot resolve ${saved.classname}`);
      this.pickups.set(entity, { item, targetsUsed: saved.targetsUsed, retained: saved.retained, expiresAt: saved.expiresAt });
    }
    for (const saved of checkpoint.powers) this.powers.set(restoreQ2Actor(game, saved.actor).id, { ...saved.state });
    for (const saved of checkpoint.powerArmorBindings) this.bindPowerArmor(restoreQ2Actor(game, saved), game);
    return undefined;
  }

  list(): readonly Q2InventoryItem[] {
    return [...this.catalog.values()].map(item => ({ id: id(item), classname: item.classname, name: item.name, kind: item.kind,
      quantity: item.kind === "ammo" || item.kind === "custom" ? item.quantity : 1,
      usable: item.kind === "custom" ? item.use !== null : item.kind === "power" || item.kind === "power-armor" || item.kind === "weapon" || item.kind === "ammo" && item.weaponAmmo === true,
      droppable: item.kind === "custom" ? item.droppable : item.kind === "key" || item.kind === "ammo" || item.kind === "power" || item.kind === "power-armor" || item.kind === "weapon" && item.classname !== "weapon_blaster",
      stayCoop: staysCoop(item) }));
  }

  lookup(value: string): Q2InventoryItem | null {
    const key = value.toLowerCase();
    return this.list().find(item => item.id.toLowerCase() === key || item.classname.toLowerCase() === key || item.name.toLowerCase() === key) ?? null;
  }

  clearPowerups(player: ActorId): undefined { this.powers.delete(player); return undefined; }

  /** Drop_Item creates the physical pickup; its source caller consumes inventory or clears death inventory. */
  drop(self: Q2Entity, game: Q2GameServices, itemId: ItemId, options: Q2DropOptions): Q2Entity | null {
    const item = itemId.startsWith("q2:") ? this.catalog.get(itemId.slice(3)) : undefined;
    const descriptor = this.lookup(itemId);
    if (item === undefined || descriptor === null || !descriptor.droppable
      || game.options.mode === "coop" && !(this.pickupPolicy?.instancedCoop?.(game) ?? false) && descriptor.stayCoop) return null;
    const count = game.host.inventory.count(self.actor.id, itemId);
    return this.dropSource(self.actor, game, item, options, item.kind === "ammo" ? Math.min(count, item.quantity) : 0);
  }

  dropMonster(actor: OwnedActor, game: Q2GameServices, classname: string): Q2Entity | null {
    const descriptor = this.lookup(classname), item = descriptor === null ? undefined : this.catalog.get(descriptor.classname);
    return item === undefined ? null : this.dropSource(actor, game, item, { playerDeath: false }, 0);
  }

  private dropSource(actor: OwnedActor, game: Q2GameServices, item: Q2ItemDefinition, options: Q2DropOptions, count: number): Q2Entity {
    const body = game.host.bodies.read(actor.id);
    if (body === null) throw new Error("Item drop owner has no shared body");
    const dropped = game.create(item.classname);
    dropped.model = item.model; dropped.owner = actor.id; dropped.spawnflags = options.playerDeath ? 0x20000 : 0x10000;
    dropped.effects = item.rotate ? 1 : 0; dropped.renderFlags = 512 | 0x8000;
    dropped.count = count;
    this.pickups.set(dropped, { item, targetsUsed: false, retained: false, expiresAt: options.expiresAt ?? null });
    const view = game.host.playerViewState(actor.id)?.viewAngles ?? body.angles;
    const forward = movedir({ ...view, y: view.y + (options.yawOffset ?? 0) });
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
    const origin = game.host.isPlayer(actor.id)
      ? game.host.trace({ start: body.origin, end: add(add(body.origin, scale(forward, 24)), { x: 0, y: 0, z: -16 }), bounds, ignore: actor.id, mask: 1 }).end
      : body.origin;
    game.move(dropped, { origin, bounds, velocity: { ...scale(forward, 100), z: 300 } }, false);
    dropped.touch = this.temporaryTouch;
    game.solid(dropped, "trigger"); game.motion(dropped, "toss"); game.show(dropped);
    game.schedule(dropped, 1, this.makeTouchable);
    return dropped;
  }

  playerPowerups(player: ActorId): Readonly<Q2PlayerPowerups> {
    return this.powers.get(player) ?? { quadUntil: 0, invulnerabilityUntil: 0, breatherUntil: 0, enviroUntil: 0 };
  }

  configurePlayer(actor: OwnedActor, game: Q2GameServices, giveBlaster = false): undefined {
    for (const item of this.catalog.values()) {
      if (item.kind !== "ammo" && item.kind !== "weapon" && item.kind !== "power" && item.kind !== "power-armor" && item.kind !== "key" && item.kind !== "custom") continue;
      this.ensure(actor, game, id(item), item.kind === "ammo" || item.kind === "custom" ? item.capacity : 32767);
    }
    if (giveBlaster && game.host.inventory.count(actor.id, "q2:weapon_blaster") === 0) game.host.inventory.give(actor, "q2:weapon_blaster", 1);
    return this.bindPowerArmor(actor, game);
  }

  private bindPowerArmor(actor: OwnedActor, game: Q2GameServices): undefined {
    if (!this.powerArmorBindings.has(actor.id)) {
      game.host.combat.bindPowerArmorCells(actor, {
        read: () => game.host.inventory.count(actor.id, "q2:ammo_cells"),
        write: count => {
          const entry = game.host.inventory.entries(actor.id).find(candidate => candidate.item === "q2:ammo_cells");
          if (entry === undefined) throw new Error("Q2 power armor requires its admitted cell inventory");
          return game.host.inventory.configure(actor, { ...entry, count });
        },
      });
      this.powerArmorBindings.add(actor.id);
    }
    return undefined;
  }

  private ensure(actor: OwnedActor, game: Q2GameServices, item: ItemId, capacity: number): undefined {
    if (!game.host.inventory.entries(actor.id).some(entry => entry.item === item)) game.host.inventory.configure(actor, { item, count: 0, capacity });
    return undefined;
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    return this.spawnItem(entity, game, entity.classname);
  }

  spawnItem(entity: Q2Entity, game: Q2GameServices, descriptorClassname: string): boolean {
    const item = this.catalog.get(descriptorClassname);
    if (item === undefined) return false;
    const flags = game.options.deathmatchFlags;
    if (game.options.mode === "deathmatch" && (
      (flags & 1) !== 0 && (item.kind === "health" || item.kind === "maximum-health") ||
      (flags & 2) !== 0 && item.kind === "power" ||
      (flags & 2048) !== 0 && (item.kind === "armor" || item.kind === "shard" || item.kind === "power-armor") ||
      (flags & 8192) !== 0 && (item.kind === "ammo" && item.weaponAmmo !== true || item.classname === "weapon_bfg")
    )) { game.remove(entity); return true; }
    this.pickups.set(entity, { item, targetsUsed: false, retained: false, expiresAt: null });
    if (game.options.mode === "coop" && (item.classname === "key_power_cube" || game.options.edition === "rerelease" && item.classname === "key_explosive_charges")) entity.spawnflags |= 1 << (8 + this.powerCubeCount++);
    entity.model ||= item.model; entity.effects |= item.rotate ? 1 : 0; entity.renderFlags |= 512;
    if (item.classname === "key_commander_head") entity.effects |= 2;
    game.schedule(entity, 2 * game.host.frameSeconds(), this.dropToFloor);
    return true;
  }

  itemDefinition(entity: Q2Entity): Q2ItemDefinition | null { return this.pickups.get(entity)?.item ?? null; }

  replaceItem(entity: Q2Entity, game: Q2GameServices, descriptorClassname: string): undefined {
    const item = this.catalog.get(descriptorClassname);
    if (item === undefined) throw new Error(`Q2 replacement item is not registered: ${descriptorClassname}`);
    const state = this.pickup(entity);
    this.pickups.set(entity, { ...state, item });
    entity.classname = item.classname; entity.model = item.model; entity.effects = item.rotate ? 1 : 0;
    return game.show(entity);
  }

  private pickup(entity: Q2Entity): PickupState {
    const state = this.pickups.get(entity);
    if (state === undefined) throw new Error("Q2 item callback has no pickup state");
    return state;
  }

  private readonly respawn: Q2Think = (entity, game) => {
    const team = entity.spawn.values.get("team");
    const candidates: Q2Entity[] = [];
    if (team === undefined) candidates.push(entity);
    else for (let member = game.entity(entity.teamMaster); member !== null; member = game.entity(member.chain)) candidates.push(member);
    let selected = candidates[Math.floor(game.host.random() * candidates.length)] ?? entity;
    if (game.options.edition === "classic") {
      const replacement = this.hooks.randomRespawn?.(selected, game);
      if (replacement !== undefined && replacement !== null && replacement !== selected) { game.remove(selected); selected = replacement; }
    }
    if (!game.host.actors.isLive(selected.actor.id)) return undefined;
    selected.visible = true; game.solid(selected, "trigger"); game.show(selected);
    game.host.emit({ kind: "effect", effect: "q2:item-respawn", origin: game.body(selected).origin, direction: zero, count: 1, color: 0 });
    if (game.options.edition === "rerelease") this.hooks.randomRespawn?.(selected, game);
    return undefined;
  };

  private setRespawn(entity: Q2Entity, game: Q2GameServices, seconds: number): undefined {
    this.pickup(entity).retained = true; entity.visible = false;
    game.solid(entity, "none"); game.show(entity);
    return game.schedule(entity, seconds, this.respawn);
  }

  private readonly dropToFloor: Q2Think = (entity, game) => {
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
    game.move(entity, { bounds }, false);
    const origin = game.body(entity).origin;
    const trace = game.host.trace({ start: origin, end: add(origin, { x: 0, y: 0, z: -128 }), bounds, ignore: entity.actor.id, mask: 3 });
    if (trace.startSolid) { game.host.diagnostic(`Q2 ${entity.classname} starts solid`); return game.remove(entity); }
    game.move(entity, { origin: trace.end });
    entity.touch = this.touchPickup;
    game.solid(entity, "trigger"); game.motion(entity, "toss");
    const team = entity.spawn.values.get("team");
    if (team !== undefined) {
      entity.flags &= ~0x400; entity.chain = entity.teamChain; entity.teamChain = null;
      entity.visible = false; game.solid(entity, "none");
      if (entity.teamMaster?.equals(entity.actor.id)) game.schedule(entity, game.host.frameSeconds(), this.respawn);
    }
    if ((entity.spawnflags & 2) !== 0) { entity.touch = null; entity.effects &= ~1; entity.renderFlags &= ~512; game.solid(entity, "box"); }
    if ((entity.spawnflags & 1) !== 0) {
      entity.visible = false; game.solid(entity, "none");
      entity.use = this.useItem;
    }
    return game.show(entity);
  };

  touch(entity: Q2Entity, game: Q2GameServices, player: ActorId): undefined {
    if (!game.host.isPlayer(player) || (game.host.combat.read(player)?.health ?? 0) < 1) return undefined;
    if (this.pickupPolicy !== null && !this.pickupPolicy.beforePickup(entity, game, player)) return undefined;
    const state = this.pickup(entity), item = state.item;
    const owner = game.host.actors.resolveOwned(player);
    if (owner === null) return undefined;
    state.retained = false;
    const taken = this.take(entity, game, owner, item);
    if (taken) {
      game.host.emit({ kind: "pickup", player, item: id(item), icon: item.icon, name: item.name });
      const body = game.host.bodies.read(player);
      if (body !== null) game.host.emit({ kind: "sound", actor: player, origin: body.origin, path: item.sound, channel: 3, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    }
    this.pickupPolicy?.beforeTargets?.(entity, game, player, taken);
    // Source items fire targets on the first attempted pickup, even when full.
    if (!state.targetsUsed) { game.useTargets(entity, player); state.targetsUsed = true; }
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    this.pickupPolicy?.afterPickup(entity, game, player, taken);
    if (!taken || !game.host.actors.isLive(entity.actor.id)) return undefined;
    const stays = game.options.mode === "coop" && staysCoop(item);
    if ((!stays || isDropped(entity)) && !state.retained && !(this.pickupPolicy?.keepAfterPickup(entity, game, player) ?? false)) game.remove(entity);
    return undefined;
  }

  private take(entity: Q2Entity, game: Q2GameServices, player: OwnedActor, item: Item): boolean {
    const current = game.host.combat.read(player.id);
    if (current === null) return false;
    const playerEntity = game.entity(player.id), maximum = playerEntity?.maxHealth || 100;
    const respawn = item.respawn;
    switch (item.kind) {
      case "custom": {
        this.ensure(player, game, id(item), item.capacity);
        if (!item.pickup(entity, game, player)) return false;
        break;
      }
      case "key": {
        this.ensure(player, game, id(item), 32767);
        if (game.options.mode === "coop") {
          if (item.classname === "key_power_cube" || game.options.edition === "rerelease" && item.classname === "key_explosive_charges") {
            if (playerEntity === null) throw new Error("Q2 cooperative key pickup requires admitted source player fields");
            const cubes = (entity.spawnflags & 0xff00) >>> 8;
            if ((playerEntity.powerCubes & cubes) !== 0) return false;
            playerEntity.powerCubes |= cubes;
          } else if (game.host.inventory.count(player.id, id(item)) !== 0) return false;
        }
        game.host.inventory.give(player, id(item), 1); return true;
      }
      case "ammo-pack": {
        for (const ammo of ammunition) {
          if (ammo.kind !== "ammo") continue;
          const capacity = ammo.classname === "ammo_bullets" || ammo.classname === "ammo_cells" ? item.full ? 300 : 250
            : ammo.classname === "ammo_shells" ? item.full ? 200 : 150 : ammo.classname === "ammo_slugs" ? item.full ? 100 : 75 : item.full ? 100 : ammo.capacity;
          this.ensure(player, game, id(ammo), ammo.capacity);
          const entry = game.host.inventory.entries(player.id).find(candidate => candidate.item === id(ammo));
          if (entry === undefined) throw new Error("Q2 ammo pack has no admitted ammo inventory");
          game.host.inventory.configure(player, { ...entry, capacity: Math.max(entry.capacity, capacity) });
          if (item.full || ammo.classname === "ammo_bullets" || ammo.classname === "ammo_shells") game.host.inventory.give(player, id(ammo), ammo.quantity);
        }
        this.hooks.ammoPack?.(player, game, item.full);
        break;
      }
      case "ammo": {
        const quantity = item.weaponAmmo === true && item.infiniteAmmoQuantity !== null && (game.options.deathmatchFlags & 8192) !== 0
          ? item.infiniteAmmoQuantity ?? 1000 : entity.count || item.quantity;
        if (this.pickupAdmission !== null && baseAmmoIds.has(id(item))) {
          const taken = item.weaponAmmo === true
            ? this.pickupAdmission.ammoWeapon(player, { item: id(item), amount: quantity, weapon: id(item) }, { mode: "always", when: "empty-ammo" })
            : this.pickupAdmission.ammo(player, { item: id(item), amount: quantity });
          if (!taken) return false;
          break;
        }
        this.ensure(player, game, id(item), item.capacity);
        const old = game.host.inventory.count(player.id, id(item));
        if (game.host.inventory.give(player, id(item), quantity) === 0) return false;
        if (item.weaponAmmo === true && old === 0) this.hooks.weaponPicked(player.id, id(item), true);
        break;
      }
      case "weapon": {
        const admission = baseWeaponIds.has(id(item)) ? this.pickupAdmission : null;
        if (admission !== null && id(item) === "q2:weapon_blaster") return false;
        if (admission === null) this.ensure(player, game, id(item), 32767);
        const previous = admission === null ? game.host.inventory.count(player.id, id(item)) : admission.owns(player.id, id(item)) ? 1 : 0;
        const weaponStays = game.options.mode === "coop" ? !(this.pickupPolicy?.instancedCoop?.(game) ?? false)
          : game.options.mode === "deathmatch" && (game.options.deathmatchFlags & 4) !== 0;
        if (weaponStays && previous > 0 && !isDropped(entity)) return false;
        if (admission === null) game.host.inventory.give(player, id(item), 1);
        const grants: PickupAmmoGrant[] = [];
        if ((entity.spawnflags & 0x10000) === 0 && item.ammo !== null) {
          const ammo = this.catalog.get(item.ammo.slice(3));
          if (ammo?.kind === "ammo") {
            const amount = (game.options.deathmatchFlags & 8192) !== 0 ? 1000 : ammo.quantity;
            if (admission === null) { this.ensure(player, game, id(ammo), ammo.capacity); game.host.inventory.give(player, id(ammo), amount); }
            else grants.push({ item: id(ammo), amount });
          }
        }
        if (admission === null) this.hooks.weaponPicked(player.id, id(item), previous === 0);
        else if (!admission.weapon(player, { item: id(item), ammo: grants }, previous === 0 ? "always" : "never")) return false;
        if (!isDropped(entity) && (game.options.mode === "coop" || game.options.mode === "deathmatch" && (game.options.deathmatchFlags & 4) !== 0)) {
          this.pickup(entity).retained = true; return true;
        }
        break;
      }
      case "health": {
        if (!item.ignoreMaximum && current.health >= maximum) return false;
        const amount = entity.count || item.amount;
        game.host.combat.setHealth(player, item.ignoreMaximum ? current.health + amount : Math.min(maximum, current.health + amount));
        if (item.timed) {
          entity.owner = player.id; this.pickup(entity).retained = true; entity.visible = false;
          game.solid(entity, "none"); game.show(entity); game.schedule(entity, 5, this.megaHealth); return true;
        }
        break;
      }
      case "armor": case "shard": {
        const next = pickupQ2Armor(item, current.armor);
        if (next === null) return false;
        game.host.combat.setArmor(player, next); break;
      }
      case "maximum-health": {
        const increase = item.fill && game.options.mode === "deathmatch" ? 0 : item.increase;
        if (playerEntity !== null) playerEntity.maxHealth = maximum + increase;
        if (item.fill && current.health < maximum + increase) game.host.combat.setHealth(player, maximum + increase);
        break;
      }
      case "power": {
        this.ensure(player, game, id(item), 32767);
        const quantity = game.host.inventory.count(player.id, id(item));
        if (game.options.edition === "rerelease" && game.options.skill === 0 && quantity >= 3 || game.options.skill === 1 && quantity >= 2 || game.options.skill >= 2 && quantity >= 1
          || game.options.mode === "coop" && !(this.pickupPolicy?.instancedCoop?.(game) ?? false) && item.coopStay && quantity > 0) return false;
        game.host.inventory.give(player, id(item), 1);
        if (game.options.mode === "deathmatch" && ((game.options.deathmatchFlags & 16) !== 0 || item.classname === "item_quad" && (entity.spawnflags & 0x20000) !== 0)) {
          const expires = this.pickup(entity).expiresAt;
          this.use(player, id(item), game, expires === null ? 30 : Math.max(0, expires - game.host.now()));
        }
        break;
      }
      case "power-armor": {
        this.ensure(player, game, id(item), 32767);
        const old = game.host.inventory.count(player.id, id(item));
        game.host.inventory.give(player, id(item), 1);
        if (game.options.mode === "deathmatch" && old === 0) this.use(player, id(item), game);
        break;
      }
    }
    if (!isDropped(entity) && game.options.mode === "deathmatch") this.setRespawn(entity, game, respawn);
    return true;
  }

  private readonly megaHealth: Q2Think = (entity, game) => {
    const owner = entity.owner === null ? null : game.host.actors.resolveOwned(entity.owner);
    const health = owner === null ? null : game.host.combat.read(owner.id);
    const maximum = game.entity(entity.owner)?.maxHealth || 100;
    if (owner !== null && health !== null && health.health > maximum) {
      game.host.combat.setHealth(owner, health.health - 1); return game.schedule(entity, 1, this.megaHealth);
    }
    return !isDropped(entity) && game.options.mode === "deathmatch" ? this.setRespawn(entity, game, 20) : game.remove(entity);
  };

  use(player: OwnedActor, itemId: ItemId, game: Q2GameServices, duration = 30): boolean {
    const item = itemId.startsWith("q2:") ? this.catalog.get(itemId.slice(3)) : undefined;
    if (item === undefined || game.host.inventory.count(player.id, itemId) === 0) return false;
    if (item.kind === "custom") return item.use?.(player, game) ?? false;
    if (item.kind === "power-armor") {
      const armor = game.host.combat.read(player.id)?.armor;
      const active = armor?.kind === "q2" && armor.powerArmor.kind !== "none";
      if (!active && game.host.inventory.count(player.id, "q2:ammo_cells") === 0) return false;
      const kind = active ? "none" : item.armor;
      const powerArmor = kind === "none" ? { kind: "none" } satisfies Extract<ArmorState, { kind: "q2" }>["powerArmor"]
        : { kind, cells: game.host.inventory.count(player.id, "q2:ammo_cells") };
      game.host.combat.setArmor(player, armor?.kind === "q2" ? { ...armor, powerArmor } : {
        kind: "q2", item: "q2:item_armor_jacket", points: 0, normalProtection: 0.3, energyProtection: 0, powerArmor,
      });
      this.hooks.powerArmor(player.id, active ? "none" : item.armor);
      return true;
    }
    if (item.kind !== "power" || !game.host.inventory.consume(player, itemId, 1)) return false;
    let state = this.powers.get(player.id);
    if (state === undefined) { state = { quadUntil: 0, invulnerabilityUntil: 0, breatherUntil: 0, enviroUntil: 0 }; this.powers.set(player.id, state); }
    const now = game.host.now();
    switch (item.classname) {
      case "item_quad": state.quadUntil = Math.max(state.quadUntil, now) + duration; break;
      case "item_silencer": this.hooks.silencer(player.id, 30); break;
      case "item_breather": state.breatherUntil = Math.max(state.breatherUntil, now) + 30; break;
      case "item_enviro": state.enviroUntil = Math.max(state.enviroUntil, now) + 30; break;
      case "item_invulnerability": {
        state.invulnerabilityUntil = Math.max(state.invulnerabilityUntil, now) + 30;
        game.host.combat.setTraits(player, { invulnerable: true });
        const timer = game.create("invulnerability_expiry"); timer.owner = player.id;
        game.schedule(timer, state.invulnerabilityUntil - now, this.invulnerabilityExpiry);
        break;
      }
    }
    return true;
  }

  private readonly touchPickup: Q2Touch = (entity, game, contact) => this.touch(entity, game, contact.other);
  private readonly temporaryTouch: Q2Touch = (entity, game, contact) => entity.owner?.equals(contact.other) ? undefined : this.touch(entity, game, contact.other);
  private readonly useItem: Q2Use = (entity, game) => {
    entity.visible = true; entity.use = null;
    game.solid(entity, (entity.spawnflags & 2) !== 0 ? "box" : "trigger"); return game.show(entity);
  };
  private readonly makeTouchable: Q2Think = (entity, game) => {
    entity.touch = this.touchPickup;
    const expires = this.pickup(entity).expiresAt;
    if (expires !== null) game.schedule(entity, Math.max(0, expires - game.host.now()), freeQ2Entity);
    else if (game.options.mode === "deathmatch") game.schedule(entity, 29, freeQ2Entity);
    return undefined;
  };
  private readonly invulnerabilityExpiry: Q2Think = (entity, game) => {
    const player = entity.owner === null ? null : game.host.actors.resolveOwned(entity.owner);
    if (player !== null && game.host.now() >= this.playerPowerups(player.id).invulnerabilityUntil) game.host.combat.setTraits(player, { invulnerable: false });
    return game.remove(entity);
  };
}

function pickupQ2Armor(item: Extract<Item, { readonly kind: "armor" | "shard" }>, old: ArmorState): ArmorState | null {
  const powerArmor = old.kind === "q2" ? old.powerArmor : { kind: "none" } satisfies Extract<ArmorState, { kind: "q2" }>["powerArmor"];
  if (item.kind === "shard") {
    if (old.kind === "q2" && old.points > 0) return { ...old, points: old.points + 2 };
    return { kind: "q2", item: "q2:item_armor_jacket", points: 2, normalProtection: 0.3, energyProtection: 0, powerArmor };
  }
  if (old.kind !== "q2" || old.points === 0) return { kind: "q2", item: id(item), points: item.points, normalProtection: item.normal, energyProtection: item.energy, powerArmor };
  if (item.normal > old.normalProtection) {
    return { kind: "q2", item: id(item), points: Math.min(item.maximum, item.points + Math.trunc(old.points * old.normalProtection / item.normal)), normalProtection: item.normal, energyProtection: item.energy, powerArmor };
  }
  const maximum = old.item === "q2:item_armor_jacket" ? 50 : old.item === "q2:item_armor_combat" ? 100 : 200;
  const points = Math.min(maximum, old.points + Math.trunc(item.points * item.normal / old.normalProtection));
  return points <= old.points ? null : { ...old, points };
}

export function createQ2ItemModule(hooks: Q2ItemHooks): Q2ItemModule { return new Q2ItemModule(hooks); }
