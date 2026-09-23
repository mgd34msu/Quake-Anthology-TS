import { expect, test } from "bun:test";
import { q2LayoutOperations, q2NativeHudOperations, type NativeQ2HudFrame } from "../../../src/ui/hud/q2-native.ts";

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
  expect(ops.map(op => op.kind === "picture" ? op.name : op.text)).toEqual(["field_3", "anum_1", "anum_2"]);
  expect(() => q2LayoutOperations("pic 999", source, 320, 240)).toThrow("outside playerstate");
});
