/* Quake II rogue/m_turret.c. ZeniMax Media, GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Think, Q2Use } from "../../foundation/host.ts";
import type { Q2MoverModule } from "../../foundation/movers.ts";
import { anglesVectors, attackTraceMask, enemyBody, enemyEye, health, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { throwQ2Debris } from "../../foundation/scenery.ts";
import { move } from "../../base/monsters/common.ts";
import { monsterFlash } from "../../rerelease/monsters/common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { turretFrame, turretMoves } from "./tables/rogue-turret.ts";

function anglemod(angle: number): number { return (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
function targetOrWorld(context: MonsterContext, trace: TraceResult): boolean {
  return trace.hit.kind === "none" || trace.hit.kind === "world" || trace.hit.actor.equals(context.game.host.worldActor()) || context.entity.enemy !== null && trace.hit.actor.equals(context.entity.enemy);
}

export function createRogueTurretDefinition(monsters: Q2Monsters, movers: Q2MoverModule, source: Q2MissionPackMonsterState): Q2MonsterDefinition {
  const ready = move("turret_move_ready_gun");
  const run = (context: MonsterContext): undefined => context.entity.frame < turretFrame.run01 ? ready(context) : context.setMove("turret_move_run");
  function aim(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    if (entity.enemy === null || entity.enemy.equals(game.host.worldActor())) { if (!context.findTarget()) return undefined; }
    if (entity.frame < turretFrame.active01) return ready(context);
    if (entity.frame < turretFrame.run01) return undefined;
    const enemy = enemyBody(context); if (enemy === null || entity.enemy === null) return undefined;
    let end = enemy.origin;
    const viewHeight = game.entity(entity.enemy)?.viewHeight ?? 22;
    if (state.move.name === "turret_move_fire_blind") end = { ...state.blindFireTarget, z: state.blindFireTarget.z + (enemy.origin.z < state.blindFireTarget.z ? viewHeight + 10 : enemy.bounds.min.z - 10) };
    else if (game.host.isPlayer(entity.enemy)) end = { ...end, z: end.z + viewHeight };
    const body = game.body(entity), ideal = vectorAngles(subtract(end, body.origin));
    let pitch = ideal.x, yaw = ideal.y;
    switch (source.get(entity).turretOrientation) {
      case -1: if (pitch < -90) pitch += 360; pitch = Math.min(pitch, -5); break;
      case -2: if (pitch > -90) pitch -= 360; pitch = clamp(pitch, -355, -185); break;
      case 0: if (pitch < -180) pitch += 360; pitch = clamp(pitch, -85, 85); if (yaw > 180) yaw -= 360; yaw = clamp(yaw, -85, 85); break;
      case 90: if (pitch < -180) pitch += 360; pitch = clamp(pitch, -85, 85); if (yaw > 270) yaw -= 360; yaw = clamp(yaw, 5, 175); break;
      case 180: if (pitch < -180) pitch += 360; pitch = clamp(pitch, -85, 85); yaw = clamp(yaw, 95, 265); break;
      case 270: if (pitch < -180) pitch += 360; pitch = clamp(pitch, -85, 85); if (yaw < 90) yaw += 360; yaw = clamp(yaw, 185, 355); break;
    }
    let pitchMove = pitch - body.angles.x;
    while (pitchMove >= 360) pitchMove -= 360;
    if (pitchMove >= 90) pitchMove -= 360;
    while (pitchMove <= -360) pitchMove += 360;
    if (pitchMove <= -90) pitchMove += 360;
    let yawMove = yaw - body.angles.y;
    if (yawMove >= 180) yawMove -= 360;
    if (yawMove <= -180) yawMove += 360;
    return game.move(entity, { angles: { x: pitch === body.angles.x ? body.angles.x : anglemod(body.angles.x + clamp(pitchMove, -state.yawSpeed, state.yawSpeed)),
      y: yaw === body.angles.y ? body.angles.y : anglemod(body.angles.y + clamp(yawMove, -state.yawSpeed, state.yawSpeed)), z: body.angles.z } });
  }
  function rocketSpeed(context: MonsterContext): number {
    const { game } = context;
    return 550 + (game.options.skill === 2 ? Math.trunc(200 * game.host.random()) : game.options.skill === 3 ? Math.trunc(100 + 200 * game.host.random()) : 0);
  }
  function fire(context: MonsterContext, blind: boolean): undefined {
    aim(context);
    const { entity, game, state } = context, enemy = enemyBody(context);
    if (enemy === null || entity.enemy === null) return undefined;
    const start = game.body(entity).origin;
    const direct = normalize(subtract(blind ? state.blindFireTarget : enemy.origin, start));
    if (dot(direct, anglesVectors(game.body(entity).angles).forward) < 0.98) return undefined;
    if (!blind) game.host.random(); // The source retains this draw after its fire-chance condition was removed.
    const speed = (entity.spawnflags & 32) !== 0 ? rocketSpeed(context) : game.options.skill === 0 ? 600 : game.options.skill === 1 ? 800 : 1000;
    if (!blind && !visible(context)) return undefined;
    const viewHeight = game.entity(entity.enemy)?.viewHeight ?? 22;
    let end = blind ? { ...state.blindFireTarget, z: state.blindFireTarget.z + (enemy.origin.z < state.blindFireTarget.z ? viewHeight + 10 : enemy.bounds.min.z - 10) }
      : { ...enemy.origin, z: enemy.origin.z + (game.host.isPlayer(entity.enemy) ? viewHeight : 22) };
    const distance = length(subtract(end, start));
    if (!blind && (entity.spawnflags & 80) === 0 && distance < 512 && game.host.random() + (3 - game.options.skill) * 0.1 < 0.8) end = add(end, scale(enemy.velocity, distance / 1000));
    const direction = normalize(subtract(end, start));
    const trace = blind ? null : game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: attackTraceMask(game) });
    if (trace !== null && !targetOrWorld(context, trace)) return undefined;
    if ((entity.spawnflags & 8) !== 0) {
      context.weapons.fireBlaster(entity, game, start, direction, 20, blind ? 1000 : speed, 8); monsterFlash(context, 143, start, direction);
    } else if (!blind && (entity.spawnflags & 16) !== 0) {
      context.weapons.fireBullet(entity, game, start, direction, 4, 0, 300, 500, 0); monsterFlash(context, 141, start, direction);
    } else if ((entity.spawnflags & 32) !== 0 && (trace === null || distance * trace.fraction > 72)) {
      context.weapons.fireRocket(entity, game, start, direction, 50, speed, 70, 50); monsterFlash(context, 142, start, direction);
    }
    return undefined;
  }
  const wake: Q2Think = (entity, game) => {
    if ((entity.flags & 1024) !== 0) return undefined;
    const context = monsters.context(entity.actor.id);
    if (context === null) throw new Error("Turret wall wake has no source monster context");
    context.state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    game.motion(entity, "stationary"); context.setMove("turret_move_stand");
    // stationarymonster_start consumes its initial random frame but must not count a second time.
    entity.frame = Math.floor(game.host.random() * 2);
    game.link(entity); game.show(entity);
    entity.use = game.sourceCallbacks.use.resolve("monster_use");
    const start = game.sourceCallbacks.think.resolve("monster_start_go");
    if (start === null) throw new Error("Turret wake has no source stationarymonster_start callback");
    return game.schedule(entity, 0.1, start);
  };
  const activate: Q2Use = (entity, game) => {
    game.motion(entity, "push"); entity.speed ||= 15; entity.accel = entity.decel = entity.speed;
    const angles = game.body(entity).angles;
    let forward: Vec3 = zero;
    if (angles.x === 270) forward = { x: 0, y: 0, z: 1 };
    else if (angles.x === 90) forward = { x: 0, y: 0, z: -1 };
    else if (angles.y === 0) forward = { x: 1, y: 0, z: 0 };
    else if (angles.y === 90) forward = { x: 0, y: 1, z: 0 };
    else if (angles.y === 180) forward = { x: -1, y: 0, z: 0 };
    else if (angles.y === 270) forward = { x: 0, y: -1, z: 0 };
    movers.linear.moveTo(entity, game, add(game.body(entity).origin, scale(forward, 32)), wake);
    const base = game.entity(entity.teamChain);
    if (base !== null) {
      game.motion(base, "push"); base.speed = base.accel = base.decel = entity.speed;
      movers.linear.moveTo(base, game, add(game.body(base).origin, scale(forward, 32)), wake);
    }
    return game.sound(entity, "world/dr_short.wav", 2);
  };
  return {
    classname: "monster_turret", kind: "turret", model: "models/monsters/turret/tris.md2", health: 240, gibHealth: -100, mass: 250,
    bounds: { min: { x: -12, y: -12, z: -12 }, max: { x: 12, y: 12, z: 12 } }, scale: 1, yawSpeed: 45, locomotion: "stationary", viewHeight: 0,
    initialMove: "turret_move_stand", moves: turretMoves, stand: move("turret_move_stand"), run,
    walk(context) { return context.entity.frame < turretFrame.run01 ? ready(context) : context.setMove("turret_move_seek"); },
    blindFire: true,
    startMode(context) { return (context.entity.spawnflags & 128) !== 0 ? "manual" : "automatic"; },
    initialize(context) {
      const { entity, game, state } = context, body = game.body(entity);
      entity.flags |= 8192; entity.gravity = 0; state.manualSteering = true; state.ignoreShots = true;
      if ((entity.spawnflags & 120) === 0) entity.spawnflags |= 8;
      if ((entity.spawnflags & 64) !== 0) entity.spawnflags = (entity.spawnflags & ~64) | 8;
      source.get(entity).turretOrientation = Math.trunc(body.angles.y);
      switch (Math.trunc(body.angles.y)) {
        case -1: game.move(entity, { angles: { ...body.angles, x: 270, y: 0 }, origin: add(body.origin, { x: 0, y: 0, z: 2 }) }); break;
        case -2: game.move(entity, { angles: { ...body.angles, x: 90, y: 0 }, origin: add(body.origin, { x: 0, y: 0, z: -2 }) }); break;
        case 0: game.move(entity, { origin: add(body.origin, { x: 2, y: 0, z: 0 }) }); break;
        case 90: game.move(entity, { origin: add(body.origin, { x: 0, y: 2, z: 0 }) }); break;
        case 180: game.move(entity, { origin: add(body.origin, { x: -2, y: 0, z: 0 }) }); break;
        case 270: game.move(entity, { origin: add(body.origin, { x: 0, y: -2, z: 0 }) }); break;
      }
      if ((entity.spawnflags & 128) !== 0 && entity.targetname === "") return game.remove(entity);
      return undefined;
    },
    afterSpawn(context) {
      const { entity, game, state } = context;
      if ((entity.spawnflags & 128) !== 0) {
        state.canTakeDamage = false; game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); entity.use = activate; game.cancel(entity);
        const base = game.create("turret_wall"), body = game.body(entity);
        const orientation = body.angles.x === 90 ? -1 : body.angles.x === 270 ? -2 : Math.trunc(body.angles.y);
        let bounds: Bounds = { min: zero, max: zero };
        switch (orientation) {
          case -1: bounds = { min: { x: -16, y: -16, z: -8 }, max: { x: 16, y: 16, z: 0 } }; break;
          case -2: bounds = { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 8 } }; break;
          case 0: bounds = { min: { x: -8, y: -16, z: -16 }, max: { x: 0, y: 16, z: 16 } }; break;
          case 90: bounds = { min: { x: -16, y: -8, z: -16 }, max: { x: 16, y: 0, z: 16 } }; break;
          case 180: bounds = { min: { x: 0, y: -16, z: -16 }, max: { x: 8, y: 16, z: 16 } }; break;
          case 270: bounds = { min: { x: -16, y: 0, z: -16 }, max: { x: 16, y: 8, z: 16 } }; break;
        }
        game.move(base, { origin: body.origin, angles: body.angles, bounds }, false);
        base.teamMaster = entity.actor.id; entity.teamMaster = entity.actor.id; entity.teamChain = base.actor.id; base.teamChain = null;
        base.flags |= 1024; base.owner = entity.actor.id; base.model = "models/monsters/turretbase/tris.md2";
        game.motion(base, "push"); game.solid(base, "none"); game.link(base); game.show(base);
      }
      if ((entity.spawnflags & 16) !== 0) entity.skin = 1;
      else if ((entity.spawnflags & 32) !== 0) entity.skin = 2;
      else entity.spawnflags |= 8;
      return game.show(entity);
    },
    sourceCallbacks: { think: { "q2:rogue/turret_wake": wake }, use: { "q2:rogue/turret_activate": activate } },
    attack(context) {
      const { state, entity, game } = context;
      if (entity.frame < turretFrame.run01) return ready(context);
      if (state.attackState !== "blind") { state.nextFrame = turretFrame.pow01; return context.setMove("turret_move_fire"); }
      const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, random = game.host.random();
      state.blindFireDelay += 3.4 + game.host.random() * 4;
      if (length(state.blindFireTarget) === 0 || random > chance) return undefined;
      state.nextFrame = turretFrame.pow01; return context.setMove("turret_move_fire_blind");
    },
    checkAttack(context) {
      const { game, entity, state } = context, eye = enemyEye(context);
      if (entity.enemy === null || eye === null) return false;
      const enemy = game.entity(entity.enemy), origin = game.body(entity).origin, start = { ...origin, z: origin.z + entity.viewHeight };
      if (health(game, entity.enemy) > 0) {
        const trace = game.host.trace({ start, end: eye, bounds: null, ignore: entity.actor.id, mask: 1 | 2 | 0x2000000 | 16 | 8 });
        if ((trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) && (enemy?.solid !== "none" || trace.fraction < 1)) {
          const blockerMonster = trace.hit.kind === "actor" && game.host.isMonster(trace.hit.actor);
          if (!blockerMonster && !visible(context) && (entity.spawnflags & 40) !== 0 && state.blindFireDelay <= 10 && game.host.now() >= state.attackFinished && game.host.now() >= state.trailTime + state.blindFireDelay) {
            const blind = game.host.trace({ start, end: state.blindFireTarget, bounds: null, ignore: entity.actor.id, mask: 0x2000000 });
            if (!blind.allSolid && !blind.startSolid && (blind.fraction === 1 || blind.hit.kind === "actor" && blind.hit.actor.equals(entity.enemy))) {
              state.attackState = "blind"; state.attackFinished = game.host.now() + 0.5 + 2 * game.host.random(); return true;
            }
          }
          return false;
        }
      }
      if (game.host.now() < state.attackFinished) return false;
      if (targetDistance(context) < 80) {
        if (game.options.skill === 0 && Math.floor(game.host.random() * 4) !== 0) return false;
        state.attackState = "missile"; return true;
      }
      let chance = (entity.spawnflags & 32) !== 0 ? 0.1 : (entity.spawnflags & 8) !== 0 ? 0.35 : 0.5;
      const next = (entity.spawnflags & 32) !== 0 ? 1.8 - 0.2 * game.options.skill : (entity.spawnflags & 8) !== 0 ? 1.2 - 0.2 * game.options.skill : 0.8 - 0.1 * game.options.skill;
      chance *= game.options.skill === 0 ? 0.5 : game.options.skill > 1 ? 2 : 1;
      if (game.host.random() < chance && visible(context) || enemy?.solid === "none") { state.attackState = "missile"; state.attackFinished = game.host.now() + next; return true; }
      state.attackState = "straight"; return false;
    },
    pain() { return undefined; },
    die(context) {
      const { entity, game } = context, body = game.body(entity);
      game.host.emit({ kind: "effect", effect: "q2:plain-explosion", origin: body.origin, direction: zero, count: 1, color: 0 });
      const start = add(body.origin, anglesVectors(body.angles).forward);
      for (const speed of [1, 2, 1, 2]) throwQ2Debris(entity, game, "models/objects/debris1/tris.md2", speed, start);
      const base = game.entity(entity.teamChain);
      if (base !== null) { game.solid(base, "box"); if (game.host.combat.read(base.actor.id) !== null) game.host.combat.setTraits(base.actor, { canTakeDamage: false }); game.motion(base, "stationary"); game.link(base); }
      // Stationary entities reach the source die callback before monster_death_use.
      if (entity.target !== "") game.useTargets(entity, entity.enemy !== null && game.host.actors.isLive(entity.enemy) ? entity.enemy : entity.actor.id);
      return game.remove(entity);
    },
    callbacks: { turret_run: run, TurretAim: aim, TurretFire(context) { return fire(context, false); }, TurretFireBlind(context) { return fire(context, true); } },
  };
}
