import { expect, test } from "bun:test";
import { q2LayoutOperations, q2NativeHudOperations, type NativeQ2HudFrame, type NativeQ2HudArsenal, type NativeQ2HudEnvironment } from "../../../src/ui/hud/q2-native.ts";

// game/g_spawn.c single_statusbar, preserving each source stat and coordinate.
const singleStatusbar = 'yb -24 xv 0 hnum xv 50 pic 0 if 2 xv 100 anum xv 150 pic 2 endif if 4 xv 200 rnum xv 250 pic 4 endif if 6 xv 296 pic 6 endif yb -50 if 7 xv 0 pic 7 xv 26 yb -42 stat_string 8 yb -50 endif if 9 xv 262 num 2 10 xv 296 pic 9 endif if 11 xv 148 pic 11 endif';
function frame(): NativeQ2HudFrame {
  const stats = Array.from({ length: 32 }, () => 0); stats[0] = 1; stats[1] = 100; stats[2] = 2; stats[3] = 50; stats[4] = 3; stats[5] = 75;
  return { protocol: { kind: "q2-classic", version: 34 }, stats, configstrings: new Map([[5, singleStatusbar], [545, "i_health"], [546, "a_shells"], [547, "i_combatarmor"]]),
    layout: '', inventory: [], playerNumber: 0, serverFrame: 4, timeMilliseconds: 100 };
}
test("API3 authored statusbar reads exact public stats and configstring picture indices", () => {
  const ops = q2NativeHudOperations(frame(), 640, 480);
  expect(ops.slice(0, 4)).toEqual([{ kind: "picture", x: 162, y: 456, name: "num_1" }, { kind: "picture", x: 178, y: 456, name: "num_0" },
    { kind: "picture", x: 194, y: 456, name: "num_0" }, { kind: "picture", x: 210, y: 456, name: "i_health" }]);
  expect(ops).toContainEqual({ kind: "picture", x: 310, y: 456, name: "a_shells" });
  expect(ops).toContainEqual({ kind: "picture", x: 410, y: 456, name: "i_combatarmor" });
  expect(ops.some(op => op.kind === "picture" && op.name === "inventory")).toBe(false);
});
test("svc_layout scoreboard uses public clientinfo and source stat layout gate", () => {
  const source = frame(), stats = [...source.stats]; stats[13] = 1;
  const configstrings = new Map(source.configstrings); configstrings.set(30, "2"); configstrings.set(1312, "Ranger\\male/grunt");
  const snapshot = { ...source, stats, configstrings, layout: 'client 0 0 0 9 20 4 xv 0 yv 40 cstring2 "YOU WIN" ctf 0 56 0 9 1400' };
  const ops = q2NativeHudOperations(snapshot, 640, 480);
  expect(ops).toContainEqual({ kind: "picture", x: 160, y: 120, name: "/players/male/grunt_i.pcx" });
  expect(ops).toContainEqual({ kind: "text", x: 192, y: 120, text: "Ranger", alternate: true });
  expect(ops).toContainEqual({ kind: "text", x: 160, y: 176, text: "  9 999 Ranger      ", alternate: true });
  const overlay = q2NativeHudOperations(snapshot, 640, 480, undefined, "layout-overlay");
  expect(overlay).toContainEqual({ kind: "text", x: 192, y: 120, text: "Ranger", alternate: true });
  expect(overlay.some(op => op.kind === "picture" && op.name === "i_health")).toBe(false);
  stats[13] = 0; expect(q2NativeHudOperations(snapshot, 640, 480).some(op => op.kind === "text" && op.text === "Ranger")).toBe(false);
});
test("svc_inventory retains source item indices, selected-row scroll and exact use bindings", () => {
  const source = frame(), stats = [...source.stats]; stats[13] = 2; stats[12] = 23;
  const inventory = Array.from({ length: 256 }, (_, index) => index >= 2 && index < 27 ? index : 0), configstrings = new Map(source.configstrings);
  for (let index = 2; index < 27; index++) configstrings.set(1056 + index, `Item ${index}`);
  const ops = q2NativeHudOperations({ ...source, stats, inventory, configstrings }, 640, 480, command => command === "use Item 23" ? "Q" : "");
  expect(ops).toContainEqual({ kind: "picture", x: 192, y: 128, name: "inventory" });
  const rows = ops.filter(op => op.kind === "text" && op.text.includes("Item ")); expect(rows).toHaveLength(17);
  expect(rows[0]).toMatchObject({ text: "        10 Item 10", alternate: true });
  expect(rows).toContainEqual({ kind: "text", x: 216, y: 264, text: "     Q  23 Item 23", alternate: false });
  expect(q2NativeHudOperations({ ...source, stats, inventory, configstrings }, 640, 480, undefined, "layout-overlay")).toEqual([]);
});
test("donor numeric flashing, suppression and malformed index boundaries", () => {
  const source = frame(), stats = [...source.stats]; stats[1] = 12; stats[3] = -1; stats[5] = 0; stats[15] = 1;
  const ops = q2LayoutOperations("hnum anum rnum", { ...source, stats }, 320, 240);
  expect(ops.map(op => op.kind === "picture" ? op.name : op.kind === "text" ? op.text : op.kind)).toEqual(["field_3", "anum_1", "anum_2"]);
  expect(() => q2LayoutOperations("pic 999", source, 320, 240)).toThrow("outside playerstate");
});


