import type { Bounds } from "../../../contracts/math.ts";
import { fixQ2StuckPlayer } from "../base/player/landmarks.ts";
import { q2EntitiesNamed, q2PlayersRange } from "../base/player/spawns.ts";
import { add, scale } from "../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think } from "../foundation/host.ts";
import { q2IsN64 } from "./types.ts";
import type { Q2RereleaseOptions } from "./types.ts";

export const q2RereleasePlayerBounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
const startDrop: Q2Think = (entity, game) => {
  game.move(entity, { bounds: q2RereleasePlayerBounds }, false); game.solid(entity, "trigger"); game.motion(entity, "toss"); return game.link(entity);
};
export const q2RereleaseSpawns: Q2SpawnModule = {
  callbacks: { think: { "rr.info_player_start_drop": startDrop } },
  spawn(entity, game) {
    const name = entity.classname;
    if (name !== "info_player_start" && name !== "info_player_coop" && name !== "info_player_coop_lava" && name !== "info_player_intermission" && name !== "info_player_deathmatch") return false;
    if ((name === "info_player_coop" || name === "info_player_coop_lava") && game.options.mode !== "coop" || name === "info_player_deathmatch" && game.options.mode !== "deathmatch") { game.remove(entity); return true; }
    if (name === "info_player_intermission") return true;
    if (name === "info_player_deathmatch") {
      entity.model = "models/objects/dmspot/tris.md2"; entity.skin = 1;
      game.move(entity, { bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } } }, false);
      game.solid(entity, "box"); game.show(entity); return true;
    }
    const origin = game.body(entity).origin;
    if (game.host.trace({ start: origin, end: origin, bounds: q2RereleasePlayerBounds, ignore: entity.actor.id, mask: 1 }).startSolid) {
      const fixed = fixQ2StuckPlayer(entity, game, origin, q2RereleasePlayerBounds);
      if (fixed !== null) game.move(entity, { origin: fixed });
    }
    if (name !== "info_player_coop_lava" && q2IsN64(game)) game.schedule(entity, game.host.frameSeconds(), startDrop);
    return true;
  },
};

export function q2RereleaseSingleSpawn(game: Q2GameServices, spawnPoint: string): Q2Entity | null {
  const starts = q2EntitiesNamed(game, "info_player_start");
  return starts.find(spot => spot.targetname.toLowerCase() === spawnPoint.toLowerCase()) ?? starts.find(spot => spot.targetname === "") ?? starts[0] ?? null;
}

function lavaSpawn(game: Q2GameServices): Q2Entity | null {
  let lavaTop = -99999;
  for (const water of q2EntitiesNamed(game, "func_water")) {
    const body = game.body(water), center = add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5));
    if ((water.spawnflags & 2) !== 0 && (game.host.pointContents(center) & 56) !== 0) lavaTop = Math.max(lavaTop, body.origin.z + body.bounds.max.z);
  }
  if (lavaTop === -99999) return null;
  let best: Q2Entity | null = null, height = 999999;
  for (const spot of q2EntitiesNamed(game, "info_player_coop_lava").slice(0, 64)) {
    const z = game.body(spot).origin.z;
    if (z >= lavaTop + 64 && z < height && q2PlayersRange(game, spot) > 32) { best = spot; height = z; }
  }
  return best;
}

export function selectQ2RereleaseSpawn(game: Q2GameServices, player: Q2Entity, bounds: Bounds, options: Q2RereleaseOptions, spawnPoint: string, force: boolean): Q2Entity | null {
  if (game.options.mode === "singleplayer") return q2RereleaseSingleSpawn(game, spawnPoint);
  if (game.options.mode === "deathmatch") {
    let spots = q2EntitiesNamed(game, "info_player_deathmatch");
    if (spots.length === 0) spots = [...q2EntitiesNamed(game, "info_player_team1"), ...q2EntitiesNamed(game, "info_player_team2")];
    if (spots.length === 0) { const start = q2EntitiesNamed(game, "info_player_start")[0]; if (start !== undefined) spots = [start]; }
    if (spots.length === 0) throw new Error("Q2 rerelease: no valid spawn points found");
    const clear = (spot: Q2Entity): boolean => {
      const origin = add(game.body(spot).origin, { x: 0, y: 0, z: 9 });
      return !game.host.trace({ start: origin, end: origin, bounds, ignore: spot.actor.id, mask: 0x42000000 }).startSolid;
    };
    if (spots.length === 1) { const spot = spots[0]; return spot !== undefined && (force || clear(spot)) ? spot : null; }
    const sorted = [...spots].sort((left, right) => q2PlayersRange(game, left) - q2PlayersRange(game, right));
    if (options.deathmatchSpawnFarthest) { for (const spot of [...sorted].reverse()) if (clear(spot)) return spot; }
    else {
      for (let index = sorted.length - 1; index > 2; index--) {
        const destination = 2 + Math.floor(game.host.random() * (index - 1)), first = sorted[index], second = sorted[destination];
        if (first !== undefined && second !== undefined) { sorted[index] = second; sorted[destination] = first; }
      }
      for (const spot of [...sorted.slice(2), ...sorted.slice(0, 2).reverse()]) if (clear(spot)) return spot;
    }
    return force ? spots[Math.floor(game.host.random() * spots.length)] ?? null : null;
  }
  if (game.options.mapName.toLowerCase() === "rmine2") return lavaSpawn(game);
  const first = q2RereleaseSingleSpawn(game, spawnPoint), coop = q2EntitiesNamed(game, "info_player_coop"), matching = coop.filter(spot => spot.targetname.toLowerCase() === spawnPoint.toLowerCase());
  const candidates = matching.length === 0 ? coop.filter(spot => spot.targetname === "") : matching;
  for (const checkPlayers of [true, false]) {
    for (const spot of first === null ? candidates : [first, ...candidates]) {
      let origin = game.body(spot).origin;
      const exclude = checkPlayers ? [player.actor.id] : game.host.players();
      const trace = () => game.host.trace({ start: origin, end: origin, bounds, ignore: player.actor.id, mask: checkPlayers ? 0x42010003 : 0x2010003, exclude });
      let result = trace();
      if (result.startSolid && !(result.hit.kind === "actor" && game.host.isPlayer(result.hit.actor))) { origin = add(origin, { x: 0, y: 0, z: 1 }); result = trace(); }
      if (result.startSolid && !(result.hit.kind === "actor" && game.host.isPlayer(result.hit.actor))) {
        const fixed = fixQ2StuckPlayer(player, game, origin, bounds);
        if (fixed === null) continue;
        origin = fixed; result = trace();
      }
      if (result.fraction === 1 || !checkPlayers && result.hit.kind === "actor" && game.host.isPlayer(result.hit.actor)) return spot;
    }
  }
  return force || !options.coopPlayerCollision ? first : null;
}
