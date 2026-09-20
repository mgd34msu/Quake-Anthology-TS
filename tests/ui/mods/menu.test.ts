// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { NativeUiController } from "../../../src/ui/common/controller.ts";
import { defaultUiSkin } from "../../../src/ui/common/skin.ts";
import { registerModMenu, type ModMenuRow, type ModMenuService } from "../../../src/ui/mods/menu.ts";

test("mod menu combines source games, toggles independently, scrolls, searches and explains unavailable choices", () => {
  const owner = createIdentityOwner("mod-menu"), seat = owner.seat(0);
  const enabled = new Set<string>(), changes: { readonly id: string; readonly enabled: boolean }[] = [];
  let refreshes = 0;
  const available = [
    { id: "q1:weather", title: "Storm effects", source: "Quake", unavailable: null },
    { id: "q2:monsters", title: "Monster variety", source: "Quake II", unavailable: null },
    { id: "q3:audio", title: "Arena ambience", source: "Quake III", unavailable: null },
    ...Array.from({ length: 10 }, (_, index) => ({ id: `q1:extra:${index}`, title: `Extra mod ${index}`, source: "Quake", unavailable: null })),
    { id: "q2:expansion", title: "Expansion enemies", source: "Quake II rerelease", unavailable: "Requires installed expansion content." },
  ] satisfies readonly Omit<ModMenuRow, "enabled">[];
  const service: ModMenuService = {
    rows: () => available.map(row => ({ ...row, enabled: enabled.has(row.id) })),
    setEnabled: (id, value) => { changes.push({ id, enabled: value }); if (value) enabled.add(id); else enabled.delete(id); },
    refresh: () => { refreshes++; }, status: () => "",
  };
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"),
    bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  const menu = registerModMenu(ui, service);
  const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies UiDrawContext["binding"]["presentation"]["hud"];
  const context: UiDrawContext = { binding: { seat, client: owner.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 },
    safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1,
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 0 };
  const text = (): readonly string[] => ui.draw(context).flatMap(command => command.kind === "text" ? [command.text.trim()] : []);
  const key = (code: number): void => { ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 0 }); };
  const click = (x: number, y: number): void => {
    ui.input({ kind: "mouse-motion", seat, position: { x, y }, delta: { x: 0, y: 0 }, timeMilliseconds: 0 });
    ui.input({ kind: "mouse-button", seat, button: 1, down: true, timeMilliseconds: 0 });
    ui.input({ kind: "mouse-button", seat, button: 1, down: false, timeMilliseconds: 0 });
  };
  ui.openMenu(menu.root);
  expect(refreshes).toBe(1);
  expect(text()).toContain("Disabled");
  key(KeyCode.Tab); key(KeyCode.Enter);
  expect(text()).toContain("Disable");
  key(KeyCode.Down);
  expect(changes).toEqual([{ id: "q1:weather", enabled: true }]);
  key(KeyCode.Tab); key(KeyCode.Enter);
  expect([...enabled]).toEqual(["q1:weather", "q2:monsters"]);
  expect(text().filter(label => label === "Enabled")).toHaveLength(2);
  click(60, 150);
  expect([...enabled]).toEqual(["q2:monsters"]);
  key(KeyCode.End);
  expect(text()).toContain("Expansion enemies");
  expect(text()).toContain("Unavailable");
  expect(text()).toContain("Requires installed expansion content.");
  key(KeyCode.Enter); click(60, 350);
  expect(changes).toHaveLength(3);
  click(400, 92);
  ui.input({ kind: "text", seat, text: "rerelease expansion", timeMilliseconds: 0 });
  expect(text()).toContain("Expansion enemies");
  expect(text()).not.toContain("Monster variety");
  expect(text()).toContain("1 enabled");
  enabled.add("q2:expansion");
  expect(text()).toContain("Disable");
  click(60, 350);
  expect([...enabled]).toEqual(["q2:monsters"]);
  click(250, 350);
  expect(refreshes).toBe(2);
  click(450, 350);
  expect(ui.activeMenu).toBeNull();
  menu.dispose();
});
