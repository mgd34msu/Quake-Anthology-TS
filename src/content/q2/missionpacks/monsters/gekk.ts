/* Quake II xatrix/m_gekk.c and acid gibs from g_misc.c. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { freeQ2Entity } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Touch } from "../../foundation/host.ts";
import { anglesVectors, checkBottom, enemyBody, enemyEye, health, MASK_SHOT, projectFlash, runAi, setDuck, targetDistance, traceGroundActor, vectorAngles } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, finishCorpse, move, sound } from "../../base/monsters/common.ts";
import { gekkFrame, gekkMoves } from "./tables/xatrix-gekk.ts";

const gibDie: Q2Die = (entity, game) => game.remove(entity);
const loogieTouch: Q2Touch = (entity, game, contact) => {
  if (contact.other === entity.owner) return undefined;
  if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
  if (game.host.combat.read(contact.other)?.canTakeDamage === true) game.damage(contact.other, entity, entity.owner, entity.damage, 1, game.body(entity).velocity, game.body(entity).origin, contact.plane?.normal ?? zero, 38, 4);
  return game.remove(entity);
};

export function fireGekkLoogie(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number): Q2Entity {
  game.sourceCallbacks.register({ think: { G_FreeEdict: freeQ2Entity }, touch: { loogie_touch: loogieTouch } });
  const projectile = game.create("loogie"), aim = normalize(direction);
  projectile.owner = self.actor.id; projectile.model = "models/objects/loogy/tris.md2"; projectile.effects |= 8; projectile.damage = damage; projectile.clipMask = MASK_SHOT; projectile.projectile = true;
  game.move(projectile, { origin: start, angles: vectorAngles(aim), velocity: scale(aim, speed), bounds: { min: zero, max: zero } }, false);
  projectile.touch = loogieTouch; game.solid(projectile, "box"); game.motion(projectile, "fly-missile"); game.schedule(projectile, 2, freeQ2Entity); game.show(projectile);
  const trace = game.host.trace({ start: game.body(self).origin, end: start, bounds: null, ignore: projectile.actor.id, mask: MASK_SHOT });
  if (trace.fraction < 1) {
    game.move(projectile, { origin: add(start, scale(aim, -10)) });
    const other = traceGroundActor(trace, game);
    if (other !== null) loogieTouch(projectile, game, { self: projectile.actor, other, plane: null, surface: null });
  }
  return projectile;
}

function acidGib(context: MonsterContext, part: string, damage: number, head = false): undefined {
  const { entity, game } = context, body = game.body(entity), gib = head ? entity : game.create("acid_gib");
  game.sourceCallbacks.register({ think: { G_FreeEdict: freeQ2Entity }, die: { acid_gib_die: gibDie } });
  const random = (): number => game.host.random(), crandom = (): number => random() * 2 - 1;
  const half = scale(subtract(body.bounds.max, body.bounds.min), 0.5), center = add(add(body.origin, body.bounds.min), add(half, { x: -1, y: -1, z: -1 }));
  const origin = head ? body.origin : add(center, { x: crandom() * half.x, y: crandom() * half.y, z: crandom() * half.z });
  gib.model = `models/objects/gekkgib/${part}/tris.md2`; gib.clipMask = MASK_SHOT; gib.flags |= 2048; gib.damage = 2;
  if (head) { gib.skin = 0; gib.frame = 0; gib.model2 = ""; gib.effects = (gib.effects | 0x200000 | 8) & ~0x4000; gib.serverFlags &= ~4; game.host.emit({ kind: "sound", actor: gib.actor.id, origin, path: "", channel: 0, volume: 0, attenuation: 1, reliable: false, loop: "stop" }); }
  else { gib.effects |= 0x200000; gib.renderFlags |= 8; }
  const impulse = scale({ x: 100 * crandom(), y: 100 * crandom(), z: 200 + 100 * random() }, damage < 50 ? 0.7 : 1.2);
  const velocity = add(body.velocity, scale(impulse, head ? 0.5 : 3));
  gib.angularVelocity = head ? { ...gib.angularVelocity, y: crandom() * 600 } : { x: random() * 600, y: random() * 600, z: random() * 600 };
  game.move(gib, { origin, velocity: { x: Math.max(-300, Math.min(300, velocity.x)), y: Math.max(-300, Math.min(300, velocity.y)), z: Math.max(200, Math.min(500, velocity.z)) }, bounds: { min: zero, max: zero } }, false);
  if (game.host.combat.read(gib.actor.id) === null) game.host.combat.create(gib.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
  else game.host.combat.setTraits(gib.actor, { canTakeDamage: true });
  gib.die = gibDie; game.motion(gib, "toss"); game.solid(gib, "box"); game.schedule(gib, 10 + random() * 10, freeQ2Entity); game.show(gib);
  return undefined;
}
function gibfest(context: MonsterContext, damage = 20): undefined {
  context.game.sound(context.entity, "misc/udeath.wav", 2);
  for (const part of ["pelvis", "arm", "arm", "torso", "claw", "leg", "leg"]) acidGib(context, part, damage);
  acidGib(context, "head", damage, true); context.state.dead = true; context.state.gibbed = true;
  return undefined;
}
function wet(context: MonsterContext, entity = context.entity): boolean {
  if (entity === context.entity) return context.state.waterLevel > 0;
  const body = context.game.body(entity);
  return (context.game.host.pointContents({ ...body.origin, z: body.origin.z + body.bounds.min.z + 1 }) & 56) !== 0;
}
function waterToLand(context: MonsterContext): undefined {
  context.entity.flags &= ~2; context.state.locomotion = "walk"; context.state.yawSpeed = 20; context.entity.viewHeight = 25;
  context.game.move(context.entity, { bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 24 } } }, false);
  return context.setMove("gekk_move_leapatk2");
}
function landToWater(context: MonsterContext): undefined {
  context.entity.flags |= 2; context.state.locomotion = "swim"; context.state.yawSpeed = 10; context.entity.viewHeight = 10;
  context.game.move(context.entity, { bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 16 } } }, false);
  return context.setMove("gekk_move_swim_start");
}
function checkJump(context: MonsterContext): boolean {
  const enemy = enemyBody(context); if (enemy === null) return false;
  const body = context.game.body(context.entity), minimum = enemy.origin.z + enemy.bounds.min.z, size = enemy.bounds.max.z - enemy.bounds.min.z;
  if (body.origin.z + body.bounds.min.z > minimum + 0.75 * size || body.origin.z + body.bounds.max.z < minimum + 0.25 * size) return false;
  const distance = Math.hypot(body.origin.x - enemy.origin.x, body.origin.y - enemy.origin.y);
  return !(distance < 100 || distance > 100 && context.game.host.random() < 0.9);
}
function run(context: MonsterContext): undefined { return context.setMove(wet(context) ? "gekk_move_swim_start" : context.state.standGround ? "gekk_move_stand" : "gekk_move_run"); }
function runStart(context: MonsterContext): undefined { return context.setMove(wet(context) ? "gekk_move_swim_start" : "gekk_move_run_start"); }
function melee(context: MonsterContext): undefined { return context.setMove(wet(context) ? "gekk_move_attack" : context.game.host.random() > 0.66 ? "gekk_move_attack1" : "gekk_move_attack2"); }
function hit(context: MonsterContext, right: boolean): undefined {
  const bounds = context.game.body(context.entity).bounds;
  const connected = context.weapons.fireHit(context.entity, context.game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 8 }, 15 + Math.floor(context.game.host.random() * 5), 100);
  return context.game.sound(context.entity, connected ? right ? "gek/gk_atck3.wav" : "gek/gk_atck2.wav" : "gek/gk_atck1.wav", 1);
}
function search(context: MonsterContext): undefined {
  const { game, entity } = context;
  let path = "gek/gk_idle1.wav";
  if ((entity.spawnflags & 8) !== 0) { const r = game.host.random(); path = r < 0.33 ? "gek/gek_low.wav" : r < 0.66 ? "gek/gek_mid.wav" : "gek/gek_high.wav"; }
  game.sound(entity, path, 2);
  const hp = Math.min(entity.maxHealth, Math.trunc(health(game, entity.actor.id) + 10 + 10 * game.host.random()));
  game.host.combat.setHealth(entity.actor, hp); entity.skin = hp < entity.maxHealth / 4 ? 2 : hp < entity.maxHealth / 2 ? 1 : 0;
  return undefined;
}

export function createGekkDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const jumpTouch: Q2Touch = (entity, game, contact) => {
    const context = monsters.context(entity.actor.id); if (context === null) throw new Error("Gekk jump without its source controller");
    if (health(game, entity.actor.id) <= 0) { entity.touch = null; return undefined; }
    const body = game.body(entity);
    if (game.host.combat.read(contact.other)?.canTakeDamage === true && length(body.velocity) > 200) {
      const normal = normalize(body.velocity), damage = Math.trunc(10 + 10 * game.host.random());
      game.damage(contact.other, entity, entity.actor.id, damage, damage, body.velocity, add(body.origin, scale(normal, body.bounds.max.x)), normal, 38);
    }
    if (!checkBottom(context, body.origin)) { if (body.ground !== null) { context.state.nextFrame = gekkFrame.leapatk_11; entity.touch = null; } return undefined; }
    entity.touch = null; return undefined;
  };
  function takeoff(context: MonsterContext, fromWater: boolean): undefined {
    const { entity, game } = context, body = game.body(entity), enemy = enemyBody(context);
    game.sound(entity, "gek/gk_sght1.wav", 2);
    game.move(entity, { origin: { ...body.origin, z: fromWater ? enemy?.origin.z ?? body.origin.z : body.origin.z + 1 } }, false);
    const long = checkJump(context);
    game.move(entity, { velocity: { ...scale(anglesVectors(body.angles).forward, fromWater ? long ? 300 : 150 : long ? 700 : 250), z: fromWater ? long ? 250 : 300 : long ? 250 : 400 }, ground: null }, false);
    context.state.ducked = true; context.state.attackFinished = game.host.now() + 3; entity.touch = jumpTouch;
    return undefined;
  }
  return {
    classname: "monster_gekk", kind: "gekk", model: "models/monsters/gekk/tris.md2", health: 125, gibHealth: -30, mass: 300,
    bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 24 } }, scale: 1,
    initialMove: "gekk_move_stand", moves: gekkMoves, stand(context) { return context.setMove(wet(context) ? "gekk_move_standunderwater" : "gekk_move_stand"); }, walk: move("gekk_move_walk"), run: runStart, melee,
    sight: sound("gek/gk_sght1.wav"), search, idle(context) { return context.setMove(wet(context) ? "gekk_move_swim_start" : "gekk_move_idle"); },
    afterSpawn(context) { if ((context.entity.spawnflags & 8) !== 0) context.setMove("gekk_move_chant"); return undefined; },
    sourceCallbacks: { touch: { gekk_jump_touch: jumpTouch, loogie_touch: loogieTouch }, die: { acid_gib_die: gibDie }, think: { G_FreeEdict: freeQ2Entity } },
    ai: { ai_stand2(context, distance) {
      if ((context.entity.spawnflags & 8) === 0) return runAi(context, "stand", distance);
      runAi(context, "move", distance);
      if ((context.entity.spawnflags & 1) === 0 && context.game.host.now() > context.state.idleTime) {
        if (context.state.idleTime !== 0) { context.idle(); context.state.idleTime = context.game.host.now() + 15 + context.game.host.random() * 15; }
        else context.state.idleTime = context.game.host.now() + context.game.host.random() * 15;
      }
      return undefined;
    } },
    checkAttack(context) {
      if (!aliveEnemy(context)) return false;
      if (targetDistance(context) < 80) { context.state.attackState = "melee"; return true; }
      const enemy = enemyBody(context); if (enemy === null) return false;
      const origin = context.game.body(context.entity).origin, close = Math.hypot(origin.x - enemy.origin.x, origin.y - enemy.origin.y) >= 100 || origin.z < enemy.origin.z;
      if (checkJump(context) || close && !wet(context)) { context.state.attackState = "missile"; return true; }
      return false;
    },
    attack(context) {
      if ((context.entity.flags & 2) !== 0 || wet(context)) return undefined;
      return context.setMove(context.game.host.random() > 0.5 && targetDistance(context) >= 80 || context.game.host.random() > 0.8 ? "gekk_move_spit" : "gekk_move_leapatk");
    },
    pain(context) {
      if ((context.entity.spawnflags & 8) !== 0) { context.entity.spawnflags &= ~8; return undefined; }
      const hp = health(context.game, context.entity.actor.id); if (hp < context.entity.maxHealth / 2) context.entity.skin = hp < context.entity.maxHealth / 4 ? 2 : 1;
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3; context.game.sound(context.entity, "gek/gk_pain1.wav", 2);
      return context.setMove(wet(context) ? "gekk_move_pain" : context.game.host.random() > 0.5 ? "gekk_move_pain1" : "gekk_move_pain2");
    },
    die(context, reaction) {
      if (health(context.game, context.entity.actor.id) <= context.state.gibHealth) return gibfest(context, reaction.damage);
      if (context.state.dead) return undefined;
      context.game.sound(context.entity, "gek/gk_deth1.wav", 2); context.state.dead = true; context.state.canTakeDamage = true; context.entity.skin = 2;
      context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true });
      if (wet(context)) return context.setMove("gekk_move_wdeath");
      const r = context.game.host.random(); return context.setMove(r > 0.66 ? "gekk_move_death1" : r > 0.33 ? "gekk_move_death3" : "gekk_move_death4");
    },
    dodge(context, attacker, eta) {
      const { game, state } = context; if (game.host.random() > 0.25) return undefined;
      context.entity.enemy ??= attacker; if (wet(context)) return context.setMove("gekk_move_attack");
      if (game.options.skill === 0) return context.setMove(game.host.random() > 0.5 ? "gekk_move_lduck" : "gekk_move_rduck");
      state.pauseTime = game.host.now() + eta + 0.3; const r = game.host.random();
      if (game.options.skill < 3 && r > (game.options.skill === 1 ? 0.33 : 0.66)) return context.setMove(game.host.random() > 0.5 ? "gekk_move_lduck" : "gekk_move_rduck");
      return context.setMove(game.host.random() > 0.66 ? "gekk_move_attack1" : "gekk_move_attack2");
    },
    callbacks: {
      gekk_face: move("gekk_move_run"), gekk_chant: move("gekk_move_chant"), gekk_run: run, gekk_run_start: runStart,
      gekk_stand(context) { return context.stand(); }, gekk_search: search,
      gekk_swim_loop(context) { context.entity.flags |= 2; context.state.locomotion = "swim"; return context.setMove("gekk_move_swim_loop"); },
      gekk_swim(context) { const enemy = context.game.entity(context.entity.enemy); return enemy !== null && !wet(context, enemy) && context.game.host.random() > 0.7 ? waterToLand(context) : context.setMove("gekk_move_swim_start"); },
      gekk_check_underwater(context) { return wet(context) ? landToWater(context) : undefined; },
      gekk_idle_loop(context) { if (context.game.host.random() > 0.75 && health(context.game, context.entity.actor.id) < context.entity.maxHealth) context.state.nextFrame = gekkFrame.idle_01; return undefined; },
      gekk_step(context) { const n = (Math.floor(context.game.host.random() * 3) + 1) % 3; return context.game.sound(context.entity, `gek/gk_step${n + 1}.wav`, 2); },
      gekk_hit_left(context) { return hit(context, false); }, gekk_hit_right(context) { return hit(context, true); },
      gekk_bite(context) { context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 5, 0); return undefined; },
      gekk_check_refire(context) {
        if (aliveEnemy(context) && context.game.host.random() < context.game.options.skill * 0.1 && targetDistance(context) < 80) {
          if (context.entity.frame === gekkFrame.clawatk3_09) context.setMove("gekk_move_attack2"); else if (context.entity.frame === gekkFrame.clawatk5_09) context.setMove("gekk_move_attack1");
        }
        return undefined;
      },
      loogie(context) {
        const eye = enemyEye(context); if (eye === null || !aliveEnemy(context)) return undefined;
        const start = add(projectFlash(context, { x: -18, y: -0.8, z: 24 }), scale(anglesVectors(context.game.body(context.entity).angles).up, 2));
        fireGekkLoogie(context.entity, context.game, start, subtract(eye, start), 5, 550); return undefined;
      },
      reloogie(context) {
        if (context.game.host.random() > 0.8 && health(context.game, context.entity.actor.id) < context.entity.maxHealth) return context.setMove("gekk_move_idle2");
        const distance = targetDistance(context);
        if (health(context.game, context.entity.enemy) >= 0 && context.game.host.random() > 0.7 && distance >= 80 && distance < 500) context.setMove("gekk_move_spit");
        return undefined;
      },
      gekk_jump_takeoff(context) { return takeoff(context, false); }, gekk_jump_takeoff2(context) { return takeoff(context, true); },
      gekk_stop_skid(context) { if (context.game.body(context.entity).ground !== null) context.game.move(context.entity, { velocity: zero }, false); return undefined; },
      gekk_check_landing(context) {
        if (context.game.body(context.entity).ground !== null) { context.game.sound(context.entity, "mutant/thud1.wav", 1); context.state.attackFinished = 0; context.state.ducked = false; return context.game.move(context.entity, { velocity: zero }, false); }
        context.state.nextFrame = context.game.host.now() > context.state.attackFinished ? gekkFrame.leapatk_11 : gekkFrame.leapatk_12; return undefined;
      },
      gekk_preattack() { return undefined; },
      isgibfest(context) { return context.game.host.random() > 0.9 ? gibfest(context) : undefined; }, gekk_gibfest: gibfest,
      gekk_dead(context) { return wet(context) ? undefined : finishCorpse(context); },
      gekk_duck_down(context) { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; },
      gekk_duck_up(context) { return setDuck(context, false); }, gekk_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
    },
  };
}
