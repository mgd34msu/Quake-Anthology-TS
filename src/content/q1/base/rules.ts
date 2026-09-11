/* client.qc source spawn, match and intermission rules. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1Weapon } from "../foundation/types.ts";
import { POINT, length, vadd, vscale, vsub } from "../foundation/types.ts";
import type { Q1CampaignBinding } from "./provider.ts";
import { classicMonsterObituaries, classicObituaryText } from "./messages.ts";
import { q1FinaleText } from "./finales.ts";
import type { SaveReader } from "../../../persistence/value.ts";

export class Q1SpawnSelector {
  private lastSpawn: Q1Actor | null = null;
  constructor(readonly game: Q1Foundation, readonly campaign: Q1CampaignBinding) {}
  capture() { return this.lastSpawn === null ? null : { slot: this.lastSpawn.actor.id.slot, generation: this.lastSpawn.actor.id.generation }; }
  restore(reader: SaveReader): undefined { this.lastSpawn = reader.nullable(value => { const actor = this.game.host.actors.resolveSaved({ slot: value.field("slot").integer(0), generation: value.field("generation").integer(0) }); if (actor === null) return value.fail("missing spawn point"); return this.game.entity(actor.id); }); return undefined; }
  private nearby(point: Q1Actor, radius: number, living: boolean): boolean {
    for (const player of this.game.host.players()) {
      if (living && this.game.health(player) <= 0) continue;
      const body = this.game.host.bodies.read(player); if (body === null) continue;
      const center = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5));
      if (length(vsub(center, this.game.body(point).origin)) <= radius) return true;
    }
    return false;
  }
  private visible(point: Q1Actor): boolean {
    for (const player of this.game.host.players()) {
      if (this.game.health(player) <= 0) continue;
      const body = this.game.host.bodies.read(player); if (body === null) continue;
      const trace = this.game.host.trace({ start: vadd(this.game.body(point).origin, { x: 0, y: 0, z: 22 }), end: vadd(body.origin, { x: 0, y: 0, z: 22 }), bounds: POINT, ignore: point.actor.id, monsters: false });
      if (trace.fraction >= 1) return true;
    }
    return false;
  }
  /** Rerelease may defer an occupied spawn. The caller retries and forces it after five seconds. */
  select(forceSpawn = false): Q1Actor | null {
    const { game } = this, entities = [...game.entities.values()];
    const region = entities.find(entity => entity.classname === "testplayerstart"); if (region !== undefined) return region;
    if (game.options.coop) {
      const after = this.lastSpawn === null ? -1 : entities.indexOf(this.lastSpawn);
      const point = entities.slice(after + 1).find(entity => entity.classname === "info_player_coop") ?? entities.find(entity => entity.classname === "info_player_start");
      if (point !== undefined) { this.lastSpawn = point; return point; }
    } else if (game.options.deathmatch !== 0) {
      const points = entities.filter(entity => entity.classname === "info_player_deathmatch");
      if (points.length === 0) throw new Error("No info_player_deathmatch on level");
      if (game.options.edition === "classic") {
        const start = this.lastSpawn === null ? -1 : points.indexOf(this.lastSpawn);
        for (let i = 1; i <= points.length; i++) {
          const point = points[(start + i) % points.length]; if (point === undefined) continue;
          if (point === this.lastSpawn || !this.nearby(point, 32, false)) { this.lastSpawn = point; return point; }
        }
        return forceSpawn ? points[0] ?? null : null;
      }
      let available = points.filter(point => !this.nearby(point, 384, true) && !this.visible(point)).reverse();
      if (available.length === 0) available = points.filter(point => !this.nearby(point, 84, true)).reverse();
      if (available.length === 0) {
        if (!forceSpawn) return null;
        return points[Math.floor(game.host.random() * (points.length - 1) + 0.5)] ?? null;
      }
      return available[Math.floor(game.host.random() * (available.length - 1) + 0.5)] ?? null;
    }
    if (this.campaign.readFlags() !== 0) { const returned = entities.find(entity => entity.classname === "info_player_start2"); if (returned !== undefined) return returned; }
    const start = entities.find(entity => entity.classname === "info_player_start"); if (start === undefined) throw new Error("PutClientInServer: no info_player_start on level"); return start;
  }
}

