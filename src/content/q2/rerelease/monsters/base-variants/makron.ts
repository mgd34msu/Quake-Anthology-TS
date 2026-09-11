// Rerelease m_boss32.cpp. ZeniMax Media, GPL-2.0.
import { makronDefinition } from "../../../base/monsters/makron.ts";
import { stopLoop } from "../../../base/monsters/boss-common.ts";
import { add, normalize, scale, subtract } from "../../../foundation/fields.ts";
import type { Q2Think } from "../../../foundation/host.ts";
import { anglesVectors, corpse, enemyEye, health, projectFlash, vectorAngles } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../../foundation/monsters/muzzle.ts";
import { defaultCheckAttack } from "../../../foundation/monsters/perception.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { chainfist, checkGib, monsterFlash, reactsToPain } from "../common.ts";
import { boss32Frame, boss32Moves } from "../tables/boss32.ts";
import type { ActorId } from "../../../../../contracts/identity.ts";

const torsoThink: Q2Think = (entity, game) => {
  if (++entity.frame >= 365) entity.frame = 346;
  const angles = game.body(entity).angles;
  if (angles.x > 0) game.move(entity, { angles: { ...angles, x: Math.max(0, angles.x - 15) } });
  game.show(entity); return game.schedule(entity, 0.1, torsoThink);
};
function spawnTorso(context: MonsterContext): undefined {
  const { entity, game } = context, torso = throwGib(entity, game, "models/monsters/boss3/rider/tris.md2", 0);
  if (torso === null) return undefined;
  const body = game.body(entity), axes = anglesVectors(body.angles), height = body.bounds.max.z - game.body(torso).bounds.max.z;
  torso.frame = 346; torso.skin = 1; torso.effects = 2; torso.angularVelocity = { x: 0, y: 0, z: 0 }; torso.sound = "makron/spine.wav";
  game.move(torso, { origin: add({ ...body.origin, z: body.origin.z + height - 15 }, scale(axes.forward, -10)), angles: { ...body.angles, x: 90 }, velocity: add(game.body(torso).velocity, add(scale(axes.up, 120), scale(axes.forward, -120))) });
  game.motion(torso, "toss"); game.show(torso);
  game.host.emit({ kind: "sound", actor: torso.actor.id, origin: game.body(torso).origin, path: torso.sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
  return game.schedule(torso, 0.1, torsoThink);
}
export function tossRereleaseMakron(context: MonsterContext, monsters: Q2Monsters): ActorId {
  const { entity, game } = context, child = game.create("monster_makron");
  child.target = entity.target; child.enemy = entity.enemy; game.move(child, { origin: game.body(entity).origin }, false);
  if (!monsters.spawn(child, game)) throw new Error("Makron must be registered before Jorg");
  child.think?.(child, game);
  const enemy = child.enemy !== null && health(game, child.enemy) > 0 ? child.enemy : monsters.currentSightClient;
  const target = enemy === null ? null : game.host.bodies.read(enemy), resumed = monsters.context(child.actor.id);
  if (target === null || resumed === null) return child.actor.id;
  const body = game.body(child), difference = subtract(target.origin, body.origin);
  game.move(child, { angles: { ...body.angles, y: vectorAngles(difference).y }, velocity: { ...scale(normalize(difference), 400), z: 200 }, ground: null });
  child.enemy = enemy; monsters.foundTarget(resumed); resumed.setMove("makron_move_sight"); child.frame = resumed.state.nextFrame = boss32Frame.active01;
  return child.actor.id;
}
export const rereleaseMakronDefinition: Q2MonsterDefinition = {
  ...makronDefinition, moves: boss32Moves, sourceCallbacks: { think: { "rerelease.makron.makron_torso_think": torsoThink } },
  initialize(context) { context.state.ignoreShots = true; return undefined; },
  checkAttack: context => defaultCheckAttack(context, { standGround: 0.4, melee: 0.8, near: 0.4, mid: 0.2, far: 0, strafeScalar: 0 }),
  pain(context, reaction) {
    const { game, entity, state } = context;
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
    if (state.move.name === "makron_move_sight" || game.host.now() < state.painTime || !chainfist(context) && reaction.damage <= 25 && game.host.random() < 0.2) return undefined;
    state.painTime = game.host.now() + 3;
    let heavy = false;
    if (reaction.damage <= 40) game.sound(entity, "makron/pain3.wav", 2, 1, 0);
    else if (reaction.damage <= 110) game.sound(entity, "makron/pain2.wav", 2, 1, 0);
    else if (game.host.random() <= (reaction.damage <= 150 ? 0.45 : 0.35)) { heavy = true; game.sound(entity, "makron/pain1.wav", 2, 1, 0); }
    if (!reactsToPain(context)) return undefined;
    if (reaction.damage <= 40) context.setMove("makron_move_pain4");
    else if (reaction.damage <= 110) context.setMove("makron_move_pain5");
    else if (heavy) context.setMove("makron_move_pain6");
    return undefined;
  },
  die(context, reaction) {
    const { entity, game, state } = context; stopLoop(context); entity.sound = "";
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2); throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", reaction.damage, { metallic: true });
      throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage, { metallic: true, head: true }); state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "makron/death.wav", 2, 1, 0); state.dead = true; state.canTakeDamage = true; entity.serverFlags |= 2;
    game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); context.setMove("makron_move_death2"); spawnTorso(context);
    return game.move(entity, { bounds: { min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 48 } } });
  },
  callbacks: {
    ...makronDefinition.callbacks,
    makron_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 24 } } }); },
    makron_spawn_torso: spawnTorso,
    MakronSaveloc(context) { const eye = enemyEye(context); if (eye !== null) context.entity.pos1 = eye; return undefined; },
    MakronRailgun(context) {
      const start = projectFlash(context, muzzleOffset("rerelease", 119)), direction = normalize(subtract(context.entity.pos1, start));
      context.weapons.fireRail(context.entity, context.game, start, direction, 50, 100); return monsterFlash(context, 119, start, direction);
    },
    MakronHyperblaster(context) {
      const frame = context.entity.frame, flash = 102 + frame - boss32Frame.attak405, start = projectFlash(context, muzzleOffset("rerelease", flash));
      const eye = enemyEye(context), yaw = context.game.body(context.entity).angles.y;
      const direction = anglesVectors({ x: eye === null ? 0 : vectorAngles(subtract(eye, start)).x, y: frame <= boss32Frame.attak413 ? yaw - 10 * (frame - boss32Frame.attak413) : yaw + 10 * (frame - boss32Frame.attak421), z: 0 }).forward;
      context.weapons.fireBlaster(context.entity, context.game, start, direction, 15, 1000, 8); return monsterFlash(context, flash, start, direction);
    },
  },
};
