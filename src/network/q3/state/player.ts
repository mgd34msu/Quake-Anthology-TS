// Source playerState_t wire storage. id Software, GPL-2.0-or-later.
import { vec3 } from "../../../core/math.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Product } from "./product.ts";
export const ENTITYNUM_NONE = 1023;
export class PlayerStateSlots {
  private readonly values: Int32Array;

  constructor(readonly length: number, sourceValues: Int32Array | null = null) {
    if (sourceValues !== null && sourceValues.length !== length) {
      throw new RangeError(`Player state source slots require ${length} values, got ${sourceValues.length}`);
    }
    this.values = sourceValues ?? new Int32Array(length);
  }

  get(index: number): number {
    const value = this.values[index];
    if (value === undefined) throw new RangeError(`Player state slot ${index} outside ${this.length}`);
    return value;
  }

  set(index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`Player state slot ${index} outside ${this.length}`);
    }
    this.values[index] = value;
  }

  copy(): Int32Array { return this.values.slice(); }
}

export type PlayerStateFields<M extends number = number, W extends number = number, S extends number = number> =
  Omit<PlayerStateRecord<M, W, S>, "copy" | "copyFrom">;

function copyVector(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function copySlots(target: PlayerStateSlots, source: PlayerStateSlots): void {
  for (let index = 0; index < target.length; index++) target.set(index, source.get(index));
}

/** Owned playerState_t storage; the engine transports game-defined integer words unchanged. */
export class PlayerStateRecord<M extends number, W extends number, S extends number> {
  commandTime = 0;
  pmType: M;
  bobCycle = 0;
  pmFlags = 0;
  pmTime = 0;
  origin = vec3(0, 0, 0);
  velocity = vec3(0, 0, 0);
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
  readonly stats = new PlayerStateSlots(16);
  readonly persistant = new PlayerStateSlots(16);
  readonly powerups = new PlayerStateSlots(16);
  readonly ammo = new PlayerStateSlots(16);
  generic1 = 0;
  loopSound = 0;
  jumppadEnt = 0;
  ping = 0;
  pmoveFramecount = 0;
  jumppadFrame = 0;
  entityEventSequence = 0;

  constructor(private stateProduct: Product, pmType: M, weapon: W, weaponState: S) {
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

  copyFrom(source: Readonly<PlayerStateFields<M, W, S>>): void {
    this.stateProduct = source.product;
    this.commandTime = source.commandTime;
    this.pmType = source.pmType;
    this.bobCycle = source.bobCycle;
    this.pmFlags = source.pmFlags;
    this.pmTime = source.pmTime;
    this.origin = copyVector(source.origin);
    this.velocity = copyVector(source.velocity);
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
    copySlots(this.stats, source.stats);
    copySlots(this.persistant, source.persistant);
    copySlots(this.powerups, source.powerups);
    copySlots(this.ammo, source.ammo);
    this.generic1 = source.generic1;
    this.loopSound = source.loopSound;
    this.jumppadEnt = source.jumppadEnt;
    this.ping = source.ping;
    this.pmoveFramecount = source.pmoveFramecount;
    this.jumppadFrame = source.jumppadFrame;
    this.entityEventSequence = source.entityEventSequence;
  }

}
export type SourcePlayerState = PlayerStateRecord<number, number, number>;
