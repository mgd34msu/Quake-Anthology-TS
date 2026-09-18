import type { SharedSimulation } from "./runtime.ts";
import type { BotKnowledge } from "../../../bots/behavior/rerelease/data/knowledge.ts";
import type { RereleaseBotObjectives } from "./bot-rerelease-world.ts";
import { Q2Ctf } from "../../../content/q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import { Q2Tag } from "../../../content/q2/missionpacks/modes/tag.ts";
import { Q2DeathBall } from "../../../content/q2/missionpacks/modes/deathball.ts";
export function rereleaseBotObjectives(simulation: SharedSimulation, knowledge: BotKnowledge): RereleaseBotObjectives {
  const q1 = simulation.q1Source(), q2 = simulation.q2Source(), match = q2?.product.match.source;
  const registry = q1?.cvars ?? simulation.q2ServerCvars();
  if (registry === null) throw new Error("Bot objective source registry unavailable");
  return {
    admit: actor => {
      if (!(match instanceof Q2Ctf || match instanceof Q2Lmctf) || (match.states.get(actor)?.team ?? 0) !== 0) return;
      let red = 0, blue = 0;
      for (const player of simulation.players()) {
        const team = match.states.get(player)?.team;
        if (team === 1) red++; else if (team === 2) blue++;
      }
      simulation.playerCommand(actor, "team", [red <= blue ? "red" : "blue"]);
    },
    mode: () => {
      const mode = knowledge.gameMode(name => registry.variableValue(name));
      if (q1?.composition.ctf !== null && q1?.composition.ctf !== undefined || match instanceof Q2Ctf || match instanceof Q2Lmctf)
        return { ...mode, gameType: "ctf", hasTeams: true };
      if (simulation.options.mode === "coop" || simulation.options.mode === "singleplayer")
        return { ...mode, gameType: registry.variableValue("horde") !== 0 ? "horde" : "coop", hasTeams: true };
      if (match instanceof Q2DeathBall) return { ...mode, hasTeams: true };
      return mode;
    },
    team: actor => {
      if (simulation.options.mode !== "deathmatch" && simulation.movementPlayer(actor) !== null) return 1;
      if (match instanceof Q2Ctf || match instanceof Q2Lmctf) return match.states.get(actor)?.team ?? 0;
      if (match instanceof Q2DeathBall) {
        const skin = match.hooks.skin(actor), settings = match.hooks.settings();
        return skin === settings.team1Skin ? 1 : skin === settings.team2Skin ? 2 : 0;
      }
      const team = simulation.combat.read(actor)?.team;
      return team === "red" || team === "1" ? 1 : team === "blue" || team === "2" ? 2 : 0;
    },
    carrying: actor => {
      if (q1?.composition.ctf !== null && q1?.composition.ctf !== undefined) return q1.composition.ctf.carried(actor) !== null;
      if (match instanceof Q2Lmctf && q2 !== null) return match.flags.carried(actor, q2.game) !== null;
      if (match instanceof Q2Ctf) return simulation.inventory.count(actor, "q2:item_flag_team1") > 0 || simulation.inventory.count(actor, "q2:item_flag_team2") > 0;
      return match instanceof Q2Tag && match.ownerActor()?.equals(actor) === true;
    },
    goal: actor => {
      if (simulation.options.mode !== "deathmatch") return q2?.product.rerelease?.entities.poi?.origin ?? null;
      const target = match instanceof Q2Tag ? match.ownerActor() : match instanceof Q2DeathBall ? match.ballActor() : null;
      return target === null || target.equals(actor) ? null : simulation.bodies.read(target)?.origin ?? null;
    },
  };
}
