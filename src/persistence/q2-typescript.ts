// The donor's classic TypeScript game uses this JSON format, distinct from retail native structs.
import { parseSourceJson, SaveNumber, sourceNumber, sourceObject, writeSourceJson } from "./source-json.ts";
import type { SaveObject } from "./source-json.ts";
import { SaveFormatError } from "./value.ts";

export interface Q2TypeScriptGameSave { readonly root: SaveObject; readonly clients: readonly SaveObject[]; }
export interface Q2TypeScriptLevelSave {
  readonly root: SaveObject;
  readonly level: SaveObject;
  readonly edicts: readonly { readonly index: number; readonly data: SaveObject }[];
}
export function decodeQ2TypeScriptGame(text: string): Q2TypeScriptGameSave {
  const root = sourceObject(parseSourceJson(text), "q2-typescript");
  if (root["stamp"] !== "quake-2-ts:g_save:v1") throw new SaveFormatError("stamp", "unsupported TypeScript donor save version");
  const clients = root["clients"];
  if (!Array.isArray(clients)) throw new SaveFormatError("clients", "expected source client array");
  return { root, clients: clients.map((client, index) => sourceObject(client, `clients[${index}]`)) };
}
export function encodeQ2TypeScriptGame(save: Q2TypeScriptGameSave): string { return writeSourceJson({ ...save.root, clients: [...save.clients] }); }
export function decodeQ2TypeScriptLevel(text: string): Q2TypeScriptLevelSave {
  const root = sourceObject(parseSourceJson(text), "q2-typescript");
  const level = sourceObject(root["level"], "level");
  const edicts = root["edicts"];
  if (!Array.isArray(edicts)) throw new SaveFormatError("edicts", "expected source entity array");
  return { root, level, edicts: edicts.map((value, offset) => {
    const record = sourceObject(value, `edicts[${offset}]`);
    if (record["index"] === undefined) throw new SaveFormatError("edicts.index", "missing source entity slot");
    const index = sourceNumber(record["index"], `edicts[${offset}].index`);
    if (!Number.isSafeInteger(index) || index < 0) throw new SaveFormatError("edicts.index", "invalid source entity slot");
    return { index, data: sourceObject(record["data"], `edicts[${offset}].data`) };
  }) };
}
export function encodeQ2TypeScriptLevel(save: Q2TypeScriptLevelSave): string {
  return writeSourceJson({ ...save.root, level: save.level, edicts: save.edicts.map(record => ({ index: new SaveNumber(String(record.index)), data: record.data })) });
}
