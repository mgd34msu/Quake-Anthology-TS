import type { ActorId } from "../../contracts/identity.ts";
import { isDeepStrictEqual } from "node:util";
import type { QvmAbiProfile } from "../../contracts/execution.ts";
import type { ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmModActorRecord, QvmModInputOutput, QvmModInputPointer } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import type { QvmFunctionCall, QvmSystemCallResult } from "./interpreter.ts";
import type { QvmModule } from "./module.ts";
import { QVM_USER_COMMAND_BYTES, readQvmUserCommand } from "./client-state-record.ts";

interface Operations {
  readonly module: QvmModule;
  readonly abiProfile: QvmAbiProfile;
  readonly records: readonly QvmModActorRecord[];
  pointer(actor: ActorId, record: string): number;
  live(actor: ActorId): boolean;
  playerState(actor: ActorId): Q3PlayerState;
}
interface CommandCapture {
  readonly output: Extract<QvmModInputOutput, { kind: "command" }>;
  readonly address: number;
  before: ReturnType<typeof readQvmUserCommand>;
}
interface Capture {
  readonly application: ModClientApplication;
  readonly selected: ReadonlySet<QvmModInputOutput>;
  readonly changes: ModClientInputOutput[];
  readonly fields: { readonly output: Extract<QvmModInputOutput, { kind: "field" }>; before: ModClientInputOutput }[];
  readonly commands: CommandCapture[];
  readonly consumed: Extract<ModClientInputOutput, { kind: "consume" }>[];
}
function scalar(view: DataView, encoding: "int32" | "float32"): number {
  const value = encoding === "int32" ? view.getInt32(0, true) : view.getFloat32(0, true);
  if (!Number.isFinite(value)) throw new Error("QVM input returned a nonfinite scalar");
  return value;
}

