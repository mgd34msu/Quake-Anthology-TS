/* hiparma.qc: split-body targeting, weapon sequences and staged death. GPL-2.0-or-later. */
import { sameActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1SoundChannel } from "../../foundation/types.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import { createMissile, throwGib } from "../../base/projectiles.ts";
import { launchHipnoticLaser } from "../hipnotic-weapons.ts";
import { multiExplosion } from "../world/hipnotic-misc.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";
import type { MissionAction, PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/hiparma.ts";
import { eye, number, radiusActors } from "./helpers.ts";

function bodyPart(monster: MissionMonster): Q1Actor {
  const body = monster.game.entity(monster.entity.references.get("trigger_field") ?? null);
  if (body === null) throw new Error("Armagon lost its source body entity"); return body;
}
function sound(monster: MissionMonster, path: string, channel: Q1SoundChannel, volume = 1, attenuation = 0.5): undefined {
  return monster.game.host.emit({ kind: "sound", actor: monster.entity.actor.id, path, channel, volume, attenuation });
}
function enemyOrigin(monster: MissionMonster): Vec3 { return monster.target ?? ZERO; }
function enemyEye(monster: MissionMonster): Vec3 { return monster.enemy === null ? ZERO : eye(monster.game, monster.enemy) ?? ZERO; }
function turn(monster: MissionMonster, difference: number, target: number): undefined {
  const current = monster.entity.number("fixangle");
  return number(monster, "fixangle", Math.abs(difference) < 10 ? target : difference > 5 ? current + 9 : difference < -5 ? current - 9 : target);
}
function syncBody(monster: MissionMonster, walking = false): Q1Actor {
  const { game, entity } = monster, body = bodyPart(monster), angles = game.body(entity).angles;
  game.setOrigin(body, monster.origin);
  if (walking && game.options.edition === "rerelease") body.movement = "step";
  body.frame = entity.frame; game.setBody(body, { angles: { ...angles, y: angles.y + entity.number("fixangle") } }); return body;
}
function idleSound(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if (game.health(entity.actor.id) < 0 || game.time <= entity.number("super_time")) return undefined;
  number(monster, "super_time", game.time + 3);
  if (game.host.random() < 0.5) { const r = game.host.random(); sound(monster, `armagon/idle${r < 0.25 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : 4}.wav`, "voice"); }
  return undefined;
}
function think(monster: MissionMonster): undefined {
  const { game, entity } = monster, body = syncBody(monster);
  entity.idealYaw = yawFor(vsub(enemyOrigin(monster), monster.origin));
  let delta = entity.idealYaw - game.body(entity).angles.y; number(monster, "cnt", 0);
  if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
  if (Math.abs(delta) > 90) { delta = 0; number(monster, "cnt", 1); }
  turn(monster, delta - entity.number("fixangle"), delta);
  if (game.health(entity.actor.id) < 0) return undefined;
  idleSound(monster);
  if (game.options.edition === "rerelease" && length(vsub(body.vector("oldorigin"), game.body(body).origin)) > 50) body.movement = "step";
  return undefined;
}
function walkThink(monster: MissionMonster): undefined {
  syncBody(monster, true); monster.changeYaw(); number(monster, "cnt", 0); turn(monster, -monster.entity.number("fixangle"), 0);
  if (monster.game.health(monster.entity.actor.id) < 0) return undefined;
  idleSound(monster); const client = monster.game.host.checkClient(monster.entity.actor);
  if (client !== null && monster.visible(client)) monster.found(client); return undefined;
}
function launch(monster: MissionMonster, offset: number, turnDirection: 0 | 1 | 2, laser: boolean): undefined {
  const { game, entity } = monster, angles = game.body(entity).angles;
  const basis = game.makeVectors({ ...angles, y: angles.y + entity.number("fixangle") + (turnDirection === 1 ? 165 : turnDirection === 2 ? -165 : 0) });
  const origin = vadd(vadd(vadd(monster.origin, { x: 0, y: 0, z: 66 }), vscale(basis.right, offset)), vscale(basis.forward, 84));
  let target = enemyEye(monster);
  if (game.options.skill !== 0) target = vadd(target, vscale(monster.enemy === null ? ZERO : game.host.bodies.read(monster.enemy)?.velocity ?? ZERO, length(vsub(target, origin)) / 1000));
  let direction = normalize(vsub(target, origin)); if (dot(direction, basis.forward) < entity.number("worldtype")) direction = basis.forward;
  entity.effects |= 2;
  if (laser) launchHipnoticLaser(game, entity.actor.id, origin, direction, false);
  else {
    game.sound(entity, "weapons/sgun1.wav", "weapon"); const punch = entity.vector("punchangle"); entity.fields.set("punchangle", `-2 ${punch.y} ${punch.z}`);
    const shot = createMissile(game, entity.actor.id, "missile", "missile", origin, vscale(direction, 1000)); shot.projectile = "rocket"; shot.touch = game.named.touch(shot, "projectile_touch");
  }
  return undefined;
}
function overThink(monster: MissionMonster, left: boolean): undefined {
  const { game, entity } = monster; monster.changeYaw(); game.host.walkMove(entity.actor, game.body(entity).angles.y, 14); syncBody(monster);
  let delta = 0;
  if (entity.count === 0) {
    entity.idealYaw = yawFor(vsub(enemyOrigin(monster), monster.origin)); delta = entity.idealYaw - game.body(entity).angles.y + (left ? -165 : 165);
    if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
  } else if (entity.count === 1) return launch(monster, left ? 40 : -40, left ? 1 : 2, false);
  return turn(monster, delta - entity.number("fixangle"), delta);
}
function walk(monster: MissionMonster): undefined {
  const { game, entity } = monster, goal = game.find(monster.state.path)[0]?.actor.id ?? game.world?.actor.id ?? null;
  if (goal !== null) game.host.moveToGoal(entity.actor, goal, 14); return undefined;
}
function run(monster: MissionMonster): undefined {
  const world = monster.game.world; if (world === null) throw new Error("Armagon requires a world entity");
  monster.changeYaw(); world.fields.set("RUN_STRAIGHT", "1"); monster.ai("run", 14); return think(monster);
}
function walkingAttack(monster: MissionMonster): undefined { monster.changeYaw(); monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y, 14); return think(monster); }
function repulse(monster: MissionMonster): undefined {
  const { game, entity } = monster; think(monster);
  if (entity.number("state") === 0) { monster.attackFinished(0.5); game.sound(entity, "armagon/repel.wav", "body"); return number(monster, "state", 1); }
  if (entity.number("state") !== 1) return undefined;
  for (const actor of radiusActors(game, monster.origin, 300)) {
    if (!game.isPlayer(actor) || ((game.entity(actor)?.movementFlags ?? 0) & 128) !== 0 || !monster.visible(actor) || game.health(actor) <= 0) continue;
    const owner = game.host.actors.resolveOwned(actor), body = game.host.bodies.read(actor); if (owner === null || body === null) continue;
    const direction = normalize(vsub(body.origin, vsub(monster.origin, { x: 0, y: 0, z: 24 })));
    game.host.bodies.write(owner, { ...body, velocity: vadd(body.velocity, vscale(direction, 1500)) });
  }
  game.radiusDamage(entity.actor.id, entity.actor.id, 60, entity.actor.id, null); number(monster, "state", 0); return monster.attackFinished(0.1);
}
function clearShot(monster: MissionMonster): { readonly clear: boolean; readonly crossedWater: boolean; readonly distance: number } {
  const { game, entity } = monster, start = monster.eye() ?? monster.origin, end = enemyEye(monster), enemy = monster.enemy ?? game.world?.actor.id ?? null;
  const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
  return { clear: enemy !== null && trace.actor !== null && sameActor(trace.actor, enemy), crossedWater: trace.inOpen && trace.inWater, distance: length(vsub(end, start)) };
}
function standAttack(monster: MissionMonster): undefined {
  const { game, entity } = monster, shot = clearShot(monster);
  if (!shot.clear || shot.crossedWater) return monster.play("armagon_run1");
  if (game.time < monster.state.attackFinished) return undefined;
  if (shot.distance < 200 && monster.enemy !== null && game.isPlayer(monster.enemy)) return repulse(monster);
  number(monster, "state", 0); if (shot.distance > 450) return monster.play("armagon_run1");
  monster.play(game.host.random() < 0.5 ? "armagon_satk1" : "armagon_slaser1");
  return entity.number("cnt") === 1 ? monster.play("armagon_run1") : undefined;
}
function checkAttack(monster: MissionMonster): boolean {
  const { game, entity } = monster; monster.lefty = false; const shot = clearShot(monster);
  if ((!shot.clear && entity.number("charmed") === 0) || shot.crossedWater || game.time < monster.state.attackFinished) return false;
  const delta = entity.idealYaw - (game.body(entity).angles.y + entity.number("fixangle"));
  if (Math.abs(delta) > 10 && shot.distance > 200 || monster.enemy === null || !game.isPlayer(monster.enemy)) return false;
  if (shot.distance < 400) { monster.play("armagon_stop1"); return true; }
  monster.lefty = true; return false;
}
function bodyExplode(game: Q1EntityServices, body: Q1Actor): undefined {
  game.schedule(body, 0.1, game.named.action(body, "hipnotic:armagon_body_explode1"));
  const count = body.number("cnt"); if (count === 0) body.count = 0;
  if (count < 25) {
    if (count > body.count) { for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, game.body(body).origin, model, -100); body.count = count + 1; }
    body.fields.set("cnt", String(count + 1));
  } else { body.fields.set("cnt", "0"); game.schedule(body, 0.1, game.named.action(body, "hipnotic:armagon_body_explode2")); }
  return undefined;
}
function bodyExplosion(game: Q1EntityServices, body: Q1Actor): undefined {
  game.sound(body, "misc/longexpl.wav", "auto", 0.5);
  for (let i = 0; i < 3; i++) for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, game.body(body).origin, model, -200);
  body.movement = "none"; body.model = "progs/s_explod.spr"; body.solid = "none"; body.frame = 0;
  return game.schedule(body, 0.1, game.named.action(body, "base:explosion_frame"));
}
function finalDeath(monster: MissionMonster): undefined {
  const { game, entity } = monster; think(monster); multiExplosion(game, entity, vadd(monster.origin, { x: 0, y: 0, z: 80 }), 20, 10, 3, 0.1, 0.5);
  game.cancel(entity); entity.movement = "none"; entity.damageable = false; entity.solid = "none"; game.setBounds(entity, { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 32 } });
  entity.movementFlags = 0; entity.fields.set("gorging", "1"); entity.wait = game.time + 5;
  const body = bodyPart(monster); game.cancel(body); body.damageable = false; body.solid = "none"; body.fields.set("gorging", "1");
  return game.schedule(body, 0.1, game.named.action(body, "hipnotic:armagon_body_explode1"));
}
export function armagonDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  const servo: MissionAction = monster => sound(monster, "armagon/servo.wav", 7, 0.5), foot: MissionAction = monster => sound(monster, "armagon/footfall.wav", 6);
  const actions: Record<string, MissionAction> = {
    armagon_think: think, armagon_walkthink: walkThink, armagon_overleft_think: monster => overThink(monster, true), armagon_overright_think: monster => overThink(monster, false),
    armagon_stand_attack: standAttack, armagon_missile_attack: monster => monster.play(monster.game.host.random() < 0.5 ? "armagon_watk1" : "armagon_wlaseratk1"),
    "movetogoal(14)": walk,
    "hiparma:armagon_stand1": monster => { monster.ai("stand", 0); think(monster); return monster.delay(0.2); },
    "hiparma:armagon_stand2": monster => { think(monster); return monster.delay(0.2); },
    "hiparma:armagon_walk3": monster => { servo(monster); walk(monster); return walkThink(monster); },
    "hiparma:armagon_walk5": monster => { foot(monster); walk(monster); return walkThink(monster); },
    "hiparma:armagon_run1": run,
    "hiparma:armagon_run3": monster => { servo(monster); return run(monster); },
    "hiparma:armagon_run5": monster => { foot(monster); return run(monster); },
    "hiparma:armagon_run12": monster => {
      run(monster); const { game, entity } = monster;
      if (entity.number("cnt") === 1 && game.time > monster.state.attackFinished) { let delta = entity.idealYaw - game.body(entity).angles.y; if (delta > 180) delta -= 360; if (delta < -180) delta += 360; monster.nextFrame = delta > 0 ? "armagon_overleft1" : "armagon_overright1"; }
      else if (monster.lefty) { monster.lefty = false; monster.nextFrame = "armagon_missile_attack"; } return undefined;
    },
    "hiparma:armagon_watk1": walkingAttack,
    "hiparma:armagon_watk2": monster => { servo(monster); return walkingAttack(monster); },
    "hiparma:armagon_watk4": monster => { foot(monster); return walkingAttack(monster); },
    "hiparma:armagon_watk6": monster => { walkingAttack(monster); return launch(monster, 40, 0, false); },
    "hiparma:armagon_watk11": monster => { walkingAttack(monster); return launch(monster, -40, 0, false); },
    "hiparma:armagon_watk13": monster => { walkingAttack(monster); return monster.attackFinished(1); },
    "hiparma:armagon_wlaseratk6": monster => { walkingAttack(monster); return launch(monster, 40, 0, true); },
    "hiparma:armagon_wlaseratk11": monster => { walkingAttack(monster); return launch(monster, -40, 0, true); },
    "SUB_AttackFinished(1.0)": monster => monster.attackFinished(1), "SUB_AttackFinished(0.3)": monster => monster.attackFinished(0.3),
    "hiparma:armagon_stop2": monster => { foot(monster); return think(monster); }, "hiparma:armagon_satk6": monster => { foot(monster); return think(monster); },
    "hiparma:armagon_satk9": monster => { think(monster); launch(monster, 40, 0, false); return launch(monster, -40, 0, false); },
    "armagon_launch_laser(40)": monster => launch(monster, 40, 0, true), "armagon_launch_laser(-40)": monster => launch(monster, -40, 0, true),
    "hiparma:armagon_die4": monster => { think(monster); multiExplosion(monster.game, monster.entity, vadd(monster.origin, { x: 0, y: 0, z: 48 }), 48, 10, 6, 0.3, 0.3); sound(monster, "armagon/death.wav", "auto", 1, 0); return monster.delay(0.2); },
    "hiparma:armagon_die8": monster => { think(monster); return monster.delay(2); }, "hiparma:armagon_die14": finalDeath,
  };
  for (const [direction, left] of new Map([["left", true], ["right", false]])) {
    actions[`hiparma:armagon_over${direction}1`] = monster => { monster.entity.count = 0; return overThink(monster, left); };
    actions[`hiparma:armagon_over${direction}3`] = monster => { servo(monster); return overThink(monster, left); };
  }
  actions["hiparma:armagon_overleft5"] = monster => { foot(monster); return overThink(monster, true); };
  actions["hiparma:armagon_overleft11"] = monster => { monster.entity.count = 1; return overThink(monster, true); };
  actions["hiparma:armagon_overleft12"] = monster => { monster.entity.count = 2; return overThink(monster, true); };
  actions["hiparma:armagon_overright5"] = monster => { foot(monster); monster.entity.count = 1; return overThink(monster, false); };
  actions["hiparma:armagon_overright6"] = monster => { monster.entity.count = 2; return overThink(monster, false); };
  actions["hiparma:armagon_overright10"] = monster => { foot(monster); return overThink(monster, false); };
  const skill = runtime.game.options.skill;
  return {
    spec: { species: "armagon", classnames: ["monster_armagon"], model: "armalegs", head: null, health: skill === 0 ? 2000 : skill === 1 ? 2500 : 3500, gibHealth: -Infinity, gibs: [],
      bounds: { min: { x: -48, y: -48, z: -24 }, max: { x: 48, y: 48, z: 84 } }, stand: "armagon_stand1", walk: "armagon_walk1", run: "armagon_run1", sight: "", missile: "armagon_missile_attack", melee: true, movement: "walk" }, frames, actions,
    callbacks: { armagon_body_explode1: { action: bodyExplode }, armagon_body_explode2: { action: bodyExplosion } },
    spawn: monster => {
      const { game, entity } = monster, body = game.create("armagon_body"); monster.lefty = false;
      game.setBody(body, { origin: vsub(monster.origin, { x: 0, y: 0, z: 64 }), bounds: { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } } });
      if (game.options.edition === "rerelease") body.fields.set("oldorigin", `${monster.origin.x} ${monster.origin.y} ${monster.origin.z}`); else body.movement = "step";
      body.solid = "none"; body.model = "progs/armabody.mdl"; entity.references.set("trigger_field", body.actor.id); body.references.set("trigger_field", entity.actor.id);
      number(monster, "fixangle", 0); number(monster, "yaw_speed", skill === 0 ? 5 : skill === 1 ? 9 : 12); number(monster, "worldtype", skill === 0 ? 0.9 : skill === 1 ? 0.85 : 0.75);
      number(monster, "state", 0); number(monster, "super_time", 0); number(monster, "endtime", 0); game.link(body); return monster.spawnDefault();
    },
    found: (monster, target) => { monster.foundDefault(target); return sound(monster, "armagon/sight.wav", "voice", 1, 0.1); },
    checkAttack, melee: monster => monster.play("armagon_stop1"),
    pain: (monster, _attacker, damage) => {
      if (monster.game.health(monster.entity.actor.id) <= 0 || damage < 25 || monster.state.painFinished > monster.game.time) return undefined;
      monster.state.painFinished = monster.game.time + 2; return monster.game.sound(monster.entity, "armagon/pain.wav");
    },
    die: monster => monster.play("armagon_die1"),
  };
}
