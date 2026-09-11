/* Shapes derived from Quake III Arena q_shared.h and the Q3 TypeScript port.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Vec4 { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface MutableVec3 { x: number; y: number; z: number; }
export interface Bounds { readonly min: Vec3; readonly max: Vec3; }
export interface Plane { readonly normal: Vec3; readonly distance: number; }
/** Quake axes are forward, left, up. */
export type Axis = readonly [Vec3, Vec3, Vec3];
export interface AngleVectors { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3; }
/** Column-major storage for column vectors, matching OpenGL. */
export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];
