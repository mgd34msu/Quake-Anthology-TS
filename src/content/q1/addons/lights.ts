/* quakec_mg1/lights.qc and quakec_mg3/lights.qc.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import { makeStatic } from "../base/map-entities.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1AddonContext } from "./context.ts";

export function addonLightStyle(fraction: number, fullRange: boolean): string {
  const maximum = fullRange ? 25 : 12;
  return String.fromCharCode(97 + (fraction <= 0 ? 0 : fraction >= 1 ? maximum : Math.floor(fraction * (maximum + 1))));
}

export function registerAddonLights(context: Q1AddonContext): undefined {
  const { game } = context, prefix = `${context.program}:light:`;
  game.registerSpawn("dynamiclight", (_game, entity) => game.options.coop && (entity.spawnflags & 1) !== 0 ? game.remove(entity) : undefined);
  game.named.register(prefix + "ramp_tick", { action: (_game, entity) => {
    const owner = game.entity(entity.owner); if (owner === null) throw new Error("target_lightramp lost its light");
    const state = entity.number("ramp.state"), delta = Math.fround(context.frameTime * entity.delay);
    const fraction = Math.fround(entity.number("cnt") + (state === 3 ? -delta : state === 1 ? delta : 0));
    game.host.emit({ kind: "lightstyle", style: owner.number("style"), pattern: addonLightStyle(fraction, (entity.spawnflags & 1) !== 0) });
    context.setNumber(entity, "cnt", fraction);
    if (fraction >= 1) { context.setNumber(entity, "cnt", 1); context.setNumber(entity, "ramp.state", 2); context.removeFrameTick(entity); }
    if (fraction <= 0) { context.setNumber(entity, "cnt", 0); context.setNumber(entity, "ramp.state", 0); context.removeFrameTick(entity); }
    return undefined;
  } });
  game.named.register(prefix + "ramp_use", { use: (_game, entity) => {
    const state = entity.number("ramp.state");
    context.setNumber(entity, "ramp.state", state === 3 || state === 0 ? 1 : 3);
    return state === 0 || state === 2 ? context.addFrameTick(entity, prefix + "ramp_tick") : undefined;
  } });
  game.named.register(prefix + "ramp_init", { action: (_game, entity) => {
    if (entity.target === "" || entity.targetname === "") throw new Error("target_lightramp requires target and targetname");
    const owner = game.find(entity.target)[0]; if (owner === undefined) throw new Error("target_lightramp has an unmatched target");
    entity.owner = owner.actor.id; const off = (owner.spawnflags & 1) !== 0;
    context.setNumber(entity, "ramp.state", off ? 0 : 2); context.setNumber(entity, "cnt", off ? 0 : 1);
    entity.think = game.named.action(entity, "SUB_Null"); entity.use = game.named.use(entity, prefix + "ramp_use"); return undefined;
  } });
  game.registerSpawn("target_lightramp", (_game, entity) => {
    entity.delay = Math.fround(1 / (entity.delay || 1)); return game.schedule(entity, 0.1, game.named.action(entity, prefix + "ramp_init"));
  });
  game.registerSpawn("light", (_game, entity) => {
    if (entity.targetname === "") return game.remove(entity);
    const style = entity.number("style"); if (style < 32) return undefined;
    if ((entity.spawnflags & 2) !== 0) { game.host.emit({ kind: "lightstyle", style, pattern: entity.targetname }); return game.remove(entity); }
    game.host.emit({ kind: "lightstyle", style, pattern: (entity.spawnflags & 1) !== 0 ? "a" : "m" }); entity.use = game.named.use(entity, "light_use"); return undefined;
  });
  game.registerSpawn("light_fluorospark", (_game, entity) => {
    if (entity.number("style") === 0) context.setNumber(entity, "style", 10);
    return game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: "ambience/buzz1.wav", volume: 0.5, attenuation: 3 });
  });
  const flame = (_game: typeof game, entity: Q1Actor): undefined => {
    entity.model = entity.classname === "light_torch_small_walltorch" ? "progs/flame.mdl" : "progs/flame2.mdl";
    game.precacheModel(entity.model);
    if (entity.classname === "light_flame_large_yellow") entity.frame = 1;
    if ((entity.spawnflags & 4) !== 0) game.setBody(entity, { angles: { x: 180, y: 0, z: 0 } });
    game.precacheSound("ambience/fire1.wav");
    game.host.emit({ kind: "ambient", origin: { ...game.body(entity).origin }, path: "ambience/fire1.wav", volume: 0.5, attenuation: 3 });
    return makeStatic(game, entity);
  };
  for (const classname of ["light_torch_small_walltorch", "light_flame_large_yellow", "light_flame_small_yellow", "light_flame_small_white"]) game.replaceSpawn(classname, flame);
  game.registerSpawn("light_flame_gas", (_game, entity) => {
    entity.model = "progs/flame3.mdl"; context.alpha(entity, 0.6);
    const second = game.create("gas_flame"); second.model = entity.model; second.frame = 1;
    game.setOrigin(second, game.body(entity).origin); context.alpha(second, 0.4); return game.link(second);
  });
  game.registerSpawn("light_candle", (_game, entity) => { entity.model = game.precacheModel("progs/candle.mdl"); return makeStatic(game, entity); });
  return undefined;
}
