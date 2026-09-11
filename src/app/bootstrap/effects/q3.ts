/* Source cgame effect producers joined to shared assets, collision and drawing. */
import type { ContentId } from "../../../contracts/content.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { SceneEntity, SceneQueries } from "../../../contracts/scene.ts";
import type { RenderOperation, SceneCamera } from "../../../contracts/render.ts";
import { SoundBank } from "../../../audio/bank.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { CompiledMaterial } from "../../../materials/compile.ts";
import { prepareMaterialBatches } from "../../../materials/evaluate.ts";
import type { DynamicLight } from "../../../materials/q3-lighting.ts";
import { GameRandom } from "../../../core/game-numeric.ts";
import { length3, sub3 } from "../../../core/math.ts";
import { ClientEffects } from "../../../content/q3/presentation/effects.ts";
import type { EffectMedia } from "../../../content/q3/presentation/effects.ts";
import { LocalEntityPool, LocalEntitySystem } from "../../../content/q3/presentation/local-entities.ts";
import type { LocalEntityMedia } from "../../../content/q3/presentation/local-entities.ts";
import { ImpactMarkSystem } from "../../../content/q3/presentation/marks.ts";
import { worldMarkProjector } from "../../../content/q3/presentation/mark-projector.ts";
import { copyRefEntity } from "../../../content/q3/presentation/ref-entity.ts";
import type { RefEntity, RefPoly, SceneModel, SceneShader } from "../../../content/q3/presentation/ref-entity.ts";
import { PlayerStateRecord } from "../../../content/q3/base/shared/player-state.ts";
import type { Product } from "../../../content/q3/base/shared/definitions.ts";
import type { Q3CharacterEvent } from "../../../content/q3/foundation/character.ts";
import { EntityEvent } from "../../../movement/q3/constants.ts";
import { SceneModelRenderer } from "../../../render/scene/models/renderer.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { polyGeometry, spriteGeometry } from "../../../render/scene/particles/primitives.ts";
import type { ApplicationAssets } from "../assets.ts";

