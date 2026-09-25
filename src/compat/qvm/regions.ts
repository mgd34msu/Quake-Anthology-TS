import { QvmOpcode, type QvmImage } from "./image.ts";

export interface QvmRegionEvaluation {
  readonly entry: number;
  readonly join: number;
  readonly inputs: readonly number[];
  readonly result: number | null;
}

type Operand = { readonly kind: "local"; readonly offset: number } | { readonly kind: "local-derived" } | { readonly kind: "constant"; readonly value: number } | { readonly kind: "unknown" };
interface Path { readonly pc: number; readonly stack: readonly Operand[]; readonly initialized: ReadonlySet<number>; }
const unknown: Operand = { kind: "unknown" };
const localDerived: Operand = { kind: "local-derived" };
function local(value: Operand | undefined): boolean { return value?.kind === "local" || value?.kind === "local-derived"; }

/** Check scalar live-ins of a standalone source frame; arguments retain their original caller ABI. */
export function qualifyQvmRegionEvaluation(instructions: QvmImage["instructions"], owner: number, region: QvmRegionEvaluation): number {
  const frame = qualifyQvmRegion(instructions, owner, region.entry, region.join);
  const valid = (offset: number): boolean => Number.isSafeInteger(offset) && offset >= 8 && offset % 4 === 0 && offset + 4 <= frame;
  if (region.inputs.some(offset => !valid(offset)) || new Set(region.inputs).size !== region.inputs.length || region.result !== null && !valid(region.result))
    throw new Error("QVM region live-in or result is outside its source frame");
  const pending = new Map<number, Path>();
  pending.set(region.entry, { pc: region.entry, stack: [], initialized: new Set(region.inputs) });
  const add = (pc: number, stack: readonly Operand[], initialized: ReadonlySet<number>): void => {
    const previous = pending.get(pc);
    pending.set(pc, previous === undefined ? { pc, stack, initialized } : { pc,
      stack: stack.map((value, index) => { const before = previous.stack[index];
        return value.kind === "local" && before?.kind === "local" && before.offset === value.offset || value.kind === "constant" && before?.kind === "constant" && before.value === value.value ? value : local(value) || local(before) ? localDerived : unknown;
      }), initialized: new Set([...initialized].filter(offset => previous.initialized.has(offset))) });
  };
  while (pending.size !== 0) {
    const pc = Math.min(...pending.keys()), path = pending.get(pc); pending.delete(pc);
    if (path === undefined) throw new Error("Missing QVM region input path");
    if (pc === region.join) {
      if (region.result !== null && !path.initialized.has(region.result)) throw new Error("QVM region result is not initialized on every source path");
      continue;
    }
    const instruction = instructions[pc]; if (instruction === undefined) throw new Error("Missing QVM region instruction");
    const stack = [...path.stack], initialized = new Set(path.initialized), opcode = instruction.opcode;
    const pop = (): Operand => { const value = stack.pop(); if (value === undefined) throw new Error("Invalid QVM region operand proof"); return value; };
    if (opcode === QvmOpcode.OP_LOCAL) {
      if (instruction.operand < 8 || instruction.operand % 4 !== 0 || instruction.operand + 4 > frame + 48) throw new Error("QVM region local address exceeds its source frame and arguments");
      stack.push({ kind: "local", offset: instruction.operand });
    }
    else if (opcode === QvmOpcode.OP_CONST) stack.push({ kind: "constant", value: instruction.operand });
    else if (opcode === QvmOpcode.OP_PUSH) stack.push(unknown);
    else if (opcode === QvmOpcode.OP_POP || opcode === QvmOpcode.OP_ARG) {
      pop(); if (opcode === QvmOpcode.OP_ARG) initialized.add(instruction.operand);
    } else if (opcode >= QvmOpcode.OP_LOAD1 && opcode <= QvmOpcode.OP_LOAD4) {
      const address = pop();
      if (address.kind === "local-derived") throw new Error("QVM region reads an unresolved source local address");
      if (address.kind === "local" && address.offset < frame && !initialized.has(address.offset)) throw new Error(`QVM region reads undeclared source local ${address.offset}`);
      stack.push(unknown);
    } else if (opcode >= QvmOpcode.OP_STORE1 && opcode <= QvmOpcode.OP_STORE4) {
      if (local(pop())) throw new Error("QVM region stores an escaping source local pointer");
      const address = pop(); if (address.kind === "local" && opcode === QvmOpcode.OP_STORE4) initialized.add(address.offset);
    } else if (opcode === QvmOpcode.OP_BLOCK_COPY) {
      const source = pop(); if (source.kind === "local-derived") throw new Error("QVM region copies an unresolved source local address");
      if (source.kind === "local") for (let offset = 0; offset < instruction.operand; offset += 4)
        if (!initialized.has(source.offset + offset)) throw new Error("QVM region copies an undeclared source local");
      const address = pop();
      if (address.kind === "local") for (let offset = 0; offset + 4 <= instruction.operand; offset += 4) initialized.add(address.offset + offset);
    } else if (opcode === QvmOpcode.OP_JUMP) {
      const destination = pop(); if (destination.kind !== "constant") throw new Error("QVM region jump lost its source target");
      add(destination.value, stack, initialized); continue;
    } else if (opcode >= QvmOpcode.OP_EQ && opcode <= QvmOpcode.OP_GEF && instruction.operandWidth === 4) {
      pop(); pop(); add(instruction.operand, stack, initialized);
    } else if (opcode === QvmOpcode.OP_CALL) { pop(); stack.push(unknown); }
    else if (opcode >= QvmOpcode.OP_ADD && opcode <= QvmOpcode.OP_RSHU && opcode !== QvmOpcode.OP_BCOM || opcode >= QvmOpcode.OP_ADDF && opcode <= QvmOpcode.OP_MULF) {
      const right = pop(), left = pop();
      stack.push((opcode === QvmOpcode.OP_ADD || opcode === QvmOpcode.OP_SUB) && left.kind === "local" && right.kind === "constant"
        ? { kind: "local", offset: left.offset + (opcode === QvmOpcode.OP_ADD ? right.value : -right.value) } : local(left) || local(right) ? localDerived : unknown);
    } else if (opcode !== QvmOpcode.OP_IGNORE && opcode !== QvmOpcode.OP_BREAK) { const value = pop(); stack.push(local(value) ? localDerived : unknown); }
    add(pc + 1, stack, initialized);
  }
  return frame;
}

