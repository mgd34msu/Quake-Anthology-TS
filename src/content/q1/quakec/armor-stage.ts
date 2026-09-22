import type { ModQcArmorStage } from "../../../contracts/mod-callbacks.ts";
import type { QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, signedQcBranch, type QcProgram } from "../../../compat/qc/program.ts";

export interface QcArmorStage extends ModQcArmorStage { readonly region: QcInlineRegion; }

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

export function qcArmorStage(program: QcProgram, declared?: ModQcArmorStage): QcArmorStage | null {
  const original = originals.get(program.digest);
  if (declared === undefined && original === undefined) return null;
  const source = declared ?? (original === undefined ? undefined : {
    function: "T_Damage", entry: original[0], exit: original[1], target: original[2], damage: original[3], saved: original[4],
    flags: { kind: "none" }, statements: program.statements.slice(original[0], original[1] + 1),
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
  return Object.freeze({ ...source, flags: Object.freeze({ ...source.flags }), statements: Object.freeze(source.statements.map(statement => Object.freeze({ ...statement }))),
    region: Object.freeze({ functionIndex: fn.index, entry: source.entry, exit: source.exit }) });
}
