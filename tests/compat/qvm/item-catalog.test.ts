import { expect, test } from "bun:test";
import { parseQvmItemLayout, readQvmItemCatalog, readQvmItemRecords } from "../../../src/compat/qvm/item-catalog.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { q3GuestPlayerUi } from "../../../src/app/bootstrap/simulation/q3/guest-player.ts";
import { toQ3PlayerState } from "../../../src/network/q3/adapters.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";

test("source item layout and all-weapons mask retain a mod's labels and weapon ordinals", () => {
  const layout = parseQvmItemLayout(new SaveReader({ address: 16, count: 2, stride: 20,
    fields: { className: 4, pickupName: 12, type: 0, tag: 8 }, weaponType: 7, ammoType: 9 }));
  const data = new Uint8Array(256), view = new DataView(data.buffer);
  let next = 80;
  const string = (value: string) => { const start = next; data.set(new TextEncoder().encode(value), next); next += value.length + 1; return start; };
  for (const [index, type, name, label] of [[0, 7, "weapon_arc", "Arc Thrower"], [1, 9, "ammo_arc", "Arc Charges"]] satisfies readonly (readonly [number, number, string, string])[]) {
    const offset = 16 + index * 20;
    view.setInt32(offset, type, true); view.setInt32(offset + 4, string(name), true);
    view.setInt32(offset + 8, 14, true); view.setInt32(offset + 12, string(label), true);
  }
  expect(readQvmItemCatalog(data, layout)).toEqual([
    { className: "weapon_arc", pickupName: "Arc Thrower", type: 7, tag: 14 },
    { className: "ammo_arc", pickupName: "Arc Charges", type: 9, tag: 14 },
  ]);
  view.setInt32(16, 3, true); view.setInt32(24, 0, true);
  expect(readQvmItemRecords(data, layout)[0]).toEqual({ index: 0, address: 16, className: "weapon_arc", pickupName: "Arc Thrower", type: 3, tag: 0 });
  expect(readQvmItemCatalog(data, layout)).toEqual([{ className: "ammo_arc", pickupName: "Arc Charges", type: 9, tag: 14 }]);
  const state = new PlayerStateRecord("baseq3", 0, 14, 0);
  state.stats.set(2, -1); state.ammo.set(14, -1);
  const ui = q3GuestPlayerUi(toQ3PlayerState(state), { provider: "q3:official", content: "q3:classic:baseq3:installed" }, 0,
    [{ weapon: 14, item: "q3:weapon/arc", ammo: "q3:ammo/arc", label: "Arc Thrower" }]);
  expect(ui.activeWeapon).toBe("q3:weapon/arc");
  expect(ui.items).toEqual([{ id: "q3:weapon/arc", label: "Arc Thrower", kind: "weapon", sourceOrdinal: 14, owned: true, hasAmmo: true, count: -1, warningCount: 0 }]);
  expect(ui.weaponStatus?.ammo.kind).toBe("unmetered");
  expect(() => readQvmItemCatalog(data, { ...layout, count: 100 })).toThrow("exceeds initialized");
  expect(() => parseQvmItemLayout(new SaveReader({ ...layout, fields: { ...layout.fields, tag: 20 } }))).toThrow("exceeds its record");
});

test("Team Arena uses its own weapon and armor stat indices", () => {
  const state = new PlayerStateRecord("missionpack", 0, 12, 0);
  state.stats.set(2, 99); state.stats.set(3, 1 << 12); state.stats.set(4, 75); state.ammo.set(12, 8);
  const ui = q3GuestPlayerUi(toQ3PlayerState(state), { provider: "q3:official", content: "q3:classic:baseq3:installed" }, 0, undefined, "missionpack");
  expect(ui.activeWeapon).toBe("q3:weapon/proxlauncher");
  expect(ui.items.find(item => item.id === "q3:weapon/proxlauncher")?.owned).toBe(true);
  expect(ui.armor).toEqual({ regular: { kind: "q3", points: 75, protection: Math.fround(0.66) }, powered: { kind: "none" } });
  expect(ui.ammo?.count).toBe(8);
});
