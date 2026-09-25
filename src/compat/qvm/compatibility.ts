import type { QvmAbiProfile, ModuleIdentity } from '../../contracts/execution.ts';
import type { ResolvedResourceReference } from '../../contracts/content.ts';
import type { MountedContent } from '../../content/mounts/index.ts';
import { normalizeResourcePath } from '../../content/mounts/paths.ts';
import { SaveReader } from '../../persistence/value.ts';
import type { QvmRole } from './syscalls.ts';

export interface QvmCompatibilityDeclaration {
  readonly profile: QvmAbiProfile;
  readonly primary: SaveReader | null;
  readonly equipmentPresentation: SaveReader | null;
}

/** Every interface in a declaration belongs to these exact module bytes. */
export async function readQvmCompatibilityDeclaration(mounts: Pick<MountedContent, 'open'>,
  module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>, role: QvmRole): Promise<QvmCompatibilityDeclaration & { readonly resource: ResolvedResourceReference | null }> {
  const opened = await mounts.open('qvm-compatibility.json');
  if (opened === null) return { profile: 'q3-modern', primary: null, equipmentPresentation: null, resource: null };
  const value: unknown = JSON.parse(new TextDecoder().decode(opened.bytes));
  return { ...parseQvmCompatibilityDeclaration(value, module, role), resource: opened.reference };
}

export async function readQvmCompatibility(mounts: Pick<MountedContent, 'open'>, module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>,
  role: QvmRole): Promise<QvmAbiProfile> {
  return (await readQvmCompatibilityDeclaration(mounts, module, role)).profile;
}

export function parseQvmCompatibility(value: unknown, module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>, role: QvmRole): QvmAbiProfile {
  return parseQvmCompatibilityDeclaration(value, module, role).profile;
}

export function parseQvmCompatibilityDeclaration(value: unknown, module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>, role: QvmRole): QvmCompatibilityDeclaration {
  const reader = new SaveReader(value, 'qvm-compatibility.json'); reader.field('version').literal(1);
  const seen = new Set<string>();
  let selected: QvmCompatibilityDeclaration = { profile: 'q3-modern', primary: null, equipmentPresentation: null };
  for (const entry of reader.field('modules').list(item => item)) {
    const selectedRole = entry.field('role').choice('qagame', 'cgame', 'ui');
    const path = normalizeResourcePath(entry.field('artifactPath').string());
    const key = `${selectedRole}/${path.toLowerCase()}`;
    if (seen.has(key)) return entry.fail('duplicate module compatibility declaration');
    seen.add(key);
    const digest = entry.field('artifactDigest').string();
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) return entry.fail('expected exact sha256 artifact digest');
    const profile = entry.field('profile').choice('q3-modern', 'q3-1.16n-base');
    const primary = entry.field('primary'), equipment = entry.field('equipmentPresentation');
    if (primary.value !== undefined && selectedRole !== 'qagame') return primary.fail('primary player interfaces belong to qagame');
    if (equipment.value !== undefined && selectedRole !== 'cgame') return equipment.fail('equipment presentation belongs to cgame');
    if (selectedRole !== role || path.toLowerCase() !== module.artifactPath.toLowerCase()) continue;
    if (digest !== module.digest) return entry.fail('compatibility declaration belongs to different artifact bytes');
    selected = { profile, primary: primary.value === undefined ? null : primary, equipmentPresentation: equipment.value === undefined ? null : equipment };
  }
  return selected;
}
