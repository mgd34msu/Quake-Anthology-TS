import type { QcFunctionBoundary, QcInlineBoundary, QcInlineRegion, QcMachine } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, type QcProgram } from "../../../compat/qc/program.ts";

interface RepeatGate { readonly region: QcInlineRegion; readonly released: number; readonly value: number; }
export interface QcWeaponStage {
  readonly dispatcher: number;
  readonly client?: { readonly spawn: number; readonly selectSpawn: number; readonly objectives: "none" };
  readonly continuations: ReadonlySet<number>;
  readonly repeats: readonly RepeatGate[];
}

/** Original progs106 weapons.qc dispatcher and player.qc next-shot release branches. */
export function qcWeaponStage(program: QcProgram): QcWeaponStage | null {
  if (program.digest !== "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580") return null;
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
  const clientFunction = (name: string, index: number, first: number, parameters: number, locals: number): number => {
    const original = program.functionNamed(name);
    if (original.index !== index || original.firstStatement !== first || original.parameterStart !== parameters || original.localWords !== locals
      || original.parameterSizes.length !== 0 || original.namedBuiltin) throw new QcProgramError(`Unsupported original client stage ${name}`);
    return index;
  };
  const client = { spawn: clientFunction("PutClientInServer", 229, 6083, 4114, 1), selectSpawn: clientFunction("SelectSpawnPoint", 228, 6007, 4093, 3), objectives: "none" } satisfies QcWeaponStage["client"];
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