export interface Q1ObituaryActor {
  readonly actor: ActorId;
  readonly name: string;
  readonly classname: string;
  readonly isPlayer: boolean;
  readonly isMonster: boolean;
  readonly team: number;
  readonly health: number;
  readonly waterType: "empty" | "water" | "slime" | "lava";
  readonly waterLevel: number;
  readonly weapon: Q1Weapon | null;
  readonly quadExpires: number;
  readonly invulnerableExpires: number;
  readonly brush: boolean;
  readonly killString: string;
}
export interface Q1Obituary {
  readonly message: { readonly text: string; readonly arguments: readonly string[] } | null;
  readonly score: { readonly actor: ActorId; readonly delta: number } | null;
  readonly achievement: { readonly actor: ActorId; readonly id: string } | null;
}
/** The selected score authority commits this decision once for an accepted death. */
export function q1Obituary(input: { readonly edition: "classic" | "rerelease"; readonly victim: Q1ObituaryActor; readonly attacker: Q1ObituaryActor | null; readonly telefragOwner: Q1ObituaryActor | null; readonly teamplay: number; readonly deathType: string; readonly random: () => number }): Q1Obituary {
  const { victim, attacker, random } = input; const roll = random();
  if (!victim.isPlayer) return { message: null, score: null, achievement: null };
  const result = (text: string, credited: ActorId, delta: number, args: readonly string[] = [victim.name], achievement: Q1Obituary["achievement"] = null): Q1Obituary => ({ message: text === "" ? null : input.edition === "classic" ? { text: classicObituaryText(text, args), arguments: [] } : { text, arguments: args }, score: { actor: credited, delta }, achievement });
  if (attacker?.classname === "teledeath" && input.telefragOwner !== null) return result("$qc_telefragged", input.telefragOwner.actor, 1, [victim.name, input.telefragOwner.name]);
  if (attacker?.classname === "teledeath2") return result("$qc_satans_power", victim.actor, -1);
  if (attacker?.isPlayer) {
    if (sameActor(victim.actor, attacker.actor)) {
      if (victim.weapon === "lightning" && victim.waterLevel > 1) return result(victim.waterType === "slime" ? "$qc_discharge_slime" : victim.waterType === "lava" ? "$qc_discharge_lava" : "$qc_discharge_water", victim.actor, -1);
      return result(victim.weapon === "grenadelauncher" ? "$qc_suicide_pin" : roll !== 0 ? "$qc_suicide_bored" : "$qc_suicide_loaded", victim.actor, -1);
    }
    if (input.teamplay === 2 && victim.team === attacker.team && (input.edition === "classic" ? victim.team > 0 : attacker.team !== 0)) return result(roll < 0.25 ? "$qc_ff_teammate" : roll < 0.5 ? "$qc_ff_glasses" : roll < 0.75 ? "$qc_ff_otherteam" : "$qc_ff_friend", attacker.actor, -1, [attacker.name]);
    const message = (text: string, achievement: Q1Obituary["achievement"] = null): Q1Obituary => result(text, attacker.actor, 1, [victim.name, attacker.name], achievement);
    switch (attacker.weapon) {
      case "axe": return message("$qc_death_ax");
      case "shotgun": return message("$qc_death_sg");
      case "supershotgun": return message("$qc_death_dbl");
      case "nailgun": return message("$qc_death_nail");
      case "supernailgun": return message("$qc_death_sng");
      case "grenadelauncher": return message(victim.health < -40 ? "$qc_death_gl1" : "$qc_death_gl2");
      case "rocketlauncher": {
        if (input.edition === "rerelease" && attacker.quadExpires > 0 && victim.health < -40) { const r = random(); return message(r < 0.3 ? "$qc_death_rl_quad1" : r < 0.6 ? "$qc_death_rl_quad2" : "$qc_death_rl1"); }
        return message(victim.health < -40 ? "$qc_death_rl2" : "$qc_death_rl3");
      }
      case "lightning": return message(attacker.waterLevel > 1 ? "$qc_death_lg1" : "$qc_death_lg2", input.edition === "rerelease" && attacker.waterLevel > 1 && attacker.invulnerableExpires !== 0 ? { actor: attacker.actor, id: "ACH_SURVIVE_DISCHARGE" } : null);
      case null: return message(attacker.killString);
    }
  }
  if (input.edition === "classic" && attacker !== null) {
    if (attacker.isMonster) return result(victim.name + (classicMonsterObituaries.get(attacker.classname) ?? ""), victim.actor, -1);
    const trap = attacker.classname === "explo_box" || attacker.classname === "misc_explobox" || attacker.classname === "misc_explobox2" ? " blew up\n" : attacker.brush && attacker.classname !== "worldspawn" ? " was squished\n" : attacker.classname === "trap_shooter" || attacker.classname === "trap_spikeshooter" ? " was spiked\n" : attacker.classname === "fireball" || attacker.classname === "misc_fireball" ? " ate a lavaball\n" : attacker.classname === "trigger_changelevel" ? " tried to leave\n" : null;
    if (trap !== null) return result(victim.name + trap, victim.actor, -1);
  }
  if (victim.waterType === "water") return result(random() < 0.5 ? "$qc_death_drown1" : "$qc_death_drown2", victim.actor, -1);
  if (victim.waterType === "slime") return result(random() < 0.5 ? "$qc_death_slime1" : "$qc_death_slime2", victim.actor, -1);
  if (victim.waterType === "lava") return result(victim.health < -15 ? "$qc_death_lava1" : random() < 0.5 ? "$qc_death_lava2" : "$qc_death_lava3", victim.actor, -1);
  if (attacker?.brush && attacker.classname !== "worldspawn") return result("$qc_death_squish", victim.actor, -1);
  if (attacker !== null && attacker.killString !== "") return result(attacker.killString, victim.actor, -1);
  return result(input.deathType === "falling" ? "$qc_death_fall" : "$qc_death_died", victim.actor, -1);
}

