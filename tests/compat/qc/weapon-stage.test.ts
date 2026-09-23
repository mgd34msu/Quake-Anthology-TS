import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins } from "../../../src/compat/qc/index.ts";
import type { QcBuiltin, QcHostBuiltinName } from "../../../src/compat/qc/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { qcWeaponStage, QcWeaponStageBinding } from "../../../src/content/q1/quakec/weapon-stage.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";

test("original id1 selected weapon boundary preserves committed axe, retires repeat shots, and continues post-think", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK");
  try {
    const entry = archive.findEntries("progs.dat").at(-1); if (entry === undefined) throw new Error("Missing original id1 program");
    const program = loadQcProgram(await archive.readEntry(entry)), stage = qcWeaponStage(program);
    if (stage === null) throw new Error("Missing qualified original weapon stage");
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 4, 3);
    const selected = new Set([entities.reference(2)]), sounds: string[] = [], traces: number[] = [];
    const host = new Map<QcHostBuiltinName, QcBuiltin>([
      ["sound", vm => { sounds.push(vm.strings.get(vm.globals.int(10))); return undefined; }],
      ["traceline", vm => { traces.push(vm.globals.int(vm.globalOffset("self"))); vm.globals.setFloat(vm.globalOffset("trace_fraction"), 1); return undefined; }],
    ]);
    const binding = new QcWeaponStageBinding(stage, () => vm, reference => selected.has(reference));
    const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind: "netquake", host, random: new SourceRandom(1) }), serverActive: () => true,
      functionBoundary: binding.composeFunctions({ functions: new Set(), run: (_call, execute) => execute() }),
      inlineBoundary: binding.composeRegions({ regions: [], run: (_region, execute) => execute() }) });
    const words = entities.at(1), field = (name: string) => vm.fieldOffset(name), run = (name: string) => vm.execute(program.functionNamed(name).index);
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(1)); vm.globals.setFloat(vm.globalOffset("time"), 10);
    words.setFloat(field("weapon"), 4096); words.setFloat(field("button0"), 1); words.setFloat(field("ammo_nails"), 20); words.setFloat(field("ammo_cells"), 20);
    words.setFloat(field("currentammo"), 20); words.setFloat(field("attack_finished"), 0);
    run("W_WeaponFrame"); expect(words.float(field("attack_finished"))).toBe(0);
    run("player_axe2"); expect(binding.settled(entities.reference(1))).toBe(false);
    vm.execute(words.int(field("think"))); expect(traces).toEqual([entities.reference(1)]);
    vm.execute(words.int(field("think"))); expect(binding.settled(entities.reference(1))).toBe(true);
    for (const callback of ["player_nail1", "player_nail2", "player_light1", "player_light2"]) {
      run(callback);
      expect(binding.settled(entities.reference(1))).toBe(true);
      expect(words.float(field("button0"))).toBe(1);
      expect(words.float(field("ammo_nails"))).toBe(20); expect(words.float(field("ammo_cells"))).toBe(20);
      expect(words.float(field("currentammo"))).toBe(20); expect(words.float(field("attack_finished"))).toBe(0);
    }
    words.setVector(field("view_ofs"), { x: 0, y: 0, z: 22 }); words.setFloat(field("health"), 100);
    words.setFloat(field("flags"), 512); words.setFloat(field("jump_flag"), -400); words.setFloat(field("watertype"), -1);
    words.setFloat(field("super_damage_finished"), 9); words.setFloat(field("super_time"), 20); words.setFloat(field("items"), 4194304);
    run("PlayerPostThink");
    expect(sounds).toContain("player/land.wav"); expect(words.float(field("jump_flag"))).toBe(0);
    expect(words.float(field("super_damage_finished"))).toBe(0); expect(words.float(field("items"))).toBe(0);
    const other = entities.at(2);
    other.setFloat(field("weapon"), 4096); other.setFloat(field("items"), 4096); other.setFloat(field("button0"), 1);
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(2)); run("W_WeaponFrame");
    expect(other.float(field("attack_finished"))).toBeGreaterThan(10);
    expect(binding.settled(entities.reference(2))).toBe(false);
  } finally { archive.close(); }
});
