// Rerelease m_shambler.cpp. ZeniMax Media, GPL-2.0.
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, scale } from "../../foundation/fields.ts";
import { clearShot, corpse, enemyBody, enemyEye, health, projectFlash, runAi, targetDistance } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { move, sound } from "../../base/monsters/common.ts";
import { chainfist, checkGib, predictedDirection, reactsToPain } from "./common.ts";
import { shamblerFrame, shamblerMoves } from "./tables/shambler.ts";

const leftHand: readonly Vec3[] = [{ x: 44, y: 36, z: 25 }, { x: 10, y: 44, z: 57 }, { x: -1, y: 40, z: 70 }, { x: -10, y: 34, z: 75 }, { x: 7.4, y: 24, z: 89 }];
const rightHand: readonly Vec3[] = [{ x: 28, y: -38, z: 25 }, { x: 31, y: -7, z: 70 }, { x: 20, y: 0, z: 80 }, { x: 16, y: 1.2, z: 81 }, { x: 27, y: -11, z: 83 }];

function run(context: MonsterContext): undefined {
  context.state.brutal = context.entity.enemy !== null && context.game.host.isPlayer(context.entity.enemy);
  return context.setMove(context.state.standGround ? "shambler_move_stand" : "shambler_move_run");
}
function clearBeam(context: MonsterContext): undefined {
  for (const id of [context.entity.beam, context.entity.beam2]) {
    const beam = context.game.entity(id); if (beam === null) continue;
    context.game.host.emit({ kind: "beam", actor: beam.actor.id, start: context.game.body(beam).origin, end: beam.pos2, width: 2, color: 0xffffffff, visible: false });
    context.game.remove(beam);
  }
  context.entity.beam = null; context.entity.beam2 = null; return undefined;
}
function lightningUpdate(context: MonsterContext): undefined {
  const frame = context.entity.frame - shamblerFrame.magic01;
  if (frame >= leftHand.length) return clearBeam(context);
  const left = leftHand[frame], right = rightHand[frame], beam = context.game.entity(context.entity.beam);
  if (left === undefined || right === undefined || beam === null) return undefined;
  const start = projectFlash(context, left), end = projectFlash(context, right);
  context.game.move(beam, { origin: start }); beam.pos2 = end;
  return context.game.host.emit({ kind: "beam", actor: beam.actor.id, start, end, width: 2, color: 0xffffffff, visible: true });
}
function claw(context: MonsterContext, smash: boolean): undefined {
  const { entity, game } = context;
  if (entity.enemy === null) return undefined;
  runAi(context, "charge", smash ? 0 : 10);
  if (!game.canDamage(entity.enemy, entity)) return undefined;
  const hit = context.weapons.fireHit(entity, game, { x: 80, y: game.body(entity).bounds.min.x, z: -4 }, (smash ? 110 : 70) + Math.floor(game.host.random() * 10), smash ? 120 : 80);
  if (hit) game.sound(entity, "shambler/smack.wav", 1);
  return undefined;
}

