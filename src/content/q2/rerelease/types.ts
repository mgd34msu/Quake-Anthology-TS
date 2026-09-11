/* Quake II rerelease game DLL extensions, GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3, Vec4 } from "../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2LandmarkCarry } from "../foundation/host.ts";
import type { Q2RereleaseLevelEntry } from "./campaign.ts";

export interface Q2Fog { readonly density: number; readonly color: Vec3; readonly skyFactor: number; }
export interface Q2HeightFog {
  readonly startColor: Vec3; readonly startDistance: number;
  readonly endColor: Vec3; readonly endDistance: number;
  readonly falloff: number; readonly density: number;
}
export interface Q2FogState { readonly fog: Q2Fog; readonly heightFog: Q2HeightFog; }
export function createQ2Fog(): Q2FogState {
  return { fog: { density: 0, color: { x: 0, y: 0, z: 0 }, skyFactor: 0 },
    heightFog: { startColor: { x: 0, y: 0, z: 0 }, startDistance: 0, endColor: { x: 0, y: 0, z: 0 }, endDistance: 0, falloff: 0, density: 0 } };
}
export type Q2CoopRespawnState = "none" | "in-combat" | "bad-area" | "blocked" | "waiting" | "no-lives";
export class Q2RereleasePlayerState {
  spawned = false;
  gameHelp1Changed = 0;
  gameHelp2Changed = 0;
  helpChanged = 0;
  helpTime = 0;
  invisibilityUntil = 0;
  invisibilityFadeUntil = 0;
  slimeDebounce = 0;
  animationTime = 0;
  flashTime = 0;
  flashes = 0;
  lastDamageUntil = 0;
  lastFiringUntil = 0;
  lives = 0;
  coopRespawnState: Q2CoopRespawnState = "none";
  flashlight = false;
  fog = createQ2Fog();
  wantedFog = createQ2Fog();
  fogTransition = 0;
  bobSkip = false;
  autoSwitch: 0 | 1 | 2 | 3 = 0;
  autoShield = -1;
  dogtag = "";
  impactDelta = 0;
  onLadder = false;
  grappleReleasedUntil = 0;
  grappleAttached = false;
  slowViewAngles: Vec3 = { x: 0, y: 0, z: 0 };
  quakeTime = 0;
  windSoundTime = 0;
  awaitingRespawn = false;
  respawnTimeout = 0;
  pendingLandmark: Omit<Q2LandmarkCarry, "player"> | null = null;
  helpLocation: Vec3 = { x: 0, y: 0, z: 0 };
  helpImage = "friend";
  helpPoints: readonly Vec3[] = [];
  helpIndex = 0;
  helpDrawTime = 0;
  constructor(readonly seat: number, readonly socialId: string) {}
}
export interface Q2RereleaseOptions {
  coopSquadRespawn: boolean;
  coopInstancedItems: boolean;
  coopLives: boolean;
  coopNumLives: number;
  deathmatchForceRespawn: boolean;
  deathmatchNoFallDamage: boolean;
  deathmatchSpawnFarthest: boolean;
  deathmatchForceRespawnTime: number;
  deathmatchAllowExit: boolean;
  coopPlayerCollision: boolean;
  autoSaveMinimumTime: number;
}
export function createQ2RereleaseOptions(changes: Partial<Q2RereleaseOptions> = {}): Q2RereleaseOptions {
  return { coopSquadRespawn: true, coopInstancedItems: true, coopLives: false, coopNumLives: 2,
    deathmatchForceRespawn: false, deathmatchNoFallDamage: false, deathmatchSpawnFarthest: false, deathmatchForceRespawnTime: 0, deathmatchAllowExit: false, coopPlayerCollision: true, autoSaveMinimumTime: 60, ...changes };
}
export type Q2RereleaseEvent =
  | { readonly kind: "localized-print"; readonly actor: ActorId | null; readonly level: "low" | "medium" | "high" | "chat"; readonly text: string; readonly args: readonly string[] }
  | { readonly kind: "mission-objective"; readonly actor: ActorId; readonly text: string; readonly args: readonly string[]; readonly talkSound: boolean }
  | { readonly kind: "mission-status"; readonly actor: ActorId; readonly iconVisible: boolean }
  | { readonly kind: "screen-blend"; readonly actor: ActorId; readonly blend: Vec4 }
  | { readonly kind: "help-computer"; readonly actor: ActorId; readonly visible: boolean; readonly primary: string; readonly secondary: string; readonly slowTime: boolean }
  | { readonly kind: "fog"; readonly actor: ActorId; readonly value: Q2FogState; readonly transitionMilliseconds: number }
  | { readonly kind: "flashlight"; readonly actor: ActorId; readonly enabled: boolean }
  | { readonly kind: "poi"; readonly actor: ActorId; readonly position: Vec3; readonly image: string; readonly duration: number; readonly color: number }
  | { readonly kind: "help-path"; readonly actor: ActorId; readonly first: boolean; readonly position: Vec3; readonly direction: Vec3 }
  | { readonly kind: "coop-respawn"; readonly actor: ActorId; readonly state: Q2CoopRespawnState; readonly lives: number }
  | { readonly kind: "autosave" }
  | { readonly kind: "alpha"; readonly actor: ActorId; readonly alpha: number }
  | { readonly kind: "end-of-unit"; readonly levels: readonly Readonly<Q2RereleaseLevelEntry>[]; readonly buttonTime: number }
  | { readonly kind: "player-dogtag"; readonly actor: ActorId; readonly value: string }
  | { readonly kind: "dynamic-light"; readonly actor: ActorId; readonly origin: Vec3; readonly radius: number; readonly color: Vec3; readonly visible: boolean }
  | { readonly kind: "restart-level"; readonly map: string }
  | { readonly kind: "story"; readonly text: string }
  | { readonly kind: "achievement"; readonly id: string }
  | { readonly kind: "sky"; readonly name: string; readonly rotation: number; readonly autoRotate: boolean; readonly axis: Vec3 }
  | { readonly kind: "healthbar"; readonly actor: ActorId; readonly slot: number; readonly target: ActorId; readonly name: string; readonly fraction: number; readonly visible: boolean }
  | { readonly kind: "item-visibility"; readonly actor: ActorId; readonly item: ActorId; readonly visible: boolean };

/** Seat identity, BSP hull clipping and navigation remain owned by their existing engine services. */
export interface Q2RereleaseHooks {
  emit(event: Q2RereleaseEvent): undefined;
  lightStyle(style: number): string;
  playerIdentity(actor: ActorId): { readonly seat: number; readonly socialId: string };
  clipTrigger(trigger: Q2Entity, player: ActorId, game: Q2GameServices): boolean;
  navigation(start: Vec3, goal: Vec3): { readonly kind: "path"; readonly distanceSquared: number; readonly points: readonly Vec3[] } | { readonly kind: "no-navigation" | "unreachable" };
  monstersSearching(player: ActorId | null): boolean;
  monsterHoldsHealthBar?(monster: ActorId): boolean;
  expansionPowerups?(player: ActorId): { readonly doubleUntil: number; readonly quadFireUntil: number; readonly irUntil: number };
  clearExpansionPowerups?(player: ActorId): undefined;
  playerCollision?(player: ActorId, collide: boolean): undefined;
  groundedOnWorld(player: ActorId): boolean;
  pushPlayer(player: ActorId, velocity: Vec3): undefined;
  setActorGravity(actor: ActorId, gravity: number): undefined;
  setWorldGravity(gravity: number): undefined;
}

export function q2IsN64(game: Pick<Q2GameServices, "options">): boolean { return game.options.mapName.startsWith("q64/"); }
export function q2UsesInstancedItems(options: Q2RereleaseOptions): boolean { return options.coopInstancedItems || options.coopSquadRespawn; }
