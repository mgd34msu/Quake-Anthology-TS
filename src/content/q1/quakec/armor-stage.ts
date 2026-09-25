import type { ModQcArmorStage } from "../../../contracts/mod-callbacks.ts";
import type { QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, signedQcBranch, type QcProgram, type QcStatement, type QcFunction } from "../../../compat/qc/program.ts";

export interface QcArmorStage extends ModQcArmorStage { readonly region: QcInlineRegion; }

function words(first: number, count = 1): number[] { return Array.from({ length: count }, (_, index) => first + index); }
function access({ opcode, a, b, c }: QcStatement): { readonly read: readonly number[]; readonly write: readonly number[] } {
  if (opcode === QcOpcode.Done || opcode === QcOpcode.Return) return { read: words(a, 3), write: [1, 2, 3] };
  if (opcode === QcOpcode.Goto) return { read: [], write: [] };
  if (opcode === QcOpcode.If || opcode === QcOpcode.IfNot) return { read: [a], write: [] };
  if (opcode >= QcOpcode.Call0 && opcode <= QcOpcode.Call8) return { read: [a, ...words(4, (opcode - QcOpcode.Call0) * 3)], write: [1, 2, 3] };
  if (opcode === QcOpcode.State) return { read: [a, b], write: [] };
  if (opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn) return { read: words(a, opcode === QcOpcode.StoreV ? 3 : 1), write: words(b, opcode === QcOpcode.StoreV ? 3 : 1) };
  if (opcode >= QcOpcode.StorePF && opcode <= QcOpcode.StorePFn) return { read: [...words(a, opcode === QcOpcode.StorePV ? 3 : 1), b], write: [] };
  if (opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn) return { read: words(a, opcode === QcOpcode.NotV ? 3 : 1), write: [c] };
  const vectorA = [QcOpcode.MulV, QcOpcode.MulVF, QcOpcode.AddV, QcOpcode.SubV, QcOpcode.EqV, QcOpcode.NeV].includes(opcode);
  const vectorB = [QcOpcode.MulV, QcOpcode.MulFV, QcOpcode.AddV, QcOpcode.SubV, QcOpcode.EqV, QcOpcode.NeV].includes(opcode);
  const vectorResult = [QcOpcode.MulFV, QcOpcode.MulVF, QcOpcode.AddV, QcOpcode.SubV, QcOpcode.LoadV].includes(opcode);
  return { read: [...words(a, vectorA ? 3 : 1), ...words(b, vectorB ? 3 : 1)], write: words(c, vectorResult ? 3 : 1) };
}

const writtenWords = new WeakMap<QcProgram, ReadonlySet<number>>();
function constantCallee(program: QcProgram, statement: QcStatement): QcFunction | undefined {
  let written = writtenWords.get(program);
  if (written === undefined) { written = new Set(program.statements.flatMap(statement => access(statement).write)); writtenWords.set(program, written); }
  if (written.has(statement.a)) return undefined;
  const view = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
  const fn = program.functions[view.getInt32(statement.a * 4, true)];
  return fn !== undefined && program.globalsByName.get(fn.name)?.offset === statement.a ? fn : undefined;
}
function sourceAccess(program: QcProgram, statement: QcStatement): ReturnType<typeof access> {
  const result = access(statement);
  if (statement.opcode < QcOpcode.Call0 || statement.opcode > QcOpcode.Call8) return result;
  const fn = constantCallee(program, statement);
  if (fn === undefined || fn.parameterSizes.length !== statement.opcode - QcOpcode.Call0) return result;
  return { read: [statement.a, ...fn.parameterSizes.flatMap((size, index) => words(4 + index * 3, size))], write: result.write };
}

