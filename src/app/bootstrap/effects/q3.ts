import { EventRing, type EventCursor } from "../../../foundation/event-ring.ts";
import { createViewProjector } from "../../../render/scene/view.ts";
import { admitQ3Poly, q3ProceduralFog, snapshotQ3SceneAdmission, type Q3SceneAdmission } from "../../../content/q3/presentation/scene.ts";
import { reserveSourceEntityRange, sourceDrawGroup, type SourceSceneOrder, type SceneOperation } from "../../../render/scene/submissions.ts";
/* Source cgame effect producers joined to shared assets, collision and drawing. */
import type { ContentId } from "../../../contracts/content.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { SceneEntity, SceneQueries } from "../../../contracts/scene.ts";
import type { RenderState, SceneCamera } from "../../../contracts/render.ts";
import { SoundBank } from "../../../audio/bank.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { RegisteredSceneMaterial } from "../../../render/scene/material-registrations.ts";
import { prepareMaterialBatches } from "../../../materials/evaluate.ts";
import type { DynamicLight } from "../../../materials/q3-lighting.ts";
import { GameRandom } from "../../../core/game-numeric.ts";
import { length3, sub3 } from "../../../core/math.ts";
import { ClientEffects } from "../../../content/q3/presentation/effects.ts";
import { q3EffectHardware, type Q3Hardware } from "../../../render/q3-hardware.ts";
import type { EffectMedia } from "../../../content/q3/presentation/effects.ts";
import { LocalEntityPool, LocalEntitySystem } from "../../../content/q3/presentation/local-entities.ts";
import type { LocalEntityMedia } from "../../../content/q3/presentation/local-entities.ts";
import { ImpactMarkSystem } from "../../../content/q3/presentation/marks.ts";
import { worldMarkProjector } from "../../../content/q3/presentation/mark-projector.ts";
import { copyRefEntity } from "../../../content/q3/presentation/ref-entity.ts";
import type { RefEntity, SceneModel, SceneShader } from "../../../content/q3/presentation/ref-entity.ts";
import { PlayerStateRecord } from "../../../content/q3/base/shared/player-state.ts";
import type { Product } from "../../../content/q3/base/shared/definitions.ts";
import type { Q3CharacterPresentationEvent } from "../simulation/types.ts";
import { EntityEvent } from "../../../movement/q3/constants.ts";
import { SceneModelRenderer } from "../../../render/scene/models/renderer.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { beamBatch, defaultModelBatch, polyGeometry, spriteGeometry, railGeometry } from "../../../render/scene/particles/primitives.ts";
import type { ApplicationAssets } from "../assets.ts";

export interface SourceEffectSound {
  readonly content: ContentId; readonly path: string; readonly origin: Vec3; readonly channel: number; readonly volume: number; readonly seconds: number;
  readonly playback: { readonly kind: "once" } | { readonly kind: "actor"; readonly actor: ActorId } | { readonly kind: "loop"; readonly actor: ActorId; readonly velocity: Vec3 };
}
const numeric: NumericProfile = { id: "q3:effect", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32" };
const primitiveState: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "back", depthRange: [0, 1], polygonOffset: null };
interface CapturedRef { readonly entityIndex: number; readonly ref: RefEntity; readonly cullRadius: number; readonly hiddenFor?: ActorId; }

export class Q3ApplicationEffects {
  private refs: CapturedRef[] = [];
  private admission = snapshotQ3SceneAdmission("mixed", [], []);
  private lights: DynamicLight[] = [];
  private readonly models: { readonly entityIndex: number; readonly entity: SceneEntity }[] = [];
  private readonly options = new Map<SceneEntity, ModelSourceOptions>();
  private readonly bloodOwners: WeakMap<RefEntity, ActorId>;
  private constructor(readonly content: ContentId, readonly assets: ApplicationAssets,
    readonly state: { time: number; readonly product: Product }, readonly effects: ClientEffects,
    readonly system: LocalEntitySystem, readonly marks: ImpactMarkSystem, readonly shaders: ReadonlyMap<string, RegisteredSceneMaterial>,
    readonly renderer: SceneModelRenderer, readonly sounds: EventRing<SourceEffectSound>, bloodOwners: WeakMap<RefEntity, ActorId>) { this.bloodOwners = bloodOwners; }
  private soundCursor: EventCursor | null = null;
  private takeSounds(): SourceEffectSound[] { this.soundCursor ??= this.sounds.openCursor(); const taken = this.sounds.take(this.soundCursor); this.sounds.retire(); return taken; }

