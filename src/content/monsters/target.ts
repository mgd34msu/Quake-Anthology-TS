export interface MonsterTargetObservation {
  readonly viewHeight: number;
  readonly notarget: boolean;
  readonly invisible: boolean;
  readonly lightLevel: number | null;
  readonly hostileUntil: number | null;
}

export function monsterTargetEligible(health: number, observation: MonsterTargetObservation | null): boolean {
  return health > 0 && observation !== null && !observation.notarget;
}
