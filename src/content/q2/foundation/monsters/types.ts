import type { ActorId } from "../../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { DeathReaction, PainReaction } from "../../../../contracts/world.ts";
import type { Q2Entity, Q2GameServices } from "../host.ts";
import type { Q2CallbackDefinitions } from "../callbacks.ts";
import type { Q2Ballistics } from "../weapons/ballistics.ts";
import type { Q2AlternateFlyState } from "./alternate-fly-state.ts";

export interface MonsterFrame {
  readonly ai: "stand" | "walk" | "run" | "charge" | "move" | "soldier_move" | "turn" | "none" | { readonly kind: "source"; readonly name: string };
  readonly distance: number;
  readonly actions: readonly (string | { readonly kind: "nextframe"; readonly frame: number | "next" })[];
  readonly lerpFrame: number;
}
export interface MonsterMove {
  readonly name: string;
  readonly firstFrame: number;
  readonly lastFrame: number;
  readonly end: string | null;
  readonly sidestepScale: number;
  readonly frames: readonly MonsterFrame[];
}
export type MonsterKind = string;
export interface MonsterState extends Q2AlternateFlyState {
  readonly kind: MonsterKind;
  readonly weapon: "blaster" | "shotgun" | "machinegun";
  locomotion: "walk" | "fly" | "swim" | "stationary";
  readonly hasMelee: boolean;
  readonly hasRangedAttack: boolean;
  readonly hasIdle: boolean;
  readonly hasSearch: boolean;
  readonly blindFire: boolean;
  goodGuy: boolean;
  targetAnger: boolean;
  ignoreShots: boolean;
  doNotCount: boolean;
  spawnedBy: "none" | "carrier" | "medic" | "widow";
  commander: ActorId | null;
  monsterSlots: number;
  monsterUsed: number;
  brutal: boolean;
  medic: boolean;
  resurrecting: boolean;
  move: MonsterMove;
  nextMove: MonsterMove | null;
  nextFrame: number;
  nextMoveTime: number;
  scale: number;
  gibHealth: number;
  initialPowerArmorType: "none" | "screen" | "shield";
  maxPowerArmorPower: number;
  baseHealth: number;
  healthScaling: number;
  canTakeDamage: boolean;
  dead: boolean;
  corpse: boolean;
  gibbed: boolean;
  standGround: boolean;
  temporaryStandGround: boolean;
  holdFrame: boolean;
  ducked: boolean;
  dodging: boolean;
  charging: boolean;
  manualSteering: boolean;
  combatPoint: boolean;
  attackState: "straight" | "sliding" | "melee" | "missile" | "blind";
  lefty: boolean;
  idealYaw: number;
  yawSpeed: number;
  pauseTime: number;
  idleTime: number;
  painTime: number;
  fireWait: number;
  duckWait: number;
  nextDuckTime: number;
  dodgeTime: number;
  attackFinished: number;
  checkAttackTime: number;
  strafeTime: number;
  hadVisibility: boolean;
  closeSightTripped: boolean;
  meleeTime: number;
  searchTime: number;
  trailTime: number;
  showHostile: number;
  lastSighting: Vec3;
  savedGoal: Vec3 | null;
  lostSight: boolean;
  pursueNext: boolean;
  pursueTemporary: boolean;
  pursuitLastSeen: boolean;
  blindFireTarget: Vec3;
  blindFireDelay: number;
  soundTarget: { readonly actor: ActorId; readonly owner: ActorId; readonly origin: Vec3; readonly time: number } | null;
  oldEnemy: ActorId | null;
  moveTarget: ActorId | null;
  combatTarget: string;
  cocked: boolean;
  forceRefire: boolean;
  normalHeight: number;
  waterLevel: 0 | 1 | 2 | 3;
  waterType: number;
  lastLinkCount: number;
  airFinished: number;
  environmentalDamageTime: number;
  jumpTime: number;
  fliesTime: number | null;
}

export type MonsterWeapons = Pick<Q2Ballistics, "fireBullet" | "fireShotgun" | "fireBlaster" | "fireHit" | "fireRocket" | "fireGrenade" | "fireRail" | "fireBfg">;

