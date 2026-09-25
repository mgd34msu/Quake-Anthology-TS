import { QVM_MAX_PRIVATE_ARGUMENT_WORDS } from "./image.ts";
import type { QvmModActorFrame as Declaration } from "../../contracts/qvm-mod-actor-frame.ts";
import type { QvmModActorRecord } from "../../contracts/qvm-mod-callbacks.ts";
import { QvmOpcode, type QvmImage } from "./image.ts";
import type { QvmModule } from "./module.ts";
import type { QvmFunctionCall } from "./interpreter.ts";

export function qvmActorBootstrap(stores: readonly number[], image: QvmImage, records: readonly QvmModActorRecord[]): readonly { readonly address: number; readonly value: number }[] {
  const destinations = new Set<number>();
  return stores.map(pc => {
    const store = image.instructions[pc], address = image.instructions[pc - 2], value = image.instructions[pc - 1];
    if (!Number.isSafeInteger(pc) || store?.opcode !== QvmOpcode.OP_STORE4 || address?.opcode !== QvmOpcode.OP_CONST || value?.opcode !== QvmOpcode.OP_CONST)
      throw new Error("QVM source bootstrap is not an original constant store");
    const offset = address.operand, end = image.initializedData.length + image.bssLength;
    if (offset < 0 || offset % 4 !== 0 || offset + 4 > end || offset < image.initializedData.length && offset + 4 > image.dataLength
      || destinations.has(offset) || records.some(record => offset < record.address + record.stride * record.capacity && offset + 4 > record.address))
      throw new Error("QVM source bootstrap overlaps projected or nonwritable storage");
    destinations.add(offset); return { address: offset, value: value.operand };
  });
}

export function validateQvmModActorFrame(definition: Declaration, image: QvmImage, record: QvmModActorRecord, inuse: number): void {
  const entry = definition.call.entry, enter = image.instructions[entry];
  if (enter?.opcode !== QvmOpcode.OP_ENTER || definition.call.returns !== "void" || definition.owned.length === 0)
    throw new Error("QVM actor frame requires its original void caller and entity loops");
  let end = entry + 1; while (end < image.instructions.length && image.instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
  const decisions = new Set<number>();
  const branch = (pc: number): void => {
    const instruction = image.instructions[pc];
    if (!Number.isSafeInteger(pc) || pc <= entry || pc >= end || decisions.has(pc) || instruction === undefined
      || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF) throw new Error("QVM actor frame predicate is not a distinct original conditional");
    decisions.add(pc);
  };
  branch(definition.end.instruction);
  for (const filter of definition.owned) {
    branch(filter.instruction);
    const local = image.instructions[filter.localInstruction], offset = image.instructions[filter.localInstruction + 2], zero = image.instructions[filter.localInstruction + 5];
    if (filter.localInstruction !== filter.instruction - 6 || local?.opcode !== QvmOpcode.OP_LOCAL || local.operand < 8 || local.operand + 4 > enter.operand
      || image.instructions[filter.localInstruction + 1]?.opcode !== QvmOpcode.OP_LOAD4 || offset?.opcode !== QvmOpcode.OP_CONST || offset.operand !== inuse
      || image.instructions[filter.localInstruction + 3]?.opcode !== QvmOpcode.OP_ADD || image.instructions[filter.localInstruction + 4]?.opcode !== QvmOpcode.OP_LOAD4
      || zero?.opcode !== QvmOpcode.OP_CONST || zero.operand !== 0
      || image.instructions[filter.instruction]?.opcode !== QvmOpcode.OP_NE || inuse + 4 > record.stride)
      throw new Error("QVM actor frame filter differs from its original local entity/in-use predicate");
  }
  const clock = definition.clock, argument = definition.call.arguments[clock.argument], address = image.instructions[clock.store - 3], local = image.instructions[clock.store - 2];
  if (!Number.isInteger(clock.argument) || clock.argument < 0 || clock.argument >= QVM_MAX_PRIVATE_ARGUMENT_WORDS || argument?.kind !== "time" || argument.input !== "time"
    || argument.units !== "milliseconds" || argument.encoding !== "int32" || !Number.isInteger(clock.address) || clock.address < 0 || clock.address % 4 !== 0
    || clock.address + 4 > image.initializedData.length + image.bssLength || clock.store <= entry || clock.store >= end
    || address?.opcode !== QvmOpcode.OP_CONST || address.operand !== clock.address || local?.opcode !== QvmOpcode.OP_LOCAL || local.operand !== enter.operand + 8 + clock.argument * 4
    || image.instructions[clock.store - 1]?.opcode !== QvmOpcode.OP_LOAD4 || image.instructions[clock.store]?.opcode !== QvmOpcode.OP_STORE4
    || definition.call.globals.some(global => global.address === clock.address)) throw new Error("QVM actor frame clock differs from its original argument store");
}

/** Caller-scoped input globals unwind before this original frame reads its saved source clock. */
export class QvmModActorFrame {
  private active: { completed: boolean } | null = null;
  private readonly remove: () => void;
  constructor(definition: Declaration, module: QvmModule, image: QvmImage,
    private readonly owned: (pointer: number) => boolean) {
    const enter = image.instructions[definition.call.entry];
    if (enter?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Missing original actor frame");
    const locals = definition.owned.map(filter => {
      const local = image.instructions[filter.localInstruction];
      if (local?.opcode !== QvmOpcode.OP_LOCAL) throw new Error("Missing original actor loop local");
      return { ...filter, offset: local.operand };
    });
    this.remove = module.bindInvocation({ kind: "qvm", module: module.profile.module, instructionIndex: definition.call.entry }, call => {
      const active = this.active;
      if (active === null) return this.proceed(call);
      const cancellation = call.cancellationScope();
      // Both interpreter paths expose the same original caller OP_ARG words at source stack + 8.
      const stack = call.words.byteOffset - call.memory.byteOffset - 8 - enter.operand;
      call.branches([...locals.map(filter => ({ instructionIndex: filter.instruction, decide: (taken: boolean) =>
        taken && this.owned(call.guest.dataView(stack + filter.offset, 4).getInt32(0, true)) })),
      { instructionIndex: definition.end.instruction, decide: (taken, control) => {
        if (taken === definition.end.completedTaken) { active.completed = true; control.cancelFunction(cancellation); }
        return taken;
      } }]);
      return this.proceed(call);
    });
  }
  private proceed(call: QvmFunctionCall) { return call.execution === "synchronous" ? call.proceed() : call.proceedAsync(); }
  run(invoke: () => void): boolean {
    if (this.active !== null) throw new Error("QVM actor frame is already executing");
    const active = { completed: false }; this.active = active;
    try { invoke(); return active.completed; }
    finally { this.active = null; }
  }
  close(): void { this.remove(); }
}
