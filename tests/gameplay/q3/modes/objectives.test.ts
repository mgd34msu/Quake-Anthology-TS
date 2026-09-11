import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { Q3EntityRecords } from "../../../../src/content/q3/base/records.ts";
import { EntityPool } from "../../../../src/content/q3/base/game/entities.ts";
import { ConnectionState } from "../../../../src/content/q3/base/game/state.ts";
import type { ServerWorld } from "../../../../src/content/q3/base/world.ts";
import { GameType, PersistentIndex, Powerup, Team } from "../../../../src/content/q3/base/shared/definitions.ts";
import { findItemForPowerup } from "../../../../src/content/q3/base/shared/items.ts";
import { PlayerStateSlots } from "../../../../src/content/q3/base/shared/player-state.ts";
import { FlagStatus, TeamRuntime } from "../../../../src/content/q3/team-arena/team.ts";

function objectiveGame(gameType: GameType) {
  const actors = new SessionActorRegistry(createIdentityOwner("objective-smoke"));
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
    onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined,
  });
  const inventory = new SharedInventoryTable(actors);
  const records = new Q3EntityRecords({ actors, bodies, combat, inventory, callbacks,
    schedule: () => undefined, runThink: () => { throw new Error("Objective touch unexpectedly requested a think"); },
    damageCall: () => null, foreign: () => null }, "q3:mode-smoke", "missionpack");
  const world: ServerWorld = {
    trace: () => { throw new Error("Objective touch unexpectedly requested a trace"); },
    pointContents: () => 0, areaEntities: () => [], entityContact: () => false,
    link: entity => { bodies.link(entity.actor); },
    unlink: number => { const entity = records.get(number); if (entity?.inuse) bodies.unlink(entity.actor); },
    linkState: number => {
      const entity = records.get(number), linked = entity === undefined || !entity.inuse ? null : bodies.linked(entity.actor.id);
      return linked === null ? undefined : { absbounds: linked.absoluteBounds, linked: true, linkcount: linked.linkCount };
    },
  };
  const pool = new EntityPool({ records, product: "missionpack", maxClients: 2,
    mapStartTime: 0, time: () => 30000, print: () => {}, link: entity => world.link(entity), unlink: entity => world.unlink(entity.slot) });
  const red = pool.activateClient(0), blue = pool.activateClient(1);
  const redClient = pool.clientAt(0), blueClient = pool.clientAt(1);
  redClient.pers.connected = blueClient.pers.connected = ConnectionState.CONNECTED;
  redClient.sess.sessionTeam = Team.TEAM_RED;
  blueClient.sess.sessionTeam = Team.TEAM_BLUE;
  redClient.pers.netname = "red";
  blueClient.pers.netname = "blue";
  red.health = blue.health = 100;
  const teamScores = new PlayerStateSlots(4), config = new Map<number, string>(), messages: string[] = [];
  const team = new TeamRuntime({ product: "missionpack", pool, world, gameType, time: 30000,
    teamScores, sortedClients: [0, 1], locationHead: null,
    obelisk: { health: 2500, regenPeriodSeconds: 1, regenAmount: 15, respawnDelaySeconds: 10 },
    sendServerCommand: (_client, text) => { messages.push(text); }, setConfigstring: (index, text) => { config.set(index, text); },
    warn: text => { throw new Error(text); },
    addScore: (entity, _origin, score) => {
      const client = entity.client;
      if (client === null) throw new Error("Score recipient has no player state");
      client.ps.persistant.set(PersistentIndex.PERS_SCORE, client.ps.persistant.get(PersistentIndex.PERS_SCORE) + score);
    },
    calculateRanks: () => {}, respawnItem: entity => { entity.r.svFlags &= ~1; }, inPVS: () => true,
  });
  team.initGame();
  return { actors, pool, red, redClient, team, teamScores, config, messages, combat };
}

test("Team Arena flag pickup and capture mutate the admitted player's source state", () => {
  const game = objectiveGame(GameType.GT_CTF);
  const redFlag = game.pool.spawn(), blueFlag = game.pool.spawn();
  redFlag.classname = "team_CTF_redflag";
  redFlag.item = findItemForPowerup("missionpack", Powerup.PW_REDFLAG);
  blueFlag.classname = "team_CTF_blueflag";
  blueFlag.item = findItemForPowerup("missionpack", Powerup.PW_BLUEFLAG);
  expect(game.team.pickupTeam(blueFlag, game.red)).toBe(-1);
  expect(game.team.state.blueStatus).toBe(FlagStatus.TAKEN);
  expect(game.redClient.ps.powerups.get(Powerup.PW_BLUEFLAG)).toBe(2147483647);
  expect(game.redClient.ps.persistant.get(PersistentIndex.PERS_SCORE)).toBe(10);
  game.team.pickupTeam(redFlag, game.red);
  expect(game.teamScores.get(Team.TEAM_RED)).toBe(1);
  expect(game.redClient.ps.persistant.get(PersistentIndex.PERS_SCORE)).toBe(110);
  expect(game.redClient.ps.persistant.get(PersistentIndex.PERS_CAPTURES)).toBe(1);
  expect(game.redClient.ps.powerups.get(Powerup.PW_BLUEFLAG)).toBe(0);
  expect(game.config.get(23)).toBe("00");
  expect(game.combat.read(game.red.actor.id)?.health).toBe(100);
  game.actors.close();
});

test("Harvester deposits carried skulls into the opposing obelisk once", () => {
  const game = objectiveGame(GameType.GT_HARVESTER);
  const destination = game.pool.spawn();
  destination.spawnflags = Team.TEAM_BLUE;
  game.redClient.ps.generic1 = 3;
  const trace = { fraction: 0, end: { x: 0, y: 0, z: 0 }, entityNum: 0, contents: 0, surfaceFlags: 0,
    solidity: "clear", contact: { kind: "none" } } satisfies Parameters<typeof game.team.obeliskTouch>[2];
  game.team.obeliskTouch(destination, game.red, trace);
  game.team.obeliskTouch(destination, game.red, trace);
  expect(game.teamScores.get(Team.TEAM_RED)).toBe(3);
  expect(game.redClient.ps.persistant.get(PersistentIndex.PERS_SCORE)).toBe(300);
  expect(game.redClient.ps.persistant.get(PersistentIndex.PERS_CAPTURES)).toBe(3);
  expect(game.redClient.ps.generic1).toBe(0);
  game.actors.close();
});
