import type { ActorId, OwnedActor, ProviderId } from './identity.ts';
import type { SavedActorId } from './session.ts';
import type { BodyState } from './world.ts';
import type { GuestCallbackReference, ModuleIdentity, NativeCallAbi } from './execution.ts';
import type { ItemId } from './gameplay.ts';

export type ProjectileRole = 'rocket' | 'grenade' | 'nail' | 'bolt' | 'plasma' | 'energy' | 'grapple';
export type WeaponBehaviorCallback = Extract<GuestCallbackReference, { readonly kind: 'quakec' | 'qvm' }>
  | { readonly kind: 'native-artifact'; readonly module: ModuleIdentity; readonly imageOffset: bigint; readonly abi: NativeCallAbi };
/** Artifact-pinned entrypoints are published by the source provider, not guessed from package names. */
export interface WeaponBehaviorDefinition {
  readonly id: `${string}:${string}`;
  readonly title: string;
  readonly module: ModuleIdentity;
  readonly role: ProjectileRole;
  readonly aspect: 'trajectory';
  readonly activate: WeaponBehaviorCallback | null;
  readonly fire: WeaponBehaviorCallback;
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
  const sameCallback = (a: WeaponBehaviorCallback | null, b: WeaponBehaviorCallback | null): boolean => {
    if (a === null || b === null) return a === b;
    if (!sameModule(a.module, b.module)) return false;
    switch (a.kind) {
      case 'quakec': return b.kind === 'quakec' && a.functionIndex === b.functionIndex;
      case 'qvm': return b.kind === 'qvm' && a.instructionIndex === b.instructionIndex;
      case 'native-artifact': return b.kind === 'native-artifact' && a.imageOffset === b.imageOffset
        && a.abi.kind === b.abi.kind && a.abi.call === b.abi.call && a.abi.image === b.abi.image && a.abi.pointerBytes === b.abi.pointerBytes;
    }
  };
  return left.id === right.id && left.role === right.role && left.aspect === right.aspect && sameModule(left.module, right.module)
    && sameCallback(left.fire, right.fire) && sameCallback(left.activate, right.activate);
}

export interface WeaponBehaviorProjectilePort {
  controlsTrajectory(projectile: ActorId): boolean;
  launch(input: WeaponBehaviorLaunch): WeaponTrajectoryUpdate | null;
  step(projectile: OwnedActor, body: BodyState, timeSeconds: number): WeaponTrajectoryUpdate | null;
}

/** Author-declared private layout, valid only for the selected exact QVM artifact. */
export interface QvmWeaponBehaviorLayout {
  readonly entityStride: number;
  readonly levelTime: number;
  readonly allocate: number;
  readonly free: number;
  readonly fields: { readonly inuse: number; readonly nextthink: number; readonly think: number; readonly health: number };
  readonly fireAbi: 'entity-pointer-start-direction';
}
export function sameQvmWeaponLayout(left: QvmWeaponBehaviorLayout, right: QvmWeaponBehaviorLayout): boolean {
  return left.entityStride === right.entityStride && left.levelTime === right.levelTime && left.allocate === right.allocate && left.free === right.free
    && left.fields.inuse === right.fields.inuse && left.fields.nextthink === right.fields.nextthink && left.fields.think === right.fields.think
    && left.fields.health === right.fields.health && left.fireAbi === right.fireAbi;
}
