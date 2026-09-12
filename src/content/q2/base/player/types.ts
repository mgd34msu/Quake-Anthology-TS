/* Player behavior adapted from id Software Quake II p_client.c, p_view.c,
 * p_hud.c and g_cmds.c. GPL-2.0-or-later. */
import type { ArmorState, AttackProvenance, InventoryEntry, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Bounds, Vec3, Vec4 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2FoundationHost } from "../../foundation/host.ts";
import type { Q2ItemModule } from "../../foundation/items.ts";
import type { Q2Weapons, Q2WeaponInput, Q2WeaponName } from "../../foundation/weapons/index.ts";

export interface Q2PlayerMovement {
  readonly viewAngles: Vec3;
  readonly commandAngles: Vec3;
  readonly waterLevel: number;
  readonly waterType: number;
  readonly grounded: boolean;
  readonly ducked: boolean;
  readonly buttons: number;
  readonly standingBounds: Bounds;
  readonly animateQ2: boolean;
}
export type Q2PlayerMovementChange =
  | { readonly kind: "spawn" | "teleport"; readonly origin: Vec3; readonly velocity: Vec3; readonly angles: Vec3; readonly commandAngles: Vec3; readonly holdMilliseconds: number; readonly spectator: boolean }
  | { readonly kind: "freeze"; readonly origin: Vec3; readonly angles: Vec3 }
  | { readonly kind: "noclip"; readonly enabled: boolean };

export interface Q2PlayerView {
  readonly angles: Vec3;
  readonly offset: Vec3;
  readonly kickAngles: Vec3;
  readonly gunAngles: Vec3;
  readonly gunOffset: Vec3;
  readonly blend: Vec4;
  readonly fov: number;
  readonly underwater: boolean;
  readonly flashes: number;
  readonly health: number;
  readonly armor: number;
  readonly ammo: number;
  readonly score: number;
  readonly selectedItem: ItemId | null;
  readonly timer: { readonly item: ItemId; readonly seconds: number } | null;
  readonly spectator: boolean;
  readonly layouts: number;
}
export interface Q2ScoreRow { readonly slot: number; readonly name: string; readonly score: number; readonly ping: number; readonly minutes: number; readonly spectator: boolean; }
export type Q2PlayerEvent =
  | { readonly kind: "print"; readonly target: ActorId | null; readonly level: "low" | "medium" | "high" | "chat"; readonly text: string }
  | { readonly kind: "userinfo"; readonly actor: ActorId; readonly slot: number; readonly name: string; readonly skin: string }
  | { readonly kind: "stufftext"; readonly actor: ActorId; readonly text: string }
  | { readonly kind: "view"; readonly actor: ActorId; readonly view: Q2PlayerView }
  | { readonly kind: "scoreboard"; readonly actor: ActorId; readonly rows: readonly Q2ScoreRow[]; readonly killer: ActorId | null; readonly reliable: boolean }
  | { readonly kind: "inventory"; readonly actor: ActorId; readonly entries: readonly InventoryEntry[] }
  | { readonly kind: "help"; readonly actor: ActorId; readonly visible: boolean }
  | { readonly kind: "load-menu"; readonly actor: ActorId }
  | { readonly kind: "trail"; readonly actor: ActorId; readonly origin: Vec3; readonly time: number }
  | { readonly kind: "chase"; readonly actor: ActorId; readonly target: ActorId | null };

export interface Q2PlayerHooks {
  weaponState?(actor: ActorId): Q2CharacterWeapon | null;
  movement(actor: ActorId): Q2PlayerMovement;
  setMovement(actor: ActorId, change: Q2PlayerMovementChange): undefined;
  emit(event: Q2PlayerEvent): undefined;
  noise(actor: ActorId, origin: Vec3): undefined;
  /** Source ClientBeginServerFrame invokes weapon think exactly once unless ClientThink already did. */
  weaponInput(actor: ActorId): Q2WeaponInput;
  banned(address: string): boolean;
  score?(victim: Q2Entity, attacker: Q2Entity | null, game: Q2GameServices, change: number, meansOfDeath: number, recipient: Q2Entity): undefined;
  playerSpawned?(entity: Q2Entity, game: Q2GameServices): undefined;
  selectSpawn?(entity: Q2Entity, game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 } | null;
  /** Expansion modes may react synchronously after base death/disconnect state changes. */
  death?(entity: Q2Entity, game: Q2GameServices, attack: AttackProvenance | null): undefined;
  dropInventory?(entity: Q2Entity, game: Q2GameServices, attack: AttackProvenance | null): undefined;
  beforeDeathInventory?(entity: Q2Entity, game: Q2GameServices, attack: AttackProvenance | null): undefined;
  disconnect?(entity: Q2Entity, game: Q2GameServices): undefined;
  command?(entity: Q2Entity, game: Q2GameServices, name: string, args: readonly string[]): boolean;
}
export interface Q2PlayerRules {
  password: string;
  spectatorPassword: string;
  maxSpectators: number;
  cheats: boolean;
  timeLimitMinutes: number;
  fragLimit: number;
  mapList: readonly string[];
  nextMap: string;
  spawnPoint: string;
  floodMessages: number;
  floodSeconds: number;
  floodWaitSeconds: number;
  rollSpeed: number;
  rollAngle: number;
  runPitch: number;
  runRoll: number;
  bobUp: number;
  bobPitch: number;
  bobRoll: number;
  gunOffset: Vec3;
}
export function createQ2PlayerRules(changes: Partial<Q2PlayerRules> = {}): Q2PlayerRules {
  return { password: "", spectatorPassword: "", maxSpectators: 4, cheats: false, timeLimitMinutes: 0, fragLimit: 0,
    mapList: [], nextMap: "", spawnPoint: "", floodMessages: 4, floodSeconds: 4, floodWaitSeconds: 10,
    rollSpeed: 200, rollAngle: 2, runPitch: 0.002, runRoll: 0.005, bobUp: 0.005, bobPitch: 0.002, bobRoll: 0.002,
    gunOffset: { x: 0, y: 0, z: 0 }, ...changes };
}
export interface Q2PlayerCarry {
  readonly health: number;
  readonly maximumHealth: number;
  readonly armor: ArmorState;
  readonly inventory: readonly InventoryEntry[];
  readonly weapon: Q2WeaponName | null;
  readonly selectedItem: ItemId | null;
  readonly score: number;
  readonly flags: number;
  readonly powerCubes: number;
}

