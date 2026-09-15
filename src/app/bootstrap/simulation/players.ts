import { prepareNetQuake, physicsNetQuake } from "../../../movement/q1/netquake.ts";
import type { Q1MovementOptions } from "../../../movement/q1/types.ts";
import type { Q1MovementState, Q1MovementResult, QwMovementState, QwMovementProfile } from "../../../contracts/movement.ts";
import type { Q1UserCommand, QwUserCommand } from "../../../contracts/protocol.ts";
import type { Q2RereleaseMovementContext } from "../../../movement/q2/index.ts";
import type { ArsenalIntent } from "../../../contracts/gameplay.ts";
import type { ExecutableRecipe, GameFamily, ProviderTiming } from "../../../contracts/content.ts";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { ActorAnimationState, ArsenalState, MovementContinuation, MovementInput, MovementProfile, MovementResult, MovementServices, MovementState, Q1MovementInput, Q2MovementInput, Q2RereleaseMovementInput, Q3MovementInput } from "../../../contracts/movement.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { SceneQueries, TraceHit } from "../../../contracts/scene.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { applyQ2MovementContacts } from "../../../movement/q2/index.ts";
import { createPlayerMovementProvider, playerMovementEnvironment, playerStandingBounds, selectedMovementProfile } from "./player-movement.ts";
import type { Q3MovementHooks } from "../../../movement/q3/types.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { PlayerView } from "./types.ts";
import type { ClientMovementOptions } from "./q3/types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

export interface NetQuakeClientBinding {
  readonly projection: { read(state: Q1MovementState): Q1MovementState; write(state: Q1MovementState): undefined } | null;
  readonly jumpAuthority: "selected-movement" | "source-gamecode";
  input(command: Q1UserCommand): undefined;
  beforePhysics(frame: FrameContext): undefined;
  think(frame: FrameContext): undefined;
  afterPhysics(frame: FrameContext): undefined;
}

export interface PlayerMovementHost {
  readonly q2MovementConfig?: () => { readonly airAccelerate: number; readonly n64Physics: boolean } | null;
  readonly netQuake?: NetQuakeClientBinding;
  readonly quakeWorld?: {
    read(state: QwMovementState): QwMovementState;
    write(state: QwMovementState): undefined;
    beforePhysics(command: QwUserCommand, frame: FrameContext): undefined;
    water(level: number, type: number): undefined;
    profile(profile: QwMovementProfile): QwMovementProfile;
  };
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly scene: SceneQueries;
  readonly rereleaseMovement: Q2RereleaseMovementContext;
  readonly weaponStep: MovementServices["weaponStep"];
  readonly animationStep: MovementServices["animationStep"];
  readonly touch: MovementServices["touch"];
  readonly q3Hooks: Q3MovementHooks;
  touchTriggers(actor: OwnedActor): undefined;
  isBrush(actor: ActorId): boolean;
  worldActor(): ActorId | null;
  sourcePunch?(actor: ActorId): Vec3 | null;
  gibbed?(): boolean;
  jump(actor: OwnedActor, action: "jump" | "swim"): undefined;
}

export function providerFamily(provider: string): GameFamily {
  if (provider.startsWith("q1:")) return "q1";
  if (provider.startsWith("q2:")) return "q2";
  if (provider.startsWith("q3:")) return "q3";
  throw new RangeError(`Unknown source provider family: ${provider}`);
}

export function providerTiming(recipe: ExecutableRecipe, provider: string): ProviderTiming {
  const timing = recipe.timing.find(value => value.provider === provider);
  if (timing === undefined) throw new Error(`Recipe has no timing for ${provider}`);
  return timing;
}

