import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import { add, length, subtract, zero } from "../../foundation/fields.ts";
import type { Q2PlayerState } from "./types.ts";

const fixedCoopMaps = ["jail2", "jail4", "mine1", "mine2", "mine3", "mine4", "lab", "boss1", "fact3", "biggun", "space", "command", "power2", "strike"];
export function q2EntitiesNamed(game: Q2GameServices, classname: string): readonly Q2Entity[] {
  return [...game.entities.values()].filter(entity => entity.classname === classname).sort((left, right) =>
    (game.host.actors.sourceOf(left.actor.id)?.slot ?? left.actor.id.slot) - (game.host.actors.sourceOf(right.actor.id)?.slot ?? right.actor.id.slot));
}
export const q2PlayerSpawns: Q2SpawnModule = {
  spawn(entity, game) {
    switch (entity.classname) {
      case "info_player_start": {
        if (game.options.mode === "coop" && game.options.mapName.toLowerCase() === "security") {
          game.schedule(entity, 0.1, (_self, active) => {
            for (const x of [124, 252, 316]) {
              const spot = active.create("info_player_coop"); spot.targetname = "jail3";
              active.move(spot, { origin: { x, y: -164, z: 80 }, angles: { x: 0, y: 90, z: 0 } });
            }
            return undefined;
          });
        }
        return true;
      }
      case "info_player_deathmatch": {
        if (game.options.mode !== "deathmatch") { game.remove(entity); return true; }
        entity.model = "models/objects/dmspot/tris.md2"; entity.skin = 1;
        game.move(entity, { bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } } }, false);
        game.solid(entity, "box"); game.show(entity); return true;
      }
      case "info_player_coop": {
        if (game.options.mode !== "coop") { game.remove(entity); return true; }
        if (fixedCoopMaps.includes(game.options.mapName.toLowerCase())) {
          game.schedule(entity, 0.1, (self, active) => {
            for (const start of q2EntitiesNamed(active, "info_player_start")) {
              if (start.targetname !== "" && length(subtract(active.body(start).origin, active.body(self).origin)) < 384) {
                if (self.targetname.toLowerCase() !== start.targetname.toLowerCase()) self.targetname = start.targetname;
                break;
              }
            }
            return undefined;
          });
        }
        return true;
      }
      case "info_player_intermission": return true;
      default: return false;
    }
  },
};

export function q2PlayersRange(game: Q2GameServices, spot: Q2Entity): number {
  let closest = 9999999;
  for (const player of game.host.players()) {
    if ((game.host.combat.read(player)?.health ?? 0) <= 0) continue;
    const body = game.host.bodies.read(player);
    if (body !== null) closest = Math.min(closest, length(subtract(body.origin, game.body(spot).origin)));
  }
  return closest;
}

export function selectQ2Spawn(game: Q2GameServices, state: Q2PlayerState, spawnPoint: string): Q2Entity {
  let spot: Q2Entity | undefined;
  if (game.options.mode === "deathmatch") {
    const spots = q2EntitiesNamed(game, "info_player_deathmatch");
    if ((game.options.deathmatchFlags & 512) !== 0) {
      let best = 0;
      for (const candidate of spots) { const distance = q2PlayersRange(game, candidate); if (distance > best) { best = distance; spot = candidate; } }
      spot ??= spots[0];
    } else {
      let first: Q2Entity | null = null, second: Q2Entity | null = null, firstRange = 99999, secondRange = 99999;
      for (const candidate of spots) {
        const range = q2PlayersRange(game, candidate);
        // Preserve source selection, including its non-shifting first/second closest slots.
        if (range < firstRange) { firstRange = range; first = candidate; }
        else if (range < secondRange) { secondRange = range; second = candidate; }
      }
      const count = spots.length <= 2 ? spots.length : spots.length - 2;
      if (count > 0) {
        let selection = Math.floor(game.host.random() * count);
        for (const candidate of spots) {
          if (spots.length > 2 && (candidate === first || candidate === second)) selection++;
          if (selection-- === 0) { spot = candidate; break; }
        }
      }
    }
  } else if (game.options.mode === "coop" && state.slot !== 0) {
    spot = q2EntitiesNamed(game, "info_player_coop").filter(candidate => candidate.targetname.toLowerCase() === spawnPoint.toLowerCase())[state.slot - 1];
  }
  if (spot === undefined) {
    const starts = q2EntitiesNamed(game, "info_player_start");
    spot = starts.find(candidate => spawnPoint === "" ? candidate.targetname === "" : candidate.targetname.toLowerCase() === spawnPoint.toLowerCase());
    if (spot === undefined && spawnPoint === "") spot = starts[0];
  }
  if (spot === undefined) throw new Error(`No Q2 player spawn for '${spawnPoint}' on ${game.options.mapName}`);
  return spot;
}

export function q2KillBox(entity: Q2Entity, game: Q2GameServices): boolean {
  const body = game.body(entity);
  for (;;) {
    const trace = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, mask: 0x2010003 });
    if (trace.hit.kind !== "actor") return !trace.startSolid;
    const target = trace.hit.actor;
    game.damage(target, entity, entity.actor.id, 100000, 0, zero, body.origin, zero, 21, 32);
    if (game.host.actors.isLive(target)) {
      const other = game.entity(target);
      if (other === null || other.solid !== "none") return false;
    }
  }
}

export function q2SpawnOrigin(entity: Q2Entity, game: Q2GameServices) { return add(game.body(entity).origin, { x: 0, y: 0, z: 10 }); }
