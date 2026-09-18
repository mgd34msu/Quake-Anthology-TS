import type { ActorId, OwnedActor, ProviderId } from './identity.ts';
import type { SavedActorId } from './session.ts';
import type { BodyState } from './world.ts';
import type { GuestCallbackReference, ModuleIdentity } from './execution.ts';
import type { ItemId } from './gameplay.ts';

export type ProjectileRole = 'rocket' | 'grenade' | 'nail' | 'bolt' | 'plasma' | 'energy' | 'grapple';
/** Artifact-pinned entrypoints are published by the source provider, not guessed from package names. */
export interface WeaponBehaviorDefinition {
  readonly id: `${string}:${string}`;
  readonly title: string;
  readonly module: ModuleIdentity;
  readonly role: ProjectileRole;
  readonly aspect: 'trajectory';
  readonly activate: GuestCallbackReference | null;
  readonly fire: GuestCallbackReference;
}
export interface WeaponBehaviorLaunch {
  readonly projectile: OwnedActor;
  readonly shooter: ActorId;
  readonly weapon: ItemId;
  readonly role: ProjectileRole;
  readonly timeSeconds: number;
  readonly body: BodyState;
}
export interface WeaponTrajectoryUpdate {
  readonly origin: BodyState['origin'];
  readonly velocity: BodyState['velocity'];
  readonly angles: BodyState['angles'];
}
/** The source keeps its private fields and nextthink; the selected launcher keeps presentation and impact. */
export interface WeaponBehaviorInstance {
  readonly initial: WeaponTrajectoryUpdate;
  readonly definition: WeaponBehaviorDefinition;
  step(body: BodyState, timeSeconds: number): WeaponTrajectoryUpdate | null;
  close(): void;
}
export interface WeaponBehaviorSource {
  readonly definition: WeaponBehaviorDefinition;
  attach(launch: WeaponBehaviorLaunch): WeaponBehaviorInstance | null;
  resume(projectile: ActorId): WeaponBehaviorInstance;
}
export type WeaponBehaviorCompatibility =
  | { readonly kind: 'supported'; readonly definition: WeaponBehaviorDefinition }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface WeaponBehaviorAttachmentCheckpoint {
  readonly version: 1;
  readonly attachments: readonly { readonly projectile: SavedActorId; readonly owner: ProviderId; readonly definition: WeaponBehaviorDefinition }[];
}
export function sameWeaponBehavior(left: WeaponBehaviorDefinition, right: WeaponBehaviorDefinition): boolean {
  const sameModule = (a: ModuleIdentity, b: ModuleIdentity): boolean => a.id === b.id && a.digest === b.digest && a.artifactPath === b.artifactPath && a.revision === b.revision;
  const sameCallback = (a: GuestCallbackReference | null, b: GuestCallbackReference | null): boolean => {
    if (a === null || b === null) return a === b;
    return a.kind === 'quakec' && b.kind === 'quakec' && sameModule(a.module, b.module) && a.functionIndex === b.functionIndex;
  };
  return left.id === right.id && left.role === right.role && left.aspect === right.aspect && sameModule(left.module, right.module)
    && sameCallback(left.fire, right.fire) && sameCallback(left.activate, right.activate);
}

export interface WeaponBehaviorProjectilePort {
  controlsTrajectory(projectile: ActorId): boolean;
  launch(input: WeaponBehaviorLaunch): WeaponTrajectoryUpdate | null;
  step(projectile: OwnedActor, body: BodyState, timeSeconds: number): WeaponTrajectoryUpdate | null;
}
