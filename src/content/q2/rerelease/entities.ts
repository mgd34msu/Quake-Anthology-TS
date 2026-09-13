import type { ActorId } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import { add, dot, length, movedir, normalize, numberField, scale, subtract, vectorField, zero } from "../foundation/fields.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch, Q2Use } from "../foundation/host.ts";
import type { Q2RereleasePlayers } from "./players.ts";
import { equalQ2Fog, interpolateQ2Fog, q2RereleaseFogFields } from "./fog.ts";
import { createQ2Fog } from "./types.ts";
import type { Q2FogState, Q2RereleaseHooks } from "./types.ts";
import { createQ2RereleaseCampaignState, q2RereleaseUnitReport, updateQ2RereleaseLevel } from "./campaign.ts";
import type { Q2RereleaseCampaignState } from "./campaign.ts";
import { unrotateQ2Landmark } from "../foundation/targets.ts";
import type { Q2LandmarkCarry } from "../foundation/host.ts";
import { angleMod } from "../../../core/math.ts";
import { q2WorldText } from "./world-text.ts";
export { createQ2RereleaseCampaignState } from "./campaign.ts";
export type { Q2RereleaseCampaignState } from "./campaign.ts";

interface HealthBar { readonly controller: ActorId; readonly target: ActorId; deadUntil: number | null; }
function absoluteBounds(entity: Q2Entity, game: Q2GameServices): Bounds {
  const body = game.body(entity);
  return { min: add(body.origin, body.bounds.min), max: add(body.origin, body.bounds.max) };
}
function intersects(first: Bounds, second: Bounds): boolean {
  return first.min.x <= second.max.x && first.max.x >= second.min.x && first.min.y <= second.max.y && first.max.y >= second.min.y && first.min.z <= second.max.z && first.max.z >= second.min.z;
}

export class Q2RereleaseEntities implements Q2SpawnModule {
  worldFog: Q2FogState = createQ2Fog();
  story = "";
  sky = { name: "unit1_", rotation: 0, autoRotate: true, axis: { x: 0, y: 0, z: 1 } };
  poi: { readonly actor: ActorId; readonly origin: Vec3; readonly image: string; readonly dynamic: ActorId | null } | null = null;
  poiStage = 0;
  lastAutoSave = 0;
  readonly healthBars: (HealthBar | null)[] = [null, null];
  readonly healthTargets = new Map<ActorId, ActorId>();

  constructor(readonly players: Q2RereleasePlayers, readonly hooks: Q2RereleaseHooks, readonly campaign: Q2RereleaseCampaignState = createQ2RereleaseCampaignState()) {}

  endOfUnit(game: Q2GameServices): undefined {
    updateQ2RereleaseLevel(game, this.campaign);
    return this.hooks.emit({ kind: "end-of-unit", levels: q2RereleaseUnitReport(this.campaign), buttonTime: game.host.now() + 5 });
  }

  transferHealthbarTarget(oldActor: ActorId, newActor: ActorId, game: Q2GameServices): undefined {
    for (let slot = 0; slot < this.healthBars.length; slot++) {
      const bar = this.healthBars[slot];
      if (bar === undefined || bar === null || bar.target !== oldActor) continue;
      this.healthBars[slot] = { ...bar, target: newActor };
      const controller = game.entity(bar.controller);
      if (controller !== null) controller.enemy = newActor;
    }
    return undefined;
  }