/** Observe original source writes and handler decisions within their actual caller frame. */
export class QvmModInput {
  private readonly removals: (() => void)[] = [];
  private readonly applications: ModClientApplication[] = [];
  private readonly captures: Capture[] = [];
  constructor(private readonly operations: Operations, outputs: readonly QvmModInputOutput[]) {
    const entries = new Map<number, Exclude<QvmModInputOutput, { kind: "field" }>[]>();
    try {
      for (const output of outputs) {
        const record = operations.records.find(record => record.id === (output.kind === "field" ? output.record : output.actor.record));
        if (record === undefined) throw new Error("QVM input output names an undeclared actor record");
        if (output.kind === "field") {
          const size = output.value.input === "view-angles" ? 12 : 4;
          if (!Number.isSafeInteger(output.offset) || output.offset < 0 || output.offset + size > record.stride)
            throw new Error("QVM input output exceeds its actor record");
          if (output.value.input !== "view-angles" && (!Number.isFinite(output.value.scale) || output.value.scale <= 0))
            throw new Error("QVM input field scale must be positive");
          continue;
        }
        this.validatePointer(output.actor.pointer);
        if (output.kind === "command") this.validatePointer(output.command);
        if (output.kind === "handler" && output.returns !== undefined) {
          const { value, encoding } = output.returns;
          if (!Number.isFinite(value) || (encoding === "float32" ? !Number.isFinite(Math.fround(value))
            : !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) throw new Error("Invalid QVM input handler return value");
        }
        const existing = entries.get(output.entry);
        if (existing === undefined) entries.set(output.entry, [output]); else existing.push(output);
      }
      for (const [entry, declarations] of entries) this.removals.push(operations.module.bindInvocation({ kind: "qvm",
        module: operations.module.profile.module, instructionIndex: entry }, call => this.invoke(call, declarations)));
    } catch (error) { this.close(); throw error; }
  }
  private validatePointer(pointer: QvmModInputPointer): void {
    if (!Number.isSafeInteger(pointer.offset) || pointer.offset < 0
      || pointer.indirections.some(offset => !Number.isSafeInteger(offset) || offset < 0)) throw new Error("Invalid QVM input pointer path");
    if (pointer.kind === "argument") {
      if (!Number.isSafeInteger(pointer.index) || pointer.index < 0 || pointer.index > 9) throw new Error("Invalid QVM input pointer argument");
    } else this.operations.module.memory.dataView(pointer.address, 4);
  }
  private address(pointer: QvmModInputPointer, call: QvmFunctionCall): number {
    let address = pointer.kind === "argument" ? call.words.getInt32(pointer.index * 4, true)
      : call.guest.dataView(pointer.address, 4).getInt32(0, true);
    for (const offset of pointer.indirections) address = call.guest.view(address + offset, 4).getInt32(0, true);
    return address + pointer.offset;
  }
  open(application: ModClientApplication): () => void {
    const suspended = this.captures.at(-1);
    if (suspended !== undefined && this.active(suspended)) this.reconcile(suspended, true);
    this.applications.push(application);
    return () => {
      const index = this.applications.lastIndexOf(application);
      if (index === -1) return;
      this.applications.splice(index, 1);
      if (suspended !== undefined && this.active(suspended)) this.reconcile(suspended, false);
    };
  }
  private active(capture: Capture): boolean {
    return this.captures.at(-1) === capture && this.applications.at(-1) === capture.application
      && this.operations.live(capture.application.identity.actor);
  }
  private field(output: Extract<QvmModInputOutput, { kind: "field" }>, actor: ActorId): ModClientInputOutput {
    const { module } = this.operations, input = output.value.input;
    const view = module.memory.dataView(this.operations.pointer(actor, output.record) + output.offset, input === "view-angles" ? 12 : 4);
    if (output.value.input === "view-angles") {
      const value = { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
      if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error("QVM input returned nonfinite angles");
      return { kind: "set", input: "view-angles", value };
    }
    return { kind: "set", input: output.value.input, value: scalar(view, output.value.encoding) / output.value.scale };
  }
  private invoke(call: QvmFunctionCall, declarations: readonly Exclude<QvmModInputOutput, { kind: "field" }>[]): QvmSystemCallResult {
    const capture = this.captures.at(-1);
    if (capture === undefined || !this.active(capture)) return call.execution === "synchronous" ? call.proceed() : call.proceedAsync();
    const actor = capture.application.identity.actor;
    const selected = declarations.filter(output => capture.selected.has(output)
      && this.address(output.actor.pointer, call) === this.operations.pointer(actor, output.actor.record));
    const commands = selected.flatMap(output => output.kind !== "command" ? [] : [{ output,
      address: this.address(output.command, call), before: readQvmUserCommand(call.guest.view(this.address(output.command, call), QVM_USER_COMMAND_BYTES), this.operations.abiProfile) }]);
    const finish = (result: number): number => {
      if (!this.active(capture)) return result;
      for (const output of selected) if (output.kind === "handler") {
        if (output.returns !== undefined) {
          const view = new DataView(new ArrayBuffer(4)); view.setInt32(0, result, true);
          const expected = output.returns.encoding === "float32" ? Math.fround(output.returns.value) : output.returns.value;
          if (scalar(view, output.returns.encoding) !== expected) continue;
        }
        capture.consumed.push({ kind: "consume", inputs: output.inputs });
      }
      this.commands(capture, commands, true);
      return result;
    };
    capture.commands.push(...commands);
    const remove = (): void => { for (const command of commands) {
      const index = capture.commands.indexOf(command); if (index !== -1) capture.commands.splice(index, 1);
    } };
    try {
      if (call.execution === "asynchronous") return call.proceedAsync().then(finish).finally(remove);
      try { return finish(call.proceed()); } finally { remove(); }
    } catch (error) { remove(); throw error; }
  }
  private commands(capture: Capture, commands: readonly CommandCapture[], publish: boolean): void {
    for (const command of commands) {
      const { output, address, before } = command;
      const after = readQvmUserCommand(this.operations.module.memory.view(address, QVM_USER_COMMAND_BYTES), this.operations.abiProfile);
      command.before = after;
      if (!publish) continue;
      for (const input of output.inputs) {
        if (input === "view-angles") {
          const delta = this.operations.playerState(capture.application.identity.actor).deltaAngleWords;
          if (before.angles.some((angle, index) => angle !== after.angles[index])) capture.changes.push({ kind: "set", input,
            value: { x: ((after.angles[0] + delta[0]) & 65535) * 360 / 65536,
              y: ((after.angles[1] + delta[1]) & 65535) * 360 / 65536, z: ((after.angles[2] + delta[2]) & 65535) * 360 / 65536 } });
          continue;
        }
        const value = (command: typeof before): number => {
          switch (input) {
            case "attack": return (command.buttons & 1) === 0 ? 0 : 1;
            case "jump": return command.upmove >= 10 ? 1 : 0;
            case "forward-move": return command.forwardmove / 127;
            case "side-move": return command.rightmove / 127;
            case "up-move": return command.upmove / 127;
          }
        };
        if (value(before) !== value(after)) capture.changes.push({ kind: "set", input, value: value(after) });
      }
    }
  }
  private reconcile(capture: Capture, publish: boolean): void {
    for (const field of capture.fields) {
      const after = this.field(field.output, capture.application.identity.actor);
      if (publish && !isDeepStrictEqual(field.before, after)) capture.changes.push(after);
      field.before = after;
    }
    this.commands(capture, capture.commands, publish);
  }
  output(outputs: readonly QvmModInputOutput[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[] {
    if (this.applications.at(-1) !== application) throw new Error("QVM input output requires its live application");
    const actor = application.identity.actor;
    const capture: Capture = { application, selected: new Set(outputs), changes: [], commands: [], consumed: [],
      fields: outputs.flatMap(output => output.kind === "field" ? [{ output, before: this.field(output, actor) }] : []) };
    this.captures.push(capture);
    try {
      run();
      if (!this.active(capture)) return [];
      this.reconcile(capture, true);
      return [...capture.changes, ...capture.consumed];
    } finally { this.captures.pop(); }
  }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); this.applications.length = 0; this.captures.length = 0; }
}
