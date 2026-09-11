/* Source cgame effect producers joined to shared assets, collision and drawing. */
import type { ContentId } from "../../../contracts/content.ts";
import type { Axis, Vec3 } from "../../../contracts/math.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { SceneEntity, SceneQueries } from "../../../contracts/scene.ts";
import type { RenderOperation, SceneCamera } from "../../../contracts/render.ts";
import { SoundBank } from "../../../audio/bank.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { CompiledMaterial } from "../../../materials/compile.ts";
import { prepareMaterialBatches } from "../../../materials/evaluate.ts";
import type { DynamicLight } from "../../../materials/q3-lighting.ts";
import { GameRandom } from "../../../core/game-numeric.ts";
import { cross3, length3, normalize3OrZero, perpendicularVector, sub3, vec3 } from "../../../core/math.ts";
import { ClientEffects } from "../../../content/q3/presentation/effects.ts";
import type { EffectMedia } from "../../../content/q3/presentation/effects.ts";
import { LocalEntityPool, LocalEntitySystem } from "../../../content/q3/presentation/local-entities.ts";
import type { LocalEntityMedia } from "../../../content/q3/presentation/local-entities.ts";
import { ImpactMarkSystem } from "../../../content/q3/presentation/marks.ts";
import { worldMarkProjector } from "../../../content/q3/presentation/mark-projector.ts";
import { copyRefEntity, createModelEntity, createSpriteEntity, createLightningEntity, DEFAULT_MODEL, RF_NOSHADOW } from "../../../content/q3/presentation/ref-entity.ts";
import type { RefEntity, RefPoly, SceneModel, SceneShader } from "../../../content/q3/presentation/ref-entity.ts";
import { PlayerStateRecord } from "../../../content/q3/base/shared/player-state.ts";
import type { Product } from "../../../content/q3/base/shared/definitions.ts";
import { Weapon } from "../../../content/q3/base/shared/definitions.ts";
import { evaluateTrajectory, evaluateTrajectoryDelta, TrajectoryType } from "../../../content/q3/base/shared/trajectory.ts";
import { ClientWeaponMediaRegistry, emitWeaponImpact, emitRailTrail, emitPlasmaTrail, ImpactSound } from "../../../content/q3/presentation/weapons.ts";
import type { Q3CharacterEvent } from "../../../content/q3/foundation/character.ts";
import { EntityEvent } from "../../../movement/q3/constants.ts";
import { SceneModelRenderer } from "../../../render/scene/models/renderer.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { polyGeometry, spriteGeometry, railGeometry } from "../../../render/scene/particles/primitives.ts";
import { ParticleSystem, loadParticleAnimations } from "../../../render/scene/particles/q3-system.ts";
import { qvmRotatePointAroundVector } from "../../../core/qvm-math.ts";
import type { Q3SharedBallisticEvent } from "../simulation/q3-ballistics.ts";
import type { ApplicationAssets } from "../assets.ts";

