import type { ModClientMovementMode, ModClientMovementOutputs } from "../contracts/mod-client-outputs.ts";
import type { MovementState } from "../contracts/movement.ts";
import type { UserCommand } from "../contracts/protocol.ts";

/** Crouch requests follow each selected source's ordinary command and clearance checks. */
export function clientStanceCommand(command: UserCommand, crouched: boolean | undefined): UserCommand {
  if (crouched === undefined) return command;
  switch (command.kind) {
    case "q2-rerelease": return { ...command, buttons: crouched ? command.buttons | 16 : command.buttons & ~16 };
    case "q1-quakeworld": return { ...command, upMove: crouched ? -Math.max(1, Math.abs(command.upMove)) : Math.max(0, command.upMove), buttons: crouched ? command.buttons & ~2 : command.buttons };
    case "q2-classic": case "q3": return { ...command, upMove: crouched ? -Math.max(1, Math.abs(command.upMove)) : Math.max(0, command.upMove) };
    case "q1-netquake": throw new Error("NetQuake has no source crouch command; authored bounds require their own qualified movement boundary");
  }
}
/** Original enumerations differ between Classic API3 and rerelease API2023. */
export function clientMovementType(kind: MovementState["kind"], mode: ModClientMovementMode): number {
  if (kind === "q1-netquake") return mode === "normal" ? 3 : mode === "noclip" ? 8 : 0;
  if (kind === "q1-quakeworld") return mode === "noclip" ? 1 : 0;
  if (kind === "q2-rerelease") return mode === "normal" ? 0 : mode === "noclip" ? 2 : 6;
  return mode === "normal" ? 0 : mode === "noclip" ? 1 : 4;
}
export function clientMovementMode(outputs: ModClientMovementOutputs | null | undefined, health: number): ModClientMovementMode | undefined {
  return health > 0 ? outputs?.mode : undefined;
}
