import { describe, expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { QcEntityMemory, QcMachine, QcStrings, QuakeCExecutor, applyQcEntityPairs, classicQcEntityLayout, createQcActorBindings, createQcBuiltins, createQcSourceSlotStorage, describeQcHost, loadQcProgram, qcLinkBounds, saveQcEntityPairs } from "../../../src/compat/qc/index.ts";
import type { QcBuiltin, QcHostBuiltinName, QcProgram } from "../../../src/compat/qc/index.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import type { SourceDamageObserver, SourceDamageResult } from "../../../src/world/gameplay/authority.ts";
import type { ArmorState, DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";

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
  test("verified id1 bytecode damage reports source stores through the same authority without replay", async () => {
    const program = await readProgram("id1/PAK0.PAK");
    expect(program.digest).toBe("sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580");
    const damage = program.functionNamed("T_Damage"), pain = program.functionNamed("SUB_Null");
    expect(damage.index).toBe(117);
    expect(damage.firstStatement).toBe(1421);
    const field = (name: string): number => {
      const value = program.fieldsByName.get(name);
      if (value === undefined) throw new Error(`Missing id1 field ${name}`);
      return value.offset;
    };
    // These sites and the take local belong only to the verified artifact above.
    const takeWord = 1589, painCall = 1568;
    const run = (observed: boolean, variant: "normal" | "exhausted" | "invulnerable" = "normal") => {
      const entities = new QcEntityMemory(classicQcEntityLayout(program), 8);
      const actors = new SessionActorRegistry(createIdentityOwner(`qc-damage-${observed}`));
      const bodies = new SharedBodyTable(actors, {
        absoluteBounds: (_actor, state) => qcLinkBounds(state, 0, createNumericOperations(Q1_DONOR_PROFILE)),
        onLink: () => undefined, onUnlink: () => undefined,
      }), callbacks = new ActorCallbackTable(actors);
      const storage = createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 });
      const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 8, lifetime: quakeEdictLifetime(1), storage,
        now: () => ({ kind: "seconds", value: 3 }), unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No test edicts"); } });
      slots.bindExisting(0, "quakec:world");
      const attacker = slots.allocate("quakec:attacker"), target = slots.allocate("quakec:target");
      const words = entities.at(2);
      words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2);
      words.setFloat(field("armorvalue"), variant === "exhausted" ? 5 : 40); words.setFloat(field("armortype"), 0.3);
      words.setFloat(field("movetype"), 3); words.setInt(field("th_pain"), pain.index); words.setInt(field("th_die"), pain.index);
      words.setFloat(field("items"), 8192);
      if (variant === "invulnerable") {
        words.setFloat(field("invincible_finished"), 10);
        words.setFloat(field("invincible_sound"), 10);
      }
      words.setVector(field("origin"), { x: 40, y: 12, z: 8 });
      words.setVector(field("velocity"), { x: 0.1, y: -0.2, z: 0.3 });
      bodies.bind(target, { read: () => ({ origin: words.vector(field("origin")), angles: words.vector(field("angles")), velocity: words.vector(field("velocity")),
        bounds: { min: words.vector(field("mins")), max: words.vector(field("maxs")) }, ground: null }),
        write: value => { words.setVector(field("origin"), value.origin); words.setVector(field("velocity"), value.velocity); return undefined; } });
      const armor = (): ArmorState => ({ kind: "q1", points: words.float(field("armorvalue")), absorption: words.float(field("armortype")), item: "q1:armor" });
      const order: string[] = [], outcomes: DamageOutcome[] = [];
      let onBeforeReaction: (() => undefined) | null = null;
      const authority = new GameplayAuthority(actors, callbacks, {
        impulse: () => { throw new Error("Source velocity was replayed"); },
        beforeReaction: () => { order.push("before-reaction"); onBeforeReaction?.(); return undefined; },
        confirmed: value => { order.push("confirmed"); outcomes.push(value); return undefined; },
      });
      authority.bind(target, { read: () => ({ health: words.float(field("health")), armor: armor(), mass: 200, canTakeDamage: true, invulnerable: variant === "invulnerable", team: null }),
        writeHealth: () => { throw new Error("Source health was replayed"); }, writeArmor: () => { throw new Error("Source armor was replayed"); } });
      callbacks.bind(target, { think: null, touch: null, use: null,
        pain: () => { throw new Error("Source pain was replayed"); }, die: () => { throw new Error("Source death was replayed"); } });
      const request: DamageRequest = { attack: { sequence: 1, time: { kind: "seconds", value: 3 }, attacker: attacker.id, inflictor: attacker.id,
        weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "q1:movement", cause: { kind: "q1", deathType: "" } },
        target: target.id, amount: 40, knockback: 40, direction: { x: 40, y: 12, z: 8 }, point: { x: 40, y: 12, z: 8 }, normal: { x: 0, y: 0, z: 0 }, delivery: "direct" };
      const active: { observer: SourceDamageObserver | null; result: SourceDamageResult } = { observer: null, result: { appliedDamage: 0, reaction: "none" } };
      const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true,
        observeCall: call => {
          if (call.caller !== damage.index || (call.statement !== painCall && call.statement !== 1532)) return undefined;
          const result: SourceDamageResult = { appliedDamage: vm.globals.float(takeWord), reaction: call.statement === painCall ? "pain" : "death" };
          active.observer?.beforeReaction(result);
          active.result = result;
          order.push(`source-${result.reaction}`);
          return undefined;
        },
        observeEntityStore: store => {
          const observer = active.observer;
          if (observer === null || store.functionIndex !== damage.index || store.reference !== entities.reference(2)) return undefined;
          const before = new DataView(store.before.buffer, store.before.byteOffset, store.before.byteLength);
          const after = new DataView(store.after.buffer, store.after.byteOffset, store.after.byteLength);
          if (store.word === field("health")) observer.stored({ kind: "health", before: before.getFloat32(0, true), after: after.getFloat32(0, true) });
          if (store.word === field("armorvalue") || store.word === field("armortype")) {
            const current = armor();
            if (current.kind !== "q1") throw new Error("Expected QC armor");
            observer.stored({ kind: "armor", before: store.word === field("armorvalue") ? { ...current, points: before.getFloat32(0, true) } : { ...current, absorption: before.getFloat32(0, true) }, after: current });
          }
          if (store.word === field("velocity")) {
            const previous = { x: before.getFloat32(0, true), y: before.getFloat32(4, true), z: before.getFloat32(8, true) };
            const next = { x: after.getFloat32(0, true), y: after.getFloat32(4, true), z: after.getFloat32(8, true) };
            observer.stored({ kind: "source-velocity", movementProvider: "q1:movement", before: previous, after: next });
            previous.x = 999; next.x = 999;
          }
          store.before.fill(0); store.after.fill(0);
          return undefined;
        },
      });
      vm.globals.setFloat(vm.globalOffset("time"), 3);
      vm.globals.setInt(vm.globalOffset("self"), entities.reference(2));
      vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(1)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 40);
      const execute = (): SourceDamageResult => { vm.execute(damage.index, 4); return active.result; };
      if (observed) authority.runSourceDamage(request, observer => { active.observer = observer; return execute(); });
      else execute();
      const retained = active.observer;
      if (retained !== null) expect(() => retained.beforeReaction(active.result)).toThrow("closed");
      const result = { bytes: entities.bytes.slice(), health: words.float(field("health")), armor: armor(), velocity: bodies.read(target.id)?.velocity,
        order: [...order], outcomes: [...outcomes], painExecutions: vm.profiling[pain.index] ?? 0, request };
      if (observed && variant === "normal") {
        active.observer = null;
        const none: SourceDamageResult = { appliedDamage: 0, reaction: "none" };
        const nestedRequest = { ...request, attack: { ...request.attack, sequence: 2 } };
        onBeforeReaction = () => {
          onBeforeReaction = null;
          words.setFloat(field("movetype"), 0);
          authority.runSourceDamage({ ...nestedRequest, amount: 100, knockback: 100 }, observer => {
            active.observer = observer;
            try {
              vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(1)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 100);
              return execute();
            } finally { active.observer = null; }
          });
          return undefined;
        };
        authority.runSourceDamage(request, outer => { outer.beforeReaction(none); return none; });
        expect(outcomes.slice(1).map(value => value.kind === "committed" ? value.decision.request.attack.sequence : -1)).toEqual([2, 1]);
        expect(outcomes.slice(1).map(value => value.kind === "committed" && value.survived)).toEqual([false, false]);
        expect(words.float(field("health"))).toBe(0);
        const failed: { observer: SourceDamageObserver | null } = { observer: null };
        const errorText = vm.strings.setEngine("qc-damage-failure", "source execution failure");
        vm.globals.setInt(4, errorText);
        expect(() => authority.runSourceDamage(request, observer => {
          failed.observer = observer;
          vm.execute(program.functionNamed("error").index, 1);
          return none;
        })).toThrow("source execution failure");
        expect(outcomes).toHaveLength(3);
        const failedObserver = failed.observer;
        if (failedObserver === null) throw new Error("Missing failed source observer");
        expect(() => failedObserver.beforeReaction(none)).toThrow("closed");
        expect(vm.depth).toBe(0);
        vm.snapshot();
        authority.register({ id: "test:qc", decide: incoming => ({ request: incoming, appliedDamage: 1, reaction: "none", mutations: [
          { kind: "health", before: words.float(field("health")), after: 1 },
          { kind: "source-velocity", before: words.vector(field("velocity")), after: { x: 0, y: 0, z: 0 }, movementProvider: "q1:movement" },
        ] }) });
        expect(() => authority.apply(request)).toThrow("Observed source velocity cannot be replayed");
        expect(words.float(field("health"))).toBe(0);
        expect(outcomes).toHaveLength(3);
        authority.runSourceDamage(request, observer => {
          actors.release(target);
          expect(() => observer.stored({ kind: "health", before: result.health, after: result.health })).toThrow();
          return none;
        });
        expect(authority.runSourceDamage(request, () => { throw new Error("Stale source executed"); }).kind).toBe("stale-target");
      }
      actors.close();
      return result;
    };
    const control = run(false), observed = run(true);
    expect(observed.bytes).toEqual(control.bytes);
    expect(observed.health).toBe(72);
    expect(observed.armor).toEqual(control.armor);
    expect(observed.velocity).toEqual(control.velocity);
    expect(observed.painExecutions).toBeGreaterThan(0);
    expect(observed.order).toEqual(["before-reaction", "source-pain", "confirmed"]);
    expect(observed.outcomes).toHaveLength(1);
    const outcome = observed.outcomes[0];
    if (outcome?.kind !== "committed") throw new Error("Expected source damage outcome");
    expect(outcome.decision.request).toEqual(observed.request);
    expect(outcome.decision.appliedDamage).toBe(28);
    expect(outcome.decision.mutations.map(value => value.kind)).toEqual(["armor", "source-velocity", "health"]);
    const velocity = outcome.decision.mutations.find(value => value.kind === "source-velocity");
    if (velocity?.kind !== "source-velocity") throw new Error("Missing absolute source velocity");
    expect(velocity.before).toEqual({ x: Math.fround(0.1), y: Math.fround(-0.2), z: Math.fround(0.3) });
    if (observed.velocity === undefined) throw new Error("Missing shared body velocity");
    expect(velocity.after).toEqual(observed.velocity);
    expect(Object.isFrozen(velocity.after)).toBe(true);
    for (const variant of ["exhausted", "invulnerable"] satisfies readonly ("exhausted" | "invulnerable")[]) {
      const reference = run(false, variant), checked = run(true, variant);
      expect(checked.bytes).toEqual(reference.bytes);
      expect(checked.health).toBe(reference.health);
      expect(checked.armor).toEqual(reference.armor);
      expect(checked.velocity).toEqual(reference.velocity);
      const damageOutcome = checked.outcomes[0];
      if (damageOutcome?.kind !== "committed") throw new Error("Missing source variant outcome");
      expect(checked.outcomes).toHaveLength(1);
      if (variant === "invulnerable") {
        expect(checked.health).toBe(100);
        expect(damageOutcome.decision.appliedDamage).toBe(0);
        expect(damageOutcome.decision.mutations.some(value => value.kind === "source-velocity")).toBe(true);
        expect(damageOutcome.decision.mutations.some(value => value.kind === "health")).toBe(false);
      } else {
        expect(damageOutcome.decision.mutations.filter(value => value.kind === "armor")).toHaveLength(2);
        expect(checked.armor).toEqual({ kind: "q1", points: 0, absorption: 0, item: "q1:armor" });
        expect(damageOutcome.decision.appliedDamage).toBe(35);
      }
    }

  });
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

