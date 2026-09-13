import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { QcProgram, QcOpcode, loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage } from "../../../src/compat/qc/index.ts";
import type { QcStatement } from "../../../src/compat/qc/program.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import type { DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";
import { Id1DamageBinding } from "../../../src/content/q1/quakec/id1-damage.ts";
import { deriveNativeProgramBinding, id1ProgramBinding } from "../../../src/content/q1/quakec/id1-program.ts";

const corpus = new URL("../../../../qfiles/q1/", import.meta.url).pathname;
async function readProgram(path: string): Promise<QcProgram> {
  const archive = await openArchive(corpus + path);
  try {
    const entry = archive.findEntries("progs.dat").at(-1);
    if (entry === undefined) throw new Error(`Missing program in ${path}`);
    return loadQcProgram(await archive.readEntry(entry));
  } finally { await archive.close(); }
}
function changedProgram(program: QcProgram, statements: readonly QcStatement[]): QcProgram {
  return new QcProgram(program.source, program.api, statements, program.globals, program.fields, program.functions,
    program.strings, program.initialGlobals, program.entityFieldWords, program.checksum, createContentDigest("0".repeat(64)));
}
function run(program: QcProgram, observed: boolean, variant: "normal" | "death" | "empathy" | "wetsuit") {
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 3);
  const actors = new SessionActorRegistry(createIdentityOwner(`mod-${observed}-${variant}`));
  const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 8, lifetime: quakeEdictLifetime(1),
    storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
    now: () => ({ kind: "seconds", value: 3 }), unlink: () => undefined, exhausted: () => { throw new Error("No slots"); } });
  slots.bindExisting(0, "test:world");
  const attacker = slots.bindExisting(1, "test:attacker"), target = slots.bindExisting(2, "test:target");
  const outcomes: DamageOutcome[] = [];
  const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => { throw new Error("Replayed source impulse"); }, beforeReaction: () => undefined,
    confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  const binding = new Id1DamageBinding({ program, entities, actors, slots }, authority, () => vm, call => {
    const request: DamageRequest = { target: call.target, amount: call.amount, knockback: 0,
      direction: { x: 0, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, delivery: "direct",
      attack: { sequence: outcomes.length, time: { kind: "seconds", value: 3 }, attacker: call.attacker, inflictor: call.inflictor,
        weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "test:qc", cause: { kind: "q1", deathType: "" } } };
    return request;
  });
  const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
    builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true,
    ...(observed ? { functionBoundary: binding.functionBoundary, observeCall: call => binding.observeCall(call), observeEntityStore: store => binding.observeEntityStore(store) } : {}),
  });
  const field = (name: string) => vm.fieldOffset(name);
  for (const [slot, actor] of [[1, attacker], [2, target]] satisfies readonly (readonly [number, typeof attacker])[]) {
    const words = entities.at(slot);
    words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2);
    words.setFloat(field("movetype"), variant === "death" ? 0 : 3);
    words.setFloat(field("armorvalue"), 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field("items"), 8192);
    words.setInt(field("th_pain"), program.functionNamed("SUB_Null").index); words.setInt(field("th_die"), program.functionNamed("SUB_Null").index);
    words.setVector(field("origin"), { x: slot * 20, y: slot * 6, z: slot * 4 });
    authority.bind(actor, { read: () => ({ health: words.float(field("health")), armor: binding.readArmor(words), mass: 200, canTakeDamage: true, invulnerable: false, team: null }),
      writeHealth: () => { throw new Error("Replayed source health"); }, writeArmor: () => { throw new Error("Replayed source armor"); } });
  }
  if (variant === "empathy") {
    entities.at(2).setFloat(field("items2"), 4);
    entities.at(2).setFloat(field("empathy_sound"), 10);
  }
  if (variant === "wetsuit") {
    entities.at(2).setFloat(field("wetsuit_finished"), 10);
    vm.globals.setFloat(vm.globalOffset("discharged"), 1);
  }
  vm.globals.setFloat(vm.globalOffset("time"), 3); vm.globals.setInt(vm.globalOffset("self"), entities.reference(2));
  vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(1)); vm.globals.setInt(10, entities.reference(1));
  vm.globals.setFloat(13, variant === "death" ? 150 : 40);
  vm.execute(program.functionNamed("T_Damage").index, 4);
  return { bytes: entities.bytes.slice(), outcomes, health: entities.at(2).float(field("health")), attackerHealth: entities.at(1).float(field("health")) };
}
for (const path of ["id1/PAK0.PAK", "hipnotic/pak0.pak", "rerelease/dopa/pak0.pak"]) {
  test(`derived ${path} damage preserves the real VM stores and reactions`, async () => {
    const program = await readProgram(path), derived = deriveNativeProgramBinding(program);
    expect(derived.damage.index).toBe(program.functionNamed("T_Damage").index);
    expect(derived.attribution).toBe("native");
    const unpinned = changedProgram(program, program.statements);
    expect(id1ProgramBinding(unpinned).attribution).toBe("native");
    for (const variant of ["normal", "death"] satisfies readonly ("normal" | "death")[]) {
      const plain = run(unpinned, false, variant), observed = run(unpinned, true, variant);
      expect(observed.bytes).toEqual(plain.bytes);
      expect(observed.outcomes).toHaveLength(1);
      const outcome = observed.outcomes[0];
      if (outcome?.kind !== "committed") throw new Error("No committed source damage");
      expect(outcome.decision.reaction).toBe(variant === "death" ? "death" : "pain");
      expect(outcome.decision.appliedDamage).toBe(variant === "death" ? 110 : 28);
      expect(outcome.decision.request.attack.weapon).toBeNull();
      const armorWrites = outcome.decision.mutations.filter(mutation => mutation.kind === "armor");
      expect(armorWrites.length).toBeGreaterThan(0);
      expect(armorWrites.at(-1)?.after).toEqual(variant === "death" ? { kind: "none" }
        : { kind: "q1", points: 28, absorption: Math.fround(0.3), item: "q1:item_armor1" });
    }
  });
}
test("Hipnotic recursive empathy and wetsuit protection remain authored source behavior", async () => {
  const program = await readProgram("hipnotic/pak0.pak");
  for (const variant of ["empathy", "wetsuit"] satisfies readonly ("empathy" | "wetsuit")[]) {
    const plain = run(program, false, variant), observed = run(program, true, variant);
    expect(observed.bytes).toEqual(plain.bytes);
    expect(observed.outcomes).toHaveLength(variant === "empathy" ? 2 : 1);
    expect(observed.health).toBe(variant === "empathy" ? 86 : 100);
    expect(observed.attackerHealth).toBe(variant === "empathy" ? 86 : 100);
  }
});
test("matching names and signatures do not admit changed damage arithmetic or reaction arguments", async () => {
  const program = await readProgram("hipnotic/pak0.pak"), binding = deriveNativeProgramBinding(program);
  const subtraction = program.statements.findIndex((statement, index) => index > binding.damage.firstStatement && index < binding.damage.healthStore && statement.opcode === QcOpcode.SubF && statement.b === binding.damage.take);
  expect(subtraction).toBeGreaterThan(0);
  const changed = program.statements.map((statement, index) => index === subtraction ? { ...statement, opcode: QcOpcode.AddF } : statement);
  expect(() => id1ProgramBinding(changedProgram(program, changed))).toThrow("health store");
  const changedPain = program.statements.map((statement, index) => index === binding.damage.pain[0] - 1 ? { ...statement, a: binding.damage.parameterStart + 3 } : statement);
  expect(() => id1ProgramBinding(changedProgram(program, changedPain))).toThrow("pain call arguments");
});

