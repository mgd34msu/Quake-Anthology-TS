import type { SeatId } from "../../contracts/identity.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { q3GameCvarDefinitions } from "../../content/q3/base/settings.ts";
import { GameType } from "../../content/q3/base/shared/definitions.ts";
import { CommonParseCursor, CommonParseState } from "../../core/common-parse.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";

export interface TeamArenaSkirmishCursor { readonly gameTypeIndex: number; readonly mapIndex: number; }
export interface TeamArenaSkirmish {
  readonly kind: "team-arena";
  readonly map: string;
  readonly title: string;
  readonly gameType: GameType.GT_TOURNAMENT | GameType.GT_CTF | GameType.GT_1FCTF | GameType.GT_OBELISK | GameType.GT_HARVESTER;
  readonly maxClients: number;
  readonly timeToBeat: number;
  readonly skill: 1 | 2 | 3 | 4 | 5;
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
  readonly clientCvars: readonly { readonly name: string; readonly value: string }[];
  readonly bots: readonly { readonly ai: string; readonly name: string; readonly team: "Red" | "Blue" | ""; readonly delayMilliseconds: number }[];
  readonly playerTeam: "Red" | "free";
  readonly playerModel: string;
  readonly playerHeadModel: string;
  readonly cursor: TeamArenaSkirmishCursor;
}
interface CampaignMap {
  readonly title: string;
  readonly name: string;
  readonly teamMembers: number;
  readonly opponent: string;
  readonly types: ReadonlySet<number>;
  readonly times: ReadonlyMap<number, number>;
}
export interface TeamArenaCampaign {
  readonly gameTypes: readonly number[];
  readonly maps: readonly CampaignMap[];
  readonly teams: ReadonlyMap<string, readonly string[]>;
  readonly aliases: ReadonlyMap<string, string>;
}

function sections(text: string): ReadonlyMap<string, readonly (readonly string[])[]> {
  const parser = new CommonParseState(), cursor = new CommonParseCursor(text), result = new Map<string, readonly (readonly string[])[]>();
  for (;;) {
    const section = parser.parse(cursor);
    if (section === "") return result;
    if (parser.parse(cursor) !== "{") throw new Error(`Invalid Team Arena ${section} section`);
    const rows: string[][] = [];
    for (;;) {
      const token = parser.parse(cursor);
      if (token === "}") break;
      if (token !== "{") throw new Error(`Invalid Team Arena ${section} row`);
      const row: string[] = [];
      for (;;) {
        const field = parser.parse(cursor);
        if (field === "}") break;
        if (field === "" || field === "{") throw new Error(`Invalid Team Arena ${section} field`);
        row.push(field);
      }
      rows.push(row);
    }
    result.set(section.toLowerCase(), rows);
  }
}
function field(row: readonly string[], index: number): string {
  const value = row[index];
  if (value === undefined) throw new Error("Incomplete Team Arena metadata row");
  return value;
}
function integer(row: readonly string[], index: number): number {
  const value = field(row, index);
  if (!/^-?\d+$/.test(value)) throw new Error("Invalid Team Arena metadata integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Team Arena metadata integer is out of range");
  return number;
}

/** Metadata grammar and defaults follow code/ui/ui_main.c, UI_StartSkirmish. */
export function parseTeamArenaCampaign(gameInfo: string, teamInfo: string): TeamArenaCampaign {
  const game = sections(gameInfo), teams = sections(teamInfo);
  const gameTypes = (game.get("gametypes") ?? []).map(row => integer(row, 1));
  const maps = (game.get("maps") ?? []).map(row => {
    const types = new Set<number>(), times = new Map<number, number>();
    for (let index = 4; index < row.length; index += 2) { const type = integer(row, index); types.add(type); times.set(type, integer(row, index + 1)); }
    const name = field(row, 1), teamMembers = integer(row, 2);
    if (!/^[a-zA-Z0-9_/-]+$/.test(name) || name.split("/").includes("..") || teamMembers < 1 || teamMembers > 5)
      throw new Error("Invalid Team Arena campaign map");
    return { title: field(row, 0), name, teamMembers, opponent: field(row, 3), types, times };
  });
  return { gameTypes, maps,
    teams: new Map((teams.get("teams") ?? []).map(row => [field(row, 0).toLowerCase(), [2, 3, 4, 5, 6].map(index => field(row, index))])),
    aliases: new Map((teams.get("aliases") ?? []).map(row => [field(row, 0).toLowerCase(), field(row, 1)])) };
}
function active(map: CampaignMap, gameType: number): boolean {
  const type = gameType === 2 ? 3 : gameType === 3 ? 0 : gameType;
  return map.types.has(2) && map.types.has(type);
}

