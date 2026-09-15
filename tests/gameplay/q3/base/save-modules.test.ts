import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { expect, test } from "bun:test";
import { GameMemory } from "../../../../src/content/q3/base/game/memory.ts";
import { ShaderRemapRegistry } from "../../../../src/content/q3/base/game/shader-remaps.ts";
import { ItemRegistry } from "../../../../src/content/q3/base/game/item-lifecycle.ts";
import { Q3GameSettings } from "../../../../src/content/q3/base/settings.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../../src/persistence/value.ts";
import { findItemForWeapon } from "../../../../src/content/q3/base/shared/items.ts";
import { Weapon } from "../../../../src/content/q3/base/shared/definitions.ts";

function persisted(value: unknown): unknown { return decodeCheckpointValue(encodeCheckpointValue(value)); }

test("module memory restores allocation position and retained source bytes", () => {
  const memory = new GameMemory(() => 0, () => {});
  memory.allocate(16).writeString("retained");
  const saved = persisted(memory.captureSaveState());
  memory.initialize();
  memory.allocate(16).writeString("changed");
  memory.restoreSaveState(saved);
  expect(memory.allocatedBytes).toBe(32);
  memory.initialize();
  expect(memory.allocate(16).readString()).toBe("retained");
  const before = memory.captureSaveState();
  expect(() => memory.restoreSaveState({ pool: new Uint8Array(2), allocPoint: 32 })).toThrow();
  expect(memory.captureSaveState()).toEqual(before);
});

test("registered items and shader remaps survive fresh module reconstruction", () => {
  const items = new ItemRegistry("missionpack"), restored = new ItemRegistry("missionpack");
  const weapon = findItemForWeapon("missionpack", Weapon.WP_PROX_LAUNCHER);
  items.register(weapon);
  restored.restoreSaveState(persisted(items.captureSaveState()));
  expect(restored.isRegistered(weapon)).toBe(true);
  const remaps = new ShaderRemapRegistry(() => {}), next = new ShaderRemapRegistry(() => {});
  remaps.add("textures/base", "textures/changed", 1.25);
  next.restoreSaveState(persisted(remaps.captureSaveState()));
  expect(next.buildShaderStateConfig()).toBe(remaps.buildShaderStateConfig());
  next.add("TEXTURES/BASE", "textures/latest", 2.5);
  expect(next.captureSaveState()).toEqual([{ oldName: "textures/base", newName: "textures/latest", timeOffset: 2.5 }]);
});

test("cached game settings retain their source update boundary", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("q3-settings-save").session, origin: { kind: "server-console" } } });
  const settings = new Q3GameSettings({ cvars, sendServerCommand: () => {}, remapTeams: () => {} }, "baseq3");
  settings.register("test");
  const before = settings.integer("g_speed");
  cvars.set("g_speed", "777", true);
  const restored = new Q3GameSettings({ cvars, sendServerCommand: () => {}, remapTeams: () => {} }, "baseq3");
  restored.restoreSaveState(persisted(settings.captureSaveState()));
  expect(restored.integer("g_speed")).toBe(before);
  expect(() => restored.restoreSaveState([])).toThrow();
  expect(restored.integer("g_speed")).toBe(before);
  restored.update();
  expect(restored.integer("g_speed")).toBe(777);
});

test("missionpack settings restore cvar identities first registered by the skirmish UI", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("missionpack-settings-save").session, origin: { kind: "server-console" } } });
  cvars.set("g_redTeam", "Pagans", true);
  cvars.set("g_blueTeam", "Stroggs", true);
  const host = { cvars, sendServerCommand: () => {}, remapTeams: () => {} };
  const settings = new Q3GameSettings(host, "missionpack");
  settings.register("test");
  const captured = settings.captureSaveState();
  expect(captured.find(snapshot => snapshot.name === "g_redTeam")?.value).toBe("Pagans");
  cvars.set("g_redTeam", "Changed after capture", true);
  const restored = new Q3GameSettings(host, "missionpack");
  restored.restoreSaveState(persisted(captured));
  expect(restored.captureSaveState()).toEqual(captured);
  expect(restored.string("g_redteam")).toBe("Pagans");
  expect(restored.string("g_blueteam")).toBe("Stroggs");
  for (const invalid of [
    captured.slice(1),
    captured.map(snapshot => snapshot.name === "g_blueTeam" ? { ...snapshot, name: "G_REDTEAM" } : snapshot),
    captured.map(snapshot => snapshot.name === "g_blueTeam" ? { ...snapshot, name: "unknown_setting" } : snapshot),
  ]) {
    expect(() => restored.restoreSaveState(persisted(invalid))).toThrow("invalid settings snapshot names");
    expect(restored.captureSaveState()).toEqual(captured);
  }
  const base = new Q3GameSettings(host, "baseq3");
  expect(() => base.restoreSaveState(persisted(captured))).toThrow("invalid settings snapshot names");
  restored.update();
  expect(restored.string("g_redteam")).toBe("Changed after capture");
});
