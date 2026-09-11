/* quakec_mg3/monsters/mg3_super_shambler.qc. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../../contracts/math.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import { spawnMeatSpray, throwGib, throwHead } from "../../../base/projectiles.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import { BLOODY_NIGHTMARE_ACTIVE } from "../../campaign.ts";
import type { Q1HeavyMonster, HeavyAction, HeavyDefinition } from "./runtime.ts";
import { heavyPrefix } from "./runtime.ts";
import { heavyLightningDamage, heavySpike } from "./projectiles.ts";
import { frames } from "./tables/mg3_super_shambler.ts";

function removeChild(monster: Q1HeavyMonster): undefined {
  const { game, entity } = monster, child = game.entity(entity.references.get("child") ?? null);
  if (child !== null && child.owner !== null && sameActor(child.owner, entity.actor.id) && child.classname === "lightning_child") game.remove(child);
  entity.references.set("child", null); return undefined;
}
function childFrame(monster: Q1HeavyMonster, frame: number): undefined {
  const { game, entity } = monster; entity.effects |= 2;
  const child = game.entity(entity.references.get("child") ?? null);
  if (child !== null && child.owner !== null && sameActor(child.owner, entity.actor.id) && child.classname === "lightning_child") child.frame = frame;
  return undefined;
}
function lightningChild(monster: Q1HeavyMonster, fast: boolean): undefined {
  const { game, entity } = monster; monster.face(); monster.delay(entity.nextThink - game.time + 0.2); entity.effects |= 2; monster.face();
  const child = game.create(fast ? "" : "lightning_child"); entity.references.set("child", child.actor.id);
  if (!fast) child.owner = entity.actor.id;
  child.model = "progs/s_light.mdl"; game.setBody(child, { origin: monster.origin, angles: game.body(entity).angles }); game.link(child);
  return game.schedule(child, fast ? 0.7 : 1.4, game.named.action(child, "SUB_Remove"));
}
function castLightning(monster: Q1HeavyMonster): undefined {
  const { game, entity } = monster; entity.effects |= 2; monster.face();
  const origin = vadd(monster.origin, { x: 0, y: 0, z: 40 }), delta = vsub(vadd(monster.target ?? ZERO, { x: 0, y: 0, z: 16 }), origin);
  const range = Math.max(600, Math.min(1000, length(delta))), direction = normalize(delta);
  const trace = game.host.trace({ start: origin, end: vadd(monster.origin, vscale(direction, range)), bounds: POINT, ignore: entity.actor.id, monsters: false });
  game.host.emit({ kind: "beam", style: "lightning1", actor: entity.actor.id, start: origin, end: trace.end });
  monster.number("frags", entity.number("frags") + 1); return heavyLightningDamage(game, entity.actor.id, origin, trace.end, 10);
}
function attackCheck(monster: Q1HeavyMonster): boolean {
  let cap = 3 + Math.floor(monster.game.host.random() * 2 + 0.5);
  if ((monster.context.base.campaign.readFlags() & BLOODY_NIGHTMARE_ACTIVE) !== 0) cap--;
  monster.entity.count++; return monster.entity.count > cap;
}
function zOffset(monster: Q1HeavyMonster): number {
  const delta = vsub(monster.target ?? ZERO, monster.origin), random = (): number => monster.game.host.random() * 2 - 1;
  if (delta.z > 30) return 100 + random() * 50;
  if (delta.z < -30) return -100 + random() * 50;
  const range = length(delta); return range > 300 ? 50 + random() * 25 : range < 150 ? -50 + random() * 25 : 0;
}
function shot(monster: Q1HeavyMonster, offsetY: number, offsetZ: number, offset: Vec3, hands: boolean): undefined {
  const { game, entity } = monster, random = (): number => game.host.random() * 2 - 1, body = game.body(entity);
  let angles = velocityAngles(vsub(monster.target ?? ZERO, monster.origin));
  if (hands) { angles = { ...angles, y: angles.y + offsetY * (12 + random() * 4) }; angles = { ...angles, x: angles.x + offsetZ * (12 + random() * 4) }; }
  else angles = { ...angles, y: angles.y + offsetY * 5 };
  const forward = game.makeVectors(angles).forward, origin = vadd(vadd(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), vscale(forward, 20)), offset);
  let direction = normalize(forward); if (!hands) direction = { ...direction, z: -direction.z + (game.host.random() - 0.5) * 0.1 };
  const missile = heavySpike(game, entity.actor.id, origin, vscale(direction, 1000)); missile.model = "progs/rogue/plasma.mdl";
  missile.angularVelocity = { x: 300 * random(), y: 300 * random(), z: 300 * random() }; missile.movement = "toss"; game.setBounds(missile, POINT);
  let velocity = vscale(direction, random() * 100 + (hands ? 500 : 400)); velocity = { ...velocity, z: (hands ? 100 : 125) + random() * 50 };
  velocity = { ...velocity, z: velocity.z + zOffset(monster) }; game.setBody(missile, { velocity }); missile.effects |= 64; return game.link(missile);
}
function blast(monster: Q1HeavyMonster, offset: Vec3, hands: boolean): undefined {
  if (hands) { for (let x = -1; x < 2; x++) for (let y = -1; y < 2; y++) shot(monster, x, y, offset, true); }
  else { for (let i = -5; i <= 5; i++) shot(monster, i, 0, offset, false); monster.game.sound(monster.entity, "zombie/z_shot1.wav", "weapon"); }
  return undefined;
}
function claw(monster: Q1HeavyMonster, side: number): undefined {
  if (monster.enemy === null) return undefined;
  const { game, entity } = monster; monster.ai("charge", 10); if (monster.distance > 100) return undefined;
  monster.melee(100, 20, 3, false); game.sound(entity, "shambler/smack.wav");
  if (side !== 0) { const basis = game.makeVectors(game.body(entity).angles); spawnMeatSpray(game, entity, vadd(monster.origin, vscale(basis.forward, 16)), vscale(basis.right, side)); }
  return undefined;
}
function smash(monster: Q1HeavyMonster): undefined {
  blast(monster, ZERO, false); if (monster.enemy === null) return undefined;
  const { game, entity } = monster; monster.ai("charge", 0); if (monster.distance > 100 || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  monster.melee(100, 40, 3, false); game.sound(entity, "shambler/smack.wav");
  for (let i = 0; i < 2; i++) { const basis = game.basis; spawnMeatSpray(game, entity, vadd(monster.origin, vscale(basis.forward, 16)), vscale(basis.right, (game.host.random() * 2 - 1) * 100)); }
  return undefined;
}
function melee(monster: Q1HeavyMonster): undefined {
  const { game, entity } = monster, delta = vsub(monster.origin, monster.target ?? ZERO), range = length(delta);
  if (range < 110) return monster.play(game.host.random() < 0.8 ? "supsham_smash1" : game.host.random() < 0.5 ? "supsham_swingl1" : "supsham_swingr1");
  if (range < 200 || entity.wait > game.time) {
    const chance = dot(game.makeVectors(game.body(entity).angles).right, normalize(delta)); return monster.play(chance < 0.45 ? "supsham_swingr1" : chance < 0.9 ? "supsham_swingl1" : "supsham_smash1");
  }
  entity.count = 0; if (game.host.random() > 0.4) { monster.play("supsham_magic1"); entity.wait = game.time + 5; }
  else { monster.play("supsham_magic_b1"); entity.wait = game.time + 3; } return undefined;
}
const actions: Record<string, HeavyAction> = {
  supsham_removechild: removeChild, SupCastLightning: castLightning, supsham_melee: melee,
  supsham_missile: monster => { const r = monster.game.host.random(); return monster.play(r < 0.36 ? "supsham_magic1" : r < 0.66 ? "supsham_swingr1" : "supsham_swingl1"); },
  cleanup_orbs: monster => { for (const entity of monster.game.entities.values()) if (entity.classname === "monster_super_shambler" && entity.owner !== null && sameActor(entity.owner, monster.entity.actor.id)) monster.game.schedule(entity, 0.1, monster.game.named.action(entity, `${heavyPrefix}:source_die`)); return undefined; },
  "mg3_super_shambler:supsham_smash10": smash,
  "mg3_super_shambler:supsham_smash12": monster => { monster.ai("charge", 4); if (attackCheck(monster)) monster.nextFrame = "supsham_magic1"; return undefined; },
  "mg3_super_shambler:supsham_swingl7": monster => { blast(monster, vadd(vscale(monster.game.basis.right, 16), { x: 0, y: 0, z: 32 }), true); monster.ai("charge", 5); return claw(monster, 250); },
  "mg3_super_shambler:supsham_swingr7": monster => { blast(monster, vadd(vscale(monster.game.basis.right, -16), { x: 0, y: 0, z: 32 }), true); monster.ai("charge", 6); return claw(monster, -250); },
  "mg3_super_shambler:supsham_swingl9": monster => { monster.ai("charge", 8); monster.game.makeVectors(monster.game.body(monster.entity).angles); if (attackCheck(monster)) monster.nextFrame = "supsham_magic1"; else if (monster.game.host.random() < 0.5) monster.nextFrame = "supsham_swingr1"; return undefined; },
  "mg3_super_shambler:supsham_swingr9": monster => { monster.ai("charge", 1); monster.ai("charge", 10); monster.game.makeVectors(monster.game.body(monster.entity).angles); if (attackCheck(monster)) monster.nextFrame = "supsham_magic1"; else if (monster.game.host.random() < 0.5) monster.nextFrame = "supsham_swingl1"; return undefined; },
  "mg3_super_shambler:supsham_magic1": monster => { monster.face(); monster.game.sound(monster.entity, "shambler/sattck1.wav", "weapon"); monster.entity.count = 0; return undefined; },
  "mg3_super_shambler:supsham_magic3": monster => lightningChild(monster, false), "mg3_super_shambler:supsham_magic_b3": monster => lightningChild(monster, true),
  "mg3_super_shambler:supsham_magic4": monster => childFrame(monster, 1), "mg3_super_shambler:supsham_magic5": monster => childFrame(monster, 2), "mg3_super_shambler:supsham_magic4b": monster => childFrame(monster, 3),
};
export const superShamblerDefinition: HeavyDefinition = {
  spec: { species: "shambler", classnames: ["monster_super_shambler"], model: "shambler_blood", head: "h_shams", health: 2000, gibHealth: -60, gibs: ["gib1", "gib2", "gib3"],
    bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "supsham_stand1", walk: "supsham_walk1", run: "supsham_run1", sight: "", melee: true, missile: "supsham_melee", movement: "walk" }, frames, actions,
  spawn: monster => { monster.game.host.combat.setHealth(monster.entity.actor, 2000); monster.number("allowPathFind", 1); monster.number("combat_style", 3); monster.number("frags", 0); return monster.initialize(2); },
  melee,
  pain: (monster, attacker, damage) => {
    const { game, entity } = monster, health = game.health(entity.actor.id); game.sound(entity, "shambler/shurt2.wav");
    if (damage >= health && attacker !== null && game.isPlayer(attacker)) {
      if (game.player(attacker)?.weapon === "axe") game.host.emit({ kind: "achievement", player: attacker, id: "ACH_CLOSE_SHAVE" });
      if (entity.number("frags") === 0) game.host.emit({ kind: "achievement", player: attacker, id: "ACH_SHAMBLER_DANCE" });
    }
    if (health <= 0 || 25 + game.host.random() * 400 > damage || monster.state.painFinished > game.time) return undefined;
    monster.state.painFinished = game.time + 5; removeChild(monster); return monster.play("supsham_pain1");
  },
  die: monster => { const { game, entity } = monster; removeChild(monster); const health = game.health(entity.actor.id);
    if (health < -60) { game.sound(entity, "player/udeath.wav"); throwHead(game, entity, "h_shams", health); for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, health); return undefined; }
    game.sound(entity, "shambler/sdeath.wav"); return monster.play("supsham_death1"); },
};
