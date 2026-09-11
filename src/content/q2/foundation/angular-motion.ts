/* AngleMove_Calc from game/g_func.c and rerelease g_func.cpp. */
import type { Vec3 } from "../../../contracts/math.ts";
import { length, scale, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "./host.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "./callbacks.ts";
import { restoreQ2Actor } from "./checkpoint.ts";

export type Q2AngularMotionCheckpoint = readonly { readonly actor: SavedActorId; readonly destination: Vec3; readonly speed: number; readonly done: string }[];

export class Q2AngularMotion {
  private moves = new WeakMap<Q2Entity, { readonly destination: Vec3; speed: number; readonly done: Q2Think }>();
  constructor(private readonly callbackPrefix = "q2:angular") {}

  get callbacks(): Q2CallbackDefinitions {
    return { think: { [`${this.callbackPrefix}/AngleMove_Done`]: this.done, [`${this.callbackPrefix}/AngleMove_Final`]: this.final,
      [`${this.callbackPrefix}/AngleMove_Begin`]: this.begin } };
  }

  capture(game: Q2GameServices): Q2AngularMotionCheckpoint {
    const entries: { actor: SavedActorId; destination: Vec3; speed: number; done: string }[] = [];
    for (const entity of game.entities.values()) {
      const state = this.moves.get(entity); if (state === undefined) continue;
      const done = game.sourceCallbacks.think.name(state.done);
      if (done === null) throw new Error("Q2 angular move checkpoint has no end function");
      entries.push({ actor: { slot: entity.actor.id.slot, generation: entity.actor.id.generation }, destination: state.destination, speed: state.speed, done });
    }
    return structuredClone(entries);
  }

  restore(game: Q2GameServices, checkpoint: Q2AngularMotionCheckpoint): undefined {
    this.moves = new WeakMap<Q2Entity, { readonly destination: Vec3; speed: number; readonly done: Q2Think }>();
    for (const saved of checkpoint) {
      const entity = game.entity(restoreQ2Actor(game, saved.actor).id), done = game.sourceCallbacks.think.resolve(saved.done);
      if (entity === null || done === null) throw new Error("Q2 angular move checkpoint has no actor or end function");
      this.moves.set(entity, { destination: { ...saved.destination }, speed: saved.speed, done });
    }
    return undefined;
  }

  moveTo(entity: Q2Entity, game: Q2GameServices, destination: Vec3, done: Q2Think): undefined {
    game.sourceCallbacks.register(this.callbacks);
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
