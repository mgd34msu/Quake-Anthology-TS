import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { registerQ1ClientCommands, resolveQ1HostCommandActor } from "../../../src/app/bootstrap/q1-client-commands.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";

for (const game of ["q1-classic-hipnotic", "q1-quakeworld"]) test(`${game} host cheats mutate actual VM authority and survive restore`, async () => {
  const launch = parseApplicationCommand(["--game", game, "--map", game === "q1-quakeworld" ? "e1m1" : "hip1m1", "--movement", "q1", "--character", "q1", "--dedicated",
    "--mode", "deathmatch", ...(game === "q1-quakeworld" ? [] : ["--progs", "progs.dat"])]);
  if (launch.kind !== "run") throw new Error("Missing VM launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`qc-host-${game}`);
  if (content.preparedQuakeC === null) throw new Error("Missing actual program");
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: launch.options.mode, skill: launch.options.skill, seed: 17, maxClients: 2 };
  const simulation = createSimulation(options);
  try {
    const source = simulation.quakecSource(); if (source === null) throw new Error("Missing VM source");
    const client = identity.client(0, 0), otherClient = identity.client(1, 0);
    if (source.kind === "quakeworld") { source.prepareClientSpawn(client); source.prepareClientSpawn(otherClient); }
    const actor = simulation.admitPlayer(client).actor, other = simulation.admitPlayer(otherClient).actor;
    const slot = source.sourceSlot(actor), otherSlot = source.sourceSlot(other);
    if (slot === null || otherSlot === null) throw new Error("Missing admitted VM actor slots");
    const vm = source.machine, words = source.entities.at(slot), otherWords = source.entities.at(otherSlot), field = (name: string) => vm.fieldOffset(name);
    const dialect = source.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake";
    const commands = new CommandBuffer({ dialect, context: { session: identity.session, origin: { kind: "remote-client", client } } });
    const players = [{ actor, client }, { actor: other, client: otherClient }];
    registerQ1ClientCommands(commands, dialect, (name, args, _seat, context) => simulation.playerCommand(
      resolveQ1HostCommandActor(name, args, context, players, () => { throw new Error("No local player in dedicated fixture"); }), name, []));
    const run = (text: string) => { commands.append(`${text}\n`); commands.execute(); };
    const flags = words.float(field("flags")), move = words.float(field("movetype"));
    run("god; notarget; noclip; fly");
    expect(words.float(field("flags"))).toBe(flags); expect(words.float(field("movetype"))).toBe(move);
    if (source.kind === "quakeworld") source.cvars.set("sv_cheats", "1");
    else vm.globals.setFloat(vm.globalOffset("deathmatch"), 0);
    const otherFlags = otherWords.float(field("flags"));
    words.setFloat(field("health"), 100); words.setFloat(field("armorvalue"), 0); words.setFloat(field("armortype"), 0);
    const damage = () => {
      vm.globals.setInt(4, source.entities.reference(slot)); vm.globals.setInt(7, 0); vm.globals.setInt(10, 0); vm.globals.setFloat(13, 20);
      vm.execute(vm.program.functionNamed("T_Damage").index, 4);
    };
    run("god"); damage(); expect(words.float(field("health"))).toBe(100);
    run("god"); damage(); expect(words.float(field("health"))).toBe(80);
    run("god; notarget; noclip");
    expect(Math.trunc(words.float(field("flags"))) & (64 | 128)).toBe(64 | 128);
    expect(source.clients.visibility.services.client(slot).notarget).toBe(true);
    if (source.kind === "netquake") {
      vm.globals.setInt(vm.globalOffset("self"), source.entities.reference(otherSlot));
      vm.globals.setInt(vm.globalOffset("sight_entity"), source.entities.reference(slot));
      vm.globals.setFloat(vm.globalOffset("sight_entity_time"), source.timeSeconds);
      otherWords.setInt(field("enemy"), 0); words.setInt(field("enemy"), source.entities.reference(otherSlot));
      vm.execute(vm.program.functionNamed("FindTarget").index);
      expect(vm.globals.float(1)).toBe(0);
      expect(otherWords.int(field("enemy"))).toBe(0);
      words.setInt(field("enemy"), 0);
    }
    expect(otherWords.float(field("flags"))).toBe(otherFlags);
    expect(words.float(field("movetype"))).toBe(8);
    run("fly");
    expect(simulation.movementPlayer(actor)?.flight).toBe(true);
    expect(words.float(field("movetype"))).toBe(5);
    const origin = words.vector(field("origin"));
    simulation.step({ elapsedMilliseconds: 50, commands: [{ actor, source: { kind: "remote-client", client }, sequence: 0,
      command: source.kind === "quakeworld" ? { kind: "q1-quakeworld", milliseconds: 50, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 320, buttons: 0, impulse: 0 }
        : { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 320, buttons: 0, impulse: 0 } }] });
    expect(words.vector(field("origin")).z).toBeGreaterThan(origin.z);
    expect(words.float(field("movetype"))).toBe(5);
    const image = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client, otherClient] });
    try {
      const next = restored.quakecSource(); if (next === null) throw new Error("Lost saved VM");
      const savedWords = next.entities.at(slot);
      expect(Math.trunc(savedWords.float(next.machine.fieldOffset("flags"))) & (64 | 128)).toBe(64 | 128);
      expect(savedWords.float(next.machine.fieldOffset("movetype"))).toBe(5);
      const restoredActor = restored.players()[0];
      if (restoredActor === undefined) throw new Error("Missing restored flying player");
      expect(restored.movementPlayer(restoredActor)?.flight).toBe(true);
      expect(next.cvars.variableValue("sv_cheats")).toBe(source.cvars.variableValue("sv_cheats"));
    } finally { restored.close(); }
    run("fly; notarget; god");
    expect(words.float(field("movetype"))).toBe(3);
    expect(Math.trunc(words.float(field("flags"))) & (64 | 128)).toBe(0);
    expect(source.clients.visibility.services.client(slot).notarget).toBe(false);
  } finally { simulation.close(); await content.close(); }
}, 30000);
