import { sweepBody } from "../swept-body.ts";
import { q1WaterTransition } from "./water-transition.ts";
/* Ported from WinQuake/sv_user.c, sv_phys.c and rerelease donor extensions.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { MovementProvider, MovementServices, MovementState, Q1MovementInput, Q1MovementResult, Q1MovementState } from "../../contracts/movement.ts";
import type { TraceResult } from "../../contracts/scene.ts";
import { MovementContext, NONE, ZERO, seconds } from "./common.ts";
import { finishMovement } from "./result.ts";
import { q1CheckWaterJump, q1PlayerJump } from "./player-actions.ts";
import { Q1_CONTENTS_EMPTY, Q1_CONTENTS_WATER, Q1_FLAG_FLY, Q1_FLAG_JUMPRELEASED, Q1_FLAG_ONGROUND, Q1_FLAG_SWIM, Q1_FLAG_WATERJUMP,
  Q1_MOVE_BOUNCE, Q1_MOVE_FLY, Q1_MOVE_FLYMISSILE, Q1_MOVE_GIB, Q1_MOVE_NOCLIP, Q1_MOVE_NONE,
  Q1_MOVE_STEP, Q1_MOVE_TOSS, Q1_MOVE_WALK, Q1_STEP_HEIGHT, type Q1MovementOptions } from "./types.ts";

type MutableState = { -readonly [K in keyof Q1MovementState]: Q1MovementState[K] };
interface FlyResult { readonly blocked: number; readonly stepTrace: TraceResult | null; }

class NetQuakeMove {
  state: MutableState;
  readonly context: MovementContext;
  readonly frameSeconds: number;
  readonly timeSeconds: number;
  constructor(readonly input: Q1MovementInput, services: MovementServices, options: Q1MovementOptions) {
    if (input.profile.edition === "quake64") throw new Error("Quake64 movement requires a qualified source physics profile");
    if (input.profile.clock.kind !== "q1-netquake") throw new Error("NetQuake movement requires a NetQuake frame clock");
    this.state = { ...input.state };
    if (input.environment.flight && input.environment.health > 0 && this.state.moveType === Q1_MOVE_WALK) this.state.moveType = Q1_MOVE_FLY;
    this.context = new MovementContext(input, services, options);
    // The shared frame owner already applies host minimum/maximum/fixed frame rules.
    this.frameSeconds = seconds(input.frame.elapsed);
    this.timeSeconds = seconds(input.frame.time);
    if (!Number.isFinite(this.frameSeconds) || this.frameSeconds < 0) throw new RangeError("Invalid NetQuake frame interval");
  }
  private setState(state: MovementState): void {
    if (state.kind !== "q1-netquake") throw new Error("NetQuake callback changed the movement provider during a frame");
    Object.assign(this.state, state);
    if (this.input.environment.flight && this.input.environment.health > 0 && this.state.moveType === Q1_MOVE_WALK) this.state.moveType = Q1_MOVE_FLY;
  }
  private link(touchTriggers: boolean): void { this.setState(this.context.link(this.state, touchTriggers)); }
  private impact(trace: TraceResult): void { this.setState(this.context.touch(trace, this.state)); }
  private think(): boolean {
    this.setState(this.context.lifecycle(this.state, "think"));
    return !this.context.removed;
  }
  private velocityBounds(): void {
    const m = this.context.math, s = this.state, maximum = this.context.options.maxVelocity ?? 2000;
    const coordinate = (value: number) => Number.isFinite(m.n.store(value)) ? value : 0;
    const velocity = (value: number) => Math.max(-maximum, Math.min(maximum, coordinate(value)));
    s.origin = m.vec(coordinate(s.origin.x), coordinate(s.origin.y), coordinate(s.origin.z));
    s.velocity = m.vec(velocity(s.velocity.x), velocity(s.velocity.y), velocity(s.velocity.z));
  }
  private gravity(): void {
    const m = this.context.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    const entityGravity = p.entityGravity === 0 ? 1 : p.entityGravity;
    const gravity = n.multiply(n.multiply(n.multiply(entityGravity, this.input.environment.gravityMultiplier), p.gravity), this.frameSeconds);
    s.velocity = m.vec(s.velocity.x, s.velocity.y, n.subtract(s.velocity.z, gravity));
  }
  private flyMove(time: number): FlyResult {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    let blocked = 0;
    let stepTrace: TraceResult | null = null;
    const stop = sweepBody({
      read: () => c.removed ? null : s,
      writeOrigin: origin => { s.origin = origin; }, writeVelocity: velocity => { s.velocity = velocity; },
      trace: (start, end) => c.trace(start, end), stopWhenStill: true,
      normal: trace => {
        if (trace.hit.kind === "none") throw new Error("NetQuake slide trace blocked without a hit");
        return trace.sourcePlane.normal;
      },
      samePlane: (first, second) => first === second,
      impact: (trace, normal) => {
        if (normal.z > 0.7) {
          blocked |= 1;
          if (c.isBsp(trace.hit)) { s.flags |= Q1_FLAG_ONGROUND; s.ground = trace.hit; }
        }
        if (normal.z === 0) { blocked |= 2; stepTrace = trace; }
        this.impact(trace);
      },
      math: { advance: (origin, time, velocity) => m.ma(origin, time, velocity),
        remaining: (time, fraction) => n.subtract(time, n.multiply(time, fraction)),
        clip: (velocity, normal) => m.clip(velocity, normal, 1), dot: (first, second) => m.dot(first, second),
        cross: (first, second) => m.cross(first, second), scale: (vector, amount) => m.scale(vector, amount) },
    }, time);
    if (stop === "solid" || stop === "plane-limit") blocked = 3;
    else if (stop === "crease-blocked") blocked = 7;
    return { blocked, stepTrace };
  }
  private pushEntity(push: Vec3): TraceResult {
    const c = this.context, s = this.state;
    const trace = c.trace(s.origin, c.math.add(s.origin, push), c.shape,
      s.moveType === Q1_MOVE_FLYMISSILE ? "missile" : c.options.solid === "not" || c.options.solid === "trigger" ? "no-monsters" : "normal");
    s.origin = trace.end;
    this.link(true);
    if (!c.removed && trace.hit.kind !== "none") this.impact(trace);
    return trace;
  }
  private checkStuck(): void {
    const c = this.context, s = this.state;
    if (c.positionFree(s.origin)) { s.oldOrigin = s.origin; return; }
    const original = s.origin;
    s.origin = s.oldOrigin;
    if (c.positionFree(s.origin)) { this.link(true); return; }
    for (let z = 0; z < 18; z++) for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      s.origin = c.math.add(original, { x, y, z });
      if (c.positionFree(s.origin)) { this.link(true); return; }
    }
    s.origin = original;
  }
  private checkWater(): boolean {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    let point = m.vec(s.origin.x, s.origin.y, n.add(n.add(s.origin.z, c.bounds.min.z), 1));
    s.waterLevel = 0; s.waterType = Q1_CONTENTS_EMPTY;
    const contents = c.contents(point);
    if (contents <= Q1_CONTENTS_WATER) {
      s.waterType = contents; s.waterLevel = 1;
      point = m.vec(point.x, point.y, n.add(s.origin.z, n.multiply(n.add(c.bounds.min.z, c.bounds.max.z), 0.5)));
      if (c.contents(point) <= Q1_CONTENTS_WATER) {
        s.waterLevel = 2;
        point = m.vec(point.x, point.y, n.add(s.origin.z, c.viewHeight));
        if (c.contents(point) <= Q1_CONTENTS_WATER) s.waterLevel = 3;
      }
    }
    return s.waterLevel > 1;
  }
  private wallFriction(trace: TraceResult): void {
    const m = this.context.math, n = m.n, s = this.state;
    const direction = m.angles(s.viewAngles).forward;
    const d = n.add(m.dot(trace.sourcePlane.normal, direction), 0.5);
    if (d >= 0) return;
    const into = m.scale(trace.sourcePlane.normal, m.dot(trace.sourcePlane.normal, s.velocity));
    const side = m.sub(s.velocity, into);
    s.velocity = m.vec(n.multiply(side.x, n.add(1, d)), n.multiply(side.y, n.add(1, d)), s.velocity.z);
  }
  private tryUnstick(oldVelocity: Vec3): FlyResult {
    const c = this.context, s = this.state, original = s.origin;
    const directions: readonly Vec3[] = [ { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: -2, y: 0, z: 0 },
      { x: 0, y: -2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: -2, y: 2, z: 0 }, { x: 2, y: -2, z: 0 }, { x: -2, y: -2, z: 0 } ];
    for (const direction of directions) {
      this.pushEntity(direction);
      if (c.removed) return { blocked: 7, stepTrace: null };
      s.velocity = c.math.vec(oldVelocity.x, oldVelocity.y, 0);
      const clip = this.flyMove(0.1);
      if (c.removed || Math.abs(original.y - s.origin.y) > 4 || Math.abs(original.x - s.origin.x) > 4) return clip;
      s.origin = original;
    }
    s.velocity = ZERO;
    return { blocked: 7, stepTrace: null };
  }
  private walkMove(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    const oldOnGround = (s.flags & Q1_FLAG_ONGROUND) !== 0;
    s.flags &= ~Q1_FLAG_ONGROUND;
    const original = s.origin, oldVelocity = s.velocity;
    let clip = this.flyMove(this.frameSeconds);
    if (c.removed || (clip.blocked & 2) === 0 || (!oldOnGround && s.waterLevel === 0)
      || s.moveType !== Q1_MOVE_WALK || c.options.noStep === true || (s.flags & Q1_FLAG_WATERJUMP) !== 0) return;
    const noStepOrigin = s.origin, noStepVelocity = s.velocity;
    s.origin = original;
    this.pushEntity({ x: 0, y: 0, z: Q1_STEP_HEIGHT });
    if (c.removed) return;
    s.velocity = m.vec(oldVelocity.x, oldVelocity.y, 0);
    clip = this.flyMove(this.frameSeconds);
    if (c.removed) return;
    if (clip.blocked !== 0 && Math.abs(original.y - s.origin.y) < 0.03125 && Math.abs(original.x - s.origin.x) < 0.03125) {
      const unstick = this.tryUnstick(oldVelocity);
      clip = { blocked: unstick.blocked, stepTrace: clip.stepTrace };
    }
    if (c.removed) return;
    if ((clip.blocked & 2) !== 0 && clip.stepTrace !== null) this.wallFriction(clip.stepTrace);
    const down = this.pushEntity({ x: 0, y: 0, z: n.add(-Q1_STEP_HEIGHT, n.multiply(oldVelocity.z, this.frameSeconds)) });
    if (c.removed) return;
    if (down.sourcePlane.normal.z > 0.7) {
      // WinQuake checks the player's SOLID_BSP here, not the hit's solid type.
      if (c.options.solid === "bsp") { s.flags |= Q1_FLAG_ONGROUND; s.ground = down.hit; }
    } else { s.origin = noStepOrigin; s.velocity = noStepVelocity; }
  }
  private friction(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    const speed = m.horizontal(s.velocity);
    if (speed === 0) return;
    const start = m.vec(n.add(s.origin.x, n.multiply(n.divide(s.velocity.x, speed), 16)),
      n.add(s.origin.y, n.multiply(n.divide(s.velocity.y, speed), 16)), n.add(s.origin.z, c.bounds.min.z));
    const trace = c.trace(start, m.add(start, { x: 0, y: 0, z: -34 }), { kind: "point" }, "no-monsters");
    const friction = trace.fraction === 1 ? n.multiply(p.friction, this.input.profile.edgeFriction) : p.friction;
    const newSpeed = Math.max(0, n.subtract(speed, n.multiply(n.multiply(this.frameSeconds, Math.max(speed, p.stopSpeed)), friction)));
    s.velocity = m.scale(s.velocity, n.divide(newSpeed, speed));
  }
  private accelerate(direction: Vec3, speed: number, air: boolean): void {
    const m = this.context.math, n = m.n, s = this.state, p = this.input.profile.parameters;
    const add = n.subtract(air ? Math.min(m.length(direction), 30) : speed, m.dot(s.velocity, air ? m.normalize(direction).direction : direction));
    if (add <= 0) return;
    const acceleration = Math.min(add, air ? n.multiply(n.multiply(p.accelerate, speed), this.frameSeconds)
      : n.multiply(n.multiply(p.accelerate, this.frameSeconds), speed));
    s.velocity = m.ma(s.velocity, acceleration, air ? m.normalize(direction).direction : direction);
  }
  private waterMove(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state, p = this.input.profile.parameters, command = this.input.command;
    const axes = m.angles(s.viewAngles);
    let wish = m.vec(n.add(n.multiply(axes.forward.x, command.forwardMove), n.multiply(axes.right.x, command.sideMove)),
      n.add(n.multiply(axes.forward.y, command.forwardMove), n.multiply(axes.right.y, command.sideMove)),
      n.add(n.multiply(axes.forward.z, command.forwardMove), n.multiply(axes.right.z, command.sideMove)));
    wish = m.vec(wish.x, wish.y, n.add(wish.z, command.forwardMove === 0 && command.sideMove === 0 && command.upMove === 0 ? -60 : command.upMove));
    let wishSpeed = m.length(wish);
    if (wishSpeed > p.maxSpeed) { wish = m.scale(wish, n.divide(p.maxSpeed, wishSpeed)); wishSpeed = p.maxSpeed; }
    wishSpeed = n.multiply(wishSpeed, 0.7);
    const speed = m.length(s.velocity);
    let newSpeed = 0;
    if (speed !== 0) {
      newSpeed = Math.max(0, n.subtract(speed, n.multiply(n.multiply(this.frameSeconds, speed), p.friction)));
      s.velocity = m.scale(s.velocity, n.divide(newSpeed, speed));
    }
    if (wishSpeed === 0) return;
    const add = n.subtract(wishSpeed, newSpeed);
    if (add <= 0) return;
    const acceleration = Math.min(add, n.multiply(n.multiply(p.accelerate, wishSpeed), this.frameSeconds));
    s.velocity = m.ma(s.velocity, acceleration, m.normalize(wish).direction);
  }
  private airMove(): void {
    const m = this.context.math, n = m.n, s = this.state, command = this.input.command, p = this.input.profile.parameters;
    const axes = m.angles(s.angles);
    const forwardMove = this.timeSeconds < s.teleportTimeSeconds && command.forwardMove < 0 ? 0 : command.forwardMove;
    let wish = m.vec(n.add(n.multiply(axes.forward.x, forwardMove), n.multiply(axes.right.x, command.sideMove)),
      n.add(n.multiply(axes.forward.y, forwardMove), n.multiply(axes.right.y, command.sideMove)), s.moveType === Q1_MOVE_WALK ? 0 : command.upMove);
    const normalized = m.normalize(wish);
    let wishSpeed = normalized.length;
    if (wishSpeed > p.maxSpeed) { wish = m.scale(wish, n.divide(p.maxSpeed, wishSpeed)); wishSpeed = p.maxSpeed; }
    if (s.moveType === Q1_MOVE_NOCLIP) s.velocity = wish;
    else if ((s.flags & Q1_FLAG_ONGROUND) !== 0) { this.friction(); this.accelerate(normalized.direction, wishSpeed, false); }
    else this.accelerate(wish, wishSpeed, true);
  }
  private alternateNoclip(): void {
    const m = this.context.math, n = m.n, s = this.state, command = this.input.command;
    const axes = m.angles(s.viewAngles);
    const wish = m.vec(n.add(n.multiply(axes.forward.x, command.forwardMove), n.multiply(axes.right.x, command.sideMove)),
      n.add(n.multiply(axes.forward.y, command.forwardMove), n.multiply(axes.right.y, command.sideMove)),
      n.add(n.add(n.multiply(axes.forward.z, command.forwardMove), n.multiply(axes.right.z, command.sideMove)), n.multiply(command.upMove, 2)));
    const normalized = m.normalize(wish);
    s.velocity = normalized.length > this.input.profile.parameters.maxSpeed ? m.scale(normalized.direction, this.input.profile.parameters.maxSpeed) : wish;
  }
  private clientThink(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    if (s.moveType === Q1_MOVE_NONE) return;
    const sourcePunch = c.options.sourcePunchAngles;
    if (sourcePunch !== undefined) s.punchAngles = sourcePunch;
    else {
      const punch = m.normalize(s.punchAngles);
      s.punchAngles = m.scale(punch.direction, Math.max(0, n.subtract(punch.length, n.multiply(10, this.frameSeconds))));
    }
    if (s.health <= 0) return;
    const angles = m.add(s.viewAngles, s.punchAngles);
    const side = m.dot(s.velocity, m.angles(s.angles).right), sign = side < 0 ? -1 : 1;
    const rollSpeed = c.options.rollSpeed ?? 200, rollAngle = c.options.rollAngle ?? 2;
    const roll = n.multiply(n.multiply(Math.abs(side) < rollSpeed ? n.divide(n.multiply(Math.abs(side), rollAngle), rollSpeed) : rollAngle, sign), 4);
    if (!s.fixAngle) s.angles = m.vec(n.divide(-angles.x, 3), angles.y, roll);
    else if ((c.options.fixAngleRoll ?? "source") === "source") s.angles = m.vec(s.angles.x, s.angles.y, roll);
    if ((s.flags & Q1_FLAG_WATERJUMP) !== 0) {
      if (this.timeSeconds > s.teleportTimeSeconds || s.waterLevel === 0) { s.flags &= ~Q1_FLAG_WATERJUMP; s.teleportTimeSeconds = 0; }
      s.velocity = m.vec(s.waterJumpDirection.x, s.waterJumpDirection.y, s.velocity.z);
      return;
    }
    if (s.moveType === Q1_MOVE_NOCLIP && this.input.profile.noClipAngleHack) this.alternateNoclip();
    else if (s.waterLevel >= 2 && s.moveType !== Q1_MOVE_NOCLIP) this.waterMove();
    else this.airMove();
  }
  private playerActions(): void {
    const c = this.context, s = this.state;
    if (c.options.jumpAuthority === "source-gamecode" || s.health <= 0 || c.viewHeight === 0 || s.moveType !== Q1_MOVE_WALK) return;
    if (s.waterLevel === 2) this.setState(q1CheckWaterJump({ ...this.input, state: s }, c.services, c.options));
    if ((this.input.command.buttons & 2) !== 0) {
      const result = q1PlayerJump(s, c.services);
      this.setState(result.state);
      if (result.action !== "none") c.options.hooks?.playerAction?.(this.input.actor, result.action, s);
    } else s.flags |= Q1_FLAG_JUMPRELEASED;
  }
  private idealPitch(): void {
    const c = this.context, m = c.math, n = m.n, s = this.state;
    if ((s.flags & Q1_FLAG_ONGROUND) === 0) return;
    const radians = n.divide(n.multiply(n.multiply(s.angles.y, Math.PI), 2), 360);
    const sine = Math.sin(radians), cosine = Math.cos(radians), heights: number[] = [];
    for (let i = 0; i < 6; i++) {
      const top = m.vec(n.add(s.origin.x, n.multiply(n.multiply(cosine, i + 3), 12)),
        n.add(s.origin.y, n.multiply(n.multiply(sine, i + 3), 12)), n.add(s.origin.z, c.viewHeight));
      const bottom = m.add(top, { x: 0, y: 0, z: -160 });
      const trace = c.trace(top, bottom, { kind: "point" }, "no-monsters");
      if (trace.allSolid || trace.fraction === 1) return;
      heights.push(n.store(n.add(top.z, n.multiply(trace.fraction, n.subtract(bottom.z, top.z)))));
    }
    let direction = 0, steps = 0, previous = heights[0];
    if (previous === undefined) return;
    for (const height of heights.slice(1)) {
      const step = n.subtract(height, previous); previous = height;
      if (step > -0.1 && step < 0.1) continue;
      if (direction !== 0 && Math.abs(n.subtract(step, direction)) > 0.1) return;
      steps++; direction = step;
    }
    if (direction === 0) s.idealPitch = 0;
    else if (steps >= 2) s.idealPitch = n.store(n.multiply(-direction, c.options.idealPitchScale ?? 0.8));
  }
  private waterTransition(): void {
    const s = this.state, contents = this.context.contents(s.origin);
    const transition = q1WaterTransition(s.waterType, contents);
    if (transition.splash) this.context.options.hooks?.sound?.(this.input.actor, "misc/h2ohit1.wav", s);
    s.waterType = transition.waterType; s.waterLevel = transition.waterLevel;
  }
  private toss(): void {
    const c = this.context, m = c.math, s = this.state;
    if ((s.flags & Q1_FLAG_ONGROUND) !== 0) return;
    this.velocityBounds();
    if (s.moveType !== Q1_MOVE_FLY && s.moveType !== Q1_MOVE_FLYMISSILE) this.gravity();
    s.angles = m.ma(s.angles, this.frameSeconds, s.angularVelocity);
    const trace = this.pushEntity(m.scale(s.velocity, this.frameSeconds));
    if (trace.fraction === 1 || c.removed) return;
    const bounces = s.moveType === Q1_MOVE_BOUNCE || (s.moveType === Q1_MOVE_GIB && this.input.profile.edition === "rerelease");
    s.velocity = m.clip(s.velocity, trace.sourcePlane.normal, bounces ? 1.5 : 1);
    if (trace.sourcePlane.normal.z > 0.7 && (s.velocity.z < 60 || !bounces)) {
      s.flags |= Q1_FLAG_ONGROUND; s.ground = trace.hit; s.velocity = ZERO; s.angularVelocity = ZERO;
    }
    this.waterTransition();
  }
  prepare(): Q1MovementState {
    const c = this.context;
    this.state.viewAngles = c.math.vec(this.input.command.viewAngles.x, this.input.command.viewAngles.y, this.input.command.viewAngles.z);
    this.clientThink();
    return this.state;
  }
  physics(): Q1MovementResult { return this.physicsStep(); }
  private physicsStep(): Q1MovementResult {
    const c = this.context, s = this.state;
    this.setState(c.lifecycle(s, "beforePhysics"));
    if (!c.removed && this.input.environment.pose === undefined) this.playerActions();
    // Preserve the existing extension paths; the branch-local order below is SV_Physics_Client's classic set.
    const extensionThink = s.moveType === Q1_MOVE_STEP || s.moveType === Q1_MOVE_FLYMISSILE || s.moveType === Q1_MOVE_GIB;
    if (!c.removed && extensionThink) this.think();
    const think = (): boolean => extensionThink ? !c.removed : this.think();
    if (!c.removed) {
      this.velocityBounds();
      if (this.input.environment.pose !== undefined) {
        if (think()) { s.velocity = ZERO; this.checkWater(); }
      } else switch (s.moveType) {
        case Q1_MOVE_NONE: think(); break;
        case Q1_MOVE_WALK:
          if (!think()) break;
          if (!this.checkWater() && (s.flags & Q1_FLAG_WATERJUMP) === 0) this.gravity();
          this.checkStuck();
          if (!c.removed) this.walkMove();
          break;
        case Q1_MOVE_FLY: if (think()) this.flyMove(this.frameSeconds); break;
        case Q1_MOVE_NOCLIP: if (think()) s.origin = c.math.ma(s.origin, this.frameSeconds, s.velocity); break;
        case Q1_MOVE_TOSS: case Q1_MOVE_BOUNCE: if (think()) this.toss(); break;
        case Q1_MOVE_FLYMISSILE: this.toss(); break;
        case Q1_MOVE_GIB:
          if (this.input.profile.edition !== "rerelease") throw new Error("MOVETYPE_GIB requires Quake rerelease behavior");
          this.toss(); break;
        case Q1_MOVE_STEP:
          if ((s.flags & (Q1_FLAG_ONGROUND | Q1_FLAG_FLY | Q1_FLAG_SWIM)) === 0) {
            const hitSound = s.velocity.z < c.math.n.multiply(this.input.profile.parameters.gravity, -0.1);
            this.gravity(); this.velocityBounds(); this.flyMove(this.frameSeconds); this.link(true);
            if (!c.removed && hitSound && (s.flags & Q1_FLAG_ONGROUND) !== 0) c.options.hooks?.sound?.(this.input.actor, "demon/dland2.wav", s);
          }
          if (!c.removed) this.waterTransition();
          break;
        default: throw new Error(`Unsupported NetQuake player movetype ${s.moveType}`);
      }
    }
    if (!c.removed) { this.link(true); this.setState(c.lifecycle(s, "afterPhysics")); }
    if (c.removed) return { kind: "q1-netquake", status: "actor-removed", actor: this.input.actor.id,
      commandSequence: this.input.commandSequence, effects: c.effects };
    this.idealPitch();
    const result = finishMovement(c, s, s.viewAngles, (s.flags & Q1_FLAG_ONGROUND) !== 0 ? s.ground : NONE, s.waterLevel, s.waterType);
    if (result.kind !== "q1-netquake") throw new Error("Weapon callback changed NetQuake movement family");
    return result;
  }
}

export function prepareNetQuake(input: Q1MovementInput, services: MovementServices, options: Q1MovementOptions = {}): Q1MovementState {
  return new NetQuakeMove(input, services, options).prepare();
}
export function physicsNetQuake(input: Q1MovementInput, services: MovementServices, options: Q1MovementOptions = {}): Q1MovementResult {
  return new NetQuakeMove(input, services, options).physics();
}
export function moveNetQuake(input: Q1MovementInput, services: MovementServices, options: Q1MovementOptions = {}): Q1MovementResult {
  const application = input.execution === "authoritative" ? services.inputApplication : undefined;
  if (application === undefined) return physicsNetQuake({ ...input, state: prepareNetQuake(input, services, options) }, services, options);
  let current = input, result: Q1MovementResult;
  try {
    const before = application.begin(input.command, input.frame, input.state);
    if (before.kind === "actor-removed") result = { kind: "q1-netquake", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: [] };
    else {
      if (before.command.kind !== "q1-netquake" || before.state.kind !== "q1-netquake") throw new Error("Input output changed NetQuake dialect");
      current = { ...input, command: before.command, state: before.state };
      result = physicsNetQuake({ ...current, state: prepareNetQuake(current, services, options) }, services, options);
    }
  } catch (error) { application.end(current.state, true); throw error; }
  const after = application.end(result.status === "active" ? result.state : current.state);
  if (after.kind === "actor-removed" || result.status === "actor-removed") return { kind: "q1-netquake", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: result.effects };
  if (after.state.kind !== "q1-netquake") throw new Error("Input completion changed NetQuake dialect");
  return { ...result, state: after.state };
}
export function createQ1MovementProvider(id: ProviderId, options: Q1MovementOptions = {}): Extract<MovementProvider, { readonly kind: "q1-netquake" }> {
  return { kind: "q1-netquake", id, move: (input, services) => moveNetQuake(input, services, options) };
}
