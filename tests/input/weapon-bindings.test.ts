import { expect, test } from "bun:test";
import { defaultBindings, namedPhysicalInput } from "../../src/input/bindings.ts";
import { baseWeaponBindingItems, resolveWeaponSelection, weaponBindingItem } from "../../src/input/weapon-bindings.ts";
import { bindingMatchesAction, registerBindingMenus } from "../../src/ui/settings/bindings.ts";
import { sharedBindingActions } from "../../src/ui/settings/action-catalog.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { NativeUiController } from "../../src/ui/common/controller.ts";
import { defaultUiSkin } from "../../src/ui/common/skin.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";

test("fresh weapon keys follow selected arsenal independently of movement", () => {
  const q2 = defaultBindings(0, "q1-netquake", baseWeaponBindingItems("q2"));
  const command = (key: string) => q2.find(binding => JSON.stringify(binding.input) === JSON.stringify(namedPhysicalInput(key)))?.target;
  expect(command("1")).toEqual({ kind: "command", text: "use q2:weapon_blaster" });
  expect(command("6")).toEqual({ kind: "command", text: "use q2:weapon_grenadelauncher" });
  expect(command("0")).toEqual({ kind: "command", text: "use q2:weapon_bfg" });
  expect(command("g")).toEqual({ kind: "command", text: "use q2:ammo_grenades" });
  expect(command("SPACE")).toEqual({ kind: "command", text: "+jump" });
  expect(command("q")).toEqual({ kind: "command", text: "+weaponwheel" });
  expect(command("MWHEELUP")).toEqual({ kind: "command", text: "weapprev" });
  expect(command("MWHEELDOWN")).toEqual({ kind: "command", text: "weapnext" });
  const withGrapple = defaultBindings(0, "q2-classic", [...baseWeaponBindingItems("q2"), { id: "q3:weapon/grapple", label: "Grapple", kind: "weapon" }]);
  expect(withGrapple.filter(binding => JSON.stringify(binding.input) === JSON.stringify(namedPhysicalInput("0"))).map(binding => binding.target))
    .toEqual([{ kind: "command", text: "use q2:weapon_bfg" }]);
  for (const family of ["q1", "q3"] satisfies readonly ("q1" | "q3")[]) {
    const bindings = defaultBindings(0, "q2-classic", baseWeaponBindingItems(family));
    expect(bindings.find(binding => JSON.stringify(binding.input) === JSON.stringify(namedPhysicalInput("1")))?.target)
      .toEqual({ kind: "command", text: family === "q1" ? "use q1:weapon/axe" : "use q3:weapon/gauntlet" });
  }
});

test("binding rows preserve moved commands and expose custom targets for removal", () => {
  const owner = createIdentityOwner("weapon-binding-editor"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q3", context });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => input.bindings,
    focus: focus => input.setFocus(focus, 0), sound: () => undefined, executeScript: () => undefined });
  input.bind({ input: { kind: "key", code: 51 }, target: { kind: "command", text: "weapon 3" } });
  input.bind({ input: { kind: "key", code: 103 }, target: { kind: "command", text: "impulse 6" } });
  input.bind({ input: { kind: "key", code: 104 }, target: { kind: "command", text: "myalias; +attack" } });
  const actions = sharedBindingActions("q3", baseWeaponBindingItems("q3"), { chat: false, scoreCommand: null, offhandGrapple: false, offhandGrenades: false })
    .filter(action => action.id === "item:q3:weapon/shotgun");
  const menus = registerBindingMenus(ui, input, actions);
  const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { readonly provider: "ui:test"; readonly content: "q1:rerelease:id1:retail" };
  const draw: UiDrawContext = { binding: { seat, client: owner.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 },
    safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1,
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 0 };
  const labels = () => ui.draw(draw).flatMap(command => command.kind === "text" ? [command.text] : []);
  const click = (x: number, y: number): void => {
    ui.input({ kind: "mouse-motion", seat, timeMilliseconds: 0, position: { x, y }, delta: { x: 0, y: 0 } });
    ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 1, down: true });
    ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 1, down: false });
  };
  try {
    ui.openMenu(menus.root);
    expect(labels()).toContain("Command: impulse 6");
    expect(labels()).toContain("Command: myalias; +attack");
    click(400, 148);
    expect(ui.bindingCapture).toBe(true);
    ui.input({ kind: "key", seat, code: 122, down: true, repeat: false, timeMilliseconds: 0 });
    expect(input.binding({ kind: "key", code: 51 })).toBeNull();
    expect(input.binding({ kind: "key", code: 122 })).toEqual({ kind: "command", text: "weapon 3" });
    labels(); click(578, 172);
    expect(input.binding({ kind: "key", code: 103 })).toBeNull();
    expect(labels()).not.toContain("Command: impulse 6");
    click(578, 172);
    expect(input.binding({ kind: "key", code: 104 })).toBeNull();
  } finally { ui.closeAll(); menus.dispose(); }
});

