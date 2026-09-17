import type { Vec3 } from "../../../contracts/math.ts";
import { parseQ1Entities, q1EntityValue } from "../../../formats/q1-map/entities.ts";
import type { Q1Entity } from "../../../formats/q1-map/types.ts";
import { GameType, type Product } from "../base/shared/definitions.ts";
import { checkObjectivePlacements, type ObjectiveClassname, type ObjectivePlacementResult } from "./objective-placement.ts";

export interface ExplicitObjectivePlacement { readonly classname: ObjectiveClassname; readonly origin: Vec3; }
export type ForeignObjectiveAdaptation = Exclude<ObjectivePlacementResult, { readonly kind: "ready" }>
  | { readonly kind: "ready"; readonly entities: string; readonly translated: number };
function field(entity: Q1Entity, name: string, value: string): Q1Entity {
  return { properties: [...entity.properties.filter(row => row.key !== name), { key: name, value }] };
}
/** Preserve authored geometry/positions; only translate equivalent flag and spawn roles. */
export function adaptForeignQ3Objectives(world: { readonly kind: "q1-bsp" | "q2-bsp" | "q3-bsp"; readonly entities: string },
  product: Product, gameType: number, explicit: readonly ExplicitObjectivePlacement[] = []): ForeignObjectiveAdaptation {
  if (world.kind === "q3-bsp" && explicit.length === 0) {
    const result = checkObjectivePlacements(product, gameType, parseQ1Entities(world.entities).map(entity => ({ classname: q1EntityValue(entity, "classname") ?? null })));
    return result.kind === "ready" ? { kind: "ready", entities: world.entities, translated: 0 } : result;
  }
  let translated = 0;
  const entities: Q1Entity[] = [];
  const obelisks = gameType === GameType.GT_OBELISK || gameType === GameType.GT_HARVESTER;
  const aliases: ReadonlyMap<string, string> = new Map([
    ["item_flag_team1", obelisks ? "team_redobelisk" : "team_CTF_redflag"],
    ["item_flag_team2", obelisks ? "team_blueobelisk" : "team_CTF_blueflag"],
    ["info_player_team1", "team_CTF_redplayer"], ["info_player_team2", "team_CTF_blueplayer"],
    ["info_player_coop", "info_player_deathmatch"], ["info_player_start2", "info_player_deathmatch"],
    ["info_player_start", "info_player_deathmatch"],
  ]);
  for (const entity of parseQ1Entities(world.entities)) {
    const classname = q1EntityValue(entity, "classname") ?? "";
    const replacement = world.kind === "q3-bsp" ? undefined : aliases.get(classname);
    const current = replacement === undefined ? entity : field(entity, "classname", replacement);
    entities.push(current); if (replacement !== undefined) translated++;
    if (replacement === "team_CTF_redplayer" || replacement === "team_CTF_blueplayer") {
      entities.push(field(current, "classname", replacement === "team_CTF_redplayer" ? "team_CTF_redspawn" : "team_CTF_bluespawn")); translated++;
    }
  }
  for (const placement of explicit) {
    if (![placement.origin.x, placement.origin.y, placement.origin.z].every(Number.isFinite)) throw new Error("Objective position must be finite");
    if (entities.some(entity => q1EntityValue(entity, "classname") === placement.classname)) continue;
    entities.push({ properties: [{ key: "classname", value: placement.classname }, { key: "origin", value: `${placement.origin.x} ${placement.origin.y} ${placement.origin.z}` }] });
  }
  const result = checkObjectivePlacements(product, gameType, entities.map(entity => ({ classname: q1EntityValue(entity, "classname") ?? null })));
  if (result.kind !== "ready") return result;
  if (!entities.some(entity => ["info_player_deathmatch", "team_CTF_redplayer", "team_CTF_blueplayer"].includes(q1EntityValue(entity, "classname") ?? "")))
    throw new Error("Q3 rules require an authored player spawn");
  const quote = (value: string): string => { if (value.includes('"') || value.includes("\0")) throw new Error("Invalid quoted entity field"); return `"${value}"`; };
  return { kind: "ready", translated, entities: entities.map(entity => `{\n${entity.properties.map(row => `${quote(row.key)} ${quote(row.value)}`).join("\n")}\n}\n`).join("") };
}
