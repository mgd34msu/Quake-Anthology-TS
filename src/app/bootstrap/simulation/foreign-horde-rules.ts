// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../contracts/identity.ts";
import type { ForeignMatchHost, ForeignMatchStrategy } from "./foreign-match-host.ts";

/**
 * Q3 horde (match provider q3:horde): admit escalating bot waves; a wave clears when every admitted
 * bot has been fragged at least once, then survivors retire and the next wave arrives after a short
 * intermission. Other families run horde in their source compositions; Q3 has no monsters, so bots
 * are the horde.
 */
export class HordeRules implements ForeignMatchStrategy {
  #wave = 0;
  #pendingWave = 1;
  readonly #fragged = new Map<ActorId, { deaths: number; fragged: boolean }>();
  #nextWaveAt = 0;
  #admissionAt = -Infinity;
  #admissionPlayers = -1;

  constructor(private readonly host: ForeignMatchHost) {}

  get wave(): number { return this.#wave; }
  get pendingWave(): number { return this.#pendingWave; }
  get fraggedCount(): number { return this.#fragged.size; }

  active(): boolean { return this.host.recipe.match.provider === "q3:horde" && this.host.sourceKind === "q3"; }
  /** Horde keeps no state a restart or save could not rebuild from the bot roster. */
  blocksCheckpoint(): boolean { return false; }
  release(): void {}

  tick(): void {
    if (!this.active()) return;
    const host = this.host, now = host.timeSeconds;
    const players = host.players();
    const bots = players.filter(actor => host.botServices.isBot(actor));
    const humansAlive = players.some(actor => !host.botServices.isBot(actor)
      && (host.q3Native(actor)?.health ?? host.combat.read(actor)?.health ?? 0) > 0);
    if (!humansAlive) return;
    if (this.#wave === 0) {
      if (now >= this.#nextWaveAt) {
        this.#wave = this.#pendingWave;
        this.#fragged.clear();
        this.#requestBot(players.length);
      }
      return;
    }
    // Register wave bots with a death baseline; Q3's PERS_KILLED is the
    // native per-client death counter, reliable across respawns.
    for (const bot of bots) {
      const deaths = host.q3Native(bot)?.deaths ?? 0;
      const entry = this.#fragged.get(bot);
      if (entry === undefined) this.#fragged.set(bot, { deaths, fragged: false });
      else if (deaths > entry.deaths) entry.fragged = true;
    }
    const admitted = [...this.#fragged.keys()].filter(actor => host.actors.isLive(actor));
    const humans = players.length - bots.length;
    const target = Math.min(1 + this.#wave, 8, Math.max(1, host.maxClients - humans));
    if (admitted.length < target) { this.#requestBot(players.length); return; }
    if (!admitted.every(actor => this.#fragged.get(actor)?.fragged === true)) return;
    // Wave cleared: retire survivors through the bot transport (which frees
    // their session client slots for the next wave) and schedule it.
    for (const bot of admitted) if (!host.botServices.tryDisconnectBot(bot)) host.disconnectPlayer(bot);
    this.#fragged.clear();
    this.#pendingWave = this.#wave >= 15 ? 1 : this.#wave + 1;
    this.#wave = 0;
    this.#nextWaveAt = now + 5;
  }

  /** Bot admission is queued through the source console, so retry at most
   * once per second until the player count shows the request landed. */
  #requestBot(playerCount: number): void {
    const now = this.host.timeSeconds;
    if (playerCount === this.#admissionPlayers && now - this.#admissionAt < 1) return;
    if (this.host.botServices.tryAddBot()) {
      this.#admissionAt = now;
      this.#admissionPlayers = playerCount;
    }
  }
}
