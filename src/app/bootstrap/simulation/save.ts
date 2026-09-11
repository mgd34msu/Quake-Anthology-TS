import type { ProviderCheckpoint, SaveImage } from "../../../contracts/session.ts";
import { SaveReader, decodeCheckpointValue } from "../../../persistence/value.ts";

export function simulationProviderCheckpoint(image: SaveImage, schema: ProviderCheckpoint["schema"]): ProviderCheckpoint {
  const matches = image.providers.filter(value => value.schema === schema);
  const value = matches[0];
  if (value === undefined || matches.length !== 1 || value.version !== (schema === "world:simulation" ? 3 : 1)) throw new Error(`Missing or unsupported saved provider ${schema}`);
  return value;
}
export function simulationSaveReader(image: SaveImage): SaveReader {
  return new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(image, "world:simulation").bytes), "world:simulation");
}
export function savedSimulationSettings(image: SaveImage) {
  const reader = simulationSaveReader(image), settings = reader.field("settings");
  return { skill: settings.field("skill").choice(0, 1, 2, 3), mode: settings.field("mode").choice("singleplayer", "coop", "deathmatch"),
    maxClients: settings.field("maxClients").integer(1), seed: settings.field("seed").integer(0),
    hostMilliseconds: reader.field("hostMilliseconds").finite(),
    clientSlots: reader.field("players").list(value => value.field("clientSlot").integer(0)) };
}
