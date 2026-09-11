/* Rerelease g_misc.cpp setup_dynamic_light/setup_shadow_lights. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { normalize3OrZero, sub3 } from "../../../core/math.ts";
import { integerField, numberField, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2Use } from "./host.ts";

export interface Q2ShadowLightState {
  readonly actor: ActorId; readonly origin: Vec3; readonly color: Vec3; readonly visible: boolean;
  readonly radius: number; readonly intensity: number; readonly resolution: number;
  readonly fadeStart: number; readonly fadeEnd: number; readonly lightstyle: number;
  readonly cone: { readonly direction: Vec3; readonly cosHalfAngle: number } | null;
}
export const dynamic_light_use: Q2Use = (entity, game) => {
  entity.serverFlags ^= 1; entity.visible = (entity.serverFlags & 1) === 0;
  return emitQ2ShadowLight(entity, game);
};
export function spawnQ2ShadowLight(entity: Q2Entity, game: Q2GameServices): undefined {
  if (numberField(entity.spawn, "shadowlightradius") > 0) {
    entity.renderFlags = 1 << 14;
    game.host.bodies.write(entity.actor, { ...game.body(entity), bounds: { min: zero, max: zero } });
    game.link(entity);
  }
  if (entity.targetname !== "") entity.use = dynamic_light_use;
  if ((entity.spawnflags & 1) !== 0) entity.serverFlags ^= 1;
  entity.visible = (entity.serverFlags & 1) === 0;
  return undefined;
}
export function emitQ2ShadowLight(entity: Q2Entity, game: Q2GameServices): undefined {
  const target = entity.target === "" ? undefined : [...game.entities.values()].find(candidate => candidate.targetname === entity.target);
  const styleTarget = entity.spawn.values.get("shadowlightstyletarget"), style = styleTarget === undefined ? undefined : [...game.entities.values()].find(candidate => candidate.targetname === styleTarget);
  const origin = game.body(entity).origin, packed = entity.skin;
  const value: Q2ShadowLightState = { actor: entity.actor.id, origin,
    color: packed === 0 ? { x: 1, y: 1, z: 1 } : { x: (packed >>> 24 & 255) / 255, y: (packed >>> 16 & 255) / 255, z: (packed >>> 8 & 255) / 255 },
    visible: (entity.serverFlags & 1) === 0, radius: numberField(entity.spawn, "shadowlightradius"),
    intensity: numberField(entity.spawn, "shadowlightintensity", 1), resolution: integerField(entity.spawn, "shadowlightresolution"),
    fadeStart: numberField(entity.spawn, "shadowlightstartfadedistance"), fadeEnd: numberField(entity.spawn, "shadowlightendfadedistance"),
    lightstyle: style?.style ?? integerField(entity.spawn, "shadowlightstyle", -1),
    cone: target === undefined ? null : { direction: normalize3OrZero(sub3(game.body(target).origin, origin)), cosHalfAngle: Math.cos(numberField(entity.spawn, "shadowlightconeangle", 45) * Math.PI / 180) } };
  return game.host.emit({ kind: "dynamic-light", ...value });
}
export function emitQ2ShadowLights(game: Q2GameServices): undefined {
  for (const entity of game.entities.values()) if (entity.classname === "dynamic_light") emitQ2ShadowLight(entity, game);
  return undefined;
}
