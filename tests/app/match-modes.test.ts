import { parseTeamArenaCampaign, planTeamArenaSkirmish } from "../../src/app/bootstrap/team-arena-skirmish.ts";
import { expect, test } from "bun:test";
import { matchMapUnavailable, matchModeUnavailable } from "../../src/app/bootstrap/match-modes.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { sourceQ2MatchSelection } from "../../src/content/composition/q2/match-selection.ts";
import { registerQ2ServerCvars, q2SourceDeathmatchFlags } from "../../src/settings/server/q2-owner.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { adaptForeignQ3Objectives } from "../../src/content/q3/team-arena/foreign-objectives.ts";
import { parseQ1Entities, q1EntityValue } from "../../src/formats/q1-map/entities.ts";
import { parseBaseArenaCatalog } from "../../src/app/bootstrap/base-arena-catalog.ts";

test("source mode admission and authored map eligibility reject incompatible modes before launch", () => {
  const q2 = { family: "q2", edition: "rerelease", campaign: "baseq2", mode: "deathmatch", rules: "deathball" } satisfies Parameters<typeof matchModeUnavailable>[0];
  expect(matchModeUnavailable(q2)).toBeNull();
  expect(matchMapUnavailable(q2, ["info_player_deathmatch"])).toContain("dm_dball_ball");
  expect(matchMapUnavailable(q2, ["dm_dball_ball", "dm_dball_ball_start", "dm_dball_goal", "dm_dball_team1_start", "dm_dball_team2_start"])).toBeNull();
  expect(matchModeUnavailable({ ...q2, mode: "coop" })).toContain("deathmatch");
  expect(matchMapUnavailable({ family: "q1", edition: "rerelease", campaign: "mg1", mode: "coop", rules: "horde" }, ["horde_manager", "info_monster_start"])).toBeNull();
  expect(matchModeUnavailable({ family: "q1", edition: "classic", campaign: "id1", mode: "coop", rules: "horde" })).toContain("rerelease");
  for (const rules of ["tag", "deathball", "horde"]) expect(parseApplicationCommand(["--rules", rules]).kind).not.toBe("error");
});
test("DeathBall selection uses source cvar defaults and remains live", () => {
  const id = createIdentityOwner("mode-selection"), cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: id.session, origin: { kind: "server-console" } } });
  registerQ2ServerCvars(cvars, "q2:deathball");
  const selected = sourceQ2MatchSelection("q2:deathball", cvars);
  expect(selected.kind).toBe("deathball"); if (selected.kind !== "deathball") throw new Error("Wrong mode");
  expect(selected.team1Skin).toBe("male/ctf_r"); expect(selected.team2Skin).toBe("male/ctf_b");
  cvars.set("goallimit", "3"); expect(selected.goalLimit).toBe(3);
  expect(sourceQ2MatchSelection("q2:tag", cvars)).toEqual({ kind: "tag" });
});
test("foreign CTF translation retains authored anchors and requires explicit neutral objectives", () => {
  const world = { kind: "q2-bsp", entities: '{ "classname" "worldspawn" } { "classname" "item_flag_team1" "origin" "10 20 30" } { "classname" "item_flag_team2" "origin" "90 20 30" } { "classname" "info_player_team1" "origin" "0 0 24" } { "classname" "info_player_deathmatch" "origin" "40 40 24" }' } satisfies Parameters<typeof adaptForeignQ3Objectives>[0];
  const ctf = adaptForeignQ3Objectives(world, "baseq3", 4);
  expect(ctf.kind).toBe("ready"); if (ctf.kind !== "ready") throw new Error("Missing flags");
  const entities = parseQ1Entities(ctf.entities);
  expect(entities.find(row => q1EntityValue(row, "classname") === "team_CTF_redflag")?.properties).toContainEqual({ key: "origin", value: "10 20 30" });
  expect(entities.some(row => q1EntityValue(row, "classname") === "team_CTF_redspawn")).toBe(true);
  expect(adaptForeignQ3Objectives(world, "missionpack", 5)).toEqual({ kind: "missing-objectives", classnames: ["team_CTF_neutralflag"] });
  expect(adaptForeignQ3Objectives(world, "missionpack", 5, [{ classname: "team_CTF_neutralflag", origin: { x: 50, y: 40, z: 24 } }]).kind).toBe("ready");
});
test("base arenas retain donor tier numbering and special launch selection", () => {
  const catalog = parseBaseArenaCatalog(['{ map q3dm0 type single special Training bots crash fraglimit 5 }\n' + [1, 2, 3, 4].map(n => `{ map q3dm${n} type single bots ranger }`).join("\n") + '\n{ map q3tourney6 type single special Final bots xaero }']);
  expect(catalog.regularCount).toBe(4); expect(catalog.tierCount).toBe(1);
  expect(catalog.arenas.find(row => row.special === "Training")).toMatchObject({ number: 4, selection: -4, bots: ["crash"], fragLimit: 5 });
  expect(catalog.arenas.find(row => row.special === "Final")).toMatchObject({ number: 5, selection: 4 });
});

test("Q3 team spawns remain eligible without a free-for-all spawn", () => {
  expect(matchMapUnavailable({ family: "q3", edition: "classic", campaign: "baseq3", mode: "deathmatch", rules: "standard" }, ["team_CTF_redplayer", "team_CTF_blueplayer"])).toBeNull();
});
test("rerelease named combat settings drive existing source flag consumers", () => {
  const id = createIdentityOwner("rerelease-flags"), cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: id.session, origin: { kind: "server-console" } } });
  registerQ2ServerCvars(cvars, "q2:standard"); cvars.set("dmflags", "256");
  expect(q2SourceDeathmatchFlags(cvars)).toBe(256 | 16 | 16384);
  cvars.set("g_dm_weapons_stay", "1"); cvars.set("g_dm_same_level", "1"); cvars.set("g_dm_no_quad_drop", "1");
  expect(q2SourceDeathmatchFlags(cvars)).toBe(256 | 16 | 4 | 32);
  expect(cvars.variableValue("g_weapon_respawn_time")).toBe(30);
  cvars.set("g_instant_weapon_switch", "1"); cvars.applyLatched(); expect(cvars.variableValue("g_instant_weapon_switch")).toBe(1);
});
test("Team Arena team choice drives authored rosters without changing admission order", () => {
  const campaign = parseTeamArenaCampaign('gametypes { { CTF 4 } } maps { { Arena arena 2 Boss 2 0 4 90 } }', 'teams { { Alpha icon A B C D E } { Beta icon F G H I J } } aliases { { A Sarge } { B Visor } { F Ranger } { G Major } }');
  const setup = planTeamArenaSkirmish(campaign, 3, { gameTypeIndex: 0, mapIndex: 0 }, { player: "Beta", opponent: "Alpha" });
  expect(setup.bots.map(bot => [bot.name, bot.team, bot.delayMilliseconds])).toEqual([["A", "Blue", 500], ["B", "Blue", 1000], ["F", "Red", 1500]]);
  expect(setup.cvars.find(row => row.name === "g_redTeam")?.value).toBe("Beta");
  expect(setup.cvars.find(row => row.name === "ui_opponentName")?.value).toBe("Alpha");
});
