import type { SelectedPickupWeapon } from "../../../../world/gameplay/pickups.ts";
import { q3WeaponStatus, q3ArsenalWarning } from "./weapon-status.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { ArsenalIntent, ItemId } from "../../../../contracts/gameplay.ts";
import type { PickupAmmoReceipt, PickupSelection } from "../../../../contracts/pickups.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import { Q3_WEAPON_ITEMS, q3RequestWeapon, q3RequestWeaponHolster, q3RequestWeaponResume, q3SpawnArsenalRuntime, q3SpawnLoadout, q3SpawnAnimation, q3WeaponItem, stepQ3Arsenal } from "../../../../content/q3/foundation/arsenal.ts";
import type { Q3ArsenalRuntimeState } from "../../../../content/q3/foundation/arsenal.ts";
import { ItemType } from "../../../../content/q3/base/shared/definitions.ts";
import { itemList } from "../../../../content/q3/base/shared/items.ts";
import { EntityEvent } from "../../../../movement/q3/constants.ts";
import { readInventoryEntry } from "../../../../persistence/save-image.ts";
import { namespaced } from "../../../../persistence/value.ts";
import type { SaveReader } from "../../../../persistence/value.ts";
import type { SharedInventoryTable } from "../../../../world/gameplay/inventory.ts";
import { resolveQ3ArsenalControls } from "../arsenal-intent.ts";
import type { PlayerUi } from "../types.ts";
import type { SelectedArsenal } from "./selected.ts";
import type { PrimaryWeaponHandoff } from "../weapon-slot.ts";

export interface Q3SelectedArsenalOptions {
  readonly provider: ProviderId;
  readonly product: "baseq3" | "missionpack";
  readonly inventory: SharedInventoryTable;
  readonly supply?: { readonly profile: ItemId; readonly loadout: ArsenalState; readonly replacedItems: readonly ItemId[] };
  firingDelay?(actor: OwnedActor, milliseconds: number): number;
  loadout?(actor: OwnedActor, defaults: ArsenalState): ArsenalState;
  readonly equipment?: {
    readonly ownsHoldables?: boolean;
    read(actor: OwnedActor): Pick<Q3ArsenalRuntimeState, "maxHealth" | "persistentPowerupTag" | "holdableItem" | "holdableTag">;
    consume(actor: OwnedActor, item: number): undefined;
    advance?(actor: OwnedActor, milliseconds: number): void;
    endCommand?(actor: OwnedActor, milliseconds: number): void;
    restore?(actor: OwnedActor, state: Pick<Q3ArsenalRuntimeState, "maxHealth" | "persistentPowerupTag" | "holdableItem" | "holdableTag">): void;
  };
  fire(actor: OwnedActor, weapon: number, input: WeaponStepInput): undefined;
  useHoldable(actor: OwnedActor, event: number, input: WeaponStepInput): undefined;
}

export interface Q3SelectedArsenalCheckpoint {
  readonly supplyProfile: ItemId | null;
  readonly arsenal: ArsenalState;
  readonly runtime: Q3ArsenalRuntimeState;
  readonly torsoAnimation: number;
  readonly lastFireMilliseconds: number | null;
}

interface PlayerArsenal {
  readonly actor: OwnedActor;
  arsenal: ArsenalState;
  runtime: Q3ArsenalRuntimeState;
  torsoAnimation: number;
  lastFireMilliseconds: number | null;
}

export class Q3SelectedArsenal implements SelectedArsenal {
  catalog(): readonly SelectedPickupWeapon[] {
    return Q3_WEAPON_ITEMS.filter(entry => this.options.product === "missionpack" || entry.weapon <= 10).map(weapon => ({ item: weapon.item, ammo: weapon.ammo, drop: "supply" }));
  }
  readonly family = "q3";
  readonly provider: ProviderId;
  private readonly inventoryItems: ReadonlySet<ItemId>;
  private readonly players = new Map<ActorId, PlayerArsenal>();

  constructor(private readonly options: Q3SelectedArsenalOptions) {
    this.provider = options.provider;
    this.inventoryItems = new Set(Q3_WEAPON_ITEMS.filter(weapon => options.product === "missionpack" || weapon.weapon <= 10)
      .flatMap(weapon => weapon.ammo === null ? [weapon.item] : [weapon.item, weapon.ammo]));
  }

