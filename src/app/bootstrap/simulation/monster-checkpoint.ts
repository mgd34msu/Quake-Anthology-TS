import type { MonsterDefinitionReference, ProviderReference } from "../../../contracts/content.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { AuthoredMonster } from "../../../content/monsters/authored.ts";
import type { Q1FoundationCheckpoint } from "../../../content/q1/foundation/checkpoint.ts";
import type { Q2FoundationCheckpoint } from "../../../content/q2/foundation/checkpoint.ts";
import type { Q2MonstersCheckpoint } from "../../../content/q2/foundation/monsters/checkpoint.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { SourceRandom } from "./random.ts";
import { readQ1FoundationCheckpoint } from "../../../persistence/q1-foundation.ts";
import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readQ2MonstersCheckpoint } from "../../../persistence/q2-monsters.ts";
import { readProvider } from "../../../persistence/recipe.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readFrame, readRandom } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";

export type SavedAuthoredMonster = Omit<AuthoredMonster, "actor" | "routeGoal" | "combatGoal" | "activation"> & {
  readonly actor: SavedActorId;
  readonly definition: MonsterDefinitionReference;
  readonly routeGoal: SavedActorId | null;
  readonly combatGoal: SavedActorId | null;
  readonly activation: { readonly kind: "active" } | { readonly kind: "dormant" } | { readonly kind: "scheduled"; readonly at: number; readonly activator: SavedActorId | null };
};
export type MonsterSourceCheckpoint = {
  readonly reference: ProviderReference;
  readonly frame: FrameContext;
  readonly random: ReturnType<SourceRandom["checkpoint"]>;
} & ({ readonly kind: "q1"; readonly entities: Q1FoundationCheckpoint }
  | { readonly kind: "q2"; readonly entities: Q2FoundationCheckpoint; readonly monsters: Q2MonstersCheckpoint });
export interface SelectedMonstersCheckpoint {
  readonly version: 1;
  readonly authored: readonly SavedAuthoredMonster[];
  readonly sources: readonly MonsterSourceCheckpoint[];
}
export function readSelectedMonstersCheckpoint(reader: SaveReader): SelectedMonstersCheckpoint {
  return { version: reader.field("version").literal(1), authored: reader.field("authored").list(value => {
    const activation = value.field("activation"), kind = activation.field("kind").choice("active", "dormant", "scheduled");
    return { actor: readSavedActor(value.field("actor")), definition: { source: readProvider(value.field("definition").field("source")), classname: value.field("definition").field("classname").string() },
      classname: value.field("classname").string(), sourceOrdinal: value.field("sourceOrdinal").integer(0), spawnflags: value.field("spawnflags").integer(),
      targetname: value.field("targetname").string(), target: value.field("target").string(), killtarget: value.field("killtarget").string(), message: value.field("message").string(), delay: value.field("delay").finite(),
      deathTarget: value.field("deathTarget").string(), dropItem: value.field("dropItem").string(), route: value.field("route").string(), routeGoal: value.field("routeGoal").nullable(readSavedActor), routeResolved: value.field("routeResolved").boolean(),
      countedDeath: value.field("countedDeath").boolean(), combatTarget: value.field("combatTarget").string(), combatGoal: value.field("combatGoal").nullable(readSavedActor), standGround: value.field("standGround").boolean(),
      activation: kind === "scheduled" ? { kind, at: activation.field("at").finite(), activator: activation.field("activator").nullable(readSavedActor) } : { kind } };
  }), sources: reader.field("sources").list(value => {
    const reference = readProvider(value.field("reference")), frame = readFrame(value.field("frame")), random = readRandom(value.field("random"));
    if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") return value.field("random").fail("Unsupported selected monster random stream");
    const kind = value.field("kind").choice("q1", "q2");
    return kind === "q1" ? { kind, reference, frame, random, entities: readQ1FoundationCheckpoint(value.field("entities")) }
      : { kind, reference, frame, random, entities: readQ2FoundationCheckpoint(value.field("entities")), monsters: readQ2MonstersCheckpoint(value.field("monsters")) };
  }) };
}
