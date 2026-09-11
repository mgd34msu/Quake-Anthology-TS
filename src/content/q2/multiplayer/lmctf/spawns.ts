/* LM_CTF p_client.c SelectTeamSpawnPoint/SelectAnySpawnPoint. GPL-2.0-or-later. */
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { add } from "../../foundation/fields.ts";
import { q2EntitiesNamed, q2PlayersRange, selectQ2Spawn } from "../../base/player/spawns.ts";
import { lmctfPlayer } from "./types.ts";
import type { LmctfContext } from "./types.ts";

export function lmctfTeamSpawn(context: LmctfContext, entity: Q2Entity, game: Q2GameServices): Q2Entity | null {
  const spots = q2EntitiesNamed(game, lmctfPlayer(context, entity.actor.id).team === 1 ? "info_player_red" : "info_player_blue");
  let best: Q2Entity | null = null, distance = 0;
  for (const spot of spots) { const current = q2PlayersRange(game, spot); if (current > distance) { best = spot; distance = current; } }
  return best ?? spots[0] ?? null;
}
export function selectLmctfSpawn(context: LmctfContext, entity: Q2Entity, game: Q2GameServices) {
  const state = lmctfPlayer(context, entity.actor.id), player = context.hooks.player(entity.actor.id);
  if (player === null) throw new Error("LMCTF spawn needs the admitted source player");
  let spot = state.spawnState === 0 ? lmctfTeamSpawn(context, entity, game) : null; state.spawnState = 1;
  if (spot === null && q2EntitiesNamed(game, "info_player_deathmatch").length > 0) {
    const deathmatch = selectQ2Spawn(game, player, ""), team = lmctfTeamSpawn(context, entity, game);
    spot = team === null || q2PlayersRange(game, deathmatch) > q2PlayersRange(game, team) ? deathmatch : team;
  }
  spot ??= q2EntitiesNamed(game, "info_flag_red")[0] ?? q2EntitiesNamed(game, "info_flag_blue")[0] ?? null;
  spot ??= selectQ2Spawn(game, player, "");
  return { origin: add(game.body(spot).origin, { x: 0, y: 0, z: 9 }), angles: game.body(spot).angles };
}
