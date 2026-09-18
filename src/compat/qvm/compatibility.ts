import type { QvmAbiProfile, ModuleIdentity } from '../../contracts/execution.ts';
import type { MountedContent } from '../../content/mounts/index.ts';
import { normalizeResourcePath } from '../../content/mounts/paths.ts';
import { SaveReader } from '../../persistence/value.ts';
import type { QvmRole } from './syscalls.ts';

/** Explicit declarations bind an SDK ABI to immutable module bytes, never to a mod name. */
export async function readQvmCompatibility(mounts: Pick<MountedContent, 'open'>, module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>,
  role: QvmRole): Promise<QvmAbiProfile> {
  const opened = await mounts.open('qvm-compatibility.json');
  if (opened === null) return 'q3-modern';
  const value: unknown = JSON.parse(new TextDecoder().decode(opened.bytes));
  return parseQvmCompatibility(value, module, role);
}

export function parseQvmCompatibility(value: unknown, module: Pick<ModuleIdentity, 'artifactPath' | 'digest'>, role: QvmRole): QvmAbiProfile {
  const reader = new SaveReader(value, 'qvm-compatibility.json'); reader.field('version').literal(1);
  const seen = new Set<string>();
  let selected: QvmAbiProfile = 'q3-modern';
  for (const entry of reader.field('modules').list(item => item)) {
    const selectedRole = entry.field('role').choice('qagame', 'cgame', 'ui');
    const path = normalizeResourcePath(entry.field('artifactPath').string());
    const key = `${selectedRole}/${path.toLowerCase()}`;
    if (seen.has(key)) throw entry.fail('duplicate module compatibility declaration');
    seen.add(key);
    const digest = entry.field('artifactDigest').string();
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw entry.fail('expected exact sha256 artifact digest');
    const profile = entry.field('profile').choice('q3-modern', 'q3-1.16n-base');
    if (profile !== 'q3-modern' && selectedRole !== 'qagame') throw entry.fail('legacy client and UI ABI support is not implemented');
    if (selectedRole !== role || path.toLowerCase() !== module.artifactPath.toLowerCase()) continue;
    if (digest !== module.digest) throw entry.fail('compatibility declaration belongs to different artifact bytes');
    selected = profile;
  }
  return selected;
}
