/* Walking-monster movement and perception from Q2 g_ai.c/m_move.c and the rerelease DLL. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { Q2Entity, Q2GameServices } from "../host.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../fields.ts";
import type { MonsterContext, MonsterFrame } from "./types.ts";
import { alternateFlyStep } from "./alternate-fly.ts";

export const MASK_MONSTERSOLID = 1 | 2 | 0x20000 | 0x2000000;
export const MASK_SHOT = 1 | 2 | 8 | 16 | 0x2000000;
export function monsterSolidMask(game: Q2GameServices): number { return MASK_MONSTERSOLID | (game.options.edition === "rerelease" ? 0x40000000 : 0); }
export function attackTraceMask(game: Q2GameServices): number { return MASK_SHOT | (game.options.edition === "rerelease" ? 0x40000000 : 0); }
export const MASK_OPAQUE = 1 | 8 | 16;
export const MASK_WATER = 8 | 16 | 32;
export const FL_NOTARGET = 32;

export function anglesVectors(angles: Vec3): { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3 } {
  const yaw = angles.y * Math.PI / 180, pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  return { forward: { x: cp * cy, y: cp * sy, z: -sp },
    right: { x: -sr * sp * cy + cr * sy, y: -sr * sp * sy - cr * cy, z: -sr * cp },
    up: { x: cr * sp * cy + sr * sy, y: cr * sp * sy - sr * cy, z: cr * cp } };
}

export function vectorAngles(direction: Vec3): Vec3 {
  const yaw = direction.x === 0 && direction.y === 0 ? 0 : Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  const pitch = Math.atan2(direction.z, Math.hypot(direction.x, direction.y)) * 180 / Math.PI;
  return { x: -pitch, y: yaw < 0 ? yaw + 360 : yaw, z: 0 };
}

export function health(game: Q2GameServices, actor: ActorId | null): number { return actor === null ? 0 : game.host.combat.read(actor)?.health ?? 0; }
export function enemyBody(context: MonsterContext) { return context.entity.enemy === null ? null : context.game.host.bodies.read(context.entity.enemy); }
export function enemyEye(context: MonsterContext): Vec3 | null {
  const body = enemyBody(context);
  if (body === null) return null;
  const observed = context.game.monsterTarget(context.entity.enemy);
  return observed === null ? null : { ...body.origin, z: body.origin.z + observed.viewHeight };
}

export function targetDistance(context: MonsterContext): number {
  const enemy = enemyBody(context);
  if (enemy === null) return Infinity;
  const self = context.game.body(context.entity);
  if (context.game.options.edition === "classic") return length(subtract(enemy.origin, self.origin));
  const axis = (a: number, amin: number, amax: number, b: number, bmin: number, bmax: number): number => Math.max(0, b + bmin - a - amax, a + amin - b - bmax);
  return Math.hypot(axis(self.origin.x, self.bounds.min.x, self.bounds.max.x, enemy.origin.x, enemy.bounds.min.x, enemy.bounds.max.x),
    axis(self.origin.y, self.bounds.min.y, self.bounds.max.y, enemy.origin.y, enemy.bounds.min.y, enemy.bounds.max.y),
    axis(self.origin.z, self.bounds.min.z, self.bounds.max.z, enemy.origin.z, enemy.bounds.min.z, enemy.bounds.max.z));
}

export function visible(context: MonsterContext, actor = context.entity.enemy): boolean {
  if (actor === null) return false;
  const target = context.game.host.bodies.read(actor);
  if (target === null) return false;
  const origin = context.game.body(context.entity).origin;
  const start = { ...origin, z: origin.z + context.entity.viewHeight };
  const observed = context.game.monsterTarget(actor); if (observed === null) return false;
  const end = { ...target.origin, z: target.origin.z + observed.viewHeight };
  return context.game.host.trace({ start, end, bounds: null, ignore: context.entity.actor.id, mask: MASK_OPAQUE }).fraction === 1;
}

export function inFront(context: MonsterContext, actor: ActorId): boolean {
  const body = context.game.host.bodies.read(actor);
  if (body === null) return false;
  const self = context.game.body(context.entity);
  return dot(anglesVectors(self.angles).forward, normalize(subtract(body.origin, self.origin))) > 0.3;
}

export function projectFlash(context: MonsterContext, offset: Vec3, angles = context.game.body(context.entity).angles): Vec3 {
  const body = context.game.body(context.entity);
  const { forward, right } = anglesVectors(angles);
  const size = context.game.options.edition === "rerelease" ? context.entity.scale : 1;
  return add(body.origin, add(scale(forward, offset.x * size), add(scale(right, offset.y * size), { x: 0, y: 0, z: offset.z * size })));
}

export function clearShot(context: MonsterContext, offset: Vec3): boolean {
  const eye = enemyEye(context);
  if (eye === null) return false;
  const rerelease = context.game.options.edition === "rerelease";
  const angles = context.game.body(context.entity).angles;
  const start = projectFlash(context, offset, rerelease ? { x: angles.x, y: context.state.idealYaw, z: 0 } : angles);
  const blind = rerelease && (context.state.attackState === "blind" || context.state.manualSteering || context.state.lostSight);
  const mask = rerelease ? 0x42000003 | 0x4000 : MASK_SHOT;
  const clear = (end: Vec3): boolean => {
    const trace = context.game.host.trace({ start, end, bounds: null, ignore: context.entity.actor.id, mask });
    return trace.hit.kind === "actor" && (trace.hit.actor === context.entity.enemy || rerelease && context.game.host.isPlayer(trace.hit.actor)) || (rerelease ? trace.fraction > 0.8 && !trace.startSolid : trace.fraction === 1);
  };
  if (clear(blind ? context.state.blindFireTarget : eye)) return true;
  const enemy = enemyBody(context);
  return rerelease && !blind && enemy !== null && clear(enemy.origin);
}

export function traceGroundActor(trace: TraceResult, game: Q2GameServices): ActorId | null {
  if (trace.hit.kind === "actor") return trace.hit.actor;
  if (trace.hit.kind === "world") return game.host.worldActor();
  return null;
}

export function changeYaw(context: MonsterContext): undefined {
  const body = context.game.body(context.entity);
  const current = ((body.angles.y % 360) + 360) % 360;
  let move = context.state.idealYaw - current;
  if (move > 180) move -= 360;
  if (move < -180) move += 360;
  const speed = context.state.yawSpeed * (context.game.options.edition === "rerelease" ? context.game.host.frameSeconds() * 10 : 1);
  move = Math.max(-speed, Math.min(speed, move));
  return context.game.move(context.entity, { angles: { ...body.angles, y: ((current + move) % 360 + 360) % 360 } }, false);
}

export function faceEnemy(context: MonsterContext): undefined {
  const target = context.state.manualSteering ? context.state.blindFireTarget : enemyBody(context)?.origin;
  if (target === undefined) return undefined;
  context.state.idealYaw = vectorAngles(subtract(target, context.game.body(context.entity).origin)).y;
  return changeYaw(context);
}

export function checkBottom(context: MonsterContext, origin: Vec3): boolean {
  const body = context.game.body(context.entity);
  const minimum = add(origin, body.bounds.min), maximum = add(origin, body.bounds.max);
  const ceiling = context.entity.gravityVector.z > 0, direction = ceiling ? 1 : -1;
  const support = ceiling ? maximum.z : minimum.z;
  const corners: readonly Vec3[] = [
    { x: minimum.x, y: minimum.y, z: support + direction }, { x: minimum.x, y: maximum.y, z: support + direction },
    { x: maximum.x, y: minimum.y, z: support + direction }, { x: maximum.x, y: maximum.y, z: support + direction },
  ];
  if (corners.every(point => context.game.host.pointContents(point) === 1)) return true;
  const rerelease = context.game.options.edition === "rerelease";
  const center = { x: (minimum.x + maximum.x) * 0.5, y: (minimum.y + maximum.y) * 0.5, z: support };
  const start = rerelease ? { x: origin.x, y: origin.y, z: support } : center;
  const middle = context.game.host.trace({ start, end: { ...start, z: start.z + direction * 36 },
    bounds: rerelease ? { min: { ...body.bounds.min, z: 0 }, max: { ...body.bounds.max, z: 0 } } : null,
    ignore: context.entity.actor.id, mask: monsterSolidMask(context.game) });
  if (middle.fraction === 1) return false;
  if (rerelease && (context.entity.spawnflags & 131072) !== 0) return true;
  const quadrant = { x: (maximum.x - minimum.x) * 0.25, y: (maximum.y - minimum.y) * 0.25, z: 0 };
  for (const corner of corners) {
    const point = rerelease ? { x: center.x + (corner.x === minimum.x ? -quadrant.x : quadrant.x), y: center.y + (corner.y === minimum.y ? -quadrant.y : quadrant.y), z: support } : { ...corner, z: support };
    const trace = context.game.host.trace({ start: point, end: { ...point, z: point.z + direction * 36 }, bounds: rerelease ? { min: scale(quadrant, -1), max: quadrant } : null,
      ignore: context.entity.actor.id, mask: monsterSolidMask(context.game) });
    if (trace.fraction === 1 || (trace.end.z - middle.end.z) * direction > 18) return false;
  }
  return true;
}

export function walkMove(context: MonsterContext, yaw: number, distance: number, commit = true, relink = true): boolean {
  const moved = sourceMoveStep(context, yaw, distance, commit, relink);
  if (commit && relink) context.consumeSourceBlocked();
  return moved;
}

function sourceMoveStep(context: MonsterContext, yaw: number, distance: number, commit: boolean, relink: boolean): boolean {
  const body = context.game.body(context.entity);
  if (context.state.locomotion === "stationary") return false;
  if (body.ground === null && context.state.locomotion === "walk") return false;
  const radians = yaw * Math.PI / 180;
  const step = context.beforeSourceMove({ x: Math.cos(radians) * distance, y: Math.sin(radians) * distance, z: 0 });
  if (step.kind === "handled") return true;
  const destination = add(body.origin, step.displacement);
  if (context.state.locomotion === "fly" || context.state.locomotion === "swim") {
    if (context.game.options.edition === "rerelease" && context.state.alternateFly && alternateFlyStep(context)) return true;
    const game = context.game, entity = context.entity, state = context.state;
    const wet = (game.host.pointContents({ ...body.origin, z: body.origin.z + body.bounds.min.z + 1 }) & MASK_WATER) !== 0;
    const deep = (game.host.pointContents({ ...body.origin, z: body.origin.z + body.bounds.min.z + 27 }) & MASK_WATER) !== 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      let end = destination;
      if (attempt === 0 && entity.enemy !== null) {
        if (entity.goal === null) entity.goal = entity.enemy;
        const goal = game.host.bodies.read(entity.goal);
        if (goal !== null) {
          const dz = body.origin.z - goal.origin.z;
          const stride = game.options.edition === "rerelease" ? game.host.frameSeconds() * 80 : 8;
          if (game.host.isPlayer(entity.goal)) {
            if (dz > 40) end = { ...end, z: end.z - stride };
            if (dz < 30 && !(state.locomotion === "swim" && !deep)) end = { ...end, z: end.z + stride };
          } else end = { ...end, z: end.z + (dz > stride ? -stride : dz > 0 ? -dz : dz < -stride ? stride : dz) };
        }
      }
      const trace = game.host.trace({ start: body.origin, end, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
      const entersWater = (game.host.pointContents({ ...trace.end, z: trace.end.z + body.bounds.min.z + 1 }) & MASK_WATER) !== 0;
      if (state.locomotion === "fly" && !wet && entersWater || state.locomotion === "swim" && !deep && !entersWater) return false;
      if (trace.fraction === 1 && !trace.startSolid && !trace.allSolid) { if (commit) { game.move(entity, { origin: trace.end }, relink); if (relink) game.host.touchTriggers(entity.actor); } return true; }
      if (entity.enemy === null) break;
    }
    return false;
  }
  const gravity = context.entity.gravityVector, ceiling = gravity.z > 0;
  const start = add(destination, scale(gravity, -18)), end = add(start, scale(gravity, 36));
  let trace = context.game.host.trace({ start, end, bounds: body.bounds, ignore: context.entity.actor.id, mask: monsterSolidMask(context.game) });
  if (trace.allSolid) return false;
  if (trace.startSolid) {
    const retry = context.game.options.edition === "classic" ? { ...start, z: start.z - 18 } : destination;
    trace = context.game.host.trace({ start: retry, end, bounds: body.bounds, ignore: context.entity.actor.id, mask: monsterSolidMask(context.game) });
    if (trace.startSolid || trace.allSolid) return false;
  }
  const supportOffset = ceiling ? body.bounds.max.z - 1 : body.bounds.min.z + 1;
  const feet = { ...body.origin, z: body.origin.z + supportOffset };
  if ((context.game.host.pointContents(feet) & MASK_WATER) === 0 && (context.game.host.pointContents({ ...trace.end, z: trace.end.z + supportOffset }) & MASK_WATER) !== 0) return false;
  if (trace.fraction === 1) {
    if ((context.entity.flags & 256) === 0) return false;
    if (commit) { context.game.move(context.entity, { origin: destination, ground: null }, relink); if (relink) context.game.host.touchTriggers(context.entity.actor); }
    return true;
  }
  if (!context.acceptsSourceGroundMove(trace.end)) return false;
  if (!checkBottom(context, trace.end)) {
    if ((context.entity.flags & 256) === 0) return false;
    if (commit) { context.game.move(context.entity, { origin: trace.end }, relink); if (relink) context.game.host.touchTriggers(context.entity.actor); }
    return true;
  }
  if (commit) {
    context.entity.flags &= ~256;
    context.game.move(context.entity, { origin: trace.end, ground: traceGroundActor(trace, context.game) }, relink);
    if (relink) context.game.host.touchTriggers(context.entity.actor);
  }
  return true;
}

export function stepDirection(context: MonsterContext, yaw: number, distance: number): boolean {
  context.state.idealYaw = yaw;
  changeYaw(context);
  const previous = context.game.body(context.entity);
  if (!walkMove(context, yaw, distance, true, false)) { context.game.link(context.entity); context.game.host.touchTriggers(context.entity.actor); return !context.game.host.actors.isLive(context.entity.actor.id); }
  context.consumeSourceBlocked();
  if (!context.game.host.actors.isLive(context.entity.actor.id)) return true;
  const delta = ((context.game.body(context.entity).angles.y - context.state.idealYaw) % 360 + 360) % 360;
  if (delta > 45 && delta < 315 && !(context.sourceCombatRules() === "rogue" && context.entity.classname.startsWith("monster_widow"))) context.game.move(context.entity, { origin: previous.origin }, false);
  context.game.link(context.entity);
  context.game.host.touchTriggers(context.entity.actor);
  return true;
}

/** SV_NewChaseDir's diagonal/cardinal sweep preserves source RNG and yaw order. */
export function chaseDirection(context: MonsterContext, goal: Vec3, distance: number): boolean {
  const old = Math.trunc(context.state.idealYaw / 45) * 45;
  const turnaround = (old - 180 + 360) % 360;
  const delta = subtract(goal, context.game.body(context.entity).origin);
  let x = delta.x > 10 ? 0 : delta.x < -10 ? 180 : -1;
  let y = delta.y < -10 ? 270 : delta.y > 10 ? 90 : -1;
  if (x !== -1 && y !== -1) {
    const diagonal = x === 0 ? (y === 90 ? 45 : 315) : (y === 90 ? 135 : 215);
    if (diagonal !== turnaround && stepDirection(context, diagonal, distance)) return true;
  }
  const directionRoll = Math.floor(context.game.host.random() * 4);
  if ((context.sourceCombatRules() === "rogue" ? (directionRoll & 1) !== 0 : directionRoll !== 0) || Math.abs(delta.y) > Math.abs(delta.x)) [x, y] = [y, x];
  if (x !== -1 && x !== turnaround && stepDirection(context, x, distance)) return true;
  if (y !== -1 && y !== turnaround && stepDirection(context, y, distance)) return true;
  if (context.sourceCombatRules() === "rogue" && context.game.host.actors.isLive(context.entity.actor.id) && health(context.game, context.entity.actor.id) > 0 && context.blocked(distance)) return true;
  if (old !== -1 && stepDirection(context, old, distance)) return true;
  const descending = Math.floor(context.game.host.random() * 2) === 0;
  for (let index = 0; index < 8; index++) {
    const yaw = descending ? 315 - index * 45 : index * 45;
    if (yaw !== turnaround && stepDirection(context, yaw, distance)) return true;
  }
  if (turnaround !== -1 && stepDirection(context, turnaround, distance)) return true;
  context.state.idealYaw = old;
  if (!checkBottom(context, context.game.body(context.entity).origin)) context.entity.flags |= 256;
  return false;
}

