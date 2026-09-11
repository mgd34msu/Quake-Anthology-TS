/* Quake pr_comp.h and pr_edict.c, id Software. GPL-2.0-or-later. */
import { BinaryReader } from "../../core/binary/index.ts";
import { createHash } from "node:crypto";
import { createContentDigest } from "../../contracts/content.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { QuakeCApiIdentity } from "../../contracts/execution.ts";

export enum QcOpcode {
  Done, MulF, MulV, MulFV, MulVF, DivF, AddF, AddV, SubF, SubV,
  EqF, EqV, EqS, EqE, EqFn, NeF, NeV, NeS, NeE, NeFn, Le, Ge, Lt, Gt,
  LoadF, LoadV, LoadS, LoadEnt, LoadFld, LoadFn, Address,
  StoreF, StoreV, StoreS, StoreEnt, StoreFld, StoreFn,
  StorePF, StorePV, StorePS, StorePEnt, StorePFld, StorePFn,
  Return, NotF, NotV, NotS, NotEnt, NotFn, If, IfNot,
  Call0, Call1, Call2, Call3, Call4, Call5, Call6, Call7, Call8,
  State, Goto, And, Or, BitAnd, BitOr,
}
export type QcValueType = "void" | "string" | "float" | "vector" | "entity" | "field" | "function" | "pointer" | "opaque";
const valueTypes: readonly QcValueType[] = ["void", "string", "float", "vector", "entity", "field", "function", "pointer"];
export interface QcDefinition { readonly type: QcValueType; readonly nativeType: number; readonly save: boolean; readonly offset: number; readonly name: string; }
export interface QcStatement { readonly opcode: QcOpcode; readonly a: number; readonly b: number; readonly c: number; }
export interface QcFunction {
  readonly index: number;
  readonly firstStatement: number;
  readonly parameterStart: number;
  readonly localWords: number;
  readonly name: string;
  readonly file: string;
  readonly parameterSizes: readonly number[];
  readonly namedBuiltin: boolean;
}
export class QcProgramError extends Error {
  constructor(message: string, readonly source = "progs.dat") { super(`${source}: ${message}`); this.name = "QcProgramError"; }
}
export function qcByteString(bytes: Uint8Array, offset: number): string {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new QcProgramError(`invalid string offset ${offset}`);
  let text = "";
  for (let cursor = offset; cursor < bytes.length; cursor++) {
    const byte = bytes[cursor];
    if (byte === undefined || byte === 0) return text;
    text += String.fromCharCode(byte);
  }
  throw new QcProgramError(`unterminated string at ${offset}`);
}
export class QcProgram {
  readonly globalsByName = new Map<string, QcDefinition>();
  readonly fieldsByName = new Map<string, QcDefinition>();
  readonly functionsByName = new Map<string, QcFunction>();
  constructor(
    readonly source: string,
    readonly api: QuakeCApiIdentity,
    readonly statements: readonly QcStatement[],
    readonly globals: readonly QcDefinition[],
    readonly fields: readonly QcDefinition[],
    readonly functions: readonly QcFunction[],
    readonly strings: Uint8Array,
    readonly initialGlobals: Uint8Array,
    readonly entityFieldWords: number,
    readonly checksum: number,
    readonly digest: ContentDigest,
  ) {
    for (const definition of globals) if (!this.globalsByName.has(definition.name)) this.globalsByName.set(definition.name, definition);
    for (const definition of fields) if (!this.fieldsByName.has(definition.name)) this.fieldsByName.set(definition.name, definition);
    for (const fn of functions) if (!this.functionsByName.has(fn.name)) this.functionsByName.set(fn.name, fn);
  }
  functionAt(index: number): QcFunction {
    const fn = this.functions[index];
    if (!Number.isInteger(index) || index <= 0 || fn === undefined) throw new QcProgramError(`invalid function ${index}`, this.source);
    return fn;
  }
  functionNamed(name: string): QcFunction {
    const fn = this.functionsByName.get(name);
    if (fn === undefined || fn.index === 0) throw new QcProgramError(`missing function ${name}`, this.source);
    return fn;
  }
}
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) !== 0 ? (crc << 1 ^ 0x1021) & 0xffff : crc << 1 & 0xffff;
  }
  return crc;
}
/** Version 6 operands are words; branch displacements are signed 16-bit values. */
export function signedQcBranch(word: number): number { return word << 16 >> 16; }
export function loadQcProgram(bytes: Uint8Array, expectedApi?: QuakeCApiIdentity, source = "progs.dat"): QcProgram {
  const reader = new BinaryReader(bytes, source);
  const version = reader.i32();
  const crc = reader.i32();
  if (version !== 6) throw new QcProgramError(`unsupported program version ${version}`, source);
  let api: QuakeCApiIdentity;
  if (crc === 5927) api = { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 };
  else if (crc === 54730) api = { kind: "q1-quakeworld", programVersion: 6, systemCrc: 54730 };
  else throw new QcProgramError(`unknown system layout CRC ${crc}`, source);
  if (expectedApi !== undefined && expectedApi.kind !== api.kind) throw new QcProgramError(`expected ${expectedApi.kind}, found ${api.kind}`, source);
  function section(stride: number): BinaryReader {
    const offset = reader.i32();
    const count = reader.i32();
    if (count < 0) throw new QcProgramError("negative section count", source);
    return reader.records(offset, count * stride, stride);
  }
  const statementsReader = section(8);
  const globalsReader = section(8);
  const fieldsReader = section(8);
  const functionsReader = section(36);
  const stringsReader = section(1);
  const valuesReader = section(4);
  const entityFieldWords = reader.i32();
  if (entityFieldWords <= 0 || entityFieldWords > 65536) throw new QcProgramError(`invalid entity field count ${entityFieldWords}`, source);
  const strings = stringsReader.bytes(stringsReader.length);
  if (strings[0] !== 0) throw new QcProgramError("string zero must be empty", source);
  const initialGlobals = valuesReader.bytes(valuesReader.length);
  if (initialGlobals.length < 28 * 4) throw new QcProgramError("missing reserved global words", source);
  function definitions(input: BinaryReader, field: boolean): QcDefinition[] {
    const result: QcDefinition[] = [];
    while (input.remaining > 0) {
      const rawType = input.u16();
      const offset = input.u16();
      const name = qcByteString(strings, input.i32());
      // FTE-generated rerelease programs retain compiler-only struct definitions.
      // Their words remain available even when the text-save type is unknown.
      const type = valueTypes[rawType & 0x7fff] ?? "opaque";
      if (field && (rawType & 0x8000) !== 0) throw new QcProgramError(`invalid definition ${name}`, source);
      const words = type === "vector" ? 3 : 1;
      const limit = field ? entityFieldWords : initialGlobals.length / 4;
      if (offset + words > limit) throw new QcProgramError(`definition ${name} exceeds its memory`, source);
      result.push({ type, nativeType: rawType & 0x7fff, save: (rawType & 0x8000) !== 0, offset, name });
    }
    return result;
  }
  const globals = definitions(globalsReader, false);
  const fields = definitions(fieldsReader, true);
  const statements: QcStatement[] = [];
  while (statementsReader.remaining > 0) {
    const opcode = statementsReader.u16();
    if (opcode > QcOpcode.BitOr) throw new QcProgramError(`unsupported opcode ${opcode}`, source);
    statements.push({ opcode, a: statementsReader.u16(), b: statementsReader.u16(), c: statementsReader.u16() });
  }
  const functions: QcFunction[] = [];
  while (functionsReader.remaining > 0) {
    const firstStatement = functionsReader.i32();
    const parameterStart = functionsReader.i32();
    const localWords = functionsReader.i32();
    functionsReader.i32(); // Runtime profile counters start at zero.
    const name = qcByteString(strings, functionsReader.i32());
    const file = qcByteString(strings, functionsReader.i32());
    const count = functionsReader.i32();
    const sizes = functionsReader.bytes(8);
    if (count < 0 || count > 8 || localWords < 0 || parameterStart < 0 || parameterStart + localWords > initialGlobals.length / 4) {
      throw new QcProgramError(`invalid function locals/parameters for ${name}`, source);
    }
    const parameterSizes: number[] = [];
    for (const size of sizes.subarray(0, count)) {
      if (firstStatement > 0 && size !== 1 && size !== 3) throw new QcProgramError(`invalid parameter size for ${name}`, source);
      parameterSizes.push(size);
    }
    // Original retail qcc emits functions whose parameter words exceed `locals`.
    // PR_EnterFunction saves exactly `locals`, then writes parameters separately.
    if (firstStatement >= statements.length || firstStatement > 0 && parameterStart + parameterSizes.reduce((sum, size) => sum + size, 0) > initialGlobals.length / 4) {
      throw new QcProgramError(`invalid entry point for ${name}`, source);
    }
    functions.push({ index: functions.length, firstStatement, parameterStart, localWords, name, file, parameterSizes,
      namedBuiltin: functions.length > 0 && firstStatement === 0 && parameterStart === 0 && localWords === 0 });
  }
  if (functions.length === 0 || statements.length === 0) throw new QcProgramError("empty function/statement table", source);
  return new QcProgram(source, api, statements, globals, fields, functions, strings, initialGlobals, entityFieldWords, crc16(bytes), createContentDigest(createHash("sha256").update(bytes).digest("hex")));
}
