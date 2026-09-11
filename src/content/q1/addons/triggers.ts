/* quakec_mg1/triggers.qc and quakec_mg3/mg3_triggers.qc, mg3_sacrifice_triggers.qc.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { doorDown, doorUp, spawnButton } from "../foundation/movers.ts";
import { ZERO, overlaps, vadd } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";
import { BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED, BLOODY_NIGHTMARE_NEWGAME, mg3RuneCount } from "./campaign.ts";

export function registerAddonTriggers(context: Q1AddonContext): undefined {
  const { game, base } = context, prefix = `${context.program}:trigger:`;
  const schedule = (entity: Q1Actor, name: string, delay: number): undefined => game.schedule(entity, delay, game.named.action(entity, prefix + name));
  const targets = (entity: Q1Actor, activator: ActorId | null): undefined => { entity.activator = activator; return game.useTargets(entity, activator); };
  game.named.register(prefix + "targets", { action: (_game, entity) => targets(entity, entity.activator) });
  const spawnUse = (classname: string, name: string, initialize?: (entity: Q1Actor) => undefined): undefined => game.registerSpawn(classname, (_game, entity) => {
    if (context.removedOutsideCoop(entity)) return undefined;
    initialize?.(entity); if (game.live(entity)) entity.use = game.named.use(entity, prefix + name); return undefined;
  });

  const counterMessage = (entity: Q1Actor, activator: ActorId | null, sacrifice: boolean, force = false): undefined => {
    if (!game.isPlayer(activator) || !force && (entity.spawnflags & 1) !== 0) return undefined;
    const count = entity.count;
    return context.broadcast(sacrifice ? count === 0 ? "$mg3_qc_sacricie_count_complete" : count >= 1 && count <= 8 ? `$mg3_qc_sacricie_count_${count}_more` : "$mg3_qc_sacricie_count_more"
      : count === 0 ? "$qc_sequence_completed" : count === 1 ? "$qc_one_more" : count === 2 ? "$qc_two_more" : count === 3 ? "$qc_three_more" : "$qc_more_go");
  };
  game.named.register(prefix + "counter_reset", { action: (_game, entity) => { entity.count = entity.number("cnt"); return undefined; } });
  const counterUse = (entity: Q1Actor, activator: ActorId | null, timed: boolean, sacrifice: boolean): undefined => {
    entity.count = Math.fround(entity.count - 1); if (entity.count < 0) return undefined;
    if (timed) schedule(entity, "counter_reset", entity.delay);
    counterMessage(entity, activator, sacrifice); if (entity.count !== 0) return undefined;
    if (timed) { entity.delay = 0; game.cancel(entity); }
    else if (!sacrifice && (entity.spawnflags & 2) !== 0) entity.count = entity.wait;
    game.named.use(entity, "multi_use")(null, activator);
    return timed ? game.remove(entity) : undefined;
  };
  game.named.register(prefix + "counter", { use: (_game, entity, _other, activator) => counterUse(entity, activator, false, false) });
  game.named.register(prefix + "counter_timed", { use: (_game, entity, _other, activator) => counterUse(entity, activator, true, false) });
  game.named.register(prefix + "sacrifice_counter", { use: (_game, entity, _other, activator) => counterUse(entity, activator, false, true) });
  game.registerSpawn("trigger_counter_timed", (_game, entity) => {
    if (context.removedOutsideCoop(entity)) return undefined;
    entity.wait = -1; entity.count ||= 2; entity.delay ||= 2; context.setNumber(entity, "cnt", entity.count);
    entity.use = game.named.use(entity, prefix + "counter_timed"); entity.think = game.named.action(entity, prefix + "counter_reset"); return undefined;
  });
  game.registerSpawn("trigger_counter", (_game, entity) => {
    if (context.removedOutsideCoop(entity)) return undefined;
    entity.count ||= 2; entity.wait ||= entity.count; entity.use = game.named.use(entity, prefix + "counter"); return undefined;
  });
  game.named.register(prefix + "repeater_tick", { action: (_game, entity) => {
    targets(entity, entity.activator); if (!game.live(entity)) return undefined;
    return schedule(entity, "repeater_tick", entity.wait + entity.number("pausetime") * game.host.random());
  } });
  game.named.register(prefix + "repeater_use", { use: (_game, entity, _other, activator) => {
    entity.activator = activator; entity.spawnflags ^= 1;
    return (entity.spawnflags & 1) === 0 ? game.cancel(entity) : schedule(entity, "repeater_tick", entity.wait + entity.number("pausetime") * game.host.random());
  } });
  spawnUse("trigger_repeater", "repeater_use", entity => {
    entity.wait ||= 1;
    return (entity.spawnflags & 1) === 0 ? undefined : schedule(entity, "repeater_tick", entity.wait + entity.number("pausetime") * game.host.random());
  });
  game.named.register(prefix + "multitouch_empty", { action: (_game, entity) => {
    entity.wait = 0; return (entity.spawnflags & 32) === 0 ? targets(entity, entity.activator) : undefined;
  } });
  game.named.register(prefix + "multitouch_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.health(other) <= 0) return undefined;
    if (entity.wait === 0) { entity.wait = 1; if ((entity.spawnflags & 16) === 0) targets(entity, other); }
    return game.live(entity) ? schedule(entity, "multitouch_empty", 0.2) : undefined;
  } });
  game.registerSpawn("trigger_multitouch", (_game, entity) => {
    context.initTrigger(entity); entity.wait = 0; entity.touch = game.named.touch(entity, prefix + "multitouch_touch"); return undefined;
  });
  game.named.register(prefix + "explosion", { action: (_game, entity) => {
    entity.delay = 0; targets(entity, entity.activator); if (!game.live(entity)) return undefined;
    if ((entity.spawnflags & 1) === 0) game.radiusDamage(entity.actor.id, entity.owner, 120, entity.actor.id, null);
    if (context.program === "mg3" && (entity.spawnflags & 2) !== 0) context.services.emit({ kind: "colored-explosion", origin: game.body(entity).origin, colorStart: 244, colorLength: 3 });
    else game.effect("explosion", game.body(entity).origin);
    return game.remove(entity);
  }, use: (_game, entity, _other, activator) => {
    entity.activator = activator;
    return entity.delay > 0 ? schedule(entity, "explosion", entity.delay) : game.named.action(entity, prefix + "explosion")();
  } });
  spawnUse("trigger_explosion", "explosion");
  game.named.register(prefix + "change_target", { use: (_game, entity) => {
    for (const target of game.entities.values()) if (target.target === entity.target) target.target = entity.killtarget;
    return undefined;
  } });
  spawnUse("trigger_changetarget", "change_target", entity => {
    if (entity.target === "" || entity.killtarget === "") throw new Error("trigger_changetarget requires target and killtarget"); return undefined;
  });
  game.named.register(prefix + "cleanup", { use: (_game, entity) => {
    for (const target of [...game.entities.values()]) if (target.monster !== null && game.health(target.actor.id) <= 0) game.remove(target);
    return game.remove(entity);
  } });
  const cleanup = (_game: typeof game, entity: Q1Actor): undefined => {
    if (!game.options.coop) return game.remove(entity);
    entity.use = game.named.use(entity, prefix + "cleanup"); return undefined;
  };
  game.registerSpawn("trigger_cleanup_corpses", cleanup);
  if (context.program !== "mg3") game.registerSpawn("mge2m2_cleanup_corpses", cleanup);
  if (context.program !== "mg3") return undefined;

  game.registerSpawn("trigger_always", (_game, entity) => context.removedOutsideCoop(entity) ? undefined : schedule(entity, "targets", 0.1));
  game.named.register(prefix + "rune_relay", { use: (_game, entity, _other, activator) => {
    const required = entity.spawnflags & 15;
    if ((base.campaign.readFlags() & required) !== required) return undefined;
    entity.activator = activator; return schedule(entity, "targets", 0.1);
  } });
  game.named.register(prefix + "rune_counter", { use: (_game, entity, _other, activator) => mg3RuneCount(base.campaign.readFlags()) >= entity.count ? targets(entity, activator) : undefined });
  game.named.register(prefix + "bn_relay", { use: (_game, entity, _other, activator) => {
    const flags = base.campaign.readFlags();
    for (const [yes, no, bit] of [[1, 8, BLOODY_NIGHTMARE_ACTIVE], [2, 16, BLOODY_NIGHTMARE_NEWGAME], [4, 32, BLOODY_NIGHTMARE_DISCOVERED]] satisfies readonly (readonly [number, number, number])[]) {
      if ((entity.spawnflags & yes) !== 0 && (flags & bit) === 0 || (entity.spawnflags & no) !== 0 && (flags & bit) !== 0) return undefined;
    }
    return targets(entity, activator);
  } });
  spawnUse("trigger_rune_relay", "rune_relay");
  spawnUse("trigger_rune_counter", "rune_counter", entity => { entity.count ||= 2; return undefined; });
  game.registerSpawn("trigger_bloodynightmare_relay", (_game, entity) => { entity.use = game.named.use(entity, prefix + "bn_relay"); return undefined; });
  spawnUse("trigger_sacrifice_counter", "sacrifice_counter", entity => { entity.count ||= 2; entity.wait ||= entity.count; return undefined; });
  game.named.register(prefix + "sacrifice_empty", { action: (_game, entity) => { entity.wait = 0; return undefined; } });
  game.named.register(prefix + "sacrifice_check", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.health(other) <= 0) return undefined;
    if (entity.wait === 0) { entity.wait = 1; const counter = game.find(entity.target)[0]; if (counter !== undefined && counter.count > 0) counterMessage(counter, other, true, true); }
    return schedule(entity, "sacrifice_empty", 0.2);
  } });
  game.registerSpawn("trigger_check_sacrifices", (_game, entity) => {
    context.initTrigger(entity); entity.wait = 0; entity.touch = game.named.touch(entity, prefix + "sacrifice_check"); return undefined;
  });
  game.named.register(prefix + "door_relay", { use: (_game, entity, _other, activator) => {
    for (const target of game.find(entity.target)) {
      const top = target.state === "top" || target.state === "up";
      if ((entity.spawnflags & (top ? 1 : 2)) !== 0) continue;
      if (target.classname === "func_door") { if (top) doorDown(game, target); else doorUp(game, target); }
      else if (target.classname === "func_button") {
        if (top) game.named.action(target, "button_return")(); else game.named.use(target, "button_use")(null, activator);
      }
    }
    return undefined;
  } });
  game.named.register(prefix + "door_group", { use: (_game, entity, _other, activator) => {
    for (const member of game.entities.values()) if (member.text("category") === entity.text("category")) {
      const top = member.state === "top" || member.state === "up", goal = member.number("goal_state");
      if (!top && goal === 0 || top && goal === 1) return undefined;
    }
    return targets(entity, activator);
  } });
  spawnUse("trigger_door_relay", "door_relay", entity => entity.target === "" ? game.remove(entity) : undefined);
  spawnUse("trigger_doorgroup_relay", "door_group", entity => entity.target === "" || entity.text("category") === "" ? game.remove(entity) : undefined);
  game.named.register(prefix + "lore", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.time <= context.playerNumber(other, "lore_active")) return undefined;
    context.setPlayerNumber(other, "lore_active", game.time + 0.5); return game.message(other, entity.message);
  } });
  game.registerSpawn("trigger_lore", (_game, entity) => {
    const flags = base.campaign.readFlags();
    if (game.mapName === "hub") for (const bit of [1, 2, 4]) {
      const number = bit === 1 ? 1 : bit === 2 ? 2 : 3;
      if ((flags & bit) !== 0 && entity.message === `$mg3_hub_rune${number}_hint`) entity.message += "_complete";
    }
    if (game.mapName === "map4" && entity.message === "$mg3_hint_bloody_nightmare_new" && (flags & 448) !== 0) return game.remove(entity);
    context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "lore"); return undefined;
  });
  game.named.register(prefix + "music", { use: (_game, entity) => {
    const track = entity.number("style"); if (entity.sounds === track) return undefined;
    context.services.emit({ kind: "music", track, loopTrack: track });
    for (const music of game.entities.values()) if (music.classname === "trigger_music") music.sounds = track;
    return undefined;
  } });
  spawnUse("trigger_music", "music", entity => {
    entity.sounds = game.world?.sounds ?? 0; if (entity.targetname === "") return game.remove(entity);
    if (entity.number("style") === 0) context.setNumber(entity, "style", 3); return undefined;
  });
  game.named.register(prefix + "heal", { touch: (_game, entity, other) => {
    const player = game.player(other);
    if (player === null || entity.attackFinished > game.time) return undefined;
    const health = game.health(other);
    if (health > 0 && health < player.maxHealth) game.host.combat.setHealth(player.actor, Math.min(health + entity.damage, player.maxHealth));
    entity.attackFinished = Math.fround(game.time + entity.wait); return undefined;
  } });
  game.registerSpawn("trigger_heal", (_game, entity) => {
    entity.damage ||= 1; entity.wait ||= 0.1; context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "heal"); return undefined;
  });
  game.named.register(prefix + "quad", { touch: (_game, entity, other) => {
    const player = game.player(other); if (player === null) return undefined;
    if ((player.powerups.get("quad") ?? 0) <= game.time) game.sound(player.actor, "items/damage.wav", "item");
    const expires = Math.fround(game.time + 0.1); player.powerups.set("quad", expires);
    context.setPlayerNumber(other, "super_time", 2); game.host.powerup(player.actor, "quad", expires); return game.link(entity);
  } });
  game.registerSpawn("trigger_quad", (_game, entity) => { context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "quad"); return undefined; });
  game.named.register(prefix + "kill_monster", { use: (_game, entity, _other, activator) => {
    for (const target of game.find(entity.target)) if (target.monster !== null && game.health(target.actor.id) > 0) {
      game.damage(target.actor.id, activator ?? entity.actor.id, activator, game.health(target.actor.id) * 2);
    }
    return undefined;
  } });
  spawnUse("trigger_relay_killmonster", "kill_monster", entity => entity.target === "" || entity.targetname === "" ? game.remove(entity) : undefined);
  game.named.register(prefix + "silent_teleport", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other)) return undefined;
    const player = game.host.actors.resolveOwned(other), body = game.host.bodies.read(other); if (player === null || body === null) return undefined;
    const height = entity.number("height"), destination = vadd(body.origin, { x: 0, y: 0, z: height + (height < 0 ? 1 : 0) });
    const death = game.create("teledeath"); death.owner = other; death.solid = "trigger";
    game.setBody(death, { origin: destination, bounds: { min: vadd(body.bounds.min, { x: -1, y: -1, z: -1 }), max: vadd(body.bounds.max, { x: 1, y: 1, z: 1 }) } });
    death.touch = game.named.touch(death, "tdeath_touch"); game.link(death);
    const bounds = game.body(death).bounds, box = { min: vadd(destination, bounds.min), max: vadd(destination, bounds.max) };
    for (const victim of game.host.actors.observations()) {
      const state = game.host.bodies.read(victim.id);
      if (state !== null && overlaps(box, { min: vadd(state.origin, state.bounds.min), max: vadd(state.origin, state.bounds.max) })) game.host.callbacks.touch({ self: death.actor, other: victim.id, plane: null, surface: null });
    }
    game.schedule(death, 0.2, game.named.action(death, "SUB_Remove")); game.host.bodies.write(player, { ...body, origin: destination }); return game.host.bodies.link(player);
  } });
  game.registerSpawn("trigger_teleport_silent", (_game, entity) => {
    if (entity.number("height") === 0) context.setNumber(entity, "height", -2048);
    context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "silent_teleport"); return undefined;
  });
  game.named.register(prefix + "cutscene", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other)) return undefined; entity.touch = null;
    const camera = [...game.entities.values()].find(candidate => candidate.classname === "info_intermission");
    if (camera === undefined) throw new Error("trigger_cutscene has no intermission camera");
    const position = game.body(camera).origin, angles = camera.vector("mangle");
    for (const playerId of game.host.players()) {
      const actor = game.host.actors.resolveOwned(playerId), body = game.host.bodies.read(playerId); if (actor === null || body === null) continue;
      game.host.bodies.write(actor, { ...body, origin: position, angles, velocity: ZERO }); game.host.bodies.link(actor);
      const source = game.entity(playerId); if (source !== null) { source.solid = "none"; source.movement = "none"; source.model = ""; }
    }
    return context.services.emit({ kind: "cutscene", camera: position, angles });
  } });
  game.registerSpawn("trigger_cutscene", (_game, entity) => { context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "cutscene"); return undefined; });
  game.registerSpawn("func_axe_button", (_game, entity) => { entity.maxHealth = 1; game.host.combat.setHealth(entity.actor, 1); return spawnButton(game, entity); });
  game.named.register(prefix + "set_skill", { use: (_game, entity, _other, activator) => {
    if (!game.isPlayer(activator)) return undefined;
    const message = entity.message;
    if (message !== "4") base.campaign.writeFlags(base.campaign.readFlags() & ~BLOODY_NIGHTMARE_ACTIVE);
    const skill = message === "0" ? 0 : message === "1" ? 1 : message === "2" ? 2 : message === "3" || message === "4" ? 3 : null;
    if (skill === null) return undefined;
    if (message === "4") base.campaign.writeFlags(base.campaign.readFlags() | BLOODY_NIGHTMARE_ACTIVE);
    context.broadcast(message === "4" ? "$mg3_selected_bloody_nightmare" : `$mg3_hub_selected_${skill === 0 ? "easy" : skill === 1 ? "normal" : skill === 2 ? "hard" : "nightmare"}`);
    base.campaign.setSkill(skill); return context.services.setCvar("skill", String(skill));
  } });
  game.registerSpawn("trigger_relay_setskill", (_game, entity) => { entity.use = game.named.use(entity, prefix + "set_skill"); return undefined; });
  game.named.register(prefix + "health_relay", { use: (_game, entity, _other, activator) => targets(entity, activator) });
  spawnUse("trigger_health_relay", "health_relay", entity => { if (game.health(entity.actor.id) === 0) game.host.combat.setHealth(entity.actor, 0.5); return undefined; });
  const explodeRepeatedly = (entity: Q1Actor): undefined => {
    if (entity.delay > 0) { const delay = entity.delay; entity.delay = 0; return schedule(entity, "explosion_repeater", delay); }
    const previous = game.entity(entity.references.get("explosion.child") ?? null);
    if (previous?.classname === "spawned_explosion") game.remove(previous);
    const child = game.create("spawned_explosion"); child.owner = entity.actor.id;
    entity.references.set("explosion.child", child.actor.id); game.setOrigin(child, game.body(entity).origin);
    game.named.action(child, prefix + "explosion")();
    if ((entity.spawnflags & 4) !== 0 && --entity.count === 0) return game.remove(entity);
    return schedule(entity, "explosion_repeater", entity.wait + game.host.random() * entity.number("pausetime"));
  };
  game.named.register(prefix + "explosion_repeater", { action: (_game, entity) => explodeRepeatedly(entity), use: (_game, entity) => explodeRepeatedly(entity) });
  game.registerSpawn("trigger_explosion_repeater", (_game, entity) => { entity.wait ||= 0.8; entity.use = game.named.use(entity, prefix + "explosion_repeater"); return undefined; });
  return undefined;
}
