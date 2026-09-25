/* Adapted from game/g_trigger.c, g_target.c, g_misc.c and their rerelease variants. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { dot, integerField, movedir, numberField, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use, Q2Touch } from "./host.ts";
import { dynamic_light_use, spawnQ2ShadowLight } from "./shadow-lights.ts";
import { freeQ2Entity } from "./callbacks.ts";

const multi_wait: Q2Think = (entity, game) => game.cancel(entity);

function multi(entity: Q2Entity, game: Q2GameServices, activator: ActorId | null): undefined {
  if (entity.nextThink !== null) return undefined;
  entity.activator = activator;
  game.useTargets(entity, activator);
  if (!game.host.actors.isLive(entity.actor.id)) return undefined;
  if (entity.wait > 0) game.schedule(entity, entity.wait, multi_wait);
  else { entity.touch = null; game.schedule(entity, game.host.frameSeconds(), freeQ2Entity); }
  return undefined;
}

function triggerMultiple(entity: Q2Entity, game: Q2GameServices): undefined {
  if (entity.classname === "trigger_once") {
    if ((entity.spawnflags & 1) !== 0) entity.spawnflags = entity.spawnflags & ~1 | 4;
    entity.wait = -1;
  } else if (entity.wait === 0) entity.wait = 0.2;
  const angles = game.body(entity).angles;
  if (angles.x !== 0 || angles.y !== 0 || angles.z !== 0) entity.movedir = movedir(angles);
  entity.visible = false;
  entity.touch = Touch_Multi;
  entity.use = Use_Multi;
  game.solid(entity, (entity.spawnflags & 4) !== 0 ? "none" : "trigger");
  return undefined;
}

function speaker(entity: Q2Entity, game: Q2GameServices): undefined {
  const noise = entity.spawn.values.get("noise");
  if (noise === undefined) { game.host.diagnostic("target_speaker has no noise"); return undefined; }
  entity.noise = noise.includes(".wav") ? noise : `${noise}.wav`;
  entity.volume = numberField(entity.spawn, "volume") || 1;
  const authoredAttenuation = numberField(entity.spawn, "attenuation");
  const rereleaseLoop = game.options.edition === "rerelease" && (entity.spawnflags & 3) !== 0;
  entity.attenuation = authoredAttenuation === -1 ? (rereleaseLoop ? -1 : 0) : authoredAttenuation || (rereleaseLoop ? 3 : 1);
  entity.sound = (entity.spawnflags & 1) !== 0 ? entity.noise : "";
  if (entity.sound !== "") emitSpeaker(entity, game, "start");
  entity.use = Use_Target_Speaker;
  game.link(entity);
  return undefined;
}

function timer(entity: Q2Entity, game: Q2GameServices): undefined {
  entity.wait ||= 1;
  entity.random = Math.min(numberField(entity.spawn, "random"), entity.wait - game.host.frameSeconds());
  entity.use = func_timer_use;
  if ((entity.spawnflags & 1) !== 0) {
    entity.activator = entity.actor.id;
    game.schedule(entity, 1 + numberField(entity.spawn, "pausetime") + entity.delay + entity.wait + (game.host.random() * 2 - 1) * entity.random, func_timer_think);
  }
  return undefined;
}

function changeLevel(entity: Q2Entity, game: Q2GameServices): undefined {
  if (entity.map === "") { game.host.diagnostic("target_changelevel has no map"); return game.remove(entity); }
  if (game.options.mapName.toLowerCase() === "fact1" && entity.map.toLowerCase() === "fact3") entity.map = "fact3$secret1";
  entity.use = use_target_changelevel;
  return undefined;
}

/** Rerelease landmark rotation order is X(pitch), Y(roll), then Z(yaw). */
export function unrotateQ2Landmark(vector: Vec3, angles: Vec3): Vec3 {
  const pitch = -angles.x * Math.PI / 180, roll = -angles.z * Math.PI / 180, yaw = -angles.y * Math.PI / 180;
  const x = { x: vector.x, y: vector.y * Math.cos(pitch) - vector.z * Math.sin(pitch), z: vector.y * Math.sin(pitch) + vector.z * Math.cos(pitch) };
  const y = { x: x.x * Math.cos(roll) + x.z * Math.sin(roll), y: x.y, z: -x.x * Math.sin(roll) + x.z * Math.cos(roll) };
  return { x: y.x * Math.cos(yaw) - y.y * Math.sin(yaw), y: y.x * Math.sin(yaw) + y.y * Math.cos(yaw), z: y.z };
}

