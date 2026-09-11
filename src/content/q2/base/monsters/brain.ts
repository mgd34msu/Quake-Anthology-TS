/* Quake II m_brain.c. id Software, GPL-2.0-or-later. */
import type { OwnedActor } from "../../../../contracts/identity.ts";
import { setDuck } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, humanoidBounds, move, sound, standardGib } from "./common.ts";
import { brainMoves } from "./tables/brain.ts";

const boundPowerArmor = new WeakSet<OwnedActor>();
function bindPowerArmor(context: MonsterContext): undefined {
  const { entity, game } = context;
  if (boundPowerArmor.has(entity.actor)) return undefined;
  game.host.combat.bindPowerArmorCells(entity.actor, {
    read: () => game.host.inventory.count(entity.actor.id, "q2:monster-power"),
    write: count => game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count, capacity: 100 }),
  });
  boundPowerArmor.add(entity.actor);
  return undefined;
}
function screen(context: MonsterContext, active: boolean): undefined {
  const { entity, game } = context;
  const cells = game.host.inventory.count(entity.actor.id, "q2:monster-power");
  return game.host.combat.setArmor(entity.actor, { kind: "q2", points: 0, normalProtection: 0, energyProtection: 0, item: "q2:monster-power-screen", powerArmor: active ? { kind: "screen", cells } : { kind: "none" } });
}
const stand = move("brain_move_stand");
function run(context: MonsterContext): undefined { screen(context, true); return context.setMove(context.state.standGround ? "brain_move_stand" : "brain_move_run"); }
function melee(context: MonsterContext): undefined { return context.setMove(context.game.host.random() <= 0.5 ? "brain_move_attack1" : "brain_move_attack2"); }
export const brainDefinition: Q2MonsterDefinition = {
  classname: "monster_brain", kind: "brain", model: "models/monsters/brain/tris.md2", health: 300, gibHealth: -150, mass: 400, bounds: humanoidBounds, scale: 1,
  initialMove: "brain_move_stand", moves: brainMoves, stand, walk: move("brain_move_walk1"), run, attack: melee, melee, hasRangedAttack: false,
  initialize(context) {
    const { entity, game } = context;
    if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
    game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count: 100, capacity: 100 });
    bindPowerArmor(context);
    return screen(context, true);
  },
  restore: bindPowerArmor,
  sight: sound("brain/brnsght1.wav"), search: sound("brain/brnsrch1.wav"),
  idle(context) { context.game.sound(context.entity, "brain/brnlens1.wav", 0, 1, 2); return context.setMove("brain_move_idle"); },
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    const r = context.game.host.random();
    context.game.sound(context.entity, r < 0.33 || r >= 0.66 ? "brain/brnpain1.wav" : "brain/brnpain2.wav", 2);
    return context.setMove(r < 0.33 ? "brain_move_pain1" : r < 0.66 ? "brain_move_pain2" : "brain_move_pain3");
  },
  die(context, reaction) {
    context.entity.effects = 0; screen(context, false);
    if (standardGib(context, reaction) || context.state.dead) return undefined;
    return beginDeath(context, reaction, "brain/brndeth1.wav", context.game.host.random() <= 0.5 ? "brain_move_death1" : "brain_move_death2");
  },
  dodge(context, attacker, eta) {
    if (context.game.host.random() > 0.25) return undefined;
    context.entity.enemy ??= attacker;
    context.state.pauseTime = context.game.host.now() + eta + 0.5;
    return context.setMove("brain_move_duck");
  },
  callbacks: {
    brain_stand: stand, brain_run: run, brain_dead: finishCorpse,
    brain_duck_down(context) { if (!context.state.ducked) setDuck(context, true); return undefined; },
    brain_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
    brain_duck_up(context) { return setDuck(context, false); },
    brain_swing_right: sound("brain/melee1.wav", 4), brain_swing_left: sound("brain/melee2.wav", 4),
    brain_hit_right(context) {
      if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.max.x, z: 8 }, 15 + Math.floor(context.game.host.random() * 5), 40)) context.game.sound(context.entity, "brain/melee3.wav", 1);
      return undefined;
    },
    brain_hit_left(context) {
      if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: 8 }, 15 + Math.floor(context.game.host.random() * 5), 40)) context.game.sound(context.entity, "brain/melee3.wav", 1);
      return undefined;
    },
    brain_chest_open(context) { context.entity.spawnflags &= ~65536; screen(context, false); return context.game.sound(context.entity, "brain/brnatck1.wav", 4); },
    brain_tentacle_attack(context) {
      if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 8 }, 10 + Math.floor(context.game.host.random() * 5), -600) && context.game.options.skill > 0) context.entity.spawnflags |= 65536;
      return context.game.sound(context.entity, "brain/brnatck3.wav", 1);
    },
    brain_chest_closed(context) { screen(context, true); if ((context.entity.spawnflags & 65536) !== 0) { context.entity.spawnflags &= ~65536; context.setMove("brain_move_attack1"); } return undefined; },
  },
};
