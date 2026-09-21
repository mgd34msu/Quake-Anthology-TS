// Rerelease m_parasite.cpp. ZeniMax Media, GPL-2.0.
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../../../foundation/fields.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../../foundation/host.ts";
import { health, projectFlash, vectorAngles } from "../../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext } from "../../../foundation/monsters/types.ts";
import { predictedDirection, rereleaseRandom } from "../common.ts";
import { parasiteFrame } from "../tables/parasite.ts";

const breakOffsets: readonly Vec3[] = [
  { x: 7, y: 0, z: 7 }, { x: 6.3, y: 14.5, z: 4 }, { x: 8.5, y: 0, z: 5.6 }, { x: 5, y: -15.25, z: 4 },
  { x: 9.5, y: -1.8, z: 5.9 }, { x: 6.2, y: 14, z: 4 }, { x: 12.25, y: 7.5, z: 1.4 }, { x: 13.8, y: 0, z: -2.4 },
  { x: 13.8, y: 0, z: -4 }, { x: 0.1, y: 0, z: -0.7 }, { x: 5, y: 0, z: 3.7 }, { x: 11, y: 0, z: 4 },
  { x: 13.5, y: 0, z: -4 }, { x: 13.5, y: 0, z: -4 }, { x: 0.2, y: 0, z: -0.7 }, { x: 3.9, y: 0, z: 3.6 },
  { x: 8.5, y: 0, z: 5 }, { x: 14, y: 0, z: -4 }, { x: 14, y: 0, z: -4 }, { x: 0.1, y: 0, z: -0.5 },
];
const drainOffsets: readonly Vec3[] = [
  { x: -1.7, y: 0, z: 1.2 }, { x: -2.2, y: 0, z: -0.6 }, { x: 7.7, y: 0, z: 7.2 }, { x: 7.2, y: 0, z: 5.7 },
  { x: 6.2, y: 0, z: 7.8 }, { x: 4.7, y: 0, z: 6.7 }, { x: 5, y: 0, z: 9 }, { x: 5, y: 0, z: 7 },
  { x: 5, y: 0, z: 10.5 }, { x: 4.5, y: 0, z: 9.7 }, { x: 1.5, y: 0, z: 12 }, { x: 2.9, y: 0, z: 11 }, { x: 2.1, y: 0, z: 7.6 },
];
function start(context: MonsterContext): Vec3 {
  const frame = context.entity.frame;
  return projectFlash(context, breakOffsets[frame - parasiteFrame.break01] ?? drainOffsets[frame - parasiteFrame.drain01] ?? { x: 8, y: 0, z: 6 });
}

