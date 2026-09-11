/* AngleMove_Calc from game/g_func.c and rerelease g_func.cpp. */
import type { Vec3 } from "../../../contracts/math.ts";
import { length, scale, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "./host.ts";

export class Q2AngularMotion {
  private readonly moves = new WeakMap<Q2Entity, { readonly destination: Vec3; speed: number; readonly done: Q2Think }>();

  moveTo(entity: Q2Entity, game: Q2GameServices, destination: Vec3, done: Q2Think): undefined {
    this.moves.set(entity, { destination, done, speed: game.options.edition === "rerelease" && entity.accel !== entity.speed ? 0 : entity.speed });
    entity.angularVelocity = zero; game.motion(entity, entity.motion);
    return game.currentActor?.equals(entity.teamMaster ?? entity.actor.id) ? this.begin(entity, game) : game.schedule(entity, game.host.frameSeconds(), this.begin);
  }

  private state(entity: Q2Entity) {
    const state = this.moves.get(entity);
    if (state === undefined) throw new Error("Q2 angular callback has no active move");
    return state;
  }

  private readonly done: Q2Think = (entity, game) => {
    const state = this.state(entity); this.moves.delete(entity);
    entity.angularVelocity = zero; game.motion(entity, entity.motion);
    return state.done(entity, game);
  };

  private readonly final: Q2Think = (entity, game) => {
    const delta = subtract(this.state(entity).destination, game.body(entity).angles);
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return this.done(entity, game);
    entity.angularVelocity = scale(delta, 1 / game.host.frameSeconds()); game.motion(entity, entity.motion);
    return game.schedule(entity, game.host.frameSeconds(), this.done);
  };

  private readonly begin: Q2Think = (entity, game) => {
    const state = this.state(entity);
    if (state.speed < entity.speed) state.speed = Math.min(entity.speed, state.speed + entity.accel);
    const delta = subtract(state.destination, game.body(entity).angles), time = length(delta) / state.speed;
    if (time < game.host.frameSeconds()) return this.final(entity, game);
    entity.angularVelocity = scale(delta, 1 / time); game.motion(entity, entity.motion);
    return state.speed >= entity.speed
      ? game.schedule(entity, Math.floor(time / game.host.frameSeconds()) * game.host.frameSeconds(), this.final)
      : game.schedule(entity, game.host.frameSeconds(), this.begin);
  };
}
