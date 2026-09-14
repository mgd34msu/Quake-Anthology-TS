import type { ExecutableRecipe, ResolvedResourceReference } from '../../../../contracts/content.ts';
import type { MountedContent } from '../../../../content/mounts/index.ts';
import { resolveQvmArtifact } from '../../../../compat/qvm/artifacts.ts';
import type { QvmModuleOptions } from '../../../../compat/qvm/module.ts';

export type Q3GameExecution = Extract<ExecutableRecipe['execution'][number], { readonly kind: 'qvm'; readonly role: 'server-game' }>;
export interface PreparedQ3Game {
  readonly execution: Q3GameExecution;
  readonly artifact: QvmModuleOptions['artifact'];
  readonly resource: ResolvedResourceReference;
}

export function assertQ3GuestRecipe(recipe: ExecutableRecipe, execution: Q3GameExecution): void {
  const owner = recipe.map.entities;
  const same = (reference: typeof owner): boolean => reference.content === owner.content && reference.provider === owner.provider;
  if (execution.api.kind !== 'q3-qagame' || execution.api.version !== 8 || !same(execution.owner)
    || recipe.execution.length !== 1 || recipe.execution[0] !== execution || owner.provider !== 'q3:official'
    || recipe.map.geometryContent !== owner.content || recipe.campaign.kind !== 'none'
    || recipe.movement.provider !== 'q3:movement' || recipe.movement.content !== owner.content
    || recipe.character.definition.provider !== 'q3:character' || recipe.character.definition.content !== owner.content
    || recipe.character.appearance.content !== owner.content || !recipe.character.appearance.provider.startsWith('q3:model/')
    || recipe.weapons.length !== 1 || recipe.weapons.some(weapon => !same(weapon))
    || ![recipe.engineBehavior, recipe.combat, recipe.inventory, recipe.match, recipe.transition].every(same)
    || recipe.equipment.grapple.kind !== 'disabled' || recipe.equipment.handGrenades.kind !== 'disabled'
    || recipe.enemies.kind !== 'map-defined'
    || recipe.timing.find(timing => timing.provider === owner.provider)?.clock.kind !== 'q3') {
    throw new Error('Q3 bytecode requires one native Q3 server game, native movement and character, map-defined actors and no mixed providers or campaign');
  }
}

export async function prepareQ3Game(execution: Q3GameExecution, mounts: MountedContent): Promise<PreparedQ3Game> {
  if (execution.api.kind !== 'q3-qagame' || execution.api.version !== 8 || execution.artifact.requestedPath.toLowerCase() !== 'vm/qagame.qvm')
    throw new Error('Selected Q3 server artifact must provide the qagame version 8 ABI');
  const opened = await mounts.open(execution.artifact.requestedPath);
  if (opened === null || opened.reference.id !== execution.artifact.id || opened.reference.digest !== execution.artifact.digest)
    throw new Error('Selected Q3 qagame artifact no longer matches its mounted identity');
  const artifact = resolveQvmArtifact({ role: 'qagame', bytes: opened.bytes, module: {
    id: execution.owner.provider, artifactPath: opened.reference.requestedPath, digest: opened.reference.digest,
    revision: `${opened.reference.provenance.mount.identity.id}:${opened.reference.provenance.mount.identity.generation}`,
  } });
  if (artifact.kind !== 'bytecode') throw new Error('Selected Q3 guest artifact did not resolve to bytecode');
  return { execution, artifact, resource: opened.reference };
}
