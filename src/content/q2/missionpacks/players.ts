/* Original Rogue p_client.c lava-level cooperative spawn selection. */
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../foundation/host.ts";
import { add, length, scale, subtract } from "../foundation/fields.ts";

export class Q2RoguePlayerSpawns implements Q2SpawnModule {
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (game.options.edition !== "classic" || entity.classname !== "info_player_coop_lava") return false;
    if (game.options.mode !== "coop") game.remove(entity);
    return true;
  }

  selectSpawn(game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 } | null {
    if (game.options.edition !== "classic" || game.options.mode !== "coop" || !["rmine2", "rmine2p"].includes(game.options.mapName.toLowerCase())) return null;
    let lavaTop = -99999, highestLava: Q2Entity | null = null;
    for (const lava of game.entities.values()) {
      if (lava.classname !== "func_door" || (lava.spawnflags & 2) === 0) continue;
      const body = game.body(lava), center = add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5));
      if ((game.host.pointContents(center) & 56) !== 0 && body.origin.z + body.bounds.max.z > lavaTop) {
        lavaTop = body.origin.z + body.bounds.max.z; highestLava = lava;
      }
    }
    if (highestLava === null) return null;
    lavaTop += 64;
    let count = 0, lowest = 999999, selected: Q2Entity | null = null;
    for (const point of game.entities.values()) {
      if (point.classname !== "info_player_coop_lava") continue;
      if (++count > 64) break;
      const origin = game.body(point).origin;
      if (origin.z < lavaTop) continue;
      let distance = 9999999;
      for (const player of game.host.players()) {
        const body = game.host.bodies.read(player);
        if (body !== null && (game.host.combat.read(player)?.health ?? 0) > 0) distance = Math.min(distance, length(subtract(origin, body.origin)));
      }
      if (distance > 32 && origin.z < lowest) { selected = point; lowest = origin.z; }
    }
    if (selected === null) return null;
    const body = game.body(selected);
    return { origin: add(body.origin, { x: 0, y: 0, z: 9 }), angles: body.angles };
  }
}