export function nextTeamArenaCursor(campaign: TeamArenaCampaign, current: TeamArenaSkirmishCursor): TeamArenaSkirmishCursor {
  const type = campaign.gameTypes[current.gameTypeIndex];
  if (type === undefined || campaign.maps[current.mapIndex] === undefined) throw new Error("Invalid Team Arena campaign cursor");
  const next = campaign.maps.findIndex((map, index) => index > current.mapIndex && active(map, type));
  if (next !== -1) return { ...current, mapIndex: next };
  const incremented = current.gameTypeIndex + 1;
  const gameTypeIndex = incremented >= campaign.gameTypes.length ? 1 : incremented === 2 ? 3 : incremented;
  const gameType = campaign.gameTypes[gameTypeIndex];
  const mapIndex = campaign.maps.findIndex(map => gameType !== undefined && active(map, gameType));
  if (mapIndex === -1) throw new Error("Next Team Arena game type has no authored single-player maps");
  return { gameTypeIndex, mapIndex };
}

export function planTeamArenaSkirmish(campaign: TeamArenaCampaign, skill: TeamArenaSkirmish["skill"] = 2,
  cursor: TeamArenaSkirmishCursor = { gameTypeIndex: 3, mapIndex: 0 }): TeamArenaSkirmish {
  const gameType = campaign.gameTypes[cursor.gameTypeIndex], map = campaign.maps[cursor.mapIndex];
  if (gameType !== 1 && gameType !== 4 && gameType !== 5 && gameType !== 6 && gameType !== 7)
    throw new Error("Unsupported Team Arena single-player game type");
  if (map === undefined || !active(map, gameType)) throw new Error("Selected Team Arena map is not authored for this skirmish");
  const bots: TeamArenaSkirmish["bots"][number][] = [];
  if (gameType === 1) bots.push({ ai: map.opponent, name: map.opponent, team: "", delayMilliseconds: 500 });
  else for (const [name, team, count] of [["Stroggs", "Blue", map.teamMembers], ["Pagans", "Red", map.teamMembers - 1]] satisfies readonly (readonly [string, "Red" | "Blue", number])[]) {
    const members = campaign.teams.get(name.toLowerCase());
    if (members === undefined) throw new Error(`Team Arena team is missing: ${name}`);
    for (let index = 0; index < count; index++) {
      const member = field(members, index);
      bots.push({ ai: campaign.aliases.get(member.toLowerCase()) ?? "James", name: member, team, delayMilliseconds: (bots.length + 1) * 500 });
    }
  }
  const maxClients = gameType === 1 ? 2 : map.teamMembers * 2, timeToBeat = map.times.get(gameType) ?? 0;
  const values: Readonly<Record<string, string>> = { nextmap: "teamarena-results", ui_teamArenaTimeToBeat: String(timeToBeat), g_gametype: String(gameType), ui_singlePlayerActive: "1", g_spSkill: String(skill),
    sv_maxclients: String(maxClients), g_doWarmup: "1", g_warmup: "15", sv_pure: "0", g_friendlyFire: "0", g_redTeam: "Pagans", g_blueTeam: "Stroggs",
    capturelimit: gameType === 6 ? "4" : gameType === 7 ? "15" : "5", fraglimit: "10",
    ui_scoreMap: map.title, ui_gameType: String(cursor.gameTypeIndex), ui_currentMap: String(cursor.mapIndex),
    ui_mapIndex: String(campaign.maps.slice(0, cursor.mapIndex).filter(row => active(row, gameType)).length), ui_teamName: "Pagans", ui_opponentName: "Stroggs" };
  return { kind: "team-arena", map: `maps/${map.name}.bsp`, title: map.title, gameType, maxClients, timeToBeat, skill,
    cvars: Object.entries(values).map(([name, value]) => ({ name, value })),
    clientCvars: [{ name: "cg_cameraOrbit", value: "0" }, { name: "cg_thirdPerson", value: "0" }, { name: "cg_drawTimer", value: "1" }], bots,
    playerTeam: gameType === 1 ? "free" : "Red", playerModel: gameType === 1 ? "sarge" : "james", playerHeadModel: gameType === 1 ? "sarge" : "*james", cursor };
}
export function currentTeamArenaCursor(campaign: TeamArenaCampaign, live: Pick<TeamArenaSkirmish, "map" | "gameType">): TeamArenaSkirmishCursor {
  const gameTypeIndex = campaign.gameTypes.indexOf(live.gameType), mapIndex = campaign.maps.findIndex(map => `maps/${map.name}.bsp`.toLowerCase() === live.map.toLowerCase());
  if (gameTypeIndex === -1 || mapIndex === -1) throw new Error("Current Team Arena match has no authored campaign entry");
  return { gameTypeIndex, mapIndex };
}
export async function readTeamArenaSkirmish(catalog: InstalledCatalog, skill: TeamArenaSkirmish["skill"] = 2,
  previous?: Pick<TeamArenaSkirmish, "map" | "gameType"> & { readonly advance?: boolean }): Promise<TeamArenaSkirmish> {
  const product = catalog.require("q3-missionpack");
  const [game, teams] = await Promise.all([catalog.read(product.id, "gameinfo.txt"), catalog.read(product.id, "teaminfo.txt")]);
  const campaign = parseTeamArenaCampaign(Buffer.from(game).toString("latin1"), Buffer.from(teams).toString("latin1"));
  return planTeamArenaSkirmish(campaign, skill, previous === undefined ? undefined : previous.advance === false ? currentTeamArenaCursor(campaign, previous) : nextTeamArenaCursor(campaign, currentTeamArenaCursor(campaign, previous)));
}