test("selected arsenal uses original ammo layout while retaining native health, armor and visibility", () => {
  const source = frame(), stats = [...source.stats]; stats[2] = 0; stats[3] = 0;
  const selected: NativeQ2HudArsenal = { ammo: 31, ammoIcon: { resource: "resource:foreign-ammo", aspect: 2 } };
  const ops = q2NativeHudOperations({ ...source, stats }, 640, 480, undefined, undefined, selected);
  expect(ops).toContainEqual({ kind: "picture", x: 278, y: 456, name: "num_3" });
  expect(ops).toContainEqual({ kind: "picture", x: 294, y: 456, name: "num_1" });
  expect(ops).toContainEqual({ kind: "arsenal-picture", x: 310, y: 456, resource: "resource:foreign-ammo", aspect: 2 });
  expect(ops.filter(op => op.kind === "picture" && ["i_health", "i_combatarmor"].includes(op.name)))
    .toEqual(q2NativeHudOperations(source, 640, 480).filter(op => op.kind === "picture" && ["i_health", "i_combatarmor"].includes(op.name)));
  expect(q2NativeHudOperations(source, 640, 480, undefined, undefined, { ammo: null, ammoIcon: null }).some(op => op.kind === "arsenal-picture")).toBe(false);
  expect(q2NativeHudOperations(source, 640, 480, undefined, "layout-overlay", selected)).toEqual([]);
  expect(q2NativeHudOperations({ ...source, configstrings: new Map() }, 640, 480, undefined, undefined, selected)).toEqual([]);
  expect(source.stats[3]).toBe(50);
});


import { LocalizationCatalog } from "../../../src/text/localization.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { q2LocalizedText } from "../../../src/app/bootstrap/q2-localization.ts";

function rerelease(): NativeQ2HudFrame {
  return { ...frame(), protocol: { kind: "q2-rerelease", version: 1038 }, stats: Array.from({ length: 64 }, () => 0),
    configstrings: new Map(), frameTimeMilliseconds: 50 };
}
function environment(): NativeQ2HudEnvironment {
  const catalog = new LocalizationCatalog(createIdentityOwner("native-hud").seat(0), "q2-rerelease");
  catalog.reload(new TextEncoder().encode('g_pc_goals="Goals"\nm_eou_press_button="Press a button"\ng_score_time="Time: {0}"\nlevel="Level"\nscore="Score"\nboss="Boss"\nstory="First line\\nSecond line"\nshells="Shells"'));
  return { useFont: true, fontLineHeight: 10, table: { rows: [], columns: [] },
    measure: text => ({ x: Math.max(...text.split("\n").map(line => line.length * 6)), y: text.split("\n").length * 10 }),
    localize: (text, args) => q2LocalizedText(catalog, text, args) };
}

test("rerelease original help and end-of-unit grammar localizes arguments and uses the source frame clock", () => {
  const source = rerelease(), env = environment();
  // p_hud.cpp HelpComputer/G_EndOfUnit layout, with original argument counts and ifgef.
  const layout = 'xv 265 yv 164 loc_rstring2 1 "{}: 2/4" "$g_pc_goals" if 0 ifgef 0 loc_string 0 "hidden" endif endif ifgef 8 yb -48 xv 0 loc_cstring2 0 "$m_eou_press_button" endif xr -8 yt 8 time_limit 1208';
  const before = q2LayoutOperations(layout, { ...source, serverFrame: 7 }, 640, 480, undefined, env);
  expect(before).toContainEqual({ kind: "font-text", x: 365, y: 283, text: "Goals: 2/4", alternate: true });
  expect(before.some(op => "text" in op && (op.text === "hidden" || op.text === "Press a button"))).toBe(false);
  const after = q2LayoutOperations(layout, { ...source, serverFrame: 8 }, 640, 480, undefined, env);
  expect(after).toContainEqual({ kind: "font-text", x: 278, y: 431, text: "Press a button", alternate: true });
  expect(after).toContainEqual({ kind: "font-text", x: 566, y: 7, text: "Time: 01:00", alternate: true });
  expect(q2LayoutOperations('loc_string 0 "hello"', frame(), 320, 240)).toEqual([]);
  expect(() => q2LayoutOperations('loc_string 8 "bad"', source, 320, 240, undefined, env)).toThrow("source limits");
});

