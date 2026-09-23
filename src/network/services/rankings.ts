/** Shared lifecycle for Q3 sv_rankings.c; the optional backend is the project's
 * sole permitted placeholder. Future services implement RankingServiceProvider. */
export interface RankingAccount { readonly playerId: bigint; readonly rank: number }
export interface RankingMatch { readonly gameId: bigint }
export type RankingAccountRequest =
  | { readonly kind: "login"; readonly username: string; readonly password: string }
  | { readonly kind: "create"; readonly username: string; readonly password: string; readonly email: string };
export type RankingLoginResult =
  | { readonly kind: "active"; readonly account: RankingAccount }
  | { readonly kind: "denied"; readonly reason: string };
export type RankingServiceReport =
  | { readonly kind: "integer"; readonly self: bigint; readonly other: bigint; readonly key: number; readonly value: number; readonly accumulate: boolean }
  | { readonly kind: "string"; readonly self: bigint; readonly other: bigint; readonly key: number; readonly value: string };
export interface RankingServiceProvider {
  readonly endpoint: URL;
  begin(gameKey: string): Promise<RankingMatch>;
  login(match: RankingMatch, request: RankingAccountRequest): Promise<RankingLoginResult>;
  join(match: RankingMatch, account: RankingAccount): Promise<void>;
  report(match: RankingMatch, report: RankingServiceReport): Promise<void>;
  poll(): Promise<void>;
  logout(match: RankingMatch, account: RankingAccount): Promise<void>;
  finish(match: RankingMatch): Promise<void>;
}
export type RankingServiceState =
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "starting" }
  | { readonly kind: "active"; readonly gameId: bigint }
  | { readonly kind: "ending" };
export type RankingPlayerState =
  | { readonly kind: "new" | "spectator" | "pending" }
  | { readonly kind: "active"; readonly account: RankingAccount }
  | { readonly kind: "denied"; readonly reason: string };

export class RankingLifecycle {
  private current: RankingServiceState = { kind: "disabled" };
  private match: RankingMatch | null = null;
  private readonly players = new Map<number, RankingPlayerState>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly provider: RankingServiceProvider | null,
    private readonly changed: (slot: number, state: RankingPlayerState) => void,
    private readonly serviceChanged: (state: RankingServiceState) => void = () => undefined) {}
  private setState(state: RankingServiceState): void { this.current = state; this.serviceChanged(state); }
  unavailable(reason: string): void { this.setState({ kind: "unavailable", reason }); }
  state(): RankingServiceState { return this.current; }
  player(slot: number): RankingPlayerState { return this.players.get(slot) ?? { kind: "new" }; }
  private setPlayer(slot: number, state: RankingPlayerState): void { this.players.set(slot, state); this.changed(slot, state); }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.then(operation);
    this.tail = next.catch((error: unknown) => { this.setState({ kind: "unavailable", reason: error instanceof Error ? error.message : "Ranking service failed" }); });
    return next;
  }
  begin(enabled: boolean, singlePlayer: boolean, gameKey: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.match !== null) throw new Error("Ranking match is already active");
      if (!enabled || singlePlayer) { this.setState({ kind: "disabled" }); return; }
      if (this.provider === null) {
        this.setState({ kind: "unavailable", reason: "No ranking service is configured. Local progress and match records remain available." }); return;
      }
      this.setState({ kind: "starting" });
      this.match = await this.provider.begin(gameKey);
      this.setState({ kind: "active", gameId: this.match.gameId });
    });
  }
  account(slot: number, request: RankingAccountRequest): Promise<void> {
    return this.enqueue(async () => {
      if (this.provider === null || this.match === null || this.current.kind !== "active") throw new Error("Ranking service is not active");
      if (this.player(slot).kind === "active") throw new Error("Ranking player is already active");
      this.setPlayer(slot, { kind: "pending" });
      try {
        const result = await this.provider.login(this.match, request);
        if (result.kind === "denied") { this.setPlayer(slot, result); return; }
        for (const state of this.players.values()) if (state.kind === "active" && state.account.playerId === result.account.playerId)
          throw new Error("Ranking account is already joined");
        await this.provider.join(this.match, result.account);
        this.setPlayer(slot, result);
      } catch (error) {
        this.setPlayer(slot, { kind: "denied", reason: error instanceof Error ? error.message : "Ranking login failed" });
        throw error;
      }
    });
  }
  private id(slot: number): bigint | null {
    if (slot === -1) return 0n;
    const state = this.player(slot); return state.kind === "active" ? state.account.playerId : null;
  }
  reportInt(self: number, other: number, key: number, value: number, accumulate: boolean): Promise<void> {
    return this.report(self, other, (first, second) => ({ kind: "integer", self: first, other: second, key, value, accumulate }));
  }
  reportString(self: number, other: number, key: number, value: string): Promise<void> {
    return this.report(self, other, (first, second) => ({ kind: "string", self: first, other: second, key, value }));
  }
  private report(self: number, other: number, make: (first: bigint, second: bigint) => RankingServiceReport): Promise<void> {
    return this.enqueue(async () => {
      if (this.current.kind !== "active" || this.match === null || this.provider === null) return;
      const first = this.id(self), second = this.id(other);
      if (first === null || second === null) return;
      await this.provider.report(this.match, make(first, second));
    });
  }
  frame(): Promise<void> { return this.enqueue(async () => { if (this.current.kind === "active") await this.provider?.poll(); }); }
  reset(slot: number): Promise<void> {
    return this.enqueue(async () => {
      const state = this.player(slot);
      if (this.current.kind === "active" && (state.kind === "denied" || state.kind === "spectator")) this.setPlayer(slot, { kind: "new" });
    });
  }
  spectate(slot: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.current.kind !== "active") return;
      const state = this.player(slot);
      if (state.kind === "active" && this.match !== null) await this.provider?.logout(this.match, state.account);
      this.setPlayer(slot, { kind: "spectator" });
    });
  }
  disconnect(slot: number): Promise<void> {
    return this.enqueue(async () => {
      const player = this.player(slot);
      try { if (player.kind === "active" && this.match !== null) await this.provider?.logout(this.match, player.account); }
      finally { this.players.delete(slot); this.changed(slot, { kind: "new" }); }
    });
  }
  end(): Promise<void> {
    return this.enqueue(async () => {
      const match = this.match;
      if (match === null) return;
      this.setState({ kind: "ending" });
      const failures: unknown[] = [];
      for (const [slot, player] of this.players) {
        try { if (player.kind === "active") await this.provider?.logout(match, player.account); }
        catch (error) { failures.push(error); }
        this.changed(slot, { kind: "new" });
      }
      try { await this.provider?.finish(match); } catch (error) { failures.push(error); }
      finally { this.match = null; this.players.clear(); this.setState({ kind: "disabled" }); }
      if (failures.length > 0) throw new AggregateError(failures, "Ranking report submission or cleanup failed");
    });
  }
}
