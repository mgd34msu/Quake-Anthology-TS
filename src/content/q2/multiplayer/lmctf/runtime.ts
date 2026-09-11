import { captureLmctfGrapple, restoreLmctfGrapple } from "../../equipment/grapple-services.ts";
/* LM_CTF selected source mode over the shared Q2 game authority. GPL-2.0-or-later. */
import { SaveReader } from "../../../../persistence/value.ts";
import { readSavedActor } from "../../../../persistence/save-image.ts";
import { saveCtfActor } from "../ctf/types.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import { zero } from "../../foundation/fields.ts";
import { LmctfVote } from "./vote.ts";
import { LmctfMatch } from "./match.ts";
import { lmctfAdminCommand } from "./admin.ts";
import { lmctfMenu, lmctfScoreboard } from "./presentation.ts";
import { LmctfWeapons } from "./weapons.ts";
import { LmctfFlags } from "./flags.ts";
import { LmctfRunes } from "./runes.ts";
import { LmctfGrapple } from "./grapple.ts";
import { selectLmctfSpawn } from "./spawns.ts";
import { createLmctfRules, LmctfPlayerState, lmctfName, lmctfPlayer, lmctfPrint, lmctfScore, lmctfStat } from "./types.ts";
import type { LmctfTravel, LmctfContext, LmctfHooks, LmctfPlayingTeam, LmctfRules, LmctfTeam } from "./types.ts";

