import type { SaveImage } from "../../contracts/session.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../persistence/value.ts";
import { saveProviderContract, validateSaveProviderOwner } from "../../persistence/provider-ownership.ts";

const schema = "app:component-clients";
export function readComponentClients(image: SaveImage): unknown | null {
  const rows = image.providers.filter(row => row.schema === schema);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error("Duplicate component client checkpoint");
  validateSaveProviderOwner(row, image.recipe.map.entities.provider);
  const value = decodeCheckpointValue(row.bytes);
  new SaveReader(value, schema).field("version").literal(1);
  return value;
}
export function saveComponentClients(image: SaveImage, value: unknown): SaveImage {
  if (image.providers.some(row => row.schema === schema)) throw new Error("Component client checkpoint is already attached");
  return { ...image, providers: [...image.providers, { ...saveProviderContract(schema, image.recipe.map.entities.provider), bytes: encodeCheckpointValue(value) }] };
}

export function requireComponentClientPresentation(image: SaveImage): void {
  const value = readComponentClients(image);
  if (value !== null && new SaveReader(value, schema).field("seats").list(row => row.value).length !== 0)
    throw new Error("Saved component viewing clients require a graphical destination");
}
