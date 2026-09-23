import type { ProviderId } from "../../contracts/identity.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { MovementEffect, MovementProvider, OrderedMovementEffect, Q3MovementInput,
  Q3MovementResult, Q3MovementState, MovementServices, MovementState } from "../../contracts/movement.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { TracePolicy, TraceShape } from "../../contracts/scene.ts";
import { vec3 } from "../../core/math.ts";
import { movePlayer } from "./move.ts";
import { MoveType } from "./constants.ts";
import type { Q3Command, Q3HookContext, Q3Motion, Q3MovementHooks, Q3Postures, Q3MotionOptions } from "./types.ts";

export interface Q3MovementProviderOptions {
  readonly id: ProviderId;
  readonly hooks: Q3MovementHooks;
  /** The selected character supplies its actual crouch/death bodies and view offsets. */
  postures(input: Q3MovementInput): Q3Postures;
  /** Source pmove_t masks and cm_noCurves/cm_playerCurveClip remain caller choices. */
  tracePolicy?(input: Q3MovementInput): Extract<TracePolicy, { readonly kind: "q3" }>;
  readonly diagnostics?: Q3MotionOptions["diagnostics"];
}

export function q3Command(command: Q3MovementInput["command"]): Q3Command {
  return { serverTime: command.serverTimeMilliseconds,
    angles: { x: command.angleWords[0], y: command.angleWords[1], z: command.angleWords[2] },
    buttons: command.buttons, weapon: command.weapon, forwardmove: command.forwardMove,
    rightmove: command.rightMove, upmove: command.upMove };
}

