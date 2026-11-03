import { readQvmCompatibilityDeclaration } from '../../../../compat/qvm/compatibility.ts';
import type { ExecutableRecipe, ResolvedExecutionModule, ResolvedResourceReference } from '../../../../contracts/content.ts';
import type { ModuleIdentity } from '../../../../contracts/execution.ts';
import type { MountedContent } from '../../../../content/mounts/index.ts';
import { resolveQvmArtifact } from '../../../../compat/qvm/artifacts.ts';
import type { QvmModuleOptions } from '../../../../compat/qvm/module.ts';
import { baseQ3GuestWeapons, q3GuestWeapons, type Q3GuestWeapon } from '../../../../content/q3/guest-items.ts';
import { prepareQ3Native } from './native-guest-source.ts';
import type { PreparedQ3Native } from './native-guest-source.ts';

import { builtinQvmPrimaryProfile, readQvmPrimaryProfile, type QvmPrimaryProfile } from "../../../../compat/qvm/primary-profile.ts";
import { parseQvmItemLayout, type QvmItemLayout } from "../../../../compat/qvm/item-catalog.ts";

export type Q3GameExecution = Extract<ExecutableRecipe['execution'][number], { readonly kind: 'qvm'; readonly role: 'server-game' }>;
export type Q3NativeGameExecution = Extract<ResolvedExecutionModule, { readonly kind: 'native'; readonly role: 'server-game' }>;
interface PreparedQ3GameBase {
  /** The module every guest call and every save is attributed to. */
  readonly module: ModuleIdentity;
  readonly resource: ResolvedResourceReference;
  readonly weapons: readonly Q3GuestWeapon[];
  readonly items?: QvmItemLayout;
  readonly primary: QvmPrimaryProfile;
  /** The retail product this qagame ships with, when its bytes are known. */
  readonly product: NonNullable<QvmModuleOptions['artifact']['known']>['product'] | undefined;
}
/** A qagame bytecode artifact, run by the interpreter. */
export interface PreparedQ3Qvm extends PreparedQ3GameBase {
  readonly kind: 'qvm';
  readonly execution: Q3GameExecution;
  readonly artifact: QvmModuleOptions['artifact'];
}
/** A native qagame (Windows PE or Linux ELF), run as a guest process the way id's engine does with vm_game 0. */
export interface PreparedQ3NativeGame extends PreparedQ3GameBase {
  readonly kind: 'native';
  readonly execution: Q3NativeGameExecution;
  readonly image: PreparedQ3Native;
}
export type PreparedQ3Game = PreparedQ3Qvm | PreparedQ3NativeGame;

export function assertQ3GuestRecipe(recipe: ExecutableRecipe, execution: Q3GameExecution | Q3NativeGameExecution): void {
  const owner = recipe.map.entities;
  const same = (reference: typeof owner): boolean => reference.content === owner.content && reference.provider === owner.provider;
  if (execution.api.kind !== 'q3-qagame' || !same(execution.owner)
    || recipe.execution.length !== 1 || recipe.execution[0] !== execution
    || recipe.weapons.length !== 1
    || ![recipe.engineBehavior, recipe.combat, recipe.inventory, recipe.match, recipe.transition].every(same)
    || recipe.enemies.kind === 'players'
    || recipe.timing.find(timing => timing.provider === owner.provider)?.clock.kind !== 'q3') {
    throw new Error('Q3 bytecode requires one native Q3 server game, map-defined actors and supported source providers');
  }
}

export async function prepareQ3Game(execution: Q3GameExecution, mounts: MountedContent): Promise<PreparedQ3Qvm> {
  if (execution.api.kind !== 'q3-qagame' || execution.artifact.requestedPath.toLowerCase() !== 'vm/qagame.qvm')
    throw new Error('Selected Q3 server artifact must provide a supported qagame ABI');
  const bytes = await mounts.read(execution.artifact), reference = execution.artifact;
  const declaration = await readQvmCompatibilityDeclaration(mounts, { artifactPath: reference.requestedPath, digest: reference.digest }, 'qagame');
  const abiProfile = declaration.profile;
  if (execution.api.version !== (abiProfile === 'q3-modern' ? 8 : 7)) throw new Error('Selected QVM ABI differs from its saved or resolved recipe');
  const artifact = resolveQvmArtifact({ abiProfile, role: 'qagame', bytes, module: {
    id: execution.owner.provider, artifactPath: reference.requestedPath, digest: reference.digest,
    revision: `${reference.provenance.mount.identity.id}:${reference.provenance.mount.identity.generation}`,
  } });
  if (artifact.kind !== 'bytecode') throw new Error('Selected Q3 guest artifact did not resolve to bytecode');
  const items = declaration.primary === null ? undefined : parseQvmItemLayout(declaration.primary.field("items"));
  const weapons = await q3GuestWeapons(artifact, mounts, items, declaration.primary?.field("inventory").field("storage").value !== undefined);
  const primary = declaration.primary === null ? builtinQvmPrimaryProfile(artifact, weapons)
    : declaration.resource === null || items === undefined ? declaration.primary.fail("primary interface lost its declaration resource")
    : readQvmPrimaryProfile(declaration.primary, artifact, items.source === "live" ? null : weapons, items, declaration.resource);
  return { kind: 'qvm', execution, artifact, module: artifact.module, resource: reference, weapons, primary, product: artifact.known?.product, ...(items === undefined ? {} : { items }) };
}

/** A native qagame is a black box to the original-source bindings: no declared primary interface, so the shared providers own weapons, items and combat around it. */
export async function prepareQ3NativeGame(execution: Q3NativeGameExecution, mounts: MountedContent): Promise<PreparedQ3NativeGame> {
  const image = await prepareQ3Native(execution, mounts);
  if (image.profile === 'quake-live-elf') throw new Error('Quake Live table-interface modules expose no verified game entry points for the server game');
  return { kind: 'native', execution, image, module: image.module, resource: execution.artifact, weapons: baseQ3GuestWeapons, product: undefined,
    primary: { declaration: null, input: null, weapons: null, inventory: null, pickups: null, combat: null } };
}