  private clearReplacedItems(actor: OwnedActor): undefined {
    for (const entry of this.options.inventory.entries(actor.id)) if (this.options.supply?.replacedItems.includes(entry.item))
      this.options.inventory.configure(actor, { ...entry, count: 0 });
    return undefined;
  }

  has(actor: ActorId): boolean { return this.players.has(actor); }

  admit(actor: OwnedActor, maxHealth: number, teamDeathmatch = false): ArsenalState {
    if (this.players.has(actor.id)) throw new Error("Selected Q3 arsenal already admitted");
    const defaults = this.options.supply?.loadout ?? q3SpawnLoadout(this.provider, this.options.product, teamDeathmatch);
    const arsenal = this.options.loadout?.(actor, defaults) ?? defaults;
    if (arsenal.provider !== this.provider || arsenal.state.kind !== "q3") throw new Error("Selected Q3 starter belongs to a different arsenal");
    this.clearReplacedItems(actor);
    for (const entry of arsenal.ammo) this.options.inventory.configure(actor, entry);
    this.players.set(actor.id, { actor, arsenal, runtime: q3SpawnArsenalRuntime(this.options.product, maxHealth), torsoAnimation: q3SpawnAnimation().torso, lastFireMilliseconds: null });
    return this.read(actor.id);
  }

  read(actor: ActorId): ArsenalState {
    return { ...this.require(actor).arsenal, ammo: this.options.inventory.entries(actor).filter(entry => this.inventoryItems.has(entry.item)) };
  }

  select(actor: ActorId, item: ItemId): boolean {
    const player = this.require(actor), weapon = Q3_WEAPON_ITEMS.find(entry => entry.item === item);
    if (weapon === undefined || this.options.product === "baseq3" && weapon.weapon > 10) return false;
    if (this.options.inventory.count(actor, item) <= 0) return false;
    player.runtime = q3RequestWeapon(player.runtime, weapon.weapon);
    return true;
  }

  pendingWeapon(actor: ActorId): ItemId | null { const requested = this.require(actor).runtime.requestedWeapon; return requested === null ? null : q3WeaponItem(requested)?.item ?? null; }

  handoff(actor: ActorId): PrimaryWeaponHandoff {
    this.require(actor);
    return { kind: "immediate",
      provider: this.provider,
      accepts: item => Q3_WEAPON_ITEMS.some(weapon => weapon.item === item &&
        (this.options.product === "missionpack" || weapon.weapon <= 10)) && this.options.inventory.count(actor, item) > 0,
      select: item => this.select(actor, item),
      holster: () => { const player = this.require(actor); player.runtime = q3RequestWeaponHolster(player.runtime); },
      isHolstered: () => this.require(actor).runtime.externalSlot === "holstered",
      resume: item => {
        const player = this.require(actor);
        if (item !== null && !Q3_WEAPON_ITEMS.some(weapon => weapon.item === item &&
          (this.options.product === "missionpack" || weapon.weapon <= 10))) throw new Error("Resume item is not a Q3 primary weapon");
        const runtime = q3RequestWeaponResume(player.runtime);
        const requested = Q3_WEAPON_ITEMS.find(weapon => weapon.item === (item ?? player.arsenal.activeWeapon));
        player.runtime = requested === undefined ? runtime : q3RequestWeapon(runtime, requested.weapon);
        return item === null || requested !== undefined && this.options.inventory.count(actor, item) > 0;
      },
    };
  }

  private bestWeapon(actor: ActorId, before: readonly PickupAmmoReceipt[] = []) {
    return [...Q3_WEAPON_ITEMS].reverse().find(weapon => (this.options.product === "missionpack" || weapon.weapon <= 10)
      && this.options.inventory.count(actor, weapon.item) > 0
      && (weapon.ammo === null || (before.find(grant => grant.item === weapon.ammo)?.before ?? this.options.inventory.count(actor, weapon.ammo)) > 0));
  }

