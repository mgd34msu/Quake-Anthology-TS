import type { Q2Ballistics } from "../../../content/q2/foundation/weapons/ballistics.ts";
import type { MonsterDefinitionReference, ProviderReference } from "../../../contracts/content.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { AuthoredMonster } from "../../../content/monsters/authored.ts";
import type { Q1FoundationCheckpoint } from "../../../content/q1/foundation/checkpoint.ts";
import type { Q2FoundationCheckpoint } from "../../../content/q2/foundation/checkpoint.ts";
import type { Q2MonstersCheckpoint } from "../../../content/q2/foundation/monsters/checkpoint.ts";
import type { Q2MoversCheckpoint } from "../../../content/q2/foundation/movers.ts";
import type { Q2MissionPackMonstersCheckpoint } from "../../../content/q2/missionpacks/monsters/state.ts";
import { readQ2MoversCheckpoint } from "../../../persistence/q2-movers.ts";
import { readQ2ItemsCheckpoint } from "../../../persistence/q2-items.ts";
import { readQ2BaseEntitiesCheckpoint } from "../../../persistence/q2-base-entities.ts";
import type { Q2ItemsCheckpoint } from "../../../content/q2/foundation/items.ts";
import type { Q2BaseEntitiesCheckpoint } from "../../../content/q2/base/entities/index.ts";
import { readQ2MissionPackMonstersCheckpoint } from "../../../persistence/q2-missionpacks.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { SourceRandom } from "./random.ts";
import { readQ1FoundationCheckpoint } from "../../../persistence/q1-foundation.ts";
import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readQ2MonstersCheckpoint } from "../../../persistence/q2-monsters.ts";
import { readProvider } from "../../../persistence/recipe.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readFrame, readRandom, readVector } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";

export type SavedAuthoredMonster = Omit<AuthoredMonster, "actor" | "routeGoal" | "combatGoal" | "activation" | "placement"> & {
  readonly actor: SavedActorId;
  readonly definition: MonsterDefinitionReference;
  readonly routeGoal: SavedActorId | null;
  readonly combatGoal: SavedActorId | null;
  readonly placement: { readonly kind: "ready" } | { readonly kind: "teleport"; readonly origin: Vec3 }
    | { readonly kind: "waiting"; readonly barriers: readonly { readonly actor: SavedActorId; readonly origin: Vec3 }[]; readonly activator: SavedActorId | null };
  readonly activation: { readonly kind: "active" } | { readonly kind: "dormant" } | { readonly kind: "scheduled"; readonly at: number; readonly activator: SavedActorId | null };
};
export type MonsterSourceCheckpoint = {
  readonly reference: ProviderReference;
  readonly frame: FrameContext;
  readonly random: ReturnType<SourceRandom["checkpoint"]>;
} & ({ readonly kind: "q1"; readonly entities: Q1FoundationCheckpoint }
  | { readonly kind: "q2"; readonly entities: Q2FoundationCheckpoint; readonly monsters: Q2MonstersCheckpoint; readonly ballistics: ReturnType<Q2Ballistics["captureProjectiles"]>;
    readonly movers: Q2MoversCheckpoint | null; readonly packs: readonly { readonly pack: "xatrix" | "rogue"; readonly state: Q2MissionPackMonstersCheckpoint }[] });
