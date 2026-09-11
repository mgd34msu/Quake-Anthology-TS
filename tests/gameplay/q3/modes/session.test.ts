import { expect, test } from "bun:test";
import { GameClient, ConnectionState, SpectatorState } from "../../../../src/content/q3/base/game/state.ts";
import { GameType, Team } from "../../../../src/content/q3/base/shared/definitions.ts";
import { CommandButtons, PlayerStateSlots } from "../../../../src/content/q3/base/shared/player-state.ts";
import { GameSessionManager, pickTeam } from "../../../../src/content/q3/team-arena/session.ts";
import type { SessionWorldState, SessionCvarName } from "../../../../src/content/q3/team-arena/session.ts";
import { clientIntermissionThink } from "../../../../src/content/q3/team-arena/client-policy.ts";
import { checkObjectivePlacements } from "../../../../src/content/q3/team-arena/objective-placement.ts";

test("team autojoin uses population then source team score and persists sessions", () => {
  const red = new GameClient("missionpack"), blue = new GameClient("missionpack"), joining = new GameClient("missionpack");
  red.pers.connected = blue.pers.connected = ConnectionState.CONNECTED;
  red.sess.sessionTeam = Team.TEAM_RED;
  blue.sess.sessionTeam = Team.TEAM_BLUE;
  const teamScores = new PlayerStateSlots(4);
  teamScores.set(Team.TEAM_BLUE, 2);
  const world: SessionWorldState = { clients: [red, blue, joining], maxClients: 3, teamScores,
    gameType: GameType.GT_CTF, teamAutoJoin: true, maxGameClients: 0, time: 24000,
    numNonSpectatorClients: 2, newSession: false };
  const values = new Map<SessionCvarName, string>();
  const broadcasts: number[] = [];
  const manager = new GameSessionManager(world, {
    cvars: { get: name => values.get(name) ?? "", set: (name, value) => { values.set(name, value); } },
    print: () => { throw new Error("Unexpected session warning"); },
    broadcastTeamChange: clientNum => { broadcasts.push(clientNum); },
  });
  expect(pickTeam(world, -1)).toBe(Team.TEAM_RED);
  manager.initializeClient(2, { valueForKey: () => "" });
  expect(joining.sess.sessionTeam).toBe(Team.TEAM_RED);
  expect(broadcasts).toEqual([2]);
  expect(values.get("session2")).toBe("1 24000 1 0 0 0 0");
  joining.sess.wins = 3;
  joining.sess.losses = 1;
  joining.sess.teamLeader = 1;
  manager.writeClient(2);
  joining.sess.wins = joining.sess.losses = joining.sess.teamLeader = 0;
  manager.readClient(2);
  expect([joining.sess.wins, joining.sess.losses, joining.sess.teamLeader]).toEqual([3, 1, 1]);
});

test("duel admission queues the third player and intermission waits for a new button press", () => {
  const client = new GameClient("baseq3");
  const world: SessionWorldState = { clients: [client], maxClients: 1, teamScores: new PlayerStateSlots(4),
    gameType: GameType.GT_TOURNAMENT, teamAutoJoin: false, maxGameClients: 0, time: 100,
    numNonSpectatorClients: 2, newSession: false };
  const manager = new GameSessionManager(world, {
    cvars: { get: () => "", set: () => {} },
    print: () => {}, broadcastTeamChange: () => { throw new Error("Unexpected team broadcast"); },
  });
  manager.initializeClient(0, { valueForKey: () => "" });
  expect(client.sess.sessionTeam).toBe(Team.TEAM_SPECTATOR);
  expect(client.sess.spectatorState).toBe(SpectatorState.FREE);
  client.buttons = CommandButtons.ATTACK;
  client.pers.cmd.buttons = CommandButtons.ATTACK;
  clientIntermissionThink(client);
  expect(client.readyToExit).toBe(false);
  client.pers.cmd.buttons = 0;
  clientIntermissionThink(client);
  client.pers.cmd.buttons = CommandButtons.ATTACK;
  clientIntermissionThink(client);
  expect(client.readyToExit).toBe(true);
});

test("foreign-map objective requirements stay explicit for each Team Arena mode", () => {
  const flags = [{ classname: "team_CTF_redflag" }, { classname: "team_CTF_blueflag" }];
  expect(checkObjectivePlacements("baseq3", GameType.GT_CTF, flags)).toEqual({ kind: "ready" });
  expect(checkObjectivePlacements("missionpack", GameType.GT_1FCTF, flags)).toEqual({
    kind: "missing-objectives", classnames: ["team_CTF_neutralflag"],
  });
  const obelisks = [{ classname: "team_redobelisk" }, { classname: "team_blueobelisk" }];
  expect(checkObjectivePlacements("missionpack", GameType.GT_OBELISK, obelisks)).toEqual({ kind: "ready" });
  expect(checkObjectivePlacements("missionpack", GameType.GT_HARVESTER, obelisks)).toEqual({
    kind: "missing-objectives", classnames: ["team_neutralobelisk"],
  });
  expect(checkObjectivePlacements("baseq3", GameType.GT_HARVESTER, obelisks).kind).toBe("unsupported-mode");
});
