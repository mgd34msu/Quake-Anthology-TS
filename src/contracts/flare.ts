import type { Vec3 } from "./math.ts";

export interface SceneFlare {
  readonly image: string;
  readonly fadeStart: number;
  readonly fadeEnd: number;
  readonly scale: number;
  readonly color: Vec3;
  readonly rimColor: Vec3 | null;
  readonly lockAngle: boolean;
}
