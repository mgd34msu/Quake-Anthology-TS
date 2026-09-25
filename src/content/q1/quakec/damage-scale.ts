import type { ActorId } from "../../../contracts/identity.ts";
import type { ModQcDamageScale, ModSourceCall, ModCallbackInput, ModRuntimeValue } from "../../../contracts/mod-callbacks.ts";
import type { QcMachine, QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, signedQcBranch, type QcProgram } from "../../../compat/qc/program.ts";
import { validateQcSourceCall, withQcSourceCall } from "../../../compat/qc/source-call.ts";
import { qcDamageCallLayout } from "./damage-call.ts";
import { qcRegionPrivateWritesAreDead, qcStatementAccess } from "./armor-stage.ts";

export interface QcDamageScale {
  readonly kind: "multiplier" | "identity" | "transform";
  readonly region: QcInlineRegion;
  readonly scratch: readonly number[];
  readonly constants: readonly { readonly word: number; readonly bits: number }[];
  readonly call: ModSourceCall;
}
type Value = { readonly kind: "actor" } | { readonly kind: "scalar"; readonly constant?: number; readonly origins?: readonly number[] } | { readonly kind: "scaled"; readonly operations: number; readonly identity: boolean; readonly powersOfTwo: boolean };
const scalar: Value = { kind: "scalar" };
const words = (start: number, length = 1): number[] => Array.from({ length }, (_, index) => start + index);
const binary = new Set([QcOpcode.AddF, QcOpcode.SubF, QcOpcode.MulF, QcOpcode.DivF, QcOpcode.EqF, QcOpcode.NeF,
  QcOpcode.EqS, QcOpcode.NeS, QcOpcode.Le, QcOpcode.Ge, QcOpcode.Lt, QcOpcode.Gt, QcOpcode.And, QcOpcode.Or, QcOpcode.BitAnd, QcOpcode.BitOr]);

