import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use } from "../../foundation/host.ts";
import { add, dot, length, normalize, numberField, scale, subtract, vectorField, zero } from "../../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { restoreQ2Actor } from "../../foundation/checkpoint.ts";
import type { Q2RereleasePlayers } from "../players.ts";
import type { Q2RereleaseHooks } from "../types.ts";
import { q2RereleaseClientAnimation } from "../view.ts";

interface EyeState { readonly neutralAngles: Vec3; eyePosition: Vec3; readonly visionCone: number; }
interface CameraState { remaining: number; distance: number; speed: number; angles: Vec3; }
interface DummyState { fadeRemaining: number; fadeDuration: number; fading: boolean; }
export interface Q2RereleaseQ64Checkpoint {
  readonly eyes: readonly { readonly actor: SavedActorId; readonly state: EyeState }[];
  readonly cameras: readonly { readonly actor: SavedActorId; readonly state: CameraState }[];
  readonly dummies: readonly { readonly actor: SavedActorId; readonly state: DummyState }[];
}

const anglemod = (angle: number): number => (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536;
function turn(current: number, ideal: number, speed: number): number {
  current = anglemod(current);
  let move = ideal - current;
  if (ideal > current && move >= 180) move -= 360;
  else if (ideal <= current && move <= -180) move += 360;
  return anglemod(current + Math.max(-speed, Math.min(speed, move)));
}

/** Rerelease g_func.cpp / g_target.cpp Q64 entities run on the shared source scheduler. */
export class Q2RereleaseQ64 implements Q2SpawnModule {
  private readonly eyes = new Map<ActorId, EyeState>();
  private readonly cameras = new Map<ActorId, CameraState>();
  private readonly dummies = new Map<ActorId, DummyState>();
  constructor(readonly players: Q2RereleasePlayers, readonly hooks: Q2RereleaseHooks, readonly endOfUnit: (game: Q2GameServices) => undefined) {}

  release(actor: ActorId): undefined { this.eyes.delete(actor); this.cameras.delete(actor); this.dummies.delete(actor); return undefined; }
  capture(): Q2RereleaseQ64Checkpoint {
    const saved = (actor: ActorId): SavedActorId => ({ slot: actor.slot, generation: actor.generation });
    return { eyes: [...this.eyes].map(([actor, state]) => ({ actor: saved(actor), state: structuredClone(state) })),
      cameras: [...this.cameras].map(([actor, state]) => ({ actor: saved(actor), state: structuredClone(state) })),
      dummies: [...this.dummies].map(([actor, state]) => ({ actor: saved(actor), state: { ...state } })) };
  }
  restore(game: Q2GameServices, checkpoint: Q2RereleaseQ64Checkpoint): undefined {
    this.eyes.clear(); this.cameras.clear(); this.dummies.clear();
    for (const entry of checkpoint.eyes) this.eyes.set(restoreQ2Actor(game, entry.actor).id, structuredClone(entry.state));
    for (const entry of checkpoint.cameras) this.cameras.set(restoreQ2Actor(game, entry.actor).id, structuredClone(entry.state));
    for (const entry of checkpoint.dummies) this.dummies.set(restoreQ2Actor(game, entry.actor).id, { ...entry.state });
    return undefined;
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname === "target_camera") {
      if (game.options.mode === "deathmatch") game.remove(entity);
      else { entity.visible = false; entity.serverFlags |= 1; entity.use = this.cameraUse; }
      return true;
    }
    if (entity.classname !== "func_eye" && entity.classname !== "func_spinning") return false;
    game.solid(entity, "brush"); game.motion(entity, "push");
    if (entity.classname === "func_spinning") {
      entity.speed ||= 100; entity.damage ||= 2; entity.timestamp = 0;
      game.schedule(entity, game.host.frameSeconds(), this.spinningThink);
    } else {
      entity.damageRadius = numberField(entity.spawn, "radius") || 512;
      entity.speed = (entity.speed || 45) * game.host.frameSeconds(); entity.wait = 1;
      const state: EyeState = { neutralAngles: game.body(entity).angles, eyePosition: vectorField(entity.spawn, "eye_position"), visionCone: numberField(entity.spawn, "vision_cone") || 0.5 };
      this.eyes.set(entity.actor.id, state);
      if ((entity.spawn.values.get("pathtarget") ?? "") !== "") game.schedule(entity, 0.1, this.eyeSetup);
      else {
        const vectors = angleVectors(state.neutralAngles), point = state.eyePosition;
        entity.movedir = vectors.forward;
        state.eyePosition = add(add(scale(vectors.forward, point.x), scale(vectors.right, point.y)), scale(vectors.up, point.z));
        game.schedule(entity, 0.1, this.eyeThink);
      }
    }
    game.link(entity); return true;
  }

  private readonly spinningThink: Q2Think = (entity, game) => {
    if (entity.timestamp <= game.host.now()) {
      entity.timestamp = game.host.now() + 1 + game.host.random() * 5;
      const component = (): number => entity.decel + game.host.random() * (entity.speed - entity.decel);
      const x = component(), y = component(), z = component();
      entity.movedir = { x: game.host.random() < 0.5 ? -x : x, y: game.host.random() < 0.5 ? -y : y, z: game.host.random() < 0.5 ? -z : z };
    }
    const step = (current: number, wanted: number): number => current < wanted ? Math.min(wanted, current + entity.accel) : Math.max(wanted, current - entity.accel);
    entity.angularVelocity = { x: step(entity.angularVelocity.x, entity.movedir.x), y: step(entity.angularVelocity.y, entity.movedir.y), z: step(entity.angularVelocity.z, entity.movedir.z) };
    game.motion(entity, "push"); return game.schedule(entity, game.host.frameSeconds(), this.spinningThink);
  };

  private readonly eyeSetup: Q2Think = (entity, game) => {
    const state = this.eyes.get(entity.actor.id);
    if (state === undefined) throw new Error("func_eye source state missing");
    const target = game.pickTarget(entity.spawn.values.get("pathtarget") ?? "");
    if (target === null) game.host.diagnostic("func_eye: bad target");
    else state.eyePosition = subtract(game.body(target).origin, game.body(entity).origin);
    entity.movedir = normalize(state.eyePosition);
    return game.schedule(entity, 0.1, this.eyeThink);
  };
  private readonly eyeThink: Q2Think = (entity, game) => {
    const state = this.eyes.get(entity.actor.id);
    if (state === undefined) throw new Error("func_eye source state missing");
    const body = game.body(entity);
    let closest: ActorId | null = null, closestDistance = Infinity;
    for (const actor of game.host.players()) {
      const player = this.players.states.get(actor), target = game.host.bodies.read(actor);
      if (player?.connected !== true || target === null) continue;
      const direction = subtract(target.origin, body.origin), distance = length(direction);
      if (dot(normalize(direction), entity.movedir) < state.visionCone || distance >= entity.damageRadius || distance >= closestDistance) continue;
      closest = actor; closestDistance = distance;
    }
    entity.enemy = closest;
    let wanted = body.angles;
    const target = closest === null ? null : game.host.bodies.read(closest);
    if (closest !== null && target !== null) {
      if ((entity.spawnflags & 0x20000) === 0) { game.useTargets(entity, closest); entity.spawnflags |= 0x20000; }
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
      const vectors = angleVectors(body.angles), offset = state.eyePosition;
      const eye = add(body.origin, add(add(scale(vectors.forward, offset.x), scale(vectors.right, offset.y)), scale(vectors.up, offset.z)));
      wanted = vectorAngles(normalize(subtract(target.origin, eye)));
      entity.frame = 2; entity.timestamp = game.host.now() + entity.wait;
    } else if (entity.timestamp <= game.host.now()) { wanted = state.neutralAngles; entity.frame = 0; }
    game.move(entity, { angles: { x: turn(body.angles.x, wanted.x, entity.speed), y: turn(body.angles.y, wanted.y, entity.speed), z: body.angles.z } });
    game.show(entity); return game.schedule(entity, game.host.frameSeconds(), this.eyeThink);
  };

  private lookAt(entity: Q2Entity, game: Q2GameServices, origin: Vec3, previous: Vec3): Vec3 {
    const target = game.targets(entity.spawn.values.get("pathtarget") ?? "")[0];
    if (target === undefined) return previous;
    const delta = subtract(game.body(target).origin, origin), planar = Math.hypot(delta.x, delta.y);
    return { x: planar === 0 ? delta.z > 0 ? -90 : 90 : -Math.atan2(delta.z, planar) * 180 / Math.PI,
      y: planar === 0 ? 0 : Math.atan2(delta.y, delta.x) * 180 / Math.PI, z: 0 };
  }
  private readonly cameraUse: Q2Use = (entity, game, _other, activator) => {
    const music = numberField(entity.spawn, "sounds");
    if (music !== 0) game.host.emit({ kind: "music", track: String(music) });
    if (entity.target === "") return undefined;
    const target = game.pickTarget(entity.target);
    if (target === null) return undefined;
    const origin = game.body(entity).origin, source = game.entity(activator);
    entity.goal = target.actor.id; entity.activator = activator;
    if (source !== null && this.players.states.has(source.actor.id)) {
      const body = game.body(source), dummy = game.create("target_camera_dummy");
      entity.enemy = dummy.actor.id; dummy.owner = source.actor.id; dummy.clipMask = source.clipMask;
      dummy.model = source.model; dummy.model2 = source.model2; dummy.skin = source.skin; dummy.frame = source.frame; dummy.renderFlags = 1;
      game.move(dummy, { origin: body.origin, angles: body.angles, velocity: body.velocity, bounds: body.bounds, ground: body.ground }, false);
      game.solid(dummy, "box"); game.motion(dummy, "step"); game.link(dummy); game.show(dummy);
      this.dummies.set(dummy.actor.id, { fading: false, fadeDuration: 0, fadeRemaining: 0 });
      game.schedule(dummy, 0.1, this.dummyThink);
    }
    const distance = length(subtract(game.body(target).origin, origin));
    const state: CameraState = { speed: entity.speed, distance, remaining: distance, angles: this.lookAt(entity, game, origin, zero) };
    this.cameras.set(entity.actor.id, state);
    this.players.intermission = { kind: "intermission", map: "", started: game.host.now(), exit: false, landmark: null };
    this.players.moveToCamera(game, origin, state.angles, true);
    if ((numberField(entity.spawn, "hackflags") & 128) !== 0) this.endOfUnit(game);
    return game.schedule(entity, entity.wait, this.cameraThink);
  };
  private readonly cameraThink: Q2Think = (entity, game) => {
    const state = this.cameras.get(entity.actor.id);
    if (state === undefined) throw new Error("target_camera source state missing");
    const skip = (numberField(entity.spawn, "hackflags") & 64) !== 0 && game.host.now() > 2 && [...this.players.states.values()].some(player => player.connected && player.buttons !== 0);
    const target = game.entity(entity.goal);
    if (skip || target === null) {
      if (entity.killtarget !== "") {
        const dummy = game.entity(entity.enemy);
        if (dummy !== null) game.remove(dummy);
        this.players.intermission = { kind: "playing" };
        this.players.intermissionCameraSet = true;
        for (const destination of game.targets(entity.killtarget)) destination.use?.(destination, game, entity.actor.id, entity.activator);
        this.players.finishCamera(game);
      }
      return game.cancel(entity);
    }
    state.remaining -= state.speed * game.host.frameSeconds() * 0.8;
    if (state.remaining <= 0) {
      if ((numberField(target.spawn, "hackflags") & 2) !== 0) {
        const dummy = game.entity(entity.enemy), fade = dummy === null ? undefined : this.dummies.get(dummy.actor.id);
        if (dummy !== null && fade !== undefined) {
          game.host.emit({ kind: "entity-event", actor: dummy.actor.id, event: 6 });
          fade.fading = true; fade.fadeRemaining = target.wait; fade.fadeDuration = target.wait;
        }
      }
      game.move(entity, { origin: game.body(target).origin });
      const next = target.target === "" ? null : game.pickTarget(target.target);
      entity.goal = next?.actor.id ?? null;
      if (next !== null) { state.speed = next.speed || 55; state.distance = state.remaining = length(subtract(game.body(next).origin, game.body(entity).origin)); }
      return game.schedule(entity, target.wait, this.cameraThink);
    }
    const fraction = 1 - state.remaining / state.distance, origin = add(game.body(entity).origin, scale(subtract(game.body(target).origin, game.body(entity).origin), fraction));
    const dummy = game.entity(entity.enemy);
    if (dummy !== null && this.dummies.get(dummy.actor.id)?.fading) this.hooks.emit({ kind: "alpha", actor: dummy.actor.id, alpha: Math.max(1 / 255, fraction) });
    state.angles = this.lookAt(entity, game, origin, state.angles); this.players.moveToCamera(game, origin, state.angles, false);
    return game.schedule(entity, game.host.frameSeconds(), this.cameraThink);
  };
  private readonly dummyThink: Q2Think = (entity, game) => {
    const source = game.entity(entity.owner), state = this.dummies.get(entity.actor.id);
    if (source === null || state === undefined) return game.remove(entity);
    const context = this.players.context(source, game), body = game.body(entity);
    q2RereleaseClientAnimation({ ...context, entity, movement: { ...context.movement, grounded: body.ground !== null } }, this.players.extra(source.actor.id));
    game.show(entity);
    if (state.fading) {
      state.fadeRemaining = Math.max(0, state.fadeRemaining - 0.1);
      this.hooks.emit({ kind: "alpha", actor: entity.actor.id, alpha: Math.max(1 / 255, state.fadeDuration === 0 ? 0 : state.fadeRemaining / state.fadeDuration) });
    }
    return game.schedule(entity, 0.1, this.dummyThink);
  };

  readonly callbacks: Q2CallbackDefinitions = { think: { "rr.func_eye_setup": this.eyeSetup, "rr.func_eye_think": this.eyeThink, "rr.func_spinning_think": this.spinningThink,
    "rr.update_target_camera": this.cameraThink, "rr.target_camera_dummy_think": this.dummyThink }, use: { "rr.use_target_camera": this.cameraUse } };
}
