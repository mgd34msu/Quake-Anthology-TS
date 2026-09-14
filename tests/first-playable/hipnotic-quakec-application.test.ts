import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import type { ItemId } from "../../src/contracts/gameplay.ts";

test("explicit Hipnotic executes native weapons and authored travel through the shared world", async () => {
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
    words.setFloat(field("weapon"), 999);
    expect(() => source.clientArsenal(player.actor)).toThrow("Unsupported actual QC weapon 999");
    words.setFloat(field("weapon"), 1);
    const shells = words.float(field("ammo_shells"));
    for (let tick = 0; tick < 12; tick++) app.session.step({ elapsedMilliseconds: 100, commands: [{ actor: player.actor,
      source: { kind: "remote-client", client: client.id }, sequence: tick + 1,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons: 1, impulse: 0 } }] });
    expect(words.float(field("ammo_shells"))).toBeLessThan(shells);
    expect(vm.profiling[vm.program.functionNamed("W_FireShotgun").index]).toBeGreaterThan(0);
    expect(simulation.inventory.count(player.actor, "q1:ammo/shells")).toBe(words.float(field("ammo_shells")));
    const owner = simulation.actors.resolveOwned(player.actor);
    if (owner === null) throw new Error("Missing native inventory owner");
    simulation.inventory.give(owner, "q1:ammo/cells", 100);
    simulation.inventory.give(owner, "q1:ammo/rockets", 100);
    simulation.inventory.give(owner, "q1:weapon/grenadelauncher", 1);
    words.setFloat(field("health"), 10000);
    let sequence = 20;
    const advance = (buttons: number, impulse = 0) => app.session.step({ elapsedMilliseconds: 100, commands: [{ actor: player.actor,
      source: { kind: "remote-client", client: client.id }, sequence: sequence++,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse } }] });
    const cases: readonly { readonly item: ItemId; readonly bit: number; readonly ammo: "ammo_cells" | "ammo_rockets"; readonly attack: string }[] = [
      { item: "q1:weapon/hipnotic:laser", bit: 8388608, ammo: "ammo_cells", attack: "HIP_FireLaser" },
      { item: "q1:weapon/hipnotic:mjolnir", bit: 128, ammo: "ammo_cells", attack: "HIP_FireMjolnir" },
      { item: "q1:weapon/hipnotic:proximity", bit: 65536, ammo: "ammo_rockets", attack: "W_FireProximityGrenade" },
    ];
    for (const weapon of cases) {
      expect(simulation.inventory.give(owner, weapon.item, 1)).toBe(1);
      expect(Math.trunc(words.float(field("items"))) & weapon.bit).toBe(weapon.bit);
      expect(simulation.requestWeapon(player.actor, { provider: source.prepared.execution.owner.provider, item: weapon.item })).toBe(true);
      for (let tick = 0; tick < 15 && words.float(field("weapon")) !== weapon.bit; tick++) advance(0);
      expect(source.clientArsenal(player.actor).activeWeapon).toBe(weapon.item);
      const beforeAmmo = words.float(field(weapon.ammo)), attack = vm.program.functionNamed(weapon.attack).index, beforeCalls = vm.profiling[attack] ?? 0;
      const actorsBefore = simulation.actors.observations().length;
      let spawned = false;
      for (let tick = 0; tick < 12; tick++) { advance(1); spawned ||= simulation.actors.observations().length > actorsBefore; }
      expect(vm.profiling[attack]).toBeGreaterThan(beforeCalls);
      if (weapon.bit !== 128) expect(spawned).toBe(true);
      else expect(vm.profiling[vm.program.functionNamed("HIP_FireMjolnirLightning").index]).toBeGreaterThan(0);
      expect(words.float(field(weapon.ammo))).toBeLessThan(beforeAmmo);
      expect(simulation.inventory.count(player.actor, weapon.ammo === "ammo_cells" ? "q1:ammo/cells" : "q1:ammo/rockets")).toBe(words.float(field(weapon.ammo)));
      for (let tick = 0; tick < 12; tick++) advance(0);
    }
    const request = (item: ItemId) => simulation.requestWeapon(player.actor, { provider: source.prepared.execution.owner.provider, item });
    expect(request("q1:weapon/shotgun")).toBe(true); advance(0);
    expect(request("q1:weapon/hipnotic:proximity")).toBe(true); advance(0);
    expect(words.float(field("weapon"))).toBe(16); expect(words.float(field("impulse"))).toBe(6);
    advance(0, 225); advance(0);
    expect(source.clientArsenal(player.actor).activeWeapon).toBe("q1:weapon/hipnotic:laser");
    expect(words.float(field("impulse"))).toBe(0);
    expect(request("q1:weapon/shotgun")).toBe(true); advance(0);
    expect(request("q1:weapon/hipnotic:proximity")).toBe(true); advance(0);
    expect(simulation.inventory.consume(owner, "q1:weapon/hipnotic:proximity", 1)).toBe(true);
    advance(0); advance(0);
    expect(words.float(field("weapon"))).toBe(16); expect(words.float(field("impulse"))).toBe(0);
    expect(simulation.inventory.give(owner, "q1:weapon/hipnotic:proximity", 1)).toBe(1);
    expect(request("q1:weapon/hipnotic:proximity")).toBe(true); advance(0);
    expect(source.clientArsenal(player.actor).activeWeapon).toBe("q1:weapon/hipnotic:proximity");
    expect(request("q1:weapon/hipnotic:proximity")).toBe(true); advance(0);
    expect(source.clientArsenal(player.actor).activeWeapon).toBe("q1:weapon/hipnotic:proximity");
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

