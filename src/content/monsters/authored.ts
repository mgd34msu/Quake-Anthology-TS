import type { Vec3 } from "../../contracts/math.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";

/** Live map-script fields; source entity records can supply these fields directly. */
export interface AuthoredTarget {
  readonly actor: OwnedActor;
  readonly classname: string;
  targetname: string;
  target: string;
  killtarget: string;
  message: string;
  delay: number;
}

export interface AuthoredMonster extends AuthoredTarget {
  readonly sourceOrdinal: number;
  readonly spawnflags: number;
  deathTarget: string;
  readonly dropItem: string;
  route: string;
  routeGoal: ActorId | null;
  routeResolved: boolean;
  countedDeath: boolean;
  combatTarget: string;
  combatGoal: ActorId | null;
  standGround: boolean;
  placement: { readonly kind: "ready" } | { readonly kind: "waiting"; readonly barriers: readonly { readonly actor: ActorId; readonly origin: Vec3 }[]; activator: ActorId | null };
  activation: { readonly kind: "active" } | { readonly kind: "dormant" } | { readonly kind: "scheduled"; readonly at: number; readonly activator: ActorId | null };
}

export interface MonsterMission {
  readonly ambush: boolean;
  spawned(): undefined;
  started(): undefined;
  killed(attacker: ActorId | null): undefined;
  route(): ActorId | null;
  use(activator: ActorId | null): boolean;
  combatRoute(): { readonly goal: ActorId | null; readonly standGround: boolean };
  foundTarget(): undefined;
}
