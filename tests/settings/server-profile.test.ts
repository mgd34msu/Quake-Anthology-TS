import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { applyServerProfile, captureServerProfile, collectServerSettings, cvarServerSettingsOwner, loadServerProfile,
  parseServerProfile, q2CombatSettings, q2LimitSettings, q2SpawnSettings, q3CombatSettings, q3LimitSettings, q3MatchSettings,
  readServerSetting, registerQ2ServerCvars, saveServerProfile, writeServerSetting } from "../../src/settings/server/index.ts";
import type { BoundServerSetting } from "../../src/settings/server/index.ts";
import { moveRotationMap, q2RotationSettings, rotationMapName } from "../../src/settings/server/rotation.ts";
import { listServerProfiles } from "../../src/settings/server/library.ts";
import { q1MatchSettings } from "../../src/settings/server/q1.ts";
import { serverDefinitionsForSelection } from "../../src/settings/server/selection.ts";
import { createStartupSource, resolveStartupRules } from "../../src/app/bootstrap/startup-source.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";

function q2Bindings() {
  const identity = createIdentityOwner("server-settings"), cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: identity.session, origin: { kind: "server-console" } } });
  registerQ2ServerCvars(cvars, "q2:official");
  const definitions = collectServerSettings([q2LimitSettings(), q2CombatSettings(), q2SpawnSettings()]), owner = cvarServerSettingsOwner(cvars);
  cvars.setServerActive(true);
  return { cvars, definitions, bindings: definitions.map(definition => ({ definition, owner })) };
}
function binding(bindings: readonly BoundServerSetting[], id: string): BoundServerSetting {
  const found = bindings.find(binding => binding.definition.id === id); if (found === undefined) throw new Error(`Missing ${id}`); return found;
}

