import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { callMethod, numberValue, objectValue, readBoolean, readField, readObject } from "../../support/reflect.ts";

// LMCTF (provider q2:lmctf) is its own PvP mod and must play on foreign
// worlds the way Tag does: Q2 worlds keep the native composition module,
// everywhere else the shared runtime mirrors Loki's Minions CTF over unified
// actors (flags from info_flag_* or farthest deathmatch spawns, balanced
// teams, capture scoring, dropped-flag return, and the five runes).
type Simulation = import("../../../src/app/bootstrap/simulation/runtime.ts").SharedSimulation;

function lmctfFlag(sim: Simulation, team: number): { id: ActorId; state: object } | null {
  const flags = readObject(sim, "lmctfFlags");
  const entry: unknown = callMethod(flags, "get", team);
  if (typeof entry !== "object" || entry === null) return null;
  const actor: unknown = readField(entry, "actor");
  if (actor === null) return null;
  const id: unknown = readField(objectValue(actor, "flag actor"), "id");
  const found = sim.actors.observations().find(candidate => candidate.id === id);
  return found === undefined ? null : { id: found.id, state: entry };
}

function lmctfCarrier(sim: Simulation, team: number): ActorId | null {
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

test("LMCTF plays on a Q3 world through the runtime match layer", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "lmctf",
    "--movement", "q3", "--character", "q3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  // LMCTF is its own PvP mode: no deathmatch selection is required with it.
  expect(parsed.options.mode).toBe("deathmatch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(sim.recipe.match.provider).toBe("q2:lmctf");
    expect(readBoolean(sim, "foreignLmctf")).toBe(true);
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 400; index++) { await app.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}`);
    };
    for (let index = 0; index < 200 && sim.players().length < 2; index++) { sim.botServices.tryAddBot(); await app.step(50); }
    const bot = sim.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot");

    await stepUntil(() => lmctfFlag(sim, 1) !== null && lmctfFlag(sim, 2) !== null, "both flags to spawn");
    const teams = readObject(sim, "lmctfTeams");
    expect(callMethod(teams, "get", local.actor)).toBe(1);
    expect(callMethod(teams, "get", bot)).toBe(2);
    expect(sim.combat.read(local.actor)?.team).toBe("red");
    const enemyFlag = lmctfFlag(sim, 2);
    if (enemyFlag === null) throw new Error("Blue flag did not spawn");
    expect(sim.presentations().find(model => model.actor.equals(enemyFlag.id))?.path).toBe("players/male/flag2.md2");

    const records = readObject(readObject(readObject(sim, "source"), "game"), "records");
    const score = (actor: ActorId): number => {
      const entity = objectValue(callMethod(records, "nativeByActor", actor), "native entity");
      const persistant = readObject(readObject(readObject(entity, "client"), "ps"), "persistant");
      return numberValue(callMethod(persistant, "get", PersistentIndex.PERS_SCORE), "PERS_SCORE");
    };
    const before = score(local.actor);
    const enemyOrigin = sim.bodies.read(enemyFlag.id)?.origin;
    if (enemyOrigin === undefined || enemyOrigin === null) throw new Error("Blue flag has no body");
    teleport(sim, local.actor, enemyOrigin);
    await stepUntil(() => lmctfCarrier(sim, 2)?.equals(local.actor) === true, "local player to take the blue flag");

    const ownFlag = lmctfFlag(sim, 1);
    if (ownFlag === null) throw new Error("Red flag missing");
    const ownOrigin = sim.bodies.read(ownFlag.id)?.origin;
    if (ownOrigin === undefined || ownOrigin === null) throw new Error("Red flag has no body");
    teleport(sim, local.actor, ownOrigin);
    await stepUntil(() => lmctfCarrier(sim, 2) === null && lmctfFlag(sim, 2) !== null, "capture to reset the blue flag");
    expect(score(local.actor) - before).toBeGreaterThanOrEqual(15);

    // A rune lies in the world and can be held.
    const runes = readObject(sim, "lmctfRunes");
    const runeEntry: unknown = callMethod(runes, "get", "damage");
    if (typeof runeEntry !== "object" || runeEntry === null) throw new Error("Damage rune missing");
    const runeActor: unknown = readField(runeEntry, "actor");
    if (runeActor === null) throw new Error("Damage rune did not spawn");
    const runeId: unknown = readField(objectValue(runeActor, "rune actor"), "id");
    const runeObserved = sim.actors.observations().find(candidate => candidate.id === runeId);
    if (runeObserved === undefined) throw new Error("Rune actor not observed");
    const runeOrigin = sim.bodies.read(runeObserved.id)?.origin;
    if (runeOrigin === undefined || runeOrigin === null) throw new Error("Rune has no body");
    teleport(sim, local.actor, runeOrigin);
    await stepUntil(() => readField(objectValue(callMethod(runes, "get", "damage"), "damage rune"), "holder") === local.actor, "local player to hold the damage rune");
  } finally { await app.close(); }
}, 240000);

test("LMCTF flags spawn and are taken on a Q1 world", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1",
    "--map", "dm3", "--rules", "lmctf",
    "--movement", "q1", "--character", "q1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  expect(parsed.options.mode).toBe("deathmatch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(readBoolean(sim, "foreignLmctf")).toBe(true);
    // The synthesized blue base is the farthest deathmatch spawn, which can
    // be the local player's own spawn: they may already be carrying it.
    for (let index = 0; index < 400 && lmctfFlag(sim, 1) === null; index++) await app.step(50);
    if (lmctfCarrier(sim, 2) === null) {
      const enemyFlag = lmctfFlag(sim, 2);
      if (enemyFlag === null) throw new Error("Blue flag did not spawn");
      const enemyOrigin = sim.bodies.read(enemyFlag.id)?.origin;
      if (enemyOrigin === undefined || enemyOrigin === null) throw new Error("Blue flag has no body");
      teleport(sim, local.actor, enemyOrigin);
      for (let index = 0; index < 200 && lmctfCarrier(sim, 2) === null; index++) await app.step(50);
    }
    expect(lmctfCarrier(sim, 2)?.equals(local.actor)).toBe(true);
    expect(sim.combat.read(local.actor)?.team).toBe("red");
  } finally { await app.close(); }
}, 240000);