export interface SourceEffectSound { readonly content: ContentId; readonly path: string; readonly origin: Vec3; readonly channel: number; readonly volume: number; readonly seconds: number; }
const numeric: NumericProfile = { id: "q3:effect", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32" };
interface CapturedRef { readonly ref: RefEntity; readonly cullRadius: number; }

export class Q3ApplicationEffects {
  private refs: CapturedRef[] = [];
  private polys: readonly RefPoly[] = [];
  private lights: DynamicLight[] = [];
  private readonly models: SceneEntity[] = [];
  private readonly options = new Map<SceneEntity, ModelSourceOptions>();
  private constructor(readonly content: ContentId, readonly assets: ApplicationAssets,
    readonly state: { time: number; readonly product: Product }, readonly effects: ClientEffects,
    readonly system: LocalEntitySystem, readonly marks: ImpactMarkSystem, readonly shaders: ReadonlyMap<string, CompiledMaterial>,
    readonly renderer: SceneModelRenderer, readonly sounds: SourceEffectSound[]) {}

  static async create(assets: ApplicationAssets, queries: SceneQueries, content: ContentId): Promise<Q3ApplicationEffects> {
    const provider = await assets.provider(content), product: Product = assets.content.catalog.product(content).expectation.campaign === "missionpack" ? "missionpack" : "baseq3";
    const bank = new SoundBank(provider.mounts), sounds: SourceEffectSound[] = [], names = new Map<PcmSound, string>(), shaders = new Map<string, CompiledMaterial>();
    const sound = async (path: string): Promise<PcmSound | null> => { const loaded = await bank.register(path, "q3"); if (loaded === null) return null; names.set(loaded.pcm, path); return loaded.pcm; };
    const shader = async (name: string): Promise<SceneShader> => { shaders.set(name, await provider.shaders.register(name)); return { name }; };
    const model = async (path: string): Promise<SceneModel> => { const loaded = await assets.model(content, path); return { kind: "model", path, model: loaded.model, resource: loaded.resource }; };
    const state = { time: 0, product, snap: null, predictedPlayerState: new PlayerStateRecord<number, number, number>(product, 0, 0, 0) };
    const sourceSound = (pcm: PcmSound | null, origin: Vec3, channel: number, volume: number): void => {
      if (pcm === null) return;
      const path = names.get(pcm); if (path === undefined) throw new Error("Q3 local sound lacks source registration");
      sounds.push({ content, path, origin, channel, volume, seconds: state.time / 1000 });
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
    const effects = new ClientEffects(state, pool, media, { noProjectileTrail: false, blood: true, gibs: true, scorePlum: true, hardware: "generic" },
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
    return new Q3ApplicationEffects(content, assets, state, effects, system, marks, shaders, new SceneModelRenderer(provider, assets.world), sounds);
  }
  event(event: Q3CharacterEvent, origin: Vec3): boolean {
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
  async prepare(seconds: number, elapsed: number): Promise<void> {
    this.state.time = Math.trunc(seconds * 1000); this.refs = []; this.lights = []; this.models.length = 0; this.options.clear();
    // Camera-near puff removal belongs to each seat; it must not retire another seat's effect.
    const far = this.assets.world.bounds.max;
    this.system.addEntities({ time: this.state.time, frameTime: Math.trunc(elapsed * 1000), viewOrigin: { x: far.x + 65536, y: far.y + 65536, z: far.z + 65536 } }, {
      addRefEntity: ref => { const owner = this.effects.pool.activeEntities().find(local => local.refEntity === ref); this.refs.push({ ref: copyRefEntity(ref), cullRadius: owner?.radius ?? 0 }); },
      addLight: light => { this.lights.push(light); },
    });
    this.polys = this.marks.addMarks();
    for (const captured of this.refs) {
      const ref = captured.ref; if (ref.kind !== "model" || ref.model.kind !== "model") continue;
      const entity: SceneEntity = { actor: null, resource: ref.model.resource, model: ref.model.model,
        transform: { origin: ref.origin, axis: ref.axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: ref.oldOrigin,
        pose: { kind: "frame", frame: ref.frame, previousFrame: ref.oldFrame, backLerp: ref.backLerp }, skin: ref.skinNum,
        color: { x: ref.shaderRGBA.x / 255, y: ref.shaderRGBA.y / 255, z: ref.shaderRGBA.z / 255, w: ref.shaderRGBA.w / 255 },
        shaderTime: { kind: "seconds", value: ref.shaderTime }, flags: { kind: "q3", bits: ref.renderFlags }, lightingOrigin: ref.lightingOrigin, shadowPlane: ref.shadowPlane, attachments: [] };
      this.models.push(entity); this.options.set(entity, { customShader: ref.customShader?.name ?? null });
    }
    await this.renderer.preload(this.models, entity => this.options.get(entity) ?? {});
  }
  frame(camera: SceneCamera): { readonly operations: readonly RenderOperation[]; readonly q3Lights: readonly DynamicLight[] } {
    const input = { camera, time: { kind: "milliseconds", value: this.state.time }, target: { kind: "preview", id: "effects" } } satisfies Parameters<ApplicationAssets["world"]["materialContext"]>[0];
    const context = this.assets.world.materialContext(input), batches = [...this.renderer.prepare(this.models, input, entity => this.options.get(entity) ?? {})];
    for (const captured of this.refs) {
      const ref = captured.ref; if (ref.kind !== "sprite" || ref.customShader === null || length3(sub3(ref.origin, camera.origin)) < captured.cullRadius) continue;
      const shader = this.shaders.get(ref.customShader.name); if (shader === undefined) throw new Error(`Unregistered effect shader ${ref.customShader.name}`);
      const geometry = spriteGeometry(ref, camera.axis, camera.clip.kind === "portal" && camera.clip.mirror);
      batches.push(...prepareMaterialBatches(shader, geometry, { ...context, entityRGBA: ref.shaderRGBA, shaderTexCoord: ref.shaderTexCoord, timeOffset: ref.shaderTime }));
    }
    for (const poly of this.polys) {
      if (poly.shader === null) continue;
      const shader = this.shaders.get(poly.shader.name); if (shader === undefined) throw new Error(`Unregistered mark shader ${poly.shader.name}`);
      batches.push(...prepareMaterialBatches(shader, polyGeometry(poly), context));
    }
    return { operations: [{ kind: "draw", batches }], q3Lights: this.lights };
  }
  drainSounds(): readonly SourceEffectSound[] { return this.sounds.splice(0); }
  close(): void { this.effects.pool.initialize(); this.marks.reset(); this.refs = []; this.models.length = 0; this.sounds.length = 0; }
}