/** Point targets remain real actors, including source-only helper and presentation entities. */
export function createQ2TargetModule(): Q2SpawnModule {
  return { callbacks: targetCallbacks, spawn(entity, game) {
    const classname = entity.classname;
    switch (classname) {
      case "worldspawn": {
        entity.model = "*0"; game.solid(entity, "brush");
        for (let index = 0; index < 8; index++) {
          const body = game.create("bodyque"); body.visible = false; body.serverFlags = 1;
        }
        game.host.emit({ kind: "music", track: entity.spawn.values.get("sounds") ?? "0" });
        return true;
      }
      case "info_player_start": case "info_player_coop": case "info_player_deathmatch": case "info_player_intermission":
      case "info_notnull": case "info_landmark": case "func_group": return true;
      case "info_null": game.remove(entity); return true;
      case "light": {
        const style = integerField(entity.spawn, "style");
        if (entity.targetname === "" || game.options.mode === "deathmatch") { game.remove(entity); return true; }
        if (style >= 32) {
          entity.use = light_use;
          game.host.emit({ kind: "lightstyle", style, pattern: (entity.spawnflags & 1) !== 0 ? "a" : "m" });
        }
        return true;
      }
      case "dynamic_light": spawnQ2ShadowLight(entity, game); return true;
      case "target_speaker": speaker(entity, game); return true;
      case "func_timer": timer(entity, game); return true;
      case "trigger_once": case "trigger_multiple": triggerMultiple(entity, game); return true;
      case "trigger_relay": entity.use = trigger_relay_use; return true;
      case "trigger_always":
        entity.delay = Math.max(entity.delay, 0.2);
        game.useTargets(entity, entity.actor.id);
        return true;
      case "trigger_counter": {
        entity.wait = -1; entity.count ||= 2;
        entity.use = trigger_counter_use;
        return true;
      }
      case "trigger_key": {
        const keyName = entity.spawn.values.get("item");
        if (keyName === undefined) { game.host.diagnostic("trigger_key has no item"); return true; }
        const pickupName = game.itemName(keyName);
        if (pickupName === null || entity.target === "") { game.host.diagnostic(`Q2 trigger_key has unknown item or no target: ${keyName}`); return true; }
        entity.use = trigger_key_use;
        return true;
      }
      case "target_help": {
        if (game.options.mode === "deathmatch" || entity.message === "") game.remove(entity);
        else entity.use = use_target_help;
        return true;
      }
      case "target_secret": case "target_goal": {
        if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
        const secret = classname === "target_secret";
        if (secret) game.counters.totalSecrets++; else game.counters.totalGoals++;
        entity.use = use_target_secret_or_goal;
        return true;
      }
      case "target_changelevel": changeLevel(entity, game); return true;
      case "target_explosion": {
        entity.use = use_target_explosion;
        return true;
      }
      case "target_splash":
        entity.count ||= 32; entity.movedir = movedir(game.body(entity).angles);
        entity.use = use_target_splash;
        return true;
      case "target_poi":
        if (game.options.edition !== "rerelease") return false;
        entity.use = use_target_poi;
        return true;
      case "func_areaportal": {
        entity.use = Use_Areaportal;
        return true;
      }
      default: return false;
    }
  } };
}

const Touch_Multi: Q2Touch = (self, services, contact) => {
    if (self.solid !== "trigger") return undefined;
    if (services.host.isPlayer(contact.other)) { if ((self.spawnflags & 2) !== 0) return undefined; }
    else if (services.host.isMonster(contact.other)) { if ((self.spawnflags & 1) === 0) return undefined; }
    else return undefined;
    const body = services.host.bodies.read(contact.other);
    if (body !== null && dot(movedir(body.angles), self.movedir) < 0) return undefined;
    return multi(self, services, contact.other);
  };

const Use_Multi: Q2Use = (self, services, _other, activator) => {
    if (self.solid === "none") return services.solid(self, "trigger");
    return multi(self, services, activator);
  };

/** Convert source loop distance to the shared Q2 loop coefficient of 0.003. */
function speakerLoopAttenuation(entity: Q2Entity, game: Q2GameServices): number {
  if (game.options.edition === "classic") return 1;
  if (entity.attenuation === -1) return 0;
  return entity.attenuation > 0 && entity.attenuation !== 3 ? entity.attenuation / 5 : 1;
}

