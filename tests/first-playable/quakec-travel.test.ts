import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset } from "../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";

async function openNativeApplication(root: string) {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", "q1", "--character", "q1", "--dedicated", "--user-content-root", root]);
  if (command.kind !== "run") throw new Error("Missing native launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, userContentRoot: root, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset: { ...preset, execution: [{ kind: "quakec", owner: preset.map.entities,
    role: "server-game", artifact: { content: preset.map.entities.content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
  return Application.open(command.options, { print: () => undefined }, recipe);
}

test("native NetQuake authored start exit carries source parms through the existing Application world change", async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-native-travel-"));
  let application: Application | null = null;
  try {
    const app = await openNativeApplication(root); application = app;
    const original = app.simulation, source = original.quakecSource();
    if (source === null) throw new Error("Missing native QuakeC source");
    expect(original.q1Source()).toBeNull();
    const client = app.session.createClient(0); client.connect("loopback");
    source.setClientInfo(client.id, new Map([["name", "Native carry"], ["bottomcolor", "4"]]));
    const player = original.admitPlayer(client.id), owned = original.actors.resolveOwned(player.actor);
    if (owned === null) throw new Error("Missing shared native player");
    const vm = source.machine, field = (name: string) => vm.fieldOffset(name), words = source.entities.at(1);
    words.setFloat(field("health"), 27); words.setFloat(field("armorvalue"), 60); words.setFloat(field("armortype"), 0.6);
    words.setFloat(field("items"), 4096 | 1 | 32 | 16384 | 131072 | 4194304);
    words.setFloat(field("weapon"), 32); words.setFloat(field("ammo_shells"), 7); words.setFloat(field("ammo_rockets"), 9);
    vm.globals.setFloat(vm.globalOffset("serverflags"), 5); source.cvars.set("sv_gravity", "600"); source.cvars.set("sv_maxspeed", "280");
    const exit = original.actors.observations().find(actor => {
      const slot = source.sourceSlot(actor.id);
      return slot !== null && source.classname(actor.id) === "trigger_changelevel" && vm.strings.get(source.entities.at(slot).int(field("map"))) === "e1m1";
    });
    if (exit === undefined) throw new Error("Missing authored start exit to e1m1");
    const exitSlot = source.sourceSlot(exit.id), body = original.bodies.read(player.actor);
    if (exitSlot === null || body === null) throw new Error("Missing shared travel bodies");
    const exitWords = source.entities.at(exitSlot), minimum = exitWords.vector(field("absmin")), maximum = exitWords.vector(field("absmax"));
    original.bodies.write(owned, { ...body, origin: { x: (minimum.x + maximum.x) / 2, y: (minimum.y + maximum.y) / 2, z: (minimum.z + maximum.z) / 2 } });
    original.bodies.link(owned); original.physics.touchTriggers(owned);
    for (let tick = 0; tick < 40 && app.simulation === original; tick++) await app.step(100);
    expect(app.options.map).toBe("maps/e1m1.bsp");
    expect(app.simulation).not.toBe(original);
    const next = app.simulation.quakecSource();
    if (next === null) throw new Error("Travel lost native QuakeC execution");
    expect(app.simulation.q1Source()).toBeNull();
    expect(original.actors.isLive(player.actor)).toBe(false);
    const actor = app.simulation.players()[0];
    if (actor === undefined) throw new Error("Travel lost the player");
    expect(actor.equals(player.actor)).toBe(false);
    expect(app.simulation.movementPlayer(actor)?.client.equals(client.id)).toBe(true);
    expect(next.clientInfo(client.id).get("name")).toBe("Native carry");
    const carried = next.entities.at(1), nextField = (name: string) => next.machine.fieldOffset(name);
    expect(carried.float(nextField("health"))).toBe(50);
    expect(carried.float(nextField("ammo_shells"))).toBe(25);
    expect(carried.float(nextField("ammo_rockets"))).toBe(9);
    expect(carried.float(nextField("armorvalue"))).toBe(60);
    expect(carried.float(nextField("items"))).toBe(4096 | 1 | 32 | 16384 | 1024);
    expect(carried.float(nextField("weapon"))).toBe(32);
    expect(next.machine.globals.float(next.machine.globalOffset("serverflags"))).toBe(5);
    expect(next.cvars.variableValue("sv_gravity")).toBe(800);
    expect(next.cvars.variableValue("sv_maxspeed")).toBe(280);
    expect(next.timeSeconds).toBe(1);
    expect(Array.from({ length: 16 }, (_, index) => next.machine.globals.float(next.machine.globalOffset(`parm${index + 1}`))))
      .toEqual(Array.from({ length: 16 }, (_, index) => vm.globals.float(vm.globalOffset(`parm${index + 1}`))));
    expect(vm.profiling[vm.program.functionNamed("SetChangeParms").index]).toBeGreaterThan(0);
    expect(next.machine.profiling[next.prepared.program.functionNamed("SetNewParms").index] ?? 0).toBe(0);
    expect(next.machine.profiling[next.prepared.program.functionNamed("ClientConnect").index]).toBeGreaterThan(0);
    expect(next.machine.profiling[next.prepared.program.functionNamed("PutClientInServer").index]).toBeGreaterThan(0);
    expect(app.simulation.inventory.count(actor, "q1:weapon/rocketlauncher")).toBe(1);
    expect(app.simulation.inventory.count(actor, "q1:ammo/rockets")).toBe(9);
    await app.changeLevel("e1m2");
    expect(app.options.map).toBe("maps/e1m2.bsp");
    const last = app.simulation.quakecSource(), lastActor = app.simulation.players()[0];
    if (last === null || lastActor === undefined) throw new Error("Second native travel lost source or player");
    expect(app.simulation.movementPlayer(lastActor)?.client.equals(client.id)).toBe(true);
    expect(app.simulation.inventory.count(lastActor, "q1:ammo/rockets")).toBe(9);
    expect(last.machine.globals.float(last.machine.globalOffset("serverflags"))).toBe(5);
    last.entities.at(1).setFloat(last.machine.fieldOffset("health"), 0);
    await app.changeLevel("e1m1");
    const respawned = app.simulation.quakecSource(), respawnedActor = app.simulation.players()[0];
    if (respawned === null || respawnedActor === undefined) throw new Error("Dead-client travel lost native player");
    expect(respawned.entities.at(1).float(respawned.machine.fieldOffset("health"))).toBe(100);
    expect(respawned.entities.at(1).float(respawned.machine.fieldOffset("armorvalue"))).toBe(0);
    expect(app.simulation.inventory.count(respawnedActor, "q1:weapon/rocketlauncher")).toBe(0);
    expect(app.simulation.inventory.count(respawnedActor, "q1:ammo/rockets")).toBe(0);
    expect(last.machine.profiling[last.prepared.program.functionNamed("SetNewParms").index]).toBeGreaterThan(0);
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("native changelevel schedules one existing transition per source world", async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-native-transition-"));
  let application: Application | null = null;
  try {
    const app = await openNativeApplication(root); application = app;
    const source = app.simulation.quakecSource();
    if (source === null) throw new Error("Missing native source");
    const vm = source.machine, changelevel = vm.program.functionNamed("changelevel").index;
    for (const map of ["e1m1", "e1m2"]) {
      vm.globals.setInt(4, vm.strings.allocate(map)); vm.execute(changelevel, 1);
    }
    const transitions = app.simulation.takeTransitions();
    expect(transitions).toHaveLength(1);
    const transition = transitions[0];
    if (transition?.kind !== "campaign-level") throw new Error("Missing native campaign transition");
    expect(transition.map).toBe("q1:e1m1");
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 15000);
