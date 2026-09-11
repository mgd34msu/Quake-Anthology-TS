import type { ExecutableRecipe, GameFamily, ProviderTiming } from "../../../contracts/content.ts";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { ActorAnimationState, ArsenalState, MovementContinuation, MovementInput, MovementProfile, MovementResult, MovementServices, MovementState, Q1MovementInput, Q2MovementInput, Q2RereleaseMovementInput, Q3MovementInput } from "../../../contracts/movement.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { SceneQueries, TraceHit } from "../../../contracts/scene.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { createQ1MovementProvider, createQwMovementProvider } from "../../../movement/q1/index.ts";
import { applyQ2MovementContacts, createQ2ClassicMovementProvider, createQ2RereleaseMovementProvider } from "../../../movement/q2/index.ts";
import { createQ3MovementProvider, Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS } from "../../../movement/q3/index.ts";
import type { Q3MovementHooks } from "../../../movement/q3/types.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { PlayerView } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const classicBounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };

export interface PlayerMovementHost {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly scene: SceneQueries;
  readonly weaponStep: MovementServices["weaponStep"];
  readonly animationStep: MovementServices["animationStep"];
  readonly touch: MovementServices["touch"];
  readonly q3Hooks: Q3MovementHooks;
  touchTriggers(actor: OwnedActor): undefined;
  isBrush(actor: ActorId): boolean;
  worldActor(): ActorId | null;
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

function movementProfile(recipe: ExecutableRecipe): MovementProfile {
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
  gravityMultiplier = 1;
  buttons = 0;
  previousButtons = 0;
  lastSequence = -1;
  lastWeaponSeconds = -Infinity;

  constructor(readonly actor: OwnedActor, readonly client: ClientId, readonly recipe: ExecutableRecipe,
    private readonly host: PlayerMovementHost, origin: Vec3, angles: Vec3, arsenal: ArsenalState) {
    this.character = providerFamily(recipe.character.definition.provider);
    this.standingBounds = this.character === "q3" ? Q3_SOURCE_STANDING_BOUNDS : classicBounds;
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
    if (body.ground !== null) this.ground = { kind: "actor", actor: body.ground };
    switch (state.kind) {
      case "q1-netquake": return { ...state, origin: body.origin, velocity: body.velocity, angles: body.angles,
        ground: state.ground, health: this.host.combat.read(this.actor.id)?.health ?? 0 };
      case "q1-quakeworld": return { ...state, origin: body.origin, velocity: body.velocity, angles: body.angles, ground: this.ground, dead: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 };
      case "q2-classic": return { ...state, originEighths: eighths(body.origin), velocityEighths: eighths(body.velocity), type: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 ? 2 : state.type };
      case "q2-rerelease": return { ...state, origin: body.origin, velocity: body.velocity, type: (this.host.combat.read(this.actor.id)?.health ?? 0) <= 0 ? 4 : state.type };
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
    const angles = state.kind === "q1-netquake" || state.kind === "q1-quakeworld" ? state.angles : this.viewAngles;
    this.host.bodies.write(this.actor, { ...body, origin: movementOrigin(state), velocity: movementVelocity(state), angles,
      bounds: this.bounds, ground: this.ground.kind === "actor" ? this.ground.actor : this.ground.kind === "world" ? this.host.worldActor() : null });
    if (link) this.host.bodies.link(this.actor);
    if (triggers) this.host.touchTriggers(this.actor);
    return this.host.actors.isLive(this.actor.id) ? { kind: "continue", state: this.readState() } : { kind: "actor-removed" };
  }

  move(input: ActorCommand, frame: FrameContext): MovementResult {
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
      environment: { health: combat.health, flight: false, haste: false, invulnerable: combat.invulnerable, gravityMultiplier: this.gravityMultiplier },
      arsenal: this.arsenal, animation: this.animation, execution: "authoritative" } satisfies Omit<Q1MovementInput, "kind" | "command" | "state" | "profile">;
    const state = this.state, profile = this.profile, command = input.command;
    const q1Options = { viewHeight: this.viewHeight, hooks: {
      playerAction: (actor: OwnedActor, action: "jump" | "swim") => this.host.jump(actor, action),
      link: (_actor: OwnedActor, next: MovementState, triggers: boolean) => this.commit(next, true, triggers),
      isBsp: (hit: TraceHit) => hit.kind === "world" || hit.kind === "actor" && this.host.isBrush(hit.actor),
      beforePhysics: (_input: MovementInput, next: MovementState) => this.commit(next, false, false),
      afterPhysics: (_input: MovementInput, next: MovementState) => this.commit(next, false, false),
    } };
    let result: MovementResult;
    if (profile.kind === "q1-netquake" && state.kind === "q1-netquake" && command.kind === "q1-netquake") {
      result = createQ1MovementProvider(profile.id, q1Options).move({ ...base, kind: "q1-netquake", profile, state, command }, this.services);
    } else if (profile.kind === "q1-quakeworld" && state.kind === "q1-quakeworld" && command.kind === "q1-quakeworld") {
      result = createQwMovementProvider(profile.id, q1Options).move({ ...base, kind: "q1-quakeworld", profile, state, command }, this.services);
    } else if (profile.kind === "q2-classic" && state.kind === "q2-classic" && command.kind === "q2-classic") {
      const move: Q2MovementInput = { ...base, kind: "q2-classic", profile, state, command };
      const moved = createQ2ClassicMovementProvider(profile.id).move(move, this.services);
      if (moved.status === "active") {
        this.accept(moved);
        const afterTriggers = this.commit(moved.state, true, true);
        result = afterTriggers.kind === "actor-removed" ? { kind: moved.kind, status: "actor-removed", actor: moved.actor, commandSequence: moved.commandSequence, effects: moved.effects }
          : afterTriggers.state.kind === "q2-classic" ? applyQ2MovementContacts(move, this.services, { ...moved, state: afterTriggers.state })
            : this.wrongFamily();
      } else result = moved;
    } else if (profile.kind === "q2-rerelease" && state.kind === "q2-rerelease" && command.kind === "q2-rerelease") {
      const move: Q2RereleaseMovementInput = { ...base, kind: "q2-rerelease", profile, state, command, viewOffset: { x: 0, y: 0, z: this.viewHeight }, snapInitial: true };
      const moved = createQ2RereleaseMovementProvider(profile.id).move(move, this.services);
      if (moved.status === "active") {
        this.accept(moved);
        const afterTriggers = this.commit(moved.state, true, true);
        result = afterTriggers.kind === "actor-removed" ? { kind: moved.kind, status: "actor-removed", actor: moved.actor, commandSequence: moved.commandSequence, effects: moved.effects }
          : afterTriggers.state.kind === "q2-rerelease" ? applyQ2MovementContacts(move, this.services, { ...moved, state: afterTriggers.state })
            : this.wrongFamily();
      } else result = moved;
    } else if (profile.kind === "q3" && state.kind === "q3" && command.kind === "q3") {
      const move: Q3MovementInput = { ...base, kind: "q3", profile, state, command };
      result = createQ3MovementProvider({ id: profile.id, hooks: this.host.q3Hooks, postures: () => this.character === "q3" ? Q3_SOURCE_POSTURES
        : { standingViewHeight: this.viewHeight, crouched: { bounds: { ...this.standingBounds, max: { ...this.standingBounds.max, z: 4 } }, viewHeight: -2 },
          dead: { bounds: { ...this.standingBounds, max: { ...this.standingBounds.max, z: -8 } }, viewHeight: -16 }, invulnerabilityExpanded: Q3_SOURCE_POSTURES.invulnerabilityExpanded } }).move(move, this.services);
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
