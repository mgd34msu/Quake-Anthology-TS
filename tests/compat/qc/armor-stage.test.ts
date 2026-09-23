import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ArmorStageInput, DamageOutcome, PoweredProtectionState } from "../../../src/contracts/gameplay.ts";
import type { ModQcArmorStage, ModCallbackDeclaration, ModActorField } from "../../../src/contracts/mod-callbacks.ts";
import type { OriginalPickupOffer } from "../../../src/contracts/original-pickups.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { QcProgram, QcOpcode, loadQcProgram, type QcDefinition, type QcFunction, type QcStatement } from "../../../src/compat/qc/program.ts";
import { QcEntityMemory, QcMachine, classicQcEntityLayout, createQcActorBindings, createQcBuiltins, createQcSourceSlotStorage } from "../../../src/compat/qc/index.ts";
import { SessionActorRegistry, ActorCallbackTable, SourceActorSlots, quakeEdictLifetime, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";
import { QcModProvider, validateQcMod } from "../../../src/compat/qc/mod-provider.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";
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
    const words = entities.at(slot), stage = binding.protectionStage(actor, "powered"), regularStage = binding.protectionStage(actor, "regular");
    words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2); words.setFloat(field("movetype"), 3);
    words.setFloat(field("armorvalue"), 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field(profile.armorField), profile.armorMasks[0]);
    words.setInt(field("classname"), vm.strings.allocate(slot === 1 ? "attacker" : "target"));
    words.setInt(field("th_pain"), program.functionNamed("SUB_Null").index); words.setInt(field("th_die"), program.functionNamed("SUB_Null").index);
    words.setVector(field("origin"), { x: slot * 20, y: 0, z: 0 });
    authority.bind(actor, { sourceDamage: () => { throw new Error("Use original source entry"); }, protection: { powered: { owner: null, ...(stage === null ? {} : { stage }) }, regular: { owner: actor.owner, ...(regularStage === null ? {} : { stage: regularStage }) } },
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
    const remove = authority.bindProtection(target, { channel: "powered", owner: "borrowed:power", rule: "test:absorb", admission: { kind: "claim" }, inventoryItems: ["q2:ammo_cells"],
      read: () => power, validateWrite: () => undefined, write: next => { power = next; return undefined; }, absorb: (input, observer) => {
        inputs.push(input);
        if (nested) return { saved: 0 };
        const before = power;
        if (before.kind === "none") throw new Error("Missing powered state");
        power = { ...before, cells: before.cells - 1 }; observer.stored({ powered: { before, after: power } });
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
  const skipped = make((_region, execute) => execute.skipToJoin()); skipped.execute(damage, 4);
  expect(skipped.entities.at(2).float(skipped.fieldOffset("armorvalue"))).toBe(40);
  expect(skipped.entities.at(2).float(skipped.fieldOffset("health"))).toBe(60);
  const twice = make((_region, execute) => { execute.skipToJoin(); try { execute(); } catch {} return undefined; });
  expect(() => twice.execute(damage, 4)).toThrow("once inside its boundary"); twice.snapshot();
});

test("declared original Copper region supplies regular armor after power to original Hipnotic", async () => {
  const primary = fixture(await readProgram("rerelease/hipnotic/pak0.pak")), program = loadQcProgram(await Bun.file(copper).bytes());
  const fields: ModActorField[] = [], occupied = new Set<number>();
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1, words = Array.from({ length: width }, (_, index) => field.offset + index);
    if (field.name === "" || words.some(word => occupied.has(word))) continue;
    words.forEach(word => occupied.add(word)); fields.push({ field: field.name, binding: "private" });
  }
  const declaration = readModCallbacks(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest },
    actorFields: fields, callbacks: [], clients: { maximum: 1, admit: [], userinfo: [], disconnect: [] }, protection: [{
      id: "copper:regular", channel: "regular", admission: { kind: "replace-current-primary" }, storage: { points: "armorvalue", item: "q1:item_armor1" },
      flags: { noArmor: 4, noPowerArmor: 0, noRegularArmor: 0, energy: 0, radius: 0 },
      absorb: { kind: "region", stage: copperStage(program), call: { function: "T_DamageApply", arguments: [
        { kind: "input", name: "self" }, { kind: "input", name: "inflictor" }, { kind: "input", name: "attacker" },
        { kind: "input", name: "amount" }, { kind: "input", name: "damage-flags" }], globals: [{ name: "time", value: { kind: "input", name: "time" } }] } },
    }] } satisfies ModCallbackDeclaration)));
  const client = createIdentityOwner("qc-regular-donor").client(0, 0), rng = new SourceRandom(17);
  const createSource = (declaration: ModCallbackDeclaration) => new QcModProvider(program, { id: "mod:copper-armor", artifactPath: "progs.dat", digest: program.digest, revision: "test" }, declaration,
    { actors: primary.actors, combat: primary.authority, inventory: new SharedInventoryTable(primary.actors), seed: 17, time: () => ({ kind: "seconds", value: 3 }),
      bodies: new SharedBodyTable(primary.actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }),
      clients: { maximum: 1, clients: () => [{ client, actor: primary.target.id }], forActor: actor => actor.equals(primary.target.id) ? client : null,
        actor: current => current.equals(client) ? primary.target.id : null, userinfo: () => "", setUserinfo: () => undefined, command: () => null,
        subscribe: () => () => undefined, subscribeApplication: () => () => undefined, drop: () => undefined } },
    { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: state => {
      if (state.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(state);
    } });
  const source = createSource(declaration);
  try {
    source.initialize();
    const words = source.machine.entities.at(1), field = (name: string) => source.machine.fieldOffset(name);
    words.setFloat(field("armorvalue"), 100); words.setFloat(field("armortype"), 0.8); words.setFloat(field("takedamage"), 2);
    words.setInt(field("classname"), source.machine.strings.allocate("donor"));
    const beforeFrame = source.machine.globals.bytes.slice(program.functionNamed("T_DamageApply").parameterStart * 4,
      (program.functionNamed("T_DamageApply").parameterStart + program.functionNamed("T_DamageApply").localWords) * 4);
    const power = primary.bindPower(); primary.targetWords.setFloat(primary.field("flags"), 8);
    primary.invoke(40);
    expect(power.inputs[0]?.amount).toBe(40);
    expect(words.float(field("armorvalue"))).toBe(84);
    expect(primary.targetWords.float(primary.field("armorvalue"))).toBe(40);
    expect(primary.targetWords.float(primary.field("health"))).toBe(96);
    expect(primary.targetWords.float(primary.field("dmg_save"))).toBe(36);
    expect(primary.authority.read(primary.target.id)?.armor.regular).toEqual({ kind: "source", points: 84, item: "q1:item_armor1" });
    expect(source.machine.globals.bytes.slice(program.functionNamed("T_DamageApply").parameterStart * 4,
      (program.functionNamed("T_DamageApply").parameterStart + program.functionNamed("T_DamageApply").localWords) * 4)).toEqual(beforeFrame);
    const saved = source.checkpoint();
    words.setFloat(field("armortype"), 0.2); primary.invoke(40);
    expect(words.float(field("armorvalue"))).toBe(80); expect(primary.targetWords.float(primary.field("health"))).toBe(80);
    source.restore(saved); expect(primary.authority.read(primary.target.id)?.armor.regular).toEqual({ kind: "source", points: 84, item: "q1:item_armor1" });
    primary.authority.setRegularPoints(primary.target, 0);
    expect(primary.authority.read(primary.target.id)?.armor.regular).toEqual({ kind: "source", points: 0, item: "q1:item_armor1" });
    primary.authority.setRegularPoints(primary.target, 50); expect(words.float(field("armorvalue"))).toBe(50);
    source.close(); expect(primary.authority.read(primary.target.id)?.armor.regular).toMatchObject({ kind: "q1", points: 40 });
    primary.invoke(40); expect(primary.targetWords.float(primary.field("armorvalue"))).toBe(34);
    power.remove();
    const both = createSource({ ...declaration, protection: [...(declaration.protection ?? []), {
      id: "copper:shared-pool", channel: "powered", storage: { cells: "armorvalue", kind: "shield" },
      flags: { noArmor: 0, noPowerArmor: 0, noRegularArmor: 0, energy: 0, radius: 0 },
      absorb: { kind: "function", call: { function: "SUB_Null", arguments: [], globals: [] } },
    }] });
    try {
      both.initialize();
      const donor = both.machine.entities.at(1);
      donor.setFloat(field("armorvalue"), 100); donor.setFloat(field("armortype"), 0.8); donor.setFloat(field("takedamage"), 2);
      donor.setInt(field("classname"), both.machine.strings.allocate("donor"));
      primary.targetWords.setFloat(primary.field("health"), 100); primary.invoke(40);
      expect(primary.authority.read(primary.target.id)?.armor).toEqual({ regular: { kind: "source", points: 68, item: "q1:item_armor1" }, powered: { kind: "shield", cells: 68 } });
      const outcome = primary.outcomes.at(-1); if (outcome?.kind !== "committed") throw new Error("Missing cross-lane outcome");
      expect(outcome.decision.mutations.filter(change => change.kind === "armor")).toHaveLength(1);
      expect(primary.targetWords.float(primary.field("health"))).toBe(92);
      expect(primary.targetWords.float(primary.field("armorvalue"))).toBe(34);
    } finally { both.close(); }
  } finally { source.close(); primary.actors.close(); }
});

