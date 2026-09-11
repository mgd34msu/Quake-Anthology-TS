import type { UseParticipant } from "./state.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { BodyState } from "../../../../contracts/world.ts";
import type { ActorSpatialQueries } from "../world.ts";
import type { DamageParticipant } from "./state.ts";
/* Push transactions and binary movers translated from id Software's g_mover.c.
 * Copyright (C) 1999-2005 Id Software, Inc. SPDX-License-Identifier: GPL-2.0-or-later */
import { add3, dot3, length3, radiusFromBounds, scale3, sub3, vec3 } from "../../../../core/math.ts";
import { qvmAngleVectors } from "../../../../core/qvm-math.ts";
import { qvmFloatToInt } from "../../../../core/numeric.ts";
import type { Bounds, Vec3 } from "../../../../core/math.ts";
import type { ServerWorld } from "../world.ts";
import { EntityEvent, EntityType, ItemType } from "../shared/definitions.ts";
import { ServerEntityFlags } from "../shared/entity-shared.ts";
import { evaluateTrajectory, TrajectoryType } from "../shared/trajectory.ts";
import { damage } from "./combat.ts";
import type { CombatContext } from "./combat.ts";
import { runThink } from "./entities.ts";
import type { SpawnVariables } from "./spawn.ts";
import { GameFlags, MAX_GENTITIES, MoverState } from "./state.ts";
import { GameEntity } from "./state.ts";
import type { ConfigStringRegistry } from "./utilities.ts";

interface MoverServices {
  readonly world: ServerWorld;
  readonly spatial: ActorSpatialQueries;
  readonly actors: MoverActorAccess;
  readonly previousTime: number;
  readonly config: Pick<ConfigStringRegistry, "modelIndex" | "soundIndex">;
  useTargets(entity: GameEntity, activator: UseParticipant): void;
  adjustAreaPortalState(entity: GameEntity, open: boolean): void;
  returnDroppedFlag(entity: GameEntity): void;
}
export interface SharedMoverBody {
  readonly actor: OwnedActor;
  readonly kind: "player" | "movable" | "fixed" | "attached";
  readonly state: BodyState;
  readonly absoluteBounds: Bounds;
  readonly clipMask: number;
}
export interface MoverActorAccess {
  native(actor: ActorId): GameEntity | null;
  participant(actor: ActorId): DamageParticipant;
  observe(actor: ActorId): SharedMoverBody | null;
  write(actor: OwnedActor, origin: Vec3, ground: ActorId | null): undefined;
  link(actor: OwnedActor): undefined;
  release(actor: OwnedActor): undefined;
}
/** Time properties must remain live while installed callbacks are scheduled. */
export type MoverHost = MoverServices & (
  | { readonly combat: Extract<CombatContext, { product: "baseq3" }>; readonly missionpack: null }
  | { readonly combat: Extract<CombatContext, { product: "missionpack" }>; readonly missionpack: { explodeMissile(entity: GameEntity): void } }
);
interface PushedNative {
  readonly kind: "native";
  readonly entity: GameEntity;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly view: { readonly kind: "none" } | { readonly kind: "client"; readonly yaw: number };
}
type PushedEntity = PushedNative | { readonly kind: "shared"; readonly body: SharedMoverBody };
const EF_MOVER_STOP = 0x400;
const MOD_CRUSH = 17;
const f32 = Math.fround;

function baseOrigin(entity: GameEntity, origin: Vec3): void { entity.s.pos = { ...entity.s.pos, base: { ...origin } }; }
function baseAngles(entity: GameEntity, angles: Vec3): void { entity.s.apos = { ...entity.s.apos, base: { ...angles } }; }
function angleShort(angle: number): number { return qvmFloatToInt(f32(f32(angle * 65536) / 360)) & 65535; }
function pushRotation(origin: Vec3, pusherOrigin: Vec3, amove: Vec3): Vec3 {
  const axes = qvmAngleVectors(amove);
  const matrix = [axes.forward, scale3(axes.right, -1), axes.up] satisfies readonly [Vec3, Vec3, Vec3];
  const org = sub3(origin, pusherOrigin);
  const rotated = vec3(dot3(org, vec3(matrix[0].x, matrix[1].x, matrix[2].x)),
    dot3(org, vec3(matrix[0].y, matrix[1].y, matrix[2].y)), dot3(org, vec3(matrix[0].z, matrix[1].z, matrix[2].z)));
  return sub3(rotated, org);
}

