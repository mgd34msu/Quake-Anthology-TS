import type { ModClientInput, ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { UserCommand } from "../../contracts/protocol.ts";
import type { Vec3 } from "../../contracts/math.ts";

/** The same units used by the existing cross-game source command translators. */
export function modClientMoveScale(command: UserCommand): number {
  return command.kind === "q3" ? 127 : command.kind === "q1-netquake" || command.kind === "q1-quakeworld" ? 320 : 200;
}
export function modClientCommandImpulse(command: UserCommand): number {
  return command.kind === "q3" || command.kind === "q2-rerelease" ? 0 : command.impulse;
}
export function modClientCommandAim(command: UserCommand, aim: Vec3, previous: Vec3): UserCommand {
  if (command.kind === "q1-netquake") return { ...command, viewAngles: aim };
  if (command.kind === "q1-quakeworld" || command.kind === "q2-rerelease") {
    const angles = command.angles;
    return { ...command, angles: { x: angles.x + aim.x - previous.x, y: angles.y + aim.y - previous.y, z: angles.z + aim.z - previous.z } };
  }
  const source = command.kind === "q3" ? command.angleWords : command.angleShorts;
  const words: [number, number, number] = [source[0] + Math.trunc((aim.x - previous.x) * 65536 / 360),
    source[1] + Math.trunc((aim.y - previous.y) * 65536 / 360), source[2] + Math.trunc((aim.z - previous.z) * 65536 / 360)];
  return command.kind === "q3" ? { ...command, angleWords: words } : { ...command, angleShorts: words };
}
export function modClientCommandScalar(command: UserCommand, input: Exclude<ModClientInput, "view-angles">, value: number): UserCommand {
  if (!Number.isFinite(value)) throw new RangeError("Source input output must be finite");
  const bit = (mask: number, enabled: boolean): number => enabled ? command.buttons | mask : command.buttons & ~mask;
  switch (input) {
    case "attack": return { ...command, buttons: bit(1, value !== 0) };
    case "jump":
      if (command.kind === "q1-netquake" || command.kind === "q1-quakeworld") return { ...command, buttons: bit(2, value !== 0) };
      if (command.kind === "q2-rerelease") return { ...command, buttons: bit(8, value !== 0) };
      return { ...command, upMove: value === 0 ? Math.min(0, command.upMove) : Math.max(10, command.upMove, modClientMoveScale(command)) };
    case "impulse":
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("Source impulse output must fit one byte");
      return command.kind === "q3" || command.kind === "q2-rerelease" ? command : { ...command, impulse: value };
    case "forward-move": return { ...command, forwardMove: move(value, command) };
    case "side-move": return command.kind === "q3" ? { ...command, rightMove: move(value, command) } : { ...command, sideMove: move(value, command) };
    case "up-move":
      return command.kind === "q2-rerelease" ? { ...command, buttons: (command.buttons & ~(8 | 16)) | (value > 0 ? 8 : value < 0 ? 16 : 0) }
        : { ...command, upMove: move(value, command) };
  }
}
function move(value: number, command: UserCommand): number {
  const scaled = value * modClientMoveScale(command);
  if (command.kind === "q2-rerelease") {
    if (!Number.isFinite(Math.fround(scaled))) throw new RangeError("Source movement output exceeds destination command ABI");
    return scaled;
  }
  const maximum = command.kind === "q3" ? 127 : 32767, minimum = command.kind === "q3" ? -127 : -32768;
  if (scaled < minimum || scaled > maximum) throw new RangeError("Source movement output exceeds destination command ABI");
  return Math.trunc(scaled);
}
export function modClientOutputChanges(output: ModClientInputOutput): readonly Exclude<ModClientInputOutput, { kind: "consume" }>[] {
  return output.kind === "consume" ? output.inputs.map(input => ({ kind: "set", input, value: 0 })) : [output];
}
