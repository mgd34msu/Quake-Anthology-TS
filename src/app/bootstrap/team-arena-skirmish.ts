import type { ApplicationOptions } from "./options.ts";
import { q3TeamArenaCatalogPolicy, type Q3ProductPolicy } from "../../core/q3-product-policy.ts";
import { openMountPlan, type MountedContent } from "../../content/mounts/index.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import { prepareQ3ApplicationProduct } from "./q3-product.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { q3GameCvarDefinitions } from "../../content/q3/base/settings.ts";
import { GameType } from "../../content/q3/base/shared/definitions.ts";
import { CommonParseCursor, CommonParseState } from "../../core/common-parse.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";

export interface TeamArenaTeams { readonly player: string; readonly opponent: string; }
export function teamArenaTeamChoices(campaign: TeamArenaCampaign): readonly string[] { return [...campaign.teams.keys()]; }
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
  cursor: TeamArenaSkirmishCursor = { gameTypeIndex: 3, mapIndex: 0 },
  teams: TeamArenaTeams = { player: "Pagans", opponent: "Stroggs" }): TeamArenaSkirmish {
  const gameType = campaign.gameTypes[cursor.gameTypeIndex], map = campaign.maps[cursor.mapIndex];
  if (gameType !== 1 && gameType !== 4 && gameType !== 5 && gameType !== 6 && gameType !== 7)
    throw new Error("Unsupported Team Arena single-player game type");
  if (map === undefined || !active(map, gameType)) throw new Error("Selected Team Arena map is not authored for this skirmish");
  const bots: TeamArenaSkirmish["bots"][number][] = [];
  if (gameType === 1) bots.push({ ai: map.opponent, name: map.opponent, team: "", delayMilliseconds: 500 });
  else for (const [name, team, count] of [[teams.opponent, "Blue", map.teamMembers], [teams.player, "Red", map.teamMembers - 1]] satisfies readonly (readonly [string, "Red" | "Blue", number])[]) {
    const members = campaign.teams.get(name.toLowerCase());
    if (members === undefined) throw new Error(`Team Arena team is missing: ${name}`);
    for (let index = 0; index < count; index++) {
      const member = field(members, index);
      bots.push({ ai: campaign.aliases.get(member.toLowerCase()) ?? "James", name: member, team, delayMilliseconds: (bots.length + 1) * 500 });
    }
  }
  const maxClients = gameType === 1 ? 2 : map.teamMembers * 2, timeToBeat = map.times.get(gameType) ?? 0;
  const values: Readonly<Record<string, string>> = { nextmap: "teamarena-results", ui_teamArenaTimeToBeat: String(timeToBeat), g_gametype: String(gameType), ui_singlePlayerActive: "1", g_spSkill: String(skill),
    sv_maxclients: String(maxClients), g_doWarmup: "1", g_warmup: "15", sv_pure: "0", g_friendlyFire: "0", g_redTeam: teams.player, g_blueTeam: teams.opponent,
    capturelimit: gameType === 6 ? "4" : gameType === 7 ? "15" : "5", fraglimit: "10",
    ui_scoreMap: map.title, ui_gameType: String(cursor.gameTypeIndex), ui_currentMap: String(cursor.mapIndex),
    ui_mapIndex: String(campaign.maps.slice(0, cursor.mapIndex).filter(row => active(row, gameType)).length), ui_teamName: teams.player, ui_opponentName: teams.opponent };
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
export async function readTeamArenaCampaign(mounts: Pick<MountedContent, "read" | "listFiles">, policy: Q3ProductPolicy): Promise<TeamArenaCampaign> {
  const files = q3TeamArenaCatalogPolicy(policy);
  const [game, teams] = await Promise.all([mounts.read(files.gameInfo), mounts.read(files.teamInfo)]);
  const campaign = parseTeamArenaCampaign(Buffer.from(game).toString("latin1"), Buffer.from(teams).toString("latin1"));
  if (!files.additionalTeams) return campaign;
  const mergedTeams = new Map(campaign.teams), aliases = new Map(campaign.aliases);
  for (const path of await mounts.listFiles("scripts", ".team")) {
    const extra = parseTeamArenaCampaign("", Buffer.from(await mounts.read(`scripts/${path}`)).toString("latin1"));
    for (const [name, members] of extra.teams) mergedTeams.set(name, members);
    for (const [name, ai] of extra.aliases) aliases.set(name, ai);
  }
  return { ...campaign, teams: mergedTeams, aliases };
}
export async function loadTeamArenaCampaign(catalog: InstalledCatalog, options: Pick<ApplicationOptions, "startupCommands" | "q3Product"> = {}): Promise<{ readonly campaign: TeamArenaCampaign; readonly q3Product: NonNullable<ApplicationOptions["q3Product"]>; readonly catalog: InstalledCatalog }> {
  const prepared = await prepareQ3ApplicationProduct(catalog, "q3-missionpack", options);
  if (prepared.q3Product === null) throw new Error("Team Arena requires a Q3 product policy");
  const product = prepared.catalog.require("q3-missionpack"), mounts = await prepared.catalog.mountsFor(product.id);
  using mounted = await openMountPlan({ id: createMountPlanId("team-arena-catalog", Buffer.from(product.id).toString("hex")), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] }, prepared.q3Product.restriction.kind === "demo" ? { q3Restriction: "demo" } : {});
  return { campaign: await readTeamArenaCampaign(mounted, prepared.q3Product.policy), q3Product: prepared.q3Product, catalog: prepared.catalog };
}
export async function readTeamArenaSkirmish(catalog: InstalledCatalog, skill: TeamArenaSkirmish["skill"] = 2,
  previous?: Pick<TeamArenaSkirmish, "map" | "gameType"> & { readonly advance?: boolean }, teams?: TeamArenaTeams,
  source?: { readonly mounts: Pick<MountedContent, "read" | "listFiles">; readonly policy: Q3ProductPolicy }): Promise<TeamArenaSkirmish> {
  let campaign: TeamArenaCampaign;
  if (source !== undefined) campaign = await readTeamArenaCampaign(source.mounts, source.policy);
  else campaign = (await loadTeamArenaCampaign(catalog)).campaign;
  return planTeamArenaSkirmish(campaign, skill, previous === undefined ? undefined : previous.advance === false ? currentTeamArenaCursor(campaign, previous) : nextTeamArenaCursor(campaign, currentTeamArenaCursor(campaign, previous)), teams);
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
