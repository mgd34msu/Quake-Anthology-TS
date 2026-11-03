// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { KeyCode } from "../../../src/core/key-codes.ts";
import { NativeUiController, createMenuLocalizer, defaultUiSkin } from "../../../src/ui/common/index.ts";
import { registerSettingsMenus } from "../../../src/ui/settings/index.ts";
import type { SettingBinding } from "../../../src/ui/settings/index.ts";

function fixture(textScale = 1) {
  const owner = createIdentityOwner("controller-fixes"),
    seat = owner.seat(0);
  const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { provider: "ui:test"; content: "q1:rerelease:id1:retail" };
  const context = (width: number, height: number): UiDrawContext => ({
    binding: {
      seat,
      client: owner.client(0, 0),
      viewport: { x: 0, y: 0, width, height },
      safeArea: { x: 0, y: 0, width, height },
      hudScale: 1,
      presentation: {
        doppler: { kind: "source" },
        environment: { kind: "audio-content" },
        assets: provider.content,
        hud: provider,
        effects: provider,
        audio: provider,
      },
    },
    timeMilliseconds: 1000,
  });
  let field = "original",
    slider = 3;
  const bindings: SettingBinding[] = [
    {
      id: "ui:test:slider",
      label: "Slider",
      category: "input",
      enabled: () => true,
      kind: "slider",
      minimum: 0,
      maximum: 20,
      step: 1,
      read: () => slider,
      write: value => {
        slider = value;
      },
    },
    {
      id: "ui:test:field",
      label: "Field",
      category: "input",
      enabled: () => true,
      kind: "text-entry",
      maximumLength: 40,
      read: () => field,
      write: value => {
        field = value;
      },
    },
  ];
  const ui = new NativeUiController({
    seat,
    skin: () => defaultUiSkin("resource:test:font"),
    now: () => 1000,
    bindings: () => [],
    focus: () => undefined,
    sound: () => undefined,
    executeScript: () => undefined,
    appearance: () => ({ menuScale: 1, textScale, highContrast: false }),
  });
  registerSettingsMenus(ui, bindings);
  const key = (code: number, down: boolean) => ui.input({ kind: "key", seat, timeMilliseconds: 1000, code, down, repeat: false });
  return { ui, seat, context, key, value: () => ({ field, slider }) };
}

test("UI-006 a modifier released while no menu is open does not stay held", () => {
  const { ui, key, value } = fixture();
  ui.openMenu("menu:settings:input:0");
  key(KeyCode.Control, true);
  key(KeyCode.Escape, true);
  key(KeyCode.Control, false);
  ui.openMenu("menu:settings:input:0");
  key(KeyCode.Tab, true);
  key(KeyCode.Tab, false);
  while (JSON.stringify(ui.state().focus).indexOf("ui:test:field") < 0) {
    key(KeyCode.Tab, true);
    key(KeyCode.Tab, false);
  }
  key(117, true);
  expect(value().field).toBe("original");
});

test("UI-007 a stick held through controller removal stops repeating", () => {
  const { ui, seat, context, value } = fixture();
  ui.openMenu("menu:settings:input:0");
  ui.input({ kind: "controller-axis", seat, timeMilliseconds: 1000, device: 7, axis: "left-x", value: 1 });
  ui.input({ kind: "controller-axis", seat, timeMilliseconds: 1000, device: 7, axis: "left-x", value: 0 });
  const before = value().slider;
  ui.draw({ ...context(640, 480), timeMilliseconds: 5000 });
  expect(value().slider).toBe(before);
});

test("UI-008 the largest Text size keeps row text inside its row", () => {
  const { ui, context } = fixture(2);
  ui.openMenu("menu:settings:input:0");
  const label = ui.draw(context(640, 480)).find(command => command.kind === "text" && command.text === "Slider");
  if (label?.kind !== "text") throw new Error("Slider label was not drawn");
  expect(label.origin.y).toBeGreaterThanOrEqual(92);
  expect(label.origin.y + 8 * label.scale).toBeLessThanOrEqual(92 + 28);
});

test("UI-018 an empty safe area draws nothing instead of throwing", () => {
  const { ui, context } = fixture();
  ui.openMenu("menu:settings:input:0");
  expect(ui.draw(context(0, 0))).toEqual([]);
});

test("UI-017 a held d-pad direction repeats like the stick and stops on release", () => {
  const { ui, seat, context, value } = fixture();
  ui.openMenu("menu:settings:input:0");
  const start = value().slider;
  ui.input({ kind: "controller-button", seat, timeMilliseconds: 1000, device: 3, button: 14, down: true });
  ui.draw({ ...context(640, 480), timeMilliseconds: 1400 });
  expect(value().slider).toBeGreaterThanOrEqual(start + 2);
  ui.input({ kind: "controller-button", seat, timeMilliseconds: 1500, device: 3, button: 14, down: false });
  const stopped = value().slider;
  ui.draw({ ...context(640, 480), timeMilliseconds: 9000 });
  expect(value().slider).toBe(stopped);
});

test("UI-017 a pad edits a focused text field and the Back+B chord abandons a binding capture", () => {
  const { ui, seat, key, value } = fixture();
  ui.openMenu("menu:settings:input:0");
  while (JSON.stringify(ui.state().focus).indexOf("ui:test:field") < 0) {
    key(KeyCode.Tab, true);
    key(KeyCode.Tab, false);
  }
  const press = (button: number) => {
    for (const down of [true, false]) ui.input({ kind: "controller-button", seat, timeMilliseconds: 1000, device: 3, button, down });
  };
  press(3);
  expect(value().field).toBe("origina");
  press(10);
  expect(value().field).toBe("originb");
  press(9);
  press(9);
  expect(value().field).toBe("origin&");
  press(2);
  expect(value().field).toBe("origin&a");
  const events: string[] = [];
  const button = (value: number, down: boolean) => ui.input({ kind: "controller-button", seat, timeMilliseconds: 1000, device: 3, button: value, down });
  ui.captureBinding(
    input => events.push(`accept ${input.kind === "controller-button" ? input.button : "?"}`),
    () => events.push("cancel"),
  );
  button(6, true);
  button(1, true);
  button(1, false);
  button(6, false);
  expect(events).toEqual(["cancel"]);
  ui.captureBinding(
    input => events.push(`accept ${input.kind === "controller-button" ? input.button : "?"}`),
    () => events.push("cancel"),
  );
  button(6, true);
  button(6, false);
  expect(events).toEqual(["cancel", "accept 6"]);
});

test("UI-019 the menu localizer translates by language and falls back to the literal", () => {
  let language = "english";
  const localize = createMenuLocalizer(
    () => new Map([["german", new Map([["Slider", "Regler"]])]]),
    () => language,
  );
  expect(localize("Slider")).toBe("Slider");
  language = "german";
  expect(localize("Slider")).toBe("Regler");
  expect(localize("Field")).toBe("Field");
  language = "french";
  expect(localize("Slider")).toBe("Slider");
});
