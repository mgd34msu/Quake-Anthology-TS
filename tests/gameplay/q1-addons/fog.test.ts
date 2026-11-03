// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { world } from "./monsters/ordinary/harness.ts";
import { literal } from "../../support/literal.ts";

test("MG1 and MG3 teleport pushes the destination fog and intermission pushes the world fog", () => {
  for (const program of literal(["mg1", "mg3"])) {
    const { game, spawn, touch, player, addonEvents } = world(program);
    spawn("worldspawn", { fog_info_entity: "fog_world" });
    spawn("info_fog", { targetname: "fog_world", fog_density: "0.01", fog_color: "0.1 0.2 0.3" });
    spawn("info_fog", { targetname: "fog_abyss", fog_density: "0.2", fog_color: "0.5 0.5 0.5" });
    spawn("info_teleport_destination", { targetname: "dest", origin: "512 0 0", fog_info_entity: "fog_abyss" });
    const teleport = spawn("trigger_teleport", { target: "dest" });
    game.time = 5;
    touch(teleport);
    const fogs = () => addonEvents.flatMap(event => (event.kind === "fog" ? [event] : []));
    expect(fogs().length).toBe(1);
    expect(fogs()[0]).toMatchObject({ kind: "fog", player: player.id, duration: 0 });
    expect(fogs()[0]?.density).toBeCloseTo(0.2, 5);
    spawn("info_intermission", { origin: "0 0 64" });
    game.beginIntermission("start", null);
    expect(fogs().length).toBe(2);
    expect(fogs()[1]).toMatchObject({ kind: "fog" });
    expect(fogs()[1]?.density).toBeCloseTo(0.01, 5);
  }
});

test("teleport does not push fog in coop", () => {
  const { game, spawn, touch, addonEvents } = world("mg3", false, false, true);
  spawn("worldspawn");
  spawn("info_fog", { targetname: "fog_abyss", fog_density: "0.2" });
  spawn("info_teleport_destination", { targetname: "dest", origin: "512 0 0", fog_info_entity: "fog_abyss" });
  game.time = 5;
  touch(spawn("trigger_teleport", { target: "dest" }));
  expect(addonEvents.filter(event => event.kind === "fog").length).toBe(0);
});
