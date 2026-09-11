/** Stable implementation name, separate from its session-owned actor handles. */
export type ProviderId = `${string}:${string}`;
export type CallbackId = `${string}:${string}`;

class SessionIdentity {
  readonly #token: symbol;
  constructor(readonly name: string, token: symbol) { this.#token = token; Object.freeze(this); }
  belongsTo(token: symbol): boolean { return this.#token === token; }
}

class ActorIdentity {
  readonly #token: symbol;
  constructor(readonly session: SessionId, readonly slot: number, readonly generation: number, token: symbol) {
    this.#token = token;
    Object.freeze(this);
  }
  equals(other: ActorIdentity): boolean {
    return this.#token === other.#token && this.slot === other.slot && this.generation === other.generation;
  }
}

class SeatIdentity {
  readonly #token: symbol;
  constructor(readonly session: SessionId, readonly index: number, token: symbol) {
    this.#token = token;
    Object.freeze(this);
  }
  equals(other: SeatIdentity): boolean { return this.#token === other.#token && this.index === other.index; }
}

class ClientIdentity {
  readonly #token: symbol;
  constructor(readonly session: SessionId, readonly slot: number, readonly generation: number, token: symbol) {
    this.#token = token;
    Object.freeze(this);
  }
  equals(other: ClientIdentity): boolean {
    return this.#token === other.#token && this.slot === other.slot && this.generation === other.generation;
  }
}

class OwnedActorReference {
  readonly #token: symbol;
  constructor(readonly id: ActorId, readonly owner: ProviderId, token: symbol) {
    this.#token = token;
    Object.freeze(this);
  }
  belongsTo(token: symbol): boolean { return this.#token === token; }
}

export type SessionId = SessionIdentity;
export type ActorId = ActorIdentity;
export type SeatId = SeatIdentity;
export type ClientId = ClientIdentity;
export type OwnedActor = OwnedActorReference;

/** Held by the session registry, never passed to gameplay providers. */
export interface IdentityOwner {
  readonly session: SessionId;
  actor(slot: number, generation: number): ActorId;
  ownedActor(id: ActorId, provider: ProviderId): OwnedActor;
  seat(index: number): SeatId;
  client(slot: number, generation: number): ClientId;
  owns(id: ActorId | SeatId | ClientId): boolean;
}

function natural(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

/** A fresh authority is required when restoring a session into another process. */
export function createIdentityOwner(name: string): IdentityOwner {
  if (name.length === 0) throw new RangeError("A session identity needs a name");
  const token = Symbol(name);
  const session: SessionId = new SessionIdentity(name, token);
  return {
    session,
    actor(slot, generation) {
      return new ActorIdentity(session, natural(slot, "Actor slot"), natural(generation, "Actor generation"), token);
    },
    ownedActor(id, provider) {
      if (!id.session.belongsTo(token)) throw new RangeError("Actor belongs to another session");
      return new OwnedActorReference(id, provider, token);
    },
    seat(index) {
      return new SeatIdentity(session, natural(index, "Seat index"), token);
    },
    client(slot, generation) {
      return new ClientIdentity(session, natural(slot, "Client slot"), natural(generation, "Client generation"), token);
    },
    owns(id) { return id.session.belongsTo(token); },
  };
}

/** Value equality handles a freshly decoded reference within the same live registry. */
export function sameActor(left: ActorId, right: ActorId): boolean {
  return left.equals(right);
}
