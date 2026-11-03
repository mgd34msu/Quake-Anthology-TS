// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import type { Q1Actor } from "../../../src/content/q1/foundation/entity.ts";
import { world } from "./monsters/ordinary/harness.ts";
import { restoreCoopWeapons } from "../../../src/content/q1/addons/index.ts";
import { literal } from "../../support/literal.ts";

test("MG coop checkpoints: only ungated points are active until a trigger fires, and a trigger activates only the points it targets", () => {
  for (const program of ["mg1", "mg3"] satisfies readonly ("mg1" | "mg3")[]) {
    const { game, base, spawn, player } = world(program, false, false, true);
    spawn("info_player_start", { origin: "0 0 0" });
    const open = spawn("info_player_coop", { origin: "64 0 0" }),
      first = spawn("info_player_coop", { origin: "128 0 0", targetname: "cp1" });
    const second = spawn("info_player_coop", { origin: "192 0 0", targetname: "cp2" }),
      flagged = spawn("info_player_coop", { origin: "256 0 0", targetname: "cp3", spawnflags: "1" });
    expect([open.activated, first.activated, second.activated, flagged.activated]).toEqual([true, false, false, true]);
    const seen = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const point = base.spawnSelector.select();
      if (point !== null && point.classname === "info_player_coop") seen.add(game.body(point).origin.x);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([64, 256]);
    const trigger = spawn("trigger_activate_coop_spawns", { target: "cp1" });
    game.named.use(trigger, "mg:coop_spawns_use")(player.id, player.id);
    expect([open.activated, first.activated, second.activated, flagged.activated]).toEqual([false, true, false, false]);
    expect(game.live(trigger)).toBe(true);
    const after = new Set<Q1Actor>();
    for (let i = 0; i < 6; i++) {
      const point = base.spawnSelector.select();
      if (point !== null && point.classname === "info_player_coop") after.add(point);
    }
    expect([...after]).toEqual([first]);
  }
});

test("MG coop respawn restores the team's weapons recorded on the checkpoint and tops ammo up to the floors", () => {
  for (const program of ["mg1", "mg3"] satisfies readonly ("mg1" | "mg3")[]) {
    const { game, spawn, player, actors, context } = world(program, false, false, true);
    const owner = actors.resolveOwned(player.id);
    if (owner === null) throw new Error("Missing player owner");
    const have = (weapon: "rocketlauncher" | "lightning" | "nailgun"): number => game.host.inventory.count(player.id, game.weaponItem(weapon));
    for (const weapon of literal(["rocketlauncher", "lightning"])) game.host.inventory.give(owner, game.weaponItem(weapon), 1);
    const checkpoint = spawn("info_player_coop", { origin: "128 0 0", targetname: "cp1" });
    game.named.use(spawn("trigger_activate_coop_spawns", { target: "cp1" }), "mg:coop_spawns_use")(player.id, player.id);
    const remembered = checkpoint.text("coop.weapons").split(" ");
    expect(remembered).toContain("lightning");
    expect(remembered).toContain("rocketlauncher");
    for (const weapon of literal(["rocketlauncher", "lightning"])) game.host.inventory.consume(owner, game.weaponItem(weapon), 1);
    game.host.inventory.consume(owner, "q1:ammo/rockets", game.host.inventory.count(player.id, "q1:ammo/rockets"));
    game.host.inventory.consume(owner, "q1:ammo/cells", game.host.inventory.count(player.id, "q1:ammo/cells"));
    game.host.inventory.give(owner, "q1:ammo/cells", 20);
    expect(have("rocketlauncher")).toBe(0);
    restoreCoopWeapons(context, player.id, checkpoint);
    expect(have("rocketlauncher")).toBe(1);
    expect(have("lightning")).toBe(1);
    expect(have("nailgun")).toBe(0);
    expect(game.host.inventory.count(player.id, "q1:ammo/rockets")).toBe(4);
    expect(game.host.inventory.count(player.id, "q1:ammo/cells")).toBe(20);
    expect(game.host.inventory.count(player.id, "q1:ammo/nails")).toBe(0);
  }
});
