import { readQvmCompatibility } from '../../../../compat/qvm/compatibility.ts';
import type { ExecutableRecipe, ResolvedResourceReference } from '../../../../contracts/content.ts';
import type { MountedContent } from '../../../../content/mounts/index.ts';
import { resolveQvmArtifact } from '../../../../compat/qvm/artifacts.ts';
import type { QvmModuleOptions } from '../../../../compat/qvm/module.ts';
import { q3GuestWeapons, type Q3GuestWeapon } from '../../../../content/q3/guest-items.ts';

export type Q3GameExecution = Extract<ExecutableRecipe['execution'][number], { readonly kind: 'qvm'; readonly role: 'server-game' }>;
export interface PreparedQ3Game {
  readonly execution: Q3GameExecution;
  readonly artifact: QvmModuleOptions['artifact'];
  readonly resource: ResolvedResourceReference;
  readonly weapons: readonly Q3GuestWeapon[];
}

export function assertQ3GuestRecipe(recipe: ExecutableRecipe, execution: Q3GameExecution): void {
  const owner = recipe.map.entities;
  const same = (reference: typeof owner): boolean => reference.content === owner.content && reference.provider === owner.provider;
  if (execution.api.kind !== 'q3-qagame' || !same(execution.owner)
    || recipe.execution.length !== 1 || recipe.execution[0] !== execution || owner.provider !== 'q3:official'
    || recipe.campaign.kind !== 'none'
    || recipe.movement.provider !== 'q3:movement' || recipe.movement.content !== owner.content
    || recipe.character.definition.provider !== 'q3:character' || recipe.character.definition.content !== owner.content
    || recipe.character.appearance.content !== owner.content || !recipe.character.appearance.provider.startsWith('q3:model/')
    || recipe.weapons.length !== 1 || recipe.weapons.some(weapon => !same(weapon)) && execution.artifact.digest !== 'sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337'
    || ![recipe.engineBehavior, recipe.combat, recipe.inventory, recipe.match, recipe.transition].every(same)
    || recipe.enemies.kind !== 'map-defined'
    || recipe.timing.find(timing => timing.provider === owner.provider)?.clock.kind !== 'q3') {
    throw new Error('Q3 bytecode requires one native Q3 server game, native movement and character, map-defined actors and supported source providers without campaign');
  }
}

export async function prepareQ3Game(execution: Q3GameExecution, mounts: MountedContent): Promise<PreparedQ3Game> {
  if (execution.api.kind !== 'q3-qagame' || execution.artifact.requestedPath.toLowerCase() !== 'vm/qagame.qvm')
    throw new Error('Selected Q3 server artifact must provide a supported qagame ABI');
  const bytes = await mounts.read(execution.artifact), reference = execution.artifact;
  const abiProfile = await readQvmCompatibility(mounts, { artifactPath: reference.requestedPath, digest: reference.digest }, 'qagame');
  if (execution.api.version !== (abiProfile === 'q3-modern' ? 8 : 7)) throw new Error('Selected QVM ABI differs from its saved or resolved recipe');
  const artifact = resolveQvmArtifact({ abiProfile, role: 'qagame', bytes, module: {
    id: execution.owner.provider, artifactPath: reference.requestedPath, digest: reference.digest,
    revision: `${reference.provenance.mount.identity.id}:${reference.provenance.mount.identity.generation}`,
  } });
  if (artifact.kind !== 'bytecode') throw new Error('Selected Q3 guest artifact did not resolve to bytecode');
  return { execution, artifact, resource: reference, weapons: await q3GuestWeapons(artifact, mounts) };
}
