/* CG_CalculateWeaponPosition, CG_MapTorsoToWeaponFrame and CG_MachinegunSpinAngle.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
import { add3, vec3 } from "../../../core/math.ts";
import { qvmAngleMod } from "../../../core/qvm-math.ts";
import { PlayerAnimation } from "../../../movement/q3/constants.ts";
import type { PlayerAnimationConfig } from "./animation-config.ts";

export interface Q3WeaponViewMotion {
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly timeMilliseconds: number;
  readonly horizontalSpeed: number;
  readonly bobCycle: number;
  readonly bobFractionSine: number;
  readonly landTime: number;
  readonly landChange: number;
}

/** Q3 weapon bob is selected with the arsenal and can follow a foreign movement result. */
export function q3WeaponViewPose(input: Q3WeaponViewMotion): { readonly origin: Vec3; readonly angles: Vec3 } {
  const f = Math.fround;
  const scale = input.bobCycle & 1 ? -input.horizontalSpeed : input.horizontalSpeed;
  const roll = f(f(scale * input.bobFractionSine) * f(0.005));
  const yaw = f(f(scale * input.bobFractionSine) * f(0.01));
  const pitch = f(f(input.horizontalSpeed * input.bobFractionSine) * f(0.005));
  let origin = { ...input.origin };
  let angles = add3(input.angles, vec3(pitch, yaw, roll));
  const delta = (input.timeMilliseconds - input.landTime) | 0;
  if (delta < 150) origin = add3(origin, vec3(0, 0, f(f(f(input.landChange * f(0.25)) * f(delta)) / 150)));
  else if (delta < 450) origin = add3(origin, vec3(0, 0, f(f(f(input.landChange * f(0.25)) * f((450 - delta) | 0)) / 300)));
  const drift = f(f(f(input.horizontalSpeed + 40) * f(Math.sin(f(f(input.timeMilliseconds) * f(0.001))))) * f(0.01));
  angles = add3(angles, vec3(drift, drift, drift));
  return { origin, angles };
}

export function q3TorsoWeaponFrame(config: PlayerAnimationConfig, frame: number): number {
  for (const index of [PlayerAnimation.TORSO_DROP, PlayerAnimation.TORSO_ATTACK, PlayerAnimation.TORSO_ATTACK2]) {
    const animation = config.animations[index];
    if (animation === undefined || animation === null) throw new Error(`Missing Q3 weapon torso animation ${index}`);
    const drop = index === PlayerAnimation.TORSO_DROP;
    if (frame >= animation.firstFrame && frame < animation.firstFrame + (drop ? 9 : 6)) return frame - animation.firstFrame + (drop ? 6 : 1);
  }
  return 0;
}

export class Q3WeaponBarrel {
  private time = 0;
  private angle = 0;
  private spinning = false;

  step(timeMilliseconds: number, firing: boolean): { readonly angle: number; readonly stopped: boolean } {
    const f = Math.fround;
    let delta = (timeMilliseconds - this.time) | 0;
    let angle: number;
    if (this.spinning) angle = f(this.angle + f(f(delta) * f(0.9)));
    else {
      if (delta > 1000) delta = 1000;
      const speed = f(f(0.5) * f(f(0.9) + f(f((1000 - delta) | 0) / 1000)));
      angle = f(this.angle + f(f(delta) * speed));
    }
    const stopped = this.spinning && !firing;
    if (this.spinning !== firing) { this.time = timeMilliseconds; this.angle = qvmAngleMod(angle); this.spinning = firing; }
    return { angle, stopped };
  }
}
