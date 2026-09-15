import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { registerQ1ClientCommands } from "../../../src/app/bootstrap/q1-client-commands.ts";
import { EngineSession } from "../../../src/world/session/session.ts";
import { createQ1ApplicationServerHost } from "../../../src/app/bootstrap/simulation/network-q1.ts";

const cases: readonly { readonly game: string; readonly map: string; readonly foreign: boolean }[] = [
  { game: "q1-classic-id1", map: "e1m1", foreign: false },
  { game: "q1-classic-hipnotic", map: "hip1m1", foreign: false },
  { game: "q1-classic-rogue", map: "r1m1", foreign: true },
  { game: "q2-classic-baseq2", map: "base1", foreign: true },
  { game: "q2-rerelease-baseq2", map: "base1", foreign: true },
];
for (const scenario of cases) test(`${scenario.game} giveall updates the chosen arsenal and named grants`, async () => {
  const corpus = resolve(import.meta.dir, "../../../../qfiles");
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", scenario.game, "--map", scenario.map, "--movement", "q1", "--character", "q1", "--dedicated", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Missing grant launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), ...(scenario.foreign ? {
    weapons: { kind: "selected", value: [{ provider: "q3:official", content: catalog.require("q3-baseq3").id }] },
  } : {}) } });
  const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`give-${scenario.game}`), client = identity.client(0, 0);
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1, playerIdentity: value => ({ seat: value.slot, socialId: "" }) });
  try {
    const actor = simulation.admitPlayer(client).actor, owned = simulation.actors.resolveOwned(actor);
    if (owned === null) throw new Error("Missing grant actor");
    const source = simulation.q1Source(), dialect = source?.cvars.dialect ?? (scenario.game.includes("rerelease") ? "q2-rerelease" : "q2-classic");
    const commands = new CommandBuffer({ dialect, context: { session: identity.session, origin: { kind: "remote-client", client } } });
    registerQ1ClientCommands(commands, dialect, (name, args) => simulation.playerCommand(actor, name, args));
    const run = (text: string) => { commands.append(`${text}\n`); commands.execute(); };
    simulation.combat.setHealth(owned, 25);
    const nativeRocket = scenario.game.startsWith("q1") ? "q1:weapon/rocketlauncher" : "q2:weapon_rocketlauncher";
    const beforeNative = simulation.inventory.count(actor, nativeRocket);
    run("giveall");
    expect(simulation.combat.read(actor)?.health).toBeGreaterThanOrEqual(100);
    expect(simulation.combat.read(actor)?.armor.kind).not.toBe("none");
    const rocket = scenario.foreign ? "q3:weapon/rocketlauncher" : nativeRocket;
    const ammo = scenario.foreign ? "q3:ammo/rocketlauncher" : "q1:ammo/rockets";
    expect(simulation.inventory.count(actor, rocket)).toBe(1); expect(simulation.inventory.count(actor, ammo)).toBeGreaterThan(0);
    if (scenario.foreign) expect(simulation.inventory.count(actor, nativeRocket)).toBe(beforeNative);
    run(`give "${ammo}" 17`); expect(simulation.inventory.count(actor, ammo)).toBe(17);
    if (scenario.foreign && scenario.game.startsWith("q2")) {
      const entry = simulation.inventory.entries(actor).find(entry => entry.item === rocket);
      if (entry === undefined) throw new Error("Missing chosen rocket entry");
      simulation.inventory.configure(owned, { ...entry, count: 0 });
      run("give Rocket Launcher"); expect(simulation.inventory.count(actor, rocket)).toBe(1);
      run("give Rockets 9"); expect(simulation.inventory.count(actor, ammo)).toBe(9);
      expect(simulation.inventory.count(actor, nativeRocket)).toBe(beforeNative);
    }
    run("give health 61"); expect(simulation.combat.read(actor)?.health).toBe(61);
    if (source !== null) {
      run("give armor 120"); expect(simulation.combat.read(actor)?.armor).toMatchObject({ points: 120, absorption: 0.6 });
      if (!scenario.foreign) {
        run("give quad"); expect((source.game.player(actor)?.powerups.get("quad") ?? 0)).toBeGreaterThan(source.game.time);
        if (scenario.game.includes("hipnotic")) { run("give 6a"); expect(simulation.inventory.count(actor, "q1:weapon/hipnotic:proximity")).toBe(1); }
      }
    }
    run("god");
    const arsenal = simulation.movementPlayer(actor)?.arsenal;
    if (arsenal === undefined) throw new Error("Missing actual arsenal");
    expect(simulation.requestWeapon(actor, { provider: arsenal.provider, item: rocket })).toBe(true);
    const ammunition = simulation.inventory.count(actor, ammo);
    for (let tick = 0; tick < 16; tick++) simulation.step({ elapsedMilliseconds: 100, commands: [{ actor,
      source: { kind: "remote-client", client }, sequence: tick,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons: tick === 0 ? 0 : 1, impulse: 0 } }] });
    expect(simulation.playerUi(actor).activeWeapon).toBe(rocket);
    expect(simulation.inventory.count(actor, ammo)).toBeLessThan(ammunition);
  } finally { simulation.close(); await content.close(); }
}, 30000);

