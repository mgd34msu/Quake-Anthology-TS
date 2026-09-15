/* Original Quake II CTF flag/bonus source. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, length, movedir, scale, subtract } from "../../foundation/fields.ts";
import { CTF_FLAGS, ctfCarriedFlag, ctfName, ctfPrint, ctfScore, ctfTeamName, otherCtfTeam } from "./types.ts";
import type { Q2CtfContext, Q2CtfPlayingTeam } from "./types.ts";

export function ctfFlagTeam(classname: string): Q2CtfPlayingTeam | null { return classname === CTF_FLAGS[1].classname ? 1 : classname === CTF_FLAGS[2].classname ? 2 : null; }
export function ctfCanSee(target: Q2Entity, viewer: Q2Entity, game: Q2GameServices): boolean {
  if (target.motion === "push") return false;
  const body = game.body(target), eye = add(game.body(viewer).origin, { x: 0, y: 0, z: viewer.viewHeight });
  for (const x of [body.bounds.min.x, body.bounds.max.x]) for (const y of [body.bounds.min.y, body.bounds.max.y]) for (const z of [body.bounds.min.z, body.bounds.max.z])
    if (game.host.trace({ start: eye, end: add(body.origin, { x, y, z }), bounds: null, ignore: viewer.actor.id, mask: 3 }).fraction === 1) return true;
  return false;
}
export class Q2CtfFlags {
  constructor(readonly context: Q2CtfContext) {}
  get callbacks(): Q2CallbackDefinitions { return { think: { CTFFlagThink: this.animate, CTFFlagSetup: this.setup, CTFDropFlagThink: this.returnDropped }, touch: { CTFDropFlagTouch: this.dropTouch, CTF_FlagTouch: this.touch } }; }
  register(): undefined {
    for (const team of [1, 2] satisfies readonly Q2CtfPlayingTeam[]) {
      const flag = CTF_FLAGS[team];
      this.context.hooks.items.register({ kind: "custom", consoleGive: "individual-only", classname: flag.classname, model: flag.model, icon: flag.icon, name: `${team === 1 ? "Red" : "Blue"} Flag`,
        sound: "ctf/flagtk.wav", rotate: false, respawn: 0, capacity: 1, quantity: 1, coopStay: false, droppable: false, use: null,
        pickup: (entity, game, player) => { this.pickup(entity, game, player.id); return false; } });
    }
    return undefined;
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    const team = ctfFlagTeam(entity.classname); if (team === null) return false;
    entity.model ||= CTF_FLAGS[team].model; entity.effects |= CTF_FLAGS[team].effect; entity.renderFlags |= 512; entity.frame = 173;
    game.schedule(entity, game.host.frameSeconds() * 2, this.setup); return true;
  }
  private readonly setup: Q2Think = (entity, game) => {
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } }, origin = game.body(entity).origin;
    const trace = game.host.trace({ start: origin, end: add(origin, { x: 0, y: 0, z: -128 }), bounds, ignore: entity.actor.id, mask: 3 });
    if (trace.startSolid) { game.host.diagnostic(`CTFFlagSetup: ${entity.classname} starts solid`); return game.remove(entity); }
    game.move(entity, { bounds, origin: trace.end }); entity.touch = this.touch; game.solid(entity, "trigger"); game.motion(entity, "toss"); game.show(entity);
    return game.schedule(entity, 0.1, this.animate);
  };
  private readonly animate: Q2Think = (entity, game) => { if (entity.solid !== "none") entity.frame = 173 + ((entity.frame - 173 + 1) % 16 + 16) % 16; game.show(entity); return game.schedule(entity, 0.1, this.animate); };
  private readonly touch: Q2Touch = (entity, game, contact) => this.pickup(entity, game, contact.other);
  private readonly dropTouch: Q2Touch = (entity, game, contact) => entity.owner === contact.other && game.host.now() < entity.timestamp + 2 ? undefined : this.pickup(entity, game, contact.other);
  private readonly returnDropped: Q2Think = (entity, game) => { const team = ctfFlagTeam(entity.classname); if (team !== null) { this.reset(game, team); ctfPrint(game, `The ${ctfTeamName(team)} flag has returned!\n`); } return undefined; };
  base(game: Q2GameServices, team: Q2CtfPlayingTeam): Q2Entity | null { return [...game.entities.values()].find(entity => entity.classname === CTF_FLAGS[team].classname && (entity.spawnflags & 0x30000) === 0) ?? null; }
  state(game: Q2GameServices, team: Q2CtfPlayingTeam): "base" | "dropped" | "taken" {
    if ([...game.entities.values()].some(entity => entity.classname === CTF_FLAGS[team].classname && (entity.spawnflags & 0x30000) !== 0)) return "dropped";
    return this.base(game, team)?.solid === "trigger" ? "base" : "taken";
  }
  reset(game: Q2GameServices, team: Q2CtfPlayingTeam): undefined {
    for (const entity of [...game.entities.values()]) if (entity.classname === CTF_FLAGS[team].classname) {
      if ((entity.spawnflags & 0x30000) !== 0) game.remove(entity);
      else { entity.visible = true; entity.serverFlags &= ~1; game.solid(entity, "trigger"); game.show(entity); game.host.emit({ kind: "entity-event", actor: entity.actor.id, event: 1 }); }
    }
    return undefined;
  }
  resetAll(game: Q2GameServices): undefined { this.reset(game, 1); return this.reset(game, 2); }
  private pickup(entity: Q2Entity, game: Q2GameServices, actor: ActorId): undefined {
    if (this.context.match.phase === "setup" || this.context.match.phase === "pregame") return undefined;
    const team = ctfFlagTeam(entity.classname), state = this.context.states.get(actor), player = game.entity(actor), common = this.context.hooks.player(actor);
    if (team === null || state === undefined || state.team === 0 || player === null || common === null || common.spectator || (game.host.combat.read(actor)?.health ?? 0) <= 0) return undefined;
    if (entity.solid !== "trigger") return undefined;
    const now = game.host.now(), enemy = otherCtfTeam(team), flag = CTF_FLAGS[team], dropped = (entity.spawnflags & 0x30000) !== 0;
    if (state.team === team) {
      if (dropped) { ctfScore(this.context, actor, 1); state.lastReturnedFlag = now; ctfPrint(game, `${ctfName(this.context, actor)} returned the ${ctfTeamName(team)} flag!\n`); this.flagSound(entity, game, "ctf/flagret.wav"); return this.reset(game, team); }
      if (game.host.inventory.count(actor, CTF_FLAGS[enemy].item) === 0) return this.targets(entity, game, actor);
      game.host.inventory.consume(player.actor, CTF_FLAGS[enemy].item, 1);
      const match = this.context.match; if (team === 1) match.team1++; else match.team2++; match.lastFlagCapture = now; match.lastCaptureTeam = team;
      ctfScore(this.context, actor, 15); const ghost = state.ghostCode === null ? undefined : match.ghosts.get(state.ghostCode); if (ghost !== undefined) ghost.captures++;
      ctfPrint(game, `${ctfName(this.context, actor)} captured the ${ctfTeamName(enemy)} flag!\n`); this.flagSound(entity, game, "ctf/flagcap.wav");
      for (const teammate of game.host.players()) {
        const member = this.context.states.get(teammate); if (member === undefined) continue;
        if (member.team !== team) { member.lastHurtCarrier = null; continue; }
        if (teammate !== actor) ctfScore(this.context, teammate, 10);
        // A missing event is not an assist during the first ten seconds of a map.
        if (member.lastReturnedFlag !== null && member.lastReturnedFlag + 10 > now) { ctfScore(this.context, teammate, 1); ctfPrint(game, `${ctfName(this.context, teammate)} gets an assist for returning the flag!\n`); }
        if (member.lastFraggedCarrier !== null && member.lastFraggedCarrier + 10 > now) { ctfScore(this.context, teammate, 2); ctfPrint(game, `${ctfName(this.context, teammate)} gets an assist for fragging the flag carrier!\n`); }
      }
      this.resetAll(game); return this.targets(entity, game, actor);
    }
    if (game.host.inventory.count(actor, flag.item) !== 0) return undefined;
    if (!game.host.inventory.entries(actor).some(entry => entry.item === flag.item)) game.host.inventory.configure(player.actor, { item: flag.item, count: 0, capacity: 1 });
    game.host.inventory.give(player.actor, flag.item, 1); state.flagSince = now;
    ctfPrint(game, `${ctfName(this.context, actor)} got the ${ctfTeamName(team)} flag!\n`);
    game.host.emit({ kind: "pickup", player: actor, item: flag.item, name: `${team === 1 ? "Red" : "Blue"} Flag`, icon: flag.icon }); game.sound(player, "ctf/flagtk.wav", 3);
    this.targets(entity, game, actor);
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (dropped) return game.remove(entity);
    entity.visible = false; entity.serverFlags |= 1; game.solid(entity, "none"); return game.show(entity);
  }
  private targets(entity: Q2Entity, game: Q2GameServices, actor: ActorId): undefined { if ((entity.spawnflags & 0x40000) === 0) { entity.spawnflags |= 0x40000; game.useTargets(entity, actor); } return undefined; }
  private flagSound(entity: Q2Entity, game: Q2GameServices, path: string): undefined { return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path, channel: 2, volume: 1, attenuation: 0, reliable: true, loop: "once" }); }
  drop(entity: Q2Entity, game: Q2GameServices): Q2Entity | null {
    const team = ctfCarriedFlag(game, entity.actor.id); if (team === null) return null;
    const flag = CTF_FLAGS[team], dropped = game.create(flag.classname), body = game.body(entity), forward = movedir(game.host.playerViewState(entity.actor.id)?.viewAngles ?? body.angles);
    dropped.model = flag.model; dropped.effects = flag.effect; dropped.renderFlags = 512; dropped.spawnflags = 0x10000; dropped.owner = entity.actor.id; dropped.timestamp = game.host.now(); dropped.touch = this.dropTouch;
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } }, origin = game.host.trace({ start: body.origin, end: add(add(body.origin, scale(forward, 24)), { x: 0, y: 0, z: -16 }), bounds, ignore: entity.actor.id, mask: 3 }).end;
    game.move(dropped, { origin, bounds, velocity: { ...scale(forward, 100), z: 300 } }); game.solid(dropped, "trigger"); game.motion(dropped, "toss"); game.show(dropped); game.schedule(dropped, 30, this.returnDropped);
    game.host.inventory.consume(entity.actor, flag.item, 1); ctfPrint(game, `${ctfName(this.context, entity.actor.id)} lost the ${ctfTeamName(team)} flag!\n`); return dropped;
  }
  hurtCarrier(target: ActorId, attacker: ActorId | null, game: Q2GameServices): undefined {
    const victim = this.context.states.get(target), aggressor = attacker === null ? undefined : this.context.states.get(attacker);
    if (victim !== undefined && aggressor !== undefined && victim.team !== 0 && aggressor.team !== 0 && victim.team !== aggressor.team && ctfCarriedFlag(game, target) === otherCtfTeam(victim.team)) aggressor.lastHurtCarrier = game.host.now();
    return undefined;
  }
  frag(victim: Q2Entity, attacker: Q2Entity | null, game: Q2GameServices): undefined {
    const target = this.context.states.get(victim.actor.id), source = attacker === null ? undefined : this.context.states.get(attacker.actor.id), ghosts = this.context.match.ghosts;
    const victimGhost = target?.ghostCode === null || target?.ghostCode === undefined ? undefined : ghosts.get(target.ghostCode); if (victimGhost !== undefined) victimGhost.deaths++;
    if (attacker === null || source === undefined || target === undefined || attacker === victim) return undefined;
    const ghost = source.ghostCode === null ? undefined : ghosts.get(source.ghostCode); if (ghost !== undefined) ghost.kills++;
    if (target.team === 0 || source.team === 0 || target.team === source.team) return undefined;
    const now = game.host.now();
    if (ctfCarriedFlag(game, victim.actor.id) === source.team) {
      source.lastFraggedCarrier = now; ctfScore(this.context, attacker.actor.id, 2);
      for (const member of this.context.states.values()) if (member.team === source.team) member.lastHurtCarrier = null;
      return ctfPrint(game, "BONUS: 2 points for fragging enemy flag carrier.\n", attacker.actor.id, "medium");
    }
    if (target.lastHurtCarrier !== null && now - target.lastHurtCarrier < 8 && ctfCarriedFlag(game, attacker.actor.id) === null) {
      ctfScore(this.context, attacker.actor.id, 2); if (ghost !== undefined) ghost.carrierDefense++; return ctfPrint(game, `${ctfName(this.context, attacker.actor.id)} defends ${ctfTeamName(source.team)}'s flag carrier against an aggressive enemy\n`, null, "medium");
    }
    const flag = this.base(game, source.team); if (flag === null) return undefined;
    const near = (object: Q2Entity): boolean => length(subtract(game.body(victim).origin, game.body(object).origin)) < 400 || length(subtract(game.body(attacker).origin, game.body(object).origin)) < 400 || ctfCanSee(object, victim, game) || ctfCanSee(object, attacker, game);
    if (near(flag)) { ctfScore(this.context, attacker.actor.id, 1); if (ghost !== undefined) ghost.baseDefense++; return ctfPrint(game, `${ctfName(this.context, attacker.actor.id)} defends the ${ctfTeamName(source.team)} ${flag.solid === "none" ? "base" : "flag"}.\n`, null, "medium"); }
    const carrier = game.host.players().find(actor => this.context.states.get(actor)?.team === source.team && ctfCarriedFlag(game, actor) === target.team), entity = carrier === undefined ? null : game.entity(carrier);
    if (entity !== null && entity !== attacker && near(entity)) { ctfScore(this.context, attacker.actor.id, 1); if (ghost !== undefined) ghost.carrierDefense++; ctfPrint(game, `${ctfName(this.context, attacker.actor.id)} defends ${ctfTeamName(source.team)}'s flag carrier.\n`, null, "medium"); }
    return undefined;
  }
  effects(entity: Q2Entity, game: Q2GameServices): undefined {
    const team = ctfCarriedFlag(game, entity.actor.id); entity.effects &= ~0xc0000;
    if (team !== null && (game.host.combat.read(entity.actor.id)?.health ?? 0) > 0) entity.effects |= CTF_FLAGS[team].effect;
    entity.model3 = team === null ? "" : CTF_FLAGS[team].model; return game.show(entity);
  }
}
