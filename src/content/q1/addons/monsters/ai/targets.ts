/* quakec_mg3/ai.qc path_corner and path control targets. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import type { Q1EntityServices } from "../../../foundation/entity-services.ts";
import { ZERO, vsub, yawFor } from "../../../foundation/types.ts";
import type { Q1AddonContext } from "../../context.ts";

function same(first: ActorId | null, second: ActorId | null): boolean {
  return first === null || second === null ? first === second : sameActor(first, second);
}
function destination(game: Q1EntityServices, mover: Q1Actor, name: string): Q1Actor | undefined {
  const target = game.find(name)[0];
  mover.references.set("goalentity", target?.actor.id ?? null);
  mover.references.set("movetarget", target?.actor.id ?? null);
  if (mover.monster !== null) mover.monster.path = target === undefined ? "" : name;
  mover.idealYaw = yawFor(vsub(target === undefined ? ZERO : game.body(target).origin, game.body(mover).origin));
  return target;
}
function pause(mover: Q1Actor, until: number): undefined {
  const value = Math.fround(until);
  mover.fields.set("pausetime", String(value));
  if (mover.monster !== null) mover.monster.pauseUntil = value;
  return undefined;
}
function moveTarget(game: Q1EntityServices, corner: Q1Actor, other: ActorId): undefined {
  const mover = game.entity(other);
  if (mover === null || !same(mover.references.get("movetarget") ?? null, corner.actor.id) || (mover.monster?.enemy ?? mover.references.get("enemy") ?? null) !== null) return undefined;
  corner.owner = other;
  const previous = game.entity(mover.references.get("dmg_inflictor") ?? null);
  if (previous?.classname === "path_corner" && same(previous.owner, previous.actor.id)) previous.owner = null;
  mover.references.set("dmg_inflictor", corner.actor.id);
  if ((mover.monster?.pauseUntil ?? mover.number("pausetime")) > game.time) return undefined;
  if (mover.classname === "monster_ogre") game.sound(mover, "ogre/ogdrag.wav", "voice", 2);
  const target = destination(game, mover, corner.target);
  if (target === undefined || corner.wait !== 0) {
    pause(mover, game.time + (target === undefined ? 999999 : corner.wait));
    mover.pathEnd?.();
  }
  return undefined;
}
function cancelPause(game: Q1EntityServices, trigger: Q1Actor): undefined {
  for (const mover of game.find(trigger.target)) {
    if ((mover.movementFlags & 32) === 0) continue;
    pause(mover, 0);
    mover.use = game.named.use(mover, `${mover.text("source.monsterCallbackPrefix")}:monster_use`);
  }
  return undefined;
}
function switchPath(game: Q1EntityServices, trigger: Q1Actor): undefined {
  for (const corner of game.find(trigger.target)) {
    if (corner.classname !== "path_corner") continue;
    const oldTarget = corner.target;
    corner.target = trigger.text("netname");
    const mover = game.entity(corner.owner);
    if (mover !== null && same(mover.references.get("movetarget") ?? null, game.find(oldTarget)[0]?.actor.id ?? null)) destination(game, mover, corner.target);
  }
  return undefined;
}
export function registerMg3PathTargets(context: Q1AddonContext): undefined {
  const { game } = context;
  game.named.register("mg3:t_movetarget", { touch: moveTarget });
  game.named.register("mg3:target_cancelpause_use", { use: cancelPause });
  game.named.register("mg3:target_switchpath_use", { use: switchPath });
  game.registerSpawn("path_corner", (_game, entity) => {
    if (entity.targetname === "") throw new Error("path_corner with no targetname.");
    if (entity.wait < 0) entity.wait = 999999;
    entity.solid = "trigger"; entity.touch = game.named.touch(entity, "mg3:t_movetarget");
    return game.setBounds(entity, { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } });
  });
  for (const classname of ["target_cancelpause", "target_switchpath"]) game.registerSpawn(classname, (_game, entity) => {
    if (entity.target === "") throw new Error(`${classname} with no target given.`);
    if (entity.targetname === "") throw new Error(`${classname} with no targetname given.`);
    if (classname === "target_switchpath" && entity.text("netname") === "") throw new Error("target_switchtarget with no netname given.");
    entity.use = game.named.use(entity, `mg3:${classname}_use`); return undefined;
  });
  return undefined;
}
