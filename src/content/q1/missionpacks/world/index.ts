/* Official mission pack world entities over the shared Q1 source runtime. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1SourceFinale } from "../../base/rules.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1MissionPack } from "../types.ts";
import { registerHipnoticTriggers } from "./hipnotic-triggers.ts";
import { registerHipnoticTrain } from "./hipnotic-train.ts";
import { registerHipnoticRotation } from "./hipnotic-rotate.ts";
import { registerHipnoticMisc, earthquakeAfterPhysics } from "./hipnotic-misc.ts";
import { registerHipnoticParticles } from "./hipnotic-particles.ts";
import { registerHipnoticSpawn } from "./hipnotic-spawn.ts";
import { registerHipnoticHazards } from "./hipnotic-hazards.ts";
import { RogueRunes } from "./rogue-runes.ts";
import { registerRogueMisc } from "./rogue-misc.ts";
import { registerRogueTime, crashTimeMachine } from "./rogue-time.ts";
import { registerRoguePendulum } from "./rogue-pendulum.ts";
import { registerRoguePlats } from "./rogue-plats.ts";
import { registerRogueHazards, rogueEarthquake } from "./rogue-hazards.ts";
import { RogueTeams } from "./rogue-teams.ts";
import { registerMissionShooters } from "./shooters.ts";
import { registerMissionCampaign } from "./campaign.ts";
import { registerRogueEnding, startRogueEnding } from "./rogue-ending.ts";
import { RogueTag } from "./rogue-tag.ts";

export interface MissionpackWorldHooks {
  readonly charmer?: () => ActorId | null;
  readonly charm?: (entity: Q1Actor, charmer: ActorId) => undefined;
  readonly becomeDecoy?: (target: string, origin: Vec3) => Q1Actor;
  readonly presentFinale?: (result: Q1SourceFinale) => undefined;
  readonly gamecfg?: () => number;
  readonly teamColor?: (actor: ActorId) => number;
  readonly setTeamColor?: (actor: ActorId, team: number) => undefined;
  readonly addFrags?: (actor: ActorId, delta: number) => undefined;
  readonly frags?: (actor: ActorId) => number;
  readonly disconnect?: (actor: ActorId) => undefined;
  readonly playerFrame?: (actor: ActorId) => number;
  readonly playerName?: (actor: ActorId) => string;
}
export class Q1MissionpackWorld {
  private readonly runes: RogueRunes | null;
  private readonly teams: RogueTeams | null;
  private readonly tag: RogueTag | null;
  constructor(readonly game: Q1EntityServices, readonly pack: Q1MissionPack, readonly hooks: MissionpackWorldHooks = {}) {
    registerMissionShooters(game, pack);
    registerMissionCampaign(game, pack, hooks);
    if (pack === "hipnotic") {
      registerHipnoticTriggers(game); registerHipnoticTrain(game); registerHipnoticRotation(game); registerHipnoticMisc(game); registerHipnoticParticles(game); registerHipnoticSpawn(game, hooks); registerHipnoticHazards(game); this.runes = null; this.teams = null; this.tag = null;
    } else { registerRogueMisc(game); registerRogueTime(game); registerRogueEnding(game); registerRoguePendulum(game); registerRoguePlats(game); registerRogueHazards(game); this.runes = new RogueRunes(game, hooks.gamecfg ?? (() => 0)); this.teams = new RogueTeams(game, hooks); this.tag = new RogueTag(game, hooks); }
  }
  afterPhysics(actor: ActorId, _seconds: number): undefined { if (this.pack === "hipnotic") return earthquakeAfterPhysics(this.game, actor); if (this.game.world?.number("rogue:earthquake_active") === 1) rogueEarthquake(this.game, actor, this.game.world.number("rogue:earthquake_intensity")); this.teams?.frame(actor); this.runes?.frame(actor); return startRogueEnding(this.game, actor, this.hooks); }
  playerSpawned(actor: ActorId): undefined { return this.teams?.playerSpawned(actor); }
  dropCarriedFlag(actor: ActorId): undefined { return this.teams?.dropCarriedFlag(actor); }
  impulse(actor: ActorId, impulse: number): boolean { return this.teams?.impulse(actor, impulse) ?? false; }
  savedTeam(actor: ActorId): number { return this.teams?.team(actor) ?? 0; }
  selectSpawn(actor: ActorId): Q1Actor | undefined { return this.teams?.selectSpawn(actor); }
  tagScore(victim: ActorId, attacker: ActorId): number { return this.tag?.score(victim, attacker) ?? 1; }
  confirmedDamage(target: ActorId, attacker: ActorId | null): undefined { return this.teams?.confirmedDamage(target, attacker); }
  playerDied(actor: ActorId, attacker: ActorId | null = null): undefined { this.teams?.playerDied(actor, attacker); return this.runes?.drop(actor); }
  runeAttackDelay(actor: ActorId, delay: number): number { return this.runes?.attackDelay(actor, delay) ?? delay; }
  runeAttackSound(actor: ActorId): undefined { return this.runes?.attackSound(actor); }
  runeDamage(actor: ActorId, amount: number): number { return this.runes?.damage(actor, amount) ?? amount; }
  runeResistance(actor: ActorId, amount: number): number { return this.runes?.resistance(actor, amount) ?? amount; }
  hasRegenerationRune(actor: ActorId): boolean { return this.runes?.hasRegeneration(actor) ?? false; }
  crashTimeMachine(): undefined { return crashTimeMachine(this.game); }
}
export function registerMissionpackWorld(game: Q1EntityServices, pack: Q1MissionPack, hooks: MissionpackWorldHooks = {}): Q1MissionpackWorld { return new Q1MissionpackWorld(game, pack, hooks); }