test("official campaign catalogs use presentation names and include expansion weapons", () => {
  expect(baseWeaponBindingItems("q1").find(item => item.id === "q1:weapon/supershotgun")?.label).toBe("Double-barrelled Shotgun");
  expect(baseWeaponBindingItems("q1", "hipnotic").find(item => item.id === "q1:weapon/hipnotic:laser")?.label).toBe("Laser Cannon");
  expect(defaultBindings(0, "q3", baseWeaponBindingItems("q1", "hipnotic")).find(binding => JSON.stringify(binding.input) === JSON.stringify(namedPhysicalInput("9")))?.target)
    .toEqual({ kind: "command", text: "use q1:weapon/hipnotic:laser" });
  expect(baseWeaponBindingItems("q1", "rogue").some(item => item.id === "q1:weapon/rogue:plasma")).toBe(true);
  expect(baseWeaponBindingItems("q2", "xatrix").find(item => item.id === "q2:weapon_boomer")?.label).toBe("Ionripper");
  expect(baseWeaponBindingItems("q2", "rogue").find(item => item.id === "q2:weapon_etf_rifle")?.label).toBe("ETF Rifle");
  expect(baseWeaponBindingItems("q3").find(item => item.id === "q3:weapon/lightning")?.label).toBe("Lightning Gun");
  expect(baseWeaponBindingItems("q3", "missionpack").find(item => item.id === "q3:weapon/proxlauncher")?.label).toBe("Prox Launcher");
  expect(baseWeaponBindingItems("q3").some(item => item.id === "q3:weapon/proxlauncher")).toBe(false);
});

test("shared dispatch resolves source aliases using selected registered items", () => {
  const q2 = [{ id: "q2:weapon_bfg", label: "bfg", kind: "weapon" }] satisfies readonly import("../../src/input/weapon-bindings.ts").WeaponBindingItem[];
  expect(resolveWeaponSelection("use", ["BFG10K"], q2)).toEqual({ kind: "weapon", item: "q2:weapon_bfg" });
  expect(resolveWeaponSelection("use", ["Super", "Shotgun"], baseWeaponBindingItems("q2"))).toEqual({ kind: "weapon", item: "q2:weapon_supershotgun" });
  expect(resolveWeaponSelection("use", ["supershotgun"], baseWeaponBindingItems("q1"))).toEqual({ kind: "weapon", item: "q1:weapon/supershotgun" });
  expect(resolveWeaponSelection("weapon", ["3"], baseWeaponBindingItems("q3"))).toEqual({ kind: "weapon", item: "q3:weapon/shotgun" });
  expect(resolveWeaponSelection("impulse", ["2"], baseWeaponBindingItems("q1"))).toEqual({ kind: "weapon", item: "q1:weapon/shotgun" });
  expect(resolveWeaponSelection("impulse", ["6"], baseWeaponBindingItems("q1", "hipnotic"))).toBeNull();
  expect(resolveWeaponSelection("impulse", ["4"], baseWeaponBindingItems("q1", "rogue"))).toBeNull();
  expect(resolveWeaponSelection("myalias", ["3"], baseWeaponBindingItems("q3"))).toBeNull();
  expect(resolveWeaponSelection("use", ["BFG10K;quit"], q2)).toBeNull();
});

test("known source commands display under the selected item action", () => {
  const capabilities = { chat: false, scoreCommand: null, offhandGrapple: false, offhandGrenades: false };
  const cases = [
    { items: baseWeaponBindingItems("q1"), command: "impulse 2", id: "q1:weapon/shotgun" },
    { items: baseWeaponBindingItems("q2"), command: 'use "Super Shotgun"', id: "q2:weapon_supershotgun" },
    { items: baseWeaponBindingItems("q2"), command: "use BFG10K", id: "q2:weapon_bfg" },
    { items: baseWeaponBindingItems("q3"), command: "weapon 3", id: "q3:weapon/shotgun" },
    { items: [{ id: "mod:laser", label: "Laser Rifle", kind: "weapon" }] satisfies readonly import("../../src/input/weapon-bindings.ts").WeaponBindingItem[], command: "use Laser Rifle", id: "mod:laser" },
  ];
  for (const entry of cases) {
    const action = sharedBindingActions("q2-classic", entry.items, capabilities).find(action => action.id === `item:${entry.id}`);
    if (action === undefined) throw new Error("Missing item action");
    expect(bindingMatchesAction({ kind: "command", text: entry.command }, action)).toBe(true);
    expect(bindingMatchesAction({ kind: "command", text: `${entry.command}; +attack` }, action)).toBe(false);
    expect(bindingMatchesAction({ kind: "command", text: "my_weapon_alias" }, action)).toBe(false);
  }
  expect(weaponBindingItem("weapon 3", baseWeaponBindingItems("q2"))).toBeNull();
  expect(weaponBindingItem("impulse 2", baseWeaponBindingItems("q3"))).toBeNull();
  expect(weaponBindingItem("weapon 3 4", baseWeaponBindingItems("q3"))).toBeNull();
  expect(weaponBindingItem("impulse 6", [...baseWeaponBindingItems("q1"), { id: "hipnotic:weapon/proximity", label: "Proximity Gun", kind: "weapon" }])).toBeNull();
  expect(weaponBindingItem("use Laser", [{ id: "mod:a", label: "Laser", kind: "weapon" }, { id: "mod:b", label: "Laser", kind: "weapon" }])).toBeNull();
});
