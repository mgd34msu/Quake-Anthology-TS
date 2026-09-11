import type { ProviderCheckpoint } from "../../../contracts/session.ts";
import { decodeQ2FoundationCheckpoint, encodeQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { decodeQ2ItemsCheckpoint, encodeQ2ItemsCheckpoint } from "../../../persistence/q2-items.ts";
import { decodeQ2MoversCheckpoint, encodeQ2MoversCheckpoint } from "../../../persistence/q2-movers.ts";
import { decodeQ2MonstersCheckpoint, encodeQ2MonstersCheckpoint } from "../../../persistence/q2-monsters.ts";
import { decodeQ2WeaponsCheckpoint, encodeQ2WeaponsCheckpoint } from "../../../persistence/q2-weapons.ts";
import { decodeQ2PlayersCheckpoint, encodeQ2PlayersCheckpoint } from "../../../persistence/q2-players.ts";
import { decodeQ2MissionPackItemsCheckpoint, encodeQ2MissionPackItemsCheckpoint, decodeQ2MissionPackMonstersCheckpoint, encodeQ2MissionPackMonstersCheckpoint } from "../../../persistence/q2-missionpacks.ts";
import { decodeQ2RereleasePlayersCheckpoint, encodeQ2RereleasePlayersCheckpoint, decodeQ2RereleaseModuleCheckpoint, encodeQ2RereleaseModuleCheckpoint } from "../../../persistence/q2-rerelease-state.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../persistence/value.ts";
import type { Q2ProductRuntime } from "./index.ts";
import { Q2Tag, Q2DeathBall } from "../../q2/missionpacks/modes/index.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { encodeQ2BaseEntitiesCheckpoint, decodeQ2BaseEntitiesCheckpoint } from "../../../persistence/q2-base-entities.ts";

/** Shared tables are saved by the session. These records contain source-private state only. */
export function captureQ2Product(source: Q2ProductRuntime): readonly ProviderCheckpoint[] {
  const records: ProviderCheckpoint[] = [];
  const add = (schema: ProviderCheckpoint["schema"], bytes: Uint8Array): undefined => {
    records.push({ provider: source.game.options.provider, schema, version: 1, bytes }); return undefined;
  };
  add("q2:composition", encodeCheckpointValue({ edition: source.configuration.edition, program: source.configuration.program, match: source.match.selection, deathmatchFlags: source.game.options.deathmatchFlags }));
  add("q2:foundation", encodeQ2FoundationCheckpoint(source.game.capture()));
  add("q2:items", encodeQ2ItemsCheckpoint(source.items.capture(source.game)));
  add("q2:movers", encodeQ2MoversCheckpoint(source.movers.capture(source.game)));
  add("q2:monsters", encodeQ2MonstersCheckpoint(source.monsters.capture()));
  add("q2:weapons", encodeQ2WeaponsCheckpoint(source.weapons.capture(source.game)));
  add("q2:players", encodeQ2PlayersCheckpoint(source.players.capture()));
  add("q2:base-entities", encodeQ2BaseEntitiesCheckpoint(source.baseEntities.capture(source.game)));
  if (source.armory !== null) add("q2:missionpack-items", encodeQ2MissionPackItemsCheckpoint(source.armory.items.capture(source.game)));
  for (const expansion of source.expansions) {
    add(`q2:${expansion.pack}-monsters`, encodeQ2MissionPackMonstersCheckpoint(expansion.monsters.capture(source.game)));
    add(`q2:${expansion.pack}-entities`, encodeCheckpointValue(expansion.entities.capture()));
  }
  if (source.rerelease !== null) {
    add("q2:rerelease-players", encodeQ2RereleasePlayersCheckpoint(source.rerelease.players.captureRerelease()));
    add("q2:rerelease-entities", encodeQ2RereleaseModuleCheckpoint(source.rerelease.entities.capture()));
  }
  if (source.match.source !== null) add("q2:match", encodeCheckpointValue(source.match.source.capture()));
  return records;
}

/** The caller restores shared actor/body/combat/inventory identities before this operation. */
export function restoreQ2Product(source: Q2ProductRuntime, checkpoints: readonly ProviderCheckpoint[]): undefined {
  const read = (schema: ProviderCheckpoint["schema"]): Uint8Array => {
    const records = checkpoints.filter(record => record.provider === source.game.options.provider && record.schema === schema);
    const record = records[0];
    if (record === undefined || records.length !== 1 || record.version !== 1) throw new Error(`Missing or incompatible Q2 source checkpoint ${schema}`);
    return record.bytes;
  };
  const selection = new SaveReader(decodeCheckpointValue(read("q2:composition")), "q2-composition");
  if (selection.field("edition").choice("classic", "rerelease") !== source.configuration.edition || selection.field("program").choice("baseq2", "xatrix", "rogue", "mg2", "n64") !== source.configuration.program)
    throw new Error("Q2 checkpoint belongs to a different source product");
  const matchSelection = selection.field("match");
  if (matchSelection.field("kind").choice("standard", "tag", "deathball") !== source.match.selection.kind) throw new Error("Q2 checkpoint belongs to a different source match mode");
  if (source.match.selection.kind === "deathball" && (matchSelection.field("team1Skin").string() !== source.match.selection.team1Skin
    || matchSelection.field("team2Skin").string() !== source.match.selection.team2Skin || matchSelection.field("goalLimit").number() !== source.match.selection.goalLimit))
    throw new Error("Q2 checkpoint belongs to different DeathBall rules");
  const deathmatchFlags = selection.field("deathmatchFlags").integer(0);
  const foundation = decodeQ2FoundationCheckpoint(read("q2:foundation"));
  const items = decodeQ2ItemsCheckpoint(read("q2:items"));
  const movers = decodeQ2MoversCheckpoint(read("q2:movers"));
  const monsters = decodeQ2MonstersCheckpoint(read("q2:monsters"));
  const weapons = decodeQ2WeaponsCheckpoint(read("q2:weapons"));
  const players = decodeQ2PlayersCheckpoint(read("q2:players"));
  const baseEntities = decodeQ2BaseEntitiesCheckpoint(read("q2:base-entities"));
  const armory = source.armory === null ? null : { module: source.armory.items, checkpoint: decodeQ2MissionPackItemsCheckpoint(read("q2:missionpack-items")) };
  const expansions = source.expansions.map(expansion => ({ module: expansion,
    monsters: decodeQ2MissionPackMonstersCheckpoint(read(`q2:${expansion.pack}-monsters`)),
    entities: { steamId: new SaveReader(decodeCheckpointValue(read(`q2:${expansion.pack}-entities`)), "q2-missionpack-entities").field("steamId").integer() },
  }));
  const rerelease = source.rerelease === null ? null : { module: source.rerelease,
    players: decodeQ2RereleasePlayersCheckpoint(read("q2:rerelease-players")),
    entities: decodeQ2RereleaseModuleCheckpoint(read("q2:rerelease-entities")),
  };
  const match = source.match.source === null ? null : { module: source.match.source, reader: new SaveReader(decodeCheckpointValue(read("q2:match")), "q2-match") };
  const tag = match?.module instanceof Q2Tag ? { module: match.module, state: { token: match.reader.field("token").nullable(readSavedActor), owner: match.reader.field("owner").nullable(readSavedActor), count: match.reader.field("count").integer(0) } } : null;
  const ball = match?.module instanceof Q2DeathBall ? { module: match.module, state: { ball: match.reader.field("ball").nullable(readSavedActor), starts: match.reader.field("starts").integer(0), team1Score: match.reader.field("team1Score").integer(), team2Score: match.reader.field("team2Score").integer() } } : null;
  source.registerCallbacks();
  source.setDeathmatchFlags(deathmatchFlags);
  source.game.restore(foundation);
  source.items.restore(source.game, items);
  source.movers.restore(source.game, movers);
  if (armory !== null) armory.module.restore(source.game, armory.checkpoint);
  for (const expansion of expansions) {
    expansion.module.entities.restore(expansion.entities);
    expansion.module.monsters.restore(source.game, expansion.monsters);
  }
  source.weapons.restore(source.game, weapons);
  source.monsters.restore(source.game, monsters);
  source.baseEntities.restore(source.game, baseEntities);
  source.players.restore(source.game, players);
  if (rerelease !== null) {
    rerelease.module.players.restoreRerelease(source.game, rerelease.players);
    rerelease.module.entities.restore(source.game, rerelease.entities);
  }
  if (tag !== null) tag.module.restore(source.game, tag.state);
  if (ball !== null) ball.module.restore(source.game, ball.state);
  return undefined;
}