export interface MonsterContext {
  readonly entity: Q2Entity;
  readonly game: Q2GameServices;
  readonly state: MonsterState;
  readonly weapons: MonsterWeapons;
  sourceCombatRules(): "base" | "rogue";
  beforeSourceMove(displacement: Vec3): { readonly kind: "handled" } | { readonly kind: "move"; readonly displacement: Vec3 };
  acceptsSourceGroundMove(origin: Vec3): boolean;
  consumeSourceBlocked(): boolean;
  runHintPath(distance: number): boolean;
  checkLostHintPath(): boolean;
  schedule(delaySeconds: number, callback: "monster_dead_think" | "M_FliesOn" | "M_FliesOff"): undefined;
  setMove(name: string, immediate?: boolean): undefined;
  stand(): undefined;
  walk(): undefined;
  run(): undefined;
  attack(): undefined;
  dispatch(callback: string): undefined;
  findTarget(): boolean;
  checkAttack(distance: number): boolean;
  moveToGoal(distance: number): boolean;
  dodge(attacker: ActorId, etaSeconds: number, trace: TraceResult | null, gravity?: boolean): undefined;
  melee(): undefined;
  blocked(distance: number): boolean;
  platformState(actor: ActorId): "top" | "bottom" | "up" | "down" | null;
  idle(): undefined;
  search(): undefined;
}

export type MonsterHandler = (context: MonsterContext) => undefined;

export interface Q2MonsterSourceCombatHooks {
  isGoodGuy(entity: Q2Entity): boolean;
  beforeReact(context: MonsterContext, attacker: ActorId): boolean;
  beforeKilled(context: MonsterContext): undefined;
  recoverEnemy(context: MonsterContext): ActorId | null;
  beforeMove(context: MonsterContext, displacement: Vec3): { readonly kind: "handled" } | { readonly kind: "move"; readonly displacement: Vec3 };
  acceptsGroundMove(context: MonsterContext, origin: Vec3): boolean;
  consumeBlocked(context: MonsterContext): boolean;
}

export interface Q2MonsterHintHooks {
  run(context: MonsterContext, distance: number): boolean;
  checkLost(context: MonsterContext): boolean;
  stop(context: MonsterContext): undefined;
}

/** Species register source callbacks against the shared frame, perception and movement runner. */
export interface Q2MonsterDefinition {
  readonly classname: string;
  readonly kind: string;
  readonly model: string;
  readonly health: number;
  readonly gibHealth: number;
  readonly mass: number;
  readonly bounds: Bounds;
  readonly scale: number;
  readonly viewHeight?: number;
  readonly yawSpeed?: number;
  readonly locomotion?: MonsterState["locomotion"];
  readonly initialMove: string;
  readonly moves: readonly MonsterMove[];
  readonly callbacks: Readonly<Record<string, MonsterHandler>>;
  readonly stand: MonsterHandler;
  readonly walk: MonsterHandler;
  readonly run: MonsterHandler;
  readonly attack: MonsterHandler;
  readonly sight?: MonsterHandler;
  readonly idle?: MonsterHandler;
  readonly search?: MonsterHandler;
  readonly melee?: MonsterHandler;
  readonly hasRangedAttack?: boolean;
  readonly blindFire?: boolean;
  readonly pain?: (context: MonsterContext, reaction: PainReaction) => undefined;
  readonly die: (context: MonsterContext, reaction: DeathReaction) => undefined;
  readonly ai?: Readonly<Record<string, (context: MonsterContext, distance: number) => undefined>>;
  readonly sourceCallbacks?: Q2CallbackDefinitions;
  readonly initialize?: MonsterHandler;
  readonly afterSpawn?: MonsterHandler;
  readonly startMode?: (context: MonsterContext) => "automatic" | "manual";
  readonly restore?: MonsterHandler;
  readonly duck?: (context: MonsterContext, eta: number) => boolean;
  readonly sidestep?: (context: MonsterContext) => boolean;
  readonly dodge?: (context: MonsterContext, attacker: ActorId, eta: number, trace: TraceResult | null, gravity: boolean) => undefined;
  readonly blocked?: (context: MonsterContext, distance: number) => boolean;
  readonly checkAttack?: (context: MonsterContext) => boolean;
}

export function recordAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Monster source table index ${index} outside ${values.length}`);
  return value;
}
