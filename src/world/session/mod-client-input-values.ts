import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { ModClientApplication } from "./mod-clients.ts";
import { modClientMoveScale } from "./mod-client-command.ts";

/** The effective source command may be retained or subdivided without a new packet. */
export function modClientInputValues(application: ModClientApplication): ReadonlyMap<ModCallbackInput, ModRuntimeValue> {
  const command = application.command;
  const jump = command.kind === "q1-netquake" || command.kind === "q1-quakeworld" ? (command.buttons & 2) !== 0
    : command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 : command.upMove >= 10;
  const impulse = application.controls?.impulse ?? application.arsenal?.impulse ?? (command.kind === "q3" || command.kind === "q2-rerelease" ? application.accepted?.input.arsenal?.impulse ?? 0 : command.impulse);
  const { time, elapsed } = application.frame;
  return new Map<ModCallbackInput, ModRuntimeValue>([
    ["self", { kind: "actor", value: application.identity.actor }],
    ["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }],
    ["elapsed", { kind: "float", value: elapsed.kind === "seconds" ? elapsed.value : elapsed.value / 1000 }],
    ["view-angles", { kind: "vector", value: application.absoluteAim }],
    ["attack", { kind: "float", value: command.buttons & 1 }],
    ["jump", { kind: "float", value: jump ? 1 : 0 }],
    ["impulse", { kind: "float", value: impulse }],
    ["forward-move", { kind: "float", value: command.forwardMove / modClientMoveScale(command) }],
    ["side-move", { kind: "float", value: (command.kind === "q3" ? command.rightMove : command.sideMove) / modClientMoveScale(command) }],
    ["up-move", { kind: "float", value: command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 ? 1 : (command.buttons & 16) !== 0 ? -1 : 0 : command.upMove / modClientMoveScale(command) }],
  ]);
}