test("rerelease table scratch is scoped to the HUD owner and shared between authored status and svc_layout", () => {
  const source = rerelease(), stats = [...source.stats], env = environment(); stats[13] = 1;
  const configstrings = new Map([[5, 'start_table 2 "$level" "$score" table_row 2 "Outer Base" "12"']]);
  const ops = q2NativeHudOperations({ ...source, stats, configstrings, layout: "xv 160 yt 0 draw_table" }, 640, 480, undefined, undefined, undefined, env);
  expect(ops).toContainEqual({ kind: "fill", x: 272, y: 8, width: 96, height: 18, color: { x: 0, y: 0, z: 0, w: 1 } });
  expect(ops).toContainEqual({ kind: "font-text", x: 287, y: 7, text: "Level", alternate: true });
  expect(ops).toContainEqual({ kind: "font-text", x: 356, y: 16, text: "12", alternate: false });
  expect(q2LayoutOperations("xv 160 yt 0 draw_table", source, 640, 480, undefined, env)).toEqual(ops);
  expect(environment().table?.rows).toEqual([]);
  expect(() => q2LayoutOperations("start_table 6", source, 320, 240, undefined, env)).toThrow("source limits");
});

test("rerelease authored lives, packed health bars, localized names, story and HUD hiding retain source policy", () => {
  const source = rerelease(), stats = [...source.stats], env = environment(); stats[49] = 2; stats[52] = 255 | (128 << 8); stats[8] = 12000; stats[13] = 5;
  const configstrings = new Map([[5, 'string "status hidden"'], [12104, "$boss"], [12105, "$story"], [12000, "##P0"], [11582, "Marine\\male/grunt\\eagle"]]);
  const layout = 'xl 0 yt 20 lives_num 49 health_bars xl 10 yt 80 loc_stat_string 8 dogtag 0 story';
  const ops = q2NativeHudOperations({ ...source, stats, configstrings, layout }, 320, 240, undefined, undefined, undefined, env);
  expect(ops).toContainEqual({ kind: "picture", x: 2, y: 20, name: "anum_0" });
  expect(ops).toContainEqual({ kind: "fill", x: 80, y: 30, width: 160, height: 4, color: { x: 1, y: 0, z: 0, w: 1 } });
  expect(ops).toContainEqual({ kind: "fill", x: 80, y: 42, width: 160, height: 4, color: { x: 80 / 255, y: 80 / 255, z: 80 / 255, w: 1 } });
  expect(ops).toContainEqual({ kind: "font-text", x: 10, y: 79, text: "Marine", alternate: false });
  expect(ops).toContainEqual({ kind: "sized-picture", x: 10, y: 80, width: 198, height: 32, name: "/tags/eagle.pcx" });
  expect(ops).toContainEqual({ kind: "font-text", x: 130, y: 110, text: "First line", alternate: false });
  expect(ops.some(op => "text" in op && op.text === "status hidden")).toBe(false);
  const arsenal: NativeQ2HudArsenal = { ammo: 31, ammoIcon: { resource: "resource:foreign-ammo", aspect: 2 } };
  expect(q2LayoutOperations("if 2 anum pic 2 endif", source, 320, 240, arsenal, env)).toContainEqual({ kind: "arsenal-picture", x: 0, y: 0, resource: "resource:foreign-ammo", aspect: 2 });
});

test("rerelease source inventory has nineteen localized rows and retains its own selected index", () => {
  const source = rerelease(), stats = [...source.stats], env = environment(); stats[13] = 2; stats[12] = 23;
  const inventory = Array.from({ length: 256 }, (_, index) => index >= 2 && index < 27 ? index : 0), configstrings = new Map<number, string>();
  for (let index = 2; index < 27; index++) configstrings.set(11326 + index, index === 23 ? "$shells" : `Item ${index}`);
  const ops = q2NativeHudOperations({ ...source, stats, inventory, configstrings }, 640, 480, undefined, undefined, undefined, env);
  expect(ops).toContainEqual({ kind: "picture", x: 192, y: 140, name: "inventory" });
  expect(ops.filter(op => op.kind === "font-text")).toHaveLength(38);
  expect(ops).toContainEqual({ kind: "font-text", x: 230, y: 278, text: "Shells", alternate: true });
  expect(ops).toContainEqual({ kind: "font-text", x: 402, y: 278, text: "23", alternate: true });
  expect(q2NativeHudOperations({ ...source, stats, inventory, configstrings }, 640, 480, undefined, "layout-overlay", undefined, env)).toEqual([]);
});

