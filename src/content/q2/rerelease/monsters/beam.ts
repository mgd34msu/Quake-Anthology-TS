import type { ActorId } from "../../../../contracts/identity.ts";
import { add, scale, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";

export function updateMonsterBeam(beam: Q2Entity, game: Q2GameServices, damage: boolean): undefined {
  const start = game.body(beam).origin, end = add(start, scale(beam.movedir, 2048)), exclude: ActorId[] = [];
  let endpoint = end;
  for (;;) {
    const trace = game.host.trace({ start, end, bounds: null, ignore: beam.actor.id, exclude, mask: 3 | 0x2000000 | 0x4000000 | 0x40000000 });
    const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : zero;
    endpoint = add(trace.end, normal);
    if (trace.hit.kind !== "actor") break;
    const target = trace.hit.actor, entity = game.entity(target), combat = game.host.combat.read(target);
    if (exclude.some(actor => actor.equals(target))) break;
    if (damage && beam.damage > 0 && combat?.canTakeDamage === true && entity?.laserImmune !== true && beam.owner?.equals(target) !== true) {
      game.damage(target, beam, beam.owner, beam.damage, game.options.skill, beam.movedir, trace.end, zero, 30, 4);
    } else if (damage && beam.damage < 0 && combat !== null && entity !== null && combat.health < entity.maxHealth) {
      game.host.combat.setHealth(entity.actor, Math.min(entity.maxHealth, combat.health - beam.damage));
    }
    if (!game.host.isMonster(target) && !game.host.isPlayer(target)) {
      if (damage) game.host.emit({ kind: "effect", effect: "q2:laser-sparks", origin: trace.end, direction: normal, count: 10, color: beam.skin });
      break;
    }
    if (exclude.length === 16) break;
    exclude.push(target);
  }
  beam.pos2 = endpoint;
  return game.host.emit({ kind: "beam", actor: beam.actor.id, start, end: endpoint, width: beam.frame, color: beam.skin, visible: true });
}

export const freeMonsterBeam: Q2Think = (beam, game) => {
  const owner = game.entity(beam.owner);
  if (owner !== null) { if ((beam.spawnflags & 1) !== 0) owner.beam2 = null; else owner.beam = null; }
  game.host.emit({ kind: "beam", actor: beam.actor.id, start: game.body(beam).origin, end: beam.pos2, width: beam.frame, color: beam.skin, visible: false });
  return game.remove(beam);
};

export function fireMonsterBeam(context: MonsterContext, damage: number, secondary: boolean, update: Q2Think): undefined {
  const { game, entity } = context;
  game.sourceCallbacks.register({ think: { beam_think: freeMonsterBeam } });
  let beam = game.entity(secondary ? entity.beam2 : entity.beam);
  if (beam === null) {
    beam = game.create("dabeam");
    if (secondary) entity.beam2 = beam.actor.id; else entity.beam = beam.actor.id;
    beam.owner = entity.actor.id; beam.damage = damage; beam.frame = 2; beam.spawnflags = secondary ? 1 : 0;
    beam.skin = context.state.medic ? 0xf3f3f1f1 : 0xf2f2f0f0;
    beam.renderFlags |= 128; beam.postthink = update; beam.sound = "misc/lasfly.wav";
    game.motion(beam, "stationary"); game.solid(beam, "none");
    game.host.emit({ kind: "sound", actor: beam.actor.id, origin: game.body(beam).origin, path: beam.sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
  }
  game.schedule(beam, 0.2, freeMonsterBeam);
  update(beam, game);
  return updateMonsterBeam(beam, game, true);
}
