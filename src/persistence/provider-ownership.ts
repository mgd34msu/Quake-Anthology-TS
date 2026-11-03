// SPDX-License-Identifier: GPL-2.0-or-later
import type { ProviderId } from "../contracts/identity.ts";
import type { ProviderCheckpoint } from "../contracts/session.ts";

export const CAMPAIGN_UNIT_CHECKPOINT = { provider: "session:campaign-unit", schema: "session:campaign-unit", version: 1 } satisfies Omit<
  ProviderCheckpoint,
  "bytes"
>;

/**
 * Version 2 of the native Quake II original-save providers allows the current level to be absent. Version 1 records
 * always carried it and are migrated by their decoders, so both versions are accepted when a save is read.
 */
export const NATIVE_Q2_ORIGINAL_VERSION = 2;
/** Whether a saved record's version is the current one or one its decoder migrates. */
export function saveProviderVersionSupported(schema: ProviderCheckpoint["schema"], version: number, current: number): boolean {
  return version === current || ((schema === "q2:classic-native-original" || schema === "q2:rerelease-native-original") && version === 1);
}

/** Host-owned schemas have fixed owners; every other supported schema belongs to the selected source. */
export function saveProviderContract(schema: ProviderCheckpoint["schema"], source: ProviderId): Omit<ProviderCheckpoint, "bytes"> {
  switch (schema) {
    case "world:source-slots":
      return { provider: "world:actors", schema, version: 1 };
    case "world:source-items":
    case "world:primary-protection":
      return { provider: "world:gameplay", schema, version: 1 };
    case "session:campaign-unit":
      return CAMPAIGN_UNIT_CHECKPOINT;
    case "app:component-clients":
      return { provider: "app:component-clients", schema, version: 1 };
    case "q2:classic-native-original":
    case "q2:rerelease-native-original":
      return { provider: source, schema, version: NATIVE_Q2_ORIGINAL_VERSION };
    default:
      if (schema.startsWith("session:")) throw new Error(`Unsupported session checkpoint ${schema}`);
      return { provider: source, schema, version: schema === "world:simulation" ? 11 : 1 };
  }
}

export function validateSaveProviderOwner(record: ProviderCheckpoint, source: ProviderId): void {
  const expected = saveProviderContract(record.schema, source);
  if (record.provider !== expected.provider) throw new Error(`Saved provider ${record.schema} has a different owner`);
  if (!saveProviderVersionSupported(record.schema, record.version, expected.version)) throw new Error(`Unsupported saved provider version ${record.schema}`);
}
