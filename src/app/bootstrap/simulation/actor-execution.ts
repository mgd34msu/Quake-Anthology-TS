import type { ContentId } from "../../../contracts/content.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { FrameContext, SourceTime } from "../../../contracts/time.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q1Actor } from "../../../content/q1/foundation/entity.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q2Entity, Q2Motion } from "../../../content/q2/foundation/host.ts";
import type { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import type { MonsterState } from "../../../content/q2/foundation/monsters/types.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { FrameScheduler } from "../../../world/scheduler.ts";
import type { SharedPhysics, SharedPhysicsFlags, SharedSolid } from "./physics.ts";

export type ActorExecution =
  | { readonly kind: "q1"; readonly entity: Q1Actor; readonly services: Q1EntityServices; readonly content: ContentId }
  | { readonly kind: "q2"; readonly entity: Q2Entity; readonly services: Q2EntityServices; readonly content: ContentId;
      readMonster(): MonsterState | undefined };

export interface ActorExecutionFrame {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly physics: SharedPhysics;
  readonly scheduler: FrameScheduler;
  readonly frame: FrameContext;
  readonly timeSeconds: number;
  readonly elapsed: number;
  readonly visited: Set<OwnedActor>;
}

const down: Vec3 = { x: 0, y: 0, z: -1 };
function model(path: string): number | null { return /^\*[0-9]+$/.test(path) ? Number(path.slice(1)) : null; }
function seconds(time: SourceTime): number { return time.kind === "seconds" ? time.value : time.value / 1000; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }

export function actorMotion(entry: ActorExecution, body: BodyState): Q2Motion {
  const entity = entry.entity;
  if (entry.kind === "q2") return { actor: entry.entity.actor, velocity: body.velocity, angularVelocity: entry.entity.angularVelocity,
    kind: entry.entity.motion, gravity: entry.entity.gravity, gravityVector: entry.entity.gravityVector, clipMask: entry.entity.clipMask, owner: entry.entity.owner };
  return { actor: entity.actor, velocity: body.velocity, angularVelocity: entity.angularVelocity,
    kind: entry.entity.movement === "flymissile" ? "fly-missile" : entry.entity.movement === "none" || entry.entity.movement === "noclip" ? "stationary" : entry.entity.movement,
    gravity: 1, gravityVector: down, clipMask: 0x6000003, owner: entity.owner };
}

export function actorCollision(entry: ActorExecution): SharedSolid {
  if (entry.kind === "q1") {
    const entity = entry.entity;
    return { family: "q1", solid: entity.solid === "none" ? "none" : entity.solid === "trigger" ? "trigger" : entity.solid === "bsp" ? "brush" : "box",
      model: model(entity.model || entity.originalModel), owner: entity.owner, monster: entity.monster !== null, item: (entity.movementFlags & 256) !== 0 };
  }
  const entity = entry.entity;
  return { family: "q2", solid: entity.solid, model: model(entity.model), owner: entity.owner,
    monster: (entity.serverFlags & 4) !== 0, deadMonster: (entity.serverFlags & 2) !== 0 };
}

export function actorFlags(entry: ActorExecution): SharedPhysicsFlags {
  if (entry.kind === "q1") {
    const entity = entry.entity;
    return { fly: (entity.movementFlags & 1) !== 0, swim: (entity.movementFlags & 2) !== 0, partialGround: (entity.movementFlags & 1024) !== 0,
      waterLevel: entity.waterLevel, waterType: entity.waterType, enemy: entity.monster?.enemy ?? null };
  }
  const entity = entry.entity, monster = entry.readMonster();
  return { teamSlave: (entity.flags & 1024) !== 0, alwaysTouch: (entity.flags & 0x10000000) !== 0,
    ...(monster === undefined ? {} : { fly: monster.locomotion === "fly", swim: monster.locomotion === "swim", dead: monster.dead, waterLevel: monster.waterLevel, waterType: monster.waterType }) };
}

export function writeActorFlags(entry: ActorExecution, changes: SharedPhysicsFlags): undefined {
  if (entry.kind === "q1") {
    if (changes.waterLevel !== undefined) entry.entity.waterLevel = changes.waterLevel;
    const waterType = changes.waterType;
    if (waterType === 0 || waterType === -1 || waterType === -2 || waterType === -3 || waterType === -4 || waterType === -5 || waterType === -6) entry.entity.waterType = waterType;
  } else {
    const monster = entry.readMonster();
    if (monster !== undefined) {
      if (changes.waterLevel === 0 || changes.waterLevel === 1 || changes.waterLevel === 2 || changes.waterLevel === 3) monster.waterLevel = changes.waterLevel;
      if (changes.waterType !== undefined) monster.waterType = changes.waterType;
    }
  }
  return undefined;
}

export function executeActor(entry: ActorExecution, context: ActorExecutionFrame): undefined {
  return entry.kind === "q1" ? executeQ1Actor(entry, context) : executeQ2Actor(entry, context);
}

function executeQ1Actor(entry: Extract<ActorExecution, { readonly kind: "q1" }>, context: ActorExecutionFrame): undefined {
  const { entity, services } = entry, actor = entity.actor;
  const { actors, bodies, physics, scheduler, elapsed } = context;
  const pusher = entity.movement === "push", step = entity.movement === "step";
  const frame: FrameContext = { ...context.frame, phase: "entity-think" };
  if (!pusher && !step) scheduler.run(actor.id, frame, "during-physics");
  if (actors.isLive(actor.id)) {
    if (entity.movement === "noclip") {
      const body = bodies.read(actor.id);
      if (body !== null) {
        bodies.write(actor, { ...body, origin: add(body.origin, { x: body.velocity.x * elapsed, y: body.velocity.y * elapsed, z: body.velocity.z * elapsed }),
          angles: add(body.angles, { x: entity.angularVelocity.x * elapsed, y: entity.angularVelocity.y * elapsed, z: entity.angularVelocity.z * elapsed }) });
        bodies.link(actor);
      }
    } else if (step) {
      physics.step(actor, elapsed);
      entity.movementFlags = (entity.movementFlags & ~512) | (bodies.read(actor.id)?.ground == null ? 0 : 512);
    } else if (entity.move === null && (entity.movement === "toss" || entity.movement === "bounce" || entity.movement === "fly" || entity.movement === "flymissile")) {
      physics.step(actor, elapsed);
    } else services.physicsEntity(actor, context.timeSeconds, elapsed);
  }
  if ((pusher || step) && actors.isLive(actor.id)) scheduler.run(actor.id, frame, "during-physics");
  if (step && actors.isLive(actor.id)) services.checkWaterTransition(entity);
  return undefined;
}

function executeQ2Actor(entry: Extract<ActorExecution, { readonly kind: "q2" }>, context: ActorExecutionFrame): undefined {
  const { services } = entry, actor = entry.entity.actor;
  const { actors, bodies, physics, scheduler, elapsed, visited } = context;
  const frame: FrameContext = { ...context.frame, phase: "entity-think" };
  return services.runActor(actor.id, () => {
    services.prePhysics(actor.id);
    if (!actors.isLive(actor.id)) return undefined;
    const entity = entry.entity;
    if (entity.motion === "push" || entity.motion === "stop") {
      const team = services.pushTeam(actor.id), master = team[0];
      if (master !== undefined && !sameActor(master.id, actor.id)) return undefined;
      for (const member of team) visited.add(member);
      const blocked = physics.pushTeam(team, elapsed);
      if (blocked !== null) {
        for (const member of team) {
          const pending = scheduler.pending(member.id);
          if (pending !== null && actors.isLive(member.id)) {
            const due = { kind: pending.timing.due.kind, value: pending.timing.due.value + (pending.timing.due.kind === "seconds" ? elapsed : elapsed * 1000) };
            scheduler.schedule(member, pending.callback, { ...pending.timing, due });
            const part = services.entity(member.id); if (part !== null) part.nextThink = seconds(due);
          }
        }
      } else for (const member of team) if (actors.isLive(member.id)) scheduler.run(member.id, frame, "during-physics");
      for (const member of team) if (actors.isLive(member.id)) services.postPhysics(member.id);
      return undefined;
    }
    const after = entity.motion === "step";
    if (!after) scheduler.run(actor.id, frame, "during-physics");
    const moved = actors.isLive(actor.id) ? physics.step(actor, elapsed) : undefined;
    if (actors.isLive(actor.id) && (entity.motion === "new-toss" && moved === "moved" || entity.motion === "toss" || entity.motion === "bounce" || entity.motion === "fly" || entity.motion === "fly-missile" || entity.motion === "wall-bounce")) {
      const body = bodies.read(actor.id);
      for (let next = entity.teamChain; body !== null && next !== null;) {
        const follower = services.entity(next); if (follower === null) break;
        const current = bodies.read(follower.actor.id);
        if (current !== null) { bodies.write(follower.actor, { ...current, origin: body.origin }); bodies.link(follower.actor); }
        next = follower.teamChain;
      }
    }
    if (after && actors.isLive(actor.id)) scheduler.run(actor.id, frame, "during-physics");
    if (actors.isLive(actor.id)) services.postPhysics(actor.id);
    return undefined;
  });
}
