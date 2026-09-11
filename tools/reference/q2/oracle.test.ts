import { describe, expect, test } from "bun:test";
import { q2Cases } from "../../../verification/reference-cases/q2/cases.ts";
import { projectRoot } from "./capture.ts";
import { classicTime, commandPredicates, declaredSaveFields, evaluate, think } from "./oracle.ts";
import { loadVerifiedSources, sourceText } from "./sources.ts";

const sources = await loadVerifiedSources(projectRoot);

describe("Q2 independently source-derived reference cases", () => {
  for (const reference of q2Cases) {
    test(reference.id, () => {
      expect(evaluate(reference.input, sources.text)).toEqual(reference.expected);
      expect(reference.sources.length).toBeGreaterThan(0);
      for (const location of reference.sources) {
        expect(location.firstLine).toBeGreaterThan(0);
        expect(location.lastLine).toBeGreaterThanOrEqual(location.firstLine);
        expect(location.lastLine).toBeLessThanOrEqual(sourceText(sources.text, location.source).split("\n").length);
      }
    });
  }

  test("classic frame equation crosschecks binary32 storage over 10,000 frames", () => {
    const value = new DataView(new ArrayBuffer(4));
    for (let frame = 0; frame <= 10_000; frame += 1) {
      value.setFloat32(0, frame / 10, true);
      expect(classicTime(frame)).toBe(value.getFloat32(0, true));
    }
    let incremented = 0;
    for (let frame = 0; frame < 10; frame += 1) incremented = Math.fround(incremented + 0.1);
    expect(incremented).not.toBe(classicTime(10));
  });

  test("adjacent binary32 deadlines straddle the classic unsuffixed epsilon", () => {
    const value = new DataView(new ArrayBuffer(4));
    value.setFloat32(0, 1.001, true);
    const roundedAbove = value.getFloat32(0, true);
    value.setUint32(0, value.getUint32(0, true) - 1, true);
    const roundedBelow = value.getFloat32(0, true);
    expect(roundedBelow).toBeLessThan(1 + 0.001);
    expect(roundedAbove).toBeGreaterThan(1 + 0.001);
    expect(think({ kind: "think", family: "classic", now: 1, nextthink: roundedBelow, reschedule: 2 })).toEqual({ now: 1, nextthink: 2, mayContinuePhysics: false, trace: [{ event: "think.enter", nextthink: 0 }, { event: "think.return", nextthink: 2 }] });
    expect(think({ kind: "think", family: "classic", now: 1, nextthink: roundedAbove, reschedule: 2 })).toEqual({ now: 1, nextthink: roundedAbove, mayContinuePhysics: true, trace: [] });
  });

  test("ordinary armor absorption matches independently stored float equation", () => {
    const value = new DataView(new ArrayBuffer(4));
    value.setFloat32(0, 0.3, true);
    const storedProtection = value.getFloat32(0, true);
    for (let damage = 0; damage <= 1000; damage += 1) {
      value.setFloat32(0, storedProtection * damage, true);
      const absorbed = Math.min(Math.ceil(value.getFloat32(0, true)), 50);
      expect(evaluate({ kind: "armor", damage, inventory: 50, armor: "jacket", energy: false, bypass: false }, sources.text)).toEqual({ absorbed, remainingArmor: 50 - absorbed, remainingDamage: damage - absorbed, effect: absorbed === 0 ? null : "SpawnDamage" });
    }
    expect(Math.ceil(storedProtection * 10)).toBe(4);
  });

  test("all 256 button bytes preserve independent native predicates", () => {
    for (let buttons = 0; buttons < 256; buttons += 1) {
      const jumpBit = Math.floor(buttons / 8) % 2 === 1;
      const crouchBit = Math.floor(buttons / 16) % 2 === 1;
      expect(commandPredicates({ kind: "command-predicates", upmove: 10, buttons, n64Physics: false })).toEqual({ classicHoldingJump: true, classicGroundedDuckBranch: false, rereleaseHoldingJump: jumpBit, rereleaseGroundedDuckBranch: crouchBit });
      expect(commandPredicates({ kind: "command-predicates", upmove: -1, buttons, n64Physics: true })).toEqual({ classicHoldingJump: false, classicGroundedDuckBranch: true, rereleaseHoldingJump: jumpBit, rereleaseGroundedDuckBranch: false });
    }
  });

  test("save fields come from the original declaration and reject absent struct", () => {
    const text = sourceText(sources.text, "rereleaseSave");
    expect(declaredSaveFields(text, "level_locals_t")).toContain("current_poi_stage");
    expect(declaredSaveFields(text, "edict_t")).toContain("fog.density");
    expect(declaredSaveFields(text, "edict_t")).toContain("bmodel_anim.enabled");
    expect(declaredSaveFields(text, "client_persistant_t")).toContain("max_ammo");
    expect(declaredSaveFields(text, "client_persistant_t")).not.toContain("max_flechettes");
    expect(() => declaredSaveFields(text, "not_a_native_struct")).toThrow("Q2 save structure missing");
  });
});
