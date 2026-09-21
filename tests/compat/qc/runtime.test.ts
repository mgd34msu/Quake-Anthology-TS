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
      const armor = (): ArmorState => ({ regular: { kind: "q1", points: words.float(field("armorvalue")), absorption: words.float(field("armortype")), item: "q1:armor" }, powered: { kind: "none" } });
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
            if (current.regular.kind !== "q1") throw new Error("Expected QC armor");
            observer.stored({ kind: "armor", before: store.word === field("armorvalue") ? { ...current, regular: { ...current.regular, points: before.getFloat32(0, true) } }
              : { ...current, regular: { ...current.regular, absorption: before.getFloat32(0, true) } }, after: current });
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
        expect(checked.armor).toEqual({ regular: { kind: "q1", points: 0, absorption: 0, item: "q1:armor" }, powered: { kind: "none" } });
        expect(damageOutcome.decision.appliedDamage).toBe(35);
      }
    }

  });
  test("verified id1 internal door damage enters shared authority without replacing source execution", async () => {
    const { Id1DamageBinding } = await import("../../../src/content/q1/quakec/id1-damage.ts");
    const program = await readProgram("id1/PAK0.PAK"), otherProgram = await readProgram("rerelease/id1/pak0.pak");
    const field = (name: string) => { const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing ${name}`); return value.offset; };
    const run = (observed: boolean, variant: "normal" | "exhausted" | "invulnerable" | "nested" | "failure", entry: "internal" | "direct" = "internal") => {
      const entities = new QcEntityMemory(classicQcEntityLayout(program), 8);
      const actors = new SessionActorRegistry(createIdentityOwner(`id1-internal-${observed}-${variant}`));
      const numeric = createNumericOperations(Q1_DONOR_PROFILE);
      const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric), onLink: () => undefined, onUnlink: () => undefined });
      const callbacks = new ActorCallbackTable(actors);
      const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 8, lifetime: quakeEdictLifetime(1),
        storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
        now: () => ({ kind: "seconds", value: 3 }), unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No source edicts"); } });
      slots.bindExisting(0, "quakec:world");
      slots.allocate("quakec:door");
      const target = slots.allocate("quakec:target"), doorWords = entities.at(1), words = entities.at(2);
      doorWords.setFloat(field("dmg"), 40); doorWords.setFloat(field("wait"), -1);
      words.setFloat(field("health"), 100); words.setFloat(field("takedamage"), 2); words.setFloat(field("movetype"), 3);
      words.setFloat(field("armorvalue"), variant === "exhausted" ? 5 : 40); words.setFloat(field("armortype"), 0.3); words.setFloat(field("items"), 8192);
      words.setInt(field("th_pain"), program.functionNamed(variant === "failure" ? "error" : "SUB_Null").index);
      words.setInt(field("th_die"), program.functionNamed("SUB_Null").index);
      words.setVector(field("origin"), { x: 40, y: 12, z: 8 }); words.setVector(field("velocity"), { x: 0.1, y: -0.2, z: 0.3 });
      if (variant === "invulnerable") { words.setFloat(field("invincible_finished"), 10); words.setFloat(field("invincible_sound"), 10); doorWords.setFloat(field("invincible_sound"), 10); }
      bodies.bind(target, { read: () => ({ origin: words.vector(field("origin")), angles: words.vector(field("angles")), velocity: words.vector(field("velocity")),
        bounds: { min: words.vector(field("mins")), max: words.vector(field("maxs")) }, ground: null }), write: () => { throw new Error("Source body replay"); } });
      const outcomes: DamageOutcome[] = [], calls: number[] = [], order: string[] = [];
      const painArguments: { readonly attacker: number; readonly damage: number; readonly argc: number }[] = [];
      let nested = false, sequence = 0;
      const reenter = () => {
        if (variant !== "nested" || nested) return undefined;
        nested = true; words.setFloat(field("movetype"), 0); doorWords.setFloat(field("dmg"), 100);
        invoke(); return undefined;
      };
      const authority = new GameplayAuthority(actors, callbacks, { impulse: () => { throw new Error("Source momentum replay"); },
        beforeReaction: () => { order.push("reaction"); return reenter(); }, confirmed: outcome => { order.push("confirmed"); outcomes.push(outcome); return undefined; } });
      const source = { program, entities, actors, slots };
      const binding = new Id1DamageBinding(source, authority, () => vm, call => {
        calls.push(call.call.caller);
        return { target: call.target, amount: call.amount, knockback: call.amount,
          attack: { sequence: sequence++, time: { kind: "seconds", value: 3 }, attacker: call.attacker, inflictor: call.inflictor,
            weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "q1:movement", cause: { kind: "q1", deathType: "squish" } },
          direction: { x: 40, y: 12, z: 8 }, point: words.vector(field("origin")), normal: { x: 0, y: 0, z: 0 }, delivery: "direct" };
      });
      authority.bind(target, { read: () => ({ health: words.float(field("health")), armor: binding.readArmor(words), mass: 200, canTakeDamage: true, invulnerable: false, team: null }),
        writeHealth: () => { throw new Error("Source health replay"); }, writeArmor: () => { throw new Error("Source armor replay"); } });
      const vm: QcMachine = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true,
        functionBoundary: { functions: new Set([program.functionNamed("SUB_Null").index, ...(observed ? binding.functionBoundary.functions : [])]),
          run: (call, execute) => {
            if (observed && call.functionIndex === 117) return binding.functionBoundary.run(call, execute);
            if (call.caller === 117 && call.statement === 1568) painArguments.push({ attacker: vm.argInt(0), damage: vm.argFloat(1), argc: vm.argc });
            execute(); return undefined;
          } },
        ...(observed ? { observeEntityStore: (store: import("../../../src/compat/qc/machine.ts").QcEntityStoreObservation) => binding.observeEntityStore(store) } : {}),
        observeCall: call => {
          if (observed) binding.observeCall(call);
          else if (call.caller === 117 && call.statement === 1568) reenter();
          return undefined;
        } });
      const invoke = () => {
        vm.globals.setFloat(vm.globalOffset("time"), 3);
        vm.globals.setInt(vm.globalOffset("self"), entities.reference(1)); vm.globals.setInt(vm.globalOffset("other"), entities.reference(2));
        if (entry === "direct") {
          vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(1)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 40);
          vm.execute(program.functionNamed("T_Damage").index, 4);
        } else vm.execute(program.functionNamed("door_blocked").index);
      };
      const foreignBinding = new Id1DamageBinding({ ...source, program: otherProgram }, authority, () => vm, () => { throw new Error("Foreign machine reached resolver"); });
      const foreignExecution = () => { throw new Error("Foreign machine executed source damage"); };
      expect(() => foreignBinding.functionBoundary.run({ functionIndex: otherProgram.functionNamed("T_Damage").index, caller: 0, statement: -1 },
        Object.assign(foreignExecution, { skip: foreignExecution }))).toThrow("binding belongs to another machine");
      if (variant === "failure") {
        expect(invoke).toThrow(); expect(outcomes).toHaveLength(0); expect(vm.depth).toBe(0); vm.snapshot();
        words.setInt(field("th_pain"), program.functionNamed("SUB_Null").index);
      }
      invoke();
      const result = { bytes: entities.bytes.slice(), outcomes, calls, order, painArguments, doorReference: entities.reference(1), health: words.float(field("health")), armor: binding.readArmor(words), velocity: bodies.read(target.id)?.velocity };
      actors.close(); return result;
    };
    for (const variant of ["normal", "exhausted", "invulnerable", "nested", "failure"] satisfies readonly ("normal" | "exhausted" | "invulnerable" | "nested" | "failure")[]) {
      const control = run(false, variant), observed = run(true, variant);
      expect(observed.bytes).toEqual(control.bytes); expect(observed.velocity).toEqual(control.velocity); expect(observed.armor).toEqual(control.armor);
      expect(observed.outcomes).toHaveLength(variant === "nested" ? 2 : 1);
      expect(observed.calls.every(caller => caller === program.functionNamed("door_blocked").index)).toBe(true);
      const outcome = observed.outcomes.at(-1); if (outcome?.kind !== "committed") throw new Error("Missing internal committed damage");
      expect(outcome.decision.request.attack.cause).toEqual({ kind: "q1", deathType: "squish" });
      if (variant === "normal") { expect(observed.health).toBe(72); expect(outcome.decision.appliedDamage).toBe(28); }
      if (variant === "invulnerable") { expect(observed.health).toBe(100); expect(outcome.decision.appliedDamage).toBe(0); }
      if (variant === "exhausted") { expect(observed.armor).toEqual({ regular: { kind: "none" }, powered: { kind: "none" } }); expect(outcome.decision.mutations.filter(value => value.kind === "armor")).toHaveLength(3); }
      if (variant === "nested") {
        expect(observed.painArguments).toEqual([{ attacker: observed.doorReference, damage: 28, argc: 2 }]);
        expect(observed.outcomes.map(value => value.kind === "committed" ? value.decision.request.attack.sequence : -1)).toEqual([1, 0]); expect(outcome.survived).toBe(false); }
    }
    const direct = run(true, "normal", "direct");
    expect(direct.calls).toEqual([0]); expect(direct.health).toBe(72); expect(direct.outcomes).toHaveLength(1);
  });
  test("selected function boundaries enforce one synchronous execution and share the interpreter budget", async () => {
    const program = await readProgram("id1/PAK0.PAK"), idle = program.functionNamed("SUB_Null").index;
    const make = (run: import("../../../src/compat/qc/machine.ts").QcFunctionBoundary["run"], selected = idle, statementLimit = 100000) => new QcMachine({ program,
      entities: new QcEntityMemory(classicQcEntityLayout(program), 8, 3), numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake" }),
      serverActive: () => true, statementLimit, functionBoundary: { functions: new Set([selected]), run } });
    const omitted = make(() => undefined);
    expect(() => omitted.execute(idle)).toThrow("omitted source execution"); omitted.snapshot();
    const repeated = make((_call, execute) => { execute(); try { execute(); } catch {} return undefined; });
    expect(() => repeated.execute(idle)).toThrow("once inside its boundary");
    expect(repeated.profiling[idle]).toBe(1); repeated.snapshot();
    const retained: { execute: (() => undefined) | null } = { execute: null };
    const once = make((_call, execute) => { retained.execute = execute; execute(); return undefined; });
    once.execute(idle);
    const expired = retained.execute; if (expired === null) throw new Error("Missing continuation");
    expect(expired).toThrow("once inside its boundary"); expect(once.profiling[idle]).toBe(1);
    const failing = make((_call, execute) => { try { execute(); } catch {} return undefined; }, program.functionNamed("SUB_CalcMoveDone").index);
    failing.globals.setInt(failing.globalOffset("self"), failing.entities.reference(1));
    expect(() => failing.execute(program.functionNamed("SUB_CalcMoveDone").index)).toThrow("unbound builtin setorigin");
    expect(failing.depth).toBe(0); failing.snapshot();
    expect(() => make((_call, execute) => execute(), 0)).toThrow("invalid function");
    const limited = make((_call, execute) => execute(), program.functionNamed("T_Damage").index, 8);
    const control = new QcMachine({ program, entities: new QcEntityMemory(classicQcEntityLayout(program), 8, 3), numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true, statementLimit: 8 });
    for (const vm of [limited, control]) {
      vm.globals.setInt(vm.globalOffset("self"), vm.entities.reference(1)); vm.globals.setInt(vm.globalOffset("other"), vm.entities.reference(2));
      expect(() => vm.execute(program.functionNamed("door_blocked").index)).toThrow("runaway loop");
      expect(vm.depth).toBe(0); vm.snapshot();
    }
    expect(limited.profiling).toEqual(control.profiling); expect(limited.entities.bytes).toEqual(control.entities.bytes);
  });
  test("post-boundary source reentry preserves the callee return consumed by its real caller", async () => {
    const program = await readProgram("id1/PAK0.PAK"), anglemod = program.functionNamed("anglemod").index, movedir = program.functionNamed("SetMovedir").index;
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 2);
    const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true,
      functionBoundary: { functions: new Set([anglemod]), run: (_call, execute) => {
        execute();
        expect(vm.globals.float(1)).toBe(180);
        entities.at(1).setVector(vm.fieldOffset("angles"), { x: 0, y: -1, z: 0 });
        vm.execute(movedir);
        return undefined;
      } } });
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(1));
    entities.at(1).setVector(vm.fieldOffset("angles"), { x: 0, y: 180, z: 0 });
    entities.at(1).setFloat(vm.fieldOffset("ideal_yaw"), 0);
    vm.execute(program.functionNamed("FacingIdeal").index);
    expect(vm.globals.float(1)).toBe(0);
    expect(vm.argc).toBe(1);
    expect(entities.at(1).vector(vm.fieldOffset("movedir"))).toEqual({ x: 0, y: 0, z: 1 });
    expect(entities.at(1).vector(vm.fieldOffset("angles"))).toEqual({ x: 0, y: 0, z: 0 });
    expect(vm.profiling[anglemod]).toBeGreaterThan(0); expect(vm.profiling[movedir]).toBeGreaterThan(0);
    expect(vm.depth).toBe(0); vm.snapshot();
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
    vm.globals.setInt(4, retainedGround); vm.globals.setVector(7, origin);
    expect(() => call("setorigin", 2)).not.toThrow();
    vm.globals.setVector(7, bounds.min); vm.globals.setVector(10, bounds.max);
    expect(() => call("setsize", 3)).not.toThrow();
    expect(actors.isLive(expiredGround.id)).toBe(false);
    expect(scene.spatial.get(expiredGround.id)).toBeNull();
    expect(() => host.actor(entities.slot(retainedGround))).toThrow("free source edict");
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

test.skipIf(!haveCorpus)("retail QC pusher uses shared authored brush movement and raw local-time thinking", async () => {
  const { SharedPhysics } = await import("../../../src/app/bootstrap/simulation/physics.ts");
  const { QcWorldHost } = await import("../../../src/compat/qc/world-host.ts");
  const { createQcPusherServices } = await import("../../../src/compat/qc/pusher-host.ts");
  const { stepQ1Pusher } = await import("../../../src/movement/q1/pusher.ts");
  const { createQcTouchCallback } = await import("../../../src/compat/qc/movement-host.ts");
  const { createSceneQueries } = await import("../../../src/world/collision/index.ts");
  const { readQ1Bsp, q1EntityValue } = await import("../../../src/formats/q1-map/index.ts");
  const archive = await openArchive(corpus + "id1/PAK0.PAK");
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1");
    const map = readQ1Bsp(await archive.readEntry(entry)), model = map.models[22];
    if (model === undefined || !map.entityList.some(entity => q1EntityValue(entity, "classname") === "func_plat" && q1EntityValue(entity, "model") === "*22")) throw new Error("Missing authored platform");
    const program = await readProgram("id1/PAK0.PAK"), entities = new QcEntityMemory(classicQcEntityLayout(program), 16, 4);
    const actors = new SessionActorRegistry(createIdentityOwner("qc-pusher")), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
    const field = (name: string) => { const definition = program.fieldsByName.get(name); if (definition === undefined) throw new Error(`Missing ${name}`); return definition.offset; };
    const physics: InstanceType<typeof SharedPhysics> = new SharedPhysics({ actors, callbacks, scene, numeric: Q1_DONOR_PROFILE,
      sourceOrder: (a, b) => (actors.sourceOf(a)?.slot ?? 0) - (actors.sourceOf(b)?.slot ?? 0),
      worldActor: () => slots.at(0)?.id ?? null,
      onBlocked: () => { throw new Error("QC pusher must dispatch its source callback"); },
      getFlags: actor => { const source = actors.sourceOf(actor.id); return { player: source?.slot === 1 }; } });
    const slots: SourceActorSlots = new SourceActorSlots(actors, { provider: "test:qc-pusher", capacity: entities.capacity, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
      now: () => ({ kind: "seconds", value: 10 }), unlink: actor => physics.bodies.unlink(actor), exhausted: () => {} });
    for (let slot = 0; slot < 4; slot++) slots.bindExisting(slot, "quakec:edict");
    const world = new QcWorldHost({ program, entities, actors, slots, bodies: physics.bodies, scene, numeric: Q1_DONOR_PROFILE,
      model: name => name === "*22" ? { index: 23, bounds: model.bounds } : null,
      foreignReference: () => { throw new Error("No foreign QC surrogate in this fixture"); } });
    world.actor(0);
    const pusher = world.actor(2), rider = world.actor(1), words = entities.at(2), riderWords = entities.at(1);
    const zero = { x: 0, y: 0, z: 0 }, origin = { x: (model.bounds.min.x + model.bounds.max.x) / 2, y: (model.bounds.min.y + model.bounds.max.y) / 2, z: model.bounds.max.z + 3 };
    words.setFloat(field("solid"), 4); words.setFloat(field("movetype"), 7); words.setVector(field("mins"), model.bounds.min); words.setVector(field("maxs"), model.bounds.max);
    words.setVector(field("velocity"), { x: 0, y: 0, z: -20 }); words.setFloat(field("ltime"), 1); words.setFloat(field("nextthink"), 1.05);
    const think = program.functionNamed("SUB_Null"); words.setInt(field("think"), think.index);
    riderWords.setFloat(field("solid"), 3); riderWords.setFloat(field("movetype"), 3); riderWords.setFloat(field("flags"), 512);
    riderWords.setInt(field("groundentity"), entities.reference(2)); riderWords.setVector(field("origin"), origin);
    riderWords.setVector(field("mins"), { x: -1, y: -1, z: -1 }); riderWords.setVector(field("maxs"), { x: 1, y: 1, z: 1 });
    physics.setSolid(pusher, "brush", 22, "q1"); physics.setSolid(rider, "box", null, "q1"); world.link(2); world.link(1);
    const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake", host: world.host, isFreeEntity: world.isFreeEntity }), serverActive: () => true });
    const touch = createQcTouchCallback(world, vm, () => 10);
    for (const actor of [pusher, rider]) callbacks.bind(actor, { think: null, use: null, pain: null, die: null, touch });
    const services = createQcPusherServices(world, vm, { physical: projection => physics.q1PusherServices(projection),
      foreign: { read: actor => { if (!actors.isLive(actor)) return null; throw new Error("Unexpected foreign pusher actor"); }, write: () => { throw new Error("Unexpected foreign pusher write"); } },
      touchTriggers: actor => physics.touchTriggers(actor), serverTime: () => 10 });
    const result = stepQ1Pusher({ actor: pusher.id, elapsedSeconds: 0.1, movement: "translate" }, services);
    expect(result.status).toBe("moved"); expect(result.moved).toEqual([rider.id]);
    expect(words.float(field("ltime"))).toBe(Math.fround(1.05)); expect(words.float(field("nextthink"))).toBe(0);
    expect(words.vector(field("origin")).z).toBeCloseTo(-1, 5);
    expect(riderWords.vector(field("origin")).z).toBeCloseTo(origin.z - 1, 5);
    expect(riderWords.int(field("groundentity"))).toBe(entities.reference(2));
    expect(vm.profiling[think.index]).toBeGreaterThan(0); expect(vm.globals.float(vm.globalOffset("time"))).toBe(10);
    // A stopped source pusher still advances local time when a future think exists.
    words.setVector(field("velocity"), zero); words.setFloat(field("nextthink"), 2);
    stepQ1Pusher({ actor: pusher.id, elapsedSeconds: 0.1, movement: "translate" }, services);
    expect(words.float(field("ltime"))).toBe(Math.fround(Math.fround(1.05) + 0.1));
    expect(words.float(field("nextthink"))).toBe(2);
    // Synthetic stationary blocker above the rider isolates rollback on the actual brush.
    const wall = world.actor(3), wallWords = entities.at(3), riderBefore = riderWords.vector(field("origin"));
    wallWords.setFloat(field("solid"), 2); wallWords.setFloat(field("movetype"), 0);
    wallWords.setVector(field("origin"), { ...riderBefore, z: riderBefore.z + 4 });
    wallWords.setVector(field("mins"), { x: -2, y: -2, z: -1 }); wallWords.setVector(field("maxs"), { x: 2, y: 2, z: 1 });
    physics.setSolid(wall, "box", null, "q1"); world.link(3);
    riderWords.setFloat(field("movetype"), 4); riderWords.setFloat(field("flags"), 512);
    words.setVector(field("velocity"), { x: 0, y: 0, z: 40 }); words.setInt(field("blocked"), think.index);
    const pusherBefore = words.vector(field("origin")), anglesBefore = words.vector(field("angles")), localBefore = words.float(field("ltime"));
    const callbacksBefore = vm.profiling[think.index] ?? 0;
    const blocked = stepQ1Pusher({ actor: pusher.id, elapsedSeconds: 0.1, movement: "translate" }, services);
    expect(blocked.status).toBe("blocked");
    expect(words.vector(field("origin"))).toEqual(pusherBefore); expect(words.vector(field("angles"))).toEqual(anglesBefore);
    expect(words.float(field("ltime"))).toBe(localBefore); expect(words.float(field("nextthink"))).toBe(2);
    expect(riderWords.vector(field("origin"))).toEqual(riderBefore);
    expect(riderWords.float(field("flags"))).toBe(0); expect(riderWords.int(field("groundentity"))).toBe(entities.reference(2));
    expect(vm.profiling[think.index]).toBe(callbacksBefore + 1);
    // Ordinary shared toss writes retain a stale source ground word while airborne.
    const start = map.entityList.find(entity => q1EntityValue(entity, "classname") === "info_player_start");
    const position = start === undefined ? [] : (q1EntityValue(start, "origin") ?? "").split(/\s+/).map(Number);
    const x = position[0], y = position[1], z = position[2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Missing actual player lane");
    riderWords.setVector(field("origin"), { x, y, z: z + 20 }); riderWords.setFloat(field("flags"), 0);
    riderWords.setVector(field("velocity"), { x: 0, y: 0, z: -20 });
    riderWords.setFloat(field("movetype"), 6); world.link(1);
    physics.setMotion({ actor: rider, kind: "toss", velocity: { x: 0, y: 0, z: -20 }, angularVelocity: zero,
      gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
    physics.step(rider, 0.05);
    expect(riderWords.vector(field("origin")).z).toBeLessThan(z + 20);
    expect(riderWords.float(field("flags")) & 512).toBe(0);
    expect(riderWords.int(field("groundentity"))).toBe(entities.reference(2));
    for (let frame = 0; frame < 30 && (riderWords.float(field("flags")) & 512) === 0; frame++) physics.step(rider, 0.05);
    expect(riderWords.float(field("flags")) & 512).toBe(512);
    expect(riderWords.int(field("groundentity"))).toBe(0);
    expect(physics.bodies.read(rider.id)?.ground).toEqual(slots.at(0)?.id ?? null);
    actors.close();
  } finally { archive.close(); }
});

test.skipIf(!haveCorpus)("verified id1 attacks and environmental callbacks preserve actual source execution", async () => {
  const { Id1SynchronousAttacks } = await import("../../../src/content/q1/quakec/id1-attacks.ts");
  const { Id1Environment } = await import("../../../src/content/q1/quakec/id1-environment.ts");
  const { Id1DamageBinding } = await import("../../../src/content/q1/quakec/id1-damage.ts");
  const { QcWorldHost } = await import("../../../src/compat/qc/world-host.ts");
  const { createQcPresentationBindings } = await import("../../../src/compat/qc/presentation-host.ts");
  const { createSceneQueries } = await import("../../../src/world/collision/index.ts");
  const { readQ1Bsp } = await import("../../../src/formats/q1-map/index.ts");
  const { parseEntities } = await import("../../../src/core/common-parse.ts");
  const { SimulationEvents } = await import("../../../src/app/bootstrap/simulation/events.ts");
  const { createQcAimBinding } = await import("../../../src/compat/qc/client-host.ts");
  const { SourceRandom } = await import("../../../src/app/bootstrap/simulation/random.ts");
  const { openMountPlan, digestFile } = await import("../../../src/content/mounts/index.ts");
  const mount = await openMountPlan({ id: "mount-plan:qc:attacks", prefixOrders: [], defaultOrder: ["mount:qc:attacks"], mounts: [
    { kind: "archive", identity: { id: "mount:qc:attacks", content: "q1:classic:id1:retail", generation: 0 }, format: "pak", archivePath: corpus + "id1/PAK0.PAK", archiveDigest: await digestFile(corpus + "id1/PAK0.PAK") },
  ] });
  const sounds = new Map<string, import("../../../src/compat/qc/presentation-host.ts").QcPrecachedResource>();
  try {
    for (const path of ["weapons/guncock.wav", "weapons/shotgn2.wav", "player/land2.wav", "plats/plat1.wav", "items/protect3.wav"]) {
      const asset = await mount.open(`sound/${path}`); if (asset === null) throw new Error(`Missing actual ${path}`);
      sounds.set(path, { index: sounds.size + 1, resource: asset.reference });
    }
  } finally { mount.close(); }
  const program = await readProgram("id1/PAK0.PAK"), archive = await openArchive(corpus + "id1/PAK0.PAK");
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1");
    const map = readQ1Bsp(await archive.readEntry(entry));
    const start = parseEntities(map.entities).find(entity => entity.get("classname") === "info_player_start");
    const coordinates = start?.get("origin")?.split(/\s+/).map(Number), x = coordinates?.[0], y = coordinates?.[1], z = coordinates?.[2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Missing actual start pose");
    const field = (name: string): number => { const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing ${name}`); return value.offset; };
    type HazardCase = "drown" | "lava" | "slime" | "fall" | "hurt" | "door" | "secret" | "plat" | "train" | "hurt-invulnerable";
    const run = (observed: boolean, weapon: "axe" | "shotgun" | "supershotgun" | "fallback" | HazardCase) => {
      const scene = createSceneQueries(map), numeric = createNumericOperations(Q1_DONOR_PROFILE);
      const actors = new SessionActorRegistry(createIdentityOwner(`qc-attack-${observed}`)), callbacks = new ActorCallbackTable(actors);
      const entities = new QcEntityMemory(classicQcEntityLayout(program), 16);
      const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric),
        onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
          scene.link(body, { family: "q1", shape: { kind: "box" }, contents: -2, owner: null, role: "solid", monster: false, deadMonster: false });
          return undefined;
        } });
      scene.bindActorState(actor => bodies.read(actor));
      const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 16, lifetime: quakeEdictLifetime(1),
        storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }), now: () => ({ kind: "seconds", value: 3 }),
        unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No edicts"); } });
      slots.bindExisting(0, "quakec:world"); const shooter = slots.allocate("quakec:player"), target = slots.allocate("quakec:target");
      const world = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE,
        model: () => null, foreignReference: () => { throw new Error("No foreign actor"); } });
      world.actor(0); world.actor(1); world.actor(2);
      const events = new SimulationEvents(bodies, () => ({ kind: "seconds", value: 3 }), () => null, actor => actors.sourceOf(actor)?.slot ?? null);
      const presentation = createQcPresentationBindings(world, { content: "q1:classic:id1:retail", events, loading: () => false,
        print: text => { throw new Error(`Unexpected missing source resource: ${text}`); }, lookup: (_kind, path) => sounds.get(path) ?? null,
        precache: () => { throw new Error("No source precache during attack"); } });
      const outcomes: DamageOutcome[] = [];
      const authority = new GameplayAuthority(actors, callbacks, { impulse: () => { throw new Error("Source impulse replay"); },
        beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
      const attacks = new Id1SynchronousAttacks(world.options, () => vm);
      const environment = new Id1Environment(world.options, () => vm);
      let environmentalCallback: import("../../../src/content/q1/quakec/id1-environment.ts").Id1PhysicsCallback | null = null;
      const damage = new Id1DamageBinding(world.options, authority, () => vm, call => {
        const attack = attacks.resolve(call);
        if (attack === null) {
          const hazard = environment.resolve(call, environmentalCallback);
          if (hazard === null) throw new Error("Unexpected damage source");
          expect(hazard.cause.kind).toBe("environment");
          if (hazard.cause.kind !== "environment") throw new Error("Expected source environment hazard");
          if (hazard.cause.hazard === "fall") expect(vm.strings.get(entities.at(2).int(field("deathtype")))).toBe("");
          return { target: call.target, amount: call.amount, knockback: hazard.knockback, direction: hazard.direction, point: hazard.point,
            normal: { x: 0, y: 0, z: 0 }, delivery: "direct", attack: { sequence: outcomes.length, time: { kind: "seconds", value: hazard.time },
              attacker: call.attacker, inflictor: call.inflictor, weapon: null, weaponProvider: "test:qc", combatProvider: "test:qc",
              inventoryProvider: "test:qc", movementProvider: "test:qc", cause: hazard.cause } };
        }
        return { target: call.target, amount: call.amount, knockback: attack.knockback, direction: attack.direction, point: attack.point, normal: attack.normal, delivery: "direct",
          attack: { sequence: outcomes.length, time: { kind: "seconds", value: attack.time }, attacker: attack.actor, inflictor: call.inflictor, weapon: attack.weapon,
            weaponProvider: "test:qc", combatProvider: "test:qc", inventoryProvider: "test:qc", movementProvider: "test:qc", cause: { kind: "q1", deathType: "" } } };
      });
      const host = new Map([...world.host, ...presentation]);
      host.set("aim", createQcAimBinding(world, { aimThreshold: () => 0.93, teamplay: () => 0,
        targets: () => [shooter, target].map(actor => ({ actor: actor.id, reference: world.reference(actor.id) })) }));
      const vm: QcMachine = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "netquake", host, random: new SourceRandom(1) }),
        serverActive: () => true, ...(observed ? { functionBoundary: attacks.compose(damage.functionBoundary),
          observeCall: call => damage.observeCall(call), observeEntityStore: store => damage.observeEntityStore(store) } : {}) });
      const owner = entities.at(1), victim = entities.at(2);
      owner.setInt(field("classname"), vm.strings.setEngine("player-class", "player"));
      owner.setFloat(field("weapon"), 128); // A later/current weapon word must not identify these explicit source attacks.
      owner.setFloat(field("ammo_shells"), weapon === "fallback" ? 1 : 10); owner.setFloat(field("currentammo"), weapon === "fallback" ? 1 : 10);
      owner.setVector(field("size"), { x: 32, y: 32, z: 56 });
      owner.setFloat(field("flags"), 8); owner.setVector(field("origin"), { x, y, z });
      owner.setVector(field("mins"), { x: -16, y: -16, z: -24 }); owner.setVector(field("maxs"), { x: 16, y: 16, z: 32 });
      victim.setVector(field("origin"), { x: x + 40, y, z });
      victim.setVector(field("mins"), { x: -16, y: -16, z: -24 }); victim.setVector(field("maxs"), { x: 16, y: 16, z: 32 });
      victim.setFloat(field("solid"), 2); victim.setFloat(field("takedamage"), 2); victim.setFloat(field("movetype"), 3);
      victim.setFloat(field("health"), 100); victim.setFloat(field("armorvalue"), 40); victim.setFloat(field("armortype"), 0.3); victim.setFloat(field("items"), 8192);
      victim.setInt(field("th_pain"), program.functionNamed("SUB_Null").index);
      authority.bind(target, { read: () => ({ health: victim.float(field("health")), armor: damage.readArmor(victim), mass: 200, canTakeDamage: true, invulnerable: false, team: null }),
        writeHealth: () => { throw new Error("Source health replay"); }, writeArmor: () => { throw new Error("Source armor replay"); } });
      world.link(1); world.link(2);
      vm.globals.setInt(vm.globalOffset("self"), entities.reference(1)); vm.globals.setFloat(vm.globalOffset("time"), 3);
      vm.globals.setVector(4, owner.vector(field("v_angle"))); vm.execute(program.functionNamed("makevectors").index, 1);
      if (weapon !== "axe" && weapon !== "shotgun" && weapon !== "supershotgun" && weapon !== "fallback") {
        const worldHazard = weapon === "drown" || weapon === "lava" || weapon === "slime" || weapon === "fall";
        const name = weapon === "drown" || weapon === "lava" || weapon === "slime" ? "WaterMove" : weapon === "fall" ? "PlayerPostThink"
          : weapon === "hurt" || weapon === "hurt-invulnerable" ? "hurt_touch" : weapon === "door" ? "door_blocked"
          : weapon === "secret" ? "secret_blocked" : weapon === "plat" ? "plat_crush" : "train_blocked";
        const hazard = worldHazard ? weapon : weapon.startsWith("hurt") ? "trigger" : "crush";
        victim.setFloat(field("flags"), weapon === "fall" ? 512 : 16);
        victim.setFloat(field("air_finished"), weapon === "drown" ? 0 : 20);
        victim.setFloat(field("waterlevel"), weapon === "drown" ? 3 : weapon === "fall" ? 0 : 1);
        victim.setFloat(field("watertype"), weapon === "lava" ? -5 : weapon === "slime" ? -4 : weapon === "fall" ? -1 : -3);
        victim.setVector(field("view_ofs"), { x: 0, y: 0, z: 22 });
        victim.setFloat(field("dmg"), 2); victim.setFloat(field("jump_flag"), -700); victim.setFloat(field("attack_finished"), 10);
        owner.setFloat(field("dmg"), 10); owner.setFloat(field("wait"), -1); owner.setFloat(field("state"), 2); owner.setFloat(field("speed"), 150);
        owner.setInt(field("noise"), vm.strings.allocate("plats/plat1.wav")); owner.setFloat(field("super_damage_finished"), 10);
        if (weapon === "hurt-invulnerable") { victim.setFloat(field("invincible_finished"), 10); victim.setFloat(field("invincible_sound"), 10); }
        vm.globals.setInt(vm.globalOffset("self"), entities.reference(worldHazard ? 2 : 1));
        vm.globals.setInt(vm.globalOffset("other"), entities.reference(2));
        const functionIndex = program.functionNamed(name).index;
        environmentalCallback = worldHazard ? null : { kind: weapon.startsWith("hurt") ? "touch" : "blocked", actor: shooter.id, other: target.id, functionIndex };
        vm.execute(functionIndex);
        const bytes = entities.bytes.slice(), velocity = bodies.read(target.id)?.velocity;
        if (observed) {
          expect(outcomes, weapon).toHaveLength(1); const outcome = outcomes[0];
          if (outcome?.kind !== "committed") throw new Error("Missing environmental decision");
          expect(outcome.decision.request.attack.cause).toEqual({ kind: "environment", hazard });
          expect(outcome.decision.request.attack.weapon).toBeNull();
          const expectedInflictor = worldHazard ? slots.at(0)?.id : shooter.id;
          if (expectedInflictor === undefined) throw new Error("Missing environmental inflictor");
          expect(outcome.decision.request.attack.inflictor).toEqual(expectedInflictor);
          expect(outcome.decision.mutations.some(value => value.kind === "source-velocity")).toBe(!worldHazard);
          expect(outcome.decision.mutations.some(value => value.kind === "impulse")).toBe(false);
          expect(outcome.decision.request.knockback).toBe(worldHazard ? 0 : weapon === "plat" ? 4 : 40);
          const momentum = outcome.decision.mutations.find(value => value.kind === "source-velocity");
          if (momentum?.kind === "source-velocity") for (const axis of ["x", "y", "z"] satisfies readonly ("x" | "y" | "z")[])
            expect(momentum.after[axis]).toBe(Math.fround(numeric.add(momentum.before[axis], Math.fround(numeric.multiply(Math.fround(numeric.multiply(outcome.decision.request.direction[axis], outcome.decision.request.knockback)), 8)))));
          if (weapon === "hurt-invulnerable") expect(victim.float(field("health"))).toBe(100);
          if (weapon === "fall") expect(vm.strings.get(victim.int(field("deathtype")))).toBe("falling");
          if (!worldHazard) {
            environmentalCallback = null; owner.setFloat(field("attack_finished"), 0);
            expect(() => vm.execute(functionIndex)).toThrow("Unmatched id1 environmental callback");
          }
        }
        actors.close(); return { bytes, velocity };
      }
      vm.execute(program.functionNamed(weapon === "axe" ? "W_FireAxe" : weapon === "shotgun" ? "W_FireShotgun" : "W_FireSuperShotgun").index);
      const bytes = entities.bytes.slice(), velocity = bodies.read(target.id)?.velocity;
      if (observed) {
        expect(owner.float(field("ammo_shells"))).toBe(weapon === "axe" ? 10 : weapon === "fallback" ? 0 : weapon === "shotgun" ? 9 : 8);
        expect(outcomes).toHaveLength(1); const outcome = outcomes[0]; if (outcome?.kind !== "committed") throw new Error("No committed source attack");
        expect(outcome.decision.appliedDamage).toBeGreaterThan(0);
        expect(outcome.decision.request.attack.weapon).toBe(weapon === "fallback" ? "q1:weapon/shotgun" : `q1:weapon/${weapon}`);
        expect(outcome.decision.request.attack.attacker).toEqual(shooter.id);
        expect(outcome.decision.request.target).toEqual(target.id);
        expect(outcome.decision.request.attack.time).toEqual({ kind: "seconds", value: 3 });
        expect(outcome.decision.request.point.x).toBeGreaterThan(x);
        expect(outcome.decision.mutations.some(value => value.kind === "source-velocity")).toBe(true);
        vm.globals.setInt(4, entities.reference(2)); vm.globals.setInt(7, entities.reference(1)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 20);
        expect(() => vm.execute(117, 4)).toThrow("Unexpected damage source");
        vm.globals.setInt(vm.globalOffset("multi_ent"), entities.reference(2)); vm.globals.setFloat(vm.globalOffset("multi_damage"), 4);
        expect(() => vm.execute(program.functionNamed("ApplyMultiDamage").index)).toThrow("Unmatched id1 synchronous damage scope");
        victim.setInt(field("th_pain"), program.functionNamed("error").index);
        expect(() => vm.execute(program.functionNamed("W_FireAxe").index)).toThrow();
        expect(() => vm.execute(program.functionNamed("ApplyMultiDamage").index)).toThrow("Unmatched id1 synchronous damage scope");
      }
      actors.close(); return { bytes, velocity };
    };
    for (const weapon of ["axe", "shotgun", "supershotgun", "fallback"] satisfies readonly ("axe" | "shotgun" | "supershotgun" | "fallback")[]) expect(run(true, weapon)).toEqual(run(false, weapon));
    for (const hazard of ["drown", "lava", "slime", "fall", "hurt", "door", "secret", "plat", "train", "hurt-invulnerable"] satisfies readonly HazardCase[])
      expect(run(true, hazard)).toEqual(run(false, hazard));
  } finally { archive.close(); }
}, 45000);

