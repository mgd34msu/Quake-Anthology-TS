import { q1WeaponStatus, q1WeaponDisplayName } from "./weapon-status.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { ArsenalIntent, InventoryEntry, ItemId } from "../../../../contracts/gameplay.ts";
import type { PickupAmmoReceipt, PickupSelection } from "../../../../contracts/pickups.ts";
import { q1AmmoPickupSelection, q1WeaponPickupSelection } from "../../../../content/q1/foundation/pickups.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { Q1EntityServices } from "../../../../content/q1/foundation/entity-services.ts";
import { WEAPONS, isQ1BaseWeapon, q1WeaponBit } from "../../../../content/q1/foundation/types.ts";
import type { Q1Weapon, Q1PlayerState } from "../../../../content/q1/foundation/types.ts";
import { q1WeaponImpulse } from "../../../../content/composition/q1/commands.ts";
import type { PlayerUi } from "../types.ts";
import { CommandButtons } from "../../../../movement/q3/constants.ts";
import type { SelectedArsenal } from "./selected.ts";

export interface Q1SelectedArsenalTravel {
  readonly weapon: Q1Weapon;
  readonly inventory: readonly InventoryEntry[];
}

export interface Q1SelectedArsenalOptions {
  readonly game: Q1EntityServices;
  nativePlayer?(actor: ActorId): Q1PlayerState;
  readonly replacedItems?: readonly ItemId[];
  fired?(actor: ActorId, weapon: Q1Weapon, animation: WeaponStepInput["animation"]): WeaponStepResult["animation"];
  impulse?(player: Q1PlayerState, value: number): boolean;
  preparePickup?(player: Q1PlayerState): undefined;
  observe(actor: ActorId): { readonly viewAngles: Vec3; readonly waterLevel: number };
}

/** The source component owns weapon continuations; the session owns the player and inventory. */
export class Q1SelectedArsenal implements SelectedArsenal {
  readonly family = "q1";
  readonly provider;
  readonly weapons: readonly Q1Weapon[];

  constructor(private readonly options: Q1SelectedArsenalOptions) {
    this.provider = options.game.provider;
    this.weapons = [...new Set<Q1Weapon>([...WEAPONS, ...options.game.registeredWeapons.keys()])];
  }

  get game(): Q1EntityServices { return this.options.game; }

  has(actor: ActorId): boolean { return this.options.game.player(actor) !== null; }

  admit(actor: OwnedActor, maxHealth: number): ArsenalState {
    const game = this.options.game;
    if (game.player(actor.id) !== null) throw new Error("Selected Q1 arsenal already admitted");
    for (const entry of game.host.inventory.entries(actor.id)) if (this.options.replacedItems?.includes(entry.item)) game.host.inventory.configure(actor, { ...entry, count: 0 });
    const native = this.options.nativePlayer?.(actor.id);
    if (native === undefined) game.initializeWeaponInventory(actor);
    for (const weapon of game.registeredWeapons.keys()) {
      const item = game.weaponItem(weapon);
      game.host.inventory.configure(actor, { item, count: game.host.inventory.count(actor.id, item), capacity: 1 });
    }
    const player = game.attachPlayer(actor, { initializeInventory: false, maxHealth: native?.maxHealth ?? maxHealth, ...(native === undefined ? {} : { weapon: native.weapon }) });
    if (native !== undefined) player.autoSwitch = native.autoSwitch;
    return this.read(actor.id);
  }

  captureTravel(actor: ActorId): Q1SelectedArsenalTravel {
    const player = this.require(actor);
    return { weapon: player.weapon, inventory: this.read(actor).ammo };
  }

  admitTravel(actor: OwnedActor, maxHealth: number, travel: Q1SelectedArsenalTravel): ArsenalState {
    const game = this.options.game;
    if (game.player(actor.id) !== null) throw new Error("Selected Q1 arsenal already admitted");
    if (!this.weapons.includes(travel.weapon) || !travel.inventory.some(entry => entry.item === game.weaponItem(travel.weapon) && entry.count > 0))
      throw new Error("Selected Q1 travel weapon is not owned by this product");
    for (const entry of travel.inventory) {
      if (!this.weapons.some(weapon => game.weaponItem(weapon) === entry.item || game.weaponAmmo(weapon) === entry.item))
        throw new Error("Selected Q1 travel contains another component's inventory");
      game.host.inventory.configure(actor, entry);
    }
    game.attachPlayer(actor, { initializeInventory: false, maxHealth, weapon: travel.weapon });
    return this.read(actor.id);
  }

  read(actor: ActorId): ArsenalState {
    const player = this.require(actor), game = this.options.game;
    if (!this.weapons.includes(player.weapon)) throw new Error("Selected Q1 player has a weapon from another product");
    return { provider: this.provider, activeWeapon: game.weaponItem(player.weapon),
      ammo: game.host.inventory.entries(actor).filter(entry => this.weapons.some(weapon => game.weaponItem(weapon) === entry.item || game.weaponAmmo(weapon) === entry.item)),
      state: { kind: "q1", frame: player.weaponFrame, attackFinishedSeconds: player.attackFinished, sourceWeapon: isQ1BaseWeapon(player.weapon) ? q1WeaponBit(player.weapon) : 0 } };
  }