export const teamArenaServerOverrides = [
  { name: "capturelimit", saved: "ui_saveCaptureLimit" }, { name: "fraglimit", saved: "ui_saveFragLimit" },
  { name: "g_doWarmup", saved: "ui_doWarmup" }, { name: "g_warmup", saved: "ui_Warmup" },
  { name: "sv_pure", saved: "ui_pure" }, { name: "g_friendlyFire", saved: "ui_friendlyFire" },
];

export function teamArenaSourceCvars(setup: TeamArenaSkirmish, baseline: readonly { readonly name: string; readonly value: string }[]): TeamArenaSkirmish["cvars"] {
  const defaults = q3GameCvarDefinitions("missionpack");
  return [{ name: "ui_maxClients", value: baseline.find(setting => setting.name.toLowerCase() === "sv_maxclients")?.value ?? "0" }, ...teamArenaServerOverrides.map(setting => ({ name: setting.saved,
    value: baseline.find(value => value.name.toLowerCase() === setting.name.toLowerCase())?.value
      ?? defaults.find(value => value.name.toLowerCase() === setting.name.toLowerCase())?.value ?? "0" })), ...setup.cvars];
}

export function teamArenaClientCvars(setup: TeamArenaSkirmish, baseline: readonly { readonly name: string; readonly value: string }[]): TeamArenaSkirmish["clientCvars"] {
  return [{ name: "ui_drawTimer", value: baseline.find(setting => setting.name.toLowerCase() === "cg_drawtimer")?.value ?? "0" }, ...setup.clientCvars];
}

/** One preparation can apply at a world-action boundary and again after its continuation. */
export class TeamArenaLaunchOverrides {
  private captured: { readonly source: TeamArenaSkirmish["cvars"]; readonly seats: readonly { readonly id: SeatId; readonly settings: TeamArenaSkirmish["clientCvars"] }[] } | null = null;
  constructor(private readonly setup: TeamArenaSkirmish) {}
  apply(source: CvarRegistry, seats: readonly { readonly id: SeatId; readonly cvars: CvarRegistry }[]): void {
    source.applyLatched();
    if (this.captured === null) {
      const capturedSeats = seats.map(seat => ({ id: seat.id, settings: [
        ...teamArenaClientCvars(this.setup, seat.cvars.snapshots()),
        ...["model", "team_model"].map(name => ({ name, value: this.setup.playerModel })),
        ...["headmodel", "team_headmodel"].map(name => ({ name, value: this.setup.playerHeadModel })),
      ] }));
      const timer = capturedSeats[0]?.settings.find(setting => setting.name === "ui_drawTimer")?.value ?? "0";
      this.captured = { source: [...teamArenaSourceCvars(this.setup, source.snapshots()), { name: "ui_drawTimer", value: timer }], seats: capturedSeats };
    }
    for (const setting of this.captured.source) source.set(setting.name, setting.value, true);
    for (const seat of seats) {
      const captured = this.captured.seats.find(saved => saved.id.equals(seat.id));
      if (captured === undefined) throw new Error("Team Arena preparation adopted an unknown seat");
      for (const setting of captured.settings) seat.cvars.set(setting.name, setting.value, true);
    }
  }
}
