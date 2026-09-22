/* Quake pr_exec.c, id Software. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import { QcEntityMemory, QcStrings, QcWords } from "./memory.ts";
import { QcOpcode, QcProgramError, signedQcBranch } from "./program.ts";
import type { QcFunction, QcProgram } from "./program.ts";

export type QcBuiltin = (machine: QcMachine) => undefined;
export interface QcBuiltinRegistry {
  readonly numbered: ReadonlyMap<number, QcBuiltin>;
  readonly named: ReadonlyMap<string, QcBuiltin>;
}
export interface QcEntityStoreObservation {
  readonly functionIndex: number;
  readonly statement: number;
  readonly reference: number;
  readonly word: number;
  readonly before: Uint8Array;
  readonly after: Uint8Array;
}
export interface QcCallSite { readonly functionIndex: number; readonly caller: number; readonly statement: number; }
export interface QcFunctionExecution {
  (prepare?: (machine: QcMachine) => undefined): undefined;
  skip(returnWords: readonly [number, number, number]): undefined;
  cancel(returnWords: readonly [number, number, number]): never;
}
export interface QcInlineRegion { readonly functionIndex: number; readonly entry: number; readonly exit: number; }
export interface QcInlineBoundary {
  readonly regions: readonly QcInlineRegion[];
  run(region: QcInlineRegion, execute: () => undefined): undefined;
}
export interface QcFunctionBoundary {
  readonly functions: ReadonlySet<number>;
  run(call: QcCallSite, execute: QcFunctionExecution): undefined;
}
export interface QcMachineOptions {
  readonly program: QcProgram;
  readonly numeric: NumericOperations;
  readonly entities: QcEntityMemory;
  readonly builtins: QcBuiltinRegistry;
  readonly serverActive: () => boolean;
  readonly statementLimit?: number;
  readonly stackLimit?: number;
  readonly localStackWords?: number;
  readonly trace?: (machine: QcMachine) => undefined;
  readonly observeCall?: (call: QcCallSite) => undefined;
  readonly functionBoundary?: QcFunctionBoundary;
  readonly inlineBoundary?: QcInlineBoundary;
  readonly observeEntityStore?: (store: QcEntityStoreObservation) => undefined;
  readonly validateEntityAccess?: (reference: number, word: number, words: 1 | 3, kind: "read" | "write") => undefined;
}
export interface QcMachineSnapshot {
  readonly globals: Uint8Array;
  readonly entities: Uint8Array;
  readonly entityCount: number;
  readonly strings: Uint8Array;
  readonly statement: number;
  readonly functionIndex: number;
  readonly argumentCount: number;
  readonly profiling: readonly number[];
  readonly traceEnabled: boolean;
}
interface CallStaging { readonly words: Uint8Array; readonly argumentCount: number; }
interface Frame { readonly statement: number; readonly functionIndex: number; readonly locals: Uint8Array; }
class QcFunctionCancellation {
  constructor(readonly owner: object, readonly words: readonly [number, number, number]) {}
}
export class QcRuntimeError extends Error {
  constructor(message: string, readonly statement: number, readonly functionIndex: number, readonly callStack: readonly { readonly functionIndex: number; readonly statement: number }[]) {
    super(`QuakeC ${functionIndex}:${statement}: ${message}`);
    this.name = "QcRuntimeError";
  }
}
/** One instance per module. Builtins may synchronously re-enter this same machine. */
export class QcMachine {
  readonly program: QcProgram;
  readonly globals: QcWords;
  readonly strings: QcStrings;
  readonly entities: QcEntityMemory;
  readonly numeric: NumericOperations;
  readonly profiling: number[];
  private readonly frames: Frame[] = [];
  private readonly statementLimit: number;
  private readonly stackLimit: number;
  private readonly localStackLimit: number;
  private localWords = 0;
  private functionIndex = 0;
  private statement = 0;
  private argumentCount = 0;
  private builtinDepth = 0;
  private boundaryDepth = 0;
  private readonly boundaryFunctions: ReadonlySet<number>;
  private readonly inlineRegions = new Map<number, QcInlineRegion>();
  traceEnabled = false;
  constructor(private readonly options: QcMachineOptions) {
    this.program = options.program; this.entities = options.entities; this.numeric = options.numeric;
    if (this.entities.layout.fieldWords !== this.program.entityFieldWords) throw new QcProgramError("entity field layout disagrees with program");
    this.globals = new QcWords(this.program.initialGlobals.slice());
    this.strings = new QcStrings(this.program.strings, this.program.api.kind === "q1-quakeworld");
    this.profiling = this.program.functions.map(() => 0);
    this.boundaryFunctions = new Set(options.functionBoundary?.functions);
    for (const index of this.boundaryFunctions) {
      const fn = this.program.functionAt(index);
      if (fn.namedBuiltin || fn.firstStatement < 0) throw new QcProgramError("function boundary requires an interpreted function");
    }
    for (const region of options.inlineBoundary?.regions ?? []) {
      const fn = this.program.functionAt(region.functionIndex);
      const end = this.program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, this.program.statements.length);
      if (fn.namedBuiltin || fn.firstStatement <= 0 || !Number.isInteger(region.entry) || !Number.isInteger(region.exit)
        || region.entry < fn.firstStatement || region.exit <= region.entry || region.exit >= end || this.inlineRegions.has(region.entry))
        throw new QcProgramError("invalid inline source region");
      this.inlineRegions.set(region.entry, Object.freeze({ ...region }));
    }
    this.statementLimit = options.statementLimit ?? 100000;
    this.stackLimit = options.stackLimit ?? 32;
    this.localStackLimit = options.localStackWords ?? 2048;
    if (![this.statementLimit, this.stackLimit, this.localStackLimit].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError("Invalid QuakeC execution limits");
  }
  get argc(): number { return this.argumentCount; }
  get currentStatement(): number { return this.statement; }
  get currentFunction(): number { return this.functionIndex; }
  get depth(): number { return this.frames.length; }
  fail(message: string): never {
    throw new QcRuntimeError(message, this.statement, this.functionIndex, this.frames.map(frame => ({ functionIndex: frame.functionIndex, statement: frame.statement })));
  }
  globalOffset(name: string): number {
    const definition = this.program.globalsByName.get(name);
    if (definition === undefined) return this.fail(`missing global ${name}`);
    return definition.offset;
  }
  fieldOffset(name: string): number {
    const definition = this.program.fieldsByName.get(name);
    if (definition === undefined) return this.fail(`missing entity field ${name}`);
    return definition.offset;
  }
  entityFloat(reference: number, field: string): number { return this.entityFields(reference, field, 1).float(this.fieldOffset(field)); }
  entityInt(reference: number, field: string): number { return this.entityFields(reference, field, 1).int(this.fieldOffset(field)); }
  entityVector(reference: number, field: string): Vec3 { return this.entityFields(reference, field, 3).vector(this.fieldOffset(field)); }
  setEntityFloat(reference: number, field: string, value: number): void { this.storeEntity(reference, field, 1, (fields, word) => fields.setFloat(word, value)); }
  setEntityInt(reference: number, field: string, value: number): void { this.storeEntity(reference, field, 1, (fields, word) => fields.setInt(word, value)); }
  setEntityVector(reference: number, field: string, value: Vec3): void { this.storeEntity(reference, field, 3, (fields, word) => fields.setVector(word, value)); }
  private entityFields(reference: number, field: string, words: 1 | 3): QcWords {
    this.options.validateEntityAccess?.(reference, this.fieldOffset(field), words, "read");
    return this.entities.fromReference(reference);
  }
  private storeEntity(reference: number, field: string, words: 1 | 3, store: (fields: QcWords, word: number) => void): void {
    const word = this.fieldOffset(field), fields = this.entities.fromReference(reference), observe = this.options.observeEntityStore;
    this.options.validateEntityAccess?.(reference, word, words, "write");
    const before = observe === undefined ? null : fields.bytes.slice(word * 4, (word + words) * 4);
    store(fields, word);
    if (observe !== undefined && before !== null) observe({ functionIndex: this.functionIndex, statement: this.statement,
      reference, word, before, after: fields.bytes.slice(word * 4, (word + words) * 4) });
  }
  argFloat(index: number): number { return this.globals.float(this.parameterOffset(index)); }
  argInt(index: number): number { return this.globals.int(this.parameterOffset(index)); }
  argVector(index: number): Vec3 { return this.globals.vector(this.parameterOffset(index)); }
  argString(index: number): string { return this.strings.get(this.argInt(index)); }
  private parameterOffset(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= 8) return this.fail(`invalid parameter ${index}`);
    return 4 + index * 3;
  }
  returnFloat(value: number): void { this.globals.setFloat(1, value); }
  returnInt(value: number): void { this.globals.setInt(1, value); }
  returnVector(value: Vec3): void { this.globals.setVector(1, value); }
  varString(first: number): string {
    let result = "";
    for (let index = first; index < this.argc; index++) result += this.argString(index);
    return result;
  }
  self(): QcWords { return this.entities.fromReference(this.globals.int(this.globalOffset("self"))); }
  missingBuiltins(): readonly { readonly functionIndex: number; readonly name: string; readonly number: number | null }[] {
    const missing: { functionIndex: number; name: string; number: number | null }[] = [];
    for (const fn of this.program.functions) {
      if (fn.firstStatement < 0 && !this.options.builtins.numbered.has(-fn.firstStatement)) missing.push({ functionIndex: fn.index, name: fn.name, number: -fn.firstStatement });
      else if (fn.namedBuiltin && !this.options.builtins.named.has(fn.name)) missing.push({ functionIndex: fn.index, name: fn.name, number: null });
    }
    return missing;
  }
  private builtin(fn: QcFunction): QcBuiltin | null {
    if (!fn.namedBuiltin && fn.firstStatement >= 0) return null;
    const builtin = fn.namedBuiltin ? this.options.builtins.named.get(fn.name) : this.options.builtins.numbered.get(-fn.firstStatement);
    if (builtin === undefined) return this.fail(`unbound builtin ${fn.name} (${fn.namedBuiltin ? "named" : -fn.firstStatement})`);
    return builtin;
  }
  private callBuiltin(builtin: QcBuiltin): void {
    this.builtinDepth++;
    try { builtin(this); }
    finally { this.builtinDepth--; }
  }
  private enter(fn: QcFunction): void {
    if (this.frames.length + 1 >= this.stackLimit) this.fail("stack overflow");
    if (this.localWords + fn.localWords > this.localStackLimit) this.fail("locals stack overflow");
    const begin = fn.parameterStart * 4;
    this.frames.push({ statement: this.statement, functionIndex: this.functionIndex, locals: this.globals.bytes.slice(begin, begin + fn.localWords * 4) });
    this.localWords += fn.localWords;
    let destination = fn.parameterStart;
    for (let parameter = 0; parameter < fn.parameterSizes.length; parameter++) {
      const size = fn.parameterSizes[parameter];
      if (size === undefined) return this.fail("invalid parameter layout");
      this.globals.copyWords(this.globals, 4 + parameter * 3, destination, size);
      destination += size;
    }
    this.functionIndex = fn.index;
    this.statement = fn.firstStatement - 1;
  }
  private leave(): void {
    const fn = this.program.functionAt(this.functionIndex);
    const frame = this.frames.pop();
    if (frame === undefined) return this.fail("stack underflow");
    this.globals.bytes.set(frame.locals, fn.parameterStart * 4);
    this.localWords -= fn.localWords;
    this.functionIndex = frame.functionIndex;
    this.statement = frame.statement;
  }
  execute(functionIndex: number, argumentCount = 0): undefined {
    if (!Number.isInteger(argumentCount) || argumentCount < 0 || argumentCount > 8) this.fail("invalid argument count");
    const fn = this.program.functionAt(functionIndex);
    this.argumentCount = argumentCount;
    this.traceEnabled = false;
    const call = { functionIndex, caller: this.functionIndex, statement: this.statement }, staging = this.captureCallStaging();
    this.options.observeCall?.(call);
    this.restoreCallStaging(staging);
    const budget = { remaining: this.statementLimit };
    this.invokeFunction(fn, call, budget, staging);
    return undefined;
  }
  private captureCallStaging(): CallStaging | null {
    return this.options.observeCall === undefined && this.boundaryFunctions.size === 0 ? null
      : { words: this.globals.bytes.slice(4, 112), argumentCount: this.argumentCount };
  }
  private restoreCallStaging(staging: CallStaging | null): void {
    if (staging !== null) { this.globals.bytes.set(staging.words, 4); this.argumentCount = staging.argumentCount; }
  }
  private invokeFunction(fn: QcFunction, call: QcCallSite, budget: { remaining: number }, staging: CallStaging | null): void {
    const boundary = this.options.functionBoundary;
    if (boundary === undefined || !this.boundaryFunctions.has(fn.index)) { this.runFunction(fn, budget); return; }
    let active = true, called = false, executing = false;
    const owner = {};
    const returnWords = (words: readonly [number, number, number]): void => {
      for (const [index, word] of words.entries()) {
        if (!Number.isInteger(word) || word < -2147483648 || word > 4294967295) this.fail("replacement return is not a QC word");
        this.globals.setInt(1 + index, word);
      }
    };
    const failure: { value: { error: unknown } | null } = { value: null };
    const completed: { value: CallStaging | null } = { value: null };
    this.boundaryDepth++;
    try {
      const finish = (run: () => undefined): undefined => {
        try {
          if (!active || called) this.fail("function continuation must execute once inside its boundary");
          called = true;
          this.restoreCallStaging(staging);
          run();
          completed.value = { words: this.globals.bytes.slice(4, 16), argumentCount: this.argumentCount };
          return undefined;
        } catch (error) { failure.value = { error }; throw error; }
      };
      const execute: QcFunctionExecution = Object.assign((prepare?: (machine: QcMachine) => undefined): undefined => finish(() => {
        prepare?.(this);
        executing = true;
        try { this.runFunction(fn, budget); }
        catch (error) {
          if (!(error instanceof QcFunctionCancellation) || error.owner !== owner) throw error;
          returnWords(error.words);
        } finally { executing = false; }
        return undefined;
      }), { skip: (returnWords: readonly [number, number, number]): undefined => finish(() => {
        for (const [index, word] of returnWords.entries()) {
          if (!Number.isInteger(word) || word < -2147483648 || word > 4294967295) this.fail("replacement return is not a QC word");
          this.globals.setInt(1 + index, word);
        }
        return undefined;
      }), cancel: (words: readonly [number, number, number]): never => {
        if (!active || !executing) this.fail("function cancellation requires its live source execution");
        throw new QcFunctionCancellation(owner, words);
      } });
      boundary.run(call, execute);
      if (failure.value !== null) throw failure.value.error;
      if (!called) this.fail("function boundary omitted source execution");
    } finally {
      active = false; this.boundaryDepth--;
      // Host confirmation may reenter QC after the callee returned. Preserve its actual return, not guest state.
      this.restoreCallStaging(completed.value);
    }
  }
  private runFunction(fn: QcFunction, budget: { remaining: number }): void {
    const exitDepth = this.frames.length;
    const builtin = this.builtin(fn);
    if (builtin !== null) { this.callBuiltin(builtin); return; }
    this.enter(fn);
    try {
      this.runStatements(exitDepth, budget);
    } catch (error) {
      while (this.frames.length > exitDepth) this.leave();
      throw error;
    }
  }
  private runStatements(exitDepth: number, budget: { remaining: number }, stop?: { readonly region: QcInlineRegion; readonly frame: Frame }): void {
      const boundary = this.inlineRegions.size === 0 ? undefined : this.options.inlineBoundary;
      while (this.frames.length > exitDepth) {
        if (stop !== undefined && this.frames.at(-1) === stop.frame) {
          if (this.statement + 1 === stop.region.exit) return;
          if (this.statement + 1 < stop.region.entry || this.statement + 1 > stop.region.exit) this.fail("inline source region escaped its continuation");
        }
        this.statement++;
        const statement = this.program.statements[this.statement];
        if (statement === undefined) this.fail("statement outside program");
        const region = boundary === undefined ? undefined : this.inlineRegions.get(this.statement);
        if (boundary !== undefined && region !== undefined && region.functionIndex === this.functionIndex
          && !(stop !== undefined && stop.frame === this.frames.at(-1) && stop.region.entry === this.statement)) {
          const frame = this.frames.at(-1);
          if (frame === undefined) this.fail("inline source region has no frame");
          let active = true, called = false;
          const failure: { value: { error: unknown } | null } = { value: null };
          this.statement--;
          try {
            boundary.run(region, () => {
              try {
                if (!active || called) this.fail("inline continuation must execute once inside its boundary");
                called = true;
                this.runStatements(exitDepth, budget, { region, frame });
              }
              catch (error) { failure.value = { error }; throw error; }
              return undefined;
            });
            if (failure.value !== null) throw failure.value.error;
            if (!called) this.fail("inline boundary omitted source execution");
          } finally { active = false; }
          continue;
        }
        if (--budget.remaining === 0) this.fail("runaway loop error");
        this.profiling[this.functionIndex] = (this.profiling[this.functionIndex] ?? 0) + 1;
        if (this.traceEnabled) this.options.trace?.(this);
        const { opcode, a, b, c } = statement;
        const g = this.globals;
        const n = this.numeric;
        const vectorBinary = (operation: (left: number, right: number) => number): void => {
          for (let index = 0; index < 3; index++) g.setFloat(c + index, operation(g.float(a + index), g.float(b + index)));
        };
        switch (opcode) {
          case QcOpcode.AddF: g.setFloat(c, n.add(g.float(a), g.float(b))); break;
          case QcOpcode.SubF: g.setFloat(c, n.subtract(g.float(a), g.float(b))); break;
          case QcOpcode.MulF: g.setFloat(c, n.multiply(g.float(a), g.float(b))); break;
          case QcOpcode.DivF: g.setFloat(c, n.divide(g.float(a), g.float(b))); break;
          case QcOpcode.AddV: vectorBinary(n.add); break;
          case QcOpcode.SubV: vectorBinary(n.subtract); break;
          case QcOpcode.MulV:
            g.setFloat(c, n.add(n.add(n.multiply(g.float(a), g.float(b)), n.multiply(g.float(a + 1), g.float(b + 1))), n.multiply(g.float(a + 2), g.float(b + 2)))); break;
          case QcOpcode.MulFV:
            for (let index = 0; index < 3; index++) g.setFloat(c + index, n.multiply(g.float(a), g.float(b + index)));
            break;
          case QcOpcode.MulVF:
            for (let index = 0; index < 3; index++) g.setFloat(c + index, n.multiply(g.float(b), g.float(a + index)));
            break;
          case QcOpcode.EqF: g.setFloat(c, g.float(a) === g.float(b) ? 1 : 0); break;
          case QcOpcode.NeF: g.setFloat(c, g.float(a) !== g.float(b) ? 1 : 0); break;
          case QcOpcode.EqV: g.setFloat(c, g.float(a) === g.float(b) && g.float(a + 1) === g.float(b + 1) && g.float(a + 2) === g.float(b + 2) ? 1 : 0); break;
          case QcOpcode.NeV: g.setFloat(c, g.float(a) !== g.float(b) || g.float(a + 1) !== g.float(b + 1) || g.float(a + 2) !== g.float(b + 2) ? 1 : 0); break;
          case QcOpcode.EqS: g.setFloat(c, this.strings.get(g.int(a)) === this.strings.get(g.int(b)) ? 1 : 0); break;
          case QcOpcode.NeS: g.setFloat(c, byteCompare(this.strings.get(g.int(a)), this.strings.get(g.int(b)))); break;
          case QcOpcode.EqE: case QcOpcode.EqFn: g.setFloat(c, g.int(a) === g.int(b) ? 1 : 0); break;
          case QcOpcode.NeE: case QcOpcode.NeFn: g.setFloat(c, g.int(a) !== g.int(b) ? 1 : 0); break;
          case QcOpcode.Le: g.setFloat(c, g.float(a) <= g.float(b) ? 1 : 0); break;
          case QcOpcode.Ge: g.setFloat(c, g.float(a) >= g.float(b) ? 1 : 0); break;
          case QcOpcode.Lt: g.setFloat(c, g.float(a) < g.float(b) ? 1 : 0); break;
          case QcOpcode.Gt: g.setFloat(c, g.float(a) > g.float(b) ? 1 : 0); break;
          case QcOpcode.NotF: g.setFloat(c, g.float(a) === 0 ? 1 : 0); break;
          case QcOpcode.NotV: g.setFloat(c, g.float(a) === 0 && g.float(a + 1) === 0 && g.float(a + 2) === 0 ? 1 : 0); break;
          case QcOpcode.NotS: g.setFloat(c, g.int(a) === 0 || this.strings.get(g.int(a)) === "" ? 1 : 0); break;
          case QcOpcode.NotEnt: g.setFloat(c, this.entities.slot(g.int(a)) === 0 ? 1 : 0); break;
          case QcOpcode.NotFn: g.setFloat(c, g.int(a) === 0 ? 1 : 0); break;
          case QcOpcode.And: g.setFloat(c, g.float(a) !== 0 && g.float(b) !== 0 ? 1 : 0); break;
          case QcOpcode.Or: g.setFloat(c, g.float(a) !== 0 || g.float(b) !== 0 ? 1 : 0); break;
          case QcOpcode.BitAnd: g.setFloat(c, n.toInt32(g.float(a)) & n.toInt32(g.float(b))); break;
          case QcOpcode.BitOr: g.setFloat(c, n.toInt32(g.float(a)) | n.toInt32(g.float(b))); break;
          case QcOpcode.StoreF: case QcOpcode.StoreS: case QcOpcode.StoreEnt: case QcOpcode.StoreFld: case QcOpcode.StoreFn:
            g.copyWords(g, a, b, 1); break;
          case QcOpcode.StoreV: g.copyWords(g, a, b, 3); break;
          case QcOpcode.LoadF: case QcOpcode.LoadS: case QcOpcode.LoadEnt: case QcOpcode.LoadFld: case QcOpcode.LoadFn:
            this.options.validateEntityAccess?.(g.int(a), g.int(b), 1, "read");
            g.copyWords(this.entities.fromReference(g.int(a)), g.int(b), c, 1); break;
          case QcOpcode.LoadV:
            this.options.validateEntityAccess?.(g.int(a), g.int(b), 3, "read");
            g.copyWords(this.entities.fromReference(g.int(a)), g.int(b), c, 3); break;
          case QcOpcode.Address:
            if (this.entities.slot(g.int(a)) === 0 && this.options.serverActive()) this.fail("assignment to world entity");
            g.setInt(c, this.entities.pointer(g.int(a), g.int(b))); break;
          case QcOpcode.StorePF: case QcOpcode.StorePS: case QcOpcode.StorePEnt: case QcOpcode.StorePFld: case QcOpcode.StorePFn: case QcOpcode.StorePV: {
            const words = opcode === QcOpcode.StorePV ? 3 : 1;
            const destination = this.entities.resolvePointer(g.int(b), words);
            this.options.validateEntityAccess?.(g.int(b) - this.entities.layout.variablesOffsetBytes - destination.word * 4, destination.word, words, "write");
            const observe = this.options.observeEntityStore;
            const before = observe === undefined ? null : destination.fields.bytes.slice(destination.word * 4, (destination.word + words) * 4);
            destination.fields.copyWords(g, a, destination.word, words);
            if (observe !== undefined && before !== null) observe({ functionIndex: this.functionIndex, statement: this.statement,
              reference: g.int(b) - this.entities.layout.variablesOffsetBytes - destination.word * 4,
              word: destination.word, before, after: destination.fields.bytes.slice(destination.word * 4, (destination.word + words) * 4) });
            break;
          }
          case QcOpcode.If: if (g.int(a) !== 0) this.statement += signedQcBranch(b) - 1; break;
          case QcOpcode.IfNot: if (g.int(a) === 0) this.statement += signedQcBranch(b) - 1; break;
          case QcOpcode.Goto: this.statement += signedQcBranch(a) - 1; break;
          case QcOpcode.Call0: case QcOpcode.Call1: case QcOpcode.Call2: case QcOpcode.Call3: case QcOpcode.Call4:
          case QcOpcode.Call5: case QcOpcode.Call6: case QcOpcode.Call7: case QcOpcode.Call8: {
            this.argumentCount = opcode - QcOpcode.Call0;
            const called = this.program.functionAt(g.int(a));
            const call = { functionIndex: called.index, caller: this.functionIndex, statement: this.statement }, staging = this.captureCallStaging();
            this.options.observeCall?.(call);
            this.restoreCallStaging(staging);
            if (this.boundaryFunctions.has(called.index)) this.invokeFunction(called, call, budget, staging);
            else {
              const callBuiltin = this.builtin(called);
              if (callBuiltin === null) this.enter(called);
              else this.callBuiltin(callBuiltin);
            }
            break;
          }
          case QcOpcode.State: {
            const self = this.self();
            if (this.options.validateEntityAccess !== undefined) {
              const reference = g.int(this.globalOffset("self"));
              const fields: readonly (readonly [string, number, "float" | "int"])[] = [
                ["nextthink", n.add(g.float(this.globalOffset("time")), 0.1), "float"], ["frame", g.float(a), "float"], ["think", g.int(b), "int"],
              ];
              for (const [name, value, type] of fields) {
                const word = this.fieldOffset(name), observe = this.options.observeEntityStore;
                this.options.validateEntityAccess(reference, word, 1, "write");
                const before = observe === undefined ? null : self.bytes.slice(word * 4, (word + 1) * 4);
                if (type === "float") self.setFloat(word, value); else self.setInt(word, value);
                if (observe !== undefined && before !== null) observe({ functionIndex: this.functionIndex, statement: this.statement, reference,
                  word, before, after: self.bytes.slice(word * 4, (word + 1) * 4) });
              }
              break;
            }
            self.setFloat(this.fieldOffset("nextthink"), n.add(g.float(this.globalOffset("time")), 0.1));
            self.setFloat(this.fieldOffset("frame"), g.float(a));
            self.setInt(this.fieldOffset("think"), g.int(b));
            break;
          }
          case QcOpcode.Done: case QcOpcode.Return:
            if (stop?.frame === this.frames.at(-1)) this.fail("inline source region returned before its continuation");
            g.copyWords(g, a, 1, 3); this.leave(); break;
          default: { const unreachable: never = opcode; this.fail(`unsupported opcode ${unreachable}`); }
        }
      }
  }
  snapshot(): QcMachineSnapshot {
    if (this.depth !== 0 || this.builtinDepth !== 0 || this.boundaryDepth !== 0) return this.fail("save requires an idle callback boundary");
    return { globals: this.globals.bytes.slice(), entities: this.entities.bytes.slice(), entityCount: this.entities.count,
      strings: this.strings.snapshot(), statement: this.statement, functionIndex: this.functionIndex, argumentCount: this.argumentCount,
      profiling: [...this.profiling], traceEnabled: this.traceEnabled };
  }
  restore(snapshot: QcMachineSnapshot): void {
    if (this.depth !== 0 || this.builtinDepth !== 0 || this.boundaryDepth !== 0) this.fail("restore requires an idle callback boundary");
    if (snapshot.globals.length !== this.globals.bytes.length || snapshot.profiling.length !== this.profiling.length || snapshot.functionIndex !== 0) this.fail("incompatible machine checkpoint");
    this.strings.restore(snapshot.strings);
    this.entities.restore(snapshot.entities, snapshot.entityCount);
    this.globals.bytes.set(snapshot.globals);
    this.statement = snapshot.statement; this.functionIndex = 0; this.argumentCount = snapshot.argumentCount;
    this.traceEnabled = snapshot.traceEnabled;
    for (let index = 0; index < this.profiling.length; index++) this.profiling[index] = snapshot.profiling[index] ?? 0;
  }
}
function byteCompare(left: string, right: string): number {
  for (let index = 0; index <= Math.min(left.length, right.length); index++) {
    const difference = (index < left.length ? left.charCodeAt(index) : 0) - (index < right.length ? right.charCodeAt(index) : 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