export function movementProfile(recipe: ExecutableRecipe): MovementProfile {
  const timing = providerTiming(recipe, recipe.movement.provider);
  const base = { id: timing.provider, clock: timing.clock, numeric: timing.numeric };
  switch (timing.clock.kind) {
    case "q1-netquake": return { ...base, kind: "q1-netquake", edition: recipe.movement.content.includes(":rerelease:") ? "rerelease" : "classic",
      parameters: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 10, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 }, edgeFriction: 2, noClipAngleHack: false };
    case "q1-quakeworld": return { ...base, kind: "q1-quakeworld",
      parameters: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } };
    case "q2-classic": return { ...base, kind: "q2-classic", airAccelerate: 0, snapInitial: true };
    case "q2-rerelease": return { ...base, kind: "q2-rerelease", airAccelerate: 0, n64Physics: false };
    case "q3": return { ...base, kind: "q3", product: "baseq3", fixedMilliseconds: timing.clock.fixedMovementMilliseconds, noFootsteps: false };
  }
}

function eighths(value: Vec3): readonly [number, number, number] {
  return [Math.trunc(value.x * 8), Math.trunc(value.y * 8), Math.trunc(value.z * 8)];
}

export function movementOrigin(state: MovementState): Vec3 {
  return state.kind === "q2-classic" ? { x: state.originEighths[0] / 8, y: state.originEighths[1] / 8, z: state.originEighths[2] / 8 } : state.origin;
}

export function movementVelocity(state: MovementState): Vec3 {
  return state.kind === "q2-classic" ? { x: state.velocityEighths[0] / 8, y: state.velocityEighths[1] / 8, z: state.velocityEighths[2] / 8 } : state.velocity;
}

export class MovementPlayer {
  get q2MovementConfig(): { readonly airAccelerate: number; readonly n64Physics: boolean } | null { return this.host.q2MovementConfig?.() ?? null; }
  readonly character: GameFamily;
  readonly standingBounds: Bounds;
  readonly profile: MovementProfile;
  readonly services: MovementServices;
  state: MovementState;
  arsenal: ArsenalState;
  animation: ActorAnimationState;
  viewAngles: Vec3;
  commandAngles: Vec3;
  viewHeight: number;
  bounds: Bounds;
  ground: TraceHit = { kind: "none" };
  waterLevel = 0;
  waterType = 0;
  intermission = false;
  cutscene: { readonly origin: Vec3; readonly angles: Vec3; readonly viewOffset: Vec3 } | null = null;
  gravityMultiplier = 1;
  worldGravity = 800;
  buttons = 0;
  previousButtons = 0;
  lastSequence = -1;
  netQuakeCommand: Q1UserCommand | null = null;
  lastWeaponSeconds = -Infinity;
  arsenalIntent: ArsenalIntent | undefined;
  sourceMovement: ClientMovementOptions | null = null;
  sourceEnvironment: MovementInput["environment"] | null = null;