  static async create(assets: ApplicationAssets, queries: SceneQueries, content: ContentId,
    preload?: "character", readHardware: () => Q3Hardware = () => "generic"): Promise<Q3ApplicationEffects> {
    const hardware = q3EffectHardware(readHardware);
    const provider = await assets.provider(content), product: Product = assets.content.catalog.product(content).expectation.campaign === "missionpack" ? "missionpack" : "baseq3";
    const renderer = new SceneModelRenderer(provider, assets.world);
    const bank = new SoundBank(provider.mounts), sounds = new EventRing<SourceEffectSound>(8192), names = new Map<PcmSound, string>(), shaders = new Map<string, RegisteredSceneMaterial>();
    const sound = async (path: string): Promise<PcmSound | null> => { const loaded = await bank.register(path, "q3"); if (loaded === null) return null; names.set(loaded.pcm, path); return loaded.pcm; };
    let preloading = preload !== undefined;
    const shader = async (name: string): Promise<SceneShader> => {
      if (preloading && provider.shaders.hasCinematic(name)) throw new Error(`Effect cinematic deferred until use: ${name}`);
      shaders.set(name, await provider.shaders.register(name)); return { name };
    };
    const model = async (path: string): Promise<SceneModel> => {
      const loaded = await assets.model(content, path);
      if (preloading) await renderer.preloadModel(loaded, {}, false);
      return { kind: "model", path, model: loaded.model, resource: loaded.resource };
    };
    const state = { time: 0, product, snap: null, predictedPlayerState: new PlayerStateRecord<number, number, number>(product, 0, 0, 0) };
    const sourceSound = (pcm: PcmSound | null, origin: Vec3, channel: number, volume: number, actor?: ActorId): void => {
      if (pcm === null) return;
      const path = names.get(pcm); if (path === undefined) throw new Error("Q3 local sound lacks source registration");
      sounds.admit({ content, path, origin, channel, volume, seconds: state.time / 1000,
        playback: actor === undefined ? { kind: "once" } : { kind: "actor", actor } });
    };
    const common = {
      waterBubbleShader: await shader("waterBubble"), smokePuffRageProShader: await shader("smokePuffRagePro"), bloodExplosionShader: await shader("bloodExplosion"),
      teleportEffectModel: await model(product === "baseq3" ? "models/misc/telep.md3" : "models/powerups/pop.md3"),
      gibSkull: await model("models/gibs/skull.md3"), gibBrain: await model("models/gibs/brain.md3"), gibAbdomen: await model("models/gibs/abdomen.md3"),
      gibArm: await model("models/gibs/arm.md3"), gibChest: await model("models/gibs/chest.md3"), gibFist: await model("models/gibs/fist.md3"),
      gibFoot: await model("models/gibs/foot.md3"), gibForearm: await model("models/gibs/forearm.md3"), gibIntestine: await model("models/gibs/intestine.md3"),
      gibLeg: await model("models/gibs/leg.md3"), smoke2: await model("models/weapons2/shells/s_shell.md3"),
    };
    let media: EffectMedia;
    if (product === "baseq3") media = { ...common, variant: { product, teleportEffectShader: await shader("teleportEffect") } };
    else media = { ...common, variant: { product, media: {
      lightningShader: await shader("lightningBolt"), kamikazeEffectModel: await model("models/weaphits/kamboom2.md3"), dishFlashModel: await model("models/weaphits/boom01.md3"),
      rocketExplosionShader: await shader("rocketExplosion"), obeliskHitSounds: [await sound("sound/items/obelisk_hit_01.wav"), await sound("sound/items/obelisk_hit_02.wav"), await sound("sound/items/obelisk_hit_03.wav")],
      invulnerabilityImpactModel: await model("models/powerups/shield/impact.md3"), invulnerabilityImpactSounds: [await sound("sound/items/invul_impact_01.wav"), await sound("sound/items/invul_impact_02.wav"), await sound("sound/items/invul_impact_03.wav")],
      invulnerabilityJuicedModel: await model("models/powerups/shield/juicer.md3"), invulnerabilityJuicedSound: await sound("sound/items/invul_juiced.wav"),
    } } };
    await shader("smokePuff");
    const pool = new LocalEntityPool(product), random = new GameRandom();
    const effects = new ClientEffects(state, pool, media, { noProjectileTrail: false, blood: true, gibs: true, scorePlum: true, get hardware() { return hardware.hardware; } },
      { randomInteger: () => random.rand(), startSound: (origin, _entity, channel, pcm) => sourceSound(pcm, origin, channel, 1) });
    const marks = new ImpactMarkSystem(worldMarkProjector(assets.world), { clock: () => state.time, enabled: () => true, energyShader: () => null });
    const localMedia: LocalEntityMedia = { bloodTrailShader: await shader("bloodTrail"), bloodMarkShader: await shader("bloodMark"), burnMarkShader: await shader("burnMark"),
      numberShaders: [await shader("gfx/2d/numbers/zero_32b"), await shader("gfx/2d/numbers/one_32b"), await shader("gfx/2d/numbers/two_32b"), await shader("gfx/2d/numbers/three_32b"), await shader("gfx/2d/numbers/four_32b"), await shader("gfx/2d/numbers/five_32b"), await shader("gfx/2d/numbers/six_32b"), await shader("gfx/2d/numbers/seven_32b"), await shader("gfx/2d/numbers/eight_32b"), await shader("gfx/2d/numbers/nine_32b"), await shader("gfx/2d/numbers/minus_32b")],
      gibBounceSounds: [await sound("sound/player/gibimp1.wav"), await sound("sound/player/gibimp2.wav"), await sound("sound/player/gibimp3.wav")] };
    const shared = { prediction: { trace: (start: Vec3, end: Vec3, bounds: { readonly min: Vec3; readonly max: Vec3 }, _skip: number, mask: number) => {
      const trace = queries.trace({ start, end, shape: { kind: "box", bounds }, target: { kind: "world" },
        policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true }, numeric, passActor: null });
      if (trace.kind !== "q3") throw new Error("Selected map did not apply Q3 trace policy");
      return { fraction: trace.fraction, end: trace.end, solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear",
        contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags, entityNum: trace.fraction < 1 ? 1022 : 1023 } satisfies ReturnType<LocalEntitySystem["host"]["prediction"]["trace"]>;
    } }, collision: { pointContents: (point: Vec3) => {
      const contents = queries.pointContents({ point, target: { kind: "world" }, policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true }, numeric, passActor: null });
      if (contents.kind !== "q3") throw new Error("Selected map did not apply Q3 content policy");
      return contents.contents;
    } }, audio: { startSound: (pcm: PcmSound | null, options: Parameters<LocalEntitySystem["host"]["audio"]["startSound"]>[1]) => {
      if (options.origin.kind !== "fixed") throw new Error("World effect sound requires a fixed origin");
      sourceSound(pcm, options.origin.position, options.channel, options.volume / 127);
    } }, clientNum: -1, random, marks };
    const system = new LocalEntitySystem(effects, product === "baseq3" ? { ...shared, product, media: localMedia } : { ...shared, product,
      media: { ...localMedia, kamikazeShockWave: await model("models/weaphits/kamwave.md3"), kamikazeExplodeSound: await sound("sound/items/kam_explode.wav"), kamikazeImplodeSound: await sound("sound/items/kam_implode.wav") } });
    const bloodOwners = new WeakMap<RefEntity, ActorId>();
    const result = new Q3ApplicationEffects(content, assets, state, effects, system, marks, shaders, renderer, sounds, bloodOwners);
    preloading = false;
    return result;
  }
  event(event: Q3CharacterPresentationEvent, origin: Vec3): boolean {
    this.state.time = event.timeMilliseconds;
    switch (event.event & ~0x300) {
      case EntityEvent.EV_PLAYER_TELEPORT_IN: case EntityEvent.EV_PLAYER_TELEPORT_OUT: this.effects.spawnEffect(origin); return true;
      case EntityEvent.EV_JUMP_PAD:
        this.effects.smokePuff({ origin, velocity: { x: 0, y: 0, z: 1 }, radius: 32, color: { x: 1, y: 1, z: 1, w: 0.33 }, duration: 1000,
          startTime: event.timeMilliseconds, fadeInTime: 0, flags: 1, shader: { name: "smokePuff" } }); return true;
      case EntityEvent.EV_GIB_PLAYER: this.effects.gibPlayer(origin); return true;
      case EntityEvent.EV_NONE: case EntityEvent.EV_FOOTSTEP: case EntityEvent.EV_FOOTSTEP_METAL: case EntityEvent.EV_FOOTSPLASH: case EntityEvent.EV_FOOTWADE: case EntityEvent.EV_SWIM:
      case EntityEvent.EV_STEP_4: case EntityEvent.EV_STEP_8: case EntityEvent.EV_STEP_12: case EntityEvent.EV_STEP_16: case EntityEvent.EV_FALL_SHORT: case EntityEvent.EV_FALL_MEDIUM: case EntityEvent.EV_FALL_FAR:
      case EntityEvent.EV_JUMP: case EntityEvent.EV_WATER_TOUCH: case EntityEvent.EV_WATER_LEAVE: case EntityEvent.EV_WATER_UNDER: case EntityEvent.EV_WATER_CLEAR:
      case EntityEvent.EV_NOAMMO: case EntityEvent.EV_CHANGE_WEAPON: case EntityEvent.EV_PAIN: case EntityEvent.EV_DEATH1: case EntityEvent.EV_DEATH2: case EntityEvent.EV_DEATH3:
      case EntityEvent.EV_OBITUARY: case EntityEvent.EV_STOPLOOPINGSOUND: case EntityEvent.EV_TAUNT: return true;
      default: return false;
    }
  }
  async prepare(timeMilliseconds: number, elapsedMilliseconds: number): Promise<void> {
    this.state.time = timeMilliseconds; this.refs = []; this.lights = []; this.models.length = 0; this.options.clear();
    // Camera-near puff removal belongs to each seat; it must not retire another seat's effect.
    const far = this.assets.world.bounds.max;
    this.system.addEntities({ time: this.state.time, frameTime: elapsedMilliseconds, viewOrigin: { x: far.x + 65536, y: far.y + 65536, z: far.z + 65536 } }, {
      addRefEntity: ref => {
        const owner = this.effects.pool.activeEntities().find(local => local.refEntity === ref), hiddenFor = this.bloodOwners.get(ref);
        this.refs.push({ entityIndex: this.refs.length, ref: copyRefEntity(ref), cullRadius: owner?.radius ?? 0, ...(hiddenFor === undefined ? {} : { hiddenFor }) });
      },
      addLight: light => { this.lights.push(light); },
    });
    this.admission = snapshotQ3SceneAdmission("mixed", this.refs.map(captured => captured.ref), this.marks.addMarks().map(poly => admitQ3Poly(poly, this.assets.world.fogSelections)));
    for (const captured of this.refs) {
      const ref = captured.ref; if (ref.kind !== "model" || ref.model.kind !== "model") continue;
      const entity: SceneEntity = { actor: null, resource: ref.model.resource, model: ref.model.model,
        transform: { origin: ref.origin, axis: ref.axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: ref.oldOrigin,
        pose: { kind: "frame", frame: ref.frame, previousFrame: ref.oldFrame, backLerp: ref.backLerp }, skin: ref.skinNum,
        color: { x: ref.shaderRGBA.x / 255, y: ref.shaderRGBA.y / 255, z: ref.shaderRGBA.z / 255, w: ref.shaderRGBA.w / 255 },
        shaderTime: { kind: "seconds", value: ref.shaderTime }, flags: { kind: "q3", bits: ref.renderFlags }, lightingOrigin: ref.lightingOrigin, shadowPlane: ref.shadowPlane, attachments: [] };
      this.models.push({ entityIndex: captured.entityIndex, entity }); this.options.set(entity, { customShader: ref.customShader?.name ?? null });
    }
    await this.renderer.preload(this.models.map(model => model.entity), entity => this.options.get(entity) ?? {});
  }
  frame(camera: SceneCamera, source: SourceSceneOrder, viewer: ActorId | null = null, q1Fog?: import("../../../contracts/render.ts").SceneFog & { readonly kind: "q1" }): { readonly admission: Q3SceneAdmission; readonly operations: readonly SceneOperation[]; readonly q3Lights: readonly DynamicLight[] } {
    const input = { ...(q1Fog === undefined ? {} : { q1Fog }), camera, time: { kind: "milliseconds", value: this.state.time }, target: { kind: "preview", id: "effects" } } satisfies Parameters<ApplicationAssets["world"]["materialContext"]>[0];
    const world = this.assets.world, operations: SceneOperation[] = [];
    const admission = this.admission;
    const firstEntity = reserveSourceEntityRange(source, admission.entities.length);
    for (const [index, poly] of admission.polygons.entries()) {
      if (poly.shader === null) continue;
      const shader = this.shaders.get(poly.shader.name);
      if (shader === undefined) throw new Error(`Unregistered mark shader ${poly.shader.name}`);
      operations.push(sourceDrawGroup(shader, { view: source, entity: { kind: "world" }, surface: index, fog: poly.fog === null ? 0 : poly.fog.index + 1, dlight: 0 },
        prepareMaterialBatches(shader, polyGeometry(poly), world.materialContext(input, undefined, poly.fog?.volume ?? null))));
    }
    const models = new Map(this.models.map(model => [model.entityIndex, model.entity]));
    const project = createViewProjector(camera), white = this.renderer.provider.textures.white.image;
    for (const captured of this.refs) {
      const ref = captured.ref;
      if (camera.clip.kind === "portal" && (ref.renderFlags & 4) !== 0) continue;
      if (viewer !== null && captured.hiddenFor?.equals(viewer)) continue;
      if (ref.kind === "portal-surface") continue;
      const entity = { kind: "refentity", index: firstEntity + captured.entityIndex } satisfies import("../../../render/scene/submissions.ts").SourceEntityOrder;
      if (ref.kind === "model") {
        if (ref.model.kind === "default") {
          if (camera.clip.kind === "none" && (ref.renderFlags & 2) !== 0) continue;
          operations.push(sourceDrawGroup(this.renderer.provider.shaders.sourceMaterials.default,
            { view: source, entity, surface: 0, fog: 0, dlight: 0 },
            [defaultModelBatch({ origin: ref.origin, axis: ref.axis, scale: { x: 1, y: 1, z: 1 } }, project, primitiveState, white)]));
          continue;
        }
        const model = models.get(captured.entityIndex);
        if (model === undefined) throw new Error("Admitted Q3 effect model lost its prepared descriptor");
        operations.push(...this.renderer.prepare([model], input, () => ({ ...this.options.get(model),
          shaderTexCoord: ref.shaderTexCoord, source: { view: source, entity } })));
        continue;
      }
      if (camera.clip.kind === "none" && (ref.renderFlags & 2) !== 0) continue;
      if (length3(sub3(ref.origin, camera.origin)) < captured.cullRadius) continue;
      const shader = ref.customShader === null ? this.renderer.provider.shaders.sourceMaterials.default : this.shaders.get(ref.customShader.name);
      if (shader === undefined) throw new Error(`Unregistered effect shader ${ref.customShader?.name}`);
      const fog = q3ProceduralFog(ref.origin, ref.radius, world.fogSelections);
      const geometry = ref.kind === "sprite" ? spriteGeometry(ref, camera.axis, camera.clip.kind === "portal" && camera.clip.mirror)
        : ref.kind === "beam" ? null : railGeometry(ref, camera.origin);
      if (geometry === null) {
        if (ref.kind !== "beam") throw new Error("Missing procedural geometry");
        operations.push(sourceDrawGroup(shader, { view: source, entity, surface: 0, fog: fog === null ? 0 : fog.index + 1, dlight: 0 },
          [beamBatch(ref, project, primitiveState, white)]));
        continue;
      }
      operations.push(sourceDrawGroup(shader, { view: source, entity, surface: 0, fog: fog === null ? 0 : fog.index + 1, dlight: 0 },
        prepareMaterialBatches(shader, geometry, { ...world.materialContext(input, undefined, fog?.volume ?? null),
          entityRGBA: ref.shaderRGBA, shaderTexCoord: ref.shaderTexCoord, timeOffset: ref.shaderTime })));
    }
    return { admission, operations, q3Lights: this.lights };
  }
  drainSounds(): readonly SourceEffectSound[] { return this.takeSounds(); }
  resetRound(): void {
    for (const entity of this.effects.pool.activeEntities()) this.bloodOwners.delete(entity.refEntity);
    this.effects.pool.initialize(); this.marks.reset();
    this.refs = []; this.admission = snapshotQ3SceneAdmission("mixed", [], []); this.lights = [];
    this.models.length = 0; this.options.clear(); this.sounds.reset();
  }
  close(): void { this.resetRound(); }
}
