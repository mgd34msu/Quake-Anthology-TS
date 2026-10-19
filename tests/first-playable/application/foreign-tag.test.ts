import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { callMethod, numberValue, objectValue, readBoolean, readField, readNumber, readObject, readObjectOrNull } from "../../support/reflect.ts";

// Rogue Tag (provider q2:tag) must play on foreign worlds in the unified
// engine. Q2 worlds keep the native composition module; everywhere else the
// shared runtime mirrors dm_tag over unified actors: a generic token actor
// at the farthest deathmatch spawn (from the retained entity lump), pickup
// by touch, owner frags scoring 3 and killing the owner scoring 5 with
// transfer. Deaths here are driven through the runtime's own observations
// (combat health transition + last-attack provenance), while admission,
// token spawn, touch pickup and score writing run for real.
type Simulation = import("../../../src/app/bootstrap/simulation/runtime.ts").SharedSimulation;

function tagTokenId(sim: Simulation): ActorId | null {
  const token = readObjectOrNull(sim, "tagToken");
  if (token === null) return null;
  const id: unknown = readField(token, "id");
  return sim.actors.observations().find(candidate => candidate.id === id)?.id ?? null;
}

function tagOwner(sim: Simulation): ActorId | null {
  const owner: unknown = readField(sim, "tagOwner");
  if (owner === null) return null;
  return sim.players().find(actor => actor === owner) ?? null;
}

function teleport(sim: Simulation, actor: ActorId, origin: { x: number; y: number; z: number }): void {
  callMethod(sim, "setPlayerMovement", actor, {
    kind: "teleport", origin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    commandAngles: { x: 0, y: 0, z: 0 }, holdMilliseconds: 0, spectator: false,
  });
}

test("Tag plays on a Q3 world through the runtime match layer", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "tag",
    "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(sim.recipe.match.provider).toBe("q2:tag");
    expect(readBoolean(sim, "foreignTag")).toBe(true);
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 400; index++) { await app.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}`);
    };
    for (let index = 0; index < 200 && sim.players().length < 2; index++) { sim.botServices.tryAddBot(); await app.step(50); }
    const bot = sim.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot");
    await stepUntil(() => tagTokenId(sim) !== null, "token to spawn");
    const tokenId = tagTokenId(sim);
    if (tokenId === null) throw new Error("Token did not spawn");
    const tokenOrigin = sim.bodies.read(tokenId)?.origin;
    if (tokenOrigin === undefined || tokenOrigin === null) throw new Error("Token has no body");
    const presentation = sim.presentations().find(model => model.actor.equals(tokenId));
    expect(presentation?.path).toBe("models/items/tagtoken/tris.md2");
    teleport(sim, local.actor, tokenOrigin);
    await stepUntil(() => tagOwner(sim)?.equals(local.actor) === true, "local player to pick up the token");
    expect(tagTokenId(sim)).toBeNull();
    expect(sim.playerUi(local.actor).armor.regular).toMatchObject({ kind: "q3", points: 100 });

    const records = readObject(readObject(readObject(sim, "source"), "game"), "records");
    const score = (actor: ActorId): number => {
      const entity = objectValue(callMethod(records, "nativeByActor", actor), "native entity");
      const persistant = readObject(readObject(readObject(entity, "client"), "ps"), "persistant");
      return numberValue(callMethod(persistant, "get", PersistentIndex.PERS_SCORE), "PERS_SCORE");
    };
    const lastAttack = readObject(sim, "lastAttack");
    const attack = (attacker: ActorId) => ({ sequence: 424242, time: { kind: "milliseconds", value: 0 }, attacker, inflictor: attacker,
      weapon: null, weaponProvider: "q3:official", combatProvider: "q3:official", inventoryProvider: "q3:official", movementProvider: "q3:official",
      cause: { kind: "q3", meansOfDeath: 1, damageFlags: 0 } });
    const kill = async (victim: ActorId, attacker: ActorId): Promise<void> => {
      const owned = sim.actors.resolveOwned(victim);
      if (owned === null) throw new Error("Victim has no owned actor");
      if ((sim.combat.read(victim)?.health ?? 0) <= 0) sim.combat.setHealth(owned, 100);
      callMethod(lastAttack, "set", owned, attack(attacker));
      await app.step(50);
      callMethod(lastAttack, "set", owned, attack(attacker));
      sim.combat.setHealth(owned, 0);
      await app.step(50); await app.step(50);
    };
    const localBefore = score(local.actor);
    await kill(bot, local.actor);
    expect(score(local.actor) - localBefore).toBeGreaterThanOrEqual(2);
    expect(readNumber(sim, "tagCount")).toBe(1);
    expect(tagOwner(sim)?.equals(local.actor)).toBe(true);

    const botOwned = sim.actors.resolveOwned(bot);
    if (botOwned === null) throw new Error("Bot has no owned actor");
    for (let index = 0; index < 100 && (sim.combat.read(bot)?.health ?? 0) <= 0; index++) { sim.combat.setHealth(botOwned, 100); await app.step(50); }
    const botBefore = score(bot);
    await kill(local.actor, bot);
    expect(score(bot) - botBefore).toBeGreaterThanOrEqual(4);
    expect(tagOwner(sim)?.equals(bot)).toBe(true);
    expect(readNumber(sim, "tagCount")).toBe(0);
  } finally { await app.close(); }
}, 240000);

test("Tag token spawns and is picked up on a Q1 world", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1",
    "--map", "dm3", "--rules", "tag",
    "--movement", "q1", "--character", "q1", "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(readBoolean(sim, "foreignTag")).toBe(true);
    for (let index = 0; index < 400 && tagTokenId(sim) === null; index++) await app.step(50);
    const tokenId = tagTokenId(sim);
    if (tokenId === null) throw new Error("Token did not spawn");
    const tokenOrigin = sim.bodies.read(tokenId)?.origin;
    if (tokenOrigin === undefined || tokenOrigin === null) throw new Error("Token has no body");
    teleport(sim, local.actor, tokenOrigin);
    for (let index = 0; index < 200 && tagOwner(sim) === null; index++) await app.step(50);
    expect(tagOwner(sim)?.equals(local.actor)).toBe(true);
    expect(sim.playerUi(local.actor).armor.regular).toMatchObject({ kind: "q1", points: 100 });
  } finally { await app.close(); }
}, 240000);
