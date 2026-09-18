import type { WeaponBehaviorDefinition } from "../../../contracts/weapon-behavior.ts";
import { readWeaponBehaviorDefinition } from "../../../world/gameplay/weapon-behaviors.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { RereleaseWeaponBehaviorCheckpoint } from "./rerelease-weapon-behavior.ts";
import { readRereleaseSourceSave } from "./native-q2-rerelease-save.ts";

export function readRereleaseWeaponBehaviorCheckpoint(reader: SaveReader, definition: WeaponBehaviorDefinition): RereleaseWeaponBehaviorCheckpoint {
  const trajectory = (value: SaveReader) => ({ origin: readVector(value.field("origin")), angles: readVector(value.field("angles")), velocity: readVector(value.field("velocity")) });
  return { version: reader.field("version").literal(1), definition: readWeaponBehaviorDefinition(reader.field("definition"), definition),
    map: { map: reader.field("map").field("map").string(), entities: reader.field("map").field("entities").string(), spawnPoint: reader.field("map").field("spawnPoint").string() },
    time: reader.field("time").finite(), cvars: reader.field("cvars").bytes(),
    game: readRereleaseSourceSave(reader.field("game")), level: readRereleaseSourceSave(reader.field("level")),
    configstrings: reader.field("configstrings").list(value => ({ index: value.field("index").integer(0), value: value.field("value").string() })),
    retired: reader.field("retired").list(value => ({ actor: readSavedActor(value.field("actor")), trajectory: trajectory(value.field("trajectory")) })),
    bindings: reader.field("bindings").list(value => ({ slot: value.field("slot").integer(1), actor: readSavedActor(value.field("actor")), kind: value.field("kind").choice("client", "target", "projectile"), generation: value.field("generation").integer(0) })) };
}
