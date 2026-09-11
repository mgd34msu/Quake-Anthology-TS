import { describe, expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { QcEntityMemory, QcMachine, QcStrings, QuakeCExecutor, applyQcEntityPairs, classicQcEntityLayout, createQcActorBindings, createQcBuiltins, createQcSourceSlotStorage, describeQcHost, loadQcProgram, saveQcEntityPairs } from "../../../src/compat/qc/index.ts";
import type { QcBuiltin, QcHostBuiltinName, QcProgram } from "../../../src/compat/qc/index.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";

const corpus = new URL("../../../../qfiles/q1/", import.meta.url).pathname;
async function readProgram(path: string): Promise<QcProgram> {
  const archive = await openArchive(corpus + path);
  try {
    const entry = archive.findEntries("progs.dat").at(-1);
    if (entry === undefined) throw new Error(`No progs.dat in ${path}`);
    return loadQcProgram(await archive.readEntry(entry), undefined, `${path}:progs.dat`);
  } finally { archive.close(); }
}
function machineFor(program: QcProgram, host?: ReadonlyMap<QcHostBuiltinName, QcBuiltin>): QcMachine {
  const builtins = host === undefined ? createQcBuiltins({ kind: "rerelease" }) : createQcBuiltins({ kind: "rerelease", host });
  return new QcMachine({ program, entities: new QcEntityMemory({ strideBytes: 96 + program.entityFieldWords * 4, variablesOffsetBytes: 96, fieldWords: program.entityFieldWords }, 16, 3),
    numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins, serverActive: () => true });
}
const haveCorpus = await Bun.file(corpus + "rerelease/id1/pak0.pak").exists();
describe.skipIf(!haveCorpus)("real QuakeC programs", () => {
  test("loads classic, all rerelease programs and the independent QuakeWorld layout", async () => {
    const classic = await readProgram("id1/PAK0.PAK");
    expect(classic.api.systemCrc).toBe(5927);
    for (const name of ["id1", "hipnotic", "rogue", "dopa", "mg1", "mg3", "ctf"]) {
      const program = await readProgram(`rerelease/${name}/pak0.pak`);
      expect(program.functions.length).toBeGreaterThan(500);
      expect(program.functions.filter(fn => fn.namedBuiltin).length).toBe(name === "ctf" ? 21 : 18);
      expect(program.fieldsByName.get("think")?.type).toBe("function");
      if (name === "mg3") expect(program.globalsByName.get("poses[0]")?.nativeType).toBe(10);
    }
    const qw = loadQcProgram(new Uint8Array(await Bun.file(corpus + "qw/qwprogs.dat").arrayBuffer()));
    expect(qw.api.kind).toBe("q1-quakeworld");
    expect(qw.functionsByName.has("SpectatorThink")).toBe(true);
  });
  test("executes source SUB_CalcMove and preserves source pointer/think state", async () => {
    const vm = machineFor(await readProgram("rerelease/id1/pak0.pak"));
    vm.globals.setInt(vm.globalOffset("self"), vm.entities.reference(1));
    const self = vm.entities.at(1);
    self.setVector(vm.fieldOffset("origin"), { x: 10, y: 20, z: 30 });
    self.setFloat(vm.fieldOffset("ltime"), 5);
    vm.globals.setVector(4, { x: 110, y: 20, z: 30 });
    vm.globals.setFloat(7, 50);
    vm.globals.setInt(10, vm.program.functionNamed("SUB_Null").index);
    vm.execute(vm.program.functionNamed("SUB_CalcMove").index, 3);
    expect(self.vector(vm.fieldOffset("velocity"))).toEqual({ x: 50, y: 0, z: 0 });
    expect(self.float(vm.fieldOffset("nextthink"))).toBe(7);
    expect(self.int(vm.fieldOffset("think"))).toBe(vm.program.functionNamed("SUB_CalcMoveDone").index);
    expect(self.vector(vm.fieldOffset("finaldest"))).toEqual({ x: 110, y: 20, z: 30 });
    expect(vm.depth).toBe(0);
  });
  test("a builtin re-enters QC immediately, then its caller continues", async () => {
    const observed: number[] = [];
    const host = new Map<QcHostBuiltinName, QcBuiltin>();
    host.set("setorigin", vm => {
      const self = vm.entities.fromReference(vm.argInt(0));
      self.setVector(vm.fieldOffset("origin"), vm.argVector(1));
      self.setVector(vm.fieldOffset("angles"), { x: 0, y: -1, z: 0 });
      vm.execute(vm.program.functionNamed("SetMovedir").index);
      observed.push(self.vector(vm.fieldOffset("movedir")).z);
    });
    const vm = machineFor(await readProgram("rerelease/id1/pak0.pak"), host);
    vm.globals.setInt(vm.globalOffset("self"), vm.entities.reference(1));
    const self = vm.entities.at(1);
    self.setVector(vm.fieldOffset("finaldest"), { x: 12, y: 13, z: 14 });
    self.setInt(vm.fieldOffset("think1"), vm.program.functionNamed("SUB_Null").index);
    vm.execute(vm.program.functionNamed("SUB_CalcMoveDone").index);
    expect(observed).toEqual([1]);
    expect(self.vector(vm.fieldOffset("origin"))).toEqual({ x: 12, y: 13, z: 14 });
    expect(self.float(vm.fieldOffset("nextthink"))).toBe(-1);
    expect(vm.depth).toBe(0);
  });
  test("raw snapshots retain private fields and strings; text fields keep source parsing", async () => {
    const vm = machineFor(await readProgram("rerelease/mg3/pak0.pak"));
    const parsed = applyQcEntityPairs(vm, 1, [ { key: "angle", value: "90" }, { key: "message", value: "first\\nsecond" }, { key: "private_unknown", value: "keep" } ]);
    expect(parsed.unknown).toEqual([{ key: "private_unknown", value: "keep" }]);
    const self = vm.entities.at(1);
    expect(self.vector(vm.fieldOffset("angles"))).toEqual({ x: 0, y: 90, z: 0 });
    const message = self.int(vm.fieldOffset("message"));
    expect(vm.strings.get(message)).toBe("first\nsecond");
    self.setInt(vm.program.entityFieldWords - 1, -0x1234567);
    const snapshot = vm.snapshot();
    self.bytes.fill(0);
    vm.strings.allocate("later");
    vm.restore(snapshot);
    expect(self.int(vm.program.entityFieldWords - 1)).toBe(-0x1234567);
    expect(vm.strings.get(message)).toBe("first\nsecond");
    expect(saveQcEntityPairs(vm, 1, false).find(pair => pair.key === "angles")?.value).toBe("0.000000 90.000000 0.000000");
  });
  test("required host services fail by builtin name, without fallback success", async () => {
    const vm = machineFor(await readProgram("rerelease/id1/pak0.pak"));
    expect(vm.missingBuiltins().some(binding => binding.name === "setmodel")).toBe(true);
    expect(() => vm.execute(vm.program.functionNamed("setmodel").index, 2)).toThrow("unbound builtin setmodel");
    expect(() => vm.execute(vm.program.functionNamed("ex_bot_movetopoint").index, 3)).toThrow("unbound builtin ex_bot_movetopoint");
  });
  test("shared executor invokes actual QC and restores its host save hook", async () => {
    const vm = machineFor(await readProgram("rerelease/id1/pak0.pak"));
    const module: ModuleIdentity = { id: "test:qc", artifactPath: vm.program.source, digest: vm.program.digest, revision: "corpus" };
    let hostCounter = 4;
    const executor = new QuakeCExecutor({ kind: "quakec", module, numeric: Q1_DONOR_PROFILE,
      host: describeQcHost(vm.program, "rerelease", vm.entities.layout, createQcBuiltins({ kind: "rerelease" })) }, vm, {
      checkpoint: () => ({ state: { module, format: "test:counter", bytes: new Uint8Array([hostCounter]) }, random: [], callbacks: [] }),
      restore: saved => { hostCounter = saved.state.bytes[0] ?? 0; },
    });
    const result = executor.invoke({ module, callback: { kind: "quakec", module, functionIndex: vm.program.functionNamed("vlen").index }, parent: null, self: null, other: null }, [
      { kind: "float32", value: 3 },
    ]);
    expect(result.kind).toBe("aggregate");
    const checkpoint = executor.checkpoint();
    hostCounter = 9;
    vm.globals.setFloat(1, 123);
    executor.restore(checkpoint);
    expect(hostCounter).toBe(4);
    expect(vm.globals.float(1)).toBe(3);
    expect(checkpoint.module.digest).toBe(vm.program.digest);
  });
  test("guest spawn/remove share actor generations and retain private fields until slot reuse", async () => {
    const program = await readProgram("rerelease/id1/pak0.pak");
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8);
    const actors = new SessionActorRegistry(createIdentityOwner("qc-source-test"));
    const storage = createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 });
    let time = 3;
    const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: entities.capacity,
      lifetime: quakeEdictLifetime(1), storage, now: () => ({ kind: "seconds", value: time }), unlink: () => {}, exhausted: () => {} });
    slots.bindExisting(0, "quakec:worldspawn");
    const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), serverActive: () => true,
      builtins: createQcBuiltins({ kind: "rerelease", ...createQcActorBindings(entities, actors, slots) }) });
    vm.execute(program.functionNamed("spawn").index);
    const reference = vm.globals.int(1);
    const original = slots.at(1);
    if (original === null) throw new Error("spawn did not allocate actor authority");
    entities.at(1).setInt(program.entityFieldWords - 1, 123456);
    vm.globals.setInt(4, reference);
    vm.execute(program.functionNamed("remove").index, 1);
    expect(actors.isLive(original.id)).toBe(false);
    expect(entities.at(1).int(program.entityFieldWords - 1)).toBe(123456);
    time = 3.1;
    vm.execute(program.functionNamed("spawn").index);
    expect(entities.slot(vm.globals.int(1))).toBe(2);
    time = 3.6;
    vm.execute(program.functionNamed("spawn").index);
    expect(vm.globals.int(1)).toBe(reference);
    expect(entities.at(1).int(program.entityFieldWords - 1)).toBe(0);
    expect(slots.at(1)?.id.equals(original.id)).toBe(false);
  });
});
test("QW negative engine-string pointers alias one mutable buffer across raw save", () => {
  const strings = new QcStrings(new Uint8Array([0]), true);
  const first = strings.setEngine("pr_string_temp", "1");
  expect(first).toBe(-1);
  expect(strings.setEngine("pr_string_temp", "2")).toBe(first);
  expect(strings.get(first)).toBe("2");
  const snapshot = strings.snapshot();
  strings.setEngine("pr_string_temp", "3");
  strings.restore(snapshot);
  expect(strings.get(first)).toBe("2");
});
test("entity pointers preserve prefix, stride and private bit patterns", () => {
  const entities = new QcEntityMemory({ strideBytes: 120, variablesOffsetBytes: 96, fieldWords: 6 }, 4, 3);
  expect(entities.reference(2)).toBe(240);
  const pointer = entities.pointer(entities.reference(2), 4);
  expect(pointer).toBe(352);
  const destination = entities.resolvePointer(pointer);
  destination.fields.setInt(destination.word, -1);
  expect(entities.at(2).int(4)).toBe(-1);
  expect(() => entities.resolvePointer(240)).toThrow("does not address entity variables");
});
