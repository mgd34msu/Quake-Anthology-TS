import type { ActorId } from "../../../contracts/identity.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use } from "../foundation/host.ts";
import { numberField } from "../foundation/fields.ts";
import { nativeAtof, nativeAtoi } from "../../../core/numeric.ts";
import { q2IsN64 } from "./types.ts";
import type { Q2RereleaseHooks } from "./types.ts";

/** ED_LoadColor accepts packed integers, float RGBA, or byte RGBA. */
export function q2RereleaseColor(value: string): number {
  if (!value.includes(" ")) return nativeAtoi(value);
  const tokens = value.trim().split(/\s+/), components = [0, 0, 0, 1].map((fallback, index) => tokens[index] === undefined ? fallback : nativeAtof(tokens[index] ?? "0"));
  const multiplier = components.some(component => component > 1) ? 1 : 255;
  const channel = (index: number): number => Math.trunc((components[index] ?? 0) * multiplier);
  return channel(3) | channel(2) << 8 | channel(1) << 16 | channel(0) << 24;
}

export class Q2RereleaseLights implements Q2SpawnModule {
  readonly active = new Map<ActorId, boolean>();
  constructor(readonly hooks: Q2RereleaseHooks) {}
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname !== "target_light") return false;
    entity.visible = false; entity.serverFlags |= 1; entity.frame = numberField(entity.spawn, "radius") || 150;
    entity.count = entity.skin; this.active.set(entity.actor.id, false);
    if (entity.target !== "") entity.chain = game.pickTarget(entity.target)?.actor.id ?? null;
    entity.use = this.use;
    if ((entity.spawnflags & 1) !== 0) this.use(entity, game, entity.actor.id, entity.actor.id);
    entity.speed = entity.speed === 0 ? 1 : 0.1 / entity.speed;
    if (q2IsN64(game)) entity.style += 10;
    game.link(entity); this.show(entity, game); return true;
  }
  private show(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.visible = (entity.serverFlags & 1) === 0;
    return this.hooks.emit({ kind: "dynamic-light", actor: entity.actor.id, origin: game.body(entity).origin, radius: entity.frame,
      color: { x: (entity.skin >>> 24 & 255) / 255, y: (entity.skin >>> 16 & 255) / 255, z: (entity.skin >>> 8 & 255) / 255 }, visible: entity.visible });
  }
  private readonly use: Q2Use = (entity, game) => {
    const active = !(this.active.get(entity.actor.id) ?? false); this.active.set(entity.actor.id, active);
    if (active) entity.serverFlags &= ~1; else entity.serverFlags |= 1;
    this.show(entity, game);
    if (!active) return game.cancel(entity);
    if (entity.chain !== null) return game.schedule(entity, 0.1, this.think);
    if ((entity.spawnflags & 4) !== 0) return game.schedule(entity, 0.1, this.flicker);
    return undefined;
  };
  private readonly flicker: Q2Think = (entity, game) => {
    if (game.host.random() < 0.5) entity.serverFlags ^= 1;
    this.show(entity, game); return game.schedule(entity, 0.1, this.flicker);
  };
  private readonly think: Q2Think = (entity, game) => {
    if ((entity.spawnflags & 4) !== 0 && game.host.random() < 0.5) entity.serverFlags ^= 1;
    const style = this.hooks.lightStyle(entity.style), target = game.entity(entity.chain);
    if (style.length === 0) throw new Error(`target_light requires source lightstyle ${entity.style}`);
    if (target === null) throw new Error("target_light lost its source color target");
    entity.delay += entity.speed;
    const index = Math.trunc(entity.delay) % style.length, current = (style.charCodeAt(index) - 97) / 25;
    const fraction = entity.delay % 1, next = (style.charCodeAt((index + 1) % style.length) - 97) / 25;
    const lerp = (entity.spawnflags & 2) !== 0 ? current : next * fraction + current * (1 - fraction);
    const channel = (shift: number): number => Math.trunc((target.skin >>> shift & 255) * lerp + (entity.count >>> shift & 255) * (1 - lerp));
    entity.skin = channel(8) << 8 | channel(16) << 16 | channel(24) << 24;
    this.show(entity, game); return game.schedule(entity, 0.1, this.think);
  };
  readonly callbacks: Q2CallbackDefinitions = { think: { "rr.target_light_think": this.think, "rr.target_light_flicker_think": this.flicker }, use: { "rr.target_light_use": this.use } };
}