export interface SourceEffectSound {
  readonly content: ContentId; readonly path: string; readonly origin: Vec3; readonly channel: number; readonly volume: number; readonly seconds: number;
  readonly playback: { readonly kind: "once" } | { readonly kind: "loop"; readonly actor: ActorId; readonly velocity: Vec3 };
}
type ImpactHost = Parameters<typeof emitWeaponImpact>[2];
interface WeaponEffects {
  readonly registry: ClientWeaponMediaRegistry;
  readonly host: ImpactHost;
  readonly particles: ParticleSystem;
  readonly view: { viewAxis: Axis };
  readonly plasma: SceneShader;
  readonly smoke: SceneShader;
  readonly nailSmoke: SceneShader | null;
  readonly bounce: readonly [PcmSound | null, PcmSound | null];
  sound(pcm: PcmSound | null, origin: Vec3, channel: number, volume: number): void;
  loop(pcm: PcmSound | null, actor: ActorId, origin: Vec3, velocity: Vec3): void;
  contents(point: Vec3): number;
}
const numeric: NumericProfile = { id: "q3:effect", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32" };
interface CapturedRef { readonly ref: RefEntity; readonly cullRadius: number; readonly hiddenFor?: ActorId; }

export class Q3ApplicationEffects {
  private refs: CapturedRef[] = [];
  private polys: readonly RefPoly[] = [];
  private lights: DynamicLight[] = [];
  private readonly models: SceneEntity[] = [];
  private readonly options = new Map<SceneEntity, ModelSourceOptions>();
  private readonly hiddenModels = new Map<SceneEntity, ActorId>();
  private readonly bloodOwners = new WeakMap<RefEntity, ActorId>();
  private weaponEffects: Promise<WeaponEffects> | null = null;
  private readyWeapons: WeaponEffects | null = null;
  private readonly projectiles = new Map<ActorId, { readonly event: Extract<Q3SharedBallisticEvent, { readonly kind: "projectile" }>; readonly time: number }>();
  private readonly flashes = new Map<ActorId, { readonly event: Q3SharedBallisticEvent; readonly time: number }>();
  private readonly lastFires = new Map<ActorId, { readonly weapon: number; readonly time: number }>();
  private readonly bolts = new Map<ActorId, { readonly event: Q3SharedBallisticEvent; readonly time: number }>();
  private constructor(readonly content: ContentId, readonly assets: ApplicationAssets,
    readonly state: { time: number; readonly product: Product }, readonly effects: ClientEffects,
    readonly system: LocalEntitySystem, readonly marks: ImpactMarkSystem, readonly shaders: ReadonlyMap<string, CompiledMaterial>,
    readonly renderer: SceneModelRenderer, readonly sounds: SourceEffectSound[], readonly loadWeapons: () => Promise<WeaponEffects>) {}

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
      sounds.push({ content, path, origin, channel, volume, seconds: state.time / 1000, playback: { kind: "once" } });
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
    const loadWeapons = async (): Promise<WeaponEffects> => {
      const registry = new ClientWeaponMediaRegistry(product, {
        registerModel: async path => path === null || await provider.mounts.open(path) === null ? DEFAULT_MODEL : model(path),
        registerShader: shader,
      }, { registerSound: sound });
      await registry.registerWeapon(Weapon.WP_MACHINEGUN);
      const view: { viewAxis: Axis } = { viewAxis: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)] };
      const particles = new ParticleSystem({ get time() { return state.time; }, refdef: view, snap: null }, {
        animations: await loadParticleAnimations({ registerShader: shader }),
        media: { tracerShader: await shader("gfx/misc/tracer"), smokePuffShader: await shader("smokePuff"), waterBubbleShader: common.waterBubbleShader },
        prediction: shared.prediction, random, hardwareType: "generic", configString: () => "", print: message => { throw new Error(message); },
      });
      const missionSound = (path: string) => product === "missionpack" ? sound(path) : Promise.resolve(null);
      const host: ImpactHost = {
        media: {
          models: { dishFlash: await model("models/weaphits/boom01.md3"), ringFlash: await model("models/weaphits/ring02.md3"), bulletFlash: await model("models/weaphits/bullet.md3") },
          shaders: { holeMark: await shader("gfx/damage/hole_lg_mrk"), burnMark: await shader("gfx/damage/burn_med_mrk"), energyMark: await shader("gfx/damage/plasma_mrk"), bulletMark: await shader("gfx/damage/bullet_mrk") },
          sounds: {
            rocketExplosion: await sound("sound/weapons/rocket/rocklx1a.wav"), plasmaExplosion: await sound("sound/weapons/plasma/plasmx1a.wav"),
            ricochet1: await sound("sound/weapons/machinegun/ric1.wav"), ricochet2: await sound("sound/weapons/machinegun/ric2.wav"), ricochet3: await sound("sound/weapons/machinegun/ric3.wav"),
            nailHit: await missionSound("sound/weapons/nailgun/wnalimpd.wav"), nailHitFlesh: await missionSound("sound/weapons/nailgun/wnalimpl.wav"), nailHitMetal: await missionSound("sound/weapons/nailgun/wnalimpm.wav"),
            chaingunHit: await missionSound("sound/weapons/vulcan/wvulimpd.wav"), chaingunHitFlesh: await missionSound("sound/weapons/vulcan/wvulimpl.wav"), chaingunHitMetal: await missionSound("sound/weapons/vulcan/wvulimpm.wav"), proxExplosion: await missionSound("sound/weapons/proxmine/wstbexpl.wav"),
          },
        }, random, effects, marks, particles, settings: () => ({ oldRocket: false }),
        clientInfo: () => ({ color1: vec3(1, 1, 1), color2: vec3(1, 1, 1) }),
        startSound: (origin, _entity, channel, pcm) => { if (origin !== null) sourceSound(pcm, origin, channel, 1); },
      };
      return { registry, host, particles, view, plasma: await shader("sprites/plasma1"), smoke: await shader("smokePuff"), nailSmoke: product === "missionpack" ? await shader("nailtrail") : null,
        bounce: [await sound("sound/weapons/grenade/hgrenb1a.wav"), await sound("sound/weapons/grenade/hgrenb2a.wav")],
        sound: sourceSound, contents: shared.collision.pointContents,
        loop: (pcm, actor, origin, velocity) => {
          if (pcm === null) return;
          const path = names.get(pcm); if (path === undefined) throw new Error("Q3 loop sound lacks source registration");
          sounds.push({ content, path, origin, channel: 0, volume: 1, seconds: state.time / 1000, playback: { kind: "loop", actor, velocity } });
        } };
    };
    return new Q3ApplicationEffects(content, assets, state, effects, system, marks, shaders, new SceneModelRenderer(provider, assets.world), sounds, loadWeapons);
  }
  async ballistic(event: Q3SharedBallisticEvent): Promise<void> {
    this.state.time = event.timeMilliseconds;
    if (event.kind === "remove") { this.projectiles.delete(event.actor); return; }
    this.weaponEffects ??= this.loadWeapons();
    const media = await this.weaponEffects; this.readyWeapons = media;
    await media.registry.registerWeapon(event.weapon);
    const weapon = media.registry.weapon(event.weapon), time = this.state.time;
    switch (event.kind) {
      case "fire": {
        const previous = this.lastFires.get(event.actor);
        this.lastFires.set(event.actor, { weapon: event.weapon, time });
        this.flashes.set(event.actor, { event, time });
        if (event.weapon === Weapon.WP_LIGHTNING && previous?.weapon === event.weapon && time - previous.time <= 50) return;
        const available = weapon.flashSounds.filter(pcm => pcm !== null);
        if (available.length > 0) media.sound(available[media.host.random.rand() % available.length] ?? null, event.origin, 2, 1);
        return;
      }
      case "projectile": {
        const prior = this.projectiles.get(event.actor);
        this.projectiles.set(event.actor, { event, time });
        if (prior !== undefined && weapon.missileTrail === "plasma") emitPlasmaTrail(time, event.end, vec3(0, 0, 0), event.weapon, media.registry, {
          random: media.host.random, localEntities: this.effects.pool, settings: () => ({ noProjectileTrail: false, oldPlasma: false }),
          prediction: { pointContents: media.contents },
        });
        if (prior !== undefined && weapon.missileTrail !== null && weapon.missileTrail !== "plasma" && weapon.missileTrail !== "grapple") {
          const origin = evaluateTrajectory(event.trajectory, time), previous = evaluateTrajectory(event.trajectory, prior.time);
          const contents = media.contents(origin), previousContents = media.contents(previous);
          if (event.trajectory.type === TrajectoryType.TR_STATIONARY) return;
          if ((contents & (8 | 16 | 32)) !== 0) {
            if ((contents & previousContents & 32) !== 0) this.effects.bubbleTrail(previous, origin, 8);
          } else for (let tick = Math.trunc((prior.time + 50) / 50) * 50; tick <= time; tick += 50) {
            const smoke = this.effects.smokePuff({ origin: evaluateTrajectory(event.trajectory, tick), velocity: vec3(0, 0, 0),
              radius: weapon.trailRadius, color: { x: 1, y: 1, z: 1, w: 0.33 }, duration: weapon.trailTime, startTime: tick, fadeInTime: 0, flags: 0, shader: weapon.missileTrail === "nail" ? media.nailSmoke : media.smoke });
            smoke.leType = "scale-fade";
          }
        }
        return;
      }
      case "bounce": media.sound(media.bounce[media.host.random.rand() & 1] ?? null, event.end, 0, 1); return;
      case "trail":
        if (event.weapon === Weapon.WP_LIGHTNING) this.bolts.set(event.actor, { event, time });
        if (event.weapon === Weapon.WP_RAILGUN) emitRailTrail(time, media.registry, { localEntities: this.effects.pool,
          settings: () => ({ oldRail: false, railTrailTime: 400 }), clientInfo: media.host.clientInfo }, 0, { ...event.origin }, event.end);
        return;
      case "impact": {
        if ((event.surfaceFlags & 16) !== 0) return;
        if (event.hitKind === "flesh") {
          if (event.target !== null) {
            const blood = this.effects.bleedAt(event.end, false);
            if (blood !== null) this.bloodOwners.set(blood, event.target);
          }
          if (event.weapon !== Weapon.WP_ROCKET_LAUNCHER && event.weapon !== Weapon.WP_GRENADE_LAUNCHER
            && !(this.state.product === "missionpack" && [Weapon.WP_NAILGUN, Weapon.WP_CHAINGUN, Weapon.WP_PROX_LAUNCHER].includes(event.weapon))) return;
        }
        emitWeaponImpact(this.state.product, media.registry, media.host, event.weapon, 0, event.end, event.normal,
          event.hitKind === "flesh" ? ImpactSound.FLESH : (event.surfaceFlags & 4096) !== 0 ? ImpactSound.METAL : ImpactSound.DEFAULT);
        return;
      }
    }
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
  async prepare(timeMilliseconds: number, elapsedMilliseconds: number): Promise<void> {
    this.state.time = timeMilliseconds; this.refs = []; this.lights = []; this.models.length = 0; this.options.clear(); this.hiddenModels.clear();
    for (const [actor, fired] of this.lastFires) if (this.state.time - fired.time > 50) this.lastFires.delete(actor);
    const media = this.readyWeapons;
    if (media !== null) {
      for (const { event } of this.projectiles.values()) {
        const weapon = media.registry.weapon(event.weapon);
        const ref = event.weapon === Weapon.WP_PLASMAGUN ? createSpriteEntity() : createModelEntity(weapon.missileModel);
        ref.origin = event.end;
        if (ref.kind === "sprite") { ref.radius = 16; ref.customShader = media.plasma; }
        else {
          ref.oldOrigin = event.end;
          ref.renderFlags = weapon.missileRenderfx | RF_NOSHADOW;
          let direction = normalize3OrZero(event.trajectory.delta);
          if (length3(direction) === 0) direction = vec3(0, 0, 1);
          const side = qvmRotatePointAroundVector(direction, perpendicularVector(direction), event.trajectory.type === TrajectoryType.TR_STATIONARY ? 0 : Math.trunc(this.state.time / 4));
          ref.axis = [direction, side, cross3(direction, side)];
        }
        this.refs.push({ ref, cullRadius: 0 });
        if (weapon.missileDlight !== 0) this.lights.push({ origin: event.end, radius: weapon.missileDlight, color: weapon.missileDlightColor });
        media.loop(weapon.missileSound, event.actor, event.end, evaluateTrajectoryDelta(event.trajectory, this.state.time));
      }
      for (const [actor, { event, time }] of this.flashes) {
        if (this.state.time - time > 20) { this.flashes.delete(actor); continue; }
        const weapon = media.registry.weapon(event.weapon), ref = createModelEntity(weapon.flashModel);
        const direction = normalize3OrZero(sub3(event.end, event.origin)), side = perpendicularVector(direction);
        ref.origin = event.origin; ref.oldOrigin = event.origin; ref.axis = [direction, side, cross3(direction, side)];
        this.refs.push({ ref, cullRadius: 0, hiddenFor: actor });
        if (length3(weapon.flashDlightColor) > 0) this.lights.push({ origin: event.origin, radius: 300 + (media.host.random.rand() & 31), color: weapon.flashDlightColor });
      }
      for (const [actor, { event, time }] of this.bolts) {
        if (this.state.time - time > 50) { this.bolts.delete(actor); continue; }
        const ref = createLightningEntity(); ref.origin = event.origin; ref.oldOrigin = event.end; ref.customShader = media.registry.effects.lightningShader;
        this.refs.push({ ref, cullRadius: 0 });
        media.loop(media.registry.weapon(event.weapon).firingSound, actor, event.origin, vec3(0, 0, 0));
      }
    }
    // Camera-near puff removal belongs to each seat; it must not retire another seat's effect.
    const far = this.assets.world.bounds.max;
    this.system.addEntities({ time: this.state.time, frameTime: elapsedMilliseconds, viewOrigin: { x: far.x + 65536, y: far.y + 65536, z: far.z + 65536 } }, {
      addRefEntity: ref => {
        const owner = this.effects.pool.activeEntities().find(local => local.refEntity === ref), hiddenFor = this.bloodOwners.get(ref);
        this.refs.push({ ref: copyRefEntity(ref), cullRadius: owner?.radius ?? 0, ...(hiddenFor === undefined ? {} : { hiddenFor }) });
      },
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
      if (captured.hiddenFor !== undefined) this.hiddenModels.set(entity, captured.hiddenFor);
    }
    await this.renderer.preload(this.models, entity => this.options.get(entity) ?? {});
  }
  frame(camera: SceneCamera, viewer: ActorId | null = null): { readonly operations: readonly RenderOperation[]; readonly q3Lights: readonly DynamicLight[] } {
    const input = { camera, time: { kind: "milliseconds", value: this.state.time }, target: { kind: "preview", id: "effects" } } satisfies Parameters<ApplicationAssets["world"]["materialContext"]>[0];
    const visible = viewer === null ? this.models : this.models.filter(entity => !this.hiddenModels.get(entity)?.equals(viewer));
    const context = this.assets.world.materialContext(input), batches = [...this.renderer.prepare(visible, input, entity => this.options.get(entity) ?? {})];
    for (const captured of this.refs) {
      if (viewer !== null && captured.hiddenFor?.equals(viewer)) continue;
      const ref = captured.ref;
      if ((ref.kind !== "sprite" && ref.kind !== "rail-core" && ref.kind !== "rail-rings" && ref.kind !== "lightning")
        || ref.customShader === null || length3(sub3(ref.origin, camera.origin)) < captured.cullRadius) continue;
      const shader = this.shaders.get(ref.customShader.name); if (shader === undefined) throw new Error(`Unregistered effect shader ${ref.customShader.name}`);
      const geometry = ref.kind === "sprite" ? spriteGeometry(ref, camera.axis, camera.clip.kind === "portal" && camera.clip.mirror) : railGeometry(ref, camera.origin);
      batches.push(...prepareMaterialBatches(shader, geometry, { ...context, entityRGBA: ref.shaderRGBA, shaderTexCoord: ref.shaderTexCoord, timeOffset: ref.shaderTime }));
    }
    const media = this.readyWeapons;
    if (media !== null) media.view.viewAxis = camera.axis;
    for (const poly of [...this.polys, ...media?.particles.addParticles(camera.origin) ?? []]) {
      if (poly.shader === null) continue;
      const shader = this.shaders.get(poly.shader.name); if (shader === undefined) throw new Error(`Unregistered mark shader ${poly.shader.name}`);
      batches.push(...prepareMaterialBatches(shader, polyGeometry(poly), context));
    }
    return { operations: [{ kind: "draw", batches }], q3Lights: this.lights };
  }
  drainSounds(): readonly SourceEffectSound[] { return this.sounds.splice(0); }
  close(): void { this.effects.pool.initialize(); this.marks.reset(); this.refs = []; this.models.length = 0; this.sounds.length = 0; this.projectiles.clear(); this.flashes.clear(); this.lastFires.clear(); this.bolts.clear(); }
}
