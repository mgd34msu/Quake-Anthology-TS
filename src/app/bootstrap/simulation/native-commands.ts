import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2RereleaseUserCommand, Q2UserCommand, UserCommand } from "../../../contracts/protocol.ts";
import type { MovementPlayer } from "./players.ts";

type NativeCommand = Q2UserCommand | Q2RereleaseUserCommand;

const word = (angle: number): number => Math.trunc(angle * 65536 / 360) & 65535;
const axis127 = (value: number): number => Math.trunc(Math.max(-127, Math.min(127, value * 127 / 200)));

/**
 * A native Q2 client command re-expressed in the selected movement dialect.
 * The guest DLL still receives its own command for its ClientThink logic;
 * this copy drives the unified movement provider inside the guest Pmove
 * call. Aim is the player's absolute view angles; Q2 axes use the shared
 * 200-unit full scale (320 for Q1 dialects, 127 for Q3).
 */
export function selectedNativeCommand(command: NativeCommand, aim: Vec3,
  player: Pick<MovementPlayer, "profile" | "arsenal">, serverTimeMilliseconds: number): UserCommand {
  const jump = command.kind === "q2-classic" ? command.upMove > 0 : (command.buttons & 8) !== 0;
  const crouch = command.kind === "q2-classic" ? command.upMove < 0 : (command.buttons & 16) !== 0;
  const attack = (command.buttons & 1) !== 0;
  const up = command.kind === "q2-classic" ? command.upMove * 320 / 200 : jump ? 320 : crouch ? -320 : 0;
  switch (player.profile.kind) {
    case "q1-netquake": return { kind: "q1-netquake", acknowledgedServerTimeSeconds: serverTimeMilliseconds / 1000, viewAngles: aim,
      forwardMove: command.forwardMove * 320 / 200, sideMove: command.sideMove * 320 / 200, upMove: up,
      buttons: (attack ? 1 : 0) | (jump ? 2 : 0), impulse: command.kind === "q2-classic" ? command.impulse : 0 };
    case "q1-quakeworld": return { kind: "q1-quakeworld", milliseconds: command.milliseconds, angles: aim,
      forwardMove: command.forwardMove * 320 / 200, sideMove: command.sideMove * 320 / 200, upMove: up,
      buttons: (attack ? 1 : 0) | (jump ? 2 : 0), impulse: command.kind === "q2-classic" ? command.impulse : 0 };
    case "q2-classic": return { kind: "q2-classic", milliseconds: command.milliseconds,
      angleShorts: [word(aim.x), word(aim.y), word(aim.z)],
      forwardMove: Math.trunc(command.forwardMove), sideMove: Math.trunc(command.sideMove),
      upMove: command.kind === "q2-classic" ? command.upMove : jump ? 200 : crouch ? -200 : 0,
      buttons: attack ? 1 : 0, impulse: command.kind === "q2-classic" ? command.impulse : 0, lightLevel: 0 };
    case "q2-rerelease": return { kind: "q2-rerelease", milliseconds: command.milliseconds, angles: aim,
      forwardMove: command.forwardMove, sideMove: command.sideMove,
      buttons: (attack ? 1 : 0) | (jump ? 8 : 0) | (crouch ? 16 : 0),
      serverFrame: command.kind === "q2-rerelease" ? command.serverFrame : 0 };
    case "q3": return { kind: "q3", serverTimeMilliseconds, angleWords: [word(aim.x), word(aim.y), word(aim.z)],
      forwardMove: axis127(command.forwardMove), rightMove: axis127(command.sideMove),
      upMove: jump ? 127 : crouch ? -127 : 0, buttons: attack ? 1 : 0,
      weapon: player.arsenal.state.kind === "q3" ? player.arsenal.state.sourceWeapon : 0 };
  }
}
