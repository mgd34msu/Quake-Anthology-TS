import type { ArsenalIntent, InventoryEntry, ItemId } from "../../../../contracts/gameplay.ts";
import type { PickupAmmoReceipt, PickupSelection } from "../../../../contracts/pickups.ts";
import { q1AmmoPickupSelection, q1WeaponPickupSelection } from "../../../../content/q1/foundation/pickups.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { Q1EntityServices } from "../../../../content/q1/foundation/entity-services.ts";
import { WEAPONS, isQ1BaseWeapon, q1WeaponBit } from "../../../../content/q1/foundation/types.ts";
import type { Q1BaseWeapon, Q1PlayerState } from "../../../../content/q1/foundation/types.ts";
import type { PlayerUi } from "../types.ts";
import { CommandButtons } from "../../../../movement/q3/constants.ts";
import type { SelectedArsenal } from "./selected.ts";

export interface Q1SelectedArsenalTravel {
  readonly weapon: Q1BaseWeapon;
  readonly inventory: readonly InventoryEntry[];
}

export interface Q1SelectedArsenalOptions {
  readonly game: Q1EntityServices;
  readonly replacedItems?: readonly ItemId[];
  observe(actor: ActorId): { readonly viewAngles: Vec3; readonly waterLevel: number };
}

/** The source component owns weapon continuations; the session owns the player and inventory. */
export class Q1SelectedArsenal implements SelectedArsenal {
  readonly family = "q1";
  readonly provider;

  constructor(private readonly options: Q1SelectedArsenalOptions) {
    this.provider = options.game.provider;
    if (options.game.registeredWeapons.size !== 0) throw new Error("Selected Q1 arsenal currently admits only base id1 weapons");
  }

  get game(): Q1EntityServices { return this.options.game; }

  has(actor: ActorId): boolean { return this.options.game.player(actor) !== null; }

  admit(actor: OwnedActor, maxHealth: number): ArsenalState {
    const game = this.options.game;
    if (game.player(actor.id) !== null) throw new Error("Selected Q1 arsenal already admitted");
    for (const entry of game.host.inventory.entries(actor.id)) if (this.options.replacedItems?.includes(entry.item)) game.host.inventory.configure(actor, { ...entry, count: 0 });
    game.initializeWeaponInventory(actor);
    game.attachPlayer(actor, { initializeInventory: false, maxHealth });
    return this.read(actor.id);
  }

  captureTravel(actor: ActorId): Q1SelectedArsenalTravel {
    const player = this.require(actor);
    if (!isQ1BaseWeapon(player.weapon)) throw new Error("Selected Q1 travel has an expansion weapon");
    return { weapon: player.weapon, inventory: this.read(actor).ammo };
  }

  admitTravel(actor: OwnedActor, maxHealth: number, travel: Q1SelectedArsenalTravel): ArsenalState {
    const game = this.options.game;
    if (game.player(actor.id) !== null) throw new Error("Selected Q1 arsenal already admitted");
    for (const entry of travel.inventory) {
      if (!WEAPONS.some(weapon => game.weaponItem(weapon) === entry.item || game.weaponAmmo(weapon) === entry.item))
        throw new Error("Selected Q1 travel contains another component's inventory");
      game.host.inventory.configure(actor, entry);
    }
    game.attachPlayer(actor, { initializeInventory: false, maxHealth, weapon: travel.weapon });
    return this.read(actor.id);
  }

  read(actor: ActorId): ArsenalState {
    const player = this.require(actor), game = this.options.game;
    if (!isQ1BaseWeapon(player.weapon)) throw new Error("Selected Q1 player has an expansion weapon");
    return { provider: this.provider, activeWeapon: game.weaponItem(player.weapon),
      ammo: game.host.inventory.entries(actor).filter(entry => WEAPONS.some(weapon => game.weaponItem(weapon) === entry.item || game.weaponAmmo(weapon) === entry.item)),
      state: { kind: "q1", frame: player.weaponFrame, attackFinishedSeconds: player.attackFinished, sourceWeapon: q1WeaponBit(player.weapon) } };
  }

  select(actor: ActorId, item: ItemId): boolean {
    const player = this.require(actor), game = this.options.game;
    const weapon = WEAPONS.find(weapon => game.weaponItem(weapon) === item);
    return weapon !== undefined && game.selectWeapon(player.actor, weapon);
  }

  pendingWeapon(actor: ActorId): null { this.require(actor); return null; }
  handoff(actor: ActorId) { return this.options.game.primaryWeaponHandoff(this.require(actor).actor); }

  pickupAmmo(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined {
    const game = this.options.game, player = this.require(actor.id);
    const before = game.chooseBest(actor, item => grants.find(grant => grant.item === item)?.before ?? game.host.inventory.count(actor.id, item));
    return q1AmmoPickupSelection(game, player, before, autoSwitch);
  }

  pickupWeapons(actor: OwnedActor, weapons: readonly ItemId[], selection: PickupSelection): undefined {
    const game = this.options.game, player = this.require(actor.id);
    for (const item of weapons) {
      const weapon = WEAPONS.find(weapon => game.weaponItem(weapon) === item);
      if (weapon !== undefined) q1WeaponPickupSelection(game, player, weapon, selection);
    }
    return undefined;
  }

  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult {
    if (intent !== undefined && intent.provider !== this.provider) throw new Error("Arsenal intent belongs to a different provider");
    if (intent?.weapon != null && !WEAPONS.some(weapon => this.options.game.weaponItem(weapon) === intent.weapon))
      throw new Error("Weapon does not belong to the selected Q1 product");
    if (intent?.weapon != null) this.select(input.actor.id, intent.weapon);
    const before = this.read(input.actor.id), observation = this.options.observe(input.actor.id);
    const seconds = input.frame.time.kind === "seconds" ? input.frame.time.value : input.frame.time.value / 1000;
    const pressed = (input.command.buttons & 1) !== 0 && (input.command.kind !== "q3" || (input.command.buttons & CommandButtons.TALK) === 0);
    this.options.game.weaponInput(input.actor, pressed, observation.viewAngles, seconds, observation.waterLevel);
    return { arsenal: this.options.game.host.actors.isLive(input.actor.id) ? this.read(input.actor.id) : before, animation: input.animation, effects: [] };
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

  ui(actor: ActorId): Pick<PlayerUi, "activeWeapon" | "ammo" | "items"> {
    const player = this.require(actor), game = this.options.game, ammo = game.weaponAmmo(player.weapon);
    return { activeWeapon: game.weaponItem(player.weapon), ammo: ammo === null ? null : { item: ammo, count: game.host.inventory.count(actor, ammo) },
      items: WEAPONS.map((weapon, index) => {
        const item = game.weaponItem(weapon), ammo = game.weaponAmmo(weapon), count = ammo === null ? null : game.host.inventory.count(actor, ammo);
        return { id: item, label: weapon, kind: "weapon", sourceOrdinal: index + 1, owned: game.host.inventory.count(actor, item) > 0,
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