export class Q2Lmctf implements Q2SpawnModule {
  readonly states = new Map<ActorId, LmctfPlayerState>();
  readonly context: LmctfContext;
  readonly match: LmctfMatch;
  readonly vote: LmctfVote;
  readonly weapons: LmctfWeapons;
  readonly flags: LmctfFlags;
  readonly runes: LmctfRunes;
  readonly grapple: LmctfGrapple;
  constructor(readonly hooks: LmctfHooks, readonly rules: LmctfRules = createLmctfRules(), private readonly travel?: LmctfTravel) {
    this.context = { hooks, rules, states: this.states, plasmaQuad: false, canScore: () => this.match.canScore(), flagsTouchable: () => this.match.phase !== "countdown" };
    this.match = new LmctfMatch(this.context); this.match.paused = travel?.paused ?? false; this.vote = new LmctfVote(this.context); this.weapons = new LmctfWeapons(this.context);
    this.flags = new LmctfFlags(this.context); this.runes = new LmctfRunes(this.context, game => this.flags.flag(1, game)); this.grapple = new LmctfGrapple(this.context);
    hooks.weapons.setSourceRules({ kind: "lmctf", postNativeThink: (current, repeat) => this.runes.weaponFrame(current.self, current.game, current.state.sourceFiring, repeat) });
  }
  get callbacks(): Q2CallbackDefinitions {
    const flags = this.flags.callbacks, runes = this.runes.callbacks, hook = this.grapple.callbacks, weapons = this.weapons.callbacks;
    return { think: { ...flags.think, ...runes.think, ...hook.think, ...weapons.think }, touch: { ...flags.touch, ...runes.touch, ...hook.touch, ...weapons.touch }, die: hook.die ?? {} };
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname === "item_flag_team1") entity.classname = "info_flag_red";
    else if (entity.classname === "item_flag_team2") entity.classname = "info_flag_blue";
    else if (entity.classname === "info_player_team1") entity.classname = "info_player_red";
    else if (entity.classname === "info_player_team2") entity.classname = "info_player_blue";
    if (entity.classname === "info_player_red" || entity.classname === "info_player_blue") { game.solid(entity, "none"); return true; }
    if (entity.classname === "info_position") { game.solid(entity, "none"); return true; }
    if (this.flags.spawn(entity, game) || this.runes.spawn(entity, game)) return true;
    if (entity.classname === "item_invulnerability" && (this.rules.ctfFlags & 2) === 0 && game.options.mode === "deathmatch") { game.remove(entity); return true; }
    return false;
  }
  postSpawn(game: Q2GameServices): undefined { game.sourceCallbacks.register(this.callbacks); this.flags.postSpawn(game); this.runes.postSpawn(game); if (this.travel?.countdown) this.match.start(game); return undefined; }
  captureTravel(): LmctfTravel {
    return { rules: { ...this.rules }, countdown: this.match.pendingMap?.countdown ?? false, paused: this.match.paused,
      players: [...this.states].flatMap(([actor, state]) => { const player = this.hooks.player(actor); return player === null ? [] : [{ slot: player.slot, team: state.team, observerTeam: state.observerTeam, extraFlags: state.extraFlags }]; }) };
  }
  capture() {
    const { refPassword: _password, rconPassword: _rconPassword, ...rules } = this.rules;
    return { rules, match: this.match.capture(), vote: this.vote.capture(), plasmaQuad: this.context.plasmaQuad, flags: this.flags.capture(), runes: this.runes.capture(),
      players: [...this.states].map(([actor, state]) => ({ actor: saveCtfActor(actor), state: { ...state, ...captureLmctfGrapple(this.grapple.state(actor)),
        rune: state.rune === null ? null : saveCtfActor(state.rune), statistics: [...state.statistics].map(([key, count]) => ({ key, count })) } })) };
  }
  restore(reader: SaveReader, game: Q2GameServices): undefined {
    this.grapple.equipment.bind(game);
    const rules = reader.field("rules");
    Object.assign(this.rules, { timeLimitMinutes: rules.field("timeLimitMinutes").finite(), fragLimit: rules.field("fragLimit").integer(), mapList: rules.field("mapList").list(value => value.string()), ctfFlags: rules.field("ctfFlags").integer(0), refFlags: rules.field("refFlags").integer(0), runes: rules.field("runes").integer(0),
      skinSet: rules.field("skinSet").integer(), flagInit: rules.field("flagInit").boolean(), disabledWeapons: rules.field("disabledWeapons").integer(0),
      fastSwitch: rules.field("fastSwitch").boolean(), autoLock: rules.field("autoLock").boolean(), countdownSeconds: rules.field("countdownSeconds").finite(), quadSeconds: rules.field("quadSeconds").finite() });
    this.grapple.states.clear();
    const players = reader.field("players").list(entry => {
      const actor = game.host.actors.resolveSaved(readSavedActor(entry.field("actor")));
      if (actor === null || this.hooks.player(actor.id) === null) throw new Error("LMCTF restore requires an admitted source player");
      const saved = entry.field("state"), state = new LmctfPlayerState();
      state.plasmaMode = saved.field("plasmaMode").boolean();
      state.team = saved.field("team").choice(0, 1, 2); state.observerTeam = saved.field("observerTeam").choice(0, 1, 2);
      state.rune = saved.field("rune").nullable(value => game.host.actors.referenceSaved(readSavedActor(value)));
      this.grapple.states.set(actor.id, restoreLmctfGrapple({ hook: saved.field("hook").nullable(readSavedActor),
        hookState: saved.field("hookState").choice(0, 1, 2), hookLength: saved.field("hookLength").finite(), hookHeld: saved.field("hookHeld").boolean() }, game));
      state.regenFrame = saved.field("regenFrame").integer(); state.killCarrierTime = saved.field("killCarrierTime").finite(); state.hitCarrierTime = saved.field("hitCarrierTime").finite();
      state.returnFlagTime = saved.field("returnFlagTime").finite(); state.defendFlagTime = saved.field("defendFlagTime").finite(); state.extraFlags = saved.field("extraFlags").integer(); state.spawnState = saved.field("spawnState").integer(0);
      for (const statistic of saved.field("statistics").list(value => ({ key: value.field("key").string(), count: value.field("count").finite() }))) state.statistics.set(statistic.key, statistic.count);
      return { actor: actor.id, state };
    });
    this.match.restore(reader.field("match")); this.vote.restore(reader.field("vote")); this.context.plasmaQuad = reader.field("plasmaQuad").boolean();
    const flags = reader.field("flags");
    this.flags.restore(game, { lastTakenSound: flags.field("lastTakenSound").finite(), flags: flags.field("flags").list(flag => ({ team: flag.field("team").choice(1, 2), actor: readSavedActor(flag.field("actor")) })) });
    this.runes.restore({ forward: reader.field("runes").field("forward").boolean() });
    this.states.clear(); for (const player of players) this.states.set(player.actor, player.state);
    return undefined;
  }
  teamTotals(): readonly [number, number] {
    let red = 0, blue = 0; for (const [actor, state] of this.states) { const score = this.hooks.player(actor)?.score ?? 0; if (state.team === 1) red += score; else if (state.team === 2) blue += score; } return [red, blue];
  }
  admitted(entity: Q2Entity, game: Q2GameServices): undefined {
    this.grapple.equipment.bind(game);
    if (this.states.has(entity.actor.id)) return undefined;
    const common = this.hooks.player(entity.actor.id); if (common === null) throw new Error("LMCTF admission requires shared source player state");
    const state = new LmctfPlayerState(); this.states.set(entity.actor.id, state);
    const carried = this.travel?.players.find(player => player.slot === common.slot);
    if (carried !== undefined) {
      state.extraFlags = carried.extraFlags;
      if (carried.team === 0) return this.observer(entity, game, carried.observerTeam);
      return this.setTeam(entity, game, carried.team);
    }
    if (common.spectator || common.requestedSpectator) return this.observer(entity, game, 0);
    let red = 0, blue = 0;
    for (const [actor, member] of this.states) if (!actor.equals(entity.actor.id)) { if (member.team === 1) red++; else if (member.team === 2) blue++; }
    const [redScore, blueScore] = this.teamTotals(); state.team = red < blue ? 1 : blue < red ? 2 : redScore > blueScore ? 2 : 1;
    this.setTeam(entity, game, state.team); return undefined;
  }
  playerSpawned(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = lmctfPlayer(this.context, entity.actor.id); this.grapple.abort(entity, game); this.grapple.state(entity.actor.id).hookHeld = false;
    if (!game.host.inventory.entries(entity.actor.id).some(entry => entry.item === "q2:weapon_hook")) game.host.inventory.configure(entity.actor, { item: "q2:weapon_hook", count: 0, capacity: 1 });
    if (state.team !== 0) game.host.inventory.give(entity.actor, "q2:weapon_hook", 1);
    game.host.combat.setTraits(entity.actor, { team: state.team === 0 || (this.rules.ctfFlags & 128) !== 0 ? null : state.team === 1 ? "RED" : "BLUE" }); return undefined;
  }
  private setTeam(entity: Q2Entity, game: Q2GameServices, team: LmctfPlayingTeam): undefined {
    const state = lmctfPlayer(this.context, entity.actor.id), player = this.hooks.player(entity.actor.id); state.team = team; state.observerTeam = 0;
    if (player !== null) { player.spectator = false; player.requestedSpectator = false; player.noclip = false; }
    game.host.combat.setTraits(entity.actor, { team: (this.rules.ctfFlags & 128) !== 0 ? null : team === 1 ? "RED" : "BLUE" });
    return lmctfPrint(game, `${lmctfName(this.context, entity.actor.id)} is now on the ${team === 1 ? "red" : "blue"} team.\n`);
  }
  join(entity: Q2Entity, game: Q2GameServices, team: LmctfPlayingTeam): undefined {
    const state = lmctfPlayer(this.context, entity.actor.id), player = this.hooks.player(entity.actor.id); if (state.team === team || player === null) return undefined;
    if (this.match.teamsLocked) return lmctfPrint(game, "Teams are locked.\n", entity.actor.id);
    if ((this.rules.ctfFlags & 8) !== 0) return game.host.emit({ kind: "centerprint", actor: entity.actor.id, text: "Sorry.  Team switching has been turned\n off on this server.\n" });
    if (!player.spectator) {
      game.damage(entity.actor.id, entity, entity.actor.id, 100000, 0, zero, game.body(entity).origin, zero, 23, 32);
      lmctfScore(this.context, game, entity.actor.id, 1, "Team Change"); lmctfStat(this.context, entity.actor.id, "deaths", -1);
    }
    this.dropInventory(entity, game); this.setTeam(entity, game, team); state.spawnState = 0; this.hooks.spawnPlayer(entity, game); return this.playerSpawned(entity, game);
  }
  observer(entity: Q2Entity, game: Q2GameServices, team: LmctfTeam): undefined {
    const state = lmctfPlayer(this.context, entity.actor.id), player = this.hooks.player(entity.actor.id); if (player === null) return undefined;
    this.dropInventory(entity, game); state.team = 0; state.observerTeam = team;
    player.spectator = true; player.requestedSpectator = true; player.noclip = true;
    game.host.combat.setTraits(entity.actor, { team: null, canTakeDamage: false }); return this.hooks.observer(entity, game);
  }
  selectSpawn(entity: Q2Entity, game: Q2GameServices) { return selectLmctfSpawn(this.context, entity, game); }
  score(victim: Q2Entity, attacker: Q2Entity | null, game: Q2GameServices, change: number, _means: number, recipient: Q2Entity): undefined {
    lmctfScore(this.context, game, recipient.actor.id, change, change > 0 ? "Kill" : "Suicide", victim.actor.id);
    if (attacker !== null) this.flags.frag(victim, attacker, game); return undefined;
  }
  dropInventory(entity: Q2Entity, game: Q2GameServices): undefined { this.flags.drop(entity, game); this.runes.drop(entity.actor.id, game); return this.grapple.states.get(entity.actor.id)?.hook === null ? undefined : this.grapple.abort(entity, game); }
  playerDeath(entity: Q2Entity, game: Q2GameServices): undefined { lmctfStat(this.context, entity.actor.id, "deaths", 1); return this.dropInventory(entity, game); }
  disconnect(entity: Q2Entity, game: Q2GameServices): undefined { this.dropInventory(entity, game); this.states.delete(entity.actor.id); this.grapple.states.delete(entity.actor.id); return undefined; }
  playerFrame(entity: Q2Entity, game: Q2GameServices): undefined { this.match.frame(game); this.vote.frame(game); this.runes.playerFrame(entity, game); if ((this.grapple.states.get(entity.actor.id)?.hookState ?? 0) !== 0) this.grapple.fire(entity, game); return undefined; }
  canMove(actor: ActorId): boolean { return !this.match.paused || ((this.states.get(actor)?.extraFlags ?? 0) & 2) !== 0; }
  gravityScale(actor: ActorId): 0 | 1 { return this.grapple.gravityScale(actor); }
  command(entity: Q2Entity, game: Q2GameServices, name: string, args: readonly string[]): boolean {
    name = name.toLowerCase();
    if (lmctfAdminCommand(this.context, this.match, entity, game, name, args)) return true;
    if (!this.canMove(entity.actor.id) && !["ctfmenu", "voteyes", "voteno", "lmctf-vote", "score", "say", "say_team", "players", "playerlist"].includes(name)) return true;
    switch (name) {
      case "ctfmenu": lmctfMenu(this.context, entity.actor.id); return true;
      case "voteyes": case "voteno": this.vote.ballot(entity.actor.id, game, name === "voteyes"); return true;
      case "lmctf-vote": if (args[0] === "skip") this.vote.start(entity.actor.id, game); else this.vote.menu(entity.actor.id); return true;
      case "score": lmctfScoreboard(this.context, entity.actor.id); return true;
      case "hook": case "+hook": this.grapple.command(entity, game, true); return true;
      case "unhook": case "-hook": this.grapple.command(entity, game, false); return true;
      case "team": {
        const choice = (args[0] ?? "").toLowerCase();
        if (choice === "red" || choice === "blue") this.join(entity, game, choice === "red" ? 1 : 2);
        else lmctfPrint(game, `You are currently on the ${lmctfPlayer(this.context, entity.actor.id).team === 1 ? "red" : "blue"} team.\nUse 'team red' or 'team blue' to change teams.\n`, entity.actor.id);
        return true;
      }
      case "observe": case "observe_red": case "observe_blue": this.observer(entity, game, name === "observe_red" ? 1 : name === "observe_blue" ? 2 : 0); return true;
      case "drop": case "use": {
        const requested = args.join(" ").toLowerCase();
        if (requested === "flag" || requested === "enemy flag") { this.flags.drop(entity, game); return true; }
        if (requested === "rune" || requested.endsWith(" artifact")) return this.runes.drop(entity.actor.id, game);
        return false;
      }
      default: return false;
    }
  }
}
