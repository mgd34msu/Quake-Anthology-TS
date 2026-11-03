// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../src/contracts/identity.ts";
import type { TransitionIntent } from "../../src/contracts/gameplay.ts";
import type { Q2Entity, Q2FoundationHost, Q2PresentationEvent } from "../../src/content/q2/foundation/host.ts";
import type { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../src/world/actors/index.ts";
import type { GameplayAuthority, SharedInventoryTable } from "../../src/world/gameplay/index.ts";

/** The parts every Q2 test host is built over; the world and player identities come from the test's own actors. */
export interface Q2HostParts {
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  /** The world actor, or a lookup for tests that create it after the host. */
  readonly world: ActorId | (() => ActorId);
  readonly players: () => readonly ActorId[];
  /** The game that owns the entities; read lazily because the host is built before the game. */
  readonly entity: (actor: ActorId) => Q2Entity | null | undefined;
}

export interface Q2TestHost {
  readonly host: Q2FoundationHost;
  /** Think times the game scheduled, keyed by actor. */
  readonly scheduled: Map<OwnedActor, number>;
  readonly events: Q2PresentationEvent[];
  readonly diagnostics: string[];
  readonly transitions: TransitionIntent[];
}

const zero = { x: 0, y: 0, z: 0 };

/**
 * One Q2 foundation host for the suite. Defaults: an open world with unit time steps of 0.1 s, no travel and no triggers, source
 * monsters recognised by the monster server flag, and scheduling, events, diagnostics and transitions recorded in the result.
 * Anything a test needs differently is an explicit override.
 */
export function q2TestHost(parts: Q2HostParts, overrides: Partial<Q2FoundationHost> = {}): Q2TestHost {
  const scheduled = new Map<OwnedActor, number>(), events: Q2PresentationEvent[] = [], diagnostics: string[] = [], transitions: TransitionIntent[] = [];
  const host: Q2FoundationHost = {
    actors: parts.actors, callbacks: parts.callbacks, bodies: parts.bodies, combat: parts.combat, inventory: parts.inventory,
    now: () => 0, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    touchTriggers: () => undefined,
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0,
      surface: null, sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 }, secondary: null }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [],
    players: parts.players, worldActor: () => typeof parts.world === "function" ? parts.world() : parts.world, isPlayer: actor => parts.players().some(player => player.equals(actor)),
    isMonster: actor => ((parts.entity(actor)?.serverFlags ?? 0) & 4) !== 0,
    inlineModelBounds: () => ({ min: zero, max: zero }), setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined, prepareLevelChange: () => undefined,
    transition: intent => { transitions.push(intent); return undefined; }, diagnostic: message => { diagnostics.push(message); return undefined; },
    ...overrides,
  };
  return { host, scheduled, events, diagnostics, transitions };
}
