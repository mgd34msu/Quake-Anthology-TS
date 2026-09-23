export { MoveFlags, CommandButtons, PlayerAnimation } from "../../../../movement/q3/constants.ts";
// Ported from id Software's code/game/q_shared.h, bg_public.h and bg_misc.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

import { vec3 } from "../../../../core/math.ts";
import type { Vec3 } from "../../../../core/math.ts";
import { nativeAtof } from "../../../../core/numeric.ts";
import { MoveType, Weapon, WeaponState, statSchema } from "./definitions.ts";
import type { Product } from "./definitions.ts";

export const ENTITYNUM_WORLD = 1022;
export const ENTITYNUM_NONE = 1023;




export interface UserCommand {
  serverTime: number;
  angles: Vec3;
  buttons: number;
  weapon: number;
  forwardmove: number;
  rightmove: number;
  upmove: number;
}

/** Fixed source arrays with checked access, including unused protocol slots. */
export interface PlayerSlotBinding { read(index: number): number; write(index: number, value: number): void; }
export class PlayerStateSlots {
  private readonly values: Int32Array;

  constructor(readonly length: number, sourceValues: Int32Array | null = null, private readonly binding: PlayerSlotBinding | null = null, private readonly stored?: (index: number, value: number) => void) {
    if (sourceValues !== null && sourceValues.length !== length) {
      throw new RangeError(`Player state source slots require ${length} values, got ${sourceValues.length}`);
    }
    this.values = sourceValues ?? new Int32Array(length);
  }

  get(index: number): number {
    const value = this.binding === null ? this.values[index] : this.binding.read(index);
    if (value === undefined) throw new RangeError(`Player state slot ${index} outside ${this.length}`);
    return value;
  }

  set(index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`Player state slot ${index} outside ${this.length}`);
    }
    if (this.binding === null) this.values[index] = value; else this.binding.write(index, value | 0);
    this.stored?.(index, this.get(index));
  }

  copy(): Int32Array { return Int32Array.from({ length: this.length }, (_, index) => this.get(index)); }
}

export interface PredictableEvent {
  readonly sequence: number;
  readonly event: number;
  readonly parameter: number;
}

export interface PredictableEventDebug {
  readonly kind: "source-debug";
  readonly module: "game" | "cgame";
  showEvents(): string;
  print(message: string): void;
}

// bg_misc.c:eventnames, including its omitted EV_OBELISKPAIN entry.
const EVENT_NAMES: readonly string[] = [
  "EV_NONE", "EV_FOOTSTEP", "EV_FOOTSTEP_METAL", "EV_FOOTSPLASH", "EV_FOOTWADE", "EV_SWIM",
  "EV_STEP_4", "EV_STEP_8", "EV_STEP_12", "EV_STEP_16", "EV_FALL_SHORT", "EV_FALL_MEDIUM", "EV_FALL_FAR",
  "EV_JUMP_PAD", "EV_JUMP", "EV_WATER_TOUCH", "EV_WATER_LEAVE", "EV_WATER_UNDER", "EV_WATER_CLEAR",
  "EV_ITEM_PICKUP", "EV_GLOBAL_ITEM_PICKUP", "EV_NOAMMO", "EV_CHANGE_WEAPON", "EV_FIRE_WEAPON",
  "EV_USE_ITEM0", "EV_USE_ITEM1", "EV_USE_ITEM2", "EV_USE_ITEM3", "EV_USE_ITEM4", "EV_USE_ITEM5",
  "EV_USE_ITEM6", "EV_USE_ITEM7", "EV_USE_ITEM8", "EV_USE_ITEM9", "EV_USE_ITEM10", "EV_USE_ITEM11",
  "EV_USE_ITEM12", "EV_USE_ITEM13", "EV_USE_ITEM14", "EV_USE_ITEM15", "EV_ITEM_RESPAWN", "EV_ITEM_POP",
  "EV_PLAYER_TELEPORT_IN", "EV_PLAYER_TELEPORT_OUT", "EV_GRENADE_BOUNCE", "EV_GENERAL_SOUND",
  "EV_GLOBAL_SOUND", "EV_GLOBAL_TEAM_SOUND", "EV_BULLET_HIT_FLESH", "EV_BULLET_HIT_WALL", "EV_MISSILE_HIT",
  "EV_MISSILE_MISS", "EV_MISSILE_MISS_METAL", "EV_RAILTRAIL", "EV_SHOTGUN", "EV_BULLET", "EV_PAIN",
  "EV_DEATH1", "EV_DEATH2", "EV_DEATH3", "EV_OBITUARY", "EV_POWERUP_QUAD", "EV_POWERUP_BATTLESUIT",
  "EV_POWERUP_REGEN", "EV_GIB_PLAYER", "EV_SCOREPLUM", "EV_PROXIMITY_MINE_STICK", "EV_PROXIMITY_MINE_TRIGGER",
  "EV_KAMIKAZE", "EV_OBELISKEXPLODE", "EV_INVUL_IMPACT", "EV_JUICED", "EV_LIGHTNINGBOLT", "EV_DEBUG_LINE",
  "EV_STOPLOOPINGSOUND", "EV_TAUNT",
];

