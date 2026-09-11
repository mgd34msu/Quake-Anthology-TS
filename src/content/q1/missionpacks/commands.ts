/* Official mission-pack ImpulseCommands developer and cheat branches. GPL-2.0-or-later. */
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1Base } from "../base/provider.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState } from "../foundation/types.ts";
import { WEAPONS, weaponItem } from "../foundation/types.ts";
import type { MissionPackPlayers } from "./player.ts";
import type { Q1MissionPack } from "./types.ts";
import { missionWeapons } from "./types.ts";
import { missionMessage } from "./messages.ts";

export interface MissionPackCommandOptions {
  readonly cheatsAllowed?: () => boolean;
  readonly developerMessage?: (text: string) => undefined;
}
function setCount(game: Q1EntityServices, player: Q1PlayerState, item: ItemId, count: number, capacity: number): undefined {
  const entry = game.host.inventory.entries(player.actor.id).find(candidate => candidate.item === item);
  return game.host.inventory.configure(player.actor, entry === undefined ? { item, count, capacity } : { ...entry, count });
}
export function missionPackCommand(game: Q1EntityServices, base: Q1Base, players: MissionPackPlayers, player: Q1PlayerState, pack: Q1MissionPack, impulse: number, options: MissionPackCommandOptions): boolean {
  const multiplayer = game.options.deathmatch !== 0 || game.options.coop;
  if (impulse === 9) {
    if (multiplayer && (game.options.edition === "classic" || !(options.cheatsAllowed?.() ?? false))) return true;
    for (const weapon of WEAPONS) setCount(game, player, weaponItem(weapon), 1, 1);
    for (const weapon of missionWeapons) if (weapon.id.startsWith(`${pack}:`)) setCount(game, player, weaponItem(weapon.id), 1, 1);
    setCount(game, player, "q1:key/silver", 1, 1); setCount(game, player, "q1:key/gold", 1, 1);
    setCount(game, player, "q1:ammo/shells", 100, 100); setCount(game, player, "q1:ammo/nails", 200, 200); setCount(game, player, "q1:ammo/rockets", 100, 100); setCount(game, player, "q1:ammo/cells", 200, 100);
    if (pack === "rogue") { setCount(game, player, "rogue:ammo/lava-nails", 200, 200); setCount(game, player, "rogue:ammo/multi-rockets", 100, 100); setCount(game, player, "rogue:ammo/plasma", 100, 100); }
    game.selectWeapon(player.actor, "rocketlauncher"); return true;
  }
  if (impulse === 11) { base.campaign.writeFlags(Math.fround(base.campaign.readFlags() * 2 + 1)); return true; }
  if (impulse === 255 || pack === "hipnotic" && (impulse === 200 || impulse === 201)) {
    if (multiplayer) return true;
    players.powerup(player, impulse === 200 ? "hipnotic:wetsuit" : impulse === 201 ? "hipnotic:empathy" : "quad", 30);
    const key = impulse === 200 ? "$qc_wetsuit_cheat" : impulse === 201 ? "$qc_empathy_cheat" : "$qc_quad_cheat";
    if (pack === "rogue") options.developerMessage?.(game.options.edition === "classic" ? "quad cheat\n" : key); else missionMessage(game, null, key);
    return true;
  }
  if (pack !== "hipnotic") return false;
  if (impulse === 205) {
    if (multiplayer) return true;
    missionMessage(game, null, "$qc_genocide_cheat");
    const world = game.world;
    if (world !== null) for (const entity of game.entities.values()) if (entity.monster !== null && game.health(entity.actor.id) > 0) game.damage(entity.actor.id, world.actor.id, world.actor.id, game.health(entity.actor.id) + 10);
    return true;
  }
  if (impulse === 202 || impulse === 203) {
    let ordinal = 0;
    for (const entity of game.entities.values()) {
      if (entity === game.world) continue; ordinal++;
      if (impulse === 203 && game.health(entity.actor.id) <= 0) continue;
      const origin = game.body(entity).origin;
      options.developerMessage?.(impulse === 202 ? `${ordinal} ${entity.classname}\n` : `${ordinal} ${entity.classname} '${origin.x} ${origin.y} ${origin.z}'\n--------------------\n`);
    }
    return true;
  }
  if (impulse === 206) {
    const world = game.world; if (world !== null) { const next = 1 - world.number("hipnotic:dump-coordinates"); world.fields.set("hipnotic:dump-coordinates", String(next)); if (next === 1) missionMessage(game, null, "$qc_dump_player_loc"); }
    return true;
  }
  return false;
}
export function dumpMissionPackCoordinates(game: Q1EntityServices, player: Q1PlayerState): undefined {
  if (game.world?.number("hipnotic:dump-coordinates") !== 1 || game.time < player.attackFinished) return undefined;
  const client = game.host.checkClient(player.actor), body = client === null ? null : game.host.bodies.read(client);
  return body === null ? undefined : game.message(null, `Player: '${body.origin.x} ${body.origin.y} ${body.origin.z}'\n`, false);
}
