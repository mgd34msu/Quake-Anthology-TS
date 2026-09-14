import { isDeepStrictEqual } from "node:util";
import type { QuakeCCheckpoint, QvmCheckpoint } from "../../../contracts/execution.ts";
import type { Q3ArsenalRuntimeState } from "../../../content/q3/foundation/arsenal.ts";
import type { ClientMovementOptions } from "../../../content/q3/team-arena/movement-host.ts";
import type { ProviderCheckpoint, SaveImage } from "../../../contracts/session.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readQ2AttackCheckpoint } from "../../../persistence/q2-foundation.ts";
import { SaveReader, decodeCheckpointValue } from "../../../persistence/value.ts";
import { decodeApplicationBotsCheckpoint, type DecodedApplicationBotsCheckpoint } from "./bots.ts";
import { savedQ3GuestClients } from "./q3/guest-runtime.ts";

export function simulationProviderCheckpoint(image: SaveImage, schema: ProviderCheckpoint["schema"]): ProviderCheckpoint {
  const matches = image.providers.filter(value => value.schema === schema);
  const value = matches[0];
  const provider = schema === "world:source-slots" ? "world:actors" : image.recipe.map.entities.provider;
  if (value === undefined || matches.length !== 1 || value.provider !== provider || value.version !== (schema === "world:simulation" ? 11 : 1)) throw new Error(`Missing or unsupported saved provider ${schema}`);
  return value;
}

export function savedSourceCvars(image: SaveImage): unknown {
  if (!image.providers.some(record => record.schema === "world:source-cvars")) return undefined;
  return decodeCheckpointValue(simulationProviderCheckpoint(image, "world:source-cvars").bytes);
}

export function savedBotCheckpoint(image: SaveImage): DecodedApplicationBotsCheckpoint | null {
  if (!image.providers.some(record => record.schema === "world:bots")) return null;
  const bots = decodeApplicationBotsCheckpoint(decodeCheckpointValue(simulationProviderCheckpoint(image, "world:bots").bytes));
  const players = simulationSaveReader(image).field("players").list(value => ({
    slot: value.field("clientSlot").integer(0), actor: readSavedActor(value.field("actor")),
  }));
  const slots = new Set<number>();
  for (const connection of bots.transport.connections) {
    if (slots.has(connection.client.slot)) throw new Error("Duplicate saved bot client slot");
    slots.add(connection.client.slot);
    const player = players.find(player => player.slot === connection.client.slot);
    if (player === undefined || player.actor.slot !== connection.actor.slot || player.actor.generation !== connection.actor.generation)
      throw new Error("Saved bot connection does not own its shared player");
  }
  return bots;
}

export function simulationGuestCheckpoint(image: SaveImage): QuakeCCheckpoint | QvmCheckpoint | null {
  const executions = image.recipe.execution.filter(module => module.role === "server-game");
  const execution = executions[0];
  if (executions.length !== 1 || execution === undefined) throw new Error("Save requires exactly one selected server execution");
  if (execution.kind !== "quakec" && execution.kind !== "qvm") {
    if (image.guests.length !== 0) throw new Error("Selected source cannot restore guest memory providers");
    return null;
  }
  const checkpoint = image.guests[0], name = execution.kind === "quakec" ? "QuakeC" : "QVM";
  if (image.guests.length !== 1 || checkpoint === undefined || checkpoint.kind !== execution.kind || checkpoint.kind !== "quakec" && checkpoint.kind !== "qvm")
    throw new Error(`${name} save requires exactly one complete guest checkpoint`);
  if (execution.kind === "qvm" && (execution.api.kind !== "q3-qagame" || execution.api.version !== 8))
    throw new Error("QVM save requires the selected qagame version 8 API");
  const mount = execution.artifact.provenance.mount.identity;
  const expected = { id: execution.owner.provider, artifactPath: execution.artifact.requestedPath,
    digest: execution.artifact.digest, revision: execution.kind === "quakec" ? execution.artifact.digest : `${mount.id}:${mount.generation}` };
  if (execution.owner.provider !== image.recipe.map.entities.provider || !isDeepStrictEqual(checkpoint.module, expected)
    || !isDeepStrictEqual(checkpoint.hostState.module, expected) || !isDeepStrictEqual(checkpoint.api, execution.api))
    throw new Error(`${name} checkpoint differs from the selected artifact and API`);
  return checkpoint;
}

export function simulationQuakeCCheckpoint(image: SaveImage): QuakeCCheckpoint | null {
  const checkpoint = simulationGuestCheckpoint(image);
  return checkpoint?.kind === "quakec" ? checkpoint : null;
}

export function simulationQvmCheckpoint(image: SaveImage): QvmCheckpoint | null {
  const checkpoint = simulationGuestCheckpoint(image);
  return checkpoint?.kind === "qvm" ? checkpoint : null;
}

