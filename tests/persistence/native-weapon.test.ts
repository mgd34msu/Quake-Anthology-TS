import { expect, test } from "bun:test";
import { createContentDigest } from "../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../src/contracts/execution.ts";
import { q2EaksWeaponDigest } from "../../src/compat/q2/rerelease/q2eaks-weapon-profile.ts";
import { builtInRereleaseWeaponDeclaration, rereleaseWeaponDefinition } from "../../src/compat/q2/rerelease/weapon-behavior-profile.ts";
import { readSavedNativeWeaponDeclaration } from "../../src/persistence/native-weapon.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../src/persistence/value.ts";
import { readRereleaseWeaponBehaviorCheckpoint } from "../../src/app/bootstrap/simulation/rerelease-weapon-checkpoint.ts";

const module: ModuleIdentity = { id: "test:native", artifactPath: "game_x64.dll", digest: q2EaksWeaponDigest, revision: q2EaksWeaponDigest };
const declaration = builtInRereleaseWeaponDeclaration(module), definition = rereleaseWeaponDefinition(module);
if (declaration === null || definition === null) throw new Error("Missing legacy native profile");
const sourceSave = { native: new TextEncoder().encode("{}"), deferredDamage: [], projections: [] };
const saved = { version: 1, definition, declaration, map: { map: "base1", entities: "{}", spawnPoint: "" },
  time: 0, cvars: new Uint8Array(), game: sourceSave, level: sourceSave, configstrings: [], retired: [], bindings: [] };
const reader = (value: unknown) => new SaveReader(decodeCheckpointValue(encodeCheckpointValue(value)), "native");

test("native checkpoint retains complete layout identity and accepts only its exact legacy fallback", () => {
  expect(readRereleaseWeaponBehaviorCheckpoint(reader(saved), definition, declaration).declaration).toEqual(declaration);
  const { declaration: omitted, ...legacy } = saved;
  expect(omitted).toEqual(declaration);
  expect(readRereleaseWeaponBehaviorCheckpoint(reader(legacy), definition, declaration).declaration).toEqual(declaration);
  const changed = { ...declaration, time: { ...declaration.time, rva: declaration.time.rva + 8 } };
  expect(() => readRereleaseWeaponBehaviorCheckpoint(reader(saved), definition, changed)).toThrow("declaration changed");
  expect(() => readRereleaseWeaponBehaviorCheckpoint(reader({ ...saved, declaration: changed }), definition, declaration)).toThrow("declaration changed");
  const changedProvisioning = { ...declaration, provisioningCvars: [...declaration.provisioningCvars, { name: "another_capability", value: "1" }] };
  expect(() => readRereleaseWeaponBehaviorCheckpoint(reader(saved), definition, changedProvisioning)).toThrow("declaration changed");
  expect(() => readSavedNativeWeaponDeclaration(new SaveReader(undefined, "legacy"), { ...definition, id: "test:different" })).toThrow("differs");
});

test("an unknown native artifact requires its retained explicit declaration", () => {
  const other = { ...module, digest: createContentDigest("a".repeat(64)), revision: "declared-build" };
  const declared = { ...declaration, artifactDigest: other.digest };
  const selected = rereleaseWeaponDefinition(other, declared);
  if (selected === null) throw new Error("Explicit declaration was not resolved");
  expect(() => readSavedNativeWeaponDeclaration(new SaveReader(undefined, "legacy"), selected)).toThrow("no retained declaration");
  expect(readSavedNativeWeaponDeclaration(reader(declared), selected)).toEqual(declared);
  expect(() => readSavedNativeWeaponDeclaration(reader(declaration), selected)).toThrow();
});