export type PlayerStateFields<M extends number = number, W extends number = number, S extends number = number> =
  Omit<PlayerStateRecord<M, W, S>, "copy" | "copyFrom" | "health" | "addEvent" | "setEventDebug">;

function copyVector(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function copySlots(target: PlayerStateSlots, source: PlayerStateSlots): void {
  for (let index = 0; index < target.length; index++) target.set(index, source.get(index));
}

/** Owned playerState_t storage; the engine transports game-defined integer words unchanged. */
export interface PlayerAuthorityBinding {
  origin(): Vec3; setOrigin(value: Vec3): void;
  velocity(): Vec3; setVelocity(value: Vec3): void;
  readonly stats: PlayerSlotBinding;
  readonly ammo: PlayerSlotBinding;
}
export class PlayerStateRecord<M extends number, W extends number, S extends number> {
  #eventDebug: PredictableEventDebug | null = null;
  commandTime = 0;
  pmType: M;
  bobCycle = 0;
  pmFlags = 0;
  pmTime = 0;
  private originValue = vec3(0, 0, 0);
  private velocityValue = vec3(0, 0, 0);
  get origin(): Vec3 { return this.authority?.origin() ?? this.originValue; }
  set origin(value: Vec3) { if (this.authority === null) this.originValue = value; else this.authority.setOrigin(value); }
  get velocity(): Vec3 { return this.authority?.velocity() ?? this.velocityValue; }
  set velocity(value: Vec3) { if (this.authority === null) this.velocityValue = value; else this.authority.setVelocity(value); }
  weaponTime = 0;
  gravity = 0;
  speed = 0;
  deltaAngles = vec3(0, 0, 0);
  groundEntityNum = 0;
  legsTimer = 0;
  legsAnim = 0;
  torsoTimer = 0;
  torsoAnim = 0;
  movementDir = 0;
  grapplePoint = vec3(0, 0, 0);
  eFlags = 0;
  eventSequence = 0;
  readonly events = new PlayerStateSlots(2);
  readonly eventParms = new PlayerStateSlots(2);
  externalEvent = 0;
  externalEventParm = 0;
  externalEventTime = 0;
  clientNum = 0;
  weapon: W;
  weaponState: S;
  viewangles = vec3(0, 0, 0);
  viewheight = 0;
  damageEvent = 0;
  damageYaw = 0;
  damagePitch = 0;
  damageCount = 0;
  readonly stats: PlayerStateSlots;
  readonly persistant = new PlayerStateSlots(16);
  readonly powerups = new PlayerStateSlots(16);
  readonly ammo: PlayerStateSlots;
  generic1 = 0;
  loopSound = 0;
  jumppadEnt = 0;
  ping = 0;
  pmoveFramecount = 0;
  jumppadFrame = 0;
  entityEventSequence = 0;

  constructor(private stateProduct: Product, pmType: M, weapon: W, weaponState: S, private readonly authority: PlayerAuthorityBinding | null = null) {
    this.stats = new PlayerStateSlots(16, null, authority?.stats ?? null);
    this.ammo = new PlayerStateSlots(16, null, authority?.ammo ?? null);
    this.pmType = pmType;
    this.weapon = weapon;
    this.weaponState = weaponState;
  }

  get product(): Product { return this.stateProduct; }

  copy(): PlayerStateRecord<M, W, S> {
    const result = new PlayerStateRecord(this.product, this.pmType, this.weapon, this.weaponState);
    result.copyFrom(this);
    return result;
  }

  copyFrom(source: Readonly<PlayerStateFields<M, W, S>>, stores: "preserve-authority" | "replace-authority" = "preserve-authority"): void {
    const preserve = this.authority !== null && stores === "preserve-authority";
    this.stateProduct = source.product;
    this.commandTime = source.commandTime;
    this.pmType = source.pmType;
    this.bobCycle = source.bobCycle;
    this.pmFlags = source.pmFlags;
    this.pmTime = source.pmTime;
    if (!preserve) {
      this.origin = copyVector(source.origin);
      this.velocity = copyVector(source.velocity);
    }
    this.weaponTime = source.weaponTime;
    this.gravity = source.gravity;
    this.speed = source.speed;
    this.deltaAngles = copyVector(source.deltaAngles);
    this.groundEntityNum = source.groundEntityNum;
    this.legsTimer = source.legsTimer;
    this.legsAnim = source.legsAnim;
    this.torsoTimer = source.torsoTimer;
    this.torsoAnim = source.torsoAnim;
    this.movementDir = source.movementDir;
    this.grapplePoint = copyVector(source.grapplePoint);
    this.eFlags = source.eFlags;
    this.eventSequence = source.eventSequence;
    copySlots(this.events, source.events);
    copySlots(this.eventParms, source.eventParms);
    this.externalEvent = source.externalEvent;
    this.externalEventParm = source.externalEventParm;
    this.externalEventTime = source.externalEventTime;
    this.clientNum = source.clientNum;
    this.weapon = source.weapon;
    this.weaponState = source.weaponState;
    this.viewangles = copyVector(source.viewangles);
    this.viewheight = source.viewheight;
    this.damageEvent = source.damageEvent;
    this.damageYaw = source.damageYaw;
    this.damagePitch = source.damagePitch;
    this.damageCount = source.damageCount;
    const schema = statSchema(this.product);
    for (let index = 0; index < this.stats.length; index++) {
      if (preserve && (index === schema.health || index === schema.armor || index === schema.weapons)) continue;
      this.stats.set(index, source.stats.get(index));
    }
    copySlots(this.persistant, source.persistant);
    copySlots(this.powerups, source.powerups);
    if (!preserve) copySlots(this.ammo, source.ammo);
    this.generic1 = source.generic1;
    this.loopSound = source.loopSound;
    this.jumppadEnt = source.jumppadEnt;
    this.ping = source.ping;
    this.pmoveFramecount = source.pmoveFramecount;
    this.jumppadFrame = source.jumppadFrame;
    this.entityEventSequence = source.entityEventSequence;
  }

  get health(): number { return this.stats.get(statSchema(this.product).health); }
  set health(value: number) { this.stats.set(statSchema(this.product).health, value); }

  setEventDebug(debug: PredictableEventDebug | null): void { this.#eventDebug = debug; }

  addEvent(event: number, parameter = 0): PredictableEvent {
    const debug = this.#eventDebug;
    if (debug !== null && nativeAtof(debug.showEvents().slice(0, 255)) !== 0) {
      const name = EVENT_NAMES[event];
      if (name === undefined) throw new RangeError(`bg_misc.c eventnames has no entry for ${event}`);
      const label = debug.module === "game" ? " game" : "Cgame";
      debug.print(`${label} event svt ${String(this.pmoveFramecount).padStart(5)} -> ${String(this.eventSequence).padStart(5)}: num = ${name.padStart(20)} parm ${parameter}\n`);
    }
    const sequence = this.eventSequence;
    this.events.set(sequence & 1, event);
    this.eventParms.set(sequence & 1, parameter);
    this.eventSequence = (sequence + 1) | 0;
    return { sequence, event, parameter };
  }
}

export type SourcePlayerState = PlayerStateRecord<number, number, number>;

/** Retail creation is source memset-zero; spawning supplies health, speed and gravity. */
export class PlayerState extends PlayerStateRecord<MoveType, Weapon, WeaponState> {
  constructor(product: Product, authority: PlayerAuthorityBinding | null = null) {
    super(product, MoveType.PM_NORMAL, Weapon.WP_NONE, WeaponState.WEAPON_READY, authority);
  }

  override copy(): PlayerState {
    const result = new PlayerState(this.product);
    result.copyFrom(this);
    return result;
  }
}

export function createPlayerState(product: Product, authority: PlayerAuthorityBinding | null = null): PlayerState {
  return new PlayerState(product, authority);
}