  private trigger(entity: Q2Entity, game: Q2GameServices): undefined {
    const angles = game.body(entity).angles;
    entity.movedir = movedir({ ...angles, y: angles.y === 0 ? 360 : angles.y });
    entity.visible = false; entity.serverFlags |= 1;
    game.move(entity, { angles: zero }, false); game.solid(entity, "trigger"); game.link(entity);
    return undefined;
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    const name = entity.classname;
    if (name === "worldspawn") {
      this.worldFog = q2RereleaseFogFields(entity.spawn);
      this.sky = { name: entity.spawn.values.get("sky") ?? "unit1_", rotation: numberField(entity.spawn, "skyrotate"), autoRotate: numberField(entity.spawn, "skyautorotate", 1) !== 0,
        axis: entity.spawn.values.has("skyaxis") ? vectorField(entity.spawn, "skyaxis") : { x: 0, y: 0, z: 1 } };
      return false;
    }
    switch (name) {
      case "misc_flare":
        entity.renderFlags = 0x200000 | ((entity.spawnflags & 7) << 10) | ((entity.spawnflags & 8) !== 0 ? 1 : 0)
          | (entity.spawn.values.get("image") ? 256 : 0);
        entity.scale = numberField(entity.spawn, "radius");
        game.solid(entity, "none");
        game.move(entity, { bounds: { min: { x: -32, y: -32, z: -32 }, max: { x: 32, y: 32, z: 32 } } }, false);
        if (entity.targetname !== "") entity.use = this.flareUse;
        game.link(entity); return true;
      case "info_world_text":
        if (!entity.spawn.values.has("message")) { game.host.diagnostic("info_world_text: no message"); game.remove(entity); return true; }
        entity.think = this.worldTextThink; entity.use = this.worldTextUse;
        if ((entity.spawnflags & 1) === 0) { entity.activator = entity.actor.id; game.schedule(entity, game.host.frameSeconds(), this.worldTextThink); }
        return true;
      case "trigger_flashlight": this.trigger(entity, game); entity.movedir = { ...entity.movedir, z: numberField(entity.spawn, "height") }; entity.touch = this.flashlightTouch; return true;
      case "trigger_fog":
        this.trigger(entity, game); entity.delay ||= 0.5; entity.goal = game.pickTarget(entity.target)?.actor.id ?? null; entity.touch = this.fogTouch;
        if ((entity.spawnflags & 3) === 0) game.host.diagnostic("trigger_fog does not affect fog or height fog");
        return true;
      case "trigger_coop_relay":
        this.trigger(entity, game); entity.message ||= "$g_coop_wait_for_players"; entity.map ||= "$g_coop_players_waiting_for_you"; entity.wait ||= 1;
        if ((entity.spawnflags & 1) !== 0) game.schedule(entity, entity.wait, this.coopRelayThink); else entity.use = this.coopRelayUse;
        return true;
      case "target_poi":
        if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
        entity.visible = false; entity.serverFlags |= 1; entity.use = this.poiUse; game.schedule(entity, 0.001, this.poiSetup); return true;
      case "target_music": entity.use = this.musicUse; return true;
      case "target_changelevel":
        if (entity.map === "") { game.host.diagnostic("target_changelevel has no map"); game.remove(entity); return true; }
        entity.visible = false; entity.serverFlags |= 1; entity.use = this.changeLevelUse; return true;
      case "target_sky": entity.use = this.skyUse; return true;
      case "target_crossunit_trigger": case "target_crossunit_target": case "target_autosave": case "target_achievement": case "target_story": case "target_healthbar":
        if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
        entity.visible = false; entity.serverFlags |= 1;
        if (name === "target_crossunit_trigger") entity.use = this.crossUnitUse;
        else if (name === "target_crossunit_target") { entity.delay ||= 1; game.schedule(entity, entity.delay, this.crossUnitThink); }
        else if (name === "target_autosave") entity.use = this.autosaveUse;
        else if (name === "target_achievement") entity.use = this.achievementUse;
        else if (name === "target_story") entity.use = this.storyUse;
        else if (entity.target === "" || entity.message === "") { game.host.diagnostic("target_healthbar requires target and message"); game.remove(entity); }
        else { entity.use = this.healthbarUse; game.schedule(entity, 0.025, this.healthbarCheck); }
        return true;
      default: return false;
    }
  }

  toggleFlashlight(actor: ActorId, game: Q2GameServices, enabled: boolean): undefined {
    const extra = this.players.extra(actor), entity = game.entity(actor);
    if (extra.flashlight === enabled) return undefined;
    extra.flashlight = enabled;
    if (entity !== null) { if (enabled) entity.flags |= 0x400000; else entity.flags &= ~0x400000; }
    if (entity !== null) game.sound(entity, enabled ? "items/flashlight_on.wav" : "items/flashlight_off.wav", 0, 1, 3);
    return this.hooks.emit({ kind: "flashlight", actor, enabled });
  }

