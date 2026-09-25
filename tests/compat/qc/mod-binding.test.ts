import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { QcProgram, QcOpcode, loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage } from "../../../src/compat/qc/index.ts";
import type { ModCallbackDeclaration, ModSourceCall } from "../../../src/contracts/mod-callbacks.ts";
import type { ProviderId } from "../../../src/contracts/identity.ts";
import type { QcStatement } from "../../../src/compat/qc/program.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import type { CombatState, DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";
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
function run(program: QcProgram, observed: boolean, variant: "normal" | "death" | "empathy" | "wetsuit", mods?: (authority: GameplayAuthority, actors: SessionActorRegistry) => void,
  scaling?: { readonly declaration: NonNullable<ModCallbackDeclaration["combat"]>; readonly quad: boolean; readonly strength: boolean;
    readonly resistance: boolean; readonly owner?: ProviderId; readonly time?: number },
  nativeCall?: { readonly amount?: number; readonly worldAttacker?: boolean; readonly extra?: { readonly index: number; readonly value: number } }) {
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 3);
  const actors = new SessionActorRegistry(createIdentityOwner(`mod-${observed}-${variant}`));
  const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 8, lifetime: quakeEdictLifetime(1),
    storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
    now: () => ({ kind: "seconds", value: 3 }), unlink: () => undefined, exhausted: () => { throw new Error("No slots"); } });
  const world = slots.bindExisting(0, "test:world");
  const attacker = slots.bindExisting(1, "test:attacker"), target = slots.bindExisting(2, "test:target");
  const outcomes: DamageOutcome[] = [];
  const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => { throw new Error("Replayed source impulse"); }, beforeReaction: () => undefined,
    confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  mods?.(authority, actors);
  const binding = new Id1DamageBinding({ program, entities, actors, slots }, authority, () => vm, call => {
    const request: DamageRequest = { target: call.target, amount: call.amount, knockback: 0,
      direction: { x: 0, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, delivery: "direct",
      attack: { sequence: outcomes.length, time: { kind: "seconds", value: 3 }, attacker: call.attacker, inflictor: call.inflictor,
        ...(scaling?.owner === undefined ? {} : { damagePowerupOwner: scaling.owner }),
        weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "test:qc", cause: { kind: "q1", deathType: "" } } };
    return request;
  }, undefined, scaling?.declaration.armorStage, scaling?.declaration.damageScale === undefined ? undefined
    : { call: scaling.declaration.damage, scale: scaling.declaration.damageScale });
  const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
    builtins: createQcBuiltins({ kind: program.api.kind === "q1-quakeworld" ? "quakeworld" : "netquake" }), serverActive: () => true,
    ...(observed ? { inlineBoundary: binding.inlineBoundary, functionBoundary: nativeCall?.extra === undefined ? binding.functionBoundary : {
      functions: binding.functionBoundary.functions, run: (call, execute) => binding.functionBoundary.run(call, Object.assign((prepare?: (machine: QcMachine) => undefined) => execute(machine => {
        prepare?.(machine);
        if (call.functionIndex === id1ProgramBinding(program).damage.index && nativeCall.extra !== undefined)
          expect(machine.argFloat(nativeCall.extra.index)).toBe(nativeCall.extra.value);
        return undefined;
      }), { skip: execute.skip, cancel: execute.cancel })) }, observeCall: call => binding.observeCall(call), observeEntityStore: store => binding.observeEntityStore(store) } : {}),
  });
  const field = (name: string) => vm.fieldOffset(name);
  for (const [slot, actor] of [[1, attacker], [2, target]] satisfies readonly (readonly [number, typeof attacker])[]) {
    const words = entities.at(slot);
    words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2);
    words.setFloat(field("movetype"), variant === "death" ? 0 : 3);
    words.setFloat(field("armorvalue"), 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field(id1ProgramBinding(program).armorField), id1ProgramBinding(program).armorMasks[0]);
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
  let factor: number | null = null, transformed: number | null = null;
  const amount = nativeCall?.amount ?? (variant === "death" ? 150 : 40), hitTime = scaling?.time ?? 3;
  if (scaling !== undefined) {
    entities.at(1).setFloat(field("super_damage_finished"), scaling.quad ? 10 : 0);
    entities.at(1).setFloat(field("player_flag"), scaling.strength ? 2 : 0);
    entities.at(2).setFloat(field("player_flag"), scaling.resistance ? 1 : 0);
    entities.at(2).setFloat(field("invincible_sound"), hitTime + 10);
    entities.at(2).setFloat(field("health"), 1000);
    entities.at(2).setFloat(field("armorvalue"), 0); entities.at(2).setFloat(field("armortype"), 0);
    if (observed) {
      const globals = vm.globals.bytes.slice(), state = entities.bytes.slice();
      const queryActor = nativeCall?.worldAttacker ? world : attacker, queryReference = entities.reference(nativeCall?.worldAttacker ? 0 : 1);
      if (scaling.declaration.damageScale?.kind !== "transform") factor = binding.damageMultiplier(queryActor.id, queryReference, hitTime);
      else expect(() => binding.damageMultiplier(queryActor.id, queryReference, hitTime)).toThrow("cannot be queried as a multiplier");
      transformed = binding.damageAmount(queryActor.id, queryReference, hitTime, amount);
      expect(vm.globals.bytes).toEqual(globals); expect(entities.bytes).toEqual(state);
    }
  }
  vm.globals.setFloat(vm.globalOffset("time"), hitTime); vm.globals.setInt(vm.globalOffset("self"), entities.reference(2));
  const sourceCall = id1ProgramBinding(program).damage.call;
  const values = { self: entities.reference(2), inflictor: entities.reference(1), attacker: entities.reference(nativeCall?.worldAttacker ? 0 : 1),
    amount: scaling?.owner === "test:qc" ? transformed ?? amount : amount };
  vm.globals.setFloat(16, 0);
  for (const role of ["self", "inflictor", "attacker", "amount"] satisfies readonly (keyof typeof values)[])
    for (const location of sourceCall.roles[role]) {
      const word = location.kind === "argument" ? 4 + location.index * 3 : location.word;
      if (role === "amount") vm.globals.setFloat(word, values[role]); else vm.globals.setInt(word, values[role]);
    }
  if (nativeCall?.extra !== undefined) vm.globals.setFloat(4 + nativeCall.extra.index * 3, nativeCall.extra.value);
  vm.execute(sourceCall.functionIndex, sourceCall.parameters.length);
  const attackerContext = sourceCall.roles.attacker.map(location => location.kind === "global" ? vm.globals.int(location.word) : null);
  return { factor, transformed, attackerContext, sourceAttacker: entities.reference(1), bytes: entities.bytes.slice(), outcomes, health: entities.at(2).float(field("health")), attackerHealth: entities.at(1).float(field("health")) };
}
test("registered transforms change actual QC damage arguments after saved call staging", async () => {
  const program = await readProgram("id1/PAK0.PAK");
  let observations = 0;
  const changed = run(program, true, "normal", authority => {
    authority.damageOperation.register({ provider: "q2:mod", id: "offset:damage", order: 0, kind: "transform", transform: request => ({ ...request, amount: request.amount + 4 }) });
    authority.damageOperation.register({ provider: "q3:mod", id: "scale:damage", order: 1, kind: "transform", transform: request => ({ ...request, amount: request.amount / 2 }) });
    authority.damageOperation.register({ provider: "q1:mod", id: "observe:damage", order: 2, kind: "observe", observe: (request, outcome) => {
      observations++; expect(request.amount).toBe(22);
      if (outcome.kind !== "committed") throw new Error("Expected native damage");
      expect(outcome.decision.request.amount).toBe(22); return undefined;
    } });
  });
  expect(changed.health).toBe(85); expect(observations).toBe(1); expect(changed.outcomes).toHaveLength(1);
  expect(changed.outcomes[0]?.kind === "committed" ? changed.outcomes[0].decision.appliedDamage : -1).toBe(15);
});

