/* ending.qc actor and camera sequence. Copyright Rogue. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { PLAYER_BOUNDS, ZERO, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import { spawnTeleportFog } from "../../foundation/spawns.ts";
import { aim } from "../../foundation/weapons.ts";
import { q1Base } from "../../base/provider.ts";
import { createMissile } from "../../base/projectiles.ts";
import { velocityAngles } from "../types.ts";
import type { MissionpackWorldHooks } from "./index.ts";
import { later, number, vector } from "./common.ts";
import { missionFinaleText } from "./finale-text.ts";
import { startFinaleTimer } from "./campaign.ts";

function machine(game: Q1Foundation): Q1Actor { const entity = game.entity(game.world?.references.get("rogue:theMachine") ?? null); if (entity === null) throw new Error("End sequence time machine is missing"); return entity; }
function removeStuff(game: Q1Foundation): undefined {
  for (const entity of [...game.entities.values()]) if (entity.classname === "ltrail_start") game.remove(entity);
  const core = [...game.entities.values()].find(entity => entity.classname === "item_time_core"); game.host.emit({ kind: "colored-explosion", origin: core === undefined ? ZERO : game.body(core).origin, colorStart: 230, colorLength: 5 });
  return core === undefined ? undefined : later(game, core, 0.1, "SUB_Remove");
}
function escapeLava(game: Q1Foundation, actor: Q1Actor): undefined { if (game.host.contents(game.body(actor).origin) !== "lava") return undefined; const point = game.find("point1")[0]; return point === undefined ? undefined : game.setOrigin(actor, game.body(point).origin); }
function goal(game: Q1Foundation, actor: Q1Actor, target: string): undefined {
  actor.target = target; const point = game.find(target)[0]; if (point === undefined) throw new Error(`End sequence ${target} placing screwed up!`);
  actor.references.set("goalentity", point.actor.id); actor.references.set("movetarget", point.actor.id); return undefined;
}
function control(game: Q1Foundation, actor: Q1Actor): undefined {
  const world = game.world; if (world === null) throw new Error("Ending requires worldspawn"); const stage = world.number("rogue:actorStage");
  if (stage === 0) { goal(game, actor, "point1"); actor.frame = 6; number(world, "rogue:actorStage", 1); return later(game, actor, 0.1, "rogue:actor_run"); }
  if (stage === 2) { goal(game, actor, "machine"); number(world, "rogue:actorStage", 5); return later(game, actor, 0.1, "rogue:actor_fire1"); }
  if (stage === 4) { actor.frame = 12; return later(game, actor, 2, "rogue:actor_teleport"); }
  if (stage === 3) { actor.target = "timepod"; game.useTargets(actor, actor.activator); goal(game, actor, "point2"); actor.frame = 6; return later(game, actor, 0.1, "rogue:actor_run"); }
  return undefined;
}
export function startRogueEnding(game: Q1Foundation, player: ActorId, hooks: MissionpackWorldHooks): undefined {
  const world = game.world; if (world === null || world.number("rogue:cutscene_running") === 0 || world.number("rogue:ending_started") !== 0) return undefined;
  const body = game.host.bodies.read(player); if (body === null) return undefined; number(world, "rogue:ending_started", 1);
  const camera = game.find("cameraview")[0], base = q1Base(game);
  base.levelRules.beginCutscene(game.mapName, player, game.time + (game.options.coop || camera === undefined ? 3 : 10000000));
  if (game.options.coop || camera === undefined) {
    game.controlPlayer(player, { kind: "cutscene", origin: vadd(body.origin, { x: 0, y: 0, z: 48 }), angles: body.angles, viewOffset: ZERO });
    game.host.emit({ kind: "finale", text: missionFinaleText(game.options.edition, "$qc_finale_coop"), stage: 4 }); removeStuff(game); return later(game, machine(game), 0.1, "rogue:time_crash");
  }
  game.host.emit({ kind: "finale", text: "", stage: 1 });
  const actor = game.create("actor"); actor.owner = player; actor.maxHealth = 100; actor.solid = "slidebox"; actor.movement = "step"; actor.frame = hooks.playerFrame?.(player) ?? 0; actor.model = "progs/player.mdl";
  game.host.combat.setHealth(actor.actor, 100); game.setBody(actor, { origin: body.origin, angles: body.angles, bounds: PLAYER_BOUNDS }); vector(actor, "view_ofs", { x: 0, y: 0, z: 25 }); actor.movementFlags |= 32; actor.idealYaw = body.angles.y; actor.yawSpeed = 20;
  world.references.set("rogue:theActor", actor.actor.id); escapeLava(game, actor); later(game, actor, 0.1, "rogue:actor_control"); game.link(actor);
  const origin = game.body(camera).origin, angles = velocityAngles(vsub(game.body(actor).origin, origin)); game.controlPlayer(player, { kind: "cutscene", origin, angles, viewOffset: ZERO });
  const tracker = game.create("rogue_camera_tracker"); tracker.owner = player; return later(game, tracker, 0.05, "rogue:track_camera");
}
export function registerRogueEnding(game: Q1Foundation): undefined {
  game.registerPathTouch("rogue:world_followers", (corner, mover) => {
    if (mover.classname !== "actor" && mover.classname !== "buzzsaw") return false;
    const current = mover.references.get("movetarget") ?? null; if (current === null || !sameActor(current, corner.actor.id)) return false;
    const next = game.find(corner.target)[0]; mover.references.set("goalentity", next?.actor.id ?? null); mover.references.set("movetarget", next?.actor.id ?? null);
    mover.idealYaw = yawFor(vsub(next === undefined ? ZERO : game.body(next).origin, game.body(mover).origin));
    if (next === undefined) { number(mover, "pausetime", game.time + 999999); if (mover.classname === "buzzsaw") later(game, mover, 0.1, "rogue:saw_stand"); }
    return true;
  });
  game.named.register("rogue:track_camera", { action: (g, e) => {
    const actor = g.entity(g.world?.references.get("rogue:theActor") ?? null), player = e.owner, body = player === null ? null : g.host.bodies.read(player); if (actor === null || player === null || body === null) return g.remove(e);
    const delta = vsub(g.body(actor).origin, body.origin); g.controlPlayer(player, { kind: "cutscene", origin: body.origin, angles: velocityAngles({ ...delta, z: -delta.z }), viewOffset: ZERO }); return later(g, e, 0.1, "rogue:track_camera");
  } });
  game.named.register("rogue:actor_control", { action: control });
  game.named.register("rogue:actor_teleport", { action: (g, e) => { spawnTeleportFog(g, g.body(e).origin); e.model = ""; return later(g, e, 999999, "SUB_Null"); } });
  game.named.register("rogue:actor_run", { action: (g, e) => {
    escapeLava(g, e); const point = g.entity(e.references.get("goalentity") ?? null), world = g.world;
    if (point?.targetname === "endpoint1" || point?.targetname === "endpoint2") { if (world !== null) number(world, "rogue:actorStage", point.targetname === "endpoint1" ? 2 : 4); return later(g, e, 0.1, "rogue:actor_control"); }
    e.frame++; if (e.frame > 11) e.frame = 6; if (point !== null) g.host.moveToGoal(e.actor, point.actor.id, 15); return later(g, e, 0.1, "rogue:actor_run");
  } });
  for (let stage = 1; stage <= 21; stage++) game.named.register(`rogue:actor_fire${stage}`, { action: (g, e) => {
    e.frame = stage <= 6 ? 106 + stage : 12 + (stage - 7) % 5;
    if (stage === 1) {
      const target = machine(g); e.references.set("goalentity", target.actor.id); target.pain = g.named.pain(target, "rogue:time_crash"); target.die = g.named.die(target, "rogue:time_crash"); g.host.combat.setHealth(target.actor, 1);
      const angles = velocityAngles(vsub(g.body(target).origin, g.body(e).origin)); g.setBody(e, { angles }); e.effects = 2;
      const basis = g.makeVectors({ ...angles, x: -angles.x }); vector(e, "v_angle", { ...angles, x: -angles.x }); number(e, "ammo_rockets1", e.number("ammo_rockets1") - 1); number(e, "currentammo", e.number("ammo_rockets1"));
      g.sound(e, "weapons/sgun1.wav", "weapon"); const missile = createMissile(g, e.actor.id, "missile", "missile", vadd(vadd(g.body(e).origin, vscale(basis.forward, 8)), { x: 0, y: 0, z: 16 }), vscale(aim(g, e.actor, basis.forward), 1000), 5); missile.projectile = "rocket"; missile.touch = g.named.touch(missile, "projectile_touch");
      g.host.emit({ kind: "finale", text: missionFinaleText(g.options.edition, "$qc_finale_rogue_end"), stage: 4 });
      if (g.options.edition === "rerelease" && q1Base(g).options.officialCampaign !== false && g.mapName === "r2m8") { g.host.emit({ kind: "achievement", player: null, id: "ACH_COMPLETE_R2M8" }); if (g.options.skill === 3) g.host.emit({ kind: "achievement", player: null, id: "ACH_COMPLETE_R2M8_NIGHTMARE" }); } startFinaleTimer(g);
    } else if (stage === 2) { g.setBody(e, { angles: { ...g.body(e).angles, x: 0 } }); vector(e, "v_angle", { ...e.vector("v_angle"), x: 0 }); }
    else if (stage === 5) { removeStuff(g); const target = machine(g); if (g.health(target.actor.id) > 0) later(g, target, 0.1, "rogue:time_crash"); }
    else if (stage === 6) e.effects = 0;
    else if (stage === 21 && g.world !== null) number(g.world, "rogue:actorStage", 3);
    return later(g, e, stage === 1 ? 0.1 : 0.15, stage === 21 ? "rogue:actor_control" : `rogue:actor_fire${stage + 1}`);
  } });
  return undefined;
}
