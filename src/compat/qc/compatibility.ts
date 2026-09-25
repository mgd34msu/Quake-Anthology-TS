import type { QcPickupCallerDeclaration } from "../../contracts/qc-pickup-callers.ts";
import { readQcPickupCaller } from "../../content/q1/quakec/pickup-callers.ts";
import { SaveReader } from '../../persistence/value.ts';
import type { RereleaseMessages } from '../../network/q1/profile.ts';

export interface QuakeCCompatibility {
  readonly messageDialect: RereleaseMessages;
  readonly pickupCallers: readonly QcPickupCallerDeclaration[];
}

/** Original source interfaces are bound to the bytes of the selected program. */
export function readQuakeCCompatibility(bytes: Uint8Array | null, artifactDigest: string): QuakeCCompatibility {
  if (bytes === null) return { messageDialect: 'known-retail', pickupCallers: [] };
  const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  const reader = new SaveReader(value, 'quakec-compatibility.json');
  reader.field('version').literal(1);
  reader.field('artifactDigest').literal(artifactDigest);
  return { messageDialect: reader.field('messageDialect').value === undefined ? 'known-retail' : reader.field('messageDialect').choice('known-retail', 'quake-1-re-ts-private'),
    pickupCallers: reader.field('pickupCallers').value === undefined ? [] : reader.field('pickupCallers').list(readQcPickupCaller) };
}
