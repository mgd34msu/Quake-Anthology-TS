// SPDX-License-Identifier: GPL-2.0-or-later
/* quakec_mg3 monsters/{shambler,ogre,shalrath}.qc skill and Bloody Nightmare behavior. GPL-2.0-or-later. */
import type { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterFrame, MonsterOperation } from "../../../base/animation.ts";
import { monsterFrames } from "../../../base/frames.ts";
import { monsterAction } from "../../../base/monster-actions.ts";
import { createMissile } from "../../../base/projectiles.ts";
import { length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import type { Q1AddonContext } from "../../context.ts";

const action = (name: string): MonsterOperation => ({ kind: "action", name });
function withAction(frame: string, name: string): readonly [string, MonsterFrame] {
  const source = monsterFrames.get(frame);
  if (source === undefined) throw new Error(`Missing native frame ${frame}`);
  return [frame, { ...source, operations: [...source.operations, action(name)] }];
}
/** Frames whose MG3 body runs a statement the id1 frame does not have. */
export const mg3NightmareFrames: ReadonlyMap<string, MonsterFrame> = new Map([
  withAction("sham_smash12", "sham_smash12"),
  withAction("ogre_nail1", "ogre_nail1"),
  withAction("ogre_nail5", "ogre_nail5"),
]);

/** nightmare_attack_check: after a run of melee the shambler answers with lightning, from skill 3 and sooner in Bloody Nightmare. */
function nightmareAttackCheck(monster: BaseMonster): boolean {
  const { game, entity } = monster,
    bloody = game.sourceBloodyNightmare?.() === true;
  const cap = 3 + Math.floor(game.host.random() * 2 + 0.5) - (bloody ? 1 : 0);
  if (game.options.skill <= 2) return false;
  entity.count++;
  return entity.count > cap;
}
function afterMelee(name: string): (monster: BaseMonster) => undefined {
  return monster => {
    if (nightmareAttackCheck(monster)) {
      monster.nextFrame = "sham_magic1";
      return undefined;
    }
    return name === "sham_smash12" ? undefined : monsterAction(monster, name);
  };
}
export const mg3NightmareActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ["sham_smash12", afterMelee("sham_smash12")],
  ["sham_swingl9", afterMelee("sham_swingl9")],
  ["sham_swingr9", afterMelee("sham_swingr9")],
  [
    "sham_magic6",
    monster => {
      if (monster.game.options.skill > 2) monster.entity.count = 0;
      return monsterAction(monster, "sham_magic6");
    },
  ],
  [
    "ogre_nail1",
    monster => {
      const { game, entity } = monster;
      if (entity.number("aflag") === 0) entity.fields.set("projectiles_max", game.sourceBloodyNightmare?.() === true && game.host.random() > 0.3 ? "2" : "0");
      entity.fields.set("projectiles", String(entity.number("projectiles_max")));
      return undefined;
    },
  ],
  [
    "ogre_nail4",
    monster => {
      const { entity } = monster;
      monsterAction(monster, "ogre_nail4");
      const remaining = entity.number("projectiles") - 1;
      entity.fields.set("projectiles", String(remaining));
      if (entity.number("projectiles_max") !== 0 && remaining > 0) monster.nextFrame = "ogre_nail2";
      return undefined;
    },
  ],
  [
    "ogre_nail5",
    monster => {
      monster.entity.fields.set("projectiles", String(monster.entity.number("projectiles_max")));
      return undefined;
    },
  ],
  ["shal_attack9", monster => launchShalMissile(monster)],
]);

function launchShalMissile(monster: BaseMonster): undefined {
  const { game, entity } = monster,
    enemy = monster.enemy;
  if (enemy === null) return undefined;
  const target = game.host.bodies.read(enemy);
  if (target === null) return undefined;
  const aim = vadd(target.origin, { x: 0, y: 0, z: 10 }),
    dir = normalize(vsub(aim, monster.origin));
  const flytime = Math.max(0.1, length(vsub(target.origin, monster.origin)) * 0.002);
  entity.effects |= 2;
  game.sound(entity, "shalrath/attack2.wav", "weapon");
  const missile = createMissile(game, entity.actor.id, "shal_missile", "v_spike", vadd(monster.origin, { x: 0, y: 0, z: 10 }), vscale(dir, 400), 5);
  missile.angularVelocity = { x: 300, y: 300, z: 300 };
  missile.references.set("enemy", enemy);
  if (game.sourceBloodyNightmare?.() === true) {
    missile.fields.set("ltime", String(game.time + flytime));
    game.schedule(missile, 0.1, game.named.action(missile, "mg3:ordinary:shal_home"));
  } else game.schedule(missile, flytime, game.named.action(missile, "mg3:ordinary:shal_home"));
  missile.touch = game.named.touch(missile, "base:vore_touch");
  return undefined;
}
function shalHome(context: Q1AddonContext, missile: Q1Actor): undefined {
  const { game } = context,
    target = missile.references.get("enemy") ?? null,
    enemy = target === null ? null : game.host.bodies.read(target);
  if (enemy === null || target === null || game.health(target) < 1) return game.remove(missile);
  const here = game.body(missile).origin;
  let dir = normalize(vsub(vadd(enemy.origin, { x: 0, y: 0, z: 10 }), here));
  if (game.sourceBloodyNightmare?.() === true && game.time < missile.number("ltime"))
    return game.schedule(missile, 0.1, game.named.action(missile, "mg3:ordinary:shal_home"));
  const speed = game.options.skill === 3 ? 285 : 250,
    reach = 32;
  let nearest: Q1Actor | null = null,
    nearestDistance = reach;
  for (const other of game.entities.values()) {
    if (other.classname !== "shal_missile" || other === missile) continue;
    const distance = length(vsub(game.body(other).origin, here));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = other;
    }
  }
  const ratio = nearestDistance / reach,
    push = 0.25 - ratio * ratio * 0.25;
  if (nearest !== null) dir = vadd(vscale(dir, 1 - push), vscale(normalize(vsub(here, game.body(nearest).origin)), push));
  game.setBody(missile, { velocity: vscale(dir, speed) });
  return game.schedule(missile, 0.1, game.named.action(missile, "mg3:ordinary:shal_home"));
}
export function registerMg3Nightmare(context: Q1AddonContext): undefined {
  context.game.named.register("mg3:ordinary:shal_home", { action: (_game, missile) => shalHome(context, missile) });
  return undefined;
}