export const shamblerDefinition: Q2MonsterDefinition = {
  classname: "monster_shambler", kind: "shambler", model: "models/monsters/shambler/tris.md2", health: 600, gibHealth: -60, mass: 500, scale: 1,
  bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, initialMove: "shambler_move_stand", moves: shamblerMoves,
  stand: move("shambler_move_stand"), walk: move("shambler_move_walk"), run, sight: sound("shambler/ssight.wav"), idle: sound("shambler/sidle.wav", 2, 2), attack: move("shambler_attack_magic"),
  melee(context) {
    const chance = context.game.host.random();
    return context.setMove(chance > 0.6 || health(context.game, context.entity.actor.id) === 600 ? "shambler_attack_smash" : chance > 0.3 ? "shambler_attack_swingl" : "shambler_attack_swingr");
  },
  pain(context, reaction) {
    const { game, entity, state } = context;
    if (game.host.now() < entity.timestamp) return undefined;
    entity.timestamp = game.host.now() + 0.001; game.sound(entity, "shambler/shurt2.wav", 0);
    if (!chainfist(context) && reaction.damage <= 30 && game.host.random() > 0.2) return undefined;
    if (game.options.skill >= 2 && (entity.frame >= shamblerFrame.smash01 && entity.frame <= shamblerFrame.smash12 || entity.frame >= shamblerFrame.swingl01 && entity.frame <= shamblerFrame.swingl09 || entity.frame >= shamblerFrame.swingr01 && entity.frame <= shamblerFrame.swingr09)) return undefined;
    if (!reactsToPain(context) || game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 2; return context.setMove("shambler_move_pain");
  },
  die(context, reaction) {
    const { game, entity, state } = context;
    clearBeam(context);
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2);
      throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/chest/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage, { head: true });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "shambler/sdeath.wav", 2); state.dead = true; state.canTakeDamage = true;
    game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("shambler_move_death");
  },
  callbacks: {
    shambler_run: run,
    shambler_maybe_idle(context) { if (context.game.host.random() > 0.8) context.game.sound(context.entity, "shambler/sidle.wav", 2, 1, 2); return undefined; },
    shambler_windup(context) {
      const { entity, game } = context;
      game.sound(entity, "shambler/sattck1.wav", 1);
      const beam = game.create("shambler_lightning"); entity.beam = beam.actor.id; beam.owner = entity.actor.id;
      beam.model = "models/proj/lightning/tris.md2"; beam.renderFlags |= 128;
      return lightningUpdate(context);
    },
    shambler_lightning_update: lightningUpdate,
    ShamblerSaveLoc(context) {
      const eye = enemyEye(context); if (eye === null) return undefined;
      context.entity.pos1 = eye; context.state.nextFrame = shamblerFrame.magic09;
      context.game.sound(context.entity, "shambler/sboom.wav", 1); return lightningUpdate(context);
    },
    ShamblerCastLightning(context) {
      if (enemyBody(context) === null) return undefined;
      let offset: Vec3 = { x: 0, y: 0, z: 48 };
      for (let i = 0; i < 8; i++) { const candidate = { x: 0, y: 0, z: 48 - i * 4 }; if (clearShot(context, candidate)) { offset = candidate; break; } }
      const start = projectFlash(context, offset), direction = predictedDirection(context, start, 0, false, (context.entity.spawnflags & 1) !== 0 ? 0 : 0.1);
      if (direction === null) return undefined;
      const { entity, game } = context;
      const trace = game.host.trace({ start, end: add(start, scale(direction, 8192)), bounds: null, ignore: entity.actor.id, mask: 0x46004003 | 8 | 16 });
      game.host.emit({ kind: "beam", actor: entity.actor.id, start, end: trace.end, width: 2, color: 0xffffffff, visible: true });
      return context.weapons.fireBullet(entity, game, start, direction, 8 + Math.floor(game.host.random() * 4), 15, 0, 0, 45);
    },
    shambler_melee1: sound("shambler/melee1.wav", 1), shambler_melee2: sound("shambler/melee2.wav", 1),
    sham_smash10: context => claw(context, true), ShamClaw: context => claw(context, false),
    sham_swingl9(context) { runAi(context, "charge", 8); if (context.game.host.random() < 0.5 && enemyBody(context) !== null && targetDistance(context) < 80) context.setMove("shambler_attack_swingr"); return undefined; },
    sham_swingr9(context) { runAi(context, "charge", 1); runAi(context, "charge", 10); if (context.game.host.random() < 0.5 && enemyBody(context) !== null && targetDistance(context) < 80) context.setMove("shambler_attack_swingl"); return undefined; },
    shambler_shrink(context) { const bounds = context.game.body(context.entity).bounds; context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { min: bounds.min, max: { ...bounds.max, z: 0 } } }); },
    shambler_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 0 } } }); },
  },
};
