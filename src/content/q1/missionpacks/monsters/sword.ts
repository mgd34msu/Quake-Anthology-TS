/* invis_sw.qc, identical classic/Rerelease source behavior. GPL-2.0-or-later. */
import { frames } from "./tables/invis_sw.ts";
import type { PackMonsterDefinition } from "./types.ts";
import { humanBounds } from "./helpers.ts";

export const swordDefinition: PackMonsterDefinition = {
  spec: { species: "sword", classnames: ["monster_sword"], model: "sword", head: null, health: 150, gibHealth: -Infinity, gibs: [], bounds: humanBounds,
    stand: "sword_stand1", walk: "sword_stand1", run: "sword_run1", sight: "knight/ksight.wav", missile: null, melee: true, movement: "walk" }, frames,
  actions: {
    sword_pause: monster => { const delay = monster.entity.delay; monster.entity.delay = 0; monster.nextFrame = "sword_run1"; monster.entity.fields.set("sword:awakened", "1"); return monster.delay(delay); },
    "invis_sw:sword_run1": monster => {
      monster.entity.effects = 8; return monster.ai("run", 14);
    },
    "invis_sw:sword_atk1": monster => { monster.game.sound(monster.entity, "knight/sword1.wav", "auto"); return monster.ai("charge", 14); },
    "invis_sw:sword_die7": monster => {
      monster.game.host.emit({ kind: "sound", actor: monster.entity.actor.id, path: "player/axhit2.wav", channel: "weapon", volume: 0.5, attenuation: 1 }); return undefined;
    },
  },
  spawn: monster => { if (monster.entity.delay === 0) monster.entity.delay = 10; return monster.spawnDefault(); },
  found: (monster, target) => { monster.foundDefault(target); if (monster.entity.number("sword:awakened") === 0) monster.nextFrame = "sword_pause"; return undefined; },
  pain: monster => { if (monster.entity.number("sword:pain-disabled") !== 0) return undefined; monster.entity.fields.set("sword:pain-disabled", "1"); monster.entity.fields.set("sword:awakened", "1"); monster.entity.delay = 0; monster.nextFrame = "sword_run1"; return monster.delay(0.1); },
  melee: monster => monster.play("sword_atk1"),
  die: monster => { monster.entity.effects = 0; return monster.play(monster.game.host.random() < 0.5 ? "sword_die1" : "sword_dieb1"); },
};
