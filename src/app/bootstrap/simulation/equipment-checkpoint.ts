import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readHandGrenadesCheckpoint } from "../../../persistence/q2-hand-grenades.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readRandom } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { HandGrenadeRuntimeCheckpoint } from "./equipment-runtime.ts";

export function readHandGrenadeRuntimeCheckpoint(reader: SaveReader): HandGrenadeRuntimeCheckpoint {
  const source = reader.field("source");
  const randomReader = source.field("random");
  const random = readRandom(randomReader);
  if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") {
    return randomReader.field("kind").fail("expected glibc-random or q2-rerelease-mt19937");
  }
  return {
    version: reader.field("version").literal(1),
    controller: readHandGrenadesCheckpoint(reader.field("controller")),
    controls: reader.field("controls").list(entry => ({
      actor: readSavedActor(entry.field("actor")),
      held: entry.field("held").boolean(),
      pressed: entry.field("pressed").boolean(),
      released: entry.field("released").boolean(),
    })),
    source: { entities: readQ2FoundationCheckpoint(source.field("entities")), random },
  };
}
