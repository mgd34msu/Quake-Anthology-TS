import type { ItemId } from "../../contracts/gameplay.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { QvmItemField, QvmItemTest, QvmWeaponActor, QvmWeaponStage } from "../../contracts/qvm-mod-items.ts";
import type { QvmModInputPointer, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import type { QvmCancellationScope, QvmFunctionCall, QvmSystemCallResult } from "./interpreter.ts";
import type { QvmModule } from "./module.ts";
import { QvmOpcode, type QvmImage } from "./image.ts";

interface Operations {
  readonly module: QvmModule;
  pointer(actor: ActorId, record: string): number;
  live(actor: ActorId): boolean;
  selected(actor: ActorId): boolean;
  invoke(actor: ActorId, call: QvmModSourceCall): number;
  attempted(actor: ActorId, value: number): void;
  accepted(actor: ActorId, value: number): void;
  completed(actor: ActorId): void;
  posture(actor: ActorId): { readonly bounds: Bounds; readonly viewHeight: number; readonly ground: number };
}
function proceed(call: QvmFunctionCall): QvmSystemCallResult { return call.execution === "synchronous" ? call.proceed() : call.proceedAsync(); }
function finish(result: QvmSystemCallResult, completed: (value: number) => number): QvmSystemCallResult {
  return typeof result === "number" ? completed(result) : result.then(completed);
}
function functionEnd(image: QvmImage, entry: number): number {
  if (image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("QVM weapon entry is not an original function");
  let end = entry + 1;
  while (end < image.instructions.length && image.instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
  return end;
}
export function validateQvmWeaponStage(stage: QvmWeaponStage, image: QvmImage): void {
  const end = functionEnd(image, stage.dispatcher.entry), seen = new Set<number>();
  for (const predicate of stage.predicates) {
    const instruction = image.instructions[predicate.instruction];
    if (predicate.instruction <= stage.dispatcher.entry || predicate.instruction >= end || seen.has(predicate.instruction)
      || instruction === undefined || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF)
      throw new Error("QVM weapon predicate is not a distinct conditional in its original dispatcher");
    seen.add(predicate.instruction);
  }
  functionEnd(image, stage.request.entry);
  if (stage.predicates.length === 0 || stage.settled.length === 0 || stage.request.accepted.length === 0
    || !Number.isSafeInteger(stage.request.argument) || stage.request.argument < 0 || stage.request.argument > 9)
    throw new Error("QVM weapon stage lacks its original decisions or settlement state");
  const continuation = stage.continuation, limit = functionEnd(image, continuation.entry), branch = image.instructions[continuation.instruction];
  if (continuation.when.length === 0) throw new Error("QVM weapon continuation lacks its source mode conditions");
  const decisions = new Set([continuation.instruction]);
  for (const predicate of continuation.predicates) {
    const instruction = image.instructions[predicate.instruction];
    if (predicate.instruction <= continuation.entry || predicate.instruction >= limit || decisions.has(predicate.instruction)
      || instruction === undefined || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF)
      throw new Error("QVM weapon continuation predicate is not a distinct original conditional");
    decisions.add(predicate.instruction);
  }
  if (continuation.instruction <= continuation.entry || continuation.instruction >= limit || branch === undefined
    || branch.opcode < QvmOpcode.OP_EQ || branch.opcode > QvmOpcode.OP_GEF || branch.operandWidth !== 4) throw new Error("QVM weapon continuation lacks an original conditional boundary");
  let pc = continuation.originalTaken ? continuation.instruction + 1 : branch.operand;
  const visited = new Set<number>();
  while (true) {
    if (pc <= continuation.entry || pc >= limit || visited.has(pc)) throw new Error("QVM weapon continuation does not take an original return edge");
    visited.add(pc);
    const instruction = image.instructions[pc];
    if (instruction?.opcode === QvmOpcode.OP_LEAVE) break;
    if (instruction?.opcode === QvmOpcode.OP_PUSH) { pc++; continue; }
    if (instruction?.opcode === QvmOpcode.OP_CONST && image.instructions[pc + 1]?.opcode === QvmOpcode.OP_JUMP) { pc = instruction.operand; continue; }
    throw new Error("QVM weapon continuation return edge has source side effects");
  }
  let previous = continuation.instruction;
  for (const { instruction, call } of continuation.calls) {
    const target = image.instructions[instruction - 1];
    if (instruction <= previous || instruction >= limit || image.instructions[instruction]?.opcode !== QvmOpcode.OP_CALL
      || target?.opcode !== QvmOpcode.OP_CONST || target.operand !== call.entry
      || call.arguments.length !== 0 || call.globals.length !== 0 || call.returns !== "void")
      throw new Error("QVM weapon continuation differs from its ordered original no-argument calls");
    functionEnd(image, call.entry); previous = instruction;
  }
  if (!continuation.calls.some(value => value.call.entry === stage.dispatcher.entry)) throw new Error("QVM continuation omits its original weapon dispatcher");
}

/** Original source setup and weapon code share the live caller's pmove and exact applied input. */
export class QvmModWeaponStage {
  private readonly applications: ModClientApplication[] = [];
  private readonly removals: (() => void)[] = [];
  private readonly dispatchers: { readonly actor: ActorId; readonly call: QvmFunctionCall }[] = [];
  private readonly inputs: { readonly actor: ActorId; cancellation: QvmCancellationScope | null; entered: boolean }[] = [];
  constructor(private readonly definition: QvmWeaponStage, inputEntry: number, private readonly operations: Operations) {
    const bind = (entry: number, hook: (call: QvmFunctionCall) => QvmSystemCallResult): void => {
      this.removals.push(operations.module.bindInvocation({ kind: "qvm", module: operations.module.profile.module, instructionIndex: entry }, hook));
    };
    try {
      bind(inputEntry, call => {
        const input = this.inputs.at(-1);
        if (input === undefined || input.entered) return proceed(call);
        input.entered = true; input.cancellation = call.cancellationScope();
        if (!this.operations.live(input.actor)) return call.cancelFunction(input.cancellation);
        return finish(proceed(call), value => { if (!this.operations.live(input.actor)) call.cancelFunction(input.cancellation ?? call.cancellationScope()); return value; });
      });
      bind(definition.continuation.entry, call => this.continue(call));
      bind(definition.dispatcher.entry, call => this.dispatch(call));
      bind(definition.request.entry, call => this.request(call));
    } catch (error) { this.close(); throw error; }
  }
  private address(pointer: QvmModInputPointer, call: QvmFunctionCall): number {
    let value = pointer.kind === "argument" ? call.words.getInt32(pointer.index * 4, true) : call.guest.dataView(pointer.address, 4).getInt32(0, true);
    for (const offset of pointer.indirections) value = call.guest.dataView(value + offset, 4).getInt32(0, true);
    return value + pointer.offset;
  }
  private actor(source: QvmWeaponActor, call: QvmFunctionCall): ActorId | null {
    const application = this.applications.at(-1), actor = application?.identity.actor;
    return actor !== undefined && this.operations.live(actor) && this.address(source.pointer, call) === this.operations.pointer(actor, source.record) ? actor : null;
  }
  open(application: ModClientApplication): () => void {
    this.applications.push(application);
    return () => { const index = this.applications.lastIndexOf(application); if (index !== -1) this.applications.splice(index, 1); };
  }
  apply(actor: ActorId, run: () => number): number {
    const input = { actor, cancellation: null, entered: false }; this.inputs.push(input);
    try { return run(); } finally { this.inputs.pop(); }
  }
  cancelRetired(actor: ActorId): void {
    if (this.operations.live(actor)) return;
    for (let index = this.inputs.length - 1; index >= 0; index--) {
      const input = this.inputs[index];
      if (input !== undefined && input.actor.equals(actor) && input.cancellation !== null) this.operations.module.cancelFunction(input.cancellation);
    }
  }
  private cancellation(actor: ActorId, call: QvmFunctionCall): QvmCancellationScope {
    for (let index = this.inputs.length - 1; index >= 0; index--) {
      const input = this.inputs[index]; if (input?.actor.equals(actor) && input.cancellation !== null) return input.cancellation;
    }
    return call.cancellationScope();
  }
  private scalar(actor: ActorId, field: QvmItemField): number {
    return this.operations.module.memory.dataView(this.operations.pointer(actor, field.record) + field.offset, 4).getInt32(0, true);
  }
  private test(actor: ActorId, test: QvmItemTest): boolean {
    const scalar = this.scalar(actor, test.field), value = test.mask === null ? scalar : scalar & test.mask;
    return test.comparison === "equals" ? value === test.value : value <= test.value;
  }
  settled(actor: ActorId): boolean { return this.operations.live(actor) && this.definition.settled.every(test => this.test(actor, test)); }
  active(actor: ActorId): ItemId | null {
    const selected = this.scalar(actor, this.definition.selection.field);
    if (selected === 0) return null;
    const value = this.definition.selection.values.find(value => value.value === selected);
    if (value === undefined) throw new Error("Original QVM selected an undeclared source weapon");
    return value.item;
  }
  private continue(call: QvmFunctionCall): QvmSystemCallResult {
    const actor = this.actor(this.definition.continuation.actor, call);
    if (actor === null) return proceed(call);
    const cancellation = this.cancellation(actor, call), movement = this.address(this.definition.continuation.projection.movement, call);
    let continued = false;
    call.branches([...this.definition.continuation.predicates.map(predicate => ({ instructionIndex: predicate.instruction, decide: (original: boolean, control: Pick<QvmFunctionCall, "cancelFunction">) => {
      if (!this.operations.live(actor)) control.cancelFunction(cancellation);
      return this.operations.selected(actor) ? original : predicate.unselected;
    } })), { instructionIndex: this.definition.continuation.instruction, decide: (original, control) => {
      if (!this.operations.live(actor)) control.cancelFunction(cancellation);
      if (original !== this.definition.continuation.originalTaken || !this.definition.continuation.when.every(test => this.test(actor, test))) return original;
      continued = true; return !original;
    } }]);
    return finish(proceed(call), result => {
      if (continued) {
        const projection = this.definition.continuation.projection, posture = this.operations.posture(actor);
        const vector = (offset: number, value: Bounds["min"]): void => {
          const view = this.operations.module.memory.dataView(movement + offset, 12);
          view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
        };
        vector(projection.minimum, posture.bounds.min); vector(projection.maximum, posture.bounds.max);
        this.operations.module.memory.dataView(this.operations.pointer(actor, projection.viewHeight.record) + projection.viewHeight.offset, 4).setInt32(0, posture.viewHeight, true);
        this.operations.module.memory.dataView(this.operations.pointer(actor, projection.ground.record) + projection.ground.offset, 4).setInt32(0, posture.ground, true);
        for (const value of this.definition.continuation.calls) {
          if (!this.operations.live(actor)) call.cancelFunction(cancellation);
          this.operations.invoke(actor, value.call);
        }
      }
      return result;
    });
  }
  private dispatch(call: QvmFunctionCall): QvmSystemCallResult {
    const actor = this.actor(this.definition.dispatcher.actor, call);
    if (actor === null) return proceed(call);
    const cancellation = this.cancellation(actor, call);
    const scope = { actor, call }; this.dispatchers.push(scope);
    const remove = (): void => { const index = this.dispatchers.lastIndexOf(scope); if (index !== -1) this.dispatchers.splice(index, 1); };
    call.branches(this.definition.predicates.map(predicate => ({ instructionIndex: predicate.instruction, decide: (original, control) => {
      if (!this.operations.live(actor)) control.cancelFunction(cancellation);
      return this.operations.selected(actor) ? original : predicate.unselected;
    } })));
    try {
      const result = finish(proceed(call), value => { if (this.operations.live(actor)) this.operations.completed(actor); return value; });
      if (typeof result !== "number") return result.finally(remove);
      remove(); return result;
    } catch (error) { remove(); throw error; }
  }
  private request(call: QvmFunctionCall): QvmSystemCallResult {
    const scope = this.dispatchers.at(-1);
    if (scope === undefined || !this.operations.live(scope.actor)) return proceed(call);
    const accepted = this.definition.request.accepted.every(test => this.test(scope.actor, test));
    const requested = call.words.getInt32(this.definition.request.argument * 4, true);
    if (!accepted) this.operations.attempted(scope.actor, requested);
    return finish(proceed(call), value => {
      if (!accepted && this.operations.live(scope.actor) && this.definition.request.accepted.every(test => this.test(scope.actor, test))) this.operations.accepted(scope.actor, requested);
      return value;
    });
  }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); this.applications.length = 0; this.dispatchers.length = 0; }
}
