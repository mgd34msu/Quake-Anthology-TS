/* Base UI progression semantics from id Software ui_gameinfo.c and ui_sppostgame.c.
 * Copyright (C) 1999-2005 Id Software. GPL-2.0-or-later. */
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { setInfoValue } from "../../core/cvars/info.ts";
import { infoValueForKey } from "../../core/info-string.ts";
import { gameAtoi } from "../../core/game-numeric.ts";

export type ArenaSkill = 1 | 2 | 3 | 4 | 5;
export interface ArenaProgressionCatalog {
  readonly regularLevels: number;
  readonly training: number | null;
  readonly final: number | null;
  readonly totalLevels: number;
}
export interface ArenaResult {
  readonly level: number;
  readonly skill: ArenaSkill;
  readonly rank: number;
  readonly accuracy: number;
  readonly impressive: number;
  readonly excellent: number;
  readonly gauntlet: number;
  readonly frags: number;
  readonly perfect: boolean;
}
export interface ArenaAward { readonly medal: number; readonly amount: number }
export interface ArenaProgressionResult {
  readonly rank: number;
  readonly completedTier: number;
  readonly unlockedMovie: number | null;
  readonly awards: readonly ArenaAward[];
  readonly nextLevel: number;
}

export class BaseArenaProgression {
  constructor(private readonly cvars: CvarRegistry, readonly catalog: ArenaProgressionCatalog) {
    if (!Number.isInteger(catalog.regularLevels) || catalog.regularLevels < 0 || catalog.regularLevels % 4 !== 0
      || !Number.isInteger(catalog.totalLevels) || catalog.totalLevels < catalog.regularLevels) throw new Error("Invalid arena progression catalog");
    for (let skill = 1; skill <= 5; skill++) cvars.register(`g_spScores${skill}`, "", CvarFlag.Archive);
    cvars.register("g_spAwards", "", CvarFlag.Archive);
    cvars.register("g_spVideos", "", CvarFlag.Archive);
  }
  private read(name: string, key: string): number { return gameAtoi(infoValueForKey(this.cvars.get(name)?.value ?? "", key)); }
  private write(name: string, key: string, value: number): void {
    const text = setInfoValue(this.cvars.get(name)?.value ?? "", key, String(value), {
      dialect: "q3", maximumLength: 1024, target: "client-userinfo", serverHighCharacters: true,
      print: message => { throw new Error(message); },
    });
    this.cvars.set(name, text, true);
  }
  best(level: number): { readonly rank: number; readonly skill: number } {
    let rank = 0, skill = 0;
    for (let n = 1; n <= 5; n++) {
      const current = this.read(`g_spScores${n}`, `l${level}`);
      if (current >= 1 && current <= 8 && (rank === 0 || current <= rank)) { rank = current; skill = n; }
    }
    return { rank, skill };
  }
  award(medal: number): number { return this.read("g_spAwards", `a${medal}`); }
  movieUnlocked(tier: number): boolean { return tier > 0 && this.read("g_spVideos", `tier${tier}`) !== 0; }
  currentLevel(): number {
    if (this.catalog.training !== null && this.best(this.catalog.training).rank !== 1) return this.catalog.training;
    for (let level = 0; level < this.catalog.regularLevels; level++) if (this.best(level).rank !== 1) return level;
    return this.catalog.final ?? -1;
  }
  levelAvailable(level: number): boolean {
    if (level === this.catalog.training) return true;
    if (level < 0 || level >= this.catalog.totalLevels) return false;
    const current = this.currentLevel();
    if (current === this.catalog.training) return false;
    if (current < 0) return true;
    const currentTier = current === this.catalog.final ? this.catalog.regularLevels / 4 : Math.trunc(current / 4);
    const tier = level === this.catalog.final ? this.catalog.regularLevels / 4 : Math.trunc(level / 4);
    return tier <= currentTier;
  }
  completedTier(level: number): number {
    if (level === this.catalog.training) return 0;
    if (level === this.catalog.final) return this.catalog.regularLevels / 4 + 1;
    if (level < 0 || level >= this.catalog.regularLevels) return -1;
    const tier = Math.trunc(level / 4);
    for (let n = tier * 4; n < tier * 4 + 4; n++) if (this.best(n).rank !== 1) return -1;
    return tier + 1;
  }
  record(result: ArenaResult): ArenaProgressionResult {
    if (!Number.isInteger(result.level) || result.level < 0 || result.level >= this.catalog.totalLevels
      || !Number.isInteger(result.rank) || result.rank < 1 || result.rank > 8) throw new Error("Invalid arena result");
    const name = `g_spScores${result.skill}`, key = `l${result.level}`, old = this.read(name, key);
    if (old === 0 || old > result.rank) this.write(name, key, result.rank);
    const awards: ArenaAward[] = [];
    const grant = (medal: number, count: number, display: number): void => {
      if (count === 0) return;
      this.write("g_spAwards", `a${medal}`, (this.award(medal) + count) | 0);
      if (display !== 0) awards.push({ medal, amount: display });
    };
    if (result.accuracy >= 50) grant(0, 1, result.accuracy);
    grant(1, result.impressive, result.impressive); grant(2, result.excellent, result.excellent); grant(3, result.gauntlet, result.gauntlet);
    const oldHundreds = Math.trunc(this.award(4) / 100);
    grant(4, result.frags, 0);
    const hundreds = Math.trunc(this.award(4) / 100);
    if (hundreds > oldHundreds) awards.push({ medal: 4, amount: Math.imul(hundreds, 100) });
    if (result.perfect) grant(5, 1, 1);
    const tier = result.rank === 1 ? this.completedTier(result.level) : -1;
    const unlockedMovie = tier >= 0 && !this.movieUnlocked(tier + 1) ? tier + 1 : null;
    if (unlockedMovie !== null) this.write("g_spVideos", `tier${unlockedMovie}`, 1);
    return { rank: result.rank, completedTier: tier, unlockedMovie, awards, nextLevel: this.currentLevel() };
  }
  reset(): void {
    for (let skill = 1; skill <= 5; skill++) this.cvars.set(`g_spScores${skill}`, "", true);
    this.cvars.set("g_spAwards", "", true); this.cvars.set("g_spVideos", "", true);
  }
  unlockLevels(): void {
    for (let level = 0; level < this.catalog.totalLevels; level++) this.write("g_spScores1", `l${level}`, 1);
    for (let tier = 1; tier <= 8; tier++) this.write("g_spVideos", `tier${tier}`, 1);
  }
  unlockMedals(): void { for (let medal = 0; medal < 6; medal++) this.write("g_spAwards", `a${medal}`, 100); }
}
