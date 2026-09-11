/* Quake II m_flipper.c. id Software, GPL-2.0-or-later. */
import type { Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, move, sound, standardGib } from "./common.ts";
import { flipperMoves } from "./tables/flipper.ts";

export const flipperDefinition: Q2MonsterDefinition = {
  classname: "monster_flipper", kind: "flipper", model: "models/monsters/flipper/tris.md2", health: 50, gibHealth: -30, mass: 100,
  bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 32 } }, scale: 1, locomotion: "swim", hasRangedAttack: false,
  initialMove: "flipper_move_stand", moves: flipperMoves, stand: move("flipper_move_stand"), walk: move("flipper_move_walk"), run: move("flipper_move_start_run"),
  attack: move("flipper_move_attack"), melee: move("flipper_move_attack"), sight: sound("flipper/flpsght1.wav"),
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    const first = (Math.floor(context.game.host.random() * 2) + 1) % 2 === 0;
    context.game.sound(context.entity, first ? "flipper/flppain1.wav" : "flipper/flppain2.wav", 2);
    return context.setMove(first ? "flipper_move_pain1" : "flipper_move_pain2");
  },
  die(context, reaction) {
    if (standardGib(context, reaction, 2, 2, "models/objects/gibs/sm_meat/tris.md2")) return undefined;
    return beginDeath(context, reaction, "flipper/flpdeth1.wav", "flipper_move_death");
  },
  callbacks: {
    flipper_run: move("flipper_move_run_start"), flipper_run_loop: move("flipper_move_run_loop"), flipper_dead: finishCorpse,
    flipper_preattack: sound("flipper/flpatck1.wav", 1),
    flipper_bite(context) { context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 5, 0); return undefined; },
  },
};
