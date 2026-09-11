import type { MonsterContext } from "../../foundation/monsters/types.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import { anglesVectors, attackTraceMask, changeYaw, enemyBody, finishDodge, health, monsterSolidMask, vectorAngles } from "../../foundation/monsters/ai.ts";
import { add, dot, length, normalize, numberField, scale, subtract } from "../../foundation/fields.ts";
import type { Q2RereleaseRandomSource } from "../../../../core/random/q2-rerelease.ts";

export function rereleaseRandom(context: MonsterContext): Q2RereleaseRandomSource {
  const random = context.game.host.rereleaseRandom;
  if (random === undefined) throw new Error("Rerelease monster source requires the session random stream");
  return random;
}

function traceContents(trace: TraceResult): number { return trace.kind === "q1" ? 0 : trace.contents; }

export function calculatePitchToFire(context: MonsterContext, target: Vec3, start: Vec3, aim: Vec3, speed: number, seconds: number, mortar: boolean, destroyOnTouch = false): Vec3 | null {
  const angles = vectorAngles(aim), world = context.game.entity(context.game.host.worldActor());
  const gravity = world === null ? 800 : numberField(world.spawn, "gravity", 800);
  let bestPitch = 0, bestDistance = Infinity;
  for (const pitch of [-80, -70, -60, -50, -40, -30, -20, -10, -5]) {
    if (mortar && pitch >= -30) break;
    let velocity = scale(anglesVectors({ ...angles, x: pitch }).forward, speed), origin = start;
    for (let remaining = seconds; remaining > 0; remaining -= 0.1) {
      velocity = { ...velocity, z: velocity.z - gravity * 0.1 };
      const trace = context.game.host.trace({ start: origin, end: add(origin, scale(velocity, 0.1)), bounds: null, ignore: null, mask: 3 | 0x2000000 | 0x4000000 | 0x40000000 });
      origin = trace.end;
      if (trace.fraction >= 1) continue;
      if (trace.kind === "q2" && ((trace.surface?.flags ?? 0) & 4) !== 0) break;
      const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : { x: 0, y: 0, z: 0 };
      origin = add(origin, normal);
      velocity = subtract(velocity, scale(normal, dot(velocity, normal) * 1.6));
      const delta = subtract(origin, target), distance = dot(delta, delta);
      if (trace.hit.kind === "actor" && (context.entity.enemy?.equals(trace.hit.actor) === true || context.game.host.isPlayer(trace.hit.actor)) || normal.z >= 0.7 && distance < 128 * 128 && distance < bestDistance) { bestPitch = pitch; bestDistance = distance; }
      if (destroyOnTouch || (traceContents(trace) & (0x2000000 | 0x4000000 | 0x40000000)) !== 0) break;
    }
  }
  return Number.isFinite(bestDistance) ? anglesVectors({ ...angles, x: bestPitch }).forward : null;
}

export function chainfist(context: MonsterContext): boolean {
  const cause = context.entity.lastAttack?.cause;
  return cause?.kind === "q2" && cause.meansOfDeath === 40;
}

export function reactsToPain(context: MonsterContext): boolean {
  return !context.state.ducked && !context.state.combatPoint && (context.game.options.skill < 3 || chainfist(context));
}

export function checkGib(context: MonsterContext): boolean {
  const cause = context.entity.lastAttack?.cause;
  return health(context.game, context.entity.actor.id) <= context.state.gibHealth
    || context.state.dead && cause?.kind === "q2" && cause.meansOfDeath === 20;
}

export function monsterFlash(context: MonsterContext, flash: number, origin: Vec3, direction: Vec3): undefined {
  return context.game.host.emit({ kind: "monster-muzzleflash", actor: context.entity.actor.id, flash, origin, direction });
}

export function predictedDirection(context: MonsterContext, start: Vec3, speed: number, eye: boolean, offset = 0): Vec3 | null {
  return predictAim(context, start, speed, eye, offset)?.direction ?? null;
}

export function predictAim(context: MonsterContext, start: Vec3, speed: number, eye: boolean, offset = 0): { readonly direction: Vec3; readonly point: Vec3 } | null {
  const enemy = enemyBody(context);
  if (enemy === null) return null;
  const { game, entity } = context, rerelease = game.options.edition === "rerelease";
  const viewHeight = game.entity(entity.enemy)?.viewHeight ?? 22;
  let direction = subtract({ ...enemy.origin, z: enemy.origin.z + (eye ? viewHeight : 0) }, start);
  if (rerelease) {
    const trace = game.host.trace({ start, end: add(start, direction), bounds: null, ignore: entity.actor.id, mask: attackTraceMask(game) });
    if (trace.hit.kind !== "actor" || entity.enemy === null || !trace.hit.actor.equals(entity.enemy)) {
      eye = !eye;
      direction = subtract({ ...enemy.origin, z: enemy.origin.z + (eye ? viewHeight : 0) }, start);
    }
  }
  const time = rerelease && speed === 0 ? 0 : length(direction) / speed;
  let target = add(enemy.origin, scale(enemy.velocity, time - offset));
  if (rerelease && (dot(normalize(direction), normalize(subtract(target, start))) < 0
    || game.host.trace({ start, end: target, bounds: null, ignore: null, mask: 3 }).fraction < 0.9)) target = enemy.origin;
  const point = { ...target, z: target.z + (eye ? viewHeight : 0) };
  return { direction: normalize(subtract(point, start)), point };
}

