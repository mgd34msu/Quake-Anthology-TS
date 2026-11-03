import { SharedOriginalPickupAdmission } from "../../../../../src/world/gameplay/original-pickups.ts";

import { SharedPhysics } from "../../../../../src/app/bootstrap/simulation/physics.ts";
import { createNativeQ1PusherServices } from "../../../../../src/app/bootstrap/simulation/native-q1-pusher.ts";
import { actorCollision, actorMotion, actorFlags } from "../../../../../src/app/bootstrap/simulation/actor-execution.ts";
import { createSceneQueries } from "../../../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../../../src/core/numeric.ts";
import type { ActorId, OwnedActor } from "../../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../../../src/world/actors/index.ts";
import { SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../../src/world/gameplay/index.ts";
import { Q1Foundation } from "../../../../../src/content/q1/foundation/runtime.ts";
import { ZERO, PLAYER_BOUNDS } from "../../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../../src/content/q1/base/index.ts";
import { registerQ1CampaignAddons, registerQ1Horde } from "../../../../../src/content/q1/addons/index.ts";
import type { Q1AddonEvent } from "../../../../../src/content/q1/addons/index.ts";
import type { Q1Entity } from "../../../../../src/formats/q1-map/index.ts";
import { inertAuthority } from "../../../../support/authority.ts";
import { q1TestHost } from "../../../../support/q1-host.ts";

export function world(program: "mg1" | "mg3", withHorde = false, walkable = false, coop = false, skill: 0 | 1 | 2 | 3 = 1) {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-addon-smoke")), callbacks = new ActorCallbackTable(actors);
  let runtime: Q1Foundation | null = null;
  const bounds = { min: { x: -1024, y: -1024, z: -1024 }, max: { x: 1024, y: 1024, z: 1024 } };
  const scene = createSceneQueries({ kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: ZERO, headnodes: [-2, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] });
  const execution = (actor: OwnedActor) => { const entity = runtime?.entity(actor.id); return entity == null || runtime === null ? null :
    { kind: "q1", entity, services: runtime, content: "q1:rerelease:mg3:test" } satisfies import("../../../../../src/app/bootstrap/simulation/actor-execution.ts").ActorExecution; };
  const physics: SharedPhysics = new SharedPhysics({ actors, callbacks, scene, numeric: Q1_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
    worldActor: () => runtime?.world?.actor.id ?? null, onBlocked: (actor, other) => runtime?.entity(actor.id)?.blocked?.(other),
    getCollision: actor => { const entry = execution(actor); return entry === null ? null : actorCollision(entry); },
    getMotion: actor => { const entry = execution(actor), body = physics.bodies.read(actor.id); return entry === null || body === null ? null : actorMotion(entry, body); },
    getFlags: actor => { const entry = execution(actor); return entry === null ? { player: true } : actorFlags(entry); } });
  const bodies = physics.bodies;

  const combat = inertAuthority(actors, callbacks);
  const inventory = new SharedInventoryTable(actors), addonEvents: Q1AddonEvent[] = [], players: ActorId[] = [];
  const cvars = new Map<string, number>();
  const { host, pending, events, transitions } = q1TestHost({ actors, callbacks, bodies, combat, inventory, entity: actor => runtime?.entity(actor), players: () => players }, {
    originalPickups: new SharedOriginalPickupAdmission(actors, combat, inventory), walkMove: () => walkable,
    changeYaw: () => { if (!walkable) throw new Error("This check does not drive monster turning"); return undefined; }, pusherServices: game => createNativeQ1PusherServices(game, physics),
  });
  const game = new Q1Foundation(host, { edition: "rerelease", skill, deathmatch: 0, coop, gravity: 800, maxClients: 4,
    campaign: program === "mg1" ? "q1:mg1" : "q1:mg3", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })), sourceEffects: game.damageSourceEffects }));
  const base = registerQ1Base(game), context = registerQ1CampaignAddons(base, program, {
    emit: event => { addonEvents.push(event); return undefined; }, isMonster: actor => game.entity(actor)?.monster !== null && game.entity(actor) !== null,
    cvar: name => cvars.get(name) ?? 0, setCvar: (name, value) => { cvars.set(name, Number(value)); return undefined; },
  });
  const horde = withHorde ? registerQ1Horde(context, { deadFlag: player => game.health(player) > 0 ? 0 : 2, noTarget: () => false, isBot: () => false,
    respawnTeammate: () => undefined, addScore: () => undefined, restartSession: () => undefined }) : null;
  const player = actors.allocateAtSource("q3:character", 1, "q3:sarge");
  bodies.create(player, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
  combat.create(player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(player, []); players.push(player.id); game.attachPlayer(player);
  const spawn = (classname: string, fields: Readonly<Record<string, string>> = {}) => {
    const source: Q1Entity = { properties: [{ key: "classname", value: classname }, ...Object.entries(fields).map(([key, value]) => ({ key, value }))] };
    const entity = game.create(classname, source); game.spawnEntity(entity); return entity;
  };
  const think = (entity: import("../../../../../src/content/q1/foundation/entity.ts").Q1Actor, time: number): undefined => {
    pending.delete(entity.actor); callbacks.think(entity.actor, { frame: 0, time: { kind: "seconds", value: time }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); return undefined;
  };
  const touch = (entity: import("../../../../../src/content/q1/foundation/entity.ts").Q1Actor): undefined => { callbacks.touch({ self: entity.actor, other: player.id, plane: null, surface: null }); return undefined; };
  const touchBy = (entity: import("../../../../../src/content/q1/foundation/entity.ts").Q1Actor, other: ActorId): undefined => { callbacks.touch({ self: entity.actor, other, plane: null, surface: null }); return undefined; };
  return { actors, game, base, context, horde, combat, player, events, addonEvents, pending, cvars, transitions, spawn, think, touch, touchBy };
}

