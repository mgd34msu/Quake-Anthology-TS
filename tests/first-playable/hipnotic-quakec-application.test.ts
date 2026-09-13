import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";

test("normal dedicated Hipnotic launch executes its authored start, client and stock weapon in the shared world", async () => {
  const root = await mkdtemp(join(tmpdir(), "hipnotic-application-"));
  let application: Application | null = null;
  try {
    const launch = parseApplicationCommand(["--game", "q1-classic-hipnotic", "--map", "start", "--dedicated", "--movement", "q1", "--character", "q1", "--user-content-root", root]);
    if (launch.kind !== "run") throw new Error("Missing Hipnotic launch options");
    const catalog = await discoverInstalledContent({ corpusRoot: launch.options.corpusRoot, userContentRoot: root, discoverMods: false });
    expect(applicationPreset(catalog, launch.options).execution[0]?.kind).toBe("typescript");
    const explicit = parseApplicationCommand(["--game", "q1-classic-hipnotic", "--progs", "progs.dat", "--map", "start", "--dedicated", "--movement", "q1", "--character", "q1", "--user-content-root", root]);
    if (explicit.kind !== "run") throw new Error("Missing explicit QuakeC launch options");
    expect(explicit.options.quakeCProgram).toBe("progs.dat");
    expect(() => applicationPreset(catalog, { ...explicit.options, dedicated: false })).toThrow("--progs requires");
    expect(() => parseApplicationCommand(["--progs", "../progs.dat"])).toThrow("Invalid relative resource path");
    expect(() => parseApplicationCommand(["--progs", "progs.dll"])).toThrow("mounted .dat artifact");
    const app = await Application.open(explicit.options, { print: () => undefined }); application = app;
    const simulation = app.simulation, source = simulation.quakecSource();
    if (source === null) throw new Error("Normal Hipnotic launch did not select QuakeC");
    expect(source.prepared.program.digest).toBe("sha256:35a2fdc3acb04bdafe8d0269f5327cd1d5b47971f1ef024429f1572d3201dc82");
    expect(source.kind).toBe("netquake"); expect(simulation.q1Source()).toBeNull();
    await expect(loadApplicationContent({ ...launch.options, dedicated: false }, simulation.recipe)).rejects.toThrow("QuakeC application execution requires");
    const vm = source.machine, field = (name: string) => vm.fieldOffset(name);
    expect(vm.profiling[vm.program.functionNamed("func_rotate_door").index]).toBeGreaterThan(0);
    expect(source.precacheNames("model")).not.toContain("");
    const door = simulation.actors.observations().find(actor => source.classname(actor.id) === "func_rotate_door");
    if (door === undefined) throw new Error("Missing authored rotating door controller");
    const doorSlot = source.sourceSlot(door.id);
    if (doorSlot === null) throw new Error("Missing door source slot");
    const doorWords = source.entities.at(doorSlot);
    expect(doorWords.float(field("modelindex"))).toBe(0);
    expect(doorWords.vector(field("mins"))).toEqual({ x: 0, y: 0, z: 0 });
    expect(doorWords.vector(field("maxs"))).toEqual({ x: 0, y: 0, z: 0 });
    const client = app.session.createClient(0); client.connect("loopback");
    const player = simulation.admitPlayer(client.id), words = source.entities.at(1);
    expect(simulation.players()).toHaveLength(1);
    for (const name of ["SetNewParms", "ClientConnect", "PutClientInServer"])
      expect(vm.profiling[vm.program.functionNamed(name).index]).toBeGreaterThan(0);
    expect(source.clientArsenal(player.actor).activeWeapon).toBe("q1:weapon/shotgun");
    for (const weapon of [128, 65536, 8388608]) {
      words.setFloat(field("weapon"), weapon);
      expect(() => source.clientArsenal(player.actor)).toThrow(`Unsupported actual QC weapon ${weapon}`);
    }
    words.setFloat(field("weapon"), 1);
    const shells = words.float(field("ammo_shells"));
    for (let tick = 0; tick < 12; tick++) app.session.step({ elapsedMilliseconds: 100, commands: [{ actor: player.actor,
      source: { kind: "remote-client", client: client.id }, sequence: tick + 1,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons: 1, impulse: 0 } }] });
    expect(words.float(field("ammo_shells"))).toBeLessThan(shells);
    expect(vm.profiling[vm.program.functionNamed("W_FireShotgun").index]).toBeGreaterThan(0);
    expect(simulation.inventory.count(player.actor, "q1:ammo/shells")).toBe(words.float(field("ammo_shells")));
    words.setFloat(field("armorvalue"), 60); words.setFloat(field("armortype"), 0.6);
    words.setFloat(field("items"), words.float(field("items")) | 16384);
    vm.globals.setFloat(vm.globalOffset("serverflags"), 1);
    const exit = simulation.actors.observations().find(actor => {
      const slot = source.sourceSlot(actor.id);
      return slot !== null && source.classname(actor.id) === "trigger_changelevel"
        && vm.strings.get(source.entities.at(slot).int(field("map"))) === "hip1m1";
    });
    if (exit === undefined) throw new Error("Missing authored Hipnotic start exit");
    const exitSlot = source.sourceSlot(exit.id), owned = simulation.actors.resolveOwned(player.actor), body = simulation.bodies.read(player.actor);
    if (exitSlot === null || owned === null || body === null) throw new Error("Missing shared travel bodies");
    const exitWords = source.entities.at(exitSlot), minimum = exitWords.vector(field("absmin")), maximum = exitWords.vector(field("absmax"));
    simulation.bodies.write(owned, { ...body, origin: { x: (minimum.x + maximum.x) / 2, y: (minimum.y + maximum.y) / 2, z: (minimum.z + maximum.z) / 2 } });
    simulation.bodies.link(owned); simulation.physics.touchTriggers(owned);
    for (let tick = 0; tick < 40 && app.simulation === simulation; tick++) await app.step(100);
    expect(app.options.map).toBe("maps/hip1m1.bsp");
    const next = app.simulation.quakecSource(), nextActor = app.simulation.players()[0];
    if (next === null || nextActor === undefined) throw new Error("Hipnotic travel lost source or client");
    expect(next).not.toBe(source); expect(app.simulation.q1Source()).toBeNull();
    expect(simulation.actors.isLive(player.actor)).toBe(false);
    expect(app.simulation.movementPlayer(nextActor)?.client.equals(client.id)).toBe(true);
    expect(vm.profiling[vm.program.functionNamed("SetChangeParms").index]).toBeGreaterThan(0);
    expect(vm.globals.float(vm.globalOffset("parm3"))).toBe(60);
    expect(next.machine.profiling[next.prepared.program.functionNamed("SetNewParms").index]).toBeGreaterThan(0);
    expect(next.entities.at(1).float(next.machine.fieldOffset("armorvalue"))).toBe(0);
    expect(next.machine.globals.float(next.machine.globalOffset("serverflags"))).toBe(1);
    expect(next.prepared.resources.get("misc/clang.wav")?.resource.requestedPath).toBe("sound/misc/clang.wav");
    expect(next.precacheNames("sound")).toContain("misc/clang.wav");
    expect(app.simulation.actors.observations().some(actor => next.classname(actor.id) === "monster_enforcer")).toBe(true);
    const think = next.prepared.program.functionNamed("enf_stand1").index, before = next.machine.profiling[think] ?? 0;
    for (let tick = 0; tick < 12; tick++) await app.step(100);
    expect(next.machine.profiling[think]).toBeGreaterThan(before);
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
