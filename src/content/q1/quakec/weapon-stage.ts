import type { ActorId } from "../../../contracts/identity.ts";
import type { ModCallbackInput, ModRuntimeValue, ModSourceCall } from "../../../contracts/mod-callbacks.ts";
import { validateQcSourceCall, withQcSourceCall } from "../../../compat/qc/source-call.ts";
import type { QcPrimaryWeaponStageDeclaration, QcWeaponStageDeclaration } from "../../../contracts/qc-weapon-stage.ts";
import type { QcFunctionBoundary, QcInlineBoundary, QcInlineRegion, QcMachine } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, signedQcBranch, type QcFunction, type QcProgram } from "../../../compat/qc/program.ts";

export interface QcClientStageCall { readonly functionIndex: number; readonly call: ModSourceCall; }
interface RepeatGate { readonly region: QcInlineRegion; readonly released: number; readonly value: number; }
export interface QcWeaponStage {
  readonly dispatcher: number;
  readonly client?: { readonly spawn: QcClientStageCall; readonly selectSpawn: QcClientStageCall; readonly objectives: { readonly kind: "none" } | { readonly kind: "call"; readonly call: QcClientStageCall } };
  readonly continuations: ReadonlySet<number>;
  readonly repeats: readonly RepeatGate[];
}

