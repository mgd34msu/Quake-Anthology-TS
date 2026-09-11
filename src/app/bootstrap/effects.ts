import type { Q2ShadowLightState } from "../../content/q2/foundation/shadow-lights.ts";
/* Application joins for Quake cl_tent/r_part and Quake II cl_tent/cl_fx.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { DrawBatch, RenderOperation, RendererImage, SceneCamera } from "../../contracts/render.ts";
import type { SceneEntity, SceneLight, SceneParticle, SceneQueries } from "../../contracts/scene.ts";
import type { WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterView } from "../../content/q3/foundation/presentation.ts";
import type { Q1BeamStyle } from "../../content/q1/foundation/types.ts";
import { add3, anglesToAxis, length3, normalize3OrZero, scale3, sub3 } from "../../core/math.ts";
import type { SurfaceDynamicLight } from "../../materials/lighting.ts";
import type { DynamicLight } from "../../materials/q3-lighting.ts";
import { SceneModelRenderer } from "../../render/scene/models/renderer.ts";
import { legacyParticleImage, prepareParticleBatch, q2BeamBatch } from "../../render/scene/particles/legacy.ts";
import { createViewProjector } from "../../render/scene/view.ts";
import type { ApplicationAssets, ProviderSceneAssets } from "./assets.ts";
import type { SimulationPresentation, SimulationPresentationEvent } from "./simulation/types.ts";
import { SourceRandom } from "./simulation/random.ts";
import { SourceParticles } from "./effects/particles.ts";
import { q2MonsterMuzzles } from "./effects/q2-muzzle.ts";
import { Q3ApplicationEffects } from "./effects/q3.ts";
import type { SourceEffectSound } from "./effects/q3.ts";
import type { Q2MissionPackEntityEvent } from "../../content/q2/missionpacks/entities/types.ts";
import { Q2EffectViews } from "./effects/q2-view.ts";
export type { SourceEffectSound } from "./effects/q3.ts";

export interface ApplicationEffectFrame {
  readonly operations: readonly RenderOperation[];
  readonly lights: readonly SurfaceDynamicLight[];
  readonly q3Lights: readonly DynamicLight[];
}
export interface UnhandledApplicationEffect { readonly source: SimulationPresentationEvent; readonly reason: string; }
interface Group {
  readonly provider: ProviderSceneAssets;
  readonly particles: SourceParticles;
  readonly renderer: SceneModelRenderer;
  models: SceneEntity[];
  sampled: readonly SceneParticle[];
}
interface TimedLight extends SurfaceDynamicLight { readonly born: number; readonly die: number; readonly decay: number; readonly actor: ActorId | null; }
interface Beam {
  readonly content: ContentId; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3;
  readonly die: number; readonly width: number; readonly color: number;
  readonly model: string | null; readonly family: "q1" | "q2";
}
interface Explosion {
  readonly content: ContentId; readonly origin: Vec3; readonly angles: Vec3; readonly start: number;
  readonly frames: number; readonly baseFrame: number; readonly path: string; readonly kind: "poly" | "misc" | "flash";
  readonly flags: number; readonly skin: number; readonly light: { readonly radius: number; readonly color: Vec3 } | null;
}
interface Steam {
  readonly content: ContentId; readonly event: Extract<Q2MissionPackEntityEvent, { readonly kind: "steam" }>;
  readonly end: number; next: number;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const white: Vec3 = { x: 1, y: 1, z: 1 };
const orange: Vec3 = { x: 1, y: 0.5, z: 0.5 };
const q1BeamModels: Readonly<Record<Q1BeamStyle, string>> = {
  lightning1: "progs/bolt.mdl", lightning2: "progs/bolt2.mdl", lightning3: "progs/bolt3.mdl", grapple: "progs/beam.mdl",
};

/** A world owns one event stream. Preparation advances it once; seat frames only sample it. */
export class ApplicationEffects {
  private readonly random: SourceRandom;
  private readonly groups = new Map<ContentId, Group>();
  private readonly images = new Map<"q1" | "q2", RendererImage>();
  private readonly q3 = new Map<ContentId, Q3ApplicationEffects>();
  private readonly q3Weapons = new Map<ContentId, Q3ApplicationEffects>();
  private readonly q3WeaponTimes = new Map<ContentId, number>();
  private entityTrails = new Map<ActorId, { readonly content: ContentId; readonly origin: Vec3; readonly count: number }>();
  private pending: SimulationPresentationEvent[] = [];
  private unhandled: UnhandledApplicationEffect[] = [];
  private beams: Beam[] = [];
  private explosions: Explosion[] = [];
  private lights: TimedLight[] = [];
  private sampledLights: SurfaceDynamicLight[] = [];
  private readonly shadowLights = new Map<ActorId, Q2ShadowLightState>();
  private readonly sourceLights = new Map<ActorId, SurfaceDynamicLight>();
  private readonly playerViews = new Q2EffectViews();
  private readonly trackerPain = new Map<ActorId, { readonly content: ContentId; readonly until: number }>();
  private steam: Steam[] = [];
  private readonly sounds: SourceEffectSound[] = [];
  private poses: readonly Pick<SimulationPresentation, "actor" | "origin" | "angles">[] = [];
  private time: number | null = null;
  private sequence = -1;
  private closed = false;
  constructor(readonly assets: ApplicationAssets, readonly queries: SceneQueries, seed = 1) { this.random = new SourceRandom(seed); }
  receive(events: readonly SimulationPresentationEvent[]): void {
    if (this.closed) throw new Error("Effect world is closed");
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence; this.pending.push(event);
    }
  }
  drainUnhandled(): readonly UnhandledApplicationEffect[] { const result = this.unhandled; this.unhandled = []; return result; }
  drainSounds() { return [...this.sounds.splice(0), ...[...this.q3.values(), ...this.q3Weapons.values()].flatMap(effects => effects.drainSounds())]; }
  playerView(actor: ActorId, camera: SceneCamera) { return this.playerViews.frame(actor, camera, this.time ?? 0, actor => this.pose(actor)); }
  private reject(source: SimulationPresentationEvent, reason: string): void { this.unhandled.push({ source, reason }); }
  private pose(actor: ActorId) { return this.poses.find(pose => pose.actor.equals(actor)); }
  private async group(content: ContentId): Promise<Group> {
    const prior = this.groups.get(content); if (prior !== undefined) return prior;
    const provider = await this.assets.provider(content);
    const group: Group = { provider, particles: new SourceParticles(this.random), renderer: new SceneModelRenderer(provider, this.assets.world), models: [], sampled: [] };
    this.groups.set(content, group);
    if (provider.family !== "q3" && !this.images.has(provider.family)) this.images.set(provider.family,
      this.assets.images.register(`*${provider.family}-source-particles`, legacyParticleImage(provider.family), { wrap: "clamp", filter: "linear" }));
    return group;
  }
  private light(origin: Vec3, time: number, radius: number, duration: number, color: Vec3, decay = 0, minimum = 0, actor: ActorId | null = null): void {
    const prior = actor === null ? -1 : this.lights.findIndex(light => light.actor?.equals(actor));
    if (prior >= 0) this.lights.splice(prior, 1);
    if (this.lights.length >= 32) this.lights.shift();
    this.lights.push({ origin, born: time, die: time + duration, radius, color, decay, minimum, actor });
  }
  private beam(beam: Beam): void {
    const old = this.beams.findIndex(value => value.actor.equals(beam.actor) && value.family === beam.family && value.model === beam.model);
    if (old >= 0) this.beams.splice(old, 1);
    this.beams.push(beam);
  }
  async prepare(snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[] = [],
    weaponClock: { readonly content: ContentId; readonly timeMilliseconds: number } | null = null): Promise<void> {
    if (this.closed) throw new Error("Effect world is closed");
    const now = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    if (this.time !== null && now < this.time) throw new Error("Effect time rewound without replacing its world owner");
    const elapsed = this.time === null ? 0 : now - this.time;
    this.poses = [...characters, ...presentations.filter(pose => !pose.viewWeapon)];
    for (const group of this.groups.values()) group.models = [];
    const pending = this.pending; this.pending = [];
    for (const source of pending) await this.event(source);
    const liveActors = new Set(snapshot.actors.map(actor => actor.id));
    for (const actor of this.shadowLights.keys()) if (!liveActors.has(actor)) this.shadowLights.delete(actor);
    for (const actor of this.sourceLights.keys()) if (!liveActors.has(actor)) this.sourceLights.delete(actor);
    for (const actor of this.trackerPain.keys()) if (!liveActors.has(actor)) this.trackerPain.delete(actor);
    this.playerViews.retain(liveActors);
    this.steam = this.steam.filter(steam => steam.end >= now);
    if (elapsed > 0 || this.time === null) for (const steam of this.steam) if (steam.next <= now) {
      const event = steam.event, particles = (await this.group(steam.content)).particles;
      if (particles.q2Steam(event.origin, event.direction, event.color, event.count, event.speed, now)) steam.next += 0.1;
    }
    this.beams = this.beams.filter(beam => beam.die >= now);
    this.explosions = this.explosions.filter(explosion => Math.floor((Math.round(now * 1000) - Math.round(explosion.start * 1000)) / 100) < explosion.frames - 1);
    this.lights = this.lights.filter(light => light.die >= now && light.radius - light.decay * (now - light.born) > 0);
    this.sampledLights = this.lights.map(light => ({ origin: light.origin, radius: Math.max(0, light.radius - light.decay * (now - light.born)), minimum: light.minimum, color: light.color }));
    this.sampledLights.push(...this.sourceLights.values());
    await this.q2Entities(presentations, now, elapsed > 0 || this.time === null);
    for (const [actor, effect] of this.trackerPain) {
      if (effect.until <= now) { this.trackerPain.delete(actor); continue; }
      if (presentations.some(entity => entity.family === "q2" && entity.actor.equals(actor) && entity.visible && !entity.viewWeapon)) continue;
      const pose = this.pose(actor);
      if (pose !== undefined) {
        if (elapsed > 0 || this.time === null) (await this.group(effect.content)).particles.q2TrackerShell(pose.origin, now);
        this.sampledLights.push({ origin: pose.origin, radius: 155, minimum: 0, color: { x: -1, y: -1, z: -1 } });
      }
    }
    for (const beam of this.beams) if (beam.model !== null) await this.beamModels(beam);
    for (const explosion of this.explosions) await this.explosionModel(explosion, now);
    for (const group of this.groups.values()) {
      const samples = group.particles.sample(now, elapsed);
      group.sampled = group.provider.family === "q1" ? samples.q1 : samples.q2;
      await group.renderer.preload(group.models);
    }
    for (const effects of this.q3.values()) await effects.prepare(Math.trunc(now * 1000), Math.trunc(elapsed * 1000));
    for (const [content, effects] of this.q3Weapons) {
      if (weaponClock === null || weaponClock.content !== content) throw new Error("Q3 ballistic effects require the selected weapon clock");
      const current = weaponClock.timeMilliseconds, previous = this.q3WeaponTimes.get(content) ?? current;
      if (current < previous) throw new Error("Q3 weapon effect clock rewound without replacing its world owner");
      await effects.prepare(current, current - previous);
      this.q3WeaponTimes.set(content, current);
    }
    this.time = now;
  }
  frame(camera: SceneCamera, viewer: ActorId | null = null): ApplicationEffectFrame {
    if (this.closed) throw new Error("Effect world is closed");
    const time = { kind: "seconds", value: this.time ?? 0 } satisfies WorldSnapshot["frame"]["time"];
    const project = createViewProjector(camera), batches: DrawBatch[] = [], q3Lights: DynamicLight[] = [];
    for (const group of this.groups.values()) {
      const family = group.provider.family;
      if (family !== "q3" && group.sampled.length > 0) {
        const image = this.images.get(family); if (image === undefined) throw new Error("Particles have no source texture");
        batches.push(prepareParticleBatch(group.sampled, { camera, indexedProfile: family, paletteColor: index => this.palette(group, index) }, image, project));
      }
      batches.push(...group.renderer.prepare(group.models, { camera, time, target: { kind: "preview", id: "effects" }, lights: this.sampledLights }));
    }
    for (const beam of this.beams) if (beam.model === null) {
      const group = this.groups.get(beam.content); if (group === undefined) throw new Error("Beam has no source palette");
      const color = this.palette(group, beam.color);
      batches.push(q2BeamBatch(beam.start, beam.end, beam.width, { ...color, w: 76.5 }, project, group.provider.textures.white.image,
        { blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: "less-equal", depthWrite: false,
          alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null }));
    }
    const operations: RenderOperation[] = [{ kind: "draw", batches }];
    const sourceLights: SurfaceDynamicLight[] = [];
    for (const effects of [...this.q3.values(), ...this.q3Weapons.values()]) {
      const frame = effects.frame(camera, viewer); operations.push(...frame.operations); q3Lights.push(...frame.q3Lights);
      sourceLights.push(...frame.q3Lights.map(light => ({ ...light, minimum: 0 })));
    }
    for (const light of this.sampledLights) q3Lights.push({ origin: light.origin, radius: light.radius, color: light.color });
    return { operations, lights: [...this.sampledLights, ...sourceLights], q3Lights: q3Lights.slice(0, 32) };
  }
  shadowSceneLights(camera: SceneCamera, style: (index: number) => number): readonly SceneLight[] {
    return [...this.shadowLights.values()].flatMap(light => {
      if (!light.visible || light.radius <= 0) return [];
      let fade = 1;
      if (!(light.fadeStart <= 1 && light.fadeEnd <= 1) && light.fadeStart <= light.fadeEnd) {
        const fraction = Math.min(1, Math.max(0, length3(sub3(light.origin, camera.origin)) / light.fadeEnd)), start = light.fadeStart / light.fadeEnd;
        if (start <= 0) fade = fraction;
        else if (start < 1) { const value = Math.min(1, Math.max(0, (fraction - start) / (1 - start))); fade = 1 - value * value * (3 - 2 * value); }
        else fade = fraction < 1 ? 1 : 0;
      }
      return fade <= 0 ? [] : [{ origin: light.origin, color: light.color, radius: light.radius, additive: true,
        profile: { kind: "q2", scale: light.intensity * fade * (light.lightstyle === -1 ? 1 : style(light.lightstyle)),
          cone: light.cone, shadow: { kind: "cast", resolution: light.resolution } } } satisfies SceneLight];
    });
  }
  private palette(group: Group, index: number): Vec3 {
    const palette = group.provider.palette; if (palette === null) throw new Error("Indexed effects require their source palette");
    const offset = (index & 255) * 3, x = palette.colors[offset], y = palette.colors[offset + 1], z = palette.colors[offset + 2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Incomplete effect palette");
    return { x, y, z };
  }
  private async event(source: SimulationPresentationEvent): Promise<void> {
    if (source.kind === "view-reset" || source.kind === "q2-player" || source.kind === "q1-level") return;
    if (source.kind === "q3-ballistics") {
      let effects = this.q3Weapons.get(source.content);
      if (effects === undefined) { effects = await Q3ApplicationEffects.create(this.assets, this.queries, source.content); this.q3Weapons.set(source.content, effects); }
      await effects.ballistic(source.event);
      return;
    }
    if (source.kind === "q3-source") {
      if (source.event.kind === "entity-event") this.reject(source, "Native Q3 entity event requires its per-seat cgame snapshot and weapon presentation context");
      return;
    }
    if (source.kind === "q2-composition") {
      const event = source.event;
      if (event.kind === "missionpack-player") {
        if (event.event.kind === "tracker-pain") this.trackerPain.set(event.event.actor, { content: source.content, until: event.event.until });
        else this.playerViews.receive(event.event);
      } else if (event.kind === "missionpack-entity") {
        const group = await this.group(source.content), effect = event.event;
        if (effect.kind === "force-wall") group.particles.q2ForceWall(effect.start, effect.end, effect.color, source.seconds);
        else if (effect.id === -1) group.particles.q2Steam(effect.origin, effect.direction, effect.color, effect.count, effect.speed, source.seconds);
        else if (this.steam.length < 32) this.steam.push({ content: source.content, event: effect, end: source.seconds + effect.milliseconds / 1000, next: source.seconds });
      } else if (event.kind === "ctf" || event.kind === "lmctf") {
        const effect = event.event;
        if (effect.kind === "grapple-cable") {
          await this.group(source.content);
          this.beam({ content: source.content, actor: effect.actor, start: add3(effect.start, effect.offset), end: effect.end,
            die: source.seconds + 0.2, width: 0, color: 0, model: "models/ctf/segment/tris.md2", family: "q2" });
        }
      } else if (event.kind === "kick" || event.kind === "grapple-prediction") {
        this.reject(source, "Q2 session action reached the presentation owner");
      } else { const exhaustive: never = event; throw new Error(`Unknown Q2 composition event: ${String(exhaustive)}`); }
      return;
    }
    if (source.kind === "q2-rerelease") {
      const event = source.event;
      if (event.kind === "dynamic-light") {
        if (event.visible) this.sourceLights.set(event.actor, { origin: event.origin, radius: event.radius, color: event.color, minimum: 0 });
        else this.sourceLights.delete(event.actor);
      }
      return;
    }
    if (source.kind === "q3-character") {
      const pose = this.pose(source.event.actor.id);
      if (pose === undefined) { this.reject(source, "Q3 character event has no captured actor pose"); return; }
      let effects = this.q3.get(source.content);
      if (effects === undefined) { effects = await Q3ApplicationEffects.create(this.assets, this.queries, source.content); this.q3.set(source.content, effects); }
      if (!effects.event(source.event, pose.origin)) this.reject(source, "Q3 event requires the full cgame snapshot payload");
      return;
    }
    if (source.kind === "q1") {
      const event = source.event;
      if (event.kind !== "effect" && event.kind !== "beam") return;
      const group = await this.group(source.content), particles = group.particles, seconds = source.seconds;
      if (event.kind === "beam") { this.beam({ content: source.content, actor: event.actor, start: event.start, end: event.end, die: seconds + 0.2, width: 0, color: 0, model: q1BeamModels[event.style], family: "q1" }); return; }
      switch (event.effect) {
        case "blood": case "meat-spray": particles.q1Impact(event.origin, zero, 73, event.amount, seconds); break;
        case "gunshot": particles.q1Impact(event.origin, zero, 0, 20, seconds); break;
        case "spike": case "superspike": particles.q1Impact(event.origin, zero, 0, event.effect === "spike" ? 10 : 20, seconds); break;
        case "explosion": particles.q1Explosion(event.origin, seconds, false); this.light(event.origin, seconds, 350, 0.5, white, 300); break;
        case "tar-explosion": particles.q1Explosion(event.origin, seconds, true); break;
        case "lava-splash": case "teleport": particles.q1Splash(event.origin, seconds, event.effect === "lava-splash"); break;
        case "muzzleflash": {
          const pose = event.actor === null ? undefined : this.pose(event.actor), direction = pose === undefined ? zero : anglesToAxis(pose.angles)[0];
          this.light(add3(add3(event.origin, { x: 0, y: 0, z: 16 }), scale3(direction, 18)), seconds, 200 + (this.random.nextInteger() & 31), 0.1, white, 0, 32, event.actor); break;
        }
        case "pickup": break;
      }
      return;
    }
    if (source.kind === "q2-weapon") {
      const event = source.event;
      if (event.kind !== "beam" && event.kind !== "muzzleflash") return;
      const group = await this.group(source.content);
      if (event.kind === "muzzleflash") {
        const pose = this.pose(event.actor); if (pose === undefined) { this.reject(source, "Q2 muzzle flash has no captured actor pose"); return; }
        const axis = anglesToAxis(pose.angles), origin = add3(add3(pose.origin, scale3(axis[0], 18)), scale3(axis[1], -16));
        if (!this.muzzle(origin, source.seconds, event.flash, event.silenced, event.actor)) this.reject(source, `Quake II player muzzle flash ${event.flash} has no source definition`);
        if (event.flash === 9 || event.flash === 10 || event.flash === 11) group.particles.q2Respawn(pose.origin, source.seconds, event.flash === 9 ? "login" : event.flash === 10 ? "logout" : "respawn");
        return;
      }
      if (event.effect === "rail" || event.effect === "rail-water") group.particles.q2Rail(event.start, event.end, source.seconds);
      else if (event.effect === "bubble-trail") group.particles.q2Bubbles(event.start, event.end, source.seconds);
      else if (event.effect === "bfg-laser" || event.effect === "bfg-zap" || event.effect === "bfg-lightning") this.beams.push({ content: source.content, actor: event.actor, start: event.start, end: event.end,
        die: source.seconds + (event.duration > 0 ? event.duration : 0.1), width: 4, color: 0xd0 + (this.random.nextInteger() & 3),
        model: event.effect === "bfg-lightning" ? "models/proj/lightning/tris.md2" : null, family: "q2" });
      else this.reject(source, "Q2 heatbeam requires the source player-beam view and offset context");
      return;
    }
    const event = source.event;
    if (event.kind === "effect") { await this.q2Effect(source, event); return; }
    if (event.kind === "beam" || event.kind === "monster-beam") {
      await this.group(source.content);
      if (event.kind === "beam" && !event.visible) { this.beams = this.beams.filter(beam => !beam.actor.equals(event.actor)); return; }
      this.beam({ content: source.content, actor: event.actor, start: event.start, end: event.end,
        die: event.kind === "beam" ? Number.POSITIVE_INFINITY : source.seconds + 0.2, width: event.kind === "beam" ? event.width : 0,
        color: event.kind === "beam" ? event.color & 255 : 0,
        model: event.kind === "monster-beam" ? "models/monsters/parasite/segment/tris.md2" : null, family: "q2" });
    } else if (event.kind === "monster-muzzleflash") await this.monsterMuzzle(source, event.origin, event.flash);
    else if (event.kind === "entity-event") {
      if (event.event === 1 || event.event === 6 || event.event === 7) {
        const pose = this.pose(event.actor); if (pose === undefined) { this.reject(source, "Q2 entity event has no captured actor pose"); return; }
        const group = await this.group(source.content);
        if (event.event === 1) group.particles.q2Respawn(pose.origin, source.seconds, "item"); else group.particles.q2Teleport(pose.origin, source.seconds);
      }
    } else if (event.kind === "dynamic-light") this.shadowLights.set(event.actor, event);
  }
  private muzzle(origin: Vec3, seconds: number, flash: number, silenced: boolean, actor: ActorId): boolean {
    if (!(flash >= 0 && flash <= 20 && flash !== 15 || flash >= 30 && flash <= 39)) return false;
    const color = flash === 6 ? { x: 0.5, y: 0.5, z: 1 } : flash === 7 ? { x: 1, y: 0.5, z: 0.2 }
      : flash === 8 || flash === 4 || flash === 31 ? { x: 1, y: 0.5, z: 0 } : flash === 3 ? { x: 1, y: 0.25, z: 0 }
      : flash === 12 || flash === 19 || flash === 34 || flash === 9 ? { x: 0, y: 1, z: 0 }
      : flash === 10 || flash === 36 ? { x: 1, y: 0, z: 0 } : flash === 35 ? { x: -1, y: -1, z: -1 }
      : flash === 17 || flash === 38 ? { x: 0, y: 0, z: 1 } : flash === 39 ? { x: 0, y: 1, z: 1 }
      : flash === 16 || flash === 18 || flash === 20 ? { x: 1, y: 0.5, z: 0.5 } : flash === 30 ? { x: 0.9, y: 0.7, z: 0 } : { x: 1, y: 1, z: 0 };
    const radius = flash === 4 ? 225 : flash === 5 ? 250 : flash === 3 ? 200 : silenced ? 100 : 200;
    const duration = flash === 33 || flash >= 36 && flash <= 39 ? 0.1 : flash >= 9 && flash <= 11 ? 0.001 : flash === 4 || flash === 5 ? 0.0001 : 0;
    this.light(origin, seconds, radius + (this.random.nextInteger() & 31), duration, color, 0, 32, actor);
    return true;
  }
  private async monsterMuzzle(source: SimulationPresentationEvent, origin: Vec3, flash: number): Promise<void> {
    const profile = q2MonsterMuzzles.get(flash);
    if (profile === undefined) { this.reject(source, `Quake II monster muzzle flash ${flash} has no source definition`); return; }
    const group = await this.group(source.content);
    this.light(origin, source.seconds, profile.radius + (this.random.nextInteger() & profile.mask), profile.radius === 300 ? 0.2 : 0, profile.color, 0, 32,
      source.kind === "q2" && source.event.kind === "monster-muzzleflash" ? source.event.actor : null);
    if (profile.particles) group.particles.q2Impact(origin, zero, 0, 40, source.seconds);
    if (profile.smoke) {
      this.explosions.push({ content: source.content, origin, angles: zero, start: source.seconds - 0.1, frames: 4, baseFrame: 0,
        path: "models/objects/smoke/tris.md2", kind: "misc", flags: 32, skin: 0, light: null });
      this.explosions.push({ content: source.content, origin, angles: zero, start: source.seconds - 0.1, frames: 2, baseFrame: 0,
        path: "models/objects/flash/tris.md2", kind: "flash", flags: 8, skin: 0, light: null });
    }
  }
  private async q2Effect(source: SimulationPresentationEvent, event: Extract<Extract<SimulationPresentationEvent, { readonly kind: "q2" }>["event"], { readonly kind: "effect" }>): Promise<void> {
    const original = event.effect, name = original.replace(/^q2:/, "").replaceAll("_", "-"), group = await this.group(source.content), p = group.particles, time = source.seconds;
    switch (name) {
      case "heatbeam-sparks": case "heatbeam-steam":
        p.q2Steam(event.origin, event.direction, name === "heatbeam-sparks" ? 8 : 0xe0, name === "heatbeam-sparks" ? 50 : 20, 60, time);
        this.sounds.push({ content: source.content, path: "weapons/lashit.wav", origin: event.origin, channel: 0, volume: 1, seconds: time, playback: { kind: "once" } }); break;
      case "chainfist-smoke": p.q2Steam(event.origin, { x: 0, y: 0, z: 1 }, 0, 20, 20, time, true); break;
      case "tracker-explosion":
        p.q2ColorExplosion(event.origin, time, 0, 1); this.light(event.origin, time, 150, 0.1, { x: -1, y: -1, z: -1 }, 0, 250);
        this.sounds.push({ content: source.content, path: "weapons/disrupthit.wav", origin: event.origin, channel: 0, volume: 1, seconds: time, playback: { kind: "once" } }); break;
      case "blood": p.q2Impact(event.origin, event.direction, 0xe8, 60, time); break;
      case "moreblood": p.q2Impact(event.origin, event.direction, 0xe8, 250, time); break;
      case "gunshot": case "shotgun": p.q2Impact(event.origin, event.direction, 0, name === "gunshot" ? 40 : 20, time); break;
      case "sparks": case "bullet-sparks": p.q2Impact(event.origin, event.direction, 0xe0, 6, time); break;
      case "screen-sparks": case "shield-sparks": p.q2Impact(event.origin, event.direction, name === "screen-sparks" ? 0xd0 : 0xb0, 40, time); break;
      case "laser-sparks": p.q2Impact(event.origin, event.direction, event.color, event.count, time, "fixed"); break;
      case "tunnel-sparks": p.q2Impact(event.origin, event.direction, event.color, event.count, time, "up"); break;
      case "splash": {
        const colors = [0, 0xe0, 0xb0, 0x50, 0xd0, 0xe0, 0xe8];
        p.q2Impact(event.origin, event.direction, colors[event.color] ?? 0, event.count, time); break;
      }
      case "bluehyperblaster": p.q2Impact(event.origin, event.direction, 0xe0, 40, time, "blaster"); break;
      case "blaster": case "blaster2": case "flechette": {
        p.q2Impact(event.origin, event.direction, name === "blaster" ? 0xe0 : name === "blaster2" ? 0xd0 : 0x6f, 40, time, "blaster");
        const direction = event.direction, yaw = direction.x !== 0 ? Math.atan2(direction.y, direction.x) * 180 / Math.PI : direction.y > 0 ? 90 : direction.y < 0 ? 270 : 0;
        this.explosions.push({ content: source.content, origin: event.origin, angles: { x: Math.acos(direction.z) * 180 / Math.PI, y: yaw, z: 0 },
          start: time - 0.1, frames: 4, baseFrame: 0, path: "models/objects/explode/tris.md2", kind: "misc", flags: 8 | 32,
          skin: name === "blaster" ? 0 : name === "blaster2" ? 1 : 2,
          light: { radius: 150, color: name === "blaster" ? { x: 1, y: 1, z: 0 } : name === "blaster2" ? { x: 0, y: 1, z: 0 } : { x: 0.19, y: 0.41, z: 0.75 } } });
        break;
      }
      case "greenblood": p.q2Impact(event.origin, event.direction, 0xdf, 30, time, "fixed"); break;
      case "electric-sparks": p.q2Impact(event.origin, event.direction, 0x75, 40, time); break;
      case "player-teleport": case "other-teleport": p.q2Teleport(event.origin, time); break;
      case "boss-teleport": p.q2BigTeleport(event.origin, time); break;
      case "item-respawn": p.q2Respawn(event.origin, time, "item"); break;
      case "logout": p.q2Respawn(event.origin, time, "logout"); break;
      case "bfg-bigexplosion": p.q2Explosion(event.origin, time, true); break;
      case "explosion1": case "explosion2": case "rocket-explosion": case "rocket-explosion-water": case "grenade-explosion": case "grenade-explosion-water": case "bfg-explosion": {
        const grenade = name === "explosion2" || name.startsWith("grenade"), bfg = name === "bfg-explosion";
        if (!bfg) p.q2Explosion(event.origin, time, false);
        const start = time - 0.1, frames = bfg ? 4 : grenade ? 19 : 15;
        this.explosions.push({ content: source.content, origin: event.origin, angles: { x: 0, y: this.random.nextInteger() % 360, z: 0 }, start,
          frames, baseFrame: bfg ? 0 : grenade ? 30 : this.random.nextUnit() < 0.5 ? 15 : 0,
          path: bfg ? "sprites/s_bfg2.sp2" : "models/objects/r_explode/tris.md2", kind: "poly", flags: bfg ? 8 | 32 : 8, skin: 0,
          light: { radius: 350, color: bfg ? { x: 0, y: 1, z: 0 } : orange } });
        break;
      }
      case "muzzleflash2": await this.monsterMuzzle(source, event.origin, event.count); break;
      case "footstep": case "monster-footstep": case "fall": case "fall-short": case "fall-far": break;
      default: this.reject(source, `Unresolved Quake II source effect ${original}`);
    }
  }
  private async q2Entities(presentations: readonly SimulationPresentation[], seconds: number, advance: boolean): Promise<void> {
    const trails = new Map<ActorId, { readonly content: ContentId; readonly origin: Vec3; readonly count: number }>();
    for (const entity of presentations) {
      if (entity.family !== "q2" || !entity.visible || entity.viewWeapon) continue;
      const prior = this.entityTrails.get(entity.actor), delta = prior === undefined ? zero : sub3(prior.origin, entity.origin);
      const reset = prior === undefined || prior.content !== entity.content || Math.abs(delta.x) > 512 || Math.abs(delta.y) > 512 || Math.abs(delta.z) > 512;
      const start = reset || prior === undefined ? entity.origin : prior.origin;
      let count = reset || prior === undefined ? 1024 : prior.count;
      if (entity.effects !== 0 || (this.trackerPain.get(entity.actor)?.until ?? 0) > seconds) {
        const group = await this.group(entity.content), p = group.particles;
        const flags = entity.effects | ((this.trackerPain.get(entity.actor)?.until ?? 0) > seconds ? 0x80000000 : 0);
        const light = (radius: number, color: Vec3): void => { this.sampledLights.push({ origin: entity.origin, radius, color, minimum: 0 }); };
        if (advance && (flags & 0x00020000) !== 0) p.q2Teleporter(entity.origin, seconds);
        // CL_AddPacketEntities preserves this order; tracker overloads blaster/hyperblaster.
        if ((flags & 0x10) !== 0) { if (advance) count = p.q2DiminishingTrail(start, entity.origin, seconds, count, "rocket"); light(200, { x: 1, y: 1, z: 0 }); }
        else if ((flags & 0x08) !== 0) { if (advance) p.q2BlasterTrail(start, entity.origin, seconds, (flags & 0x04000000) !== 0); light(200, { x: (flags & 0x04000000) !== 0 ? 0 : 1, y: 1, z: 0 }); }
        else if ((flags & 0x40) !== 0) light(200, { x: (flags & 0x04000000) !== 0 ? 0 : 1, y: 1, z: 0 });
        else if ((flags & 0x02) !== 0) { if (advance) count = p.q2DiminishingTrail(start, entity.origin, seconds, count, "blood"); }
        else if ((flags & 0x20) !== 0) { if (advance) count = p.q2DiminishingTrail(start, entity.origin, seconds, count, "smoke"); }
        else if ((flags & 0x80) !== 0) light((flags & 0x2000) !== 0 ? 200 : [300, 400, 600, 300, 150, 75][entity.frame] ?? 0, { x: 0, y: 1, z: 0 });
        else if ((flags & 0x80000000) !== 0) {
          if ((flags & 0x04000000) !== 0) light(50 + 500 * (Math.sin(seconds * 2) + 1), { x: -1, y: -1, z: -1 });
          else { if (advance) p.q2TrackerShell(start, seconds); light(155, { x: -1, y: -1, z: -1 }); }
        }
        else if ((flags & 0x04000000) !== 0) { if (advance) p.q2TrackerTrail(start, entity.origin, seconds); light(200, { x: -1, y: -1, z: -1 }); }
        else if ((flags & 0x00200000) !== 0) { if (advance) count = p.q2DiminishingTrail(start, entity.origin, seconds, count, "green-blood"); }
        else if ((flags & 0x00400000) !== 0) light(200, { x: 0, y: 0, z: 1 });
        else if ((flags & 0x01000000) !== 0) { if (advance && (flags & 0x2000) !== 0) p.q2BlasterTrail(start, entity.origin, seconds, false); light(130, orange); }
      }
      trails.set(entity.actor, { content: entity.content, origin: entity.origin, count });
    }
    this.entityTrails = trails;
  }
  private async beamModels(beam: Beam): Promise<void> {
    if (beam.model === null) return;
    const start = beam.start;
    const delta = sub3(beam.end, start), length = length3(delta), direction = normalize3OrZero(delta), horizontal = Math.hypot(delta.x, delta.y);
    const yawAngle = horizontal === 0 ? 0 : Math.atan2(delta.y, delta.x) * 180 / Math.PI;
    const pitchAngle = horizontal === 0 ? delta.z > 0 ? 90 : 270 : Math.atan2(delta.z, horizontal) * (beam.family === "q1" ? 180 : -180) / Math.PI;
    const yaw = beam.family === "q1" ? Math.trunc(yawAngle) : yawAngle < 0 ? yawAngle + 360 : yawAngle;
    const pitch = beam.family === "q1" ? Math.trunc(pitchAngle) : pitchAngle < 0 ? pitchAngle + 360 : pitchAngle;
    const asset = await this.assets.model(beam.content, beam.model), group = await this.group(beam.content);
    const lightning = beam.model === "models/proj/lightning/tris.md2", modelLength = lightning ? 35 : 30;
    const beamLength = lightning ? length - 20 : length, shortLightning = lightning && beamLength <= modelLength;
    const steps = shortLightning ? 1 : Math.ceil(beamLength / modelLength), spacing = beam.family === "q1" ? 30 : steps > 1 ? (beamLength - modelLength) / (steps - 1) : 0;
    for (let segment = 0; segment < steps; segment++) {
      const origin = shortLightning ? beam.end : add3(start, scale3(direction, segment * spacing));
      const angles = { x: lightning && !shortLightning ? -pitch : pitch, y: lightning && !shortLightning ? yaw + 180 : yaw, z: this.random.nextInteger() % 360 };
      group.models.push({ actor: null, resource: asset.resource, model: asset.model,
        transform: { origin, axis: anglesToAxis(angles), scale: white }, previousOrigin: origin,
        pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { ...white, w: 1 }, shaderTime: { kind: "seconds", value: 0 },
        flags: { kind: beam.family, bits: lightning ? 8 : 0 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] });
    }
  }
  private async explosionModel(explosion: Explosion, now: number): Promise<void> {
    const asset = await this.assets.model(explosion.content, explosion.path), group = await this.group(explosion.content);
    const fraction = (Math.round(now * 1000) - Math.round(explosion.start * 1000)) / 100, frame = Math.max(0, Math.floor(fraction));
    const alpha = explosion.kind === "flash" ? 1 : explosion.kind === "misc" ? 1 - fraction / (explosion.frames - 1) : (16 - frame) / 16;
    const skin = explosion.kind === "poly" ? frame < 10 ? frame >> 1 : frame < 13 ? 5 : 6 : explosion.skin;
    if (explosion.light !== null) this.sampledLights.push({ origin: explosion.origin, radius: explosion.light.radius * alpha, color: explosion.light.color, minimum: 0 });
    group.models.push({ actor: null, resource: asset.resource, model: asset.model,
      transform: { origin: explosion.origin, axis: anglesToAxis(explosion.angles), scale: white }, previousOrigin: explosion.origin,
      pose: { kind: "frame", frame: explosion.baseFrame + frame + 1, previousFrame: explosion.baseFrame + frame, backLerp: 1 - (fraction - frame) },
      skin, color: { ...white, w: alpha }, shaderTime: { kind: "seconds", value: 0 },
      flags: { kind: "q2", bits: explosion.flags | (explosion.kind === "poly" && frame >= 10 ? 32 : 0) }, lightingOrigin: explosion.origin, shadowPlane: 0, attachments: [] });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.pending = []; this.unhandled = []; this.beams = []; this.explosions = []; this.lights = []; this.sampledLights = [];
    for (const effects of [...this.q3.values(), ...this.q3Weapons.values()]) effects.close();
    for (const image of this.images.values()) this.assets.images.release(image);
    this.images.clear(); this.groups.clear(); this.q3.clear(); this.q3Weapons.clear(); this.q3WeaponTimes.clear(); this.entityTrails.clear();
    this.shadowLights.clear(); this.sourceLights.clear(); this.playerViews.clear(); this.trackerPain.clear(); this.steam = []; this.sounds.length = 0;
  }
}
