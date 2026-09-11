import type { Q2MissionPackItemsCheckpoint } from "../content/q2/missionpacks/items.ts";
import type { Q2MissionPackMonstersCheckpoint } from "../content/q2/missionpacks/monsters/state.ts";
import type { Q2RogueEntitiesCheckpoint } from "../content/q2/missionpacks/entities/rogue.ts";
import type { Q2TagCheckpoint } from "../content/q2/missionpacks/modes/tag.ts";
import type { Q2DeathBallCheckpoint } from "../content/q2/missionpacks/modes/deathball.ts";
import { decodeQ2RogueHintsCheckpoint } from "../content/q2/missionpacks/monsters/hints.ts";
import { readSavedActor } from "./save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

export function readQ2MissionPackItemsCheckpoint(reader: SaveReader): Q2MissionPackItemsCheckpoint {
  return { powers: reader.field("powers").list(value => { const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: { quadFireUntil: state.field("quadFireUntil").number(), doubleUntil: state.field("doubleUntil").number(), irUntil: state.field("irUntil").number() } }; }) };
}
export function encodeQ2MissionPackItemsCheckpoint(checkpoint: Q2MissionPackItemsCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2MissionPackItemsCheckpoint(bytes: Uint8Array): Q2MissionPackItemsCheckpoint { return readQ2MissionPackItemsCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-missionpack-items")); }
export function readQ2MissionPackMonstersCheckpoint(reader: SaveReader): Q2MissionPackMonstersCheckpoint {
  return { version: reader.field("version").literal(1), flyerNextMove: reader.field("flyerNextMove").choice("none", "run"), hints: reader.field("hints").nullable(decodeQ2RogueHintsCheckpoint), widowShotsFired: reader.field("widowShotsFired").number(), widowDamageMultiplier: reader.field("widowDamageMultiplier").choice(1, 2, 4), actors: reader.field("actors").list(value => { const state = value.field("state"); return { actor: readSavedActor(value.field("actor")), state: { blocked: state.field("blocked").boolean(), turretOrientation: state.field("turretOrientation").number(), healer: state.field("healer").nullable(readSavedActor), badMedic1: state.field("badMedic1").nullable(readSavedActor), badMedic2: state.field("badMedic2").nullable(readSavedActor), medicTries: state.field("medicTries").number(), chosenReinforcements: [...state.field("chosenReinforcements").list(value => { const index = value.integer(0); if (index >= 255) value.fail("expected a reinforcement index below 255"); return index; })], reactToDamageTime: state.field("reactToDamageTime").finite(), summonStrength: state.field("summonStrength").number(), lastPlayerEnemy: state.field("lastPlayerEnemy").nullable(readSavedActor), badArea: state.field("badArea").nullable(readSavedActor), goodGuy: state.field("goodGuy").boolean(), widowQuadUntil: state.field("widowQuadUntil").number(), widowDoubleUntil: state.field("widowDoubleUntil").number(), widowInvulnerableUntil: state.field("widowInvulnerableUntil").number() } }; }) };
}
export function encodeQ2MissionPackMonstersCheckpoint(checkpoint: Q2MissionPackMonstersCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2MissionPackMonstersCheckpoint(bytes: Uint8Array): Q2MissionPackMonstersCheckpoint { return readQ2MissionPackMonstersCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-missionpack-monsters")); }

export function readQ2RogueEntitiesCheckpoint(reader: SaveReader): Q2RogueEntitiesCheckpoint { return { steamId: reader.field("steamId").number() }; }
export function encodeQ2RogueEntitiesCheckpoint(checkpoint: Q2RogueEntitiesCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2RogueEntitiesCheckpoint(bytes: Uint8Array): Q2RogueEntitiesCheckpoint { return readQ2RogueEntitiesCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-rogue-entities")); }
export function readQ2TagCheckpoint(reader: SaveReader): Q2TagCheckpoint {
  return { token: reader.field("token").nullable(readSavedActor), owner: reader.field("owner").nullable(readSavedActor), count: reader.field("count").number() };
}
export function encodeQ2TagCheckpoint(checkpoint: Q2TagCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2TagCheckpoint(bytes: Uint8Array): Q2TagCheckpoint { return readQ2TagCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-tag")); }
export function readQ2DeathBallCheckpoint(reader: SaveReader): Q2DeathBallCheckpoint {
  return { ball: reader.field("ball").nullable(readSavedActor), starts: reader.field("starts").number(), team1Score: reader.field("team1Score").number(), team2Score: reader.field("team2Score").number() };
}
export function encodeQ2DeathBallCheckpoint(checkpoint: Q2DeathBallCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2DeathBallCheckpoint(bytes: Uint8Array): Q2DeathBallCheckpoint { return readQ2DeathBallCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-deathball")); }
