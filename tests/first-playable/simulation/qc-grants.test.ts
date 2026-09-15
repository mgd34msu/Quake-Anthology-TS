import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { registerQ1ClientCommands } from "../../../src/app/bootstrap/q1-client-commands.ts";

for (const game of ["q1-classic-hipnotic", "q1-quakeworld"]) test(`${game} give changes the admitted VM player's source fields`, async () => {
  const launch = parseApplicationCommand(["--game", game, "--map", game === "q1-quakeworld" ? "e1m1" : "hip1m1", "--movement", "q1", "--character", "q1", "--dedicated",
    "--mode", "deathmatch", ...(game === "q1-quakeworld" ? [] : ["--progs", "progs.dat"])]);
  if (launch.kind !== "run") throw new Error("Missing VM launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`qc-give-${game}`);
  if (content.preparedQuakeC === null) throw new Error("Missing actual program");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: launch.options.mode, skill: 1, seed: 17, maxClients: 2 });
  try {
    const source = simulation.quakecSource(); if (source === null) throw new Error("Missing VM source");
    const client = identity.client(0, 0), otherClient = identity.client(1, 0);
    if (source.kind === "quakeworld") { source.prepareClientSpawn(client); source.prepareClientSpawn(otherClient); }
    const actor = simulation.admitPlayer(client).actor, other = simulation.admitPlayer(otherClient).actor;
    const slot = source.sourceSlot(actor), otherSlot = source.sourceSlot(other);
    if (slot === null || otherSlot === null) throw new Error("Missing VM client slots");
    const vm = source.machine, words = source.entities.at(slot), otherWords = source.entities.at(otherSlot), field = (name: string) => vm.fieldOffset(name);
    const commands = new CommandBuffer({ dialect: source.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake",
      context: { session: identity.session, origin: { kind: "remote-client", client } } });
    registerQ1ClientCommands(commands, commands.dialect, (name, args) => simulation.playerCommand(actor, name, args));
    const run = (text: string) => { commands.append(`${text}\n`); commands.execute(); };
    const initial = words.float(field("items")), otherItems = otherWords.float(field("items"));
    run("giveall"); expect(words.float(field("items"))).toBe(initial);
    if (source.kind === "quakeworld") source.cvars.set("sv_cheats", "1");
    else vm.globals.setFloat(vm.globalOffset("deathmatch"), 0);
    run("giveall"); expect(Math.trunc(words.float(field("items"))) & 64).toBe(64);
    expect(words.float(field("ammo_rockets"))).toBe(100); expect(words.float(field("armorvalue"))).toBe(200);
    run("give r 17; give h 61; give a 120");
    expect(words.float(field("ammo_rockets"))).toBe(17); expect(words.float(field("health"))).toBe(61);
    expect(words.float(field("armorvalue"))).toBe(120); expect(words.float(field("armortype"))).toBeCloseTo(0.6);
    if (source.kind === "netquake") { run("give 6a"); expect(Math.trunc(words.float(field("items"))) & (1 << 16)).not.toBe(0); }
    if (source.kind === "netquake") {
      const powerups = [
        { classname: "item_artifact_super_damage", timer: "super_damage_finished" },
        { classname: "item_artifact_invulnerability", timer: "invincible_finished" },
        { classname: "item_artifact_invisibility", timer: "invisible_finished" },
        { classname: "item_artifact_envirosuit", timer: "radsuit_finished" },
      ];
      const template = Array.from({ length: source.entities.count }, (_, index) => source.entities.at(index))
        .map(item => ({ item, definition: powerups.find(powerup => powerup.classname === vm.strings.get(item.int(field("classname")))) }))
        .find(entry => entry.definition !== undefined && entry.item.int(field("touch")) !== 0);
      if (template?.definition === undefined) throw new Error("Hipnotic map has no powerup template");
      const original = template.item.bytes.slice();
      run(`give ${template.definition.classname}`);
      expect(words.float(field(template.definition.timer))).toBeGreaterThan(source.timeSeconds);
      expect(template.item.bytes).toEqual(original);
    }
    expect(otherWords.float(field("items"))).toBe(otherItems);
  } finally { simulation.close(); await content.close(); }
}, 30000);
