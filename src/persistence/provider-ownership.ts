import type { ProviderId } from "../contracts/identity.ts";
import type { ProviderCheckpoint } from "../contracts/session.ts";

export const CAMPAIGN_UNIT_CHECKPOINT = { provider: "session:campaign-unit", schema: "session:campaign-unit", version: 1 } satisfies Omit<ProviderCheckpoint, "bytes">;

/** Host-owned schemas have fixed owners; every other supported schema belongs to the selected source. */
export function saveProviderContract(schema: ProviderCheckpoint["schema"], source: ProviderId): Omit<ProviderCheckpoint, "bytes"> {
  switch (schema) {
    case "world:source-slots": return { provider: "world:actors", schema, version: 1 };
    case "world:source-items": case "world:primary-protection": return { provider: "world:gameplay", schema, version: 1 };
    case "session:campaign-unit": return CAMPAIGN_UNIT_CHECKPOINT;
    default:
      if (schema.startsWith("session:")) throw new Error(`Unsupported session checkpoint ${schema}`);
      return { provider: source, schema, version: schema === "world:simulation" ? 11 : 1 };
  }
}

export function validateSaveProviderOwner(record: ProviderCheckpoint, source: ProviderId): void {
  const expected = saveProviderContract(record.schema, source);
  if (record.provider !== expected.provider) throw new Error(`Saved provider ${record.schema} has a different owner`);
  if (record.version !== expected.version) throw new Error(`Unsupported saved provider version ${record.schema}`);
}
