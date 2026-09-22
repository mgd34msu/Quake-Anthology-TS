import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ArmorStageInput, DamageOutcome, PoweredProtectionState } from "../../../src/contracts/gameplay.ts";
import type { ModQcArmorStage } from "../../../src/contracts/mod-callbacks.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { QcProgram, QcOpcode, loadQcProgram } from "../../../src/compat/qc/program.ts";
import { QcEntityMemory, QcMachine, classicQcEntityLayout, createQcActorBindings, createQcBuiltins, createQcSourceSlotStorage } from "../../../src/compat/qc/index.ts";
import { SessionActorRegistry, ActorCallbackTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { Id1DamageBinding } from "../../../src/content/q1/quakec/id1-damage.ts";
import { id1ProgramBinding } from "../../../src/content/q1/quakec/id1-program.ts";
import { qcArmorStage } from "../../../src/content/q1/quakec/armor-stage.ts";
import type { QcInlineBoundary } from "../../../src/compat/qc/machine.ts";

const corpus = "/home/buzzkill/Projects/qfiles/q1/";
const copper = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
async function readProgram(path: string): Promise<QcProgram> {
  const archive = await openArchive(corpus + path);
  try {
    const entry = archive.findEntries("progs.dat").at(-1);
    if (entry === undefined) throw new Error("Missing original program");
    return loadQcProgram(await archive.readEntry(entry));
  } finally { await archive.close(); }
}
function copperStage(program: QcProgram): ModQcArmorStage {
  const declaration = readModCallbacks(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "quakec",
    program: { path: "progs.dat", digest: program.digest }, actorFields: [], callbacks: [], combat: { damage: { function: "T_Damage", arguments: [], globals: [] },
      armorStage: { function: "T_DamageApply", entry: 5592, exit: 5606, target: 5363, damage: 5366, saved: 5372,
        flags: { kind: "bits", word: 5367, noArmor: 4, noPowerArmor: 0, noRegularArmor: 0, energy: 0 }, statements: program.statements.slice(5592, 5607) } } })));
  const stage = declaration.combat?.armorStage;
  if (stage === undefined) throw new Error("Missing declared stage");
  return stage;
}
function fixture(program: QcProgram, declaration?: ModQcArmorStage) {
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 3);
  const actors = new SessionActorRegistry(createIdentityOwner("qc-armor-stage"));
  let sourceTime = 3;
  const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 8, lifetime: quakeEdictLifetime(1),
    storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
    now: () => ({ kind: "seconds", value: sourceTime }), unlink: () => undefined, exhausted: () => { throw new Error("No source slot"); } });
  slots.bindExisting(0, "test:world");
  const attacker = slots.bindExisting(1, "test:attacker"), target = slots.bindExisting(2, "test:target"), outcomes: DamageOutcome[] = [];
  const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => { throw new Error("Source impulse replay"); },
    beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  let sequence = 0;
  const binding = new Id1DamageBinding({ program, entities, actors, slots }, authority, () => vm, call => ({
    target: call.target, amount: call.amount, knockback: 0, direction: { x: 1, y: 0, z: 0 }, point: { x: 44, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, delivery: "direct",
    attack: { sequence: sequence++, time: { kind: "seconds", value: 3 }, attacker: call.attacker, inflictor: call.inflictor,
      weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "test:qc", cause: { kind: "q1", deathType: "" } },
  }), undefined, declaration);
  const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
    builtins: createQcBuiltins({ kind: "netquake", ...createQcActorBindings(entities, actors, slots) }),
    serverActive: () => true, functionBoundary: binding.functionBoundary, inlineBoundary: binding.inlineBoundary,
    observeCall: call => binding.observeCall(call), observeEntityStore: store => binding.observeEntityStore(store) });
  const field = (name: string) => vm.fieldOffset(name), targetWords = entities.at(2), attackerWords = entities.at(1);
  const profile = id1ProgramBinding(program);
  for (const [slot, actor] of [[1, attacker], [2, target]] satisfies readonly (readonly [number, typeof target])[]) {
    const words = entities.at(slot), stage = binding.poweredArmorStage(actor);
    words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2); words.setFloat(field("movetype"), 3);
    words.setFloat(field("armorvalue"), 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field(profile.armorField), profile.armorMasks[0]);
    words.setInt(field("classname"), vm.strings.allocate(slot === 1 ? "attacker" : "target"));
    words.setInt(field("th_pain"), program.functionNamed("SUB_Null").index); words.setInt(field("th_die"), program.functionNamed("SUB_Null").index);
    words.setVector(field("origin"), { x: slot * 20, y: 0, z: 0 });
    authority.bind(actor, { sourceDamage: () => { throw new Error("Use original source entry"); }, ...(stage === null ? {} : { poweredArmorStage: stage }),
      read: () => ({ health: words.float(field("health")), armor: binding.readArmor(words), mass: 200, canTakeDamage: true, invulnerable: false, team: null }),
      writeHealth: () => { throw new Error("Source health replay"); }, writeArmor: () => { throw new Error("Source armor replay"); } });
  }
  vm.globals.setFloat(vm.globalOffset("time"), 3); vm.globals.setInt(vm.globalOffset("self"), entities.reference(2));
  const invoke = (amount = 40, flags = 0, fromWorld = false): void => {
    vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(fromWorld ? 0 : 1)); vm.globals.setInt(10, entities.reference(fromWorld ? 0 : 1));
    vm.globals.setFloat(13, amount); vm.globals.setFloat(16, flags);
    vm.execute(program.functionNamed("T_Damage").index, program.functionNamed("T_Damage").parameterSizes.length);
  };
  const bindPower = (effect?: () => void) => {
    let power: PoweredProtectionState = { kind: "shield", cells: 40 }, nested = false;
    const inputs: ArmorStageInput[] = [];
    const remove = authority.bindPoweredProtection(target, { owner: "borrowed:power", rule: "test:absorb", admission: { kind: "claim" }, fuelItems: ["q2:ammo_cells"],
      read: () => power, validateWrite: () => undefined, write: next => { power = next; return undefined; }, absorb: (input, observer) => {
        inputs.push(input);
        if (nested) return { saved: 0 };
        const before = power;
        if (before.kind === "none") throw new Error("Missing powered state");
        power = { ...before, cells: before.cells - 1 }; observer.stored({ before, after: power });
        nested = true;
        try { effect?.(); } finally { nested = false; }
        return { saved: Math.min(20, input.amount) };
      } });
    return { inputs, remove, read: () => power };
  };
  const removeAndReuse = (): Uint8Array => {
    vm.globals.setInt(4, entities.reference(2)); vm.execute(program.functionNamed("remove").index, 1);
    sourceTime = 4;
    vm.execute(program.functionNamed("spawn").index);
    expect(vm.globals.int(1)).toBe(entities.reference(2));
    expect(slots.at(2)?.id.equals(target.id)).toBe(false);
    targetWords.setFloat(field("health"), 777); targetWords.setFloat(field("armorvalue"), 333);
    if (program.fieldsByName.has("customflags")) targetWords.setFloat(field("customflags"), 4);
    return targetWords.bytes.slice();
  };
  return { actors, slots, target, vm, authority, entities, binding, field, targetWords, attackerWords, outcomes, invoke, bindPower, removeAndReuse };
}