export class MoverRuntime {
  constructor(readonly host: MoverHost) {
    if (host.combat.entities.options.product !== host.combat.product) throw new Error("Mover product does not match its entity pool");
  }

  private owned(entity: GameEntity): void {
    if (this.host.combat.entities.get(entity.slot) !== entity) throw new Error("Mover entity does not belong to this pool");
  }

  private bounds(entity: GameEntity): Bounds {
    return { min: entity.r.absmin, max: entity.r.absmax };
  }

  testEntityPosition(entity: GameEntity): DamageParticipant | null {
    this.owned(entity);
    const start = entity.client === null ? entity.s.pos.base : entity.client.ps.origin;
    const result = this.host.spatial.traceActor({ start, end: start,
      shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs },
      passActor: entity.actor.id, mask: entity.clipmask === 0 ? 1 : entity.clipmask });
    return result.solidity === "clear" ? null : result.hit.kind === "actor" ? this.host.actors.participant(result.hit.actor)
      : this.host.combat.entities.at(1022);
  }

  private tryPushing(check: GameEntity, pusher: GameEntity, move: Vec3, amove: Vec3, pushed: PushedEntity[]): boolean {
    if ((pusher.s.eFlags & EF_MOVER_STOP) !== 0 && check.s.groundEntityNum !== pusher.s.number) return false;
    if (pushed.length >= MAX_GENTITIES) throw new Error("pushed stack exceeds MAX_GENTITIES");
    const saved: PushedNative = { kind: "native", entity: check,
      origin: { ...(check.client === null ? check.s.pos.base : check.client.ps.origin) }, angles: { ...check.s.apos.base },
      view: check.client === null ? { kind: "none" } : { kind: "client", yaw: f32(check.client.ps.deltaAngles.y) } };
    pushed.push(saved);
    const rotationMove = pushRotation(saved.origin, pusher.r.currentOrigin, amove);
    baseOrigin(check, add3(add3(check.s.pos.base, move), rotationMove));
    if (check.client !== null) {
      const ps = check.client.ps;
      ps.origin = add3(add3(ps.origin, move), rotationMove);
      ps.deltaAngles = { ...ps.deltaAngles, y: (ps.deltaAngles.y + angleShort(amove.y)) | 0 };
    }
    if (check.s.groundEntityNum !== pusher.s.number) check.s.groundEntityNum = -1;
    if (this.testEntityPosition(check) === null) {
      check.r.currentOrigin = { ...(check.client === null ? check.s.pos.base : check.client.ps.origin) };
      this.host.world.link(check);
      return true;
    }
    // Source riding fallback restores position and angles but retains view yaw.
    baseOrigin(check, saved.origin);
    if (check.client !== null) check.client.ps.origin = { ...saved.origin };
    baseAngles(check, saved.angles);
    if (this.testEntityPosition(check) === null) {
      check.s.groundEntityNum = -1;
      pushed.pop();
      return true;
    }
    return false;
  }

  private checkProximityPosition(entity: GameEntity): boolean {
    const start = add3(entity.s.pos.base, scale3(entity.movedir, 0.125));
    const end = add3(entity.s.pos.base, scale3(entity.movedir, 2));
    const trace = this.host.spatial.traceActor({ start, end, shape: { kind: "point" }, passActor: entity.actor.id, mask: 1 });
    return trace.solidity === "clear" && trace.fraction === 1;
  }

  private sharedPositionBlocked(check: SharedMoverBody): boolean {
    const body = this.host.actors.observe(check.actor.id);
    if (body === null) return false;
    const trace = this.host.spatial.traceActor({ start: body.state.origin, end: body.state.origin,
      shape: { kind: "box", mins: body.state.bounds.min, maxs: body.state.bounds.max },
      passActor: check.actor.id, mask: check.clipMask === 0 ? 1 : check.clipMask });
    return trace.solidity !== "clear";
  }

  private tryPushingShared(check: SharedMoverBody, pusher: GameEntity, move: Vec3, amove: Vec3, pushed: PushedEntity[]): boolean {
    const rider = check.state.ground?.equals(pusher.actor.id) === true;
    if ((pusher.s.eFlags & EF_MOVER_STOP) !== 0 && !rider) return false;
    if (pushed.length >= MAX_GENTITIES) throw new Error("pushed stack exceeds MAX_GENTITIES");
    pushed.push({ kind: "shared", body: check });
    const rotation = pushRotation(check.state.origin, pusher.r.currentOrigin, amove);
    this.host.actors.write(check.actor, add3(add3(check.state.origin, move), rotation), rider ? check.state.ground : null);
    if (!this.sharedPositionBlocked(check)) { this.host.actors.link(check.actor); return true; }
    this.host.actors.write(check.actor, check.state.origin, rider ? check.state.ground : null);
    if (!this.sharedPositionBlocked(check)) {
      this.host.actors.write(check.actor, check.state.origin, null);
      pushed.pop();
      return true;
    }
    return false;
  }

  private restorePushed(pushed: readonly PushedEntity[]): void {
    for (const saved of [...pushed].reverse()) {
      if (saved.kind === "shared") {
        const current = this.host.actors.observe(saved.body.actor.id);
        if (current !== null) {
          this.host.actors.write(saved.body.actor, saved.body.state.origin, current.state.ground);
          this.host.actors.link(saved.body.actor);
        }
        continue;
      }
      const entity = saved.entity;
      baseOrigin(entity, saved.origin); baseAngles(entity, saved.angles);
      if (entity.client !== null) {
        if (saved.view.kind !== "client") throw new Error("pushed entity acquired a client during the transaction");
        entity.client.ps.deltaAngles = { ...entity.client.ps.deltaAngles, y: qvmFloatToInt(saved.view.yaw) };
        entity.client.ps.origin = { ...saved.origin };
      }
      this.host.world.link(entity);
    }
  }

  private pushProximityMine(entity: GameEntity, pusher: GameEntity, move: Vec3, amove: Vec3): boolean {
    const axes = qvmAngleVectors(sub3(vec3(0, 0, 0), amove));
    baseOrigin(entity, add3(entity.s.pos.base, move));
    const org = sub3(entity.s.pos.base, pusher.r.currentOrigin);
    const rotated = vec3(dot3(org, axes.forward), -dot3(org, axes.right), dot3(org, axes.up));
    baseOrigin(entity, add3(entity.s.pos.base, sub3(rotated, org)));
    if (!this.checkProximityPosition(entity)) return false;
    entity.r.currentOrigin = { ...entity.s.pos.base };
    this.host.world.link(entity);
    return true;
  }

  private pushPart(pusher: GameEntity, move: Vec3, amove: Vec3, pushed: PushedEntity[]): DamageParticipant | null {
    const world = this.host.world;
    let destination: Bounds, total: Bounds;
    if (pusher.r.currentAngles.x !== 0 || pusher.r.currentAngles.y !== 0 || pusher.r.currentAngles.z !== 0 || amove.x !== 0 || amove.y !== 0 || amove.z !== 0) {
      const radius = radiusFromBounds({ min: pusher.r.mins, max: pusher.r.maxs });
      const extent = vec3(radius, radius, radius), position = add3(pusher.r.currentOrigin, move);
      destination = { min: sub3(position, extent), max: add3(position, extent) };
      // Source rotating broadphase is centered on the old origin.
      total = { min: sub3(destination.min, move), max: sub3(destination.max, move) };
    } else {
      const bounds = this.bounds(pusher);
      destination = { min: add3(bounds.min, move), max: add3(bounds.max, move) };
      total = { min: add3(bounds.min, vec3(Math.min(move.x, 0), Math.min(move.y, 0), Math.min(move.z, 0))),
        max: add3(bounds.max, vec3(Math.max(move.x, 0), Math.max(move.y, 0), Math.max(move.z, 0))) };
    }
    world.unlink(pusher.slot);
    const entities = this.host.spatial.areaActors(total, MAX_GENTITIES);
    pusher.r.currentOrigin = add3(pusher.r.currentOrigin, move);
    pusher.r.currentAngles = add3(pusher.r.currentAngles, amove);
    world.link(pusher);
    for (const actor of entities) {
      const observed = this.host.actors.observe(actor);
      if (observed === null || observed.kind === "attached") continue;
      const check = this.host.actors.native(actor);
      if (check === null) {
        if (observed.kind === "fixed") continue;
        const rider = observed.state.ground?.equals(pusher.actor.id) === true;
        if (!rider) {
          const bounds = observed.absoluteBounds;
          if (bounds.min.x >= destination.max.x || bounds.min.y >= destination.max.y || bounds.min.z >= destination.max.z ||
            bounds.max.x <= destination.min.x || bounds.max.y <= destination.min.y || bounds.max.z <= destination.min.z) continue;
          if (!this.sharedPositionBlocked(observed)) continue;
        }
        if (this.tryPushingShared(observed, pusher, move, amove, pushed)) continue;
        const participant = this.host.actors.participant(actor);
        if (pusher.s.pos.type === TrajectoryType.TR_SINE || pusher.s.apos.type === TrajectoryType.TR_SINE) {
          damage(this.host.combat, participant, pusher, pusher, null, null, 99999, 0, MOD_CRUSH);
          continue;
        }
        this.restorePushed(pushed);
        return participant;
      }
      if (this.host.missionpack !== null && check.s.eType === EntityType.ET_MISSILE && check.classname === "prox mine") {
        const clear = check.enemy === pusher ? this.pushProximityMine(check, pusher, move, amove) : this.checkProximityPosition(check);
        if (!clear) {
          check.s.loopSound = 0;
          this.host.combat.entities.addEvent(check, EntityEvent.EV_PROXIMITY_MINE_TRIGGER);
          this.host.missionpack.explodeMissile(check);
          if (check.activator !== null) { this.host.combat.entities.free(check.activator); check.activator = null; }
        }
        continue;
      }
      if (check.s.eType !== EntityType.ET_ITEM && check.s.eType !== EntityType.ET_PLAYER && !check.physicsObject) continue;
      if (check.s.groundEntityNum !== pusher.s.number) {
        const bounds = this.bounds(check);
        if (bounds.min.x >= destination.max.x || bounds.min.y >= destination.max.y || bounds.min.z >= destination.max.z ||
          bounds.max.x <= destination.min.x || bounds.max.y <= destination.min.y || bounds.max.z <= destination.min.z) continue;
        if (this.testEntityPosition(check) === null) continue;
      }
      if (this.tryPushing(check, pusher, move, amove, pushed)) continue;
      if (pusher.s.pos.type === TrajectoryType.TR_SINE || pusher.s.apos.type === TrajectoryType.TR_SINE) {
        damage(this.host.combat, check, pusher, pusher, null, null, 99999, 0, MOD_CRUSH);
        continue;
      }
      this.restorePushed(pushed);
      return check;
    }
    return null;
  }

  runTeam(entity: GameEntity): void {
    this.owned(entity);
    const pushed: PushedEntity[] = [];
    const time = this.host.combat.time;
    let obstacle: DamageParticipant | null = null;
    for (let part: GameEntity | null = entity; part !== null; part = part.teamchain) {
      const move = sub3(evaluateTrajectory(part.s.pos, time), part.r.currentOrigin);
      const amove = sub3(evaluateTrajectory(part.s.apos, time), part.r.currentAngles);
      obstacle = this.pushPart(part, move, amove, pushed);
      if (obstacle !== null) break;
    }
    if (obstacle !== null) {
      const elapsed = (time - this.host.previousTime) | 0;
      for (let part: GameEntity | null = entity; part !== null; part = part.teamchain) {
        part.s.pos = { ...part.s.pos, time: (part.s.pos.time + elapsed) | 0 };
        part.s.apos = { ...part.s.apos, time: (part.s.apos.time + elapsed) | 0 };
        part.r.currentOrigin = evaluateTrajectory(part.s.pos, time);
        part.r.currentAngles = evaluateTrajectory(part.s.apos, time);
        this.host.world.link(part);
      }
      entity.blocked?.(entity, obstacle);
      return;
    }
    for (let part: GameEntity | null = entity; part !== null; part = part.teamchain) {
      if (part.s.pos.type === TrajectoryType.TR_LINEAR_STOP && time >= ((part.s.pos.time + part.s.pos.duration) | 0)) part.reached?.(part);
    }
  }

  run(entity: GameEntity): void {
    this.owned(entity);
    if ((entity.flags & GameFlags.TEAMSLAVE) !== 0) return;
    if (entity.s.pos.type !== TrajectoryType.TR_STATIONARY || entity.s.apos.type !== TrajectoryType.TR_STATIONARY) this.runTeam(entity);
    runThink(entity, this.host.combat.time);
  }

  setState(entity: GameEntity, state: MoverState, time: number): void {
    this.owned(entity);
    time |= 0;
    entity.moverState = state;
    const previous = entity.s.pos;
    switch (state) {
      case MoverState.POS1: entity.s.pos = { ...previous, type: TrajectoryType.TR_STATIONARY, time, base: { ...entity.pos1 } }; break;
      case MoverState.POS2: entity.s.pos = { ...previous, type: TrajectoryType.TR_STATIONARY, time, base: { ...entity.pos2 } }; break;
      case MoverState.ONE_TO_TWO: entity.s.pos = { ...previous, type: TrajectoryType.TR_LINEAR_STOP, time, base: { ...entity.pos1 },
        delta: scale3(sub3(entity.pos2, entity.pos1), f32(1000 / f32(previous.duration))) }; break;
      case MoverState.TWO_TO_ONE: entity.s.pos = { ...previous, type: TrajectoryType.TR_LINEAR_STOP, time, base: { ...entity.pos2 },
        delta: scale3(sub3(entity.pos1, entity.pos2), f32(1000 / f32(previous.duration))) }; break;
      default: { const exhaustive: never = state; throw new Error(`Invalid mover state ${exhaustive}`); }
    }
    entity.r.currentOrigin = evaluateTrajectory(entity.s.pos, this.host.combat.time);
    this.host.world.link(entity);
  }

  matchTeam(leader: GameEntity, state: MoverState, time: number): void {
    this.owned(leader);
    for (let part: GameEntity | null = leader; part !== null; part = part.teamchain) this.setState(part, state, time);
  }

  returnToPos1(entity: GameEntity): void {
    this.matchTeam(entity, MoverState.TWO_TO_ONE, this.host.combat.time);
    entity.s.loopSound = entity.soundLoop;
    if (entity.sound2to1 !== 0) this.host.combat.entities.addEvent(entity, EntityEvent.EV_GENERAL_SOUND, entity.sound2to1);
  }

  reachedBinary(entity: GameEntity): void {
    this.owned(entity);
    const time = this.host.combat.time;
    entity.s.loopSound = entity.soundLoop;
    if (entity.moverState === MoverState.ONE_TO_TWO) {
      this.setState(entity, MoverState.POS2, time);
      if (entity.soundPos2 !== 0) this.host.combat.entities.addEvent(entity, EntityEvent.EV_GENERAL_SOUND, entity.soundPos2);
      entity.think = self => { this.returnToPos1(self); };
      entity.nextthink = qvmFloatToInt(f32(f32(time) + entity.wait));
      if (entity.activation === null) entity.activation = entity;
      this.host.useTargets(entity, entity.activation);
    } else if (entity.moverState === MoverState.TWO_TO_ONE) {
      this.setState(entity, MoverState.POS1, time);
      if (entity.soundPos1 !== 0) this.host.combat.entities.addEvent(entity, EntityEvent.EV_GENERAL_SOUND, entity.soundPos1);
      if (entity.teammaster === null || entity.teammaster === entity) this.host.adjustAreaPortalState(entity, false);
    } else throw new Error("Reached_BinaryMover: bad moverState");
  }

  useBinary(entity: GameEntity, other: UseParticipant | null, activator: UseParticipant | null): void {
    this.owned(entity);
    if ((entity.flags & GameFlags.TEAMSLAVE) !== 0) {
      if (entity.teammaster === null) throw new Error("Mover team slave has no team master");
      this.useBinary(entity.teammaster, other, activator); return;
    }
    const time = this.host.combat.time;
    entity.activation = activator;
    if (entity.moverState === MoverState.POS1) {
      this.matchTeam(entity, MoverState.ONE_TO_TWO, (time + 50) | 0);
      if (entity.sound1to2 !== 0) this.host.combat.entities.addEvent(entity, EntityEvent.EV_GENERAL_SOUND, entity.sound1to2);
      entity.s.loopSound = entity.soundLoop;
      if (entity.teammaster === null || entity.teammaster === entity) this.host.adjustAreaPortalState(entity, true);
    } else if (entity.moverState === MoverState.POS2) entity.nextthink = qvmFloatToInt(f32(f32(time) + entity.wait));
    else {
      const total = entity.s.pos.duration, partial = Math.min((time - entity.s.pos.time) | 0, total);
      const state = entity.moverState === MoverState.TWO_TO_ONE ? MoverState.ONE_TO_TWO : MoverState.TWO_TO_ONE;
      this.matchTeam(entity, state, (time - ((total - partial) | 0)) | 0);
      const sound = state === MoverState.ONE_TO_TWO ? entity.sound1to2 : entity.sound2to1;
      if (sound !== 0) this.host.combat.entities.addEvent(entity, EntityEvent.EV_GENERAL_SOUND, sound);
    }
  }

  initializeBinary(entity: GameEntity, variables: SpawnVariables): void {
    this.owned(entity);
    if (entity.model2 !== null) entity.s.modelindex2 = this.host.config.modelIndex(entity.model2);
    const noise = variables.string("noise", "100");
    if (noise.present) entity.s.loopSound = this.host.config.soundIndex(noise.value);
    const light = variables.float("light", "100"), color = variables.vector("color", "1 1 1");
    if (light.present || color.present) {
      const component = (value: number): number => Math.min(255, qvmFloatToInt(f32(value * 255)));
      const intensity = Math.min(255, qvmFloatToInt(f32(light.value / 4)));
      entity.s.constantLight = component(color.value.x) | (component(color.value.y) << 8) | (component(color.value.z) << 16) | (intensity << 24);
    }
    entity.use = (self, other, activator) => { this.useBinary(self, other, activator); };
    entity.reached = self => { this.reachedBinary(self); };
    entity.moverState = MoverState.POS1;
    entity.r.svFlags = ServerEntityFlags.USE_CURRENT_ORIGIN;
    entity.s.eType = EntityType.ET_MOVER;
    entity.r.currentOrigin = { ...entity.pos1 };
    this.host.world.link(entity);
    const move = sub3(entity.pos2, entity.pos1), distance = length3(move);
    if (entity.speed === 0) entity.speed = 100;
    const duration = qvmFloatToInt(f32(f32(distance * 1000) / entity.speed));
    entity.s.pos = { ...entity.s.pos, type: TrajectoryType.TR_STATIONARY, base: { ...entity.pos1 }, delta: scale3(move, entity.speed), duration: Math.max(duration, 1) };
  }

  blockedDoor(entity: GameEntity, other: DamageParticipant): void {
    this.owned(entity);
    if (!(other instanceof GameEntity)) {
      const body = this.host.actors.observe(other.actor);
      if (body === null) return;
      if (body.kind !== "player") {
        this.host.combat.entities.tempEntity(body.state.origin, EntityEvent.EV_ITEM_POP);
        this.host.actors.release(body.actor);
        return;
      }
      if (entity.damage !== 0) damage(this.host.combat, other, entity, entity, null, null, entity.damage, 0, MOD_CRUSH);
      if ((entity.spawnflags & 4) === 0) this.useBinary(entity, entity, other);
      return;
    }
    this.owned(other);
    if (other.client === null) {
      if (other.s.eType === EntityType.ET_ITEM) {
        if (other.item === null) throw new Error("Blocked item has no item definition");
        if (other.item.type === ItemType.IT_TEAM) { this.host.returnDroppedFlag(other); return; }
      }
      this.host.combat.entities.tempEntity(other.s.origin, EntityEvent.EV_ITEM_POP);
      this.host.combat.entities.free(other);
      return;
    }
    if (entity.damage !== 0) damage(this.host.combat, other, entity, entity, null, null, entity.damage, 0, MOD_CRUSH);
    if ((entity.spawnflags & 4) !== 0) return;
    this.useBinary(entity, entity, other);
  }
}