function emitSpeaker(entity: Q2Entity, game: Q2GameServices, operation: "start" | "stop" | "once"): undefined {
  return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: entity.noise, channel: 2,
    volume: operation === "once" ? entity.volume : 1,
    attenuation: operation === "once" ? entity.attenuation : speakerLoopAttenuation(entity, game),
    reliable: (entity.spawnflags & 4) !== 0, loop: operation });
}

const Use_Target_Speaker: Q2Use = (self, services) => {
    if ((self.spawnflags & 3) !== 0) { self.sound = self.sound === "" ? self.noise : ""; return emitSpeaker(self, services, self.sound !== "" ? "start" : "stop"); }
    return emitSpeaker(self, services, "once");
  };

const func_timer_think: Q2Think = (self, services) => {
  services.useTargets(self, self.activator);
  if (!services.host.actors.isLive(self.actor.id)) return undefined;
  return services.schedule(self, self.wait + (services.host.random() * 2 - 1) * self.random, func_timer_think);
};

const func_timer_use: Q2Use = (self, services, _other, activator) => {
    self.activator = activator;
    if (self.nextThink !== null) return services.cancel(self);
    return self.delay !== 0 ? services.schedule(self, self.delay, func_timer_think) : func_timer_think(self, services);
  };

const use_target_changelevel: Q2Use = (self, services, other, activator) => {
    if (self.transitionStarted) return undefined;
    const map = self.map;
    if (services.options.mode === "singleplayer") {
      const player = services.host.players()[0];
      if (player !== undefined && (services.host.combat.read(player)?.health ?? 0) <= 0) return undefined;
    }
    if (services.options.mode === "deathmatch" && (services.options.deathmatchFlags & 4096) === 0 && other !== null && services.entity(other)?.classname !== "worldspawn") {
      const body = services.host.bodies.read(other), health = services.host.combat.read(other);
      if (body !== null && health !== null) services.damage(other, self, self.actor.id, 10 * (services.entity(other)?.maxHealth || 100), 1000, zero, body.origin, zero, 28);
      return undefined;
    }
    if (map.includes("*")) services.counters.serverFlags &= ~255;
    const separator = map.indexOf("$");
    const destination = separator < 0 ? map : map.slice(0, separator);
    const spawnPoint = separator < 0 ? "" : map.slice(separator + 1);
    const landmark = activator === null || services.options.mode === "deathmatch" ? null : services.pickTarget(self.target);
    const playerBody = activator === null ? null : services.host.bodies.read(activator);
    const playerView = activator === null ? null : services.host.playerViewState(activator);
    if (activator !== null && landmark !== null && playerBody !== null && playerView !== null) {
      const reference = services.body(landmark);
      services.host.prepareLevelChange(map, { player: activator, name: landmark.targetname,
        relativeOrigin: unrotateQ2Landmark(subtract(playerBody.origin, reference.origin), reference.angles),
        relativeVelocity: unrotateQ2Landmark(playerView.oldVelocity, reference.angles),
        relativeViewAngles: subtract(playerView.viewAngles, reference.angles) }, services.counters.serverFlags);
    } else services.host.prepareLevelChange(map, null, services.counters.serverFlags);
    self.transitionStarted = true;
    services.host.transition({ kind: "campaign-level", campaign: services.options.campaign, map: `q2:${destination}`,
      spawnPoint, gates: [], cause: activator });
    return undefined;
  };

const light_use: Q2Use = (self, services) => { self.spawnflags ^= 1; return services.host.emit({ kind: "lightstyle", style: self.style, pattern: (self.spawnflags & 1) !== 0 ? "a" : "m" }); };

const trigger_relay_use: Q2Use = (self, services, _other, activator) => services.useTargets(self, activator);

const trigger_counter_use: Q2Use = (self, services, _other, activator) => {
          if (self.count === 0) return undefined;
          self.count--;
          if ((self.spawnflags & 1) === 0 && activator !== null) {
            services.host.emit({ kind: "centerprint", actor: activator, text: self.count ? `${self.count} more to go...` : "Sequence completed!" });
            services.sound(self, "misc/talk1.wav", 0);
          }
          return self.count === 0 ? multi(self, services, activator) : undefined;
        };