test("a mod can replace QC damage without executing its original stores", async () => {
  const program = await readProgram("id1/PAK0.PAK");
  let observations = 0;
  const changed = run(program, true, "normal", authority => {
    authority.damageOperation.register({ provider: "q2:mod", id: "cancel:damage", order: 0, kind: "replace", replace: request => ({
      kind: "committed", decision: { request, mutations: [], appliedDamage: 0, reaction: "none" }, survived: true,
    }) });
    authority.damageOperation.register({ provider: "q3:mod", id: "observe:damage", order: 1, kind: "observe", observe: () => { observations++; return undefined; } });
  });
  expect(changed.health).toBe(100); expect(changed.attackerHealth).toBe(100); expect(changed.outcomes).toEqual([]); expect(observations).toBe(1);
});

test("QC rejects transformations that its source call cannot execute", async () => {
  const program = await readProgram("id1/PAK0.PAK");
  expect(() => run(program, true, "normal", authority => {
    authority.damageOperation.register({ provider: "q3:mod", id: "knockback:damage", order: 0, kind: "transform", transform: request => ({ ...request, knockback: 300 }) });
  })).toThrow("independent damage metadata requires a replacement");
});

for (const path of ["id1/PAK0.PAK", "hipnotic/pak0.pak", "rerelease/dopa/pak0.pak", "rogue/pak0.pak"]) {
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
      expect(armorWrites.at(-1)?.after.regular).toEqual(variant === "death" ? { kind: "none" }
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
test("native armor projection requires the source inventory constants", async () => {
  const program = await readProgram("rogue/pak0.pak");
  expect(id1ProgramBinding(program).armorField).toBe("items2");
  expect(id1ProgramBinding(program).armorMasks).toEqual([1, 2, 4]);
});
test("source calls after the reaction cannot hide helper combat writes", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = id1ProgramBinding(base);
  const sites = layout.damage;
  if (sites.kind !== "sites") throw new Error("Expected pinned fixture sites");
  const initial = new Uint8Array(base.initialGlobals.length + 16); initial.set(base.initialGlobals);
  const extra = base.initialGlobals.length / 4, functionIndex = base.functions.length;
  const values = new DataView(initial.buffer); values.setInt32(extra * 4, functionIndex, true); values.setFloat32((extra + 2) * 4, 1, true);
  const self = base.globalsByName.get("self"), health = base.globalsByName.get("health");
  if (self === undefined || health === undefined) throw new Error("Missing source fields");
  const end = base.functions.reduce((limit, fn) => fn.firstStatement > layout.damage.firstStatement ? Math.min(limit, fn.firstStatement) : limit, base.statements.length);
  const tail = base.statements.findIndex((statement, index) => index > sites.pain[0] && index < end && statement.opcode === QcOpcode.StoreEnt && statement.b === self.offset);
  expect(tail).toBeGreaterThan(sites.pain[0]);
  const statements: QcStatement[] = base.statements.map((statement, index) => index === tail ? { opcode: QcOpcode.Call0, a: extra, b: 0, c: 0 } : statement);
  statements.push({ opcode: QcOpcode.Address, a: self.offset, b: health.offset, c: extra + 1 },
    { opcode: QcOpcode.StorePF, a: extra + 2, b: extra + 1, c: 0 }, { opcode: QcOpcode.Done, a: 0, b: 0, c: 0 });
  const functions = [...base.functions, { index: functionIndex, firstStatement: base.statements.length, parameterStart: extra + 3,
    localWords: 0, name: "AfterDamage", file: "test.qc", parameterSizes: [], namedBuiltin: false }];
  const program = new QcProgram(base.source, base.api, statements, base.globals, base.fields, functions,
    base.strings, initial, base.entityFieldWords, base.checksum, createContentDigest("1".repeat(64)));
  expect(() => run(program, true, "normal")).toThrow("combat store follows its reaction continuation");
});

test("retargeting a damage parameter cannot silently damage another actor on an early return", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = id1ProgramBinding(base);
  const sites = layout.damage;
  if (sites.kind !== "sites") throw new Error("Expected pinned fixture sites");
  const statements = base.statements.map((statement, index) => index === layout.damage.firstStatement + 4
    ? { opcode: QcOpcode.StoreEnt, a: layout.damage.parameterStart + 2, b: layout.damage.parameterStart, c: 0 }
    : index === sites.healthStore + 1 ? { opcode: QcOpcode.Return, a: 0, b: 0, c: 0 } : statement);
  expect(() => run(changedProgram(base, statements), true, "normal")).toThrow("redirects a combat store to another actor");
});

