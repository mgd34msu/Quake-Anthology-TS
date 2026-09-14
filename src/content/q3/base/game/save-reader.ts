import { SaveReader } from "../../../../persistence/value.ts";
import type { Q3GraphState, Q3EntityState, Q3ClientState } from "./save-state.ts";
import { readEntityValues, readNetworkValues, readClientValues, readPlayerValues, readPersistantValues, readTeamValues, readSessionValues, readVector } from "./save-values.ts";

export function readQ3Actor(reader: SaveReader) { return { slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }; }
function trajectory(reader: SaveReader) {
  return { type: reader.field("type").number(), time: reader.field("time").number(), duration: reader.field("duration").number(),
    base: readVector(reader.field("base")), delta: readVector(reader.field("delta")) };
}
function slot(reader: SaveReader, maximum: number): number {
  const value = reader.integer(0);
  if (value >= maximum) reader.fail("Q3 source reference outside retained table");
  return value;
}
function entitySlot(reader: SaveReader): number { return slot(reader, 1024); }
function clientSlot(reader: SaveReader): number { return slot(reader, 64); }
function entity(reader: SaveReader): Q3EntityState {
  const shared = reader.field("shared"), model = shared.field("model"), kind = model.field("kind").choice("inline", "box", "capsule");
  const classname = reader.field("classname"), nameKind = classname.field("kind").choice("value", "client-name");
  return { values: readEntityValues(reader.field("values")), network: readNetworkValues(reader.field("network")),
    pos: trajectory(reader.field("pos")), apos: trajectory(reader.field("apos")),
    shared: { svFlags: shared.field("svFlags").number(), singleClient: shared.field("singleClient").number(), contents: shared.field("contents").number(),
      ownerNum: shared.field("ownerNum").number(), model: kind === "inline" ? { kind, index: model.field("index").integer(0) } : { kind } },
    sharedPrivate: { absMinOverride: reader.field("sharedPrivate").field("absMinOverride").nullable(readVector),
      absMaxOverride: reader.field("sharedPrivate").field("absMaxOverride").nullable(readVector),
      previousLink: reader.field("sharedPrivate").field("previousLink").nullable(value => {
        const state = value.field("state");
        return { actor: readQ3Actor(value.field("actor")), linkCount: value.field("linkCount").integer(0),
          absoluteBounds: { min: readVector(value.field("absoluteBounds").field("min")), max: readVector(value.field("absoluteBounds").field("max")) },
          state: { origin: readVector(state.field("origin")), angles: readVector(state.field("angles")), velocity: readVector(state.field("velocity")),
            bounds: { min: readVector(state.field("bounds").field("min")), max: readVector(state.field("bounds").field("max")) }, ground: state.field("ground").nullable(readQ3Actor) } };
      }) },
    client: reader.field("client").nullable(clientSlot),
    classname: nameKind === "value" ? { kind: nameKind, value: classname.field("value").nullable(value => value.string()) }
      : { kind: nameKind, client: clientSlot(classname.field("client")) },
    parent: reader.field("parent").nullable(entitySlot), nextTrain: reader.field("nextTrain").nullable(entitySlot), prevTrain: reader.field("prevTrain").nullable(entitySlot),
    targetEnt: reader.field("targetEnt").nullable(entitySlot), chain: reader.field("chain").nullable(entitySlot), enemy: reader.field("enemy").nullable(entitySlot),
    activator: reader.field("activator").nullable(entitySlot), teamchain: reader.field("teamchain").nullable(entitySlot), teammaster: reader.field("teammaster").nullable(entitySlot),
    activation: reader.field("activation").nullable(value => value.field("kind").choice("entity", "actor") === "entity"
      ? { kind: "entity", slot: entitySlot(value.field("slot")) } : { kind: "actor", actor: readQ3Actor(value.field("actor")) }),
    item: reader.field("item").nullable(value => value.integer(0)), nextthink: reader.field("nextthink").number(),
    think: reader.field("think").nullable(value => value.string()), reached: reader.field("reached").nullable(value => value.string()),
    blocked: reader.field("blocked").nullable(value => value.string()), touch: reader.field("touch").nullable(value => value.string()),
    use: reader.field("use").nullable(value => value.string()), pain: reader.field("pain").nullable(value => value.string()), die: reader.field("die").nullable(value => value.string()) };
}
function numbers(reader: SaveReader): readonly number[] { return reader.list(value => value.number()); }
function client(reader: SaveReader): Q3ClientState {
  const command = reader.field("command"), backing = reader.field("backing");
  return { values: readClientValues(reader.field("values")), player: readPlayerValues(reader.field("player")), persistant: readPersistantValues(reader.field("persistant")),
    command: { serverTime: command.field("serverTime").number(), angles: readVector(command.field("angles")), buttons: command.field("buttons").number(),
      weapon: command.field("weapon").number(), forwardmove: command.field("forwardmove").number(), rightmove: command.field("rightmove").number(), upmove: command.field("upmove").number() },
    team: readTeamValues(reader.field("team")), session: readSessionValues(reader.field("session")),
    events: numbers(reader.field("events")), eventParms: numbers(reader.field("eventParms")), persistantSlots: numbers(reader.field("persistantSlots")),
    powerups: numbers(reader.field("powerups")), ammoTimes: numbers(reader.field("ammoTimes")),
    backing: { sourceStats: numbers(backing.field("sourceStats")), specialAmmo: numbers(backing.field("specialAmmo")) },
    hook: reader.field("hook").nullable(entitySlot), persistantPowerup: reader.field("persistantPowerup").nullable(entitySlot), areabits: reader.field("areabits").nullable(value => value.bytes()) };
}
export function readQ3Graph(value: unknown): Q3GraphState {
  const reader = new SaveReader(value, "q3.graph");
  return { ownership: reader.field("ownership").list(value => ({ actor: value.field("actor").nullable(readQ3Actor), active: value.field("active").boolean(), borrowed: value.field("borrowed").boolean() })),
    entities: reader.field("entities").list(entity), clients: reader.field("clients").list(client),
    numEntities: reader.field("numEntities").integer(64), maxClients: reader.field("maxClients").integer(1) };
}
