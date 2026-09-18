import type { MovementState } from "../../../contracts/movement.ts";
import type { UserCommand, Q1UserCommand } from "../../../contracts/protocol.ts";
import type { Vec3 } from "../../../contracts/math.ts";

/** Translate physical actions into the source QC ABI, retaining source weapon impulses. */
export function quakeCClientCommand(command: UserCommand): Q1UserCommand {
  let angles: Vec3;
  let jump: boolean;
  let side: number;
  let up: number;
  let impulse: number;
  switch (command.kind) {
    case "q1-netquake": return command;
    case "q1-quakeworld": angles = command.angles; jump = (command.buttons & 2) !== 0; side = command.sideMove; up = command.upMove; impulse = command.impulse; break;
    case "q2-rerelease": angles = command.angles; jump = (command.buttons & 8) !== 0; side = command.sideMove; up = jump ? 1 : 0; impulse = 0; break;
    case "q2-classic": angles = { x: command.angleShorts[0] * 360 / 65536, y: command.angleShorts[1] * 360 / 65536, z: command.angleShorts[2] * 360 / 65536 }; jump = command.upMove >= 10; side = command.sideMove; up = command.upMove; impulse = command.impulse; break;
    case "q3": angles = { x: command.angleWords[0] * 360 / 65536, y: command.angleWords[1] * 360 / 65536, z: command.angleWords[2] * 360 / 65536 }; jump = command.upMove >= 10; side = command.rightMove; up = command.upMove; impulse = 0; break;
  }
  return { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: angles,
    forwardMove: command.forwardMove, sideMove: side, upMove: up, buttons: (command.buttons & 1) | (jump ? 2 : 0), impulse };
}

export interface QuakeCClientTransitionState {
  readonly flags: number;
  readonly velocity: Vec3;
}

export function quakeCSourceJump(command: UserCommand, before: QuakeCClientTransitionState, after: QuakeCClientTransitionState): boolean {
  const jumpFlags = 512 | 4096;
  return (quakeCClientCommand(command).buttons & 2) !== 0
    && (before.flags & jumpFlags) === jumpFlags && (after.flags & jumpFlags) === 0
    && after.velocity.z > before.velocity.z;
}

export interface QuakeCClientMovement {
  readonly command: UserCommand;
  readonly sourceJump: boolean;
}

export function consumeQuakeCJump(command: UserCommand): UserCommand {
  switch (command.kind) {
    case "q1-netquake": case "q1-quakeworld": return { ...command, buttons: command.buttons & ~2 };
    case "q2-rerelease": return { ...command, buttons: command.buttons & ~8 };
    case "q2-classic": case "q3": return { ...command, upMove: command.upMove > 0 ? 0 : command.upMove };
  }
}

/** QW spectators own free flight independently of the selected physics dialect. */
export function quakeCFreeMovement(state: MovementState): MovementState {
  switch (state.kind) {
    case "q1-netquake": return { ...state, moveType: 8 };
    case "q1-quakeworld": return { ...state, spectator: 1 };
    case "q2-classic": return { ...state, type: 1 };
    case "q2-rerelease": return { ...state, type: 2 };
    case "q3": return { ...state, movementType: 1 };
  }
}