function safeFlow(program: QcProgram, start: number, limit: number, dirty: Set<number>, output?: number): boolean {
  const ends = new Map<number, number>(), entered = new Map<number, Set<number>>();
  const functionEnd = (start: number): number => {
    const known = ends.get(start); if (known !== undefined) return known;
    const end = program.functions.reduce((limit, fn) => fn.firstStatement > start ? Math.min(limit, fn.firstStatement) : limit, program.statements.length);
    ends.set(start, end); return end;
  };
  const pending = [{ index: start, remaining: dirty, limit, called: false, localStart: 0, localEnd: 0 }], seen = new Map<number, Set<number>>();
  while (pending.length !== 0) {
    const current = pending.pop(); if (current === undefined || current.remaining.size === 0) continue;
    const { index, remaining, limit, called, localStart, localEnd } = current;
    if (!called && index === limit && output !== undefined) { if (remaining.has(output)) return false; continue; }
    if (index < 0 || index >= limit) return false;
    const key = index * 2 + Number(called), previous = seen.get(key);
    if (previous !== undefined && [...remaining].every(word => previous.has(word))) continue;
    seen.set(key, new Set([...(previous ?? []), ...remaining]));
    const statement = program.statements[index]; if (statement === undefined) return false;
    const { read, write } = sourceAccess(program, statement);
    const tainted = read.some(word => remaining.has(word));
    if (tainted && (called && write.some(word => word >= 28 && (word < localStart || word >= localEnd)) || write.length === 0 || statement.opcode === QcOpcode.Return || statement.opcode === QcOpcode.Done
      || statement.opcode >= QcOpcode.Call0 && statement.opcode <= QcOpcode.Call8)) return false;
    if (statement.opcode >= QcOpcode.Call0 && statement.opcode <= QcOpcode.Call8 && [...remaining].some(word => word >= 28)) {
      const fn = constantCallee(program, statement), candidates = fn === undefined ? program.functions : [fn];
      for (const callee of candidates) {
        if (callee.firstStatement <= 0 || callee.namedBuiltin) continue;
        const parameterEnd = callee.parameterStart + callee.parameterSizes.reduce((count, size) => count + size, 0);
        const incoming = new Set([...remaining].filter(word => word < callee.parameterStart || word >= parameterEnd));
        const previous = entered.get(callee.index);
        if (previous !== undefined && [...incoming].every(word => previous.has(word))) continue;
        entered.set(callee.index, new Set([...(previous ?? []), ...incoming]));
        // Callees may carry dirty frame/ABI temporaries until overwritten, but cannot publish
        // them outside their restored frame. Keep caller dirtiness when traversing the join.
        pending.push({ index: callee.firstStatement, limit: functionEnd(callee.firstStatement), called: true,
          localStart: callee.parameterStart, localEnd: callee.parameterStart + callee.localWords, remaining: incoming });
      }
    }
    const next = new Set([...remaining].filter(word => !write.includes(word)));
    if (statement.opcode >= QcOpcode.StoreF && statement.opcode <= QcOpcode.StoreFn) {
      for (let offset = 0; offset < write.length; offset++) if (remaining.has(statement.a + offset)) next.add(statement.b + offset);
    } else if (tainted) for (const word of write) next.add(word);
    if (statement.opcode === QcOpcode.Return || statement.opcode === QcOpcode.Done) continue;
    const successors = statement.opcode === QcOpcode.Goto ? [index + signedQcBranch(statement.a)]
      : statement.opcode === QcOpcode.If || statement.opcode === QcOpcode.IfNot ? [index + 1, index + signedQcBranch(statement.b)] : [index + 1];
    for (const successor of successors) pending.push({ index: successor, remaining: next, limit, called, localStart, localEnd });
  }
  return true;
}

/** Prove that skipping the region leaves only its declared saved word live. */
function replacementSafe(program: QcProgram, source: ModQcArmorStage, end: number): boolean {
  const writes = new Set<number>(), visiting = new Set<number>();
  // These standard ABI builtins write only the reserved return words.
  const returnOnlyBuiltins = new Set([-7, -9, -12, -13, -36, -37, -38, -43, -51]);
  const collect = (start: number, limit: number, localStart = 0, localEnd = 0): boolean => {
    for (let index = start; index < limit; index++) {
      const statement = program.statements[index]; if (statement === undefined) return false;
      for (const word of access(statement).write) if (word < localStart || word >= localEnd) writes.add(word);
      if (statement.opcode < QcOpcode.Call0 || statement.opcode > QcOpcode.Call8) continue;
      const fn = constantCallee(program, statement);
      if (fn === undefined) return false;
      const entry = fn.index;
      if (fn.namedBuiltin || fn.firstStatement < 0) { if (!returnOnlyBuiltins.has(fn.firstStatement)) return false; continue; }
      if (visiting.has(entry)) return false;
      visiting.add(entry);
      const stop = program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, program.statements.length);
      if (!collect(fn.firstStatement, stop, fn.parameterStart, fn.parameterStart + fn.localWords)) return false;
      visiting.delete(entry);
    }
    return true;
  };
  if (!collect(source.entry, source.exit)) return false;
  writes.delete(source.saved);
  const owner = program.functionNamed(source.function);
  if ([...writes].some(word => word >= 28 && (word < owner.parameterStart || word >= owner.parameterStart + owner.localWords)
    && program.globals.some(global => global.offset === word && global.name !== ""))) return false;
  return safeFlow(program, source.exit, end, writes);
}

/** Scalar-region qualification uses the same opcode access contract as continuation analysis. */
export function qcStatementAccess(statement: QcStatement): { readonly read: readonly number[]; readonly write: readonly number[] } {
  return access(statement);
}

