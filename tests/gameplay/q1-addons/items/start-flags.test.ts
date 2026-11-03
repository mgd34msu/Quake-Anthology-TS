// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { world } from "../monsters/ordinary/harness.ts";

test("MG3 base pickups honor rune, SPAWNED and DROPTOFLOOR_DISABLE start flags", () => {
  const { game, spawn, think } = world("mg3");
  const gated = spawn("item_rockets", { spawnflags: String(262144), origin: "0 0 0" });
  expect(game.live(gated)).toBe(false);
  const hidden = spawn("item_shells", { spawnflags: String(4 | 65536), origin: "32 0 0" });
  expect(game.live(hidden)).toBe(true);
  expect(hidden.use).not.toBeNull();
  think(hidden, 0.2);
  expect(game.live(hidden)).toBe(true);
  expect(hidden.solid).toBe("none");
  expect(hidden.model).toBe("");
  expect(game.body(hidden).origin.z).toBe(6);
  game.named.use(hidden, "mg3:items:regenerate")(null, null);
  expect(hidden.solid).toBe("trigger");
  expect(hidden.model).not.toBe("");
  const fixed = spawn("item_health", { spawnflags: String(65536), origin: "64 0 0" });
  think(fixed, 0.2);
  expect(game.live(fixed)).toBe(true);
  expect(fixed.movement).toBe("none");
  expect(game.body(fixed).origin.z).toBe(6);
});

test("MG1 start-item flags: DROPTOFLOOR_DISABLE items stay where placed and coop-only items are removed outside coop", () => {
  const { game, spawn, think } = world("mg1");
  const coopOnly = spawn("item_shells", { spawnflags: String(32768), origin: "0 0 0" });
  expect(game.live(coopOnly)).toBe(false);
  const fixed = spawn("item_armor1", { spawnflags: String(65536), origin: "64 0 0" });
  think(fixed, 0.2);
  expect(game.live(fixed)).toBe(true);
  expect(fixed.movement).toBe("none");
});

test("MG trigger_teleport honors IGNORE_TARGETNAME and the MG3 start-dormant flag", () => {
  const { game, spawn, player, touch } = world("mg3");
  spawn("worldspawn");
  spawn("info_teleport_destination", { targetname: "dest", origin: "512 0 0" });
  const open = spawn("trigger_teleport", { target: "dest", targetname: "tele", spawnflags: "6" });
  game.time = 5;
  touch(open);
  expect(game.host.bodies.read(player.id)?.origin.x).toBe(512);
  const dormant = spawn("trigger_teleport", { target: "dest", targetname: "tele2", spawnflags: "14" });
  expect(dormant.touch).toBeNull();
  game.named.use(dormant, "mg3:teleport_activate")(player.id, player.id);
  expect(dormant.touch).not.toBeNull();
});

test("MG3 cell boxes hold 10 and 20, coop pickups respawn for other players, and a weapon that stays still fires its targets once", () => {
  const { game, spawn, think, touch, actors, player } = world("mg3", false, false, true);
  const owner = actors.resolveOwned(player.id);
  if (owner === null) throw new Error("Missing player owner");
  game.attachPlayer(owner);
  const cells = (): number => game.host.inventory.count(player.id, "q1:ammo/cells");
  const small = spawn("item_cells", { spawnflags: String(65536), origin: "0 0 0" }),
    big = spawn("item_cells", { spawnflags: String(65536 | 1), origin: "64 0 0" });
  think(small, 0.2);
  think(big, 0.2);
  const before = cells();
  touch(small);
  expect(cells() - before).toBe(10);
  const mid = cells();
  touch(big);
  expect(cells() - mid).toBe(20);
  expect(small.solid).toBe("none");
  expect(small.nextThink).toBeGreaterThan(300);
  const weapon = spawn("weapon_rocketlauncher", { spawnflags: String(65536), origin: "128 0 0", target: "ambush" });
  think(weapon, 0.2);
  touch(weapon);
  expect(weapon.target).toBe("");
});

test("MG3 sigils with flag 128 are bound to the regenerate use", () => {
  const { spawn } = world("mg3");
  const sigil = spawn("item_sigil", { spawnflags: String(1 | 128), targetname: "rune", origin: "0 0 0" });
  expect(sigil.use).not.toBeNull();
  expect(sigil.originalModel).toBe("progs/end1.mdl");
});
