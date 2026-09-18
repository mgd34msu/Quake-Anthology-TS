import { isDeepStrictEqual } from "node:util";
import type { ModuleIdentity } from "../../../contracts/execution.ts";
import type { ProviderCheckpoint } from "../../../contracts/session.ts";
import type { RereleaseSourceSave } from "../../../compat/q2/rerelease/host.ts";
import type { RereleaseDeferredDamageSave, RereleaseSavedActor } from "../../../compat/q2/rerelease/deferred-damage.ts";
import { readModule } from "../../../persistence/execution.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readVector } from "../../../persistence/shared.ts";
import { readQ2AttackCheckpoint } from "../../../persistence/q2-foundation.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../persistence/value.ts";

export interface Q2RereleaseNativeIdentity { readonly module: ModuleIdentity; readonly map: string }
export interface Q2RereleaseLevelState {
  readonly configstrings: readonly { readonly index: number; readonly value: string }[];
  readonly portals: readonly { readonly portal: number; readonly open: boolean }[];
}
export interface Q2RereleaseVisitedLevel extends Q2RereleaseLevelState {
  readonly version: 1; readonly map: string; readonly level: RereleaseSourceSave;
}
export interface Q2RereleaseNativeSave extends Q2RereleaseNativeIdentity {
  readonly api: { readonly kind: "q2-rerelease-game"; readonly version: 2023 };
  readonly abi: "windows-x86-64";
  readonly autosave: boolean;
  readonly server: Q2RereleaseLevelState & { readonly cvars: Uint8Array };
  readonly game: RereleaseSourceSave;
  readonly level: RereleaseSourceSave;
  readonly visitedLevels: readonly Q2RereleaseVisitedLevel[];
}
function boundedInteger(reader: SaveReader, maximum: number): number {
  const value = reader.integer(0); if (value > maximum) throw new Error("Native API 2023 value exceeds its public range"); return value;
}
function readReference(reader: SaveReader): RereleaseSavedActor {
  const kind = reader.field("kind").choice("native", "shared");
  return kind === "shared" ? { kind, actor: readSavedActor(reader.field("actor")) }
    : { kind, slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) };
}
function readDamage(reader: SaveReader): RereleaseDeferredDamageSave {
  const request = reader.field("request");
  return { target: readReference(reader.field("target")), attack: readQ2AttackCheckpoint(reader.field("attack")),
    references: reader.field("references").list(value => ({ actor: readSavedActor(value.field("actor")), reference: readReference(value.field("reference")) })),
    request: { amount: request.field("amount").finite(), knockback: request.field("knockback").finite(), direction: readVector(request.field("direction")),
      point: readVector(request.field("point")), normal: readVector(request.field("normal")), delivery: request.field("delivery").choice("direct", "radius") },
    blood: reader.field("blood").finite(), knockback: reader.field("knockback").finite(), point: readVector(reader.field("point")),
    mod: reader.field("mod").list(value => boundedInteger(value, 255)), attackerSlot: reader.field("attackerSlot").integer(0), inflictorSlot: reader.field("inflictorSlot").integer(0) };
}
export function readRereleaseSourceSave(reader: SaveReader): RereleaseSourceSave {
  const source = { native: reader.field("native").bytes(), deferredDamage: reader.field("deferredDamage").list(readDamage),
    projections: reader.field("projections").list(value => ({ slot: value.field("slot").integer(0), actor: readSavedActor(value.field("actor")) })) };
  if (source.native.length === 0 || source.native.includes(0)) throw new Error("Native API 2023 save requires unterminated JSON bytes");
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.native));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Native API 2023 save must contain a JSON object");
  if (new Set(source.projections.map(value => value.slot)).size !== source.projections.length
    || new Set(source.projections.map(value => `${value.actor.slot}:${value.actor.generation}`)).size !== source.projections.length)
    throw new Error("Duplicate native API 2023 projection");
  for (const damage of source.deferredDamage) if (damage.mod.length !== 3)
    throw new Error("Invalid native API 2023 deferred damage");
  return source;
}
function readLevel(reader: SaveReader): Q2RereleaseLevelState {
  const state = {
    configstrings: reader.field("configstrings").list(value => ({ index: boundedInteger(value.field("index"), 12447), value: value.field("value").string() })),
    portals: reader.field("portals").list(value => ({ portal: value.field("portal").integer(0), open: value.field("open").boolean() })),
  };
  if (new Set(state.configstrings.map(value => value.index)).size !== state.configstrings.length
    || new Set(state.portals.map(value => value.portal)).size !== state.portals.length) throw new Error("Duplicate native API 2023 level metadata");
  return state;
}
function mapPath(reader: SaveReader): string {
  const path = reader.string();
  if (!path.startsWith("maps/") || !path.endsWith(".bsp") || path.length <= 9 || /[\x00-\x1f\x7f\\:]/.test(path)
    || path.split("/").some(part => part === "" || part === "." || part === "..")) throw new Error("Invalid native API 2023 map path");
  return path;
}
export function decodeQ2RereleaseNativeSave(record: ProviderCheckpoint, expected: Q2RereleaseNativeIdentity): Q2RereleaseNativeSave {
  if (record.provider !== expected.module.id || record.schema !== "q2:rerelease-native-original" || record.version !== 1)
    throw new Error("Unsupported rerelease native source save provider");
  const reader = new SaveReader(decodeCheckpointValue(record.bytes), "q2.rerelease-native-original"), api = reader.field("api");
  api.field("kind").literal("q2-rerelease-game"); api.field("version").literal(2023); reader.field("abi").literal("windows-x86-64");
  const module = readModule(reader.field("module")), map = mapPath(reader.field("map"));
  if (!isDeepStrictEqual(module, expected.module) || map !== expected.map) throw new Error("Rerelease native save differs from the selected module, ABI or map");
  const state = reader.field("server"), cvars = state.field("cvars").bytes();
  decodeCheckpointValue(cvars);
  const visitedLevels = reader.field("visitedLevels").list(value => {
    value.field("version").literal(1);
    return { version: 1, ...readLevel(value), map: mapPath(value.field("map")), level: readRereleaseSourceSave(value.field("level")) } satisfies Q2RereleaseVisitedLevel;
  });
  if (new Set(visitedLevels.map(value => value.map)).size !== visitedLevels.length || visitedLevels.some(value => value.map === map))
    throw new Error("Duplicate native API 2023 visited map");
  const game = readRereleaseSourceSave(reader.field("game"));
  if (game.deferredDamage.length !== 0 || game.projections.length !== 0) throw new Error("Native game save cannot own level projections");
  return { module, map, api: { kind: "q2-rerelease-game", version: 2023 }, abi: "windows-x86-64", autosave: reader.field("autosave").boolean(),
    server: { ...readLevel(state), cvars }, game, level: readRereleaseSourceSave(reader.field("level")), visitedLevels };
}
export function encodeQ2RereleaseNativeSave(save: Q2RereleaseNativeSave): ProviderCheckpoint {
  const record: ProviderCheckpoint = { provider: save.module.id, schema: "q2:rerelease-native-original", version: 1, bytes: encodeCheckpointValue(save) };
  decodeQ2RereleaseNativeSave(record, save);
  return record;
}
