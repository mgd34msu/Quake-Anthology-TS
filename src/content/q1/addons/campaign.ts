/* quakec_mg1/items_runes.qc, map_specific; quakec_mg3/items_runes.qc.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { spawnButton, doorUp } from "../foundation/movers.ts";
import { ZERO, vadd } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

export const MG1_ALL_SIGILS = 31;
export const MG1_LAST_SIGIL_SHIFT = 6;
export const MG3_RUNE_MASK = 15;
export const BLOODY_NIGHTMARE_ACTIVE = 64;
export const BLOODY_NIGHTMARE_DISCOVERED = 128;
export const BLOODY_NIGHTMARE_NEWGAME = 256;

export function mg1LastSigil(flags: number): number { return (flags >>> MG1_LAST_SIGIL_SHIFT) & MG1_ALL_SIGILS; }
export function mg1ClearLastSigil(flags: number): number { return flags & ~(MG1_ALL_SIGILS << MG1_LAST_SIGIL_SHIFT); }
export function mg3RuneCount(flags: number): number {
  let count = 0;
  for (const bit of [1, 2, 4, 8]) if ((flags & bit) !== 0) count++;
  return count;
}

export function registerCampaignAddons(context: Q1AddonContext): undefined {
  const { game, base } = context, prefix = `${context.program}:campaign:`;
  const action = (entity: Q1Actor, name: string, delay: number): undefined => game.schedule(entity, delay, game.named.action(entity, prefix + name));
  const useTargets = (entity: Q1Actor, activator: ActorId | null): undefined => game.useTargets(entity, activator);
  game.named.register(prefix + "gib_monster", { action: (_game, entity) => {
    const world = game.world;
    if (world === null) throw new Error("Horde exit requires the source world actor");
    game.damage(entity.actor.id, world.actor.id, world.actor.id, 4000); return undefined;
  } });
  base.levelRules.registerIntermissionRule({ id: `${context.program}:campaign`,
    touch: (trigger, _player) => {
      game.world?.fields.set("addon.intermissiontext", trigger.text("endtext"));
      if (game.mapName === "mgend") base.campaign.writeFlags(0);
      return undefined;
    },
    begin: (map, _cause) => {
      if (base.options.officialCampaign !== false) {
        const complete = game.mapName === "e5end" ? "E5END" : game.mapName === "mgend" ? "MGEND" : context.program === "mg3" && game.mapName === "boss" && (map === "start" || map === "map1") ? "MG3" : null;
        if (complete !== null) {
          game.host.emit({ kind: "achievement", player: null, id: `ACH_COMPLETE_${complete}` });
          if (game.options.skill === 3) game.host.emit({ kind: "achievement", player: null, id: `ACH_COMPLETE_${complete}_NIGHTMARE` });
        }
      }
      if (game.mapName === "e5m6" && map === "e5sm2") game.host.emit({ kind: "achievement", player: null, id: "ACH_FIND_E5M8" });
      if (game.mapName === "mge1m1" && map === "mge1m3") game.host.emit({ kind: "achievement", player: null, id: "ACH_FIND_MGE1M3" });
      if (context.program !== "mg3") {
        const manager = [...game.entities.values()].find(entity => entity.classname === "horde_manager");
        if (manager !== undefined) {
          game.cancel(manager);
          for (const monster of game.entities.values()) if (monster.text("category") === "monster") action(monster, "gib_monster", 0.2 + game.host.random() * 1.8);
        }
      }
      return undefined;
    },
    finale: stage => {
      if (stage === 2) {
        const map = game.mapName, text = map === "e1m7" ? base.registered ? "$qc_finale_e1" : "$qc_finale_e1_shareware" : map === "e2m6" ? "$qc_finale_e2" : map === "e3m6" ? "$qc_finale_e3" : map === "e4m7" ? "$qc_finale_e4"
          : game.world?.text("endtext") || game.world?.text("addon.intermissiontext") || "";
        game.world?.fields.set("addon.intermissiontext", "");
        return text === "" ? null : { kind: "finale", text, track: 2 };
      }
      if (stage === 3) {
        if (!base.registered) return { kind: "sell-screen" };
        if (context.program !== "mg3" && (base.campaign.readFlags() & MG1_ALL_SIGILS) === MG1_ALL_SIGILS) return { kind: "finale", text: "$qc_mg1_endtext_all_runes", track: 2 };
      }
      return null;
    },
    travel: (map, cause) => {
      if (context.services.cvar("samelevel") !== 0) { game.travel(game.mapName, cause); return true; }
      if (context.program !== "mg3" && context.services.cvar("horde") !== 0) {
        game.travel(game.mapName === "horde1" ? "horde2" : game.mapName === "horde2" ? "horde3" : game.mapName === "horde3" ? "horde4" : "horde1", cause); return true;
      }
      if (context.program === "mg3" && game.mapName === "hub" && (base.campaign.readFlags() & (BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_NEWGAME)) === (BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_NEWGAME) && map === "secret2") {
        game.travel("boss2", cause); return true;
      }
      if (map === "start" && !game.options.coop && game.options.deathmatch === 0) {
        game.host.emit({ kind: "server-command", text: "menu_credits\ndisconnect\n" }); return true;
      }
      return false;
    },
  });
  const touchSigil = (entity: Q1Actor, other: ActorId): undefined => {
    if (entity.solid !== "trigger" || !game.isPlayer(other) || game.health(other) <= 0) return undefined;
    context.broadcast(entity.text("netname"));
    const player = game.host.actors.resolveOwned(other);
    if (player !== null) game.sound(player, "misc/runekey.wav", "item");
    game.effect("pickup", game.body(entity).origin, other);
    entity.solid = "none"; entity.model = ""; game.link(entity);
    const bits = context.program === "mg3" ? entity.number("style") : entity.spawnflags & MG1_ALL_SIGILS;
    base.campaign.writeFlags(base.campaign.readFlags() | bits | (context.program === "mg3" ? 0 : bits << MG1_LAST_SIGIL_SHIFT));
    if (context.program !== "mg3" && context.services.cvar("horde") !== 0 && (bits & 2) !== 0) {
      for (const player of game.host.players()) context.setPlayerNumber(player, "hunger_time", game.time + 10);
    }
    context.services.emit({ kind: "rune-collected", program: context.program, player: other, bits });
    return useTargets(entity, other);
  };
  game.named.register(prefix + "sigil_touch", { touch: (_game, entity, other) => touchSigil(entity, other) });
  game.named.register(prefix + "drop_item", { action: (_game, entity) => {
    const body = game.body(entity), start = vadd(body.origin, { x: 0, y: 0, z: 6 });
    const floor = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (floor.allSolid || floor.fraction === 1) return game.remove(entity);
    game.setBody(entity, { origin: floor.end, velocity: ZERO, ground: floor.actor }); return game.link(entity);
  } });
  game.named.register(prefix + "use_targets", { action: (_game, entity) => useTargets(entity, entity.activator) });
  game.named.register(prefix + "indicator_use", { use: (_game, entity, _other, activator) => {
    context.alpha(entity, 1); return useTargets(entity, activator);
  } });
  game.named.register(prefix + "hub_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other)) return undefined;
    if (game.options.noExit === 1 || game.options.noExit === 2 && game.mapName !== "start") {
      game.damage(other, entity.actor.id, entity.actor.id, 50000, null, "direct", "exit"); return undefined;
    }
    base.levelRules.changelevelTouched(entity, other); base.options.playerExited?.(other); useTargets(entity, other);
    const map = base.options.sameLevel?.() ? game.mapName : entity.text("map");
    if ((entity.spawnflags & 1) !== 0 && game.options.deathmatch === 0 && entity.text("endtext") === "") return base.levelRules.travelTo(map, other);
    entity.touch = null; entity.activator = other; return action(entity, "hub_changelevel", 0.1);
  } });
  game.named.register(prefix + "hub_changelevel", { action: (_game, entity) => {
    base.levelRules.begin(entity.text("map"), entity.activator);
    if ((entity.spawnflags & 1) !== 0) {
      const result = base.levelRules.advanceFinale(game.time);
      if (result.kind === "finale") {
        context.services.emit({ kind: "music", track: result.track, loopTrack: 3 });
        game.host.emit({ kind: "finale", text: result.text, stage: 2 });
      } else if (result.kind === "sell-screen") context.services.emit({ kind: "sell-screen" });
    }
    return undefined;
  } });
  game.named.register(prefix + "electrode_touch", { touch: (_game, entity, other, normal) => {
    if (!game.isPlayer(other) || game.health(other) <= 0) return undefined;
    game.named.touch(entity, "button_touch")(other, normal); entity.touch = null;
    for (const target of game.entities.values()) if (target.classname === "mge2m2_electrode_target" && target.number("cnt") === entity.number("cnt")) {
      game.schedule(target, 0.1, game.named.action(target, "SUB_Remove"));
    }
    return undefined;
  } });
  game.named.register(prefix + "egg_use", { use: (_game, entity) => {
    for (const target of game.find(entity.target)) if (target.classname === "func_door") {
      target.movedir = target.fields.has("dest2") ? target.vector("dest2") : target.dest2; target.pos1 = game.body(target).origin;
      target.pos2 = vadd(target.pos1, target.movedir); target.state = "bottom"; target.speed = 500;
      target.fields.set("noise1", "doors/drclos4.wav"); target.fields.set("noise2", "doors/doormv1.wav");
      doorUp(game, target);
    }
    return undefined;
  } });
  const fixPickup = (entity: Q1Actor): undefined => {
    const enable = entity.activated; entity.activated = true;
    for (const rune of game.entities.values()) if (rune.classname === "item_sigil") rune.touch = enable ? game.named.touch(rune, prefix + "sigil_touch") : null;
    return undefined;
  };
  game.named.register(prefix + "fix_pickup", { action: (_game, entity) => fixPickup(entity), use: (_game, entity) => fixPickup(entity) });

  game.replaceSpawn("item_sigil", (_game, entity) => {
    const mission3 = context.program === "mg3", spawned = mission3 ? entity.spawnflags & 128 : 0;
    if (entity.spawnflags === 0) entity.spawnflags = 1;
    const bits = mission3 ? [1, 2, 4, 8] : [1, 2, 4, 8, 16, 32];
    const index = bits.findIndex(bit => (entity.spawnflags & bit) !== 0), bit = bits[index];
    if (bit === undefined) throw new Error(`${context.program} item_sigil has no source rune model`);
    entity.spawnflags = bit | spawned; context.setNumber(entity, "style", bit);
    entity.model = mission3 ? `progs/end${index + 1}.mdl` : `progs/mg1_rune${index + 1}.mdl`;
    entity.fields.set("netname", mission3 ? `$mg3_qc_rune${index + 1}` : `$qc_mg1_pickup_rune${index + 1}`);
    entity.solid = "trigger"; entity.movement = "toss"; entity.touch = game.named.touch(entity, prefix + "sigil_touch");
    game.setBounds(entity, { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    return action(entity, "drop_item", 0.2);
  });
  game.registerSpawn("misc_rune_indicator", (_game, entity) => {
    const active = (entity.spawnflags & 64) !== 0; entity.spawnflags &= ~64;
    if (entity.spawnflags === 0) entity.spawnflags = 1;
    const bits = [1, 2, 4, 8, 16, 32], index = bits.findIndex(bit => (entity.spawnflags & bit) !== 0), bit = bits[index];
    if (bit === undefined) throw new Error("misc_rune_indicator has no rune model");
    entity.spawnflags = bit; entity.model = `progs/mg1_rune${index + 1}.mdl`; entity.use = game.named.use(entity, prefix + "indicator_use");
    if ((base.campaign.readFlags() & bit) !== 0 || active) return action(entity, "use_targets", 0.2);
    return context.alpha(entity, 0.2);
  });
  game.replaceSpawn("func_bossgate", (_game, entity) => {
    const inverse = (entity.spawnflags & 64) !== 0; entity.spawnflags &= ~64;
    if (entity.spawnflags === 0) entity.spawnflags = 15;
    entity.spawnflags &= MG1_ALL_SIGILS;
    const complete = (base.campaign.readFlags() & entity.spawnflags) === entity.spawnflags;
    if (complete !== inverse) return game.remove(entity);
    entity.solid = "bsp"; entity.movement = "push"; game.setBody(entity, { angles: ZERO });
    entity.use = game.named.use(entity, "func_wall_use");
    return entity.target !== "" || entity.killtarget !== "" ? action(entity, "use_targets", 0.2) : undefined;
  });
  game.registerSpawn("info_player_start_hub", () => undefined);
  game.replaceSpawn("trigger_changelevel", (_game, entity) => {
    if (entity.text("map") === "") throw new Error("changelevel trigger doesn't have map");
    context.initTrigger(entity);
    if (game.live(entity)) entity.touch = game.named.touch(entity, prefix + "hub_touch");
    return undefined;
  });
  if (context.program === "mg3") base.spawnSelector.registerSelection("mg3:start", () => {
    if (game.options.coop || game.options.deathmatch !== 0 || [...game.entities.values()].some(entity => entity.classname === "testplayerstart")) return undefined;
    const point = [...game.entities.values()].find(entity => entity.classname === "info_player_start");
    if (point === undefined) throw new Error("PutClientInServer: no info_player_start on level"); return point;
  });
  if (context.program !== "mg3") {
    base.spawnSelector.registerSelection(`${context.program}:hub`, () => {
      if (game.options.coop || game.options.deathmatch !== 0) return undefined;
      if ([...game.entities.values()].some(entity => entity.classname === "testplayerstart")) return undefined;
      const pickup = mg1LastSigil(base.campaign.readFlags()); if (pickup === 0) return undefined;
      const index = [1, 2, 4, 8, 16, 32].findIndex(bit => (pickup & bit) !== 0);
      const point = [...game.entities.values()].find(entity => entity.text("netname") === `start_${index + 1}`);
      if (point?.classname !== "info_player_start_hub") return undefined;
      base.campaign.writeFlags(mg1ClearLastSigil(base.campaign.readFlags())); return point;
    });
    game.registerSpawn("hub_trigger_changelevel", (_game, entity) => {
      if ((base.campaign.readFlags() & MG1_ALL_SIGILS) !== MG1_ALL_SIGILS) return game.remove(entity);
      if (entity.text("map") === "") throw new Error("hub_trigger_changelevel is missing its map");
      context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "hub_touch"); return undefined;
    });
    game.registerSpawn("mge2m2_electrode_target", () => undefined);
    game.registerSpawn("mge2m2_electrode_button", (_game, entity) => {
      spawnButton(game, entity); entity.touch = game.named.touch(entity, prefix + "electrode_touch"); return undefined;
    });
    game.registerSpawn("mge2m2_rune_egg_opener", (_game, entity) => { entity.use = game.named.use(entity, prefix + "egg_use"); return undefined; });
    game.registerSpawn("mge2m2_rune_pickup_fixer", (_game, entity) => {
      entity.use = game.named.use(entity, prefix + "fix_pickup"); return action(entity, "fix_pickup", 0.8);
    });
  }
  return undefined;
}
