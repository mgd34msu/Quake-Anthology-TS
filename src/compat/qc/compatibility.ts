import { SaveReader } from '../../persistence/value.ts';
import type { RereleaseMessages } from '../../network/q1/profile.ts';

/** Explicit private protocol opt-in bound to the bytes of the selected program. */
export function readQuakeCCompatibility(bytes: Uint8Array | null, artifactDigest: string): RereleaseMessages {
  if (bytes === null) return 'known-retail';
  const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  const reader = new SaveReader(value, 'quakec-compatibility.json');
  reader.field('version').literal(1);
  reader.field('artifactDigest').literal(artifactDigest);
  return reader.field('messageDialect').choice('known-retail', 'quake-1-re-ts-private');
}
