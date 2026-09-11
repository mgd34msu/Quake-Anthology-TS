/* hipspike.qc's dormant monster_spikemine. Active trap_spike_mine is in hipitems.qc. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
export function registerDormantSpikemine(game: Q1EntityServices): undefined {
  game.registerSpawn("monster_spikemine", (_game, entity) => {
    if (game.options.deathmatch !== 0) return game.remove(entity);
    entity.solid = "slidebox"; entity.movement = "step"; entity.model = "progs/demon.mdl";
    game.setBounds(entity, { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }); return game.link(entity);
  });
  return undefined;
}
