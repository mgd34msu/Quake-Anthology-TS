import type { Q2PlayerState } from "./types.ts";

const environment: ReadonlyMap<number, string> = new Map([
  [23, "suicides"], [22, "cratered"], [20, "was squished"], [17, "sank like a rock"], [18, "melted"], [19, "does a back flip into the lava"],
  [25, "blew up"], [26, "blew up"], [28, "found a way out"], [30, "saw the light"], [33, "got blasted"],
  [27, "was in the wrong place"], [29, "was in the wrong place"], [31, "was in the wrong place"],
]);
const kills: ReadonlyMap<number, readonly [string, string]> = new Map([
  [1, ["was blasted by", ""]], [2, ["was gunned down by", ""]], [3, ["was blown away by", "'s super shotgun"]],
  [4, ["was machinegunned by", ""]], [5, ["was cut in half by", "'s chaingun"]], [6, ["was popped by", "'s grenade"]],
  [7, ["was shredded by", "'s shrapnel"]], [8, ["ate", "'s rocket"]], [9, ["almost dodged", "'s rocket"]],
  [10, ["was melted by", "'s hyperblaster"]], [11, ["was railed by", ""]], [12, ["saw the pretty lights from", "'s BFG"]],
  [13, ["was disintegrated by", "'s BFG blast"]], [14, ["couldn't hide from", "'s BFG"]], [15, ["caught", "'s handgrenade"]],
  [16, ["didn't see", "'s handgrenade"]], [24, ["feels", "'s pain"]], [21, ["tried to invade", "'s personal space"]],
]);
export function q2Obituary(victim: Q2PlayerState, attacker: Q2PlayerState | null, means: number, deathmatch: boolean, coop: boolean): string {
  const friendly = (means & 0x8000000) !== 0 || coop && attacker !== null;
  const mod = means & ~0x8000000;
  let message = environment.get(mod);
  if (attacker === victim) {
    const possessive = victim.gender === "female" ? "her" : victim.gender === "neutral" ? "its" : "his";
    const reflexive = victim.gender === "female" ? "herself" : victim.gender === "neutral" ? "itself" : "himself";
    message = mod === 24 ? "tried to put the pin back in" : mod === 7 || mod === 16 ? `tripped on ${possessive} own grenade`
      : mod === 9 ? `blew ${reflexive} up` : mod === 13 ? "should have used a smaller gun" : `killed ${reflexive}`;
  }
  if ((deathmatch || coop) && message !== undefined) { if (deathmatch) victim.score--; return `${victim.name} ${message}.\n`; }
  const kill = kills.get(mod);
  if ((deathmatch || coop) && attacker !== null && kill !== undefined) {
    if (deathmatch) attacker.score += friendly ? -1 : 1;
    return `${victim.name} ${kill[0]} ${attacker.name}${kill[1]}\n`;
  }
  if (deathmatch) victim.score--;
  return `${victim.name} died.\n`;
}
