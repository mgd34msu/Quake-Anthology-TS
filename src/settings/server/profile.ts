import { ConfigStore, settingsPath } from "../config.ts";
import type { BoundServerSetting, ServerProfile, ServerSettingCollection, ServerSettingDefinition, ServerSettingId, ServerSettingStatus } from "./types.ts";

export function collectServerSettings(collections: readonly ServerSettingCollection[]): readonly ServerSettingDefinition[] {
  const definitions = new Map<ServerSettingId, ServerSettingDefinition>();
  for (const collection of collections) for (const definition of collection.definitions) {
    if (definitions.has(definition.id)) throw new Error(`Two selected components own ${definition.id}`);
    parseServerSetting(definition, definition.defaultValue);
    definitions.set(definition.id, definition);
  }
  return [...definitions.values()];
}

/** Configuration files, console bridges and UI writes share this boundary. */
export function parseServerSetting(definition: ServerSettingDefinition, input: string): string {
  switch (definition.kind) {
    case "toggle":
      if (input === "1" || input === "true") return "1";
      if (input === "0" || input === "false") return "0";
      throw new RangeError(`${definition.label} requires a boolean`);
    case "slider": {
      const value = Number(input);
      if (input.trim() === "" || !Number.isFinite(value) || definition.integer && !Number.isSafeInteger(value)
        || value < definition.minimum || value > definition.maximum) throw new RangeError(`${definition.label} is outside its allowed range`);
      return String(value);
    }
    case "choice":
      if (!definition.choices.some(choice => choice.id === input)) throw new RangeError(`Unknown ${definition.label} choice`);
      return input;
    case "text-entry":
      if (input.length > definition.maximumLength || /[\0\r\n]/.test(input)) throw new RangeError(`${definition.label} contains invalid text`);
      return input;
  }
}
export function readServerSetting(binding: BoundServerSetting): ServerSettingStatus {
  const values = binding.owner.read(binding.definition.target);
  return { ...values, pending: values.desired !== values.effective, applyAt: binding.definition.applyAt };
}
export function writeServerSetting(binding: BoundServerSetting, value: string): ServerSettingStatus {
  binding.owner.write(binding.definition.target, parseServerSetting(binding.definition, value), binding.definition.applyAt);
  return readServerSetting(binding);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected a server profile object");
  return value;
}
export function parseServerProfile(value: unknown, definitions: readonly ServerSettingDefinition[]): ServerProfile {
  const input = record(value), overrides = input["overrides"];
  if (input["version"] !== 1 || !Array.isArray(overrides)) throw new Error("Unsupported server profile");
  const seen = new Set<ServerSettingId>();
  return { version: 1, overrides: overrides.map((entry: unknown) => {
    const saved = record(entry), definition = definitions.find(candidate => candidate.id === saved["id"]), value = saved["value"];
    if (definition === undefined || typeof value !== "string") throw new Error("Server profile setting has no selected owner");
    if (seen.has(definition.id)) throw new Error(`Duplicate server profile setting ${definition.id}`);
    seen.add(definition.id);
    return { id: definition.id, value: parseServerSetting(definition, value) };
  }) };
}
export function captureServerProfile(bindings: readonly BoundServerSetting[]): ServerProfile {
  return parseServerProfile({ version: 1, overrides: bindings.map(binding => ({ id: binding.definition.id, value: binding.owner.read(binding.definition.target).desired })) }, bindings.map(binding => binding.definition));
}
export function applyServerProfile(profile: ServerProfile, bindings: readonly BoundServerSetting[]): void {
  const validated = parseServerProfile(profile, bindings.map(binding => binding.definition));
  // Resolve the complete write list before any source mutation.
  const writes = validated.overrides.map(override => {
    const binding = bindings.find(candidate => candidate.definition.id === override.id);
    if (binding === undefined) throw new Error(`No server owner for ${override.id}`);
    return { binding, value: override.value };
  });
  for (const { binding, value } of writes) writeServerSetting(binding, value);
}
export async function saveServerProfile(store: ConfigStore, name: string, profile: ServerProfile, definitions: readonly ServerSettingDefinition[]): Promise<void> {
  await store.dump(name, `${JSON.stringify(parseServerProfile(profile, definitions), null, 2)}\n`);
}
export async function loadServerProfile(store: ConfigStore, name: string, definitions: readonly ServerSettingDefinition[]): Promise<ServerProfile | null> {
  const file = Bun.file(settingsPath(store.root, name));
  if (!await file.exists()) return null;
  const value: unknown = JSON.parse(await file.text());
  return parseServerProfile(value, definitions);
}
