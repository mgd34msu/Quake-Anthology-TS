import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { DamageDecision, ItemId } from "../../../contracts/gameplay.ts";
import { Q1Foundation } from "../../q1/foundation/runtime.ts";
import type { Q1Actor } from "../../q1/foundation/entity.ts";
import { WEAPONS } from "../../q1/foundation/types.ts";
import type { Q1FoundationHost, Q1FoundationOptions } from "../../q1/foundation/types.ts";
import { registerQ1Base, q1ClientNotice, q1Obituary, newQ1Travel, captureQ1Travel, decodeQ1Travel, admitQ1Travel, dropBackpack } from "../../q1/base/index.ts";
import type { Q1Base, Q1ObituaryActor, Q1TravelState, Q1IntermissionResult } from "../../q1/base/index.ts";
import type { Q1CharacterPresentation, Q1CharacterSourcePose } from "../../q1/base/player.ts";
import { registerQ1MissionPack } from "../../q1/missionpacks/runtime.ts";
import type { Q1MissionPackRuntime } from "../../q1/missionpacks/runtime.ts";
import { Q1AddonContext, registerQ1CampaignAddons, registerCTF, registerQ1Horde, handleQ1AddonImpulse, frameQ1AddonPlayer } from "../../q1/addons/index.ts";
import type { Q1Ctf, Q1Horde } from "../../q1/addons/index.ts";
import type { Q1CtfServices } from "../../q1/addons/ctf/types.ts";
import { newQ1CtfTravel, captureQ1CtfTravel, decodeQ1CtfTravel } from "../../q1/addons/ctf/travel.ts";
import { newQ1AddonTravel, captureQ1AddonTravel, decodeQ1AddonTravel, admitQ1AddonTravel } from "../../q1/addons/travel.ts";
import { mg3HammerBodyFrame, handleMg3ItemImpulse } from "../../q1/addons/items/index.ts";
import { Q1SourceClients } from "./clients.ts";
import { baseQ1Impulse, q1WeaponImpulse } from "./commands.ts";
import type { Q1Map } from "../../../formats/q1-map/index.ts";
import type { Q1ClientAdmission, Q1CompositionServices, Q1SourceInput, Q1SourceSelection } from "./types.ts";