/** Artifact-qualified weapons.qc dispatchers and player.qc next-shot release branches. */
export function qcWeaponStage(program: QcProgram, declared?: QcPrimaryWeaponStageDeclaration): QcWeaponStage | null {
  if (declared !== undefined) {
    const stage = qcDeclaredWeaponStage(program, declared);
    const source = (declaration: string | ModSourceCall, result: "void" | "entity"): QcClientStageCall => {
      const call = typeof declaration === "string" ? { function: declaration, arguments: [], globals: [] } : declaration;
      validateQcSourceCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "client stage");
      const name = call.function, fn = program.functionNamed(name);
      if (fn.firstStatement <= 0 || fn.namedBuiltin) throw new QcProgramError("QC client stage requires an original source function");
      const end = program.functions.reduce((end, other) => other.firstStatement > fn.firstStatement ? Math.min(end, other.firstStatement) : end, program.statements.length);
      const returns = program.statements.slice(fn.firstStatement, end).filter(statement => (statement.opcode === QcOpcode.Return || statement.opcode === QcOpcode.Done) && statement.a !== 0);
      if (result === "void" ? returns.length !== 0 : returns.length === 0 || returns.some(statement => !program.globals.some(global => global.offset === statement.a && global.type === "entity")))
        throw new QcProgramError(`QC client stage ${name} does not return ${result}`);
      return Object.freeze({ functionIndex: fn.index, call });
    };
    const client = declared.client, objectives = client.objectives;
    return Object.freeze({ ...stage, client: Object.freeze({ spawn: source(client.spawn, "void"), selectSpawn: source(client.selectSpawn, "entity"),
      objectives: objectives.kind === "none" ? Object.freeze({ kind: objectives.kind }) : Object.freeze({ kind: objectives.kind, call: source("call" in objectives ? objectives.call : objectives.function, "void") }) }) });
  }
  const qw = program.digest === "sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830";
  if (!qw && program.digest !== "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580") return null;
  const fn = (name: string, index: number, first: number): number => {
    const original = program.functionNamed(name);
    if (original.index !== index || original.firstStatement !== first || original.localWords !== 0
      || original.parameterSizes.length !== 0 || original.namedBuiltin) throw new QcProgramError(`Unsupported original weapon stage ${name}`);
    return index;
  };
  const statement = (index: number, opcode: QcOpcode, a: number, b: number): void => {
    const actual = program.statements[index];
    if (actual?.opcode !== opcode || actual.a !== a || actual.b !== b)
      throw new QcProgramError(`Original weapon stage statement ${index} differs from its qualified artifact`);
  };
  const clientFunction = (name: string, index: number, first: number, parameters: number, locals: number): QcClientStageCall => {
    const original = program.functionNamed(name);
    if (original.index !== index || original.firstStatement !== first || original.parameterStart !== parameters || original.localWords !== locals
      || original.parameterSizes.length !== 0 || original.namedBuiltin) throw new QcProgramError(`Unsupported original client stage ${name}`);
    return { functionIndex: index, call: { function: name, arguments: [], globals: [] } };
  };
  if (qw) {
    const client = { spawn: clientFunction("PutClientInServer", 193, 5554, 3621, 2), selectSpawn: clientFunction("SelectSpawnPoint", 191, 5465, 3585, 9), objectives: { kind: "none" } } satisfies QcWeaponStage["client"];
    const dispatcher = fn("W_WeaponFrame", 170, 4618);
    fn("player_run", 215, 7185);
    const continuations = new Set<number>();
    const families: readonly (readonly [string, number, readonly number[]])[] = [
      ["shot", 217, [7237, 7242, 7246, 7250, 7254, 7258]],
      ["axe", 223, [7262, 7266, 7270, 7275]], ["axeb", 227, [7279, 7283, 7287, 7292]],
      ["axec", 231, [7296, 7300, 7304, 7309]], ["axed", 235, [7313, 7317, 7321, 7326]],
      ["nail", 239, [7330, 7356]], ["light", 241, [7382, 7405]],
      ["rocket", 243, [7428, 7433, 7437, 7441, 7445, 7449]],
    ];
    for (const [family, firstIndex, starts] of families) for (const [ordinal, first] of starts.entries())
      continuations.add(fn(`player_${family}${ordinal + 1}`, firstIndex + ordinal, first));
    const gates: readonly (readonly [number, number, number, boolean])[] = [[239, 7332, 4574, true], [240, 7358, 4588, true], [241, 7384, 4603, false], [242, 7407, 4615, false]];
    const repeats = gates.map(([functionIndex, entry, held, impulse]): RepeatGate => {
      const exact = (offset: number, opcode: QcOpcode, a: number, b: number, c: number): void => {
        statement(entry + offset, opcode, a, b);
        if (program.statements[entry + offset]?.c !== c) throw new QcProgramError("QW weapon release temporary differs");
      };
      exact(0, QcOpcode.LoadF, 28, 165, held);
      exact(1, QcOpcode.NotF, held, 0, held + 1);
      exact(2, QcOpcode.Or, held + 1, 3457, held + 2);
      if (impulse) {
        exact(3, QcOpcode.LoadF, 28, 168, held + 3);
        exact(4, QcOpcode.Or, held + 2, held + 3, held + 4);
      }
      const exit = entry + (impulse ? 5 : 3), released = held + (impulse ? 4 : 2);
      statement(exit, QcOpcode.IfNot, released, 3);
      statement(exit + 1, QcOpcode.Call0, 2112, 0);
      statement(exit + 2, QcOpcode.Return, 0, 0);
      return { region: { functionIndex, entry, exit, replaceable: true }, released, value: 1 };
    });
    return { dispatcher, client, continuations, repeats };
  }
  const client = { spawn: clientFunction("PutClientInServer", 229, 6083, 4114, 1), selectSpawn: clientFunction("SelectSpawnPoint", 228, 6007, 4093, 3), objectives: { kind: "none" } } satisfies QcWeaponStage["client"];
  const dispatcher = fn("W_WeaponFrame", 206, 5047);
  fn("player_run", 248, 7380);
  const continuations = new Set<number>();
  const families: readonly (readonly [string, number, readonly number[]])[] = [
    ["shot", 249, [7421, 7429, 7433, 7437, 7441, 7445]],
    ["axe", 255, [7449, 7453, 7457, 7462]], ["axeb", 259, [7466, 7470, 7474, 7479]],
    ["axec", 263, [7483, 7487, 7491, 7496]], ["axed", 267, [7500, 7504, 7508, 7513]],
    ["nail", 271, [7517, 7543]], ["light", 273, [7569, 7594]],
    ["rocket", 275, [7619, 7627, 7631, 7635, 7639, 7643]],
  ];
  for (const [family, firstIndex, starts] of families) for (const [ordinal, first] of starts.entries())
    continuations.add(fn(`player_${family}${ordinal + 1}`, firstIndex + ordinal, first));
  const gates: readonly (readonly [number, number, number])[] = [[271, 7522, 4951], [272, 7548, 4965], [273, 7574, 4980], [274, 7599, 4994]];
  const repeats = gates.map(([functionIndex, entry, held]): RepeatGate => {
    statement(entry, QcOpcode.LoadF, 28, 170);
    if (program.statements[entry]?.c !== held) throw new QcProgramError("Original weapon release temporary differs");
    statement(entry + 1, QcOpcode.NotF, held, 0);
    if (program.statements[entry + 1]?.c !== held + 1) throw new QcProgramError("Original weapon release result differs");
    statement(entry + 2, QcOpcode.IfNot, held + 1, 3);
    statement(entry + 3, QcOpcode.Call0, 2597, 0);
    statement(entry + 4, QcOpcode.Return, 0, 0);
    return { region: { functionIndex, entry, exit: entry + 2, replaceable: true }, released: held + 1, value: 1 };
  });
  return { dispatcher, client, continuations, repeats };
}

