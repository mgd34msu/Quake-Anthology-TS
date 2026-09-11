/* Independent adapter for the source PM_Weapon stage and ClientSpawn loadout.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { InventoryEntry, ItemId } from "../../../contracts/gameplay.ts";
import type { ProviderId } from "../../../contracts/identity.ts";
import type { AnimationState, ArsenalState, MovementEffect, WeaponStepInput, WeaponStepResult } from "../../../contracts/movement.ts";
import { CommandButtons, MoveFlags, PlayerAnimation, Weapon, WeaponState } from "../../../movement/q3/constants.ts";
import { runQ3WeaponStep } from "../../../movement/q3/weapon.ts";
import type { Q3SourceWeaponState } from "../../../movement/q3/weapon.ts";
import { runQ3TorsoOperation } from "../../../movement/q3/animation.ts";

export interface Q3WeaponItem {
  readonly weapon: Weapon;
  readonly item: ItemId;
  readonly ammo: ItemId | null;
}

export const Q3_WEAPON_ITEMS: readonly Q3WeaponItem[] = [
  { weapon: Weapon.WP_GAUNTLET, item: "q3:weapon/gauntlet", ammo: null },
  { weapon: Weapon.WP_MACHINEGUN, item: "q3:weapon/machinegun", ammo: "q3:ammo/machinegun" },
  { weapon: Weapon.WP_SHOTGUN, item: "q3:weapon/shotgun", ammo: "q3:ammo/shotgun" },
  { weapon: Weapon.WP_GRENADE_LAUNCHER, item: "q3:weapon/grenadelauncher", ammo: "q3:ammo/grenadelauncher" },
  { weapon: Weapon.WP_ROCKET_LAUNCHER, item: "q3:weapon/rocketlauncher", ammo: "q3:ammo/rocketlauncher" },
  { weapon: Weapon.WP_LIGHTNING, item: "q3:weapon/lightning", ammo: "q3:ammo/lightning" },
  { weapon: Weapon.WP_RAILGUN, item: "q3:weapon/railgun", ammo: "q3:ammo/railgun" },
  { weapon: Weapon.WP_PLASMAGUN, item: "q3:weapon/plasmagun", ammo: "q3:ammo/plasmagun" },
  { weapon: Weapon.WP_BFG, item: "q3:weapon/bfg", ammo: "q3:ammo/bfg" },
  { weapon: Weapon.WP_GRAPPLING_HOOK, item: "q3:weapon/grapple", ammo: null },
  { weapon: Weapon.WP_NAILGUN, item: "q3:weapon/nailgun", ammo: "q3:ammo/nailgun" },
  { weapon: Weapon.WP_PROX_LAUNCHER, item: "q3:weapon/proxlauncher", ammo: "q3:ammo/proxlauncher" },
  { weapon: Weapon.WP_CHAINGUN, item: "q3:weapon/chaingun", ammo: "q3:ammo/chaingun" },
];

export function q3WeaponItem(weapon: number): Q3WeaponItem | null {
  return Q3_WEAPON_ITEMS.find(entry => entry.weapon === weapon) ?? null;
}

export interface Q3ArsenalControls {
  readonly attack: boolean;
  readonly useHoldable: boolean;
  readonly requestedWeapon: number;
}

export interface Q3ArsenalRuntimeState {
  readonly product: "baseq3" | "missionpack";
  readonly maxHealth: number;
  readonly spectator: boolean;
  readonly persistentPowerupTag: number;
  readonly holdableItem: number;
  readonly holdableTag: number;
  readonly respawned: boolean;
  readonly useItemHeld: boolean;
  readonly eventSequence: number;
  readonly fractionalMilliseconds: number;
}

export interface Q3ArsenalStep extends WeaponStepResult {
  readonly runtime: Q3ArsenalRuntimeState;
  readonly torsoAnimations: readonly number[];
}

/** The selected input adapter supplies Q3 actions; foreign button words are never reinterpreted. */
export function stepQ3Arsenal(input: WeaponStepInput, runtime: Q3ArsenalRuntimeState, controls: Q3ArsenalControls): Q3ArsenalStep {
  if (input.arsenal.state.kind !== "q3") throw new TypeError("Q3 arsenal adapter requires Q3 weapon state");
  const elapsed = input.frame.elapsed.kind === "milliseconds" ? input.frame.elapsed.value : input.frame.elapsed.value * 1000;
  const clock = elapsed + runtime.fractionalMilliseconds;
  const msec = Math.trunc(clock);
  if (!Number.isFinite(clock) || msec < 0) throw new RangeError("Q3 weapon step clock must be finite and nonnegative");
  const entries = new Map(input.arsenal.ammo.map(entry => [entry.item, entry]));
  let ownedWeapons = 0;
  for (const weapon of Q3_WEAPON_ITEMS) if ((entries.get(weapon.item)?.count ?? 0) > 0) ownedWeapons |= 1 << weapon.weapon;
  const effects: MovementEffect[] = [];
  const torsoAnimations: number[] = [];
  let animation = input.animation;
  let eventSequence = runtime.eventSequence;
  let currentWeapon = input.arsenal.state.sourceWeapon;
  let currentState = input.arsenal.state.state;
  let currentTime = input.arsenal.state.timeMilliseconds;
  const weaponSnapshot = (): Extract<ArsenalState["state"], { readonly kind: "q3" }> => ({
    kind: "q3", sourceWeapon: currentWeapon, state: currentState, timeMilliseconds: currentTime,
  });
  const changed = (before: Extract<ArsenalState["state"], { readonly kind: "q3" }>): void => {
    const after = weaponSnapshot();
    if (before.sourceWeapon !== after.sourceWeapon || before.state !== after.state || before.timeMilliseconds !== after.timeMilliseconds) {
      effects.push({ kind: "weapon", provider: input.arsenal.provider, before, after });
    }
  };
  const state: Q3SourceWeaponState = {
    product: runtime.product, pmFlags: (runtime.respawned ? MoveFlags.RESPAWNED : 0) | (runtime.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0),
    get weapon() { return currentWeapon; },
    set weapon(value) {
      const before = weaponSnapshot(); currentWeapon = value; changed(before);
      if (before.sourceWeapon !== value) effects.push({ kind: "weapon-selection", provider: input.arsenal.provider,
        before: q3WeaponItem(before.sourceWeapon)?.item ?? null, after: q3WeaponItem(value)?.item ?? null });
    },
    get weaponState() { return currentState; },
    set weaponState(value) { const before = weaponSnapshot(); currentState = value; changed(before); },
    get weaponTime() { return currentTime; },
    set weaponTime(value) { const before = weaponSnapshot(); currentTime = value; changed(before); },
    ownedWeapons, health: input.environment.health, maxHealth: runtime.maxHealth, spectator: runtime.spectator,
    haste: input.environment.haste, persistentPowerupTag: runtime.persistentPowerupTag,
    holdableItem: runtime.holdableItem, holdableTag: runtime.holdableTag,
    ammo: {
      get(weapon) {
        const item = q3WeaponItem(weapon);
        if (item === null) return 0;
        return item.ammo === null ? -1 : entries.get(item.ammo)?.count ?? 0;
      },
      set(weapon, count) {
        const item = q3WeaponItem(weapon);
        if (item === null || item.ammo === null) throw new Error(`Q3 weapon has no consumable ammo slot: ${weapon}`);
        const before = entries.get(item.ammo);
        if (before === undefined) throw new Error(`Missing Q3 ammo inventory entry: ${item.ammo}`);
        entries.set(item.ammo, { ...before, count });
        effects.push({ kind: "ammo", item: item.ammo, before: before.count, after: count });
      },
    },
  };
  // PMF_RESPAWNED clears when both source actions are released, even under foreign movement.
  if (input.environment.health > 0 && !controls.attack && !controls.useHoldable) state.pmFlags &= ~MoveFlags.RESPAWNED;
  runQ3WeaponStep(state, { buttons: (controls.attack ? CommandButtons.ATTACK : 0) | (controls.useHoldable ? CommandButtons.USE_HOLDABLE : 0),
    weapon: controls.requestedWeapon }, {
    msec, gauntletHit: input.gauntletHit,
    event(event) { effects.push({ kind: "event", value: { provider: input.arsenal.provider, sequence: eventSequence++, event, parameter: 0 } }); },
    startTorso(torso) {
      torsoAnimations.push(torso);
      // A foreign character consumes these semantic source requests through its own pose adapter.
      if (animation.state.kind !== "q3" || input.environment.health <= 0) return;
      const result = runQ3TorsoOperation(torso, { animation, dead: false, elapsedMilliseconds: msec,
        buttons: 0, product: runtime.product, eventSequence });
      effects.push(...result.effects);
      animation = result.animation;
    },
  });
  const weapon = weaponSnapshot();
  const activeWeapon = q3WeaponItem(state.weapon)?.item ?? null;
  return { arsenal: { ...input.arsenal, activeWeapon, state: weapon, ammo: [...entries.values()] }, animation, effects, torsoAnimations,
    runtime: { ...runtime, holdableItem: state.holdableItem, holdableTag: state.holdableTag,
      respawned: (state.pmFlags & MoveFlags.RESPAWNED) !== 0, useItemHeld: (state.pmFlags & MoveFlags.USE_ITEM_HELD) !== 0,
      fractionalMilliseconds: clock - msec, eventSequence } };
}

