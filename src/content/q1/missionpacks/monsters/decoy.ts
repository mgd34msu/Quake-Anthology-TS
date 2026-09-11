/* hipdecoy.qc player-model decoys. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { vsub, yawFor } from "../../foundation/types.ts";
import { MissionMonster, type Q1MissionPackMonsters } from "./runtime.ts";
import type { PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/hipdecoy.ts";
import { hullBounds, number } from "./helpers.ts";

function setup(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  entity.model = "progs/player.mdl"; game.setBounds(entity, hullBounds); entity.fields.set("view_ofs", "0 0 22");
  entity.solid = "slidebox"; entity.movement = "step"; entity.maxHealth = 3000000; game.host.combat.setHealth(entity.actor, 3000000);
  const player = game.entity(game.host.players()[0] ?? null); entity.fields.set("colormap", String(player?.number("colormap") ?? 0));
  return undefined;
}
export const decoyDefinition: PackMonsterDefinition = {
  spec: { species: "decoy", classnames: ["monster_decoy"], model: "player", head: null, health: 3000000, gibHealth: -Infinity, gibs: [], bounds: hullBounds,
    stand: "decoy_stand1", walk: "decoy_walk1", run: "decoy_walk1", sight: "", missile: "decoy_stand1", melee: false, movement: "walk" }, frames,
  actions: {
    "hipdecoy:decoy_stand1": monster => {
      const { game, entity } = monster; monster.changeYaw();
      let walk = entity.number("walkframe"); if (walk >= 5) walk = 0;
      entity.frame = 12 + walk; number(monster, "walkframe", walk + 1);
      if (game.time > monster.state.pauseUntil) return monster.play("decoy_walk1");
      return undefined;
    },
    "hipdecoy:decoy_walk1": monster => {
      const { game, entity } = monster, goal = game.entity(entity.references.get("goalentity") ?? null) ?? game.find(monster.state.path)[0];
      if (goal !== undefined && goal !== null) game.host.moveToGoal(entity.actor, goal.actor.id, 12);
      number(monster, "weaponframe", 0); let walk = entity.number("walkframe"); if (walk === 6) walk = 0;
      if (walk === 2 || walk === 5) {
        const r = game.host.random(), step = r < 0.14 ? 1 : r < 0.29 ? 2 : r < 0.43 ? 3 : r < 0.58 ? 4 : r < 0.72 ? 5 : r < 0.86 ? 6 : 7;
        game.host.emit({ kind: "sound", actor: entity.actor.id, path: `misc/foot${step}.wav`, channel: "voice", volume: 0.5, attenuation: 1 });
      }
      entity.frame += walk; return number(monster, "walkframe", walk + 1);
    },
  },
  spawn: monster => { setup(monster); monster.spawnDefault(); monster.game.totalMonsters--; return undefined; },
  pain: monster => monster.play("decoy_stand1"), die: monster => monster.play("decoy_stand1"),
};
export function becomeDecoy(runtime: Q1MissionPackMonsters, target: string, origin: Vec3): Q1Actor {
  const { game } = runtime, entity = game.create("monster_decoy"), monster = new MissionMonster(game, entity, decoyDefinition, runtime);
  runtime.monsters.set(entity.actor, monster); game.world?.references.set("hipdecoy", entity.actor.id); setup(monster); game.setOrigin(entity, origin);
  entity.target = target; monster.state.path = target; entity.damageable = true; entity.aimedDamage = true; entity.idealYaw = game.body(entity).angles.y;
  if (entity.yawSpeed === 0) entity.yawSpeed = 20; entity.use = game.named.use(entity, "hipnotic:monster_use"); entity.movementFlags |= 32;
  const destination = game.find(target)[0];
  if (target !== "") {
    entity.references.set("goalentity", destination?.actor.id ?? null); entity.references.set("movetarget", destination?.actor.id ?? null);
    entity.idealYaw = yawFor(vsub(destination === undefined ? game.world === null ? { x: 0, y: 0, z: 0 } : game.body(game.world).origin : game.body(destination).origin, origin));
    if (destination?.classname === "path_corner") monster.play("decoy_walk1"); else monster.state.pauseUntil = 99999999;
    monster.play("decoy_stand1");
  } else { monster.state.pauseUntil = 99999999; monster.play("decoy_stand1"); }
  monster.delay(entity.nextThink - game.time + game.host.random() * 0.5); return entity;
}
