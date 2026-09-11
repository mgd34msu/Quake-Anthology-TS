/* game/g_func.c linear Move_Calc and accelerated platform movement. */
import type { Vec3 } from "../../../contracts/math.ts";
import { add, length, scale, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "./host.ts";

interface LinearMove {
  readonly direction: Vec3;
  readonly destination: Vec3;
  readonly reference: Vec3;
  remaining: number;
  currentSpeed: number;
  moveSpeed: number;
  nextSpeed: number;
  decelDistance: number;
  readonly done: Q2Think;
  curve: { readonly positions: Float32Array; frame: number; subframe: number; readonly subframes: number } | null;
}

export class Q2LinearMotion {
  private readonly moves = new WeakMap<Q2Entity, LinearMove>();

  moveTo(entity: Q2Entity, game: Q2GameServices, destination: Vec3, done: Q2Think): undefined {
    const delta = subtract(destination, game.body(entity).origin), distance = length(delta);
    const state: LinearMove = { direction: distance === 0 ? zero : scale(delta, 1 / distance), remaining: distance,
      destination, reference: game.body(entity).origin, currentSpeed: 0, moveSpeed: 0, nextSpeed: 0, decelDistance: 0, done, curve: null };
    this.moves.set(entity, state);
    this.velocity(entity, game, zero);
    if (entity.speed === entity.accel && entity.speed === entity.decel) {
      if (game.currentActor?.equals(entity.teamMaster ?? entity.actor.id)) return this.begin(entity, game);
      return game.schedule(entity, game.host.frameSeconds(), this.begin);
    }
    if (game.options.edition === "rerelease" && game.host.frameSeconds() !== 0.1) {
      const subframes = 0.1 / game.host.frameSeconds() - 1;
      const positions: number[] = subframes !== 0 ? [0] : [];
      while (state.remaining !== 0) {
        if (state.currentSpeed === 0) calculateAcceleration(state, entity);
        accelerate(state, entity);
        if (state.remaining <= state.currentSpeed) break;
        state.remaining -= state.currentSpeed;
        positions.push(distance - state.remaining);
      }
      if (subframes !== 0) positions.push(distance);
      state.curve = { positions: Float32Array.from(positions), frame: subframes !== 0 ? 1 : 0, subframe: 0, subframes };
      return game.schedule(entity, game.host.frameSeconds(), this.curve);
    }
    return game.schedule(entity, game.host.frameSeconds(), this.accelerate);
  }

  private state(entity: Q2Entity): LinearMove {
    const state = this.moves.get(entity);
    if (state === undefined) throw new Error("Q2 mover callback has no active move");
    return state;
  }

  private velocity(entity: Q2Entity, game: Q2GameServices, velocity: Vec3): undefined {
    game.move(entity, { velocity }, false);
    return game.motion(entity, entity.motion);
  }

  private readonly done: Q2Think = (entity, game) => {
    this.velocity(entity, game, zero);
    const state = this.state(entity);
    this.moves.delete(entity);
    return state.done(entity, game);
  };

  private readonly final: Q2Think = (entity, game) => {
    const state = this.state(entity);
    if (state.remaining === 0) return this.done(entity, game);
    const delta = game.options.edition === "rerelease" ? subtract(state.destination, game.body(entity).origin) : scale(state.direction, state.remaining);
    this.velocity(entity, game, scale(delta, 1 / game.host.frameSeconds()));
    return game.schedule(entity, game.host.frameSeconds(), this.done);
  };

  private readonly begin: Q2Think = (entity, game) => {
    const state = this.state(entity), frame = game.host.frameSeconds();
    if (entity.speed * frame >= state.remaining) return this.final(entity, game);
    this.velocity(entity, game, scale(state.direction, entity.speed));
    const frames = Math.floor(state.remaining / entity.speed / frame);
    state.remaining -= frames * entity.speed * frame;
    return game.schedule(entity, frames * frame, this.final);
  };

  private readonly accelerate: Q2Think = (entity, game) => {
    const state = this.state(entity);
    if (game.options.edition === "rerelease") state.remaining = length(subtract(state.destination, game.body(entity).origin));
    else state.remaining -= state.currentSpeed;
    if (state.currentSpeed === 0) calculateAcceleration(state, entity);
    accelerate(state, entity);
    if (state.remaining <= state.currentSpeed) return this.final(entity, game);
    // The original accelerated mover units are distance per 100ms, not velocity.
    this.velocity(entity, game, scale(state.direction, state.currentSpeed / game.host.frameSeconds()));
    return game.schedule(entity, game.host.frameSeconds(), this.accelerate);
  };

  private readonly curve: Q2Think = (entity, game) => {
    const state = this.state(entity), curve = state.curve;
    if (curve === null) throw new Error("Q2 rerelease accelerated move has no curve");
    if (curve.subframes !== 0 && curve.subframe === curve.subframes + 1) { curve.subframe = 0; curve.frame++; }
    if (curve.frame === curve.positions.length) return this.final(entity, game);
    let distance: number;
    if (curve.subframes !== 0) {
      const from = curve.positions[curve.frame - 1], to = curve.positions[curve.frame];
      if (from === undefined || to === undefined) throw new Error("Q2 accelerated move references a missing curve sample");
      distance = from + (to - from) * (curve.subframe + 1) / (curve.subframes + 1);
      curve.subframe++;
    } else {
      const sample = curve.positions[curve.frame++];
      if (sample === undefined) throw new Error("Q2 accelerated move references a missing curve sample");
      distance = sample;
    }
    const target = add(state.reference, scale(state.direction, distance));
    this.velocity(entity, game, scale(subtract(target, game.body(entity).origin), 1 / game.host.frameSeconds()));
    return game.schedule(entity, game.host.frameSeconds(), this.curve);
  };
}

function accelerationDistance(target: number, rate: number): number { return target * (target / rate + 1) / 2; }

function calculateAcceleration(state: LinearMove, entity: Q2Entity): undefined {
  state.moveSpeed = entity.speed;
  if (state.remaining < entity.accel) { state.currentSpeed = state.remaining; return undefined; }
  const accelDistance = accelerationDistance(entity.speed, entity.accel);
  let decelDistance = accelerationDistance(entity.speed, entity.decel);
  if (state.remaining - accelDistance - decelDistance < 0) {
    const factor = (entity.accel + entity.decel) / (entity.accel * entity.decel);
    state.moveSpeed = (-2 + Math.sqrt(4 + 8 * factor * state.remaining)) / (2 * factor);
    decelDistance = accelerationDistance(state.moveSpeed, entity.decel);
  }
  state.decelDistance = decelDistance;
  return undefined;
}

function accelerate(state: LinearMove, entity: Q2Entity): undefined {
  if (state.remaining <= state.decelDistance) {
    if (state.remaining < state.decelDistance) {
      if (state.nextSpeed !== 0) { state.currentSpeed = state.nextSpeed; state.nextSpeed = 0; return undefined; }
      if (state.currentSpeed > entity.decel) state.currentSpeed -= entity.decel;
    }
    return undefined;
  }
  if (state.currentSpeed === state.moveSpeed && state.remaining - state.currentSpeed < state.decelDistance) {
    const firstDistance = state.remaining - state.decelDistance;
    const secondDistance = state.moveSpeed * (1 - firstDistance / state.moveSpeed);
    state.currentSpeed = state.moveSpeed;
    state.nextSpeed = state.moveSpeed - entity.decel * secondDistance / (firstDistance + secondDistance);
    return undefined;
  }
  if (state.currentSpeed < entity.speed) {
    const oldSpeed = state.currentSpeed;
    state.currentSpeed = Math.min(state.currentSpeed + entity.accel, entity.speed);
    if (state.remaining - state.currentSpeed >= state.decelDistance) return undefined;
    const firstDistance = state.remaining - state.decelDistance;
    const firstSpeed = (oldSpeed + state.moveSpeed) / 2;
    const secondDistance = state.moveSpeed * (1 - firstDistance / firstSpeed);
    const distance = firstDistance + secondDistance;
    state.currentSpeed = firstSpeed * firstDistance / distance + state.moveSpeed * secondDistance / distance;
    state.nextSpeed = state.moveSpeed - entity.decel * secondDistance / distance;
  }
  return undefined;
}
