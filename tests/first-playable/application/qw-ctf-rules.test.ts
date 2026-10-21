import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { createStartupSelection } from "../../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { callMethod, numberValue, objectValue, readBoolean, readField, readObject } from "../../support/reflect.ts";

// Shared CTF (provider q1:ctf) must run on QuakeWorld programs like on every
// other provider: the unified flag layer spawns both flags (authored flag
// entities where present, farthest deathmatch spawns elsewhere), assigns
// teams, and runs take/capture through the same machinery as foreign LMCTF.
type Simulation = import("../../../src/app/bootstrap/simulation/runtime.ts").SharedSimulation;

function ctfFlag(sim: Simulation, team: number): { id: ActorId; state: object } | null {
  const flags = readObject(sim, "lmctfFlags");
  const entry: unknown = callMethod(flags, "get", team);
  if (typeof entry !== "object" || entry === null) return null;
  const actor: unknown = readField(entry, "actor");
  if (actor === null) return null;
  const id: unknown = readField(objectValue(actor, "flag actor"), "id");
  const found = sim.actors.observations().find(candidate => candidate.id === id);
  return found === undefined ? null : { id: found.id, state: entry };
}

function ctfCarrier(sim: Simulation, team: number): ActorId | null {
  const flags = readObject(sim, "lmctfFlags");
  const entry: unknown = callMethod(flags, "get", team);
  if (typeof entry !== "object" || entry === null) return null;
  const carrier: unknown = readField(entry, "carrier");
  if (carrier === null) return null;
  return sim.players().find(actor => actor === carrier) ?? null;
}

function teleport(sim: Simulation, actor: ActorId, origin: { x: number; y: number; z: number }): void {
  callMethod(sim, "setPlayerMovement", actor, {
    kind: "teleport", origin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    commandAngles: { x: 0, y: 0, z: 0 }, holdMilliseconds: 0, spectator: false,
  });
}

function matchScore(sim: Simulation, actor: ActorId): number {
  const player = objectValue(callMethod(sim, "primaryMatchPlayer", actor), "match player");
  return numberValue(callMethod(player, "score"), "match score");
}

async function playCtf(mapSet: string, map: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "quake-qw-ctf-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q1-quakeworld", "--map", map, "--mode", "deathmatch", "--rules", "ctf",
      "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const selection = await createStartupSelection(parsed.options);
    selection.select("mapProduct", mapSet);
    const launch = await selection.resolve();
    app = await Application.open(launch.options, { saveDirectory: join(root, "saves"), print: () => undefined }, launch.recipe);
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(sim.recipe.match.provider).toBe("q1:ctf");
    expect(readBoolean(sim, "foreignCtf")).toBe(true);
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 400; index++) { await app?.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}`);
    };

    await stepUntil(() => ctfFlag(sim, 1) !== null && (ctfFlag(sim, 2) !== null || ctfCarrier(sim, 2) !== null), "both flags to spawn");
    expect(callMethod(readObject(sim, "lmctfTeams"), "get", local.actor)).toBe(1);
    expect(sim.combat.read(local.actor)?.team).toBe("red");
    const ownFlag = ctfFlag(sim, 1); if (ownFlag === null) throw new Error("Red flag missing");
    expect(sim.presentations().find(model => model.actor.equals(ownFlag.id))?.path).toBe("progs/flag.mdl");
    expect(sim.presentations().find(model => model.actor.equals(ownFlag.id))?.family).toBe("q1");

    const before = matchScore(sim, local.actor);
    if (ctfCarrier(sim, 2) === null) {
      const enemyFlag = ctfFlag(sim, 2); if (enemyFlag === null) throw new Error("Blue flag did not spawn");
      const enemyOrigin = sim.bodies.read(enemyFlag.id)?.origin;
      if (enemyOrigin === undefined || enemyOrigin === null) throw new Error("Blue flag has no body");
      teleport(sim, local.actor, enemyOrigin);
    }
    await stepUntil(() => ctfCarrier(sim, 2)?.equals(local.actor) === true, "local player to take the blue flag");

    const ownOrigin = sim.bodies.read(ownFlag.id)?.origin;
    if (ownOrigin === undefined || ownOrigin === null) throw new Error("Red flag has no body");
    teleport(sim, local.actor, ownOrigin);
    await stepUntil(() => ctfCarrier(sim, 2) === null && ctfFlag(sim, 2) !== null, "capture to reset the blue flag");
    expect(matchScore(sim, local.actor) - before).toBeGreaterThanOrEqual(15);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}

test("QuakeWorld plays shared CTF rules on a generic map (dm3)", async () => { await playCtf("q1-quakeworld", "dm3"); }, 240000);
test("QuakeWorld plays shared CTF rules on authored flags (ctf1)", async () => { await playCtf("q1-classic-ctf", "ctf1"); }, 240000);
