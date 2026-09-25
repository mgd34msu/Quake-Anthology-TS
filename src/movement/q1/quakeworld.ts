import { clientMovementMode, clientMovementType, clientStanceCommand } from "../client-outputs.ts";
import { sweepBody } from "../swept-body.ts";
/* Ported from QuakeWorld/client/pmove.c and server/sv_user.c.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ProviderId } from "../../contracts/identity.ts";
import { sameActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { MovementProvider, MovementServices, MovementState, QwMovementInput, QwMovementResult, QwMovementState } from "../../contracts/movement.ts";
import type { QwUserCommand } from "../../contracts/protocol.ts";
import type { TraceHit, TraceResult } from "../../contracts/scene.ts";
import { MovementContext, NONE, ZERO } from "./common.ts";
import { finishMovement } from "./result.ts";
import { Q1_CONTENTS_EMPTY, Q1_CONTENTS_SLIME, Q1_CONTENTS_SOLID, Q1_CONTENTS_WATER, Q1_STEP_HEIGHT, type Q1MovementOptions } from "./types.ts";

export function* quakeWorldCommandSlices(command: QwUserCommand, maximumMilliseconds: number): Generator<QwUserCommand, void, unknown> {
  if (maximumMilliseconds < 1) throw new RangeError("QuakeWorld command interval must be positive");
  if (!Number.isInteger(command.milliseconds) || command.milliseconds < 0 || command.milliseconds > 255)
    throw new RangeError("QuakeWorld command milliseconds must fit its source byte");
  if (command.milliseconds > maximumMilliseconds) {
    const milliseconds = Math.floor(command.milliseconds / 2);
    yield* quakeWorldCommandSlices({ ...command, milliseconds }, maximumMilliseconds);
    yield* quakeWorldCommandSlices({ ...command, milliseconds, impulse: 0 }, maximumMilliseconds);
  } else yield command;
}

type MutableState = { -readonly [K in keyof QwMovementState]: QwMovementState[K] };

class QuakeWorldMove {
  state: MutableState;
  readonly context: MovementContext;
  private frameSeconds = 0;
  private forward: Vec3 = ZERO;
  private right: Vec3 = ZERO;
  private waterLevel = 0;
  private waterType = Q1_CONTENTS_EMPTY;
  private readonly touched: TraceHit[] = [];
  private command: QwUserCommand;
  constructor(readonly input: QwMovementInput, services: MovementServices, options: Q1MovementOptions) {
    this.state = { ...input.state };
    this.command = input.command;
    this.context = new MovementContext(input, services, options);
  }
  private setState(state: MovementState): void {
    if (state.kind !== "q1-quakeworld") throw new Error("QuakeWorld callback changed the movement provider during a command");
    this.state = { ...state };
    const mode = clientMovementMode(this.input.environment.clientOutputs, this.input.environment.health);
    if (mode !== undefined) { this.context.projectClientMode(); this.state.spectator = clientMovementType(this.input.kind, mode); }
  }
  private record(trace: TraceResult): void {
    this.context.contacts.push({ trace, target: trace.hit, substep: this.context.substep });
  }
  private flyMove(): number {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    const primal = s.velocity;
    let blocked = 0;
    const stop = sweepBody({
      read: () => s, writeOrigin: origin => { s.origin = origin; }, writeVelocity: velocity => { s.velocity = velocity; },
      trace: (start, end) => c.trace(start, end), normal: trace => trace.sourcePlane.normal,
      stopWhenStill: false, samePlane: (first, second) => first === second,
      collisionPolicy: { stopOnStartSolid: true, originalVelocity: "initial", creaseVelocity: "last-candidate" },
      impact: (trace, normal) => {
        this.record(trace);
        if (normal.z > 0.7) blocked |= 1;
        if (normal.z === 0) blocked |= 2;
      },
      math: { advance: (origin, time, velocity) => m.ma(origin, time, velocity),
        remaining: (time, fraction) => n.subtract(time, n.multiply(time, fraction)),
        clip: (velocity, normal) => m.clip(velocity, normal, 1), dot: (first, second) => m.dot(first, second),
        cross: (first, second) => m.cross(first, second), scale: (vector, amount) => m.scale(vector, amount) },
    }, this.frameSeconds);
    if (stop === "solid") return 3;
    if (s.waterJumpTimeSeconds !== 0) s.velocity = primal;
    return blocked;
  }
  private groundMove(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    s.velocity = m.vec(s.velocity.x, s.velocity.y, 0);
    if (s.velocity.x === 0 && s.velocity.y === 0) return;
    const destination = m.ma(s.origin, this.frameSeconds, s.velocity);
    let trace = c.trace(s.origin, destination);
    if (trace.fraction === 1) { s.origin = trace.end; return; }
    const original = s.origin, originalVelocity = s.velocity;
    this.flyMove();
    const down = s.origin, downVelocity = s.velocity;
    s.origin = original; s.velocity = originalVelocity;
    trace = c.trace(s.origin, m.add(s.origin, { x: 0, y: 0, z: Q1_STEP_HEIGHT }));
    if (!trace.startSolid && !trace.allSolid) s.origin = trace.end;
    this.flyMove();
    trace = c.trace(s.origin, m.add(s.origin, { x: 0, y: 0, z: -Q1_STEP_HEIGHT }));
    let useDown = trace.sourcePlane.normal.z < 0.7;
    if (!useDown) {
      if (!trace.startSolid && !trace.allSolid) s.origin = trace.end;
      const downDelta = m.sub(down, original), upDelta = m.sub(s.origin, original);
      const downDistance = n.add(n.multiply(downDelta.x, downDelta.x), n.multiply(downDelta.y, downDelta.y));
      const upDistance = n.add(n.multiply(upDelta.x, upDelta.x), n.multiply(upDelta.y, upDelta.y));
      useDown = downDistance > upDistance;
    }
    if (useDown) { s.origin = down; s.velocity = downVelocity; }
    else s.velocity = m.vec(s.velocity.x, s.velocity.y, downVelocity.z);
  }
  private friction(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    if (s.waterJumpTimeSeconds !== 0) return;
    const speed = m.length(s.velocity);
    if (speed < 1) { s.velocity = m.vec(0, 0, s.velocity.z); return; }
    let friction = p.friction;
    if (s.ground.kind !== "none") {
      const start = m.vec(n.add(s.origin.x, n.multiply(n.divide(s.velocity.x, speed), 16)),
        n.add(s.origin.y, n.multiply(n.divide(s.velocity.y, speed), 16)), n.add(s.origin.z, c.bounds.min.z));
      // QW uses the player hull here; NetQuake uses a point trace.
      if (c.trace(start, m.add(start, { x: 0, y: 0, z: -34 })).fraction === 1) friction = n.multiply(friction, 2);
    }
    let drop = 0;
    if (this.waterLevel >= 2) drop = n.multiply(n.multiply(n.multiply(speed, p.waterFriction), this.waterLevel), this.frameSeconds);
    else if (s.ground.kind !== "none") drop = n.multiply(n.multiply(Math.max(speed, p.stopSpeed), friction), this.frameSeconds);
    s.velocity = m.scale(s.velocity, n.divide(Math.max(0, n.subtract(speed, drop)), speed));
  }
  private accelerate(direction: Vec3, speed: number, acceleration: number, air = false): void {
    const m = this.context.math, n = m.n, s = this.state;
    if (s.dead || s.waterJumpTimeSeconds !== 0) return;
    const add = n.subtract(air ? Math.min(speed, 30) : speed, m.dot(s.velocity, direction));
    if (add <= 0) return;
    const amount = Math.min(add, air ? n.multiply(n.multiply(acceleration, speed), this.frameSeconds)
      : n.multiply(n.multiply(acceleration, this.frameSeconds), speed));
    s.velocity = m.ma(s.velocity, amount, direction);
  }
  private wishVelocity(): Vec3 {
    const m = this.context.math, n = m.n, command = this.command;
    return m.vec(n.add(n.multiply(this.forward.x, this.context.speed(command.forwardMove)), n.multiply(this.right.x, this.context.speed(command.sideMove))),
      n.add(n.multiply(this.forward.y, this.context.speed(command.forwardMove)), n.multiply(this.right.y, this.context.speed(command.sideMove))),
      n.add(n.multiply(this.forward.z, this.context.speed(command.forwardMove)), n.multiply(this.right.z, this.context.speed(command.sideMove))));
  }
  private waterMove(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state, command = this.command, p = this.input.profile.parameters;
    let wish = this.wishVelocity();
    wish = m.vec(wish.x, wish.y, n.add(wish.z, command.forwardMove === 0 && command.sideMove === 0 && command.upMove === 0 ? -60 : this.context.speed(command.upMove)));
    const normalized = m.normalize(wish), speed = n.multiply(Math.min(normalized.length, this.context.speed(p.maxSpeed)), 0.7);
    this.accelerate(normalized.direction, speed, p.waterAccelerate);
    const destination = m.ma(s.origin, this.frameSeconds, s.velocity);
    const start = m.add(destination, { x: 0, y: 0, z: Q1_STEP_HEIGHT + 1 });
    const trace = c.trace(start, destination);
    if (!trace.startSolid && !trace.allSolid) { s.origin = trace.end; return; }
    this.flyMove();
  }
  private airMove(): void {
    const m = this.context.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    this.forward = m.normalize(m.vec(this.forward.x, this.forward.y, 0)).direction;
    this.right = m.normalize(m.vec(this.right.x, this.right.y, 0)).direction;
    const wish = m.normalize(this.wishVelocity()), speed = Math.min(wish.length, this.context.speed(p.maxSpeed));
    const gravity = n.multiply(n.multiply(n.multiply(p.entityGravity, this.input.environment.gravityMultiplier), p.gravity), this.frameSeconds);
    if (s.ground.kind !== "none") {
      s.velocity = m.vec(s.velocity.x, s.velocity.y, 0);
      this.accelerate(wish.direction, speed, p.accelerate);
      s.velocity = m.vec(s.velocity.x, s.velocity.y, n.subtract(s.velocity.z, gravity));
      this.groundMove();
    } else {
      // Original pmove.c uses accelerate here; airaccelerate is transmitted but unused.
      this.accelerate(wish.direction, speed, p.accelerate, true);
      s.velocity = m.vec(s.velocity.x, s.velocity.y, n.subtract(s.velocity.z, gravity));
      this.flyMove();
    }
  }
  private categorize(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    if (s.velocity.z > 180) s.ground = NONE;
    else {
      const trace = c.trace(s.origin, m.add(s.origin, { x: 0, y: 0, z: -1 }));
      s.ground = trace.sourcePlane.normal.z < 0.7 ? NONE : trace.hit;
      if (s.ground.kind !== "none") {
        s.waterJumpTimeSeconds = 0;
        if (!trace.startSolid && !trace.allSolid) s.origin = trace.end;
      }
      if (trace.hit.kind === "actor") this.record(trace);
    }
    this.waterLevel = 0; this.waterType = Q1_CONTENTS_EMPTY;
    let point = m.vec(s.origin.x, s.origin.y, n.add(n.add(s.origin.z, c.bounds.min.z), 1));
    const contents = c.contents(point);
    if (contents > Q1_CONTENTS_WATER) return;
    this.waterType = contents; this.waterLevel = 1;
    point = m.vec(point.x, point.y, n.add(s.origin.z, n.multiply(n.add(c.bounds.min.z, c.bounds.max.z), 0.5)));
    if (c.contents(point) > Q1_CONTENTS_WATER) return;
    this.waterLevel = 2;
    point = m.vec(point.x, point.y, n.add(s.origin.z, c.viewHeight));
    if (c.contents(point) <= Q1_CONTENTS_WATER) this.waterLevel = 3;
  }
  private jump(): void {
    const m = this.context.math, n = m.n, s = this.state;
    if (s.dead) { s.oldButtons |= 2; return; }
    if (s.waterJumpTimeSeconds !== 0) {
      s.waterJumpTimeSeconds = Math.max(0, n.subtract(s.waterJumpTimeSeconds, this.frameSeconds)); return;
    }
    if (this.waterLevel >= 2) {
      s.ground = NONE;
      s.velocity = m.vec(s.velocity.x, s.velocity.y, this.waterType === Q1_CONTENTS_WATER ? 100 : this.waterType === Q1_CONTENTS_SLIME ? 80 : 50);
      return;
    }
    if (s.ground.kind === "none" || (s.oldButtons & 2) !== 0) return;
    s.ground = NONE;
    s.velocity = m.vec(s.velocity.x, s.velocity.y, n.add(s.velocity.z, 270));
    s.oldButtons |= 2;
  }
  private checkWaterJump(): void {
    const c = this.context, m = c.math, s = this.state;
    if (s.waterJumpTimeSeconds !== 0 || s.velocity.z < -180) return;
    const forward = m.normalize(m.vec(this.forward.x, this.forward.y, 0)).direction;
    const spot = m.add(m.ma(s.origin, 24, forward), { x: 0, y: 0, z: 8 });
    if (c.contents(spot) !== Q1_CONTENTS_SOLID || c.contents(m.add(spot, { x: 0, y: 0, z: 24 })) !== Q1_CONTENTS_EMPTY) return;
    const velocity = m.scale(forward, 50);
    s.velocity = m.vec(velocity.x, velocity.y, 310);
    s.waterJumpTimeSeconds = 2; s.oldButtons |= 2;
  }
  private nudge(): void {
    const c = this.context, m = c.math, s = this.state, base = s.origin;
    // Source loops use the unsnapped base, including the initial zero-offset try.
    for (const z of [0, -1, 1]) for (const x of [0, -1, 1]) for (const y of [0, -1, 1]) {
      s.origin = m.add(base, { x: x / 8, y: y / 8, z: z / 8 });
      if (c.positionFree(s.origin)) return;
    }
    s.origin = base;
  }
  private spectatorMove(collide = false): void {
    const m = this.context.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    const speed = m.length(s.velocity);
    if (speed < 1) s.velocity = ZERO;
    else {
      const friction = n.multiply(p.friction, 1.5);
      const drop = n.multiply(n.multiply(Math.max(speed, p.stopSpeed), friction), this.frameSeconds);
      s.velocity = m.scale(s.velocity, n.divide(Math.max(0, n.subtract(speed, drop)), speed));
    }
    this.forward = m.normalize(this.forward).direction; this.right = m.normalize(this.right).direction;
    let wish = this.wishVelocity();
    wish = m.vec(wish.x, wish.y, n.add(wish.z, this.context.speed(this.command.upMove)));
    const normalized = m.normalize(wish), wishSpeed = Math.min(normalized.length, collide ? this.context.speed(p.maxSpeed) : this.context.speed(p.spectatorMaxSpeed));
    const add = n.subtract(wishSpeed, m.dot(s.velocity, normalized.direction));
    // This early return also skips origin integration in original SpectatorMove.
    if (add <= 0 && !collide) return;
    const acceleration = Math.max(0, Math.min(add, n.multiply(n.multiply(p.accelerate, this.frameSeconds), wishSpeed)));
    s.velocity = m.ma(s.velocity, acceleration, normalized.direction);
    if (collide) this.flyMove(); else s.origin = m.ma(s.origin, this.frameSeconds, s.velocity);
  }
  private alreadyTouched(hit: TraceHit): boolean {
    return this.touched.some(prior => prior.kind === "world" && hit.kind === "world" ? prior.model === hit.model
      : prior.kind === "actor" && hit.kind === "actor" ? sameActor(prior.actor, hit.actor) : false);
  }
  private step(command: QwUserCommand): void {
    const application = this.input.execution === "authoritative" ? this.context.services.inputApplication : undefined;
    if (application === undefined) { this.stepPhysics(command); return; }
    try {
      const before = application.begin(command, { ...this.input.frame, elapsed: { kind: "milliseconds", value: command.milliseconds } }, this.state);
      if (before.kind === "actor-removed") this.context.removed = true; else { if (before.command.kind !== "q1-quakeworld") throw new Error("Input output changed command dialect"); this.setState(before.state); this.stepPhysics(before.command); }
    } catch (error) { application.end(this.state, true); throw error; }
    const after = application.end(this.state);
    if (after.kind === "actor-removed") this.context.removed = true; else this.setState(after.state);
  }
  private stepPhysics(command: QwUserCommand): void {
    const c = this.context;
    this.command = command;
    this.frameSeconds = c.math.n.multiply(command.milliseconds, 0.001);
    this.setState(c.lifecycle(this.state, "beforePhysics", { ...this.input, command,
      frame: { ...this.input.frame, elapsed: { kind: "milliseconds", value: command.milliseconds } } }));
    if (c.removed) return;
    const effective = clientStanceCommand(command, this.input.environment.clientOutputs?.stance);
    if (effective.kind !== "q1-quakeworld") throw new Error("Client stance changed movement dialect");
    command = effective; this.command = command;
    // CL_PredictUsercmd seeds pmove.angles before PlayerMove computes its axes.
    if (this.input.execution === "prediction") this.state.angles = c.math.vec(command.angles.x, command.angles.y, command.angles.z);
    const axes = c.math.angles(this.state.angles);
    this.forward = axes.forward; this.right = axes.right;
    const mode = clientMovementMode(this.input.environment.clientOutputs, this.input.environment.health);
    if (mode === "freeze") { this.state.velocity = ZERO; return; }
    if (this.state.spectator !== 0) { this.spectatorMove(); return; }
    const contactStart = c.contacts.length;
    if (this.input.environment.pose === undefined) this.nudge();
    this.state.angles = c.math.vec(command.angles.x, command.angles.y, command.angles.z);
    this.categorize();
    if (this.input.environment.pose !== undefined) this.state.velocity = ZERO;
    else if (this.input.environment.flight && this.input.environment.health > 0) {
      this.state.ground = NONE; this.state.waterJumpTimeSeconds = 0; this.spectatorMove(true);
    } else {
    if (this.waterLevel === 2) this.checkWaterJump();
    if (this.state.velocity.z < 0) this.state.waterJumpTimeSeconds = 0;
    if ((command.buttons & 2) !== 0) this.jump(); else this.state.oldButtons &= ~2;
    this.friction();
    if (this.waterLevel >= 2) this.waterMove(); else this.airMove();
    }
    this.categorize();
    c.options.hooks?.qwState?.(this.waterLevel, this.waterType);
    this.setState(c.link(this.state, true));
    // QW records impacts during PMove, then invokes each target once after linking.
    for (const contact of c.contacts.slice(contactStart)) {
      if (c.removed) break;
      if (contact.target.kind === "none" || this.alreadyTouched(contact.target)) continue;
      this.touched.push(contact.target);
      this.setState(c.touch(contact.trace, this.state, false));
    }
  }
  private runCommand(command: QwUserCommand): void {
    if (this.context.removed) return;
    const clock = this.input.profile.clock;
    if (clock.kind !== "q1-quakeworld") throw new Error("QuakeWorld movement needs a QuakeWorld command clock");
    for (const slice of quakeWorldCommandSlices(command, clock.maximumCommandMilliseconds)) {
      if (this.context.removed) break;
      this.step(slice); this.context.substep++;
    }
  }

  run(): QwMovementResult {
    if (!Number.isInteger(this.input.command.milliseconds) || this.input.command.milliseconds < 0 || this.input.command.milliseconds > 255) {
      throw new RangeError("QuakeWorld command milliseconds must fit its source byte");
    }
    this.runCommand(this.input.command);
    this.setState(this.context.lifecycle(this.state, "afterPhysics"));
    if (this.context.removed) return { kind: "q1-quakeworld", status: "actor-removed", actor: this.input.actor.id,
      commandSequence: this.input.commandSequence, effects: this.context.effects };
    const result = finishMovement(this.context, this.state, this.state.angles, this.state.ground, this.waterLevel, this.waterType);
    if (result.kind !== "q1-quakeworld") throw new Error("Weapon callback changed QuakeWorld movement family");
    return result;
  }
}

export function moveQuakeWorld(input: QwMovementInput, services: MovementServices, options: Q1MovementOptions = {}): QwMovementResult {
  return new QuakeWorldMove(input, services, options).run();
}
export function createQwMovementProvider(id: ProviderId, options: Q1MovementOptions = {}): Extract<MovementProvider, { readonly kind: "q1-quakeworld" }> {
  return { kind: "q1-quakeworld", id, move: (input, services) => moveQuakeWorld(input, services, options) };
}
