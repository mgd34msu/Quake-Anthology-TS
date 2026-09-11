/* ClientSpawn, player_die and source character animation admission.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CombatState, InventoryEntry } from "../../../contracts/gameplay.ts";
import type { OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { ActorAnimationState, AnimationStepInput, AnimationStepResult, AnimationState } from "../../../contracts/movement.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { ActorCallbackTable } from "../../../world/actors/callbacks.ts";
import type { SharedBodyTable } from "../../../world/actors/body.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import { runQ3AnimationOperation } from "../../../movement/q3/animation.ts";
import { EntityEvent, PlayerAnimation } from "../../../movement/q3/constants.ts";
import { gameAtoi } from "../../../core/game-numeric.ts";
import { q3SpawnAnimation } from "./arsenal.ts";

export const Q3_CHARACTER_BOUNDS = { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } };
export const Q3_CHARACTER_VIEW_HEIGHT = 26;

export interface Q3CharacterEvent {
  readonly actor: OwnedActor;
  readonly sequence: number;
  readonly timeMilliseconds: number;
  readonly event: number;
  readonly parameter: number;
}

export interface Q3CharacterServices {
  readonly bodies: SharedBodyTable;
  readonly callbacks: ActorCallbackTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  timeMilliseconds(): number;
  emit(event: Q3CharacterEvent): undefined;
  /** The selected map/game controller owns spawn occupancy and targets. */
  spawnTargets(actor: OwnedActor): undefined;
  killBox(actor: OwnedActor): undefined;
  deathContext(actor: OwnedActor): Q3CharacterDeathContext;
}

export interface Q3CharacterDeathContext {
  readonly blood: boolean;
  readonly noDrop: boolean;
  readonly suicide: boolean;
  readonly killerSourceSlot: number;
}

export interface Q3CharacterSpawn {
  readonly body: BodyState;
  readonly combat: CombatState;
  readonly inventory: readonly InventoryEntry[];
}

/** Global source death animation cycling belongs to the game instance, never to a static variable. */
export class Q3DeathAnimationSequence {
  private index = 0;
  next(): { readonly animation: PlayerAnimation; readonly event: EntityEvent } {
    const result = this.index === 0 ? { animation: PlayerAnimation.BOTH_DEATH1, event: EntityEvent.EV_DEATH1 }
      : this.index === 1 ? { animation: PlayerAnimation.BOTH_DEATH2, event: EntityEvent.EV_DEATH2 }
        : { animation: PlayerAnimation.BOTH_DEATH3, event: EntityEvent.EV_DEATH3 };
    this.index = (this.index + 1) % 3;
    return result;
  }
}

export function q3MaximumHealth(handicap: string): number {
  const maximum = gameAtoi(handicap);
  return maximum < 1 || maximum > 100 ? 100 : maximum;
}

export function q3InitialCombat(handicap: string, team: string | null): CombatState {
  return { health: (q3MaximumHealth(handicap) + 25) | 0, armor: { kind: "q3", points: 0, protection: Math.fround(0.66) },
    mass: 200, canTakeDamage: true, invulnerable: false, team };
}

/** Gameplay keeps health, body and inventory in the shared tables. This owns only Q3 character state. */
export class Q3CharacterActor {
  private currentAnimation: Extract<AnimationState, { readonly kind: "q3" }> = q3SpawnAnimation();
  private flags = 0;
  private sequence = 0;
  private respawnTime = 0;
  private spawnCount = 0;
  private dead = false;
  private gibbed = false;
  private initialized = false;

  constructor(readonly actor: OwnedActor, readonly provider: ProviderId, readonly product: "baseq3" | "missionpack",
    readonly services: Q3CharacterServices, readonly deathAnimations: Q3DeathAnimationSequence) {}

  get animation(): ActorAnimationState { return { provider: this.provider, state: this.currentAnimation }; }
  get sourceFlags(): number { return this.flags; }
  get eventSequence(): number { return this.sequence; }
  get respawnEligibleAfterMilliseconds(): number { return this.respawnTime; }
  get spawns(): number { return this.spawnCount; }

  private emit(event: number, parameter = 0): undefined {
    return this.services.emit({ actor: this.actor, sequence: this.sequence++, timeMilliseconds: this.services.timeMilliseconds(), event, parameter });
  }

  spawn(input: Q3CharacterSpawn): undefined {
    const { services, actor } = this;
    if (!this.initialized) {
      services.combat.create(actor, input.combat);
      services.inventory.create(actor, input.inventory);
      this.initialized = true;
    } else {
      services.combat.setHealth(actor, input.combat.health);
      services.combat.setArmor(actor, input.combat.armor);
      services.combat.setTraits(actor, input.combat);
      for (const entry of services.inventory.entries(actor.id)) services.inventory.configure(actor, { ...entry, count: 0 });
      for (const entry of input.inventory) services.inventory.configure(actor, entry);
    }
    this.currentAnimation = q3SpawnAnimation();
    this.flags = (this.flags & (4 | 0x4000 | 0x80000)) ^ 4;
    this.dead = false;
    this.gibbed = false;
    this.respawnTime = services.timeMilliseconds();
    this.spawnCount++;
    services.bodies.write(actor, input.body);
    services.callbacks.bind(actor, { think: null, touch: null, use: null,
      pain: reaction => { const health = services.combat.read(reaction.self.id)?.health ?? 0;
        this.emit(EntityEvent.EV_PAIN, health); return undefined; },
      die: () => { this.die(); return undefined; } });
    services.killBox(actor);
    services.bodies.link(actor);
    services.spawnTargets(actor);
    if (this.spawnCount > 1) this.emit(EntityEvent.EV_PLAYER_TELEPORT_IN);
    return undefined;
  }