/** Fields here belong to Q2's player rules/presentation, never duplicate shared live health or inventory. */
export class Q2PlayerState {
  useQ2Weapons = true;
  useQ2Inventory = true;
  spawnInventory: readonly InventoryEntry[] = [];
  userinfo = "";
  name = "";
  skin = "male/grunt";
  gender: "male" | "female" | "neutral" = "male";
  fov = 90;
  hand: "right" | "left" | "center" = "right";
  spectator = false;
  requestedSpectator = false;
  connected = true;
  dead = false;
  gibbed = false;
  noclip = false;
  god = false;
  notarget = false;
  score = 0;
  ping = 0;
  respawnTime = 0;
  airFinished = 0;
  nextDrownTime = 0;
  drownDamage = 2;
  oldWaterLevel = 0;
  breatherSound = 0;
  painDebounce = 0;
  damageBlood = 0;
  damageArmor = 0;
  damagePowerArmor = 0;
  damageKnockback = 0;
  damageFrom: Vec3 = { x: 0, y: 0, z: 0 };
  damageBlend: Vec3 = { x: 0, y: 0, z: 0 };
  damageAlpha = 0;
  bonusAlpha = 0;
  damagePitch = 0;
  damageRoll = 0;
  damageTime = 0;
  powerArmorTime = 0;
  fallTime = 0;
  fallValue = 0;
  landmarkFreeFall = false;
  landmarkNoiseTime = 0;
  oldVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  oldViewAngles: Vec3 = { x: 0, y: 0, z: 0 };
  killerYaw = 0;
  buttons = 0;
  latchedButtons = 0;
  weaponThunk = false;
  bobTime = 0;
  bobMove = 0;
  event = "";
  animationPriority = 0;
  animationEnd = 39;
  animationDuck = false;
  animationRun = false;
  loopSound = "";
  selectedItem: ItemId | null = "q2:weapon_blaster";
  showScores = false;
  showInventory = false;
  showHelp = false;
  chaseTarget: ActorId | null = null;
  coopRespawn: Q2PlayerCarry | null = null;
  floodTimes: number[] = [];
  floodLockUntil = 0;
  constructor(readonly slot: number, readonly enteredAt: number) {}
}
export interface Q2PlayerContext {
  readonly entity: Q2Entity;
  readonly game: Q2GameServices;
  readonly state: Q2PlayerState;
  readonly movement: Q2PlayerMovement;
  readonly rules: Q2PlayerRules;
  readonly items: Q2ItemModule;
  readonly weapons: Q2Weapons;
  readonly hooks: Q2PlayerHooks;
  powerups(): Readonly<import("../../foundation/items.ts").Q2PlayerPowerups>;
  weaponState(): Q2CharacterWeapon | null;
  environmentDamage(amount: number, means: number, flags: number): undefined;
}

export interface Q2CharacterWeapon {
  readonly q2Name: Q2WeaponName | null;
  readonly ammo: ItemId | null;
  readonly kickAngles: Vec3;
  readonly kickOrigin: Vec3;
  readonly loopSound: string;
}
export interface Q2CharacterServices {
  readonly host: Pick<Q2FoundationHost, "now" | "random" | "combat" | "inventory" | "pointContents" | "emit">;
  readonly options: Pick<Q2GameServices["options"], "mode" | "deathmatchFlags"> & { readonly edition?: Q2GameServices["options"]["edition"] };
  body: Q2GameServices["body"];
  move: Q2GameServices["move"];
  sound: Q2GameServices["sound"];
}
export interface Q2CharacterContext extends Omit<Q2PlayerContext, "game" | "items" | "weapons" | "hooks"> {
  readonly game: Q2CharacterServices;
  readonly hooks: Pick<Q2PlayerHooks, "noise">;
}
