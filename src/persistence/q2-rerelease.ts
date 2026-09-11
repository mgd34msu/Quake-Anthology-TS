// Quake II rerelease g_save.cpp. Dotted FIELD_AUTO names remain flat JSON keys.
import type { Vec3 } from "../contracts/math.ts";
import { parseSourceJson, SaveNumber, sourceNumber, sourceObject, writeSourceJson } from "./source-json.ts";
import type { SaveJson, SaveObject } from "./source-json.ts";
import { SaveFormatError } from "./value.ts";

export interface Q2RereleaseGameSave { readonly root: SaveObject; readonly game: SaveObject; readonly clients: readonly SaveObject[]; }
export interface Q2RereleaseLevelSave { readonly root: SaveObject; readonly level: SaveObject; readonly entities: ReadonlyMap<number, SaveObject>; }

function rootOf(text: string): SaveObject {
  const root = sourceObject(parseSourceJson(text), "q2-rerelease");
  if (sourceNumber(root["save_version"], "save_version") !== 1) throw new SaveFormatError("q2-rerelease", "unsupported game save version");
  return root;
}
export function decodeQ2RereleaseGame(text: string): Q2RereleaseGameSave {
  const root = rootOf(text); const game = sourceObject(root["game"], "game");
  const clients = root["clients"];
  if (!Array.isArray(clients)) throw new SaveFormatError("clients", "expected client array");
  return { root, game, clients: clients.map((client, index) => sourceObject(client, `clients[${index}]`)) };
}
export function encodeQ2RereleaseGame(save: Q2RereleaseGameSave): string {
  return writeSourceJson({ ...save.root, game: save.game, clients: [...save.clients] });
}
export function decodeQ2RereleaseLevel(text: string): Q2RereleaseLevelSave {
  const root = rootOf(text); const level = sourceObject(root["level"], "level"); const entities = new Map<number, SaveObject>();
  const records = sourceObject(root["entities"], "entities");
  for (const key of Object.keys(records)) {
    const slot = Number(key);
    if (!Number.isSafeInteger(slot) || slot < 0 || String(slot) !== key) throw new SaveFormatError(`entities.${key}`, "invalid source entity index");
    entities.set(slot, sourceObject(records[key], `entities.${key}`));
  }
  return { root, level, entities };
}
export function encodeQ2RereleaseLevel(save: Q2RereleaseLevelSave): string {
  const entities: SaveObject = {};
  for (const [slot, entity] of save.entities) entities[String(slot)] = entity;
  return writeSourceJson({ ...save.root, level: save.level, entities });
}

function vector(value: SaveJson | undefined, path: string): Vec3 {
  if (value === undefined) return { x: 0, y: 0, z: 0 };
  if (!Array.isArray(value) || value.length !== 3) throw new SaveFormatError(path, "expected source vec3");
  return { x: sourceNumber(value[0], path), y: sourceNumber(value[1], path), z: sourceNumber(value[2], path) };
}
function vectorValue(value: Vec3): SaveJson { return [SaveNumber.from(value.x), SaveNumber.from(value.y), SaveNumber.from(value.z)]; }
function boolean(value: SaveJson | undefined, path: string): boolean { if (value === undefined) return false; if (typeof value !== "boolean") throw new SaveFormatError(path, "expected boolean"); return value; }

export interface Q2FogSave {
  readonly color: Vec3; readonly density: number; readonly colorOff: Vec3; readonly densityOff: number; readonly skyFactor: number; readonly skyFactorOff: number;
}
export interface Q2HeightFogSave {
  readonly falloff: number; readonly density: number; readonly startColor: Vec3; readonly startDistance: number; readonly endColor: Vec3; readonly endDistance: number;
  readonly falloffOff: number; readonly densityOff: number; readonly startColorOff: Vec3; readonly startDistanceOff: number; readonly endColorOff: Vec3; readonly endDistanceOff: number;
}
export interface Q2BrushAnimationSave {
  readonly start: number; readonly end: number; readonly style: number; readonly speed: number; readonly noWrap: boolean;
  readonly alternateStart: number; readonly alternateEnd: number; readonly alternateStyle: number; readonly alternateSpeed: number; readonly alternateNoWrap: boolean;
  readonly enabled: boolean; readonly alternate: boolean; readonly currentlyAlternate: boolean; readonly nextTick: number;
}
export interface Q2PoiSave { readonly valid: boolean; readonly point: Vec3; readonly stage: number; readonly image: number; readonly dynamicEntity: number | null; }