/** Qualify a forward original region with no escaping edge or live operand at either boundary. */
export function qualifyQvmRegion(instructions: QvmImage["instructions"], owner: number, entry: number, join: number): number {
  const first = instructions[owner];
  if (first?.opcode !== QvmOpcode.OP_ENTER) throw new Error("QVM region owner is not a function");
  let end = owner + 1;
  while (end < instructions.length && instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
  if (!Number.isSafeInteger(entry) || !Number.isSafeInteger(join) || entry <= owner || join <= entry || join >= end)
    throw new Error("QVM region is outside its owning function");
  const depth = new Map<number, number>(), pending: { readonly pc: number; readonly depth: number }[] = [{ pc: entry, depth: 0 }];
  let joined = false;
  const edge = (from: number, target: number, count: number): void => {
    if (target <= from || target > join) throw new Error("QVM region has an escaping or backward edge");
    pending.push({ pc: target, depth: count });
  };
  while (pending.length !== 0) {
    const next = pending.pop(); if (next === undefined) throw new Error("Missing QVM region path");
    const known = depth.get(next.pc);
    if (known !== undefined) { if (known !== next.depth) throw new Error("QVM region paths disagree on operand depth"); continue; }
    depth.set(next.pc, next.depth);
    if (next.pc === join) { if (next.depth !== 0) throw new Error("QVM region join retains live operands"); joined = true; continue; }
    const instruction = instructions[next.pc];
    if (instruction === undefined) throw new Error("QVM region has no original instruction");
    const opcode = instruction.opcode;
    let required = 0, change = 0;
    if (opcode === QvmOpcode.OP_CONST || opcode === QvmOpcode.OP_LOCAL || opcode === QvmOpcode.OP_PUSH) change = 1;
    else if (opcode === QvmOpcode.OP_POP || opcode === QvmOpcode.OP_ARG || opcode === QvmOpcode.OP_JUMP) { required = 1; change = -1; }
    else if (opcode === QvmOpcode.OP_STORE1 || opcode === QvmOpcode.OP_STORE2 || opcode === QvmOpcode.OP_STORE4 || opcode === QvmOpcode.OP_BLOCK_COPY) { required = 2; change = -2; }
    else if (opcode >= QvmOpcode.OP_EQ && opcode <= QvmOpcode.OP_GEF) { required = 2; change = -2; }
    else if (opcode >= QvmOpcode.OP_ADD && opcode <= QvmOpcode.OP_RSHU || opcode >= QvmOpcode.OP_ADDF && opcode <= QvmOpcode.OP_MULF) {
      required = opcode === QvmOpcode.OP_BCOM ? 1 : 2; change = opcode === QvmOpcode.OP_BCOM ? 0 : -1;
    } else if (opcode === QvmOpcode.OP_CALL || opcode >= QvmOpcode.OP_LOAD1 && opcode <= QvmOpcode.OP_LOAD4
      || opcode >= QvmOpcode.OP_SEX8 && opcode <= QvmOpcode.OP_NEGI || opcode === QvmOpcode.OP_NEGF
      || opcode === QvmOpcode.OP_CVIF || opcode === QvmOpcode.OP_CVFI) required = 1;
    else if (opcode !== QvmOpcode.OP_IGNORE && opcode !== QvmOpcode.OP_BREAK) throw new Error("QVM region contains a frame or unsupported instruction");
    if (next.depth < required) throw new Error("QVM region requires operands from outside its boundary");
    const result = next.depth + change;
    if (opcode === QvmOpcode.OP_JUMP) {
      const target = instructions[next.pc - 1];
      if (target?.opcode !== QvmOpcode.OP_CONST) throw new Error("QVM region has an indirect jump");
      edge(next.pc, target.operand, result);
    } else {
      edge(next.pc, next.pc + 1, result);
      if (opcode >= QvmOpcode.OP_EQ && opcode <= QvmOpcode.OP_GEF && instruction.operandWidth === 4) edge(next.pc, instruction.operand, result);
    }
  }
  if (!joined) throw new Error("QVM region does not reach its original join");
  for (let pc = owner + 1; pc < end; pc++) {
    if (pc >= entry && pc < join) continue;
    const instruction = instructions[pc];
    const target = instruction !== undefined && instruction.opcode >= QvmOpcode.OP_EQ && instruction.opcode <= QvmOpcode.OP_GEF && instruction.operandWidth === 4
      ? instruction.operand : instruction?.opcode === QvmOpcode.OP_JUMP && instructions[pc - 1]?.opcode === QvmOpcode.OP_CONST ? instructions[pc - 1] : null;
    const destination = typeof target === "number" ? target : target?.opcode === QvmOpcode.OP_CONST ? target.operand : null;
    if (destination !== null && destination > entry && destination < join) throw new Error("QVM region has an incoming interior edge");
  }
  return first.operand;
}
