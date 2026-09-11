/* Quake II m_boss3.c. id Software, GPL-2.0-or-later. */
import { zero } from "../../foundation/fields.ts";
import type { Q2SpawnModule, Q2Think } from "../../foundation/host.ts";
import { boss32Frame } from "./tables/boss32.ts";

const think: Q2Think = (entity, game) => {
  entity.frame = entity.frame === boss32Frame.stand260 ? boss32Frame.stand201 : entity.frame + 1;
  game.show(entity);
  return game.schedule(entity, 0.1, think);
};
export const q2Boss3StandModule: Q2SpawnModule = {
  spawn(entity, game) {
    if (entity.classname !== "monster_boss3_stand") return false;
    if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
    entity.model = "models/monsters/boss3/rider/tris.md2"; entity.frame = boss32Frame.stand201;
    game.move(entity, { bounds: { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 90 } } });
    game.motion(entity, "step"); game.solid(entity, "box"); game.show(entity);
    entity.use = (self, services) => { services.host.emit({ kind: "effect", effect: "q2:boss-teleport", origin: services.body(self).origin, direction: zero, count: 1, color: 0 }); return services.remove(self); };
    game.schedule(entity, 0.1, think);
    return true;
  },
};
