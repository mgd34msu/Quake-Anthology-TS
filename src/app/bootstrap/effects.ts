import { presentationOwnerKey, samePresentationOwner, type PresentationOwner } from "../../contracts/presentation.ts";
import { addQ2Blend } from "../../content/q2/base/player/view.ts";
import type { Q3Hardware } from "../../render/q3-hardware.ts";
import type { Q3SceneAdmission } from "../../content/q3/presentation/scene.ts";
import { sequenceDrawGroup, type SourceSceneOrder, type SceneOperation } from "../../render/scene/submissions.ts";
import type { Q2ShadowLightState } from "../../content/q2/foundation/shadow-lights.ts";
/* Application joins for Quake cl_tent/r_part and Quake II cl_tent/cl_fx.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { RendererImage, SceneCamera } from "../../contracts/render.ts";
import type { SceneEntity, SceneLight, SceneParticle, SceneQueries, SceneLightStyle } from "../../contracts/scene.ts";
import type { WorldScene } from "../../render/scene/world.ts";
import type { ModelTransform } from "../../render/scene/view.ts";
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
import { q2MonsterMuzzle } from "./effects/q2-muzzle.ts";
import { Q3ApplicationEffects } from "./effects/q3.ts";
import type { SourceEffectSound } from "./effects/q3.ts";
import type { Q2MissionPackEntityEvent } from "../../content/q2/missionpacks/entities/types.ts";
import { Q2EffectViews, type Q2EffectPlayerView } from "./effects/q2-view.ts";
import { Q2_TRANSIENT_MODELS } from "../../content/q2/foundation/effect-resources.ts";
export type { SourceEffectSound } from "./effects/q3.ts";

export interface ApplicationEffectFrame {
  readonly q3Admissions: readonly Q3SceneAdmission[];
  readonly operations: readonly SceneOperation[];
  readonly lights: readonly SurfaceDynamicLight[];
  readonly q3Lights: readonly DynamicLight[];
}
export interface UnhandledApplicationEffect { readonly source: SimulationPresentationEvent; readonly reason: string; }
interface Group {
  readonly provider: ProviderSceneAssets;
  readonly particles: SourceParticles;
  readonly renderer: SceneModelRenderer;
  models: SceneEntity[];
  readonly statics: (SceneEntity & { readonly presentationOwner?: PresentationOwner })[];
  beams: { readonly actor: ActorId; readonly remote: readonly SceneEntity[]; readonly local: readonly SceneEntity[] | null }[];
  sampled: readonly SceneParticle[];
}
interface TimedLight extends SurfaceDynamicLight { readonly born: number; readonly die: number; readonly decay: number; readonly actor: ActorId | null; }
type Beam = {
  readonly presentationOwner?: PresentationOwner;
  readonly content: ContentId; readonly start: Vec3; readonly end: Vec3;
  readonly die: number; readonly width: number; readonly color: number;
  readonly model: string | null;
} & ({ readonly family: "q1"; readonly actor: ActorId } | { readonly family: "q2"; readonly actor: ActorId | null });
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
  private readonly recipients = new Map<ActorId, ApplicationEffects>();
  private eventsOnly = false;
  private readonly random: SourceRandom;
  private readonly groups = new Map<ContentId, Group>();
  private readonly preparedRenderers = new Map<ContentId, SceneModelRenderer>();
  private readonly images = new Map<"q1" | "q2", RendererImage>();
  private readonly q3 = new Map<ContentId, Q3ApplicationEffects>();
  private readonly q3Weapons = new Map<ContentId, Q3ApplicationEffects>();
  private readonly preparedQ3Weapons = new Map<ContentId, Q3ApplicationEffects>();
  private readonly q3WeaponTimes = new Map<ContentId, number>();
  private entityTrails = new Map<ActorId, { readonly content: ContentId; readonly origin: Vec3; readonly count: number }>();
  private q1Trails = new Map<ActorId, { readonly content: ContentId; readonly path: string; readonly origin: Vec3 }>();
  private pending: SimulationPresentationEvent[] = [];
  private readonly retiredOwners = new Set<string>();
  private readonly ownerRevisions = new Map<string, number>();
  private unhandled: UnhandledApplicationEffect[] = [];
  private beams: Beam[] = [];
  private explosions: Explosion[] = [];
  private readonly staticBrushes: { readonly presentationOwner?: PresentationOwner; readonly scene: WorldScene; readonly model: number; readonly transform: ModelTransform; readonly frame: number }[] = [];
  private styles: readonly SceneLightStyle[] = [];
  private lights: TimedLight[] = [];
  private sampledLights: SurfaceDynamicLight[] = [];
  private readonly flashlights = new Map<ActorId, Extract<SimulationPresentationEvent, { readonly kind: "q2-rerelease" }>["event"] & { readonly kind: "flashlight"; readonly presentationOwner?: PresentationOwner }>();
  private readonly shadowLights = new Map<ActorId, Q2ShadowLightState & { readonly presentationOwner?: PresentationOwner }>();
  private readonly sourceLights = new Map<ActorId, SurfaceDynamicLight & { readonly presentationOwner?: PresentationOwner }>();
  private readonly playerViews = new Q2EffectViews();
  private readonly bonusFlashes = new Map<ActorId, number>();
  private readonly trackerPain = new Map<ActorId, { readonly content: ContentId; readonly until: number }>();
  private steam: Steam[] = [];
  private readonly sounds: SourceEffectSound[] = [];
  private poses: readonly Pick<SimulationPresentation, "actor" | "origin" | "angles">[] = [];
  private time: number | null = null;
  private sequence = -1;
  private closed = false;
  private rendererHardware: () => Q3Hardware = () => "generic";
  private readonly readHardware = (): Q3Hardware => this.rendererHardware();
  bindRendererHardware(read: () => Q3Hardware): void { this.rendererHardware = read; }
  constructor(readonly assets: ApplicationAssets, readonly queries: SceneQueries, readonly isPlayer: (actor: ActorId) => boolean, private readonly seed = 1) { this.random = new SourceRandom(seed); }
  receive(events: readonly SimulationPresentationEvent[]): void {
    if (this.closed) throw new Error("Effect world is closed");
    for (const event of events) {
      if (event.kind === "presentation-owner") {
        const owner = event.event.owner, key = presentationOwnerKey(owner);
        if (event.event.kind === "retired") this.retiredOwners.add(key);
        this.ownerRevisions.set(key, event.sequence);
        this.pending = this.pending.filter(source => !samePresentationOwner(source.owner, owner));
        for (const effects of this.recipients.values()) effects.receive([event]);
        if (event.event.kind === "refreshed") continue;
        this.beams = this.beams.filter(beam => !samePresentationOwner(beam.presentationOwner, owner));
        for (const [actor, light] of this.flashlights) if (samePresentationOwner(light.presentationOwner, owner)) this.flashlights.delete(actor);
        for (const [actor, light] of this.shadowLights) if (samePresentationOwner(light.presentationOwner, owner)) this.shadowLights.delete(actor);
        for (const [actor, light] of this.sourceLights) if (samePresentationOwner(light.presentationOwner, owner)) this.sourceLights.delete(actor);
        for (let index = this.staticBrushes.length - 1; index >= 0; index--)
          if (samePresentationOwner(this.staticBrushes[index]?.presentationOwner, owner)) this.staticBrushes.splice(index, 1);
        for (const group of this.groups.values()) for (let index = group.statics.length - 1; index >= 0; index--)
          if (samePresentationOwner(group.statics[index]?.presentationOwner, owner)) group.statics.splice(index, 1);
        continue;
      }
      if (event.owner !== undefined && this.retiredOwners.has(presentationOwnerKey(event.owner))) continue;
      if (event.recipient !== undefined) {
        const { recipient, ...shared } = event;
        let effects = this.recipients.get(recipient);
        if (effects === undefined) {
          effects = new ApplicationEffects(this.assets, this.queries, this.isPlayer, this.seed);
          effects.eventsOnly = true; effects.bindRendererHardware(this.readHardware);
          this.recipients.set(recipient, effects);
        }
        effects.receive([shared]);
        continue;
      }
      if (event.kind === "q1-fog") continue;
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence; this.pending.push(event);
    }
  }
  drainUnhandled(): readonly UnhandledApplicationEffect[] {
    const result = this.unhandled; this.unhandled = [];
    for (const [recipient, effects] of this.recipients) for (const entry of effects.drainUnhandled()) result.push({ ...entry, source: { ...entry.source, recipient } });
    return result;
  }
  drainRecipientSounds(): readonly { readonly recipient: ActorId; readonly sounds: readonly SourceEffectSound[] }[] {
    const result: { recipient: ActorId; sounds: readonly SourceEffectSound[] }[] = [];
    for (const [recipient, effects] of this.recipients) {
      const sounds = effects.drainSounds(); if (sounds.length > 0) result.push({ recipient, sounds });
    }
    return result;
  }
  drainSounds() { return [...this.sounds.splice(0), ...[...this.q3.values(), ...this.q3Weapons.values()].flatMap(effects => effects.drainSounds())]; }
  playerView(actor: ActorId, camera: SceneCamera): Q2EffectPlayerView {
    const shared = this.sharedPlayerView(actor, camera), effects = this.recipients.get(actor);
    if (effects === undefined) return shared;
    const local = effects.playerView(actor, shared.camera);
    return { camera: local.camera, infrared: shared.infrared || local.infrared,
      blend: local.blend === null ? shared.blend : addQ2Blend(shared.blend ?? { x: 0, y: 0, z: 0, w: 0 }, local.blend, local.blend.w) };
  }
  private sharedPlayerView(actor: ActorId, camera: SceneCamera): Q2EffectPlayerView {
    const seconds = this.time ?? 0, view = this.playerViews.frame(actor, camera, seconds, actor => this.pose(actor));
    const until = this.bonusFlashes.get(actor);
    if (until === undefined) return view;
    // WinQuake view.c V_BonusFlash_f / V_CalcBlend: 50 percent, decaying at 100 per second.
    const percent = Math.max(0, Math.min(50, (until - seconds) * 100));
    if (percent === 0) return view;
    return { ...view, blend: addQ2Blend(view.blend ?? { x: 0, y: 0, z: 0, w: 0 },
      { x: 215 / 255, y: 186 / 255, z: 69 / 255 }, percent / 255) };
  }
  private reject(source: SimulationPresentationEvent, reason: string): void { this.unhandled.push({ source, reason }); }
  private pose(actor: ActorId) { return this.poses.find(pose => pose.actor.equals(actor)); }
  private async group(content: ContentId): Promise<Group> {
    const prior = this.groups.get(content); if (prior !== undefined) return prior;
    const provider = await this.assets.provider(content);
    const renderer = this.preparedRenderers.get(content) ?? new SceneModelRenderer(provider, this.assets.world);
    this.preparedRenderers.delete(content);
    const group: Group = { provider, particles: new SourceParticles(this.random), renderer, models: [], statics: [], beams: [], sampled: [] };
    this.groups.set(content, group);
    if (provider.family !== "q3" && !this.images.has(provider.family)) this.images.set(provider.family,
      this.assets.images.register(`*${provider.family}-source-particles`, legacyParticleImage(provider.family), { wrap: "clamp", filter: "linear" }));
    return group;
  }
  async preloadTransientResources(): Promise<readonly { readonly content: ContentId; readonly path: string; readonly error: string }[]> {
    const recipe = this.assets.content.recipe;
    const character = recipe.character.definition.content;
    const contents = new Set<ContentId>([recipe.map.entities.content, character, ...recipe.weapons.map(weapon => weapon.content)]);
    for (const equipment of [recipe.equipment.grapple, recipe.equipment.handGrenades]) if (equipment.kind === "enabled") contents.add(equipment.source.content);
    if (recipe.enemies.kind === "replace") for (const target of [recipe.enemies.default, ...Object.values(recipe.enemies.byClassname)]) {
      if ("source" in target) contents.add(target.source.content);
    }
    const failures: { content: ContentId; path: string; error: string }[] = [];
    if (character !== recipe.map.entities.content && this.assets.content.catalog.product(character).expectation.family === "q3" && !this.q3.has(character)) {
      try { this.q3.set(character, await Q3ApplicationEffects.create(this.assets, this.queries, character, this.isPlayer, "character", this.readHardware)); }
      catch (error: unknown) { failures.push({ content: character, path: "Q3 character effect media", error: error instanceof Error ? error.message : String(error) }); }
    }
    for (const content of new Set(recipe.weapons.map(weapon => weapon.content))) {
      if (content === recipe.map.entities.content || this.assets.content.catalog.product(content).expectation.family !== "q3"
        || this.preparedQ3Weapons.has(content) || this.q3Weapons.has(content)) continue;
      try {
        const effects = await Q3ApplicationEffects.create(this.assets, this.queries, content, this.isPlayer, "weapons", this.readHardware);
        this.preparedQ3Weapons.set(content, effects);
      } catch (error: unknown) {
        failures.push({ content, path: "Q3 effect media", error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const content of contents) {
      if (this.assets.content.catalog.product(content).expectation.family !== "q2") continue;
      for (const path of Object.values(Q2_TRANSIENT_MODELS)) {
        try {
          const provider = await this.assets.provider(content);
          if (await provider.mounts.resolve(path) === null) continue;
          const asset = await this.assets.model(content, path);
          let renderer = this.preparedRenderers.get(content);
          if (renderer === undefined) { renderer = new SceneModelRenderer(provider, this.assets.world); this.preparedRenderers.set(content, renderer); }
          await renderer.preloadModel(asset);
        } catch (error) { this.preparedRenderers.delete(content); failures.push({ content, path, error: error instanceof Error ? error.message : String(error) }); }
      }
    }
    return failures;
  }

  async preloadModel(content: ContentId, path: string): Promise<void> {
    const provider = await this.assets.provider(content);
    const asset = await this.assets.model(content, path);
    let renderer = this.groups.get(content)?.renderer ?? this.preparedRenderers.get(content);
    if (renderer === undefined) {
      renderer = new SceneModelRenderer(provider, this.assets.world);
      this.preparedRenderers.set(content, renderer);
    }
    await renderer.preloadModel(asset, {}, false);
  }
  private light(origin: Vec3, time: number, radius: number, duration: number, color: Vec3, decay = 0, minimum = 0, actor: ActorId | null = null): void {
    const prior = actor === null ? -1 : this.lights.findIndex(light => light.actor?.equals(actor));
    if (prior >= 0) this.lights.splice(prior, 1);
    if (this.lights.length >= 32) this.lights.shift();
    this.lights.push({ origin, born: time, die: time + duration, radius, color, decay, minimum, actor });
  }
  private beam(beam: Beam): void {
    const actor = beam.actor;
    const old = actor === null ? -1 : this.beams.findIndex(value => value.actor?.equals(actor) && value.family === beam.family && value.model === beam.model);
    if (old >= 0) this.beams.splice(old, 1);
    this.beams.push(beam);
  }
  async prepare(snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[] = [],
    weaponClock: { readonly content: ContentId; readonly timeMilliseconds: number } | null = null): Promise<void> {
    if (this.closed) throw new Error("Effect world is closed");
    const now = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    if (this.time !== null && now < this.time) throw new Error("Effect time rewound without replacing its world owner");
    const elapsed = this.time === null ? 0 : now - this.time;
    this.styles = snapshot.scene.lightStyles;
    this.poses = [...characters, ...presentations.filter(pose => !pose.viewWeapon)];
    for (const group of this.groups.values()) { group.models = []; group.beams = []; }
    const pending = this.pending; this.pending = [];
    for (const source of pending) await this.event(source);
    const liveActors = new Set(snapshot.actors.map(actor => actor.id));
    for (const actor of this.flashlights.keys()) if (!liveActors.has(actor)) this.flashlights.delete(actor);
    for (const actor of this.shadowLights.keys()) if (!liveActors.has(actor)) this.shadowLights.delete(actor);
    for (const actor of this.sourceLights.keys()) if (!liveActors.has(actor)) this.sourceLights.delete(actor);
    for (const actor of this.trackerPain.keys()) if (!liveActors.has(actor)) this.trackerPain.delete(actor);
    this.playerViews.retain(liveActors);
    for (const [actor, until] of this.bonusFlashes) if (!liveActors.has(actor) || until <= now) this.bonusFlashes.delete(actor);
    this.steam = this.steam.filter(steam => steam.end >= now);
    if (elapsed > 0 || this.time === null) for (const steam of this.steam) if (steam.next <= now) {
      const event = steam.event, particles = (await this.group(steam.content)).particles;
      if (particles.q2Steam(event.origin, event.direction, event.color, event.count, event.speed, now)) steam.next += 0.1;
    }
    this.beams = this.beams.filter(beam => beam.die >= now);
    this.explosions = this.explosions.filter(explosion => Math.floor((Math.round(now * 1000) - Math.round(explosion.start * 1000)) / 100) < explosion.frames - 1);
    this.lights = this.lights.filter(light => light.die >= now && light.radius - light.decay * (now - light.born) > 0);
    if (!this.eventsOnly) await this.q1Entities(presentations, now, elapsed > 0 || this.time === null);
    this.sampledLights = this.lights.map(light => ({ origin: light.origin, radius: Math.max(0, light.radius - light.decay * (now - light.born)), minimum: light.minimum, color: light.color }));
    this.sampledLights.push(...this.sourceLights.values());
    if (!this.eventsOnly) await this.q2Entities(presentations, now, elapsed > 0 || this.time === null);
    for (const [actor, effect] of this.trackerPain) {
      if (effect.until <= now) { this.trackerPain.delete(actor); continue; }
      if (!this.eventsOnly && presentations.some(entity => entity.family === "q2" && entity.actor.equals(actor) && entity.visible && !entity.viewWeapon)) continue;
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
      await group.renderer.preload([...group.statics, ...group.models, ...group.beams.flatMap(beam => [...beam.remote, ...(beam.local ?? [])])]);
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
    for (const [recipient, effects] of this.recipients) {
      if (!liveActors.has(recipient)) { effects.close(); this.recipients.delete(recipient); }
      else await effects.prepare(snapshot, presentations, characters, weaponClock);
    }
  }
  frame(camera: SceneCamera, source: SourceSceneOrder, viewer: ActorId | null = null, q1Fog?: import("../../contracts/render.ts").SceneFog & { readonly kind: "q1" }): ApplicationEffectFrame {
    if (this.closed) throw new Error("Effect world is closed");
    const time = { kind: "seconds", value: this.time ?? 0 } satisfies WorldSnapshot["frame"]["time"];
    const project = createViewProjector(camera), prepared: SceneOperation[] = [], q3Lights: DynamicLight[] = [];
    for (const group of this.groups.values()) {
      const family = group.provider.family;
      if (family !== "q3" && group.sampled.length > 0) {
        const image = this.images.get(family); if (image === undefined) throw new Error("Particles have no source texture");
        prepared.push(sequenceDrawGroup("translucent", [prepareParticleBatch(group.sampled, { camera, indexedProfile: family, paletteColor: index => this.palette(group, index) }, image, project)]));
      }
      const models = [...group.statics, ...group.models, ...group.beams.flatMap(beam => viewer?.equals(beam.actor) && beam.local !== null ? beam.local : beam.remote)];
      prepared.push(...group.renderer.prepare(models, { camera, time, target: { kind: "preview", id: "effects" }, lights: this.sampledLights }));
    }
    for (const beam of this.beams) if (beam.model === null) {
      const group = this.groups.get(beam.content); if (group === undefined) throw new Error("Beam has no source palette");
      const color = this.palette(group, beam.color);
      prepared.push(sequenceDrawGroup("translucent", [q2BeamBatch(beam.start, beam.end, beam.width, { ...color, w: 76.5 }, project, group.provider.textures.white.image,
        { blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: "less-equal", depthWrite: false,
          alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null })]));
    }
    const q1Styles = Array.from({ length: 256 }, (_, index) => { const value = this.styles.find(style => style.kind === "q1" && style.style === index); return value?.kind === "q1" ? value.value : 256; });
    const operations: SceneOperation[] = [...this.staticBrushes.flatMap(brush => brush.scene.prepareModel(brush.model, brush.transform,
      { camera, time, target: { kind: "preview", id: "effects" }, lights: this.sampledLights, q1Styles, ...(q1Fog === undefined ? {} : { q1Fog }), animationFrame: brush.frame })), ...prepared];
    const sourceLights: SurfaceDynamicLight[] = [], q3Admissions: Q3SceneAdmission[] = [];
    for (const effects of [...this.q3.values(), ...this.q3Weapons.values()]) {
      const frame = effects.frame(camera, source, viewer, q1Fog); q3Admissions.push(frame.admission); operations.push(...frame.operations); q3Lights.push(...frame.q3Lights);
      sourceLights.push(...frame.q3Lights.map(light => ({ ...light, minimum: 0 })));
    }
    for (const light of this.sampledLights) q3Lights.push({ origin: light.origin, radius: light.radius, color: light.color });
    const local = viewer === null ? undefined : this.recipients.get(viewer)?.frame(camera, source, viewer, q1Fog);
    if (local !== undefined) { q3Admissions.push(...local.q3Admissions); operations.push(...local.operations); sourceLights.push(...local.lights); q3Lights.push(...local.q3Lights); }
    const polygon = (operation: SceneOperation): boolean => operation.kind === "scene-group" && operation.order.kind === "source" && operation.order.source.entity.kind === "world";
    return { q3Admissions, operations: [...operations.filter(polygon), ...operations.filter(operation => !polygon(operation))], lights: [...this.sampledLights, ...sourceLights], q3Lights: q3Lights.slice(0, 32) };
  }
  shadowSceneLights(camera: SceneCamera, style: (index: number) => number, viewer: ActorId | null = null): readonly SceneLight[] {
    const flashlights: SceneLight[] = [...this.flashlights.values()].flatMap(light => {
      const pose = this.pose(light.actor);
      if (pose === undefined) return [];
      const local = viewer?.equals(light.actor) === true, axis = local ? camera.axis : anglesToAxis(pose.angles);
      // q2repro CL_AddPacketEntities per-pixel flashlight; scene axis[1] is left.
      const origin = local ? add3(camera.origin, scale3(axis[1], light.hand === "center" ? 0 : light.hand === "left" ? 7 : -7)) : pose.origin;
      return [{ origin, color: white, radius: 512, additive: true, profile: { kind: "q2", scale: 2,
        cone: { direction: axis[0], cosHalfAngle: Math.cos(22 * Math.PI / 180) }, shadow: { kind: "cast", resolution: 512 } } } satisfies SceneLight];
    });
    return [...(viewer === null ? [] : this.recipients.get(viewer)?.shadowSceneLights(camera, style, viewer) ?? []), ...flashlights, ...[...this.shadowLights.values()].flatMap(light => {
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
    })];
  }
  private palette(group: Group, index: number): Vec3 {
    const palette = group.provider.palette; if (palette === null) throw new Error("Indexed effects require their source palette");
    const offset = (index & 255) * 3, x = palette.colors[offset], y = palette.colors[offset + 1], z = palette.colors[offset + 2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Incomplete effect palette");
    return { x, y, z };
  }
  private async event(source: SimulationPresentationEvent): Promise<void> {
    const ownerKey = presentationOwnerKey(source.owner), revision = this.ownerRevisions.get(ownerKey) ?? 0;
    const current = (): boolean => !this.closed && !this.retiredOwners.has(ownerKey)
      && source.sequence > (this.ownerRevisions.get(ownerKey) ?? -1) && (this.ownerRevisions.get(ownerKey) ?? 0) === revision;
    if (!current()) return;
    if (source.kind === "view-reset" || source.kind === "q2-player" || source.kind === "q1-level") return;
    if (source.kind === "q3-ballistics") {
      if (source.event.kind === "rail-award") { this.reject(source, "Selected Q3 rail reward presentation has no source cgame binding"); return; }
      let effects = this.q3Weapons.get(source.content);
      if (effects === undefined) {
        effects = this.preparedQ3Weapons.get(source.content) ?? await Q3ApplicationEffects.create(this.assets, this.queries, source.content, this.isPlayer, undefined, this.readHardware);
        if (!current()) { effects.close(); return; }
        this.preparedQ3Weapons.delete(source.content);
        this.q3Weapons.set(source.content, effects);
      }
      await effects.ballistic(source.event);
      return;
    }
    if (source.kind === "q3-source") {
      if (source.event.kind === "sound") {
        const sound = source.event;
        this.sounds.push({ content: source.content, path: sound.path, origin: sound.origin, channel: sound.channel, volume: sound.volume, seconds: source.seconds,
          playback: sound.loop ? { kind: "loop", actor: sound.actor, velocity: sound.velocity } : { kind: "actor", actor: sound.actor } });
      }
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
        if (!current()) return;
        if (effect.kind === "force-wall") group.particles.q2ForceWall(effect.start, effect.end, effect.color, source.seconds);
        else if (effect.id === -1) group.particles.q2Steam(effect.origin, effect.direction, effect.color, effect.count, effect.speed, source.seconds);
        else if (this.steam.length < 32) this.steam.push({ content: source.content, event: effect, end: source.seconds + effect.milliseconds / 1000, next: source.seconds });
      } else if (event.kind === "ctf" || event.kind === "lmctf") {
        const effect = event.event;
        if (effect.kind === "grapple-cable") {
          await this.group(source.content);
      if (!current()) return;
          this.beam({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), content: source.content, actor: effect.actor, start: add3(effect.start, effect.offset), end: effect.end,
            die: source.seconds + 0.2, width: 0, color: 0, model: Q2_TRANSIENT_MODELS.cable, family: "q2" });
        }
      } else if (event.kind === "kick" || event.kind === "grapple-prediction") {
        this.reject(source, "Q2 session action reached the presentation owner");
      } else { const exhaustive: never = event; throw new Error(`Unknown Q2 composition event: ${String(exhaustive)}`); }
      return;
    }
    if (source.kind === "q2-rerelease") {
      const event = source.event;
      if (event.kind === "flashlight") {
        if (event.enabled) this.flashlights.set(event.actor, { ...event, ...(source.owner === undefined ? {} : { presentationOwner: source.owner }) }); else this.flashlights.delete(event.actor);
      } else if (event.kind === "dynamic-light") {
        if (event.visible) this.sourceLights.set(event.actor, { ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), origin: event.origin, radius: event.radius, color: event.color, minimum: 0 });
        else this.sourceLights.delete(event.actor);
      }
      return;
    }
    if (source.kind === "q3-character") {
      const pose = this.pose(source.event.actor);
      if (pose === undefined) { this.reject(source, "Q3 character event has no captured actor pose"); return; }
      let effects = this.q3.get(source.content);
      if (effects === undefined) { effects = await Q3ApplicationEffects.create(this.assets, this.queries, source.content, this.isPlayer, undefined, this.readHardware); if (!current()) { effects.close(); return; } this.q3.set(source.content, effects); }
      if (!effects.event(source.event, pose.origin)) this.reject(source, "Q3 event requires the full cgame snapshot payload");
      return;
    }
    if (source.kind === "q1") {
      const event = source.event;
      if (event.kind === "effect" && event.effect === "pickup") {
        if (event.actor !== null) this.bonusFlashes.set(event.actor, source.seconds + 0.5);
        return;
      }
      if (event.kind === "static-model") {
        if (event.path === "") return;
        const asset = await this.assets.model(source.content, event.path);
        if (!current()) return;
        if (asset.model.kind === "brush-model") {
          if (asset.brushScene === null) throw new Error(`Static brush ${event.path} has no prepared world scene`);
          this.staticBrushes.push({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), scene: asset.brushScene, model: asset.model.model, transform: { origin: { ...event.origin }, axis: anglesToAxis(event.angles) }, frame: event.frame });
          return;
        }
        const group = await this.group(source.content);
        if (!current()) return;
        group.statics.push({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), actor: null, resource: asset.resource, model: asset.model,
          transform: { origin: { ...event.origin }, axis: anglesToAxis(event.angles), scale: white }, previousOrigin: { ...event.origin },
          pose: { kind: "frame", frame: event.frame, previousFrame: event.frame, backLerp: 0 }, skin: event.skin, color: { ...white, w: 1 },
          shaderTime: { kind: "seconds", value: 0 }, flags: { kind: "q1", bits: 0 }, lightingOrigin: { ...event.origin }, shadowPlane: 0, attachments: [] });
        return;
      }
      if (event.kind !== "effect" && event.kind !== "beam" && event.kind !== "colored-explosion") return;
      const group = await this.group(source.content), particles = group.particles, seconds = source.seconds;
      if (!current()) return;
      if (event.kind === "beam") { this.beam({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), content: source.content, actor: event.actor, start: event.start, end: event.end, die: seconds + 0.2, width: 0, color: 0, model: q1BeamModels[event.style], family: "q1" }); return; }
      const sound = (path: string): void => { this.sounds.push({ content: source.content, path, origin: event.origin,
        channel: 0, volume: 1, seconds, playback: { kind: "once" } }); };
      if (event.kind === "colored-explosion") {
        particles.q1ColorExplosion(event.origin, seconds, event.colorStart, event.colorLength);
        this.light(event.origin, seconds, 350, 0.5, white, 300);
        sound("weapons/r_exp3.wav");
        return;
      }
      switch (event.effect) {
        case "blood": case "meat-spray": particles.q1Impact(event.origin, zero, 73, event.amount, seconds); break;
        case "gunshot": particles.q1Impact(event.origin, zero, 0, 20, seconds); break;
        case "spike": case "superspike": {
          particles.q1Impact(event.origin, zero, 0, event.effect === "spike" ? 10 : 20, seconds);
          if (this.random.nextInteger() % 5 !== 0) sound("weapons/tink1.wav");
          else {
            const ricochet = this.random.nextInteger() & 3;
            sound(ricochet === 1 ? "weapons/ric1.wav" : ricochet === 2 ? "weapons/ric2.wav" : "weapons/ric3.wav");
          }
          break;
        }
        case "wizard-spike": case "knight-spike":
          particles.q1Impact(event.origin, zero, event.effect === "wizard-spike" ? 20 : 226, event.effect === "wizard-spike" ? 30 : 20, seconds);
          sound(event.effect === "wizard-spike" ? "wizard/hit.wav" : "hknight/hit.wav"); break;
        case "explosion": particles.q1Explosion(event.origin, seconds, false); this.light(event.origin, seconds, 350, 0.5, white, 300); sound("weapons/r_exp3.wav"); break;
        case "tar-explosion": particles.q1Explosion(event.origin, seconds, true); sound("weapons/r_exp3.wav"); break;
        case "lava-splash": case "teleport": particles.q1Splash(event.origin, seconds, event.effect === "lava-splash"); break;
        case "muzzleflash": {
          const pose = event.actor === null ? undefined : this.pose(event.actor), direction = pose === undefined ? zero : anglesToAxis(pose.angles)[0];
          const origin = event.muzzle === undefined ? add3(add3(event.origin, { x: 0, y: 0, z: 16 }), scale3(direction, 18))
            : add3(event.muzzle.origin, scale3(anglesToAxis(event.muzzle.angles)[0], 18));
          this.light(origin, seconds, 200 + (this.random.nextInteger() & 31), 0.1, white, 0, 32, event.actor); break;
        }
      }
      return;
    }
    if (source.kind === "q2-weapon") {
      const event = source.event;
      if (event.kind !== "beam" && event.kind !== "muzzleflash") return;
      const group = await this.group(source.content);
      if (!current()) return;
      if (event.kind === "muzzleflash") {
        const pose = this.pose(event.actor); if (pose === undefined) { this.reject(source, "Q2 muzzle flash has no captured actor pose"); return; }
        const axis = anglesToAxis(pose.angles), origin = add3(add3(pose.origin, scale3(axis[0], 18)), scale3(axis[1], -16));
        if (!this.muzzle(origin, source.seconds, event.flash, event.silenced, event.actor)) this.reject(source, `Quake II player muzzle flash ${event.flash} has no source definition`);
        if (event.flash === 9 || event.flash === 10 || event.flash === 11) group.particles.q2Respawn(pose.origin, source.seconds, event.flash === 9 ? "login" : event.flash === 10 ? "logout" : "respawn");
        return;
      }
      if (event.effect === "rail" || event.effect === "rail-water") group.particles.q2Rail(event.start, event.end, source.seconds);
      else if (event.effect === "bubble-trail") group.particles.q2Bubbles(event.start, event.end, source.seconds);
      else if (event.effect === "bfg-laser" || event.effect === "bfg-zap" || event.effect === "bfg-lightning") this.beams.push({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), content: source.content, actor: event.actor, start: event.start, end: event.end,
        die: source.seconds + (event.duration > 0 ? event.duration : 0.1), width: 4, color: 0xd0 + (this.random.nextInteger() & 3),
        model: event.effect === "bfg-lightning" ? Q2_TRANSIENT_MODELS.lightning : null, family: "q2" });
      else this.reject(source, "Q2 heatbeam requires the source player-beam view and offset context");
      return;
    }
    const event = source.event;
    if (event.kind === "effect") { await this.q2Effect(source, event, current); return; }
    if (event.kind === "beam" || event.kind === "monster-beam") {
      await this.group(source.content);
      if (!current()) return;
      if (event.kind === "beam" && !event.visible) { this.beams = this.beams.filter(beam => !beam.actor?.equals(event.actor)); return; }
      this.beam({ ...(source.owner === undefined ? {} : { presentationOwner: source.owner }), content: source.content, actor: event.actor, start: event.start, end: event.end,
        die: event.kind === "beam" ? Number.POSITIVE_INFINITY : source.seconds + 0.2, width: event.kind === "beam" ? event.width : 0,
        color: event.kind === "beam" ? event.color & 255 : 0,
        model: event.kind === "monster-beam" ? Q2_TRANSIENT_MODELS.parasite : null, family: "q2" });
    } else if (event.kind === "monster-muzzleflash") await this.monsterMuzzle(source, event.origin, event.flash, current);
    else if (event.kind === "entity-event") {
      if (event.event === 1 || event.event === 6 || event.event === 7) {
        const pose = this.pose(event.actor); if (pose === undefined) { this.reject(source, "Q2 entity event has no captured actor pose"); return; }
        const group = await this.group(source.content);
      if (!current()) return;
        if (event.event === 1) group.particles.q2Respawn(pose.origin, source.seconds, "item"); else group.particles.q2Teleport(pose.origin, source.seconds);
      }
    } else if (event.kind === "dynamic-light") this.shadowLights.set(event.actor, { ...event, ...(source.owner === undefined ? {} : { presentationOwner: source.owner }) });
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
  private async monsterMuzzle(source: SimulationPresentationEvent, origin: Vec3, flash: number, current: () => boolean): Promise<void> {
    const profile = q2MonsterMuzzle(flash, this.assets.content.catalog.product(source.content).expectation.edition === "rerelease");
    if (profile === undefined) { this.reject(source, `Quake II monster muzzle flash ${flash} has no source definition`); return; }
    const group = await this.group(source.content);
    if (!current()) return;
    this.light(origin, source.seconds, profile.radius + (this.random.nextInteger() & profile.mask), profile.radius === 300 ? 0.2 : 0, profile.color, 0, 32,
      source.kind === "q2" && source.event.kind === "monster-muzzleflash" ? source.event.actor : null);
    if (profile.particles) group.particles.q2Impact(origin, zero, 0, 40, source.seconds);
    if (profile.smoke) {
      this.explosions.push({ content: source.content, origin, angles: zero, start: source.seconds - 0.1, frames: 4, baseFrame: 0,
        path: Q2_TRANSIENT_MODELS.smoke, kind: "misc", flags: 32, skin: 0, light: null });
      this.explosions.push({ content: source.content, origin, angles: zero, start: source.seconds - 0.1, frames: 2, baseFrame: 0,
        path: Q2_TRANSIENT_MODELS.flash, kind: "flash", flags: 8, skin: 0, light: null });
    }
  }
  private async q2Effect(source: SimulationPresentationEvent, event: Extract<Extract<SimulationPresentationEvent, { readonly kind: "q2" }>["event"], { readonly kind: "effect" }>, current: () => boolean): Promise<void> {
    const original = event.effect, name = original.replace(/^q2:/, "").replaceAll("_", "-"), group = await this.group(source.content), p = group.particles, time = source.seconds;
    if (!current()) return;
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
          start: time - 0.1, frames: 4, baseFrame: 0, path: Q2_TRANSIENT_MODELS.explosion, kind: "misc", flags: 8 | 32,
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
      case "berserk-slam": p.q2BerserkSlam(event.origin, event.direction, time); break;
      case "plain-explosion":
        this.explosions.push({ content: source.content, origin: event.origin, angles: { x: 0, y: this.random.nextInteger() % 360, z: 0 },
          start: time - 0.1, frames: 15, baseFrame: this.random.nextUnit() < 0.5 ? 15 : 0,
          path: Q2_TRANSIENT_MODELS.rocketExplosion, kind: "poly", flags: 8, skin: 0, light: { radius: 350, color: orange } });
        this.sounds.push({ content: source.content, path: "weapons/rocklx1a.wav", origin: event.origin, channel: 0, volume: 1, seconds: time, playback: { kind: "once" } });
        break;

      case "explosion1": case "explosion2": case "rocket-explosion": case "rocket-explosion-water": case "grenade-explosion": case "grenade-explosion-water": case "bfg-explosion": {
        const grenade = name === "explosion2" || name.startsWith("grenade"), bfg = name === "bfg-explosion";
        if (!bfg) p.q2Explosion(event.origin, time, false);
        const start = time - 0.1, frames = bfg ? 4 : grenade ? 19 : 15;
        this.explosions.push({ content: source.content, origin: event.origin, angles: { x: 0, y: this.random.nextInteger() % 360, z: 0 }, start,
          frames, baseFrame: bfg ? 0 : grenade ? 30 : this.random.nextUnit() < 0.5 ? 15 : 0,
          path: bfg ? Q2_TRANSIENT_MODELS.bfgExplosion : Q2_TRANSIENT_MODELS.rocketExplosion, kind: "poly", flags: bfg ? 8 | 32 : 8, skin: 0,
          light: { radius: 350, color: bfg ? { x: 0, y: 1, z: 0 } : orange } });
        if (!bfg) this.sounds.push({ content: source.content,
          path: name.endsWith("-water") ? "weapons/xpld_wat.wav" : grenade ? "weapons/grenlx1a.wav" : "weapons/rocklx1a.wav",
          origin: event.origin, channel: 0, volume: 1, seconds: time, playback: { kind: "once" } });
        break;
      }
      case "footstep": case "monster-footstep": case "fall": case "fall-short": case "fall-far": break;
      default: this.reject(source, `Unresolved Quake II source effect ${original}`);
    }
  }
  private async q1Entities(presentations: readonly SimulationPresentation[], seconds: number, advance: boolean): Promise<void> {
    if (!advance) return;
    const trails = new Map<ActorId, { readonly content: ContentId; readonly path: string; readonly origin: Vec3 }>();
    for (const entity of presentations) {
      if (entity.family !== "q1" || entity.viewWeapon || entity.path === "") continue;
      const group = await this.group(entity.content), model = (await this.assets.model(entity.content, entity.path)).model;
      const flags = model.kind === "q1-mdl" ? model.flags : model.kind === "md5" && model.skinSelection.kind === "q1-mdl-replacement" ? model.skinSelection.flags : 0;
      const prior = this.q1Trails.get(entity.actor), delta = prior === undefined ? zero : sub3(entity.origin, prior.origin);
      const reset = prior === undefined || prior.content !== entity.content || prior.path !== entity.path
        || Math.abs(delta.x) > 100 || Math.abs(delta.y) > 100 || Math.abs(delta.z) > 100;
      const start = reset || prior === undefined ? entity.origin : prior.origin;
      trails.set(entity.actor, { content: entity.content, path: entity.path, origin: entity.origin });
      const assign = (origin: Vec3, radius: number, color: Vec3 = white, minimum = 0, duration = 0.001): void => {
        this.light(origin, seconds, radius, duration, color, 0, minimum, entity.actor);
      };
      if (advance && (entity.effects & 1) !== 0) group.particles.q1Entity(entity.origin, seconds);
      if ((entity.effects & 2) !== 0) {
        const forward = anglesToAxis(entity.angles)[0];
        assign(add3(add3(entity.origin, { x: 0, y: 0, z: 16 }), scale3(forward, 18)), 200 + (this.random.nextInteger() & 31), white, 32, 0.1);
      }
      if ((entity.effects & 4) !== 0) assign(add3(entity.origin, { x: 0, y: 0, z: 16 }), 400 + (this.random.nextInteger() & 31));
      if ((entity.effects & 8) !== 0) assign(entity.origin, 200 + (this.random.nextInteger() & 31));
      if (this.assets.content.catalog.product(entity.content).expectation.edition === "rerelease") {
        if ((entity.effects & 16) !== 0) assign(entity.origin, 200 + (this.random.nextInteger() & 31), { x: 0.25, y: 0.25, z: 1 });
        if ((entity.effects & 32) !== 0) assign(entity.origin, 200 + (this.random.nextInteger() & 31), { x: 1, y: 0.25, z: 0.25 });
        if ((entity.effects & 64) !== 0) assign(entity.origin, 64 + (this.random.nextInteger() & 31),
          { x: 1, y: 192 / 255, z: 120 / 255 }, 0, Math.fround(seconds + 0.001) - seconds);
      }
      const trail = (flags & 4) !== 0 ? 2 : (flags & 32) !== 0 ? 4 : (flags & 16) !== 0 ? 3 : (flags & 64) !== 0 ? 5
        : (flags & 1) !== 0 ? 0 : (flags & 2) !== 0 ? 1 : (flags & 128) !== 0 ? 6 : null;
      if (trail !== null && advance) group.particles.q1Trail(start, entity.origin, trail, seconds);
      if (trail === 0) assign(entity.origin, 200, white, 0, 0.01);
    }
    this.q1Trails = trails;
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
    const asset = await this.assets.model(beam.content, beam.model), group = await this.group(beam.content);
    const rolls: number[] = [];
    const build = (start: Vec3): readonly SceneEntity[] => {
      const models: SceneEntity[] = [];
      const delta = sub3(beam.end, start), length = length3(delta), direction = normalize3OrZero(delta), horizontal = Math.hypot(delta.x, delta.y);
      const yawAngle = horizontal === 0 ? 0 : Math.atan2(delta.y, delta.x) * 180 / Math.PI;
      const pitchAngle = horizontal === 0 ? delta.z > 0 ? 90 : 270 : Math.atan2(delta.z, horizontal) * (beam.family === "q1" ? 180 : -180) / Math.PI;
      const yaw = beam.family === "q1" ? Math.trunc(yawAngle) : yawAngle < 0 ? yawAngle + 360 : yawAngle;
      const pitch = beam.family === "q1" ? Math.trunc(pitchAngle) : pitchAngle < 0 ? pitchAngle + 360 : pitchAngle;
      const lightning = beam.model === Q2_TRANSIENT_MODELS.lightning, modelLength = lightning ? 35 : 30;
      const beamLength = lightning ? length - 20 : length, shortLightning = lightning && beamLength <= modelLength;
      const steps = shortLightning ? 1 : Math.ceil(beamLength / modelLength), spacing = beam.family === "q1" ? 30 : steps > 1 ? (beamLength - modelLength) / (steps - 1) : 0;
      for (let segment = 0; segment < steps; segment++) {
        const origin = shortLightning ? beam.end : add3(start, scale3(direction, segment * spacing));
        const roll = rolls[segment] ?? this.random.nextInteger() % 360; rolls[segment] = roll;
        const angles = { x: lightning && !shortLightning ? -pitch : pitch, y: lightning && !shortLightning ? yaw + 180 : yaw, z: roll };
        models.push({ actor: null, resource: asset.resource, model: asset.model,
          transform: { origin, axis: anglesToAxis(angles), scale: white }, previousOrigin: origin,
          pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { ...white, w: 1 }, shaderTime: { kind: "seconds", value: 0 },
          flags: { kind: beam.family, bits: lightning ? 8 : 0 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] });
      }
      return models;
    };
    const remote = build(beam.start), pose = beam.family === "q1" ? this.pose(beam.actor) : undefined;
    if (beam.family === "q2") group.models.push(...remote);
    else group.beams.push({ actor: beam.actor, remote, local: pose === undefined ? null : build(pose.origin) });
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
  resetRound(): void {
    if (this.closed) throw new Error("Effect world is closed");
    for (const effects of this.recipients.values()) effects.resetRound();
    this.pending = []; this.unhandled = []; this.beams = []; this.explosions = [];
    this.staticBrushes.length = 0; this.styles = []; this.lights = []; this.sampledLights = [];
    this.entityTrails.clear(); this.q1Trails.clear(); this.shadowLights.clear(); this.sourceLights.clear(); this.flashlights.clear();
    this.playerViews.clear(); this.bonusFlashes.clear(); this.trackerPain.clear(); this.steam = []; this.sounds.length = 0;
    this.poses = []; this.time = null; this.q3WeaponTimes.clear();
    for (const group of this.groups.values()) {
      group.particles.clear(); group.models = []; group.statics.length = 0; group.beams = []; group.sampled = [];
    }
    for (const effects of new Set([...this.q3.values(), ...this.q3Weapons.values(), ...this.preparedQ3Weapons.values()])) effects.resetRound();
  }
  close(): void {
    if (this.closed) return;
    for (const effects of this.recipients.values()) effects.close();
    this.recipients.clear();
    this.closed = true; this.pending = []; this.unhandled = []; this.beams = []; this.explosions = []; this.lights = []; this.sampledLights = [];
    this.staticBrushes.length = 0; this.styles = [];
    for (const effects of [...this.q3.values(), ...this.q3Weapons.values(), ...this.preparedQ3Weapons.values()]) effects.close();
    this.preparedQ3Weapons.clear();
    for (const image of this.images.values()) this.assets.images.release(image);
    this.images.clear(); this.groups.clear(); this.preparedRenderers.clear(); this.q3.clear(); this.q3Weapons.clear(); this.q3WeaponTimes.clear(); this.entityTrails.clear(); this.q1Trails.clear();
    this.shadowLights.clear(); this.sourceLights.clear(); this.flashlights.clear(); this.playerViews.clear(); this.bonusFlashes.clear(); this.trackerPain.clear(); this.steam = []; this.sounds.length = 0;
  }
}
