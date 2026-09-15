import type { DebugShape } from "../../../debug/shapes.ts";
import type { Vec4 } from "../../../contracts/math.ts";
import { q2DebugShape } from "./debug-shapes.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q2Entity, Q2GameServices } from "../foundation/host.ts";
import type { Q2PickupPolicy } from "../foundation/items.ts";
import { add, dot, length, movedir, normalize, scale, subtract } from "../foundation/fields.ts";
import { Q2RereleaseEntities } from "./entities.ts";
import type { Q2RereleaseCampaignState } from "./entities.ts";
import type { Q2RereleasePlayers } from "./players.ts";
import { q2UsesInstancedItems } from "./types.ts";
import type { Q2RereleaseHooks } from "./types.ts";
import { restoreQ2Actor, saveQ2Actor } from "../foundation/checkpoint.ts";
import type { Q2RereleaseModuleCheckpoint } from "./checkpoint.ts";
import { Q2RereleaseTriggers } from "./triggers.ts";
import { Q2RereleaseQ64 } from "./q64/index.ts";
import { enterQ2RereleaseLevel, updateQ2RereleaseLevel } from "./campaign.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import { Q2RereleaseLights, q2RereleaseColor } from "./lights.ts";
import { Q2RereleaseGoals } from "./goals.ts";
export * from "./types.ts";
export { Q2RereleasePlayers } from "./players.ts";
export { createQ2RereleaseCampaignState } from "./entities.ts";
export type { Q2RereleaseCampaignState } from "./entities.ts";
export type { Q2RereleaseModuleCheckpoint, Q2RereleasePlayersCheckpoint } from "./checkpoint.ts";

export interface Q2RereleaseModuleOptions { readonly players: Q2RereleasePlayers; readonly hooks: Q2RereleaseHooks; readonly campaign?: Q2RereleaseCampaignState; }

/** Edition extensions register before generic Q2 modules; they share all live game services. */
export function createQ2RereleaseModule(options: Q2RereleaseModuleOptions): Q2RereleaseModule { return new Q2RereleaseModule(options); }

export class Q2RereleaseModule extends Q2RereleaseEntities implements Q2PickupPolicy {
  drawDebugShape(shape: DebugShape, color: Vec4, lifetimeSeconds: number, depthTest: boolean): undefined {
    return this.hooks.emit(q2DebugShape(shape, color, lifetimeSeconds, depthTest));
  }
  readonly pickedUpBy = new Map<ActorId, Set<number>>();
  private readonly pickupMessages = new Map<ActorId, string>();
  readonly triggers: Q2RereleaseTriggers;
  readonly q64: Q2RereleaseQ64;
  readonly lights: Q2RereleaseLights;
  readonly goals: Q2RereleaseGoals;
  private releaseBound = false;

  constructor(options: Q2RereleaseModuleOptions) {
    super(options.players, options.hooks, options.campaign);
    this.triggers = new Q2RereleaseTriggers(options.players, options.hooks);
    this.q64 = new Q2RereleaseQ64(options.players, options.hooks, game => this.endOfUnit(game));
    this.lights = new Q2RereleaseLights(options.hooks);
    this.goals = new Q2RereleaseGoals(options.players, this.campaign, options.hooks, this.poiUse);
    this.players.extension = this;
    const items = this.players.items;
    items.setPickupPolicy(this);
    items.register({ kind: "power", classname: "item_invisibility", model: "models/items/cloaker/tris.md2", icon: "p_cloaker", name: "Invisibility", sound: "items/pkup.wav", rotate: true, respawn: 300, coopStay: false });
    items.register({ kind: "custom", classname: "item_flashlight", model: "models/items/flashlight/tris.md2", icon: "p_torch", name: "Flashlight", sound: "items/pkup.wav", rotate: true, respawn: 0,
      capacity: 1, quantity: 1, coopStay: true, droppable: false,
      pickup: (_entity, game, player) => game.host.inventory.count(player.id, "q2:item_flashlight") === 0 && game.host.inventory.give(player, "q2:item_flashlight", 1) > 0,
      use: (player, game) => { this.toggleFlashlight(player.id, game, !this.players.extra(player.id).flashlight); return true; } });
    items.register({ kind: "custom", consoleGive: "inventory-only", classname: "item_compass", model: "", icon: "p_compass", name: "Compass", sound: "", rotate: false, respawn: 0,
      capacity: 1, quantity: 0, coopStay: true, droppable: false, pickup: () => false,
      use: (player, game) => { this.useCompass(player.id, game); return true; } });
  }

