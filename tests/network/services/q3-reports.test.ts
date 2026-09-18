import { expect, test } from "bun:test";
import { Q3RankingReports, type Q3RankingReport } from "../../../src/content/q3/base/game/rankings.ts";
import { rankingAccountView } from "../../../src/ui/settings/rankings.ts";

test("Q3 donor reports suppress warmup and coalesce pellet hits without losing damage", () => {
  const reports: Q3RankingReport[] = [], source = new Q3RankingReports(); let warmup = true;
  const detach = source.attach(report => reports.push(report), () => warmup);
  source.fireWeapon(0, 5); expect(reports).toEqual([]);
  warmup = false; source.fireWeapon(0, 5);
  expect(reports.map(report => report.key)).toEqual([1111020002, 1111020502]); reports.length = 0;
  source.damage(1, 0, 10, 1, 100, true, false); source.damage(1, 0, 10, 1, 100, true, false);
  expect(reports.filter(report => report.key === 1111020004)).toHaveLength(1);
  expect(reports.filter(report => report.key === 1111020006)).toHaveLength(2);
  reports.length = 0; source.playerDie(1, 0, 6);
  expect(reports).toEqual([{kind:"integer",self:0,other:1,key:1211020000,value:1,accumulate:true},
    {kind:"integer",self:0,other:1,key:1211020500,value:1,accumulate:true}]);
  detach(); source.fireWeapon(0, 5); expect(reports).toHaveLength(2);
});

test("public account view preserves explicit provider unavailability", () => {
  expect(rankingAccountView({ service: () => ({ kind: "unavailable", reason: "SDK unavailable" }),
    player: () => ({ kind: "new" }), submit: async () => undefined, reset: async () => undefined,
    spectate: async () => undefined })).toEqual({kind:"unavailable",message:"SDK unavailable"});
});

import { ApplicationQ3Rankings } from "../../../src/app/bootstrap/q3-rankings.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { Q3EntityRecords } from "../../../src/content/q3/base/records.ts";
import { EntityPool } from "../../../src/content/q3/base/game/entities.ts";
import { GameLevel } from "../../../src/content/q3/base/game/level.ts";
import { Team } from "../../../src/content/q3/base/shared/definitions.ts";
import type { RankingServiceReport } from "../../../src/network/services/rankings.ts";