export function createProboscis(monsters: Q2Monsters) {
  const reset: Q2Think = (tip, game) => {
    const owner = game.entity(tip.owner), segment = game.entity(tip.proboscus);
    if (owner !== null) owner.proboscus = null;
    if (segment !== null) game.remove(segment);
    return game.remove(tip);
  };
  const die: Q2Die = (tip, game) => {
    const cause = tip.lastAttack?.cause;
    return cause?.kind === "q2" && cause.meansOfDeath === 20 ? reset(tip, game) : undefined;
  };
  function retract(tip: Q2Entity, game: Q2GameServices): undefined {
    const owner = tip.owner === null ? null : monsters.context(tip.owner);
    if (owner?.state.move.name === "parasite_move_fire_proboscis") owner.state.nextFrame = parasiteFrame.drain12;
    if (tip.style !== 2) tip.speed *= 2;
    tip.style = 2; game.motion(tip, "stationary"); game.solid(tip, "none"); return game.link(tip);
  }
  function hit(tip: Q2Entity, game: Q2GameServices, other: ActorId, point: Vec3, normal: Vec3, startSolid: boolean): undefined {
    const owner = tip.owner === null ? null : monsters.context(tip.owner);
    if (owner === null || owner.state.move.name !== "parasite_move_fire_proboscis") return undefined;
    const body = game.body(tip), target = game.host.bodies.read(other);
    let position: Vec3;
    if (target !== null && (game.host.isPlayer(other) || owner.entity.enemy?.equals(other) === true)) {
      position = startSolid ? point : subtract(point, scale(normalize(subtract(body.origin, point)), 12));
      owner.state.nextFrame = parasiteFrame.drain06; tip.style = 1; tip.pos1 = subtract(position, target.origin); tip.enemy = other;
      tip.renderFlags |= 32; game.motion(tip, "stationary"); game.solid(tip, "none"); game.sound(tip, "parasite/paratck3.wav", 1);
    } else {
      position = add(point, normal);
      if (game.host.isMonster(other) || ((game.entity(other)?.serverFlags ?? 0) & 2) !== 0) retract(tip, game);
      else {
        owner.setMove("parasite_move_break"); tip.style = 1; game.motion(tip, "stationary"); game.solid(tip, "none");
        game.move(owner.entity, { angles: { ...game.body(owner.entity).angles, y: body.angles.y } });
      }
    }
    if (game.host.combat.read(other)?.canTakeDamage === true) game.damage(other, tip, tip.owner, 5, 0, normal, point, normal, 0);
    game.host.emit({ kind: "sound", actor: owner.entity.actor.id, origin: point, path: "parasite/paratck2.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    game.move(tip, { origin: position }); return game.schedule(tip, game.host.frameSeconds(), think);
  }
  const touch: Q2Touch = (tip, game, contact) => hit(tip, game, contact.other, game.body(tip).origin, contact.plane?.normal ?? zero, false);
  const think: Q2Think = (tip, game) => {
    const owner = tip.owner === null ? null : monsters.context(tip.owner);
    if (owner === null) return reset(tip, game);
    game.schedule(tip, game.host.frameSeconds(), think);
    const body = game.body(tip);
    if (tip.style === 2) {
      const origin = start(owner), direction = subtract(body.origin, origin), distance = length(direction);
      if (distance <= tip.speed * 2 * game.host.frameSeconds()) { tip.style = 3; tip.think = reset; return game.move(tip, { origin }); }
      return game.move(tip, { origin: subtract(body.origin, scale(normalize(direction), tip.speed * game.host.frameSeconds())) });
    }
    if (tip.style === 1 && tip.enemy !== null) {
      const target = game.host.bodies.read(tip.enemy), combat = game.host.combat.read(tip.enemy);
      if (target === null || combat === null || combat.health <= 0 || !combat.canTakeDamage) return retract(tip, game);
      const origin = add(target.origin, tip.pos1), from = start(owner), trace = game.host.trace({ start: from, end: origin, bounds: null, ignore: null, mask: 3 });
      game.move(tip, { origin, angles: vectorAngles(normalize(subtract(origin, from))) });
      if (trace.fraction !== 1) { retract(tip, game); return game.move(tip, { origin: body.origin }); }
      if (tip.timestamp <= game.host.now()) {
        const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : zero;
        game.damage(tip.enemy, tip, tip.owner, 2, 0, normal, trace.end, normal, 0);
        const hp = Math.min(owner.entity.maxHealth, health(game, owner.entity.actor.id) + 2);
        game.host.combat.setHealth(owner.entity.actor, hp); owner.entity.skin = hp < owner.entity.maxHealth / 2 ? 1 : 0; tip.timestamp = game.host.now() + 0.1;
      }
      return game.link(tip);
    }
    if (tip.style === 0) {
      const target = owner.entity.enemy === null ? null : game.host.bodies.read(owner.entity.enemy);
      if (target === null || health(game, owner.entity.enemy) <= 0) return retract(tip, game);
      const delta = subtract(body.origin, target.origin);
      if (length(delta) > tip.speed * 2 / 15 && dot(normalize(delta), normalize(subtract(body.origin, game.body(owner.entity).origin))) > 0) return retract(tip, game);
    }
    return undefined;
  };
  const draw: Q2Think = (segment, game) => {
    const tip = game.entity(segment.owner), owner = tip?.owner === null || tip?.owner === undefined ? null : monsters.context(tip.owner);
    if (tip === null || owner === null) return undefined;
    const from = start(owner), tipOrigin = game.body(tip).origin, to = subtract(tipOrigin, scale(normalize(subtract(tipOrigin, from)), 8));
    segment.pos2 = to; game.move(segment, { origin: from });
    return undefined;
  };
  function fire(context: MonsterContext): undefined {
    const { entity, game } = context, previous = game.entity(entity.proboscus);
    if (previous !== null && previous.style !== 2) reset(previous, game);
    const from = start(context), offset = Math.fround(rereleaseRandom(context).float(-0.9999999403953552, 1) * Math.fround(0.1));
    const direction = predictedDirection(context, from, 1250, false, offset); if (direction === null) return undefined;
    const tip = game.create("parasite_proboscis"), segment = game.create("parasite_proboscis_segment");
    tip.model = "models/monsters/parasite/tip/tris.md2"; tip.owner = entity.actor.id; entity.proboscus = tip.actor.id;
    tip.clipMask = 3 | 0x2000000 | 0x40000000; tip.speed = 1250; tip.projectile = true; tip.die = die; tip.touch = touch;
    tip.flags |= 8; game.host.combat.create(tip.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    game.move(tip, { origin: from, angles: vectorAngles(direction), velocity: scale(direction, tip.speed) });
    game.motion(tip, "fly-missile"); game.solid(tip, "box"); game.schedule(tip, game.host.frameSeconds(), think);
    segment.model = "models/monsters/parasite/segment/tris.md2"; segment.renderFlags = 128; segment.postthink = draw;
    tip.proboscus = segment.actor.id; segment.owner = tip.actor.id;
    const trace = game.host.trace({ start: from, end: add(from, scale(direction, tip.speed * game.host.frameSeconds())), bounds: null, ignore: entity.actor.id, mask: tip.clipMask });
    if (trace.startSolid || trace.fraction < 1) hit(tip, game, trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor(), trace.startSolid ? from : trace.end,
      trace.startSolid ? scale(direction, -1) : trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, trace.startSolid);
    segment.pos2 = add(game.body(tip).origin, scale(normalize(subtract(game.body(tip).origin, from)), 8));
    game.move(segment, { origin: from }); game.show(tip); return game.show(segment);
  }
  return { reset, retract, draw, fire, callbacks: {
    think: { "rerelease.parasite.proboscis_reset": reset, "rerelease.parasite.proboscis_think": think, "rerelease.parasite.proboscis_segment_draw": draw },
    touch: { "rerelease.parasite.proboscis_touch": touch }, die: { "rerelease.parasite.proboscis_die": die },
  } };
}
