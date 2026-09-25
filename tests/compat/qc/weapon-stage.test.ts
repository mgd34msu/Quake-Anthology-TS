import type { QcPrimaryWeaponStageDeclaration } from "../../../src/contracts/qc-weapon-stage.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { readQuakeCCompatibility } from "../../../src/compat/qc/compatibility.ts";
import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins } from "../../../src/compat/qc/index.ts";
import type { QcBuiltin, QcHostBuiltinName } from "../../../src/compat/qc/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { qcWeaponStage, QcWeaponStageBinding, invokeQcClientStage, qcClientStageSelf } from "../../../src/content/q1/quakec/weapon-stage.ts";
import { id1DamageMultiplier } from "../../../src/content/q1/quakec/id1-program.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";

for (const kind of ["netquake", "quakeworld"] satisfies readonly ("netquake" | "quakeworld")[]) test(`original ${kind} selected weapon boundary preserves committed axe, retires repeat shots, and continues post-think`, async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK");
  try {
    const entry = archive.findEntries("progs.dat").at(-1); if (entry === undefined) throw new Error("Missing original id1 program");
    const program = loadQcProgram(kind === "quakeworld" ? await Bun.file("/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat").bytes() : await archive.readEntry(entry)), originalStage = qcWeaponStage(program);
    if (originalStage === null || originalStage.client === undefined) throw new Error("Missing qualified original weapon stage");
    const declaration = readQuakeCCompatibility(new TextEncoder().encode(JSON.stringify({ version: 1, artifactDigest: program.digest, weaponStage: {
      dispatcher: program.functionAt(originalStage.dispatcher).name,
      continuations: [...originalStage.continuations].map(index => program.functionAt(index).name),
      repeats: originalStage.repeats.map(gate => ({ function: program.functionAt(gate.region.functionIndex).name, entry: gate.region.entry, exit: gate.region.exit,
        result: { word: gate.released, value: gate.value }, statements: program.statements.slice(gate.region.entry, gate.region.exit + 1) })),
      client: { spawn: program.functionAt(originalStage.client.spawn.functionIndex).name, selectSpawn: program.functionAt(originalStage.client.selectSpawn.functionIndex).name, objectives: { kind: "none" } },
    } })), program.digest).weaponStage;
    if (declaration === undefined) throw new Error("Missing declared weapon stage");
    const stage = qcWeaponStage(program, declaration);
    if (stage === null) throw new Error("Declared original weapon stage was not admitted");
    expect(stage).toEqual(originalStage);
    expect(() => qcWeaponStage(program, { ...declaration, client: { ...declaration.client, spawn: declaration.client.selectSpawn } })).toThrow("does not return void");
    expect(() => qcWeaponStage(program, { ...declaration, client: { ...declaration.client, selectSpawn: declaration.dispatcher } })).toThrow("does not return entity");
    expect(() => qcWeaponStage(program, { ...declaration, client: { ...declaration.client, objectives: { kind: "call", function: "T_Damage" } } })).toThrow("incompatible source signature");
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 4, 3);
    const selected = new Set([entities.reference(2)]), sounds: string[] = [], traces: number[] = [], messages: number[] = [];
    const host = new Map<QcHostBuiltinName, QcBuiltin>([
      ["WriteByte", vm => { messages.push(vm.argFloat(1)); return undefined; }],
      ["WriteEntity", vm => { messages.push(vm.argInt(1)); return undefined; }],
      ["multicast", () => undefined],
      ["sound", vm => { sounds.push(vm.strings.get(vm.globals.int(10))); return undefined; }],
      ["traceline", vm => { traces.push(vm.globals.int(vm.globalOffset("self"))); vm.globals.setFloat(vm.globalOffset("trace_fraction"), 1); return undefined; }],
    ]);
    const binding = new QcWeaponStageBinding(stage, () => vm, reference => selected.has(reference));
    const vm: QcMachine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind, host, random: new SourceRandom(1) }), serverActive: () => true,
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
    if (kind === "quakeworld") expect(messages).toEqual([39, entities.reference(1), 39, entities.reference(1), 39, entities.reference(1), 39, entities.reference(1)]);
    words.setVector(field("view_ofs"), { x: 0, y: 0, z: 22 }); words.setFloat(field("health"), 100);
    words.setFloat(field("flags"), 512); words.setFloat(field("jump_flag"), -400); words.setFloat(field("watertype"), -1);
    words.setFloat(field("super_damage_finished"), 9); words.setFloat(field("super_time"), 20); words.setFloat(field("items"), 4194304);
    run("PlayerPostThink");
    expect(sounds).toContain("player/land.wav"); expect(words.float(field("jump_flag"))).toBe(0);
    expect(words.float(field("super_damage_finished"))).toBe(0); expect(words.float(field("items"))).toBe(0);
    for (const [deathmatch, quadUntil, classname, factor] of [
      [1, 20, "player", 4], [4, 20, "player", kind === "quakeworld" ? 8 : 4],
      [4, 20, "door", kind === "quakeworld" ? 1 : 4], [4, 0, "player", 1],
    ] satisfies readonly (readonly [number, number, string, number])[]) {
      vm.globals.setFloat(vm.globalOffset("deathmatch"), deathmatch);
      words.setFloat(field("super_damage_finished"), quadUntil);
      words.setInt(field("classname"), vm.strings.allocate(classname));
      expect(id1DamageMultiplier(vm, entities.reference(1), entities.reference(1))).toBe(factor);
    }
    const other = entities.at(2);
    other.setFloat(field("weapon"), 4096); other.setFloat(field("items"), 4096); other.setFloat(field("button0"), 1);
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(2)); run("W_WeaponFrame");
    expect(other.float(field("attack_finished"))).toBeGreaterThan(10);
    expect(binding.settled(entities.reference(2))).toBe(false);
  } finally { archive.close(); }
});