test("original Copper pickups decide refusal and publish each tier store during nested source damage", async () => {
  const primary = fixture(await readProgram("rerelease/hipnotic/pak0.pak")), program = loadQcProgram(await Bun.file(copper).bytes());
  const fields: ModActorField[] = [], occupied = new Set<number>();
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1, words = Array.from({ length: width }, (_, index) => field.offset + index);
    if (field.name === "" || words.some(word => occupied.has(word))) continue;
    words.forEach(word => occupied.add(word)); fields.push({ field: field.name, binding: "private" });
  }
  const declaration = readModCallbacks(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest },
    actorFields: fields, callbacks: [], clients: { maximum: 1, admit: [], userinfo: [], disconnect: [] }, protection: [{
      id: "copper:regular", channel: "regular", admission: { kind: "replace-current-primary" }, storage: { points: "armorvalue", item: null,
        selection: { field: "items", mask: 8192 | 16384 | 32768, values: [{ value: 0, item: null }, { value: 8192, item: "q1:item_armor1" },
          { value: 16384, item: "q1:item_armor2" }, { value: 32768, item: "q1:item_armorInv" }] } },
      flags: { noArmor: 4, noPowerArmor: 0, noRegularArmor: 0, energy: 0, radius: 0 },
      absorb: { kind: "region", stage: copperStage(program), call: { function: "T_DamageApply", arguments: [
        { kind: "input", name: "self" }, { kind: "input", name: "inflictor" }, { kind: "input", name: "attacker" },
        { kind: "input", name: "amount" }, { kind: "input", name: "damage-flags" }], globals: [{ name: "time", value: { kind: "input", name: "time" } }] } },
    }], pickups: [{ id: "copper:green", resource: { kind: "protection", channel: "regular" }, offered: ["q1:item_armor1"], operation: { kind: "boolean-grant",
      grant: { function: "armor_give", arguments: [{ kind: "input", name: "self" }, { kind: "float", value: 100 }, { kind: "float", value: 0.3 }, { kind: "float", value: 1 }], globals: [] } } },
    { id: "copper:red", resource: { kind: "protection", channel: "regular" }, offered: ["q1:item_armorInv"], operation: { kind: "boolean-grant",
      grant: { function: "armor_give", arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "pickup-count" }, { kind: "float", value: 0.7 }, { kind: "float", value: 1 }],
        globals: [{ name: "other", value: { kind: "input", name: "other" } }, { name: "time", value: { kind: "input", name: "time" } }] } } }] } satisfies ModCallbackDeclaration)));
  const client = createIdentityOwner("qc-pickup-client").client(0, 0), inventory = new SharedInventoryTable(primary.actors), rng = new SourceRandom(19);
  const firstRule = declaration.pickups?.[0]; if (firstRule === undefined) throw new Error("Missing declared pickup rule");
  expect(() => validateQcMod(program, { ...declaration, pickups: [...(declaration.pickups ?? []), { ...firstRule, id: "duplicate:offered" }] })).toThrow("distinct offered items");
  expect(() => validateQcMod(program, { ...declaration, pickups: [{ ...firstRule, resource: { kind: "inventory", item: "q1:ammo/shells" } }] })).toThrow("declared source storage");
  inventory.create(primary.target, []);
  const source = new QcModProvider(program, { id: "mod:copper-pickup", artifactPath: "progs.dat", digest: program.digest, revision: "test" }, declaration,
    { actors: primary.actors, combat: primary.authority, inventory, seed: 19, time: () => ({ kind: "seconds", value: 3 }),
      bodies: new SharedBodyTable(primary.actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }),
      clients: { maximum: 1, clients: () => [{ client, actor: primary.target.id }], forActor: actor => actor.equals(primary.target.id) ? client : null,
        actor: current => current.equals(client) ? primary.target.id : null, userinfo: () => "", setUserinfo: () => undefined, command: () => null,
        subscribe: () => () => undefined, subscribeApplication: () => () => undefined, drop: () => undefined } },
    { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: state => {
      if (state.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(state);
    } });
  const pickup = primary.actors.allocate("map:items", "q1:item_armorInv"), admission = new SharedOriginalPickupAdmission(primary.actors, primary.authority, inventory);
  const offer: OriginalPickupOffer = { recipient: primary.target.id, pickup: pickup.id, source: "map:items", item: "q1:item_armorInv",
    defaultResource: { kind: "protection", channel: "regular" }, count: { kind: "override", amount: 200 }, dropped: false, time: { kind: "milliseconds", value: 3000 } };
  let fallback = 0; const completed: boolean[] = [];
  const continuation = { original: () => { fallback++; return true; }, complete: (taken: boolean) => { completed.push(taken); } };
  try {
    source.initialize();
    const words = source.machine.entities.at(1), field = (name: string) => source.machine.fieldOffset(name);
    words.setFloat(field("armorvalue"), 100); words.setFloat(field("armortype"), 0.7); words.setFloat(field("items"), 32768);
    words.setFloat(field("takedamage"), 2); words.setInt(field("classname"), source.machine.strings.allocate("player"));
    expect(admission.touch({ ...offer, item: "q1:item_armor1", count: { kind: "default" } }, continuation)).toBe("refused");
    expect(words.float(field("armorvalue"))).toBe(100); expect(completed).toEqual([false]); expect(fallback).toBe(0);
    expect(admission.touch({ ...offer, item: "q2:item_armor_body" }, continuation)).toBe("refused");
    expect(fallback).toBe(0);
    words.setFloat(field("armorvalue"), 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field("items"), 8192);
    const selected = primary.authority.resolvePickup(primary.target, offer).matches[0]; if (selected === undefined) throw new Error("Missing source pickup rule");
    const stores: string[] = [];
    let nested = false;
    const power = primary.bindPower(() => {
      expect(primary.authority.withPickupProtection(primary.target, selected.owner, observer => selected.take(offer, { stored: change => {
        observer.stored(change);
        const armor = primary.authority.read(primary.target.id)?.armor.regular;
        if (armor?.kind !== "source") throw new Error("Missing source armor");
        stores.push(`${armor.points}:${armor.item}`);
        if (!nested) { nested = true; primary.invoke(10); }
        return undefined;
      } }))).toBe("accepted");
    });
    primary.invoke(40);
    expect(stores).toEqual(["200:q1:item_armor1", "197:null", "197:q1:item_armorInv"]);
    expect(words.float(field("armorvalue"))).toBe(183);
    expect(words.float(field("armortype"))).toBe(Math.fround(0.7));
    expect(primary.targetWords.float(primary.field("armorvalue"))).toBe(40);
    expect(primary.targetWords.float(primary.field("health"))).toBe(87);
    power.remove();
    const saved = source.checkpoint(); source.restore(saved); expect(selected.current()).toBe(false);
    expect(admission.touch(offer, continuation)).toBe("accepted");
    expect(primary.authority.read(primary.target.id)?.armor.regular).toEqual({ kind: "source", points: 200, item: "q1:item_armorInv" });
    expect(completed).toEqual([false, false, true]); expect(fallback).toBe(0);
    expect(() => admission.touch({ ...offer, count: { kind: "override", amount: 16777217 } }, continuation)).toThrow("source scalar ABI");
    source.close();
    expect(admission.touch(offer, continuation)).toBe("accepted"); expect(fallback).toBe(1);
    expect(primary.authority.read(primary.target.id)?.armor.regular).toMatchObject({ kind: "q1", points: 40 });
  } finally { source.close(); primary.actors.close(); }
});

