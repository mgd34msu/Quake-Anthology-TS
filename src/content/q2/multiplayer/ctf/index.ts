/* Original Quake II CTF 1.09b g_ctf.c integration. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch } from "../../foundation/host.ts";
import type { Q2WeaponInput } from "../../foundation/weapons/types.ts";
import { add, movedir, scale, zero } from "../../foundation/fields.ts";
import { q2Userinfo } from "../../base/player/index.ts";
import { q2EntitiesNamed, q2KillBox, q2PlayersRange, q2SpawnOrigin, selectQ2Spawn } from "../../base/player/spawns.ts";
import { createQ2CtfRules, ctfName, ctfPlayer, ctfPrint, ctfScore, ctfTeamName, Q2CtfMatchState, Q2CtfPlayerState } from "./types.ts";
import type { Q2CtfContext, Q2CtfHooks, Q2CtfMenuAction, Q2CtfPlayingTeam, Q2CtfRules } from "./types.ts";
import { Q2CtfFlags } from "./flags.ts";
import { Q2CtfMatch } from "./match.ts";
import { Q2CtfPresentation, ctfTech } from "./presentation.ts";
import { Q2CtfGrapple } from "./grapple.ts";
import { Q2CtfTechs } from "./techs.ts";
import { captureQ2Ctf, restoreQ2Ctf } from "./checkpoint.ts";
import type { Q2CtfCheckpoint } from "./checkpoint.ts";

export * from "./types.ts";
export * from "./checkpoint.ts";
export { Q2CtfFlags, Q2CtfMatch, Q2CtfPresentation, Q2CtfGrapple, Q2CtfTechs };
export type { Q2CtfAdminSettings } from "./match.ts";

/** One selected CTF match attached to the existing source player and game services. */
export class Q2Ctf implements Q2SpawnModule {
  readonly context: Q2CtfContext;
  readonly flags: Q2CtfFlags;
  readonly match: Q2CtfMatch;
  readonly presentation: Q2CtfPresentation;
  readonly grapple: Q2CtfGrapple;
  readonly techs: Q2CtfTechs;
  constructor(hooks: Q2CtfHooks, rules: Partial<Q2CtfRules> = {}) {
    this.context = { hooks, rules: createQ2CtfRules(rules), states: new Map<ActorId, Q2CtfPlayerState>(), match: new Q2CtfMatchState() };
    this.flags = new Q2CtfFlags(this.context); this.grapple = new Q2CtfGrapple(this.context); this.techs = new Q2CtfTechs(this.context);
    this.match = new Q2CtfMatch(this.context, { resetPlayers: game => this.resetPlayers(game), resetGrapple: (entity, game) => this.grapple.reset(entity, game), join: (entity, game, team, ghost) => this.join(entity, game, team, ghost) });
    this.presentation = new Q2CtfPresentation(this.context, this.flags);
    this.flags.register(); this.grapple.register(); this.techs.register();
    hooks.weapons.setSourceRules({ kind: "ctf", haste: context => this.techs.haste(context.self.actor.id, context.game),
      strengthSound: context => this.techs.strengthSound(context.self, context.game), hasteSound: context => this.techs.hasteSound(context.self, context.game) });
  }
  get states() { return this.context.states; }
  get rules() { return this.context.rules; }
  get callbacks(): Q2CallbackDefinitions {
    const flag = this.flags.callbacks, grapple = this.grapple.callbacks, tech = this.techs.callbacks;
    return { think: { ...flag.think, ...grapple.think, ...tech.think, misc_ctf_banner_think: this.bannerThink },
      touch: { ...flag.touch, ...grapple.touch, ...tech.touch, old_teleporter_touch: this.teleportTouch },
      use: { ...flag.use, ...grapple.use, ...tech.use }, pain: { ...flag.pain, ...grapple.pain, ...tech.pain }, die: { ...flag.die, ...grapple.die, ...tech.die }, blocked: { ...flag.blocked, ...grapple.blocked, ...tech.blocked } };
  }
  itemName(classname: string): string | null { return this.context.hooks.items.itemName(classname); }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (this.flags.spawn(entity, game) || this.techs.spawn(entity, game)) return true;
    switch (entity.classname) {
      case "info_player_team1": case "info_player_team2": return true;
      case "misc_ctf_banner": case "misc_ctf_small_banner":
        entity.model = entity.classname === "misc_ctf_banner" ? "models/ctf/banner/tris.md2" : "models/ctf/banner/small.md2";
        entity.skin = (entity.spawnflags & 1) !== 0 ? 1 : 0; entity.frame = Math.floor(game.host.random() * 16);
        game.solid(entity, "none"); game.motion(entity, "stationary"); game.show(entity); game.schedule(entity, 0.1, this.bannerThink); return true;
      case "info_teleport_destination": game.move(entity, { origin: add(game.body(entity).origin, { x: 0, y: 0, z: 16 }) }); return true;
      case "trigger_teleport": {
        if (entity.target === "") { game.host.diagnostic("teleporter without a target"); game.remove(entity); return true; }
        entity.visible = false; entity.serverFlags |= 1; entity.touch = this.teleportTouch;
        if (entity.model.startsWith("*")) game.move(entity, { bounds: game.host.inlineModelBounds(Number(entity.model.slice(1))) });
        game.solid(entity, "trigger"); game.show(entity);
        const sound = game.create("ctf_teleport_sound"), body = game.body(entity); entity.enemy = sound.actor.id;
        game.move(sound, { origin: add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)) });
        game.host.emit({ kind: "sound", actor: sound.actor.id, origin: game.body(sound).origin, path: "world/hum1.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
        return true;
      }
      default: return false;
    }
  }
  private readonly bannerThink: Q2Think = (entity, game) => { entity.frame = (entity.frame + 1) % 16; game.show(entity); return game.schedule(entity, 0.1, this.bannerThink); };
  private readonly teleportTouch: Q2Touch = (entity, game, contact) => {
    const player = game.entity(contact.other); if (player === null || !game.host.isPlayer(contact.other)) return undefined;
    const destination = game.targets(entity.target)[0]; if (destination === undefined) { game.host.diagnostic("Couldn't find CTF teleporter destination"); return undefined; }
    this.grapple.reset(player, game);
    const body = game.body(destination), velocity = scale(movedir(body.angles), 200);
    game.host.bodies.unlink(player.actor); game.move(player, { origin: body.origin, velocity, angles: { x: 0, y: body.angles.y, z: 0 } }, false);
    this.context.hooks.teleport(player, game, body.origin, body.angles, velocity);
    if (entity.enemy !== null) game.host.emit({ kind: "entity-event", actor: entity.enemy, event: 6 });
    game.host.emit({ kind: "entity-event", actor: player.actor.id, event: 6 }); q2KillBox(player, game); return game.link(player);
  };
  afterSpawn(game: Q2GameServices): undefined { this.match.afterSpawn(game); return this.techs.setup(game); }
  admitted(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.states.has(entity.actor.id)) return undefined;
    const common = this.context.hooks.player(entity.actor.id); if (common === null) throw new Error("CTF admission requires the shared player state");
    const state = new Q2CtfPlayerState(); this.states.set(entity.actor.id, state);
    if ((game.options.deathmatchFlags & 131072) !== 0 && this.context.match.phase === "none" && !common.requestedSpectator) {
      let one = 0, two = 0; for (const member of this.states.values()) { if (member.team === 1) one++; else if (member.team === 2) two++; }
      state.team = one < two ? 1 : two < one ? 2 : game.host.random() < 0.5 ? 1 : 2;
      this.assignSkin(entity); return this.spawnPlayer(entity, game);
    }
    this.setObserver(entity, game); return this.presentation.joinMenu(entity);
  }
  assignSkin(entity: Q2Entity): undefined {
    const player = this.context.hooks.player(entity.actor.id), state = ctfPlayer(this.context, entity.actor.id); if (player === null) throw new Error("Missing shared CTF player");
    const original = q2Userinfo(player.userinfo).get("skin") ?? player.skin, slash = original.lastIndexOf("/"), model = slash < 0 ? "male/" : original.slice(0, slash + 1);
    return this.context.hooks.setSkin(entity.actor.id, state.team === 0 ? original : `${model}${state.team === 1 ? "ctf_r" : "ctf_b"}`);
  }
  private spawnPlayer(entity: Q2Entity, game: Q2GameServices): undefined {
    const player = this.context.hooks.player(entity.actor.id); if (player === null) throw new Error("Missing shared CTF player");
    player.spectator = false; player.requestedSpectator = false; player.dead = false; player.noclip = false; player.god = false; entity.serverFlags &= ~1; entity.visible = true;
    this.context.hooks.spawnPlayer(entity, game);
    game.host.combat.setTraits(entity.actor, { team: ctfTeamName(ctfPlayer(this.context, entity.actor.id).team) });
    if (player.useQ2Weapons) game.host.inventory.configure(entity.actor, { item: "q2:weapon_grapple", count: 1, capacity: 1 });
    this.assignSkin(entity); return undefined;
  }
  join(entity: Q2Entity, game: Q2GameServices, team: Q2CtfPlayingTeam, ghost = false): boolean {
    const state = ctfPlayer(this.context, entity.actor.id), phase = this.context.match.phase;
    if (!ghost && (this.rules.matchLock && (phase === "pregame" || phase === "game") || this.rules.forceJoin === "red" && team !== 1 || this.rules.forceJoin === "blue" && team !== 2)) return false;
    this.dropInventory(entity, game); state.team = team; state.spawnState = 0; state.ready = false;
    if (phase === "game" && !ghost) this.match.assignGhost(entity, game);
    this.spawnPlayer(entity, game); game.host.emit({ kind: "entity-event", actor: entity.actor.id, event: 6 });
    ctfPrint(game, `${ctfName(this.context, entity.actor.id)} joined the ${ctfTeamName(team)} team.\n`);
    if (phase === "setup") game.host.emit({ kind: "centerprint", actor: entity.actor.id, text: 'Type "ready" in console to ready up.' });
    return true;
  }
  teamCommand(entity: Q2Entity, game: Q2GameServices, name: string): undefined {
    const state = ctfPlayer(this.context, entity.actor.id), team = name.toLowerCase() === "red" ? 1 : name.toLowerCase() === "blue" ? 2 : null;
    if (name === "") return ctfPrint(game, `You are on the ${ctfTeamName(state.team)} team.\n`, entity.actor.id);
    if (this.context.match.phase !== "none" && this.context.match.phase !== "setup") return ctfPrint(game, "Can't change teams in a match.\n", entity.actor.id);
    if (team === null) return ctfPrint(game, `Unknown team ${name}.\n`, entity.actor.id);
    if (state.team === team) return ctfPrint(game, `You are already on the ${ctfTeamName(team)} team.\n`, entity.actor.id);
    const previous = state.team, player = this.context.hooks.player(entity.actor.id); this.dropInventory(entity, game);
    if (previous !== 0 && player !== null) {
      player.god = false; game.host.combat.setTraits(entity.actor, { invulnerable: false });
      game.damage(entity.actor.id, entity, entity.actor.id, 100000, 0, zero, game.body(entity).origin, zero, 23, 32);
      player.score = 0;
    }
    this.join(entity, game, team); return undefined;
  }
  private setObserver(entity: Q2Entity, game: Q2GameServices): undefined {
    const player = this.context.hooks.player(entity.actor.id); if (player === null) throw new Error("Missing shared CTF player");
    player.spectator = true; player.requestedSpectator = true; player.noclip = true; player.god = false;
    game.host.combat.setTraits(entity.actor, { team: null, canTakeDamage: false, invulnerable: false });
    entity.visible = false; entity.serverFlags |= 1; game.solid(entity, "none"); game.show(entity); return this.context.hooks.observer(entity, game);
  }
  observer(entity: Q2Entity, game: Q2GameServices): undefined {
    this.dropInventory(entity, game); const state = ctfPlayer(this.context, entity.actor.id), player = this.context.hooks.player(entity.actor.id);
    state.team = 0; state.ready = false; state.matchRespawnAt = null; if (player !== null) player.score = 0;
    this.setObserver(entity, game); this.assignSkin(entity); return this.presentation.joinMenu(entity);
  }
  selectSpawn(entity: Q2Entity, game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 } | null {
    const state = this.states.get(entity.actor.id), player = this.context.hooks.player(entity.actor.id); if (state === undefined || state.team === 0 || player === null) return null;
    let spot: Q2Entity | undefined;
    if (state.spawnState === 0) {
      state.spawnState++;
      const starts = q2EntitiesNamed(game, `info_player_team${state.team}`), sorted = starts.map(entity => ({ entity, range: q2PlayersRange(game, entity) })).sort((a, b) => a.range - b.range);
      const candidates = starts.length > 2 ? starts.filter(entity => entity !== sorted[0]?.entity && entity !== sorted[1]?.entity) : starts;
      spot = candidates[Math.floor(game.host.random() * candidates.length)];
    }
    spot ??= selectQ2Spawn(game, player, ""); return { origin: q2SpawnOrigin(spot, game), angles: game.body(spot).angles };
  }
  score(victim: Q2Entity, attacker: Q2Entity | null, game: Q2GameServices, change: number, _means: number, recipient: Q2Entity): undefined {
    ctfScore(this.context, recipient.actor.id, change); this.flags.frag(victim, attacker, game); return undefined;
  }
  sameTeam(one: ActorId | null, two: ActorId): boolean { const first = one === null ? undefined : this.states.get(one)?.team; return first !== undefined && first !== 0 && first === this.states.get(two)?.team; }
  /** Composition invokes this before the shared player clears death inventory. */
  dropInventory(entity: Q2Entity, game: Q2GameServices): undefined { this.grapple.reset(entity, game); this.flags.drop(entity, game); return this.techs.drop(entity, game, true); }
  death(entity: Q2Entity, game: Q2GameServices): undefined { return this.grapple.reset(entity, game); }
  disconnect(entity: Q2Entity, game: Q2GameServices): undefined {
    this.match.syncGhost(entity.actor.id); this.dropInventory(entity, game);
    const state = this.states.get(entity.actor.id), ghost = state?.ghostCode === null || state?.ghostCode === undefined ? undefined : this.context.match.ghosts.get(state.ghostCode);
    if (ghost !== undefined) ghost.actor = null;
    if (this.context.match.election?.target === entity.actor.id) this.context.match.election = null;
    this.states.delete(entity.actor.id); return undefined;
  }
  beforePlayer(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.states.get(entity.actor.id); if (state === undefined) return undefined;
    if (state.matchRespawnAt !== null && state.matchRespawnAt <= game.host.now()) { state.matchRespawnAt = null; this.spawnPlayer(entity, game); }
    else { const player = this.context.hooks.player(entity.actor.id); if (state.team !== 0 && this.context.match.phase === "game" && player?.dead === true && player.respawnTime < game.host.now()) this.spawnPlayer(entity, game); }
    return undefined;
  }
  weaponInput(entity: Q2Entity, game: Q2GameServices, input: Q2WeaponInput): Q2WeaponInput { return { ...input, haste: input.haste || this.techs.haste(entity.actor.id, game), instantSwitch: input.instantSwitch || this.rules.instantWeapons }; }
  afterPlayer(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.states.get(entity.actor.id); if (state === undefined) return undefined;
    const player = this.context.hooks.player(entity.actor.id);
    if (state.team !== 0 && player?.useQ2Weapons === true && !player.dead && game.host.inventory.count(entity.actor.id, "q2:weapon_grapple") === 0) game.host.inventory.configure(entity.actor, { item: "q2:weapon_grapple", count: 1, capacity: 1 });
    this.grapple.playerFrame(entity, game); this.techs.regenerate(entity, game); this.flags.effects(entity, game); this.match.syncGhost(entity.actor.id); return this.presentation.hud(entity, game, this.match.status(game));
  }
  afterPlayerFrames(game: Q2GameServices): undefined { for (const actor of game.host.players()) this.match.syncGhost(actor); return undefined; }
  checkRules(game: Q2GameServices): boolean { return this.match.checkRules(game); }
  matchSetup(): boolean { return this.context.match.phase === "setup" || this.context.match.phase === "pregame"; }
  pickupsAllowed(): boolean { return !this.matchSetup(); }
  resetPlayers(game: Q2GameServices): undefined {
    for (const actor of game.host.players()) { const entity = game.entity(actor); if (entity !== null && this.states.has(actor)) this.observer(entity, game); }
    this.techs.reset(game); this.flags.resetAll(game);
    const respawn = this.context.hooks.items.callbacks.think?.["q2_items_respawn"];
    for (const entity of game.entities.values()) if (entity.solid === "none" && entity.think === respawn && entity.nextThink !== null && entity.nextThink >= game.host.now() && respawn !== undefined) { game.cancel(entity); respawn(entity, game); }
    return undefined;
  }
  command(entity: Q2Entity, game: Q2GameServices, command: string, args: readonly string[]): boolean {
    if (!this.states.has(entity.actor.id)) return false;
    const state = ctfPlayer(this.context, entity.actor.id), player = this.context.hooks.player(entity.actor.id), words = args.join(" ");
    switch (command.toLowerCase()) {
      case "ctf-menu": {
        if (args.length !== 1) return false;
        const action = args[0];
        switch (action) {
          case "join-red": case "join-blue": case "observer": case "chase": case "credits": case "match": case "ready": case "notready":
          case "admin-settings": case "admin-start": case "admin-cancel": case "close": this.menuAction(entity, game, action); break;
          default: return false;
        }
        break;
      }
      case "ctf-settings": {
        if (args.length !== 2 || !state.admin) return false;
        const key = args[0], value = args[1], rules = this.rules, flags = game.options.deathmatchFlags;
        const settings = { matchMinutes: rules.matchMinutes, setupMinutes: rules.setupMinutes, startSeconds: rules.startSeconds,
          weaponsStay: (flags & 4) !== 0, instantItems: (flags & 16) !== 0, quadDrop: (flags & 16384) !== 0, instantWeapons: rules.instantWeapons, matchLock: rules.matchLock };
        switch (key) {
          case "matchMinutes": case "setupMinutes": case "startSeconds": {
            const number = Number(value);
            if (value === undefined || value.trim() === "" || !Number.isFinite(number) || number <= 0) return false;
            settings[key] = number; break;
          }
          case "weaponsStay": case "instantItems": case "quadDrop": case "instantWeapons": case "matchLock":
            if (value !== "true" && value !== "false" && value !== "1" && value !== "0") return false;
            settings[key] = value === "true" || value === "1"; break;
          default: return false;
        }
        this.match.configure(entity, game, settings); this.match.settingsMenu(entity, game); break;
      }
      case "team": this.teamCommand(entity, game, words); break;
      case "observer": this.observer(entity, game); break;
      case "id": state.idView = !state.idView; ctfPrint(game, `Disabling player identification ${state.idView ? "off" : "on"}.\n`, entity.actor.id); break;
      case "say_team": this.presentation.sayTeam(entity, game, words); break;
      case "score": case "help": if (player !== null) { player.showScores = !player.showScores; if (player.showScores) this.presentation.scoreboard(entity, game); } break;
      case "inven": if (state.team !== 0) return false; this.presentation.joinMenu(entity); break;
      case "ready": this.match.ready(entity, game, true); break;
      case "notready": this.match.ready(entity, game, false); break;
      case "yes": this.match.vote(entity, game, true); break;
      case "no": this.match.vote(entity, game, false); break;
      case "ghost": if (/^\d+$/.test(words)) this.match.restoreGhost(entity, game, Number(words)); break;
      case "admin": this.match.admin(entity, game, words); break;
      case "stats": this.presentation.stats(entity, game); break;
      case "warp": this.match.warp(entity, game, words); break;
      case "boot": this.match.boot(entity, game, words); break;
      case "playerlist": {
        const lines = game.host.players().map(actor => { const common = this.context.hooks.player(actor), member = this.states.get(actor); return common === null || member === undefined ? "" : `${common.slot + 1} ${Math.floor((game.host.now() - common.enteredAt) / 60)}:${Math.trunc(game.host.now() - common.enteredAt) % 60} ${common.ping} ${common.score} ${common.name}${member.team === 0 ? " (spectator)" : ""}${member.admin ? " (admin)" : ""}\n`; });
        ctfPrint(game, lines.join("").slice(0, 1399), entity.actor.id); break;
      }
      case "drop": if (words.toLowerCase() !== "tech") return false; if (ctfTech(game, entity.actor.id) !== null) this.techs.drop(entity, game); break;
      default: return false;
    }
    return true;
  }
  menuAction(entity: Q2Entity, game: Q2GameServices, action: Q2CtfMenuAction): undefined {
    switch (action) {
      case "join-red": this.join(entity, game, 1); break;
      case "join-blue": this.join(entity, game, 2); break;
      case "observer": this.observer(entity, game); break;
      case "chase": this.context.hooks.chase(entity.actor.id); break;
      case "match": this.match.beginElection(entity, game, "match"); break;
      case "ready": this.match.ready(entity, game, true); break;
      case "notready": this.match.ready(entity, game, false); break;
      case "admin-start": if (ctfPlayer(this.context, entity.actor.id).admin) { if (this.context.match.phase === "setup") { this.context.match.phase = "pregame"; this.context.match.matchTime = game.host.now() + this.rules.startSeconds; } else this.match.setup(game); } break;
      case "admin-cancel": if (ctfPlayer(this.context, entity.actor.id).admin) { this.context.match.phase = "none"; this.resetPlayers(game); } break;
      case "admin-settings": this.match.settingsMenu(entity, game); break;
      case "credits": this.context.hooks.emit({ kind: "menu", actor: entity.actor.id, title: "ThreeWave CTF credits", entries: [{ label: "Design and code: David 'Zoid' Kirsch", action: null }, { label: "id Software Quake II", action: null }, { label: "Close", action: "close" }] }); break;
      case "close": this.context.hooks.emit({ kind: "menu", actor: entity.actor.id, title: "", entries: [] }); break;
    }
    return undefined;
  }
  capture(): Q2CtfCheckpoint { return captureQ2Ctf(this.context); }
  restore(checkpoint: Q2CtfCheckpoint, game: Q2GameServices): undefined { return restoreQ2Ctf(this.context, game, checkpoint); }
}
