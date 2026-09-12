import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../../src/contracts/content.ts";
import { createContentDigest, createResourceId } from "../../../src/contracts/content.ts";
import type { FrameContext, ClockProfile } from "../../../src/contracts/time.ts";
import { Q3_BINARY32_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { SharedInventoryTable, GameplayAuthority } from "../../../src/world/gameplay/index.ts";
import { SharedSceneQueries } from "../../../src/world/collision/index.ts";
import { FrameScheduler } from "../../../src/world/scheduler.ts";
import { SharedPhysics } from "../../../src/app/bootstrap/simulation/physics.ts";
import { Q3SourceRuntime, createQ3SourceHost } from "../../../src/app/bootstrap/simulation/q3/index.ts";
import type { Q3SourceEvent } from "../../../src/app/bootstrap/simulation/q3/index.ts";
import { Q3CharacterActor, Q3DeathAnimationSequence, q3InitialCombat } from "../../../src/content/q3/foundation/character.ts";
import { damage } from "../../../src/content/q3/base/game/combat.ts";
import { ServerEntityFlags } from "../../../src/content/q3/base/shared/entity-shared.ts";
import { useActor } from "../../../src/content/q3/base/game/use-participant.ts";
import { Weapon, PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { parseQ3Bsp, adaptQ3Bsp } from "../../../src/formats/q3-map/index.ts";
import { openArchive } from "../../../src/content/archive/index.ts";

const archivePath = resolve(process.env["Q3_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../qfiles/q3a"), "baseq3/pak0.pk3");
const clock: ClockProfile = { kind: "q3", serverFrameMilliseconds: 100, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 };

function sourceRecipe(byteLength: number): ExecutableRecipe {
  const content = "q3:classic:baseq3:retail";
  const provider = (role: string): ProviderReference => ({ provider: `q3:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/q3dm1.bsp", byteLength,
    provenance: { kind: "loose", memberPath: "maps/q3dm1.bsp", mount: { kind: "loose", identity: { id: "mount:q3:smoke", content, generation: 0 }, rootPath: "/retail-map-smoke" } },
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

test.skipIf(!existsSync(archivePath))("retail Q3 map, selected player admission, source attacks and thinks share the session owners", async () => {
  const archive = await openArchive(archivePath, "pk3");
  const entry = archive.findEntries("maps/q3dm1.bsp")[0];
  if (entry === undefined) throw new Error("Retail q3dm1 is missing");
  const bytes = await archive.readEntry(entry); archive.close();
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
  const host = createQ3SourceHost({ actors, bodies: physics.bodies, callbacks, combat, inventory, scene,
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
    spawnPlayer: (entity, pose) => {
      const body = physics.bodies.read(entity.actor.id); if (body === null) throw new Error("Selected character body missing");
      physics.bodies.write(entity.actor, { ...body, origin: pose.origin, angles: pose.angles });
      if (entity.client === null) throw new Error("Selected character source client missing");
      entity.client.ps.viewheight = 22;
    },
  }, { gameType: 0, singlePlayer: false, maxClients: 2, mapName: "q3dm1" });
  runtime = new Q3SourceRuntime({ recipe, weaponProvider: { provider: "q3:weapons", content: recipe.map.entities.content }, product: "baseq3",
    entities: map.entities, seed: 42, maxClients: 2, buildDate: "source-smoke" }, host);
  combat.register(runtime.bridge.policy());
  const report = runtime.load();
  expect(report.outcomes.filter(outcome => outcome.kind === "unknown")).toHaveLength(0);
  expect(actors.atSource("q3:game", 1022)?.id).toEqual(runtime.pool.at(1022).actor.id);
  for (const next of [200, 300]) {
    time = next; runtime.beginFrame(frame());
    for (const observation of actors.observations()) { const actor = actors.resolveOwned(observation.id); if (actor !== null) runtime.runActor(actor); }
    runtime.endFrame();
  }
  expect(runtime.presentations().some(model => model.path.includes("shotgun"))).toBe(true);
  const actor = actors.allocateAtSource("q3:character", 0, "q3:selected-player"), zero = { x: 0, y: 0, z: 0 };
  const selectedBounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
  physics.bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds: selectedBounds, ground: null });
  combat.create(actor, { health: 87, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(actor, [{ item: "q2:weapon/blaster", count: 1, capacity: 1 }]);
  let deaths = 0;
  callbacks.bind(actor, { think: null, touch: null, use: null, pain: () => undefined, die: () => { deaths++; return undefined; } });
  host.sourceCommand({ actor: actor.id, source: { kind: "remote-client", client: identities.client(0, 0) }, sequence: 0,
    command: { kind: "q3", serverTimeMilliseconds: 200, angleWords: [0, 0, 0], buttons: 0, weapon: 0, forwardMove: 0, rightMove: 0, upMove: 0 } });
  const player = runtime.admitPlayer(actor, 0);
  expect(player.actor).toBe(actor);
  expect(combat.read(actor.id)?.health).toBe(87);
  expect(physics.bodies.read(actor.id)?.bounds).toEqual(selectedBounds);
  expect(player.s.solid).toBe((64 << 16) | (24 << 8) | 16);
  expect(inventory.count(actor.id, "q2:weapon/blaster")).toBe(1);
  // Impacts retain first-seen actor identity, including world and released foreign contacts.
  const bot = runtime.pool.spawn();
  bot.r.svFlags |= ServerEntityFlags.BOT;
  const first = actors.allocateAtSource("q2:contact-proof", 1, "q2:foreign-first");
  const removed = actors.allocateAtSource("q2:contact-proof", 2, "q2:foreign-removed");
  const order: string[] = [];
  bot.touch = (_self, other) => {
    const id = useActor(other);
    order.push(id.equals(first.id) ? "bot-first" : id.equals(runtime.pool.at(1022).actor.id) ? "bot-world" : "wrong-identity");
  };
  callbacks.bind(first, { think: null, use: null, pain: null, die: null, touch: contact => {
    expect(contact.other.equals(bot.actor.id)).toBe(true);
    order.push("foreign-first");
    actors.release(removed);
    const replacement = actors.allocateAtSource("q2:contact-proof", 2, "q2:replacement");
    callbacks.bind(replacement, { think: null, use: null, pain: null, die: null, touch: () => { order.push("wrong-replacement"); return undefined; } });
    return undefined;
  } });
  runtime.think.clientImpacts(bot, [first.id, first.id, removed.id, runtime.pool.at(1022).actor.id, first.id]);
  expect(order).toEqual(["bot-first", "foreign-first", "bot-world"]);
  runtime.pool.free(bot);
  actors.release(first);
  const replacement = actors.atSource("q2:contact-proof", 2);
  if (replacement !== null) actors.release(replacement);
  const client = runtime.pool.clientAt(0);
  expect(client.ps.stats.get(2)).toBe(0);
  client.ps.weapon = Weapon.WP_GRENADE_LAUNCHER;
  runtime.playerWeapon(actor.id);
  const grenade = actors.observations().map(observation => runtime.records.byActor(observation.id)).find(entity => entity?.classname === "grenade");
  if (grenade == null) throw new Error("Q3 weapon did not produce a shared grenade actor");
  expect(scheduler.pending(grenade.actor.id)?.timing.due.value).toBe(2800);
  time = 2800; runtime.beginFrame(frame()); runtime.runActor(grenade.actor);
  expect(grenade.s.eType).not.toBe(3);
  damage(runtime.combat, player, runtime.pool.at(1022), runtime.pool.at(1022), null, null, 1000, 0, 17);
  expect(deaths).toBe(1);
  expect(client.ps.persistant.get(PersistentIndex.PERS_KILLED)).toBe(1);
  expect(physics.bodies.read(actor.id)?.bounds).toEqual(selectedBounds);
  expect(runtime.sourceState().clients[0]?.actor).toEqual(actor.id);
  runtime.endFrame();
  expect(events.some(event => event.kind === "entity-event" && event.state.otherEntityNum === player.s.number)).toBe(true);
  expect(events.some(event => event.kind === "server-command" && event.text.startsWith("scores"))).toBe(true);
  const selected = new Q3CharacterActor(actor, "q3:character", "baseq3", { bodies: physics.bodies, callbacks, combat, inventory,
    placement: "source-game", timeMilliseconds: () => time, emit: () => { throw new Error("Source spawn owns teleport events"); },
    deathContext: () => ({ blood: true, noDrop: false, suicide: false, killerSourceSlot: 1022 }) }, host.deathAnimations);
  const body = physics.bodies.read(actor.id); if (body === null) throw new Error("Selected body was removed");
  physics.bodies.unlink(actor);
  selected.spawn({ body, combat: q3InitialCombat("100", null), inventory: inventory.entries(actor.id) });
  selected.spawn({ body, combat: q3InitialCombat("100", null), inventory: inventory.entries(actor.id) });
  expect(combat.read(actor.id)?.health).toBe(125);
  expect(physics.bodies.linked(actor.id)).toBeNull();
  expect(inventory.count(actor.id, "q2:weapon/blaster")).toBe(1);
});
