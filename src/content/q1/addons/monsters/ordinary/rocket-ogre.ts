/* quakec_mg3/monsters/ogre.qc rocket variant. GPL-2.0-or-later. */
import { sameActor } from "../../../../../contracts/identity.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import { createMissile, spriteExplosion } from "../../../base/projectiles.ts";
import { monsterFrames } from "../../../base/frames.ts";
import type { MonsterFrame } from "../../../base/animation.ts";
import type { Q1AddonContext } from "../../context.ts";
import { length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";

export const rocketOgreFrames = new Map<string, MonsterFrame>();
for (const name of ["ogre_stand5", "ogre_walk3", "ogre_run1", "ogre_nail1", "ogre_nail4", "ogre_nail5", "ogre_die3", "ogre_bdie3"]) {
  const frame = monsterFrames.get(name); if (frame === undefined) throw new Error(`Missing ogre frame ${name}`);
  rocketOgreFrames.set(name, { ...frame, operations: frame.operations.filter(op => op.kind !== "sound" && op.kind !== "action") });
}
export function rocketOgreFrame(monster: BaseMonster, name: string): undefined {
  const { game, entity } = monster;
  if (name === "ogre_nail1" || name === "ogre_nail5") entity.fields.set("projectiles", String(entity.number("projectiles_max")));
  if (name === "ogre_nail4") {
    fireRocket(monster); const remaining = entity.number("projectiles") - 1; entity.fields.set("projectiles", String(remaining));
    if (entity.number("projectiles_max") !== 0 && remaining > 0) monster.nextFrame = "ogre_nail2";
  }
  if ((name === "ogre_stand5" || name === "ogre_walk3" || name === "ogre_run1") && game.host.random() < 0.2) {
    const index = (name === "ogre_walk3" ? 3 : 1) + (game.host.random() < 0.5 ? 0 : 1);
    game.sound(entity, `armagon/idle${index}.wav`, "voice", 2);
  }
  return undefined;
}
function fireRocket(monster: BaseMonster): undefined {
  const { game, entity, target, enemy } = monster; if (target === null || enemy === null) return undefined;
  const body = game.host.bodies.read(enemy); if (body === null) return undefined;
  const basis = monster.makeVectors();
  const offset = (entity.number("projectiles_max") - entity.number("projectiles")) * (game.host.random() > 0.5 ? -64 : 64);
  const lead = vscale({ ...body.velocity, z: 0 }, length(vsub(target, monster.origin)) / 1200);
  const aim = vadd(vsub(vadd(vadd(target, { x: 0, y: 0, z: -8 }), lead), vadd(monster.origin, { x: 0, y: 0, z: 16 })), vscale(basis.right, offset));
  entity.effects |= 2; game.sound(entity, "weapons/sgun1.wav", "weapon");
  const missile = createMissile(game, entity.actor.id, "ogre_missile", "missile", vadd(vadd(monster.origin, vscale(basis.forward, 8)), { x: 0, y: 0, z: 16 }), vscale(normalize(aim), 600));
  missile.fields.set("ammo_nails", String(game.time + 0.2)); missile.touch = game.named.touch(missile, "mg3:ordinary:T_OgreMissileTouch");
  return undefined;
}
export function registerRocketOgre(context: Q1AddonContext): undefined {
  context.game.named.register("mg3:ordinary:T_OgreMissileTouch", { touch: (game, missile, other) => {
    if (missile.owner !== null && sameActor(missile.owner, other)) return undefined;
    const body = game.body(missile), origin = body.origin;
    if (game.host.contents(origin) === "sky") return game.remove(missile);
    if (missile.number("ammo_nails") > game.time) {
      game.effect("blood", origin, other, 18); game.damage(other, missile.actor.id, missile.owner, 20); game.effect("knight-spike", origin); return game.remove(missile);
    }
    if (game.health(other) !== 0) {
      const classname = game.entity(other)?.classname;
      game.damage(other, missile.actor.id, missile.owner, classname === "monster_shambler" ? 20 : classname === "monster_zombie" ? 60 : 40);
    }
    game.radiusDamage(missile.actor.id, missile.owner, 40, other, null);
    game.setOrigin(missile, vsub(origin, vscale(normalize(body.velocity), 8))); return spriteExplosion(game, missile);
  } });
  return undefined;
}
