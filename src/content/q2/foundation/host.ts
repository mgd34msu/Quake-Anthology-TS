/* Q2 gameplay provider boundary. Gameplay logic is adapted from id Software's
 * Quake II game and the rerelease game DLL. GPL-2.0-or-later. */
import type { AttackProvenance, DamageOutcome, ItemId, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { Q2RereleaseRandomSource } from "../../../core/random/q2-rerelease.ts";
import type { BodyState, DeathReaction, PainReaction, TouchContact } from "../../../contracts/world.ts";
import type { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import type { Q2CallbackDefinitions, Q2SourceCallbacks } from "./callbacks.ts";
import type { Q2EntityServices } from "./entity-services.ts";
import type { AuthoredTarget } from "../../monsters/authored.ts";

export type Q2Edition = "classic" | "rerelease";
export interface Q2GameOptions {
  readonly edition: Q2Edition;
  readonly mapName: string;
  readonly skill: 0 | 1 | 2 | 3;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly deathmatchFlags: number;
  readonly maxClients: number;
  readonly provider: ProviderId;
  readonly campaign: ProviderId;
  readonly combatProvider: ProviderId;
  readonly inventoryProvider: ProviderId;
  readonly movementProvider: ProviderId;
}

export interface Q2SpawnFields {
  readonly ordinal: number;
  readonly classname: string;
  readonly values: ReadonlyMap<string, string>;
}

export type Q2PresentationEvent =
  | { readonly kind: "model"; readonly actor: ActorId; readonly path: string; readonly attachedModels: readonly string[]; readonly frame: number; readonly oldFrame: number; readonly scale: number; readonly alpha: number; readonly skin: number; readonly effects: number; readonly renderFlags: number }
  | { readonly kind: "visibility"; readonly actor: ActorId; readonly visible: boolean }
  | { readonly kind: "sound"; readonly actor: ActorId | null; readonly origin: Vec3; readonly path: string; readonly channel: number; readonly volume: number; readonly attenuation: number; readonly reliable: boolean; readonly loop: "start" | "stop" | "once" }
  | { readonly kind: "centerprint"; readonly actor: ActorId; readonly text: string }
  | { readonly kind: "print"; readonly actor: ActorId | null; readonly level: "low" | "medium" | "high" | "chat"; readonly text: string }
  | { readonly kind: "help"; readonly slot: 1 | 2; readonly text: string }
  | { readonly kind: "lightstyle"; readonly style: number; readonly pattern: string }
  | { readonly kind: "music"; readonly track: string }
  | { readonly kind: "effect"; readonly effect: string; readonly origin: Vec3; readonly direction: Vec3; readonly count: number; readonly color: number }
  | { readonly kind: "pickup"; readonly player: ActorId; readonly item: ItemId; readonly icon: string; readonly name: string }
  | { readonly kind: "poi"; readonly origin: Vec3; readonly message: string; readonly fields: ReadonlyMap<string, string> }
  | ({ readonly kind: "dynamic-light" } & import("./shadow-lights.ts").Q2ShadowLightState)
  | { readonly kind: "beam"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3; readonly width: number; readonly color: number; readonly visible: boolean }
  | { readonly kind: "monster-beam"; readonly effect: "parasite" | "medic"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "monster-muzzleflash"; readonly actor: ActorId; readonly flash: number; readonly origin: Vec3; readonly direction: Vec3 }
  | { readonly kind: "entity-event"; readonly actor: ActorId; readonly event: number };

export interface Q2TraceRequest {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly bounds: Bounds | null;
  readonly ignore: ActorId | null;
  readonly mask: number;
  readonly exclude?: readonly ActorId[];
}

/** The engine owns physical movement and commits each pusher move with rollback. */
export interface Q2Motion {
  readonly actor: OwnedActor;
  readonly velocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly kind: "stationary" | "push" | "stop" | "toss" | "new-toss" | "bounce" | "wall-bounce" | "fly" | "fly-missile" | "step";
  readonly gravity: number;
  readonly gravityVector: Vec3;
  readonly clipMask: number;
  readonly owner: ActorId | null;
}

export interface Q2LandmarkCarry {
  readonly player: ActorId;
  readonly name: string;
  readonly relativeOrigin: Vec3;
  readonly relativeVelocity: Vec3;
  readonly relativeViewAngles: Vec3;
}

export interface Q2FoundationHost {
  monsterTarget?(actor: ActorId): import("../../monsters/target.ts").MonsterTargetObservation | null;
  registerEntity?(entity: Q2Entity, services: Q2EntityServices): undefined;
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly callbacks: ActorCallbackTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  now(): number;
  frameSeconds(): number;
  random(): number;
  /** Rerelease source callbacks share this stream with random(); classic hosts omit it. */
  readonly rereleaseRandom?: Q2RereleaseRandomSource;
  /** Schedule the actor's bound think callback on the shared source clock. */
  schedule(actor: OwnedActor, dueSeconds: number | null): undefined;
  touchTriggers(actor: OwnedActor): undefined;
  trace(request: Q2TraceRequest): TraceResult;
  pointContents(point: Vec3): number;
  inPvs(first: Vec3, second: Vec3): boolean;
  inPhs(first: Vec3, second: Vec3): boolean;
  areasConnected(first: Vec3, second: Vec3): boolean;
  /** Includes foreign players and actors. Returns source-stable traversal order. */
  nearby(origin: Vec3, radius: number): readonly ActorId[];
  players(): readonly ActorId[];
  worldActor(): ActorId;
  isPlayer(actor: ActorId): boolean;
  isMonster(actor: ActorId): boolean;
  inlineModelBounds(model: number): Bounds;
  setSolid(actor: OwnedActor, solid: "none" | "trigger" | "box" | "brush", model: number | null): undefined;
  setMotion(motion: Q2Motion): undefined;
  setAreaPortal(portal: number, open: boolean): undefined;
  emit(event: Q2PresentationEvent): undefined;
  playerViewState(player: ActorId): { readonly viewAngles: Vec3; readonly oldVelocity: Vec3 } | null;
  keyConsumed(player: ActorId): undefined;
  /** Source campaign state captured before the shared coordinator admits travel. */
  prepareLevelChange(map: string, landmark: Q2LandmarkCarry | null, serverFlags: number): undefined;
  transition(intent: TransitionIntent): undefined;
  diagnostic(message: string): undefined;
}

export type Q2Think = (entity: Q2Entity, game: Q2GameServices) => undefined;
export type Q2Use = (entity: Q2Entity, game: Q2GameServices, other: ActorId | null, activator: ActorId | null) => undefined;
export type Q2Touch = (entity: Q2Entity, game: Q2GameServices, contact: TouchContact) => undefined;
export type Q2Pain = (entity: Q2Entity, game: Q2GameServices, reaction: PainReaction) => undefined;
export type Q2Die = (entity: Q2Entity, game: Q2GameServices, reaction: DeathReaction) => undefined;

/** Provider-owned fields exclude shared body, health, armor and inventory state. */
export class Q2Entity {
  classname: string;
  target: string;
  targetname: string;
  killtarget: string;
  combatTarget: string;
  deathTarget: string;
  healthTarget: string;
  itemTarget: string;
  message: string;
  model: string;
  model2 = "";
  model3 = "";
  model4 = "";
  spawnflags: number;
  delay = 0;
  wait = 0;
  speed = 0;
  accel = 0;
  decel = 0;
  damage = 0;
  damageRadius = 0;
  radiusDamage = 0;
  count = 0;
  maxHealth = 0;
  viewHeight = 0;
  frame = 0;
  oldFrame = -1;
  scale = 1;
  alpha = 1;
  skin = 0;
  effects = 0;
  renderFlags = 0;
  flags = 0;
  serverFlags = 0;
  lightLevel = 128;
  powerCubes = 0;
  timestamp = 0;
  noise = "";
  sound = "";
  volume = 0;
  attenuation = 0;
  random = 0;
  map = "";
  style = 0;
  transitionStarted = false;
  clipMask = 0x6000003;
  projectile = false;
  dodgeable = false;
  laserImmune = false;
  damageableTarget = false;
  lastAttack: AttackProvenance | null = null;
  visible = true;
  solid: "none" | "trigger" | "box" | "brush" = "none";
  motion: Q2Motion["kind"] = "stationary";
  gravity = 1;
  gravityVector: Vec3 = { x: 0, y: 0, z: -1 };
  angularVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  movedir: Vec3 = { x: 0, y: 0, z: 0 };
  pos1: Vec3 = { x: 0, y: 0, z: 0 };
  pos2: Vec3 = { x: 0, y: 0, z: 0 };
  activator: ActorId | null = null;
  enemy: ActorId | null = null;
  owner: ActorId | null = null;
  goal: ActorId | null = null;
  teamMaster: ActorId | null = null;
  teamChain: ActorId | null = null;
  chain: ActorId | null = null;
  beam: ActorId | null = null;
  beam2: ActorId | null = null;
  proboscus: ActorId | null = null;
  nextThink: number | null = null;
  think: Q2Think | null = null;
  prethink: Q2Think | null = null;
  postthink: Q2Think | null = null;
  use: Q2Use | null = null;
  touch: Q2Touch | null = null;
  pain: Q2Pain | null = null;
  die: Q2Die | null = null;
  blocked: ((entity: Q2Entity, game: Q2GameServices, other: ActorId) => undefined) | null = null;

  constructor(readonly actor: OwnedActor, readonly spawn: Q2SpawnFields) {
    this.classname = spawn.classname;
    this.target = spawn.values.get("target") ?? "";
    this.targetname = spawn.values.get("targetname") ?? "";
    this.killtarget = spawn.values.get("killtarget") ?? "";
    this.combatTarget = spawn.values.get("combattarget") ?? "";
    this.deathTarget = spawn.values.get("deathtarget") ?? "";
    this.healthTarget = spawn.values.get("healthtarget") ?? "";
    this.itemTarget = spawn.values.get("itemtarget") ?? "";
    this.message = spawn.values.get("message") ?? "";
    this.model = spawn.values.get("model") ?? "";
    this.spawnflags = 0;
  }

}

export interface Q2GameServices {
  readonly host: Q2FoundationHost;
  readonly sourceCallbacks: Q2SourceCallbacks;
  readonly options: Q2GameOptions;
  readonly entities: ReadonlyMap<ActorId, Q2Entity>;
  readonly currentActor: ActorId | null;
  readonly counters: { totalSecrets: number; foundSecrets: number; totalGoals: number; foundGoals: number; totalMonsters: number; killedMonsters: number; serverFlags: number };
  spawn(fields: Q2SpawnFields): Q2Entity;
  create(classname: string, values?: ReadonlyMap<string, string>): Q2Entity;
  remove(entity: Q2Entity): undefined;
  entity(actor: ActorId | null): Q2Entity | null;
  itemName(classname: string): string | null;
  pushTeam(actor: ActorId): readonly OwnedActor[];
  body(entity: Pick<Q2Entity, "actor">): BodyState;
  move(entity: Q2Entity, changes: Partial<BodyState>, link?: boolean): undefined;
  link(entity: Q2Entity): undefined;
  solid(entity: Q2Entity, solid: Q2Entity["solid"]): undefined;
  motion(entity: Q2Entity, kind: Q2Motion["kind"]): undefined;
  schedule(entity: Q2Entity, delaySeconds: number, think: Q2Think): undefined;
  cancel(entity: Q2Entity): undefined;
  useTargets(entity: AuthoredTarget, activator: ActorId | null, ignoreDelay?: boolean): undefined;
  monsterTarget(actor: ActorId | null): import("../../monsters/target.ts").MonsterTargetObservation | null;
  targets(name: string): readonly Q2Entity[];
  pickTarget(name: string): Q2Entity | null;
  show(entity: Q2Entity): undefined;
  sound(entity: Pick<Q2Entity, "actor">, path: string, channel?: number, volume?: number, attenuation?: number): undefined;
  damage(target: ActorId, inflictor: Q2Entity | ActorId, attacker: ActorId | null, amount: number, knockback: number, direction: Vec3, point: Vec3, normal: Vec3, meansOfDeath: number, flags?: number, weapon?: ItemId | null): DamageOutcome;
  radiusDamage(inflictor: Q2Entity, attacker: ActorId | null, damage: number, ignore: ActorId | null, radius: number, meansOfDeath: number, damageFlags?: number, weapon?: ItemId | null): undefined;
  canDamage(target: ActorId, inflictor: Pick<Q2Entity, "actor">): boolean;
  attack(inflictor: Q2Entity | ActorId, attacker: ActorId | null, meansOfDeath: number, flags: number, weapon: ItemId | null): AttackProvenance;
}

export interface Q2SpawnModule {
  readonly callbacks?: Q2CallbackDefinitions;
  itemName?(classname: string): string | null;
  spawn(entity: Q2Entity, game: Q2GameServices): boolean;
}