test("a helper that redirects the target cannot omit its subsequent combat stores", async () => {
  const base = await readProgram("id1/PAK0.PAK"), layout = id1ProgramBinding(base);
  const sites = layout.damage;
  if (sites.kind !== "sites") throw new Error("Expected pinned fixture sites");
  const initial = new Uint8Array(base.initialGlobals.length + 4); initial.set(base.initialGlobals);
  const extra = base.initialGlobals.length / 4, functionIndex = base.functions.length;
  new DataView(initial.buffer).setInt32(extra * 4, functionIndex, true);
  const statements: QcStatement[] = base.statements.map((statement, index) => index === layout.damage.firstStatement + 4
    ? { opcode: QcOpcode.Call0, a: extra, b: 0, c: 0 } : index === sites.healthStore + 1
      ? { opcode: QcOpcode.Return, a: 0, b: 0, c: 0 } : statement);
  statements.push({ opcode: QcOpcode.StoreEnt, a: layout.damage.parameterStart + 2, b: layout.damage.parameterStart, c: 0 },
    { opcode: QcOpcode.Done, a: 0, b: 0, c: 0 });
  const functions = [...base.functions, { index: functionIndex, firstStatement: base.statements.length, parameterStart: extra,
    localWords: 0, name: "RedirectDamage", file: "test.qc", parameterSizes: [], namedBuiltin: false }];
  const program = new QcProgram(base.source, base.api, statements, base.globals, base.fields, functions,
    base.strings, initial, base.entityFieldWords, base.checksum, createContentDigest("2".repeat(64)));
  expect(() => run(program, true, "normal")).toThrow("redirects a combat store to another actor");
});