/** Check that skipping qualified private temporary writes cannot affect the source continuation. */
export function qcRegionPrivateWritesAreDead(program: QcProgram, start: number, end: number, writes: ReadonlySet<number>): boolean {
  return safeFlow(program, start, end, new Set(writes));
}

function standaloneSafe(program: QcProgram, source: ModQcArmorStage): boolean {
  const fn = program.functionNamed(source.function), parameters = fn.parameterSizes.reduce((count, size) => count + size, 0);
  const named = new Set(program.globals.flatMap(global => global.name === "" ? [] : words(global.offset, global.type === "vector" ? 3 : 1)));
  const missing = new Set([...words(fn.parameterStart + parameters, fn.localWords - parameters),
    ...program.statements.slice(source.entry, source.exit).flatMap(statement => sourceAccess(program, statement).read)
      .filter(word => word >= 28 && !named.has(word))]);
  for (const word of words(fn.parameterStart, parameters)) missing.delete(word);
  return safeFlow(program, source.entry, source.exit, missing, source.saved);
}

// Source-reviewed entry, join and frame words for the original regular-armor regions.
const originals: ReadonlyMap<string, readonly [number, number, number, number, number]> = new Map([
  ["sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580", [1431, 1455, 1580, 1583, 1588]],
  ["sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830", [377, 401, 855, 858, 863]],
  ["sha256:35a2fdc3acb04bdafe8d0269f5327cd1d5b47971f1ef024429f1572d3201dc82", [2008, 2032, 2061, 2064, 2069]],
  ["sha256:f3610ade82495b6b064f3ba5894d9f40ac9406f92c5f24a1946e87138b4fdf0a", [5145, 5171, 3678, 3681, 3686]],
  ["sha256:36616cd101dfdb1cf1cabfd02c9c50a6bb6b69eaff7d61000f44eeff4291be12", [3060, 3086, 2397, 2400, 2405]],
  ["sha256:f9a2d64e84a6530281c016f1a5557924370fdd9a1a10eb6e785d491352ffacf0", [1317, 1337, 3662, 3665, 3670]],
  ["sha256:39418aa9a7cfcccbc3c195cd757c9f6a20c0b10ba40ce74333de4277144dcb16", [1913, 1933, 4598, 4601, 4606]],
  ["sha256:b828d7dd7150688e5b562cb4ab65f0ec208cebe97804d39f18fd69b7664627ac", [4932, 4954, 5553, 5556, 5561]],
  ["sha256:88b440d1d73ebfcab39d94e78309ba9856012e181b6c66df2cf31018b6563a13", [2493, 2515, 1936, 1939, 1944]],
  ["sha256:1f410f927c1b634f74f538becf8c1c2d04cbdfd3a74759c8fafc425b5fdcb2c0", [2484, 2504, 4443, 4446, 4451]],
  ["sha256:9ed7d5be3f348f02bd009519be7161baaf41a9e8e77eb769d187afab997f3dd9", [2573, 2593, 6214, 6217, 6222]],
]);
const originalScales: ReadonlyMap<string, NonNullable<ModQcArmorStage["regularScale"]>> = new Map([
  ["sha256:f3610ade82495b6b064f3ba5894d9f40ac9406f92c5f24a1946e87138b4fdf0a", [{ caller: "superlavaspike_touch", statement: 32005, scale: 0.5 }]],
  ["sha256:b828d7dd7150688e5b562cb4ab65f0ec208cebe97804d39f18fd69b7664627ac", [{ caller: "superlavaspike_touch", statement: 31488, scale: 0.5 }]],
]);

