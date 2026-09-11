/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { Q1Entity } from "../../../formats/q1-map/index.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { Q1MoveType, Q1Solid } from "./types.ts";
import { ZERO, vectors } from "./types.ts";

export interface Q1Move {
  readonly destination: Vec3;
  readonly speed: number;
  remaining: number;
  readonly done: () => undefined;
}
export type Q1MonsterSpecies = "army" | "dog" | "knight" | "enforcer" | "demon" | "ogre" | "hellknight" | "shambler" | "wizard" | "shalrath" | "tarbaby" | "fish" | "zombie" | "boss" | "oldone" | "gremlin" | "scourge" | "armagon" | "spikemine" | "decoy" | "eel" | "sword" | "wrath" | "super-wrath" | "mummy" | "lava-man" | "morph" | "dragon";
export const Q1_MONSTER_SPECIES: readonly Q1MonsterSpecies[] = ["army", "dog", "knight", "enforcer", "demon", "ogre", "hellknight", "shambler", "wizard", "shalrath", "tarbaby", "fish", "zombie", "boss", "oldone", "gremlin", "scourge", "armagon", "spikemine", "decoy", "eel", "sword", "wrath", "super-wrath", "mummy", "lava-man", "morph", "dragon"];
export interface Q1Monster {
  readonly species: Q1MonsterSpecies;
  mode: "stand" | "walk" | "run" | "attack" | "leap" | "pain" | "death";
  frameIndex: number;
  sequence: readonly number[];
  firstFrame: number;
  enemy: ActorId | null;
  oldEnemy: ActorId | null;
  path: string;
  pauseUntil: number;
  attackFinished: number;
  painFinished: number;
  searchUntil: number;
  deathDrop: boolean;
  refired: boolean;
}
export class Q1Actor {
  model = "";
  frame = 0;
  skin = 0;
  effects = 0;
  solid: Q1Solid = "none";
  movement: Q1MoveType = "none";
  readonly fields = new Map<string, string>();
  readonly references = new Map<string, ActorId | null>();
  target = "";
  targetname = "";
  killtarget = "";
  message = "";
  delay = 0;
  spawnflags = 0;
  sounds = 0;
  wait = 0;
  speed = 0;
  damage = 0;
  maxHealth = 0;
  get damageable(): boolean { return this.combat.read(this.actor.id)?.canTakeDamage ?? false; }
  set damageable(value: boolean) { this.combat.setTraits(this.actor, { canTakeDamage: value }); }
  aimedDamage = false;
  nextThink = -1;
  think: (() => undefined) | null = null;
  use: ((other: ActorId | null, activator: ActorId | null) => undefined) | null = null;
  touch: ((other: ActorId, normal: Vec3 | null) => undefined) | null = null;
  pain: ((attacker: ActorId | null, damage: number) => undefined) | null = null;
  die: ((attacker: ActorId | null) => undefined) | null = null;
  blocked: ((other: ActorId) => undefined) | null = null;
  move: Q1Move | null = null;
  owner: ActorId | null = null;
  activator: ActorId | null = null;
  originalModel = "";
  pos1: Vec3 = ZERO;
  pos2: Vec3 = ZERO;
  dest1: Vec3 = ZERO;
  dest2: Vec3 = ZERO;
  movedir: Vec3 = ZERO;
  mangle: Vec3 = ZERO;
  state: "bottom" | "up" | "top" | "down" = "bottom";
  doorGroup: readonly Q1Actor[] = [];
  triggerBounds: Bounds | null = null;
  attackFinished = 0;
  count = 0;
  activated = false;
  monster: Q1Monster | null = null;
  projectile: "rocket" | "grenade" | "spike" | "superspike" | null = null;
  projectileWeapon: import("./types.ts").Q1Weapon | null = null;
  angularVelocity: Vec3 = ZERO;
  waterLevel = 0;
  waterType: 0 | -1 | -2 | -3 | -4 | -5 | -6 = 0;
  movementFlags = 0;
  idealYaw = 0;
  yawSpeed = 20;
  attackState: "straight" | "melee" | "missile" | "dodging" = "straight";
  pathEnd: (() => undefined) | null = null;

  constructor(readonly actor: OwnedActor, public classname: string, readonly sourceOrdinal: number | null, private readonly combat: GameplayAuthority, source?: Q1Entity) {
    if (source !== undefined) for (const property of source.properties) this.fields.set(property.key, property.value);
    this.model = this.text("model"); this.originalModel = this.model;
    this.target = this.text("target"); this.targetname = this.text("targetname"); this.killtarget = this.text("killtarget");
    this.message = this.text("message"); this.delay = this.number("delay"); this.spawnflags = this.number("spawnflags");
    this.sounds = this.number("sounds"); this.wait = this.number("wait"); this.speed = this.number("speed");
    this.damage = this.number("dmg"); this.maxHealth = this.number("health"); this.count = this.number("count");
  }
  text(key: string): string { return this.fields.get(key) ?? ""; }
  number(key: string, fallback = 0): number {
    const text = this.text(key); if (text === "") return fallback;
    const value = Number.parseFloat(text); return Number.isFinite(value) ? Math.fround(value) : fallback;
  }
  vector(key: string): Vec3 { return parseVector(this.text(key)); }
}
export function parseVector(text: string): Vec3 {
  const numbers = text.trim().split(/\s+/u).map(value => Number.parseFloat(value));
  const x = numbers[0] ?? 0, y = numbers[1] ?? 0, z = numbers[2] ?? 0;
  return { x: Number.isFinite(x) ? Math.fround(x) : 0, y: Number.isFinite(y) ? Math.fround(y) : 0, z: Number.isFinite(z) ? Math.fround(z) : 0 };
}
export function sourceAngles(source: Q1Entity): Vec3 {
  const angles = q1EntityValue(source, "angles"); if (angles !== null) return parseVector(angles);
  const angle = Number(q1EntityValue(source, "angle") ?? 0); return { x: 0, y: angle, z: 0 };
}
export function moveDirection(angles: Vec3, game?: import("./entity-services.ts").Q1EntityServices): Vec3 {
  if (angles.y === -1 && angles.x === 0 && angles.z === 0) return { x: 0, y: 0, z: 1 };
  if (angles.y === -2 && angles.x === 0 && angles.z === 0) return { x: 0, y: 0, z: -1 };
  return (game === undefined ? vectors(angles) : game.makeVectors(angles)).forward;
}
