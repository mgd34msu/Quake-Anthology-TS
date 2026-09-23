import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1EntityServices } from "./entity-services.ts";
import type { Q1PlayerState, Q1Weapon } from "./types.ts";

/** Source modules own ammunition mutations, attack timing and weapon effects. */
export interface Q1WeaponDefinition {
  readonly id: Q1Weapon;
  readonly item?: ItemId;
  readonly ammo: ItemId | null;
  readonly ammoPerShot?: number;
  readonly model: string;
  readonly rank: number;
  modelFor?(game: Q1EntityServices, player: Q1PlayerState): string;
  available?(game: Q1EntityServices, player: Q1PlayerState): boolean;
  bestAvailable?(game: Q1EntityServices, player: Q1PlayerState): boolean;
  fire(game: Q1EntityServices, player: Q1PlayerState): boolean;
  animate?(game: Q1EntityServices, player: Q1PlayerState, seconds: number): undefined;
}
export interface Q1PlayerExtension {
  readonly id: string;
  /** New-player admission only. Saved inventories and private state restore through their owners. */
  attach?(game: Q1EntityServices, player: Q1PlayerState): undefined;
  inventoryCapacity?(game: Q1EntityServices, player: Q1PlayerState, item: ItemId): number | undefined;
  /** Source prethink effects run before ordinary environment and timed-effect handling. */
  frame?(game: Q1EntityServices, player: Q1PlayerState, seconds: number): undefined;
  afterPhysics?(game: Q1EntityServices, player: Q1PlayerState, seconds: number): undefined;
  /** Source spawn parameters survive level changes independently of ordinary equipment resets. */
  captureTravel?(game: Q1EntityServices, player: Q1PlayerState): Uint8Array;
  restoreTravel?(game: Q1EntityServices, player: Q1PlayerState, bytes: Uint8Array): undefined;
}

export interface Q1PickupRules {
  readonly id: string;
  weaponLeave?(game: Q1EntityServices): boolean;
  weaponGranted?(game: Q1EntityServices, player: Q1PlayerState, weapon: Q1Weapon): Q1Weapon;
  weaponAmmoGrant?(game: Q1EntityServices, player: Q1PlayerState, weapon: Q1Weapon, defaultAmount: number): number;
  weaponRank?(weapon: Q1Weapon): number;
  autoSwitch?(game: Q1EntityServices, player: Q1PlayerState, wasOwned: boolean): boolean;
  respawn?(game: Q1EntityServices, entity: import("./entity.ts").Q1Actor, defaultSeconds: number): number;
}

export interface Q1WeaponRules {
  readonly id: string;
  consumeAmmo?(game: Q1EntityServices, player: Q1PlayerState, item: ItemId, amount: number): boolean;
  beforeFire?(game: Q1EntityServices, player: Q1PlayerState): undefined;
  frameDelay?(game: Q1EntityServices, player: Q1PlayerState, delay: number): number;
  attackDelay?(game: Q1EntityServices, player: Q1PlayerState, delay: number): number;
  nailSpeed?(game: Q1EntityServices, player: Q1PlayerState, speed: number): number;
}