export function blockedCheckPlatform(context: MonsterContext, distance: number): boolean {
  const enemy = enemyBody(context);
  if (enemy === null) return false;
  const { game, entity } = context, body = game.body(entity);
  const above = enemy.origin.z + enemy.bounds.min.z >= body.origin.z + body.bounds.max.z;
  const below = enemy.origin.z + enemy.bounds.max.z <= body.origin.z + body.bounds.min.z;
  if (!above && !below) return false;
  let platform = game.entity(body.ground);
  if (!platform?.classname.startsWith("func_plat")) {
    const start = add(body.origin, scale(anglesVectors(body.angles).forward, distance));
    const trace = game.host.trace({ start, end: add(start, { x: 0, y: 0, z: -384 }), bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    platform = trace.fraction < 1 && !trace.allSolid && !trace.startSolid && trace.hit.kind === "actor" ? game.entity(trace.hit.actor) : null;
  }
  if (platform === null || !platform.classname.startsWith("func_plat") || platform.use === null) return false;
  const state = context.platformState(platform.actor.id), standing = body.ground?.equals(platform.actor.id) === true;
  if (above ? standing && state === "bottom" || !standing && state === "top" : standing && state === "top" || !standing && state === "bottom") {
    platform.use(platform, game, entity.actor.id, entity.actor.id);
    return true;
  }
  return false;
}

export function monsterJumpFinished(context: MonsterContext): boolean {
  const { game, entity } = context;
  if (game.options.edition === "classic") return game.host.now() - entity.timestamp > 3;
  const body = game.body(entity), forward = anglesVectors(body.angles).forward;
  if (length({ x: body.velocity.x * forward.x, y: body.velocity.y * forward.y, z: body.velocity.z * forward.z }) < 150) {
    game.move(entity, { velocity: { ...scale(forward, 150), z: body.velocity.z } });
  }
  return context.state.jumpTime < game.host.now();
}

export type JumpNavigation = { readonly kind: "none" } | { readonly kind: "path"; readonly traversalPending: boolean; readonly first: Vec3; readonly second: Vec3 };
export type JumpResult = "none" | "up" | "down" | "turn";

export function blockedCheckJump(context: MonsterContext, _distance: number, dropHeight: number, jumpHeight: number, canJump = true, navigation: JumpNavigation = { kind: "none" }): JumpResult {
  const enemy = enemyBody(context);
  if (enemy === null) return "none";
  const { game, entity, state } = context, rerelease = game.options.edition === "rerelease", body = game.body(entity);
  if (rerelease && (!canJump || state.jumpTime > game.host.now())) return "none";
  const startJump = (): undefined => { if (rerelease) { finishDodge(context); state.jumpTime = game.host.now() + 3; } return undefined; };
  if (rerelease && navigation.kind === "path") {
    if (!navigation.traversalPending) return "none";
    state.idealYaw = vectorAngles(normalize(subtract(navigation.first, navigation.second))).y + 180;
    if (state.idealYaw > 360) state.idealYaw -= 360;
    const delta = ((body.angles.y - state.idealYaw) % 360 + 360) % 360;
    if (delta > 45 && delta < 315) { changeYaw(context); return "turn"; }
    startJump(); return navigation.second.z > navigation.first.z ? "up" : "down";
  }
  const minZ = body.origin.z + body.bounds.min.z, enemyMin = enemy.origin.z + enemy.bounds.min.z;
  const forward = anglesVectors(body.angles).forward, ahead = add(body.origin, scale(forward, 48));
  const down = enemyMin < minZ - (rerelease ? 18 : 16), up = enemyMin > minZ + (rerelease ? 18 : 16);
  if (down && dropHeight !== 0) {
    if (game.host.trace({ start: body.origin, end: ahead, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) }).fraction < 1) return "none";
    const end = { ...ahead, z: (rerelease ? minZ : body.bounds.min.z) - dropHeight - 1 };
    const trace = game.host.trace({ start: ahead, end, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) | 56 });
    if (trace.fraction === 1 || trace.allSolid || trace.startSolid) return "none";
    if (rerelease && (traceContents(trace) & 32) !== 0) {
      const deep = game.host.trace({ start: trace.end, end, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
      if ((game.host.pointContents({ ...deep.end, z: deep.end.z + body.bounds.min.z + 49 }) & 56) !== 0) return "none";
    }
    if (minZ - trace.end.z < 24 || (traceContents(trace) & (rerelease ? 35 : 3)) === 0 || enemyMin - trace.end.z > 32
      || trace.contact.kind !== "plane" || trace.contact.plane.normal.z < 0.9) return "none";
    startJump(); return "down";
  }
  if (up && jumpHeight !== 0) {
    const trace = game.host.trace({ start: { ...ahead, z: body.origin.z + body.bounds.max.z + jumpHeight }, end: ahead, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) | 56 });
    if (trace.fraction === 1 || trace.allSolid || trace.startSolid || trace.end.z - minZ > jumpHeight || (traceContents(trace) & (rerelease ? 35 : 3)) === 0) return "none";
    const wall = game.host.trace({ start: body.origin, end: add(body.origin, scale(forward, 64)), bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    if (wall.fraction < 1 && !wall.allSolid && !wall.startSolid && wall.contact.kind === "plane") {
      state.idealYaw = vectorAngles(wall.contact.plane.normal).y + 180;
      if (state.idealYaw > 360) state.idealYaw -= 360;
      changeYaw(context);
    }
    startJump(); return "up";
  }
  return "none";
}
