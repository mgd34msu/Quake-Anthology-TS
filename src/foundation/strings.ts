/*
 * Interned string identities, following the shared C foundation
 * (include/qa/strings.h, src/core/strings.c): text is admitted once and every
 * runtime comparison afterwards is a uint32 identity check. Name classes are
 * computed at admission, never re-derived per query. IDs belong to this table
 * lifetime; persist the string, never the process-local ID.
 * GPL-2.0-or-later.
 */

/** The invalid/absent string identity. */
export const STRING_NONE = 0;

export const NAME_MONSTER = 1 << 0;
export const NAME_PLAYER_START = 1 << 1;
export const NAME_ITEM_FLAG = 1 << 2;
export const NAME_BRUSH_PATH = 1 << 3;
export const NAME_SEXED_SOUND = 1 << 4;
export const NAME_INFO_FLAG = 1 << 5;
export const NAME_FUNC = 1 << 6;
export const NAME_TEAM_RED_EXACT = 1 << 7;
export const NAME_TEAM_BLUE_EXACT = 1 << 8;
export const NAME_TEAM_RED_ALIAS = 1 << 9;
export const NAME_TEAM_BLUE_ALIAS = 1 << 10;
export const NAME_TEAM_COLOR_NAMESPACE = 1 << 11;
export const NAME_Q1_AMMO = 1 << 12;

/** Classifies an admitted name once, mirroring the C table's stored bits. */
export function quakeNameFlags(text: string): number {
  let flags = 0;
  if (text.startsWith("*")) flags |= NAME_SEXED_SOUND;
  if (text.startsWith("monster_")) flags |= NAME_MONSTER;
  if (text.startsWith("info_player_")) flags |= NAME_PLAYER_START;
  if (text.startsWith("item_flag_")) flags |= NAME_ITEM_FLAG;
  if (text.startsWith("info_flag")) flags |= NAME_INFO_FLAG;
  if (text.startsWith("func")) flags |= NAME_FUNC;
  if (text.startsWith("q1:ammo/")) flags |= NAME_Q1_AMMO;
  if (text.length > 2 && text.startsWith("*") && (text.endsWith("p") || text.endsWith("P"))) flags |= NAME_BRUSH_PATH;
  switch (text) {
    case "red": case "team:red": flags |= NAME_TEAM_RED_ALIAS | NAME_TEAM_RED_EXACT; break;
    case "blue": case "team:blue": flags |= NAME_TEAM_BLUE_ALIAS | NAME_TEAM_BLUE_EXACT; break;
    case "5": case "q2:1": case "q3:1": flags |= NAME_TEAM_RED_ALIAS; break;
    case "14": case "q2:2": case "q3:2": flags |= NAME_TEAM_BLUE_ALIAS; break;
    case "q2": case "q3": flags |= NAME_TEAM_COLOR_NAMESPACE; break;
    default: break;
  }
  return flags;
}

/**
 * Exact byte identity, with no case folding or path normalization; normalize
 * at the domain boundary before interning. The optional classifier runs once
 * per distinct string at admission.
 */
export class StringTable {
  private readonly ids = new Map<string, number>();
  private readonly texts: string[] = [""];
  private flags = new Uint32Array(64);

  constructor(private readonly classify: (text: string) => number = quakeNameFlags) {}

  get count(): number { return this.texts.length - 1; }

  intern(text: string): number {
    const existing = this.ids.get(text);
    if (existing !== undefined) return existing;
    const id = this.texts.length;
    if (id > 0xffffffff) throw new RangeError("String identity space exhausted");
    this.texts.push(text);
    if (id >= this.flags.length) {
      const grown = new Uint32Array(this.flags.length * 2);
      grown.set(this.flags);
      this.flags = grown;
    }
    this.flags[id] = this.classify(text) >>> 0;
    this.ids.set(text, id);
    return id;
  }

  /** Returns STRING_NONE without admitting the text. */
  find(text: string): number {
    return this.ids.get(text) ?? STRING_NONE;
  }

  /** Binds a static name list once; the returned IDs stay valid for the table lifetime. */
  bindNames(names: readonly string[]): readonly number[] {
    return names.map((name) => this.intern(name));
  }

  text(id: number): string {
    const value = this.texts[id];
    if (value === undefined) throw new RangeError(`String id is outside this table: ${id}`);
    return value;
  }

  nameFlags(id: number): number {
    const value = this.flags[id];
    return value === undefined ? 0 : value;
  }
}