  constructor(readonly actor: OwnedActor, readonly client: ClientId, readonly recipe: ExecutableRecipe,
    private readonly host: PlayerMovementHost, origin: Vec3, angles: Vec3, arsenal: ArsenalState) {
    this.character = providerFamily(recipe.character.definition.provider);
    this.standingBounds = playerStandingBounds(this.character);
    this.bounds = this.standingBounds;
    this.viewHeight = this.character === "q3" ? 26 : 22;
    this.viewAngles = angles;
    this.commandAngles = angles;
    this.profile = movementProfile(recipe);
    this.arsenal = arsenal;
    this.animation = { provider: recipe.character.definition.provider,
      state: this.character === "q1" ? { kind: "q1", frame: 12, nextFrameSeconds: 0 }
        : this.character === "q2" ? { kind: "q2", frame: 0, endFrame: 39, priority: 0, duck: false, run: false }
        : { kind: "q3", legs: 22, torso: 11, legsTimerMilliseconds: 0, torsoTimerMilliseconds: 0 } };
    this.services = { scene: host.scene, numeric: createNumericOperations(this.profile.numeric),
      touch: host.touch, weaponStep: host.weaponStep, animationStep: host.animationStep };
    switch (this.profile.kind) {
      case "q1-netquake": this.state = { kind: "q1-netquake", origin, velocity: zero, angles,
        oldOrigin: origin, angularVelocity: zero, viewAngles: angles, punchAngles: zero, moveType: 3, flags: 4096,
        ground: this.ground, waterLevel: 0, waterType: -1, teleportTimeSeconds: 0, waterJumpDirection: zero, idealPitch: 0, fixAngle: false, health: 100 }; break;
      case "q1-quakeworld": this.state = { kind: "q1-quakeworld", origin, velocity: zero, angles, oldButtons: 0,
        waterJumpTimeSeconds: 0, dead: false, spectator: 0, ground: this.ground }; break;
      case "q2-classic": this.state = { kind: "q2-classic", type: 0, originEighths: eighths(origin), velocityEighths: [0, 0, 0], flags: 0, timeEightMilliseconds: 0, gravity: 800, deltaAngleShorts: [0, 0, 0] }; break;
      case "q2-rerelease": this.state = { kind: "q2-rerelease", type: 0, origin, velocity: zero, flags: 0, timeMilliseconds: 0, gravity: 800, deltaAngles: zero, viewHeight: this.viewHeight }; break;
      case "q3": this.state = { kind: "q3", commandTimeMilliseconds: 0, movementType: 0, bobCycle: 0, movementFlags: 0, movementTimeMilliseconds: 0,
        origin, velocity: zero, gravity: 800, speed: 320, deltaAngleWords: [0, 0, 0], movementDirection: 0, grapplePoint: zero, flags: 0, viewAngles: angles,
        viewHeight: this.viewHeight, ground: this.ground, predictableEventSequence: 0, jumpPad: null, movementFrame: 0, jumpPadFrame: 0 }; break;
    }
  }

  view(): PlayerView {
    const body = this.host.bodies.read(this.actor.id);
    if (body === null) throw new Error("Player no longer has a body");
    return { origin: body.origin, angles: this.viewAngles, viewHeight: this.viewHeight };
  }

  readState(): MovementState {
    const body = this.host.bodies.read(this.actor.id);
    if (body === null) throw new Error("Player no longer has a body");
    const state = this.state;
    const world = this.host.worldActor();
    this.ground = body.ground === null ? { kind: "none" } : world !== null && body.ground.equals(world)
      ? { kind: "world", model: 0 } : { kind: "actor", actor: body.ground };
    switch (state.kind) {
      case "q1-netquake": {
        const current = { ...state, origin: body.origin, velocity: body.velocity, angles: body.angles,
          ground: this.ground, flags: this.ground.kind === "none" ? state.flags & ~512 : state.flags | 512,
          health: this.host.combat.read(this.actor.id)?.health ?? 0 };
        return this.host.netQuake?.projection?.read(current) ?? current;
      }
      case "q1-quakeworld": {
        const current = { ...state, origin: body.origin, velocity: body.velocity, angles: body.angles, ground: this.ground, dead: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 };
        return this.host.quakeWorld?.read(current) ?? current;
      }
      case "q2-classic": return { ...state, originEighths: eighths(body.origin), velocityEighths: eighths(body.velocity), type: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 ? this.host.gibbed?.() === true ? 3 : 2 : state.type };
      case "q2-rerelease": return { ...state, origin: body.origin, velocity: body.velocity, type: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 ? this.host.gibbed?.() === true ? 5 : 4 : state.type };
      case "q3": return { ...state, origin: body.origin, velocity: body.velocity, ground: this.ground, movementType: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 ? 3 : state.movementType };
    }
  }

