import type { ActorCommand } from "../../../../contracts/session.ts";
import type { UserCommand as SelectedCommand } from "../../../../contracts/protocol.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { UserCommand as Q3Command } from "../../../../content/q3/base/shared/player-state.ts";

/** Source policy edits the translated fields while unchanged foreign command units retain their original precision. */
export function applyQ3CommandPolicy(pending: ActorCommand, before: Q3Command, after: Q3Command,
  converted: SelectedCommand, frozen = false): ActorCommand {
  const envelope = frozen && pending.arsenal !== undefined
    ? { ...pending, arsenal: { ...pending.arsenal, weapon: null, useHoldable: false } } : pending;
  const original = pending.command;
  if (original.kind === "q3") return { ...envelope, command: converted };
  const forward = (value: number, changed: number): number => frozen ? 0 : before.forwardmove === after.forwardmove ? value : changed;
  const side = (value: number, changed: number): number => frozen ? 0 : before.rightmove === after.rightmove ? value : changed;
  const up = (value: number, changed: number): number => frozen ? 0 : before.upmove === after.upmove ? value : changed;
  const angles = (value: Vec3, changed: Vec3): Vec3 => ({
    x: before.angles.x === after.angles.x ? value.x : changed.x,
    y: before.angles.y === after.angles.y ? value.y : changed.y,
    z: before.angles.z === after.angles.z ? value.z : changed.z,
  });
  const buttons = (value: number, changed: number, jumpMask: number): number => {
    if (frozen) return 0;
    const mask = 1 | (before.upmove === after.upmove ? 0 : jumpMask);
    return (value & ~mask) | (changed & mask);
  };
  switch (original.kind) {
    case "q1-netquake": {
      if (converted.kind !== original.kind) throw new Error("Q3 policy changed the selected command dialect");
      return { ...envelope, command: { ...original,
        acknowledgedServerTimeSeconds: before.serverTime === after.serverTime ? original.acknowledgedServerTimeSeconds : converted.acknowledgedServerTimeSeconds,
        viewAngles: angles(original.viewAngles, converted.viewAngles), forwardMove: forward(original.forwardMove, converted.forwardMove),
        sideMove: side(original.sideMove, converted.sideMove), upMove: up(original.upMove, converted.upMove),
        buttons: buttons(original.buttons, converted.buttons, 2), impulse: frozen ? 0 : original.impulse } };
    }
    case "q1-quakeworld": {
      if (converted.kind !== original.kind) throw new Error("Q3 policy changed the selected command dialect");
      return { ...envelope, command: { ...original, milliseconds: converted.milliseconds,
        angles: angles(original.angles, converted.angles), forwardMove: forward(original.forwardMove, converted.forwardMove),
        sideMove: side(original.sideMove, converted.sideMove), upMove: up(original.upMove, converted.upMove),
        buttons: buttons(original.buttons, converted.buttons, 0), impulse: frozen ? 0 : original.impulse } };
    }
    case "q2-classic": {
      if (converted.kind !== original.kind) throw new Error("Q3 policy changed the selected command dialect");
      return { ...envelope, command: { ...original, milliseconds: converted.milliseconds,
        angleShorts: [before.angles.x === after.angles.x ? original.angleShorts[0] : converted.angleShorts[0],
          before.angles.y === after.angles.y ? original.angleShorts[1] : converted.angleShorts[1],
          before.angles.z === after.angles.z ? original.angleShorts[2] : converted.angleShorts[2]],
        forwardMove: forward(original.forwardMove, converted.forwardMove), sideMove: side(original.sideMove, converted.sideMove),
        upMove: up(original.upMove, converted.upMove), buttons: buttons(original.buttons, converted.buttons, 0), impulse: frozen ? 0 : original.impulse } };
    }
    case "q2-rerelease": {
      if (converted.kind !== original.kind) throw new Error("Q3 policy changed the selected command dialect");
      return { ...envelope, command: { ...original, milliseconds: converted.milliseconds,
        angles: angles(original.angles, converted.angles), forwardMove: forward(original.forwardMove, converted.forwardMove),
        sideMove: side(original.sideMove, converted.sideMove), buttons: buttons(original.buttons, converted.buttons, 8 | 16) } };
    }
  }
}