test("QC armor admission validates original profiles and declared statement control flow", async () => {
  for (const path of ["id1/PAK0.PAK", "hipnotic/pak0.pak", "rogue/pak0.pak", "rerelease/id1/pak0.pak", "rerelease/hipnotic/pak0.pak",
    "rerelease/rogue/pak0.pak", "rerelease/ctf/pak0.pak", "rerelease/dopa/pak0.pak", "rerelease/mg3/pak0.pak"]) {
    expect(qcArmorStage(await readProgram(path))?.region.replaceable).toBe(true);
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
  const deathmatch = program.globalsByName.get("deathmatch"); if (deathmatch === undefined) throw new Error("Missing source global");
  const privateWrite = program.statements.map((statement, index) => index === declaration.exit - 1
    ? { opcode: QcOpcode.StoreF, a: declaration.damage, b: deathmatch.offset, c: 0 } : statement);
  const unsafe = new QcProgram(program.source, program.api, privateWrite, program.globals, program.fields, program.functions,
    program.strings, program.initialGlobals, program.entityFieldWords, program.checksum, createContentDigest("1".repeat(64)));
  const unsafeStage = qcArmorStage(unsafe, { ...declaration, statements: privateWrite.slice(declaration.entry, declaration.exit + 1) });
  expect(unsafeStage).not.toBeNull(); expect(unsafeStage?.region.replaceable).toBeUndefined(); expect(unsafeStage?.region.standalone).toBeUndefined();
});

test("standalone QC regions reject a caller local read through nested helpers", () => {
  const statement = (opcode: QcOpcode, a = 0, b = 0, c = 0): QcStatement => ({ opcode, a, b, c });
  const statements = [statement(QcOpcode.Done), statement(QcOpcode.StoreF, 41, 43),
    statement(QcOpcode.LoadF, 40, 30, 44), statement(QcOpcode.Call0, 31), statement(QcOpcode.StoreF, 1, 42),
    statement(QcOpcode.SubF, 41, 42, 41), statement(QcOpcode.Return, 41),
    statement(QcOpcode.Call0, 32), statement(QcOpcode.Return, 1), statement(QcOpcode.StoreF, 43, 1), statement(QcOpcode.Return, 1)];
  const definition = (name: string, offset: number, type: QcDefinition["type"], nativeType: number): QcDefinition => ({ name, offset, type, nativeType, save: false });
  const fn = (index: number, name: string, firstStatement: number, parameterStart: number, localWords: number, parameterSizes: readonly number[]): QcFunction => ({ index, name, firstStatement, parameterStart, localWords, parameterSizes, file: "review.qc", namedBuiltin: false });
  const initial = new Uint8Array(128 * 4), data = new DataView(initial.buffer); data.setInt32(31 * 4, 2, true); data.setInt32(32 * 4, 3, true); data.setFloat32(43 * 4, 7, true);
  const program = new QcProgram("nested-frame-read", { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 }, statements,
    [definition("armortype", 30, "field", 5), definition("HelperA", 31, "function", 6), definition("HelperB", 32, "function", 6),
      definition("target", 40, "entity", 4), definition("damage", 41, "float", 2), definition("saved", 42, "float", 2)],
    [definition("armortype", 0, "float", 2)], [fn(0, "", 0, 0, 0, []), fn(1, "T_Damage", 1, 40, 5, [1, 1]), fn(2, "HelperA", 7, 50, 0, []), fn(3, "HelperB", 9, 55, 0, [])],
    new Uint8Array([0]), initial, 1, 5927, createContentDigest("ef".repeat(32)));
  const stage = qcArmorStage(program, { function: "T_Damage", entry: 2, exit: 5, target: 40, damage: 41, saved: 42, flags: { kind: "none" }, statements: statements.slice(2, 6) });
  expect(stage?.region.replaceable).toBe(true);
  expect(stage?.region.standalone).toBeUndefined();
});