test.skipIf(!haveCorpus)("retail QC spatial builtins share raw bodies, source lifetimes and actual BSP traces", async () => {
  const { QcWorldHost, qcLinkBounds } = await import("../../../src/compat/qc/world-host.ts");
  const { SharedBodyTable } = await import("../../../src/world/actors/index.ts");
  const { createSceneQueries } = await import("../../../src/world/collision/index.ts");
  const { readQ1Bsp } = await import("../../../src/formats/q1-map/index.ts");
  const { parseEntities } = await import("../../../src/core/common-parse.ts");
  const archive = await openArchive(corpus + "rerelease/id1/pak0.pak");
  try {
    const entry = archive.findEntries("maps/start.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail start BSP");
    const world = readQ1Bsp(await archive.readEntry(entry)), scene = createSceneQueries(world);
    const start = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
    const coordinates = start?.get("origin")?.split(/\s+/).map(Number);
    const x = coordinates?.[0], y = coordinates?.[1], z = coordinates?.[2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Missing retail player start");
    const origin = { x, y, z }, program = await readProgram("rerelease/id1/pak0.pak");
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 16);
    const numeric = createNumericOperations(Q1_DONOR_PROFILE), actors = new SessionActorRegistry(createIdentityOwner("qc-world-test"));
    const field = (name: string) => { const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing ${name}`); return value.offset; };
    const sourceSlot = (actor: import("../../../src/contracts/identity.ts").ActorId) => {
      const source = actors.sourceOf(actor); if (source === null) throw new Error("Missing source slot"); return source.slot;
    };
    const linkedOrigins: { readonly actor: import("../../../src/contracts/identity.ts").ActorId; readonly origin: import("../../../src/contracts/math.ts").Vec3 }[] = [];
    const bodies = new SharedBodyTable(actors, {
      absoluteBounds: (actor, state) => qcLinkBounds(state, entities.at(sourceSlot(actor.id)).float(field("flags")), numeric),
      onUnlink: actor => { scene.unlink(actor); return undefined; },
      onLink: body => {
        linkedOrigins.push({ actor: body.actor, origin: body.state.origin });
        const words = entities.at(sourceSlot(body.actor)), solid = words.float(field("solid"));
        if (solid === 0) { scene.unlink(body.actor); return undefined; }
        const owner = actors.atSource("test:qc-world", entities.slot(words.int(field("owner"))))?.id ?? null;
        scene.link(body, { family: "q1", shape: solid === 4 ? { kind: "model", model: words.float(field("modelindex")) - 1 } : { kind: "box" },
          contents: -2, owner, role: solid === 1 ? "trigger" : "solid", monster: (Math.trunc(words.float(field("flags"))) & 32) !== 0, deadMonster: false });
        return undefined;
      },
    });
    scene.bindActorState(actor => bodies.read(actor));
    const storage = createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 });
    const slots = new SourceActorSlots(actors, { provider: "test:qc-world", capacity: entities.capacity, lifetime: quakeEdictLifetime(1), storage,
      now: () => ({ kind: "seconds", value: 1 }), unlink: actor => bodies.unlink(actor), exhausted: () => {} });
    slots.bindExisting(0, "quakec:world");
    const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
    const host = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE,
      model: name => name === "progs/player.mdl" ? { index: 2, bounds } : null,
      foreignReference: () => { throw new Error("Fixture has no foreign source surrogate"); } });
    host.actor(0);
    const { createQcPresentationBindings } = await import("../../../src/compat/qc/presentation-host.ts");
    const { SimulationEvents } = await import("../../../src/app/bootstrap/simulation/events.ts");
    const { openMountPlan, digestFile } = await import("../../../src/content/mounts/index.ts");
    const content = "q1:rerelease:id1:retail";
    const mounted = await openMountPlan({ id: "mount-plan:qc-presentation:retail", prefixOrders: [], defaultOrder: ["mount:qc:retail"],
      mounts: [{ kind: "archive", identity: { id: "mount:qc:retail", content, generation: 0 }, format: "pak", archivePath: corpus + "rerelease/id1/pak0.pak", archiveDigest: await digestFile(corpus + "rerelease/id1/pak0.pak") }] });
    const media = new Map<string, import("../../../src/contracts/content.ts").ResolvedResourceReference>();
    try {
      for (const path of ["sound/ambience/water1.wav", "progs/player.mdl"]) {
        const opened = await mounted.open(path); if (opened === null) throw new Error(`Missing retail ${path}`); media.set(path, opened.reference);
      }
    } finally { mounted.close(); }
    const events = new SimulationEvents(bodies, () => ({ kind: "seconds", value: 1 }), () => null, sourceSlot);
    const cache = new Map<string, import("../../../src/compat/qc/presentation-host.ts").QcPrecachedResource>(), prints: string[] = [];
    let loading = true;
    const presentation = createQcPresentationBindings(host, { content, events, loading: () => loading,
      print: text => { prints.push(text); return undefined; }, lookup: (kind, name) => cache.get(`${kind}:${name}`) ?? null,
      precache: (kind, name) => {
        const key = `${kind}:${name}`, previous = cache.get(key); if (previous !== undefined) return previous;
        const resource = media.get(kind === "sound" ? `sound/${name}` : name); if (resource === undefined) throw new Error(`Unprepared test media ${name}`);
        const value = { index: cache.size + 1, resource }; cache.set(key, value); return value;
      } });
    const { createQcMovementBindings, createQcTouchCallback } = await import("../../../src/compat/qc/movement-host.ts");
    const { touchQ1Triggers } = await import("../../../src/world/actors/triggers.ts");
    const { SourceRandom } = await import("../../../src/app/bootstrap/simulation/random.ts");
    const movementRandom = new SourceRandom(1);
    const movement = createQcMovementBindings(host, { scene, random: movementRandom,
      touchTriggers: moving => touchQ1Triggers({ actors, bodies, spatial: scene.spatial,
        isTrigger: trigger => entities.at(sourceSlot(trigger.id)).float(field("solid")) === 1,
        touch: contact => createQcTouchCallback(host, vm, () => 3)(contact) }, moving) });
    const vm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "rerelease", random: movementRandom, host: new Map([...host.host, ...presentation, ...movement]), isFreeEntity: host.isFreeEntity }), serverActive: () => true });
    const call = (name: string, argc: number) => vm.execute(program.functionNamed(name).index, argc);
    call("spawn", 0);
    const reference = vm.globals.int(1), slot = entities.slot(reference), actor = host.actor(slot), fields = entities.at(slot);
    fields.setFloat(field("solid"), 2);
    vm.globals.setInt(4, reference); vm.globals.setInt(7, vm.strings.allocate("missing.mdl"));
    expect(() => call("setmodel", 2)).toThrow("no precache");
    vm.globals.setInt(7, vm.strings.allocate("progs/player.mdl")); call("setmodel", 2);
    expect(fields.vector(field("size"))).toEqual({ x: 32, y: 32, z: 56 });
    vm.globals.setVector(7, origin); call("setorigin", 2);
    expect(bodies.read(actor.id)?.origin).toEqual(origin);
    expect(scene.spatial.get(actor.id)?.body.actor).toEqual(actor.id);
    fields.setVector(field("origin"), { ...origin, x: origin.x + 8 });
    expect(bodies.read(actor.id)?.origin.x).toBe(origin.x + 8);
    expect(bodies.linked(actor.id)?.state.origin).toEqual(origin);
    const state = bodies.read(actor.id); if (state === null) throw new Error("Missing raw body");
    bodies.write(actor, { ...state, velocity: { x: 7, y: 8, z: 9 } });
    expect(fields.vector(field("velocity"))).toEqual({ x: 7, y: 8, z: 9 });
    vm.globals.setInt(4, reference); vm.globals.setVector(7, { x: 2, y: 0, z: 0 }); vm.globals.setVector(10, { x: 1, y: 0, z: 0 });
    expect(() => call("setsize", 3)).toThrow("backwards mins/maxs");
    vm.globals.setVector(7, bounds.min); vm.globals.setVector(10, bounds.max); call("setsize", 3);
    expect(bodies.linked(actor.id)?.state.origin.x).toBe(origin.x + 8);
    vm.globals.setVector(4, origin); vm.globals.setFloat(7, 64); call("findradius", 2);
    expect(vm.globals.int(1)).toBe(reference); expect(fields.int(field("chain"))).toBe(0);
    vm.globals.setVector(4, origin); call("pointcontents", 1); expect(vm.globals.float(1)).toBe(-1);
    const end = { ...origin, z: origin.z - 256 };
    const direct = scene.trace({ start: origin, end, shape: { kind: "point" }, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor.id });
    expect(direct.fraction).toBeLessThan(1);
    vm.globals.setVector(4, origin); vm.globals.setVector(7, end); vm.globals.setFloat(10, 0); vm.globals.setInt(13, reference); call("traceline", 4);
    expect(vm.globals.float(vm.globalOffset("trace_fraction"))).toBe(Math.fround(direct.fraction));
    expect(vm.globals.vector(vm.globalOffset("trace_endpos"))).toEqual(direct.end);
    expect(vm.globals.int(vm.globalOffset("trace_ent"))).toBe(0);
    vm.globals.setInt(vm.globalOffset("self"), reference); call("droptofloor", 0);
    expect(vm.globals.float(1)).toBe(1); expect(bodies.read(actor.id)?.ground).toEqual(slots.at(0)?.id ?? null);
    const beforeWalk = bodies.read(actor.id); if (beforeWalk === null) throw new Error("Missing body before walkmove");
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 1); call("walkmove", 2);
    expect(vm.globals.float(1)).toBe(1);
    expect(bodies.read(actor.id)?.origin.x).toBe(numeric.add(beforeWalk.origin.x, 1));
    // Both builtins consume the same source random stream; world is a valid unlinked goal.
    fields.setInt(field("goalentity"), 0); fields.setInt(field("enemy"), 0);
    fields.setFloat(field("ideal_yaw"), 0); fields.setFloat(field("yaw_speed"), 20); fields.setVector(field("angles"), { x: 0, y: 0, z: 0 });
    const beforeGoal = fields.vector(field("origin")), randomBeforeGoal = movementRandom.checkpoint();
    if (randomBeforeGoal.kind !== "glibc-random") throw new Error("Expected source glibc random");
    vm.globals.setFloat(1, 73); vm.globals.setFloat(4, 1); call("movetogoal", 1);
    expect(vm.globals.float(1)).toBe(73);
    expect(fields.vector(field("origin")).x).toBe(numeric.add(beforeGoal.x, 1));
    const randomAfterGoal = movementRandom.checkpoint();
    if (randomAfterGoal.kind !== "glibc-random") throw new Error("Expected source glibc random");
    expect(randomAfterGoal.draws - randomBeforeGoal.draws).toBe(1);
    const groundedFlags = fields.float(field("flags")); fields.setFloat(field("flags"), 0);
    const beforeAirborneGoal = fields.vector(field("origin"));
    vm.globals.setFloat(1, 73); vm.globals.setFloat(4, 1); call("movetogoal", 1);
    expect(vm.globals.float(1)).toBe(0); expect(fields.vector(field("origin"))).toEqual(beforeAirborneGoal);
    expect(movementRandom.checkpoint()).toEqual(randomAfterGoal);
    fields.setFloat(field("flags"), groundedFlags); fields.setInt(field("enemy"), reference);
    // The world goal's raw abs bounds participate in CloseEnough despite having no shared link.
    expect(bodies.linked(host.actor(0).id)).toBeNull();
    vm.globals.setFloat(1, 73); vm.globals.setFloat(4, 10000); call("movetogoal", 1);
    expect(vm.globals.float(1)).toBe(73); expect(fields.vector(field("origin"))).toEqual(beforeAirborneGoal);
    expect(movementRandom.checkpoint()).toEqual(randomAfterGoal);
    fields.setInt(field("enemy"), 0);
    const expiredGround = slots.allocate("quakec:expired-ground"), retainedGround = host.reference(expiredGround.id);
    slots.free(expiredGround);
    fields.setInt(field("goalentity"), retainedGround); vm.globals.setFloat(4, 1);
    expect(() => call("movetogoal", 1)).toThrow("free source edict");
    expect(movementRandom.checkpoint()).toEqual(randomAfterGoal);
    fields.setInt(field("goalentity"), 0);
    const walkingFlags = fields.float(field("flags"));
    fields.setFloat(field("flags"), 0); fields.setInt(field("groundentity"), retainedGround);
    const airborneOrigin = fields.vector(field("origin"));
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 1); call("walkmove", 2);
    expect(vm.globals.float(1)).toBe(0); expect(fields.vector(field("origin"))).toEqual(airborneOrigin);
    expect(fields.int(field("groundentity"))).toBe(retainedGround);
    fields.setFloat(field("flags"), 1);
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 1); call("walkmove", 2);
    expect(vm.globals.float(1)).toBe(1);
    expect(fields.vector(field("origin")).x).toBe(numeric.add(airborneOrigin.x, 1));
    expect(fields.int(field("groundentity"))).toBe(retainedGround);
    fields.setFloat(field("flags"), walkingFlags); fields.setInt(field("groundentity"), 0);
    // Synthetic trigger at the real BSP player lane; actual QC moves and removes it during walkmove.
    const trigger = slots.allocate("quakec:test-trigger"), triggerSlot = sourceSlot(trigger.id), triggerWords = entities.at(triggerSlot);
    host.actor(triggerSlot);
    const grounded = bodies.read(actor.id); if (grounded === null) throw new Error("Missing grounded QC actor");
    triggerWords.setFloat(field("solid"), 1);
    triggerWords.setVector(field("origin"), grounded.origin);
    triggerWords.setVector(field("mins"), bounds.min); triggerWords.setVector(field("maxs"), bounds.max);
    const destination = { ...grounded.origin, x: grounded.origin.x + 256 };
    triggerWords.setVector(field("finaldest"), destination);
    triggerWords.setInt(field("touch"), program.functionNamed("SUB_CalcMoveDone").index);
    triggerWords.setInt(field("think1"), program.functionNamed("SUB_Remove").index);
    host.link(triggerSlot);
    vm.globals.setInt(vm.globalOffset("other"), reference);
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 0); call("walkmove", 2);
    expect(vm.globals.float(1)).toBe(1);
    expect(linkedOrigins.filter(link => link.actor.equals(trigger.id)).at(-1)?.origin).toEqual(destination);
    expect(actors.isLive(trigger.id)).toBe(false);
    expect(vm.globals.int(vm.globalOffset("self"))).toBe(reference);
    expect(vm.globals.int(vm.globalOffset("other"))).toBe(reference);
    expect(vm.globals.float(vm.globalOffset("time"))).toBe(3);
    const failing = slots.allocate("quakec:failing-trigger"), failingSlot = sourceSlot(failing.id), failingWords = entities.at(failingSlot);
    host.actor(failingSlot);
    failingWords.setFloat(field("solid"), 1); failingWords.setVector(field("origin"), grounded.origin);
    failingWords.setVector(field("mins"), bounds.min); failingWords.setVector(field("maxs"), bounds.max);
    failingWords.setVector(field("finaldest"), grounded.origin);
    failingWords.setInt(field("touch"), program.functionNamed("SUB_CalcMoveDone").index);
    failingWords.setInt(field("think1"), program.functionNamed("objerror").index);
    host.link(failingSlot);
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 0);
    expect(() => call("walkmove", 2)).toThrow();
    expect(vm.globals.int(vm.globalOffset("self"))).toBe(reference);
    expect(vm.globals.int(vm.globalOffset("other"))).toBe(reference);
    failingWords.setInt(field("touch"), program.functionNamed("SUB_Remove").index);
    vm.globals.setFloat(4, 0); vm.globals.setFloat(7, 0); call("walkmove", 2);
    expect(vm.globals.float(1)).toBe(1); expect(actors.isLive(failing.id)).toBe(false);
    vm.globals.setInt(4, reference); call("remove", 1);
    expect(scene.spatial.get(actor.id)).toBeNull(); expect(bodies.read(actor.id)).toBeNull();
    call("spawn", 0); expect(vm.globals.int(1)).toBe(reference);
    expect(host.actor(slot).id.equals(actor.id)).toBe(false);
    expect(() => host.reference(actor.id)).toThrow("stale actor");
    expect(bodies.read(host.actor(slot).id)?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    const sample = vm.strings.allocate("ambience/water1.wav");
    vm.globals.setInt(4, sample); call("precache_sound", 1); expect(vm.globals.int(1)).toBe(sample);
    call("precache_sound", 1); expect(cache.size).toBe(1);
    vm.globals.setInt(4, vm.strings.allocate("progs/player.mdl")); call("precache_model", 1); expect(cache.size).toBe(2);
    loading = false; expect(() => call("precache_model", 1)).toThrow("spawn functions");
    vm.globals.setInt(4, sample); call("precache_file", 1); expect(vm.globals.int(1)).toBe(sample);
    const current = host.actor(slot), body = bodies.read(current.id); if (body === null) throw new Error("Missing presentation body");
    bodies.write(current, { ...body, origin, bounds });
    vm.globals.setInt(4, reference); vm.globals.setFloat(7, 7); vm.globals.setInt(10, sample); vm.globals.setFloat(13, 0.5); vm.globals.setFloat(16, 0.75);
    call("sound", 5);
    const soundResource = media.get("sound/ambience/water1.wav"); if (soundResource === undefined) throw new Error("Missing sound identity");
    expect(events.take()[0]?.payload).toEqual({ kind: "sound", resource: soundResource.id, actor: current.id, origin: { ...origin, z: origin.z + 4 }, channel: 7, volume: 127 / 255, attenuation: 0.75 });
    vm.globals.setFloat(7, 0); call("sound", 5); expect(events.take()[0]?.payload).toMatchObject({ kind: "sound", channel: 0 });
    vm.globals.setFloat(7, 8); expect(() => call("sound", 5)).toThrow("channel = 8");
    vm.globals.setFloat(7, 1); vm.globals.setFloat(13, 2); expect(() => call("sound", 5)).toThrow("volume");
    vm.globals.setFloat(13, 1); vm.globals.setFloat(16, 5); expect(() => call("sound", 5)).toThrow("attenuation");
    vm.globals.setFloat(16, 1); vm.globals.setInt(10, vm.strings.allocate("absent.wav")); call("sound", 5);
    expect(prints).toEqual(["SV_StartSound: absent.wav not precacheed\n"]); expect(events.take()).toEqual([]);
    vm.globals.setVector(4, origin); vm.globals.setInt(7, sample); vm.globals.setFloat(10, 0.25); vm.globals.setFloat(13, 2); call("ambientsound", 4);
    expect(events.capture().persistent).toHaveLength(1);
    vm.globals.setVector(4, origin); vm.globals.setVector(7, { x: 1, y: -2, z: 3 }); vm.globals.setFloat(10, 73); vm.globals.setFloat(13, 12); call("particle", 4);
    loading = true; vm.globals.setFloat(4, 2); vm.globals.setInt(7, vm.strings.allocate("az")); call("lightstyle", 2);
    expect(events.lightStyle(2)).toBe("az"); expect(events.lightStyles(1)).toContainEqual({ kind: "q1", style: 2, value: 0 });
    expect(events.takePresentation().some(value => value.kind === "q1" && value.event.kind === "particles" && value.event.count === 12 && value.event.color === 73)).toBe(true);

    // Only field-backed reserved clients: this exercises visibility, not client game startup.
    const { QcClientHost } = await import("../../../src/compat/qc/client-host.ts");
    const secondClient = slots.allocate("quakec:visibility-client"), observer = slots.allocate("quakec:visibility-observer");
    expect(sourceSlot(current.id)).toBe(1); expect(sourceSlot(secondClient.id)).toBe(2);
    host.actor(2); host.actor(sourceSlot(observer.id));
    const firstWords = entities.at(1), secondWords = entities.at(2), observerWords = entities.at(sourceSlot(observer.id));
    const zero = { x: 0, y: 0, z: 0 }, cluster = (point: import("../../../src/contracts/math.ts").Vec3) => scene.leafCluster(scene.pointLeaf(point));
    const positions = parseEntities(world.entities).flatMap(entity => {
      const values = entity.get("origin")?.split(/\s+/).map(Number), px = values?.[0], py = values?.[1], pz = values?.[2];
      return px === undefined || py === undefined || pz === undefined ? [] : [{ x: px, y: py, z: pz }];
    });
    const hidden = positions.find(point => cluster(point) >= 0 && !scene.clusterVisible(cluster(origin), cluster(point), "pvs"));
    if (hidden === undefined) throw new Error("Retail BSP has no distinct hidden authored position for the visibility witness");
    firstWords.setFloat(field("health"), 0);
    secondWords.setFloat(field("health"), 100); secondWords.setFloat(field("flags"), 0);
    secondWords.setVector(field("origin"), origin); secondWords.setVector(field("view_ofs"), zero);
    observerWords.setVector(field("origin"), origin);
    observerWords.setVector(field("view_ofs"), { x: hidden.x - origin.x, y: hidden.y - origin.y, z: hidden.z - origin.z });
    expect(scene.clusterVisible(cluster(origin), cluster(origin), "pvs")).toBe(true);
    let checkTime = 0;
    const clients = new QcClientHost(host, { scene, maxClients: 2, serverTime: () => checkTime });
    const visibilityVm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "rerelease", host: clients.host }), serverActive: () => true });
    visibilityVm.globals.setInt(visibilityVm.globalOffset("self"), host.reference(observer.id));
    const check = () => { visibilityVm.execute(program.functionNamed("checkclient").index); return visibilityVm.globals.int(1); };
    expect(check()).toBe(0);
    expect(clients.visibility.capture()).toEqual({ lastCheckSlot: 0, lastCheckTime: 0, checkedCluster: null });
    checkTime = 0.1; expect(check()).toBe(0);
    const cached = clients.visibility.capture(); expect(cached.lastCheckSlot).toBe(2); expect(cached.checkedCluster).toBe(cluster(origin));
    secondWords.setVector(field("origin"), hidden);
    checkTime = 0.15; expect(check()).toBe(0);
    const restoredClients = new QcClientHost(host, { scene, maxClients: 2, serverTime: () => checkTime });
    restoredClients.visibility.restore(cached);
    const eye = { origin: hidden, viewOffset: zero };
    expect(restoredClients.visibility.check(eye, checkTime, numeric)).toBeNull();
    expect(() => restoredClients.visibility.restore({ ...cached, lastCheckTime: Infinity })).toThrow();
    expect(() => restoredClients.visibility.restore({ ...cached, lastCheckSlot: 3 })).toThrow();
    expect(() => restoredClients.visibility.restore({ ...cached, checkedCluster: world.leaves.length })).toThrow();
    expect(restoredClients.visibility.capture()).toEqual(cached);
    checkTime = 0.21; expect(check()).toBe(host.reference(secondClient.id));
    expect(restoredClients.visibility.check(eye, checkTime, numeric)).toEqual(secondClient.id);
    expect(restoredClients.visibility.capture()).toEqual(clients.visibility.capture());
    secondWords.setFloat(field("flags"), 128);
    checkTime = 0.22; expect(check()).toBe(host.reference(secondClient.id));
    secondWords.setFloat(field("health"), 0); expect(check()).toBe(0);
    secondWords.setFloat(field("health"), 100);
    // The prior slot terminates a full scan even with NOTARGET set, matching PF_newcheckclient.
    checkTime = 0.32; expect(check()).toBe(host.reference(secondClient.id));
    firstWords.setFloat(field("health"), 100); firstWords.setFloat(field("flags"), 0);
    firstWords.setVector(field("origin"), hidden); firstWords.setVector(field("view_ofs"), zero);
    checkTime = 0.43; expect(check()).toBe(host.reference(current.id));
    firstWords.setFloat(field("flags"), 128); secondWords.setFloat(field("flags"), 0);
    checkTime = 0.54; expect(check()).toBe(host.reference(secondClient.id));
    slots.free(secondClient); checkTime = 0.55; expect(check()).toBe(0);

  } finally { archive.close(); }
});
