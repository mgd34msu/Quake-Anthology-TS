import type { ModCallbackDeclaration } from "../../contracts/mod-callbacks.ts";
import { readQcCombat } from "../../content/mods/callbacks.ts";
import type { QcPrimaryWeaponStageDeclaration } from "../../contracts/qc-weapon-stage.ts";
import { readQcPrimaryWeaponStage } from "../../content/q1/quakec/weapon-stage-declaration.ts";
import type { QcPickupCallerDeclaration } from "../../contracts/qc-pickup-callers.ts";
import { readQcPickupCaller } from "../../content/q1/quakec/pickup-callers.ts";
import { SaveReader } from '../../persistence/value.ts';
import type { RereleaseMessages } from '../../network/q1/profile.ts';

export interface QuakeCCompatibility {
  readonly combat?: NonNullable<ModCallbackDeclaration["combat"]>;
  readonly weaponStage?: QcPrimaryWeaponStageDeclaration;
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
  return { ...(reader.field("combat").value === undefined ? {} : { combat: readQcCombat(reader.field("combat")) }), ...(reader.field("weaponStage").value === undefined ? {} : { weaponStage: readQcPrimaryWeaponStage(reader.field("weaponStage")) }), messageDialect: reader.field('messageDialect').value === undefined ? 'known-retail' : reader.field('messageDialect').choice('known-retail', 'quake-1-re-ts-private'),
    pickupCallers: reader.field('pickupCallers').value === undefined ? [] : reader.field('pickupCallers').list(readQcPickupCaller) };
}
