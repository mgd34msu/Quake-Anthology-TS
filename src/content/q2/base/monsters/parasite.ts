/* Quake II m_parasite.c. id Software, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { length, subtract, zero } from "../../foundation/fields.ts";
import { enemyBody, MASK_SHOT, projectFlash, vectorAngles } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, move, sound } from "./common.ts";
import { parasiteFrame, parasiteMoves } from "./tables/parasite.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "parasite_move_stand" : "parasite_move_run"); }
function startRun(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "parasite_move_stand" : "parasite_move_start_run"); }
export function parasiteDrainReachable(start: Vec3, end: Vec3): boolean {
  const direction = subtract(start, end);
  if (length(direction) > 256) return false;
  let pitch = vectorAngles(direction).x;
  if (pitch < -180) pitch += 360;
  return Math.abs(pitch) <= 30;
}
export const parasiteDefinition: Q2MonsterDefinition = {
  classname: "monster_parasite", kind: "parasite", model: "models/monsters/parasite/tris.md2", health: 175, gibHealth: -50, mass: 250,
  bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 24 } }, scale: 1,
  initialMove: "parasite_move_stand", moves: parasiteMoves, stand: move("parasite_move_stand"), walk: move("parasite_move_start_walk"), run: startRun,
  attack: move("parasite_move_drain"), sight: sound("parasite/parsght1.wav", 1), idle: move("parasite_move_start_fidget"),
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    context.game.sound(context.entity, context.game.host.random() < 0.5 ? "parasite/parpain1.wav" : "parasite/parpain2.wav", 2);
    return context.setMove("parasite_move_pain1");
  },
  die(context, reaction) { return beginDeath(context, reaction, "parasite/pardeth1.wav", "parasite_move_death"); },
  callbacks: {
    parasite_stand: move("parasite_move_stand"), parasite_walk: move("parasite_move_walk"), parasite_run: run, parasite_start_run: startRun, parasite_dead: finishCorpse,
    parasite_launch: sound("parasite/paratck1.wav", 1), parasite_reel_in: sound("parasite/paratck4.wav", 1), parasite_tap: sound("parasite/paridle1.wav", 1, 2), parasite_scratch: sound("parasite/paridle2.wav", 1, 2), parasite_search: sound("parasite/parsrch1.wav", 1, 2),
    parasite_do_fidget: move("parasite_move_fidget"), parasite_refidget(context) { return context.setMove(context.game.host.random() <= 0.8 ? "parasite_move_fidget" : "parasite_move_end_fidget"); },
    parasite_drain_attack(context) {
      const { entity, game } = context, enemy = enemyBody(context);
      if (enemy === null || entity.enemy === null) return undefined;
      const start = projectFlash(context, { x: 24, y: 0, z: 6 });
      if (!parasiteDrainReachable(start, enemy.origin) && !parasiteDrainReachable(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.max.z - 8 }) && !parasiteDrainReachable(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 8 })) return undefined;
      // The source restores the target origin after checking top/bottom reach.
      const end = enemy.origin, trace = game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: MASK_SHOT });
      if (trace.hit.kind !== "actor" || trace.hit.actor !== entity.enemy) return undefined;
      const first = entity.frame === parasiteFrame.drain03;
      if (first) game.host.emit({ kind: "sound", actor: entity.enemy, origin: end, path: "parasite/paratck2.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
      else if (entity.frame === parasiteFrame.drain04) game.sound(entity, "parasite/paratck3.wav", 1);
      game.host.emit({ kind: "monster-beam", effect: "parasite", actor: entity.actor.id, start, end });
      game.damage(entity.enemy, entity, entity.actor.id, first ? 5 : 2, 0, subtract(start, end), end, zero, 0, 8);
      return undefined;
    },
  },
};
