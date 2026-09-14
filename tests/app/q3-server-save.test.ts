import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { Q3ServerState } from "../../src/app/bootstrap/simulation/q3/server-state.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";

function server(name: string) {
  return new Q3ServerState({ session: createIdentityOwner(name).session,
    settings: { gameType: 0, singlePlayer: true, maxClients: 4, mapName: "q3dm1" }, now: () => 0, print: () => {} });
}
function persisted(value: unknown): unknown { return decodeCheckpointValue(encodeCheckpointValue(value)); }

test("fresh Q3 server restores complete storage and preserves cvar registry identity", () => {
  const source = server("source"), restored = server("restored");
  source.cvars.register("save_latched", "2", CvarFlag.Latch);
  source.cvars.set("save_latched", "3");
  source.cvars.set("g_gravity", "777.5", true);
  source.configstrings.set(12, "");
  source.configstrings.set(33, "models/powerups/health/mega.md3");
  source.setUserinfo(3, "\\name\\checkpoint");
  source.setUserCommand(3, { serverTime: 31337, angles: [1, 65535, -10], forwardmove: -127, rightmove: 37, upmove: 0, buttons: 17, weapon: 5 });
  const registry = restored.cvars;
  restored.restoreSaveState(persisted(source.captureSaveState()));
  expect(restored.cvars).toBe(registry);
  expect(restored.captureSaveState()).toEqual(source.captureSaveState());
  expect(restored.hasConfigstring(12)).toBe(true);
  expect(restored.hasConfigstring(13)).toBe(false);
  expect(restored.cvars.get("SAVE_LATCHED")?.latchedValue).toBe("3");
  expect(restored.cvars.variableValue("g_gravity")).toBe(777.5);
  restored.clearClient(3);
  expect(restored.getUserinfo(3)).toBeUndefined();
  expect(restored.getUserCommand(3)).toBeUndefined();
  expect(source.getUserinfo(3)).toBe("\\name\\checkpoint");
});

test("invalid Q3 host and cvar records leave existing storage unchanged", () => {
  const source = server("validation");
  source.configstrings.set(10, "retained");
  const before = source.captureSaveState();
  expect(() => source.restoreSaveState({ ...before, configstrings: [{ slot: 1024, value: "bad" }] })).toThrow();
  expect(source.captureSaveState()).toEqual(before);
  const cvars = before.cvars;
  expect(() => source.restoreSaveState({ ...before, cvars: { ...cvars, order: ["missing"] } })).toThrow();
  expect(source.captureSaveState()).toEqual(before);
  const wrong = new CvarRegistry({ dialect: "q1-netquake", context: { session: createIdentityOwner("wrong").session, origin: { kind: "server-console" } } });
  expect(() => source.restoreSaveState({ ...before, cvars: wrong.captureSaveState() })).toThrow();
  expect(source.captureSaveState()).toEqual(before);
});
