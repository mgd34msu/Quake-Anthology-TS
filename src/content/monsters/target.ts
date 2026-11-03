export interface MonsterTargetObservation {
  readonly viewHeight: number;
  readonly notarget: boolean;
  readonly invisible: boolean;
  readonly lightLevel: number | null;
  readonly hostileUntil: number | null;
  /** Rerelease invisibility: null when not cloaked, else the alpha a monster must roll under (0 once the reveal fade has ended). */
  readonly cloakAlpha?: number | null;
}

export function monsterTargetEligible(health: number, observation: MonsterTargetObservation | null): boolean {
  // FL_NOTARGET is read only when acquiring a target (FindTarget), never by a monster already chasing.
  return health > 0 && observation !== null;
}
