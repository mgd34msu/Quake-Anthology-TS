import { resolveQ3ArsenalControls } from "./arsenal-intent.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { UserCommand as SelectedCommand } from "../../../contracts/protocol.ts";
import type { UserCommand } from "../../../content/q3/base/shared/player-state.ts";
import type { MovementPlayer } from "./players.ts";

/** Source client policy receives command units independently of the selected PMove input. */
export function q3SourceCommand(input: ActorCommand, player: MovementPlayer, milliseconds: number, nativeWeapon: number): UserCommand {
  const command = input.command;
  const controls = player.arsenal.state.kind === "q3"
    ? resolveQ3ArsenalControls(player.arsenal, input.arsenal, command, player.recipe.map.entities.content.includes("missionpack") ? "missionpack" : "baseq3")
    : { requestedWeapon: nativeWeapon, useHoldable: input.arsenal?.useHoldable ?? (command.kind === "q3" && (command.buttons & 4) !== 0) };
  const buttons = (command.kind === "q3" ? command.buttons & ~4 : command.buttons & 1) | (controls.useHoldable ? 4 : 0);
  if (command.kind === "q3") return { serverTime: command.serverTimeMilliseconds,
    angles: { x: command.angleWords[0], y: command.angleWords[1], z: command.angleWords[2] }, buttons,
    weapon: controls.requestedWeapon, forwardmove: command.forwardMove, rightmove: command.rightMove, upmove: command.upMove };
  const angles = command.kind === "q2-classic" ? { x: command.angleShorts[0], y: command.angleShorts[1], z: command.angleShorts[2] }
    : (() => { const value = command.kind === "q1-netquake" ? command.viewAngles : command.angles;
      return { x: Math.trunc(value.x * 65536 / 360) & 65535, y: Math.trunc(value.y * 65536 / 360) & 65535, z: Math.trunc(value.z * 65536 / 360) & 65535 }; })();
  const axis = (value: number): number => Math.trunc(Math.max(-127, Math.min(127, value * 127 / (command.kind === "q1-netquake" || command.kind === "q1-quakeworld" ? 320 : 200))));
  return { serverTime: Math.trunc(milliseconds), angles, buttons,
    weapon: controls.requestedWeapon,
    forwardmove: axis(command.forwardMove), rightmove: axis(command.sideMove),
    upmove: command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 ? 127 : (command.buttons & 16) !== 0 ? -127 : 0 : axis(command.upMove) };
}

/** Source spawn/inactivity frames can supply commands without a new transport packet. */
export function selectedQ3Command(command: UserCommand, player: Pick<MovementPlayer, "profile">, milliseconds: number): SelectedCommand {
  const angles = { x: command.angles.x * 360 / 65536, y: command.angles.y * 360 / 65536, z: command.angles.z * 360 / 65536 };
  const forwardMove = command.forwardmove * 320 / 127, sideMove = command.rightmove * 320 / 127, upMove = command.upmove * 320 / 127;
  switch (player.profile.kind) {
    case "q1-netquake": return { kind: "q1-netquake", acknowledgedServerTimeSeconds: command.serverTime / 1000,
      viewAngles: angles, forwardMove, sideMove, upMove, buttons: (command.buttons & 1) | (command.upmove > 0 ? 2 : 0), impulse: 0 };
    case "q1-quakeworld": return { kind: "q1-quakeworld", milliseconds, angles, forwardMove, sideMove, upMove, buttons: command.buttons & 1, impulse: 0 };
    case "q2-classic": return { kind: "q2-classic", milliseconds, angleShorts: [command.angles.x, command.angles.y, command.angles.z],
      forwardMove: command.forwardmove * 200 / 127, sideMove: command.rightmove * 200 / 127, upMove: command.upmove * 200 / 127, buttons: command.buttons & 1, impulse: 0, lightLevel: 0 };
    case "q2-rerelease": return { kind: "q2-rerelease", milliseconds, angles, forwardMove: command.forwardmove * 200 / 127,
      sideMove: command.rightmove * 200 / 127, buttons: (command.buttons & 1) | (command.upmove > 0 ? 8 : command.upmove < 0 ? 16 : 0), serverFrame: 0 };
    case "q3": return { kind: "q3", serverTimeMilliseconds: command.serverTime, angleWords: [command.angles.x, command.angles.y, command.angles.z],
      forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove, buttons: command.buttons, weapon: command.weapon };
  }
}
