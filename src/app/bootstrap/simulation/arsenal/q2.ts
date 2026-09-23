import { q2BaseWeaponDisplayName } from "../../../../content/q2/foundation/items.ts";
import { q2MissionWeaponDisplayName } from "../../../../content/q2/missionpacks/items.ts";
import { q2WeaponStatus } from "./weapon-status.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import { latchQ2WeaponButtons, earlyQ2WeaponTurn, beginQ2WeaponTurn } from "../../../../content/q2/foundation/weapons/turn.ts";
import type { Q2WeaponTurnState } from "../../../../content/q2/foundation/weapons/turn.ts";
import type { ArsenalIntent, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { PickupAmmoReceipt, PickupSelection } from "../../../../contracts/pickups.ts";
import type { Q2GameServices } from "../../../../content/q2/foundation/host.ts";
import { Q2_BASE_WEAPONS } from "../../../../content/q2/foundation/weapons/definitions.ts";
import type { Q2Weapons } from "../../../../content/q2/foundation/weapons/player.ts";
import { Q2WeaponState } from "../../../../content/q2/foundation/weapons/types.ts";
import type { Q2WeaponDefinition, Q2WeaponInput, Q2WeaponName, Q2WeaponOwner } from "../../../../content/q2/foundation/weapons/types.ts";
import type { SharedInventoryTable } from "../../../../world/gameplay/inventory.ts";
import type { PlayerUi } from "../types.ts";
import type { PrimaryWeaponHandoff } from "../weapon-slot.ts";
import type { SelectedArsenal } from "./selected.ts";

export interface Q2SelectedWeaponTurnState extends Q2WeaponTurnState { firing: { readonly weapon: Q2WeaponName; credit: number } | null; }

export interface Q2SelectedArsenalOptions {
  readonly game: Q2GameServices;
  readonly weapons: Q2Weapons;
  readonly inventoryDefinitions: readonly { readonly item: ItemId; readonly capacity: number }[];
  /** Weakest to strongest shared pickup preference; expansion selections must supply their policy. */
  readonly pickupOrder?: readonly ItemId[];
  readonly replacedItems?: readonly ItemId[];
  readonly loadout?: { readonly weapon: ItemId; readonly inventory: readonly { readonly item: ItemId; readonly count: number }[] };
  observe(actor: ActorId): { readonly owner: Q2WeaponOwner; readonly input: Q2WeaponInput };
}

export function projectQ2Arsenal(actor: ActorId, provider: ProviderId, weapons: Q2Weapons, inventory: SharedInventoryTable): ArsenalState {
  const state = weapons.states.get(actor);
  if (state === undefined) throw new Error("Q2 player has no arsenal");
  return { provider, activeWeapon: state.weapon === null ? null : weapons.definition(state.weapon).item, ammo: inventory.entries(actor),
    state: { kind: "q2", gunFrame: state.frame, state: state.phase === "ready" ? 0 : state.phase === "activating" ? 1 : state.phase === "dropping" ? 2 : 3,
      pendingWeapon: state.pending === null ? null : weapons.definition(state.pending).item, machinegunShots: state.machinegunShots,
      grenadeTime: { kind: "seconds", value: state.grenadeTime }, grenadeBlewUp: state.grenadeBlewUp } };
}

export class Q2SelectedArsenal implements SelectedArsenal {
  private readonly definitions: readonly Q2WeaponDefinition[];
  private readonly pickupOrder: readonly ItemId[];
  private readonly turns = new Map<ActorId, Q2SelectedWeaponTurnState>();
  readonly family = "q2";
  readonly provider: ProviderId;
  constructor(private readonly options: Q2SelectedArsenalOptions) {
    this.provider = options.game.options.provider;
    options.game.host.actors.onRelease(actor => { this.turns.delete(actor.id); return undefined; });
    this.definitions = options.weapons.registeredDefinitions();
    this.pickupOrder = [...(options.pickupOrder ?? Q2_BASE_WEAPONS.map(definition => definition.item))];
    if (this.definitions.some(definition => !this.pickupOrder.includes(definition.item)))
      throw new Error("Selected Q2 arsenal requires an explicit pickup preference for every registered weapon");
    for (const definition of this.definitions) for (const item of definition.ammo === null ? [definition.item] : [definition.item, definition.ammo])
      if (!options.inventoryDefinitions.some(entry => entry.item === item)) throw new Error(`Missing source Q2 inventory definition ${item}`);
    if (options.loadout !== undefined) {
      if (!this.definitions.some(definition => definition.item === options.loadout?.weapon)) throw new Error("Selected Q2 starter weapon is outside the registered arsenal");
      for (const entry of options.loadout.inventory) if (!Number.isSafeInteger(entry.count) || entry.count < 0
        || !this.definitions.some(definition => definition.item === entry.item || definition.ammo === entry.item)) throw new Error("Selected Q2 starter inventory is invalid");
    }
  }
  has(actor: ActorId): boolean { return this.options.weapons.states.has(actor); }
  admit(actor: OwnedActor, _maxHealth: number): ArsenalState {
    if (this.has(actor.id)) throw new Error("Selected Q2 arsenal already admitted");
    const { game, weapons } = this.options, inventory = game.host.inventory;
    const items = new Set(this.definitions.flatMap(definition => definition.ammo === null ? [definition.item] : [definition.item, definition.ammo]));
    for (const entry of inventory.entries(actor.id)) if (this.options.replacedItems?.includes(entry.item) && !items.has(entry.item)) inventory.configure(actor, { ...entry, count: 0 });
    for (const entry of this.options.inventoryDefinitions) if (items.has(entry.item) && !inventory.entries(actor.id).some(current => current.item === entry.item)) inventory.configure(actor, { ...entry, count: 0 });
    const loadout = this.options.loadout;
    if (loadout !== undefined) {
      for (const entry of inventory.entries(actor.id)) if (items.has(entry.item)) inventory.configure(actor,
        { ...entry, count: Math.min(entry.capacity, loadout.inventory.find(value => value.item === entry.item)?.count ?? 0) });
    } else if (inventory.count(actor.id, "q2:weapon_blaster") === 0) inventory.give(actor, "q2:weapon_blaster", 1);
    const weapon = loadout === undefined ? "blaster" : this.definitions.find(definition => definition.item === loadout.weapon)?.name;
    if (weapon === undefined || inventory.count(actor.id, weapons.definition(weapon).item) < 1) throw new Error("Selected Q2 starter weapon is not owned");
    weapons.bind({ actor }, game, new Q2WeaponState(weapon));
    this.turns.set(actor.id, { buttons: 0, latchedButtons: 0, weaponThunk: false, firing: null });
    return this.read(actor.id);
  }
  read(actor: ActorId): ArsenalState {
    const arsenal = projectQ2Arsenal(actor, this.provider, this.options.weapons, this.options.game.host.inventory);
    return { ...arsenal, ammo: arsenal.ammo.filter(entry => this.definitions.some(definition => definition.item === entry.item || definition.ammo === entry.item)) };
  }
  select(actor: ActorId, item: ItemId): boolean {
    const definition = this.definitions.find(definition => definition.item === item);
    if (definition === undefined) return false;
    const result = this.options.weapons.requestWeapon(this.options.observe(actor).owner, this.options.game, definition.name);
    return result === "selected" || result === "current";
  }
  pendingWeapon(actor: ActorId): ItemId | null {
    const pending = this.require(actor).pending;
    return pending === null ? null : this.options.weapons.definition(pending).item;
  }
  handoff(actor: ActorId): PrimaryWeaponHandoff {
    const { weapons, game } = this.options;
    return { provider: this.provider,
      accepts: item => { const definition = this.definitions.find(definition => definition.item === item);
        return definition !== undefined && game.host.inventory.count(actor, item) > 0 && (definition.ammo === null || game.host.inventory.count(actor, definition.ammo) >= definition.quantity); },
      select: item => this.select(actor, item), holster: () => weapons.requestHolster(this.options.observe(actor).owner),
      isHolstered: () => weapons.isHolstered(this.options.observe(actor).owner),
      resume: item => { const observation = this.options.observe(actor);
        const definition = item === null ? null : this.definitions.find(definition => definition.item === item);
        if (definition === undefined) throw new Error("Weapon does not belong to selected Q2 arsenal");
        weapons.resumePrimary(observation.owner, game, observation.input, definition?.name ?? null); } };
  }
  pickupAmmo(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined {
    if (autoSwitch && grants.some(grant => grant.item === "q2:ammo_grenades" && grant.before === 0)) this.pickupWeapons(actor, ["q2:ammo_grenades"], "better");
  }
  pickupWeapons(actor: OwnedActor, items: readonly ItemId[], selection: PickupSelection): undefined {
    if (selection === "never") return;
    for (const item of items) {
      const current = this.pendingWeapon(actor.id) ?? this.read(actor.id).activeWeapon;
      if (selection === "always" || this.pickupOrder.indexOf(item) > (current === null ? -1 : this.pickupOrder.indexOf(current))) this.select(actor.id, item);
    }
  }
  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult {
    if (intent !== undefined && intent.provider !== this.provider) throw new Error("Arsenal intent belongs to another provider");
    if (intent?.weapon != null) {
      if (!this.definitions.some(definition => definition.item === intent.weapon)) throw new Error("Weapon does not belong to selected Q2 arsenal");
      this.select(input.actor.id, intent.weapon);
    }
    const before = this.read(input.actor.id), observed = this.options.observe(input.actor.id);
    const turn = this.requireTurn(input.actor.id);
    latchQ2WeaponButtons(turn, (input.command.buttons & ~1) | (observed.input.attack ? 1 : 0));
    if (!observed.input.spectator) earlyQ2WeaponTurn(turn, latchedAttack => this.options.weapons.tick(observed.owner, this.options.game, { ...observed.input, latchedAttack, weaponThunk: turn.weaponThunk }));
    if (turn.firing?.weapon !== this.options.weapons.states.get(input.actor.id)?.weapon) turn.firing = null;
    return { arsenal: this.options.game.host.actors.isLive(input.actor.id) ? this.read(input.actor.id) : before, animation: input.animation, effects: [] };
  }
  frame(actor: ActorId): undefined {
    const turn = this.requireTurn(actor), observed = this.options.observe(actor), game = this.options.game, weapons = this.options.weapons;
    const state = this.require(actor), elapsed = game.host.frameSeconds();
    if (turn.firing?.weapon !== state.weapon) turn.firing = null;
    if (game.options.edition === "classic" && !observed.input.spectator && state.phase === "firing" && state.weapon !== null && (game.host.combat.read(actor)?.health ?? 0) > 0) {
      const interval = weapons.firingInterval(actor, elapsed);
      if (interval !== elapsed) {
        turn.firing ??= { weapon: state.weapon, credit: 0 };
        turn.firing.credit += elapsed / interval - 1;
      }
    }
    beginQ2WeaponTurn(turn, !observed.input.spectator, latchedAttack => weapons.tick(observed.owner, game, { ...observed.input, latchedAttack, weaponThunk: turn.weaponThunk }));
    const firing = turn.firing;
    while (firing !== null && firing.credit >= 1 && game.host.actors.isLive(actor) && this.turns.get(actor) === turn && weapons.states.get(actor) === state
      && state.weapon === firing.weapon && state.phase === "firing" && (game.host.combat.read(actor)?.health ?? 0) > 0) {
      firing.credit -= 1;
      const current = this.options.observe(actor);
      if (current.input.spectator) break;
      weapons.tick(current.owner, game, { ...current.input, latchedAttack: false, weaponThunk: false });
    }
    if (firing !== null) {
      if (state.weapon !== firing.weapon || weapons.states.get(actor) !== state) turn.firing = null;
      else firing.credit %= 1;
    }
    if ((game.host.combat.read(actor)?.health ?? 0) > 0) turn.latchedButtons = 0;
  }
  captureTurn(actor: ActorId): Q2SelectedWeaponTurnState {
    const turn = this.requireTurn(actor), firing = turn.firing?.weapon === this.require(actor).weapon ? turn.firing : null;
    return { ...turn, firing: firing === null ? null : { ...firing } };
  }
  restoreTurn(actor: ActorId, turn: Q2SelectedWeaponTurnState): undefined {
    const state = this.require(actor), firing = turn.firing;
    if (firing !== null && (firing.weapon !== state.weapon || !Number.isFinite(firing.credit) || firing.credit < 0 || firing.credit >= 1)) throw new RangeError("Invalid saved Q2 firing credit");
    this.turns.set(actor, { ...turn, firing: firing === null ? null : { ...firing } });
  }
  private requireTurn(actor: ActorId): Q2SelectedWeaponTurnState {
    const turn = this.turns.get(actor);
    if (turn === undefined) throw new Error("Selected Q2 arsenal has no command continuation");
    return turn;
  }
  remove(actor: ActorId): undefined {
    const state = this.options.weapons.states.get(actor);
    if (state !== undefined && this.options.game.host.actors.isLive(actor)) this.options.weapons.setLoop(this.options.observe(actor).owner, this.options.game, state, "");
    this.options.weapons.states.delete(actor); this.options.weapons.inputs.delete(actor); this.turns.delete(actor);
  }
  ui(actor: ActorId, source: ProviderReference): Pick<PlayerUi, "activeWeapon" | "ammo" | "items" | "weaponStatus" | "arsenalWarning"> {
    const state = this.require(actor), inventory = this.options.game.host.inventory;
    const active = state.weapon === null ? null : this.options.weapons.definition(state.weapon);
    return { weaponStatus: q2WeaponStatus(active, item => inventory.count(actor, item), source), arsenalWarning: "none", activeWeapon: active?.item ?? null, ammo: active?.ammo == null ? null : { item: active.ammo, count: inventory.count(actor, active.ammo) },
      items: this.definitions.map((definition, index) => ({ id: definition.item, label: q2BaseWeaponDisplayName(definition.item) ?? q2MissionWeaponDisplayName(definition.name) ?? definition.name, kind: "weapon", sourceOrdinal: index + 1,
        owned: inventory.count(actor, definition.item) > 0, hasAmmo: definition.ammo === null || inventory.count(actor, definition.ammo) >= definition.quantity,
        count: definition.ammo === null ? null : inventory.count(actor, definition.ammo), warningCount: definition.warning })) };
  }
  view(actor: ActorId): { readonly path: string; readonly frame: number } | null {
    const state = this.require(actor);
    return state.weapon === null || state.primaryHandoff === "holstered" ? null : { path: state.viewModel ?? this.options.weapons.definition(state.weapon).viewModel, frame: state.frame };
  }
  private require(actor: ActorId): Q2WeaponState {
    const state = this.options.weapons.states.get(actor);
    if (state === undefined) throw new Error("Actor has no selected Q2 arsenal");
    return state;
  }
}
