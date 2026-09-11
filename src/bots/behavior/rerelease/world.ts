// Observations and commands from the common quake-1-re-ts/quake-2-re-ts
// rerelease brain. The selected game supplies observations of its admitted
// actor; SharedBotPopulation passes the resulting command to that actor's
// existing movement provider. This interface owns no game entities.
//
// The interface deliberately speaks in the vocabulary of the shipped
// bots/*.txt knowledge files (item flags, weapon numbers, monster
// classnames) rather than in either game's engine types, because those files
// are the design the bots were tuned against.

import type { BotVec3 } from "./math.ts";
import type { BotNavigation } from "./nav.ts";

//============================================================================
// what the brain can see

export const BotEntityKind = {
  Player: 0,
  Monster: 1,
  Item: 2,
  Interactable: 3,
};
export type BotEntityKindT = number;

export interface BotEntityT {
  /** Stable for as long as the entity lives; the brain uses it to remember targets across frames. */
  readonly id: number;
  readonly kind: BotEntityKindT;
  /** The game's own classname, which is the key every bots/*.txt file is written against. */
  readonly classname: string;
  readonly origin: BotVec3;
  /** The point a weapon should be aimed at for a "center" aim point. */
  readonly center: BotVec3;
  /** The top of the bounding box, for a "head" aim point. */
  readonly head: BotVec3;
  /** The bottom of the bounding box, for a "feet" aim point. */
  readonly feet: BotVec3;
  readonly velocity: BotVec3;
  readonly health: number;
  /** Zero when the entity has no team. */
  readonly team: number;
  /** A player holding a team objective (the enemy flag carrier), when the binding can tell. */
  readonly carryingObjective?: boolean;
  /** True for a player or monster that is out of the fight. */
  readonly dead: boolean;
  /** True while the entity is invisible (Ring of Shadows, or the game's equivalent). */
  readonly invisible: boolean;
  /** 0 dry, 1 feet wet, 2 waist, 3 fully submerged -- the QuakeC waterlevel. weapons.txt's electric-in-water exemption needs the TARGET's water state, not just the bot's own. */
  readonly waterLevel: number;
  /** Set on a bot-controlled player so bots can tell each other apart from humans. */
  readonly isBot: boolean;
  /** The entity's spawnflags, which items.txt and interactables.txt both test. */
  readonly spawnflags: number;
  /** Non-zero when the entity has health the bot could shoot off (interactables.txt's `health` condition). */
  readonly hasHealth: boolean;
  /** True when the entity carries a targetname (interactables.txt's `targetname` condition). */
  readonly hasTargetname: boolean;
}

/** One noise the bot could have heard this frame. */
export interface BotSoundT {
  readonly origin: BotVec3;
  /** The entity that made it, when the game knows; -1 otherwise. */
  readonly sourceId: number;
  /** Server time the sound was made. */
  readonly time: number;
  /** Louder sounds carry further; the brain scales senses.sound_range by this. */
  readonly loudness: number;
}

//============================================================================
// the bot's own state

export interface BotSelfT {
  readonly id: number;
  readonly origin: BotVec3;
  readonly velocity: BotVec3;
  /** (pitch, yaw, roll) in degrees, Quake's convention. */
  readonly viewAngles: BotVec3;
  /** Eye position -- origin plus the game's view offset. */
  readonly eye: BotVec3;
  readonly health: number;
  readonly armor: number;
  /** The QuakeC `items` bitmask, which weapons.txt's `number` field indexes into. */
  readonly items: number;
  /** Keyed by weapons.txt's `ammo_name` ("ammo_shells", "ammo_nails", ...). */
  readonly ammo: Readonly<Record<string, number>>;
  /** The QuakeC `weapon` field: the bit of `items` for the weapon in hand. */
  readonly currentWeapon: number;
  readonly onGround: boolean;
  /** 0 dry, 1 feet wet, 2 waist, 3 fully submerged -- the QuakeC waterlevel. */
  readonly waterLevel: number;
  /** Seconds of breath left while submerged, when the binding can tell; undefined otherwise. */
  readonly airSeconds?: number;
  /** True when the bot is standing on a lift or train, when the binding can tell. */
  readonly onLift?: boolean;
  readonly team: number;
  readonly dead: boolean;
  /** True when the bot holds the Pentagram, which weapons.txt's electric-in-water rule exempts. */
  readonly hasProtection: boolean;
  /** Current armor type's maximum, read from the selected inventory provider. */
  readonly maxArmor?: number;
  /**
   * True while the bot is carrying an objective it has to deliver -- the
   * enemy flag in capture the flag. The game says so, because what counts as
   * carrying one is the game's own rule (Quake 1's CTF progs writes the
   * enemy team's key bit into `items`); a binding for a game with no
   * objectives leaves it out.
   */
  readonly carryingObjective?: boolean;
}

//============================================================================
// traces

export interface BotTraceT {
  /** 1 when nothing was hit. */
  readonly fraction: number;
  readonly endpos: BotVec3;
  /** True when the trace started inside a solid. */
  readonly startsolid: boolean;
  /** The entity that was hit, when the trace hit one of the entities of interest. */
  readonly hitId: number;
}

/** Point-contents answers the brain needs; the binding maps its own numbering onto these. */
export const BotContents = {
  Empty: 0,
  Solid: 1,
  Water: 2,
  Slime: 3,
  Lava: 4,
  Sky: 5,
};
export type BotContentsT = number;

//============================================================================
// what the brain produces

export interface BotUsercmdT {
  forwardmove: number;
  sidemove: number;
  upmove: number;
  /** Bit 0 is attack, bit 1 is jump, bit 2 is use -- the QuakeC button0/button2/button1 order. */
  buttons: number;
  /** 0 for none; otherwise the impulse to send this frame (weapon selection). */
  impulse: number;
  /** (pitch, yaw, roll) in degrees. */
  viewAngles: BotVec3;
}

export const BOT_BUTTON_ATTACK = 1;
export const BOT_BUTTON_JUMP = 2;
export const BOT_BUTTON_USE = 4;

export function emptyUsercmd(): BotUsercmdT {
  return { forwardmove: 0, sidemove: 0, upmove: 0, buttons: 0, impulse: 0, viewAngles: { x: 0, y: 0, z: 0 } };
}

//============================================================================

/**
 * The world as the brain is allowed to see it. Every method is a query the
 * game answers from its own state; the brain caches nothing across frames
 * except what it explicitly remembers (targets, paths, awareness levels).
 */
export interface BotWorldT {
  /** Server time in seconds. */
  time(): number;
  /** The length of the frame about to be simulated, in seconds. */
  frameTime(): number;

  /** This bot's own state, re-read every frame. */
  self(): BotSelfT;

  /** A point trace against the world and against solid entities. */
  traceLine(start: BotVec3, end: BotVec3): BotTraceT;
  /** A box trace, for "can I actually walk from here to there". */
  traceBox(start: BotVec3, mins: BotVec3, maxs: BotVec3, end: BotVec3): BotTraceT;
  /** What kind of medium a point is in. */
  pointContents(p: BotVec3): BotContentsT;

  /**
   * Everything within reach that the brain might act on this frame: other
   * players, monsters, pickups on the ground, and the buttons/plats/doors
   * interactables.txt describes. The binding is free to cull; the brain
   * treats what it gets as the whole world.
   */
  entities(): readonly BotEntityT[];

  /** The noises made since the last call, oldest first. */
  hearing(): readonly BotSoundT[];

  /** The navigation graph for this map, or null when the map has none. */
  nav(): BotNavigation | null;
}
