import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { NativeUiController } from "../../src/ui/common/controller.ts";
import { defaultUiSkin } from "../../src/ui/common/skin.ts";
import { registerLibraryMenu } from "../../src/ui/library/menu.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { bindGameplaySettings } from "../../src/ui/settings/gameplay.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
const owner = createIdentityOwner("library-tests"), seat = owner.seat(0);
const controller = () => new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 0, bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
test("library keyboard selection does not activate; explicit Open dispatches selected actual ID", () => {
  const ui = controller(), opened: string[] = []; let refreshes = 0;
  const menu = registerLibraryMenu(ui, "menu:test:library", "Demos", { entries: () => [{ id: "one", label: "Demo one" }, { id: "two", label: "Demo two" }], status: () => "", refresh: () => { refreshes++; }, activate: id => { opened.push(id); } });
  ui.openMenu(menu.root); expect(refreshes).toBe(1);
  const key = (code: number) => ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 1 });
  key(KeyCode.Tab); key(KeyCode.Down); expect(opened).toEqual([]);
  key(KeyCode.Enter); expect(opened).toEqual(["two"]);
  menu.dispose();
});
test("gameplay preferences only expose registered source settings and commit source values", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } } });
  cvars.register("sv_autosave", "1"); cvars.register("name", "Ranger");
  const settings = bindGameplaySettings({ cvars });
  expect(settings.map(setting => setting.label)).toEqual(["Automatic saves", "Player name"]);
  const auto = settings[0]; if (auto?.kind !== "toggle") throw new Error("Expected autosave toggle");
  auto.write(false); expect(cvars.variableValue("sv_autosave")).toBe(0);
  const name = settings[1]; if (name?.kind !== "text-entry") throw new Error("Expected player name");
  name.write("Crash"); expect(cvars.find("name")?.value).toBe("Ranger"); name.commit?.submit("Crash"); expect(cvars.find("name")?.value).toBe("Crash");
});

test("restoring player defaults requires the explicit confirmation action", async () => {
  const { registerSettingsMenus } = await import("../../src/ui/settings/index.ts");
  const ui = controller(); let resets = 0;
  const menus = registerSettingsMenus(ui, [], undefined, { label: "Reset player preferences", apply: () => { resets++; } });
  ui.openMenu(menus.root); ui.openMenu("menu:settings:reset-confirm");
  const key = (code: number) => ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 1 });
  key(KeyCode.Enter); expect(resets).toBe(0);
  ui.openMenu("menu:settings:reset-confirm"); key(KeyCode.Tab); key(KeyCode.Enter); expect(resets).toBe(1);
  menus.dispose();
});

test("inventory controller activation uses the source item and close dispatches putaway", async () => {
  const { registerInventoryMenu } = await import("../../src/ui/library/inventory.ts");
  const ui = controller(), commands: string[] = [];
  const menu = registerInventoryMenu(ui, () => [{ id: "q2:item_quad", label: "Quad damage", count: 1, selected: true, binding: null, icon: null }],
    (name, args) => { commands.push([name, ...args].join(" ")); return undefined; });
  ui.openMenu(menu.root);
  ui.input({ kind: "controller-button", seat, device: 1, button: 0, down: true, timeMilliseconds: 1 });
  expect(commands).toEqual(["use q2:item_quad"]);
  ui.input({ kind: "key", seat, code: KeyCode.Escape, down: true, repeat: false, timeMilliseconds: 2 });
  expect(commands).toEqual(["use q2:item_quad", "putaway"]);
  menu.dispose();
});

test("Arena results preserve an opened progress menu when service returns a fresh snapshot", async () => {
  const { BaseArenaMenus } = await import("../../src/app/bootstrap/base-arena-menu.ts");
  const ui = controller();
  const menus = new BaseArenaMenus(ui, { selection: () => ({ tiers: [], rows: [], current: null }), skill: () => 2, play: () => undefined, result: () => ({ result: { rank: 1, completedTier: 0, unlockedMovie: null, awards: [], nextLevel: 1 },
    podium: [{ client: 0, rank: 1, score: 10 }], musicCommand: "music music/win", winnerAnnouncementAfterMilliseconds: 1000, controls: ["retry", "next", "main"] }),
    playerName: () => "Ranger", progress: () => [], retry: () => undefined, next: () => undefined, quit: () => undefined, reset: () => undefined });
  menus.update(); expect(ui.activeMenu).toBe("menu:application:arena-result");
  ui.openMenu(menus.root); menus.update(); expect(ui.activeMenu).toBe(menus.root);
  menus.close();
});
