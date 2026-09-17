import { CommonParseCursor, CommonParseState } from "../../core/common-parse.ts";
import type { MountedContent } from "../../content/mounts/index.ts";

export interface BaseArena {
  readonly number: number;
  readonly map: string;
  readonly title: string;
  readonly bots: readonly string[];
  readonly special: string;
  readonly selection: number;
  readonly fragLimit: number;
  readonly timeLimit: number;
}
export interface BaseArenaCatalog { readonly arenas: readonly BaseArena[]; readonly regularCount: number; readonly tierCount: number; }
/** UI_LoadArenas numbering is distinct from the source game's file-order arena numbers. */
export function parseBaseArenaCatalog(texts: readonly string[]): BaseArenaCatalog {
  const infos: ReadonlyMap<string, string>[] = [];
  for (const text of texts) {
    const parser = new CommonParseState(), cursor = new CommonParseCursor(text);
    for (;;) {
      const token = parser.parse(cursor); if (token === "") break;
      if (token !== "{") throw new Error("Malformed base arena definition");
      const fields = new Map<string, string>();
      for (;;) {
        const key = parser.parse(cursor); if (key === "}") break;
        if (key === "") throw new Error("Unterminated base arena definition");
        fields.set(key, parser.parse(cursor, false) || "<NULL>");
      }
      infos.push(fields);
    }
  }
  const singles = infos.filter(row => row.get("type")?.includes("single"));
  const regularCount = Math.floor(singles.filter(row => !row.get("special")).length / 4) * 4;
  let single = 0, specialNumber = regularCount;
  const arenas = singles.map(row => {
    const special = row.get("special") ?? "", number = special ? specialNumber++ : single++;
    const name = row.get("map");
    if (name === undefined || !/^[a-z0-9_/-]+$/i.test(name)) throw new Error("Invalid base arena map name");
    const frag = Number.parseInt(row.get("fraglimit") ?? "0", 10) || 0, time = Number.parseInt(row.get("timelimit") ?? "0", 10) || 0;
    return { number, map: `maps/${name}.bsp`, title: row.get("longname") ?? name, special,
      selection: special.toLowerCase() === "training" ? -4 : special.toLowerCase() === "final" ? regularCount : number,
      bots: (row.get("bots") ?? "").split(/\s+/).filter(Boolean), fragLimit: frag === 0 && time === 0 ? 10 : frag, timeLimit: time };
  });
  return { arenas, regularCount, tierCount: regularCount / 4 };
}
export async function readBaseArenaCatalog(mounts: Pick<MountedContent, "listFiles" | "open">): Promise<BaseArenaCatalog> {
  const files = ["scripts/arenas.txt", ...(await mounts.listFiles("scripts", ".arena")).map(name => `scripts/${name}`)];
  const texts: string[] = [];
  for (const path of files) {
    const resource = await mounts.open(path);
    if (resource !== null) texts.push(Buffer.from(resource.bytes).toString("latin1"));
  }
  return parseBaseArenaCatalog(texts);
}
export function baseArenaForMap(catalog: BaseArenaCatalog, map: string): BaseArena {
  const path = map.toLowerCase().replace(/^maps\//, "").replace(/\.bsp$/, "");
  const arena = catalog.arenas.find(row => row.map.toLowerCase() === `maps/${path}.bsp`);
  if (arena === undefined) throw new Error(`No authored single-player arena for ${map}`);
  return arena;
}
