import { SharedOriginalPickupAdmission } from "../../../../src/world/gameplay/original-pickups.ts";
import { corpusFile } from "../../../support/corpus.ts";

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../../../src/contracts/content.ts";
import { createContentDigest, createResourceId } from "../../../../src/contracts/content.ts";
import type { FrameContext, ClockProfile } from "../../../../src/contracts/time.ts";
import { Q3_BINARY32_PROFILE } from "../../../../src/core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable, GameplayAuthority } from "../../../../src/world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../../src/world/collision/index.ts";
import { FrameScheduler } from "../../../../src/world/scheduler.ts";
import { SharedPhysics } from "../../../../src/app/bootstrap/simulation/physics.ts";
import { Q3SourceRuntime, createQ3SourceHost } from "../../../../src/app/bootstrap/simulation/q3/index.ts";
import type { Q3SourceEvent } from "../../../../src/app/bootstrap/simulation/q3/index.ts";
import { Q3DeathAnimationSequence } from "../../../../src/content/q3/foundation/character.ts";
import { parseQ3Bsp, adaptQ3Bsp } from "../../../../src/formats/q3-map/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";

const archivePath = resolve(corpusFile("q3a"), "baseq3/pak0.pk3");
const clock: ClockProfile = { kind: "q3", serverFrameMilliseconds: 100, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 };

