/* Hipnotic ai.qc path_follow and t_movetarget. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { BaseMonster } from "../../base/monsters.ts";
import { POINT, ZERO, vsub, yawFor } from "../../foundation/types.ts";
import type { Q1MissionPackMonsters } from "./runtime.ts";

function controller(runtime: Q1MissionPackMonsters, entity: Q1Actor): BaseMonster | null {
  return runtime.monsters.get(entity.actor) ?? runtime.base.monsters.get(entity.actor) ?? null;
}
function follow(runtime: Q1MissionPackMonsters, trigger: Q1Actor, actor: ActorId): undefined {
  const { game } = runtime, entity = game.entity(actor);
  if (entity === null || (entity.movementFlags & 32) === 0 || entity.classname === "monster_decoy" || entity.number("wetsuit_time") > game.time) return undefined;
  const monster = controller(runtime, entity); if (monster === null) return undefined;
  const enemy = monster.enemy, start = monster.eye(), end = enemy === null ? game.world === null ? ZERO : game.body(game.world).origin : monster.eye(enemy);
  if (start === null || end === null || game.host.trace({ start, end, bounds: POINT, ignore: actor, monsters: true }).fraction === 1) return undefined;
  if (enemy !== null) {
    monster.state.oldEnemy = enemy; monster.enemy = null; monster.nextFrame = monster.spec.walk;
    entity.think = game.named.action(entity, `${monster.source?.callbackPrefix ?? "base"}:monster_frame`);
  }
  const target = game.find(trigger.target)[0]; monster.state.path = target?.targetname ?? "";
  entity.references.set("goalentity", target?.actor.id ?? null); entity.references.set("movetarget", target?.actor.id ?? null);
  entity.idealYaw = yawFor(vsub(target === undefined ? ZERO : game.body(target).origin, monster.origin));
  entity.fields.set("wetsuit_time", String(Math.fround(game.time + 2)));
  if (target !== undefined) return undefined;
  if (monster.state.oldEnemy !== null) return monster.found(monster.state.oldEnemy);
  const client = game.host.checkClient(entity.actor);
  // Original QC enters FoundTarget when checkclient returns world.
  if (client === null && game.world !== null) return monster.found(game.world.actor.id);
  monster.state.pauseUntil = game.time + 999999; return monster.play(monster.spec.stand);
}
export function registerHipnoticPaths(runtime: Q1MissionPackMonsters): undefined {
  const { game } = runtime;
  game.named.register("hipnotic:t_followtarget", { touch: (_game, entity, other) => follow(runtime, entity, other) });
  for (const classname of ["path_follow", "path_follow2"]) game.registerSpawn(classname, (source, entity) => {
    entity.solid = "trigger"; entity.touch = source.named.touch(entity, "hipnotic:t_followtarget");
    if (classname === "path_follow2") return source.setBounds(entity, { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } });
    entity.movement = "none"; entity.model = ""; return source.link(entity);
  });
  game.registerPathTouch("hipnotic:t_movetarget", (corner, entity) => {
    const monster = controller(runtime, entity);
    if (monster === null) return false;
    if (monster.state.path !== corner.targetname || monster.enemy !== null) return true;
    if (entity.classname === "monster_ogre") game.sound(entity, "ogre/ogdrag.wav", "voice", 2);
    if (corner.target !== "") {
      const target = game.find(corner.target)[0]; monster.state.path = target?.targetname ?? "";
      entity.references.set("goalentity", target?.actor.id ?? null); entity.references.set("movetarget", target?.actor.id ?? null);
      entity.idealYaw = yawFor(vsub(target === undefined ? ZERO : game.body(target).origin, monster.origin));
      if (target !== undefined) {
        if (corner.delay !== 0) { monster.state.pauseUntil = game.time + corner.delay; monster.play(monster.spec.stand); }
        return true;
      }
    }
    monster.state.pauseUntil = game.time + 999999; monster.play(monster.spec.stand); return true;
  });
  return undefined;
}
