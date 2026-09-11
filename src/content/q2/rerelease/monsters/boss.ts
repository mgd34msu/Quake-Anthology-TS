import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";
import { zero } from "../../foundation/fields.ts";

export function randomBodyPoint(entity: Q2Entity, game: Q2GameServices): Vec3 {
  const { origin, bounds } = game.body(entity), random = game.host.random;
  return { x: origin.x + bounds.min.x + random() * (bounds.max.x - bounds.min.x), y: origin.y + bounds.min.y + random() * (bounds.max.y - bounds.min.y), z: origin.z + bounds.min.z + random() * (bounds.max.z - bounds.min.z) };
}

export const bossExplodeThink: Q2Think = (entity, game) => {
  const owner = game.entity(entity.owner);
  if (owner === null || owner.model !== entity.model) return game.remove(entity);
  game.host.emit({ kind: "effect", effect: entity.viewHeight % 3 === 0 ? "q2:explosion1" : "q2:explosion1-nl", origin: randomBodyPoint(owner, game), direction: zero, count: 1, color: 0 });
  entity.viewHeight++;
  return game.schedule(entity, 0.05 + game.host.random() * 0.15, bossExplodeThink);
};

export function bossExplode({ entity, game }: MonsterContext): undefined {
  if ((entity.spawnflags & (1 << 16)) !== 0) return undefined;
  game.sourceCallbacks.register({ think: { BossExplode_think: bossExplodeThink } });
  const exploder = game.create("boss_exploder");
  exploder.owner = entity.actor.id; exploder.model = entity.model; exploder.visible = false; exploder.viewHeight = 0;
  return game.schedule(exploder, 0.075 + game.host.random() * 0.175, bossExplodeThink);
}
