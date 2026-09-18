import type { MountedContent } from '../mounts/index.ts';
import { normalizeResourcePath } from '../mounts/paths.ts';
import type { ProviderId } from '../../contracts/identity.ts';
import type { ResolvedResourceReference } from '../../contracts/content.ts';
import { SaveReader } from '../../persistence/value.ts';
import { resolveQvmArtifact } from '../../compat/qvm/artifacts.ts';
import type { QvmModuleOptions } from '../../compat/qvm/module.ts';
import { readQvmWeaponProfile, type QvmWeaponProfile } from '../../compat/qvm/weapon-behavior-profile.ts';

export interface MountedQvmWeaponBehavior {
  readonly artifact: QvmModuleOptions['artifact'];
  readonly resource: ResolvedResourceReference;
  readonly profile: QvmWeaponProfile;
  readonly declaration: unknown;
}
export function readQvmWeaponBehaviorDocument(bytes: Uint8Array): readonly unknown[] {
  const value: unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const reader=new SaveReader(value,'qvm-weapon-behaviors.json');reader.field('version').literal(1);
  return reader.field('profiles').list(entry=>entry.value);
}
export async function loadQvmWeaponBehavior(mounts: Pick<MountedContent,'open'>, provider: ProviderId, declaration: unknown): Promise<MountedQvmWeaponBehavior> {
  const reader=new SaveReader(declaration,'qvm-weapon-profile'),path=normalizeResourcePath(reader.field('artifactPath').string());
  const abiProfile=reader.field('abiProfile').choice('q3-modern','q3-1.16n-base');
  const opened=await mounts.open(path);
  if(opened === null) throw new Error(`Declared QVM behavior artifact is missing: ${path}`);
  const artifact=resolveQvmArtifact({role:'qagame',abiProfile,bytes:opened.bytes,module:{id:provider,artifactPath:path,digest:opened.reference.digest,revision:opened.reference.digest}});
  if(artifact.kind !== 'bytecode') throw new Error('QVM weapon behavior requires actual bytecode');
  const profile=readQvmWeaponProfile(declaration,artifact);
  return {artifact,resource:opened.reference,profile,declaration};
}
export async function discoverQvmWeaponBehaviors(mounts: Pick<MountedContent,'open'>, provider: ProviderId): Promise<readonly MountedQvmWeaponBehavior[] | null> {
  const opened=await mounts.open('qvm-weapon-behaviors.json');if(opened === null)return null;
  const result:MountedQvmWeaponBehavior[]=[],seen=new Set<string>();
  for(const declaration of readQvmWeaponBehaviorDocument(opened.bytes)) {
    const entry=await loadQvmWeaponBehavior(mounts,provider,declaration),id=entry.profile.definition.id;
    if(seen.has(id))throw new Error(`Duplicate QVM weapon behavior ${id}`);seen.add(id);result.push(entry);
  }
  return result;
}