/** Invoke the declared source ABI inside the original engine client context. */
export function invokeQcClientStage(machine: QcMachine, stage: QcClientStageCall, actor: ActorId, time: number,
  reference: (actor: ActorId | null) => number): number {
  const globals = machine.globals, selfOffset = machine.globalOffset("self"), otherOffset = machine.globalOffset("other");
  const self = globals.int(selfOffset), other = globals.int(otherOffset);
  const inputs = new Map<ModCallbackInput, ModRuntimeValue>([["self", { kind: "actor", value: actor }], ["time", { kind: "float", value: time }]]);
  try {
    globals.setInt(selfOffset, reference(actor)); globals.setInt(otherOffset, reference(null));
    globals.setFloat(machine.globalOffset("time"), time);
    return withQcSourceCall(machine, stage.call, inputs, reference, count => {
      machine.execute(stage.functionIndex, count);
      return globals.int(1);
    });
  } finally { globals.setInt(selfOffset, self); globals.setInt(otherOffset, other); }
}

/** Original source callers may pass the client explicitly instead of using global self. */
export function qcClientStageSelf(machine: QcMachine, stage: QcClientStageCall): number {
  let client: number | undefined;
  const admit = (reference: number): void => {
    if (client !== undefined && client !== reference) throw new QcProgramError("QC client call has conflicting source self inputs");
    client = reference;
  };
  stage.call.arguments.forEach((value, index) => { if (value.kind === "input" && value.name === "self") admit(machine.argInt(index)); });
  for (const global of stage.call.globals) if (global.value.kind === "input" && global.value.name === "self") admit(machine.globals.int(machine.globalOffset(global.name)));
  return client ?? machine.globals.int(machine.globalOffset("self"));
}

