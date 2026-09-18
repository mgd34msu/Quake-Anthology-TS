import { readSeatLanguage, writeSeatLanguage } from "../../src/ui/settings/language.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatUiPreferences } from "../../src/ui/settings/index.ts";
import { registerAccessibilitySettings } from "../../src/ui/settings/accessibility.ts";
import { accessibleColors } from "../../src/ui/common/accessibility.ts";
import { defaultUiSkin } from "../../src/ui/common/skin.ts";

test("accessibility choices persist in archived cvars and remain independent per seat", () => {
  const owner = createIdentityOwner("accessibility"), cvars = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(0), client: owner.client(0, 0) } } });
  registerAccessibilitySettings(cvars);
  const first = new SeatUiPreferences(owner.seat(0), cvars), second = new SeatUiPreferences(owner.seat(1), cvars);
  first.values = { ...first.values, typeface: "bold", colorMode: "monochrome", hudScale: 1.5, textScale: 2, menuScale: 0.8, captions: false };
  const restored = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(0), client: owner.client(0, 0) } } });
  registerAccessibilitySettings(restored); restored.applyArchive(cvars.archiveEntries());
  expect(new SeatUiPreferences(owner.seat(0), restored).values).toEqual(first.values);
  expect(second.values.typeface).toBe("standard"); expect(second.values.captions).toBe(true);
  expect(first.values.hudScale).toBe(1.5); expect(first.values.menuScale).toBe(0.8);
  expect(first.bindings().find(binding => binding.id === "ui:accessibility:typeface")?.kind).toBe("choice");
  cvars.set("ui_seat1_textScale", "99"); expect(first.values.textScale).toBe(2);
});

test("color alternatives retain readable text, explicit focus and opaque high contrast panels", () => {
  const base = defaultUiSkin("resource:test:font").colors;
  const mono = accessibleColors(base, { highContrast: true, colorMode: "monochrome" });
  expect(mono.text).toEqual(mono.accent); expect(mono.panel.w).toBe(1);
  expect(mono.focused).not.toEqual(mono.control);
  const alternate = accessibleColors(base, { highContrast: false, colorMode: "blue-yellow" });
  expect(alternate.accent.x).toBeGreaterThan(alternate.accent.z);
  expect(alternate.focused.z).toBeGreaterThan(alternate.focused.x);
});

test("seat language uses the same archived owner and observes console changes", () => {
  const owner = createIdentityOwner("language-archive"), context = { session: owner.session, origin: { kind: "server-console" } } satisfies ConstructorParameters<typeof CvarRegistry>[0]["context"];
  const cvars = new CvarRegistry({ dialect: "q3", context }); registerAccessibilitySettings(cvars);
  writeSeatLanguage(cvars, 0, "french");
  const restored = new CvarRegistry({ dialect: "q3", context }); registerAccessibilitySettings(restored); restored.applyArchive(cvars.archiveEntries());
  expect(readSeatLanguage(restored, 0)).toBe("french"); expect(readSeatLanguage(restored, 1)).toBe("english");
  restored.set("ui_seat1_language", "german"); expect(readSeatLanguage(restored, 0)).toBe("german");
  restored.set("ui_seat1_language", "../bad"); expect(readSeatLanguage(restored, 0)).toBe("german");
});
