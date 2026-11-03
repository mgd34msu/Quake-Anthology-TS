// SPDX-License-Identifier: GPL-2.0-or-later
import { QcOpcode } from "../../src/compat/qc/program.ts";

export type QcAsmType = "float" | "vector" | "string" | "entity" | "field" | "function";
const typeCodes: Record<QcAsmType, number> = { string: 1, float: 2, vector: 3, entity: 4, field: 5, function: 6 };

/** QC `self`, `other`, `world`, `time` and the other engine-owned globals follow the reserved words in progs.dat order. */
const engineGlobals: readonly (readonly [string, QcAsmType])[] = [
  ["self", "entity"],
  ["other", "entity"],
  ["world", "entity"],
  ["activator", "entity"],
  ["time", "float"],
  ["frametime", "float"],
  ["force_retouch", "float"],
  ["mapname", "string"],
  ["deathmatch", "float"],
  ["coop", "float"],
  ["teamplay", "float"],
  ["serverflags", "float"],
  ["v_forward", "vector"],
  ["v_up", "vector"],
  ["v_right", "vector"],
];
/** The engine-known entity fields in the order id's defs.qc declares them. */
const engineFields: readonly (readonly [string, QcAsmType])[] = [
  ["modelindex", "float"],
  ["absmin", "vector"],
  ["absmax", "vector"],
  ["ltime", "float"],
  ["movetype", "float"],
  ["solid", "float"],
  ["origin", "vector"],
  ["oldorigin", "vector"],
  ["velocity", "vector"],
  ["angles", "vector"],
  ["avelocity", "vector"],
  ["punchangle", "vector"],
  ["classname", "string"],
  ["model", "string"],
  ["frame", "float"],
  ["skin", "float"],
  ["effects", "float"],
  ["mins", "vector"],
  ["maxs", "vector"],
  ["size", "vector"],
  ["touch", "function"],
  ["use", "function"],
  ["think", "function"],
  ["blocked", "function"],
  ["nextthink", "float"],
  ["groundentity", "entity"],
  ["health", "float"],
  ["frags", "float"],
  ["weapon", "float"],
  ["weaponmodel", "string"],
  ["weaponframe", "float"],
  ["currentammo", "float"],
  ["ammo_shells", "float"],
  ["ammo_nails", "float"],
  ["ammo_rockets", "float"],
  ["ammo_cells", "float"],
  ["items", "float"],
  ["takedamage", "float"],
  ["chain", "entity"],
  ["deadflag", "float"],
  ["view_ofs", "vector"],
  ["button0", "float"],
  ["button1", "float"],
  ["button2", "float"],
  ["impulse", "float"],
  ["fixangle", "float"],
  ["v_angle", "vector"],
  ["idealpitch", "float"],
  ["netname", "string"],
  ["enemy", "entity"],
  ["flags", "float"],
  ["colormap", "float"],
  ["team", "float"],
  ["max_health", "float"],
  ["teleport_time", "float"],
  ["armortype", "float"],
  ["armorvalue", "float"],
  ["waterlevel", "float"],
  ["watertype", "float"],
  ["ideal_yaw", "float"],
  ["yaw_speed", "float"],
  ["aiment", "entity"],
  ["goalentity", "entity"],
  ["spawnflags", "float"],
  ["target", "string"],
  ["targetname", "string"],
  ["dmg_take", "float"],
  ["dmg_save", "float"],
  ["dmg_inflictor", "entity"],
  ["owner", "entity"],
  ["movedir", "vector"],
  ["message", "string"],
  ["sounds", "float"],
  ["noise", "string"],
  ["noise1", "string"],
  ["noise2", "string"],
  ["noise3", "string"],
];
const localsBase = 1024,
  constantsBase = 8192;

export interface QcAsmFunction {
  readonly name: string;
  readonly body: (fn: QcAsmFn) => void;
  readonly params: readonly QcAsmType[];
}

