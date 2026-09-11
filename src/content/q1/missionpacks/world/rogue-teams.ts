/* teamplay.qc flag and team rules. Copyright Rogue / ZOID. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { spawnMapActor } from "../../foundation/spawns.ts";
import { ZERO, length, vadd, vsub, vscale } from "../../foundation/types.ts";
import type { MissionpackWorldHooks } from "./index.ts";
import { brush, later, number, vector } from "./common.ts";

const flagBounds = { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 74 } };
function teamName(team: number): string { return team === 5 ? "Red" : team === 14 ? "Blue" : team === 1 ? "Grey" : "UNKNOWN"; }
export class RogueTeams {
  constructor(private readonly game: Q1EntityServices, private readonly hooks: MissionpackWorldHooks) {
    game.setBaseTeamHealth(false);
    game.registerDamageSourceEffects("rogue:teams", {
      armorAllowed: request => !this.ctf || request.attack.attacker !== null && sameActor(request.attack.attacker, request.target) || this.team(request.attack.attacker) !== this.team(request.target) || ((hooks.gamecfg?.() ?? 0) & 2) !== 0,
      beforeHealth: request => this.mode <= 0 || (this.mode !== 1 || this.team(request.attack.attacker) !== this.team(request.target)) && (!this.ctf || request.attack.attacker !== null && sameActor(request.attack.attacker, request.target) || this.team(request.attack.attacker) !== this.team(request.target) || ((hooks.gamecfg?.() ?? 0) & 4) !== 0),
    });
    game.named.register("rogue:flag_place", { action: (g, e) => { e.movementFlags = 256 | 131072; e.solid = "trigger"; e.movement = "toss"; e.touch = g.named.touch(e, "rogue:flag_touch"); e.mangle = g.body(e).angles; e.effects |= 8; number(e, "cnt", 0); if (!this.dropFloor(e)) return g.remove(e); vector(e, "oldorigin", g.body(e).origin); return later(g, e, 0.1, "rogue:flag_think"); } });
    game.named.register("rogue:flag_think", { action: (_g, e) => this.flagThink(e) });
    game.named.register("rogue:flag_touch", { touch: (_g, e, other) => this.touch(e, other) });
    game.named.register("rogue:flagbase_touch", { touch: (_g, e, other) => this.baseTouch(e, other) });
    for (const [classname, team, skin] of [["item_flag_team1", 5, 0], ["item_flag_team2", 14, 1], ["item_flag", 0, 2]] satisfies readonly (readonly [string, number, number])[]) game.registerSpawn(classname, (g, e) => {
      if (team === 0 ? this.mode !== 5 : g.options.deathmatch === 0 || !this.ctf) return g.remove(e);
      number(e, "team", team); e.skin = skin; this.flagBase(e, team === 0 ? "item_flagbase" : team === 5 ? "item_flagbase_team1" : "item_flagbase_team2");
      if (team !== 0 && this.mode === 5) return g.remove(e);
      e.model = "progs/ctfmodel.mdl"; e.fields.set("noise", "misc/flagtk.wav"); e.fields.set("noise1", "misc/flagret.wav"); g.setBounds(e, flagBounds); return later(g, e, 0.2, "rogue:flag_place");
    });
    for (const classname of ["info_player_team1", "info_player_team2"]) game.registerSpawn(classname, () => undefined);
    game.registerSpawn("func_ctf_wall", (g, e) => this.ctf ? brush(g, e) : g.remove(e));
    game.registerSpawn("trigger_teleport", (g, e) => (e.spawnflags & 4) !== 0 && !this.ctf ? g.remove(e) : spawnMapActor(g, e));
  }
  get mode(): number { return this.game.options.teamplay ?? 0; }
  get ctf(): boolean { return this.mode === 4 || this.mode === 5 || this.mode === 6; }
  private state(actor: ActorId): Q1Actor {
    const found = [...this.game.entities.values()].find(entity => entity.classname === "rogue_team_state" && entity.owner !== null && sameActor(entity.owner, actor)); if (found !== undefined) return found;
    const state = this.game.create("rogue_team_state"); state.owner = actor; number(state, "steam", this.ctf && ((this.hooks.gamecfg?.() ?? 0) & 8) === 0 ? -1 : this.color(actor)); return state;
  }
  private color(actor: ActorId): number { if (this.hooks.teamColor === undefined) { if (this.mode <= 0) return 0; throw new Error("Rogue teamplay requires shared player colors"); } return this.hooks.teamColor(actor); }
  team(actor: ActorId | null): number { return actor === null || !this.game.isPlayer(actor) ? 0 : this.state(actor).number("steam"); }
  private setColor(actor: ActorId, team: number): undefined { if (this.hooks.setTeamColor === undefined) throw new Error("Rogue CTF requires shared color mutation"); return this.hooks.setTeamColor(actor, team); }
  private score(actor: ActorId, delta: number): undefined { if (this.hooks.addFrags === undefined) throw new Error("Rogue CTF requires shared score authority"); return this.hooks.addFrags(actor, delta); }
  private name(actor: ActorId): string { if (this.hooks.playerName === undefined) throw new Error("Rogue CTF requires player names"); return this.hooks.playerName(actor); }
  private message(actor: ActorId, text: string, center = true): undefined { return this.game.host.emit({ kind: "message", player: actor, text, center }); }
  private broadcast(text: string): undefined { for (const actor of this.game.host.players()) this.message(actor, text, false); return undefined; }
  private sound(actor: ActorId, path: string, global = false): undefined { const owner = this.game.host.actors.resolveOwned(actor); return owner === null ? undefined : this.game.sound(owner, path, global ? "voice" : "item", global ? 0 : 1); }
  private legal(team: number): boolean { return this.mode < 4 ? team > 0 : this.ctf ? team === 5 || team === 14 || this.mode === 6 && team === 1 : true; }
  playerSpawned(actor: ActorId): undefined {
    const state = this.state(actor); if (state.number("steam") >= 0 || this.mode < 4) { const color = this.color(actor); if (this.legal(color)) { number(state, "steam", color); return undefined; } }
    let red = 0, blue = 0, grey = 0; for (const player of this.game.host.players()) if (!sameActor(actor, player)) { const team = this.team(player); if (team === 5) red++; else if (team === 14) blue++; else if (team === 1) grey++; }
    let team = 5, count = red; if (blue < count || blue === count && this.game.host.random() < 0.5) { team = 14; count = blue; } if (this.mode === 6 && grey * 2 < count) team = 1;
    number(state, "steam", team); number(state, "ctf_flags", state.number("ctf_flags") | 4); this.message(actor, `You have been assigned to the ${teamName(team)} team.\n`, false); return this.setColor(actor, team);
  }
  frame(actor: ActorId): undefined {
    const game = this.game, state = this.state(actor), color = this.color(actor);
    this.checkUpdate();
    if (game.options.deathmatch === 0 || this.mode < 4) return number(state, "steam", color);
    if ((state.number("ctf_flags") & 4) !== 0) { number(state, "ctf_flags", state.number("ctf_flags") & ~4); return this.setColor(actor, state.number("steam")); }
    if (!this.legal(color) && color === state.number("steam")) number(state, "steam", -1);
    if (color === state.number("steam")) return undefined;
    const previous = state.number("steam"), changes = ((this.hooks.gamecfg?.() ?? 0) & 16) !== 0;
    if (previous >= 0 && this.legal(previous) && !changes) {
      if (state.number("suicide_count") > 3) { this.message(actor, "$qc_color_games", false); if (this.hooks.disconnect === undefined) throw new Error("Rogue team enforcement requires shared disconnect"); this.hooks.disconnect(actor); }
      if (state.number("ctf_killed") !== 1) number(state, "ctf_killed", 2); game.damage(actor, actor, actor, 1000); number(state, "suicide_count", state.number("suicide_count") + 1); this.message(actor, "$qc_cannot_change_teams", false); return this.setColor(actor, previous);
    }
    if (previous >= 0 && !this.legal(previous)) number(state, "steam", -50);
    if (state.number("steam") > 0) { if (state.number("ctf_killed") !== 1) number(state, "ctf_killed", 2); game.damage(actor, actor, actor, 1000); }
    if (this.hooks.frags === undefined) throw new Error("Rogue team changes require shared scores"); this.score(actor, -this.hooks.frags(actor)); return this.playerSpawned(actor);
  }
  selectSpawn(actor: ActorId): Q1Actor | undefined {
    const game = this.game, world = game.world; if (game.options.coop || game.options.deathmatch === 0 || !this.ctf || world === null) return undefined;
    const entities = [...game.entities.values()], test = entities.find(e => e.classname === "testplayerstart"); if (test !== undefined) return test;
    const team = this.state(actor).number("ctf_killed") === 0 ? this.team(actor) : 0;
    const key = team === 5 ? "rogue:team1_lastspawn" : team === 14 ? "rogue:team2_lastspawn" : "rogue:lastspawn";
    const classname = team === 5 ? "info_player_team1" : team === 14 ? "info_player_team2" : "info_player_deathmatch";
    const last = game.entity(world.references.get(key) ?? null), points = entities.filter(e => e.classname === classname), start = last === null ? -1 : points.indexOf(last);
    for (let count = 1; count <= points.length; count++) {
      const point = points[(start + count) % points.length]; if (point === undefined) continue;
      if (point === last || !game.host.players().some(player => { const body = game.host.bodies.read(player); return body !== null && length(vsub(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), game.body(point).origin)) <= 32; })) { world.references.set(key, point.actor.id); return point; }
    }
    return undefined;
  }
  impulse(actor: ActorId, impulse: number): boolean {
    if (impulse !== 23) return false; const game = this.game; if (game.options.deathmatch === 0) return true;
    if (!this.ctf) { this.message(actor, "$qc_ctf_disabled", false); return true; }
    const flags = this.flags();
    if (this.mode === 5) {
      const flag = flags.find(e => e.classname === "item_flag"), owner = flag?.owner;
      const text = flag === undefined ? "$qc_flag_missing" : flag.number("cnt") === 0 ? "$qc_flag_at_base" : flag.number("cnt") === 2 ? "$qc_flag_lying_about" : flag.number("cnt") === 1 && owner !== null && owner !== undefined ? sameActor(owner, actor) ? "$qc_you_have_flag" : `${this.name(owner)} of the ${teamName(this.team(owner))} team has the flag!\n` : "$qc_flag_screwed_up";
      this.message(actor, text, false); return true;
    }
    const red = flags.find(e => e.classname === "item_flag_team1"), blue = flags.find(e => e.classname === "item_flag_team2");
    const ordered = this.mode === 4 && this.color(actor) !== 5 ? [blue, red] : [red, blue];
    for (const [index, flag] of ordered.entries()) {
      const own = this.mode === 4 ? index === 0 : this.team(actor) === (index === 0 ? red?.number("team") : red?.number("team")), label = own ? "Your flag" : this.mode === 4 ? "The enemy flag" : `${index === 0 ? "Red" : "Blue"} flag`;
      if (flag?.number("cnt") === 1 && flag.owner !== null) {
        const owner = flag.owner, text = sameActor(owner, actor) ? this.mode === 4 ? "$qc_you_have_enemy_flag" : `You have the ${index === 0 ? "Red" : "Blue"} flag!\n` : this.mode === 4 ? `${this.name(owner)} has ${own ? "your" : "the enemy"} flag.\n` : `${this.name(owner)} of the ${teamName(this.team(owner))} team has the ${index === 0 ? "Red" : "Blue"} flag.\n`;
        this.message(actor, text, false);
      } else this.message(actor, `${label} is ${flag === undefined ? "missing!" : flag.number("cnt") === 0 ? this.mode === 6 ? "at base." : own ? "in your base." : "in their base." : flag.number("cnt") === 2 ? "lying about." : " corrupt."}\n`, false);
    }
    return true;
  }
  private checkUpdate(): undefined {
    const game = this.game, world = game.world; if (world === null || world.number("rogue:nextteamupdtime") > game.time || this.mode < 1 || game.options.deathmatch === 0) return undefined;
    number(world, "rogue:nextteamupdtime", game.time + 120); if (!this.ctf) return undefined;
    if (this.hooks.frags === undefined) throw new Error("Rogue score update requires shared frags"); let red = 0, blue = 0, grey = 0;
    for (const player of game.host.players()) { const team = this.team(player), score = this.hooks.frags(player); if (team === 5) red += score; else if (team === 14) blue += score; else if (team === 1) grey += score; }
    const scores = this.mode === 6 ? [{ team: 5, score: red }, { team: 14, score: blue }, { team: 1, score: grey }] : [{ team: 5, score: red }, { team: 14, score: blue }];
    const sorted = scores.sort((a, b) => b.score - a.score), first = sorted[0], second = sorted[1]; if (first === undefined || second === undefined) return undefined;
    if (first.score > second.score) return this.broadcast(`${teamName(first.team)} team is leading by ${first.score - second.score} points!\n`);
    const tied = red === blue ? [5, 14] : grey === blue ? [14, 1] : [5, 1]; return this.broadcast(`${teamName(tied[0] ?? 5)} and ${teamName(tied[1] ?? 14)} teams are tied with ${first.score} points!\n`);
  }
  private flags(): readonly Q1Actor[] { return [...this.game.entities.values()].filter(entity => entity.classname === "item_flag_team1" || entity.classname === "item_flag_team2" || entity.classname === "item_flag"); }
  private dropFloor(entity: Q1Actor): boolean {
    const body = this.game.body(entity), origin = vadd(body.origin, { x: 0, y: 0, z: 6 }), trace = this.game.host.trace({ start: origin, end: vadd(origin, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (trace.fraction === 1 || trace.allSolid) return false; this.game.setBody(entity, { origin: trace.end, velocity: ZERO, ground: trace.actor }); this.game.link(entity); return true;
  }
  private flagBase(flag: Q1Actor, classname: string): undefined { const base = this.game.create(classname); base.model = "progs/ctfbase.mdl"; base.skin = flag.skin; number(base, "team", flag.number("team")); base.movementFlags = 256; base.movement = "toss"; base.solid = this.mode === 5 || this.mode === 6 ? "trigger" : "none"; if (base.solid === "trigger") base.touch = this.game.named.touch(base, "rogue:flagbase_touch"); this.game.setBody(base, { origin: this.game.body(flag).origin, angles: this.game.body(flag).angles, bounds: { min: { x: -8, y: -8, z: 0 }, max: { x: 8, y: 8, z: 8 } } }); if (!this.dropFloor(base)) this.game.remove(base); return undefined; }
  private regenerate(flag: Q1Actor): undefined { flag.movement = "toss"; flag.solid = "trigger"; this.game.sound(flag, "items/itembk2.wav", "voice"); this.game.setBody(flag, { origin: flag.vector("oldorigin"), angles: flag.mangle }); number(flag, "cnt", 0); flag.owner = null; return this.game.link(flag); }
  private returnFlag(flag: Q1Actor): undefined { this.regenerate(flag); for (const actor of this.game.host.players()) this.message(actor, this.mode === 5 ? "$qc_flag_returned" : this.mode === 6 ? `${teamName(flag.number("team"))} flag has been returned to base!\n` : this.team(actor) === flag.number("team") ? "$qc_your_flag_returned_base" : "$qc_enemy_flag_returned_base"); return undefined; }
  private dropFlag(flag: Q1Actor): undefined {
    const actor = flag.owner, body = actor === null ? null : this.game.host.bodies.read(actor); if (body === null) return this.returnFlag(flag);
    if (actor !== null) this.broadcast(`${this.name(actor)} lost the ${this.mode === 5 ? "" : teamName(flag.number("team")) + " "}flag!\n`);
    this.game.setBody(flag, { origin: vadd(body.origin, { x: 0, y: 0, z: -24 }), velocity: { x: 0, y: 0, z: 300 }, bounds: flagBounds }); number(flag, "cnt", 2); flag.movementFlags = 256 | 131072; flag.solid = "trigger"; flag.movement = "toss"; number(flag, "super_time", this.game.time + 40); return this.game.link(flag);
  }
  private flagThink(flag: Q1Actor): undefined {
    const game = this.game; later(game, flag, 0.1, "rogue:flag_think"); const status = flag.number("cnt"); if (status === 0) return undefined;
    if (status === 2) return game.time - flag.number("super_time") > 40 ? this.returnFlag(flag) : undefined;
    if (status !== 1) throw new Error("Flag in invalid state"); const actor = flag.owner, body = actor === null ? null : game.host.bodies.read(actor);
    if (actor === null || body === null || !game.isPlayer(actor) || game.health(actor) <= 0) return this.dropFlag(flag);
    const bits = this.state(actor).number("ctf_flags"), team = flag.number("team"); if (this.mode === 5 && (bits & 1) === 0 || team === 5 && (bits & 1) === 0 || team === 14 && (bits & 2) === 0) return this.dropFlag(flag);
    if (this.hooks.playerFrame === undefined) throw new Error("Rogue carried flags require character source frames"); const frame = this.hooks.playerFrame(actor), offsets = [2, 8, 12, 11, 10, 4, 2, 10, 10, 8, 4, 2];
    const distance = 14 + (frame >= 29 && frame <= 40 ? offsets[frame - 29] ?? 0 : frame >= 103 && frame <= 106 ? 6 : frame >= 107 && frame <= 118 ? 7 : 0), basis = game.makeVectors(body.angles), forward = { ...basis.forward, z: -basis.forward.z };
    game.setBody(flag, { origin: vadd(vsub(vadd(body.origin, { x: 0, y: 0, z: -16 }), vscale(forward, distance)), vscale(basis.right, 22)), angles: vadd(body.angles, { x: 0, y: 0, z: -45 }) }); game.link(flag); return later(game, flag, 0.01, "rogue:flag_think");
  }
  private clearKeys(actor: ActorId): undefined { const owner = this.game.host.actors.resolveOwned(actor); if (owner !== null) for (const item of ["q1:key/silver", "q1:key/gold"] satisfies readonly ("q1:key/silver" | "q1:key/gold")[]) this.game.host.inventory.consume(owner, item, this.game.host.inventory.count(actor, item)); return undefined; }
  private capture(actor: ActorId, alternate: boolean): undefined {
    const game = this.game, state = this.state(actor), team = this.team(actor), bits = state.number("ctf_flags"); this.broadcast(`${this.name(actor)} captured the flag!\n`); this.clearKeys(actor); this.sound(actor, "misc/flagcap.wav", true); this.score(actor, alternate ? 8 : 15);
    for (const player of game.host.players()) { const other = this.state(player); if (this.color(player) === team) { if (!sameActor(actor, player)) this.score(player, alternate ? 4 : 10); if (!alternate) { if (this.mode !== 5 && other.number("ctf_lastreturnedflag") + 4 > game.time) this.score(player, 1); if (other.number("ctf_lastfraggedcarrier") + 6 > game.time) this.score(player, 2); } this.message(player, "$qc_your_team_captured"); } else { number(other, "ctf_lasthurtcarrier", -5); this.message(player, "$qc_your_flag_captured"); } if (!alternate) number(other, "ctf_flags", other.number("ctf_flags") & ~3); }
    for (const flag of this.flags()) if (alternate ? flag.number("team") === ((bits & 1) !== 0 ? 5 : 14) : this.mode === 5 ? flag.classname === "item_flag" : flag.classname !== "item_flag") this.regenerate(flag);
    if (alternate) number(state, "ctf_flags", bits & ~3); return undefined;
  }
  private touch(flag: Q1Actor, actor: ActorId): undefined {
    const game = this.game; if (!game.isPlayer(actor) || game.health(actor) <= 0 || this.color(actor) !== this.team(actor) || flag.number("cnt") === 1) return undefined;
    const state = this.state(actor), bits = state.number("ctf_flags"), team = flag.number("team");
    if (this.mode !== 5) {
      if (this.mode !== 4 && this.mode !== 6) return undefined;
      if (team === this.team(actor)) { if (flag.number("cnt") === 0) return team === 5 && (bits & 2) !== 0 || team === 14 && (bits & 1) !== 0 ? this.capture(actor, false) : undefined; this.score(actor, 1); number(state, "ctf_lastreturnedflag", game.time); this.sound(actor, flag.text("noise1")); return this.returnFlag(flag); }
      if ((bits & 3) !== 0) return undefined;
    }
    this.broadcast(`${this.name(actor)} got the ${this.mode === 5 ? "" : teamName(team) + " "}flag!\n`); this.sound(actor, flag.text("noise")); number(state, "ctf_flags", bits | (team === 14 ? 2 : 1)); number(state, "ctf_flagsince", game.time);
    const owner = game.host.actors.resolveOwned(actor); if (owner !== null) { if (team === 0 || team === 14) game.host.inventory.give(owner, "q1:key/silver", 1); if (team === 0 || team === 5) game.host.inventory.give(owner, "q1:key/gold", 1); }
    flag.owner = actor; flag.movement = "noclip"; flag.solid = "none"; number(flag, "cnt", 1); game.link(flag); this.message(actor, this.mode === 5 ? "YOU GOT THE FLAG\n\nTAKE IT TO THEIR BASE\n" : "YOU GOT THE ENEMY FLAG\n\nRETURN TO BASE\n");
    for (const player of game.host.players()) if (!sameActor(actor, player)) this.message(player, this.mode === 5 ? "$qc_flag_taken" : this.team(player) === team ? "$qc_your_flag_taken" : `${teamName(this.team(actor))} team has the ${teamName(team)} flag!\n`); return undefined;
  }
  private baseTouch(base: Q1Actor, actor: ActorId): undefined { if (!this.game.isPlayer(actor) || this.game.health(actor) <= 0 || this.color(actor) !== this.team(actor)) return undefined; const bits = this.state(actor).number("ctf_flags"), team = base.number("team"); if (this.mode === 5) return (team === 5 && this.team(actor) === 14 || team === 14 && this.team(actor) === 5) && (bits & 1) !== 0 ? this.capture(actor, false) : undefined; return this.mode === 6 && this.team(actor) === 1 && ((bits & 1) !== 0 && team === 14 || (bits & 2) !== 0 && team === 5) ? this.capture(actor, true) : undefined; }
  confirmedDamage(target: ActorId, attacker: ActorId | null): undefined { if (this.ctf && attacker !== null && this.game.isPlayer(target) && this.game.isPlayer(attacker) && (this.state(target).number("ctf_flags") & 3) !== 0 && this.team(target) !== this.team(attacker)) number(this.state(attacker), "ctf_lasthurtcarrier", this.game.time); return undefined; }
  playerDied(actor: ActorId, attacker: ActorId | null): undefined {
    const state = this.state(actor); number(state, "ctf_killed", state.number("ctf_killed") === 2 ? 0 : 1);
    if (!this.ctf) return undefined; const bits = state.number("ctf_flags");
    if (attacker !== null && this.game.isPlayer(attacker) && !sameActor(actor, attacker)) this.assists(actor, attacker);
    if ((bits & 3) !== 0) for (const player of this.game.host.players()) if (this.mode === 5 || (bits & 1) !== 0 && this.team(player) === 5 || (bits & 2) !== 0 && this.team(player) === 14) number(this.state(player), "ctf_lasthurtcarrier", -10);
    const flag = this.flags().find(flag => flag.classname === (this.mode === 5 && (bits & 1) !== 0 ? "item_flag" : (bits & 1) !== 0 ? "item_flag_team1" : (bits & 2) !== 0 ? "item_flag_team2" : ""));
    if (flag !== undefined) { number(state, "ctf_flags", bits & ~3); this.dropFlag(flag); } return undefined;
  }
  private assists(target: ActorId, attacker: ActorId): undefined {
    const game = this.game, victim = this.state(target), killer = this.state(attacker), team = this.team(attacker);
    if ((victim.number("ctf_flags") & 3) !== 0 && this.team(target) !== team) { number(killer, "ctf_lastfraggedcarrier", game.time); if (victim.number("ctf_flagsince") + 2 <= game.time) { this.score(attacker, 2); this.message(attacker, "$qc_enemy_killed_bonus", false); } else this.message(attacker, "$qc_enemy_killed_no_bonus", false); }
    let flagBonus = false, carrierBonus = false;
    if (victim.number("ctf_lasthurtcarrier") + 4 > game.time && (killer.number("ctf_flags") & 3) === 0) { this.score(attacker, 2); carrierBonus = true; }
    for (const originActor of [attacker, target]) {
      const origin = game.host.bodies.read(originActor)?.origin; if (origin === undefined) continue;
      for (const observation of [...game.host.actors.observations()].reverse()) {
        const actor = observation.id, body = game.host.bodies.read(actor); if (body === null || length(vsub(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), origin)) > 400) continue;
        if (game.isPlayer(actor) && this.team(actor) === team && (this.state(actor).number("ctf_flags") & 3) !== 0 && !sameActor(actor, attacker) && !carrierBonus) { this.score(attacker, 1); carrierBonus = true; }
        const classname = game.host.classname(actor); if (team === 5 && classname === "item_flag_team1" || team === 14 && classname === "item_flag_team2" || classname === "item_flag" && (!sameActor(originActor, target) || !flagBonus)) { this.score(attacker, 1); flagBonus = true; }
      }
    }
    return undefined;
  }
}