function rankingPool() {
  const actors = new SessionActorRegistry(createIdentityOwner("ranking-source")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const records = new Q3EntityRecords({ actors, bodies, combat, inventory: new SharedInventoryTable(actors), callbacks,
    foreign: () => null, isPlayer: () => false, damageCall: () => null, schedule: () => undefined, runThink: () => undefined }, "q3:base", "baseq3");
  const level = new GameLevel();
  const pool = new EntityPool({ records, product: "baseq3", maxClients: 1, mapStartTime: 0,
    time: () => level.time, print: () => undefined, link: () => undefined, unlink: () => undefined });
  pool.activateClient(0);
  return { pool, level };
}

test("TS source account activation reports gameplay and match metadata before logout", async () => {
  const { pool, level } = rankingPool();
  const reports: RankingServiceReport[] = [], cleanup: string[] = [];
  const owner = new ApplicationQ3Rankings(pool, level, {
    endpoint: new URL("https://rankings.invalid"), begin: async () => ({gameId: 1n}),
    login: async () => ({kind:"active",account:{playerId:2n,rank:3}}), join: async () => undefined,
    report: async (_match, report) => { reports.push(report); }, poll: async () => undefined,
    logout: async () => { cleanup.push("logout"); }, finish: async () => { cleanup.push("finish"); },
  }, { status: () => undefined, menu: () => undefined, spectator: slot => { pool.clientAt(slot).sess.sessionTeam = Team.TEAM_SPECTATOR; },
    activate: slot => { pool.clientAt(slot).sess.sessionTeam = Team.TEAM_FREE; }, scoreboard: () => undefined,
    dropBot: () => undefined, gameType: () => 0, cvar: name => name === "mapname" ? "q3dm1" : "0", setCvar: () => undefined });
  await owner.begin(true, false, "provider-game-key"); expect(pool.clientAt(0).sess.sessionTeam).toBe(Team.TEAM_SPECTATOR);
  await owner.accountActions(0).submit({kind:"login",username:"player",password:"not-retained"}); await owner.frame();
  expect(pool.clientAt(0).sess.sessionTeam).toBe(Team.TEAM_FREE);
  pool.rankings.fireWeapon(0, 5); await owner.frame(); await owner.gameOver(); await owner.close();
  expect(reports[0]).toEqual({kind:"integer",self:2n,other:0n,key:1111020002,value:1,accumulate:true});
  expect(reports).toContainEqual({kind:"string",self:0n,other:0n,key:1000010001,value:"q3dm1"});
  expect(cleanup).toEqual(["logout","finish"]);
});

import { registerRankingAccountMenu } from "../../../src/ui/settings/ranking-account.ts";
import { NativeUiController, defaultUiSkin } from "../../../src/ui/common/index.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import type { RankingAccountRequest } from "../../../src/network/services/rankings.ts";

test("ranking account menu submits through real seat keyboard controls and clears drafts on close", async () => {
  const seat = createIdentityOwner("ranking-menu").seat(0), requests: RankingAccountRequest[] = [];
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"),
    bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  const menu = registerRankingAccountMenu(ui, () => ({ service: () => ({kind:"active",gameId:1n}), player: () => ({kind:"new"}),
    submit: async request => { requests.push(request); }, reset: async () => undefined, spectate: async () => undefined }));
  const key = (code: number): void => { ui.input({kind:"key",seat,timeMilliseconds:0,code,down:true,repeat:false}); };
  ui.openMenu(menu.root); ui.input({kind:"text",seat,timeMilliseconds:0,text:"player"}); key(KeyCode.Tab);
  ui.input({kind:"text",seat,timeMilliseconds:0,text:"secret"}); key(KeyCode.Tab); key(KeyCode.Tab); key(KeyCode.Tab); key(KeyCode.Enter);
  await Promise.resolve(); await Promise.resolve();
  expect(requests).toEqual([{kind:"login",username:"player",password:"secret"}]);
  ui.closeMenu(); ui.openMenu(menu.root); key(KeyCode.Tab); key(KeyCode.Tab); key(KeyCode.Tab); key(KeyCode.Tab); key(KeyCode.Enter);
  await Promise.resolve(); expect(requests).toHaveLength(1); menu.dispose(); expect(ui.activeMenu).toBeNull();
});

test("ranking backpressure marks optional service unavailable without throwing into source gameplay", async () => {
  const {pool,level} = rankingPool(), states: string[] = [], cleanup: string[] = [];
  const owner = new ApplicationQ3Rankings(pool,level,{
    endpoint:new URL("https://rankings.invalid"),begin:async()=>({gameId:1n}),
    login:async()=>({kind:"active",account:{playerId:2n,rank:1}}),join:async()=>undefined,report:async()=>undefined,poll:async()=>undefined,
    logout:async()=>{cleanup.push("logout");},finish:async()=>{cleanup.push("finish");},
  },{status:()=>undefined,serviceStatus:state=>{states.push(state.kind);},menu:()=>undefined,spectator:()=>undefined,
    activate:()=>undefined,scoreboard:()=>undefined,dropBot:()=>undefined,gameType:()=>0,cvar:()=>"0",setCvar:()=>undefined});
  await owner.begin(true,false,"configured-provider-key"); await owner.account(0,{kind:"login",username:"player",password:"secret"});
  expect(()=>{for(let i=0;i<33000;i++)pool.rankings.fireWeapon(0,5);}).not.toThrow();
  expect(owner.lifecycle.state().kind).toBe("unavailable"); expect(states.at(-1)).toBe("unavailable");
  await owner.frame(); await owner.close(); expect(cleanup).toEqual(["logout","finish"]);
});