/** Qualify the exact pure attacker policy and its original suppression boundary. */
export function qcDamageScale(program: QcProgram, call: ModSourceCall, source: ModQcDamageScale | undefined): QcDamageScale | null {
  if (source === undefined) return null;
  const reject = (reason: string): never => { throw new QcProgramError(`Unsupported QC damage scale: ${reason}`, program.source); };
  const fn = program.functionNamed(source.function), end = program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, program.statements.length);
  if (source.function !== call.function || fn.firstStatement <= 0 || fn.namedBuiltin
    || !Number.isInteger(source.entry) || !Number.isInteger(source.exit) || source.entry < fn.firstStatement || source.exit <= source.entry || source.exit >= end)
    reject("original damage region bounds");
  const layout = qcDamageCallLayout(program, call), amount = layout.roles.amount;
  const location = amount[0];
  if (amount.length !== 1 || location === undefined) return reject("scale result requires one original float input");
  const damage = location.kind === "argument" ? location.frameWord : location.word, parameterEnd = fn.parameterStart + fn.parameterSizes.reduce((sum, size) => sum + size, 0);
  if (source.damage !== damage || fn.localWords < parameterEnd - fn.parameterStart) reject("original damage parameter");
  validateQcSourceCall(program, call, new Set(["self", "attacker", "inflictor", "amount", "time"]), "damage scale");
  const context = new Map<number, Value | null>();
  for (const global of call.globals) {
    const definition = program.globalsByName.get(global.name);
    if (definition === undefined) return reject("missing declared context global");
    const value = global.value;
    if (value.kind === "input") context.set(definition.offset, value.name === "attacker" ? { kind: "actor" }
      : value.name === "amount" ? { kind: "scaled", operations: 0, identity: true, powersOfTwo: true } : value.name === "time" ? scalar : null);
    else if (value.kind === "float") context.set(definition.offset, { kind: "scalar", constant: Math.fround(value.value) });
    else for (const word of words(definition.offset, definition.type === "vector" ? 3 : 1)) context.set(word, scalar);
  }
  const prefixWrites = new Set<number>();
  const amountInputs = new Set([damage, ...[...context].filter(([, value]) => value?.kind === "scaled").map(([word]) => word)]);
  for (const statement of program.statements.slice(fn.firstStatement, source.entry)) {
    const { opcode } = statement, access = qcStatementAccess(statement);
    if (access.read.some(word => amountInputs.has(word))) reject("damage-dependent policy precedes the scaling region");
    if (opcode >= QcOpcode.StorePF && opcode <= QcOpcode.StorePFn || opcode >= QcOpcode.Call0 && opcode <= QcOpcode.Call8 || opcode === QcOpcode.State)
      reject("source side effects precede the scale query");
    if (!(opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn && statement.a === statement.b))
      for (const word of access.write) prefixWrites.add(word);
  }
  if (prefixWrites.has(damage) || layout.roles.attacker.some(location => prefixWrites.has(location.kind === "argument" ? location.frameWord : location.word))) reject("source changes scale arguments before the region");
  if (source.statements.length !== source.exit - source.entry + 1) reject("incomplete original instructions");
  for (const [offset, expected] of source.statements.entries()) {
    const actual = program.statements[source.entry + offset];
    if (actual === undefined || actual.opcode !== expected.opcode || actual.a !== expected.a || actual.b !== expected.b || actual.c !== expected.c) reject("instructions differ from artifact");
  }
  const named = new Set(program.globals.filter(global => global.name !== "").flatMap(global => words(global.offset, global.type === "vector" ? 3 : 1)));
  const mutable = new Set<number>();
  for (const statement of program.statements) for (const word of qcStatementAccess(statement).write) mutable.add(word);
  const initial = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength), scratch = new Set<number>(), constants = new Set<number>();
  const merge = (left: Value, right: Value): Value => {
    if (left.kind !== right.kind) {
      if (source.kind === "transform" && left.kind !== "actor" && right.kind !== "actor") return { kind: "scaled", operations: 0, identity: false, powersOfTwo: false };
      return reject("control flow replaces damage with an independent value");
    }
    if (left.kind === "actor" && right.kind === "actor") return left;
    if (left.kind === "scalar" && right.kind === "scalar") return left.constant === right.constant ? { ...left,
      ...((left.origins?.length ?? 0) + (right.origins?.length ?? 0) === 0 ? {} : { origins: [...(left.origins ?? []), ...(right.origins ?? [])] }) } : scalar;
    if (left.kind === "scaled" && right.kind === "scaled") return { kind: "scaled", operations: Math.max(left.operations, right.operations), identity: left.identity && right.identity, powersOfTwo: left.powersOfTwo && right.powersOfTwo };
    return reject("inconsistent source value");
  };
  const initialValues = new Map<number, Value>([[damage, { kind: "scaled", operations: 0, identity: true, powersOfTwo: true }]]);
  for (const location of layout.roles.attacker) if (location.kind === "argument") initialValues.set(location.frameWord, { kind: "actor" });
  const pending = new Map<number, Map<number, Value>>([[source.entry, initialValues]]);
  const edge = (from: number, to: number, values: ReadonlyMap<number, Value>): void => {
    if (to <= from || to < source.entry || to > source.exit) reject("escaping or backward branch");
    const previous = pending.get(to);
    pending.set(to, previous === undefined ? new Map(values) : new Map([...previous].flatMap(([word, value]) => {
      const next = values.get(word); return next === undefined ? [] : [[word, merge(value, next)]];
    })));
  };
  let joined = false, multiplied = false;
  while (pending.size !== 0) {
    const pc = Math.min(...pending.keys()), values = pending.get(pc); pending.delete(pc);
    if (values === undefined) return reject("missing source path");
    if (pc === source.exit) {
      const result = values.get(damage);
      if (result === undefined || result.kind === "actor" || source.kind !== "transform" && result.kind !== "scaled") return reject("join does not retain scalar damage");
      if (source.kind === "identity" && (result.kind !== "scaled" || !result.identity)) reject("identity region changes its original damage input");
      joined = true; continue;
    }
    const statement = program.statements[pc]; if (statement === undefined) return reject("missing source instruction");
    const { opcode, a, b, c } = statement;
    const read = (word: number): Value => {
      const value = values.get(word); if (value !== undefined) return value;
      if (!Number.isInteger(word) || word < 28 || word * 4 + 4 > initial.byteLength) return reject("unavailable original word");
      if (word >= fn.parameterStart && word < fn.parameterStart + fn.localWords || !named.has(word) && mutable.has(word)) return reject("undeclared local or target/inflictor dependency");
      const supplied = context.get(word);
      if (supplied === null) return reject("non-attacker declared entity context");
      if (supplied !== undefined) return supplied;
      if (prefixWrites.has(word)) return reject("unexecuted source context assignment");
      if (program.globalsByName.get("time")?.offset === word) return reject("current source time must be declared");
      if (program.globals.some(global => global.offset === word && global.type === "entity")) return reject("non-attacker entity context");
      return mutable.has(word) ? scalar : { kind: "scalar", constant: initial.getFloat32(word * 4, true), origins: [word] };
    };
    const independent = (word: number): Value => { const value = read(word); if (value.kind === "scaled") return reject("nonlinear damage-dependent predicate or address"); return value; };
    const write = (word: number, value: Value): void => {
      if (!Number.isInteger(word) || word < 28 || word * 4 + 4 > initial.byteLength
        || word !== damage && (word >= fn.parameterStart && word < parameterEnd || named.has(word) && !(word >= parameterEnd && word < fn.parameterStart + fn.localWords))) reject("source write outside private frame");
      if (word === damage && (value.kind === "actor" || source.kind !== "transform" && value.kind !== "scaled")) reject("damage overwritten by independent value");
      scratch.add(word); values.set(word, value);
    };
    if (opcode === QcOpcode.If || opcode === QcOpcode.IfNot) { if (source.kind === "transform") read(a); else independent(a); edge(pc, pc + signedQcBranch(b), values); }
    else if (opcode === QcOpcode.Goto) { edge(pc, pc + signedQcBranch(a), values); continue; }
    else if (opcode === QcOpcode.LoadF || opcode === QcOpcode.LoadS) {
      if (read(a).kind !== "actor") reject("entity reads must belong to the original attacker");
      independent(b); write(c, scalar);
    }
    else if (opcode === QcOpcode.StoreF || opcode === QcOpcode.StoreEnt || opcode === QcOpcode.StoreS) write(b, read(a));
    else if (opcode === QcOpcode.NotF || opcode === QcOpcode.NotS || opcode === QcOpcode.NotEnt) { const value = source.kind === "transform" ? read(a) : independent(a); write(c, value.kind === "scaled" ? { ...value, identity: false } : scalar); }
    else if (binary.has(opcode)) {
      const left = read(a), right = read(b);
      if (source.kind === "transform") {
        if (left.kind === "actor" || right.kind === "actor") reject("damage arithmetic cannot consume entity references");
        write(c, left.kind === "scaled" || right.kind === "scaled" ? { kind: "scaled", operations: 0, identity: false, powersOfTwo: false } : scalar);
      } else if (left.kind !== "scaled" && right.kind !== "scaled") write(c, scalar);
      else {
        const scaled = left.kind === "scaled" ? left : right, factor = left.kind === "scalar" ? left : right;
        if (scaled.kind !== "scaled" || factor.kind !== "scalar" || opcode !== QcOpcode.MulF && opcode !== QcOpcode.DivF || opcode === QcOpcode.DivF && left.kind !== "scaled")
          return reject("nonmultiplicative damage transformation");
        const power = factor.constant !== undefined && factor.constant > 0 && Number.isInteger(Math.log2(factor.constant));
        if (opcode === QcOpcode.DivF && !power) reject("division requires an exactly representable reciprocal");
        if (power) for (const word of factor.origins ?? []) constants.add(word);
        const increasing = power && factor.constant !== undefined && (opcode === QcOpcode.DivF ? factor.constant <= 1 : factor.constant >= 1);
        if (scaled.operations > 0 && !(scaled.powersOfTwo && increasing)) reject("multiple rounded scales cannot be represented by one factor");
        multiplied = true; write(c, { kind: "scaled", operations: scaled.operations + 1, identity: scaled.identity && factor.constant === 1, powersOfTwo: scaled.powersOfTwo && increasing });
      }
    } else return reject("region must contain only source reads and scalar frame operations");
    edge(pc, pc + 1, values);
  }
  if (!joined || source.kind !== "identity" && source.kind !== "transform" && !multiplied) reject("region has no original multiplicative result");
  for (let pc = fn.firstStatement; pc < end; pc++) {
    if (pc >= source.entry && pc < source.exit) continue;
    const statement = program.statements[pc]; if (statement === undefined) continue;
    const destination = statement.opcode === QcOpcode.Goto ? pc + signedQcBranch(statement.a)
      : statement.opcode === QcOpcode.If || statement.opcode === QcOpcode.IfNot ? pc + signedQcBranch(statement.b) : -1;
    if (destination > source.entry && destination < source.exit) reject("incoming interior branch");
    if (pc < source.entry && destination >= source.exit) reject("source path bypasses scaling before continuing damage");
    if (pc >= source.exit && destination >= fn.firstStatement && destination <= source.entry) reject("source path repeats scaling");
  }
  const privateWrites = new Set(scratch); privateWrites.delete(damage);
  if (!qcRegionPrivateWritesAreDead(program, source.exit, end, privateWrites)) reject("private scale outputs remain live after suppression");
  return Object.freeze({ kind: source.kind ?? "multiplier", call, scratch: Object.freeze([...scratch]), constants: Object.freeze([...constants].map(word => Object.freeze({ word, bits: initial.getInt32(word * 4, true) }))), region: Object.freeze({ functionIndex: fn.index, entry: source.entry, exit: source.exit,
    replaceable: true, standalone: Object.freeze(location.kind === "argument" ? { saved: damage } : { saved: damage, scope: "global" }) }) });
}

