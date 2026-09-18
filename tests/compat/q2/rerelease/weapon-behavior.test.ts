import { expect, test } from "bun:test";
import { rereleaseWeaponInitializationEntities, withRereleaseWeaponProvisioning } from "../../../../src/compat/q2/rerelease/weapon-behavior-profile.ts";
import { parseQ1Entities, q1EntityValue } from "../../../../src/formats/q1-map/entities.ts";
import { CvarRegistry, Q2CvarFlag } from "../../../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";

test("native component initialization retains authored world and admission fields without taking world actor ownership", () => {
  const source = '{"classname" "worldspawn" "custom_policy" "keep"}\n{"classname" "info_player_start" "origin" "10 20 30" "targetname" "entry"}\n{"classname" "func_door" "model" "*1"}\n{"classname" "custom_monster" "script" "authored"}';
  const profile = { initializationClasses: ["worldspawn", "info_player_start"] };
  const entities = parseQ1Entities(rereleaseWeaponInitializationEntities(source, profile));
  expect(entities.map(entity => q1EntityValue(entity, "classname"))).toEqual(["worldspawn", "info_player_start"]);
  expect(entities.map(entity => q1EntityValue(entity, "custom_policy"))).toEqual(["keep", null]);
  expect(entities.map(entity => q1EntityValue(entity, "origin"))).toEqual([null, "10 20 30"]);
  expect(entities.map(entity => q1EntityValue(entity, "targetname"))).toEqual([null, "entry"]);
  expect(() => rereleaseWeaponInitializationEntities('{"classname" "info_player_start"}', profile)).toThrow("one authored worldspawn");
});

test("native multiplayer provisioning scopes its declared private cheat capability and restores a pending latch on failure", () => {
  const identity = createIdentityOwner("native-provisioning");
  const source = new CvarRegistry({ dialect: "q2-rerelease", context: { session: identity.session, origin: { kind: "server-console" } } });
  source.register("cheats", "0", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch); source.register("maxclients", "8"); source.register("unrelated", "0");
  source.setServerActive(true); source.set("cheats", "2"); const before = source.captureWorldTransferState();
  const profile = { provisioningCvars: [{ name: "cheats", value: "1" }] }, observed: number[] = [];
  const refresh = () => { observed.push(source.variableValue("cheats")); };
  expect(() => withRereleaseWeaponProvisioning(profile, source, refresh, () => {
    expect(source.variableValue("maxclients")).toBe(8); expect(source.variableValue("cheats")).toBe(1); throw new Error("authored command failure");
  })).toThrow("authored command failure");
  expect(source.captureWorldTransferState()).toEqual(before); expect(observed).toEqual([1, 0]);
  expect(() => withRereleaseWeaponProvisioning(profile, source, refresh, () => source.set("unrelated", "1"))).toThrow("undeclared source cvar");
  expect(source.captureWorldTransferState()).toEqual(before);
});

import { retireRereleaseWeaponActor } from "../../../../src/app/bootstrap/simulation/rerelease-weapon-behavior.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { WeaponTrajectoryUpdate } from "../../../../src/contracts/weapon-behavior.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/registry.ts";

test("native mirrors retire once across actor release, reentrant source-slot reuse and later attachment disposal", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("native-retirement"));
  const state: Parameters<typeof retireRereleaseWeaponActor>[1] = { slots: new Map<ActorId, number>(), bindings: new Map<number, Parameters<Parameters<typeof retireRereleaseWeaponActor>[2]>[1]>(), retired: new Map<ActorId, WeaponTrajectoryUpdate>() };
  const original = actors.allocate("test:primary", "test:rocket"), replacement = actors.allocate("test:primary", "test:target");
  state.slots.set(original.id, 5); state.bindings.set(5, { actor: original, kind: "projectile", generation: 1 });
  let disposals = 0;
  const dispose = () => {
    disposals++;
    expect(state.slots.has(original.id)).toBe(false);
    expect(state.bindings.has(5)).toBe(false);
    state.slots.set(replacement.id, 5); state.bindings.set(5, { actor: replacement, kind: "target", generation: 2 });
  };
  const unsubscribe = actors.onRelease(actor => { retireRereleaseWeaponActor(actor.id, state, dispose); return undefined; });
  actors.release(original);
  retireRereleaseWeaponActor(original.id, state, dispose);
  expect(disposals).toBe(1); expect(state.bindings.get(5)?.actor).toBe(replacement);
  unsubscribe(); actors.release(replacement);
  expect(disposals).toBe(1);
});
