// PM_Weapon from id Software bg_pmove.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { EntityEvent, Holdable, Powerup, Weapon, WeaponState, CommandButtons as B, MoveFlags as F, PlayerAnimation as A } from "./constants.ts";
import type { Q3Command } from "./types.ts";

export interface Q3SourceWeaponState {
  readonly product: "baseq3" | "missionpack";
  pmFlags: number; weapon: number; weaponState: number; weaponTime: number;
  readonly ownedWeapons: number; readonly health: number; readonly maxHealth: number;
  readonly spectator: boolean; readonly haste: boolean; readonly persistentPowerupTag: number;
  holdableItem: number; holdableTag: number;
  readonly ammo: { get(weapon: number): number; set(weapon: number, count: number): void };
}

export interface Q3SourceWeaponOptions {
  readonly msec: number; readonly gauntletHit: boolean;
  event(event: number): void;
  startTorso(animation: number): void;
}

class WeaponStep {
  constructor(readonly state: Q3SourceWeaponState, readonly cmd: Pick<Q3Command, "buttons" | "weapon">, readonly options: Q3SourceWeaponOptions) {}
  get msec(): number { return this.options.msec; }
  event(event: number): void { this.options.event(event); }
  startTorso(animation: number): void { this.options.startTorso(animation); }
  private beginWeaponChange(weapon: number): void {
    const ps = this.state;
    if (weapon <= Weapon.WP_NONE || weapon >= (ps.product === "missionpack" ? 14 : 11) ||
      !(ps.ownedWeapons & (1 << weapon)) || ps.weaponState === WeaponState.WEAPON_DROPPING) return;
    this.event(EntityEvent.EV_CHANGE_WEAPON);
    ps.weaponState = WeaponState.WEAPON_DROPPING;
    ps.weaponTime += 200;
    this.startTorso(A.TORSO_DROP);
  }
  private finishWeaponChange(): void {
    const ps = this.state;
    const requestedWeapon = this.cmd.weapon;
    let weapon: Weapon;
    switch (requestedWeapon) {
      case Weapon.WP_NONE: case Weapon.WP_GAUNTLET: case Weapon.WP_MACHINEGUN: case Weapon.WP_SHOTGUN:
      case Weapon.WP_GRENADE_LAUNCHER: case Weapon.WP_ROCKET_LAUNCHER: case Weapon.WP_LIGHTNING:
      case Weapon.WP_RAILGUN: case Weapon.WP_PLASMAGUN: case Weapon.WP_BFG: case Weapon.WP_GRAPPLING_HOOK:
      case Weapon.WP_NAILGUN: case Weapon.WP_PROX_LAUNCHER: case Weapon.WP_CHAINGUN: weapon = requestedWeapon; break;
      default: weapon = Weapon.WP_NONE; break;
    }
    if (weapon >= (ps.product === "missionpack" ? 14 : 11)) weapon = Weapon.WP_NONE;
    if (!(ps.ownedWeapons & (1 << weapon))) weapon = Weapon.WP_NONE;
    ps.weapon = weapon;
    ps.weaponState = WeaponState.WEAPON_RAISING;
    ps.weaponTime += 250;
    this.startTorso(A.TORSO_RAISE);
  }
  run(): void {
    const ps = this.state;
    if (ps.pmFlags & F.RESPAWNED || ps.spectator) return;
    if (ps.health <= 0) { ps.weapon = Weapon.WP_NONE; return; }
    if (this.cmd.buttons & B.USE_HOLDABLE) {
      if (!(ps.pmFlags & F.USE_ITEM_HELD)) {
        const tag = ps.holdableTag;
        if (tag !== Holdable.HI_MEDKIT || ps.health < ps.maxHealth + 25) {
          ps.pmFlags |= F.USE_ITEM_HELD;
          this.event(EntityEvent.EV_USE_ITEM0 + tag);
          ps.holdableItem = 0; ps.holdableTag = 0;
        }
        return;
      }
    } else ps.pmFlags &= ~F.USE_ITEM_HELD;
    if (ps.weaponTime > 0) ps.weaponTime -= this.msec;
    if (ps.weaponTime <= 0 || ps.weaponState !== WeaponState.WEAPON_FIRING) {
      if (ps.weapon !== this.cmd.weapon) this.beginWeaponChange(this.cmd.weapon);
    }
    if (ps.weaponTime > 0) return;
    if (ps.weaponState === WeaponState.WEAPON_DROPPING) { this.finishWeaponChange(); return; }
    if (ps.weaponState === WeaponState.WEAPON_RAISING) {
      ps.weaponState = WeaponState.WEAPON_READY;
      this.startTorso(ps.weapon === Weapon.WP_GAUNTLET ? A.TORSO_STAND2 : A.TORSO_STAND);
      return;
    }
    if (!(this.cmd.buttons & B.ATTACK) || (ps.weapon === Weapon.WP_GAUNTLET && !this.options.gauntletHit)) {
      ps.weaponTime = 0;
      ps.weaponState = WeaponState.WEAPON_READY;
      return;
    }
    this.startTorso(ps.weapon === Weapon.WP_GAUNTLET ? A.TORSO_ATTACK2 : A.TORSO_ATTACK);
    ps.weaponState = WeaponState.WEAPON_FIRING;
    const ammo = ps.ammo.get(ps.weapon);
    if (ammo === 0) { this.event(EntityEvent.EV_NOAMMO); ps.weaponTime += 500; return; }
    if (ammo !== -1) ps.ammo.set(ps.weapon, ammo - 1);
    this.event(EntityEvent.EV_FIRE_WEAPON);
    let addTime: number;
    switch (ps.weapon) {
      case Weapon.WP_LIGHTNING: addTime = 50; break;
      case Weapon.WP_SHOTGUN: addTime = 1000; break;
      case Weapon.WP_MACHINEGUN: case Weapon.WP_PLASMAGUN: addTime = 100; break;
      case Weapon.WP_GRENADE_LAUNCHER: case Weapon.WP_ROCKET_LAUNCHER: addTime = 800; break;
      case Weapon.WP_RAILGUN: addTime = 1500; break;
      case Weapon.WP_BFG: addTime = 200; break;
      case Weapon.WP_NAILGUN: addTime = ps.product === "missionpack" ? 1000 : 400; break;
      case Weapon.WP_PROX_LAUNCHER: addTime = ps.product === "missionpack" ? 800 : 400; break;
      case Weapon.WP_CHAINGUN: addTime = ps.product === "missionpack" ? 30 : 400; break;
      default: addTime = 400; break;
    }
    const persistent = ps.product === "missionpack" ? ps.persistentPowerupTag : 0;
    if (persistent === Powerup.PW_SCOUT) addTime = Math.trunc(addTime / 1.5);
    else if (persistent === Powerup.PW_AMMOREGEN || ps.haste) addTime = Math.trunc(addTime / 1.3);
    ps.weaponTime += addTime;
  }
}

/** Called only by the selected Q3 arsenal adapter at its movement weapon stage. */
export function runQ3WeaponStep(state: Q3SourceWeaponState, command: Pick<Q3Command, "buttons" | "weapon">, options: Q3SourceWeaponOptions): void {
  new WeaponStep(state, command, options).run();
}
