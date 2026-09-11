import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use } from "../foundation/host.ts";
import { numberField } from "../foundation/fields.ts";
import type { Q2RereleasePlayers } from "./players.ts";
import type { Q2RereleaseCampaignState } from "./campaign.ts";
import type { Q2RereleaseHooks } from "./types.ts";

export interface Q2RereleaseGoalsCheckpoint { readonly goals: string | null; readonly goalNumber: number; }

export class Q2RereleaseGoals implements Q2SpawnModule {
  goals: string | null = null;
  goalNumber = 0;

  constructor(readonly players: Q2RereleasePlayers, readonly campaign: Q2RereleaseCampaignState, readonly hooks: Q2RereleaseHooks, readonly setPoi: Q2Use) {}

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname === "worldspawn") {
      if (numberField(entity.spawn, "hub_map") !== 0) {
        Object.assign(this.campaign.mission, { primary: "", secondary: "", primaryChanges: 0, secondaryChanges: 0 });
        for (const extra of this.players.rereleaseStates.values()) { extra.gameHelp1Changed = 0; extra.gameHelp2Changed = 0; }
      }
      this.goals = entity.spawn.values.get("goals") ?? null;
      if (this.goals !== null) this.campaign.mission.primaryChanges++;
      return false;
    }
    if (entity.classname !== "target_help" && entity.classname !== "target_secret" && entity.classname !== "target_goal") return false;
    if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
    if (entity.classname === "target_help") {
      if (entity.message === "") { game.host.diagnostic("target_help has no message"); game.remove(entity); return true; }
      entity.use = this.helpUse;
      return true;
    }
    entity.visible = false; entity.serverFlags |= 1; entity.use = this.goalUse;
    if (entity.classname === "target_secret") { game.counters.totalSecrets++; game.schedule(entity, 0.01, this.verifyTarget); }
    else game.counters.totalGoals++;
    return true;
  }

  readonly helpUse: Q2Use = (entity, game, other, activator) => {
    const mission = this.campaign.mission;
    let changed = false;
    if ((entity.spawnflags & 1) !== 0) {
      if (mission.primary !== entity.message) { mission.primary = entity.message.slice(0, 511); mission.primaryChanges++; changed = true; }
    } else if (mission.secondary !== entity.message) { mission.secondary = entity.message.slice(0, 511); mission.secondaryChanges++; changed = true; }
    if (changed) game.host.emit({ kind: "help", slot: (entity.spawnflags & 1) !== 0 ? 1 : 2, text: entity.message });
    if ((entity.spawnflags & 2) !== 0) this.setPoi(entity, game, other, activator);
    return undefined;
  };

  private readonly verifyTarget: Q2Think = (entity, game) => {
    if (entity.targetname === "") game.host.diagnostic(`WARNING: missing targetname on ${entity.classname}`);
    else if (![...game.entities.values()].some(other => other.target === entity.targetname)) game.host.diagnostic(`WARNING: nothing targets ${entity.classname} ${entity.targetname}`);
    return undefined;
  };

  private readonly goalUse: Q2Use = (entity, game, _other, activator) => {
    game.sound(entity, entity.spawn.values.get("noise") ?? "misc/secret.wav", 2);
    if (entity.classname === "target_secret") game.counters.foundSecrets++;
    else {
      game.counters.foundGoals++;
      if (game.counters.foundGoals === game.counters.totalGoals && (entity.spawnflags & 1) === 0) game.host.emit({ kind: "music", track: String(numberField(entity.spawn, "sounds")) });
      if (this.goals !== null) {
        this.goalNumber++; this.campaign.mission.primaryChanges++;
        for (const actor of game.host.players()) { const player = game.entity(actor); if (player !== null) this.notify(player, game); }
      }
    }
    game.useTargets(entity, activator);
    return game.remove(entity);
  };

  notify(entity: Q2Entity, game: Q2GameServices): undefined {
    const state = this.players.states.get(entity.actor.id), extra = this.players.rereleaseStates.get(entity.actor.id);
    if (game.options.mode === "deathmatch" || state === undefined || extra === undefined || !extra.spawned || game.host.now() - state.enteredAt < 0.3) return undefined;
    const mission = this.campaign.mission;
    if (this.goals !== null) {
      if (mission.primaryChanges !== mission.secondaryChanges) {
        const goal = this.goals.split("\t")[this.goalNumber];
        if (goal === undefined) throw new Error("Invalid Quake 64 goals: completed goal index exceeds the authored goal list");
        mission.primary = goal.slice(0, 511); mission.secondaryChanges = mission.primaryChanges;
      }
      if (extra.gameHelp1Changed !== mission.primaryChanges) {
        this.hooks.emit({ kind: "mission-objective", actor: entity.actor.id, text: mission.primary, args: [], talkSound: true });
        extra.gameHelp1Changed = mission.primaryChanges;
      }
      return undefined;
    }
    if (extra.gameHelp1Changed !== mission.primaryChanges) {
      extra.gameHelp1Changed = mission.primaryChanges; extra.helpChanged = 1; extra.helpTime = game.host.now() + 5;
      if (mission.primary !== "") this.hooks.emit({ kind: "mission-objective", actor: entity.actor.id, text: "$g_primary_mission_objective", args: [mission.primary], talkSound: false });
    }
    if (extra.gameHelp2Changed !== mission.secondaryChanges) {
      extra.gameHelp2Changed = mission.secondaryChanges; extra.helpChanged = 1; extra.helpTime = game.host.now() + 5;
      if (mission.secondary !== "") this.hooks.emit({ kind: "mission-objective", actor: entity.actor.id, text: "$g_secondary_mission_objective", args: [mission.secondary], talkSound: false });
    }
    return undefined;
  }

  endPlayerFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    const extra = this.players.extra(entity.actor.id), now = game.host.now();
    if (extra.helpChanged !== 0 && extra.helpChanged <= 3 && extra.helpTime < now) {
      if (extra.helpChanged === 1) game.sound(entity, "misc/pc_up.wav", 0, 1, 3);
      extra.helpChanged++; extra.helpTime = now + 5;
    }
    return this.hooks.emit({ kind: "mission-status", actor: entity.actor.id, iconVisible: extra.helpChanged >= 1 && extra.helpChanged <= 2 && Math.trunc(now * 1000) % 1000 < 500 });
  }

  help(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.players.intermission.kind !== "playing") return undefined;
    const state = this.players.context(entity, game).state, extra = this.players.extra(entity.actor.id), mission = this.campaign.mission;
    state.showInventory = false; state.showScores = false;
    if (state.showHelp && (extra.gameHelp1Changed === mission.primaryChanges || extra.gameHelp2Changed === mission.secondaryChanges)) state.showHelp = false;
    else { state.showHelp = true; extra.helpChanged = 0; }
    this.players.hooks.emit({ kind: "help", actor: entity.actor.id, visible: state.showHelp });
    return this.hooks.emit({ kind: "help-computer", actor: entity.actor.id, visible: state.showHelp, primary: mission.primary, secondary: mission.secondary, slowTime: state.showHelp });
  }

  capture(): Q2RereleaseGoalsCheckpoint { return { goals: this.goals, goalNumber: this.goalNumber }; }
  restore(checkpoint: Q2RereleaseGoalsCheckpoint): undefined { this.goals = checkpoint.goals; this.goalNumber = checkpoint.goalNumber; return undefined; }
  get callbacks(): Q2CallbackDefinitions { return { think: { "rr.G_VerifyTargetted": this.verifyTarget }, use: { "rr.Use_Target_Help": this.helpUse, "rr.use_target_goal_or_secret": this.goalUse } }; }
}