test("a branch cannot enter a reaction while skipping the observed health store", async () => {
  const program = await readProgram("hipnotic/pak0.pak"), binding = deriveNativeProgramBinding(program);
  const branch = program.statements.findIndex((statement, index) => index > binding.damage.firstStatement && statement.opcode === QcOpcode.IfNot);
  const changed = program.statements.map((statement, index) => index === branch ? { ...statement, b: binding.damage.death[0] - 2 - branch } : statement);
  expect(() => id1ProgramBinding(changedProgram(program, changed))).toThrow("reaction is not dominated by health store");
});

test("Rogue's real items2 armor encoding is rejected until its shared armor projection exists", async () => {
  const program = await readProgram("rogue/pak0.pak");
  expect(() => id1ProgramBinding(program)).toThrow("armor inventory layout");
});

test("source calls after the reaction cannot hide helper combat writes", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = deriveNativeProgramBinding(base);
  const initial = new Uint8Array(base.initialGlobals.length + 16); initial.set(base.initialGlobals);
  const extra = base.initialGlobals.length / 4, functionIndex = base.functions.length;
  const values = new DataView(initial.buffer); values.setInt32(extra * 4, functionIndex, true); values.setFloat32((extra + 2) * 4, 1, true);
  const self = base.globalsByName.get("self"), health = base.globalsByName.get("health");
  if (self === undefined || health === undefined) throw new Error("Missing source fields");
  const end = base.functions.reduce((limit, fn) => fn.firstStatement > layout.damage.firstStatement ? Math.min(limit, fn.firstStatement) : limit, base.statements.length);
  const tail = base.statements.findIndex((statement, index) => index > layout.damage.pain[0] && index < end && statement.opcode === QcOpcode.StoreEnt && statement.b === self.offset);
  expect(tail).toBeGreaterThan(layout.damage.pain[0]);
  const statements: QcStatement[] = base.statements.map((statement, index) => index === tail ? { opcode: QcOpcode.Call0, a: extra, b: 0, c: 0 } : statement);
  statements.push({ opcode: QcOpcode.Address, a: self.offset, b: health.offset, c: extra + 1 },
    { opcode: QcOpcode.StorePF, a: extra + 2, b: extra + 1, c: 0 }, { opcode: QcOpcode.Done, a: 0, b: 0, c: 0 });
  const functions = [...base.functions, { index: functionIndex, firstStatement: base.statements.length, parameterStart: extra + 3,
    localWords: 0, name: "AfterDamage", file: "test.qc", parameterSizes: [], namedBuiltin: false }];
  const program = new QcProgram(base.source, base.api, statements, base.globals, base.fields, functions,
    base.strings, initial, base.entityFieldWords, base.checksum, createContentDigest("1".repeat(64)));
  expect(() => deriveNativeProgramBinding(program)).toThrow("calls another function after reaction");
});