export function runAi(context: MonsterContext, ai: Extract<MonsterFrame["ai"], string>, distance: number): undefined {
  const { game, entity, state } = context;
  const rogue = context.sourceCombatRules() === "rogue";
  const extended = game.options.edition === "rerelease" || rogue;
  if (ai === "none") return undefined;
  if (ai === "turn") {
    if (distance !== 0) walkMove(context, game.body(entity).angles.y, distance);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (context.findTarget()) return undefined;
    if (game.options.edition === "classic" || !state.manualSteering) changeYaw(context);
    return undefined;
  }
  if (ai === "move" || ai === "soldier_move") {
    walkMove(context, game.body(entity).angles.y, distance);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (ai === "soldier_move" && !proneShot(context)) context.dispatch("soldier_stand_up");
    return undefined;
  }
  if (ai === "charge") {
    const enemy = enemyBody(context);
    if (extended && enemy === null) return undefined;
    if (rogue && game.options.edition === "classic" && enemy !== null && visible(context)) state.blindFireTarget = enemy.origin;
    if (!state.manualSteering) faceEnemy(context); else changeYaw(context);
    if (game.options.edition === "rerelease" && enemy !== null && visible(context)) state.blindFireTarget = add(enemy.origin, scale(enemy.velocity, -0.1));
    if (distance !== 0) {
      if (extended && state.charging) { context.moveToGoal(distance); return undefined; }
      const yaw = game.body(entity).angles.y;
      if (extended && state.attackState === "sliding") {
        const side = rogue && game.options.edition === "classic" && entity.enemy !== null && game.entity(entity.enemy)?.classname === "tesla" ? 0 : state.lefty ? 90 : -90;
        const sideways = game.options.edition === "classic" ? distance : distance * state.move.sidestepScale;
        if (!walkMove(context, state.idealYaw + side, sideways)) { state.lefty = !state.lefty; walkMove(context, state.idealYaw - side, sideways); }
      } else walkMove(context, yaw, distance);
    }
    if (game.options.edition === "rerelease" && targetDistance(context) <= 50) changeYaw(context);
    return undefined;
  }
  if (ai === "stand") {
    if (distance !== 0) walkMove(context, game.body(entity).angles.y, distance);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (state.standGround) {
      if (entity.enemy !== null) {
        const enemy = enemyBody(context);
        if (enemy !== null) state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
        if (game.body(entity).angles.y !== state.idealYaw && state.temporaryStandGround) { state.standGround = false; state.temporaryStandGround = false; context.run(); }
        if (!rogue || !state.manualSteering) changeYaw(context);
        const attacking = context.checkAttack(0);
        if (rogue) {
          const target = enemyBody(context);
          if (target !== null && visible(context)) {
            state.lostSight = false; state.lastSighting = target.origin; state.blindFireTarget = target.origin;
            state.trailTime = game.host.now(); state.blindFireDelay = 0;
          } else if (!attacking) context.findTarget();
        }
      } else context.findTarget();
      return undefined;
    }
    if (context.findTarget()) return undefined;
    if (game.host.now() > state.pauseTime) return context.walk();
    if (state.hasIdle && (entity.spawnflags & 1) === 0 && game.host.now() > state.idleTime) {
      if (state.idleTime !== 0) { context.idle(); state.idleTime = game.host.now() + 15 + game.host.random() * 15; }
      else state.idleTime = game.host.now() + game.host.random() * 15;
    }
    return undefined;
  }
  if (ai === "walk") {
    context.moveToGoal(distance);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (context.findTarget()) return undefined;
    if (state.hasSearch && game.host.now() > state.idleTime) {
      if (state.idleTime !== 0) { context.search(); state.idleTime = game.host.now() + 15 + game.host.random() * 15; }
      else state.idleTime = game.host.now() + game.host.random() * 15;
    }
    return undefined;
  }
  if (state.combatPoint) { context.moveToGoal(distance); return undefined; }
  if (rogue && game.options.edition === "classic") {
    state.ducked = false;
    const body = game.body(entity);
    if (body.bounds.max.z !== state.normalHeight) {
      state.canTakeDamage = true; state.nextDuckTime = game.host.now() + 0.5;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      game.move(entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: state.normalHeight } } });
    }
  }
  if (context.runHintPath(distance)) return undefined;
  let alreadyMoved = false;
  if (state.soundTarget !== null) {
    const delta = subtract(game.body(entity).origin, state.soundTarget.origin);
    if (length(delta) < (game.options.edition === "classic" ? 64 : 32)) {
      state.standGround = true; state.temporaryStandGround = true; context.stand(); return undefined;
    }
    context.moveToGoal(distance); alreadyMoved = extended;
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (!context.findTarget()) return undefined;
  }
  const attacking = context.checkAttack(distance);
  if (extended) {
    if (!visible(context) && state.attackState === "sliding") state.attackState = "straight";
    if (state.dodging) state.attackState = "sliding";
  } else if (attacking) return undefined;
  if (state.attackState === "sliding") {
    if (!alreadyMoved) slide(context, distance);
    if (!attacking && state.attackState === "sliding") return undefined;
  } else if (state.charging && !state.manualSteering) faceEnemy(context);
  if (attacking) {
    if (distance !== 0 && !alreadyMoved && state.attackState === "straight" && !state.standGround) context.moveToGoal(distance);
    return undefined;
  }
  if (state.standGround) return undefined;
  if (!visible(context) && context.checkLostHintPath()) return undefined;
  if (!visible(context) && game.options.mode === "coop" && context.findTarget()) return undefined;
  if (!alreadyMoved) context.moveToGoal(distance);
  if (!game.host.actors.isLive(entity.actor.id)) return undefined;
  if (state.searchTime !== 0 && game.host.now() > state.searchTime + 20) state.searchTime = 0;
  return undefined;
}