/** Borrow only the qualified original frame and scratch words, restoring them before returning. */
export function evaluateQcDamageScale(machine: QcMachine, scale: QcDamageScale, owner: ActorId, actorReference: number, seconds: number): number {
  if (scale.kind === "transform") throw new QcProgramError("Original QC amount transform cannot be queried as a multiplier");
  return evaluateQcDamageAmount(machine, scale, owner, actorReference, seconds, 1);
}

export function evaluateQcDamageAmount(machine: QcMachine, scale: QcDamageScale, owner: ActorId, actorReference: number, seconds: number, amount: number): number {
  const actor = { kind: "actor", value: owner } satisfies ModRuntimeValue;
  const inputs = new Map<ModCallbackInput, ModRuntimeValue>([["self", actor], ["attacker", actor], ["inflictor", actor],
    ["amount", { kind: "float", value: amount }], ["time", { kind: "float", value: seconds }]]);
  for (const { word, bits } of scale.constants) if (machine.globals.int(word) !== bits)
    throw new QcProgramError("Original QC scaling constant changed after qualification");
  const scratch = scale.scratch.map(word => ({ word, value: machine.globals.int(word) }));
  try {
    const result = withQcSourceCall(machine, scale.call, inputs, actor => {
      if (actor === null) return machine.entities.reference(0);
      if (!actor.equals(owner)) throw new QcProgramError("QC damage scale changed its source attacker");
      return actorReference;
    }, count => machine.executeRegion(scale.region, count));
    if (!Number.isFinite(result) || result < 0) throw new QcProgramError("Original QC damage amount is not finite and nonnegative");
    return result;
  } finally { for (const { word, value } of scratch) machine.globals.setInt(word, value); }
}
