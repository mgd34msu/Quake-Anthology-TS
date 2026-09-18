import type { MountedContent } from '../mounts/index.ts';
import type { ProviderId } from '../../contracts/identity.ts';
import type { ResolvedResourceReference } from '../../contracts/content.ts';
import type { ModuleIdentity } from '../../contracts/execution.ts';
import type { NativeWeaponBehaviorDeclaration } from '../../contracts/native-weapon-behavior.ts';
import type { WeaponBehaviorDefinition } from '../../contracts/weapon-behavior.ts';
import { SaveReader } from '../../persistence/value.ts';
import { parsePe } from '../../guest/pe/index.ts';
import { readNativeWeaponDeclaration, validateNativeWeaponImage } from '../../compat/q2/rerelease/native-weapon-declaration.ts';
import { builtInRereleaseWeaponDeclaration, rereleaseWeaponDefinition } from '../../compat/q2/rerelease/weapon-behavior-profile.ts';

export interface MountedNativeWeaponBehavior {
  readonly resource: ResolvedResourceReference;
  readonly definition: WeaponBehaviorDefinition;
  readonly declaration: NativeWeaponBehaviorDeclaration;
}
export function readNativeWeaponBehaviorDocument(bytes: Uint8Array): readonly unknown[] {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const reader = new SaveReader(value, 'native-weapon-behaviors.json');
  reader.field('version').literal(1);
  return reader.field('profiles').list(entry => entry.value);
}
export async function loadNativeWeaponBehavior(mounts: Pick<MountedContent, 'open'>, provider: ProviderId, value: unknown): Promise<MountedNativeWeaponBehavior> {
  const declaration = readNativeWeaponDeclaration(value), opened = await mounts.open(declaration.artifactPath);
  if (opened === null) throw new Error(`Declared native behavior artifact is missing: ${declaration.artifactPath}`);
  const module: ModuleIdentity = { id: provider, artifactPath: opened.reference.requestedPath, digest: opened.reference.digest, revision: opened.reference.digest };
  readNativeWeaponDeclaration(declaration, module);
  validateNativeWeaponImage(declaration, parsePe(opened.bytes));
  const definition = rereleaseWeaponDefinition(module, declaration);
  if (definition === null) throw new Error('Declared native behavior has no executable definition');
  return { resource: opened.reference, definition, declaration };
}
export async function discoverNativeWeaponBehaviors(mounts: Pick<MountedContent, 'open'>, provider: ProviderId): Promise<readonly MountedNativeWeaponBehavior[] | null> {
  const document = await mounts.open('native-weapon-behaviors.json');
  if (document === null) {
    const opened = await mounts.open('game_x64.dll');
    if (opened === null) return null;
    const module: ModuleIdentity = { id: provider, artifactPath: opened.reference.requestedPath, digest: opened.reference.digest, revision: opened.reference.digest };
    const declaration = builtInRereleaseWeaponDeclaration(module);
    return declaration === null ? null : [await loadNativeWeaponBehavior(mounts, provider, declaration)];
  }
  const result: MountedNativeWeaponBehavior[] = [], seen = new Set<string>();
  for (const declaration of readNativeWeaponBehaviorDocument(document.bytes)) {
    const entry = await loadNativeWeaponBehavior(mounts, provider, declaration);
    if (seen.has(entry.definition.id)) throw new Error(`Duplicate native weapon behavior ${entry.definition.id}`);
    seen.add(entry.definition.id); result.push(entry);
  }
  return result;
}
