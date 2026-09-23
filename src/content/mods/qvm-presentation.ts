import type { QvmModPresentationDeclaration, QvmPresentationArgument, QvmPresentationCall, QvmPresentationProgram } from "../../contracts/qvm-mod-presentation.ts";
import { SaveReader } from "../../persistence/value.ts";
import { readDigest } from "../../persistence/shared.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";

function int32(reader: SaveReader): number {
  const value = reader.integer(-0x80000000);
  return value > 0x7fffffff ? reader.fail("Source scalar exceeds int32") : value;
}
function argument(reader: SaveReader): QvmPresentationArgument {
  const kind = reader.field("kind").choice("int32", "float32", "address", "source"), value = reader.field("value");
  switch (kind) {
    case "source": return { kind, value: value.choice("player-state", "entity-state", "centity", "origin", "snapshot", "client-number", "time", "event", "parameter", "snapshot-number", "server-command-sequence") };
    case "int32": return { kind, value: int32(value) };
    case "address": return { kind, value: value.integer(0) };
    case "float32": {
      const scalar = value.finite();
      return Number.isFinite(Math.fround(scalar)) ? { kind, value: scalar } : value.fail("Source scalar exceeds float32");
    }
  }
}
function call(reader: SaveReader): QvmPresentationCall {
  const parameters = reader.field("arguments").list(argument);
  if (parameters.length > 10) return reader.fail("Source presentation call exceeds QVM argument ABI");
  return { entry: reader.field("entry").integer(0), arguments: parameters };
}
function program(reader: SaveReader): QvmPresentationProgram {
  return { path: normalizeResourcePath(reader.field("path").string()), digest: readDigest(reader.field("digest")),
    abiProfile: reader.field("abiProfile").choice("q3-modern", "q3-1.16n-base") };
}
export function readQvmModPresentation(bytes: Uint8Array): QvmModPresentationDeclaration {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return readQvmModPresentationDeclaration(new SaveReader(value, "qvm-presentation"));
}
export function readQvmModPresentationDeclaration(reader: SaveReader): QvmModPresentationDeclaration {
  const storage = reader.field("storage"), centities = storage.field("centities"), snapshot = storage.field("snapshot");
  const runtime = reader.field("runtime").choice("qvm-player-events", "qvm-scene");
  const base = { version: reader.field("version").literal(1),
    gameplay: program(reader.field("gameplay")), cgame: program(reader.field("cgame")),
    initialize: reader.field("initialize").list(call), refresh: reader.field("refresh").list(call), frame: reader.field("frame").list(call) };
  const commonStorage = { gameState: storage.field("gameState").integer(0),
    time: storage.field("time").list(value => value.integer(0)), frameTime: storage.field("frameTime").list(value => value.integer(0)),
    viewOrigin: storage.field("viewOrigin").list(value => value.integer(0)) };
  const commonEntities = { address: centities.field("address").integer(0), stride: centities.field("stride").integer(1), capacity: centities.field("capacity").integer(1),
    state: centities.field("state").integer(0) };
  if (runtime === "qvm-scene") {
    const body = reader.field("body"), player = body.field("player"), mesh = body.field("mesh"), eventCheck = reader.field("eventCheck");
    return { ...base, runtime, cvars: reader.field("cvars").list(entry => ({ name: entry.field("name").string(), value: entry.field("value").string() })), storage: { ...commonStorage,
      serverCommandSequence: storage.field("serverCommandSequence").integer(0), centities: { ...commonEntities,
      previousEvent: centities.field("previousEvent").integer(0), snapshotTime: centities.field("snapshotTime").integer(0) } },
      snapshots: reader.field("snapshots").list(call), eventEntityType: reader.field("eventEntityType").integer(0),
      eventCheck: { entry: eventCheck.field("entry").integer(0), centityArgument: eventCheck.field("centityArgument").integer(0) },
      body: { player: { entry: player.field("entry").integer(0), centityArgument: player.field("centityArgument").integer(0) },
        mesh: { entry: mesh.field("entry").integer(0), entityArgument: mesh.field("entityArgument").integer(0),
          stateArgument: mesh.field("stateArgument").integer(0), shaderOffset: mesh.field("shaderOffset").integer(0) } } };
  }
  return { ...base, runtime,
    storage: { gameState: storage.field("gameState").integer(0), playerState: storage.field("playerState").integer(0),
      snapshot: { kind: snapshot.field("kind").literal("synthetic-player-event"), address: snapshot.field("address").integer(0), pointers: snapshot.field("pointers").list(value => value.integer(0)) },
      centities: { address: centities.field("address").integer(0), stride: centities.field("stride").integer(1), capacity: centities.field("capacity").integer(1),
        state: centities.field("state").integer(0), origin: centities.field("origin").integer(0) },
      time: storage.field("time").list(value => value.integer(0)), frameTime: storage.field("frameTime").list(value => value.integer(0)),
      viewOrigin: storage.field("viewOrigin").list(value => value.integer(0)) },
    project: reader.field("project").list(call), event: call(reader.field("event")) };
}
