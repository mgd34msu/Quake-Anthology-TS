import type { MovementBodyShape } from "../../movement/body-shape.ts";
import type { ModClientMovementOutputs } from "../../contracts/mod-client-outputs.ts";
import { clientMovementType, clientStanceCommand } from "../../movement/client-outputs.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue } from "../../contracts/execution.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import type { Q2UserCommand, Q2RereleaseUserCommand } from "../../contracts/protocol.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { ModClientApplication, ModClientCommand, ModClientIdentity } from "../../world/session/mod-clients.ts";
import type { ModClientApplications } from "../../world/session/mod-client-applications.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../guest/abi/runner.ts";
import { requiredPointer } from "../../guest/runtime/common/memory.ts";
import { classicViewAngles, rereleaseViewAngles } from "../../movement/q2/view.ts";
import type { ClassicQ2GuestHost } from "./classic/host.ts";
import { CLASSIC_Q2_EXPORTS, CLASSIC_Q2_PMOVE_BYTES } from "./classic/layout.ts";
import type { RereleaseGuestModule } from "./rerelease/module.ts";
import { gameExports, gameExportLayout } from "./rerelease/api.ts";
import { edictLayout, fieldOffset, pmoveLayout, pmoveStateLayout, usercmdLayout } from "./rerelease/layouts.ts";
import { readRereleaseUserCommand } from "./rerelease/player-state.ts";
import { writeNativeUserCommand } from "./native-mod-client-stages.ts";
import { bindNativeModEntry, type NativeModEntryBinding } from "./native-mod-entries.ts";

type NativeCommand = Q2UserCommand | Q2RereleaseUserCommand;
export interface NativeInputMotion {
  read(): { readonly origin: Vec3; readonly velocity: Vec3 };
  grounded(): boolean;
  view(): { readonly viewOffset: Vec3; readonly crouched: boolean };
  write(value: { readonly origin: Vec3; readonly velocity: Vec3 }): undefined;
}
export interface NativeInputServices {
  readonly applications: ModClientApplications;
  bodyBounds?(actor: ActorId): Bounds | null;
  readonly numeric: NumericOperations;
  clientOutputs?(actor: ActorId): ModClientMovementOutputs | null;
  identity(slot: number): ModClientIdentity | null;
  live(identity: ModClientIdentity): boolean;
  accepted(actor: ActorId): ModClientCommand | null;
  frame(): FrameContext;
  onRelease(listener: (actor: ActorId) => undefined): () => void;
  retired(identity: ModClientIdentity): void;
  originalCommand?(identity: ModClientIdentity, command: NativeCommand): NativeCommand;
  movement<T>(identity: ModClientIdentity, projection: NativeInputMotion, run: () => T): T;
}
type NativeInputSource = ({ readonly edition: "classic"; readonly host: ClassicQ2GuestHost }
  | { readonly edition: "rerelease"; readonly host: RereleaseGuestModule }) & { retire(slot: number, identity: ModClientIdentity): void };
interface CommandScope { readonly identity: ModClientIdentity; readonly slot: number; }
class RemovedNativeInput extends Error {
  constructor(readonly scope: CommandScope) { super("Native input actor was removed"); }
}

export function readClassicUserCommand(view: DataView): Q2UserCommand {
  return { kind: "q2-classic", milliseconds: view.getUint8(0), buttons: view.getUint8(1),
    angleShorts: [view.getInt16(2, true), view.getInt16(4, true), view.getInt16(6, true)],
    forwardMove: view.getInt16(8, true), sideMove: view.getInt16(10, true), upMove: view.getInt16(12, true),
    impulse: view.getUint8(14), lightLevel: view.getUint8(15) };
}

