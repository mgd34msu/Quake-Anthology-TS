/* hipholes.qc: shotgun bullet holes, at most ten sprites that last 300 seconds. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { POINT, vscale, vsub } from "../../foundation/types.ts";
import { velocityAngles } from "../types.ts";

const LIMIT = 10;
export function registerHipnoticBulletHoles(game: Q1EntityServices): undefined {
  game.worldPrecaches.push(() => { game.precacheModel("progs/s_bullet.spr"); });
  game.named.register("hip:remove_bullethole", { action: (g, hole) => g.remove(hole) });
  game.sourceBulletHole = (shooter, position, normal) => {
    const holes = [...game.entities.values()].filter(entity => entity.classname === "bullethole" && game.live(entity));
    const hole: Q1Actor = game.create("bullethole"); hole.model = "progs/s_bullet.spr"; hole.solid = "none"; hole.movement = "none";
    const direction = { x: -normal.x, y: -normal.y, z: normal.z };
    const body = game.host.bodies.read(shooter.id), forward = game.makeVectors(body?.angles ?? { x: 0, y: 0, z: 0 }).forward;
    game.setBody(hole, { origin: vsub(position, vscale(forward, 0.2)), bounds: POINT, angles: velocityAngles(direction) });
    game.link(hole); game.schedule(hole, 300, game.named.action(hole, "hip:remove_bullethole"));
    const oldest = holes[0]; if (holes.length + 1 > LIMIT && oldest !== undefined) game.remove(oldest);
  };
  return undefined;
}