test("authenticated NetQuake host commands affect only the admitted actor", async () => {
  const launch = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--dedicated", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Missing network fixture launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("give-wire");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 2 });
  const session = new EngineSession(identity, { kind: "headless" }); session.attachWorld(simulation);
  try {
    const host = await createQ1ApplicationServerHost({ session, simulation, content, protocol: { kind: "q1-netquake", version: 15 }, print: () => undefined });
    const first = host.admit({ kind: "loopback", id: "first" }), second = host.admit({ kind: "loopback", id: "second" });
    if (first.kind !== "accepted" || second.kind !== "accepted") throw new Error("Missing authenticated clients");
    host.command(first.player, "give", ["all"]);
    expect(simulation.inventory.count(first.player.actor, "q1:weapon/rocketlauncher")).toBe(1);
    expect(simulation.inventory.count(second.player.actor, "q1:weapon/rocketlauncher")).toBe(0);
    host.command(first.player, "god", [String(second.player.client.slot)]);
    expect(simulation.combat.read(first.player.actor)?.invulnerable).toBe(true);
    expect(simulation.combat.read(second.player.actor)?.invulnerable).toBe(false);
    host.command(first.player, "give", ["h", "43"]);
    expect(simulation.combat.read(first.player.actor)?.health).toBe(43);
    expect(simulation.combat.read(second.player.actor)?.health).toBe(100);
  } finally { session.close(); await content.close(); }
}, 30000);

for (const foreign of [false, true]) test(`Q3 give respects source gates and ${foreign ? "selected Q2" : "native"} inventory`, async () => {
  const launch = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Missing Q3 grant launch");
  const catalog = await discoverInstalledContent({ corpusRoot: launch.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), ...(foreign ? {
    weapons: { kind: "selected", value: [{ provider: "q2:official", content: catalog.require("q2-classic-baseq2").id }] },
  } : {}) } });
  const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`q3-give-${foreign}`), client = identity.client(0, 0);
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 1, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(client).actor, source = simulation.q3Source(); if (source === null) throw new Error("Missing Q3 source");
    const rocket = foreign ? "q2:weapon_rocketlauncher" : "q3:weapon/rocketlauncher", ammo = foreign ? "q2:ammo_rockets" : "q3:ammo/rocketlauncher";
    simulation.playerCommand(actor, "giveall", []); expect(simulation.inventory.count(actor, rocket)).toBe(0);
    source.host.cvars.set("sv_cheats", "1", true);
    simulation.step({ elapsedMilliseconds: 1, commands: [] });
    simulation.playerCommand(actor, "giveall", []);
    expect(simulation.inventory.count(actor, rocket)).toBe(1); expect(simulation.inventory.count(actor, ammo)).toBeGreaterThan(0);
    if (foreign) {
      expect(simulation.inventory.count(actor, "q3:weapon/rocketlauncher")).toBe(0);
      simulation.playerCommand(actor, "give", ["q2:weapon_railgun"]); expect(simulation.inventory.count(actor, "q2:weapon_railgun")).toBe(1);
      simulation.playerCommand(actor, "give", ["Rocket Launcher"]); expect(simulation.inventory.count(actor, rocket)).toBe(2);
    } else expect(simulation.inventory.count(actor, ammo)).toBe(999);
    expect(simulation.combat.read(actor)?.armor).toMatchObject({ points: 200 });
  } finally { simulation.close(); await content.close(); }
}, 30000);