test.skipIf(!haveCorpus)("actual id1 broadcast writers preserve all temp effects, bytes and actor generations", async () => {
  const { QcWorldHost } = await import("../../../src/compat/qc/world-host.ts");
  const { QcBroadcastMessages } = await import("../../../src/compat/qc/presentation-host.ts");
  const { createSceneQueries } = await import("../../../src/world/collision/index.ts");
  const { readQ1Bsp } = await import("../../../src/formats/q1-map/index.ts");
  const { parseQ12Model } = await import("../../../src/formats/q12-model/index.ts");
  const { SourceRandom } = await import("../../../src/app/bootstrap/simulation/random.ts");
  const program = await readProgram("id1/PAK0.PAK"), archive = await openArchive(corpus + "id1/PAK0.PAK");
  const actors = new SessionActorRegistry(createIdentityOwner("qc-broadcast"));
  try {
    const mapEntry = archive.findEntries("maps/e1m1.bsp")[0], spriteEntry = archive.findEntries("progs/s_explod.spr")[0];
    if (mapEntry === undefined || spriteEntry === undefined) throw new Error("Missing actual broadcast resources");
    const map = readQ1Bsp(await archive.readEntry(mapEntry)), sprite = parseQ12Model(await archive.readEntry(spriteEntry), "progs/s_explod.spr");
    if (sprite.kind !== "q1-spr") throw new Error("Expected actual explosion sprite");
    const scene = createSceneQueries(map), numeric = createNumericOperations(Q1_DONOR_PROFILE);
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 16);
    const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric),
      onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => { scene.link(body, { family: "q1", shape: { kind: "box" }, contents: -2, owner: null, role: "solid", monster: false, deadMonster: false }); return undefined; } });
    const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 16, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }), now: () => ({ kind: "seconds", value: 3 }),
      unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No message edicts"); } });
    slots.bindExisting(0, "quakec:world"); const shooter = slots.allocate("quakec:writer");
    const world = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE,
      model: name => name === "progs/s_explod.spr" ? { index: 1, bounds: sprite.bounds } : null,
      foreignReference: () => { throw new Error("No foreign message actors"); } });
    world.actor(0); world.actor(1);
    const events: import("../../../src/compat/qc/presentation-host.ts").QcBroadcastEvent[] = [];
    let messages = new QcBroadcastMessages(world, event => { events.push(event); return undefined; });
    const vm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "netquake", random: new SourceRandom(1), host: world.host, isFreeEntity: world.isFreeEntity }), serverActive: () => true });
    // The registry is built from these real host functions before each source execution.
    const source = () => new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "netquake", random: new SourceRandom(1),
      host: new Map([...world.host, ...messages.host]), isFreeEntity: world.isFreeEntity }), serverActive: () => true });
    const field = (name: string): number => { const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing ${name}`); return value.offset; };
    const words = entities.at(1), origin = { x: 480.1875, y: -352.1875, z: 89.1875 };
    words.setVector(field("origin"), origin); words.setFloat(field("ammo_cells"), 2); words.setFloat(field("t_width"), 100);
    words.setFloat(field("solid"), 0); words.setFloat(field("takedamage"), 0); world.link(1);
    const actual = source();
    actual.globals.setInt(actual.globalOffset("self"), entities.reference(1)); actual.globals.setFloat(actual.globalOffset("time"), 3);
    actual.globals.setVector(actual.globalOffset("v_forward"), { x: 1, y: 0, z: 0 });
    actual.execute(program.functionNamed("W_FireLightning").index);
    actual.execute(program.functionNamed("GrenadeExplode").index);
    expect(events).toHaveLength(0); messages.flush();
    expect(events[0]).toMatchObject({ kind: "beam", style: "lightning2", actor: shooter.id, start: { x: 480.125, y: -352.125, z: 105.125 } });
    expect(events[1]).toMatchObject({ kind: "effect", effect: "explosion", origin: { x: 480.125, y: -352.125, z: 89.125 } });
    expect(words.float(field("ammo_cells"))).toBe(1);
    const write = (name: QcHostBuiltinName, value: number, integer = false): void => {
      const builtin = messages.host.get(name); if (builtin === undefined) throw new Error(`Missing ${name}`);
      vm.globals.setFloat(4, 0); if (integer) vm.globals.setInt(7, value); else vm.globals.setFloat(7, value); builtin(vm);
    };
    const reset = (): void => { events.length = 0; messages = new QcBroadcastMessages(world, event => { events.push(event); return undefined; }); };
    reset();
    write("WriteChar", 23); write("WriteAngle", 0); write("WriteLong", 0);
    write("WriteString", vm.strings.setEngine("message-byte", "\x80"), true);
    expect([...messages.bytes()]).toEqual([23, 0, 0, 0, 0, 0, 128, 0]); messages.flush();
    expect(events[0]).toMatchObject({ kind: "effect", effect: "spike", origin: { x: 0, y: 0, z: 16 } });
    reset();
    for (let type = 0; type < 14; type++) {
      write("WriteByte", 23); write("WriteByte", type);
      const beam = type === 5 || type === 6 || type === 9 || type === 13;
      if (beam) write("WriteEntity", entities.reference(1), true);
      for (let axis = 0; axis < (beam ? 6 : 3); axis++) write("WriteCoord", axis + 0.1875);
      if (type === 12) { write("WriteByte", 176); write("WriteByte", 8); }
    }
    messages.flush(); expect(events).toHaveLength(14);
    expect(events[7]).toMatchObject({ kind: "effect", effect: "wizard-spike" }); expect(events[8]).toMatchObject({ kind: "effect", effect: "knight-spike" });
    expect(events[12]).toEqual({ kind: "colored-explosion", origin: { x: 0.125, y: 1.125, z: 2.125 }, colorStart: 176, colorLength: 8 });
    const encoded: Uint8Array[] = [];
    reset();
    for (const mode of ["entity", "short", "bytes"]) {
      write("WriteByte", 23); write("WriteByte", 6);
      if (mode === "entity") write("WriteEntity", entities.reference(1), true);
      else if (mode === "short") write("WriteShort", 1);
      else { write("WriteByte", 1); write("WriteByte", 0); }
      for (let axis = 0; axis < 6; axis++) write("WriteCoord", axis);
      encoded.push(messages.bytes().slice(-16));
    }
    const firstEncoding = encoded[0]; if (firstEncoding === undefined) throw new Error("Missing entity encoding");
    for (const bytes of encoded) expect(bytes).toEqual(firstEncoding);
    actors.release(shooter); const replacement = slots.bindExisting(1, "quakec:replacement");
    expect(replacement.id.equals(shooter.id)).toBe(false);
    messages.flush(); expect(events).toHaveLength(3);
    for (const event of events) { if (event.kind !== "beam") throw new Error("Expected captured beam"); expect(event.actor.equals(shooter.id)).toBe(true); }
    reset();
    write("WriteByte", 23); write("WriteByte", 3); for (let axis = 0; axis < 3; axis++) write("WriteCoord", 0);
    write("WriteByte", 23); write("WriteByte", 6); write("WriteShort", 15); for (let axis = 0; axis < 6; axis++) write("WriteCoord", 0);
    expect(() => messages.flush()).toThrow("had no owned actor"); expect(events).toHaveLength(0);
    reset(); write("WriteByte", 23); write("WriteByte", 3); write("WriteCoord", 0);
    expect(() => messages.flush()).toThrow(); expect(events).toHaveLength(0);
    reset(); const byte = messages.host.get("WriteByte"); if (byte === undefined) throw new Error("Missing byte writer");
    for (const destination of [1, 2, 3]) { vm.globals.setFloat(4, destination); expect(() => byte(vm)).toThrow("destination"); }
    expect(messages.bytes()).toHaveLength(0);
  } finally { actors.close(); archive.close(); }
});

test.skipIf(!haveCorpus)("installed Hipnotic localcmd appends exact source text without executing it", async () => {
  const { QcWorldHost } = await import("../../../src/compat/qc/world-host.ts");
  const { createQcPresentationBindings } = await import("../../../src/compat/qc/presentation-host.ts");
  const { createSceneQueries } = await import("../../../src/world/collision/index.ts");
  const { readQ1Bsp } = await import("../../../src/formats/q1-map/index.ts");
  const { CommandBuffer } = await import("../../../src/core/commands/index.ts");
  const program = await readProgram("hipnotic/pak0.pak"), archive = await openArchive(corpus + "id1/PAK0.PAK");
  const identity = createIdentityOwner("qc-localcmd"), actors = new SessionActorRegistry(identity);
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing real geometry");
    const scene = createSceneQueries(readQ1Bsp(await archive.readEntry(entry))), numeric = createNumericOperations(Q1_DONOR_PROFILE);
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 16), bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric),
      onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
        scene.link(body, { family: "q1", shape: { kind: "box" }, contents: -2, owner: null, role: "solid", monster: false, deadMonster: false }); return undefined;
      } });
    const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 16, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }), now: () => ({ kind: "seconds", value: 1 }),
      unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No command edicts"); } });
    slots.bindExisting(0, "quakec:world"); slots.allocate("quakec:info_command");
    const world = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE, model: () => null,
      foreignReference: () => { throw new Error("No foreign command actors"); } });
    const texts: string[] = [], printed: string[] = [];
    const presentation = createQcPresentationBindings(world, { content: "q1:classic:hipnotic:retail", loading: () => false,
      print: () => undefined, lookup: () => null, precache: () => { throw new Error("No command precache"); },
      events: { registerResource: () => undefined, emit: (_content, source) => {
        if (source.event.kind !== "server-command") throw new Error("Unexpected command event"); texts.push(source.event.text); return undefined;
      } } });
    const vm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "netquake", host: presentation }), serverActive: () => true });
    const message = program.fieldsByName.get("message"); if (message === undefined) throw new Error("Missing message field");
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(1));
    const chunks = ["echo \"split", " text\";wait;echo after\n"];
    for (const text of chunks) { entities.at(1).setInt(message.offset, vm.strings.setEngine("map-command", text)); vm.execute(program.functionNamed("info_command").index); }
    expect(texts).toEqual(chunks); expect(printed).toEqual([]);
    const commands = new CommandBuffer({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "server-console" } }, print: text => { printed.push(text); } });
    for (const text of texts) commands.append(text);
    expect(printed).toEqual([]); commands.execute(); expect(printed.join("")).toContain("split text"); expect(printed.join("")).not.toContain("after");
    commands.execute(); expect(printed.join("")).toContain("after");
  } finally { actors.close(); archive.close(); }
});


test.skipIf(!haveCorpus)("Q1 application localcmd shares native startup and next-frame command execution", async () => {
  const { Application } = await import("../../../src/app/bootstrap/application.ts");
  const { parseApplicationCommand } = await import("../../../src/app/bootstrap/options.ts");
  const { applicationPreset } = await import("../../../src/app/bootstrap/content.ts");
  const { discoverInstalledContent, presetChoice, resolveLaunch } = await import("../../../src/content/catalog/index.ts");
for (const mode of ['qc', 'native']) {
  const command = parseApplicationCommand(['--game', mode === 'qc' ? 'q1-classic-id1' : 'q1-classic-hipnotic', '--map', mode === 'qc' ? 'e1m1' : 'hip1m1', '--dedicated']);
  if (command.kind !== 'run') throw new Error('Missing launch');
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset: mode === 'native' ? preset : { ...preset, execution: [{ kind: 'quakec', owner: preset.map.entities, role: 'server-game', artifact: { content: preset.map.entities.content, path: 'progs.dat' }, api: { kind: 'q1-netquake', programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
  const printed: string[] = [];
  const app = await Application.open(command.options, { print: text => { printed.push(text); } }, recipe);
  try {
    const qc = app.simulation.quakecSource(), native = app.simulation.q1Source();
    const cvars = qc?.cvars ?? native?.cvars; if (cvars === undefined) throw new Error('Missing cvars');
    const emit = (text: string): void => {
      if (qc !== null) { qc.machine.globals.setInt(4, qc.machine.strings.setEngine('localcmd-probe', text)); qc.machine.execute(qc.prepared.program.functionNamed('localcmd').index, 1); }
      else if (native !== null) { const entity = native.game.create('info_command'); entity.message = text; native.game.spawnEntity(entity); }
      else throw new Error('Missing source');
    };
    emit('sv_gravity 3'); emit('21;echo startup-once;wait;sv_gravity 654\n');
    if (cvars.variableValue('sv_gravity') !== 800) throw new Error('Command executed synchronously');
    await app.step(100);
    if (cvars.variableValue('sv_gravity') !== 321) throw new Error('Startup/append/wait phase failed');
    const delivered = app.presentationEvents.filter(event => event.kind === 'q1' && event.event.kind === 'server-command');
    if (delivered.length !== 2) throw new Error('Startup events lost or duplicated');
    await app.step(100);
    if (cvars.variableValue('sv_gravity') !== 654) throw new Error('Next-frame wait failed');
    if (printed.join('').split('startup-once').length !== 2) throw new Error('Startup command replayed');
    if (qc !== null) {
      const begin = qc.beginFrame.bind(qc); let once = false;
      qc.beginFrame = frame => { begin(frame); if (!once) { once = true; emit('sv_gravity 222\n'); } return undefined; };
      await app.step(100);
      if (cvars.variableValue('sv_gravity') !== 654) throw new Error('Source command executed at frame end');
      await app.step(100);
      if (cvars.variableValue('sv_gravity') !== 222) throw new Error('Source command did not execute next frame');
    }
    emit('not_a_registered_engine_command\n'); await app.step(100);
    if (!printed.join('').includes('Unknown command')) throw new Error('Unsupported command silently swallowed');
    expect(delivered).toHaveLength(2);
    expect(printed.join('')).toContain('Unknown command');
  } finally { await app.close(); }
}
}, 30000);

test.skipIf(!haveCorpus)("actual id1 e1m2 makestatic preserves resources and pose before source release", async () => {
  const { Application } = await import("../../../src/app/bootstrap/application.ts");
  const { parseApplicationCommand } = await import("../../../src/app/bootstrap/options.ts");
  const { applicationPreset } = await import("../../../src/app/bootstrap/content.ts");
  const { discoverInstalledContent, presetChoice, resolveLaunch } = await import("../../../src/content/catalog/index.ts");
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m2", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Missing dedicated command");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset: { ...preset, execution: [{ kind: "quakec", owner: preset.map.entities, role: "server-game",
    artifact: { content: preset.map.entities.content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
  const app = await Application.open(command.options, { print: () => undefined }, recipe);
  try {
    const source = app.simulation.quakecSource(); if (source === null) throw new Error("Missing actual source");
    const startup = app.simulation.drainPresentationEvents().filter(event => event.kind === "q1" && event.event.kind === "static-model");
    expect(startup).toHaveLength(24);
    expect(startup.some(event => event.kind === "q1" && event.event.kind === "static-model" && event.event.path === "progs/flame.mdl"
      && event.event.origin.x === 932 && event.event.origin.y === 640 && event.event.origin.z === 340)).toBe(true);
    expect(source.machine.profiling[source.prepared.program.functionNamed("light_torch_small_walltorch").index]).toBeGreaterThan(0);
    const vm = source.machine, field = (name: string): number => vm.fieldOffset(name);
    vm.execute(source.prepared.program.functionNamed("spawn").index);
    const reference = vm.globals.int(1), slot = source.entities.slot(reference), actor = source.slots.at(slot);
    if (actor === null) throw new Error("Source spawn did not admit actor");
    const words = source.entities.at(slot), origin = { x: 1.1875, y: -2.1875, z: 3.1875 }, angles = { x: 12.375, y: 43.875, z: 0.125 };
    words.setVector(field("origin"), origin); words.setVector(field("angles"), angles);
    words.setFloat(field("frame"), 300.75); words.setFloat(field("colormap"), 258.75); words.setFloat(field("skin"), 259.75);
    words.setFloat(field("modelindex"), 255); words.setInt(field("model"), vm.strings.setEngine("static-model-test", "progs/not-precached.mdl"));
    vm.globals.setInt(4, reference);
    expect(() => vm.execute(source.prepared.program.functionNamed("makestatic").index, 1)).toThrow("not precached");
    expect(app.simulation.actors.isLive(actor.id)).toBe(true); expect(app.simulation.drainPresentationEvents()).toHaveLength(0);
    words.setInt(field("model"), vm.strings.setEngine("static-model-test", "progs/flame.mdl"));
    vm.globals.setInt(4, reference); vm.execute(source.prepared.program.functionNamed("makestatic").index, 1);
    expect(app.simulation.actors.isLive(actor.id)).toBe(false); expect(source.slots.at(slot)).toBeNull(); expect(source.worldHost.isFreeEntity(slot)).toBe(true);
    const emitted = app.simulation.drainPresentationEvents(); expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ kind: "q1", event: { kind: "static-model", path: "progs/flame.mdl", frame: 300, colorMap: 258, skin: 259, origin, angles } });
    vm.execute(source.prepared.program.functionNamed("spawn").index);
    const reused = source.slots.at(source.entities.slot(vm.globals.int(1))); if (reused === null) throw new Error("Missing reused source actor");
    expect(source.entities.slot(vm.globals.int(1))).toBe(slot); expect(reused.id.equals(actor.id)).toBe(false);
    source.entities.at(slot).setVector(field("origin"), { x: 999, y: 999, z: 999 });
    expect(emitted[0]).toMatchObject({ kind: "q1", event: { origin, angles } });
    source.entities.at(slot).setInt(field("model"), 0);
    vm.globals.setInt(4, source.entities.reference(slot)); vm.execute(source.prepared.program.functionNamed("makestatic").index, 1);
    expect(app.simulation.actors.isLive(reused.id)).toBe(false); expect(source.worldHost.isFreeEntity(slot)).toBe(true);
    const emptyModel = app.simulation.drainPresentationEvents();
    expect(emptyModel).toHaveLength(1); expect(emptyModel[0]).toMatchObject({ kind: "q1", event: { kind: "static-model", path: "", origin: { x: 999, y: 999, z: 999 } } });
    await app.step(100);
    expect(app.simulation.events.capture().persistent.filter(event => event.kind === "q1" && event.event.kind === "static-model")).toHaveLength(26);
  } finally { await app.close(); }
}, 30000);