test("canonical inventory uses the same selected identity with each source layout and visibility", () => {
  const inventory: NonNullable<NativeQ2HudArsenal["inventory"]> = { items: [
    { item: "q3:weapon/shotgun", label: "Shotgun", count: 1 }, { item: "q3:ammo/shotgun", label: "Shells", count: 42 },
    { item: "q2:key_blue_key", label: "Blue Key", count: 1 }], selected: "q3:weapon/shotgun" };
  const arsenal: NativeQ2HudArsenal = { ammo: 42, ammoIcon: null, inventory };
  for (const base of [frame(), rerelease()]) {
    const stats = [...base.stats]; stats[13] = 2; stats[12] = 999;
    const ops = q2NativeHudOperations({ ...base, stats, inventory: [99] }, 640, 480, command => command === "use Shotgun" ? "2" : "", undefined, arsenal, environment());
    expect(ops.some(op => "text" in op && op.text.includes("Shotgun"))).toBe(true);
    expect(ops.some(op => "text" in op && op.text.includes("Blue Key"))).toBe(true);
    expect(ops.some(op => "text" in op && op.text.includes("42"))).toBe(true);
    if (base.protocol.kind === "q2-classic") expect(ops).toContainEqual({ kind: "text", x: 216, y: 160, text: "     2   1 Shotgun", alternate: false });
    else expect(ops).toContainEqual({ kind: "font-text", x: 230, y: 158, text: "Shotgun", alternate: true });
    stats[13] = 0;
    expect(q2NativeHudOperations({ ...base, stats }, 640, 480, undefined, undefined, arsenal, environment()).some(op => "text" in op && op.text.includes("Shotgun"))).toBe(false);
  }
});


test("selected item HUD uses canonical art and rerelease name while preserving original visibility and expiry", () => {
  const selected: NativeQ2HudArsenal = { ammo: null, ammoIcon: null,
    selectedItem: { label: "$railgun", localizedLabel: "Railgun", icon: { resource: "resource:railgun-owner-icon", aspect: 1 } } };
  for (const base of [frame(), rerelease()]) {
    const stats = [...base.stats], configstrings = new Map(base.configstrings);
    stats[6] = 9;
    configstrings.set(base.protocol.kind === "q2-classic" ? 553 : 10311, "w_blaster");
    const snapshot = { ...base, stats, configstrings };
    const layout = "xl 100 yt 20 if 6 pic 6 endif";
    expect(q2LayoutOperations(layout, snapshot, 320, 240, selected, environment()))
      .toEqual([{ kind: "arsenal-picture", x: 100, y: 20, resource: "resource:railgun-owner-icon", aspect: 1 }]);
    expect(q2LayoutOperations(layout, snapshot, 320, 240, { ...selected, selectedItem: { ...selected.selectedItem, label: "Axe", localizedLabel: "Axe", icon: null } }, environment())).toEqual([]);
    expect(q2LayoutOperations(layout, snapshot, 320, 240, undefined, environment())).toEqual([{ kind: "picture", x: 100, y: 20, name: "w_blaster" }]);
    stats[6] = 0;
    expect(q2LayoutOperations(layout, snapshot, 320, 240, selected, environment())).toEqual([]);
  }
  const base = rerelease(), stats = [...base.stats]; stats[51] = 11327;
  const snapshot = { ...base, stats, configstrings: new Map([[11327, "Blaster"]]) };
  const layout = "xl 100 yt 20 if 51 loc_stat_rstring 51 endif";
  expect(q2LayoutOperations(layout, snapshot, 320, 240, selected, environment()))
    .toEqual([{ kind: "font-text", x: 58, y: 19, text: "Railgun", alternate: false }]);
  expect(q2LayoutOperations("stat_string 51", snapshot, 320, 240, selected, environment()))
    .toEqual([{ kind: "font-text", x: 0, y: -1, text: "$railgun", alternate: false }]);
  stats[51] = 0;
  expect(q2LayoutOperations(layout, snapshot, 320, 240, selected, environment())).toEqual([]);
});
