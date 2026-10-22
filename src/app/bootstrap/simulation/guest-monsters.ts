import type { EnemySelection, MonsterDefinitionReference } from "../../../contracts/content.ts";
import { parseQ2Entities } from "../../../content/q2/foundation/fields.ts";
import type { Q2SpawnFields } from "../../../content/q2/foundation/host.ts";
import { q1OrdinaryMonsters, q2OrdinaryMonsters } from "./monster-runtime.ts";

export interface GuestMonsterReplacement {
  readonly ordinal: number;
  readonly classname: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly definition: MonsterDefinitionReference;
}
export interface GuestMonsterKept { readonly classname: string; readonly reason: string; }
export interface GuestMonsterPlan {
  /** Entity text handed to the guest with replaced monsters removed. */
  readonly entities: string;
  readonly replacements: readonly GuestMonsterReplacement[];
  readonly kept: readonly GuestMonsterKept[];
}

type ReplaceSelection = Extract<EnemySelection, { readonly kind: "replace" }>;

function inhibited(fields: Q2SpawnFields, edition: "classic" | "rerelease", skill: number, mode: "singleplayer" | "coop" | "deathmatch"): boolean {
  const flags = Number(fields.values.get("spawnflags") ?? 0);
  if (mode === "deathmatch") return (flags & 2048) !== 0;
  if (edition === "rerelease") {
    if (mode === "coop" && (flags & 4096) !== 0) return true;
    if (mode !== "coop" && (flags & 16384) !== 0) return true;
  }
  return (flags & (skill === 0 ? 256 : skill === 1 ? 512 : 1024)) !== 0;
}

/** Top-level brace spans of each entity in authored order, so unreplaced
 * entities keep their exact authored bytes (escapes included). */
function entitySpans(text: string): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  let depth = 0, start = -1, quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index - 1] !== "\\") quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === "{") { if (depth === 0) start = index; depth++; }
    else if (char === "}") { depth--; if (depth === 0 && start >= 0) { spans.push([start, index + 1]); start = -1; } }
  }
  return spans;
}

/**
 * Selected monsters on a black-box native world: the guest DLL spawns what
 * the entity string says, so replaced authored monsters are removed from
 * that string and admitted as shared TS monsters instead. Obligations the
 * guest alone can discharge (triggered dormancy, death/kill target chains
 * into guest entities, item drops) keep the guest monster, visibly.
 */
export function planGuestMonsters(entities: string, edition: "classic" | "rerelease", authoredFamily: "q1" | "q2" | "q3",
  selection: ReplaceSelection, skill: number, mode: "singleplayer" | "coop" | "deathmatch", projection: boolean): GuestMonsterPlan {
  const authored = parseQ2Entities(entities, edition);
  // Q3-authored maps carry no native monster classes of their own; authored
  // monster spawns found there use Q1/Q2 classnames, so both ordinary sets apply.
  const ordinary = authoredFamily === "q1" ? q1OrdinaryMonsters : authoredFamily === "q2" ? q2OrdinaryMonsters
    : new Set([...q1OrdinaryMonsters, ...q2OrdinaryMonsters]);
  const inhibition = authoredFamily === "q1" ? 0xf00 : edition === "rerelease" ? 0xff00 : 0x1f00;
  const replacements: GuestMonsterReplacement[] = [], kept: GuestMonsterKept[] = [], removed = new Set<number>();
  for (const entity of authored) {
    const classname = entity.classname;
    if (!classname.startsWith("monster_")) continue;
    const target = selection.byClassname[classname] ?? selection.default;
    if ("kind" in target) continue;
    const fields = entity.values, flags = Number(fields.get("spawnflags") ?? 0);
    const keep = (reason: string): void => { kept.push({ classname, reason }); };
    if (!projection) { keep("guest has no declared combat profile to project selected monsters"); continue; }
    if (!ordinary.has(classname)) { keep("authored obligations are not preserved by selected admission"); continue; }
    if ((flags & ~inhibition & ~1) !== 0) { keep(`spawn flags ${flags} need guest-native handling`); continue; }
    if ((fields.get("targetname") ?? "") !== "") { keep("triggered monsters stay guest-native"); continue; }
    if ((fields.get("deathtarget") ?? "") !== "" || (fields.get("killtarget") ?? "") !== "") { keep("death target chains stay guest-native"); continue; }
    if ((fields.get("combattarget") ?? "") !== "") { keep("combat targets stay guest-native"); continue; }
    if ((fields.get("item") ?? "") !== "") { keep("item drops stay guest-native"); continue; }
    if (inhibited(entity, edition, skill, mode)) continue;
    replacements.push({ ordinal: entity.ordinal, classname, fields, definition: target });
    removed.add(entity.ordinal);
  }
  if (replacements.length === 0) return { entities, replacements, kept };
  const spans = entitySpans(entities);
  if (spans.length !== authored.length) throw new Error("Native monster admission could not segment the authored entities");
  const text = authored.flatMap(entity => removed.has(entity.ordinal) ? [] : [entities.slice(spans[entity.ordinal]?.[0] ?? 0, spans[entity.ordinal]?.[1] ?? 0) + "\n"]).join("");
  return { entities: text, replacements, kept };
}
