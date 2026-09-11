import type { ContentId } from "../../contracts/content.ts";
import type { SceneEntity } from "../../contracts/scene.ts";
import { qvmAnglesToAxis } from "../../core/qvm-math.ts";
import { GameRandom } from "../../core/game-numeric.ts";
import { createLerpFrame, runLerpFrame } from "../../content/q3/foundation/animation.ts";
import { parsePlayerAnimationConfig } from "../../content/q3/foundation/animation-config.ts";
import type { PlayerAnimationConfig } from "../../content/q3/foundation/animation-config.ts";
import { Q3WeaponBarrel, q3TorsoWeaponFrame, q3WeaponViewPose } from "../../content/q3/foundation/weapon-pose.ts";
import { RF_DEPTHHACK, RF_FIRST_PERSON, RF_MINLIGHT } from "../../content/q3/presentation/ref-entity.ts";
import { attachSceneEntity, modelAttachmentTag } from "../../render/scene/models/transform.ts";
import type { ApplicationAssets, ModelAsset } from "./assets.ts";
import type { SimulationPresentation } from "./simulation/types.ts";

const zero = { x: 0, y: 0, z: 0 };
const unit = { x: 1, y: 1, z: 1 };

/** CG_AddViewWeapon uses the hand model as a tag anchor, then draws gun, barrel and flash. */
export class SelectedQ3WeaponPresenter {
  private readonly torso = createLerpFrame();
  private readonly barrel = new Q3WeaponBarrel();
  private readonly random = new GameRandom();
  private readonly animations = new Map<ContentId, Promise<PlayerAnimationConfig>>();
  private readonly models = new Map<string, Promise<ModelAsset | null>>();

  constructor(private readonly assets: ApplicationAssets, private readonly characterAnimation: PlayerAnimationConfig | null) {}

  private animation(content: ContentId): Promise<PlayerAnimationConfig> {
    if (this.characterAnimation !== null) return Promise.resolve(this.characterAnimation);
    const existing = this.animations.get(content); if (existing !== undefined) return existing;
    const pending = (async () => {
      const provider = await this.assets.provider(content), path = "models/players/sarge/animation.cfg", resource = await provider.mounts.open(path);
      if (resource === null) throw new Error("Selected Q3 weapon animation configuration is missing");
      return parsePlayerAnimationConfig(new TextDecoder().decode(resource.bytes), path);
    })();
    this.animations.set(content, pending); return pending;
  }

  private model(content: ContentId, path: string): Promise<ModelAsset | null> {
    const key = `${content}/${path}`, existing = this.models.get(key); if (existing !== undefined) return existing;
    const pending = (async () => (await (await this.assets.provider(content)).mounts.open(path)) === null ? null : this.assets.model(content, path))();
    this.models.set(key, pending); return pending;
  }

  async frame(source: SimulationPresentation): Promise<SceneEntity> {
    const view = source.q3Weapon; if (view === undefined) throw new Error("Selected Q3 weapon presentation state is missing");
    const stem = source.path.replace(/\.[^.]+$/, "");
    const [gunAsset, ownHand, barrelAsset, flashAsset, animation] = await Promise.all([
      this.assets.model(source.content, source.path), this.model(source.content, `${stem}_hand.md3`),
      this.model(source.content, `${stem}_barrel.md3`), this.model(source.content, `${stem}_flash.md3`), this.animation(source.content),
    ]);
    const handAsset = ownHand ?? await this.assets.model(source.content, "models/weapons2/shotgun/shotgun_hand.md3");
    runLerpFrame(animation, this.torso, { timeMs: view.timeMilliseconds, newAnimation: view.torsoAnimation, speedScale: 1, noPlayerAnimations: false });
    const position = q3WeaponViewPose({ origin: source.origin, angles: source.angles, timeMilliseconds: view.timeMilliseconds,
      horizontalSpeed: view.horizontalSpeed, bobCycle: (view.bobCycle & 128) >> 7,
      bobFractionSine: Math.abs(Math.sin((view.bobCycle & 127) / 127 * Math.PI)), landTime: 0, landChange: 0 });
    const part = (asset: ModelAsset, origin = zero, angles = zero): SceneEntity => ({ actor: source.actor, resource: asset.resource, model: asset.model,
      transform: { origin, axis: qvmAnglesToAxis(angles), scale: unit }, previousOrigin: origin,
      pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { x: 1, y: 1, z: 1, w: 1 },
      shaderTime: { kind: "milliseconds", value: 0 }, flags: { kind: "q3", bits: RF_MINLIGHT | RF_FIRST_PERSON | RF_DEPTHHACK }, lightingOrigin: source.origin, shadowPlane: 0, attachments: [] });
    const hand: SceneEntity = { ...part(handAsset, position.origin, position.angles), pose: { kind: "frame",
      frame: q3TorsoWeaponFrame(animation, this.torso.frame), previousFrame: q3TorsoWeaponFrame(animation, this.torso.oldFrame), backLerp: this.torso.backLerp } };
    const tag = modelAttachmentTag(hand, "tag_weapon"); if (tag === null) throw new Error("Selected Q3 hands model has no tag_weapon");
    const attachments: SceneEntity["attachments"][number][] = [];
    const spin = this.barrel.step(view.timeMilliseconds, view.firing);
    if (barrelAsset !== null) attachments.push({ tag: "tag_barrel", entity: part(barrelAsset, zero, { x: 0, y: 0, z: spin.angle }) });
    const continuous = view.firing && (view.weapon === 1 || view.weapon === 6 || view.weapon === 10);
    if (flashAsset !== null && (continuous || view.lastFireMilliseconds !== null && view.timeMilliseconds - view.lastFireMilliseconds <= 20))
      attachments.push({ tag: "tag_flash", entity: part(flashAsset, zero, { x: 0, y: 0, z: Math.fround(this.random.crandom() * 10) }) });
    return attachSceneEntity(hand, { ...part(gunAsset), attachments }, tag);
  }
}
