// Source AAS settings and reachability construction contract. GPL-2.0-or-later.
import type { Vec3 } from "../../contracts/math.ts";
import { vec3 } from "../../core/math.ts";
import type { AasAsset } from "./aas.ts";

/** The source static aassettings record survives AAS world replacement and shutdown. */
export class AasMovementSettings {
  gravityDirection: Vec3 = vec3(0, 0, 0);
  friction = 0; stopSpeed = 0; gravity = 0; waterFriction = 0; waterGravity = 0;
  maxVelocity = 0; maxWalkVelocity = 0; maxCrouchVelocity = 0; maxSwimVelocity = 0;
  walkAccelerate = 0; airAccelerate = 0; swimAccelerate = 0;
  maxStep = 0; maxSteepness = 0; maxWaterJump = 0; maxBarrier = 0;
  jumpVelocity = 0; fallDelta5 = 0; fallDelta10 = 0;
  waterJumpTime = 0; teleportTime = 0; barrierJumpTime = 0; startCrouchTime = 0;
  startGrappleTime = 0; startWalkOffLedgeTime = 0; startJumpTime = 0;
  rocketJumpTime = 0; bfgJumpTime = 0; jumpPadTime = 0; airControlledJumpPadTime = 0;
  funcBobTime = 0; startElevatorTime = 0; fallDamage5Time = 0; fallDamage10Time = 0;
  maxFallHeight = 0; maxJumpFallHeight = 0;
}
export type AasLibVarValue = (name: string, defaultValue: string) => number;
/** AAS_InitSettings reads LibVarValue once, in source order; later cvar writes need another init. */
export function initAasMovementSettings(value: AasLibVarValue, settings: AasMovementSettings = new AasMovementSettings()): AasMovementSettings {
  const read = (name: string, initial: string) => Math.fround(value(name, initial));
  settings.gravityDirection = vec3(0, 0, -1);
  settings.friction = read("phys_friction", "6"); settings.stopSpeed = read("phys_stopspeed", "100"); settings.gravity = read("phys_gravity", "800");
  settings.waterFriction = read("phys_waterfriction", "1"); settings.waterGravity = read("phys_watergravity", "400");
  settings.maxVelocity = read("phys_maxvelocity", "320"); settings.maxWalkVelocity = read("phys_maxwalkvelocity", "320");
  settings.maxCrouchVelocity = read("phys_maxcrouchvelocity", "100"); settings.maxSwimVelocity = read("phys_maxswimvelocity", "150");
  settings.walkAccelerate = read("phys_walkaccelerate", "10"); settings.airAccelerate = read("phys_airaccelerate", "1"); settings.swimAccelerate = read("phys_swimaccelerate", "4");
  settings.maxStep = read("phys_maxstep", "19"); settings.maxSteepness = read("phys_maxsteepness", "0.7"); settings.maxWaterJump = read("phys_maxwaterjump", "18");
  settings.maxBarrier = read("phys_maxbarrier", "33"); settings.jumpVelocity = read("phys_jumpvel", "270");
  settings.fallDelta5 = read("phys_falldelta5", "40"); settings.fallDelta10 = read("phys_falldelta10", "60");
  settings.waterJumpTime = read("rs_waterjump", "400"); settings.teleportTime = read("rs_teleport", "50"); settings.barrierJumpTime = read("rs_barrierjump", "100");
  settings.startCrouchTime = read("rs_startcrouch", "300"); settings.startGrappleTime = read("rs_startgrapple", "500");
  settings.startWalkOffLedgeTime = read("rs_startwalkoffledge", "70"); settings.startJumpTime = read("rs_startjump", "300");
  settings.rocketJumpTime = read("rs_rocketjump", "500"); settings.bfgJumpTime = read("rs_bfgjump", "500"); settings.jumpPadTime = read("rs_jumppad", "250");
  settings.airControlledJumpPadTime = read("rs_aircontrolledjumppad", "300"); settings.funcBobTime = read("rs_funcbob", "300");
  settings.startElevatorTime = read("rs_startelevator", "50"); settings.fallDamage5Time = read("rs_falldamage5", "300");
  settings.fallDamage10Time = read("rs_falldamage10", "500"); settings.maxFallHeight = read("rs_maxfallheight", "0"); settings.maxJumpFallHeight = read("rs_maxjumpfallheight", "450");
  return settings;
}
/** Source initial values for controlled fixtures; production calls init with the actual LibVar owner. */
export const DEFAULT_AAS_MOVEMENT_SETTINGS: Readonly<AasMovementSettings> = Object.freeze({ ...initAasMovementSettings((_name, initial) => Number(initial)) });
export enum AasStopEvent {
  NONE = 0, HIT_GROUND = 1, LEAVE_GROUND = 2, ENTER_WATER = 4, ENTER_SLIME = 8, ENTER_LAVA = 16,
  HIT_GROUND_DAMAGE = 32, GAP = 64, TOUCH_JUMP_PAD = 128, TOUCH_TELEPORTER = 256,
  ENTER_AREA = 512, HIT_GROUND_AREA = 1024, HIT_BOUNDING_BOX = 2048, TOUCH_CLUSTER_PORTAL = 4096,
}

export type AasFace = AasAsset["faces"][number];
export type AasPlane = AasAsset["planes"][number];
export type AasWorld = AasAsset;
export type AasAreaSettings = { -readonly [K in keyof AasAsset["settings"][number]]: AasAsset["settings"][number][K] };
export interface AasReachabilityWorld extends AasAsset {
  readonly settings: AasAreaSettings[];
  pointArea(point: Vec3): number;
  setting(area: number): AasAreaSettings;
}
export interface AasClientMove { readonly end: Vec3; readonly velocity: Vec3; readonly endArea: number; readonly frames: number; readonly stopEvent: number; readonly time: number; }
