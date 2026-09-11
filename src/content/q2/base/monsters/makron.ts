/* Quake II m_boss32.c. id Software, GPL-2.0-or-later. */
import { normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Think } from "../../foundation/host.ts";
import { anglesVectors, enemyEye, health, projectFlash, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { bossCheckAttack, stopLoop } from "./boss-common.ts";
import { damagedSkin, finishCorpse, move, muzzle, shot, sound } from "./common.ts";
import { boss32Frame, boss32Moves } from "./tables/boss32.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "makron_move_stand" : "makron_move_run"); }
const spawnCallbacks = new WeakMap<Q2Monsters, Q2Think>();
function makronSpawnCallback(monsters: Q2Monsters): Q2Think {
  const existing = spawnCallbacks.get(monsters);
  if (existing !== undefined) return existing;
  const spawn: Q2Think = (self, services) => {
    if (!monsters.spawn(self, services)) throw new Error("Makron definition must be registered before Jorg");
    const player = monsters.currentSightClient;
    const target = player === null ? null : services.host.bodies.read(player);
    if (target === null) return undefined;
    const body = services.body(self), direction = subtract(target.origin, body.origin);
    return services.move(self, { angles: { ...body.angles, y: vectorAngles(direction).y }, velocity: { ...scale(normalize(direction), 400), z: 200 }, ground: null });
  };
  spawnCallbacks.set(monsters, spawn);
  return spawn;
}
export function withMakronSpawnCallbacks(definition: Q2MonsterDefinition, monsters: Q2Monsters): Q2MonsterDefinition {
  return { ...definition, sourceCallbacks: { ...definition.sourceCallbacks, think: { ...definition.sourceCallbacks?.think,
    "q2:base/MakronSpawn": makronSpawnCallback(monsters), "q2:base/makron_torso_think": makronTorsoThink } } };
}
const makronTorsoThink: Q2Think = (self, services) => {
  self.frame++;
  if (self.frame >= 365) self.frame = 346;
  services.show(self);
  return services.schedule(self, 0.1, makronTorsoThink);
};
export function makronToss(context: MonsterContext, monsters: Q2Monsters): undefined {
  const { entity, game } = context, child = game.create("monster_makron");
  child.target = entity.target;
  game.move(child, { origin: game.body(entity).origin }, false);
  return game.schedule(child, 0.8, makronSpawnCallback(monsters));
}
export const makronDefinition: Q2MonsterDefinition = {
  classname: "monster_makron", kind: "makron", model: "models/monsters/boss3/rider/tris.md2", health: 3000, gibHealth: -2000, mass: 500,
  bounds: { min: { x: -30, y: -30, z: 0 }, max: { x: 30, y: 30, z: 90 } }, scale: 1,
  initialMove: "makron_move_sight", moves: boss32Moves, stand: move("makron_move_stand"), walk: move("makron_move_walk"), run, sight: move("makron_move_sight"),
  checkAttack(context) { return bossCheckAttack(context); },
  attack(context) { const r = context.game.host.random(); return context.setMove(r <= 0.3 ? "makron_move_attack3" : r <= 0.6 ? "makron_move_attack4" : "makron_move_attack5"); },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime || reaction.damage <= 25 && context.game.host.random() < 0.2) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    let animation: string, path: string;
    if (reaction.damage <= 40) { animation = "makron_move_pain4"; path = "makron/pain3.wav"; }
    else if (reaction.damage <= 110) { animation = "makron_move_pain5"; path = "makron/pain2.wav"; }
    else {
      // The original dangling else belongs to the first random test, inside damage <= 150.
      if (reaction.damage > 150) return undefined;
      if (context.game.host.random() > 0.45 && context.game.host.random() > 0.35) return undefined;
      animation = "makron_move_pain6"; path = "makron/pain1.wav";
    }
    context.game.sound(context.entity, path, 2, 1, 0);
    return context.setMove(animation);
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    stopLoop(context);
    if (health(game, entity.actor.id) <= state.gibHealth) {
      game.sound(entity, "misc/udeath.wav", 2);
      throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", reaction.damage, { metallic: true });
      throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage, { metallic: true, head: true });
      state.dead = true; state.gibbed = true;
      return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "makron/death.wav", 2, 1, 0);
    state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    const torso = game.create("makron_torso"), body = game.body(entity);
    torso.model = "models/monsters/boss3/rider/tris.md2"; torso.frame = 346;
    game.move(torso, { origin: { ...body.origin, y: body.origin.y - 84 }, angles: body.angles, bounds: { min: { x: -8, y: -8, z: 0 }, max: { x: 8, y: 8, z: 8 } }, velocity: zero });
    game.motion(torso, "stationary"); game.solid(torso, "none"); game.show(torso);
    game.host.emit({ kind: "sound", actor: torso.actor.id, origin: game.body(torso).origin, path: "makron/spine.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
    game.schedule(torso, 0.2, makronTorsoThink);
    return context.setMove("makron_move_death2");
  },
  callbacks: {
    makron_run: run,
    makron_dead(context) { return finishCorpse(context, { min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 72 } }); },
    makron_step_left: sound("makron/step1.wav", 4), makron_step_right: sound("makron/step2.wav", 4), makron_popup: sound("makron/popup.wav", 4, 0), makron_hit: sound("makron/bhit.wav", 0, 0), makron_brainsplorch: sound("makron/brain1.wav", 2), makron_prerailgun: sound("makron/rail_up.wav", 1),
    makron_taunt(context) { const r = context.game.host.random(); return context.game.sound(context.entity, r <= 0.3 ? "makron/voice4.wav" : r <= 0.6 ? "makron/voice3.wav" : "makron/voice.wav", 0, 1, 0); },
    makronBFG(context) {
      const aim = shot(context, 101); if (aim === null) return undefined;
      context.game.sound(context.entity, "makron/bfg_fire.wav", 2);
      context.weapons.fireBfg(context.entity, context.game, aim.start, aim.direction, 50, 300, 300);
      return muzzle(context, 101, aim.direction, aim.start);
    },
    MakronSaveloc(context) { const eye = enemyEye(context); if (eye !== null) context.state.blindFireTarget = eye; return undefined; },
    MakronRailgun(context) {
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, 119)), direction = normalize(subtract(context.state.blindFireTarget, start));
      context.weapons.fireRail(context.entity, context.game, start, direction, 50, 100);
      return muzzle(context, 119, direction, start);
    },
    MakronHyperblaster(context) {
      const frame = context.entity.frame, flash = 102 + frame - boss32Frame.attak405;
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash));
      const eye = enemyEye(context), yaw = context.game.body(context.entity).angles.y;
      const direction = anglesVectors({ x: eye === null ? 0 : vectorAngles(subtract(eye, start)).x, y: frame <= boss32Frame.attak413 ? yaw - 10 * (frame - boss32Frame.attak413) : yaw + 10 * (frame - boss32Frame.attak421), z: 0 }).forward;
      context.weapons.fireBlaster(context.entity, context.game, start, direction, 15, 1000, 8);
      return muzzle(context, 102, direction, start);
    },
  },
};
