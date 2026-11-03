// SPDX-License-Identifier: GPL-2.0-or-later
/* quakec_mg3/monsters/tarbaby.qc: monster_slime, SlimeMissile, SlimeMissileTouch and SlimeStartCheck. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { OwnedActor } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import type { Q1AddonContext } from "../../context.ts";

type MonsterFactory = (context: Q1AddonContext, entity: Q1Actor) => BaseMonster;
const small = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };

/** tbaby_explode without the final BecomeExplosion: the sprite is a visual that ends in a removal. */
function explode(context: Q1AddonContext, entity: Q1Actor): undefined {
  const { game } = context,
    body = game.body(entity);
  game.sound(entity, "blob/death1.wav");
  game.effect("tar-explosion", vsub(body.origin, vscale(normalize(body.velocity), 8)));
  return game.remove(entity);
}

function slimeMissile(context: Q1AddonContext, monster: BaseMonster, origin: Vec3, offset: number): undefined {
  const { game, entity } = monster,
    angles = game.body(entity).angles;
  const missile = game.create("slime_missile");
  missile.classname = "";
  missile.owner = entity.actor.id;
  missile.references.set("enemy", monster.enemy);
  context.setNumber(missile, "slime", entity.number("slime"));
  missile.solid = "bbox";
  missile.movement = "bounce";
  missile.model = "progs/v_spike.mdl";
  const forward = game.makeVectors({ ...angles, y: angles.y + offset }).forward;
  game.setBody(missile, { origin: vadd(origin, { x: 0, y: 0, z: 16 }), velocity: { ...vscale(forward, 200), z: 200 }, bounds: POINT });
  missile.angularVelocity = { x: 300, y: 300, z: 300 };
  missile.touch = game.named.touch(missile, `${context.program}:ordinary:slime_missile_touch`);
  game.schedule(missile, 5, game.named.action(missile, "SUB_Remove"));
  return game.link(missile);
}

/** tbaby_die2 for the MG3 tarbaby: the base explosion, then the monster_slime split. */
export function tarbabyDie2(context: Q1AddonContext): (monster: BaseMonster) => undefined {
  return monster => {
    const { game, entity } = monster,
      body = game.body(entity),
      id = entity.actor.id;
    game.radiusDamage(id, id, 120, null, null);
    game.sound(entity, "blob/death1.wav");
    const origin = vsub(body.origin, vscale(normalize(body.velocity), 8));
    game.effect("tar-explosion", origin);
    if (entity.number("slime") !== 0) {
      context.setNumber(entity, "slime", entity.number("slime") - 1);
      const crandom = (): number => 2 * (game.host.random() - 0.5);
      let offset = 180 + crandom() * 20;
      if (game.host.random() > 0.7) {
        offset = 120 + crandom() * 20;
        slimeMissile(context, monster, origin, offset * -1);
      }
      slimeMissile(context, monster, origin, 0 + crandom() * 20);
      slimeMissile(context, monster, origin, offset);
    }
    return game.remove(entity);
  };
}

export function registerSlime(context: Q1AddonContext, monsters: Map<OwnedActor, BaseMonster>, create: MonsterFactory): undefined {
  const { game } = context,
    prefix = `${context.program}:ordinary`;
  game.registerSpawn("monster_slime", (_game, entity) => {
    game.precacheModel("progs/v_spike.mdl");
    game.precacheSound("shalrath/attack2.wav");
    context.setNumber(entity, "slime", 2);
    entity.classname = "monster_tarbaby";
    context.setNumber(entity, "aflag", 1);
    entity.fields.set("addon.monsterClass", "monster_tarbaby");
    const value = create(context, entity);
    monsters.set(entity.actor, value);
    return value.spawn();
  });
  game.named.register(`${prefix}:slime_missile_touch`, {
    touch: (_game, missile, other) => {
      if (missile.owner !== null && sameActor(missile.owner, other)) return undefined;
      const origin = game.body(missile).origin;
      if (game.health(other) !== 0) {
        game.radiusDamage(missile.actor.id, missile.actor.id, 120, null, null);
        return explode(context, missile);
      }
      const tar = game.create("monster_tarbaby");
      tar.fields.set("addon.monsterClass", "monster_tarbaby");
      const value = create(context, tar);
      monsters.set(tar.actor, value);
      game.setBody(tar, { origin: vadd(origin, { x: 0, y: 0, z: 25 }), angles: { x: 0, y: 2 * (game.host.random() - 0.5) * 180, z: 0 } });
      context.setNumber(tar, "slime", missile.number("slime"));
      value.enemy = missile.references.get("enemy") ?? null;
      tar.idealYaw = game.body(tar).angles.y;
      tar.yawSpeed ||= 20;
      context.setVector(tar, "view_ofs", { x: 0, y: 0, z: 25 });
      game.host.combat.setHealth(tar.actor, 80);
      game.host.combat.setTraits(tar.actor, { team: "q1:monsters" });
      tar.movementFlags |= 32;
      tar.pain = game.named.pain(tar, `${prefix}:monster_pain`);
      tar.die = game.named.die(tar, `${prefix}:monster_die`);
      tar.pathEnd = game.named.action(tar, `${prefix}:monster_stand`);
      context.setNumber(tar, "allowPathFind", 1);
      context.setNumber(tar, "combat_style", 2);
      context.setNumber(tar, "lefty", 1);
      context.setNumber(tar, "state", 1);
      value.lefty = true;
      tar.solid = "slidebox";
      tar.movement = "step";
      tar.model = "progs/tarbaby.mdl";
      tar.fields.set("mdl", "progs/tarbaby.mdl");
      game.setBounds(tar, small);
      value.state.pauseUntil = 99999999;
      game.schedule(tar, 0.1, game.named.action(tar, `${prefix}:slime_start_check`));
      return game.remove(missile);
    },
  });
  game.named.register(`${prefix}:slime_start_check`, {
    action: (_game, entity) => {
      if (!game.host.walkMove(entity.actor, 0, 0)) return explode(context, entity);
      entity.aimedDamage = true;
      entity.damageable = true;
      game.totalMonsters++;
      return game.schedule(entity, 0.1, game.named.action(entity, `${prefix}:monster_found`));
    },
  });
  return undefined;
}
