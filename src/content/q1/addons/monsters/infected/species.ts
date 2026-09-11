/* quakec_mg3/monsters/mg3_*_infected.qc. GPL-2.0-or-later. */
import { baseSpecies } from "../../../base/species.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";

export type InfectedKind = "army" | "knight" | "enforcer" | "hellknight";
export const infectedClassnames: ReadonlyMap<string, InfectedKind> = new Map([
  ["monster_army_infected", "army"], ["monster_knight_infected", "knight"], ["monster_enforcer_infected", "enforcer"], ["monster_hell_knight_infected", "hellknight"],
]);
const human = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } };
const large = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } };
const army: MonsterSpecies = { species: "army", classnames: ["monster_army"], model: "soldier", head: "h_guard", health: 30, gibHealth: -35, gibs: ["gib1", "gib2", "gib3"],
  bounds: human, stand: "army_stand1", walk: "army_walk1", run: "army_run1", sight: "soldier/sight1.wav", missile: "army_atk1", melee: false, movement: "walk" };
export function infectedKind(entity: Q1Actor): InfectedKind {
  const kind = entity.text("infected.kind");
  if (kind === "army" || kind === "knight" || kind === "enforcer" || kind === "hellknight") return kind;
  throw new Error(`Missing MG3 infected variant on ${entity.classname}`);
}
export function infectedSpecies(entity: Q1Actor): MonsterSpecies {
  const kind = infectedKind(entity), transformed = entity.number("infected.transformed") !== 0;
  const species = transformed ? kind === "army" || kind === "knight" ? "zombie" : "demon" : kind;
  if (species === "army") return army;
  const source = baseSpecies.find(spec => spec.species === species); if (source === undefined) throw new Error(`Missing base species ${species}`);
  if (species === "zombie") return { ...source, missile: null, melee: true };
  if (species === "enforcer") return { ...source, bounds: large };
  if (species !== "hellknight" || entity.number("infected.risen") !== 0) return source;
  const corpse = (entity.spawnflags & 65536) !== 0 ? 1 : (entity.spawnflags & 8388608) !== 0 ? 2 : 0;
  return corpse === 0 ? source : { ...source, stand: `hknight_corpse${corpse}`, run: `hknight_corpse${corpse}_rise0` };
}