test("native arithmetic is observed without imposing an id1 subtraction template", async () => {
  const base = await readProgram("id1/PAK0.PAK"), sites = id1ProgramBinding(base).damage;
  if (sites.kind !== "sites") throw new Error("Expected pinned fixture sites");
  const subtraction = base.statements.findIndex((statement, index) => index > sites.firstStatement && index < sites.healthStore
    && statement.opcode === QcOpcode.SubF && statement.b === sites.take);
  expect(subtraction).toBeGreaterThan(0);
  const program = changedProgram(base, base.statements.map((statement, index) => index === subtraction ? { ...statement, opcode: QcOpcode.AddF } : statement));
  const plain = run(program, false, "normal"), observed = run(program, true, "normal");
  expect(observed.bytes).toEqual(plain.bytes);
  const outcome = observed.outcomes[0];
  if (outcome?.kind !== "committed") throw new Error("No committed source mutation");
  expect(outcome.decision.appliedDamage).toBe(100 - observed.health);
});


test("declared original Threewave QuakeWorld combat retains source stores and rejects unqualified admission", async () => {
  const { validateQcModCombat } = await import("../../../src/compat/qc/mod-combat.ts");
  const { readQuakeCCompatibility } = await import("../../../src/compat/qc/compatibility.ts");
  const bytes = await Bun.file("/home/buzzkill/Projects/qfiles/q1/ctf/qwprogs.dat").bytes(), program = loadQcProgram(bytes);
  const raw = { version: 1, artifactDigest: program.digest, combat: { damage: { function: "T_Damage",
    arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "inflictor" }, { kind: "input", name: "attacker" }, { kind: "input", name: "amount" }],
    globals: [{ name: "time", value: { kind: "input", name: "time" } }] } } };
  const encoded = new TextEncoder().encode(JSON.stringify(raw)), declaration = readQuakeCCompatibility(encoded, program.digest).combat;
  if (declaration === undefined) throw new Error("Missing declared source combat");
  expect(program.api.kind).toBe("q1-quakeworld");
  expect(() => id1ProgramBinding(program)).toThrow("artifact-qualified combat declaration");
  expect(() => validateQcModCombat(program, { ...declaration, damage: { ...declaration.damage, arguments: declaration.damage.arguments.slice(0, 3) } })).toThrow();
  expect(() => id1ProgramBinding(program)).toThrow("artifact-qualified combat declaration");
  expect(() => readQuakeCCompatibility(encoded, "sha256:" + "0".repeat(64))).toThrow();
  validateQcModCombat(program, declaration);
  const binding = id1ProgramBinding(program);
  expect(binding.kind).toBe("quakeworld"); expect(binding.attribution).toBe("native");
  expect(binding.damage.index).toBe(program.functionNamed("T_Damage").index);
  for (const variant of ["normal", "death"] satisfies readonly ("normal" | "death")[]) {
    const plain = run(program, false, variant), observed = run(program, true, variant);
    expect(observed.bytes).toEqual(plain.bytes); expect(observed.outcomes).toHaveLength(1);
    const outcome = observed.outcomes[0]; if (outcome?.kind !== "committed") throw new Error("Missing original damage outcome");
    expect(outcome.decision.reaction).toBe(variant === "death" ? "death" : "pain");
  }
  expect(id1ProgramBinding(loadQcProgram(await Bun.file("/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat").bytes())).attribution).toBe("pinned");
});


