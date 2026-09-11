export interface MonsterTargetObservation {
  readonly viewHeight: number;
  readonly notarget: boolean;
  readonly invisible: boolean;
  readonly lightLevel: number | null;
  readonly hostileUntil: number | null;
}
