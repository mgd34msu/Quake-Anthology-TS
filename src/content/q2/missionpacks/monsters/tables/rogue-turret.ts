/* Original Quake II rogue/m_turret.c frame order and distances. ZeniMax Media, GPL-2.0-or-later. */
import type { MonsterMove } from "../../../foundation/monsters/types.ts";

export const turretMoves: readonly MonsterMove[] = [
  { name: "turret_move_stand", firstFrame: 0, lastFrame: 1, end: null, sidestepScale: 0, frames: [
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
  ] },
  { name: "turret_move_ready_gun", firstFrame: 2, lastFrame: 8, end: "turret_run", sidestepScale: 0, frames: [
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
    { ai: "stand", distance: 0, actions: [], lerpFrame: -1 },
  ] },
  { name: "turret_move_seek", firstFrame: 8, lastFrame: 9, end: null, sidestepScale: 0, frames: [
    { ai: "walk", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "walk", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
  ] },
  { name: "turret_move_run", firstFrame: 8, lastFrame: 9, end: "turret_run", sidestepScale: 0, frames: [
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
  ] },
  { name: "turret_move_fire", firstFrame: 10, lastFrame: 13, end: "turret_run", sidestepScale: 0, frames: [
    { ai: "run", distance: 0, actions: ["TurretFire"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
  ] },
  { name: "turret_move_fire_blind", firstFrame: 10, lastFrame: 13, end: "turret_run", sidestepScale: 0, frames: [
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretAim"], lerpFrame: -1 },
    { ai: "run", distance: 0, actions: ["TurretFireBlind"], lerpFrame: -1 },
  ] },
];

export const turretFrame = Object.freeze({
  "stand01": 0,
  "stand02": 1,
  "active01": 2,
  "active02": 3,
  "active03": 4,
  "active04": 5,
  "active05": 6,
  "active06": 7,
  "run01": 8,
  "run02": 9,
  "pow01": 10,
  "pow02": 11,
  "pow03": 12,
  "pow04": 13,
  "death01": 14,
  "death02": 15
});
