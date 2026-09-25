import type { ActorId } from "../../contracts/identity.ts";
import type { FixedMovementPose } from "../../contracts/movement.ts";
import type { QvmGame } from "./game.ts";
import type { QvmFunctionCall, QvmSystemCallResult } from "./interpreter.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { qvmUserCommandLayout } from "./client-state-record.ts";
import { qualifyQvmRegion } from "./regions.ts";

export interface QvmEquipmentMovementProfile {
  readonly move: number;
  readonly slice: number;
  readonly duck: number;
  readonly movementGlobal: number;
  readonly locomotion: { readonly entry: number; readonly join: number };
  readonly mins: number;
  readonly maxs: number;
}
export interface QvmEquipmentMotion { readonly speedMultiplier: number; readonly pose: FixedMovementPose | null; readonly ownsHoldableInput: boolean; }
interface Frame { readonly actor: ActorId; readonly player: number; readonly movement: number; readonly pose: FixedMovementPose | null; readonly ownsHoldableInput: boolean; }
const proceed = (call: QvmFunctionCall): QvmSystemCallResult => call.execution === "synchronous" ? call.proceed() : call.proceedAsync();

/** Equipment changes the original movement decision; source timers, input and weapon dispatch still execute. */
export class QvmEquipmentMovement {
  private readonly removals: (() => void)[] = [];
  private readonly frames: (Frame | null)[] = [];
  constructor(private readonly game: Pick<QvmGame, "module" | "data">, artifact: QvmModuleOptions["artifact"],
    private readonly profile: QvmEquipmentMovementProfile, private readonly services: {
      actor(slot: number): ActorId | null;
      live(actor: ActorId): boolean;
      equipment(actor: ActorId): QvmEquipmentMotion | null;
    }) {
    for (const entry of [profile.move, profile.slice, profile.duck]) if (artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER)
      throw new Error("Selected equipment movement requires an original function boundary");
    qualifyQvmRegion(artifact.image.instructions, profile.slice, profile.locomotion.entry, profile.locomotion.join);
    const bind = (entry: number, callback: (call: QvmFunctionCall) => QvmSystemCallResult): void => {
      this.removals.push(game.module.bindInvocation({ kind: "qvm", module: artifact.module, instructionIndex: entry }, callback));
    };
    try {
      bind(profile.duck, call => this.duck(call));
    } catch (error) { this.close(); throw error; }
  }
  private admit(call: QvmFunctionCall): Frame | null {
    const movement = call.words.getInt32(0, true), player = call.guest.dataView(movement, 4).getInt32(0, true), located = this.game.data.checkpoint();
    const slot = (player - located.clientsWord) / located.clientStride;
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.game.data.numClients) return null;
    const actor = this.services.actor(slot);
    if (actor === null || !this.services.live(actor)) return null;
    const equipment = this.services.equipment(actor);
    if (equipment === null) return null;
    if (!Number.isFinite(equipment.speedMultiplier) || equipment.speedMultiplier <= 0) throw new Error("Selected movement speed must be positive and finite");
    const speed = call.guest.dataView(player + 52, 4);
    speed.setInt32(0, Math.trunc(Math.fround(speed.getInt32(0, true) * equipment.speedMultiplier)), true);
    return { actor, player, movement, pose: equipment.pose, ownsHoldableInput: equipment.ownsHoldableInput };
  }
  movement(call: QvmFunctionCall, kind: "client-command" | "movement-slice", run: () => QvmSystemCallResult): QvmSystemCallResult {
    if (kind === "movement-slice") return this.slice(call, run);
    const frame = this.admit(call); this.frames.push(frame);
    const finish = (): void => { if (this.frames.pop() !== frame) throw new Error("Selected movement scope completed out of order"); };
    try { const result = run(); if (typeof result !== "number") return result.finally(finish); finish(); return result; }
    catch (error) { if (this.frames.at(-1) === frame) finish(); throw error; }
  }
  private current(call: QvmFunctionCall): Frame | null {
    const frame = this.frames.at(-1);
    return frame == null || !this.services.live(frame.actor) || frame.pose === null
      || call.guest.dataView(this.profile.movementGlobal, 4).getInt32(0, true) !== frame.movement ? null : frame;
  }
  private slice(call: QvmFunctionCall, run: () => QvmSystemCallResult): QvmSystemCallResult {
    const frame = this.frames.at(-1);
    if (frame != null && frame.pose !== null && this.services.live(frame.actor)) call.regions([{ ...this.profile.locomotion, run: () => {
      if (this.current(call) !== frame) return "execute";
      const command = call.guest.dataView(frame.movement + 4, 24);
      const layout = qvmUserCommandLayout(this.game.module.abiProfile);
      command.setInt8(layout.forward, 0); command.setInt8(layout.right, 0); command.setInt8(layout.up, 0);
      const velocity = call.guest.dataView(frame.player + 32, 12);
      velocity.setFloat32(0, 0, true); velocity.setFloat32(4, 0, true); velocity.setFloat32(8, 0, true);
      return "skip";
    } }]);
    return run();
  }
  prepareWeapon(actor: ActorId, call: QvmFunctionCall): (() => void) | undefined {
    const frame = this.frames.at(-1);
    if (frame == null || !frame.actor.equals(actor) || !this.services.live(frame.actor) || !frame.ownsHoldableInput
      || call.guest.dataView(this.profile.movementGlobal, 4).getInt32(0, true) !== frame.movement) return undefined;
    const layout = qvmUserCommandLayout(this.game.module.abiProfile), word = call.guest.dataView(frame.movement + 4 + layout.buttons.offset, layout.buttons.bytes);
    const read = (): number => layout.buttons.bytes === 1 ? word.getUint8(0) : word.getInt32(0, true);
    const write = (value: number): void => { if (layout.buttons.bytes === 1) word.setUint8(0, value); else word.setInt32(0, value, true); };
    const previous = read(), projected = previous & ~4; write(projected);
    return () => { if (this.services.live(frame.actor) && read() === projected) write(previous); };
  }
  private duck(call: QvmFunctionCall): QvmSystemCallResult {
    const frame = this.current(call), pose = frame?.pose;
    if (frame === null || pose == null) return proceed(call);
    const flags = call.guest.dataView(frame.player + 12, 4);
    flags.setInt32(0, pose.crouched ? flags.getInt32(0, true) | 1 : flags.getInt32(0, true) & ~1, true);
    call.guest.dataView(frame.player + 164, 4).setInt32(0, pose.viewHeight, true);
    for (const [offset, value] of [[this.profile.mins, pose.bounds.min], [this.profile.maxs, pose.bounds.max]] satisfies readonly (readonly [number, FixedMovementPose["bounds"]["min"]])[]) {
      const view = call.guest.dataView(frame.movement + offset, 12);
      view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
    }
    return 0;
  }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); }
}