function slide(context: MonsterContext, distance: number): undefined {
  const { state, game } = context;
  if (!state.manualSteering) faceEnemy(context);
  const side = state.lefty ? 90 : -90;
  const amount = game.options.edition === "rerelease" && state.locomotion !== "fly" ? Math.min(distance, 8 / (game.host.frameSeconds() * 100)) : distance;
  if (walkMove(context, state.idealYaw + side, amount)) return undefined;
  if ((game.options.edition === "rerelease" || context.sourceCombatRules() === "rogue") && state.dodging) { finishDodge(context); state.attackState = "straight"; return undefined; }
  state.lefty = !state.lefty;
  if (!walkMove(context, state.idealYaw - side, amount) && (game.options.edition === "rerelease" || context.sourceCombatRules() === "rogue")) state.attackState = "straight";
  return undefined;
}

export function proneShot(context: MonsterContext): boolean {
  const enemy = enemyBody(context);
  if (enemy === null || health(context.game, context.entity.enemy) <= 0) return false;
  const self = context.game.body(context.entity);
  const difference = subtract(enemy.origin, self.origin);
  return dot(anglesVectors(self.angles).forward, normalize({ ...difference, z: 0 })) >= 0.8;
}

export function setDuck(context: MonsterContext, down: boolean): undefined {
  if (!down && !context.state.ducked) return undefined;
  const body = context.game.body(context.entity);
  context.state.ducked = down;
  context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: context.state.normalHeight - (down ? 32 : 0) } } });
  return undefined;
}

