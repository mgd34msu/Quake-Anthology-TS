import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { sameWeaponBehavior, type WeaponBehaviorCallback, type WeaponBehaviorDefinition } from "../../../src/contracts/weapon-behavior.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";
import { readWeaponBehaviorDefinition } from "../../../src/world/gameplay/weapon-behaviors.ts";

const module: ModuleIdentity = { id: "test:weapon", artifactPath: "game_x64.dll", digest: createContentDigest("a".repeat(64)), revision: "source-1" };
function definition(fire: WeaponBehaviorCallback): WeaponBehaviorDefinition {
  return { id: "test:trajectory", title: "Source trajectory", module, role: "rocket", aspect: "trajectory", activate: null, fire };
}
function restored(saved: unknown, loaded: WeaponBehaviorDefinition): WeaponBehaviorDefinition {
  return readWeaponBehaviorDefinition(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(saved)), "behavior"), loaded);
}

test("checkpoint callbacks retain loaded artifact identity across source VMs", () => {
  const callbacks: readonly WeaponBehaviorCallback[] = [
    { kind: "quakec", module, functionIndex: 8 },
    { kind: "qvm", module, instructionIndex: 12 },
    { kind: "native-artifact", module, imageOffset: 0xef900n, abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } },
  ];
  for (const callback of callbacks) {
    const loaded = definition(callback);
    expect(restored(loaded, loaded)).toBe(loaded);
    expect(sameWeaponBehavior(loaded, { ...loaded, title: "Renamed display label" })).toBe(true);
    const wrongArtifact = { ...loaded, fire: { ...callback, module: { ...module, digest: createContentDigest("b".repeat(64)) } } };
    expect(sameWeaponBehavior(loaded, wrongArtifact)).toBe(false);
    expect(() => restored(wrongArtifact, loaded)).toThrow("module differs");
  }
});

test("a save cannot replace a native entrypoint or calling convention", () => {
  const fire: WeaponBehaviorCallback = { kind: "native-artifact", module, imageOffset: 0xef900n,
    abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } };
  const loaded = definition(fire);
  const moved = { ...loaded, fire: { ...fire, imageOffset: fire.imageOffset + 1n } };
  expect(sameWeaponBehavior(loaded, moved)).toBe(false);
  expect(() => restored(moved, loaded)).toThrow("native weapon entry differs");
  const changedAbi: WeaponBehaviorDefinition = { ...loaded, fire: { ...fire,
    abi: { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" } } };
  expect(sameWeaponBehavior(loaded, changedAbi)).toBe(false);
  expect(() => restored(changedAbi, loaded)).toThrow("callback ABI differs");
  expect(() => restored({ ...loaded, fire: { ...fire, kind: "native-guest", address: 0x12345678n } }, loaded)).toThrow();
  expect(() => restored({ ...loaded, activate: fire }, loaded)).toThrow("unexpected activation callback");
});
