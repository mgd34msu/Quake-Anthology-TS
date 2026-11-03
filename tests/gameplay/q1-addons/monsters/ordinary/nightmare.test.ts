// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import type { Q1Actor } from "../../../../../src/content/q1/foundation/entity.ts";
import { ordinaryAddonMonster } from "../../../../../src/content/q1/addons/monsters/ordinary/index.ts";
import { BLOODY_NIGHTMARE_ACTIVE } from "../../../../../src/content/q1/addons/campaign.ts";
import { length } from "../../../../../src/content/q1/foundation/types.ts";
import { world } from "./harness.ts";
import { literal } from "../../../../support/literal.ts";

type Harness = ReturnType<typeof world>;
function monster(h: Harness, classname: string, bloody: boolean, fields: Record<string, string> = {}) {
  h.spawn("worldspawn");
  const entity = h.spawn(classname, { origin: "256 0 0", ...fields });
  if (bloody) h.base.campaign.writeFlags(h.base.campaign.readFlags() | BLOODY_NIGHTMARE_ACTIVE);
  const controller = ordinaryAddonMonster(h.context, entity);
  if (controller === undefined) throw new Error(`Missing controller for ${classname}`);
  controller.enemy = h.player.id;
  return { entity, controller };
}
const live = (h: Harness, classname: string): Q1Actor[] =>
  [...h.game.entities.values()].filter(entity => entity.classname === classname && h.game.live(entity));

test("MG3 shambler answers a run of melee with lightning from skill 3, sooner in Bloody Nightmare, never below skill 3", () => {
  const easy = world("mg3", false, true),
    hard = world("mg3", false, true, false, 3),
    bloody = world("mg3", false, true, false, 3);
  const a = monster(easy, "monster_shambler", false),
    b = monster(hard, "monster_shambler", false),
    c = monster(bloody, "monster_shambler", true);
  const swings = (m: { controller: { play(name: string): undefined; nextFrame: string } }): number => {
    for (let swing = 1; swing <= 10; swing++) {
      m.controller.play("sham_swingr9");
      if (m.controller.nextFrame === "sham_magic1") return swing;
    }
    return 0;
  };
  expect(swings(a)).toBe(0);
  expect(swings(b)).toBe(5);
  expect(swings(c)).toBe(4);
});

test("Bloody Nightmare speeds hell knight spikes and gives enforcers a second laser and wizards extra spikes", () => {
  for (const bloodyFlag of [false, true]) {
    const h = world("mg3", false, true, false, 3),
      knight = monster(h, "monster_hell_knight", bloodyFlag);
    knight.controller.play("hknight_magica9");
    const spike = live(h, "knight_spike")[0];
    if (spike === undefined) throw new Error("No knight spike");
    expect(Math.round(length(h.game.body(spike).velocity))).toBe(bloodyFlag ? 500 : 300);

    const f = world("mg3", false, true, false, 3),
      enforcer = monster(f, "monster_enforcer", bloodyFlag);
    enforcer.controller.play("enf_atk6");
    expect(live(f, "enforcer_laser").length).toBe(bloodyFlag ? 2 : 1);

    const w = world("mg3", false, true, false, 3),
      wizard = monster(w, "monster_wizard", bloodyFlag);
    wizard.controller.play("wiz_fast1");
    for (const timer of live(w, "wizard_fastfire")) w.think(timer, 20);
    expect(live(w, "wizard_spike").length).toBe(bloodyFlag ? 4 : 2);
  }
});

test("MG3 ogre fires a second grenade in Bloody Nightmare", () => {
  for (const bloodyFlag of [false, true]) {
    const h = world("mg3", false, true, false, 3),
      ogre = monster(h, "monster_ogre", bloodyFlag);
    ogre.controller.play("ogre_nail1");
    expect(ogre.entity.number("projectiles_max")).toBe(bloodyFlag ? 2 : 0);
    ogre.controller.play("ogre_nail4");
    expect(live(h, "ogre_grenade").length).toBe(1);
    expect(ogre.controller.nextFrame).toBe(bloodyFlag ? "ogre_nail2" : ogre.controller.nextFrame);
  }
});

test("MG3 ordinary enforcers brush off light hits at skill 3, and MG1 and MG3 demons hit only once per half second of a leap", () => {
  const h = world("mg3", false, true, false, 3),
    enforcer = monster(h, "monster_enforcer", false);
  h.game.time = 10;
  enforcer.controller.pain(h.player.id, 1);
  expect(enforcer.entity.monster?.painFinished).toBe(0);
  const lowSkill = world("mg3", false, true),
    plain = monster(lowSkill, "monster_enforcer", false);
  lowSkill.game.time = 10;
  plain.controller.pain(lowSkill.player.id, 1);
  expect(plain.entity.monster?.painFinished).toBeGreaterThan(10);
  for (const program of literal(["mg1", "mg3"])) {
    const j = world(program, false, true),
      demon = monster(j, "monster_demon1", false);
    j.game.time = 10;
    j.game.setBody(demon.entity, { velocity: { x: 500, y: 0, z: 0 } });
    demon.entity.touch = j.game.named.touch(demon.entity, `${program}:ordinary:monster_jump_touch`);
    const before = j.game.health(j.player.id);
    j.touchBy(demon.entity, j.player.id);
    const first = j.game.health(j.player.id);
    expect(first).toBeLessThan(before);
    demon.entity.touch = j.game.named.touch(demon.entity, `${program}:ordinary:monster_jump_touch`);
    j.touchBy(demon.entity, j.player.id);
    expect(j.game.health(j.player.id)).toBe(first);
  }
});

test("MG3 shalrath missiles home at 285 on Nightmare and wait out their flight time in Bloody Nightmare", () => {
  for (const bloodyFlag of [false, true]) {
    const h = world("mg3", false, true, false, 3),
      shal = monster(h, "monster_shalrath", bloodyFlag);
    h.game.time = 10;
    shal.controller.play("shal_attack9");
    const missile = live(h, "shal_missile")[0];
    if (missile === undefined) throw new Error("No shalrath missile");
    expect(h.pending.get(missile.actor)).toBeCloseTo(bloodyFlag ? 10.1 : 10.512, 2);
    h.game.time = 10.1;
    h.think(missile, 10.1);
    expect(Math.round(length(h.game.body(missile).velocity))).toBe(bloodyFlag ? 400 : 285);
  }
});