export function readQ2Fog(record: SaveObject): Q2FogSave {
  return { color: vector(record["fog.color"], "fog.color"), density: sourceNumber(record["fog.density"], "fog.density"), colorOff: vector(record["fog.color_off"], "fog.color_off"),
    densityOff: sourceNumber(record["fog.density_off"], "fog.density_off"), skyFactor: sourceNumber(record["fog.sky_factor"], "fog.sky_factor"), skyFactorOff: sourceNumber(record["fog.sky_factor_off"], "fog.sky_factor_off") };
}
export function writeQ2Fog(record: SaveObject, fog: Q2FogSave): undefined {
  record["fog.color"] = vectorValue(fog.color); record["fog.density"] = SaveNumber.from(fog.density); record["fog.color_off"] = vectorValue(fog.colorOff);
  record["fog.density_off"] = SaveNumber.from(fog.densityOff); record["fog.sky_factor"] = SaveNumber.from(fog.skyFactor); record["fog.sky_factor_off"] = SaveNumber.from(fog.skyFactorOff); return undefined;
}
export function readQ2HeightFog(record: SaveObject): Q2HeightFogSave {
  const n = (key: string): number => sourceNumber(record[`heightfog.${key}`], `heightfog.${key}`);
  const v = (key: string): Vec3 => vector(record[`heightfog.${key}`], `heightfog.${key}`);
  return { falloff: n("falloff"), density: n("density"), startColor: v("start_color"), startDistance: n("start_dist"), endColor: v("end_color"), endDistance: n("end_dist"),
    falloffOff: n("falloff_off"), densityOff: n("density_off"), startColorOff: v("start_color_off"), startDistanceOff: n("start_dist_off"), endColorOff: v("end_color_off"), endDistanceOff: n("end_dist_off") };
}
export function writeQ2HeightFog(record: SaveObject, fog: Q2HeightFogSave): undefined {
  const numbers: readonly (readonly [string, number])[] = [["falloff", fog.falloff], ["density", fog.density], ["start_dist", fog.startDistance], ["end_dist", fog.endDistance], ["falloff_off", fog.falloffOff], ["density_off", fog.densityOff], ["start_dist_off", fog.startDistanceOff], ["end_dist_off", fog.endDistanceOff]];
  for (const [key, value] of numbers) record[`heightfog.${key}`] = SaveNumber.from(value);
  for (const [key, value] of [["start_color", fog.startColor], ["end_color", fog.endColor], ["start_color_off", fog.startColorOff], ["end_color_off", fog.endColorOff]] satisfies readonly (readonly [string, Vec3])[]) record[`heightfog.${key}`] = vectorValue(value);
  return undefined;
}
export function readQ2BrushAnimation(record: SaveObject): Q2BrushAnimationSave {
  const n = (key: string): number => sourceNumber(record[`bmodel_anim.${key}`], `bmodel_anim.${key}`);
  const b = (key: string): boolean => boolean(record[`bmodel_anim.${key}`], `bmodel_anim.${key}`);
  return { start: n("start"), end: n("end"), style: n("style"), speed: n("speed"), noWrap: b("nowrap"), alternateStart: n("alt_start"), alternateEnd: n("alt_end"), alternateStyle: n("alt_style"), alternateSpeed: n("alt_speed"), alternateNoWrap: b("alt_nowrap"), enabled: b("enabled"), alternate: b("alternate"), currentlyAlternate: b("currently_alternate"), nextTick: n("next_tick") };
}
export function writeQ2BrushAnimation(record: SaveObject, animation: Q2BrushAnimationSave): undefined {
  for (const [key, value] of [["start", animation.start], ["end", animation.end], ["style", animation.style], ["speed", animation.speed], ["alt_start", animation.alternateStart], ["alt_end", animation.alternateEnd], ["alt_style", animation.alternateStyle], ["alt_speed", animation.alternateSpeed], ["next_tick", animation.nextTick]] satisfies readonly (readonly [string, number])[]) record[`bmodel_anim.${key}`] = SaveNumber.from(value);
  for (const [key, value] of [["nowrap", animation.noWrap], ["alt_nowrap", animation.alternateNoWrap], ["enabled", animation.enabled], ["alternate", animation.alternate], ["currently_alternate", animation.currentlyAlternate]] satisfies readonly (readonly [string, boolean])[]) record[`bmodel_anim.${key}`] = value;
  return undefined;
}
export function readQ2Poi(level: SaveObject): Q2PoiSave {
  return { valid: boolean(level["valid_poi"], "valid_poi"), point: vector(level["current_poi"], "current_poi"), stage: sourceNumber(level["current_poi_stage"], "current_poi_stage"), image: sourceNumber(level["current_poi_image"], "current_poi_image"),
    dynamicEntity: level["current_dynamic_poi"] === undefined || level["current_dynamic_poi"] === null ? null : sourceNumber(level["current_dynamic_poi"], "current_dynamic_poi") };
}
export function writeQ2Poi(level: SaveObject, poi: Q2PoiSave): undefined {
  level["valid_poi"] = poi.valid; level["current_poi"] = vectorValue(poi.point); level["current_poi_stage"] = SaveNumber.from(poi.stage); level["current_poi_image"] = SaveNumber.from(poi.image); level["current_dynamic_poi"] = poi.dynamicEntity === null ? null : SaveNumber.from(poi.dynamicEntity); return undefined;
}
export function readQ2AmmoCapacity(persistent: SaveObject): readonly number[] {
  const values = persistent["max_ammo"]; if (values === undefined) return [];
  if (!Array.isArray(values)) throw new SaveFormatError("max_ammo", "expected ammo capacity array");
  return values.map((value, index) => sourceNumber(value, `max_ammo[${index}]`));
}
export function writeQ2AmmoCapacity(persistent: SaveObject, values: readonly number[]): undefined { persistent["max_ammo"] = values.map(SaveNumber.from); return undefined; }
