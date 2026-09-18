import { expect, test } from "bun:test";
import { createContentDigest } from "../../src/contracts/content.ts";
import { encodeCheckpointValue } from "../../src/persistence/value.ts";
import { encodeQ2RereleaseNativeSave, decodeQ2RereleaseNativeSave, type Q2RereleaseNativeSave } from "../../src/app/bootstrap/simulation/native-q2-rerelease-save.ts";

test("API2023 checkpoint retains native JSON and projections under exact module and edition ownership", () => {
  const source = { native: new TextEncoder().encode('{"native_field":{"unknown_to_engine":42}}'), deferredDamage: [], projections: [] };
  const save: Q2RereleaseNativeSave = {
    module: { id: "q2:native-test", artifactPath: "game_x64.dll", digest: createContentDigest("12".repeat(32)), revision: "r1" },
    map: "maps/base1.bsp", api: { kind: "q2-rerelease-game", version: 2023 }, abi: "windows-x86-64", autosave: false,
    server: { cvars: encodeCheckpointValue({ dialect: "q2-rerelease" }), configstrings: [{ index: 12447, value: "tail" }], portals: [{ portal: 7, open: true }] },
    game: source, level: { ...source, projections: [{ slot: 9, actor: { slot: 30, generation: 8 } }] },
    visitedLevels: [{ version: 1, map: "maps/base2.bsp", level: source, configstrings: [], portals: [] }],
  };
  const checkpoint = encodeQ2RereleaseNativeSave(save), restored = decodeQ2RereleaseNativeSave(checkpoint, save);
  expect(restored).toEqual(save);
  expect(restored.level.native).toEqual(source.native);
  expect(() => decodeQ2RereleaseNativeSave(checkpoint, { ...save, module: { ...save.module, digest: createContentDigest("34".repeat(32)) } })).toThrow("selected module");
  expect(() => decodeQ2RereleaseNativeSave({ ...checkpoint, schema: "q2:classic-native-original" }, save)).toThrow("provider");
  expect(() => encodeQ2RereleaseNativeSave({ ...save, server: { ...save.server, configstrings: [{ index: 1, value: "a" }, { index: 1, value: "b" }] } })).toThrow("Duplicate");
  expect(() => encodeQ2RereleaseNativeSave({ ...save, game: { ...source, native: new TextEncoder().encode("broken") } })).toThrow();
  expect(() => encodeQ2RereleaseNativeSave({ ...save, visitedLevels: [{ version: 1, map: save.map, level: source, configstrings: [], portals: [] }] })).toThrow("visited");
});