test("original Hipnotic empathy, armor, feedback and momentum compose around borrowed power", async () => {
  const source = await readProgram("rerelease/hipnotic/pak0.pak"), plain = fixture(source), powered = fixture(source);
  try {
    for (const run of [plain, powered]) {
      run.attackerWords.setFloat(run.field("super_damage_finished"), 10);
      run.targetWords.setFloat(run.field("items2"), 4); run.targetWords.setFloat(run.field("empathy_sound"), 10);
      run.targetWords.setFloat(run.field("flags"), 8);
    }
    const power = powered.bindPower();
    plain.invoke(); powered.invoke();
    expect(power.inputs).toHaveLength(1); expect(power.inputs[0]?.amount).toBe(80);
    expect(power.inputs[0]?.geometry).toEqual({ direction: { x: 1, y: 0, z: 0 }, point: { x: 44, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    expect(powered.targetWords.float(powered.field("health"))).toBe(58);
    expect(powered.targetWords.float(powered.field("armorvalue"))).toBe(22);
    expect(powered.targetWords.float(powered.field("dmg_save"))).toBe(38);
    expect(powered.targetWords.vector(powered.field("velocity"))).toEqual(plain.targetWords.vector(plain.field("velocity")));
    expect(powered.attackerWords.bytes).toEqual(plain.attackerWords.bytes);
    expect(powered.outcomes).toHaveLength(2);
    const outcome = powered.outcomes.at(-1);
    if (outcome?.kind !== "committed") throw new Error("Missing original source outcome");
    expect(outcome.decision.mutations.map(mutation => mutation.kind)).toEqual(["armor", "armor", "source-velocity", "health"]);
    expect(power.inputs[0]?.request).toBe(outcome.decision.request);
    power.remove();
    const fresh = fixture(source);
    try {
      powered.vm.restore(fresh.vm.snapshot()); powered.outcomes.length = 0;
      powered.invoke(); fresh.invoke();
      expect(powered.entities.bytes).toEqual(fresh.entities.bytes);
    } finally { fresh.actors.close(); }
  } finally { plain.actors.close(); powered.actors.close(); }
});

test("effectful QC power rebases nested damage and cancels the exact retired source invocation", async () => {
  const program = await readProgram("rerelease/hipnotic/pak0.pak"), nested = fixture(program), retired = fixture(program);
  try {
    nested.bindPower(() => nested.invoke(10, 0, true)); nested.invoke();
    expect(nested.outcomes).toHaveLength(2);
    expect(nested.targetWords.float(nested.field("health"))).toBe(79);
    expect(nested.targetWords.float(nested.field("armorvalue"))).toBe(31);
    const replacement: { bytes: Uint8Array | null } = { bytes: null };
    retired.bindPower(() => { replacement.bytes = retired.removeAndReuse(); }); retired.invoke();
    expect(retired.outcomes).toHaveLength(1); expect(retired.vm.depth).toBe(0); retired.vm.snapshot();
    if (replacement.bytes === null) throw new Error("Source did not allocate a replacement");
    expect(retired.targetWords.bytes).toEqual(replacement.bytes);
    const outcome = retired.outcomes[0];
    if (outcome?.kind !== "committed") throw new Error("Missing retired source outcome");
    expect(outcome.survived).toBe(false); expect(outcome.decision.mutations.map(mutation => mutation.kind)).toEqual(["armor"]);
  } finally { nested.actors.close(); retired.actors.close(); }
});

test("declared original Copper helper debits only regular savings and preserves no-armor flags", async () => {
  const program = loadQcProgram(await Bun.file(copper).bytes()), declaration = copperStage(program);
  expect(qcArmorStage(program)).toBeNull();
  for (const flags of [0, 4]) {
    const run = fixture(program, declaration);
    try {
      const power = run.bindPower(); run.invoke(40, flags);
      expect(run.targetWords.float(run.field("health"))).toBe(flags === 0 ? 86 : 60);
      expect(run.targetWords.float(run.field("armorvalue"))).toBe(flags === 0 ? 34 : 40);
      expect(power.inputs).toHaveLength(flags === 0 ? 1 : 0);
      expect(run.outcomes).toHaveLength(1); expect(run.vm.depth).toBe(0); run.vm.snapshot();
    } finally { run.actors.close(); }
  }
  const retired = fixture(program, declaration);
  try {
    const replacement: { bytes: Uint8Array | null } = { bytes: null };
    retired.bindPower(() => { replacement.bytes = retired.removeAndReuse(); }); retired.invoke();
    expect(retired.targetWords.float(retired.field("customflags"))).toBe(4);
    if (replacement.bytes === null) throw new Error("Source did not allocate a replacement");
    expect(retired.targetWords.bytes).toEqual(replacement.bytes);
    expect(retired.vm.depth).toBe(0); retired.vm.snapshot();
  } finally { retired.actors.close(); }
});

test("inline QC continuations execute once and preserve the original instruction budget", async () => {
  const program = await readProgram("id1/PAK0.PAK"), stage = qcArmorStage(program);
  if (stage === null) throw new Error("Missing original inline stage");
  const make = (run?: QcInlineBoundary["run"], statementLimit = 100000) => {
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 3);
    const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake" }),
      serverActive: () => true, statementLimit, ...(run === undefined ? {} : { inlineBoundary: { regions: [stage.region], run } }) });
    entities.at(2).setFloat(vm.fieldOffset("takedamage"), 2); entities.at(2).setFloat(vm.fieldOffset("health"), 100);
    entities.at(2).setFloat(vm.fieldOffset("armorvalue"), 40); entities.at(2).setFloat(vm.fieldOffset("armortype"), 0.3);
    vm.globals.setInt(4, entities.reference(2)); vm.globals.setFloat(13, 40); vm.globals.setFloat(vm.globalOffset("time"), 3);
    return vm;
  };
  const damage = program.functionNamed("T_Damage").index;
  const omitted = make(() => undefined);
  expect(() => omitted.execute(damage, 4)).toThrow("omitted source execution"); omitted.snapshot();
  const repeated = make((_region, execute) => { execute(); try { execute(); } catch {} return undefined; });
  expect(() => repeated.execute(damage, 4)).toThrow("once inside its boundary"); repeated.snapshot();
  const saved: { execute: (() => undefined) | null } = { execute: null };
  const once = make((_region, execute) => { saved.execute = execute; return execute(); });
  once.execute(damage, 4);
  if (saved.execute === null) throw new Error("Missing continuation");
  expect(saved.execute).toThrow("once inside its boundary"); once.snapshot();
  const plain = make(undefined, 18), bounded = make((_region, execute) => execute(), 18);
  for (const vm of [plain, bounded]) { expect(() => vm.execute(damage, 4)).toThrow("runaway loop"); vm.snapshot(); }
  expect(bounded.profiling).toEqual(plain.profiling); expect(bounded.entities.bytes).toEqual(plain.entities.bytes);
});