for (const game of ["q1-classic-hipnotic", "q1-classic-id1", "q1-quakeworld"]) test(`${game} QC disk save survives closed application and resumes the same command suffix`, async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-full-save-"));
  let application: Application | null = null;
  try {
    const launch = parseApplicationCommand(["--game", game, ...(game === "q1-quakeworld" ? ["--mode", "deathmatch"] : ["--progs", "progs.dat"]),
      "--map", game === "q1-quakeworld" ? "e1m1" : "start", "--dedicated", "--movement", "q1", "--character", "q1", "--user-content-root", root]);
    if (launch.kind !== "run") throw new Error("Missing QC save launch");
    let app = await Application.open(launch.options, { print: () => undefined }); application = app;
    const original = app.simulation.quakecSource(); if (original === null) throw new Error("Missing QC source");
    const client = app.session.createClient(0); client.connect("loopback");
    original.setClientInfo(client.id, new Map([["name", "Saved QC client"], ["team", "red"], ["noaim", "1"]]));
    if (original.kind === "quakeworld") {
      original.prepareClientSpawn(client.id);
      expect(() => original.checkpoint()).toThrow("pending client handshakes");
    }
    const admitted = app.simulation.admitPlayer(client.id), owned = app.simulation.actors.resolveOwned(admitted.actor);
    if (owned === null) throw new Error("Missing QC player");
    app.simulation.combat.setHealth(owned, 10000);
    app.simulation.inventory.give(owned, "q1:weapon/grenadelauncher", 1); app.simulation.inventory.give(owned, "q1:ammo/rockets", 100);
    const advance = (sequence: number, buttons: number, impulse = 0) => {
      const actor = app.simulation.players()[0], source = app.simulation.quakecSource();
      if (actor === undefined || source === null) throw new Error("Missing saved player/source");
      const movement = app.simulation.movementPlayer(actor); if (movement === null) throw new Error("Missing client movement");
      if (source.kind === "quakeworld") {
        app.simulation.queueQuakeWorldCommands(movement.client, [{ kind: "q1-quakeworld", milliseconds: 100, angles: { x: -15, y: 90, z: 0 },
          forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse }], sequence);
        app.session.step({ elapsedMilliseconds: 100, commands: [] });
      } else app.session.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client: movement.client }, sequence,
        command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.timeSeconds, viewAngles: { x: -15, y: 90, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse } }] });
    };
    if (original.kind === "quakeworld") {
      app.simulation.queueQuakeWorldCommands(client.id, [{ kind: "q1-quakeworld", milliseconds: 100, angles: { x: -15, y: 90, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 }], 0);
      expect(() => app.simulation.checkpoint()).toThrow("completed source commands");
      app.session.step({ elapsedMilliseconds: 100, commands: [] });
      expect(app.simulation.movementPlayer(admitted.actor)?.lastSequence).toBe(0);
      const completedActions: string[] = [];
      app.simulation.queueQuakeWorldAction(client.id, () => { original.cvars.set("sv_maxspeed", "312"); completedActions.push("speed"); });
      expect(() => app.simulation.checkpoint()).toThrow("completed source commands");
      expect(completedActions).toEqual([]);
      app.session.step({ elapsedMilliseconds: 100, commands: [] });
      expect(completedActions).toEqual(["speed"]);
      expect(original.cvars.variableValue("sv_maxspeed")).toBe(312);
    }
    advance(1, 0, 6); advance(2, 1);
    if (game === "q1-quakeworld") for (let frame = 0; frame < 12 && original.projectiles.capture().length === 0; frame++) advance(3 + frame, 1);
    expect(original.entities.count).toBeGreaterThan(original.reservedClientSlots + 1);
    if (game !== "q1-classic-hipnotic") expect(original.projectiles.capture().some(entry => app.simulation.actors.resolveSaved(entry.actor) !== null)).toBe(true);
    if (game === "q1-quakeworld") expect(original.entities.at(1).int(original.machine.fieldOffset("netname"))).toBeLessThan(0);
    if (game === "q1-classic-hipnotic") {
      app.simulation.inventory.give(owned, "q1:weapon/hipnotic:proximity", 1);
      expect(app.simulation.requestWeapon(admitted.actor, { provider: original.prepared.execution.owner.provider, item: "q1:weapon/hipnotic:proximity" })).toBe(true);
      for (let frame = 0; frame < 8; frame++) advance(10 + frame, frame === 0 ? 0 : 1);
      expect(original.machine.profiling[original.prepared.program.functionNamed("W_FireProximityGrenade").index]).toBeGreaterThan(0);
      expect(app.simulation.actors.observations().some(actor => {
        const slot = original.sourceSlot(actor.id); if (slot === null) return false;
        const words = original.entities.at(slot);
        return ["think", "touch"].some(field => /prox/i.test(original.prepared.program.functions[words.int(original.machine.fieldOffset(field))]?.name ?? ""));
      })).toBe(true);
      expect(app.simulation.requestWeapon(admitted.actor, { provider: original.prepared.execution.owner.provider, item: "q1:weapon/shotgun" })).toBe(true);
      advance(20, 0);
      expect(app.simulation.requestWeapon(admitted.actor, { provider: original.prepared.execution.owner.provider, item: "q1:weapon/hipnotic:proximity" })).toBe(true);
    }
    const path = join(root, "full.qtsave"), saved = original.machine.snapshot(), savedVisibility = original.clients.visibility.capture();
    const savedCvars = original.cvars.captureQuakeCState(), savedPrecache = original.precacheNames("model");
    await app.saveGame(path);
    for (let frame = 0; frame < 24; frame++) advance(100 + frame, frame < 5 ? 1 : 0);
    const expected = original.machine.snapshot(), expectedVisibility = original.clients.visibility.capture();
    await app.close(); application = null;
    app = await Application.open(launch.options, { print: () => undefined }); application = app;
    const freshClient = app.session.createClient(0); freshClient.connect("loopback");
    if (game === "q1-quakeworld") app.simulation.quakecSource()?.prepareClientSpawn(freshClient.id);
    app.simulation.admitPlayer(freshClient.id);
    await app.loadGame(path);
    const restored = app.simulation.quakecSource(); if (restored === null) throw new Error("QC source lost after disk restore");
    expect(restored.machine.snapshot()).toEqual(saved);
    expect(restored.clients.visibility.capture()).toEqual(savedVisibility); expect(restored.cvars.captureQuakeCState()).toEqual(savedCvars);
    expect(restored.precacheNames("model")).toEqual(savedPrecache);
    expect(restored.clientInfo(freshClient.id)).toEqual(new Map([["name", "Saved QC client"], ["team", "red"], ["noaim", "1"]]));
    expect(app.simulation.players()[0]?.equals(admitted.actor)).toBe(false);
    for (let frame = 0; frame < 24; frame++) advance(100 + frame, frame < 5 ? 1 : 0);
    expect(restored.machine.snapshot()).toEqual(expected); expect(restored.clients.visibility.capture()).toEqual(expectedVisibility);
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
