/* LM_CTF g_ctffunc.c and p_client.c flag bonuses. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, length, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { q2EntitiesNamed } from "../../base/player/spawns.ts";
import { CTF_FLAGS, otherCtfTeam } from "../ctf/types.ts";
import { lmctfActive, lmctfName, lmctfPlayer, lmctfPrint, lmctfScore, lmctfStat, lmctfToss } from "./types.ts";
import type { LmctfContext, LmctfPlayingTeam } from "./types.ts";

const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 33 } };
export interface LmctfFlagsCheckpoint { readonly flags: readonly { readonly team: LmctfPlayingTeam; readonly actor: SavedActorId }[]; readonly lastTakenSound: number; }
export class LmctfFlags {
  private readonly flags = new Map<LmctfPlayingTeam, ActorId>();
  private lastTakenSound = 0;
  constructor(readonly context: LmctfContext) {
    context.hooks.items.register({ kind: "custom", classname: "flag", model: "players/male/flag1.md2", icon: "a_redflag", name: "Enemy Flag", sound: "misc/am_pkup.wav",
      rotate: false, respawn: 0, capacity: 32767, quantity: 1, coopStay: false, droppable: false, use: (actor, game) => { const player = game.entity(actor.id); if (player === null || this.carried(actor.id, game) === null) return false; this.drop(player, game); return true; },
      pickup: (entity, game, player) => { this.pickup(entity, game, player.id); return false; } });
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { "lmctf:ctf_flagwave": this.wave, "lmctf:Drop_Flag_Think": this.droppedThink },
    touch: { "lmctf:ctf_flagtouch": this.touch, "lmctf:Flag_DropTouch": this.dropTouch } }; }
  capture(): LmctfFlagsCheckpoint { return { flags: [...this.flags].map(([team, actor]) => ({ team, actor: { slot: actor.slot, generation: actor.generation } })), lastTakenSound: this.lastTakenSound }; }
  restore(game: Q2GameServices, saved: LmctfFlagsCheckpoint): undefined {
    this.flags.clear(); for (const flag of saved.flags) { const actor = game.host.actors.resolveSaved(flag.actor); if (actor === null) throw new Error("Saved LMCTF flag is absent"); this.flags.set(flag.team, actor.id); }
    this.lastTakenSound = saved.lastTakenSound; return undefined;
  }
  flag(team: LmctfPlayingTeam, game: Q2GameServices): Q2Entity | null { return game.entity(this.flags.get(team) ?? null); }
  carried(actor: ActorId, game: Q2GameServices): Q2Entity | null {
    const state = this.context.states.get(actor); return state === undefined || state.team === 0 || game.host.inventory.count(actor, "q2:flag") === 0 ? null : this.flag(otherCtfTeam(state.team), game);
  }
  atHome(flag: Q2Entity, game: Q2GameServices): boolean { return length(subtract(flag.pos1, game.body(flag).origin)) <= 32; }
  state(team: LmctfPlayingTeam, game: Q2GameServices): "base" | "taken" | "dropped" {
    const flag = this.flag(team, game); return flag === null || this.atHome(flag, game) && flag.solid !== "none" ? "base" : flag.solid === "none" ? "taken" : "dropped";
  }
  private properties(flag: Q2Entity, game: Q2GameServices): undefined {
    flag.visible = true; flag.owner = null; flag.timestamp = 0; flag.touch = this.touch;
    game.move(flag, { bounds }); game.solid(flag, "trigger"); game.motion(flag, "toss");
    const origin = game.body(flag).origin;
    const trace = game.host.trace({ start: origin, end: add(origin, { x: 0, y: 0, z: -128 }), bounds, ignore: flag.actor.id, mask: 3 });
    game.move(flag, { origin: trace.end, angles: zero, velocity: zero }); game.show(flag); return game.schedule(flag, 0.1, this.wave);
  }
  reset(flag: Q2Entity | null, player: ActorId | null, game: Q2GameServices): undefined {
    if (flag !== null) { game.move(flag, { origin: flag.pos1, angles: flag.pos2 }); this.properties(flag, game); }
    const entity = game.entity(player);
    if (entity !== null) { entity.effects &= ~0x100; entity.model3 = ""; game.host.inventory.consume(entity.actor, "q2:flag", game.host.inventory.count(entity.actor.id, "q2:flag")); game.show(entity); }
    return undefined;
  }
  resetAll(game: Q2GameServices): undefined { for (const team of [1, 2] satisfies readonly LmctfPlayingTeam[]) { const flag = this.flag(team, game); this.reset(flag, flag?.owner ?? null, game); } return undefined; }
  private farthest(from: Q2Entity, game: Q2GameServices): Q2Entity | null {
    const candidates = [...q2EntitiesNamed(game, "info_player_deathmatch"), ...q2EntitiesNamed(game, "info_flag_red").slice(0, 1), ...q2EntitiesNamed(game, "info_flag_blue").slice(0, 1)];
    let best: Q2Entity | null = null, distance = 0;
    for (const candidate of candidates) { const current = length(subtract(game.body(from).origin, game.body(candidate).origin)); if (current > distance) { best = candidate; distance = current; } }
    return best ?? q2EntitiesNamed(game, "info_player_deathmatch")[0] ?? null;
  }
  private spawnFlag(team: LmctfPlayingTeam, game: Q2GameServices): undefined {
    if (this.flag(team, game) !== null || game.options.mode !== "deathmatch" || (this.context.rules.ctfFlags & 256) !== 0) return undefined;
    const classname = team === 1 ? "info_flag_red" : "info_flag_blue";
    let spot = q2EntitiesNamed(game, classname)[0] ?? null;
    if (spot === null) {
      spot = q2EntitiesNamed(game, "info_player_deathmatch")[0] ?? null;
      if (spot !== null) spot = this.farthest(spot, game);
      if (team === 2 && spot !== null) spot = this.farthest(spot, game);
      spot ??= q2EntitiesNamed(game, team === 1 ? "info_player_start" : "target_changelevel")[0] ?? null;
      if (spot === null) return undefined;
      spot.classname = classname; spot.effects |= 0x100; spot.renderFlags |= team === 1 ? 1024 : 4096; game.show(spot);
    }
    const flag = game.create("flag"), body = game.body(spot);
    flag.count = team; flag.model = CTF_FLAGS[team].model; flag.effects = CTF_FLAGS[team].effect;
    flag.frame = this.context.rules.flagInit ? 173 : 0; flag.pos1 = body.origin; flag.pos2 = body.angles; this.flags.set(team, flag.actor.id);
    this.reset(flag, null, game); this.properties(flag, game);
    for (const spawn of q2EntitiesNamed(game, "info_player_deathmatch")) if (length(subtract(game.body(spawn).origin, flag.pos1)) <= 256) game.remove(spawn);
    return undefined;
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname === "info_flag_red" || entity.classname === "info_flag_blue") { game.solid(entity, "none"); return true; }
    if (entity.classname !== "flag") return false;
    const team = entity.count === 1 || entity.count === 2 ? entity.count : null;
    if (team !== null) { this.flags.set(team, entity.actor.id); this.properties(entity, game); }
    return true;
  }
  postSpawn(game: Q2GameServices): undefined { game.sourceCallbacks.register(this.callbacks); this.spawnFlag(1, game); return this.spawnFlag(2, game); }
  private team(flag: Q2Entity): LmctfPlayingTeam { if (flag.count !== 1 && flag.count !== 2) throw new Error("LMCTF flag has no source team"); return flag.count; }
  private announce(game: Q2GameServices, team: LmctfPlayingTeam, own: string, other: string): undefined {
    for (const actor of game.host.players()) lmctfPrint(game, this.context.states.get(actor)?.team === team ? own : other, actor); return undefined;
  }
  private sound(flag: Q2Entity, game: Q2GameServices, path: string, volume = 0.8): undefined { return game.sound(flag, path, 5, volume, 0); }
  private readonly wave: Q2Think = (flag, game) => {
    if (flag.solid !== "none") { flag.frame = 173 + (flag.frame - 172) % 16; game.show(flag); }
    game.schedule(flag, 0.1, this.wave);
    if (flag.timestamp !== 0 && game.host.now() > flag.timestamp + 30 && (flag.owner === null || !lmctfActive(this.context, game, flag.owner))) {
      this.sound(flag, game, this.team(flag) === 1 ? "ctf/r_returned.wav" : "ctf/b_returned.wav"); this.reset(flag, null, game);
    }
    return undefined;
  };
  private readonly touch: Q2Touch = (entity, game, contact) => { this.pickup(entity, game, contact.other); return undefined; };
  private readonly dropTouch: Q2Touch = (entity, game, contact) => entity.owner?.equals(contact.other) ? undefined : this.touch(entity, game, contact);
  private readonly droppedThink: Q2Think = (entity, game) => { entity.owner = null; entity.touch = this.touch; return game.schedule(entity, 0.1, this.wave); };
  drop(player: Q2Entity, game: Q2GameServices): undefined {
    const flag = this.carried(player.actor.id, game); if (flag === null) return undefined;
    this.reset(flag, player.actor.id, game); this.properties(flag, game); flag.owner = player.actor.id; flag.touch = this.dropTouch;
    game.schedule(flag, 1, this.droppedThink); lmctfToss(flag, player, game, angleVectors(game.host.playerViewState(player.actor.id)?.viewAngles ?? game.body(player).angles).forward);
    flag.timestamp = game.host.now(); lmctfStat(this.context, player.actor.id, "flag-lost", 1); lmctfScore(this.context, game, player.actor.id, 0, "FC LostFlag");
    return lmctfPrint(game, `${lmctfName(this.context, player.actor.id)} lost the ${this.team(flag) === 1 ? "red" : "blue"} flag.\n`);
  }
  pickup(flag: Q2Entity, game: Q2GameServices, actor: ActorId): boolean {
    if (!this.context.flagsTouchable() || !lmctfActive(this.context, game, actor) || (game.host.combat.read(actor)?.health ?? 0) <= 0 || flag.solid !== "trigger") return false;
    const team = this.team(flag), player = game.entity(actor), state = lmctfPlayer(this.context, actor), name = lmctfName(this.context, actor), color = team === 1 ? "red" : "blue", now = game.host.now();
    if (player === null) return false;
    if (state.team === team) {
      if (this.atHome(flag, game)) {
        if (game.host.inventory.count(actor, "q2:flag") > 0) this.captureFlag(flag, game, player, team);
      } else {
        this.sound(flag, game, team === 1 ? "ctf/r_returned.wav" : "ctf/b_returned.wav");
        lmctfStat(this.context, actor, "returns", 1); lmctfScore(this.context, game, actor, 1, "F Return"); state.returnFlagTime = now;
        this.announce(game, team, `${name} returned your flag!\n`, `${name} returned the ${color} flag.\n`);
        for (const [other, member] of this.context.states) if (!other.equals(actor) && member.team === team && now < member.killCarrierTime + 6) {
          lmctfPrint(game, `${lmctfName(this.context, other)} helped ${name} return the ${color} flag.\n`);
          lmctfScore(this.context, game, other, 1, "F Return Assist"); lmctfStat(this.context, other, "assists", 1); member.killCarrierTime = 0;
        }
        this.reset(flag, null, game);
      }
      return false;
    }
    if ((this.context.rules.refFlags & team) !== 0) return false;
    player.effects |= 0x100; player.renderFlags |= team === 2 ? 1024 : 4096;
    this.announce(game, team, `${name} stole your flag!\n`, `${name} stole the ${color} flag.\n`);
    lmctfStat(this.context, actor, "flag-taken", 1); lmctfScore(this.context, game, actor, 0, "F Pickup");
    if (this.atHome(flag, game)) { game.sound(flag, "ctf/flagtk.wav", 0, 0.7); this.sound(flag, game, team === 1 ? "ctf/r_stolen.wav" : "ctf/b_stolen.wav"); }
    else if (now > this.lastTakenSound + 8) { this.lastTakenSound = now; this.sound(flag, game, team === 1 ? "ctf/r_stolen.wav" : "ctf/b_stolen.wav"); }
    flag.owner = actor; flag.visible = false; game.solid(flag, "none"); game.show(flag); game.schedule(flag, 0.1, this.wave);
    player.model3 = flag.model; game.show(player);
    if (!game.host.inventory.entries(actor).some(entry => entry.item === "q2:flag")) game.host.inventory.configure(player.actor, { item: "q2:flag", count: 0, capacity: 32767 });
    game.host.inventory.give(player.actor, "q2:flag", 1); game.host.emit({ kind: "pickup", player: actor, item: "q2:flag", name: "Enemy Flag", icon: "a_redflag" }); game.sound(player, "misc/am_pkup.wav", 3); return true;
  }
  private captureFlag(home: Q2Entity, game: Q2GameServices, player: Q2Entity, team: LmctfPlayingTeam): undefined {
    const enemy = this.flag(otherCtfTeam(team), game); if (enemy === null) return undefined;
    const name = lmctfName(this.context, player.actor.id), color = team === 1 ? "blue" : "red", now = game.host.now();
    this.announce(game, otherCtfTeam(team), `${name} captured your flag!\n`, `${name} captured the ${color} flag.\n`);
    for (const [actor, member] of this.context.states) if (member.team === team) {
      for (const assist of [{ field: "killCarrierTime", window: 6, name: "FC Frag Assist", reason: "killing the flag carrier" },
        { field: "returnFlagTime", window: 3, name: "F Return Assist", reason: "returning the flag" },
        { field: "defendFlagTime", window: 2, name: "F Defend Assist", reason: "defending the flag" }] satisfies readonly { readonly field: "killCarrierTime" | "returnFlagTime" | "defendFlagTime"; readonly window: number; readonly name: string; readonly reason: string }[]) {
        if (now < member[assist.field] + assist.window) {
          lmctfPrint(game, `${lmctfName(this.context, actor)} assisted the capture by ${assist.reason}.\n`);
          lmctfScore(this.context, game, actor, 1, assist.name); lmctfStat(this.context, actor, "assists", 1); member[assist.field] = 0;
        }
      }
    }
    this.sound(home, game, `ctf/${team === 1 ? "red" : "blue"}score${this.context.rules.skinSet + 1}.wav`, 1);
    game.host.emit({ kind: "effect", effect: "bfg-explosion", origin: game.body(home).origin, direction: zero, count: 0, color: 0 });
    lmctfScore(this.context, game, player.actor.id, 5, "F Capture"); lmctfStat(this.context, player.actor.id, "captures", 1);
    let bonus = 10;
    if ((this.context.rules.ctfFlags & 512) !== 0) {
      let allies = 1, enemies = 1;
      for (const [actor, state] of this.context.states) if (lmctfActive(this.context, game, actor)) { if (state.team === team) allies++; else if (state.team !== 0) enemies++; }
      bonus = Math.trunc(bonus * enemies / allies);
    }
    for (const [actor, state] of this.context.states) if (state.team === team) lmctfScore(this.context, game, actor, bonus, "Team Score");
    return this.reset(enemy, enemy.owner, game);
  }
  hurtCarrier(target: ActorId, attacker: ActorId | null, game: Q2GameServices): undefined {
    if (attacker !== null && this.carried(target, game) !== null) { const state = this.context.states.get(attacker); if (state !== undefined) state.hitCarrierTime = game.host.now(); } return undefined;
  }
  frag(victim: Q2Entity, attacker: Q2Entity, game: Q2GameServices): undefined {
    const source = this.context.states.get(attacker.actor.id), target = this.context.states.get(victim.actor.id);
    if (source === undefined || target === undefined || source.team === 0 || target.team === 0 || source.team === target.team || attacker === victim) return undefined;
    const own = this.flag(source.team, game), enemy = this.flag(target.team, game), now = game.host.now(), color = source.team === 1 ? "red" : "blue";
    const near = (origin: Vec3, radius: number): boolean => length(subtract(game.body(attacker).origin, origin)) < radius || length(subtract(game.body(victim).origin, origin)) < radius;
    const award = (amount: number, log: string, stat: string, text: string): undefined => { lmctfScore(this.context, game, attacker.actor.id, amount, log); lmctfStat(this.context, attacker.actor.id, stat, 1); return lmctfPrint(game, `${lmctfName(this.context, attacker.actor.id)} ${text}\n`); };
    if (own !== null && (own.owner === null || !lmctfActive(this.context, game, own.owner))) {
      if (this.atHome(own, game)) {
        if (near(game.body(own).origin, 800)) { award(2, "F Def", "defense-flag", `defends the ${color} flag.`); source.defendFlagTime = now; }
      } else {
        if (near(own.pos1, 600)) award(1, "F Base Def", "defense-base", `defends the ${color} base.`);
        if (near(game.body(own).origin, 400)) source.defendFlagTime = now;
      }
      const carrier = game.entity(enemy?.owner ?? null);
      if (carrier !== null && carrier !== attacker && lmctfActive(this.context, game, carrier.actor.id)) {
        if (now < target.hitCarrierTime + 2) award(3, "FC Def", "defense-carrier", `defends the ${color} flag carrier from an aggressive enemy.`);
        else if (near(game.body(carrier).origin, 500)) award(2, "FC Def", "defense-carrier", `defends the ${color} flag carrier.`);
      }
    }
    if (this.carried(victim.actor.id, game) !== null) { award(2, "FC Frag", "offense-carrier", "killed the enemy flag carrier."); source.killCarrierTime = now; }
    return undefined;
  }
}