  select(actor: ActorId, item: ItemId): boolean {
    const player = this.require(actor), game = this.options.game;
    const weapon = this.weapons.find(weapon => game.weaponItem(weapon) === item);
    return weapon !== undefined && game.selectWeapon(player.actor, weapon);
  }

  pendingWeapon(actor: ActorId): null { this.require(actor); return null; }
  impulse(actor: ActorId, value: number): boolean {
    const player = this.require(actor);
    if (value === 0 || this.game.time < player.attackFinished) return false;
    return this.options.impulse?.(player, value) ?? q1WeaponImpulse(this.game, player, value);
  }
  handoff(actor: ActorId) { return this.options.game.primaryWeaponHandoff(this.require(actor).actor); }

  pickupAmmo(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined {
    const game = this.options.game, player = this.require(actor.id);
    this.options.preparePickup?.(player);
    const before = game.chooseBest(actor, item => grants.find(grant => grant.item === item)?.before ?? game.host.inventory.count(actor.id, item));
    return q1AmmoPickupSelection(game, player, before, autoSwitch && (this.options.nativePlayer?.(actor.id).autoSwitch ?? player.autoSwitch) !== "never");
  }

  pickupWeapons(actor: OwnedActor, weapons: readonly ItemId[], selection: PickupSelection): undefined {
    const game = this.options.game, player = this.require(actor.id);
    this.options.preparePickup?.(player);
    for (const item of weapons) {
      const weapon = this.weapons.find(weapon => game.weaponItem(weapon) === item);
      if (weapon !== undefined) q1WeaponPickupSelection(game, player, weapon, (this.options.nativePlayer?.(actor.id).autoSwitch ?? player.autoSwitch) === "never" ? "never" : selection);
    }
    return undefined;
  }

  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult {
    if (intent !== undefined && intent.provider !== this.provider) throw new Error("Arsenal intent belongs to a different provider");
    if (intent?.weapon != null && !this.weapons.some(weapon => this.options.game.weaponItem(weapon) === intent.weapon))
      throw new Error("Weapon does not belong to the selected Q1 product");
    if (intent?.weapon != null && this.options.game.weaponItem(this.require(input.actor.id).weapon) !== intent.weapon)
      this.select(input.actor.id, intent.weapon);
    const before = this.read(input.actor.id), observation = this.options.observe(input.actor.id);
    const seconds = input.frame.time.kind === "seconds" ? input.frame.time.value : input.frame.time.value / 1000;
    const pressed = (input.command.buttons & 1) !== 0 && (input.command.kind !== "q3" || (input.command.buttons & CommandButtons.TALK) === 0);
    const weapon = this.require(input.actor.id).weapon;
    const fired = this.options.game.weaponInput(input.actor, pressed, observation.viewAngles, seconds, observation.waterLevel);
    const live = this.options.game.host.actors.isLive(input.actor.id);
    const animation = fired && live ? this.options.fired?.(input.actor.id, weapon, input.animation) ?? input.animation : input.animation;
    return { arsenal: live ? this.read(input.actor.id) : before, animation, effects: [] };
  }

  frame(seconds: number): undefined {
    for (const player of this.options.game.players.values()) this.options.game.weaponFrame(player.actor, seconds);
    return undefined;
  }

  remove(actor: ActorId): undefined {
    const player = this.options.game.player(actor);
    if (player !== null) this.options.game.players.delete(player.actor);
    return undefined;
  }

  ui(actor: ActorId, source: ProviderReference): Pick<PlayerUi, "activeWeapon" | "ammo" | "items" | "weaponStatus" | "arsenalWarning"> {
    const player = this.require(actor), game = this.options.game, ammo = game.weaponAmmo(player.weapon);
    return { weaponStatus: q1WeaponStatus(game, player, source), arsenalWarning: "none", activeWeapon: game.weaponItem(player.weapon), ammo: ammo === null ? null : { item: ammo, count: game.host.inventory.count(actor, ammo) },
      items: this.weapons.map((weapon, index) => {
        const item = game.weaponItem(weapon), ammo = game.weaponAmmo(weapon), count = ammo === null ? null : game.host.inventory.count(actor, ammo);
        return { id: item, label: q1WeaponDisplayName(weapon), kind: "weapon", sourceOrdinal: index + 1, owned: game.host.inventory.count(actor, item) > 0,
          hasAmmo: game.weaponAvailable(player, weapon), count, warningCount: 0 };
      }) };
  }

  view(actor: ActorId): { readonly path: string; readonly frame: number } {
    const player = this.require(actor);
    return { path: this.options.game.weaponModel(player.weapon, player), frame: player.weaponFrame };
  }

  private require(actor: ActorId): Q1PlayerState {
    const player = this.options.game.player(actor);
    if (player === null) throw new Error("Actor has no selected Q1 arsenal");
    return player;
  }
}
