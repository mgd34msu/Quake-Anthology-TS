import { expect, test } from "bun:test";
import { ClientGameState, ClientGameStaticState } from "../../src/content/q3/presentation/state.ts";
import { ClientServerCommandRuntime } from "../../src/content/q3/presentation/server-commands.ts";

function unavailable(): never { throw new Error("Unexpected presentation service"); }
function runtimeFor(state: ClientGameState, staticState: ClientGameStaticState): ClientServerCommandRuntime {
  return new ClientServerCommandRuntime({ state, staticState,
    clients: { clientInfo: index => {
      const info = staticState.clientInfo[index]; if (info === undefined) throw new Error("Invalid client slot"); return info;
    }, newClientInfo: unavailable, loadDeferredPlayers: unavailable, reset: () => {} },
    resources: { registerModel: unavailable },
    assets: { read: unavailable, readSync: unavailable, readFileLength: unavailable, has: unavailable, list: unavailable },
    random: { random: unavailable }, resetPlayerEntity: unavailable, getServerCommand: unavailable,
    refreshGameState: () => {}, configString: () => "", readVmCvar: unavailable, setCvar: () => {}, print: unavailable, centerPrint: unavailable,
    sendConsoleCommand: unavailable, sound: unavailable, registerSound: unavailable, startLocalSound: unavailable,
    startBackgroundTrack: unavailable, remapShader: unavailable, clearLocalEntities: unavailable, clearMarks: unavailable,
    clearParticles: unavailable, clearLoopingSounds: unavailable, setScoreSelection: unavailable,
    showResponseHead: unavailable, memoryRemaining: unavailable });
}

test("a tinfo command for the full 32-player overlay fills every slot and a count above 32 is clamped", async () => {
  const state = new ClientGameState("baseq3", 0, 0), staticState = new ClientGameStaticState("baseq3"), runtime = runtimeFor(state, staticState);
  try {
    const entries: string[] = [];
    for (let slot = 0; slot < 32; slot++) entries.push(String(slot + 10), String(slot), String(100 - slot), String(slot), String(slot % 16), String(slot * 2));
    await runtime.executeCommand(["tinfo", "40", ...entries]);
    expect(state.numSortedTeamPlayers).toBe(32);
    expect(state.sortedTeamPlayers[31]).toBe(41);
    const last = staticState.clientInfo[41];
    expect(last?.health).toBe(69);
    expect(last?.curWeapon).toBe(15);
    expect(last?.powerups).toBe(62);
  } finally { runtime.dispose(); }
});

test("a tinfo entry naming a client outside the tables ends the list there", async () => {
  const state = new ClientGameState("baseq3", 0, 0), staticState = new ClientGameStaticState("baseq3"), runtime = runtimeFor(state, staticState);
  try {
    await runtime.executeCommand(["tinfo", "3", "1", "0", "50", "5", "7", "0", "99", "0", "50", "5", "7", "0", "2", "0", "50", "5", "7", "0"]);
    expect(state.numSortedTeamPlayers).toBe(1);
    expect(state.sortedTeamPlayers[0]).toBe(1);
  } finally { runtime.dispose(); }
});