test("declared client calls execute original Copper parameters, globals and entity results with nested staging restored", async () => {
  const program = loadQcProgram(await Bun.file("/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat").bytes());
  const declaration: QcPrimaryWeaponStageDeclaration = { dispatcher: "W_WeaponFrame", continuations: ["player_axe1"], repeats: [], client: {
    spawn: { function: "autosave", arguments: [{ kind: "input", name: "self" }, { kind: "string", value: "stage-check" }],
      globals: [{ name: "isKex", value: { kind: "float", value: 0 } }, { name: "v_forward", value: { kind: "vector", value: { x: 1, y: 2, z: 3 } } }] },
    selectSpawn: { function: "FindNextIntermission", arguments: [{ kind: "input", name: "self" }], globals: [] },
    objectives: { kind: "call", call: { function: "ClearItemEffects", arguments: [{ kind: "input", name: "self" }],
      globals: [{ name: "time", value: { kind: "input", name: "time" } }] } },
  } };
  const compatibility = () => readQuakeCCompatibility(new TextEncoder().encode(JSON.stringify({ version: 1, artifactDigest: program.digest, weaponStage: declaration })), program.digest);
  const parsed = compatibility().weaponStage;
  if (parsed === undefined) throw new Error("Missing declared client calls");
  expect(parsed).toEqual(declaration);
  const stage = qcWeaponStage(program, parsed)?.client;
  if (stage === undefined || stage.objectives.kind !== "call") throw new Error("Missing qualified client calls");
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 4, 3), actor = createIdentityOwner("qc-client-stage").actor(1, 0);
  const reference = (value: typeof actor | null) => value === null ? entities.reference(0) : value.equals(actor) ? entities.reference(1) : -1;
  const commands: string[] = [], observed: number[] = []; let fault = false;
  const host = new Map<QcHostBuiltinName, QcBuiltin>([["stuffcmd", vm => {
    if (fault) throw new Error("authored call fault");
    expect(vm.argInt(0)).toBe(reference(actor));
    expect(vm.globals.vector(vm.globalOffset("v_forward"))).toEqual({ x: 1, y: 2, z: 3 });
    const staging = vm.globals.bytes.slice(4, 112);
    expect(invokeQcClientStage(vm, stage.selectSpawn, actor, 5, reference)).toBe(reference(actor));
    expect(vm.globals.bytes.slice(4, 112)).toEqual(staging);
    commands.push(vm.argString(1)); return undefined;
  }]]);
  const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), serverActive: () => true,
    builtins: createQcBuiltins({ kind: "netquake", host, random: new SourceRandom(1) }),
    functionBoundary: { functions: new Set([stage.spawn.functionIndex]), run: (_call, execute) => { observed.push(qcClientStageSelf(vm, stage.spawn)); return execute(); } } });
  const globals = vm.globals, field = (name: string) => vm.fieldOffset(name), words = entities.at(1);
  globals.setFloat(vm.globalOffset("isKex"), 1); globals.setVector(vm.globalOffset("v_forward"), { x: 9, y: 8, z: 7 });
  globals.setInt(vm.globalOffset("self"), entities.reference(2)); globals.setInt(vm.globalOffset("other"), entities.reference(2));
  globals.setInt(1, 12345); const staging = globals.bytes.slice(4, 112);
  invokeQcClientStage(vm, stage.spawn, actor, 5, reference);
  expect(commands).toEqual(["echo Autosaving...; wait; save ", "stage-check", "\n"]); expect(observed).toEqual([reference(actor)]);
  expect(globals.float(vm.globalOffset("isKex"))).toBe(1); expect(globals.vector(vm.globalOffset("v_forward"))).toEqual({ x: 9, y: 8, z: 7 });
  expect(globals.int(vm.globalOffset("self"))).toBe(entities.reference(2)); expect(globals.int(vm.globalOffset("other"))).toBe(entities.reference(2));
  expect(globals.bytes.slice(4, 112)).toEqual(staging);
  words.setFloat(field("items"), 4194304); words.setFloat(field("super_damage_finished"), 15); words.setFloat(field("effects"), 4);
  invokeQcClientStage(vm, stage.objectives.call, actor, 5, reference);
  expect(words.float(field("items"))).toBe(0); expect(words.float(field("super_damage_finished"))).toBe(10); expect(words.float(field("effects"))).toBe(0);
  fault = true;
  expect(() => invokeQcClientStage(vm, stage.spawn, actor, 5, reference)).toThrow("authored call fault");
  expect(globals.bytes.slice(4, 112)).toEqual(staging); expect(globals.float(vm.globalOffset("isKex"))).toBe(1);
  expect(globals.int(vm.globalOffset("self"))).toBe(entities.reference(2));
  expect(() => qcWeaponStage(program, { ...parsed, client: { ...parsed.client, spawn: { function: "autosave", arguments: [], globals: [] } } })).toThrow("incompatible source signature");
  expect(() => qcWeaponStage(program, { ...parsed, client: { ...parsed.client, selectSpawn: { function: "FindNextIntermission", arguments: [{ kind: "input", name: "attacker" }], globals: [] } } })).toThrow("cannot read attacker");
  expect(() => qcWeaponStage(program, { ...parsed, client: { ...parsed.client, spawn: { function: "autosave", arguments: [{ kind: "input", name: "self" }, { kind: "string", value: "x" }], globals: [{ name: "isKex", value: { kind: "vector", value: { x: 0, y: 0, z: 0 } } }] } } })).toThrow("incompatible type");
});
