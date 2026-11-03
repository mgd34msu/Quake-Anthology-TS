// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, ClientId } from "../../../contracts/identity.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { q2Userinfo } from "../../../content/q2/base/player/index.ts";
import type { Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import type { SourceRuntime } from "./runtime.ts";

type Of<K extends SourceRuntime["kind"]> = Extract<SourceRuntime, { readonly kind: K }>;

/** What a strategy may ask of the simulation that owns it; the simulation's own stores stay the single copy. */
export interface SourceStrategyHost {
  readonly q2Views: Map<ActorId, Q2PlayerView>;
  playerClient(actor: ActorId): ClientId | null;
  nativeQ2Client(actor: ActorId): ClientId;
  /** Whether the Q2 player has a cutscene camera. */
  hasCutscene(actor: ActorId): boolean;
  /** Raises the userinfo client event when the source's stored userinfo no longer equals `previous`. */
  userinfoChanged(actor: ActorId, previous: string | null): void;
}

export interface PauseControl {
  readonly cvars: CvarRegistry;
  isSpectator(actor: ActorId): boolean;
}

/** The per-source behavior of a SharedSimulation, chosen once when its source is created. */
export interface SourceStrategy {
  /** The actor's userinfo string as the source stores it, or null when the source has none. */
  userinfo(actor: ActorId): string | null;
  /** Replaces the stored userinfo without running the source's change callbacks. */
  storeUserinfo(actor: ActorId, client: ClientId, userinfo: string): void;
  /** Applies a userinfo change through the source's own path; the result is awaited by the caller. */
  updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void | Promise<void>;
  /** Pause settings, or null when the source cannot pause. */
  pause(): PauseControl | null;
}

function joinInfo(values: Iterable<readonly [string, string]>): string {
  return [...values].map(([name, value]) => `\\${name}\\${value}`).join("");
}
function sameInfo(previous: ReadonlyMap<string, string>, values: ReadonlyMap<string, string>): boolean {
  return previous.size === values.size && [...values].every(([name, value]) => previous.get(name) === value);
}

class LoadingStrategy implements SourceStrategy {
  userinfo(_actor: ActorId): string | null { return null; }
  storeUserinfo(_actor: ActorId, _client: ClientId, _userinfo: string): void { throw new Error("Component userinfo requires an initialized source"); }
  updateUserinfo(_actor: ActorId, _userinfo: string, _previous: string | null): void | Promise<void> { /* no source yet: nothing stores userinfo */ }
  pause(): PauseControl | null { return null; }
}

class Q1Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q1">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null { return joinInfo(this.source.composition.clients.require(actor).userinfo); }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const info = this.source.composition.clients.require(actor).userinfo; info.clear();
    for (const [name, value] of q2Userinfo(userinfo)) info.set(name, value);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const current = this.source.composition.clients.require(actor).userinfo, values = q2Userinfo(userinfo);
    if (sameInfo(current, values)) return;
    this.source.composition.userinfo(actor, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl { return { cvars: this.source.cvars, isSpectator: () => false }; }
}

class QuakeCStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"quakec">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : joinInfo(this.source.game.clientInfo(client));
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.setClientInfoStorage(client, q2Userinfo(userinfo)); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor); if (client === null) return;
    const values = q2Userinfo(userinfo);
    if (sameInfo(this.source.game.clientInfo(client), values)) return;
    this.source.game.setClientInfo(client, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl {
    const game = this.source.game;
    return { cvars: game.cvars, isSpectator: actor => game.kind === "quakeworld" && game.isSpectatorClient(actor) };
  }
}

class Q2Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q2">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null { return this.source.players.states.get(actor)?.userinfo ?? null; }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const player = this.source.players.states.get(actor); if (player === undefined) throw new Error("Component userinfo has no Q2 player");
    player.userinfo = userinfo;
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const source = this.source, state = source.players.states.get(actor), entity = source.game.entity(actor);
    if (state === undefined || entity === null || state.userinfo === userinfo) return;
    const previousFov = state.fov, previousRequest = q2Userinfo(state.userinfo).get("fov");
    source.players.userinfoChanged(entity, source.game, userinfo);
    if (this.host.hasCutscene(actor) || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0 || previousRequest === q2Userinfo(userinfo).get("fov")) state.fov = previousFov;
    const view = this.host.q2Views.get(actor);
    if (view?.fov === previousFov) this.host.q2Views.set(actor, { ...view, fov: state.fov });
    this.host.userinfoChanged(actor, previous);
  }
}

class Q2NativeStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q2-native">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    return this.source.game.clients.find(client => client.slot === slot)?.userinfo ?? null;
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.setUserinfoStorage(client.slot + 1, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    if (this.source.game.clients.find(client => client.slot === slot)?.userinfo !== userinfo) this.source.game.userinfo(slot, userinfo);
    this.host.userinfoChanged(actor, previous);
  }
}

class Q3Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q3">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : this.source.game.host.engine.getUserinfo(client.slot);
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.host.engine.setUserinfo(client.slot, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor); if (client === null) throw new Error("Q3 userinfo has no admitted client");
    this.source.game.host.engine.setUserinfo(client.slot, userinfo);
    this.source.game.admission.userinfoChanged(client.slot);
    this.host.userinfoChanged(actor, previous);
  }
}

class Q3QvmStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q3-qvm">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : this.source.game.state.getUserinfo(client.slot) ?? null;
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.state.setUserinfo(client.slot, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, _previous: string | null): void | Promise<void> {
    const player = this.source.game.players().find(player => player.actor.equals(actor));
    if (player === undefined) throw new Error("Q3 guest userinfo has no admitted client");
    return this.source.game.userinfo(player, userinfo);
  }
}

export function createSourceStrategy(source: SourceRuntime, host: SourceStrategyHost): SourceStrategy {
  switch (source.kind) {
    case "loading": return new LoadingStrategy();
    case "quakec": return new QuakeCStrategy(source, host);
    case "q1": return new Q1Strategy(source, host);
    case "q3": return new Q3Strategy(source, host);
    case "q3-qvm": return new Q3QvmStrategy(source, host);
    case "q2-native": return new Q2NativeStrategy(source, host);
    case "q2": return new Q2Strategy(source, host);
  }
}