  commit(state: MovementState, link: boolean, triggers: boolean): MovementContinuation {
    if (!this.host.actors.isLive(this.actor.id)) return { kind: "actor-removed" };
    this.state = state;
    if (state.kind === "q1-netquake") this.ground = (state.flags & 512) !== 0 ? state.ground : { kind: "none" };
    else if (state.kind === "q1-quakeworld" || state.kind === "q3") this.ground = state.ground;
    if (state.kind === "q1-netquake") { this.waterLevel = state.waterLevel; this.waterType = state.waterType; this.viewAngles = state.viewAngles; }
    const body = this.host.bodies.read(this.actor.id);
    if (body === null) throw new Error("Player has no body during movement");
    if (state.kind === "q1-netquake" && this.host.netQuake !== undefined) this.bounds = body.bounds;
    const angles = state.kind === "q1-netquake" || state.kind === "q1-quakeworld" ? state.angles : this.viewAngles;
    if (state.kind === "q1-quakeworld" && this.host.quakeWorld !== undefined) {
      this.host.quakeWorld.write(state); this.bounds = body.bounds;
    } else this.host.bodies.write(this.actor, { ...body, origin: movementOrigin(state), velocity: movementVelocity(state), angles,
      bounds: this.bounds, ground: this.ground.kind === "actor" ? this.ground.actor : this.ground.kind === "world" ? this.host.worldActor() : null });
    if (state.kind === "q1-netquake") this.host.netQuake?.projection?.write(state);
    if (link) this.host.bodies.link(this.actor);
    if (triggers) this.host.touchTriggers(this.actor);
    return this.host.actors.isLive(this.actor.id) ? { kind: "continue", state: this.readState() } : { kind: "actor-removed" };
  }

  private acceptArsenalIntent(intent: ArsenalIntent | undefined): void {
    const pending = this.arsenalIntent;
    if (pending !== undefined && (pending.impulse ?? 0) !== 0 && (intent === undefined || intent.provider === pending.provider)) {
      this.arsenalIntent = intent === undefined ? { ...pending, weapon: null, useHoldable: false }
        : { ...intent, impulse: intent.impulse || pending.impulse || 0 };
    } else this.arsenalIntent = intent;
  }

