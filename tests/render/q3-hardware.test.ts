import { expect, test } from "bun:test";
import { q3EffectHardware, q3Hardware, q3HardwareNumber, type Q3Hardware } from "../../src/render/q3-hardware.ts";

test("retained Q3 effect profiles follow renderer changes with both source spellings", () => {
  let renderer = "";
  const profile = q3EffectHardware(() => q3Hardware(renderer));
  expect([profile.hardware, profile.hardwareType]).toEqual(["generic", "generic"]);
  renderer = "ATI Rage Pro";
  expect([profile.hardware, profile.hardwareType]).toEqual(["ragepro", "rage-pro"]);
  renderer = "NVIDIA RIVA 128";
  expect([profile.hardware, profile.hardwareType]).toEqual(["generic", "generic"]);
  renderer = "ATI RagePro";
  expect([profile.hardware, profile.hardwareType]).toEqual(["ragepro", "rage-pro"]);
  renderer = "";
  expect([profile.hardware, profile.hardwareType]).toEqual(["generic", "generic"]);
});

test("Q3 hardware classification retains source precedence and GL config enum values", () => {
  const cases = [["NVIDIA GeForce RTX 5060 Ti", "generic", 0], ["Mesa Voodoo_Graphics", "3dfx", 1],
    ["Banshee Rage Pro", "3dfx", 1], ["NVIDIA RIVA 128", "riva128", 2], ["ATI RAGE PRO", "ragepro", 3],
    ["ATI RagePro", "ragepro", 3], ["3Dlabs Permedia2", "permedia2", 4], ["", "generic", 0]] satisfies readonly (readonly [string, Q3Hardware, number])[];
  for (const [name, hardware, value] of cases) {
    expect(q3Hardware(name)).toBe(hardware);
    expect(q3HardwareNumber(q3Hardware(name))).toBe(value);
  }
});
