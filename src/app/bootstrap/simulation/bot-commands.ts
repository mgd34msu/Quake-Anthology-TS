import type { BotUsercmdT } from "../../../bots/behavior/rerelease/world.ts";
import { BOT_BUTTON_ATTACK, BOT_BUTTON_JUMP, BOT_BUTTON_USE } from "../../../bots/behavior/rerelease/world.ts";
import type { MovementProfile } from "../../../contracts/movement.ts";
import type { UserCommand } from "../../../contracts/protocol.ts";

/** Bot movement is already expressed in source velocity units. Only Q3 uses signed command bytes. */
export function rereleaseBotCommand(source: BotUsercmdT, dialect: MovementProfile["kind"], milliseconds: number, serverTime: number): UserCommand {
  const attack = source.buttons & BOT_BUTTON_ATTACK;
  const jump = (source.buttons & BOT_BUTTON_JUMP) !== 0;
  const use = (source.buttons & BOT_BUTTON_USE) !== 0;
  const upMove = jump ? Math.max(200, source.upmove) : source.upmove;
  const angle = (value: number): number => Math.trunc(value * 65536 / 360) & 65535;
  switch (dialect) {
    case "q1-netquake": return { kind: "q1-netquake", acknowledgedServerTimeSeconds: serverTime / 1000,
      viewAngles: source.viewAngles, forwardMove: source.forwardmove, sideMove: source.sidemove, upMove,
      buttons: attack | (jump ? 2 : 0), impulse: 0 };
    case "q1-quakeworld": return { kind: "q1-quakeworld", milliseconds, angles: source.viewAngles,
      forwardMove: source.forwardmove, sideMove: source.sidemove, upMove, buttons: attack, impulse: 0 };
    case "q2-classic": return { kind: "q2-classic", milliseconds,
      angleShorts: [angle(source.viewAngles.x), angle(source.viewAngles.y), angle(source.viewAngles.z)],
      forwardMove: source.forwardmove, sideMove: source.sidemove, upMove, buttons: attack | (use ? 2 : 0), impulse: 0, lightLevel: 0 };
    case "q2-rerelease": return { kind: "q2-rerelease", milliseconds, angles: source.viewAngles,
      forwardMove: source.forwardmove, sideMove: source.sidemove,
      buttons: attack | (use ? 2 : 0) | (upMove > 0 ? 8 : upMove < 0 ? 16 : 0), serverFrame: 0 };
    case "q3": {
      const move = (value: number): number => Math.max(-127, Math.min(127, Math.trunc(value * 127 / 320)));
      return { kind: "q3", serverTimeMilliseconds: serverTime,
        angleWords: [angle(source.viewAngles.x), angle(source.viewAngles.y), angle(source.viewAngles.z)],
        forwardMove: move(source.forwardmove), rightMove: move(source.sidemove), upMove: jump ? 127 : move(source.upmove), buttons: attack, weapon: 0 };
    }
  }
}