  usePowerup(player: OwnedActor, item: ItemId, game: Q2GameServices): boolean {
    if (item === "q2:item_invisibility") {
      const extra = this.players.extra(player.id);
      extra.invisibilityUntil = Math.max(extra.invisibilityUntil, game.host.now()) + 30;
      const entity = game.entity(player.id); if (entity !== null) game.sound(entity, "items/protect.wav", 3);
      return true;
    }
    if (item === "q2:item_adrenaline") {
      const entity = game.entity(player.id); if (entity === null) throw new Error("Rerelease adrenaline requires a source player");
      if (game.options.mode !== "deathmatch") entity.maxHealth++;
      if ((game.host.combat.read(player.id)?.health ?? 0) < entity.maxHealth) game.host.combat.setHealth(player, entity.maxHealth);
      game.sound(entity, "items/n_health.wav", 3);
      return true;
    }
    return false;
  }

  override spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (!this.releaseBound) {
      this.releaseBound = true;
      game.host.actors.onRelease(actor => {
        this.pickedUpBy.delete(actor.id); this.pickupMessages.delete(actor.id); this.healthTargets.delete(actor.id); this.triggers.soundTimes.delete(actor.id);
        this.q64.release(actor.id);
        this.lights.active.delete(actor.id);
        if (this.poi?.dynamic === actor.id) this.poi = { ...this.poi, dynamic: null };
        return undefined;
      });
    }
    const color = entity.spawn.values.get("rgba") ?? entity.spawn.values.get("_color");
    if (color !== undefined) entity.skin = q2RereleaseColor(color);
    return this.q64.spawn(entity, game) || this.lights.spawn(entity, game) || this.goals.spawn(entity, game) || this.triggers.spawn(entity, game) || super.spawn(entity, game);
  }

  override get callbacks(): Q2CallbackDefinitions {
    const base = super.callbacks, triggers = this.triggers.callbacks, q64 = this.q64.callbacks, lights = this.lights.callbacks, goals = this.goals.callbacks;
    return { think: { ...base.think, ...triggers.think, ...q64.think, ...lights.think, ...goals.think }, touch: { ...base.touch, ...triggers.touch }, use: { ...base.use, ...triggers.use, ...q64.use, ...lights.use, ...goals.use } };
  }

  capture(): Q2RereleaseModuleCheckpoint {
    const saved = (actor: ActorId) => ({ slot: actor.slot, generation: actor.generation });
    return { version: 1, worldFog: structuredClone(this.worldFog), story: this.story, sky: structuredClone(this.sky),
      poi: this.poi === null ? null : { ...this.poi, actor: saved(this.poi.actor), dynamic: saveQ2Actor(this.poi.dynamic) }, poiStage: this.poiStage, lastAutoSave: this.lastAutoSave,
      campaign: { crossUnitFlags: this.campaign.crossUnitFlags, visitedMaps: [...this.campaign.visitedMaps], levels: [...this.campaign.levels.values()].map(entry => ({ ...entry })), mission: { ...this.campaign.mission } },
      healthBars: this.healthBars.map(bar => bar === null ? null : { controller: saved(bar.controller), target: saved(bar.target), deadUntil: bar.deadUntil }),
      healthTargets: [...this.healthTargets].map(([controller, target]) => ({ controller: saved(controller), target: saved(target) })),
      pickedUpBy: [...this.pickedUpBy].map(([actor, slots]) => ({ actor: saved(actor), slots: [...slots] })),
      triggerSoundTimes: [...this.triggers.soundTimes].map(([actor, time]) => ({ actor: saved(actor), time })), q64: this.q64.capture(), lights: [...this.lights.active].map(([actor, active]) => ({ actor: saved(actor), active })), goals: this.goals.capture() };
  }

  restore(game: Q2GameServices, checkpoint: Q2RereleaseModuleCheckpoint): undefined {
    this.worldFog = structuredClone(checkpoint.worldFog); this.story = checkpoint.story; this.sky = structuredClone(checkpoint.sky);
    this.poi = checkpoint.poi === null ? null : { ...checkpoint.poi, actor: game.host.actors.referenceSaved(checkpoint.poi.actor), dynamic: checkpoint.poi.dynamic === null ? null : game.host.actors.referenceSaved(checkpoint.poi.dynamic) };
    this.poiStage = checkpoint.poiStage; this.lastAutoSave = checkpoint.lastAutoSave;
    this.campaign.crossUnitFlags = checkpoint.campaign.crossUnitFlags; this.campaign.visitedMaps = new Set(checkpoint.campaign.visitedMaps);
    this.campaign.levels.clear(); for (const entry of checkpoint.campaign.levels) this.campaign.levels.set(entry.map, { ...entry });
    Object.assign(this.campaign.mission, checkpoint.campaign.mission);
    this.healthBars.splice(0, this.healthBars.length, ...checkpoint.healthBars.map(bar => bar === null ? null : { controller: game.host.actors.referenceSaved(bar.controller), target: game.host.actors.referenceSaved(bar.target), deadUntil: bar.deadUntil }));
    this.healthTargets.clear(); this.pickedUpBy.clear(); this.pickupMessages.clear();
    for (const entry of checkpoint.healthTargets) this.healthTargets.set(restoreQ2Actor(game, entry.controller).id, game.host.actors.referenceSaved(entry.target));
    for (const entry of checkpoint.pickedUpBy) this.pickedUpBy.set(restoreQ2Actor(game, entry.actor).id, new Set(entry.slots));
    this.triggers.soundTimes.clear();
    for (const entry of checkpoint.triggerSoundTimes) this.triggers.soundTimes.set(restoreQ2Actor(game, entry.actor).id, entry.time);
    this.q64.restore(game, checkpoint.q64);
    this.lights.active.clear(); for (const entry of checkpoint.lights) this.lights.active.set(restoreQ2Actor(game, entry.actor).id, entry.active);
    this.goals.restore(checkpoint.goals);
    return undefined;
  }

  admitted(entity: Q2Entity, game: Q2GameServices): undefined {
    enterQ2RereleaseLevel(game, this.players, this.campaign);
    const state = this.players.context(entity, game).state, extra = this.players.extra(entity.actor.id);
    extra.spawned = !extra.awaitingRespawn;
    extra.wantedFog = this.worldFog;
    this.forceFog(entity.actor.id, true);
    if (state.useQ2Inventory && game.options.mode !== "deathmatch") game.host.inventory.configure(entity.actor, { item: "q2:item_compass", count: 1, capacity: 1 });
    if (game.options.mode === "coop" && state.useQ2Inventory) {
      for (const actor of game.host.players()) {
        const other = this.players.states.get(actor), source = game.entity(actor);
        if (actor === entity.actor.id || other === undefined || source === null || other.spectator || other.noclip) continue;
        for (const item of game.host.inventory.entries(actor)) game.host.inventory.configure(entity.actor, item);
        entity.powerCubes = source.powerCubes;
        break;
      }
    }
    return undefined;
  }

  /** G_RunFrame invokes this once after all ClientEndServerFrame calls. */
  afterPlayerFrames(game: Q2GameServices): undefined {
    const entry = this.campaign.levels.get(game.options.mapName), host = [...this.players.states.values()].find(player => player.slot === 0);
    if (entry !== undefined && this.players.intermission.kind === "playing" && host?.connected === true) entry.time += game.host.frameSeconds();
    return undefined;
  }
  beforeLevelChange(game: Q2GameServices): undefined { return updateQ2RereleaseLevel(game, this.campaign); }
  leaveUnit(): undefined {
    this.campaign.levels.clear();
    if (this.players.rereleaseOptions.coopLives) for (const extra of this.players.rereleaseStates.values()) extra.lives = this.players.rereleaseOptions.coopNumLives + 1;
    return undefined;
  }
  spawned(entity: Q2Entity, _game: Q2GameServices): undefined {
    const extra = this.players.extra(entity.actor.id); extra.wantedFog = this.worldFog; extra.spawned = !extra.awaitingRespawn;
    this.forceFog(entity.actor.id, true);
    return this.hooks.emit({ kind: "flashlight", actor: entity.actor.id, enabled: extra.flashlight });
  }

  private instanced(game: Q2GameServices): boolean { return game.options.mode === "coop" && q2UsesInstancedItems(this.players.rereleaseOptions); }
  instancedCoop(game: Q2GameServices): boolean { return this.instanced(game); }
  canPickup(entity: Q2Entity, game: Q2GameServices, player: ActorId): boolean {
    const state = this.players.states.get(player);
    if (state === undefined) return false;
    return !this.instanced(game) || this.pickedUpBy.get(entity.actor.id)?.has(state.slot) !== true;
  }
  beforePickup(entity: Q2Entity, game: Q2GameServices, player: ActorId): boolean {
    if (!this.canPickup(entity, game, player)) return false;
    if (this.instanced(game) || game.options.mode === "deathmatch") { this.pickupMessages.set(entity.actor.id, entity.message); entity.message = ""; }
    return true;
  }
  afterPickup(entity: Q2Entity, _game: Q2GameServices, _player: ActorId, _taken: boolean): undefined {
    const message = this.pickupMessages.get(entity.actor.id);
    if (message !== undefined) { entity.message = message; this.pickupMessages.delete(entity.actor.id); }
    return undefined;
  }
  beforeTargets(entity: Q2Entity, game: Q2GameServices, player: ActorId, taken: boolean): undefined {
    const state = this.players.states.get(player);
    if (state === undefined || !taken) return undefined;
    state.bonusAlpha = 0.25;
    const descriptor = this.players.items.lookup(entity.classname);
    if (descriptor !== null && descriptor.usable && game.host.inventory.count(player, descriptor.id) !== 0) state.selectedItem = descriptor.id;
    if (this.instanced(game)) {
      const picked = this.pickedUpBy.get(entity.actor.id) ?? new Set<number>();
      picked.add(state.slot); this.pickedUpBy.set(entity.actor.id, picked);
      this.hooks.emit({ kind: "item-visibility", actor: player, item: entity.actor.id, visible: false });
      const message = this.pickupMessages.get(entity.actor.id) ?? entity.message;
      if (message !== "") game.host.emit({ kind: "centerprint", actor: player, text: message });
    }
    return undefined;
  }
  keepAfterPickup(entity: Q2Entity, game: Q2GameServices, _player: ActorId): boolean { return this.instanced(game) && (entity.spawnflags & 0x20000) === 0; }

  sendPoi(actor: ActorId): undefined {
    const extra = this.players.extra(actor);
    return this.hooks.emit({ kind: "poi", actor, position: extra.helpLocation, image: extra.helpImage, duration: 10000, color: 208 });
  }

  useCompass(actor: ActorId, game: Q2GameServices): undefined {
    if (this.poi === null) { game.host.emit({ kind: "print", actor, level: "high", text: "$no_valid_poi" }); return undefined; }
    const dynamic = game.entity(this.poi.dynamic);
    if (dynamic !== null) dynamic.use?.(dynamic, game, actor, actor);
    const body = game.host.bodies.read(actor);
    if (body === null) return undefined;
    const extra = this.players.extra(actor), poi = this.poi;
    extra.helpLocation = poi.origin; extra.helpImage = poi.image;
    const path = this.hooks.navigation(body.origin, poi.origin);
    if (path.kind === "path" && path.points.length !== 0) {
      const points = path.points.slice(0, 128);
      let index = 0;
      while (index + 1 < points.length && length(subtract(points[index] ?? poi.origin, body.origin)) <= 192) index++;
      const first = points[index] ?? poi.origin, forward = movedir(this.players.hooks.movement(actor).viewAngles);
      if (dot(normalize(subtract(first, body.origin)), forward) < 0.3) {
        const entity = game.entity(actor), height = entity?.viewHeight ?? 22;
        const trace = game.host.trace({ start: add(body.origin, { x: 0, y: 0, z: height }), end: add(body.origin, scale(forward, 64)), bounds: null, ignore: null, mask: 1 });
        const point = trace.fraction < 1 && trace.contact.kind === "plane" ? add(trace.end, scale(trace.contact.plane.normal, 8)) : trace.end;
        points.splice(index, 0, point);
      }
      extra.helpPoints = points; extra.helpIndex = index; extra.helpDrawTime = 0;
      this.compassUpdate(actor, game, true);
    } else {
      this.sendPoi(actor);
      game.host.emit({ kind: "sound", actor, origin: body.origin, path: "misc/help_marker.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    }
    return undefined;
  }

  compassUpdate(actor: ActorId, game: Q2GameServices, first: boolean): undefined {
    const extra = this.players.extra(actor), point = extra.helpPoints[extra.helpIndex], body = game.host.bodies.read(actor);
    if (point === undefined || body === null || extra.helpDrawTime >= game.host.now()) return undefined;
    if (length(subtract(point, body.origin)) > 4096 || !game.host.inPhs(body.origin, point)) { extra.helpPoints = []; return undefined; }
    this.hooks.emit({ kind: "help-path", actor, first, position: point, direction: normalize(subtract(extra.helpPoints[extra.helpIndex + 1] ?? extra.helpLocation, point)) });
    this.sendPoi(actor);
    game.host.emit({ kind: "sound", actor, origin: point, path: "misc/help_marker.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    extra.helpIndex++; extra.helpDrawTime = game.host.now() + 0.2;
    return undefined;
  }

  beginPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined { this.forceFog(entity.actor.id, false); return this.goals.notify(entity, game); }
  help(entity: Q2Entity, game: Q2GameServices): undefined { return this.goals.help(entity, game); }
  override endPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    super.endPlayerFrame(entity, game);
    if (this.players.intermission.kind === "playing") this.goals.endPlayerFrame(entity, game);
    return this.compassUpdate(entity.actor.id, game, false);
  }
}
