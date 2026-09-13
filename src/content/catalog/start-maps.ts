import type { ResolvedResourceReference } from "../../contracts/content.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";

export interface AuthoredEpisode {
  readonly id: string;
  readonly command: string;
  readonly name: string;
  readonly activity: string;
  readonly needsSkillSelect: boolean;
}

export interface AuthoredStartMap {
  readonly episode: string;
  readonly bsp: string;
  readonly path: string;
  readonly title: string;
  readonly startItems: string;
  readonly singleplayer: boolean;
  readonly cooperative: boolean;
  readonly captureTheFlag: boolean;
}

export interface AuthoredStartCatalog {
  readonly resource: ResolvedResourceReference;
  readonly episode: AuthoredEpisode | null;
  readonly starts: readonly AuthoredStartMap[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid mapdb.json object");
  return value;
}
function string(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error("Invalid mapdb.json string");
  return value;
}
function flag(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("Invalid mapdb.json flag");
  return value;
}
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
function entries(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  if (!isUnknownArray(value)) throw new Error("Invalid mapdb.json array");
  return value;
}

/** The donor MapDB_ResolveBsp selects the final BSP while retaining the authored cinematic chain. */
export function parseAuthoredStarts(bytes: Uint8Array, campaign: string): Pick<AuthoredStartCatalog, "episode" | "starts"> {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes)), database = record(value);
  const episodeId = campaign === "ctf" ? "baseq2" : campaign;
  let episode: AuthoredEpisode | null = null;
  for (const value of entries(database["episodes"])) {
    const row = record(value);
    if (string(row["id"]) !== episodeId) continue;
    episode = { id: string(row["id"]), command: string(row["command"]), name: string(row["name"]), activity: string(row["activity"]), needsSkillSelect: flag(row["needsSkillSelect"]) };
    break;
  }
  const starts: AuthoredStartMap[] = [];
  for (const value of entries(database["maps"])) {
    const row = record(value);
    if (string(row["episode"]) !== episodeId || !(campaign === "ctf" ? flag(row["ctf"]) : flag(row["sp"]))) continue;
    const bsp = string(row["bsp"]), last = bsp.split("+").at(-1) ?? "", name = last.replace(/^\*/, "");
    if (name.length === 0 || /[+*$;\s]/.test(name)) throw new Error(`Invalid mapdb.json start BSP: ${bsp}`);
    const path = normalizeResourcePath(`maps/${name}.bsp`);
    starts.push({ episode: episodeId, bsp, path, title: string(row["title"]), startItems: string(row["start_items"]),
      singleplayer: flag(row["sp"]), cooperative: flag(row["coop"]), captureTheFlag: flag(row["ctf"]) });
  }
  return { episode, starts };
}
