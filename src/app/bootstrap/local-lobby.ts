import { LocalLobbyService } from "../../network/services/online.ts";
import type { Account, Lobby, LobbyId } from "../../network/services/online.ts";

export interface LocalLobbyTransitions {
  host(lobby: Lobby & { readonly phase: "starting" }): Promise<{ readonly endpoint: NonNullable<Lobby["endpoint"]>; readonly wire: NonNullable<Lobby["wire"]> }>;
  join(lobby: Extract<Lobby, { readonly phase: "playing" }>): Promise<void>;
  leave(lobby: Lobby): Promise<void>;
  completed(lobby: Lobby): Promise<void>;
}
export interface LocalLobbySelection {
  readonly composition: Lobby["composition"];
}

/** Retained local service membership outlives each launched world. Retail platform lobbies are a separate provider. */
export class ApplicationLocalLobby {
  private membership: LobbyId | null = null;
  private lastLobby: Lobby | null = null;
  private launchedGeneration = 0;
  private completedGeneration = 0;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly service: LocalLobbyService, readonly account: Account,
    private readonly transitions: LocalLobbyTransitions) {}
  list(): readonly Lobby[] { return this.service.list(); }
  current(): Lobby | null { return this.service.list().find(lobby => lobby.id === this.membership) ?? null; }
  private operation(operation: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Local lobby session is closed"));
    const result = this.tail.then(operation);
    this.tail = result.catch((_error: unknown) => undefined);
    return result;
  }
  private require(): Lobby {
    const lobby = this.current();
    if (lobby === null || !lobby.members.some(member => member.account.id === this.account.id)) throw new Error("No current local lobby membership");
    return lobby;
  }
  host(name: string, capacity: number, selection: LocalLobbySelection, seats = 1): Promise<void> {
    return this.operation(async () => {
      if (this.membership !== null) throw new Error("Leave the current lobby before hosting another");
      const lobby = this.service.create(this.account, name, capacity, selection.composition, seats);
      this.membership = lobby.id; this.lastLobby = lobby; this.launchedGeneration = 0; this.completedGeneration = 0;
    });
  }
  join(id: LobbyId, seats = 1): Promise<void> {
    return this.operation(async () => {
      if (this.membership !== null) throw new Error("Leave the current lobby before joining another");
      const lobby = this.service.join(id, this.account, seats);
      this.membership = lobby.id; this.lastLobby = lobby; this.launchedGeneration = 0; this.completedGeneration = 0;
    });
  }
  ready(value: boolean): Promise<void> {
    return this.operation(async () => { this.service.ready(this.require().id, this.account.id, value); });
  }
  start(): Promise<void> {
    return this.operation(async () => {
      const lobby = this.require();
      if (lobby.owner !== this.account.id) throw new Error("Only the local lobby host can start a match");
      const next = this.service.start(lobby.id, this.account.id);
      let boundHost = false;
      try {
        const bound = await this.transitions.host(next);
        boundHost = true;
        this.lastLobby = this.service.publish(next.id, this.account.id, next.matchGeneration, bound.endpoint, bound.wire);
        this.launchedGeneration = next.matchGeneration;
      }
      catch (error: unknown) {
        const failures: unknown[] = [error];
        try { if (this.current() !== null) this.service.complete(next.id, this.account.id, next.matchGeneration); }
        catch (cleanup: unknown) { failures.push(cleanup); }
        try { if (boundHost) await this.transitions.leave(next); }
        catch (cleanup: unknown) { failures.push(cleanup); }
        if (failures.length > 1) throw new AggregateError(failures, "Lobby publication and host cleanup failed");
        throw error;
      }
    });
  }
  private async launch(lobby: Extract<Lobby, { readonly phase: "playing" }>): Promise<void> {
    if (lobby.matchGeneration <= this.launchedGeneration) return;
    await this.transitions.join(lobby);
    this.launchedGeneration = lobby.matchGeneration;
  }
  poll(): Promise<void> {
    return this.operation(async () => {
      if (this.membership === null) return;
      const lobby = this.current();
      if (lobby === null) {
        const previous = this.lastLobby; this.membership = null; this.lastLobby = null;
        if (previous !== null) await this.transitions.leave(previous);
        return;
      }
      this.lastLobby = lobby;
      if (lobby.phase === "playing") await this.launch(lobby);
      else if (lobby.phase === "open" && this.launchedGeneration > this.completedGeneration) {
        await this.transitions.completed(lobby); this.completedGeneration = this.launchedGeneration;
      }
    });
  }
  complete(): Promise<void> {
    return this.operation(async () => {
      const lobby = this.require();
      if (lobby.owner !== this.account.id) throw new Error("Only the local lobby host can complete the match");
      const completed = this.service.complete(lobby.id, this.account.id, this.launchedGeneration);
      if (this.launchedGeneration > this.completedGeneration) {
        await this.transitions.completed(completed); this.completedGeneration = this.launchedGeneration;
      }
    });
  }
  private async leaveCurrent(): Promise<void> {
    const lobby = this.current() ?? this.lastLobby;
    this.membership = null; this.lastLobby = null;
    if (lobby === null) return;
    if (this.service.list().some(current => current.id === lobby.id)) this.service.leave(lobby.id, this.account.id);
    await this.transitions.leave(lobby);
  }
  leave(): Promise<void> { return this.operation(() => this.leaveCurrent()); }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; await this.tail; await this.leaveCurrent();
  }
}