export function finishDodge(context: MonsterContext): undefined {
  context.state.dodging = false;
  if (context.state.attackState === "sliding") context.state.attackState = "straight";
  return undefined;
}

export function corpse(context: MonsterContext): undefined {
  context.state.corpse = true;
  context.entity.serverFlags |= 2;
  context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } });
  context.game.motion(context.entity, "toss");
  context.game.cancel(context.entity);
  if (context.game.options.edition === "classic") {
    if (context.state.kind === "infantry") flyCheck(context);
  } else {
    context.schedule(0.1, "monster_dead_think");
  }
  return undefined;
}

function setFlies(context: MonsterContext, on: boolean): undefined {
  if (on) context.entity.effects |= 0x4000; else context.entity.effects &= ~0x4000;
  context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "infantry/inflies1.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: on ? "start" : "stop" });
  return context.game.show(context.entity);
}

export function monsterDeadThink(context: MonsterContext): undefined {
  const { state, game, entity } = context;
  if (state.kind === "infantry") {
    if (state.fliesTime === null) state.fliesTime = game.host.now() + 5 + game.host.random() * 10;
    else if (state.fliesTime < game.host.now()) {
      const on = (entity.effects & 0x4000) === 0;
      setFlies(context, on);
      state.fliesTime = on ? game.host.now() + 60 : Number.MAX_VALUE;
    }
  }
  if (entity.frame !== state.move.lastFrame) entity.frame++;
  game.show(entity);
  return context.schedule(0.1, "monster_dead_think");
}

function wetCorpse(context: MonsterContext): boolean {
  const body = context.game.body(context.entity);
  return (context.game.host.pointContents({ ...body.origin, z: body.origin.z + body.bounds.min.z + 1 }) & MASK_WATER) !== 0;
}
export function fliesOn(context: MonsterContext): undefined {
  if (wetCorpse(context)) return undefined;
  setFlies(context, true);
  return context.schedule(60, "M_FliesOff");
}
export function fliesOff(context: MonsterContext): undefined { setFlies(context, false); return context.game.cancel(context.entity); }
export function flyCheck(context: MonsterContext): undefined {
  if (wetCorpse(context) || context.game.host.random() > 0.5) return undefined;
  return context.schedule(5 + 10 * context.game.host.random(), "M_FliesOn");
}

export function bodyOf(game: Q2GameServices, entity: Q2Entity | null): Vec3 { return entity === null ? zero : game.body(entity).origin; }
