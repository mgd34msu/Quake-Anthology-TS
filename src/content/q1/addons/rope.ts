/* quakec_mg3/misc_rope.qc. Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { Q1Actor } from "../foundation/entity.ts";
import { POINT, length, vadd, vsub } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

export function registerAddonRopes(context: Q1AddonContext): undefined {
  const { game } = context, tick = "mg3:rope:tick";
  const next = (entity: Q1Actor): Q1Actor | null => game.entity(entity.references.get("rope.chain") ?? null);
  game.named.register(tick, { action: (_game, entity) => {
    const origin = entity.vector("oldorigin");
    const top = game.host.trace({ start: origin, end: vadd(origin, { x: 0, y: 0, z: 2048 }), bounds: POINT, ignore: entity.actor.id, monsters: false });
    const bottom = game.host.trace({ start: origin, end: vadd(origin, { x: 0, y: 0, z: -2048 }), bounds: POINT, ignore: entity.actor.id, monsters: false });
    let segments = Math.floor(length(vsub(bottom.end, top.end)) / 32);
    const models = Math.max(0, Math.min(32, Math.floor(segments / 4)));
    while (models < entity.count) {
      const first = next(entity), following = first === null ? null : next(first);
      if (first?.classname === "misc_rope_segment") game.remove(first);
      entity.references.set("rope.chain", following?.actor.id ?? null); entity.count--;
    }
    while (models > entity.count) {
      const segment = game.create("misc_rope_segment"); segment.model = "progs/ropex.mdl"; segment.frame = 3; segment.skin = entity.skin;
      segment.solid = "none"; segment.damageable = false; segment.movement = "none";
      // Source sets the parent bounds here, then sets its final bounds below.
      game.setBounds(entity, { min: { x: -4, y: -4, z: 0 }, max: { x: 4, y: 4, z: 128 } });
      segment.references.set("rope.chain", entity.references.get("rope.chain") ?? null); entity.references.set("rope.chain", segment.actor.id); entity.count++;
    }
    let segment = next(entity), position = bottom.end;
    for (let index = 0; index < models; index++) {
      if (segment === null) throw new Error("misc_rope lost its source segment chain");
      game.setOrigin(segment, position); position = vadd(position, { x: 0, y: 0, z: 128 }); segment = next(segment); segments -= 4;
    }
    game.setOrigin(entity, position); entity.frame = segments;
    return game.setBounds(entity, { min: { x: -4, y: -4, z: 0 }, max: { x: 4, y: 4, z: 32 * (segments + 1) } });
  } });
  game.registerSpawn("misc_rope", (_game, entity) => {
    entity.model = "progs/ropex.mdl"; entity.skin = entity.number("skin"); context.setVector(entity, "oldorigin", game.body(entity).origin);
    entity.count = 0; entity.solid = "none"; entity.damageable = false; entity.movement = "none";
    game.setBounds(entity, { min: { x: -4, y: -4, z: 0 }, max: { x: 4, y: 4, z: 32 } });
    return context.addFrameTick(entity, tick);
  });
  return undefined;
}
