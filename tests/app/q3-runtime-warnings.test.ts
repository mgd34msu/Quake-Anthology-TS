import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag } from "../../src/core/cvars/index.ts";
import { infoValueForKey } from "../../src/core/info-string.ts";
import { Q3ServerState } from "../../src/app/bootstrap/simulation/q3/server-state.ts";
import { ClientGameState, ClientGameStaticState } from "../../src/content/q3/presentation/state.ts";
import { ClientServerCommandRuntime } from "../../src/content/q3/presentation/server-commands.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../src/app/bootstrap/simulation/runtime.ts";
import { loadMountedBotAssetFiles } from "../../src/bots/behavior/index.ts";
import { BotLibrary } from "../../src/bots/behavior/q3/library.ts";
import { q3BotGame } from "../../src/bots/behavior/q3/source-game.ts";
import { WeaponLoadResult } from "../../src/bots/behavior/library/weapons.ts";

function unavailable(): never { throw new Error("Unexpected presentation service"); }
function server() {
  return new Q3ServerState({ session: createIdentityOwner("serverinfo-proof").session,
    settings: { gameType: 0, singlePlayer: false, maxClients: 4, mapName: "q3dm1" }, now: () => 0, print: unavailable });
}

test("canonical Q3 serverinfo reaches the real cgame parser without a network host", async () => {
  const source = server(), state = new ClientGameState("baseq3", 0, 0), staticState = new ClientGameStaticState("baseq3");
  const runtime = new ClientServerCommandRuntime({ state, staticState,
    clients: { clientInfo: index => {
      const info = staticState.clientInfo[index]; if (info === undefined) throw new Error("Invalid client slot"); return info;
    }, newClientInfo: unavailable, loadDeferredPlayers: unavailable, reset: () => {} },
    resources: { registerModel: unavailable },
    assets: { read: unavailable, readSync: unavailable, readFileLength: unavailable, has: unavailable, list: unavailable },
    random: { random: unavailable }, resetPlayerEntity: unavailable, getServerCommand: unavailable,
    refreshGameState: () => {}, configString: index => source.configstrings.get(index),
    readVmCvar: unavailable, setCvar: () => {}, print: unavailable, centerPrint: unavailable,
    sendConsoleCommand: unavailable, sound: unavailable, registerSound: unavailable, startLocalSound: unavailable,
    startBackgroundTrack: unavailable, remapShader: unavailable, clearLocalEntities: unavailable, clearMarks: unavailable,
    clearParticles: unavailable, clearLoopingSounds: unavailable, setScoreSelection: unavailable,
    showResponseHead: unavailable, memoryRemaining: unavailable });
  try {
    expect(source.cvars.get("sv_maxclients")?.flags).toBe(CvarFlag.ServerInfo | CvarFlag.Latch);
    runtime.parseServerInfo();
    expect(staticState.maxclients).toBe(4);
    expect(staticState.mapname).toBe("maps/q3dm1.bsp");
    expect(source.refreshServerInfo()).toBeNull();
    source.cvars.register("fraglimit", "20", CvarFlag.ServerInfo);
    const published = source.refreshServerInfo();
    expect(published).toBe(source.configstrings.get(0));
    expect(published).not.toBeNull();
    await runtime.executeCommand(["cs", "0"]);
    expect(staticState.fraglimit).toBe(20);
    expect(staticState.maxclients).toBe(4);
    expect(source.refreshServerInfo()).toBeNull();
  } finally { runtime.dispose(); }
});

test("serverinfo capture and restore preserve pending metadata and exact cvar storage", () => {
  const source = server();
  source.cvars.register("fraglimit", "20", CvarFlag.ServerInfo);
  const storedInfo = source.configstrings.get(0), saved = source.captureSaveState();
  expect(source.captureSaveState()).toEqual(saved);
  expect(source.configstrings.get(0)).toBe(storedInfo);
  const restored = server();
  restored.restoreSaveState(decodeCheckpointValue(encodeCheckpointValue(saved)));
  expect(restored.captureSaveState()).toEqual(saved);
  expect(restored.configstrings.get(0)).toBe(storedInfo);
  expect(restored.refreshServerInfo()).toBe(source.refreshServerInfo());
  expect(restored.captureSaveState()).toEqual(source.captureSaveState());
});

const corpus = resolve(import.meta.dir, "../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")))("actual Q3 source arsenal refresh never asks botlib for WP_NONE", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q3 runtime options");
  const content = await loadApplicationContent(launch.options);
  let simulation: SharedSimulation | null = null, library: BotLibrary | null = null;
  try {
    simulation = new SharedSimulation({ identity: createIdentityOwner("arsenal-warning-proof"), recipe: content.recipe,
      world: content.world, mounts: content.mounts, mode: "deathmatch", skill: 3, seed: 7, maxClients: 4, dedicated: true });
    const source = simulation.q3Source();
    if (source === null) throw new Error("Missing actual Q3 source runtime");
    const initial = source.sourceState().configstrings.find(entry => entry.index === 0)?.value ?? "";
    expect(infoValueForKey(initial, "sv_maxclients")).toBe("4");
    expect(infoValueForKey(initial, "g_gametype")).toBe("0");
    simulation.drainPresentationEvents();
    source.host.cvars.set("fraglimit", "23", true);
    source.endFrame();
    const updates = simulation.drainPresentationEvents().filter(event => event.kind === "q3-source" && event.event.kind === "configstring" && event.event.index === 0);
    expect(updates).toHaveLength(1);
    expect(infoValueForKey(source.host.configstrings.get(0), "fraglimit")).toBe("23");
    source.endFrame();
    expect(simulation.drainPresentationEvents().filter(event => event.kind === "q3-source" && event.event.kind === "configstring" && event.event.index === 0)).toHaveLength(0);
    const files = await loadMountedBotAssetFiles(await content.forContent(content.recipe.map.entities.content), content.catalog);
    const diagnostics: string[] = [];
    library = new BotLibrary({ files, random: { nextInt: () => 0 }, debug: false, milliseconds: () => 0,
      print: (_severity, text) => { diagnostics.push(text); return undefined; }, clientCommand: () => undefined, openLog: unavailable });
    expect(library.weapons.setup()).toBe(WeaponLoadResult.NoError);
    const handle = library.weapons.allocateState(), knowledge = q3BotGame(source, unavailable).knowledge;
    diagnostics.length = 0;
    for (let refresh = 0; refresh < 4; refresh++) {
      expect(knowledge.weaponInfo(library, handle, 1)?.name).toBe("Gauntlet");
      expect(knowledge.weaponInfo(library, handle, 5)?.name).toBe("Rocket Launcher");
    }
    expect(diagnostics).toEqual([]);
    expect(library.weapons.getWeaponInfo(handle, 0)).toBeUndefined();
    expect(diagnostics).toContain("weapon number out of range");
  } finally { library?.shutdown(); simulation?.close(); await content.close(); }
}, 30000);
