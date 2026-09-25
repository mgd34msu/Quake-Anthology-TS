import type { ItemId } from "../../../contracts/gameplay.ts";
import type { QcPickupCallerDeclaration, QcPickupScalar } from "../../../contracts/qc-pickup-callers.ts";
import type { PickupResource } from "../../../contracts/original-pickups.ts";
import { namespaced, type SaveReader } from "../../../persistence/value.ts";
import { QcOpcode, QcProgramError, signedQcBranch, type QcProgram } from "../../../compat/qc/program.ts";
import type { QcPickupStage } from "./pickup-stage.ts";

function scalar(reader: SaveReader): QcPickupScalar {
  return reader.field("kind").choice("field", "global") === "field"
    ? { kind: "field", name: reader.field("name").string() } : { kind: "global", word: reader.field("word").integer(0) };
}
function item(reader: SaveReader) {
  const resource = reader.field("resource").nullable((value): PickupResource => value.field("kind").choice("protection", "inventory") === "protection"
    ? { kind: "protection", channel: value.field("channel").choice("regular", "powered") }
    : { kind: "inventory", item: namespaced(value.field("item")) });
  return { item: namespaced(reader.field("item")), resource,
    ...(reader.field("count").value === undefined ? {} : { count: scalar(reader.field("count")) }) };
}
export function readQcPickupCaller(reader: SaveReader): QcPickupCallerDeclaration {
  const descriptor = reader.field("descriptor"), kind = descriptor.field("kind").choice("constant", "string", "float");
  return { function: reader.field("function").string(), descriptor: kind === "constant" ? { kind, ...item(descriptor) }
    : kind === "string" ? { kind, field: descriptor.field("field").string(), values: descriptor.field("values").list(value => ({ ...item(value), value: value.field("value").string() })) }
    : { kind, field: descriptor.field("field").string(), values: descriptor.field("values").list(value => ({ ...item(value), value: value.field("value").finite() })) },
    ...(reader.field("dropped").value === undefined ? {} : { dropped: scalar(reader.field("dropped")) }),
    regions: reader.field("regions").list(region => {
      const operation = region.field("operation"), kind = operation.field("kind").choice("decision", "admission", "grant", "consume");
      return { entry: region.field("entry").integer(0), exit: region.field("exit").integer(0),
        statements: region.field("statements").list(value => ({ opcode: value.field("opcode").integer(0), a: value.field("a").integer(0), b: value.field("b").integer(0), c: value.field("c").integer(0) })),
        operation: kind === "decision" ? { kind, word: operation.field("word").integer(0), accepted: operation.field("accepted").finite() } : { kind } };
    }) };
}

/** Declarations are bound to the enclosing compatibility document's exact program digest. */
export function qcDeclaredPickupStages(program: QcProgram, declarations: readonly QcPickupCallerDeclaration[]): readonly QcPickupStage[] {
  const callers = new Set<number>();
  const fail = (reason: string): never => { throw new QcProgramError(`Invalid declared pickup caller: ${reason}`, program.source); };
  const global = (word: number): void => {
    if (!Number.isInteger(word) || word < 0 || word * 4 >= program.initialGlobals.byteLength) fail("global word is outside source memory");
  };
  const field = (name: string, type: "string" | "float"): void => {
    if (program.fieldsByName.get(name)?.type !== type) fail(`source field ${name} is not ${type}`);
  };
  const value = (input: QcPickupScalar): QcPickupScalar => {
    if (input.kind === "field") field(input.name, "float"); else global(input.word);
    return Object.freeze({ ...input });
  };
  return Object.freeze(declarations.map(declaration => {
    const fn = program.functionNamed(declaration.function);
    if (fn.firstStatement <= 0 || fn.namedBuiltin || fn.parameterSizes.length !== 0 || callers.has(fn.index)) fail("duplicate or non-touch source function");
    callers.add(fn.index);
    const end = program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, program.statements.length);
    const descriptor = declaration.descriptor;
    if (descriptor.kind !== "constant") {
      field(descriptor.field, descriptor.kind);
      if (descriptor.values.length === 0 || new Set(descriptor.values.map(value => value.value)).size !== descriptor.values.length) fail("empty or ambiguous source item descriptors");
      if (descriptor.kind === "float" && descriptor.values.some(value => Math.fround(value.value) !== value.value)) fail("item discriminator is not an exact source float");
    }
    const regions = [...declaration.regions].sort((a, b) => a.entry - b.entry);
    if (!regions.some(region => region.operation.kind === "decision" || region.operation.kind === "admission")) fail("missing recipient admission boundary");
    let previousEnd = fn.firstStatement;
    for (const region of regions) {
      if (!Number.isInteger(region.entry) || !Number.isInteger(region.exit) || region.entry < previousEnd || region.exit <= region.entry || region.exit >= end) fail("overlapping or out-of-function regions");
      previousEnd = region.exit;
      if (region.statements.length !== region.exit - region.entry + 1) fail("instruction proof must include the region and its join");
      for (const [offset, expected] of region.statements.entries()) {
        const actual = program.statements[region.entry + offset];
        if (actual === undefined || actual.opcode !== expected.opcode || actual.a !== expected.a || actual.b !== expected.b || actual.c !== expected.c) fail("instruction proof differs from original artifact");
      }
      if (region.operation.kind === "decision") {
        global(region.operation.word);
        const join = program.statements[region.exit];
        if (join?.a !== region.operation.word || (join.opcode !== QcOpcode.If && join.opcode !== QcOpcode.IfNot)) fail("decision join does not consume the declared source predicate");
        if (Math.fround(region.operation.accepted) !== region.operation.accepted) fail("accepted decision is not an exact source float");
      }
      for (let at = fn.firstStatement; at < end; at++) {
        const statement = program.statements[at]; if (statement === undefined) return fail("missing source instruction");
        const target = statement.opcode === QcOpcode.Goto ? at + signedQcBranch(statement.a)
          : statement.opcode === QcOpcode.If || statement.opcode === QcOpcode.IfNot ? at + signedQcBranch(statement.b) : null;
        if (target !== null && (at < region.entry || at >= region.exit) && target > region.entry && target < region.exit) fail("source branch enters the middle of a declared region");
      }
    }
    const describe = (entry: { readonly item: ItemId; readonly resource: PickupResource | null; readonly count?: QcPickupScalar }) =>
      ({ item: entry.item, resource: entry.resource === null ? null : Object.freeze({ ...entry.resource }), ...(entry.count === undefined ? {} : { count: value(entry.count) }) });
    return Object.freeze({ functionIndex: fn.index,
      descriptor: descriptor.kind === "constant" ? Object.freeze({ kind: descriptor.kind, value: Object.freeze({ ...describe(descriptor), value: 0 }) })
        : Object.freeze({ kind: descriptor.kind, field: descriptor.field, values: Object.freeze(descriptor.values.map(entry => Object.freeze({ ...describe(entry), value: entry.value }))) }),
      ...(declaration.dropped === undefined ? {} : { dropped: value(declaration.dropped) }),
      regions: Object.freeze(regions.map(region => Object.freeze({ region: Object.freeze({ functionIndex: fn.index, entry: region.entry, exit: region.exit, replaceable: true }), operation: Object.freeze({ ...region.operation }) }))),
    });
  }));
}
