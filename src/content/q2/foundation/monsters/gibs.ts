/* Q2 g_misc.c / rerelease g_misc.cpp organic and metallic gibs. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch, Q2Die } from "../host.ts";
import type { Q2CallbackDefinitions } from "../callbacks.ts";
import { add, scale, zero } from "../fields.ts";
import { anglesVectors, vectorAngles } from "./ai.ts";

export interface Q2GibOptions {
  readonly head?: boolean;
  readonly metallic?: boolean;
  readonly skinned?: boolean;
  readonly upright?: boolean;
}

const freeGib: Q2Think = (entity, game) => game.remove(entity);
const animateMeat: Q2Think = (entity, game) => {
  entity.frame++;
  game.show(entity);
  return game.schedule(entity, entity.frame === 10 ? 8 + game.host.random() * 10 : 0.1, entity.frame === 10 ? freeGib : animateMeat);
};

const gibDie: Q2Die = (entity, game) => {
  const cause = entity.lastAttack?.cause;
  if (game.options.edition === "classic" || cause?.kind === "q2" && cause.meansOfDeath === 20) game.remove(entity);
  return undefined;
};
const uprightTouch: Q2Touch = (entity, game, contact) => {
  if (contact.plane !== null && contact.plane.normal.z > 0.7) {
    const current = game.body(entity).angles;
    game.move(entity, { angles: { x: Math.max(-5, Math.min(5, current.x)), y: current.y, z: Math.max(-5, Math.min(5, current.z)) } });
  }
  return undefined;
};
const organicTouch: Q2Touch = (entity, game, contact) => {
  if (game.body(entity).ground === null) return undefined;
  entity.touch = null;
  if (contact.plane !== null) {
    game.sound(entity, "misc/fhit3.wav", 2);
    game.move(entity, { angles: vectorAngles(anglesVectors(vectorAngles(contact.plane.normal)).right) });
    if (entity.model === "models/objects/gibs/sm_meat/tris.md2") { entity.frame++; game.show(entity); game.schedule(entity, 0.1, animateMeat); }
  }
  return undefined;
};
export const q2GibCallbacks: Q2CallbackDefinitions = {
  think: { gib_free: freeGib, gib_think: animateMeat }, die: { gib_die: gibDie }, touch: { gib_touch: organicTouch, gib_touch_upright: uprightTouch },
};

/** A head reuses the dying actor, as ThrowHead/ThrowGib(GIB_HEAD) do. */
export function throwGib(self: Q2Entity, game: Q2GameServices, model: string, damage: number, options: Q2GibOptions = {}): Q2Entity | null {
  game.sourceCallbacks.register(q2GibCallbacks);
  const rerelease = game.options.edition === "rerelease";
  const body = game.body(self);
  const gib = options.head === true ? self : game.create("gib");
  const half = scale({ x: body.bounds.max.x - body.bounds.min.x, y: body.bounds.max.y - body.bounds.min.y, z: body.bounds.max.z - body.bounds.min.z }, 0.5);
  const center = add(body.origin, add(body.bounds.min, add(half, rerelease ? zero : { x: -1, y: -1, z: -1 })));
  const crandom = (): number => game.host.random() * 2 - 1;
  let origin = body.origin;
  if (options.head !== true || rerelease) {
    let tries = 0;
    do {
      origin = add(center, { x: crandom() * half.x, y: crandom() * half.y, z: crandom() * half.z });
      tries++;
    } while (rerelease && tries < 3 && (game.host.pointContents(origin) & 3) !== 0);
    if (rerelease && (game.host.pointContents(origin) & 3) !== 0 && options.head !== true) { game.remove(gib); return null; }
  }
  const impulse = scale({ x: 100 * crandom(), y: 100 * crandom(), z: 200 + 100 * game.host.random() }, damage < 50 ? 0.7 : 1.2);
  const velocity = add(body.velocity, scale(impulse, options.metallic === true ? 1 : 0.5));
  const clipped: Vec3 = { x: Math.max(-300, Math.min(300, velocity.x)), y: Math.max(-300, Math.min(300, velocity.y)), z: Math.max(200, Math.min(500, velocity.z)) };
  gib.model = model;
  if (rerelease) gib.classname = "gib";
  gib.frame = 0;
  gib.oldFrame = -1;
  gib.skin = options.skinned === true ? self.skin : 0;
  gib.effects = rerelease ? 2 : (gib.effects | 2) & ~0x4000;
  if (rerelease) gib.renderFlags = (1 << 24) | (1 << 13) | (1 << 15);
  gib.flags |= 2048 | (rerelease ? (1 << 20) | (1 << 28) : 0);
  gib.serverFlags = (gib.serverFlags & ~4) | (rerelease ? 2 : 0);
  gib.clipMask = 3;
  gib.scale = rerelease ? self.scale : 1;
  gib.angularVelocity = options.head === true && !rerelease
    ? { ...gib.angularVelocity, y: crandom() * 600 }
    : { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 };
  const angles = rerelease ? { x: game.host.random() * 359, y: game.host.random() * 359, z: game.host.random() * 359 } : game.body(gib).angles;
  game.move(gib, { origin, velocity: clipped, angles, bounds: { min: zero, max: zero }, ground: null }, false);
  if (game.host.combat.read(gib.actor.id) === null) game.host.combat.create(gib.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
  else game.host.combat.setTraits(gib.actor, { canTakeDamage: true });
  gib.die = gibDie;
  gib.pain = null;
  gib.use = null;
  gib.touch = rerelease ? options.upright === true ? uprightTouch : null : options.metallic === true ? null : organicTouch;
  game.solid(gib, "none");
  game.motion(gib, options.metallic === true ? "bounce" : "toss");
  game.schedule(gib, 10 + game.host.random() * 10, freeGib);
  game.link(gib);
  game.show(gib);
  return gib;
}

export function throwHead(self: Q2Entity, game: Q2GameServices, model: string, damage: number): Q2Entity | null {
  return throwGib(self, game, model, damage, { head: true });
}