function sourceRecipe(byteLength: number): ExecutableRecipe {
  const content = "q3:classic:baseq3:retail";
  const provider = (role: string): ProviderReference => ({ provider: `q3:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/q3dm17.bsp", byteLength,
    provenance: { kind: "loose", memberPath: "maps/q3dm17.bsp", mount: { kind: "loose", identity: { id: "mount:q3:smoke", content, generation: 0 }, rootPath: "/retail-map-smoke" } },
    digest: createContentDigest("0".repeat(64)), resolution: { kind: "default-order", plan: "mount-plan:q3:smoke", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:q3:smoke", preset: "recipe:q3:smoke", map: { geometryContent: content, geometry, entities: provider("game") },
    campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") }, movement: provider("movement"),
    character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"),
    inventory: provider("inventory"), match: provider("match"), transition: provider("transition"), execution: [],
    mounts: { id: "mount-plan:q3:smoke", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry],
    timing: ["game", "character", "movement", "combat", "weapons", "inventory"].map(role => ({ provider: provider(role).provider, clock, numeric: Q3_BINARY32_PROFILE })),
    ordering: { kind: "native", traversal: "source-slot-order", clock } };
}

test.skipIf(!existsSync(archivePath))("a func_train leg between coincident path corners stays finite", async () => {
  const archive = await openArchive(archivePath, "pk3");
  const entry = archive.findEntries("maps/q3dm17.bsp")[0];
  if (entry === undefined) throw new Error("Retail q3dm17 is missing");
  const bytes = await archive.readEntry(entry); archive.close();
  const trainEntities = [
    '{ "classname" "worldspawn" }',
    '{ "classname" "info_player_deathmatch" "origin" "0 0 64" }',
    '{ "classname" "func_train" "model" "*1" "target" "c1" "speed" "100" "origin" "0 0 0" }',
    '{ "classname" "path_corner" "targetname" "c1" "target" "c2" "origin" "64 64 64" }',
    '{ "classname" "path_corner" "targetname" "c2" "target" "c1" "origin" "64 64 64" }',
  ].join("\n");
  const map = adaptQ3Bsp(parseQ3Bsp(bytes)), recipe = sourceRecipe(bytes.length), identities = createIdentityOwner("q3-integration-smoke");
  const actors = new SessionActorRegistry(identities), callbacks = new ActorCallbackTable(actors), scene = new SharedSceneQueries(map);
  const physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q3_BINARY32_PROFILE,
    sourceOrder: (left, right) => (actors.sourceOf(left)?.slot ?? left.slot) - (actors.sourceOf(right)?.slot ?? right.slot),
    worldActor: () => actors.atSource("q3:game", 1022)?.id ?? null, onBlocked: () => { throw new Error("Q3 movers use source mover dispatch"); } });
  let runtime: Q3SourceRuntime | null = null;
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => { const body = physics.bodies.read(actor.id); if (body === null) throw new Error("Missing impulse body");
      physics.bodies.write(actor, { ...body, velocity: { x: Math.fround(body.velocity.x + impulse.x), y: Math.fround(body.velocity.y + impulse.y), z: Math.fround(body.velocity.z + impulse.z) } }); return undefined; },
    beforeReaction: (actor, decision) => { if (runtime === null) throw new Error("Source is not constructed"); runtime.beforeReaction(actor, decision); return undefined; },
    confirmed: () => undefined,
  });
  const inventory = new SharedInventoryTable(actors), scheduler = new FrameScheduler({ actors, ordering: recipe.ordering,
    clocks: recipe.timing.map(entry => ({ provider: entry.provider, profile: entry.clock })),
    resolve: () => (actor, frame) => { callbacks.think(actor, frame); return undefined; } });
  let time = 100;
  const frame = (): FrameContext => ({ frame: time / 100, time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: 100 }, phase: "entity-physics" });
  const events: Q3SourceEvent[] = [];
  const host = createQ3SourceHost({ actors, bodies: physics.bodies, callbacks, combat, inventory, scene, originalPickups: new SharedOriginalPickupAdmission(actors, combat, inventory),
    moverActors: {
      observe: id => {
        const actor = actors.resolveOwned(id), state = physics.bodies.read(id), linked = physics.bodies.linked(id);
        if (actor === null || state === null || linked === null) return null;
        const motion = physics.motionOf(id);
        return { actor, state, absoluteBounds: linked.absoluteBounds, clipMask: motion?.clipMask ?? 1,
          kind: physics.bodies.attachment(id) !== null ? "attached" : runtime?.records.nativeByActor(id)?.client != null ? "player"
            : motion === null || motion.kind === "stationary" || motion.kind === "push" || motion.kind === "stop" ? "fixed" : "movable" };
      },
      write: (actor, origin, ground) => { const body = physics.bodies.read(actor.id); if (body !== null) physics.bodies.write(actor, { ...body, origin, ground }); return undefined; },
      link: actor => physics.bodies.link(actor), release: actor => actors.release(actor),
    },
    bots: { kind: "unavailable", reason: "This source phase smoke admits human actors" }, deathAnimations: new Q3DeathAnimationSequence(), now: () => time,
    emit: event => { events.push(event); }, clientNumber: actor => actors.sourceOf(actor)?.slot ?? -1,
    schedule: (actor, due) => { if (due === null) scheduler.cancel(actor); else scheduler.schedule(actor, "world:think", {
      due: { kind: "milliseconds", value: due }, boundary: "during-physics", order: { actor: actor.id, provider: actor.owner, sequence: 0 } }); return undefined; },
    runThink: actor => { scheduler.run(actor.id, frame(), "during-physics"); return undefined; },
    collision: (actor, collision) => physics.setCollision(actor, collision), armorContext: () => ({ screenFacingDot: 1, arithmetic: "binary32" }), foreign: () => null, isPlayer: () => false,
    sourceCommand: input => { const command = input.command; if (command.kind !== "q3") throw new Error("Smoke command is Q3");
      return { serverTime: command.serverTimeMilliseconds, angles: { x: command.angleWords[0], y: command.angleWords[1], z: command.angleWords[2] }, buttons: command.buttons,
        weapon: command.weapon, forwardmove: command.forwardMove, rightmove: command.rightMove, upmove: command.upMove }; },
    moveClient: () => { throw new Error("Admission must retain the existing command time until the next selected movement command"); },
    selectSpawnWeapon: () => undefined,
    spawnPlayer: (entity, pose) => {
      const body = physics.bodies.read(entity.actor.id); if (body === null) throw new Error("Selected character body missing");
      physics.bodies.write(entity.actor, { ...body, origin: pose.origin, angles: pose.angles });
      if (entity.client === null) throw new Error("Selected character source client missing");
      entity.client.ps.viewheight = 22;
    },
  }, { gameType: 0, singlePlayer: false, maxClients: 2, mapName: "q3dm17" });
  runtime = new Q3SourceRuntime({ recipe, weaponProvider: { provider: "q3:weapons", content: recipe.map.entities.content }, product: "baseq3",
    entities: trainEntities, seed: 42, maxClients: 2, buildDate: "source-smoke" }, host);
  combat.register(runtime.bridge.policy());
  const report = runtime.load();
  expect(report.outcomes.filter(outcome => outcome.kind === "unknown")).toHaveLength(0);
  let train: ReturnType<typeof runtime.pool.at> | null = null;
  for (let slot = 0; slot < 1024; slot++) { const entity = runtime.pool.at(slot); if (entity.classname === "func_train") { train = entity; break; } }
  if (train === null) throw new Error("The train did not spawn");
  for (const next of [200, 300, 400, 500, 600, 700, 800]) {
    time = next; runtime.beginFrame(frame());
    for (const observation of actors.observations()) { const actor = actors.resolveOwned(observation.id); if (actor !== null) runtime.runActor(actor); }
    runtime.endFrame();
  }
  expect(Number.isFinite(train.s.pos.duration)).toBe(true);
  expect(train.s.pos.duration).toBeGreaterThanOrEqual(1);
  for (const value of [train.s.pos.delta.x, train.s.pos.delta.y, train.s.pos.delta.z, train.r.currentOrigin.x, train.r.currentOrigin.y, train.r.currentOrigin.z]) expect(Number.isFinite(value)).toBe(true);
});
