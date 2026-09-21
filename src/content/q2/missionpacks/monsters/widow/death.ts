/* Original Rogue m_widow2.c and g_spawn.c death debris. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../../foundation/callbacks.ts";
import { add, scale, zero } from "../../../foundation/fields.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../../foundation/host.ts";
import { q2GibCallbacks } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext } from "../../../foundation/monsters/types.ts";
import { widowProject } from "./common.ts";

const meat = "models/objects/gibs/sm_meat/tris.md2", metal = "models/objects/gibs/sm_metal/tris.md2";
const free: Q2Think = (entity, game) => game.remove(entity);
const die: Q2Die = (entity, game) => game.remove(entity);
const touch: Q2Touch = (entity, game) => {
  game.solid(entity, "none"); entity.touch = null; entity.angularVelocity = zero;
  game.move(entity, { angles: { x: 0, y: game.body(entity).angles.y, z: 0 } });
  game.motion(entity, entity.motion);
  if (entity.noise !== "") game.sound(entity, entity.noise, 2);
  return undefined;
};
function clip(velocity: Vec3): Vec3 { return { x: Math.max(-300, Math.min(300, velocity.x)), y: Math.max(-300, Math.min(300, velocity.y)), z: Math.max(200, Math.min(500, velocity.z)) }; }
export function widowGib(self: Q2Entity, game: Q2GameServices, model: string, damage: number, organic: boolean, origin: Vec3 | null = null, sized = false, hitSound = "", fade = true): Q2Entity {
  const gib = game.create("gib"), body = game.body(self), random = (): number => game.host.random(), signed = (): number => random() * 2 - 1;
  const half = scale({ x: body.bounds.max.x - body.bounds.min.x, y: body.bounds.max.y - body.bounds.min.y, z: body.bounds.max.z - body.bounds.min.z }, 0.5);
  const center = add(body.origin, add(body.bounds.min, add(half, { x: -1, y: -1, z: -1 })));
  const point = origin ?? add(center, { x: signed() * half.x, y: signed() * half.y, z: signed() * half.z });
  gib.effects = 2; gib.flags |= 2048; gib.renderFlags |= 32768; gib.die = die;
  const lifetime = (fade ? sized ? 20 : 5 : sized ? 60 : 25) + random() * (sized ? 15 : 10);
  let velocity = clip(add(body.velocity, scale({ x: damage * signed(), y: damage * signed(), z: damage * signed() + 200 }, organic ? 0.5 : 1)));
  gib.model = model;
  let bounds = { min: zero, max: zero };
  if (sized) {
    gib.noise = hitSound;
    gib.angularVelocity = { x: random() * 400, y: random() * 400, z: random() * 200 };
    velocity = clip({ x: velocity.x * 2, y: velocity.y * 2, z: Math.abs(velocity.z) });
    velocity = { ...velocity, z: Math.max(350 + random() * 100, velocity.z) };
    gib.gravity = 0.25; gib.touch = touch; gib.owner = self.actor.id;
    const size = model === "models/monsters/blackwidow2/gib2/tris.md2" ? 10 : 5;
    bounds = { min: { x: -size, y: -size, z: 0 }, max: { x: size, y: size, z: size } };
  } else {
    velocity = { ...velocity, x: velocity.x * 2, y: velocity.y * 2 };
    gib.angularVelocity = { x: random() * 600, y: random() * 600, z: random() * 600 };
    gib.touch = organic ? game.sourceCallbacks.touch.resolve("gib_touch") : null;
  }
  game.move(gib, { origin: point, velocity, bounds }, false);
  game.host.combat.create(gib.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
  game.solid(gib, sized ? "box" : "none"); game.motion(gib, organic ? "toss" : "bounce"); game.schedule(gib, lifetime, free); game.link(gib); game.show(gib);
  return gib;
}
export function widowEffect(game: Q2GameServices, origin: Vec3, effect = "q2:explosion1", count = 1): undefined {
  return game.host.emit({ kind: "effect", effect, origin, direction: zero, count, color: 0 });
}
function small(self: Q2Entity, game: Q2GameServices, point: Vec3): undefined {
  for (let i = 0; i < 2; i++) widowGib(self, game, meat, 300, true, point, false, "", false);
  widowGib(self, game, metal, 300, false, point, false, "", false); widowGib(self, game, metal, 100, false, point, false, "", false); return undefined;
}
function more(self: Q2Entity, game: Q2GameServices, point: Vec3): undefined {
  if (game.options.mode === "coop") return small(self, game, point);
  widowGib(self, game, meat, 300, true, point, false, "", false);
  for (let i = 0; i < 2; i++) widowGib(self, game, metal, 300, false, point, false, "", false);
  for (let i = 0; i < 3; i++) widowGib(self, game, metal, 100, false, point, false, "", false);
  return undefined;
}
const legsThink: Q2Think = (entity, game) => {
  if (entity.frame === 17) { const point = widowProject(entity, game, { x: 11.77, y: -7.24, z: 23.31 }); widowEffect(game, point); small(entity, game, point); }
  if (entity.frame < 23) { entity.frame++; game.show(entity); return game.schedule(entity, 0.1, legsThink); }
  if (entity.wait === 0) entity.wait = game.host.now() + 1;
  if (game.host.now() > entity.wait) {
    for (const [offset, pieces] of [[{ x: -65.6, y: -8.44, z: 28.59 }, 2], [{ x: -1.04, y: -51.18, z: 7.04 }, 3]] satisfies readonly (readonly [Vec3, number])[]) {
      const point = widowProject(entity, game, offset); widowEffect(game, point); small(entity, game, point);
      for (let i = 1; i <= pieces; i++) widowGib(entity, game, `models/monsters/blackwidow/gib${i}/tris.md2`, 80 + Math.trunc(game.host.random() * 20), false, point, true);
    }
    return game.remove(entity);
  }
  if (game.host.now() > entity.wait - 0.5 && entity.count === 0) {
    entity.count = 1;
    widowEffect(game, widowProject(entity, game, { x: 31, y: -88.7, z: 10.96 }));
    widowEffect(game, widowProject(entity, game, { x: -12.67, y: -4.39, z: 15.68 }));
  }
  return game.schedule(entity, 0.1, legsThink);
};
export function spawnWidowLegs(self: Q2Entity, game: Q2GameServices): undefined {
  const legs = game.create("widowlegs"), body = game.body(self); legs.model = "models/monsters/legs/tris.md2"; legs.renderFlags = 32768;
  game.move(legs, { origin: body.origin, angles: body.angles }, false); game.solid(legs, "none"); game.motion(legs, "stationary"); game.schedule(legs, 0.1, legsThink); game.link(legs); game.show(legs); return undefined;
}
export const widowDebrisCallbacks: Q2CallbackDefinitions = {
  think: { ...q2GibCallbacks.think, "q2:rogue/widow_gib_free": free, "q2:rogue/widowlegs_think": legsThink },
  touch: { ...q2GibCallbacks.touch, "q2:rogue/widow_gib_touch": touch }, die: { ...q2GibCallbacks.die, "q2:rogue/widow_gib_die": die },
};
export function widowExplosion(context: MonsterContext, offset: Vec3): undefined {
  const { entity, game } = context, point = widowProject(entity, game, offset); widowEffect(game, point);
  widowGib(entity, game, meat, 300, true, point, false, "", false); widowGib(entity, game, metal, 100, false, point, false, "", false);
  for (let i = 0; i < 2; i++) widowGib(entity, game, metal, 300, false, point, false, "", false);
  return undefined;
}
export function widowExplosionLeg(context: MonsterContext): undefined {
  const { entity, game } = context;
  for (const [offset, piece, damage] of [[{ x: -31.89, y: -47.86, z: 67.02 }, 2, 200], [{ x: -44.9, y: -82.14, z: 54.72 }, 1, 300]] satisfies readonly (readonly [Vec3, number, number])[]) {
    const point = widowProject(entity, game, offset); widowEffect(game, point, piece === 2 ? "q2:explosion1_big" : "q2:explosion1");
    widowGib(entity, game, `models/monsters/blackwidow2/gib${piece}/tris.md2`, damage, false, point, true, "misc/fhit3.wav", false);
    widowGib(entity, game, meat, 300, true, point, false, "", false); widowGib(entity, game, metal, 100, false, point, false, "", false);
  }
  return undefined;
}
export function createWidowExplode(monsters: Q2Monsters): Q2Think {
  const explode: Q2Think = (entity, game) => {
    const context = monsters.context(entity.actor.id); if (context === null) throw new Error("Widow explosion lost its source controller");
    const origin = game.body(entity).origin;
    let point = { ...origin, z: origin.z + 24 + (Math.floor(game.host.random() * 0x80000000) & 15) };
    if (entity.count < 8) point.z += 24 + (Math.floor(game.host.random() * 0x80000000) & 31);
    switch (entity.count) {
      case 0: point = add(point, { x: -24, y: -24, z: 0 }); break;
      case 1: point = add(point, { x: 24, y: 24, z: 0 }); small(entity, game, point); break;
      case 2: point = add(point, { x: 24, y: -24, z: 0 }); break;
      case 3: point = add(point, { x: -24, y: 24, z: 0 }); more(entity, game, point); break;
      case 4: point = add(point, { x: -48, y: -48, z: 0 }); break;
      case 5: {
        point = add(point, { x: 48, y: 48, z: 0 }); const arm = widowProject(entity, game, { x: 65.76, y: 17.52, z: 7.56 }); widowEffect(game, arm, "q2:explosion1_big");
        for (let i = 0; i < 2; i++) widowGib(entity, game, metal, 100, false, arm, false, "", false); break;
      }
      case 6: {
        point = add(point, { x: -48, y: 48, z: 0 }); const arm = widowProject(entity, game, { x: 65.76, y: 17.52, z: 7.56 });
        widowGib(entity, game, "models/monsters/blackwidow2/gib4/tris.md2", 200, false, arm, true, "misc/fhit3.wav", false); widowGib(entity, game, meat, 300, true, arm, false, "", false); break;
      }
      case 7: point = add(point, { x: 48, y: -48, z: 0 }); small(entity, game, point); break;
      case 8: point = add(origin, { x: 18, y: 18, z: 48 }); more(entity, game, point); break;
      case 9: point = add(origin, { x: -18, y: 18, z: 48 }); break;
      case 10: point = add(origin, { x: 18, y: -18, z: 48 }); break;
      case 11: point = add(origin, { x: -18, y: -18, z: 48 }); break;
      case 12:
        entity.sound = ""; widowGib(entity, game, meat, 400, true);
        for (let i = 0; i < 2; i++) widowGib(entity, game, metal, 100, false);
        for (let i = 0; i < 2; i++) widowGib(entity, game, metal, 400, false);
        context.state.dead = true; context.setMove("widow2_move_dead"); return monsters.resumeMonster(entity, game);
    }
    entity.count++;
    widowEffect(game, point, entity.count >= 9 && entity.count <= 12 ? "q2:explosion1_big" : entity.count % 2 === 1 ? "q2:explosion1" : "q2:explosion1_np");
    return game.schedule(entity, 0.1, explode);
  };
  return explode;
}
