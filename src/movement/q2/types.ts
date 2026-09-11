/* Quake II q_shared.h and rerelease game.h, id Software / ZeniMax.
 * GPL-2.0-or-later. Movement-local representations of source ABI fields. */
import type { Bounds } from "../../contracts/math.ts";
import type { TraceHit, TraceResult } from "../../contracts/scene.ts";

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export const axes: readonly (0 | 1 | 2)[] = [0, 1, 2];
export type MovementEntity = Exclude<TraceHit, { readonly kind: "none" }>;
export interface CplaneT { normal: Vec3; dist: number; type: number; signbits: number; }
export interface CsurfaceT { name: string; flags: number; value: number; material: string; }
export type KexCsurfaceT = CsurfaceT;
export interface TraceT {
  allsolid: boolean; startsolid: boolean; fraction: number; endpos: Vec3;
  plane: CplaneT; surface: CsurfaceT | null; contents: number;
  ent: MovementEntity | null; plane2: CplaneT; surface2: CsurfaceT | null;
  readonly source: TraceResult;
}
export type KexTraceT = TraceT;
export type PmTraceFn = (start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3) => TraceT;
export type StuckObjectTraceFn = PmTraceFn;
export interface ClassicPmove {
  s: { pm_type: number; origin: Vec3; velocity: Vec3; pm_flags: number; pm_time: number; gravity: number; delta_angles: Vec3 };
  cmd: { msec: number; angles: Vec3; forwardmove: number; sidemove: number; upmove: number; buttons: number; impulse: number; lightlevel: number };
  snapinitial: boolean; numtouch: number; touchents: MovementEntity[]; touchtraces: TraceT[];
  viewangles: Vec3; viewheight: number; mins: Vec3; maxs: Vec3; groundentity: MovementEntity | null;
  watertype: number; waterlevel: number; trace: PmTraceFn; pointcontents(point: Vec3): number;
  /** Selected character dimensions, independent of movement family. */
  characterBounds: Bounds;
}
export interface KexTouchListT { num: number; traces: TraceT[]; }
export interface KexPmoveT {
  s: { pm_type: number; origin: Vec3; velocity: Vec3; pm_flags: number; pm_time: number; gravity: number; delta_angles: Vec3; viewheight: number };
  cmd: { msec: number; angles: Vec3; forwardmove: number; sidemove: number; buttons: number; server_frame: number };
  snapinitial: boolean; touch: KexTouchListT; viewangles: Vec3; mins: Vec3; maxs: Vec3;
  groundentity: MovementEntity | null; groundplane: CplaneT; watertype: number; waterlevel: number;
  player: MovementEntity | null;
  trace(start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3, pass: MovementEntity | null, mask: number): TraceT;
  clip(start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3, mask: number): TraceT;
  pointcontents(point: Vec3): number;
  viewoffset: Vec3; screen_blend: Vec4; rdflags: number; jump_sound: boolean; step_clip: boolean; impact_delta: number;
  characterBounds: Bounds;
}
export interface PmConfigT { airaccel: number; n64_physics: boolean; }
export const PM_CONFIG_DEFAULT: PmConfigT = { airaccel: 0, n64_physics: false };
export enum PmTypeT { PM_NORMAL, PM_SPECTATOR, PM_DEAD, PM_GIB, PM_FREEZE }
export enum KexPmTypeT { PM_NORMAL, PM_GRAPPLE, PM_NOCLIP, PM_SPECTATOR, PM_DEAD, PM_GIB, PM_FREEZE }
export enum StuckResultT { GOOD_POSITION, FIXED, NO_GOOD_POSITION }
export enum WaterLevelT { WATER_NONE, WATER_FEET, WATER_WAIST, WATER_UNDER }
export const PITCH = 0, YAW = 1, ROLL = 2;
export const STEPSIZE = 18, MAXTOUCH = 32;
export const PMF_DUCKED = 1, PMF_JUMP_HELD = 2, PMF_ON_GROUND = 4, PMF_TIME_WATERJUMP = 8, PMF_TIME_LAND = 16, PMF_TIME_TELEPORT = 32;
export const PmflagsT = { PMF_NONE: 0, PMF_DUCKED, PMF_JUMP_HELD, PMF_ON_GROUND, PMF_TIME_WATERJUMP, PMF_TIME_LAND, PMF_TIME_TELEPORT,
  PMF_NO_POSITIONAL_PREDICTION: 64, PMF_ON_LADDER: 128, PMF_NO_ANGULAR_PREDICTION: 256, PMF_IGNORE_PLAYER_COLLISION: 512, PMF_TIME_TRICK: 1024 };
export const ButtonT = { BUTTON_NONE: 0, BUTTON_ATTACK: 1, BUTTON_USE: 2, BUTTON_HOLSTER: 4, BUTTON_JUMP: 8, BUTTON_CROUCH: 16, BUTTON_ANY: 128 };
export const RefdefFlagsT = { RDF_NONE: 0, RDF_UNDERWATER: 1 };
export const CONTENTS_SOLID = 1, CONTENTS_WINDOW = 2, CONTENTS_LAVA = 8, CONTENTS_SLIME = 16, CONTENTS_WATER = 32;
export const CONTENTS_CURRENT_0 = 1 << 18, CONTENTS_CURRENT_90 = 1 << 19, CONTENTS_CURRENT_180 = 1 << 20, CONTENTS_CURRENT_270 = 1 << 21, CONTENTS_CURRENT_UP = 1 << 22, CONTENTS_CURRENT_DOWN = 1 << 23;
export const CONTENTS_LADDER = 1 << 29;
export const ContentsT = { CONTENTS_NONE: 0, CONTENTS_SOLID, CONTENTS_WINDOW, CONTENTS_LAVA, CONTENTS_SLIME, CONTENTS_WATER,
  CONTENTS_CURRENT_0, CONTENTS_CURRENT_90, CONTENTS_CURRENT_180, CONTENTS_CURRENT_270, CONTENTS_CURRENT_UP, CONTENTS_CURRENT_DOWN, CONTENTS_LADDER,
  CONTENTS_NO_WATERJUMP: 1 << 13, CONTENTS_PLAYERCLIP: 1 << 16, CONTENTS_MONSTER: 1 << 25, CONTENTS_PLAYER: 1 << 30 };
export type ContentsT = number;
export const SURF_SLICK = 2;
export const SurfflagsT = { SURF_SLICK };
export const MASK_SOLID = CONTENTS_SOLID | CONTENTS_WINDOW;
export const MASK_DEADSOLID = MASK_SOLID | ContentsT.CONTENTS_PLAYERCLIP;
export const MASK_PLAYERSOLID = MASK_DEADSOLID | ContentsT.CONTENTS_MONSTER | ContentsT.CONTENTS_PLAYER;
export const MASK_CLASSIC_PLAYERSOLID = MASK_DEADSOLID | ContentsT.CONTENTS_MONSTER;
export const MASK_WATER = CONTENTS_WATER | CONTENTS_LAVA | CONTENTS_SLIME;
export const MASK_CURRENT = CONTENTS_CURRENT_0 | CONTENTS_CURRENT_90 | CONTENTS_CURRENT_180 | CONTENTS_CURRENT_270 | CONTENTS_CURRENT_UP | CONTENTS_CURRENT_DOWN;
export function element<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Quake II movement index ${index} outside ${values.length}`);
  return value;
}
export function plane(): CplaneT { return { normal: [0, 0, 0], dist: 0, type: 0, signbits: 0 }; }