/** Public ClientThink/Pmove boundaries, including calls made inside the original game DLL. */
export class NativeInputBinding {
  private readonly removals: (() => void)[] = [];
  private readonly commands: CommandScope[] = [];
  private current: ModClientApplication | null = null;
  constructor(private readonly source: NativeInputSource, private readonly services: NativeInputServices) {
    const host = source.host, memory = host.memory;
    const entryHost = { memory, entries: host.options.runner.options,
      invoke: (address: GuestAddress, signature: Parameters<typeof host.invoke>[1], values: readonly GuestCallValue[]) => host.invoke(address, signature, values) };
    const entry = (name: "ClientThink" | "Pmove") => {
      if (source.edition === "classic") {
        const definition = CLASSIC_Q2_EXPORTS[name];
        if (definition === undefined) throw new Error(`API3 lacks ${name}`);
        const address = memory.readPointer(memory.offset(source.host.edicts.exports, BigInt(definition.offset)));
        if (address === null) throw new Error(`Null API3 ${name}`);
        return { address, signature: definition.signature };
      }
      const definition = gameExports.find(value => value.name === name);
      if (definition === undefined) throw new Error(`API2023 lacks ${name}`);
      const address = memory.readPointer(memory.offset(source.host.bindGame(), BigInt(fieldOffset(gameExportLayout, name))));
      if (address === null) throw new Error(`Null API2023 ${name}`);
      return { address, signature: definition.signature };
    };
    const think = entry("ClientThink");
    const command = bindNativeModEntry(entryHost, think.address, `${memory.module.id}:input.ClientThink`, think.signature,
      (values, original) => this.command(values, original), () => services.applications.active || services.bodyBounds !== undefined);
    this.removals.push(command.close);
    try {
      this.removals.push(services.onRelease(actor => {
        for (const scope of this.commands) if (scope.identity.actor.equals(actor)) source.retire(scope.slot, scope.identity);
        return undefined;
      }));
      if (source.edition === "classic") this.removals.push(source.host.bindInputMovement((address, run) => {
        this.movement(address, body => { run(body); return { kind: "void" }; }); return undefined;
      }));
      else this.removals.push(source.host.bindInputMovement((address, run) => {
        this.movement(address, body => { run(body); return { kind: "void" }; }); return undefined;
      }, () => (services.applications.active || services.bodyBounds !== undefined) && this.commands.length !== 0));
    } catch (error) { this.close(); throw error; }
  }
  private assertLive(scope: CommandScope): void {
    if (!this.services.live(scope.identity)) throw new RemovedNativeInput(scope);
  }
  private command(values: readonly GuestCallValue[], original: NativeModEntryBinding["original"]): GuestCallResult {
    const { source, services } = this, pointer = requiredPointer(values, 0);
    const record = source.edition === "classic" ? source.host.edicts.fromPointer(pointer) : source.host.entities().fromPointer(pointer);
    const identity = services.identity(record.slot);
    if (identity === null) return original(values);
    const scope: CommandScope = { identity, slot: record.slot }, cpu = source.host.options.runner.options.cpu;
    const saved = captureAbiProcessorState(cpu.state);
    this.commands.push(scope);
    try {
      if (!services.applications.active) { this.assertLive(scope); const result = original(values); this.assertLive(scope); return result; }
      const address = requiredPointer(values, 1), memory = source.host.memory;
      const commandView = memory.borrow(address, source.edition === "classic" ? 16 : usercmdLayout.byteLength);
      const command = source.edition === "classic" ? readClassicUserCommand(commandView) : readRereleaseUserCommand(commandView);
      const state = source.edition === "classic" ? source.host.edicts.clientPrefix(record.slot)
        : (() => { const client = memory.readPointer(memory.offset(record.address, BigInt(fieldOffset(edictLayout, "client"))));
          return client === null ? null : memory.borrow(client, pmoveStateLayout.byteLength); })();
      if (state === null) throw new Error("Native input has no public client state");
      return this.apply(scope, "client-command", command, state, commandView, () => original(values));
    } catch (error) {
      if (!(error instanceof RemovedNativeInput) || error.scope !== scope) throw error;
      // Unlike guest faults, this controlled exit resumes this exact original caller.
      restoreAbiProcessorState(cpu.state, saved);
      return { kind: "void" };
    } finally { this.commands.pop(); }
  }
  private apply(scope: CommandScope, kind: ModClientApplication["scope"], command: NativeCommand, state: DataView, commandView: DataView,
    run: () => GuestCallResult): GuestCallResult {
    const previous = this.current;
    const parent = previous?.identity.actor.equals(scope.identity.actor) === true ? previous : null;
    const frame = this.services.frame();
    let application: ModClientApplication | null = null, failed = true;
    let projectedType: { readonly before: number; readonly value: number } | null = null;
    try {
      application = this.services.applications.begin({ identity: scope.identity, scope: kind, command,
        angleSpace: "source-relative", absoluteAim: this.aim(command, state), accepted: this.services.accepted(scope.identity.actor),
        arsenal: kind === "movement-slice" ? parent?.arsenal ?? null : null,
        controls: { impulse: command.kind === "q2-classic" ? command.impulse : kind === "movement-slice" ? parent?.controls?.impulse ?? 0 : 0 },
        parentInvocation: previous?.invocation ?? null, frame: { ...frame, phase: "client-command", elapsed: { kind: "milliseconds", value: command.milliseconds } } },
      (aim, value) => {
        if (value.kind === "q2-classic") return { ...value, angleShorts: [
          Math.trunc(aim.x * 65536 / 360) - state.getInt16(20, true), Math.trunc(aim.y * 65536 / 360) - state.getInt16(22, true), Math.trunc(aim.z * 65536 / 360) - state.getInt16(24, true)] };
        if (value.kind === "q2-rerelease") return { ...value, angles: {
          x: aim.x - state.getFloat32(36, true), y: aim.y - state.getFloat32(40, true), z: aim.z - state.getFloat32(44, true) } };
        throw new Error("Native input output changed command dialect");
      });
      this.current = application;
      this.assertLive(scope);
      if (application !== null) {
        const effective = clientStanceCommand(application.command, kind === "movement-slice" ? this.services.clientOutputs?.(scope.identity.actor)?.stance : undefined);
        if (effective.kind === "q2-classic" || effective.kind === "q2-rerelease")
          writeNativeUserCommand(commandView, kind === "client-command" ? this.services.originalCommand?.(scope.identity, effective) ?? effective : effective);
        else throw new Error("Native input output changed command dialect");
      }
      const output = kind === "movement-slice" ? this.services.clientOutputs?.(scope.identity.actor) : null;
      if (output?.mode !== undefined) {
        const before = state.getInt32(0, true), value = clientMovementType(command.kind, output.mode);
        projectedType = { before, value }; state.setInt32(0, value, true);
      }
      const result = run();
      failed = false;
      this.services.applications.finish(application);
      application = null;
      this.assertLive(scope);
      return result;
    } finally {
      try { this.services.applications.finish(application, failed); }
      finally {
        if (projectedType !== null && this.services.live(scope.identity) && state.getInt32(0, true) === projectedType.value) state.setInt32(0, projectedType.before, true);
        this.current = previous;
      }
    }
  }
  private aim(command: NativeCommand, state: DataView): Vec3 {
    const result: [number, number, number] = [0, 0, 0];
    if (command.kind === "q2-classic") classicViewAngles(result, [...command.angleShorts],
      [state.getInt16(20, true), state.getInt16(22, true), state.getInt16(24, true)], state.getUint8(16), this.services.numeric);
    else rereleaseViewAngles(result, [command.angles.x, command.angles.y, command.angles.z],
      [state.getFloat32(36, true), state.getFloat32(40, true), state.getFloat32(44, true)], state.getUint16(28, true), this.services.numeric);
    return { x: result[0], y: result[1], z: result[2] };
  }
  private movement(address: GuestAddress, run: (body?: MovementBodyShape) => GuestCallResult): GuestCallResult {
    const scope = this.commands.at(-1);
    if (scope === undefined) return run();
    this.assertLive(scope);
    const { source } = this, memory = source.host.memory;
    if (source.edition === "rerelease") {
      const player = memory.readPointer(memory.offset(address, BigInt(fieldOffset(pmoveLayout, "player"))));
      if (player?.byteOffset !== source.host.entities().atSlot(scope.slot).address.byteOffset) return run();
    }
    if (!this.services.applications.active) return this.runBody(scope, run);
    const classic = source.edition === "classic", view = memory.borrow(address, classic ? CLASSIC_Q2_PMOVE_BYTES : pmoveLayout.byteLength);
    const commandOffset = classic ? 28 : fieldOffset(pmoveLayout, "cmd.msec");
    const cmd = new DataView(view.buffer, view.byteOffset + commandOffset, classic ? 16 : usercmdLayout.byteLength);
    const command = classic ? readClassicUserCommand(cmd) : readRereleaseUserCommand(cmd);
    let moved = false;
    const vector = (offset: number): Vec3 => classic
      ? { x: view.getInt16(offset, true) * 0.125, y: view.getInt16(offset + 2, true) * 0.125, z: view.getInt16(offset + 4, true) * 0.125 }
      : { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) };
    const store = (offset: number, value: Vec3): void => {
      for (const [axis, amount] of [value.x, value.y, value.z].entries()) {
        if (classic) view.setInt16(offset + axis * 2, this.services.numeric.toInt32(this.services.numeric.multiply(amount, 8)), true);
        else view.setFloat32(offset + axis * 4, amount, true);
      }
    };
    const projection: NativeInputMotion = { read: () => ({ origin: vector(4), velocity: vector(classic ? 10 : 16) }),
      grounded: () => ((classic ? view.getUint8(16) : view.getUint16(fieldOffset(pmoveStateLayout, "pm_flags"), true)) & 4) !== 0,
      view: () => {
        if (source.edition === "classic") {
          const client = source.host.edicts.clientPrefix(scope.slot);
          if (client === null) throw new Error("Native input has no public client view");
          return { viewOffset: { x: client.getFloat32(40, true), y: client.getFloat32(44, true), z: moved ? view.getFloat32(192, true) : client.getFloat32(48, true) },
            crouched: ((moved ? view.getUint8(16) : client.getUint8(16)) & 1) !== 0 };
        }
        const offset = vector(fieldOffset(pmoveLayout, "viewoffset"));
        return { viewOffset: { ...offset, z: offset.z + view.getInt8(fieldOffset(pmoveStateLayout, "viewheight")) },
        crouched: (view.getUint16(fieldOffset(pmoveStateLayout, "pm_flags"), true) & 1) !== 0 };
      },
      write: value => { store(4, value.origin); store(classic ? 10 : 16, value.velocity); return undefined; } };
    return this.services.movement(scope.identity, projection, () => this.apply(scope, "movement-slice", command, view, cmd,
      () => {
        const result = this.runBody(scope, run); moved = true; return result;
      }));
  }
  private runBody(scope: CommandScope, run: (body?: MovementBodyShape) => GuestCallResult): GuestCallResult {
    this.assertLive(scope);
    const requested = this.services.clientOutputs?.(scope.identity.actor)?.bodyBounds, current = this.services.bodyBounds?.(scope.identity.actor);
    if (requested !== undefined && current == null) throw new Error("Native body shape lost its current actor bounds");
    const body = current == null ? undefined : { current, ...(requested === undefined ? {} : { requested }), currentActor: () => this.assertLive(scope) };
    const result = run(body); this.assertLive(scope); return result;
  }
  close(): undefined { for (const remove of this.removals.splice(0).reverse()) remove(); return undefined; }
}