test("declared attacker scaling queries original rune and quad paths once while retaining target Resistance", async () => {
  const { validateQcModCombat } = await import("../../../src/compat/qc/mod-combat.ts");
  const { readQuakeCCompatibility } = await import("../../../src/compat/qc/compatibility.ts");
  const { qcDamageScale } = await import("../../../src/content/q1/quakec/damage-scale.ts");
  const program = loadQcProgram(await Bun.file("/home/buzzkill/Projects/qfiles/q1/ctf/qwprogs.dat").bytes());
  const declaration = readQuakeCCompatibility(new TextEncoder().encode(JSON.stringify({ version: 1, artifactDigest: program.digest,
    combat: { damage: { function: "T_Damage", arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "inflictor" },
      { kind: "input", name: "attacker" }, { kind: "input", name: "amount" }], globals: [{ name: "time", value: { kind: "input", name: "time" } }] },
      damageScale: { function: "T_Damage", entry: 2957, exit: 2967, damage: 2294, statements: program.statements.slice(2957, 2968) } },
  })), program.digest).combat;
  if (declaration?.damageScale === undefined) throw new Error("Missing declared source scale");
  validateQcModCombat(program, declaration);
  for (const [quad, expected] of [[false, 2], [true, 8]] satisfies readonly (readonly [boolean, number])[]) {
    const options = { declaration, quad, strength: true, resistance: true };
    const native = run(program, false, "normal", undefined, options);
    const selected = run(program, true, "normal", undefined, { ...options, owner: "test:qc" });
    const independentlyOwned = run(program, true, "normal", undefined, { ...options, owner: "test:other" });
    expect(selected.factor).toBe(expected);
    expect(selected.health).toBe(1000 - 40 * expected / 2);
    expect(selected.bytes).toEqual(native.bytes);
    expect(independentlyOwned.bytes).toEqual(native.bytes);
  }
  const scale = declaration.damageScale;
  expect(() => qcDamageScale(program, declaration.damage, { ...scale, kind: "identity" })).toThrow("changes its original damage input");
  const identityStatements = program.statements.map((statement, index) => index === 2960 || index === 2965
    ? { opcode: QcOpcode.StoreF, a: statement.a, b: statement.c, c: 0 } : statement);
  const identityProgram = changedProgram(program, identityStatements);
  const identity = readQuakeCCompatibility(new TextEncoder().encode(JSON.stringify({ version: 1, artifactDigest: identityProgram.digest,
    combat: { ...declaration, damageScale: { ...scale, kind: "identity", statements: identityStatements.slice(scale.entry, scale.exit + 1) } },
  })), identityProgram.digest).combat;
  if (identity?.damageScale === undefined) throw new Error("Missing explicit source identity contract");
  const identityScale = identity.damageScale;
  expect(identityScale.kind).toBe("identity");
  validateQcModCombat(identityProgram, identity);
  const unchanged = { declaration: identity, quad: true, strength: true, resistance: true };
  const originalIdentity = run(identityProgram, false, "normal", undefined, unchanged);
  const selectedIdentity = run(identityProgram, true, "normal", undefined, { ...unchanged, owner: "test:qc" });
  expect(selectedIdentity.factor).toBe(1); expect(selectedIdentity.health).toBe(980);
  expect(selectedIdentity.bytes).toEqual(originalIdentity.bytes);
  expect(() => qcDamageScale(identityProgram, identity.damage, { ...identityScale, kind: "multiplier" })).toThrow("no original multiplicative result");
  expect(() => qcDamageScale(program, declaration.damage, { ...scale, exit: 2974, statements: program.statements.slice(2957, 2975) })).toThrow("target/inflictor");
  const statements = [...program.statements]; const multiply = statements[2960];
  if (multiply === undefined) throw new Error("Missing original multiply");
  statements[2960] = { ...multiply, opcode: QcOpcode.AddF };
  const nonLinear = changedProgram(program, statements);
  expect(() => qcDamageScale(nonLinear, declaration.damage, { ...scale, statements: statements.slice(scale.entry, scale.exit + 1) })).toThrow("nonmultiplicative");
  expect(() => qcDamageScale(nonLinear, declaration.damage, scale)).toThrow("differ");
  const operation = { ...declaration, damageScale: { ...scale, kind: "transform", statements: statements.slice(scale.entry, scale.exit + 1) } } satisfies NonNullable<ModCallbackDeclaration["combat"]>;
  validateQcModCombat(nonLinear, operation);
  const transformedOptions = { declaration: operation, quad: true, strength: true, resistance: true };
  const originalTransform = run(nonLinear, false, "normal", undefined, transformedOptions);
  const selectedTransform = run(nonLinear, true, "normal", undefined, { ...transformedOptions, owner: "test:qc" });
  expect(selectedTransform.transformed).toBe(88); expect(selectedTransform.health).toBe(956);
  expect(selectedTransform.bytes).toEqual(originalTransform.bytes);
  // Original current time at impact removes Quad's addition without removing Strength.
  const expired = { ...transformedOptions, time: 12 };
  const expiredSelected = run(nonLinear, true, "normal", undefined, { ...expired, owner: "test:qc" });
  expect(expiredSelected.transformed).toBe(80);
  expect(expiredSelected.bytes).toEqual(run(nonLinear, false, "normal", undefined, expired).bytes);
  const worldSelected = run(nonLinear, true, "normal", undefined, { ...transformedOptions, owner: "test:qc" }, { worldAttacker: true });
  expect(worldSelected.transformed).toBe(40);
  expect(worldSelected.bytes).toEqual(run(nonLinear, false, "normal", undefined, transformedOptions, { worldAttacker: true }).bytes);
  const dependentStatements = statements.map((statement, index) => index === 2958 ? { ...statement, b: scale.damage } : statement);
  const dependent = changedProgram(program, dependentStatements);
  const dependentDeclaration = { ...operation, damageScale: { ...operation.damageScale, statements: dependentStatements.slice(scale.entry, scale.exit + 1) } };
  validateQcModCombat(dependent, dependentDeclaration);
  for (const amount of [6, 12]) {
    const options = { ...transformedOptions, declaration: dependentDeclaration };
    const selected = run(dependent, true, "normal", undefined, { ...options, owner: "test:qc" }, { amount });
    expect(selected.transformed).toBe(amount < 10 ? (amount + 4) * 2 : amount * 2);
    expect(selected.bytes).toEqual(run(dependent, false, "normal", undefined, options, { amount }).bytes);
  }
  const initial = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
  const three = program.globals.find(global => global.type === "float" && initial.getFloat32(global.offset * 4, true) === 3);
  if (three === undefined) throw new Error("Original source constant three is missing");
  const roundedStatements = program.statements.map((statement, index) => index === 2960 ? { ...statement, opcode: QcOpcode.DivF, b: three.offset } : statement);
  const rounded = changedProgram(program, roundedStatements);
  const roundedDeclaration = { ...operation, damageScale: { ...operation.damageScale, statements: roundedStatements.slice(scale.entry, scale.exit + 1) } };
  validateQcModCombat(rounded, roundedDeclaration);
  const roundedOptions = { ...transformedOptions, declaration: roundedDeclaration };
  const roundedSelected = run(rounded, true, "normal", undefined, { ...roundedOptions, owner: "test:qc" }, { amount: 0.3 });
  expect(roundedSelected.transformed).toBe(Math.fround(Math.fround(Math.fround(0.3) / 3) * 2));
  expect(roundedSelected.transformed).not.toBe(Math.fround(Math.fround(0.3) * Math.fround(Math.fround(1 / 3) * 2)));
  expect(roundedSelected.bytes).toEqual(run(rounded, false, "normal", undefined, roundedOptions, { amount: 0.3 }).bytes);

});


