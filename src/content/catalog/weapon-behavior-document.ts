import { normalizeResourcePath } from "../mounts/paths.ts";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function list(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
export interface WeaponBehaviorDocument {
  readonly version: 1;
  readonly artifactPath?: string;
  readonly behaviors: readonly unknown[];
}
export function readWeaponBehaviorDocument(bytes: Uint8Array): WeaponBehaviorDocument {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!record(value) || value["version"] !== 1 || !list(value["behaviors"])) throw new Error("Invalid weapon behavior declaration");
  const artifact = value["artifactPath"];
  if (artifact !== undefined && typeof artifact !== "string") throw new Error("Invalid weapon behavior artifact path");
  return { version: 1, ...(artifact === undefined ? {} : { artifactPath: normalizeResourcePath(artifact) }), behaviors: value["behaviors"] };
}
export function weaponBehaviorEntryId(entry: unknown): string {
  if (!record(entry) || typeof entry["id"] !== "string") throw new Error("Invalid weapon behavior entry");
  return entry["id"];
}