/** One function's statement stream. Locals are fresh globals inside the function's parameter window, so recursion and nested calls restore them. */
export class QcAsmFn {
  readonly statements: [QcOpcode, number, number, number][] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: { readonly at: number; readonly slot: "a" | "b"; readonly label: string }[] = [];
  private nextLabel = 0;
  localWords = 0;
  readonly params: number[] = [];
  constructor(
    private readonly asm: QcAssembler,
    readonly parameterStart: number,
    readonly paramTypes: readonly QcAsmType[],
  ) {
    for (const type of paramTypes) this.params.push(this.local(type));
  }
  /** The local slot of a declared parameter. */
  param(index: number): number {
    const slot = this.params[index];
    if (slot === undefined) throw new RangeError(`The function has no parameter ${index}`);
    return slot;
  }
  local(type: QcAsmType = "float"): number {
    const size = type === "vector" ? 3 : 1,
      offset = this.parameterStart + this.localWords;
    this.localWords += size;
    return offset;
  }
  op(opcode: QcOpcode, a = 0, b = 0, c = 0): void {
    this.statements.push([opcode, a, b, c]);
  }
  /** Position-independent labels: `jump`, `branch` and `branchNot` reference them by name. */
  label(name?: string): string {
    const label = name ?? `L${this.nextLabel++}`;
    this.labels.set(label, this.statements.length);
    return label;
  }
  fresh(): string {
    return `L${this.nextLabel++}`;
  }
  jump(label: string): void {
    this.fixups.push({ at: this.statements.length, slot: "a", label });
    this.op(QcOpcode.Goto);
  }
  branch(condition: number, label: string): void {
    this.fixups.push({ at: this.statements.length, slot: "b", label });
    this.op(QcOpcode.If, condition);
  }
  branchNot(condition: number, label: string): void {
    this.fixups.push({ at: this.statements.length, slot: "b", label });
    this.op(QcOpcode.IfNot, condition);
  }
  resolve(): void {
    for (const fixup of this.fixups) {
      const target = this.labels.get(fixup.label),
        statement = this.statements[fixup.at];
      if (target === undefined || statement === undefined) throw new Error(`Unresolved QC label ${fixup.label}`);
      statement[fixup.slot === "a" ? 1 : 2] = (target - fixup.at) & 0xffff;
    }
  }
  float(value: number): number {
    return this.asm.constantFloat(value);
  }
  string(value: string): number {
    return this.asm.constantString(value);
  }
  vec(x: number, y: number, z: number): number {
    return this.asm.constantVector(x, y, z);
  }
  /** Name a local so its type is recorded in the program's definitions. */
  named(name: string, type: QcAsmType, offset: number): number {
    this.asm.nameLocal(name, type, offset);
    return offset;
  }
  fieldRef(name: string): number {
    return this.asm.constantField(name);
  }
  fnRef(name: string): number {
    return this.asm.constantFunction(name);
  }
  global(name: string): number {
    return this.asm.globalOffset(name);
  }
  /** dst = entity.field */
  load(entity: number, field: string, type: QcAsmType = "float"): number {
    const dst = this.local(type);
    this.op(
      type === "vector"
        ? QcOpcode.LoadV
        : type === "string"
          ? QcOpcode.LoadS
          : type === "entity"
            ? QcOpcode.LoadEnt
            : type === "function"
              ? QcOpcode.LoadFn
              : QcOpcode.LoadF,
      entity,
      this.fieldRef(field),
      dst,
    );
    return dst;
  }
  /** entity.field = value */
  store(entity: number, field: string, value: number, type: QcAsmType = "float"): void {
    const pointer = this.local("float");
    this.op(QcOpcode.Address, entity, this.fieldRef(field), pointer);
    this.op(
      type === "vector"
        ? QcOpcode.StorePV
        : type === "string"
          ? QcOpcode.StorePS
          : type === "entity"
            ? QcOpcode.StorePEnt
            : type === "function"
              ? QcOpcode.StorePFn
              : QcOpcode.StorePF,
      value,
      pointer,
    );
  }
  /** global = value */
  assign(dst: number, value: number, type: QcAsmType = "float"): void {
    this.op(
      type === "vector"
        ? QcOpcode.StoreV
        : type === "string"
          ? QcOpcode.StoreS
          : type === "entity"
            ? QcOpcode.StoreEnt
            : type === "function"
              ? QcOpcode.StoreFn
              : QcOpcode.StoreF,
      value,
      dst,
    );
  }
  binary(opcode: QcOpcode, a: number, b: number, type: QcAsmType = "float"): number {
    const dst = this.local(type);
    this.op(opcode, a, b, dst);
    return dst;
  }
  add(a: number, b: number): number {
    return this.binary(QcOpcode.AddF, a, b);
  }
  sub(a: number, b: number): number {
    return this.binary(QcOpcode.SubF, a, b);
  }
  mul(a: number, b: number): number {
    return this.binary(QcOpcode.MulF, a, b);
  }
  div(a: number, b: number): number {
    return this.binary(QcOpcode.DivF, a, b);
  }
  lt(a: number, b: number): number {
    return this.binary(QcOpcode.Lt, a, b);
  }
  gt(a: number, b: number): number {
    return this.binary(QcOpcode.Gt, a, b);
  }
  le(a: number, b: number): number {
    return this.binary(QcOpcode.Le, a, b);
  }
  ge(a: number, b: number): number {
    return this.binary(QcOpcode.Ge, a, b);
  }
  eq(a: number, b: number): number {
    return this.binary(QcOpcode.EqF, a, b);
  }
  ne(a: number, b: number): number {
    return this.binary(QcOpcode.NeF, a, b);
  }
  bitAnd(a: number, b: number): number {
    return this.binary(QcOpcode.BitAnd, a, b);
  }
  bitOr(a: number, b: number): number {
    return this.binary(QcOpcode.BitOr, a, b);
  }
  not(a: number): number {
    const dst = this.local();
    this.op(QcOpcode.NotF, a, 0, dst);
    return dst;
  }
  unset(pointer: number): number {
    const dst = this.local();
    this.op(QcOpcode.NotFn, pointer, 0, dst);
    return dst;
  }
  isNull(entity: number): number {
    const dst = this.local();
    this.op(QcOpcode.NotEnt, entity, 0, dst);
    return dst;
  }
  /** Call `name` with word-sized arguments; vectors are passed as three words from their first word. Returns the return-value word (global 1). */
  call(name: string, ...args: readonly (number | readonly [number, "vector"])[]): number {
    args.forEach((arg, index) => {
      const parm = 4 + index * 3;
      if (typeof arg === "number") this.op(QcOpcode.StoreF, arg, parm);
      else this.op(QcOpcode.StoreV, arg[0], parm);
    });
    this.op(QcOpcode.Call0 + args.length, this.fnRef(name));
    return 1;
  }
  /** Call the function whose index is held in `pointer`. */
  callPointer(pointer: number, ...args: readonly number[]): number {
    args.forEach((arg, index) => this.op(QcOpcode.StoreF, arg, 4 + index * 3));
    this.op(QcOpcode.Call0 + args.length, pointer);
    return 1;
  }
  /** Copy the return value out of OFS_RETURN so a later call cannot overwrite it. */
  result(type: QcAsmType = "float"): number {
    const dst = this.local(type);
    this.assign(dst, 1, type);
    return dst;
  }
  ret(value = 0): void {
    this.op(QcOpcode.Return, value);
  }
}

