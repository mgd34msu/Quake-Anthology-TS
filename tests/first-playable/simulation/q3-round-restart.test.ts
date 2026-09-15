import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";

test("Q3 rounds retain shared services and retire actors and listeners", async () => {
 const launch = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
 if (launch.kind !== "run") throw new Error("Missing launch");
 const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("q3-round"), client = identity.client(0, 0);
 const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 1, maxClients: 1 });
 try {
  let player = simulation.admitPlayer(client).actor;
  simulation.step({ elapsedMilliseconds: 500, commands: [] });
  const scene = simulation.scene, clock = simulation.clock, registry = simulation.actors, first = simulation.q3Source();
  if (first === null) throw new Error("Missing source");
  const cvars = first.host.cvars; cvars.set("g_restarted", "1", true); cvars.set("g_speed", "450", true);
  let subscriptions = 0, unsubscriptions = 0, retiredCalls = 0;
  const observe = registry.onRelease.bind(registry);
  const observation = spyOn(registry, "onRelease").mockImplementation(callback => {
   subscriptions++; let done = false; const release = observe(actor => { if (done) retiredCalls++; return callback(actor); });
   return () => { if (!done) { done = true; unsubscriptions++; } return release(); };
  });
  try {
   for (let index = 0; index < 3; index++) {
    const old = simulation.q3Source(), oldPlayer = player, reconnect = simulation.restartSourceRound();
    expect(reconnect).toEqual([client]);
    const admitted = reconnect.map(client => simulation.admitPlayer(client))[0];
    if (admitted === undefined) throw new Error("Missing reconnected client");
    player = admitted.actor;
    expect(simulation.q3Source()).not.toBe(old); expect(registry.isLive(oldPlayer)).toBe(false); expect(registry.isLive(player)).toBe(true);
    expect(simulation.clientIdentities()).toEqual([client]); expect(simulation.scene).toBe(scene); expect(simulation.clock).toBe(clock); expect(simulation.actors).toBe(registry);
    expect(simulation.timeSeconds).toBe(0.5); expect(simulation.q3Source()?.host.cvars).toBe(cvars); expect(cvars.variableValue("g_speed")).toBe(450);
    expect(subscriptions - unsubscriptions).toBe(3); expect(retiredCalls).toBe(0);
   }
   simulation.drainPresentationEvents();
   const restored = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "deathmatch", seed: 1, maxClients: 1, restore: simulation.checkpoint(), restoredClients: [client] });
   try {
    expect(restored.sourceRestartPlan()).toEqual({ kind: "source-reset" });
    expect(restored.restartSourceRound()).toEqual([client]);
    expect(restored.actors.isLive(restored.admitPlayer(client).actor)).toBe(true);
    expect(restored.timeSeconds).toBe(0.5);
    expect(restored.q3Source()?.host.cvars.variableValue("g_speed")).toBe(450);
   } finally { restored.close(); }
   const active = simulation.q3Source(); cvars.set("sv_maxclients", "2", true);
   expect(() => simulation.restartSourceRound()).toThrow("client-capacity-changed"); expect(simulation.q3Source()).toBe(active); expect(registry.isLive(player)).toBe(true);
   cvars.set("sv_maxclients", "1", true); cvars.clearModified("sv_maxclients"); cvars.set("g_gametype", "4", true);
   expect(() => simulation.restartSourceRound()).toThrow("game-type-changed"); expect(registry.isLive(player)).toBe(true);
   cvars.set("g_gametype", "0", true); simulation.close(); expect(subscriptions).toBe(unsubscriptions);
  } finally { observation.mockRestore(); }
 } finally { simulation.close(); await content.close(); }
});

for (const mixed of [false, true]) test(`Q3 restart eligibility preserves ${mixed ? "foreign arsenal" : "native"} selection`, async () => {
 const launch = parseApplicationCommand(["--game", mixed ? "q3-baseq3" : "q3-missionpack", "--map", mixed ? "q3dm1" : "mpteam1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
 if (launch.kind !== "run") throw new Error("Missing launch");
 const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
 const preset = applicationPreset(catalog, launch.options), choice = presetChoice(preset.id);
 const recipe = await resolveLaunch({ catalog, preset, choice: mixed ? { ...choice, weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require("q1-classic-id1").id }] } } : choice });
 const content = await loadApplicationContent(launch.options, recipe);
 const simulation = createSimulation({ identity: createIdentityOwner("ta-restart-plan"), recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 1, maxClients: 6 });
 try {
  const before = simulation.q3Source();
  expect(simulation.sourceRestartPlan().kind).toBe(mixed ? "replace-world" : "source-reset");
  if (mixed) {
   expect(() => simulation.restartSourceRound()).toThrow("adjunct providers");
   expect(simulation.q3Source()).toBe(before); expect(simulation.recipe).toBe(recipe);
  }
 } finally { simulation.close(); await content.close(); }
});

test("console latched restart requests and change-back survive save restore and force full replacement", async () => {
 const launch = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
 if (launch.kind !== "run") throw new Error("Missing launch");
 const content = await loadApplicationContent(launch.options);
 try {
  for (const [name, requested, original, reason] of [["sv_maxclients", "2", "1", "client-capacity-changed"], ["g_gametype", "4", "0", "game-type-changed"]]) {
   if (name === undefined || requested === undefined || original === undefined || reason === undefined) throw new Error("Missing case");
   const identity = createIdentityOwner("latched-" + name), client = identity.client(0, 0);
   const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 1, maxClients: 1 };
   const simulation = createSimulation(options);
   try {
    const player = simulation.admitPlayer(client).actor, source = simulation.q3Source();
    if (source === null) throw new Error("Missing source");
    simulation.step({ elapsedMilliseconds: 250, commands: [] });
    const cvars = source.host.cvars, commands = new CommandBuffer({ dialect: "q3", context: cvars.context, cvars });
    expect(simulation.sourceRestartPlan()).toEqual({ kind: "source-reset" });
    commands.executeNow(`set ${name} ${requested}`);
    expect(cvars.variableString(name)).toBe(original); expect(cvars.find(name)?.latchedValue).toBe(requested);
    expect(simulation.sourceRestartPlan()).toEqual({ kind: "replace-world", reason });
    commands.executeNow(`set ${name} ${original}`);
    expect(cvars.find(name)?.modified).toBe(true); expect(cvars.find(name)?.latchedValue).toBe(requested);
    const before = cvars.captureSaveState();
    expect(() => simulation.restartSourceRound()).toThrow(reason);
    expect(cvars.captureSaveState()).toEqual(before); expect(simulation.actors.isLive(player)).toBe(true);
    simulation.drainPresentationEvents();
    const restored = createSimulation({ ...options, restore: simulation.checkpoint(), restoredClients: [client] });
    try {
     expect(restored.timeSeconds).toBe(0.25); expect(restored.sourceRestartPlan()).toEqual({ kind: "replace-world", reason });
     expect(restored.q3Source()?.host.cvars.find(name)?.latchedValue).toBe(requested);
    } finally { restored.close(); }
   } finally { simulation.close(); }
  }
 } finally { await content.close(); }
});