function move(input: Q3MovementInput, services: MovementServices, options: Q3MovementProviderOptions): Q3MovementResult {
  if (input.profile.numeric.arithmetic.kind !== "binary32" || services.numeric.profile.arithmetic.kind !== "binary32") {
    throw new TypeError("The Q3 movement implementation requires binary32 operations");
  }
  const source = input.state;
  const motion: Q3Motion = {
    commandTime: source.commandTimeMilliseconds, pmType: source.movementType, bobCycle: source.bobCycle,
    pmFlags: source.movementFlags, pmTime: source.movementTimeMilliseconds, origin: source.origin,
    velocity: source.velocity, gravity: Math.trunc(source.gravity * input.environment.gravityMultiplier),
    speed: source.speed, deltaAngles: { x: source.deltaAngleWords[0], y: source.deltaAngleWords[1], z: source.deltaAngleWords[2] },
    ground: source.ground, movementDir: source.movementDirection, grapplePoint: source.grapplePoint,
    eFlags: source.flags, viewangles: source.viewAngles, viewheight: source.viewHeight,
    pmoveFramecount: source.movementFrame, eventSequence: source.predictableEventSequence,
    actor: input.actor.id, health: input.environment.health, flight: input.environment.flight,
    invulnerable: input.environment.invulnerable, product: input.profile.product,
  };
  const standing: Bounds = input.shape.kind === "point" ? { min: vec3(0, 0, 0), max: vec3(0, 0, 0) } : input.shape.bounds;
  const shape = (bounds: Bounds): TraceShape => input.shape.kind === "point" ? input.shape : { kind: input.shape.kind, bounds };
  const selectedPolicy = options.tracePolicy?.(input) ?? { kind: "q3", curves: true, playerCurveClip: true,
    contentsMask: 1 | 0x10000 | (source.movementType === MoveType.PM_SPECTATOR ? 0 : 0x2000000) };
  const policy = (contentsMask: number): TracePolicy => ({ ...selectedPolicy, kind: "q3", contentsMask });
  let arsenal = input.arsenal;
  let animation = input.animation;
  let command = q3Command(input.command);
  let frame: FrameContext = input.frame;
  let substep = 0;
  const effects: OrderedMovementEffect[] = [];
  const application = input.execution === "authoritative" ? services.inputApplication : undefined;
  let applicationOpen = false, removed = false;
  let sourceState = source;
  const movementState = (): Q3MovementState => ({ ...sourceState,
    commandTimeMilliseconds: motion.commandTime, movementType: motion.pmType,
    bobCycle: motion.bobCycle, movementFlags: motion.pmFlags, movementTimeMilliseconds: motion.pmTime,
    origin: motion.origin, velocity: motion.velocity,
    deltaAngleWords: [motion.deltaAngles.x, motion.deltaAngles.y, motion.deltaAngles.z],
    ground: motion.ground, movementDirection: motion.movementDir, flags: motion.eFlags,
    viewAngles: motion.viewangles, viewHeight: motion.viewheight, movementFrame: motion.pmoveFramecount,
    predictableEventSequence: motion.eventSequence });
  const resume = (state: MovementState): void => {
    if (state.kind !== "q3") throw new Error("Input callback changed Quake III movement family");
    sourceState = state;
    motion.commandTime = state.commandTimeMilliseconds; motion.pmType = state.movementType;
    motion.bobCycle = state.bobCycle; motion.pmFlags = state.movementFlags; motion.pmTime = state.movementTimeMilliseconds;
    motion.origin = state.origin; motion.velocity = state.velocity; motion.ground = state.ground;
    motion.deltaAngles = { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] };
    motion.movementDir = state.movementDirection; motion.eFlags = state.flags;
    motion.viewangles = state.viewAngles; motion.viewheight = state.viewHeight; motion.pmoveFramecount = state.movementFrame;
    motion.eventSequence = state.predictableEventSequence; motion.grapplePoint = state.grapplePoint;
    motion.gravity = Math.trunc(state.gravity * input.environment.gravityMultiplier); motion.speed = state.speed;
  };
  const context = (): Q3HookContext => ({ input, motion, command, frame, arsenal, animation, services });
  const append = (effect: MovementEffect): void => {
    let ordered = effect;
    if (effect.kind === "event") {
      ordered = { kind: "event", value: { ...effect.value, sequence: motion.eventSequence } };
      motion.eventSequence = (motion.eventSequence + 1) | 0;
    }
    effects.push({ substep, sequence: effects.length, time: frame.time, effect: ordered });
  };
  let result: ReturnType<typeof movePlayer>;
  try { result = movePlayer(motion, command, {
    trace(start, end, bounds, passActor, mask) {
      return services.scene.trace({ start, end, shape: shape(bounds), passActor, target: { kind: "world" },
        numeric: input.profile.numeric, policy: policy(mask) });
    },
    pointContents(point, passActor) {
      const contents = services.scene.pointContents({ point, passActor, target: { kind: "world" },
        numeric: input.profile.numeric, policy: policy(-1) });
      if (contents.kind !== "q3") throw new TypeError("Q3 point contents queries require Q3 content flags");
      return contents.contents;
    },
    standingBounds: standing, postures: options.postures(input),
    traceMask: selectedPolicy.contentsMask, fixedMsec: input.profile.fixedMilliseconds, noFootsteps: input.profile.noFootsteps,
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    beginStep(_state, activeCommand, msec, index) {
      command = activeCommand; substep = index;
      frame = { ...input.frame, time: { kind: "milliseconds", value: command.serverTime },
        elapsed: { kind: "milliseconds", value: msec } };
      if (application !== undefined) {
        applicationOpen = true;
        const before = application.begin({ ...input.command, serverTimeMilliseconds: command.serverTime,
          angleWords: [command.angles.x, command.angles.y, command.angles.z], buttons: command.buttons,
          weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove }, frame, movementState());
        if (before.kind === "actor-removed") { removed = true; return false; }
        if (before.command.kind !== "q3") throw new Error("Input output changed command dialect");
        Object.assign(activeCommand, q3Command(before.command));
        resume(before.state);
      }
      return true;
    },
    ...(application === undefined ? {} : { endStep() {
      applicationOpen = false;
      const after = application.end(movementState());
      if (after.kind === "actor-removed") { removed = true; return false; }
      resume(after.state); return true;
    } }),
    event(event) { append({ kind: "event", value: { provider: options.id, sequence: motion.eventSequence, event, parameter: 0 } }); },
    animation(request) {
      const update = options.hooks.animation(request, context());
      animation = update.animation;
      for (const effect of update.effects) append(effect);
    },
    weapon() {
      const update = options.hooks.weapon(context());
      arsenal = update.arsenal; animation = update.animation; motion.pmFlags = update.movementFlags;
      for (const effect of update.effects) append(effect);
    },
    torso() {
      const update = options.hooks.torso(context());
      animation = update.animation;
      for (const effect of update.effects) append(effect);
    },
    firing() { return options.hooks.firing(context()); },
    contact(trace) {
      if (trace.hit.kind !== "none") append({ kind: "touch", target: trace.hit, substep });
    },
  }); } catch (error) { if (applicationOpen) application?.end(movementState(), true); throw error; }
  if (applicationOpen) application?.end(movementState());
  if (removed) return { kind: "q3", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects };
  return { kind: "q3", status: "active", actor: input.actor.id, commandSequence: input.commandSequence,
    state: movementState(),
    bounds: result.bounds, viewAngles: motion.viewangles, viewHeight: motion.viewheight, ground: motion.ground,
    waterLevel: result.waterlevel, waterType: result.watertype, horizontalSpeed: result.xyspeed,
    contacts: result.contacts.map(trace => ({ target: trace.hit, trace, substep })), effects, arsenal, animation };
}

export function createQ3MovementProvider(options: Q3MovementProviderOptions): Extract<MovementProvider, { readonly kind: "q3" }> {
  return { kind: "q3", id: options.id, move(input, services) { return move(input, services, options); } };
}
