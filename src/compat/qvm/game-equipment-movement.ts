import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { MovementBodyShape } from "../../movement/body-shape.ts";
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
  readonly bodyTrace?: { readonly callback: number; readonly mask: number };
}
export interface QvmEquipmentMotion { readonly speedMultiplier: number; readonly pose: FixedMovementPose | null; readonly ownsHoldableInput: boolean; readonly body?: MovementBodyShape; }
interface Frame { acceptedBounds?: Bounds; readonly actor: ActorId; readonly player: number; readonly movement: number; readonly pose: FixedMovementPose | null; readonly ownsHoldableInput: boolean; readonly body?: MovementBodyShape; }
const proceed = (call: QvmFunctionCall): QvmSystemCallResult => call.execution === "synchronous" ? call.proceed() : call.proceedAsync();

/** Equipment changes the original movement decision; source timers, input and weapon dispatch still execute. */
export class QvmEquipmentMovement {
  private readonly removals: (() => void)[] = [];
  private readonly bodyScratch: number;
  private readonly frames: (Frame | null)[] = [];
  constructor(private readonly game: Pick<QvmGame, "module" | "data">, artifact: QvmModuleOptions["artifact"],
    private readonly profile: QvmEquipmentMovementProfile, private readonly services: {
      actor(slot: number): ActorId | null;
      live(actor: ActorId): boolean;
      equipment(actor: ActorId): QvmEquipmentMotion | null;
    }) {
    this.bodyScratch = Math.ceil((artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength) / 16) * 16;
    if (profile.bodyTrace !== undefined && this.bodyScratch + 92 > artifact.image.allocatedDataLength - 65536) throw new Error("Original body trace requires scratch outside source data and stack");
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
    return { actor, player, movement, pose: equipment.pose, ownsHoldableInput: equipment.ownsHoldableInput, ...(equipment.body === undefined ? {} : { body: equipment.body }) };
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
    return frame == null || !this.services.live(frame.actor) || frame.pose === null && frame.body === undefined
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
    if (frame === null) return proceed(call);
    if (pose == null) return this.bodyShape(call, frame);
    const flags = call.guest.dataView(frame.player + 12, 4);
    flags.setInt32(0, pose.crouched ? flags.getInt32(0, true) | 1 : flags.getInt32(0, true) & ~1, true);
    call.guest.dataView(frame.player + 164, 4).setInt32(0, pose.viewHeight, true);
    for (const [offset, value] of [[this.profile.mins, pose.bounds.min], [this.profile.maxs, pose.bounds.max]] satisfies readonly (readonly [number, FixedMovementPose["bounds"]["min"]])[]) {
      const view = call.guest.dataView(frame.movement + offset, 12);
      view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
    }
    return 0;
  }
  private bodyShape(call: QvmFunctionCall, frame: Frame): QvmSystemCallResult {
    const body = frame.body, trace = this.profile.bodyTrace;
    if (body === undefined || trace === undefined) {
      if (body?.requested !== undefined) throw new Error("Original QVM body shape requires an admitted trace callback layout");
      return proceed(call);
    }
    const flags = call.guest.dataView(frame.player + 12, 4), height = call.guest.dataView(frame.player + 164, 4);
    const previousDuck = flags.getInt32(0, true) & 1, previousHeight = height.getInt32(0, true);
    const vector = (at: number): Vec3 => { const view = call.guest.dataView(at, 12); return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) }; };
    const write = (at: number, value: Vec3): void => { const view = call.guest.dataView(at, 12); view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true); };
    const finish = (result: number): QvmSystemCallResult => {
      body.currentActor();
      const source = { min: vector(frame.movement + this.profile.mins), max: vector(frame.movement + this.profile.maxs) };
      const requested = body.requested ?? source, previous = frame.acceptedBounds ?? body.current;
      const apply = (accepted: Bounds): number => {
        call.effect(() => { body.currentActor();
          if (accepted !== requested) { flags.setInt32(0, (flags.getInt32(0, true) & ~1) | previousDuck, true); height.setInt32(0, previousHeight, true); }
          frame.acceptedBounds = accepted; write(frame.movement + this.profile.mins, accepted.min); write(frame.movement + this.profile.maxs, accepted.max); return undefined;
        }); return result;
      };
      const expands = requested.min.x < previous.min.x || requested.min.y < previous.min.y || requested.min.z < previous.min.z
        || requested.max.x > previous.max.x || requested.max.y > previous.max.y || requested.max.z > previous.max.z;
      if (!expands) return apply(requested);
      const at = this.bodyScratch, saved = call.memory.slice(at, at + 92);
      const restore = (): void => { call.effect(() => { call.guest.writeBytes(at, saved); return undefined; }); };
      const checked = (): number => {
        const value = call.guest.dataView(at, 56);
        return apply(value.getInt32(0, true) === 0 ? requested : previous);
      };
      try {
        call.effect(() => { write(at + 56, vector(frame.player + 20)); write(at + 68, requested.min); write(at + 80, requested.max); return undefined; });
        const callback = call.guest.dataView(frame.movement + trace.callback, 4).getInt32(0, true), mask = call.guest.dataView(frame.movement + trace.mask, 4).getInt32(0, true);
        const value = this.game.module.invokeSourceCallback(call, callback, [at, at + 56, at + 68, at + 80, at + 56, call.guest.dataView(frame.player + 140, 4).getInt32(0, true), mask]);
        if (typeof value !== "number") return value.then(checked).finally(restore);
        const complete = checked(); restore(); return complete;
      } catch (error) { restore(); throw error; }
    };
    const result = proceed(call);
    return typeof result === "number" ? finish(result) : result.then(finish);
  }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); }
}