export function q3SpawnArsenalRuntime(product: "baseq3" | "missionpack", maxHealth: number, eventSequence = 0): Q3ArsenalRuntimeState {
  return { product, maxHealth, spectator: false, persistentPowerupTag: 0, holdableItem: 0, holdableTag: 0,
    respawned: true, useItemHeld: false, eventSequence, fractionalMilliseconds: 0 };
}

export function q3SpawnLoadout(provider: ProviderId, product: "baseq3" | "missionpack", teamDeathmatch: boolean): ArsenalState {
  const ammo: InventoryEntry[] = [];
  for (const weapon of Q3_WEAPON_ITEMS) {
    if (product === "baseq3" && weapon.weapon >= Weapon.WP_NAILGUN) continue;
    ammo.push({ item: weapon.item, count: weapon.weapon === Weapon.WP_GAUNTLET || weapon.weapon === Weapon.WP_MACHINEGUN ? 1 : 0, capacity: 1 });
    if (weapon.ammo !== null) ammo.push({ item: weapon.ammo, count: weapon.weapon === Weapon.WP_MACHINEGUN ? teamDeathmatch ? 50 : 100 : 0, capacity: 200 });
  }
  return { provider, activeWeapon: "q3:weapon/machinegun", state: { kind: "q3", sourceWeapon: Weapon.WP_MACHINEGUN,
    state: WeaponState.WEAPON_READY, timeMilliseconds: 0 }, ammo };
}

export function q3SpawnAnimation(): Extract<AnimationState, { readonly kind: "q3" }> {
  return { kind: "q3", legs: PlayerAnimation.LEGS_IDLE, torso: PlayerAnimation.TORSO_STAND, legsTimerMilliseconds: 0, torsoTimerMilliseconds: 0 };
}
