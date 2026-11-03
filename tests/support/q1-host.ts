// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../src/contracts/identity.ts";
import type { TransitionIntent } from "../../src/contracts/gameplay.ts";
import { Q1_DONOR_PROFILE } from "../../src/core/numeric.ts";
import type { Q1Actor, Q1Event, Q1FoundationHost } from "../../src/content/q1/foundation/types.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../src/world/actors/index.ts";
import type { ActorCallbackTable, SessionActorRegistry } from "../../src/world/actors/index.ts";
import type { SceneQueries } from "../../src/world/collision/index.ts";
import type { GameplayAuthority, SharedInventoryTable } from "../../src/world/gameplay/index.ts";

/** The parts every Q1 test host is built over. `scene` is the real map collision; without it the world is an open void. */
export interface Q1HostParts {
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly scene?: SceneQueries;
  /** Reported as the hit actor when a trace strikes the map. */
  readonly world?: () => ActorId | null;
  /** The game that owns the entities; read lazily because the host is built before the game. */
  readonly entity: (actor: ActorId) => Q1Actor | null | undefined;
  readonly players: () => readonly ActorId[];
}

export interface Q1TestHost {
  readonly host: Q1FoundationHost;
  /** Think times the game scheduled, keyed by actor. */
  readonly pending: Map<OwnedActor, number>;
  readonly events: Q1Event[];
  readonly transitions: TransitionIntent[];
}

type Contents = ReturnType<Q1FoundationHost["contents"]>;
const contentsByCode = new Map<number, Contents>([[-2, "solid"], [-3, "water"], [-4, "slime"], [-5, "lava"], [-6, "sky"]]);

/** Body linking as the production scene does: a live solid or trigger entity links as a box or its brush model, anything else is unlinked. */
export function q1SceneBodies(actors: SessionActorRegistry, scene: SceneQueries, entity: Q1HostParts["entity"]): SharedBodyTable {
  return new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const source = entity(body.actor);
    if (source === null || source === undefined || source.solid === "none" || source.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = source.model.startsWith("*") ? Number(source.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: source.owner,
      role: source.solid === "trigger" ? "trigger" : "solid", monster: source.monster !== null, deadMonster: false });
    return undefined;
  } });
}

/**
 * One Q1 foundation host for the suite. Defaults: map collision from `scene` (or an open void), no monster movement, think
 * scheduling and events recorded in the returned collections. Anything a test needs differently is an explicit override.
 */
export function q1TestHost(parts: Q1HostParts, overrides: Partial<Q1FoundationHost> = {}): Q1TestHost {
  const { scene } = parts, pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], transitions: TransitionIntent[] = [];
  const trace: Q1FoundationHost["trace"] = scene === undefined
    ? request => ({ fraction: 1, end: request.end, normal: { x: 0, y: 0, z: 0 }, actor: null, startSolid: false, allSolid: false, sky: false, inOpen: true, inWater: false })
    : request => {
      const result = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: request.missile === true ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (result.kind !== "q1") throw new Error("Q1 trace expected");
      return { fraction: result.fraction, end: result.end, normal: result.sourcePlane.normal,
        actor: result.hit.kind === "actor" ? result.hit.actor : result.hit.kind === "world" ? parts.world?.() ?? null : null,
        startSolid: result.startSolid, allSolid: result.allSolid, sky: false, inOpen: result.inOpen, inWater: result.inWater };
    };
  const contents: Q1FoundationHost["contents"] = scene === undefined ? () => "empty" : point => {
    const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
    if (result.kind !== "q1") throw new Error("Q1 contents expected");
    return contentsByCode.get(result.contents) ?? "empty";
  };
  const host: Q1FoundationHost = {
    actors: parts.actors, callbacks: parts.callbacks, bodies: parts.bodies, combat: parts.combat, inventory: parts.inventory, random: () => 0.4,
    trace, contents, walkMove: () => false, moveToGoal: () => undefined, changeYaw: () => undefined, checkBottom: () => false,
    pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: intent => { transitions.push(intent); return undefined; },
    players: parts.players, checkClient: () => null, classname: actor => parts.entity(actor)?.classname ?? "player", powerup: () => undefined,
    ...overrides,
  };
  return { host, pending, events, transitions };
}