interface Stored {
  readonly name: string;
  readonly fn: QcAsmFn | null;
  readonly firstStatement: number;
  readonly builtin: number;
  readonly params: readonly QcAsmType[];
}

/** Hand-assembles a version 6 progs.dat in memory so tests can exercise QuakeC behavior without any shipped game data. */
export class QcAssembler {
  private readonly stringBytes: number[] = [0];
  private readonly stringOffsets = new Map<string, number>();
  private readonly globalDefs: { readonly name: string; readonly type: QcAsmType; readonly offset: number }[] = [];
  private readonly fieldDefs: { readonly name: string; readonly type: QcAsmType; readonly offset: number }[] = [];
  private readonly values = new Map<number, number>();
  private readonly floatConstants = new Map<number, number>();
  private readonly stringConstants = new Map<string, number>();
  private readonly vectorConstants = new Map<string, number>();
  private readonly fieldConstants = new Map<string, number>();
  private readonly functionConstants = new Map<string, number>();
  private readonly functionTable: Stored[] = [{ name: "", fn: null, firstStatement: 0, builtin: 0, params: [] }];
  private readonly pending: { readonly index: number; readonly fn: QcAsmFn; readonly body: (fn: QcAsmFn) => void }[] = [];
  private nextGlobal = 28;
  private nextField = 0;
  private nextLocal = localsBase;
  private nextConstant = constantsBase;
  readonly crc: number;
  constructor(crc: 5927 | 54730 = 5927) {
    this.crc = crc;
    this.globalDefs.push({ name: "", type: "entity", offset: 0 });
    for (const [name, type] of engineGlobals) this.defineGlobal(name, type);
    for (const [name, type] of engineFields) this.defineField(name, type);
  }
  string(text: string): number {
    const known = this.stringOffsets.get(text);
    if (known !== undefined) return known;
    const offset = this.stringBytes.length;
    for (const char of new TextEncoder().encode(text)) this.stringBytes.push(char);
    this.stringBytes.push(0);
    this.stringOffsets.set(text, offset);
    return offset;
  }
  defineGlobal(name: string, type: QcAsmType = "float", initial?: number): number {
    const known = this.globalDefs.find(def => def.name === name);
    if (known !== undefined) return known.offset;
    const offset = this.nextGlobal;
    this.nextGlobal += type === "vector" ? 3 : 1;
    if (this.nextGlobal > localsBase) throw new Error("Too many named QC globals");
    this.globalDefs.push({ name, type, offset });
    if (initial !== undefined) this.values.set(offset, initial);
    return offset;
  }
  globalOffset(name: string): number {
    const def = this.globalDefs.find(entry => entry.name === name);
    if (def === undefined) throw new Error(`Unknown QC global ${name}`);
    return def.offset;
  }
  defineField(name: string, type: QcAsmType = "float"): number {
    const known = this.fieldDefs.find(def => def.name === name);
    if (known !== undefined) return known.offset;
    const offset = this.nextField;
    this.nextField += type === "vector" ? 3 : 1;
    this.fieldDefs.push({ name, type, offset });
    if (type === "vector") {
      for (const [index, suffix] of ["_x", "_y", "_z"].entries()) this.fieldDefs.push({ name: `${name}${suffix}`, type: "float", offset: offset + index });
    }
    return offset;
  }
  private constant(): number {
    return this.nextConstant++;
  }
  constantFloat(value: number): number {
    const known = this.floatConstants.get(value);
    if (known !== undefined) return known;
    const offset = this.constant();
    this.floatConstants.set(value, offset);
    this.values.set(offset, new Uint32Array(new Float32Array([value]).buffer)[0] ?? 0);
    this.globalDefs.push({ name: "IMMEDIATE", type: "float", offset });
    return offset;
  }
  constantVector(x: number, y: number, z: number): number {
    const key = `${x},${y},${z}`,
      known = this.vectorConstants.get(key);
    if (known !== undefined) return known;
    const offset = this.nextConstant;
    this.nextConstant += 3;
    this.vectorConstants.set(key, offset);
    [x, y, z].forEach((value, index) => this.values.set(offset + index, new Uint32Array(new Float32Array([value]).buffer)[0] ?? 0));
    this.globalDefs.push({ name: "IMMEDIATE", type: "vector", offset });
    return offset;
  }
  /** A typed, named word for a function local; rules that inspect frames look words up by their definition. */
  nameLocal(name: string, type: QcAsmType, offset: number): void {
    this.globalDefs.push({ name, type, offset });
  }
  constantString(value: string): number {
    const known = this.stringConstants.get(value);
    if (known !== undefined) return known;
    const offset = this.constant();
    this.stringConstants.set(value, offset);
    this.values.set(offset, this.string(value));
    this.globalDefs.push({ name: "IMMEDIATE", type: "string", offset });
    return offset;
  }
  constantField(name: string): number {
    const known = this.fieldConstants.get(name);
    if (known !== undefined) return known;
    const field = this.fieldDefs.find(def => def.name === name);
    if (field === undefined) throw new Error(`Unknown QC field ${name}`);
    const offset = this.constant();
    this.fieldConstants.set(name, offset);
    this.values.set(offset, field.offset);
    this.globalDefs.push({ name, type: "field", offset });
    return offset;
  }
  constantFunction(name: string): number {
    const known = this.functionConstants.get(name);
    if (known !== undefined) return known;
    const index = this.functionTable.findIndex(entry => entry.name === name);
    if (index < 0) throw new Error(`Unknown QC function ${name}`);
    const offset = this.constant();
    this.functionConstants.set(name, offset);
    this.values.set(offset, index);
    this.globalDefs.push({ name, type: "function", offset });
    return offset;
  }
  /** Numbered builtin: `firstStatement` is the negative builtin number. */
  builtin(name: string, number: number, params: readonly QcAsmType[] = []): void {
    this.functionTable.push({ name, fn: null, firstStatement: -number, builtin: number, params });
  }
  /** Declare first so bodies can call each other; bodies are emitted in `build`. */
  declare(name: string, params: readonly QcAsmType[], body: (fn: QcAsmFn) => void, names: readonly string[] = []): void {
    const index = this.functionTable.length,
      start = this.nextLocal;
    const fn = new QcAsmFn(this, start, params);
    params.forEach((type, slot) => this.nameLocal(names[slot] ?? `${name}.arg${slot}`, type, fn.params[slot] ?? 0));
    this.functionTable.push({ name, fn, firstStatement: -1, builtin: 0, params });
    this.pending.push({ index, fn, body });
    // Reserve the window now; the real size is only known after the body runs, so each function gets a generous fixed span.
    this.nextLocal += 256;
  }
  /** Build the progs.dat image. */
  build(): Uint8Array {
    const statements: [QcOpcode, number, number, number][] = [[QcOpcode.Done, 0, 0, 0]];
    const starts = new Map<number, number>();
    for (const entry of this.pending) {
      entry.body(entry.fn);
      entry.fn.ret(0);
      entry.fn.resolve();
      if (entry.fn.localWords > 256) throw new Error(`QC function ${this.functionTable[entry.index]?.name ?? "?"} needs ${entry.fn.localWords} local words`);
      starts.set(entry.index, statements.length);
      statements.push(...entry.fn.statements);
    }
    // Every function has a function-typed global holding its index, as qcc emits, so rules can match call sites by definition.
    this.functionTable.forEach((entry, index) => {
      if (index > 0 && !this.functionConstants.has(entry.name)) this.constantFunction(entry.name);
    });
    const highest = Math.max(this.nextConstant, this.nextLocal, this.nextGlobal) + 1;
    const initial = new Uint32Array(highest);
    for (const [offset, value] of this.values) initial[offset] = value;
    const globalDefs = this.globalDefs.filter(def => def.name !== "");
    const totalFieldWords = Math.max(this.nextField, 1);
    // Header: version, crc, then (offset, count) for statements, globals, fields, functions, strings, global values, then entity field words.
    const defBytes = (defs: readonly { name: string; type: QcAsmType; offset: number }[]) => {
      const bytes = new Uint8Array(defs.length * 8),
        view = new DataView(bytes.buffer);
      defs.forEach((def, index) => {
        view.setUint16(index * 8, typeCodes[def.type], true);
        view.setUint16(index * 8 + 2, def.offset, true);
        view.setInt32(index * 8 + 4, this.string(def.name), true);
      });
      return bytes;
    };
    const globalDefBytes = defBytes(globalDefs),
      fieldDefBytes = defBytes(this.fieldDefs);
    const functionBytes = new Uint8Array(this.functionTable.length * 36),
      functionView = new DataView(functionBytes.buffer);
    this.functionTable.forEach((entry, index) => {
      const at = index * 36,
        base = entry.fn?.parameterStart ?? 0;
      functionView.setInt32(at, entry.fn === null ? entry.firstStatement : (starts.get(index) ?? 0), true);
      functionView.setInt32(at + 4, base, true);
      functionView.setInt32(at + 8, entry.fn?.localWords ?? 0, true);
      functionView.setInt32(at + 16, this.string(entry.name), true);
      functionView.setInt32(at + 20, this.string("synthetic.qc"), true);
      functionView.setInt32(at + 24, entry.params.length, true);
      entry.params.forEach((param, slot) => {
        functionBytes[at + 28 + slot] = param === "vector" ? 3 : 1;
      });
    });
    const statementBytes = new Uint8Array(statements.length * 8),
      statementView = new DataView(statementBytes.buffer);
    statements.forEach((statement, index) => statement.forEach((word, slot) => statementView.setUint16(index * 8 + slot * 2, word & 0xffff, true)));
    const strings = Uint8Array.from(this.stringBytes),
      values = new Uint8Array(initial.buffer);
    const sections = [statementBytes, globalDefBytes, fieldDefBytes, functionBytes, strings, values];
    const counts = [statements.length, globalDefs.length, this.fieldDefs.length, this.functionTable.length, strings.length, initial.length];
    const headerSize = 8 + 12 * 4 + 4,
      header = new Uint8Array(headerSize),
      headerView = new DataView(header.buffer);
    headerView.setInt32(0, 6, true);
    headerView.setInt32(4, this.crc, true);
    let cursor = headerSize;
    sections.forEach((section, index) => {
      headerView.setInt32(8 + index * 8, cursor, true);
      headerView.setInt32(12 + index * 8, counts[index] ?? 0, true);
      cursor += section.length;
    });
    headerView.setInt32(8 + 48, totalFieldWords, true);
    const image = new Uint8Array(cursor);
    image.set(header, 0);
    let at = headerSize;
    for (const section of sections) {
      image.set(section, at);
      at += section.length;
    }
    return image;
  }
}