export function qcArmorStage(program: QcProgram, declared?: ModQcArmorStage): QcArmorStage | null {
  const original = originals.get(program.digest), scales = originalScales.get(program.digest);
  if (declared === undefined && original === undefined) return null;
  const source = declared ?? (original === undefined ? undefined : {
    function: "T_Damage", entry: original[0], exit: original[1], target: original[2], damage: original[3], saved: original[4],
    flags: { kind: "none" }, statements: program.statements.slice(original[0], original[1] + 1),
    ...(scales === undefined ? {} : { regularScale: scales }),
  } satisfies ModQcArmorStage);
  if (source === undefined) throw new QcProgramError("Missing declared QC armor stage");
  const reject = (reason: string): never => { throw new QcProgramError(`Unsupported QC armor stage: ${reason}`, program.source); };
  const fn = program.functionNamed(source.function);
  const end = program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, program.statements.length);
  if (fn.namedBuiltin || fn.firstStatement <= 0 || !Number.isInteger(source.entry) || !Number.isInteger(source.exit)
    || source.entry < fn.firstStatement || source.exit <= source.entry || source.exit >= end) reject("region bounds");
  const local = (word: number, type: "entity" | "float"): void => {
    if (!Number.isInteger(word) || word < fn.parameterStart || word >= fn.parameterStart + fn.localWords
      || !program.globals.some(global => global.offset === word && global.type === type)) reject("typed frame words");
  };
  local(source.target, "entity"); local(source.damage, "float"); local(source.saved, "float");
  const scaleSites = new Set<number>();
  for (const scale of source.regularScale ?? []) {
    const caller = program.functionNamed(scale.caller), statement = program.statements[scale.statement];
    const end = program.functions.reduce((limit, fn) => fn.firstStatement > caller.firstStatement ? Math.min(limit, fn.firstStatement) : limit, program.statements.length);
    if (!Number.isInteger(scale.statement) || scale.statement < caller.firstStatement || scale.statement >= end
      || statement?.opcode !== QcOpcode.Call4 || statement.a !== program.globalsByName.get("T_Damage")?.offset
      || !Number.isFinite(scale.scale) || scale.scale < 0 || scaleSites.has(scale.statement)) reject("original regular armor scale call site");
    scaleSites.add(scale.statement);
  }
  if (new Set([source.target, source.damage, source.saved]).size !== 3) reject("overlapping frame words");
  if (source.flags.kind === "bits") {
    local(source.flags.word, "float");
    if ([source.flags.noArmor, source.flags.noPowerArmor, source.flags.noRegularArmor, source.flags.energy]
      .some(mask => !Number.isInteger(mask) || mask < 0 || mask > 0x7fffff)) reject("source flag masks");
  }
  if (source.statements.length !== source.exit - source.entry + 1) reject("incomplete instruction declaration");
  for (const [offset, expected] of source.statements.entries()) {
    const actual = program.statements[source.entry + offset];
    if (actual === undefined || actual.opcode !== expected.opcode || actual.a !== expected.a || actual.b !== expected.b || actual.c !== expected.c)
      reject("instruction declaration differs from artifact");
  }
  const first = program.statements[source.entry], join = program.statements[source.exit];
  const field = program.globalsByName.get("armortype");
  if (first?.a !== source.target || !(first.opcode === QcOpcode.LoadF && first.b === field?.offset
    || (first.opcode === QcOpcode.StoreF || first.opcode === QcOpcode.StoreEnt) && first.b === 4)) reject("entry must precede regular armor reads or call staging");
  if (join?.opcode !== QcOpcode.SubF || join.a !== source.damage || join.b !== source.saved) reject("damage-minus-savings join");
  const pending = [source.entry], visited = new Set<number>();
  while (pending.length !== 0) {
    const index = pending.pop();
    if (index === undefined || index === source.exit || visited.has(index)) continue;
    if (index < source.entry || index > source.exit) reject("control flow leaves regular armor region");
    visited.add(index);
    const statement = program.statements[index];
    if (statement === undefined) return reject("missing statement");
    const { opcode, a, b, c } = statement;
    if (opcode === QcOpcode.Done || opcode === QcOpcode.Return || opcode === QcOpcode.State) reject("region exits or changes actor state");
    const destination = opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn ? b
      : opcode >= QcOpcode.MulF && opcode <= QcOpcode.Address || opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn || opcode >= QcOpcode.And ? c : -1;
    const width = [QcOpcode.StoreV, QcOpcode.MulFV, QcOpcode.MulVF, QcOpcode.AddV, QcOpcode.SubV, QcOpcode.LoadV].includes(opcode) ? 3 : 1;
    if (source.damage >= destination && source.damage < destination + width || source.target >= destination && source.target < destination + width)
      reject("region changes captured actor or damage local");
    const successors = opcode === QcOpcode.Goto ? [index + signedQcBranch(a)]
      : opcode === QcOpcode.If || opcode === QcOpcode.IfNot ? [index + 1, index + signedQcBranch(b)] : [index + 1];
    if (successors.some(next => next <= index)) reject("looping armor region");
    pending.push(...successors);
  }
  const replaceable = replacementSafe(program, source, end);
  return Object.freeze({ ...source, flags: Object.freeze({ ...source.flags }), statements: Object.freeze(source.statements.map(statement => Object.freeze({ ...statement }))),
    ...(source.regularScale === undefined ? {} : { regularScale: Object.freeze(source.regularScale.map(site => Object.freeze({ ...site }))) }),
    region: Object.freeze({ functionIndex: fn.index, entry: source.entry, exit: source.exit, ...(replaceable ? { replaceable: true } : {}),
      ...(replaceable && standaloneSafe(program, source) ? { standalone: Object.freeze({ saved: source.saved }) } : {}) }) });
}