test("Q1 Rogue team choices persist pending map rules and apply to the next source owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "q1-team-profile-"));
  const source = { provider: "q1:official", content: "q1:classic:rogue:base" } satisfies Parameters<typeof serverDefinitionsForSelection>[0]["source"];
  const definitions = serverDefinitionsForSelection({ source, match: source, combat: source });
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: createIdentityOwner("q1-team-settings").session, origin: { kind: "server-console" } } });
  cvars.register("teamplay", "0");
  const bindings = definitions.map(definition => ({ definition, owner: cvarServerSettingsOwner(cvars) }));
  const teamplay = binding(bindings, "server:q1.teamplay");
  try {
    expect(teamplay.definition.kind).toBe("choice");
    expect(writeServerSetting(teamplay, "6")).toEqual({ desired: "6", effective: "0", pending: true, applyAt: "next-map" });
    const store = new ConfigStore(root);
    await saveServerProfile(store, "rogue.json", captureServerProfile(bindings), definitions);
    const saved = await loadServerProfile(store, "rogue.json", definitions); if (saved === null) throw new Error("Missing profile");
    applyServerProfile(saved, definitions.map(definition => ({ definition, owner: cvarServerSettingsOwner(cvars, true) })));
    expect(cvars.variableValue("teamplay")).toBe(6);
    const launch = parseApplicationCommand(["--game", "q1-classic-rogue", "--mode", "deathmatch"]);
    if (launch.kind !== "run") throw new Error("Missing Rogue launch");
    const options = { ...launch.options, serverProfile: saved };
    const startup = createStartupSource(options, { source, match: source }, "q1-netquake", cvars.context, 8, () => undefined);
    const resolved = resolveStartupRules(options, startup, 8, definitions);
    expect(resolved.options.mode).toBe("deathmatch"); expect(startup.variableValue("teamplay")).toBe(6);
    expect(() => parseServerProfile(saved, q1MatchSettings("standard").definitions)).toThrow("Unknown");
    expect(q1MatchSettings("ctf").definitions).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("independent match and combat collections preserve source defaults and reject competing semantic owners", () => {
  const definitions = collectServerSettings([q2LimitSettings(), q3CombatSettings("baseq3")]);
  expect(definitions.find(definition => definition.id === "server:frag-limit")?.defaultValue).toBe("0");
  expect(parseServerProfile({ version: 1, overrides: [{ id: "server:time-limit", value: "0.5" }] }, definitions).overrides[0]?.value).toBe("0.5");
  expect(definitions.find(definition => definition.id === "server:friendly-fire")?.target).toEqual({ kind: "value", name: "g_friendlyFire" });
  expect(q3LimitSettings("baseq3").definitions.find(definition => definition.id === "server:frag-limit")?.defaultValue).toBe("20");
  expect(() => collectServerSettings([q2LimitSettings(), q3LimitSettings("baseq3")])).toThrow("Two selected components own");
  expect(() => parseServerProfile({ version: 1, overrides: [{ id: "server:q3.game-type", value: "7" }] }, collectServerSettings([q3MatchSettings("baseq3")]))).toThrow("Unknown");
});
test("live mask writes preserve pending spawn flags in the real source registry", () => {
  const { cvars, bindings } = q2Bindings(), health = binding(bindings, "server:q2.no-health"), friendly = binding(bindings, "server:friendly-fire");
  expect(writeServerSetting(health, "true")).toEqual({ desired: "1", effective: "0", pending: true, applyAt: "next-map" });
  expect(writeServerSetting(friendly, "false").effective).toBe("0");
  expect(cvars.find("dmflags")?.value).toBe("256");
  expect(cvars.find("dmflags")?.latchedValue).toBe("257");
  expect(readServerSetting(health).pending).toBe(true);
  cvars.applyLatched();
  expect(readServerSetting(health).pending).toBe(false);
  expect(cvars.variableValue("dmflags")).toBe(257);
  expect(cvars.find("dmflags")?.flags).toBe(Q2CvarFlag.ServerInfo);
  cvars.set("dmflags", "0");
  expect(cvars.variableValue("dmflags")).toBe(0);
  cvars.register("protected", "0", Q2CvarFlag.NoSet);
  expect(() => cvars.stage("protected", "1")).toThrow("protected");
  expect(() => cvars.stage("missing", "1")).toThrow("unregistered");
});
test("profile validation finishes before source writes and actual files preserve desired values", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-server-profile-"));
  try {
    const { cvars, definitions, bindings } = q2Bindings();
    expect(() => applyServerProfile({ version: 1, overrides: [{ id: "server:frag-limit", value: "9" }, { id: "server:time-limit", value: "NaN" }] }, bindings)).toThrow();
    expect(cvars.variableValue("fraglimit")).toBe(0);
    writeServerSetting(binding(bindings, "server:q2.no-health"), "1");
    writeServerSetting(binding(bindings, "server:frag-limit"), "9");
    const store = new ConfigStore(root), profile = captureServerProfile(bindings);
    expect(await listServerProfiles(store)).toEqual([]);
    await saveServerProfile(store, "servers/test.json", profile, definitions);
    expect(await listServerProfiles(store)).toEqual([{ name: "test", path: "servers/test.json" }]);
    expect(await loadServerProfile(store, "servers/test.json", definitions)).toEqual(profile);
    expect(() => parseServerProfile({ version: 1, overrides: [{ id: "server:missing", value: "0" }] }, definitions)).toThrow("no selected owner");
    await expect(saveServerProfile(store, "../escape.json", profile, definitions)).rejects.toThrow("escapes");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ordered rotations use the selected source cvar and survive profile capture", () => {
  for (const rerelease of [false, true]) {
    const identity = createIdentityOwner(`rotation-${rerelease}`);
    const cvars = new CvarRegistry({ dialect: rerelease ? "q2-rerelease" : "q2-classic", context: { session: identity.session, origin: { kind: "server-console" } } });
    const name = rerelease ? "g_map_list" : "sv_maplist";
    cvars.register(name, "", 0);
    if (rerelease) cvars.register("g_map_list_shuffle", "0", 0);
    const definitions = q2RotationSettings(rerelease).definitions, owner = cvarServerSettingsOwner(cvars);
    const bindings = definitions.map(definition => ({ definition, owner }));
    const rotation = binding(bindings, "server:map-rotation");
    const maps = ["maps/q2dm1.bsp", "q2dm2", "q2dm3"].map(rotationMapName);
    writeServerSetting(rotation, moveRotationMap(maps, 2, -1).join(" "));
    expect(cvars.variableString(name)).toBe("q2dm1 q2dm3 q2dm2");
    if (rerelease) writeServerSetting(binding(bindings, "server:map-rotation-shuffle"), "1");
    const profile = captureServerProfile(bindings);
    writeServerSetting(rotation, "");
    expect(cvars.variableString(name)).toBe("");
    applyServerProfile(profile, bindings);
    expect(cvars.variableString(name)).toBe("q2dm1 q2dm3 q2dm2");
    expect(cvars.variableString("g_map_list_shuffle")).toBe(rerelease ? "1" : "");
    expect(moveRotationMap(maps, 0, -1)).toBe(maps);
  }
  expect(() => rotationMapName("../outside")).toThrow();
  expect(() => rotationMapName("q2dm1;quit")).toThrow();
});
