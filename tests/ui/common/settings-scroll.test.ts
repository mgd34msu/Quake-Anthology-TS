import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { NativeUiController, defaultUiSkin } from "../../../src/ui/common/index.ts";
import { registerSettingsMenus } from "../../../src/ui/settings/index.ts";
import type { SettingBinding } from "../../../src/ui/settings/index.ts";

test("settings scroll preserves values, reveals keyboard focus and clips pointer targets", () => {
  const owner = createIdentityOwner("settings-scroll"), seat = owner.seat(0);
  const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { provider: "ui:test"; content: "q1:rerelease:id1:retail" };
  const context: UiDrawContext = { binding: { seat, client: owner.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 },
    safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1, presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" },
      assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 1000 };
  const values = Array.from({ length: 20 }, () => 3);
  let field = "original";
  const bindings: SettingBinding[] = values.map((_value, index) => ({ id: `ui:test:slider-${index}`, label: `Slider ${index}`, category: "input", enabled: () => true,
    kind: "slider", minimum: 0, maximum: 20, step: 1, read: () => values[index] ?? 0, write: value => { values[index] = value; } }));
  bindings.push({ id: "ui:test:field", label: "Field", category: "input", enabled: () => true, kind: "text-entry", maximumLength: 40,
    read: () => field, write: value => { field = value; } });
  const ui = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 1000, bindings: () => [],
    focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  registerSettingsMenus(ui, bindings); ui.openMenu("menu:settings:input:0");
  const draw = () => ui.draw(context);
  const labels = () => draw().flatMap(command => command.kind === "text" ? [command.text] : []);
  const move = (x: number, y: number) => ui.input({ kind: "mouse-motion", seat, timeMilliseconds: 1000, position: { x, y }, delta: { x: 0, y: 0 } });
  const button = (down: boolean) => ui.input({ kind: "mouse-button", seat, timeMilliseconds: 1000, button: 1, down });
  const key = (code: number) => { for (const down of [true, false]) ui.input({ kind: "key", seat, timeMilliseconds: 1000, code, down, repeat: false }); };
  expect(labels()).toContain("Controls"); expect(labels()).not.toContain("Next page"); expect(labels()).not.toContain("Slider 19");
  move(450, 110); ui.input({ kind: "mouse-wheel", seat, timeMilliseconds: 1000, delta: { x: 0, y: -1 } });
  expect(values).toEqual(Array.from({ length: 20 }, () => 3)); expect(labels()).not.toContain("Slider 0");
  move(450, 80); button(true); button(false); expect(values).toEqual(Array.from({ length: 20 }, () => 3));
  move(568, 140); button(true); move(568, 390); button(false);
  expect(labels()).toContain("Slider 19"); expect(labels()).toContain("Field"); expect(labels()).toContain("Back");
  const commands = draw(); expect(commands.some(command => command.kind === "clip" && command.rect?.y === 92 && command.rect.height === 300)).toBe(true);
  for (let index = 0; index < 20; index++) key(KeyCode.Tab);
  expect(ui.state().focus).toMatchObject({ kind: "menu", control: "ui:test:field" });
  ui.input({ kind: "text", seat, timeMilliseconds: 1000, text: "!" }); expect(field).toBe("original!");
  key(KeyCode.Home); ui.input({ kind: "text", seat, timeMilliseconds: 1000, text: "A" }); expect(field).toBe("Aoriginal!");
  key(KeyCode.Tab); expect(ui.state().focus).toMatchObject({ kind: "menu", control: "ui:settings:back" });
  key(KeyCode.Tab); expect(labels()).toContain("Slider 0"); key(KeyCode.Right); expect(values[0]).toBe(4);
  expect(ui.activeMenu).toBe("menu:settings:input:0");
  move(450, 110); ui.input({ kind: "mouse-wheel", seat, timeMilliseconds: 1000, delta: { x: 0, y: -1 } });
  button(true); button(false); expect(values[3]).not.toBe(3); expect(values[0]).toBe(4);

});
