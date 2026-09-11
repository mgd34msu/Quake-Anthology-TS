/* Original CTF match, election, ghost and admin rules. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { ctfName, ctfPlayer, ctfPrint, ctfTeamName } from "./types.ts";
import type { Q2CtfContext, Q2CtfElection, Q2CtfPlayingTeam } from "./types.ts";

export interface Q2CtfMatchActions { resetPlayers(game: Q2GameServices): undefined; resetGrapple(entity: Q2Entity, game: Q2GameServices): undefined; join(entity: Q2Entity, game: Q2GameServices, team: Q2CtfPlayingTeam, ghost?: boolean): boolean; }
export interface Q2CtfAdminSettings { readonly matchMinutes: number; readonly setupMinutes: number; readonly startSeconds: number; readonly weaponsStay: boolean; readonly instantItems: boolean; readonly quadDrop: boolean; readonly instantWeapons: boolean; readonly matchLock: boolean; }
export class Q2CtfMatch {
  constructor(readonly context: Q2CtfContext, readonly actions: Q2CtfMatchActions) {}
  afterSpawn(game: Q2GameServices): undefined {
    const match = this.context.match; if (this.context.rules.competition > 1) { match.phase = "setup"; match.matchTime = game.host.now() + this.context.rules.setupMinutes * 60; } return undefined;
  }
  setup(game: Q2GameServices): undefined { const match = this.context.match; match.phase = "setup"; match.matchTime = game.host.now() + this.context.rules.setupMinutes * 60; if (this.context.rules.competition < 3) this.context.rules.competition = 2; return this.actions.resetPlayers(game); }
  assignGhost(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = ctfPlayer(this.context, entity.actor.id), match = this.context.match;
    if (state.team === 0) return undefined;
    if (state.ghostCode !== null) match.ghosts.delete(state.ghostCode);
    if (match.ghosts.size >= game.options.maxClients) { state.ghostCode = null; return undefined; }
    let code = 10000 + Math.floor(game.host.random() * 90000);
    // A deterministic source random stream may repeat; probe unused codes rather
    // than hanging forever while still keeping each live ghost code unique.
    while (match.ghosts.has(code)) code = 10000 + (code - 9999) % 90000;
    match.ghosts.set(code, { code, team: state.team, name: ctfName(this.context, entity.actor.id), actor: entity.actor.id, score: 0, deaths: 0, kills: 0, captures: 0, baseDefense: 0, carrierDefense: 0 });
    state.ghostCode = code; ctfPrint(game, `Your ghost code is **** ${code} ****\n`, entity.actor.id, "chat");
    return ctfPrint(game, `If you lose connection, rejoin with your score intact by typing "ghost ${code}".\n`, entity.actor.id);
  }
  syncGhost(actor: ActorId): undefined {
    const state = this.context.states.get(actor), player = this.context.hooks.player(actor), ghost = state?.ghostCode === null || state?.ghostCode === undefined ? undefined : this.context.match.ghosts.get(state.ghostCode);
    if (ghost !== undefined && player !== null) { ghost.score = player.score; ghost.name = player.name; } return undefined;
  }
  restoreGhost(entity: Q2Entity, game: Q2GameServices, code: number): boolean {
    const state = ctfPlayer(this.context, entity.actor.id), match = this.context.match, ghost = match.ghosts.get(code), player = this.context.hooks.player(entity.actor.id);
    if (state.team !== 0 || match.phase !== "game" || ghost === undefined || player === null) return false;
    const old = ghost.actor === null ? undefined : this.context.states.get(ghost.actor); if (old !== undefined) old.ghostCode = null;
    state.ghostCode = code; ghost.actor = entity.actor.id; state.spawnState = 0;
    this.actions.join(entity, game, ghost.team, true); player.score = ghost.score;
    ctfPrint(game, `${player.name} has been reinstated to ${ctfTeamName(ghost.team)} team.\n`); return true;
  }
  ready(entity: Q2Entity, game: Q2GameServices, ready: boolean): boolean {
    const state = ctfPlayer(this.context, entity.actor.id), match = this.context.match;
    if (state.team === 0 || ready && match.phase !== "setup" || !ready && match.phase !== "setup" && match.phase !== "pregame" || state.ready === ready) return false;
    state.ready = ready; ctfPrint(game, `${ctfName(this.context, entity.actor.id)} is ${ready ? "ready" : "no longer ready"}.\n`);
    if (!ready && match.phase === "pregame") { match.phase = "setup"; match.matchTime = game.host.now() + this.context.rules.setupMinutes * 60; ctfPrint(game, "Match halted.\n", null, "chat"); }
    const participants = game.host.players().flatMap(actor => { const value = this.context.states.get(actor); return value === undefined || value.team === 0 ? [] : [value]; });
    if (ready && participants.every(member => member.ready) && participants.some(member => member.team === 1) && participants.some(member => member.team === 2)) {
      match.phase = "pregame"; match.matchTime = game.host.now() + this.context.rules.startSeconds; ctfPrint(game, "All players are ready. Match starting.\n", null, "chat");
    }
    return true;
  }
  start(game: Q2GameServices): undefined {
    const match = this.context.match; match.phase = "game"; match.matchTime = game.host.now() + this.context.rules.matchMinutes * 60; match.team1 = 0; match.team2 = 0; match.ghosts.clear();
    for (const actor of game.host.players()) {
      const state = this.context.states.get(actor), entity = game.entity(actor), player = this.context.hooks.player(actor); if (state === undefined || entity === null || player === null) continue;
      player.score = 0; state.spawnState = 0; state.ghostCode = null; state.lastReturnedFlag = null; state.lastFraggedCarrier = null; state.lastHurtCarrier = null;
      game.host.emit({ kind: "centerprint", actor, text: "******************\n\nMATCH HAS STARTED!\n\n******************" });
      if (state.team === 0) continue;
      this.assignGhost(entity, game); this.actions.resetGrapple(entity, game);
      this.context.hooks.observer(entity, game); player.dead = true; player.god = false; entity.visible = false; game.show(entity);
      state.matchRespawnAt = game.host.now() + 1 + Math.floor(game.host.random() * 30) / 10; player.respawnTime = state.matchRespawnAt;
    }
    return undefined;
  }
  totals(game: Q2GameServices): readonly [number, number] {
    let one = 0, two = 0; for (const actor of game.host.players()) { const team = this.context.states.get(actor)?.team, score = this.context.hooks.player(actor)?.score ?? 0; if (team === 1) one += score; else if (team === 2) two += score; } return [one, two];
  }
  end(game: Q2GameServices): undefined {
    const match = this.context.match; match.phase = "post"; [match.total1, match.total2] = this.totals(game);
    ctfPrint(game, `MATCH COMPLETED!\nRED TEAM: ${match.team1} captures, ${match.total1} points\nBLUE TEAM: ${match.team2} captures, ${match.total2} points\n`, null, "chat");
    const captures = match.team1 - match.team2, points = match.total1 - match.total2, difference = captures || points;
    ctfPrint(game, difference === 0 ? "TIE GAME!\n" : `${ctfTeamName(difference > 0 ? 1 : 2)} team won by ${Math.abs(difference)} ${captures !== 0 ? "CAPTURES" : "POINTS"}!\n`, null, "chat");
    return this.context.hooks.endLevel(game, null);
  }
  beginElection(entity: Q2Entity, game: Q2GameServices, kind: Q2CtfElection["kind"], map = ""): boolean {
    const match = this.context.match, count = game.host.players().filter(actor => this.context.states.has(actor)).length, percentage = this.context.rules.electionPercentage;
    if (match.election !== null || percentage <= 0 || count < 2) return false;
    for (const state of this.context.states.values()) state.voted = false;
    const message = `${ctfName(this.context, entity.actor.id)} requested ${kind === "map" ? `warping to ${map}` : kind === "admin" ? "admin rights" : "match mode"}.`;
    match.election = { kind, target: entity.actor.id, map, message, votes: 0, needed: Math.max(1, Math.trunc(count * percentage / 100)), expires: game.host.now() + 20 };
    ctfPrint(game, `${message}\nType YES or NO to vote on this request.\n`, null, "chat"); return true;
  }
  vote(entity: Q2Entity, game: Q2GameServices, yes: boolean): boolean {
    const state = ctfPlayer(this.context, entity.actor.id), election = this.context.match.election;
    if (election === null || state.voted || election.target === entity.actor.id || game.host.now() >= election.expires) return false;
    state.voted = true; if (yes) election.votes++;
    if (election.votes >= election.needed) {
      this.context.match.election = null;
      if (election.kind === "match") this.setup(game);
      else if (election.kind === "map") this.context.hooks.endLevel(game, election.map);
      else { const target = this.context.states.get(election.target); if (target !== undefined) { target.admin = true; ctfPrint(game, `${ctfName(this.context, election.target)} has become an admin.\n`); } }
    } else ctfPrint(game, `Votes: ${election.votes} Needed: ${election.needed} Time left: ${Math.max(0, Math.trunc(election.expires - game.host.now()))}s\n`);
    return true;
  }
  checkRules(game: Q2GameServices): boolean {
    const match = this.context.match, now = game.host.now();
    if (match.election !== null && match.election.expires <= now) { match.election = null; ctfPrint(game, "Election timed out and has been cancelled.\n", null, "chat"); }
    if (match.phase === "none") { if (this.context.rules.captureLimit > 0 && Math.max(match.team1, match.team2) >= this.context.rules.captureLimit) { ctfPrint(game, "Capturelimit hit.\n"); return true; } return false; }
    if (match.matchTime <= now) {
      if (match.phase === "setup") { if (this.context.rules.competition < 3) { match.phase = "none"; this.context.rules.competition = 1; this.actions.resetPlayers(game); } else match.matchTime = now + this.context.rules.setupMinutes * 60; }
      else if (match.phase === "pregame") this.start(game);
      else if (match.phase === "game") this.end(game);
    }
    const remaining = Math.max(0, Math.trunc(match.matchTime - now)); if (remaining !== match.lastTime) { match.lastTime = remaining; this.context.hooks.emit({ kind: "match-status", text: this.status(game) }); }
    return false;
  }
  status(game: Q2GameServices): string {
    const match = this.context.match, time = Math.max(0, Math.trunc(match.matchTime - game.host.now())), clock = `${Math.floor(time / 60).toString().padStart(2, "0")}:${(time % 60).toString().padStart(2, "0")}`;
    if (match.phase === "setup") { const waiting = game.host.players().filter(actor => { const state = this.context.states.get(actor); return state !== undefined && state.team !== 0 && !state.ready; }).length; return `${this.context.rules.competition < 3 ? `${clock} ` : ""}SETUP: ${waiting} not ready`; }
    return match.phase === "pregame" ? `${clock} UNTIL START` : match.phase === "game" ? `${clock} MATCH` : "";
  }
  admin(entity: Q2Entity, game: Q2GameServices, password: string): boolean {
    const state = ctfPlayer(this.context, entity.actor.id);
    if (!state.admin && password !== "" && this.context.rules.adminPassword !== "" && password === this.context.rules.adminPassword) { state.admin = true; ctfPrint(game, `${ctfName(this.context, entity.actor.id)} has become an admin.\n`); }
    if (!state.admin) return this.beginElection(entity, game, "admin");
    this.context.hooks.emit({ kind: "menu", actor: entity.actor.id, title: "Administration Menu", entries: [
      { label: "Settings", action: "admin-settings" }, { label: this.context.match.phase === "setup" ? "Force start match" : "Switch to match setup", action: "admin-start" }, { label: "Cancel", action: "close" }] }); return true;
  }
  configure(entity: Q2Entity, game: Q2GameServices, values: Q2CtfAdminSettings): boolean {
    if (!ctfPlayer(this.context, entity.actor.id).admin) return false;
    for (const duration of [values.matchMinutes, values.setupMinutes, values.startSeconds]) if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("CTF match durations must be positive");
    const rules = this.context.rules, match = this.context.match;
    if (match.phase === "game") match.matchTime += (values.matchMinutes - rules.matchMinutes) * 60;
    else if (match.phase === "setup") match.matchTime += (values.setupMinutes - rules.setupMinutes) * 60;
    else if (match.phase === "pregame") match.matchTime += values.startSeconds - rules.startSeconds;
    rules.matchMinutes = values.matchMinutes; rules.setupMinutes = values.setupMinutes; rules.startSeconds = values.startSeconds; rules.instantWeapons = values.instantWeapons; rules.matchLock = values.matchLock;
    const flags = game.options.deathmatchFlags & ~(4 | 16 | 16384) | (values.weaponsStay ? 4 : 0) | (values.instantItems ? 16 : 0) | (values.quadDrop ? 16384 : 0);
    this.context.hooks.setDeathmatchFlags(flags); ctfPrint(game, `${ctfName(this.context, entity.actor.id)} changed match settings.\n`); return true;
  }
  settingsMenu(entity: Q2Entity, game: Q2GameServices): undefined {
    if (!ctfPlayer(this.context, entity.actor.id).admin) return undefined;
    const rules = this.context.rules, flags = game.options.deathmatchFlags;
    return this.context.hooks.emit({ kind: "admin-settings", actor: entity.actor.id, settings: { matchMinutes: rules.matchMinutes, setupMinutes: rules.setupMinutes,
      startSeconds: rules.startSeconds, weaponsStay: (flags & 4) !== 0, instantItems: (flags & 16) !== 0, quadDrop: (flags & 16384) !== 0, instantWeapons: rules.instantWeapons, matchLock: rules.matchLock } });
  }
  warp(entity: Q2Entity, game: Q2GameServices, requested: string): boolean {
    const map = this.context.rules.warpList.find(value => value.toLowerCase() === requested.toLowerCase()); if (map === undefined) { ctfPrint(game, `Available levels: ${this.context.rules.warpList.join(" ")}\n`, entity.actor.id); return false; }
    if (ctfPlayer(this.context, entity.actor.id).admin) { this.context.hooks.endLevel(game, map); return true; } return this.beginElection(entity, game, "map", map);
  }
  boot(entity: Q2Entity, game: Q2GameServices, number: string): boolean {
    if (!ctfPlayer(this.context, entity.actor.id).admin || !/^\d+$/.test(number)) return false;
    const slot = Number(number) - 1, actor = game.host.players().find(candidate => this.context.hooks.player(candidate)?.slot === slot); if (actor === undefined) return false;
    this.context.hooks.kick(actor); return true;
  }
}