test("QC armor admission validates original profiles and declared statement control flow", async () => {
  for (const path of ["id1/PAK0.PAK", "hipnotic/pak0.pak", "rogue/pak0.pak", "rerelease/id1/pak0.pak", "rerelease/hipnotic/pak0.pak",
    "rerelease/rogue/pak0.pak", "rerelease/ctf/pak0.pak", "rerelease/dopa/pak0.pak", "rerelease/mg3/pak0.pak"]) {
    expect(qcArmorStage(await readProgram(path))).not.toBeNull();
  }
  const program = loadQcProgram(await Bun.file(copper).bytes()), declaration = copperStage(program);
  expect(() => qcArmorStage(program, { ...declaration, entry: declaration.entry + 1 })).toThrow("incomplete instruction");
  expect(() => qcArmorStage(program, { ...declaration, target: declaration.damage })).toThrow("typed frame");
  expect(() => qcArmorStage(program, { ...declaration, statements: declaration.statements.map((statement, index) => index === 0 ? { ...statement, a: 0 } : statement) })).toThrow("differs from artifact");
  const statements = program.statements.map((statement, index) => index === declaration.entry + 1 ? { opcode: QcOpcode.Return, a: 0, b: 0, c: 0 } : statement);
  const changed = new QcProgram(program.source, program.api, statements, program.globals, program.fields, program.functions,
    program.strings, program.initialGlobals, program.entityFieldWords, program.checksum, createContentDigest("0".repeat(64)));
  expect(qcArmorStage(changed)).toBeNull();
  expect(() => qcArmorStage(changed, { ...declaration, statements: statements.slice(declaration.entry, declaration.exit + 1) })).toThrow("region exits");
});