  /** Called after the selected combat owner has committed lethal damage. */
  die(): undefined {
    if (this.gibbed) return undefined;
    const health = this.services.combat.read(this.actor.id)?.health;
    if (health === undefined) throw new Error("Q3 character has no health binding");
    const context = this.services.deathContext(this.actor);
    if (this.dead) {
      if (health <= -40 && context.blood) this.gib(context.killerSourceSlot);
      else if (!context.blood && health <= -40) this.services.combat.setHealth(this.actor, -39);
      return undefined;
    }
    this.dead = true;
    this.flags |= 1;
    this.respawnTime = (this.services.timeMilliseconds() + 1700) | 0;
    const body = this.services.bodies.read(this.actor.id);
    if (body !== null) {
      this.services.bodies.write(this.actor, { ...body, angles: { x: 0, y: body.angles.y, z: 0 },
        bounds: { ...body.bounds, max: { ...body.bounds.max, z: -8 } } });
      this.services.bodies.link(this.actor);
    }
    if ((health <= -40 && !context.noDrop && context.blood) || context.suicide) this.gib(context.killerSourceSlot);
    else {
      if (health <= -40) this.services.combat.setHealth(this.actor, -39);
      const next = this.deathAnimations.next();
      this.currentAnimation = { ...this.currentAnimation,
        legs: ((this.currentAnimation.legs & 128) ^ 128) | next.animation,
        torso: ((this.currentAnimation.torso & 128) ^ 128) | next.animation };
      this.emit(next.event, context.killerSourceSlot);
    }
    return undefined;
  }

  private gib(killerSourceSlot: number): undefined {
    this.gibbed = true;
    this.flags |= 0x80;
    this.services.combat.setTraits(this.actor, { canTakeDamage: false });
    this.services.bodies.unlink(this.actor);
    return this.emit(EntityEvent.EV_GIB_PLAYER, killerSourceSlot);
  }

  wantsRespawn(nowMilliseconds: number, attack: boolean, useHoldable: boolean, forceRespawnSeconds = 0): boolean {
    if (!this.dead || nowMilliseconds <= this.respawnTime) return false;
    return attack || useHoldable || (forceRespawnSeconds > 0 && ((nowMilliseconds - this.respawnTime) | 0) > Math.imul(forceRespawnSeconds, 1000));
  }

  commitAnimation(animation: ActorAnimationState): undefined {
    if (animation.provider !== this.provider || animation.state.kind !== "q3") throw new TypeError("Q3 character animation belongs to another provider");
    this.currentAnimation = animation.state;
    return undefined;
  }
}

/** Semantic locomotion from Q1/Q2 selects the native Q3 character clips. */
export function stepQ3CharacterAnimation(input: AnimationStepInput, product: "baseq3" | "missionpack", dead: boolean,
  eventSequence = 0): AnimationStepResult {
  if (input.animation.state.kind !== "q3") throw new TypeError("Q3 character requires a Q3 animation state");
  const elapsed = input.frame.elapsed.kind === "milliseconds" ? input.frame.elapsed.value : Math.trunc(input.frame.elapsed.value * 1000);
  const context = { animation: input.animation, dead, elapsedMilliseconds: elapsed, buttons: 0, product, eventSequence };
  const dropped = runQ3AnimationOperation({ kind: "drop-timers" }, context);
  let animation: PlayerAnimation;
  switch (input.locomotion) {
    case "idle": animation = PlayerAnimation.LEGS_IDLE; break;
    case "walk": animation = input.backwards ? PlayerAnimation.LEGS_BACKWALK : PlayerAnimation.LEGS_WALK; break;
    case "run": animation = input.backwards ? PlayerAnimation.LEGS_BACK : PlayerAnimation.LEGS_RUN; break;
    case "backward": animation = PlayerAnimation.LEGS_BACK; break;
    case "crouch": animation = input.backwards ? PlayerAnimation.LEGS_BACKCR : PlayerAnimation.LEGS_WALKCR; break;
    case "jump": animation = input.backwards ? PlayerAnimation.LEGS_JUMPB : PlayerAnimation.LEGS_JUMP; break;
    case "land": animation = input.backwards ? PlayerAnimation.LEGS_LANDB : PlayerAnimation.LEGS_LAND; break;
    case "swim": animation = PlayerAnimation.LEGS_SWIM; break;
  }
  const selected = runQ3AnimationOperation({ kind: "legs", animation, force: input.force }, { ...context, animation: dropped.animation });
  if (input.locomotion !== "land") return { animation: selected.animation, effects: [...dropped.effects, ...selected.effects] };
  const landed = runQ3AnimationOperation({ kind: "legs-timer", milliseconds: 130 }, { ...context, animation: selected.animation });
  return { animation: landed.animation, effects: [...dropped.effects, ...selected.effects, ...landed.effects] };
}
