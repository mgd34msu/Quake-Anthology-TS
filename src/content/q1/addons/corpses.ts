/* quakec_mg1/misc_corpses.qc and MG3 inhibition. GPL-2.0-or-later. */
import type { Q1AddonContext } from "./context.ts";

// Final corpse-frame macros from the corresponding source model frame declarations.
const poses: readonly (readonly [string, number])[] = [
  ["demon", 53], ["dog", 16], ["dog", 25], ["enforcer", 54], ["enforcer", 65], ["fish", 38], ["hknight", 53], ["hknight", 62],
  ["knight", 85], ["knight", 96], ["ogre", 116], ["ogre", 126], ["shalrath", 22], ["shambler", 87], ["soldier", 17], ["soldier", 28], ["wizard", 53],
  ["player", 49], ["player", 60], ["player", 69], ["player", 84], ["player", 93], ["player", 102],
  ["h_demon", 0], ["h_dog", 0], ["h_guard", 0], ["h_hellkn", 0], ["h_knight", 0], ["h_mega", 0], ["h_ogre", 0],
  ["h_player", 0], ["h_shal", 0], ["h_shams", 0], ["h_wizard", 0], ["h_zombie", 0], ["gib1", 0], ["gib2", 0], ["gib3", 0],
];
export function registerAddonCorpses(context: Q1AddonContext): undefined {
  context.game.registerSpawn("misc_corpse", (_game, entity) => {
    if (context.program === "mg3" && (context.removedOutsideCoop(entity) || context.removedForRunes(entity))) return undefined;
    const pose = poses[entity.number("style")]; if (pose === undefined) throw new Error("misc_corpse with invalid style");
    entity.model = `progs/${pose[0]}.mdl`; entity.frame = pose[1]; entity.solid = "none"; entity.movement = "none"; return undefined;
  });
  context.game.registerSpawn("ambient_drone", (game, entity) => game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: "ambience/drone6.wav", volume: 0.5, attenuation: 3 }));
  context.game.registerSpawn("ambient_generic", (game, entity) => {
    const path = entity.text("noise"); if (path === "") return game.remove(entity);
    game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path, volume: entity.number("volume") || 0.5, attenuation: entity.delay || 3 }); return game.remove(entity);
  });
  return undefined;
}
