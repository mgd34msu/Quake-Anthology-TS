/* eel.qc, identical classic/Rerelease source behavior. GPL-2.0-or-later. */
import { POINT } from "../../foundation/types.ts";
import type { PackMonsterDefinition } from "./types.ts";
import type { MissionMonster } from "./runtime.ts";
import { frames } from "./tables/eel.ts";
import { dropToFloor, eelZap, gib, hullBounds, number } from "./helpers.ts";

function pitch(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if (game.host.contents(monster.origin) !== "water") { dropToFloor(monster); game.damage(entity.actor.id, game.world?.actor.id ?? entity.actor.id, game.world?.actor.id ?? null, 6); return undefined; }
  if (game.time < entity.delay) return undefined;
  let weapon = entity.number("weapon"); if (weapon > 10) weapon = -10;
  const body = game.body(entity);
  if (weapon !== 0) game.setBody(entity, { angles: { ...body.angles, x: body.angles.x + (weapon < 0 ? -1.5 : 1.5) } });
  return number(monster, "weapon", weapon + 1);
}
function charge(monster: MissionMonster): undefined { monster.ai("charge", 8); return pitch(monster); }
export const eelDefinition: PackMonsterDefinition = {
  spec: { species: "eel", classnames: ["monster_eel"], model: "eel2", head: "eelgib", health: 60, gibHealth: -12, gibs: ["gib1", "gib1", "gib1"], bounds: hullBounds,
    stand: "eel_stand1", walk: "eel_walk1", run: "eel_run1", sight: "eel/eelc5.wav", missile: null, melee: true, movement: "swim" },
  frames,
  actions: {
    eel_pitch_change: pitch,
    "eel:eel_attack8": monster => { monster.entity.effects = 8; monster.entity.skin = 1; charge(monster); return monster.game.sound(monster.entity, "eel/eatt1.wav", "weapon"); },
    "eel:eel_attack9": monster => { monster.entity.skin = 2; return charge(monster); },
    "eel:eel_attack10": monster => { monster.entity.skin = 3; return charge(monster); },
    "eel:eel_attack11": monster => { monster.entity.effects = 4; monster.entity.skin = 4; return charge(monster); },
    "eel:eel_attack12": monster => {
      monster.entity.skin = 5;
      const { game, entity } = monster;
      if (monster.enemy !== null && monster.target !== null) {
        const trace = game.host.trace({ start: monster.origin, end: monster.target, bounds: POINT, ignore: entity.actor.id, monsters: true });
        if (trace.actor === monster.enemy && !(trace.inOpen && trace.inWater)) eelZap(monster);
      }
      entity.skin = 0; entity.effects = 0; return undefined;
    },
    "eel:eel_death1": monster => { monster.entity.skin = 0; monster.entity.effects = 0; return monster.game.sound(monster.entity, "eel/edie3r.wav"); },
    "eel:eel_death11": monster => { monster.entity.movementFlags -= 2; return undefined; },
    droptofloor: monster => { dropToFloor(monster); return undefined; },
    "eel:eel_pain1": monster => {
      if (monster.state.painFinished > monster.game.time) return undefined;
      monster.state.painFinished = monster.game.time + 1; monster.game.sound(monster.entity, "eel/epain3.wav"); monster.entity.skin = 0; return undefined;
    },
  },
  spawn: monster => { monster.entity.delay = monster.game.time + monster.game.host.random() * 6; number(monster, "weapon", 0); return monster.spawnDefault(); },
  pain: monster => monster.play("eel_pain1"),
  melee: monster => monster.play("eel_attack1"),
  die: monster => {
    monster.entity.movementFlags += 2; monster.game.setBounds(monster.entity, POINT);
    if (monster.game.health(monster.entity.actor.id) < -12) { monster.entity.skin = 0; monster.entity.effects = 0; return gib(monster, "eelgib", ["gib1", "gib1", "gib1"], ""); }
    return monster.play("eel_death1");
  },
};
