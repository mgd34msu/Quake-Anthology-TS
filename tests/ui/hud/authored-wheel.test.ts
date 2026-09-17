import { expect, test } from "bun:test";
import { parseQ1WeaponWheel } from "../../../src/ui/hud/q1-wheel.ts";
import { q1WheelSlotItem } from "../../../src/app/bootstrap/q1-wheel.ts";
test("authored wheel slots dispatch exact expansion impulses", () => {
  const wheel = parseQ1WeaponWheel("slot 9 {\nimpulse 227\nweaponnum 65536\n}\nslot 10 {\nimpulse 228\n}\nslot 11 {\nimpulse 22\n}");
  expect(wheel.errors).toEqual([]);
  const [proximity, grenade, grapple] = wheel.slots;
  if (proximity === undefined || grenade === undefined || grapple === undefined) throw new Error("Missing parsed slots");
  expect(q1WheelSlotItem(proximity, "hipnotic")).toBe("q1:weapon/hipnotic:proximity");
  expect(q1WheelSlotItem(grenade, "hipnotic")).toBe("q1:weapon/grenadelauncher");
  expect(q1WheelSlotItem(grapple, "rogue")).toBe("q1:weapon/rogue:grapple");
  expect(q1WheelSlotItem(proximity, "id1")).toBeNull();
});
