import type { RankingAccountActions } from "../../ui/settings/rankings.ts";
import { RankingLifecycle } from "../../network/services/rankings.ts";
import type { RankingAccountRequest, RankingPlayerState, RankingServiceProvider, RankingServiceState } from "../../network/services/rankings.ts";
import type { EntityPool } from "../../content/q3/base/game/entities.ts";
import type { GameLevel } from "../../content/q3/base/game/level.ts";
import type { Q3RankingReport } from "../../content/q3/base/game/rankings.ts";
import { ServerEntityFlags } from "../../content/q3/base/shared/entity-shared.ts";
import { GameType, Team } from "../../content/q3/base/shared/definitions.ts";

export interface Q3RankingHost {
  status(slot: number, state: RankingPlayerState): void;
  serviceStatus?(state: RankingServiceState): void;
  menu(slot: number): void;
  spectator(slot: number): void;
  activate(slot: number): void;
  scoreboard(slot: number): void;
  dropBot(slot: number): void;
  gameType(): number;
  cvar(name: string): string;
  setCvar(name: string, value: string): void;
}

/** Source slots are local to this match. Account IDs never become ActorIds or local progress identities. */
export class ApplicationQ3Rankings {
  readonly lifecycle: RankingLifecycle;
  private readonly reports: Q3RankingReport[] = [];
  private readonly observed = new Map<number, RankingPlayerState>();
  private readonly detach: () => void;
  private readonly weapons = new Map<number, { weapon: number; since: number }>();
  private closed = false;
  private ended = false;
  constructor(private readonly pool: EntityPool, private readonly level: GameLevel,
    provider: RankingServiceProvider | null, private readonly host: Q3RankingHost) {
    this.lifecycle = new RankingLifecycle(provider, (slot, state) => host.status(slot, state), state => host.serviceStatus?.(state));
    this.detach = pool.rankings.attach(report => {
      if (this.lifecycle.state().kind !== "active" || this.ended) return;
      if (this.reports.length >= 65536) {
        this.reports.length = 0;
        this.lifecycle.unavailable("Ranking provider cannot keep up with source reports; this match cannot be submitted completely.");
        return;
      }
      this.reports.push(report);
    }, () => level.warmupTime !== 0);
  }
  private assertOpen(): void { if (this.closed) throw new Error("Ranking match owner is closed"); }
  async begin(enabled: boolean, singlePlayer: boolean, gameKey: string): Promise<void> {
    this.assertOpen(); await this.lifecycle.begin(enabled, singlePlayer, gameKey); await this.frame();
  }
  account(slot: number, request: RankingAccountRequest): Promise<void> {
    this.assertClient(slot); return this.lifecycle.account(slot, request);
  }
  accountActions(slot: number): RankingAccountActions {
    this.assertClient(slot);
    return { service: () => this.lifecycle.state(), player: () => this.lifecycle.player(slot),
      submit: request => this.account(slot, request), reset: () => this.reset(slot), spectate: () => this.spectate(slot) };
  }
  reset(slot: number): Promise<void> { this.assertClient(slot); return this.lifecycle.reset(slot); }
  async spectate(slot: number): Promise<void> {
    this.assertClient(slot); await this.flush(); await this.lifecycle.spectate(slot);
  }
  async disconnect(slot: number): Promise<void> {
    this.assertOpen(); await this.flush(); await this.lifecycle.disconnect(slot); this.observed.delete(slot); this.weapons.delete(slot);
  }
  private assertClient(slot: number): void {
    this.assertOpen();
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.pool.maxClients || this.pool.get(slot)?.client === null || !this.pool.get(slot)?.inuse)
      throw new Error("Ranking account requires a connected source client");
  }
  private async flush(): Promise<void> {
    const reports = this.reports.splice(0);
    for (const report of reports) {
      if (this.lifecycle.state().kind !== "active") break;
      if (report.kind === "integer") await this.lifecycle.reportInt(report.self, report.other, report.key, report.value, report.accumulate);
      else await this.lifecycle.reportString(report.self, report.other, report.key, report.value);
    }
  }
  async frame(): Promise<void> {
    this.assertOpen(); await this.flush(); await this.lifecycle.frame();
    if (this.lifecycle.state().kind !== "active" || this.ended) return;
    for (let slot = 0; slot < this.pool.maxClients; slot++) {
      const entity = this.pool.get(slot); if (!entity?.inuse || entity.client === null) continue;
      if (entity.r.svFlags & ServerEntityFlags.BOT) { this.host.dropBot(slot); continue; }
      const weapon = this.weapons.get(slot);
      if (weapon === undefined) this.weapons.set(slot, { weapon: entity.client.ps.weapon, since: this.level.time });
      else if (weapon.weapon !== entity.client.ps.weapon) {
        this.pool.rankings.weaponTime(slot, weapon.weapon, Math.trunc((this.level.time - weapon.since) / 1000));
        this.weapons.set(slot, { weapon: entity.client.ps.weapon, since: this.level.time });
      }
      const state = this.lifecycle.player(slot), previous = this.observed.get(slot);
      this.observed.set(slot, state);
      if (previous?.kind !== state.kind) this.host.status(slot, state);
      if (state.kind === "new" || state.kind === "spectator") {
        if (entity.client.sess.sessionTeam !== Team.TEAM_SPECTATOR) {
          this.host.spectator(slot); this.host.menu(slot);
        }
      } else if (state.kind === "denied") await this.lifecycle.reset(slot);
      else if (state.kind === "active") {
        if (entity.client.sess.sessionTeam === Team.TEAM_SPECTATOR && this.host.gameType() < GameType.GT_TEAM) this.host.activate(slot);
        if (previous?.kind !== "active") {
          for (let other = 0; other < this.pool.maxClients; other++) {
            const peer = this.pool.get(other); if (!peer?.inuse || peer.client === null || (peer.r.svFlags & ServerEntityFlags.BOT)) continue;
            if (other !== slot && this.lifecycle.player(other).kind === "active") await this.lifecycle.reportInt(slot, other, 1210000002, 1, false);
            this.host.scoreboard(other);
          }
        }
      }
    }
    const fraglimit = Number(this.host.cvar("fraglimit")), timelimit = Number(this.host.cvar("timelimit"));
    if ((fraglimit === 0 || fraglimit > 100) && (timelimit === 0 || timelimit > 1000)) this.host.setCvar("timelimit", "1000");
  }
  async gameOver(): Promise<void> {
    this.assertOpen(); if (this.ended || this.level.warmupTime !== 0) return;
    await this.flush(); this.ended = true;
    const strings: readonly (readonly [string, number])[] = [["sv_hostname", 1000010000], ["mapname", 1000010001], ["fs_game", 1000010002], ["version", 1000010011]];
    const integers: readonly (readonly [string, number])[] = [["g_gametype", 1010010003], ["fraglimit", 1010010004], ["timelimit", 1010010005],
      ["sv_maxclients", 1010010006], ["sv_maxRate", 1010010007], ["sv_minPing", 1010010008], ["sv_maxPing", 1010010009], ["dedicated", 1010010010]];
    for (const [name, key] of strings) await this.lifecycle.reportString(-1, -1, key, this.host.cvar(name));
    for (const [name, key] of integers) await this.lifecycle.reportInt(-1, -1, key, Math.trunc(Number(this.host.cvar(name))) || 0, false);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.detach();
    try { await this.flush(); } finally { await this.lifecycle.end(); }
  }
}