export function qcDeclaredWeaponStage(program: QcProgram, declared: QcWeaponStageDeclaration): QcWeaponStage {
  const fn = (name: string) => {
    const value = program.functionNamed(name);
    if (value.index === 0 || value.firstStatement <= 0 || value.namedBuiltin || value.parameterSizes.length !== 0) throw new Error("QC weapon stage requires original parameterless source functions");
    const end = program.functions.reduce((end, other) => other.firstStatement > value.firstStatement ? Math.min(end, other.firstStatement) : end, program.statements.length);
    if (program.statements.slice(value.firstStatement, end).some(statement => (statement.opcode === QcOpcode.Return || statement.opcode === QcOpcode.Done) && statement.a !== 0)) throw new Error("QC weapon stage function returns a source value");
    return value;
  };
  const dispatcher = fn(declared.dispatcher), continuations = new Set(declared.continuations.map(name => fn(name).index));
  const ranges: { entry: number; exit: number }[] = [];
  const named = new Set(program.globals.filter(global => global.name !== "" && global.name !== "IMMEDIATE").flatMap(global => Array.from({ length: global.type === "vector" ? 3 : 1 }, (_, index) => global.offset + index)));
  const temporary = (word: number, owner: QcFunction): boolean => Number.isInteger(word) && word >= 28 && word * 4 < program.initialGlobals.length
    && (!named.has(word) || word >= owner.parameterStart && word < owner.parameterStart + owner.localWords);
  const pure = new Set([QcOpcode.LoadF, QcOpcode.NotF, QcOpcode.EqF, QcOpcode.NeF, QcOpcode.Le, QcOpcode.Ge, QcOpcode.Lt, QcOpcode.Gt, QcOpcode.And, QcOpcode.Or, QcOpcode.BitAnd, QcOpcode.BitOr,
    QcOpcode.AddF, QcOpcode.SubF, QcOpcode.MulF, QcOpcode.DivF]);
  if (continuations.size === 0 || continuations.size !== declared.continuations.length || continuations.has(dispatcher.index)) throw new Error("QC weapon continuation declarations overlap or are empty");
  const repeats = declared.repeats.map(source => {
    const owner = fn(source.function), end = program.functions.reduce((end, other) => other.firstStatement > owner.firstStatement ? Math.min(end, other.firstStatement) : end, program.statements.length);
    if (!continuations.has(owner.index) || ranges.some(range => source.entry <= range.exit && source.exit >= range.entry) || !Number.isInteger(source.entry) || !Number.isInteger(source.exit)
      || source.entry < owner.firstStatement || source.exit <= source.entry || source.exit + 2 >= end || !temporary(source.result.word, owner)
      || source.result.value !== 0 && source.result.value !== 1 || source.statements.length !== source.exit - source.entry + 1) throw new Error("QC weapon repeat boundary is outside its original continuation");
    ranges.push({ entry: source.entry, exit: source.exit });
    let resultWritten = false;
    source.statements.forEach((expected, offset) => { const actual = program.statements[source.entry + offset];
      if (actual === undefined || actual.opcode !== expected.opcode || actual.a !== expected.a || actual.b !== expected.b || actual.c !== expected.c) throw new Error("QC weapon repeat boundary differs from its declared original instructions");
      if (offset === source.statements.length - 1) return;
      if (!pure.has(actual.opcode) || !temporary(actual.c, owner)) throw new Error("QC weapon repeat must be a pure scalar predicate using source temporaries");
      resultWritten ||= actual.c === source.result.word;
    });
    const join = program.statements[source.exit], release = program.statements[source.exit + 1], returned = program.statements[source.exit + 2];
    if (!resultWritten || join?.a !== source.result.word || join.opcode !== (source.result.value === 0 ? QcOpcode.If : QcOpcode.IfNot) || signedQcBranch(join.b) !== 3
      || release?.opcode !== QcOpcode.Call0 || returned?.opcode !== QcOpcode.Return || returned.a !== 0) throw new Error("QC weapon predicate does not join its original release-call and return branch");
    const original = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
    if (release.a < 0 || release.a * 4 + 4 > original.byteLength) throw new Error("QC weapon release call is outside source globals");
    const callee = program.functionAt(original.getInt32(release.a * 4, true)); fn(callee.name);
    return { region: { functionIndex: owner.index, entry: source.entry, exit: source.exit, replaceable: true }, released: source.result.word, value: source.result.value } satisfies QcWeaponStage["repeats"][number];
  });
  return Object.freeze({ dispatcher: dispatcher.index, continuations, repeats: Object.freeze(repeats.map(gate => Object.freeze({ ...gate, region: Object.freeze({ ...gate.region }) }))) });
}


/** Selection gates new attacks; committed melee hits and source animation finish normally. */
export class QcWeaponStageBinding {
  constructor(readonly stage: QcWeaponStage, private readonly machine: () => QcMachine,
    private readonly selected: (reference: number) => boolean) {}

  settled(reference: number): boolean {
    const vm = this.machine();
    return !this.stage.continuations.has(vm.entities.fromReference(reference).int(vm.fieldOffset("think")));
  }

  composeFunctions(inner: QcFunctionBoundary): QcFunctionBoundary {
    if (inner.functions.has(this.stage.dispatcher)) throw new QcProgramError("Original weapon dispatcher already has a boundary owner");
    return { functions: new Set([...inner.functions, this.stage.dispatcher]), run: (call, execute) => {
      if (call.functionIndex !== this.stage.dispatcher) return inner.run(call, execute);
      const vm = this.machine();
      return this.selected(vm.globals.int(vm.globalOffset("self"))) ? execute() : execute.skip([0, 0, 0]);
    } };
  }

  composeRegions(inner: QcInlineBoundary): QcInlineBoundary {
    for (const gate of this.stage.repeats) if (inner.regions.some(region => region.entry === gate.region.entry))
      throw new QcProgramError("Original weapon repeat gate already has a boundary owner");
    return { regions: [...inner.regions, ...this.stage.repeats.map(gate => gate.region)], run: (region, execute) => {
      const gate = this.stage.repeats.find(value => value.region.entry === region.entry);
      if (gate === undefined) return inner.run(region, execute);
      const vm = this.machine();
      if (this.selected(vm.globals.int(vm.globalOffset("self")))) return execute();
      execute();
      vm.globals.setFloat(gate.released, gate.value);
      return undefined;
    } };
  }
}