const trigger_key_use: Q2Use = (self, services, _other, activator) => {
          const keyName = self.spawn.values.get("item") ?? "", key: ItemId = `q2:${keyName}`, pickupName = services.itemName(keyName);
          if (pickupName === null) throw new Error(`Q2 saved key references missing item ${keyName}`);
          if (activator === null || !services.host.isPlayer(activator)) return undefined;
          if (services.host.inventory.count(activator, key) === 0) {
            if (services.host.now() < self.timestamp) return undefined;
            self.timestamp = services.host.now() + 5;
            services.host.emit({ kind: "centerprint", actor: activator, text: `You need the ${pickupName}` });
            const body = services.host.bodies.read(activator);
            if (body !== null) services.host.emit({ kind: "sound", actor: activator, origin: body.origin, path: "misc/keytry.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
            return undefined;
          }
          const body = services.host.bodies.read(activator);
          if (body !== null) services.host.emit({ kind: "sound", actor: activator, origin: body.origin, path: "misc/keyuse.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
          // Key identity is preserved in the shared inventory even for a foreign player provider.
          const cubeKey = keyName === "key_power_cube" || services.options.edition === "rerelease" && keyName === "key_explosive_charges";
          let cube = 0;
          if (services.options.mode === "coop" && cubeKey) {
            const bits = services.entity(activator)?.powerCubes ?? 0;
            for (; cube < 8 && (bits & 1 << cube) === 0; cube++);
          }
          for (const player of services.options.mode === "coop" ? services.host.players() : [activator]) {
            const owner = services.host.actors.resolveOwned(player);
            if (owner === null) continue;
            if (services.options.mode === "coop" && cubeKey) {
              const entity = services.entity(player);
              if (entity === null || (entity.powerCubes & 1 << cube) === 0) continue;
              entity.powerCubes &= ~(1 << cube); services.host.inventory.consume(owner, key, 1);
            } else services.host.inventory.consume(owner, key, services.options.mode === "coop" ? services.host.inventory.count(player, key) : 1);
            services.host.keyConsumed(player);
          }
          services.useTargets(self, activator); self.use = null;
          return undefined;
        };

const use_target_help: Q2Use = (self, services) => services.host.emit({ kind: "help", slot: (self.spawnflags & 1) !== 0 ? 1 : 2, text: self.message });

const use_target_secret_or_goal: Q2Use = (self, services, _other, activator) => {
          const secret = self.classname === "target_secret";
          services.sound(self, self.spawn.values.get("noise") ?? "misc/secret.wav");
          if (secret) services.counters.foundSecrets++; else services.counters.foundGoals++;
          if (!secret && services.counters.totalGoals === services.counters.foundGoals) services.host.emit({ kind: "music", track: "0" });
          services.useTargets(self, activator); return services.remove(self);
        };

const use_target_explosion: Q2Use = (self, services, _other, activator) => { self.activator = activator; return self.delay === 0 ? explode(self, services) : services.schedule(self, self.delay, explode); };

const explode: Q2Think = (self, services) => {
  services.host.emit({ kind: "effect", effect: "q2:explosion1", origin: services.body(self).origin, direction: zero, count: 1, color: 0 });
  services.radiusDamage(self, self.activator, self.damage, null, self.damage + 40, 25);
  return services.useTargets(self, self.activator, true);
};

const use_target_splash: Q2Use = (self, services, _other, activator) => {
          services.host.emit({ kind: "effect", effect: "q2:splash", origin: services.body(self).origin, direction: self.movedir, count: self.count, color: integerField(self.spawn, "sounds") });
          if (self.damage !== 0) services.radiusDamage(self, activator, self.damage, null, self.damage + 40, 29);
          return undefined;
        };

const use_target_poi: Q2Use = (self, services) => services.host.emit({ kind: "poi", origin: services.body(self).origin, message: self.message, fields: self.spawn.values });

const Use_Areaportal: Q2Use = (self, services) => { self.count ^= 1; return services.host.setAreaPortal(self.style, self.count !== 0); };

const targetCallbacks = {
think: { multi_wait, func_timer_think, target_explosion_explode: explode },
use: { dynamic_light_use, Use_Multi, Use_Target_Speaker, func_timer_use, use_target_changelevel, light_use, trigger_relay_use, trigger_counter_use, trigger_key_use, use_target_help, use_target_secret_or_goal, use_target_explosion, use_target_splash, use_target_poi, Use_Areaportal },
touch: { Touch_Multi }
};