test("declared private QC damage ABI maps reordered arguments and scoped globals without rebuilding extra values", async () => {
  const { validateQcModCombat } = await import("../../../src/compat/qc/mod-combat.ts");
  const base = await readProgram("id1/PAK0.PAK"), original = base.functionNamed("T_Damage"), start = original.parameterStart;
  const attackerGlobal = base.globalsByName.get("damage_attacker");
  if (attackerGlobal === undefined) throw new Error("Missing original attacker context");
  const end = base.functions.reduce((limit, fn) => fn.firstStatement > original.firstStatement ? Math.min(limit, fn.firstStatement) : limit, base.statements.length);
  const remap = (word: number): number => word === start ? start + 1 : word === start + 1 ? start + 3 : word === start + 2 ? attackerGlobal.offset : word === start + 3 ? start : word;
  const statements = base.statements.map((statement, index) => {
    if (index < original.firstStatement || index >= end || statement.opcode === QcOpcode.Goto) return statement;
    const { opcode, a, b, c } = statement;
    if (opcode === QcOpcode.If || opcode === QcOpcode.IfNot || opcode === QcOpcode.Return || opcode === QcOpcode.Done || opcode >= QcOpcode.Call0 && opcode <= QcOpcode.Call8)
      return { ...statement, a: remap(a) };
    return { opcode, a: remap(a), b: remap(b), c: remap(c) };
  });
  const program = new QcProgram(base.source, base.api, statements, base.globals.map(global => {
    if (global.name === "T_Damage") return { ...global, name: "PrivateDamage" };
    if (global.offset === start || global.offset === start + 2) return { ...global, name: global.offset === start ? "private_amount" : "private_extra", type: "float", nativeType: 2 };
    if (global.offset === start + 3) return { ...global, name: "private_inflictor", type: "entity", nativeType: 4 };
    return global;
  }), base.fields, base.functions.map(fn => fn.index === original.index ? { ...fn, name: "PrivateDamage", parameterSizes: [1, 1, 1, 1, 3] } : fn),
    base.strings, base.initialGlobals, base.entityFieldWords, base.checksum, createContentDigest("1".repeat(64)));
  const damage: ModSourceCall = { function: "PrivateDamage", arguments: [{ kind: "input", name: "amount" }, { kind: "input", name: "self" },
    { kind: "float", value: 7 }, { kind: "input", name: "inflictor" }, { kind: "vector", value: { x: 11, y: 12, z: 13 } }],
    globals: [{ name: "damage_attacker", value: { kind: "input", name: "attacker" } }, { name: "time", value: { kind: "input", name: "time" } }] };
  expect(() => id1ProgramBinding(program)).toThrow("T_Damage");
  validateQcModCombat(program, { damage });
  const { qcDamageScale } = await import("../../../src/content/q1/quakec/damage-scale.ts");
  expect(qcDamageScale(program, damage, { function: "PrivateDamage", entry: 1426, exit: 1431, damage: start,
    statements: program.statements.slice(1426, 1432) })).not.toBeNull();
  const extra = { index: 4, value: 99 };
  const plain = run(program, false, "normal", undefined, undefined, { amount: 42, worldAttacker: true, extra });
  const observed = run(program, true, "normal", authority => {
    authority.damageOperation.register({ provider: "test:transform", id: "test:reorder", kind: "transform", order: 0,
      transform: request => ({ ...request, amount: request.amount + 2, attack: { ...request.attack, attacker: null } }) });
  }, undefined, { extra });
  expect(observed.bytes).toEqual(plain.bytes);
  expect(observed.attackerContext).toEqual([observed.sourceAttacker]);
  expect(observed.outcomes).toHaveLength(1);
  const outcome = observed.outcomes[0];
  if (outcome?.kind !== "committed") throw new Error("Missing declared private damage outcome");
  expect(outcome.decision.request.amount).toBe(42); expect(outcome.decision.request.attack.attacker).toBeNull();
  expect(outcome.decision.reaction).toBe("pain");
  expect(() => validateQcModCombat(program, { damage: { ...damage, arguments: damage.arguments.slice(0, 4) } })).toThrow("signature");
  expect(() => validateQcModCombat(program, { damage: { ...damage, globals: damage.globals.slice(1) } })).toThrow("missing attacker");
});