/** Registers one official source program on the session's existing world and actors. */
export class Q1SourceComposition {
  readonly base: Q1Base;
  readonly clients: Q1SourceClients;
  readonly packs: Q1MissionPackRuntime | null;
  readonly addon: Q1AddonContext | null;
  readonly ctf: Q1Ctf | null;
  readonly horde: Q1Horde | null;
  constructor(readonly game: Q1Foundation, readonly selection: Q1SourceSelection, readonly services: Q1CompositionServices) {
    this.clients = new Q1SourceClients(game, selection.program, services);
    if (game.options.edition === "rerelease" && (selection.program === "id1" || selection.program === "hipnotic" || selection.program === "rogue")) {
      game.registerDamageSourceEffects("q1:coop-bots", { beforeQuad: (request, amount) => {
        const attacker = request.attack.attacker;
        if (game.options.coop && attacker !== null && !sameActor(request.target, attacker) && this.clients.get(request.target) !== null && this.clients.get(attacker) !== null
          && services.selectedPlayer(attacker).isBot && !services.selectedPlayer(request.target).isBot) return { kind: "cancel" };
        return { kind: "continue", amount };
      } });
    }
    if (selection.program === "rogue") game.setBaseTeamHealth(false);
    this.base = registerQ1Base(game, { campaign: { readFlags: () => selection.campaign.readFlags(), writeFlags: flags => selection.campaign.writeFlags(flags),
      setSkill: skill => { selection.campaign.setSkill(skill); return services.setCvar("skill", String(skill)); } }, registered: selection.registered, officialCampaign: selection.officialCampaign,
      sameLevel: () => services.cvar("samelevel") !== 0, playerExited: actor => this.notice(actor, "exit"), finishCampaign: () => services.finishCampaign() });
    const addonServices = { emit: (event: import("../../q1/addons/context.ts").Q1AddonEvent) => services.emit({ kind: "addon", event }),
      isMonster: (actor: ActorId) => this.isMonster(actor), cvar: (name: string) => services.cvar(name), setCvar: (name: string, value: string) => services.setCvar(name, value) };
    if (selection.program === "hipnotic" || selection.program === "rogue") {
      this.packs = registerQ1MissionPack(game, this.base, selection.program, {
        gamecfg: () => services.cvar("gamecfg"), teamColor: actor => this.clients.teamColor(actor),
        setTeamColor: (actor, color) => this.clients.colors(actor, color - 1, color - 1),
        addFrags: (actor, delta) => this.clients.addScore(actor, delta), frags: actor => this.clients.require(actor).frags,
        disconnect: actor => this.disconnect(actor), playerFrame: actor => services.selectedPlayer(actor).frame, playerName: actor => this.clients.require(actor).name,
        cheatsAllowed: () => services.cvar("sv_cheats") !== 0, developerMessage: text => services.emit({ kind: "developer-message", text }), footsteps: () => services.cvar("footsteps") === 1,
      });
      this.addon = null; this.ctf = null; this.horde = null;
    } else if (selection.program === "ctf") {
      this.packs = null; this.addon = new Q1AddonContext(this.base, "ctf", addonServices);
      this.ctf = registerCTF(this.addon, this.ctfServices(), services.sharedGrapple ?? null); this.horde = null;
    } else if (selection.program === "dopa" || selection.program === "mg1" || selection.program === "mg3") {
      this.packs = null; this.addon = registerQ1CampaignAddons(this.base, selection.program, addonServices); this.ctf = null;
      this.horde = selection.program === "mg1" || selection.program === "dopa" ? registerQ1Horde(this.addon, {
        deadFlag: actor => services.selectedPlayer(actor).deadFlag, noTarget: actor => this.noTarget(actor),
        isBot: actor => services.selectedPlayer(actor).isBot, addScore: (actor, delta) => this.clients.addScore(actor, delta),
        respawnTeammate: actor => this.respawnAt(actor, null, this.newTravel()), restartSession: (map, flags) => services.restartSession(map, flags),
      }) : null;
    } else { this.packs = null; this.addon = null; this.ctf = null; this.horde = null; }
    if (this.addon?.program === "mg3") {
      const addon = this.addon;
      game.registerDamageSourceEffects("q1:mg3:buddha", { lethalHealth: (request, health) => addon.playerNumber(request.target, "buddha") !== 0
        ? { health: 1, reaction: "none" } : { health, reaction: "death" } });
    }
    game.registerStateExtension({ id: "q1:source-clients", capture: () => this.clients.capture(), restore: bytes => this.clients.restore(bytes) });
  }
  spawnMap(map: Q1Map) {
    const name = map.source.replace(/^.*[/\\]/u, "").replace(/\.bsp$/u, "");
    this.services.setCvar("sv_gravity", name === "e1m8" ? "100" : "800"); return this.game.spawnMap(map);
  }
  private ctfServices(): Q1CtfServices {
    const { game, clients, services } = this;
    return {
      name: actor => clients.require(actor).name, score: actor => clients.require(actor).frags, addScore: (actor, delta) => clients.addScore(actor, delta), isBot: actor => services.selectedPlayer(actor).isBot,
      captures: team => team === "red" ? clients.redCaptures : clients.blueCaptures,
      addCapture: team => { const total = team === "red" ? ++clients.redCaptures : ++clients.blueCaptures; return services.emit({ kind: "ctf-capture", team, total }); },
      input: actor => {
        const client = clients.require(actor), player = game.player(actor), selected = services.selectedPlayer(actor);
        return { attack: player?.attackHeld ?? false, jump: player?.jumpHeld ?? false, impulse: client.impulse,
          grappleSelected: services.selectedWeapon(actor) === "q1:ctf/weapon/grapple", viewAngles: selected.viewAngles, teleportUntil: selected.teleportUntil, frame: selected.frame };
      },
      consumeImpulse: actor => { clients.require(actor).impulse = 0; return undefined; },
      observer: actor => clients.require(actor).observer, setObserver: (actor, enabled) => clients.setObserver(actor, enabled),
      respawn: (actor, spot) => this.respawnAt(actor, spot, this.newTravel()), disconnect: actor => this.disconnect(actor),
      colors: (actor, shirt, pants) => clients.colors(actor, shirt, pants), promptSupported: actor => services.promptSupported(actor),
      prompt: (actor, title, choices) => services.emit({ kind: "prompt", actor, title, choices }), clearPrompt: actor => services.emit({ kind: "clear-prompt", actor }),
      teleport: (actor, origin, angles, velocity, until) => services.teleport(actor, origin, angles, velocity, until),
      selectGrapple: actor => { services.selectWeapon(actor, "q1:ctf/weapon/grapple"); return undefined; },
      selectedWeapon: actor => services.selectedWeapon(actor), selectedAmmo: actor => services.selectedAmmo(actor),
      weaponChanged: (actor, acquired) => services.weaponChanged(actor, acquired), haste: actor => services.weaponChanged(actor, null),
      status: (actor, status) => services.emit({ kind: "ctf-status", actor, status }), log: (actor, action) => services.emit({ kind: "source-log", actor, action }),
    };
  }
  private isMonster(actor: ActorId): boolean { const entity = this.game.entity(actor); return entity !== null && (entity.movementFlags & 32) !== 0; }
  attach(actor: OwnedActor, admission: Q1ClientAdmission): undefined {
    this.clients.attach(actor, admission); this.notice(actor.id, "connect");
    const result = this.base.levelRules.clientConnected(this.game.time, this.services.cvar("samelevel") !== 0); this.presentIntermission(result); return undefined;
  }
  /** The outer session has already initialized the selected character, source arsenal and travel. */
  spawned(actor: ActorId, firstAdmission: boolean): undefined {
    const client = this.clients.require(actor); client.deathRecorded = false; client.impulse = 0; client.use = false; client.respawnRequestedAt = -1;
    if (!firstAdmission) { this.base.levelRules.resetPlayer(client.actor); this.horde?.restoreKeys(actor); }
    this.clients.spawned(actor); this.packs?.playerSpawned(actor); this.ctf?.spawnPlayer(actor, firstAdmission); return undefined;
  }
  userinfo(actor: ActorId, values: ReadonlyMap<string, string>): undefined { return this.clients.update(actor, values); }
  noTarget(actor: ActorId): boolean { return this.clients.get(actor)?.noTarget ?? false; }
  setNoTarget(actor: ActorId, enabled: boolean): undefined { const client = this.clients.require(actor); client.noTarget = enabled; return this.clients.publish(client); }
  input(actor: ActorId, input: Q1SourceInput): undefined {
    const client = this.clients.require(actor), selected = this.services.selectedPlayer(actor); if (input.impulse !== 0) client.impulse = input.impulse; client.use = input.use;
    return this.game.playerInput(client.actor, { attack: input.attack, jump: input.jump, teleportUntil: selected.teleportUntil });
  }
  /** Called once after game.beginFrame and before source player prethink. */
  preFrame(elapsedSeconds: number): undefined {
    this.addon?.frame(elapsedSeconds);
    if (this.game.options.deathmatch !== 0) this.base.levelRules.checkLimits(this.game.time, [...this.clients.records.values()].map(client => client.frags), this.services.cvar("timelimit"), this.services.cvar("fraglimit"));
    return undefined;
  }
  /** Before game.playerFrame: source observer/team/rune prethink precedes environment and movement. */
  playerPreThink(actor: ActorId): undefined { this.ctf?.playerFrame(actor); return undefined; }
  /** After selected movement and game.playerAfterPhysics, which already invokes pack and horde extensions. */
  playerPostThink(actor: ActorId): undefined { this.ctf?.afterPhysics(actor); if (this.addon !== null) frameQ1AddonPlayer(this.addon, actor, this.services.selectedPlayer(actor).viewOffset); return undefined; }
  /** Returns true only when this selected source program consumed its impulse. */
  impulse(actor: ActorId): boolean {
    const client = this.clients.require(actor), player = this.game.player(actor);
    const weapons = this.services.weaponServices === undefined ? this.game : this.services.weaponServices(actor), weaponPlayer = weapons?.player(actor) ?? null;
    if (client.impulse === 0 || weaponPlayer !== null && weapons !== null && weapons.time < weaponPlayer.attackFinished) return false;
    if (this.ctf?.impulse(actor)) return true;
    if (this.packs?.impulse(actor, client.impulse)) { client.impulse = 0; return true; }
    if (this.addon !== null && handleMg3ItemImpulse(this.addon, actor, client.impulse, text => this.services.emit({ kind: "developer-message", text }))) { client.impulse = 0; return true; }
    if (this.addon !== null && handleQ1AddonImpulse(this.addon, actor, client.impulse)) { client.impulse = 0; return true; }
    if (weapons !== null && weaponPlayer !== null && q1WeaponImpulse(weapons, weaponPlayer, client.impulse)) { client.impulse = 0; return true; }
    if (player === null || weapons === null) return false;
    if (baseQ1Impulse(this, player, client.impulse)) { client.impulse = 0; return true; }
    client.impulse = 0; return true;
  }
  /** Invoke only after an accepted shot, including a foreign arsenal using source campaign rules. */
  fired(actor: ActorId, weapon: ItemId | null): undefined {
    const client = this.clients.get(actor); if (client === null) return undefined;
    return this.base.levelRules.noteAttack(client.actor, weapon === "q1:weapon/axe");
  }
  /** Runs inside GameplayAuthority.beforeReaction, before character death callbacks and item drops. */
  beforeReaction(actor: OwnedActor, decision: DamageDecision): undefined {
    const client = this.clients.get(actor.id);
    if (decision.reaction === "death" && (client !== null || this.game.entity(actor.id) !== null) && this.game.health(actor.id) < -99) this.game.host.combat.setHealth(actor, -99);
    if (client === null) {
      const entity = this.game.entity(actor.id), attacker = decision.request.attack.attacker;
      if (decision.reaction !== "death" || entity === null || entity.movement === "none" || entity.movement === "push") return undefined;
      if (this.game.options.edition === "rerelease" && this.isMonster(actor.id) && attacker !== null && this.clients.get(attacker) !== null && entity.text("horde.sourceDie") === "") this.clients.addScore(attacker, 1);
      // ClientObituary consumes its source rnum even when the victim is not a player.
      this.game.host.random(); return undefined;
    }
    this.base.levelRules.noteDamage(actor, decision.appliedDamage);
    if (decision.appliedDamage > 0) this.packs?.confirmedDamage(actor.id, decision.request.attack.attacker);
    if (decision.reaction !== "death" || client.deathRecorded) return undefined;
    client.deathRecorded = true; const attacker = decision.request.attack.attacker, sourceAttacker = attacker === null ? null : this.game.entity(attacker);
    const obituaryInput: Parameters<typeof q1Obituary>[0] = { edition: this.game.options.edition, victim: this.obituaryActor(actor.id), attacker: attacker === null ? null : this.obituaryActor(attacker),
      telefragOwner: sourceAttacker?.owner == null ? null : this.obituaryActor(sourceAttacker.owner), teamplay: this.services.cvar("teamplay"),
      deathType: decision.request.attack.cause.kind === "q1" ? decision.request.attack.cause.deathType : decision.request.attack.cause.kind === "environment" && decision.request.attack.cause.hazard === "fall" ? "falling" : "",
      random: () => this.game.host.random() };
    const obituary = this.packs?.obituary(obituaryInput, decision.request.attack.inflictor) ?? q1Obituary(obituaryInput);
    if (obituary.message !== null) this.broadcast(obituary.message.text, obituary.message.arguments);
    if (this.ctf !== null) this.ctf.death(actor.id, attacker);
    else {
      if (obituary.score !== null && this.clients.get(obituary.score.actor) !== null) this.clients.addScore(obituary.score.actor, obituary.score.delta);
      if (attacker !== null && this.clients.get(attacker) !== null) this.horde?.teammateKilled(attacker);
    }
    if (obituary.achievement !== null) this.game.host.emit({ kind: "achievement", player: obituary.achievement.actor, id: obituary.achievement.id });
    return this.packs?.playerDied(actor.id, attacker);
  }
  private obituaryActor(actor: ActorId): Q1ObituaryActor {
    const entity = this.game.entity(actor), client = this.clients.get(actor), player = this.game.player(actor), selected = client === null ? null : this.services.selectedPlayer(actor);
    const powers = player?.powerups;
    return { actor, name: client?.name ?? entity?.text("netname") ?? "", classname: client === null ? this.game.host.classname(actor) : "player", isPlayer: client !== null, isMonster: this.isMonster(actor),
      team: client === null ? entity?.number("team") ?? 0 : client.team, health: this.game.health(actor), waterType: selected?.waterType ?? "empty", waterLevel: selected?.waterLevel ?? entity?.waterLevel ?? 0,
      weapon: player?.weapon ?? null, quadExpires: Math.max(0, (powers?.get("quad") ?? 0) - this.game.time), invulnerableExpires: Math.max(0, (powers?.get("invulnerability") ?? 0) - this.game.time),
      brush: entity?.solid === "bsp", killString: entity?.text("kill_string") ?? "" };
  }
  private broadcast(text: string, args: readonly string[]): undefined { for (const actor of this.game.host.players()) this.game.message(actor, text, false, args); return undefined; }
  private notice(actor: ActorId, event: "connect" | "disconnect" | "suicide" | "exit"): undefined {
    const client = this.clients.require(actor), notice = q1ClientNotice(this.game.options.edition, event, client.name, client.frags);
    this.broadcast(notice.text, notice.arguments); if (notice.scoreDelta !== 0) this.clients.addScore(actor, notice.scoreDelta); return undefined;
  }
  disconnect(actor: ActorId): undefined {
    const client = this.clients.require(actor); this.ctf?.disconnectPlayer(actor); this.packs?.playerDied(actor, null); this.notice(actor, "disconnect");
    this.services.emit({ kind: "client-left", actor, slot: client.slot }); return this.services.disconnect(actor);
  }
  requestRespawn(actor: ActorId, coopEntry: Q1TravelState | null = null): undefined {
    if (this.horde?.requestRespawn()) return undefined;
    if (!this.game.options.coop && this.game.options.deathmatch === 0) return this.services.restartSession(this.game.mapName, this.selection.campaign.readFlags());
    return this.respawnAt(actor, null, this.game.options.coop && coopEntry !== null ? coopEntry : this.newTravel());
  }
  private respawnAt(actor: ActorId, sourceSpot: Q1Actor | null, travel: Q1TravelState): undefined {
    const client = this.clients.require(actor); if (client.respawnRequestedAt < 0) client.respawnRequestedAt = this.game.time;
    const spot = sourceSpot ?? this.selectSpawn(actor, this.game.time >= client.respawnRequestedAt + 5);
    if (spot === null) return undefined;
    this.services.placePlayer(client.actor, spot, travel); return this.spawned(actor, false);
  }
  selectSpawn(actor: ActorId | null = null, force = false): Q1Actor | null {
    if (actor !== null && this.ctf !== null) return this.ctf.selectSpawn(actor);
    if (actor !== null) { const point = this.packs?.selectSpawn(actor); if (point !== undefined) return point; }
    return this.base.spawnSelector.select(force);
  }
  newTravel(): Q1TravelState { return this.ctf !== null ? newQ1CtfTravel(this.ctf) : this.packs?.newTravel() ?? (this.addon !== null ? newQ1AddonTravel(this.addon) : newQ1Travel(this.game.options)); }
  captureTravel(actor: OwnedActor): Q1TravelState { return this.ctf !== null ? captureQ1CtfTravel(this.ctf, actor) : this.packs?.captureTravel(actor) ?? (this.addon !== null ? captureQ1AddonTravel(this.addon, actor) : captureQ1Travel(this.game, actor, WEAPONS.find(weapon => this.game.weaponItem(weapon) === this.services.selectedWeapon(actor.id)) ?? this.game.player(actor.id)?.weapon)); }
  decodeTravel(state: Q1TravelState): Q1TravelState {
    return this.ctf !== null ? decodeQ1CtfTravel(this.ctf, state) : this.packs?.decodeTravel(state, this.selection.campaign.readFlags()) ?? (this.addon !== null ? decodeQ1AddonTravel(this.addon, state) : decodeQ1Travel(this.game, state, this.selection.campaign.readFlags()));
  }
  admitTravel(actor: OwnedActor, state: Q1TravelState): undefined {
    if (this.packs !== null) return this.packs.admitTravel(actor, this.packs.decodeTravel(state, this.selection.campaign.readFlags()));
    return this.addon !== null && this.ctf === null ? admitQ1AddonTravel(this.addon, actor, state) : admitQ1Travel(this.game, actor, this.decodeTravel(state));
  }
  /** The selected inventory calls this for a Q1 source death drop exactly once. */
  dropInventory(actor: OwnedActor): Q1Actor | null {
    if (!this.game.options.coop && this.game.options.deathmatch === 0) return null;
    if (this.packs !== null) return this.packs.dropBackpack(actor);
    const body = this.game.host.bodies.read(actor.id); if (body === null) throw new Error("Q1 death drop has no shared body");
    return dropBackpack(this.game, body.origin, { weapon: WEAPONS.find(weapon => this.game.weaponItem(weapon) === this.services.selectedWeapon(actor.id)) ?? this.game.player(actor.id)?.weapon ?? null, shells: this.game.host.inventory.count(actor.id, "q1:ammo/shells"),
      nails: this.game.host.inventory.count(actor.id, "q1:ammo/nails"), rockets: this.game.host.inventory.count(actor.id, "q1:ammo/rockets"), cells: this.game.host.inventory.count(actor.id, "q1:ammo/cells") });
  }
  requestIntermissionExit(pressed: boolean): Q1IntermissionResult {
    const result = this.base.levelRules.requestExit(this.game.time, pressed, this.services.cvar("samelevel") !== 0); this.presentIntermission(result); return result;
  }
  private presentIntermission(result: Q1IntermissionResult): undefined {
    return result.kind === "finale" || result.kind === "sell-screen" ? this.services.emit({ kind: "level-presentation", event: result }) : undefined;
  }
  dismissFinale(): undefined { return this.base.dismissFinale(); }
  characterPose(actor: ActorId): Q1CharacterSourcePose {
    if (this.ctf !== null) return this.ctf.characterPose(actor);
    const player = this.game.player(actor);
    if (this.addon?.program === "mg3" && player !== null) return { frame: mg3HammerBodyFrame(this.addon, player) };
    return this.packs?.characterPose(actor) ?? { frame: null };
  }
  fallDamageAllowed(actor: ActorId): boolean { return this.ctf?.fallDamageAllowed(actor) ?? true; }
  characterFrame(actor: ActorId, presentation: Q1CharacterPresentation): undefined { return this.packs?.characterFrame(actor, presentation); }
  suicide(actor: ActorId): undefined {
    if (this.ctf !== null) return this.ctf.suicide(actor);
    this.notice(actor, "suicide"); return this.requestRespawn(actor);
  }
}

export function createQ1SourceComposition(host: Q1FoundationHost, options: Omit<Q1FoundationOptions, "precacheProgram">, selection: Q1SourceSelection, services: Q1CompositionServices): Q1SourceComposition {
  const precacheProfile: Pick<Q1FoundationOptions, "precacheProgram"> = selection.program === "id1" ? { precacheProgram: "id1" } : {};
  return new Q1SourceComposition(new Q1Foundation(host, { ...options, ...precacheProfile,
    get skill() { const value = services.cvar("skill"); return value >= 3 ? 3 : value >= 2 ? 2 : value >= 1 ? 1 : 0; },
    get teamplay() { return services.cvar("teamplay"); }, get gravity() { return services.cvar("sv_gravity"); } }), selection, services);
}
