/* quakec_{mg1,mg3}/monsters/soldier.qc and fight.qc SoldierCheckAttack. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import { fireBullets } from "../../../foundation/weapons.ts";
import { POINT, normalize, vscale, vsub } from "../../../foundation/types.ts";

export const armySpecies: MonsterSpecies = { species: "army", classnames: ["monster_army"], model: "soldier", head: "h_guard", health: 30, gibHealth: -35, gibs: ["gib1", "gib2", "gib3"],
  bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } }, stand: "army_stand1", walk: "army_walk1", run: "army_run1", sight: "soldier/sight1.wav", missile: "army_atk1", melee: false, movement: "walk" };
export const armyActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ["army_fire", monster => {
    const { game, entity } = monster, target = monster.enemy === null ? null : game.host.bodies.read(monster.enemy); if (target === null) return undefined;
    monster.face(); game.sound(entity, "soldier/sattck1.wav", "weapon");
    fireBullets(game, entity.actor, normalize(vsub(vsub(target.origin, vscale(target.velocity, 0.2)), monster.origin)), game.body(entity).angles, 4, 0.1, 0.1, null);
    entity.effects |= 2; return undefined;
  }],
  ["army_refire", monster => { if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) { monster.state.refired = true; monster.nextFrame = "army_atk1"; } return undefined; }],
]);
export function armyAttack(monster: BaseMonster): boolean {
  const { game, entity } = monster, enemy = monster.enemy, range = game.world?.number("enemy_range") ?? 0; if (enemy === null) return false;
  const start = monster.eye(), end = monster.eye(enemy); if (start === null || end === null) return false;
  const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater || range === 3 || game.time < monster.state.attackFinished || game.host.random() >= (range === 0 ? 0.9 : range === 1 ? 0.4 : range === 2 ? 0.05 : 0)) return false;
  monster.play("army_atk1"); monster.attackFinished(1 + game.host.random()); if (game.host.random() < 0.3) { monster.lefty = !monster.lefty; entity.fields.set("lefty", monster.lefty ? "1" : "0"); } return true;
}
export function armyPain(monster: BaseMonster, attacker: ActorId | null, damage: number, nightmareResistance: boolean): undefined {
  monster.retaliate(attacker); const { game, entity, state } = monster;
  if (state.painFinished > game.time || nightmareResistance && game.options.skill > 2 && game.host.random() * 100 > damage) return undefined;
  const r = game.host.random(); state.painFinished = game.time + (r < 0.2 ? 0.6 : 1.1);
  monster.play(r < 0.2 ? "army_pain1" : r < 0.6 ? "army_painb1" : "army_painc1"); return game.sound(entity, r < 0.2 ? "soldier/pain1.wav" : "soldier/pain2.wav", "voice");
}