  private readonly flashlightTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other)) return undefined;
    if ((entity.spawnflags & 1) !== 0 && !this.hooks.clipTrigger(entity, contact.other, game)) return undefined;
    if (entity.style === 1 || entity.style === 2) return this.toggleFlashlight(contact.other, game, entity.style === 1);
    const body = game.host.bodies.read(contact.other);
    if (body !== null && dot(body.velocity, body.velocity) > 32) return this.toggleFlashlight(contact.other, game, dot(normalize(body.velocity), entity.movedir) > 0);
    return undefined;
  };

  private readonly fogTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other) || entity.timestamp > game.host.now()) return undefined;
    entity.timestamp = game.host.now() + entity.wait;
    const extra = this.players.extra(contact.other), values = game.entity(entity.goal) ?? entity, body = game.host.bodies.read(contact.other);
    if (body === null) return undefined;
    extra.fogTransition = (entity.spawnflags & 4) !== 0 ? 0 : values.delay || 0.5;
    let value: Q2FogState;
    if ((entity.spawnflags & 16) !== 0) {
      const bounds = absoluteBounds(entity, game), center = scale(add(bounds.min, bounds.max), 0.5);
      const size = scale(add(subtract(bounds.max, bounds.min), subtract(body.bounds.max, body.bounds.min)), 0.5), dir = entity.movedir;
      const start = { x: -dir.x * size.x, y: -dir.y * size.y, z: -dir.z * size.z }, end = scale(start, -1), relative = subtract(body.origin, center);
      const distance = { x: relative.x * Math.abs(dir.x), y: relative.y * Math.abs(dir.y), z: relative.z * Math.abs(dir.z) };
      const fraction = Math.max(0, Math.min(1, length(subtract(distance, start)) / length(subtract(start, end))));
      value = interpolateQ2Fog(q2RereleaseFogFields(values.spawn, true), q2RereleaseFogFields(values.spawn), fraction);
    } else {
      if ((entity.spawnflags & 8) === 0 && length(body.velocity) <= 0.0001) return undefined;
      const on = (entity.spawnflags & 8) !== 0 || dot(normalize(body.velocity), entity.movedir) > 0;
      value = q2RereleaseFogFields(values.spawn, !on);
    }
    extra.wantedFog = { fog: (entity.spawnflags & 1) !== 0 ? value.fog : extra.wantedFog.fog, heightFog: (entity.spawnflags & 2) !== 0 ? value.heightFog : extra.wantedFog.heightFog };
    return undefined;
  };

  forceFog(actor: ActorId, instant: boolean): undefined {
    const extra = this.players.extra(actor);
    if (equalQ2Fog(extra.fog, extra.wantedFog)) return undefined;
    this.hooks.emit({ kind: "fog", actor, value: extra.wantedFog, transitionMilliseconds: instant ? 0 : Math.max(0, Math.min(65535, Math.trunc(extra.fogTransition * 1000))) });
    extra.fog = extra.wantedFog;
    return undefined;
  }

  private eligiblePlayers(game: Q2GameServices): readonly Q2Entity[] {
    const result: Q2Entity[] = [];
    for (const actor of game.host.players()) {
      const player = game.entity(actor), state = this.players.states.get(actor);
      if (player !== null && state !== undefined && !state.dead && !state.spectator && !state.noclip && (game.host.combat.read(actor)?.health ?? 0) > 0) result.push(player);
    }
    return result;
  }

  private fireRelay(entity: Q2Entity, game: Q2GameServices, actor: ActorId | null): undefined {
    const message = entity.message; entity.message = ""; game.useTargets(entity, actor); entity.message = message; return undefined;
  }

  private readonly coopRelayUse: Q2Use = (entity, game, _other, activator) => {
    if (game.options.mode !== "coop") return this.fireRelay(entity, game, activator);
    const bounds = absoluteBounds(entity, game), outside = this.eligiblePlayers(game).filter(player => !intersects(bounds, absoluteBounds(player, game)));
    if (outside.length === 0) return this.fireRelay(entity, game, activator);
    if (entity.timestamp < game.host.now()) {
      for (const player of outside) game.host.emit({ kind: "centerprint", actor: player.actor.id, text: entity.map });
      if (activator !== null) game.host.emit({ kind: "centerprint", actor: activator, text: entity.message });
    }
    entity.timestamp = game.host.now() + 5; return undefined;
  };

  private readonly coopRelayThink: Q2Think = (entity, game) => {
    const bounds = absoluteBounds(entity, game), active = this.eligiblePlayers(game), inside = active.filter(player => intersects(bounds, absoluteBounds(player, game)));
    if (inside.length === active.length) { this.fireRelay(entity, game, game.host.players()[0] ?? null); return game.remove(entity); }
    if (inside.length !== 0 && entity.timestamp < game.host.now()) {
      for (const actor of game.host.players()) game.host.emit({ kind: "centerprint", actor, text: inside.some(player => player.actor.id === actor) ? entity.message : entity.map });
      entity.timestamp = game.host.now() + 5;
    }
    return game.schedule(entity, entity.wait, this.coopRelayThink);
  };

  private team(entity: Q2Entity, game: Q2GameServices): readonly Q2Entity[] {
    const name = entity.spawn.values.get("team");
    return name === undefined || name === "" ? [entity] : [...game.entities.values()].filter(member => member.spawn.values.get("team") === name);
  }

  private readonly poiSetup: Q2Think = (entity, game) => {
    if ((entity.spawnflags & 5) !== 0) for (const member of this.team(entity, game)) member.spawnflags |= entity.spawnflags & 5;
    return undefined;
  };

  readonly poiUse: Q2Use = (source, game, _other, activator) => {
    source.spawnflags &= ~8;
    if (source.count !== 0 && this.poiStage > source.count) return undefined;
    let selected: Q2Entity | null = source;
    const team = this.team(source, game), master = team[0] ?? source;
    if (source.spawn.values.has("team")) {
      selected = null;
      let bestDistance = Infinity, bestStyle = 2147483647, fallback: Q2Entity | null = null;
      const origin = activator === null ? zero : game.host.bodies.read(activator)?.origin ?? zero;
      for (const member of team) {
        if ((member.spawnflags & 8) !== 0) continue;
        if ((member.spawnflags & 2) !== 0) { fallback = member; continue; }
        if (member.count !== 0 && this.poiStage > member.count || member.style > bestStyle) continue;
        const destination = game.body(member).origin, path = this.hooks.navigation(origin, destination);
        const distance = path.kind === "path" ? path.distanceSquared : path.kind === "no-navigation" ? dot(subtract(destination, origin), subtract(destination, origin)) : Infinity;
        const nearest = (master.spawnflags & 1) !== 0;
        if (nearest && selected !== null && distance > bestDistance) continue;
        if (member.style < bestStyle) {
          if (nearest && distance === Infinity) continue;
          bestStyle = member.style; if (nearest) bestDistance = distance; selected = member;
        } else if (!nearest || distance < bestDistance) { bestDistance = distance; selected = member; }
      }
      if (selected === null && fallback !== null && (fallback.spawnflags & 4) !== 0) selected = fallback;
    }
    if (selected === null || selected.classname === "target_poi" && (selected.spawnflags & 2) !== 0 && (selected.spawnflags & 4) === 0) return undefined;
    if (selected.count !== 0) this.poiStage = selected.count;
    const dynamic = (selected.spawnflags & 4) !== 0 ? team.find(member => (member.spawnflags & 2) !== 0)?.actor.id ?? null : null;
    this.poi = { actor: selected.actor.id, origin: game.body(selected).origin, image: selected.spawn.values.get("image") ?? "friend", dynamic };
    return undefined;
  };

  private readonly flareUse: Q2Use = (entity, game) => { entity.serverFlags ^= 1; game.link(entity); return undefined; };
  private readonly musicUse: Q2Use = (entity, game) => game.host.emit({ kind: "music", track: entity.spawn.values.get("sounds") ?? "0" });
  private readonly skyUse: Q2Use = (entity) => {
    const values = entity.spawn.values;
    this.sky = { name: values.get("sky") ?? this.sky.name, rotation: values.has("skyrotate") ? numberField(entity.spawn, "skyrotate") : this.sky.rotation,
      autoRotate: values.has("skyautorotate") ? numberField(entity.spawn, "skyautorotate") !== 0 : this.sky.autoRotate,
      axis: values.has("skyaxis") ? vectorField(entity.spawn, "skyaxis") : this.sky.axis };
    return this.hooks.emit({ kind: "sky", ...this.sky });
  };
  private readonly crossUnitUse: Q2Use = (entity, game) => { this.campaign.crossUnitFlags |= entity.spawnflags; return game.remove(entity); };
  private readonly crossUnitThink: Q2Think = (entity, game) => {
    if (entity.spawnflags === (this.campaign.crossUnitFlags & 0xff00ff & entity.spawnflags)) { game.useTargets(entity, entity.actor.id); game.remove(entity); }
    return undefined;
  };
  private readonly autosaveUse: Q2Use = (_entity, game) => {
    if (game.host.now() - this.lastAutoSave > this.players.rereleaseOptions.autoSaveMinimumTime) { this.hooks.emit({ kind: "autosave" }); this.lastAutoSave = game.host.now(); }
    return undefined;
  };
  private readonly achievementUse: Q2Use = entity => this.hooks.emit({ kind: "achievement", id: entity.spawn.values.get("achievement") ?? "" });
  private readonly storyUse: Q2Use = entity => { this.story = entity.message; return this.hooks.emit({ kind: "story", text: this.story }); };
  private readonly changeLevelUse: Q2Use = (entity, game, other, activator) => {
    if (this.players.intermission.kind !== "playing") return undefined;
    if (game.options.mode === "singleplayer") {
      const first = [...this.players.states].find(([, state]) => state.slot === 0);
      if (first === undefined || (game.host.combat.read(first[0])?.health ?? 0) <= 0) return undefined;
    }
    if (game.options.mode === "deathmatch") {
      if (!this.players.rereleaseOptions.deathmatchAllowExit && other !== game.host.worldActor()) {
        const target = game.entity(other);
        if (target !== null) game.damage(target.actor.id, entity, entity.actor.id, 10 * target.maxHealth, 1000, zero, game.body(target).origin, zero, 28);
        return undefined;
      }
      if (game.host.now() < 10) return undefined;
      const player = activator === null ? undefined : this.players.states.get(activator);
      if (player !== undefined) this.hooks.emit({ kind: "localized-print", actor: null, level: "high", text: "$g_exited_level", args: [player.name] });
    }
    if (entity.map.includes("*")) game.counters.serverFlags &= 0x0000ff00;
    let landmark: Q2LandmarkCarry | null = null;
    if (activator !== null && game.options.mode !== "deathmatch" && this.players.states.has(activator)) {
      const target = game.pickTarget(entity.target), body = game.host.bodies.read(activator), view = game.host.playerViewState(activator);
      entity.goal = target?.actor.id ?? null;
      if (target !== null && body !== null && view !== null) {
        const reference = game.body(target);
        landmark = { player: activator, name: target.targetname,
          relativeOrigin: unrotateQ2Landmark(subtract(body.origin, reference.origin), reference.angles),
          relativeVelocity: unrotateQ2Landmark(view.oldVelocity, reference.angles), relativeViewAngles: subtract(view.viewAngles, reference.angles) };
      }
    }
    return this.players.beginRereleaseIntermission(game, entity.map, landmark, entity.spawnflags);
  };
  private readonly healthbarCheck: Q2Think = (entity, game) => {
    const target = game.pickTarget(entity.target);
    if (target === null || !game.host.isMonster(target.actor.id)) return game.remove(entity);
    this.healthTargets.set(entity.actor.id, target.actor.id); return undefined;
  };
  private readonly healthbarUse: Q2Use = (entity, game) => {
    const target = game.pickTarget(entity.target);
    if (target === null || this.healthTargets.get(entity.actor.id) !== target.actor.id) return game.remove(entity);
    const slot = this.healthBars.findIndex(value => value === null);
    if (slot === -1) { game.host.diagnostic("target_healthbar: too many health bars"); return game.remove(entity); }
    entity.enemy = target.actor.id;
    this.healthBars[slot] = { controller: entity.actor.id, target: target.actor.id, deadUntil: null }; return undefined;
  };

  endPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    this.forceFog(entity.actor.id, false);
    for (let slot = 0; slot < this.healthBars.length; slot++) {
      const bar = this.healthBars[slot];
      if (bar === null || bar === undefined) continue;
      const controller = game.entity(bar.controller), target = game.entity(bar.target), now = game.host.now();
      const remove = (): undefined => {
        this.healthBars[slot] = null;
        for (const actor of game.host.players()) this.hooks.emit({ kind: "healthbar", actor, slot, target: bar.target, name: controller?.message ?? "", fraction: 0, visible: false });
        return undefined;
      };
      if (controller === null || bar.deadUntil !== null && bar.deadUntil < now) { remove(); continue; }
      const health = target === null ? 0 : game.host.combat.read(bar.target)?.health ?? 0;
      if (health <= 0 && bar.deadUntil === null && !this.hooks.monsterHoldsHealthBar?.(bar.target)) {
        if (controller.delay === 0) { remove(); continue; }
        bar.deadUntil = now + controller.delay;
      }
      const empty = bar.deadUntil !== null || health <= 0;
      const visible = empty || (controller.spawnflags & 1) === 0 || target !== null && game.host.inPvs(game.body(entity).origin, game.body(target).origin);
      this.hooks.emit({ kind: "healthbar", actor: entity.actor.id, slot, target: bar.target, name: controller.message,
        fraction: empty || target === null ? 0 : Math.max(0, Math.min(1, health / target.maxHealth)), visible });
    }
    return undefined;
  }

  private readonly worldTextThink: Q2Think = (entity, game) => {
    const colors = [
      { x: 1, y: 1, z: 1, w: 1 }, { x: 1, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 1, w: 1 },
      { x: 0, y: 1, z: 0, w: 1 }, { x: 1, y: 1, z: 0, w: 1 }, { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 1, z: 1, w: 1 }, { x: 116 / 255, y: 61 / 255, z: 50 / 255, w: 1 },
    ];
    const selected = colors[numberField(entity.spawn, "sounds")];
    if (selected === undefined) game.host.diagnostic("info_world_text: invalid color");
    const body = game.body(entity), yaw = angleMod(body.angles.y) + 180;
    const radius = numberField(entity.spawn, "radius");
    if (radius < 0) return game.schedule(entity, game.host.frameSeconds(), this.worldTextThink);
    this.hooks.emit({ kind: "world-text", lifetime: game.host.frameSeconds(), text: q2WorldText({
      origin: body.origin, angles: body.angles.y === -3 ? null : { x: 0, y: yaw > 360 ? yaw - 360 : yaw, z: 0 },
      text: entity.message, color: selected ?? { x: 1, y: 1, z: 1, w: 1 }, size: radius === 0 ? 0.2 : radius, depthTest: true }) });
    return game.schedule(entity, game.host.frameSeconds(), this.worldTextThink);
  };

  private readonly worldTextUse: Q2Use = (entity, game, _other, activator) => {
    if (entity.activator === null) { entity.activator = activator; this.worldTextThink(entity, game); }
    else { game.cancel(entity); entity.think = this.worldTextThink; entity.activator = null; }
    if ((entity.spawnflags & 2) !== 0) entity.use = null;
    const target = game.pickTarget(entity.target);
    target?.use?.(target, game, entity.actor.id, entity.actor.id);
    if ((entity.spawnflags & 4) !== 0) game.remove(entity);
    return undefined;
  };

  get callbacks(): Q2CallbackDefinitions { return {
    think: { "rr.info_world_text_think": this.worldTextThink, "rr.target_poi_setup": this.poiSetup, "rr.trigger_coop_relay_think": this.coopRelayThink, "rr.target_crossunit_target_think": this.crossUnitThink, "rr.check_target_healthbar": this.healthbarCheck },
    touch: { "rr.trigger_flashlight_touch": this.flashlightTouch, "rr.trigger_fog_touch": this.fogTouch },
    use: { "rr.misc_flare_use": this.flareUse, "rr.info_world_text_use": this.worldTextUse, "rr.trigger_coop_relay_use": this.coopRelayUse, "rr.target_poi_use": this.poiUse, "rr.use_target_music": this.musicUse,
      "rr.use_target_sky": this.skyUse, "rr.trigger_crossunit_trigger_use": this.crossUnitUse, "rr.use_target_autosave": this.autosaveUse,
      "rr.use_target_achievement": this.achievementUse, "rr.use_target_story": this.storyUse, "rr.use_target_healthbar": this.healthbarUse, "rr.use_target_changelevel": this.changeLevelUse },
  }; }
}