export type Q1IntermissionResult = { readonly kind: "waiting" } | { readonly kind: "travel"; readonly map: string } | { readonly kind: "finale"; readonly text: string; readonly track: 2 } | { readonly kind: "sell-screen" };
export class Q1LevelRules {
  private nextMap = "";
  private stage = 0;
  private exitAfter = 0;
  constructor(readonly game: Q1Foundation, readonly campaign: Q1CampaignBinding, readonly registered = true) {
    game.named.register("base:next_level", { action: (_game, entity) => { this.begin(this.nextMap, null); return game.remove(entity); } });
  }
  capture() { return { nextMap: this.nextMap, stage: this.stage, exitAfter: this.exitAfter }; }
  restore(reader: SaveReader): undefined { this.nextMap = reader.field("nextMap").string(); this.stage = reader.field("stage").integer(0); this.exitAfter = reader.field("exitAfter").number(); return undefined; }
  begin(map: string, cause: ActorId | null): undefined { this.nextMap = map; this.stage = 1; this.exitAfter = this.game.time + (this.game.options.deathmatch !== 0 ? 5 : 2); return this.game.beginIntermission(map, cause); }
  checkLimits(seconds: number, scores: readonly number[], timelimitMinutes: number, fraglimit: number): boolean {
    if (this.nextMap !== "" || timelimitMinutes === 0 && fraglimit === 0) return false;
    if (!(timelimitMinutes !== 0 && seconds >= timelimitMinutes * 60) && !(fraglimit !== 0 && scores.some(score => score >= fraglimit))) return false;
    this.game.time = seconds; let next = this.game.mapName;
    if (next === "start") {
      const flags = this.campaign.readFlags();
      if (!this.registered) next = "e1m1";
      else if ((flags & 1) === 0) { next = "e1m1"; this.campaign.writeFlags(flags | 1); }
      else if ((flags & 2) === 0) { next = "e2m1"; this.campaign.writeFlags(flags | 2); }
      else if ((flags & 4) === 0) { next = "e3m1"; this.campaign.writeFlags(flags | 4); }
      else if ((flags & 8) === 0) { next = "e4m1"; this.campaign.writeFlags(flags - 7); }
    } else next = [...this.game.entities.values()].find(entity => entity.classname === "trigger_changelevel")?.text("map") || next;
    this.nextMap = next; const timer = this.game.create("nextlevel");
    this.game.schedule(timer, 0.1, this.game.named.action(timer, "base:next_level")); return true;
  }
  requestExit(seconds: number, pressed: boolean, sameLevel = false): Q1IntermissionResult {
    if (this.stage === 0 || !pressed || seconds < this.exitAfter) return { kind: "waiting" };
    const travel = (): Q1IntermissionResult => {
      const map = sameLevel ? this.game.mapName : this.nextMap; this.game.time = seconds; this.game.intermission = null; this.game.travel(map, null); this.stage = 0; return { kind: "travel", map };
    };
    if (this.game.options.deathmatch !== 0) return travel();
    this.exitAfter = seconds + 1; this.stage++;
    if (this.stage === 2) {
      const map = this.game.mapName;
      const text = map === "e1m7" ? this.registered ? "$qc_finale_e1" : "$qc_finale_e1_shareware" : map === "e2m6" ? "$qc_finale_e2" : map === "e3m6" ? "$qc_finale_e3" : map === "e4m7" ? "$qc_finale_e4" : null;
      if (text !== null) return { kind: "finale", text: q1FinaleText(this.game.options.edition, text), track: 2 };
      return travel();
    }
    if (this.stage === 3) {
      if (!this.registered) return { kind: "sell-screen" };
      if ((this.campaign.readFlags() & 15) === 15) return { kind: "finale", text: q1FinaleText(this.game.options.edition, "$qc_finale_all_runes"), track: 2 };
    }
    return travel();
  }
}