  pickupAmmo(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined {
    const player = this.require(actor.id);
    if (autoSwitch && this.bestWeapon(actor.id, grants)?.item === player.arsenal.activeWeapon) {
      const next = this.bestWeapon(actor.id); if (next !== undefined) this.select(actor.id, next.item);
    }
    return undefined;
  }

  pickupWeapons(actor: OwnedActor, weapons: readonly ItemId[], selection: PickupSelection): undefined {
    const player = this.require(actor.id), current = Q3_WEAPON_ITEMS.find(weapon => weapon.item === player.arsenal.activeWeapon);
    const next = [...Q3_WEAPON_ITEMS].reverse().find(weapon => weapons.includes(weapon.item));
    if (selection !== "never" && next !== undefined && (selection === "always" || current === undefined || next.weapon > current.weapon)) this.select(actor.id, next.item);
    return undefined;
  }

  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult {
    const player = this.require(input.actor.id), arsenal = this.read(input.actor.id);
    if (this.options.equipment !== undefined) player.runtime = { ...player.runtime, ...this.options.equipment.read(player.actor) };
    const holdable = player.runtime.holdableItem;
    if (intent !== undefined && intent.provider !== this.provider) throw new Error("Arsenal intent belongs to a different provider");
    if (intent?.weapon != null) {
      const requested = Q3_WEAPON_ITEMS.find(entry => entry.item === intent.weapon);
      if (requested === undefined || this.options.product === "baseq3" && requested.weapon > 10) throw new Error("Weapon does not belong to the selected Q3 product");
      this.select(input.actor.id, intent.weapon);
    }
    const weaponAnimation = { provider: this.provider, state: { ...q3SpawnAnimation(), torso: player.torsoAnimation } };
    const firingDelay = this.options.firingDelay;
    const controls = resolveQ3ArsenalControls(arsenal, intent, input.command, this.options.product);
    const result = stepQ3Arsenal({ ...input, arsenal, animation: input.animation.state.kind === "q3" ? input.animation : weaponAnimation }, player.runtime,
      this.options.equipment?.ownsHoldables === false ? { ...controls, useHoldable: false } : controls,
      firingDelay === undefined ? undefined : milliseconds => firingDelay(player.actor, milliseconds));
    const elapsed = input.frame.elapsed.kind === "milliseconds" ? input.frame.elapsed.value : input.frame.elapsed.value * 1000;
    const milliseconds = Math.trunc(elapsed + player.runtime.fractionalMilliseconds);
    this.options.equipment?.advance?.(player.actor, milliseconds);
    player.arsenal = result.arsenal;
    player.runtime = result.runtime;
    if (holdable !== 0 && result.runtime.holdableItem === 0) this.options.equipment?.consume(player.actor, holdable);
    if (result.animation.state.kind === "q3") player.torsoAnimation = result.animation.state.torso;
    for (const entry of result.arsenal.ammo) this.options.inventory.configure(player.actor, entry);
    if (result.arsenal.state.kind !== "q3") throw new Error("Selected Q3 step returned a foreign arsenal");
    for (const effect of result.effects) {
      if (effect.kind !== "event") continue;
      if (effect.value.event === EntityEvent.EV_FIRE_WEAPON) { player.lastFireMilliseconds = input.frame.time.kind === "milliseconds" ? input.frame.time.value : input.frame.time.value * 1000; this.options.fire(player.actor, result.arsenal.state.sourceWeapon, input); }
      else if (effect.value.event >= EntityEvent.EV_USE_ITEM0 && effect.value.event <= EntityEvent.EV_USE_ITEM15) this.options.useHoldable(player.actor, effect.value.event, input);
    }
    if (this.players.has(player.actor.id)) this.options.equipment?.endCommand?.(player.actor, milliseconds);
    return { ...result, arsenal: this.players.has(player.actor.id) ? this.read(player.actor.id) : result.arsenal,
      animation: input.animation.state.kind === "q3" ? result.animation : input.animation };
  }

  remove(actor: ActorId): undefined { this.players.delete(actor); return undefined; }

  capture(actor: ActorId): Q3SelectedArsenalCheckpoint {
    const player = this.require(actor);
    return { supplyProfile: this.options.supply?.profile ?? null, arsenal: this.read(actor), runtime: { ...player.runtime, ...this.options.equipment?.read(player.actor) }, torsoAnimation: player.torsoAnimation, lastFireMilliseconds: player.lastFireMilliseconds };
  }

  restore(actor: OwnedActor, checkpoint: Q3SelectedArsenalCheckpoint): undefined {
    if (checkpoint.supplyProfile !== (this.options.supply?.profile ?? null)) throw new Error("Saved pickup supply differs from selected arsenal composition");
    if (checkpoint.arsenal.provider !== this.provider || checkpoint.arsenal.state.kind !== "q3" || checkpoint.runtime.product !== this.options.product) throw new Error("Saved arsenal differs from selected Q3 provider");
    for (const entry of checkpoint.arsenal.ammo) if (this.inventoryItems.has(entry.item)) this.options.inventory.configure(actor, entry);
    this.options.equipment?.restore?.(actor, checkpoint.runtime);
    this.players.set(actor.id, { actor, arsenal: checkpoint.arsenal, runtime: { ...checkpoint.runtime }, torsoAnimation: checkpoint.torsoAnimation, lastFireMilliseconds: checkpoint.lastFireMilliseconds });
    return undefined;
  }

  ui(actor: ActorId, source: ProviderReference): Pick<PlayerUi, "activeWeapon" | "ammo" | "items" | "weaponStatus" | "arsenalWarning"> {
    const arsenal = this.read(actor), weapon = arsenal.state.kind === "q3" ? q3WeaponItem(arsenal.state.sourceWeapon) : null;
    return { weaponStatus: q3WeaponStatus(arsenal.activeWeapon, this.options.product, item => this.options.inventory.count(actor, item), source),
      arsenalWarning: q3ArsenalWarning(this.options.product, item => this.options.inventory.count(actor, item)), activeWeapon: arsenal.activeWeapon,
      ammo: weapon?.ammo == null ? null : { item: weapon.ammo, count: this.options.inventory.count(actor, weapon.ammo) },
      items: Q3_WEAPON_ITEMS.filter(entry => this.options.product === "missionpack" || entry.weapon <= 10).map(entry => {
        const count = entry.ammo === null ? null : this.options.inventory.count(actor, entry.ammo);
        return { id: entry.item, label: entry.item.slice("q3:weapon/".length), kind: "weapon", sourceOrdinal: entry.weapon,
          owned: this.options.inventory.count(actor, entry.item) > 0, hasAmmo: count === null || count > 0, count, warningCount: 0 };
      }) };
  }

  viewState(actor: ActorId) { const player = this.require(actor); return { torsoAnimation: player.torsoAnimation, lastFireMilliseconds: player.lastFireMilliseconds }; }

  view(actor: ActorId): { readonly path: string; readonly frame: number } | null {
    const arsenal = this.read(actor);
    if (arsenal.state.kind !== "q3") throw new Error("Selected Q3 player has foreign arsenal state");
    const number = arsenal.state.sourceWeapon;
    const item = itemList(this.options.product).find(entry => entry.type === ItemType.IT_WEAPON && entry.tag === number);
    const path = item?.worldModels[0];
    return path == null ? null : { path, frame: 0 };
  }

  private require(actor: ActorId): PlayerArsenal {
    const player = this.players.get(actor);
    if (player === undefined) throw new Error("Actor has no selected Q3 arsenal");
    return player;
  }
}

export function readQ3SelectedArsenalCheckpoint(reader: SaveReader): Q3SelectedArsenalCheckpoint {
  const arsenal = reader.field("arsenal"), state = arsenal.field("state"), runtime = reader.field("runtime");
  return {
    supplyProfile: reader.field("supplyProfile").value === undefined ? null : reader.field("supplyProfile").nullable(namespaced),
    arsenal: { provider: namespaced(arsenal.field("provider")), activeWeapon: arsenal.field("activeWeapon").nullable(namespaced),
      ammo: arsenal.field("ammo").list(readInventoryEntry), state: { kind: state.field("kind").literal("q3"),
        sourceWeapon: state.field("sourceWeapon").integer(0), state: state.field("state").integer(0), timeMilliseconds: state.field("timeMilliseconds").number() } },
    runtime: { product: runtime.field("product").choice("baseq3", "missionpack"), maxHealth: runtime.field("maxHealth").number(),
      spectator: runtime.field("spectator").boolean(), persistentPowerupTag: runtime.field("persistentPowerupTag").integer(0),
      holdableItem: runtime.field("holdableItem").integer(0), holdableTag: runtime.field("holdableTag").integer(0),
      respawned: runtime.field("respawned").boolean(), useItemHeld: runtime.field("useItemHeld").boolean(),
      eventSequence: runtime.field("eventSequence").integer(0), fractionalMilliseconds: runtime.field("fractionalMilliseconds").number(),
      externalSlot: runtime.field("externalSlot").value === undefined ? "active" :
        runtime.field("externalSlot").choice("active", "holster-requested", "dropping", "holstered", "resume-requested"), requestedWeapon: runtime.field("requestedWeapon").nullable(value => value.integer(0)) },
    torsoAnimation: reader.field("torsoAnimation").integer(0), lastFireMilliseconds: reader.field("lastFireMilliseconds").nullable(value => value.finite()),
  };
}
