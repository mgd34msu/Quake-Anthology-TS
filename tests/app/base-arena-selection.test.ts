import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { parseBaseArenaCatalog } from "../../src/app/bootstrap/base-arena-catalog.ts";
import { BaseArenaProgression } from "../../src/app/bootstrap/base-arena-progression.ts";
import { arenaSelection } from "../../src/app/bootstrap/base-arena-selection.ts";
import { registerArenaSelectionMenu } from "../../src/app/bootstrap/base-arena-select-menu.ts";
import { NativeUiController } from "../../src/ui/common/controller.ts";
import { defaultUiSkin } from "../../src/ui/common/skin.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { BaseArenaMenus } from "../../src/app/bootstrap/base-arena-menu.ts";

function setup() {
  const owner = createIdentityOwner("arena-selection-test"), seat = owner.seat(0);
  const catalog = parseBaseArenaCatalog([`{ map q3dm0 longname Training type single special training bots Crash }
    { map q3dm1 longname "Arena one" type single bots "Sarge Grunt" fraglimit 15 }
    { map q3dm2 type single } { map q3dm3 type single } { map q3dm4 type single }
    { map q3tourney6 type single special final bots Xaero }`]);
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
  const progress = new BaseArenaProgression(cvars, { regularLevels: 4, training: 4, final: 5, totalLevels: 6 });
  const ui = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 0, bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  return { catalog, progress, cvars, ui, seat };
}

test("arena selection retains authored tiers, opponents, limits and archived unlocks", () => {
  const { catalog, progress, cvars } = setup();
  const locked = arenaSelection(catalog, progress);
  expect(locked.tiers.map(tier => tier.label)).toEqual(["Training", "Tier 1", "Final arena"]);
  expect(locked.current).toBe("maps/q3dm0.bsp");
  expect(locked.rows.filter(row => row.available).map(row => row.arena.map)).toEqual(["maps/q3dm0.bsp"]);
  cvars.set("g_spScores3", "\\l4\\1", true);
  const unlocked = arenaSelection(catalog, progress);
  expect(unlocked.current).toBe("maps/q3dm1.bsp");
  expect(arenaSelection(catalog, progress, "-4").current).toBe("maps/q3dm0.bsp");
  expect(arenaSelection(catalog, progress, "4").current).toBe("maps/q3dm1.bsp");
  expect(unlocked.rows.find(row => row.arena.map === "maps/q3dm1.bsp")?.arena.bots).toEqual(["Sarge", "Grunt"]);
  expect(unlocked.rows.find(row => row.arena.map === "maps/q3dm1.bsp")?.arena.fragLimit).toBe(15);
  expect(unlocked.rows.find(row => row.arena.special === "final")?.available).toBe(false);
});

test("public arena menu can inspect locked tiers but only launches unlocked authored maps", () => {
  const { catalog, progress, ui, seat } = setup(), launched: string[] = [];
  const dispose = registerArenaSelectionMenu(ui, "menu:test:arenas", { read: () => arenaSelection(catalog, progress), choose: map => { launched.push(map); } });
  ui.openMenu("menu:test:arenas");
  const key = (code: number) => ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 1 });
  key(KeyCode.Right); key(KeyCode.Tab); key(KeyCode.Enter);
  expect(launched).toEqual([]);
  ui.closeMenu(); ui.openMenu("menu:test:arenas"); key(KeyCode.Tab); key(KeyCode.Enter);
  expect(launched).toEqual(["maps/q3dm0.bsp"]);
  dispose();
});

test("arena selection retains recovery controls while a replacement world is still pending", () => {
  const { catalog, progress, ui, seat } = setup(), requested: string[] = [];
  const menus = new BaseArenaMenus(ui, {
    selection: () => arenaSelection(catalog, progress), skill: () => 2,
    play: (map, skill) => { requested.push(`${map}:${skill}`); },
    result: () => ({ result: { rank: 1, completedTier: 0, unlockedMovie: null, awards: [], nextLevel: 0 },
      podium: [], musicCommand: "music music/win", winnerAnnouncementAfterMilliseconds: 1000, controls: ["retry", "next", "main"] }),
    playerName: () => "Player", progress: () => [], retry: () => undefined, next: () => undefined, quit: () => undefined, reset: () => undefined,
  });
  menus.update(); ui.openMenu("menu:application:arena-selection");
  const key = (code: number) => ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 1 });
  key(KeyCode.Tab); key(KeyCode.Enter); key(KeyCode.Enter);
  expect(requested).toEqual(["maps/q3dm0.bsp:1"]);
  menus.update();
  expect(ui.activeMenu).toBe("menu:application:arena-skill");
  key(KeyCode.Escape); key(KeyCode.Escape);
  expect(ui.activeMenu).toBe("menu:application:arena-result");
  menus.close();
});