test("retargeting a damage parameter cannot silently damage another actor on an early return", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = deriveNativeProgramBinding(base);
  const statements = base.statements.map((statement, index) => index === layout.damage.firstStatement + 4
    ? { opcode: QcOpcode.StoreEnt, a: layout.damage.parameterStart + 2, b: layout.damage.parameterStart, c: 0 }
    : index === layout.damage.healthStore + 1 ? { opcode: QcOpcode.Return, a: 0, b: 0, c: 0 } : statement);
  expect(() => deriveNativeProgramBinding(changedProgram(base, statements))).toThrow("actor parameters are reassigned");
});

test("a helper that redirects the target cannot omit its subsequent combat stores", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = deriveNativeProgramBinding(base);
  const initial = new Uint8Array(base.initialGlobals.length + 4); initial.set(base.initialGlobals);
  const extra = base.initialGlobals.length / 4, functionIndex = base.functions.length;
  new DataView(initial.buffer).setInt32(extra * 4, functionIndex, true);
  const statements: QcStatement[] = base.statements.map((statement, index) => index === layout.damage.firstStatement + 4
    ? { opcode: QcOpcode.Call0, a: extra, b: 0, c: 0 } : index === layout.damage.healthStore + 1
      ? { opcode: QcOpcode.Return, a: 0, b: 0, c: 0 } : statement);
  statements.push({ opcode: QcOpcode.StoreEnt, a: layout.damage.parameterStart + 2, b: layout.damage.parameterStart, c: 0 },
    { opcode: QcOpcode.Done, a: 0, b: 0, c: 0 });
  const functions = [...base.functions, { index: functionIndex, firstStatement: base.statements.length, parameterStart: extra,
    localWords: 0, name: "RedirectDamage", file: "test.qc", parameterSizes: [], namedBuiltin: false }];
  const program = new QcProgram(base.source, base.api, statements, base.globals, base.fields, functions,
    base.strings, initial, base.entityFieldWords, base.checksum, createContentDigest("2".repeat(64)));
  expect(() => run(program, true, "normal")).toThrow("redirects a combat store to another actor");
});