test("QC redirected damage uses the current target owner without replaying original source stores", async () => {
  const program = await readProgram("id1/PAK0.PAK");
  for (const mode of ["redirect", "rebind"]) {
    let health = 100, calls = 0, transforms = 0;
    const result = run(program, true, "normal", (authority, actors) => {
      const foreign = actors.allocate("test:foreign", "test:target");
      const binding = {
        read: () => ({ health, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null } satisfies CombatState),
        writeHealth: () => { throw new Error("Replayed foreign health"); }, writeArmor: () => { throw new Error("Replayed foreign armor"); },
        sourceDamage: (request: DamageRequest) => authority.apply(request, current => authority.runSourceDamage(current, (observer, effective) => {
          calls++;
          const before = health; health -= effective.amount;
          observer.stored({ kind: "health", before, after: health });
          return { appliedDamage: effective.amount, reaction: "none" };
        })),
      };
      authority.bind(foreign, binding);
      authority.damageOperation.register({ provider: "q2:mod", id: "redirect:damage", order: 0, kind: "transform", transform: request => {
        transforms++;
        if (mode === "redirect") return { ...request, target: foreign.id };
        const target = actors.resolveOwned(request.target);
        if (target === null) throw new Error("Missing original target");
        authority.rebind(target, binding);
        return request;
      } });
    });
    expect(result.health).toBe(100); expect(result.attackerHealth).toBe(100);
    expect(health).toBe(60); expect(calls).toBe(1); expect(transforms).toBe(1);
    expect(result.outcomes).toHaveLength(1);
  }
});