export interface SelectedMonstersCheckpoint {
  readonly version: 2;
  readonly authored: readonly SavedAuthoredMonster[];
  readonly sources: readonly MonsterSourceCheckpoint[];
}
/** Authored-family world adjunct state for foreign maps on a TS primary. */
export interface ForeignQ2WorldCheckpoint {
  readonly version: 1;
  readonly reference: ProviderReference;
  readonly edition: "classic" | "rerelease";
  readonly program: "baseq2" | "xatrix" | "rogue" | "mg2";
  readonly frame: FrameContext;
  readonly random: ReturnType<SourceRandom["checkpoint"]>;
  readonly entities: Q2FoundationCheckpoint;
  readonly monsters: Q2MonstersCheckpoint;
  readonly ballistics: ReturnType<Q2Ballistics["captureProjectiles"]>;
  readonly movers: Q2MoversCheckpoint;
  readonly items: Q2ItemsCheckpoint;
  readonly baseEntities: Q2BaseEntitiesCheckpoint;
  readonly packs: readonly { readonly pack: "xatrix" | "rogue"; readonly monsters: Q2MissionPackMonstersCheckpoint; readonly steamId: number }[];
}
export function readForeignQ2WorldCheckpoint(reader: SaveReader): ForeignQ2WorldCheckpoint {
  const random = readRandom(reader.field("random"));
  if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") return reader.field("random").fail("Unsupported foreign world random stream");
  return { version: reader.field("version").literal(1), reference: readProvider(reader.field("reference")),
    edition: reader.field("edition").choice("classic", "rerelease"), program: reader.field("program").choice("baseq2", "xatrix", "rogue", "mg2"),
    frame: readFrame(reader.field("frame")), random,
    entities: readQ2FoundationCheckpoint(reader.field("entities")), monsters: readQ2MonstersCheckpoint(reader.field("monsters")),
    ballistics: { blasterCauses: reader.field("ballistics").field("blasterCauses").list(cause => ({ actor: readSavedActor(cause.field("actor")), meansOfDeath: cause.field("meansOfDeath").integer() })) },
    movers: readQ2MoversCheckpoint(reader.field("movers")), items: readQ2ItemsCheckpoint(reader.field("items")),
    baseEntities: readQ2BaseEntitiesCheckpoint(reader.field("baseEntities")),
    packs: reader.field("packs").list(pack => ({ pack: pack.field("pack").choice("xatrix", "rogue"),
      monsters: readQ2MissionPackMonstersCheckpoint(pack.field("monsters")), steamId: pack.field("steamId").integer() })) };
}
/** Q1 authored-family world adjunct state for foreign maps on a TS primary. */
export interface ForeignQ1WorldCheckpoint {
  readonly version: 1;
  readonly reference: ProviderReference;
  readonly edition: "classic" | "rerelease";
  readonly program: "id1" | "hipnotic" | "rogue" | "dopa" | "mg1" | "mg3" | "ctf";
  readonly frame: FrameContext;
  readonly random: ReturnType<SourceRandom["checkpoint"]>;
  readonly entities: Q1FoundationCheckpoint;
}
export function readForeignQ1WorldCheckpoint(reader: SaveReader): ForeignQ1WorldCheckpoint {
  const random = readRandom(reader.field("random"));
  if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") return reader.field("random").fail("Unsupported foreign world random stream");
  return { version: reader.field("version").literal(1), reference: readProvider(reader.field("reference")),
    edition: reader.field("edition").choice("classic", "rerelease"), program: reader.field("program").choice("id1", "hipnotic", "rogue", "dopa", "mg1", "mg3", "ctf"),
    frame: readFrame(reader.field("frame")), random, entities: readQ1FoundationCheckpoint(reader.field("entities")) };
}
export function readSelectedMonstersCheckpoint(reader: SaveReader): SelectedMonstersCheckpoint {
  return { version: reader.field("version").literal(2), authored: reader.field("authored").list(value => {
    const activation = value.field("activation"), kind = activation.field("kind").choice("active", "dormant", "scheduled");
    const placement = value.field("placement"), placementKind = placement.value === undefined ? "ready" : placement.field("kind").choice("ready", "waiting", "teleport");
    return { actor: readSavedActor(value.field("actor")), definition: { source: readProvider(value.field("definition").field("source")), classname: value.field("definition").field("classname").string() },
      classname: value.field("classname").string(), sourceOrdinal: value.field("sourceOrdinal").integer(0), spawnflags: value.field("spawnflags").integer(),
      targetname: value.field("targetname").string(), target: value.field("target").string(), killtarget: value.field("killtarget").string(), message: value.field("message").string(), delay: value.field("delay").finite(),
      deathTarget: value.field("deathTarget").string(), dropItem: value.field("dropItem").string(), route: value.field("route").string(), routeGoal: value.field("routeGoal").nullable(readSavedActor), routeResolved: value.field("routeResolved").boolean(),
      countedDeath: value.field("countedDeath").boolean(), combatTarget: value.field("combatTarget").string(), combatGoal: value.field("combatGoal").nullable(readSavedActor), standGround: value.field("standGround").boolean(),
      placement: placementKind === "waiting"
        ? { kind: "waiting", barriers: placement.field("barriers").list(barrier => ({ actor: readSavedActor(barrier.field("actor")), origin: readVector(barrier.field("origin")) })), activator: placement.field("activator").nullable(readSavedActor) }
        : placementKind === "teleport" ? { kind: "teleport", origin: readVector(placement.field("origin")) } : { kind: "ready" },
      activation: kind === "scheduled" ? { kind, at: activation.field("at").finite(), activator: activation.field("activator").nullable(readSavedActor) } : { kind } };
  }), sources: reader.field("sources").list(value => {
    const reference = readProvider(value.field("reference")), frame = readFrame(value.field("frame")), random = readRandom(value.field("random"));
    if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") return value.field("random").fail("Unsupported selected monster random stream");
    const kind = value.field("kind").choice("q1", "q2");
    return kind === "q1" ? { kind, reference, frame, random, entities: readQ1FoundationCheckpoint(value.field("entities")) }
      : { kind, reference, frame, random, entities: readQ2FoundationCheckpoint(value.field("entities")), monsters: readQ2MonstersCheckpoint(value.field("monsters")),
        movers: value.field("movers").value === undefined ? null : readQ2MoversCheckpoint(value.field("movers")),
        packs: value.field("packs").value === undefined ? [] : value.field("packs").list(pack => ({ pack: pack.field("pack").choice("xatrix", "rogue"), state: readQ2MissionPackMonstersCheckpoint(pack.field("state")) })),
        ballistics: { blasterCauses: value.field("ballistics").field("blasterCauses").list(cause => ({ actor: readSavedActor(cause.field("actor")), meansOfDeath: cause.field("meansOfDeath").integer() })) } };
  }) };
}
