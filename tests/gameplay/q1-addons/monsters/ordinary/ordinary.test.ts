// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { ordinaryAddonMonster } from "../../../../../src/content/q1/addons/monsters/ordinary/index.ts";
import { spawnShubZombie } from "../../../../../src/content/q1/addons/monsters/bosses/szombie.ts";
import { world } from "./harness.ts";

test("a Shub zombie grenade that lands on world is removed on its next touch instead of throwing", () => {
  const { game, context, spawn, touchBy } = world("mg3", false, true);
  spawn("worldspawn");
  spawn("info_szombie_spawn", { origin: "0 0 0" });
  game.time = 20;
  const zombie = spawnShubZombie(context);
  if (zombie === null) throw new Error("Missing Shub zombie");
  const grenade = game.create("szombie_grenade");
  grenade.owner = zombie.actor.id;
  grenade.movement = "bounce";
  grenade.solid = "bbox";
  grenade.touch = game.named.touch(grenade, "mg3:szombie:grenade_touch");
  const bsp = game.world;
  if (bsp === null) throw new Error("Missing world");
  touchBy(grenade, bsp.actor.id);
  expect(game.live(grenade)).toBe(true);
  touchBy(grenade, bsp.actor.id);
  expect(game.live(grenade)).toBe(false);
});

test("monster_slime spawns as a tarbaby and splits into missiles that become slime tarbabies", () => {
  const { game, context, spawn, think, touchBy } = world("mg3", false, true);
  spawn("worldspawn");
  const slime = spawn("monster_slime", { origin: "0 0 0" });
  expect(slime.classname).toBe("monster_tarbaby");
  expect(slime.number("slime")).toBe(2);
  const controller = ordinaryAddonMonster(context, slime);
  if (controller === undefined) throw new Error("Missing slime controller");
  controller.play("tbaby_die2");
  expect(game.live(slime)).toBe(false);
  const missiles = [...game.entities.values()].filter(entity => entity.model === "progs/v_spike.mdl" && game.live(entity));
  expect(missiles.length).toBe(2);
  for (const missile of missiles) expect(missile.number("slime")).toBe(1);
  const bsp = game.world;
  if (bsp === null) throw new Error("Missing world");
  const before = game.totalMonsters;
  const [first] = missiles;
  if (first === undefined) throw new Error("Missing missile");
  touchBy(first, bsp.actor.id);
  expect(game.live(first)).toBe(false);
  const child = [...game.entities.values()].find(entity => entity.classname === "monster_tarbaby" && game.live(entity) && entity !== slime);
  if (child === undefined) throw new Error("Missing split tarbaby");
  expect(child.number("slime")).toBe(1);
  expect(child.damageable).toBe(false);
  think(child, 0.1);
  expect(child.damageable).toBe(true);
  expect(game.totalMonsters).toBe(before + 1);
});

test("army and dog run through InitMonster: trigger-spawned ones stay hidden and use the source hull", () => {
  const { game, spawn, think } = world("mg3", false, true);
  const hidden = spawn("monster_army", { spawnflags: "4", origin: "0 0 0" });
  expect(hidden.solid).toBe("none");
  expect(hidden.model).toBe("");
  const army = spawn("monster_army", { origin: "64 0 0" }),
    dog = spawn("monster_dog", { origin: "128 0 0" });
  think(army, 1);
  think(dog, 1);
  expect(game.body(army).bounds.max.z).toBe(32);
  expect(game.body(dog).bounds.max.z).toBe(64);
  expect(army.solid).toBe("slidebox");
  expect(dog.solid).toBe("slidebox");
});

test("MG1 killable Chthon wakes with 4000 HP, takes only lightning damage and shocks at the thresholds", () => {
  const { game, context, spawn, think, actors, player } = world("mg1");
  spawn("worldspawn");
  const boss = spawn("monster_boss", { spawnflags: "2", targetname: "chthon", origin: "0 0 0" });
  const controller = ordinaryAddonMonster(context, boss);
  if (controller === undefined) throw new Error("Missing Chthon controller");
  expect(boss.damageable).toBe(false);
  game.named.use(boss, "mg1:ordinary:boss_awake")(player.id, player.id);
  expect(game.health(boss.actor.id)).toBe(4000);
  expect(boss.damageable).toBe(true);
  const owner = actors.resolveOwned(player.id);
  if (owner === null) throw new Error("Missing player owner");
  const state = game.attachPlayer(owner);
  state.weapon = "rocketlauncher";
  game.damage(boss.actor.id, player.id, player.id, 500);
  expect(game.health(boss.actor.id)).toBe(4000);
  state.weapon = "lightning";
  game.damage(boss.actor.id, player.id, player.id, 500);
  expect(game.health(boss.actor.id)).toBe(3500);
  expect(controller.currentFrame).toBe("boss_shockz1");
  game.damage(boss.actor.id, player.id, player.id, 2200);
  expect(game.health(boss.actor.id)).toBe(1300);
  expect(controller.currentFrame).toBe("boss_shockb1");
  game.damage(boss.actor.id, player.id, player.id, 5000);
  expect(game.live(boss) ? controller.currentFrame : "removed").toBe("boss_death1");
  think(boss, 1);
});

test("Shub-Niggurath's zombie and Oldnew share the MG3 monster base that supplies contents damage, ideal_yaw pain walking and FindTarget", async () => {
  const { Mg3Monster } = await import("../../../../../src/content/q1/addons/monsters/ai/controller.ts");
  const { Q1ShubZombie } = await import("../../../../../src/content/q1/addons/monsters/bosses/szombie.ts");
  const { Q1Oldnew } = await import("../../../../../src/content/q1/addons/monsters/bosses/oldnew.ts");
  const zombieParent: unknown = Object.getPrototypeOf(Q1ShubZombie.prototype),
    oldnewParent: unknown = Object.getPrototypeOf(Q1Oldnew.prototype);
  expect(zombieParent).toBe(Mg3Monster.prototype);
  expect(oldnewParent).toBe(Mg3Monster.prototype);
});
