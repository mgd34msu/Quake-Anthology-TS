/* quakec_mg1/horde.qc SpawnSquad2 and SpawnWave2. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";

export type HordeMonster = "knight" | "hellknight" | "dog" | "demon" | "ogre" | "grunt" | "enforcer" | "shambler" | "shalrath" | "wizard" | "zombie";
export type HordeSquad = "3 grunts" | "2 grunts, 1 dog" | "2 dogs" | "1 enforcer" | "2 enforcers" | "1 ogre" | "2 knights" | "2 zombies" | "1 wizard" | "2 hellknights" | "2 knights, 1 hellknight" | "3 wizards" | "shambler" | "double demon" | "shalrath";
export type HordeSquadType = "normal" | "ranged" | "flying" | "boss";
export interface HordeSquadSpawn { readonly monster: HordeMonster; readonly offset: Vec3 }

export function hordeSquad(name: HordeSquad, skill: number, random: () => number): readonly HordeSquadSpawn[] {
  const spawn = (monster: HordeMonster, x = 0, y = 0, z = 0): HordeSquadSpawn => ({ monster, offset: { x, y, z } });
  switch (name) {
    case "3 grunts": return skill > 0 ? [spawn("grunt", 0, -40), spawn("grunt", 40, 40), spawn("grunt", -40, 40)] : [spawn("grunt", -40), spawn("grunt", 40)];
    case "2 grunts, 1 dog": return [spawn("dog", 44), spawn("grunt", -40, -40), spawn("grunt", -40, 40)];
    case "2 dogs": return skill > 0 ? [spawn("dog", 0, -44), spawn("dog", 0, 44)] : [spawn("dog", 0, -44)];
    case "1 enforcer": return [spawn("enforcer")];
    case "2 enforcers": return skill > 0 ? [spawn("enforcer", 40), spawn("enforcer", -40)] : [spawn("enforcer")];
    case "1 ogre": return [spawn("ogre")];
    case "2 knights": return skill > 0 ? [spawn("knight", 40), spawn("knight", -40)] : [spawn("knight", 40)];
    case "2 zombies": return [spawn("zombie", 40), spawn("zombie", -40)];
    case "1 wizard": return [spawn("wizard")];
    case "2 hellknights": return skill > 0 ? [spawn("hellknight", 0, 40), spawn("hellknight", 0, -40)] : [spawn("hellknight", 0, 40)];
    case "2 knights, 1 hellknight": return [spawn("hellknight", 40), spawn("knight", -40, 40), spawn("knight", -40, -40)];
    case "3 wizards": return skill > 0 ? [spawn("wizard", 40, 40, 40), spawn("wizard", -40, 40, 40), spawn("wizard", -40, -40, 40)] : [spawn("wizard", 40, 40, 40), spawn("wizard", -40, 40, 40)];
    case "shambler": return [spawn("shambler")];
    case "double demon": return skill >= 3 && random() > 0.8 ? [spawn("shambler", 40, 40), spawn("shambler", -40, -40)] : skill >= 1 ? [spawn("demon", 40, 40), spawn("demon", -40, -40)] : [spawn("demon")];
    case "shalrath": return [spawn("shalrath")];
  }
}

export function chooseHordeSquad(army: boolean, category: "fodder" | "elites" | "bosses", random: () => number): { readonly squad: HordeSquad; readonly type: HordeSquadType } | null {
  if (army) {
    if (category === "bosses") return null;
    if (category === "elites") return { squad: random() * 2 < 1.5 ? "2 enforcers" : "1 ogre", type: "ranged" };
    const roll = random() * 4;
    return { squad: roll < 1 ? "3 grunts" : roll < 2 ? "2 grunts, 1 dog" : roll < 3.5 ? "2 dogs" : "1 enforcer", type: roll < 3.5 ? "normal" : "ranged" };
  }
  if (category === "fodder") {
    const roll = random() * 4; return { squad: roll < 2 ? "2 knights" : roll < 3 ? "2 zombies" : "1 wizard", type: roll < 3 ? "normal" : "flying" };
  }
  if (category === "elites") {
    const roll = random() * 4; return { squad: roll < 1 ? "2 hellknights" : roll < 2 ? "2 knights, 1 hellknight" : roll < 3 ? "1 ogre" : "3 wizards", type: roll < 2 ? "normal" : roll < 3 ? "ranged" : "flying" };
  }
  const roll = random() * 3; return { squad: roll < 1 ? "shambler" : roll < 2.5 ? "double demon" : "shalrath", type: roll >= 1 && roll < 2.5 ? "normal" : "boss" };
}
