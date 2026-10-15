import { expect, test } from "bun:test";
import type { PcmSound } from "../../../../src/audio/wav.ts";
import { EntityEvent, EntityType, GameType, Weapon } from "../../../../src/content/q3/base/shared/definitions.ts";
import { TrajectoryType } from "../../../../src/content/q3/base/shared/trajectory.ts";
import { ClientEventRuntime, type ClientEventHost, type ClientEventSound } from "../../../../src/content/q3/presentation/events.ts";
import { retailSnapshot } from "../../../../src/content/q3/presentation/retail-snapshot.ts";
import { ClientGameState } from "../../../../src/content/q3/presentation/state.ts";
import { PlayerStateRecord } from "../../../../src/network/q3/state/player.ts";
import type { Snapshot } from "../../../../src/network/q3/server-message.ts";

test("snapshot weapon events prepare their weapon media before emitting effects", async () => {
  const state = new ClientGameState("baseq3", 0, 0);
  const playerState = new PlayerStateRecord<number, number, number>("baseq3", 0, 0, 0);
  const input: Snapshot = { messageNumber: 1, serverTime: 1000, deltaNumber: 0, flags: 0, serverCommandNumber: 0,
    parseEntitiesNumber: 0, areaMask: new Uint8Array(32), playerState, entities: [] };
  state.snap = retailSnapshot(input);
  state.time = 1000;

  const calls: string[] = [];
  const silent: readonly [PcmSound | null, PcmSound | null, PcmSound | null, PcmSound | null] = [null, null, null, null];
  const sounds: Record<ClientEventSound, PcmSound | null> = {
    useNothingSound: null, medkitSound: null, landSound: null, jumpPadSound: null,
    watrInSound: null, watrOutSound: null, watrUnSound: null, n_healthSound: null, selectSound: null,
    teleInSound: null, teleOutSound: null, respawnSound: null, hgrenb1aSound: null, hgrenb2aSound: null,
    captureYourTeamSound: null, captureOpponentSound: null, returnYourTeamSound: null, returnOpponentSound: null,
    blueFlagReturnedSound: null, redFlagReturnedSound: null, enemyTookYourFlagSound: null, yourTeamTookEnemyFlagSound: null,
    yourBaseIsUnderAttackSound: null, redScoredSound: null, blueScoredSound: null, redLeadsSound: null, blueLeadsSound: null,
    teamsTiedSound: null, quadSound: null, protectSound: null, regenSound: null, gibSound: null,
  };
  const host: ClientEventHost = {
    product: "baseq3",
    presentEvent: (_entity, _position, source) => source(),
    prepareWeapon: async weapon => { calls.push(`prepare:${weapon}`); },
    media: { sounds, footsteps: { normal: silent, boot: silent, flesh: silent, mech: silent, energy: silent, metal: silent, splash: silent }, gameSounds: [], smokePuffShader: null },
    options: { gameType: GameType.GT_FFA, debugEvents: false, footsteps: false, autoswitch: false,
      demoPlayback: false, noPredict: false, synchronousClients: false, singlePlayerActive: false, cameraOrbit: false },
    random: { rand: () => 0 },
    entities: { setEntitySoundPosition: () => {}, beam: () => {} },
    weapons: {
      outOfAmmoChange: () => { calls.push("outOfAmmo"); },
      fireWeapon: () => { calls.push("fire"); },
      missileHitPlayer: () => { calls.push("missileHitPlayer"); },
      missileHitWall: () => { calls.push("missileHitWall"); },
      railTrail: () => { calls.push("railTrail"); },
      bullet: () => { calls.push("bullet"); },
      shotgunFire: () => { calls.push("shotgun"); },
    },
    effects: { smokePuff: () => { throw new Error("unexpected smoke"); }, spawnEffect: () => { throw new Error("unexpected spawn effect"); }, gibPlayer: () => {}, scorePlum: () => {} },
    clientInfo: () => ({ gender: "male", footsteps: "normal", team: 0, medkitUsageTime: 0 }),
    playerName: () => null,
    soundConfigString: () => "",
    customSound: () => null,
    registerSound: () => null,
    startSound: () => {},
    stopLoopingSound: () => {},
    addBufferedSound: () => {},
    print: () => {},
    centerPrint: () => {},
  };
  const events = new ClientEventRuntime(state, host);

  const rail = state.entityAt(5);
  rail.previousEvent = 0;
  rail.currentState.eType = EntityType.ET_EVENTS + EntityEvent.EV_RAILTRAIL;
  rail.currentState.eventParm = 255;
  rail.currentState.clientNum = 0;
  rail.currentState.pos = { type: TrajectoryType.TR_STATIONARY, time: 1000, duration: 0,
    base: { x: 200, y: 0, z: 0 }, delta: { x: 0, y: 0, z: 0 } };
  rail.currentState.origin2 = { x: 0, y: 0, z: 0 };
  await events.checkEvents(rail);
  expect(calls).toEqual([`prepare:${Weapon.WP_RAILGUN}`, "railTrail"]);

  calls.length = 0;
  const missile = state.entityAt(6);
  missile.previousEvent = 0;
  missile.currentState.eType = EntityType.ET_EVENTS + EntityEvent.EV_MISSILE_MISS;
  missile.currentState.weapon = Weapon.WP_ROCKET_LAUNCHER;
  missile.currentState.eventParm = 0;
  missile.currentState.pos = { type: TrajectoryType.TR_STATIONARY, time: 1000, duration: 0,
    base: { x: 10, y: 0, z: 0 }, delta: { x: 0, y: 0, z: 0 } };
  await events.checkEvents(missile);
  expect(calls).toEqual([`prepare:${Weapon.WP_ROCKET_LAUNCHER}`, "missileHitWall"]);
});