export function validateSimulationSave(image: SaveImage): void {
  const records = new Set<string>();
  for (const record of image.providers) {
    const key = `${record.provider}/${record.schema}`;
    if (records.has(key)) throw new Error(`Duplicate saved provider ${record.schema}`);
    records.add(key);
    if (record.provider !== (record.schema === "world:source-slots" ? "world:actors" : image.recipe.map.entities.provider))
      throw new Error(`Saved provider ${record.schema} has a different owner`);
  }
  simulationProviderCheckpoint(image, "world:simulation");
  simulationProviderCheckpoint(image, "world:source-slots");
  const guest = simulationGuestCheckpoint(image);
  if (guest?.kind === "qvm" && simulationSaveReader(image).field("players").list(value => value.value).length !== 0)
    throw new Error("QVM players must remain owned by the saved guest client records");
  const execution = image.recipe.execution.find(module => module.role === "server-game");
  const bots = savedBotCheckpoint(image);
  if (bots !== null && execution?.kind !== "typescript") throw new Error("Saved bot services have no supported source owner");
  if (bots !== null && execution?.kind === "typescript" && execution.api.kind !== "q3-qagame")
    simulationProviderCheckpoint(image, "world:source-cvars");
  if (image.providers.some(record => record.schema === "world:source-cvars")) {
    if (execution?.kind !== "typescript" || execution.api.kind !== "q1-netquake" && execution.api.kind !== "q1-quakeworld"
      && execution.api.kind !== "q2-classic-game" && execution.api.kind !== "q2-rerelease-game")
      throw new Error("Saved common cvars have no matching source owner");
    simulationProviderCheckpoint(image, "world:source-cvars");
  }
  if (guest === null && execution?.kind === "typescript") {
    if (execution.api.kind === "q1-netquake" || execution.api.kind === "q1-quakeworld") simulationProviderCheckpoint(image, "q1:foundation");
    else if (execution.api.kind === "q2-classic-game" || execution.api.kind === "q2-rerelease-game") {
      for (const schema of ["q2:composition", "q2:foundation", "q2:items", "q2:movers", "q2:monsters", "q2:weapons", "q2:players", "q2:base-entities"] satisfies readonly ProviderCheckpoint["schema"][])
        simulationProviderCheckpoint(image, schema);
    } else if (execution.api.kind === "q3-qagame") {
      simulationProviderCheckpoint(image, "q3:native");
      simulationProviderCheckpoint(image, "world:q3-runtime");
    }
  }
  const clocks = image.clocks.filter(clock => clock.provider === image.recipe.map.entities.provider);
  if (clocks.length !== 1 || !isDeepStrictEqual(clocks[0]?.time, image.frame.time)) throw new Error("Saved source clock disagrees with its frame");
  if (image.random.filter(random => random.provider === image.recipe.map.entities.provider).length !== 1)
    throw new Error("Save requires one matching source random stream");
  for (const entries of [image.bodies, image.combat, image.inventories, image.configurations, image.thinks]) {
    const actors = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.actor.slot}/${entry.actor.generation}`;
      if (actors.has(key)) throw new Error("Duplicate saved actor state");
      actors.add(key);
    }
  }
}

export function nativeQ3RuntimeReader(image: SaveImage) {
  const reader = new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(image, "world:q3-runtime").bytes), "world:q3-runtime");
  return {
    arsenals: reader.field("arsenals").list(entry => {
      const state = entry.field("state");
      const arsenal: Q3ArsenalRuntimeState = { product: state.field("product").choice("baseq3", "missionpack"), maxHealth: state.field("maxHealth").number(),
        spectator: state.field("spectator").boolean(), persistentPowerupTag: state.field("persistentPowerupTag").integer(), holdableItem: state.field("holdableItem").integer(),
        holdableTag: state.field("holdableTag").integer(), respawned: state.field("respawned").boolean(), useItemHeld: state.field("useItemHeld").boolean(),
        eventSequence: state.field("eventSequence").integer(), fractionalMilliseconds: state.field("fractionalMilliseconds").finite(),
        externalSlot: state.field("externalSlot").choice("active", "holster-requested", "dropping", "holstered", "resume-requested"),
        requestedWeapon: state.field("requestedWeapon").nullable(value => value.integer()) };
      return { actor: readSavedActor(entry.field("actor")), state: arsenal };
    }),
    movement: reader.field("movement").list(entry => ({ actor: readSavedActor(entry.field("actor")), state: entry.field("state").nullable((state): ClientMovementOptions => ({
      traceMask: state.field("traceMask").integer(), fixedMsec: state.field("fixedMsec").nullable(value => value.integer()),
      noFootsteps: state.field("noFootsteps").boolean(), gauntletHit: state.field("gauntletHit").boolean(), debugLevel: state.field("debugLevel").integer() })) })),
    lastAttacks: reader.field("lastAttacks").list(entry => ({ actor: readSavedActor(entry.field("actor")), attack: readQ2AttackCheckpoint(entry.field("attack")) })),
  };
}
export function simulationSaveReader(image: SaveImage): SaveReader {
  return new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(image, "world:simulation").bytes), "world:simulation");
}
export function savedSimulationSettings(image: SaveImage) {
  const reader = simulationSaveReader(image), settings = reader.field("settings");
  const guest = simulationQvmCheckpoint(image);
  return { skill: settings.field("skill").choice(0, 1, 2, 3), mode: settings.field("mode").choice("singleplayer", "coop", "deathmatch"),
    maxClients: settings.field("maxClients").integer(1), seed: settings.field("seed").integer(0),
    hostMilliseconds: reader.field("hostMilliseconds").finite(),
    clientSlots: guest === null ? reader.field("players").list(value => value.field("clientSlot").integer(0))
      : savedQ3GuestClients(guest).map(player => player.client.slot) };
}