  receiveNetQuake(input: ActorCommand): undefined {
    if (input.command.kind !== "q1-netquake") throw new Error("NetQuake client requires a NetQuake command");
    if (input.sequence <= this.lastSequence) return undefined;
    this.netQuakeCommand = { ...input.command, impulse: input.command.impulse || this.netQuakeCommand?.impulse || 0 };
    this.acceptArsenalIntent(input.arsenal);
    this.previousButtons = this.buttons; this.buttons = input.command.buttons;
    this.commandAngles = input.command.viewAngles; this.viewAngles = input.command.viewAngles; this.lastSequence = input.sequence;
    return undefined;
  }
  private netQuakeInput(frame: FrameContext): Q1MovementInput {
    const state = this.readState(), profile = selectedMovementProfile(this), combat = this.host.combat.read(this.actor.id);
    if (state.kind !== "q1-netquake" || profile.kind !== "q1-netquake" || combat === null) throw new Error("Missing NetQuake movement state");
    const command = this.netQuakeCommand ?? { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: this.viewAngles,
      forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
    return { kind: "q1-netquake", actor: this.actor, commandSequence: this.lastSequence, frame, shape: { kind: "box", bounds: this.bounds },
      environment: playerMovementEnvironment(this, combat), arsenal: this.arsenal, animation: this.animation, execution: "authoritative", state, profile, command };
  }
  private netQuakeOptions(): Q1MovementOptions {
    const sourcePunchAngles = this.host.sourcePunch?.(this.actor.id), binding = this.host.netQuake;
    return { ...(sourcePunchAngles == null ? {} : { sourcePunchAngles }), viewHeight: this.viewHeight,
      ...(binding === undefined ? {} : { jumpAuthority: binding.jumpAuthority }), hooks: {
        ...(binding === undefined ? {} : { shape: () => {
          const body = this.host.bodies.read(this.actor.id);
          if (body === null) throw new Error("NetQuake client lost its authoritative body");
          return { kind: "box", bounds: body.bounds } satisfies import("../../../contracts/scene.ts").TraceShape;
        } }),
        playerAction: (actor, action) => this.host.jump(actor, action),
        link: (_actor, next, triggers) => this.commit(next, true, triggers),
        isBsp: hit => hit.kind === "world" || hit.kind === "actor" && this.host.isBrush(hit.actor),
        beforePhysics: (input, state) => {
          const committed = this.commit(state, false, false);
          if (committed.kind === "actor-removed") return committed;
          binding?.beforePhysics(input.frame);
          return this.host.actors.isLive(this.actor.id) ? { kind: "continue", state: this.readState() } : { kind: "actor-removed" };
        },
        afterPhysics: (input, state) => {
          const committed = this.commit(state, false, false);
          if (committed.kind === "actor-removed") return committed;
          binding?.afterPhysics(input.frame);
          return this.host.actors.isLive(this.actor.id) ? { kind: "continue", state: this.readState() } : { kind: "actor-removed" };
        },
        think: (input, state) => {
          const committed = this.commit(state, false, false);
          if (committed.kind === "actor-removed") return committed;
          binding?.think(input.frame);
          return this.host.actors.isLive(this.actor.id) ? { kind: "continue", state: this.readState() } : { kind: "actor-removed" };
        },
      } };
  }
  prepareNetQuake(frame: FrameContext): undefined {
    const input = this.netQuakeInput(frame);
    this.host.netQuake?.input(input.command);
    const prepared = prepareNetQuake({ ...input, state: this.readStateQ1() }, this.services, this.netQuakeOptions());
    this.commit(prepared, false, false);
    return undefined;
  }
  private readStateQ1(): Q1MovementState {
    const state = this.readState(); if (state.kind !== "q1-netquake") throw new Error("NetQuake source changed movement family"); return state;
  }
  physicsNetQuake(frame: FrameContext): Q1MovementResult {
    const result = physicsNetQuake(this.netQuakeInput(frame), this.services, this.netQuakeOptions());
    if (result.status === "active" && this.host.actors.isLive(this.actor.id)) { this.accept(result); this.commit(result.state, false, false); }
    if (this.netQuakeCommand !== null) this.netQuakeCommand = { ...this.netQuakeCommand, impulse: 0 };
    return result;
  }

  move(input: ActorCommand, frame: FrameContext): MovementResult {
    this.acceptArsenalIntent(input.arsenal);
    this.state = this.readState();
    this.previousButtons = this.buttons;
    this.buttons = input.command.buttons;
    if (input.command.kind === "q1-netquake") this.viewAngles = input.command.viewAngles;
    else if (input.command.kind === "q1-quakeworld" || input.command.kind === "q2-rerelease") this.viewAngles = input.command.angles;
    else { const words = input.command.kind === "q2-classic" ? input.command.angleShorts : input.command.angleWords;
      this.viewAngles = { x: words[0] * 360 / 65536, y: words[1] * 360 / 65536, z: words[2] * 360 / 65536 }; }
    this.commandAngles = this.viewAngles;
    const combat = this.host.combat.read(this.actor.id);
    if (combat === null) throw new Error("Player has no combat state");
    const base = { actor: this.actor, commandSequence: input.sequence, frame, shape: { kind: "box", bounds: this.standingBounds },
      environment: playerMovementEnvironment(this, combat),
      arsenal: this.arsenal, animation: this.animation, execution: "authoritative" } satisfies Omit<Q1MovementInput, "kind" | "command" | "state" | "profile">;
    const state = this.state, selectedProfile = selectedMovementProfile(this), command = input.command;
    const profile = selectedProfile.kind === "q1-quakeworld" ? this.host.quakeWorld?.profile(selectedProfile) ?? selectedProfile : selectedProfile;
    const sourcePunchAngles = this.host.sourcePunch?.(this.actor.id);
    const q1Options = { ...(sourcePunchAngles == null ? {} : { sourcePunchAngles }), viewHeight: this.viewHeight, hooks: {
      playerAction: (actor: OwnedActor, action: "jump" | "swim") => this.host.jump(actor, action),
      link: (_actor: OwnedActor, next: MovementState, triggers: boolean) => this.commit(next, true, triggers),
      isBsp: (hit: TraceHit) => hit.kind === "world" || hit.kind === "actor" && this.host.isBrush(hit.actor),
      qwState: (level: number, type: number): undefined => this.host.quakeWorld?.water(level, type),
      beforePhysics: (input: MovementInput, next: MovementState) => {
        const committed = this.commit(next, false, false);
        if (committed.kind === "actor-removed") return committed;
        if (input.kind === "q1-quakeworld") this.host.quakeWorld?.beforePhysics(input.command, input.frame);
        return { kind: "continue", state: this.readState() } satisfies MovementContinuation;
      },
      afterPhysics: (_input: MovementInput, next: MovementState) => this.commit(next, false, false),
    } };
    const provider = createPlayerMovementProvider(this, { q1: q1Options, q2: this.host.rereleaseMovement, q3: {
      ...this.host.q3Hooks,
      weapon: context => { this.viewAngles = context.motion.viewangles; return this.host.q3Hooks.weapon(context); },
    } });
    let result: MovementResult;
    if (provider.kind === "q1-netquake" && profile.kind === "q1-netquake" && state.kind === "q1-netquake" && command.kind === "q1-netquake") {
      result = provider.move({ ...base, kind: "q1-netquake", profile, state, command }, this.services);
    } else if (provider.kind === "q1-quakeworld" && profile.kind === "q1-quakeworld" && state.kind === "q1-quakeworld" && command.kind === "q1-quakeworld") {
      result = provider.move({ ...base, kind: "q1-quakeworld", profile, state, command }, this.services);
    } else if (provider.kind === "q2-classic" && profile.kind === "q2-classic" && state.kind === "q2-classic" && command.kind === "q2-classic") {
      const move: Q2MovementInput = { ...base, kind: "q2-classic", profile, state, command };
      const moved = provider.move(move, this.services);
      if (moved.status === "active") {
        this.accept(moved);
        const afterTriggers = this.commit(moved.state, true, true);
        result = afterTriggers.kind === "actor-removed" ? { kind: moved.kind, status: "actor-removed", actor: moved.actor, commandSequence: moved.commandSequence, effects: moved.effects }
          : afterTriggers.state.kind === "q2-classic" ? applyQ2MovementContacts(move, this.services, { ...moved, state: afterTriggers.state })
            : this.wrongFamily();
      } else result = moved;
    } else if (provider.kind === "q2-rerelease" && profile.kind === "q2-rerelease" && state.kind === "q2-rerelease" && command.kind === "q2-rerelease") {
      const move: Q2RereleaseMovementInput = { ...base, kind: "q2-rerelease", profile, state, command, viewOffset: { x: 0, y: 0, z: this.viewHeight }, snapInitial: true };
      const moved = provider.move(move, this.services);
      if (moved.status === "active") {
        this.accept(moved);
        const afterTriggers = this.commit(moved.state, true, true);
        result = afterTriggers.kind === "actor-removed" ? { kind: moved.kind, status: "actor-removed", actor: moved.actor, commandSequence: moved.commandSequence, effects: moved.effects }
          : afterTriggers.state.kind === "q2-rerelease" ? applyQ2MovementContacts(move, this.services, { ...moved, state: afterTriggers.state })
            : this.wrongFamily();
      } else result = moved;
    } else if (provider.kind === "q3" && profile.kind === "q3" && state.kind === "q3" && command.kind === "q3") {
      const move: Q3MovementInput = { ...base, kind: "q3", profile, state, command };
      result = provider.move(move, this.services);
    } else throw new Error(`Command ${command.kind} does not match movement ${profile.kind}`);
    if (result.status === "active" && this.host.actors.isLive(this.actor.id)) {
      this.accept(result);
      this.commit(result.state, true, result.kind === "q3");
    }
    this.lastSequence = input.sequence;
    return result;
  }

  private accept(result: Extract<MovementResult, { readonly status: "active" }>): undefined {
    this.state = result.state; this.viewAngles = result.viewAngles; this.viewHeight = result.viewHeight;
    this.bounds = result.bounds; this.ground = result.ground; this.waterLevel = result.waterLevel; this.waterType = result.waterType;
    this.arsenal = result.arsenal; this.animation = result.animation;
    return undefined;
  }

  private wrongFamily(): never { throw new Error("Source callback changed a player's movement provider"); }
}
