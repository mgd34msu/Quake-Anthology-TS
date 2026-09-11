import type { ContentId } from "../../../contracts/content.ts";
/* CG_Player, CG_PlayerAnimation and player powerup pass selection.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Axis, Vec3, Vec4 } from "../../../contracts/math.ts";
import type { AnimationState } from "../../../contracts/movement.ts";
import type { SceneEntity } from "../../../contracts/scene.ts";
import type { SourceTime } from "../../../contracts/time.ts";
import { qvmAnglesToAxis } from "../../../core/qvm-math.ts";
import { PlayerAnimation, Powerup } from "../../../movement/q3/constants.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { attachSceneEntity, modelAttachmentTag } from "../../../render/scene/models/transform.ts";
import type { Q3CharacterAssets, Q3CharacterPart } from "./assets.ts";
import { ANIMATION_TOGGLE_BIT, clearLerpFrame, createLerpFrame, runLerpFrame } from "./animation.ts";
import type { LerpFrame } from "./animation.ts";
import { calculatePlayerPose, createPlayerPoseState } from "./player-pose.ts";

export interface Q3CharacterView {
  readonly actor: ActorId;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly velocity: Vec3;
  readonly movementDirection: number;
  readonly animation: Extract<AnimationState, { readonly kind: "q3" }>;
  readonly sourceFlags: number;
  readonly powerups: number;
  readonly team: "red" | "blue" | null;
  readonly color: Vec4;
}

export interface Q3CharacterRenderOptions {
  readonly timeMilliseconds: number;
  readonly frameMilliseconds: number;
  readonly shaderTime: SourceTime;
  readonly swingSpeed: number;
  readonly noPlayerAnimations: boolean;
  readonly personalModel: boolean;
  readonly shadowPlane: number | null;
  /** Already prepared by the independently selected arsenal, in tag_weapon coordinates. */
  readonly weapon: readonly Q3CharacterPass[];
}

export interface Q3CharacterPass {
  readonly content: ContentId | null;
  readonly entity: SceneEntity;
  readonly shader: string | null;
  options(entity: SceneEntity): ModelSourceOptions;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const UNIT: Vec3 = { x: 1, y: 1, z: 1 };

/** One instance per actor and viewing seat; presentation clocks never change simulation state. */
export class Q3CharacterPresenter {
  readonly pose = createPlayerPoseState();

  constructor(readonly assets: Q3CharacterAssets) {}

  reset(view: Q3CharacterView, timeMilliseconds: number): void {
    clearLerpFrame(this.assets.animation, this.pose.legs, view.animation.legs, timeMilliseconds);
    clearLerpFrame(this.assets.animation, this.pose.torso, view.animation.torso, timeMilliseconds);
    // CG_ResetPlayerEntity clears lerp frames after selecting the first animation.
    Object.assign(this.pose.legs, createLerpFrame(), { yawAngle: view.angles.y, yawing: false, pitchAngle: 0, pitching: false });
    Object.assign(this.pose.torso, createLerpFrame(), { yawAngle: view.angles.y, yawing: false, pitchAngle: view.angles.x, pitching: false });
  }

  frame(view: Q3CharacterView, options: Q3CharacterRenderOptions): readonly Q3CharacterPass[] {
    if (view.sourceFlags & 0x80) return [];
    const axes = calculatePlayerPose(this.pose, { entity: { eFlags: view.sourceFlags, velocity: view.velocity,
      movementDirection: view.movementDirection, legsAnim: view.animation.legs, torsoAnim: view.animation.torso },
      animationConfig: this.assets.animation, lerpAngles: view.angles, timeMs: options.timeMilliseconds,
      frameTimeMs: options.frameMilliseconds, swingSpeed: options.swingSpeed });
    const speedScale = view.powerups & (1 << Powerup.PW_HASTE) ? 1.5 : 1;
    const legsAnimation = this.pose.legs.yawing && (view.animation.legs & ~ANIMATION_TOGGLE_BIT) === PlayerAnimation.LEGS_IDLE
      ? PlayerAnimation.LEGS_TURN : view.animation.legs;
    runLerpFrame(this.assets.animation, this.pose.legs, { timeMs: options.timeMilliseconds, newAnimation: legsAnimation,
      speedScale, noPlayerAnimations: options.noPlayerAnimations });
    runLerpFrame(this.assets.animation, this.pose.torso, { timeMs: options.timeMilliseconds, newAnimation: view.animation.torso,
      speedScale, noPlayerAnimations: options.noPlayerAnimations });
    const flags = 0x80 | (options.personalModel ? 2 : 0) | (options.shadowPlane === null ? 0 : 0x40);
    const part = (asset: Q3CharacterPart, axis: Axis, origin: Vec3, frame: LerpFrame | null,
      attachments: SceneEntity["attachments"]): SceneEntity => ({ actor: view.actor, resource: asset.resource,
      model: asset.model, transform: { origin, axis, scale: UNIT }, previousOrigin: origin,
      pose: { kind: "frame", frame: frame?.frame ?? 0, previousFrame: frame?.oldFrame ?? 0, backLerp: frame?.backLerp ?? 0 },
      skin: 0, color: view.color, shaderTime: options.shaderTime, flags: { kind: "q3", bits: flags },
      lightingOrigin: view.origin, shadowPlane: options.shadowPlane ?? 0, attachments });
    const head = part(this.assets.head, axes.head, ZERO, null, []);
    const torso = part(this.assets.upper, axes.torso, ZERO, this.pose.torso, [{ tag: "tag_head", entity: head }]);
    const legs = part(this.assets.lower, axes.legs, view.origin, this.pose.legs, [{ tag: "tag_torso", entity: torso }]);
    const skinOptions = (entity: SceneEntity): ModelSourceOptions => {
      const asset = [this.assets.lower, this.assets.upper, this.assets.head].find(part => part.resource.id === entity.resource.id);
      return asset === undefined ? {} : { customSkin: asset.surfaces };
    };
    const pass = (shader: string | null): Q3CharacterPass => ({ content: null, entity: legs, shader,
      options: entity => shader === null ? skinOptions(entity) : { ...skinOptions(entity), customShader: shader } });
    const passes = view.powerups & (1 << Powerup.PW_INVIS) ? [pass("powerups/invisibility")] : [pass(null)];
    if (!(view.powerups & (1 << Powerup.PW_INVIS))) {
      if (view.powerups & (1 << Powerup.PW_QUAD)) passes.push(pass(view.team === "red" ? "powerups/blueflag" : "powerups/quad"));
      if ((view.powerups & (1 << Powerup.PW_REGEN)) && Math.trunc(options.timeMilliseconds / 100) % 10 === 1) passes.push(pass("powerups/regen"));
      if (view.powerups & (1 << Powerup.PW_BATTLESUIT)) passes.push(pass("powerups/battleSuit"));
    }
    const torsoTag = modelAttachmentTag(legs, "tag_torso");
    if (torsoTag !== null) {
      const worldTorso = attachSceneEntity(legs, torso, torsoTag);
      const weaponTag = modelAttachmentTag(worldTorso, "tag_weapon");
      if (weaponTag !== null) for (const weapon of options.weapon) {
        passes.push({ ...weapon, entity: attachSceneEntity(worldTorso, weapon.entity, weaponTag) });
      }
    }
    return passes;
  }
}

export function q3IdentityAxis(): Axis { return qvmAnglesToAxis(ZERO); }
